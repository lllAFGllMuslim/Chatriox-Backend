const express = require('express');
const { body, validationResult } = require('express-validator');
const { auth } = require('../middleware/auth');
const Campaign = require('../models/Campaign');
const User = require('../models/User');
const EmailActivity = require('../models/EmailActivity');
const nodemailer = require('nodemailer');

const router = express.Router();

// @route   POST /api/email/send
// @desc    Send email campaign
// @access  Private
router.post('/send', [
  auth,
  body('to').isEmail().withMessage('Valid recipient email is required'),
  body('subject').trim().isLength({ min: 1 }).withMessage('Subject is required'),
  body('content').trim().isLength({ min: 1 }).withMessage('Content is required')
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

    const { to, subject, content, fromName, fromEmail } = req.body;
    const userId = req.user.id;

    // Create email activity record
    const emailActivity = new EmailActivity({
      user: userId,
      recipient: {
        email: to,
        name: req.body.recipientName || ''
      },
      sender: {
        email: fromEmail || 'noreply@marketinghub.com',
        name: fromName || 'MarketingHub'
      },
      emailDetails: {
        subject,
        content,
        messageId: `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      },
      status: 'sent',
      tracking: {
        sentAt: new Date()
      },
      response: {
        smtpResponse: 'Email sent successfully',
        deliveryStatus: 'sent'
      }
    });

    await emailActivity.save();

    // Update user usage
    const user = await User.findById(userId);
    user.usage.emailsSent += 1;
    await user.save();

    res.json({
      success: true,
      message: 'Email sent successfully',
      data: {
        messageId: emailActivity.emailDetails.messageId,
        activityId: emailActivity._id
      }
    });
  } catch (error) {
    console.error('Send email error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/email/campaigns
// @desc    Get user's email campaigns
// @access  Private
router.get('/campaigns', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    
    const campaigns = await Campaign.find({
      user: req.user.id,
      type: 'email'
    })
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);
    
    const total = await Campaign.countDocuments({
      user: req.user.id,
      type: 'email'
    });
    
    res.json({
      success: true,
      data: campaigns,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get campaigns error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/email/campaigns/:id
// @desc    Get campaign details
// @access  Private
router.get('/campaigns/:id', auth, async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      user: req.user.id,
      type: 'email'
    });
    
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }
    
    res.json({
      success: true,
      data: campaign
    });
  } catch (error) {
    console.error('Get campaign error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   DELETE /api/email/campaigns/:id
// @desc    Delete campaign
// @access  Private
router.delete('/campaigns/:id', auth, async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      user: req.user.id,
      type: 'email'
    });
    
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }
    
    await Campaign.findByIdAndDelete(req.params.id);
    
    res.json({
      success: true,
      message: 'Campaign deleted successfully'
    });
  } catch (error) {
    console.error('Delete campaign error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;