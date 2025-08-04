// routes/payment.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { Cashfree } = require('cashfree-pg');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// Initialize Cashfree
Cashfree.XClientId = process.env.CASHFREE_CLIENT_ID;
Cashfree.XClientSecret = process.env.CASHFREE_CLIENT_SECRET;
Cashfree.XEnvironment = process.env.NODE_ENV === 'production' ? Cashfree.Environment.PRODUCTION : Cashfree.Environment.SANDBOX;

// Plan configuration
const PLANS = {
  starter: {
    name: 'Starter',
    price: 0,
    durationDays: 3, 
    features: ['Basic features']
  },
  professional: {
    name: 'Professional',
    price: 199,
    durationDays: 1, 
    features: ['All features']
  },
  business: {
    name: 'Business',
    price: 499,
    durationDays: 7,
    features: ['All features']
  },
  enterprise: {
    name: 'Enterprise',
    price: 1999,
    durationDays: 30, 
    features: ['All features']
  }
};

// Middleware to check authentication
const authenticateUser = async (req, res, next) => {
  try {
    // Assuming you have JWT auth middleware
    // Replace this with your actual auth middleware
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'Access denied' });
    }
    
    // Verify token and get user (implement your JWT verification)
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// Get all plans
router.get('/plans', (req, res) => {
  try {
    res.json({
      success: true,
      plans: PLANS
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get user's current subscription
router.get('/subscription', authenticateUser, async (req, res) => {
  try {
    const user = req.user;
    
    res.json({
      success: true,
      subscription: {
        plan: user.plan,
        planName: PLANS[user.plan]?.name,
        price: PLANS[user.plan]?.price,
        status: user.planStatus,
        expiry: user.planExpiry,
        daysRemaining: user.getTrialDaysRemaining(),
        isInTrial: user.isInTrial(),
        isTrialExpired: user.isTrialExpired(),
        usage: user.usage
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Create payment order
router.post('/create-order', authenticateUser, async (req, res) => {
  try {
    const { plan } = req.body;
    const user = req.user;

    // Validate plan
    if (!PLANS[plan]) {
      return res.status(400).json({ success: false, message: 'Invalid plan' });
    }

    // Free plan doesn't need payment
    if (PLANS[plan].price === 0) {
      // Directly upgrade to starter plan
      user.plan = 'starter';
      user.planStatus = 'active';
      const planDuration = PLANS[plan].durationDays;
      user.planExpiry = new Date(Date.now() + planDuration * 24 * 60 * 60 * 1000);
      await user.save();

      return res.json({
        success: true,
        message: 'Successfully upgraded to starter plan',
        subscription: {
          plan: user.plan,
          status: user.planStatus,
          expiry: user.planExpiry
        }
      });
    }

    // Generate unique order ID
    const orderId = `order_${user._id}_${Date.now()}`;
    const amount = PLANS[plan].price;

    // Create Cashfree order
    const orderRequest = {
      order_id: orderId,
      order_amount: amount,
      order_currency: 'INR',
      customer_details: {
        customer_id: user._id.toString(),
        customer_name: user.name,
        customer_email: user.email,
        customer_phone: user.phone || '9999999999'
      },
      order_meta: {
        return_url: `${process.env.FRONTEND_URL}/payment/success?order_id=${orderId}`,
        notify_url: `${process.env.BACKEND_URL}/api/payment/webhook`,
        payment_methods: 'cc,dc,nb,upi,wallet'
      },
      order_note: `Subscription for ${PLANS[plan].name} plan`
    };

    const response = await Cashfree.PGCreateOrder('2023-08-01', orderRequest);

    // Save payment record
    user.paymentHistory.push({
      orderId: orderId,
      amount: amount,
      currency: 'INR',
      status: 'pending',
      plan: plan,
      billingCycle: 'monthly'
    });
    await user.save();

    res.json({
      success: true,
      order: {
        orderId: orderId,
        amount: amount,
        plan: plan,
        planName: PLANS[plan].name,
        paymentSessionId: response.data.payment_session_id,
        paymentUrl: response.data.payment_link
      }
    });

  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Verify payment
router.post('/verify', authenticateUser, async (req, res) => {
  try {
    const { orderId } = req.body;
    const user = req.user;

    // Get order status from Cashfree
    const response = await Cashfree.PGOrderFetchPayments('2023-08-01', orderId);
    
    if (response.data && response.data.length > 0) {
      const payment = response.data[0];
      
      // Find payment record
      const paymentRecord = user.paymentHistory.find(p => p.orderId === orderId);
      if (!paymentRecord) {
        return res.status(404).json({ success: false, message: 'Payment record not found' });
      }

      if (payment.payment_status === 'SUCCESS') {
        // Update payment record
        paymentRecord.paymentId = payment.cf_payment_id;
        paymentRecord.status = 'success';
        paymentRecord.paidAt = new Date();

        // Update user subscription
        user.plan = paymentRecord.plan;
        user.planStatus = 'active';
        const planDuration = PLANS[paymentRecord.plan].durationDays;
        user.planExpiry = new Date(Date.now() + planDuration * 24 * 60 * 60 * 1000);

        await user.save();

        res.json({
          success: true,
          message: 'Payment successful',
          subscription: {
            plan: user.plan,
            planName: PLANS[user.plan].name,
            status: user.planStatus,
            expiry: user.planExpiry
          }
        });
      } else {
        paymentRecord.status = 'failed';
        await user.save();
        
        res.json({
          success: false,
          message: 'Payment failed'
        });
      }
    } else {
      res.json({
        success: false,
        message: 'Payment not found'
      });
    }

  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Webhook for payment notifications
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    const body = req.body;

    // Verify webhook signature
    const expectedSignature = crypto
      .createHmac('sha256', process.env.CASHFREE_WEBHOOK_SECRET)
      .update(timestamp + body)
      .digest('base64');

    if (signature !== expectedSignature) {
      return res.status(400).json({ success: false, message: 'Invalid signature' });
    }

    const webhookData = JSON.parse(body);
    
    if (webhookData.type === 'PAYMENT_SUCCESS_WEBHOOK') {
      const { order_id, payment_status, cf_payment_id } = webhookData.data;

      // Find user by order ID
      const user = await User.findOne({ 'paymentHistory.orderId': order_id });
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      // Find payment record
      const paymentRecord = user.paymentHistory.find(p => p.orderId === order_id);
      if (!paymentRecord) {
        return res.status(404).json({ success: false, message: 'Payment record not found' });
      }

      if (payment_status === 'SUCCESS' && paymentRecord.status === 'pending') {
        // Update payment record
        paymentRecord.paymentId = cf_payment_id;
        paymentRecord.status = 'success';
        paymentRecord.paidAt = new Date();

        // Update user subscription
        user.plan = paymentRecord.plan;
        user.planStatus = 'active';
        const planDuration = PLANS[paymentRecord.plan].durationDays;
        user.planExpiry = new Date(Date.now() + planDuration * 24 * 60 * 60 * 1000);
        await user.save();

        console.log(`Payment successful for user ${user.email}, plan: ${user.plan}`);
      }
    }

    res.json({ success: true, message: 'Webhook processed' });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Cancel subscription
router.post('/cancel', authenticateUser, async (req, res) => {
  try {
    const user = req.user;

    user.planStatus = 'cancelled';
    await user.save();

    res.json({
      success: true,
      message: 'Subscription cancelled successfully',
      subscription: {
        plan: user.plan,
        status: user.planStatus,
        expiry: user.planExpiry
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get payment history
router.get('/history', authenticateUser, async (req, res) => {
  try {
    const user = req.user;

    const payments = user.paymentHistory.map(payment => ({
      orderId: payment.orderId,
      paymentId: payment.paymentId,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      plan: payment.plan,
      planName: PLANS[payment.plan]?.name,
      billingCycle: payment.billingCycle,
      paidAt: payment.paidAt,
      createdAt: payment.createdAt
    }));

    res.json({
      success: true,
      payments: payments.reverse() // Latest first
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;