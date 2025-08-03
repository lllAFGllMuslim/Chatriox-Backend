const express = require('express');
const { body, validationResult } = require('express-validator');
const { auth } = require('../middleware/auth');
const WhatsAppAccount = require('../models/WhatsAppAccount');
const WhatsAppCampaign = require('../models/WhatsAppCampaign');
const WhatsAppContact = require('../models/WhatsAppContact');
const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const User = require('../models/User');

const router = express.Router();

// @route   GET /api/whatsapp/accounts
// @desc    Get user's WhatsApp accounts
// @access  Private
router.get('/accounts', auth, async (req, res) => {
  try {
    const accounts = await WhatsAppAccount.find({
      user: req.user.id,
      isActive: true
    }).sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: accounts
    });
  } catch (error) {
    console.error('Get WhatsApp accounts error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/whatsapp/connect
// @desc    Connect WhatsApp account
// @access  Private
router.post('/connect', [
  auth,
  body('accountName').trim().isLength({ min: 1 }).withMessage('Account name is required')
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

    const { accountName } = req.body;
    const userId = req.user.id;

    const account = new WhatsAppAccount({
      user: userId,
      accountName,
      status: 'connecting'
    });

    await account.save();

    res.status(201).json({
      success: true,
      message: 'WhatsApp account connection initiated',
      data: account
    });
  } catch (error) {
    console.error('Connect WhatsApp account error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/whatsapp/send
// @desc    Send WhatsApp message
// @access  Private
router.post('/send', [
  auth,
  body('accountId').isMongoId().withMessage('Valid account ID is required'),
  body('recipients').isArray({ min: 1 }).withMessage('At least one recipient is required'),
  body('content.type').isIn(['text', 'image', 'video', 'document', 'audio']).withMessage('Invalid content type'),
  body('content.text').optional().trim().isLength({ min: 1 })
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

    const { accountId, recipients, content } = req.body;
    const userId = req.user.id;

    // Verify account ownership
    const account = await WhatsAppAccount.findOne({
      _id: accountId,
      user: userId,
      status: 'ready'
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'WhatsApp account not found or not ready'
      });
    }

    // Create campaign
    const campaign = new WhatsAppCampaign({
      user: userId,
      name: `Quick Send - ${new Date().toLocaleDateString()}`,
      whatsappAccount: accountId,
      messages: recipients.map(phone => ({
        recipient: { phone },
        content,
        status: 'pending'
      })),
      status: 'running'
    });

    await campaign.save();

    // Update user usage
    const user = await User.findById(userId);
    user.usage.whatsappMessagesSent = (user.usage.whatsappMessagesSent || 0) + recipients.length;
    await user.save();

    res.json({
      success: true,
      message: 'Messages queued for sending',
      data: {
        campaignId: campaign._id,
        recipientCount: recipients.length
      }
    });
  } catch (error) {
    console.error('Send WhatsApp message error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/whatsapp/campaigns
// @desc    Get user's WhatsApp campaigns
// @access  Private
router.get('/campaigns', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    
    const campaigns = await WhatsAppCampaign.find({
      user: req.user.id
    })
    .populate('whatsappAccount', 'accountName phoneNumber')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);
    
    const total = await WhatsAppCampaign.countDocuments({
      user: req.user.id
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
    console.error('Get WhatsApp campaigns error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/whatsapp/contacts
// @desc    Get user's WhatsApp contacts
// @access  Private
router.get('/contacts', auth, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    
    const contacts = await WhatsAppContact.find({
      user: req.user.id,
      isActive: true
    })
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);
    
    const total = await WhatsAppContact.countDocuments({
      user: req.user.id,
      isActive: true
    });
    
    res.json({
      success: true,
      data: contacts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get WhatsApp contacts error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/whatsapp/contacts
// @desc    Add WhatsApp contact
// @access  Private
router.post('/contacts', [
  auth,
  body('name').trim().isLength({ min: 1 }).withMessage('Name is required'),
  body('phone').trim().isLength({ min: 10 }).withMessage('Valid phone number is required')
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

    const { name, phone, email, company } = req.body;
    const userId = req.user.id;

    // Check if contact already exists
    const existingContact = await WhatsAppContact.findOne({
      user: userId,
      phone
    });

    if (existingContact) {
      return res.status(400).json({
        success: false,
        message: 'Contact with this phone number already exists'
      });
    }

    const contact = new WhatsAppContact({
      user: userId,
      name,
      phone,
      email,
      company
    });

    await contact.save();

    res.status(201).json({
      success: true,
      message: 'Contact added successfully',
      data: contact
    });
  } catch (error) {
    console.error('Add WhatsApp contact error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/whatsapp/templates
// @desc    Get WhatsApp templates
// @access  Private
router.get('/templates', auth, async (req, res) => {
  try {
    const templates = await WhatsAppTemplate.find({
      user: req.user.id,
      isActive: true
    }).sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: templates
    });
  } catch (error) {
    console.error('Get WhatsApp templates error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/whatsapp/stats
// @desc    Get WhatsApp statistics
// @access  Private
router.get('/stats', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const totalAccounts = await WhatsAppAccount.countDocuments({
      user: userId,
      isActive: true
    });
    
    const connectedAccounts = await WhatsAppAccount.countDocuments({
      user: userId,
      status: 'ready',
      isActive: true
    });
    
    const totalCampaigns = await WhatsAppCampaign.countDocuments({
      user: userId
    });
    
    const totalContacts = await WhatsAppContact.countDocuments({
      user: userId,
      isActive: true
    });
    
    // Get recent campaign stats
    const recentCampaigns = await WhatsAppCampaign.find({
      user: userId,
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    });
    
    const totalMessagesSent = recentCampaigns.reduce((sum, campaign) => sum + campaign.progress.sent, 0);
    const totalMessagesDelivered = recentCampaigns.reduce((sum, campaign) => sum + campaign.progress.delivered, 0);
    
    res.json({
      success: true,
      data: {
        totalAccounts,
        connectedAccounts,
        totalCampaigns,
        totalContacts,
        totalMessagesSent,
        totalMessagesDelivered,
        deliveryRate: totalMessagesSent > 0 ? (totalMessagesDelivered / totalMessagesSent) * 100 : 0
      }
    });
  } catch (error) {
    console.error('Get WhatsApp stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;