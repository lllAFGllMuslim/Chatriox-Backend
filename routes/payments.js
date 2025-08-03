const express = require('express');
const { body, validationResult } = require('express-validator');
const { auth } = require('../middleware/auth');
const User = require('../models/User');
const CashfreeService = require('../services/CashfreeService');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// Plan configurations with INR pricing (USD * 85)
const PLANS = {
  starter: {
    name: 'Starter',
    price: { monthly: 2465, yearly: 24650 }, // $29 * 85, $290 * 85
    features: {
      emailsPerMonth: 5000,
      emailAccounts: 1,
      whatsappAccounts: 1,
      templates: 'basic',
      validation: true,
      analytics: 'basic',
      support: 'email',
      whatsapp: false,
      scraper: false,
      customBranding: false,
      apiAccess: false
    },
    trialLimits: {
      emailsPerMonth: 100,
      emailAccounts: 1,
      whatsappAccounts: 1,
      templates: 'basic',
      validation: 50,
      analytics: 'basic'
    }
  },
  professional: {
    name: 'Professional',
    price: { monthly: 6715, yearly: 67150 }, // $79 * 85, $790 * 85
    features: {
      emailsPerMonth: 25000,
      emailAccounts: 5,
      whatsappAccounts: 3,
      templates: 'premium',
      validation: true,
      analytics: 'advanced',
      support: 'priority',
      whatsapp: true,
      scraper: true,
      customBranding: false,
      apiAccess: false
    },
    trialLimits: {
      emailsPerMonth: 500,
      emailAccounts: 2,
      whatsappAccounts: 1,
      templates: 'premium',
      validation: 200,
      analytics: 'advanced'
    }
  },
  enterprise: {
    name: 'Enterprise',
    price: { monthly: 16915, yearly: 169150 }, // $199 * 85, $1990 * 85
    features: {
      emailsPerMonth: -1, // unlimited
      emailAccounts: -1, // unlimited
      whatsappAccounts: 10,
      templates: 'custom',
      validation: 'advanced',
      analytics: 'enterprise',
      support: '24/7',
      whatsapp: true,
      scraper: 'advanced',
      customBranding: true,
      apiAccess: true
    },
    trialLimits: {
      emailsPerMonth: 1000,
      emailAccounts: 3,
      whatsappAccounts: 2,
      templates: 'custom',
      validation: 500,
      analytics: 'enterprise'
    }
  }
};

// @route   POST /api/payments/create-order
// @desc    Create payment order
// @access  Private
router.post('/create-order', [
  auth,
  body('planId').isIn(['starter', 'professional', 'enterprise']).withMessage('Invalid plan'),
  body('billingCycle').isIn(['monthly', 'yearly']).withMessage('Invalid billing cycle')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { planId, billingCycle } = req.body;
    const userId = req.user.id;
    const user = await User.findById(userId);

    const plan = PLANS[planId];
    if (!plan) {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan selected'
      });
    }

    const orderId = `ORDER_${Date.now()}_${userId}`;
    const orderAmount = plan.price[billingCycle];

    const orderData = {
      orderId,
      orderAmount,
      orderCurrency: 'INR',
      customerName: user.name,
      customerEmail: user.email,
      customerPhone: user.phone || '9999999999',
      returnUrl: `${process.env.FRONTEND_URL}/payment/success`,
      notifyUrl: `${process.env.BACKEND_URL}/api/payments/webhook`
    };

    const result = await CashfreeService.createOrder(orderData);

    if (result.success) {
      res.json({
        success: true,
        data: {
          orderId,
          paymentSessionId: result.data.payment_session_id,
          orderAmount,
          planId,
          billingCycle
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Failed to create payment order',
        error: result.error
      });
    }
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/payments/webhook
// @desc    Handle payment webhook
// @access  Public
router.post('/webhook', async (req, res) => {
  try {
    const {
      orderId,
      orderAmount,
      referenceId,
      txStatus,
      paymentMode,
      txMsg,
      txTime,
      signature
    } = req.body;

    // Verify signature
    const isValidSignature = CashfreeService.verifySignature(
      orderId,
      orderAmount,
      referenceId,
      txStatus,
      paymentMode,
      txMsg,
      txTime,
      signature
    );

    if (!isValidSignature) {
      return res.status(400).json({
        success: false,
        message: 'Invalid signature'
      });
    }

    // Extract user ID from order ID
    const userId = orderId.split('_')[2];
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (txStatus === 'SUCCESS') {
      // Extract plan info from order (you might want to store this in a separate orders table)
      const orderInfo = await getOrderInfo(orderId); // Implement this function
      
      // Update user plan
      user.planStatus = 'active';
      user.plan = orderInfo.planId;
      user.planExpiry = new Date(Date.now() + (orderInfo.billingCycle === 'yearly' ? 365 : 30) * 24 * 60 * 60 * 1000);
      
      // Add payment to history
      user.paymentHistory.push({
        orderId,
        paymentId: referenceId,
        amount: orderAmount,
        currency: 'INR',
        status: 'success',
        plan: orderInfo.planId,
        billingCycle: orderInfo.billingCycle,
        paidAt: new Date()
      });

      await user.save();

      // Send confirmation email
      // await sendPaymentConfirmationEmail(user, orderInfo);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/payments/plans
// @desc    Get all plans with trial limits
// @access  Private
router.get('/plans', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const isInTrial = user.isInTrial();
    const trialDaysRemaining = user.getTrialDaysRemaining();

    const plans = Object.keys(PLANS).map(key => ({
      id: key,
      ...PLANS[key],
      isCurrentPlan: user.plan === key && user.planStatus === 'active',
      trialDaysRemaining: isInTrial ? trialDaysRemaining : 0
    }));

    res.json({
      success: true,
      data: {
        plans,
        currentUser: {
          plan: user.plan,
          planStatus: user.planStatus,
          isInTrial,
          trialDaysRemaining,
          planExpiry: user.planExpiry
        }
      }
    });
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/payments/trial-status
// @desc    Get trial status
// @access  Private
router.get('/trial-status', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const isInTrial = user.isInTrial();
    const isTrialExpired = user.isTrialExpired();
    const trialDaysRemaining = user.getTrialDaysRemaining();

    res.json({
      success: true,
      data: {
        isInTrial,
        isTrialExpired,
        trialDaysRemaining,
        trialStartDate: user.trialStartDate,
        trialEndDate: user.trialEndDate,
        planStatus: user.planStatus,
        currentPlan: user.plan
      }
    });
  } catch (error) {
    console.error('Get trial status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/payments/extend-trial
// @desc    Extend trial (admin only)
// @access  Private/Admin
router.post('/extend-trial', [auth], async (req, res) => {
  try {
    const { userId, days } = req.body;
    
    // Check if current user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.trialEndDate = new Date(user.trialEndDate.getTime() + days * 24 * 60 * 60 * 1000);
    await user.save();

    res.json({
      success: true,
      message: `Trial extended by ${days} days`,
      data: {
        newTrialEndDate: user.trialEndDate
      }
    });
  } catch (error) {
    console.error('Extend trial error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Helper function to get order info (implement based on your needs)
async function getOrderInfo(orderId) {
  // This is a simplified version - you might want to store order details in database
  return {
    planId: 'starter', // Extract from order or database
    billingCycle: 'monthly' // Extract from order or database
  };
}

module.exports = router;