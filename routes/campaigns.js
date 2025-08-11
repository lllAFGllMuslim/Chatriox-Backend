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
const templatesRouter = require('./templates');
const { systemTemplates } = templatesRouter;
const crypto = require('crypto');

const router = express.Router();
// ADD THIS FUNCTION after line 13 (after const router = express.Router();)

function addTrackingToEmail(emailContent, activityId) {
  let trackedContent = emailContent;
  
  const trackingPixel = `<img src="${process.env.BASE_URL}/api/email-tracking/track-open/${activityId}" width="1" height="1" style="display:none;" alt="" />`;
  
  if (trackedContent.includes('</body>')) {
    trackedContent = trackedContent.replace('</body>', `${trackingPixel}</body>`);
  } else {
    trackedContent += trackingPixel;
  }
  
  const linkRegex = /<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1/gi;
  trackedContent = trackedContent.replace(linkRegex, (match, quote, url) => {
    if (url.includes('/api/email-tracking/track-click') || url.startsWith('mailto:') || url.startsWith('tel:')) {
      return match;
    }
    
    const encodedUrl = encodeURIComponent(url);
    const trackingUrl = `${process.env.BASE_URL}/api/email-tracking/track-click/${activityId}?url=${encodedUrl}`;
    
    return match.replace(url, trackingUrl);
  });
  
  return trackedContent;
}
// Decryption function for SMTP passwords
const algorithm = 'aes-256-cbc';
const secretKey = Buffer.from(process.env.ENCRYPTION_KEY, 'hex'); // Make sure ENCRYPTION_KEY is hex and 64 chars

function decrypt(text) {
  const textParts = text.split(':');
  const iv = Buffer.from(textParts.shift(), 'hex'); // First part is IV
  const encryptedText = Buffer.from(textParts.join(':'), 'hex');

  const decipher = crypto.createDecipheriv(algorithm, secretKey, iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  
  return decrypted.toString();
}

// @route   POST /api/campaigns/create
// @desc    Create new email campaign
// @access  Private
router.post('/create', [
  auth,
  body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Campaign name is required'),
  body('subject').trim().isLength({ min: 1 }).withMessage('Subject is required'),
  body('smtpConfigId').isMongoId().withMessage('Valid SMTP configuration is required'),
  body('templateId').trim().isLength({ min: 1 }).withMessage('Template is required'),
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
    console.log(`[PROCESS] Starting processCampaign for campaignId=${campaignId}`);

    const campaign = await Campaign.findById(campaignId).populate('user');
    if (!campaign) {
      console.error(`[PROCESS][ERROR] Campaign not found: ${campaignId}`);
      return;
    }
    console.log(`[PROCESS] Loaded campaign "${campaign.name}" (${campaign._id}).`);

    // ensure stats object exists
    if (!campaign.stats) {
      campaign.stats = { sent: 0, failed: 0 };
    }

    // Get SMTP configuration
    const smtpConfig = await SMTPConfig.findById(campaign.settings.smtpConfigId);
    if (!smtpConfig) {
      console.error(`[PROCESS][ERROR] SMTP configuration not found for id=${campaign.settings.smtpConfigId}`);
      campaign.status = 'failed';
      campaign.error = 'SMTP configuration not found';
      await campaign.save();
      return;
    }
    console.log(`[PROCESS] Using SMTP config: id=${smtpConfig._id} host=${smtpConfig.host}:${smtpConfig.port} secure=${smtpConfig.secure} user=${smtpConfig.username}`);

    // Decrypt SMTP password
    let decryptedPassword;
    try {
      decryptedPassword = decrypt(smtpConfig.password);
      console.log(`[PROCESS] SMTP password decrypted for user=${smtpConfig.username} (password not printed)`);
    } catch (err) {
      console.error(`[PROCESS][ERROR] Failed to decrypt SMTP password: ${err && err.message}`, err);
      campaign.status = 'failed';
      campaign.error = 'SMTP password decrypt failed';
      await campaign.save();
      return;
    }

    // Create transporter
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: {
        user: smtpConfig.username,
        pass: decryptedPassword
      },
      logger: true,
      debug: true
    });

    // Verify SMTP connection
    try {
      console.log(`[SMTP] Verifying connection to ${smtpConfig.host}:${smtpConfig.port} ...`);
      await transporter.verify();
      console.log(`[SMTP] Verification succeeded: connected to ${smtpConfig.host}:${smtpConfig.port} as ${smtpConfig.username}`);
    } catch (err) {
      console.error(`[SMTP][ERROR] Verification failed: ${err && err.message}`, err);
      campaign.status = 'failed';
      campaign.error = `SMTP verify failed: ${err && err.message}`;
      await campaign.save();
      return;
    }

    // Update campaign status
    campaign.status = 'sending';
    campaign.sentAt = new Date();
    await campaign.save();
    console.log(`[PROCESS] Campaign status set to "sending". Recipients count: ${campaign.recipients.length}`);

    // Process recipients in batches
    const batchSize = 5;
    let processedCount = 0;

    for (let i = 0; i < campaign.recipients.length; i += batchSize) {
      const batchIndex = Math.floor(i / batchSize) + 1;
      const batch = campaign.recipients.slice(i, i + batchSize);
      console.log(`[BATCH] Starting batch ${batchIndex}. Size: ${batch.length}`);

const batchPromises = batch.map(async (recipient, idx) => {
        const recipientIndex = i + idx + 1;
        console.log(`[SEND] [Batch ${batchIndex}] [#${recipientIndex}] Preparing to send to ${recipient.email}`);

        let emailActivity; // Declare here so it's accessible in catch block

        try {
          // Replace template variables
          let emailContent = campaign.content || '';
          try {
            emailContent = emailContent.replace(/{{first_name}}/g, recipient.name.split(' ')[0] || '');
            emailContent = emailContent.replace(/{{last_name}}/g, recipient.name.split(' ')[1] || '');
            emailContent = emailContent.replace(/{{email}}/g, recipient.email);
            emailContent = emailContent.replace(/{{company_name}}/g, 'MarketingHub');
            emailContent = emailContent.replace(/{{year}}/g, new Date().getFullYear());
          } catch (templErr) {
            console.warn(`[TEMPLATE][WARN] Error while replacing template variables for ${recipient.email}: ${templErr && templErr.message}`);
          }

          // CREATE EmailActivity FIRST (before sending)
          emailActivity = new EmailActivity({
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
              messageId: `campaign_${campaign._id}_${Date.now()}_${Math.random()}`,
              smtpConfig: campaign.settings.smtpConfigId
            },
            status: 'pending',
            tracking: {
              opens: 0,
              clicks: 0
            },
            metadata: {
              emailSize: emailContent.length,
              tags: ['campaign', campaign.name ? campaign.name.toLowerCase().replace(/\s+/g, '-') : '']
            }
          });

          await emailActivity.save();
          console.log(`[TRACKING] Created EmailActivity with ID: ${emailActivity._id}`);

          // Add tracking using the activity ID
          if (campaign.settings.trackOpens || campaign.settings.trackClicks) {
            emailContent = addTrackingToEmail(emailContent, emailActivity._id);
            console.log(`[TRACKING] Added tracking elements to email for ${recipient.email}`);
          }

          const mailOptions = {
            from: `${campaign.settings.fromName} <${campaign.settings.fromEmail}>`,
            to: recipient.email,
            subject: campaign.subject,
            html: emailContent,
            replyTo: campaign.settings.replyTo
          };

          const info = await transporter.sendMail(mailOptions);

          // Log nodemailer response
          console.log(`[SENT] [#${recipientIndex}] to=${recipient.email} messageId=${info && info.messageId} response=${info && info.response}`);

          recipient.status = 'sent';
          recipient.sentAt = new Date();

          // Update EmailActivity with success
          emailActivity.status = 'sent';
          emailActivity.tracking.sentAt = new Date();
          emailActivity.emailDetails.messageId = info && info.messageId ? info.messageId : emailActivity.emailDetails.messageId;
          emailActivity.emailDetails.content = emailContent; // Save final content with tracking
          emailActivity.response = {
            smtpResponse: info && (info.response || info.accepted || JSON.stringify(info)),
            deliveryStatus: 'sent'
          };

          await emailActivity.save();
          campaign.stats.sent = (campaign.stats.sent || 0) + 1;
          processedCount++;

        } catch (error) {
          console.error(`[FAILED] [#${recipientIndex}] to=${recipient.email} error=${error && error.message}`, error);
          recipient.status = 'failed';
          recipient.errorMessage = error && error.message;
          campaign.stats.failed = (campaign.stats.failed || 0) + 1;

          // Update EmailActivity with failure (if it was created)
          if (emailActivity && emailActivity._id) {
            emailActivity.status = 'failed';
            emailActivity.response = { 
              smtpResponse: error && (error.response || error.message) || 'unknown error' 
            };
            emailActivity.tracking.attemptedAt = new Date();
            await emailActivity.save();
          }
        }
      });

      await Promise.all(batchPromises);

      // Save progress after each batch
      await campaign.save();
      console.log(`[BATCH] Completed batch ${batchIndex}. Progress saved. Stats: sent=${campaign.stats.sent || 0}, failed=${campaign.stats.failed || 0}`);

      // Add delay between batches
      if (i + batchSize < campaign.recipients.length) {
        const delayMs = 2000;
        console.log(`[BATCH] Waiting ${delayMs}ms before next batch...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    } // end for batches

    // Update final campaign status
    campaign.status = 'completed';
    campaign.completedAt = new Date();
    await campaign.save();
    console.log(`[PROCESS] Campaign marked completed. ID=${campaign._id}`);

    // Update user usage (safe id extraction)
    let userId = campaign.user && campaign.user._id ? campaign.user._id : campaign.user;
    const user = await User.findById(userId);
    if (user) {
      user.usage = user.usage || { emailsSent: 0 };
      user.usage.emailsSent = (user.usage.emailsSent || 0) + (campaign.stats.sent || 0);
      await user.save();
      console.log(`[USAGE] Updated user (${user._id}) usage. Total emailsSent=${user.usage.emailsSent}`);
    } else {
      console.warn(`[USAGE][WARN] Could not find user to update usage for id=${userId}`);
    }

    console.log(`[SUMMARY] Campaign ${campaignId} completed. Sent: ${campaign.stats.sent || 0}, Failed: ${campaign.stats.failed || 0}, Processed: ${processedCount}`);

  } catch (error) {
    console.error('[Process campaign error]:', error && error.message, error);
    // Mark campaign as failed
    try {
      await Campaign.findByIdAndUpdate(campaignId, {
        status: 'failed',
        error: error && error.message,
        completedAt: new Date()
      });
    } catch (uErr) {
      console.error(`[Process campaign error] Failed to update campaign status in DB: ${uErr && uErr.message}`, uErr);
    }
  }
}

module.exports = router;