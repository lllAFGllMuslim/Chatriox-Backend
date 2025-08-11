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
    price: { monthly: 1, yearly: 169150 }, // $199 * 85, $1990 * 85
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


const calculateUpgradePrice = (currentPlan, newPlan, billingCycle, daysUsed, currentBillingCycle) => {
  const planHierarchy = { starter: 1, professional: 2, enterprise: 3 };
  
  // Allow billing cycle changes on same plan
  const isHigherTier = planHierarchy[newPlan] > planHierarchy[currentPlan];
  const isSamePlanBillingChange = currentPlan === newPlan && currentBillingCycle !== billingCycle;
  
  if (!isHigherTier && !isSamePlanBillingChange) {
    return null; // Not an upgrade or billing change
  }

  // Don't allow yearly to monthly changes for now
  if (currentBillingCycle === 'yearly' && billingCycle === 'monthly') {
    return null;
  }

  const currentPlanConfig = PLANS[currentPlan];
  const newPlanConfig = PLANS[newPlan];
  
  // Calculate total days in current billing cycle
  const totalDaysInCycle = currentBillingCycle === 'yearly' ? 365 : 30;
  const remainingDays = totalDaysInCycle - daysUsed;
  
  // Calculate daily rate of current plan
  const currentPlanPrice = currentPlanConfig.price[currentBillingCycle];
  const dailyRateCurrentPlan = currentPlanPrice / totalDaysInCycle;
  
  // Calculate credit for remaining days
  const creditAmount = dailyRateCurrentPlan * remainingDays;
  
  // Calculate new plan price
  const newPlanPrice = newPlanConfig.price[billingCycle];
  
  // Final discounted price
  const discountedPrice = Math.max(0, newPlanPrice - creditAmount);
  
  return {
    originalPrice: newPlanPrice,
    creditAmount: Math.round(creditAmount * 100) / 100,
    discountedPrice: Math.round(discountedPrice * 100) / 100,
    remainingDays,
    dailyRate: Math.round(dailyRateCurrentPlan * 100) / 100
  };
};

// @desc    Create payment order
// @access  Private
router.post('/create-order', [
  auth,
  body('planId').isIn(['starter', 'professional', 'enterprise']).withMessage('Invalid plan'),
  body('billingCycle').isIn(['monthly', 'yearly']).withMessage('Invalid billing cycle'),
  body('isUpgrade').optional().isBoolean().withMessage('isUpgrade must be boolean')
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

    const { planId, billingCycle, isUpgrade = false } = req.body;
    const userId = req.user.id;
    const user = await User.findById(userId);

    const plan = PLANS[planId];
    if (!plan) {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan selected'
      });
    }

    let orderAmount = plan.price[billingCycle];
    let upgradeInfo = null;

    // Handle upgrade pricing (including billing cycle changes)
    if (isUpgrade && user.planStatus === 'active') {
      const currentDate = new Date();
      const planStartDate = user.planExpiry ? 
        new Date(user.planExpiry.getTime() - (user.currentBillingCycle === 'yearly' ? 365 : 30) * 24 * 60 * 60 * 1000) 
        : user.createdAt;
      
      const daysUsed = Math.ceil((currentDate - planStartDate) / (1000 * 60 * 60 * 24));
      
      const upgrade = calculateUpgradePrice(
        user.plan, 
        planId, 
        billingCycle, 
        daysUsed, 
        user.currentBillingCycle || 'monthly'
      );
      
      if (!upgrade) {
        return res.status(400).json({
          success: false,
          message: 'Invalid upgrade. You can only upgrade to a higher tier plan or change billing cycles.'
        });
      }
      
      orderAmount = upgrade.discountedPrice;
      upgradeInfo = upgrade;
    }

    const orderId = `ORDER_${Date.now()}_${userId}`;

    const orderData = {
      order_id: orderId,
      order_amount: orderAmount,
      order_currency: 'INR',
      customer_details: {
        customer_id: userId,
        customer_name: user.name,
        customer_email: user.email,
        customer_phone: user.phone || '9999999999'
      },
      order_meta: {
        return_url: `${process.env.FRONTEND_URL}/payment/success?order_id=${orderId}&plan_id=${planId}&billing_cycle=${billingCycle}&is_upgrade=${isUpgrade}`
      }
    };

    const result = await CashfreeService.createOrder(orderData);

    if (result.success) {
      res.json({
        success: true,
        data: {
          orderId,
          paymentSessionId: result.data.payment_session_id,
          orderAmount,
          originalAmount: plan.price[billingCycle],
          planId,
          billingCycle,
          isUpgrade,
          upgradeInfo
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


router.post('/calculate-upgrade', [
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

    if (user.planStatus !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'No active plan found for upgrade calculation'
      });
    }

    // Calculate days used in current plan
    const currentDate = new Date();
    const planStartDate = user.planExpiry ? 
      new Date(user.planExpiry.getTime() - (user.currentBillingCycle === 'yearly' ? 365 : 30) * 24 * 60 * 60 * 1000) 
      : user.createdAt;
    
    const daysUsed = Math.ceil((currentDate - planStartDate) / (1000 * 60 * 60 * 24));
    
    const upgrade = calculateUpgradePrice(
      user.plan, 
      planId, 
      billingCycle, 
      daysUsed, 
      user.currentBillingCycle || 'monthly'
    );
    
    if (!upgrade) {
      return res.status(400).json({
        success: false,
        message: 'Invalid upgrade. You can only upgrade to a higher tier plan or change billing cycles.'
      });
    }

    res.json({
      success: true,
      data: {
        currentPlan: user.plan,
        newPlan: planId,
        billingCycle,
        daysUsed,
        ...upgrade
      }
    });
  } catch (error) {
    console.error('Calculate upgrade error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Verify payment manually (call this after payment success)
// @access  Private
router.post('/verify-payment', [
  auth,
  body('orderId').notEmpty().withMessage('Order ID is required'),
  body('planId').isIn(['starter', 'professional', 'enterprise']).withMessage('Invalid plan'),
  body('billingCycle').isIn(['monthly', 'yearly']).withMessage('Invalid billing cycle'),
  body('isUpgrade').optional().isBoolean().withMessage('isUpgrade must be boolean') // Add this validation
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

    const { orderId, planId, billingCycle, isUpgrade = false } = req.body; // Extract isUpgrade
    const userId = req.user.id;

    // Verify order status with Cashfree
    const orderStatus = await CashfreeService.getOrderStatus(orderId);
    
    if (!orderStatus.success) {
      return res.status(400).json({
        success: false,
        message: 'Failed to verify payment status'
      });
    }

    if (orderStatus.data.order_status === 'PAID') {
      const user = await User.findById(userId);
      
      // Store previous plan info for upgrade handling
      const previousPlan = user.plan;
      const previousExpiry = user.planExpiry;
      
      // Update user plan
      user.planStatus = 'active';
      user.plan = planId;
      user.currentBillingCycle = billingCycle; // Add this field to track current billing cycle
      
      // Handle plan expiry based on upgrade or new subscription
      if (isUpgrade && previousExpiry && new Date() < previousExpiry) {
        // For upgrades, extend from current expiry date instead of now
        const daysToAdd = billingCycle === 'yearly' ? 365 : 30;
        user.planExpiry = new Date(previousExpiry.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
      } else {
        // For new subscriptions or expired plans
        user.planExpiry = new Date(Date.now() + (billingCycle === 'yearly' ? 365 : 30) * 24 * 60 * 60 * 1000);
      }
      
      // Add payment to history with upgrade info
      const paymentRecord = {
        orderId,
        paymentId: orderStatus.data.cf_payment_id,
        amount: orderStatus.data.order_amount,
        currency: 'INR',
        status: 'success',
        plan: planId,
        billingCycle: billingCycle,
        paidAt: new Date()
      };
      
      if (isUpgrade) {
        paymentRecord.isUpgrade = true;
        paymentRecord.previousPlan = previousPlan;
      }
      
      user.paymentHistory.push(paymentRecord);

      await user.save();

      res.json({
        success: true,
        message: 'Payment verified and plan activated',
        data: {
          plan: planId,
          billingCycle,
          planExpiry: user.planExpiry,
          wasUpgrade: isUpgrade
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Payment not completed',
        status: orderStatus.data.order_status
      });
    }
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});


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
          currentBillingCycle: user.currentBillingCycle || 'monthly', // Add this
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

module.exports = router;
