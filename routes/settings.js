const express = require('express');
const { body, validationResult } = require('express-validator');
const { auth } = require('../middleware/auth');
const User = require('../models/User');
const bcrypt = require('bcryptjs');

const router = express.Router();

// @route   GET /api/settings
// @desc    Get user settings
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    res.json({
      success: true,
      data: {
        profile: {
          name: user.name,
          email: user.email
        },
        preferences: user.settings,
        notifications: user.settings.notifications
      }
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/settings/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', [
  auth,
  body('name').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters'),
  body('email').optional().isEmail().normalizeEmail().withMessage('Please enter a valid email')
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

    const { name, email } = req.body;
    const userId = req.user.id;

    const updateData = {};
    if (name) updateData.name = name;
    if (email) {
      // Check if email is already taken by another user
      const existingUser = await User.findOne({ 
        email, 
        _id: { $ne: userId } 
      });
      
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Email is already taken by another user'
        });
      }
      
      updateData.email = email;
    }

    const user = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/settings/password
// @desc    Change user password
// @access  Private
router.put('/password', [
  auth,
  body('currentPassword').exists().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters long'),
  body('confirmPassword').custom((value, { req }) => {
    if (value !== req.body.newPassword) {
      throw new Error('Password confirmation does not match');
    }
    return true;
  })
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

    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    // Get user with password
    const user = await User.findById(userId).select('+password');
    
    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password
    await User.findByIdAndUpdate(userId, {
      password: hashedPassword
    });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/settings/preferences
// @desc    Update user preferences
// @access  Private
router.put('/preferences', [
  auth,
  body('theme').optional().isIn(['light', 'dark']).withMessage('Theme must be light or dark'),
  body('language').optional().isLength({ min: 2, max: 5 }).withMessage('Invalid language code'),
  body('timezone').optional().isLength({ min: 3, max: 50 }).withMessage('Invalid timezone')
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

    const { theme, language, timezone } = req.body;
    const userId = req.user.id;

    const updateData = {};
    if (theme) updateData['settings.theme'] = theme;
    if (language) updateData['settings.language'] = language;
    if (timezone) updateData['settings.timezone'] = timezone;

    const user = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Preferences updated successfully',
      data: user.settings
    });
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/settings/notifications
// @desc    Update notification settings
// @access  Private
router.put('/notifications', [
  auth,
  body('email').optional().isBoolean().withMessage('Email notification must be boolean'),
  body('push').optional().isBoolean().withMessage('Push notification must be boolean'),
  body('sms').optional().isBoolean().withMessage('SMS notification must be boolean'),
  body('marketing').optional().isBoolean().withMessage('Marketing notification must be boolean')
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

    const { email, push, sms, marketing } = req.body;
    const userId = req.user.id;

    const updateData = {};
    if (typeof email === 'boolean') updateData['settings.notifications.email'] = email;
    if (typeof push === 'boolean') updateData['settings.notifications.push'] = push;
    if (typeof sms === 'boolean') updateData['settings.notifications.sms'] = sms;
    if (typeof marketing === 'boolean') updateData['settings.notifications.marketing'] = marketing;

    const user = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Notification settings updated successfully',
      data: user.settings.notifications
    });
  } catch (error) {
    console.error('Update notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   DELETE /api/settings/account
// @desc    Delete user account
// @access  Private
router.delete('/account', [
  auth,
  body('password').exists().withMessage('Password is required to delete account'),
  body('confirmation').equals('DELETE').withMessage('Please type DELETE to confirm')
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

    const { password } = req.body;
    const userId = req.user.id;

    // Get user with password
    const user = await User.findById(userId).select('+password');
    
    // Verify password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Password is incorrect'
      });
    }

    // In a real application, you would:
    // 1. Cancel any active subscriptions
    // 2. Delete or anonymize user data
    // 3. Send confirmation email
    // 4. Clean up related records

    // For now, just deactivate the account
    await User.findByIdAndUpdate(userId, {
      isActive: false,
      email: `deleted_${Date.now()}@deleted.com`
    });

    res.json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/settings/export
// @desc    Export user data
// @access  Private
router.get('/export', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get all user data
    const user = await User.findById(userId);
    const Campaign = require('../models/Campaign');
    const EmailValidation = require('../models/EmailValidation');
    const ScrapingJob = require('../models/ScrapingJob');
    
    const campaigns = await Campaign.find({ user: userId });
    const validations = await EmailValidation.find({ user: userId });
    const scrapingJobs = await ScrapingJob.find({ user: userId });

    const exportData = {
      profile: {
        name: user.name,
        email: user.email,
        plan: user.plan,
        createdAt: user.createdAt
      },
      settings: user.settings,
      usage: user.usage,
      campaigns: campaigns.map(c => ({
        name: c.name,
        type: c.type,
        status: c.status,
        stats: c.stats,
        createdAt: c.createdAt
      })),
      validations: validations.map(v => ({
        email: v.email,
        status: v.status,
        score: v.score,
        validatedAt: v.validatedAt
      })),
      scrapingJobs: scrapingJobs.map(s => ({
        url: s.url,
        status: s.status,
        emailsFound: s.progress.emailsFound,
        createdAt: s.createdAt
      }))
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="user_data_${userId}.json"`);
    res.json(exportData);
  } catch (error) {
    console.error('Export data error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;