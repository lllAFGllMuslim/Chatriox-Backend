const express = require('express');
const { auth, admin } = require('../middleware/auth');
const User = require('../models/User');
const Campaign = require('../models/Campaign');
const WhatsAppCampaign = require('../models/WhatsAppCampaign');
const EmailValidation = require('../models/EmailValidation');

const router = express.Router();

// @route   GET /api/admin/dashboard
// @desc    Get admin dashboard statistics
// @access  Private/Admin
router.get('/dashboard', [auth, admin], async (req, res) => {
  try {
    const { timeRange = '30d' } = req.query;
    
    // Calculate date range
    const now = new Date();
    let startDate;
    
    switch (timeRange) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // User statistics
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ isActive: true });
    const trialUsers = await User.countDocuments({ planStatus: 'trial' });
    const paidUsers = await User.countDocuments({ planStatus: 'active' });
    const expiredUsers = await User.countDocuments({ planStatus: 'expired' });

    // New users in time range
    const newUsers = await User.countDocuments({
      createdAt: { $gte: startDate }
    });

    // Trial to paid conversion
    const trialToPaidUsers = await User.countDocuments({
      planStatus: 'active',
      'paymentHistory.0': { $exists: true },
      createdAt: { $gte: startDate }
    });

    // Plan distribution
    const planDistribution = await User.aggregate([
      { $match: { planStatus: 'active' } },
      {
        $group: {
          _id: '$plan',
          count: { $sum: 1 },
          revenue: {
            $sum: {
              $cond: [
                { $eq: ['$plan', 'starter'] }, 2465,
                { $cond: [
                  { $eq: ['$plan', 'professional'] }, 6715,
                  16915
                ]}
              ]
            }
          }
        }
      }
    ]);

    // Daily active users
    const dailyActiveUsers = await User.countDocuments({
      lastLogin: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) }
    });

    // Weekly active users
    const weeklyActiveUsers = await User.countDocuments({
      lastLogin: { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) }
    });

    // Campaign statistics
    const totalCampaigns = await Campaign.countDocuments({
      createdAt: { $gte: startDate }
    });

    const totalWhatsAppCampaigns = await WhatsAppCampaign.countDocuments({
      createdAt: { $gte: startDate }
    });

    // Email validations
    const totalValidations = await EmailValidation.countDocuments({
      validatedAt: { $gte: startDate }
    });

    // Revenue calculation
    const revenueData = await User.aggregate([
      {
        $match: {
          'paymentHistory.paidAt': { $gte: startDate }
        }
      },
      {
        $unwind: '$paymentHistory'
      },
      {
        $match: {
          'paymentHistory.paidAt': { $gte: startDate },
          'paymentHistory.status': 'success'
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$paymentHistory.amount' },
          totalTransactions: { $sum: 1 }
        }
      }
    ]);

    const revenue = revenueData[0] || { totalRevenue: 0, totalTransactions: 0 };

    // Trial expiry alerts (users expiring in next 24 hours)
    const trialExpiringUsers = await User.countDocuments({
      planStatus: 'trial',
      trialEndDate: {
        $gte: now,
        $lte: new Date(now.getTime() + 24 * 60 * 60 * 1000)
      }
    });

    // Growth metrics
    const previousPeriodStart = new Date(startDate.getTime() - (now.getTime() - startDate.getTime()));
    const previousNewUsers = await User.countDocuments({
      createdAt: { $gte: previousPeriodStart, $lt: startDate }
    });

    const userGrowthRate = previousNewUsers > 0 ? 
      ((newUsers - previousNewUsers) / previousNewUsers) * 100 : 0;

    res.json({
      success: true,
      data: {
        overview: {
          totalUsers,
          activeUsers,
          trialUsers,
          paidUsers,
          expiredUsers,
          newUsers,
          trialToPaidUsers,
          dailyActiveUsers,
          weeklyActiveUsers,
          userGrowthRate: parseFloat(userGrowthRate.toFixed(2))
        },
        revenue: {
          totalRevenue: revenue.totalRevenue,
          totalTransactions: revenue.totalTransactions,
          averageOrderValue: revenue.totalTransactions > 0 ? 
            revenue.totalRevenue / revenue.totalTransactions : 0
        },
        campaigns: {
          totalEmailCampaigns: totalCampaigns,
          totalWhatsAppCampaigns,
          totalValidations
        },
        planDistribution,
        alerts: {
          trialExpiringUsers
        }
      }
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/admin/users
// @desc    Get users with filters
// @access  Private/Admin
router.get('/users', [auth, admin], async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      search, 
      plan, 
      planStatus, 
      dateRange,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;
    
    const query = {};
    
    // Search by name or email
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Filter by plan
    if (plan) query.plan = plan;
    
    // Filter by plan status
    if (planStatus) query.planStatus = planStatus;
    
    // Filter by date range
    if (dateRange) {
      const now = new Date();
      let startDate;
      
      switch (dateRange) {
        case '7d':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case '90d':
          startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
      }
      
      if (startDate) {
        query.createdAt = { $gte: startDate };
      }
    }
    
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
    
    const users = await User.find(query)
      .select('-password')
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await User.countDocuments(query);
    
    // Add computed fields
    const usersWithComputedFields = users.map(user => {
      const userObj = user.toObject();
      userObj.isInTrial = user.isInTrial();
      userObj.trialDaysRemaining = user.getTrialDaysRemaining();
      userObj.totalRevenue = user.paymentHistory
        .filter(p => p.status === 'success')
        .reduce((sum, p) => sum + p.amount, 0);
      return userObj;
    });
    
    res.json({
      success: true,
      data: usersWithComputedFields,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get admin users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/admin/analytics
// @desc    Get detailed analytics
// @access  Private/Admin
router.get('/analytics', [auth, admin], async (req, res) => {
  try {
    const { timeRange = '30d' } = req.query;
    
    // User registration trends (last 30 days)
    const registrationTrends = await User.aggregate([
      {
        $match: {
          createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
      }
    ]);

    // Revenue trends
    const revenueTrends = await User.aggregate([
      { $unwind: '$paymentHistory' },
      {
        $match: {
          'paymentHistory.paidAt': { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          'paymentHistory.status': 'success'
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$paymentHistory.paidAt' },
            month: { $month: '$paymentHistory.paidAt' },
            day: { $dayOfMonth: '$paymentHistory.paidAt' }
          },
          revenue: { $sum: '$paymentHistory.amount' },
          transactions: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
      }
    ]);

    // Trial conversion rates
    const trialConversion = await User.aggregate([
      {
        $group: {
          _id: '$planStatus',
          count: { $sum: 1 }
        }
      }
    ]);

    // Plan popularity
    const planPopularity = await User.aggregate([
      {
        $match: { planStatus: 'active' }
      },
      {
        $group: {
          _id: '$plan',
          count: { $sum: 1 },
          revenue: {
            $sum: {
              $reduce: {
                input: '$paymentHistory',
                initialValue: 0,
                in: {
                  $cond: [
                    { $eq: ['$$this.status', 'success'] },
                    { $add: ['$$value', '$$this.amount'] },
                    '$$value'
                  ]
                }
              }
            }
          }
        }
      }
    ]);

    // Churn analysis
    const churnedUsers = await User.countDocuments({
      planStatus: 'expired',
      planExpiry: { $lt: new Date() }
    });

    res.json({
      success: true,
      data: {
        registrationTrends,
        revenueTrends,
        trialConversion,
        planPopularity,
        churnedUsers
      }
    });
  } catch (error) {
    console.error('Admin analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/admin/users/:id/plan
// @desc    Update user plan (admin)
// @access  Private/Admin
router.put('/users/:id/plan', [auth, admin], async (req, res) => {
  try {
    const { plan, planStatus, planExpiry } = req.body;
    const userId = req.params.id;
    
    const updateData = {};
    if (plan) updateData.plan = plan;
    if (planStatus) updateData.planStatus = planStatus;
    if (planExpiry) updateData.planExpiry = new Date(planExpiry);
    
    const user = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true }
    ).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      message: 'User plan updated successfully',
      data: user
    });
  } catch (error) {
    console.error('Update user plan error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/admin/users/:id/extend-trial
// @desc    Extend user trial
// @access  Private/Admin
router.post('/users/:id/extend-trial', [auth, admin], async (req, res) => {
  try {
    const { days } = req.body;
    const userId = req.params.id;
    
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