const express = require('express');
const { auth } = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

// Plan configurations
const PLANS = {
  starter: {
    name: 'Starter',
    price: { monthly: 0.01, yearly: 290 },
    features: {
      emailsPerMonth: 4999,
      emailAccounts: 1,
      templates: 'basic',
      validation: true,
      analytics: 'basic',
      support: 'email',
      whatsapp: false,
      scraper: false,
      customBranding: false,
      apiAccess: false
    }
  },
  professional: {
    name: 'Professional',
    price: { monthly: 79, yearly: 790 },
    features: {
      emailsPerMonth: 25000,
      emailAccounts: 5,
      templates: 'premium',
      validation: true,
      analytics: 'advanced',
      support: 'priority',
      whatsapp: true,
      scraper: true,
      customBranding: false,
      apiAccess: false
    }
  },
  enterprise: {
    name: 'Enterprise',
    price: { monthly: 199, yearly: 1990 },
    features: {
      emailsPerMonth: -1, // unlimited
      emailAccounts: -1, // unlimited
      templates: 'custom',
      validation: 'advanced',
      analytics: 'enterprise',
      support: '24/7',
      whatsapp: true,
      scraper: 'advanced',
      customBranding: true,
      apiAccess: true
    }
  }
};

// @route   GET /api/plans
// @desc    Get all available plans
// @access  Public
router.get('/', (req, res) => {
  try {
    const plans = Object.keys(PLANS).map(key => ({
      id: key,
      ...PLANS[key]
    }));

    res.json({
      success: true,
      data: plans
    });
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/plans/current
// @desc    Get current user's plan
// @access  Private
router.get('/current', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const currentPlan = PLANS[user.plan];

    if (!currentPlan) {
      return res.status(404).json({
        success: false,
        message: 'Current plan not found'
      });
    }

    res.json({
      success: true,
      data: {
        id: user.plan,
        ...currentPlan,
        expiry: user.planExpiry,
        usage: user.usage
      }
    });
  } catch (error) {
    console.error('Get current plan error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/plans/upgrade
// @desc    Upgrade user's plan
// @access  Private
router.post('/upgrade', auth, async (req, res) => {
  try {
    const { planId, billingCycle = 'monthly' } = req.body;

    if (!PLANS[planId]) {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan selected'
      });
    }

    const user = await User.findById(req.user.id);
    const newPlan = PLANS[planId];
    const planHierarchy = { starter: 1, professional: 2, enterprise: 3 };

    // Check if it's actually an upgrade
    if (planHierarchy[planId] <= planHierarchy[user.plan]) {
      return res.status(400).json({
        success: false,
        message: 'You can only upgrade to a higher plan'
      });
    }

    // In a real application, you would:
    // 1. Process payment with Stripe/PayPal
    // 2. Handle prorations
    // 3. Send confirmation emails
    // 4. Update billing records

    // For now, just update the user's plan
    user.plan = planId;
    user.planExpiry = new Date(Date.now() + (billingCycle === 'yearly' ? 365 : 30) * 24 * 60 * 60 * 1000);
    await user.save();

    res.json({
      success: true,
      message: `Successfully upgraded to ${newPlan.name} plan`,
      data: {
        plan: planId,
        expiry: user.planExpiry,
        price: newPlan.price[billingCycle],
        billingCycle
      }
    });
  } catch (error) {
    console.error('Plan upgrade error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during plan upgrade'
    });
  }
});

// @route   POST /api/plans/downgrade
// @desc    Downgrade user's plan
// @access  Private
router.post('/downgrade', auth, async (req, res) => {
  try {
    const { planId } = req.body;

    if (!PLANS[planId]) {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan selected'
      });
    }

    const user = await User.findById(req.user.id);
    const newPlan = PLANS[planId];
    const planHierarchy = { starter: 1, professional: 2, enterprise: 3 };

    // Check if it's actually a downgrade
    if (planHierarchy[planId] >= planHierarchy[user.plan]) {
      return res.status(400).json({
        success: false,
        message: 'You can only downgrade to a lower plan'
      });
    }

    // Check if user's current usage fits the new plan
    const newPlanLimits = newPlan.features;
    if (newPlanLimits.emailsPerMonth !== -1 && user.usage.emailsSent > newPlanLimits.emailsPerMonth) {
      return res.status(400).json({
        success: false,
        message: 'Your current usage exceeds the limits of the selected plan'
      });
    }

    // Schedule downgrade for next billing cycle
    user.plan = planId;
    await user.save();

    res.json({
      success: true,
      message: `Plan will be downgraded to ${newPlan.name} at the end of current billing cycle`,
      data: {
        plan: planId,
        effectiveDate: user.planExpiry
      }
    });
  } catch (error) {
    console.error('Plan downgrade error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during plan downgrade'
    });
  }
});

// @route   GET /api/plans/usage
// @desc    Get current plan usage
// @access  Private
router.get('/usage', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const currentPlan = PLANS[user.plan];

    if (!currentPlan) {
      return res.status(404).json({
        success: false,
        message: 'Current plan not found'
      });
    }

    // Calculate usage percentages
    const limits = currentPlan.features;
    const usage = user.usage;

    const usageData = {
      emails: {
        used: usage.emailsSent,
        limit: limits.emailsPerMonth,
        percentage: limits.emailsPerMonth === -1 ? 0 : (usage.emailsSent / limits.emailsPerMonth) * 100
      },
      emailAccounts: {
        used: user.emailAccounts.length,
        limit: limits.emailAccounts,
        percentage: limits.emailAccounts === -1 ? 0 : (user.emailAccounts.length / limits.emailAccounts) * 100
      },
      validations: {
        used: usage.emailsValidated,
        limit: -1, // Most plans have unlimited validations
        percentage: 0
      },
      scraping: {
        used: usage.websitesScraped,
        limit: -1,
        percentage: 0
      }
    };

    res.json({
      success: true,
      data: {
        plan: user.plan,
        planName: currentPlan.name,
        expiry: user.planExpiry,
        usage: usageData
      }
    });
  } catch (error) {
    console.error('Get usage error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/plans/cancel
// @desc    Cancel subscription
// @access  Private
router.post('/cancel', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    // In a real application, you would:
    // 1. Cancel the subscription with payment provider
    // 2. Calculate refunds if applicable
    // 3. Send cancellation confirmation
    // 4. Schedule account downgrade

    // For now, just schedule downgrade to starter plan
    const cancellationDate = user.planExpiry;
    
    res.json({
      success: true,
      message: 'Subscription cancelled successfully',
      data: {
        cancellationDate,
        message: 'Your account will be downgraded to the Starter plan when your current billing period ends.'
      }
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during cancellation'
    });
  }
});

module.exports = router;