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

// FIXED: Consistent encryption/decryption configuration - same as SMTP config
const algorithm = 'aes-256-cbc';

// CRITICAL FIX: Use the same key logic as SMTP config file
if (!process.env.ENCRYPTION_KEY) {
  console.error('❌ ENCRYPTION_KEY environment variable is not set!');
  throw new Error('ENCRYPTION_KEY environment variable is required for password decryption');
}

const secretKey = Buffer.from(process.env.ENCRYPTION_KEY, 'hex'); // Must match SMTP config exactly

// FIXED: Consistent decryption function - same as SMTP config
function decrypt(text) {
  try {
    if (!text || typeof text !== 'string') {
      throw new Error('Invalid encrypted text format');
    }

    const [ivHex, encryptedText] = text.split(':');
    if (!ivHex || !encryptedText) {
      throw new Error('Invalid encrypted text format - missing IV or data');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(algorithm, secretKey, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error.message);
    throw new Error(`Failed to decrypt SMTP password: ${error.message}`);
  }
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

    console.log(`🚀 Creating campaign: ${name} for user: ${userId}`);

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

    console.log(`✅ SMTP config found: ${smtpConfig.name}`);

    // FIXED: Test decryption early to catch issues
    try {
      const testDecrypt = decrypt(smtpConfig.password);
      console.log('✅ SMTP password decryption test successful');
    } catch (decryptError) {
      console.error('❌ SMTP password decryption test failed:', decryptError.message);
      return res.status(400).json({
        success: false,
        message: 'SMTP password decryption failed. Please re-save your SMTP configuration.',
        error: decryptError.message
      });
    }

    // Validate template
    let template;
    if (templateId.startsWith('system_')) {
      // Handle system templates
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

    console.log(`✅ Template found: ${template.name || template._id}`);

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

    console.log(`✅ Contact list found: ${contactList.name}, Valid contacts: ${validContacts.length}`);

    // Create campaign
    const campaign = new Campaign({
      user: userId,
      name,
      type: 'email',
      subject,
      content: template.content,
      recipients: validContacts.map(contact => ({
        email: contact.email,
        name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
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
      status: scheduleType === 'scheduled' ? 'scheduled' : 'pending',
      stats: {
        sent: 0,
        failed: 0,
        pending: validContacts.length,
        opened: 0,
        clicked: 0,
        bounced: 0,
        unsubscribed: 0
      }
    });

    await campaign.save();
    console.log(`✅ Campaign created: ${campaign._id}`);

    // If sending now, start processing with proper error handling
    if (scheduleType === 'now') {
      console.log(`🎯 Starting campaign processing immediately: ${campaign._id}`);
      // Don't await this, but handle errors properly
      processCampaign(campaign._id).catch(error => {
        console.error(`❌ Campaign processing failed for ${campaign._id}:`, error);
      });
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
    console.error('❌ Create campaign error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
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
      .select('name subject status stats schedule createdAt sentAt completedAt error');
    
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
    console.error('❌ Get campaigns error:', error);
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
    console.error('❌ Get campaign error:', error);
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
    campaign.completedAt = new Date();
    await campaign.save();
    
    res.json({
      success: true,
      message: 'Campaign cancelled successfully'
    });
  } catch (error) {
    console.error('❌ Cancel campaign error:', error);
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
    console.error('❌ Delete campaign error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/campaigns/test-smtp/:configId
// @desc    Test SMTP configuration
// @access  Private
router.post('/test-smtp/:configId', auth, async (req, res) => {
  try {
    console.log(`🧪 Testing SMTP config: ${req.params.configId}`);
    
    const smtpConfig = await SMTPConfig.findOne({
      _id: req.params.configId,
      user: req.user.id
    });

    if (!smtpConfig) {
      return res.status(404).json({
        success: false,
        message: 'SMTP configuration not found'
      });
    }

    console.log(`📧 Testing SMTP: ${smtpConfig.host}:${smtpConfig.port}`);

    // FIXED: Use consistent decryption
    let decryptedPassword;
    try {
      decryptedPassword = decrypt(smtpConfig.password);
      console.log('✅ Password decryption successful');
    } catch (error) {
      console.error('❌ Password decryption failed:', error);
      return res.status(400).json({
        success: false,
        message: 'Failed to decrypt SMTP password. Please re-save your SMTP configuration.',
        error: error.message
      });
    }

    const transporterConfig = {
      host: smtpConfig.host,
      port: parseInt(smtpConfig.port),
      secure: smtpConfig.secure,
      auth: {
        user: smtpConfig.username,
        pass: decryptedPassword
      }
    };

    const transporter = nodemailer.createTransport(transporterConfig);

    // Verify connection
    console.log('🔍 Verifying SMTP connection...');
    await transporter.verify();
    console.log('✅ SMTP verification successful');

    // Send test email
    const testEmail = {
      from: `${smtpConfig.fromName} <${smtpConfig.fromEmail}>`,
      to: smtpConfig.fromEmail, // Send to self for testing
      subject: 'SMTP Test Email - ' + new Date().toLocaleString(),
      html: `
        <h2>🎉 SMTP Test Successful!</h2>
        <p>Your SMTP configuration is working correctly.</p>
        <p><strong>Config Details:</strong></p>
        <ul>
          <li>Host: ${smtpConfig.host}</li>
          <li>Port: ${smtpConfig.port}</li>
          <li>Secure: ${smtpConfig.secure}</li>
          <li>From: ${smtpConfig.fromName} &lt;${smtpConfig.fromEmail}&gt;</li>
        </ul>
        <p>Test performed at: ${new Date().toISOString()}</p>
      `
    };

    console.log('📤 Sending test email...');
    const info = await transporter.sendMail(testEmail);
    console.log('✅ Test email sent successfully:', info.messageId);

    res.json({
      success: true,
      message: 'SMTP test successful - check your inbox!',
      data: {
        messageId: info.messageId,
        config: {
          host: smtpConfig.host,
          port: smtpConfig.port,
          secure: smtpConfig.secure,
          from: `${smtpConfig.fromName} <${smtpConfig.fromEmail}>`
        }
      }
    });
  } catch (error) {
    console.error('❌ SMTP test error:', error);
    res.status(400).json({
      success: false,
      message: 'SMTP test failed',
      error: error.message
    });
  }
});

// @route   POST /api/campaigns/debug/:id
// @desc    Debug campaign processing
// @access  Private
router.post('/debug/:id', auth, async (req, res) => {
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
    
    console.log(`🐛 Debug campaign: ${campaign.name} (${campaign._id})`);
    console.log(`📊 Status: ${campaign.status}`);
    console.log(`📧 Recipients: ${campaign.recipients.length}`);
    console.log(`⚙️ SMTP Config: ${campaign.settings.smtpConfigId}`);
    
    // Try to process manually
    processCampaign(campaign._id).catch(error => {
      console.error('❌ Manual processing failed:', error);
    });
    
    res.json({ 
      success: true, 
      message: 'Manual processing started - check server logs',
      data: {
        campaignId: campaign._id,
        status: campaign.status,
        recipients: campaign.recipients.length,
        error: campaign.error
      }
    });
  } catch (error) {
    console.error('❌ Debug error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Debug failed',
      error: error.message 
    });
  }
});

// FIXED: Campaign processing function with consistent decryption
async function processCampaign(campaignId) {
  console.log(`\n🚀 ===== STARTING CAMPAIGN PROCESSING: ${campaignId} =====`);
  
  try {
    // Get campaign
    const campaign = await Campaign.findById(campaignId).populate('user');
    if (!campaign) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }

    console.log(`📋 Campaign: "${campaign.name}"`);
    console.log(`👤 User: ${campaign.user.email}`);
    console.log(`📧 Recipients: ${campaign.recipients.length}`);

    // Update status to sending
    campaign.status = 'sending';
    campaign.sentAt = new Date();
    await campaign.save();
    console.log('✅ Campaign status updated to SENDING');

    // Get SMTP configuration
    const smtpConfig = await SMTPConfig.findById(campaign.settings.smtpConfigId);
    if (!smtpConfig) {
      throw new Error(`SMTP configuration not found: ${campaign.settings.smtpConfigId}`);
    }

    console.log(`📤 SMTP: ${smtpConfig.name} (${smtpConfig.host}:${smtpConfig.port})`);

    // FIXED: Use consistent decryption
    let decryptedPassword;
    try {
      decryptedPassword = decrypt(smtpConfig.password);
      console.log('🔓 SMTP password decrypted successfully');
    } catch (error) {
      throw new Error(`Password decryption failed: ${error.message}`);
    }

    // Create transporter configuration
    const transporterConfig = {
      host: smtpConfig.host,
      port: parseInt(smtpConfig.port),
      secure: smtpConfig.secure,
      auth: {
        user: smtpConfig.username,
        pass: decryptedPassword
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 5
    };

    console.log('🔧 Creating SMTP transporter...');
    const transporter = nodemailer.createTransport(transporterConfig);

    // Verify SMTP connection before sending
    try {
      await transporter.verify();
      console.log('✅ SMTP connection verified successfully');
    } catch (verifyError) {
      throw new Error(`SMTP verification failed: ${verifyError.message}`);
    }

    // Process recipients in batches
    const batchSize = 5;
    let processedCount = 0;
    let sentCount = 0;
    let failedCount = 0;

    console.log(`📦 Processing ${campaign.recipients.length} recipients in batches of ${batchSize}`);

    for (let i = 0; i < campaign.recipients.length; i += batchSize) {
      const batch = campaign.recipients.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(campaign.recipients.length / batchSize);
      
      console.log(`\n📦 Batch ${batchNumber}/${totalBatches} - Processing ${batch.length} emails`);
      
      const batchPromises = batch.map(async (recipient, index) => {
        let emailActivity = null; // Declare at function scope
        try {
          // STEP 1: Create EmailActivity record FIRST
          emailActivity = new EmailActivity({
            user: campaign.user._id,
            campaign: campaign._id,
            recipient: {
              email: recipient.email,
              name: recipient.name || ''
            },
            sender: {
              email: campaign.settings.fromEmail,
              name: campaign.settings.fromName
            },
            template: {
              id: campaign.settings.templateId,
              name: 'Campaign Template',
              subject: campaign.subject,
              content: campaign.content
            },
            emailDetails: {
              subject: campaign.subject,
              content: campaign.content,
              smtpConfig: campaign.settings.smtpConfigId
            },
            status: 'pending', // Start as pending
            tracking: {
              opens: 0,
              clicks: 0,
              sentAt: null,
              openedAt: null,
              clickedAt: null
            },
            metadata: {
              tags: ['campaign', campaign.name.toLowerCase().replace(/\s+/g, '-')]
            }
          });
          
          await emailActivity.save();
          console.log(`📝 EmailActivity created: ${emailActivity._id}`);

          // STEP 2: Process email content with tracking
          let emailContent = campaign.content || '';
          const firstName = (recipient.name || '').split(' ')[0] || '';
          const lastName = (recipient.name || '').split(' ').slice(1).join(' ') || '';
          
          // Replace template variables
          emailContent = emailContent.replace(/{{first_name}}/g, firstName);
          emailContent = emailContent.replace(/{{last_name}}/g, lastName);
          emailContent = emailContent.replace(/{{full_name}}/g, recipient.name || '');
          emailContent = emailContent.replace(/{{email}}/g, recipient.email);
          emailContent = emailContent.replace(/{{company_name}}/g, 'MarketingHub');
          emailContent = emailContent.replace(/{{year}}/g, new Date().getFullYear().toString());

          // STEP 3: Add tracking pixel for opens
          const trackingPixel = `<img src="${process.env.BASE_URL || 'https://chatriox.com'}/api/email-tracking/track-open/${emailActivity._id}" width="1" height="1" style="display:none;" alt="">`;
          
          // STEP 4: Wrap links with click tracking
          const baseUrl = process.env.BASE_URL || 'https://chatriox.com';
          emailContent = emailContent.replace(
            /<a\s+([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*?)>/gi,
            (match, beforeHref, url, afterHref) => {
              const trackingUrl = `${baseUrl}/api/email-tracking/track-click/${emailActivity._id}?url=${encodeURIComponent(url)}`;
              return `<a ${beforeHref}href="${trackingUrl}"${afterHref}>`;
            }
          );

          // STEP 5: Add tracking pixel before closing body tag or at the end
          if (emailContent.includes('</body>')) {
            emailContent = emailContent.replace('</body>', `${trackingPixel}</body>`);
          } else {
            emailContent += trackingPixel;
          }

          // Update the activity with final content
          emailActivity.emailDetails.content = emailContent;
          emailActivity.emailDetails.emailSize = emailContent.length;

          const mailOptions = {
            from: `${campaign.settings.fromName} <${campaign.settings.fromEmail}>`,
            to: recipient.email,
            subject: campaign.subject,
            html: emailContent,
            replyTo: campaign.settings.replyTo
          };

          console.log(`📤 Sending to: ${recipient.email}`);
          const info = await transporter.sendMail(mailOptions);
          console.log(`✅ Sent to ${recipient.email} - MessageId: ${info.messageId}`);
          
          // STEP 6: Update EmailActivity with success
          emailActivity.status = 'sent';
          emailActivity.tracking.sentAt = new Date();
          emailActivity.emailDetails.messageId = info.messageId;
          emailActivity.response = {
            smtpResponse: info.response,
            deliveryStatus: 'sent'
          };
          await emailActivity.save();
          
          // Update recipient status in campaign
          const recipientIndex = campaign.recipients.findIndex(r => r.email === recipient.email);
          if (recipientIndex !== -1) {
            campaign.recipients[recipientIndex].status = 'sent';
            campaign.recipients[recipientIndex].sentAt = new Date();
          }
          
          sentCount++;
          
        } catch (error) {
          console.error(`❌ Failed to send to ${recipient.email}:`, error.message);
          
          // Update EmailActivity with failure
          if (emailActivity) {
            emailActivity.status = 'failed';
            emailActivity.response = {
              error: error.message,
              deliveryStatus: 'failed'
            };
            await emailActivity.save();
          }
          
          // Update recipient status in campaign
          const recipientIndex = campaign.recipients.findIndex(r => r.email === recipient.email);
          if (recipientIndex !== -1) {
            campaign.recipients[recipientIndex].status = 'failed';
            campaign.recipients[recipientIndex].errorMessage = error.message;
          }
          
          failedCount++;
        }
        
        processedCount++;
      });

      await Promise.all(batchPromises);
      
      // Update campaign stats
      campaign.stats.sent = sentCount;
      campaign.stats.failed = failedCount;
      campaign.stats.pending = campaign.recipients.length - processedCount;
      
      // Save progress
      await campaign.save();
      
      console.log(`📊 Batch ${batchNumber} completed - Sent: ${sentCount}, Failed: ${failedCount}, Remaining: ${campaign.recipients.length - processedCount}`);
      
      // Add delay between batches to avoid rate limiting
      if (i + batchSize < campaign.recipients.length) {
        console.log('⏳ Waiting 2 seconds before next batch...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Update final campaign status
    campaign.status = 'completed';
    campaign.completedAt = new Date();
    await campaign.save();

    // Update user usage
    if (campaign.user && sentCount > 0) {
      await User.findByIdAndUpdate(campaign.user._id, {
        $inc: { 'usage.emailsSent': sentCount }
      });
    }

    console.log(`\n🎉 ===== CAMPAIGN COMPLETED: ${campaignId} =====`);
    console.log(`✅ Successfully sent: ${sentCount} emails`);
    console.log(`❌ Failed: ${failedCount} emails`);
    console.log(`📊 Total processed: ${processedCount} recipients`);

    // Close transporter pool
    transporter.close();

  } catch (error) {
    console.error(`\n💥 ===== CAMPAIGN PROCESSING FAILED: ${campaignId} =====`);
    console.error(`❌ Error: ${error.message}`);
    console.error(`📍 Stack:`, error.stack);
    
    // Mark campaign as failed
    try {
      await Campaign.findByIdAndUpdate(campaignId, {
        status: 'failed',
        error: error.message,
        completedAt: new Date()
      });
      console.log('💾 Campaign marked as failed in database');
    } catch (updateError) {
      console.error('❌ Failed to update campaign status:', updateError.message);
    }
  }
}

module.exports = router;