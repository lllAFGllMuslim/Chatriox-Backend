const express = require('express');
const { body, validationResult } = require('express-validator');
const { auth } = require('../middleware/auth');
const Campaign = require('../models/Campaign');
const SMTPConfig = require('../models/SMTPConfig');
const Template = require('../models/Template');
const ContactList = require('../models/ContactList');
const User = require('../models/User');
const EmailActivity = require('../models/EmailActivity');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const router = express.Router();

// Decryption function for SMTP passwords
const algorithm = 'aes-256-cbc';
const secretKey = process.env.ENCRYPTION_KEY || crypto.randomBytes(32);

function decrypt(text) {
  const textParts = text.split(':');
  const iv = Buffer.from(textParts.shift(), 'hex');
  const encryptedText = textParts.join(':');
  const decipher = crypto.createDecipher(algorithm, secretKey);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// @route   POST /api/campaigns/create
// @desc    Create new email campaign
// @access  Private
router.post('/create', [
  auth,
  body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Campaign name is required'),
  body('subject').trim().isLength({ min: 1 }).withMessage('Subject is required'),
  body('smtpConfigId').isMongoId().withMessage('Valid SMTP configuration is required'),
  body('templateId').isLength({ min: 1 }).withMessage('Template is required'),
  body('contactListId').isMongoId().withMessage('Valid contact list is required'),
  body('scheduleType').isIn(['now', 'scheduled']).withMessage('Invalid schedule type')
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

    const {
      name,
      subject,
      smtpConfigId,
      templateId,
      contactListId,
      scheduleType,
      scheduledAt,
      customFromName,
      customFromEmail
    } = req.body;

    const userId = req.user.id;

    // Validate SMTP configuration
    const smtpConfig = await SMTPConfig.findOne({
      _id: smtpConfigId,
      user: userId,
      isActive: true,
      isVerified: true
    });

    if (!smtpConfig) {
      return res.status(400).json({
        success: false,
        message: 'SMTP configuration not found or not verified'
      });
    }

    // Validate template
    let template;
    if (templateId.startsWith('system_')) {
      // Handle system templates (you'd need to import the system templates here)
      const systemTemplates = require('./templates').systemTemplates;
      template = systemTemplates.find(t => t._id === templateId);
    } else {
      template = await Template.findOne({
        _id: templateId,
        user: userId
      });
    }

    if (!template) {
      return res.status(400).json({
        success: false,
        message: 'Template not found'
      });
    }

    // Validate contact list
    const contactList = await ContactList.findOne({
      _id: contactListId,
      user: userId,
      isActive: true
    });

    if (!contactList) {
      return res.status(400).json({
        success: false,
        message: 'Contact list not found'
      });
    }

    // Filter valid contacts
    const validContacts = contactList.contacts.filter(
      contact => contact.validationStatus === 'valid' || !contact.isValidated
    );

    if (validContacts.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid contacts found in the selected list'
      });
    }

    // Create campaign
    const campaign = new Campaign({
      user: userId,
      name,
      type: 'email',
      subject,
      content: template.content,
      recipients: validContacts.map(contact => ({
        email: contact.email,
        name: `${contact.firstName} ${contact.lastName}`.trim(),
        status: 'pending'
      })),
      settings: {
        fromName: customFromName || smtpConfig.fromName,
        fromEmail: customFromEmail || smtpConfig.fromEmail,
        replyTo: customFromEmail || smtpConfig.fromEmail,
        trackOpens: true,
        trackClicks: true,
        smtpConfigId: smtpConfig._id,
        templateId: template._id || templateId,
        contactListId: contactList._id
      },
      schedule: {
        isScheduled: scheduleType === 'scheduled',
        scheduledAt: scheduleType === 'scheduled' ? new Date(scheduledAt) : null
      },
      status: scheduleType === 'scheduled' ? 'scheduled' : 'pending'
    });

    await campaign.save();

    // If sending now, start processing
    if (scheduleType === 'now') {
      processCampaign(campaign._id);
    }

    res.status(201).json({
      success: true,
      message: scheduleType === 'scheduled' ? 'Campaign scheduled successfully' : 'Campaign created and sending started',
      data: {
        campaignId: campaign._id,
        name: campaign.name,
        recipientCount: validContacts.length,
        status: campaign.status,
        scheduledAt: campaign.schedule.scheduledAt
      }
    });
  } catch (error) {
    console.error('Create campaign error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/campaigns
// @desc    Get user's campaigns
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, status, type = 'email' } = req.query;
    
    const query = { user: req.user.id, type };
    if (status) query.status = status;
    
    const campaigns = await Campaign.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('name subject status stats schedule createdAt sentAt completedAt');
    
    const total = await Campaign.countDocuments(query);
    
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

// @route   GET /api/campaigns/:id
// @desc    Get campaign details
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      user: req.user.id
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

// @route   POST /api/campaigns/:id/cancel
// @desc    Cancel scheduled campaign
// @access  Private
router.post('/:id/cancel', auth, async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      user: req.user.id
    });
    
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }
    
    if (campaign.status !== 'scheduled' && campaign.status !== 'sending') {
      return res.status(400).json({
        success: false,
        message: 'Campaign cannot be cancelled in current status'
      });
    }
    
    campaign.status = 'cancelled';
    await campaign.save();
    
    res.json({
      success: true,
      message: 'Campaign cancelled successfully'
    });
  } catch (error) {
    console.error('Cancel campaign error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   DELETE /api/campaigns/:id
// @desc    Delete campaign
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      user: req.user.id
    });
    
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }
    
    if (campaign.status === 'sending') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete campaign that is currently sending'
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

// Helper function to process campaign
async function processCampaign(campaignId) {
  try {
    const campaign = await Campaign.findById(campaignId).populate('user');
    if (!campaign) return;

    // Get SMTP configuration
    const smtpConfig = await SMTPConfig.findById(campaign.settings.smtpConfigId);
    if (!smtpConfig) {
      campaign.status = 'failed';
      campaign.error = 'SMTP configuration not found';
      await campaign.save();
      return;
    }

    // Decrypt SMTP password
    const decryptedPassword = decrypt(smtpConfig.password);

    // Create transporter
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: {
        user: smtpConfig.username,
        pass: decryptedPassword
      }
    });

    // Update campaign status
    campaign.status = 'sending';
    campaign.sentAt = new Date();
    await campaign.save();

    // Process recipients in batches
    const batchSize = 5;
    let processedCount = 0;

    for (let i = 0; i < campaign.recipients.length; i += batchSize) {
      const batch = campaign.recipients.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (recipient) => {
        try {
          // Replace template variables
          let emailContent = campaign.content;
          emailContent = emailContent.replace(/{{first_name}}/g, recipient.name.split(' ')[0] || '');
          emailContent = emailContent.replace(/{{last_name}}/g, recipient.name.split(' ')[1] || '');
          emailContent = emailContent.replace(/{{email}}/g, recipient.email);
          emailContent = emailContent.replace(/{{company_name}}/g, 'MarketingHub');
          emailContent = emailContent.replace(/{{year}}/g, new Date().getFullYear());

          const mailOptions = {
            from: `${campaign.settings.fromName} <${campaign.settings.fromEmail}>`,
            to: recipient.email,
            subject: campaign.subject,
            html: emailContent,
            replyTo: campaign.settings.replyTo
          };

          await transporter.sendMail(mailOptions);
          
          recipient.status = 'sent';
          recipient.sentAt = new Date();
          
          // Save email activity
          const emailActivity = new EmailActivity({
            user: campaign.user,
            campaign: campaign._id,
            recipient: {
              email: recipient.email,
              name: recipient.name
            },
            sender: {
              email: campaign.settings.fromEmail,
              name: campaign.settings.fromName
            },
            template: {
              id: campaign.settings.templateId,
              name: 'Campaign Template',
              subject: campaign.subject,
              content: emailContent
            },
            emailDetails: {
              subject: campaign.subject,
              content: emailContent,
              messageId: `campaign_${campaign._id}_${Date.now()}`,
              smtpConfig: campaign.settings.smtpConfigId
            },
            status: 'sent',
            tracking: {
              sentAt: new Date()
            },
            response: {
              smtpResponse: 'Message sent successfully',
              deliveryStatus: 'sent'
            },
            metadata: {
              emailSize: emailContent.length,
              tags: ['campaign', campaign.name.toLowerCase().replace(/\s+/g, '-')]
            }
          });
          
          await emailActivity.save();
          processedCount++;
        } catch (error) {
          console.error(`Error sending to ${recipient.email}:`, error);
          recipient.status = 'failed';
          recipient.errorMessage = error.message;
        }
      });

      await Promise.all(batchPromises);
      
      // Save progress
      await campaign.save();
      
      // Add delay between batches
      if (i + batchSize < campaign.recipients.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Update final campaign status
    campaign.status = 'completed';
    campaign.completedAt = new Date();
    await campaign.save();

    // Update user usage
    const user = await User.findById(campaign.user);
    user.usage.emailsSent += campaign.stats.sent;
    await user.save();

    console.log(`Campaign ${campaignId} completed. Sent: ${campaign.stats.sent}, Failed: ${campaign.stats.failed}`);

  } catch (error) {
    console.error('Process campaign error:', error);
    
    // Mark campaign as failed
    await Campaign.findByIdAndUpdate(campaignId, {
      status: 'failed',
      error: error.message,
      completedAt: new Date()
    });
  }
}

module.exports = router;