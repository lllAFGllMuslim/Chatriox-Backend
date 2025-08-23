const express = require('express');
const { body, validationResult } = require('express-validator');
const { auth } = require('../middleware/auth');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const WhatsAppAccount = require('../models/WhatsAppAccount');
const WhatsAppCampaign = require('../models/WhatsAppCampaign');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const WhatsAppContactList = require('../models/WhatsAppContactList');
const WhatsAppWebService = require('../services/WhatsAppWebService');

const router = express.Router();

// Optimized file upload configuration
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadPath = path.join(__dirname, '../uploads/whatsapp');
      if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|mp4|mov|avi|pdf|doc|docx|csv|txt|mp3|wav|ogg/;
    const extname = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowed.test(file.mimetype);
    cb(mimetype && extname ? null : new Error('Invalid file type'), mimetype && extname);
  }
});

// Utility functions
const handleError = (res, error, message = 'Server error') => {
  console.error(`❌ ${message}:`, error);
  res.status(500).json({ success: false, message, error: error.message });
};

const validatePhone = (phone) => {
  if (!phone) return null;
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 10) return null;
  return cleaned.length === 10 ? '91' + cleaned : cleaned;
};

const parseJSON = (data) => {
  try {
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch {
    return null;
  }
};

// @route   POST /api/whatsapp-web/connect
// @desc    Connect/Reconnect WhatsApp account
router.post('/connect', [
  auth,
  body('accountName').trim().isLength({ min: 1 }).withMessage('Account name required'),
  body('phoneNumber').optional().matches(/^\+?[\d\s\-\(\)]+$/).withMessage('Invalid phone number')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { accountName, phoneNumber } = req.body;
    const userId = req.user.id;
    const io = req.app.get('io') || global.io;

    if (!io) {
      return res.status(500).json({ success: false, message: 'Socket.IO not available' });
    }

    // FIXED: Check for account name uniqueness per user (not single account limit)
    const existingAccount = await WhatsAppAccount.findOne({ 
      user: userId, 
      accountName: accountName.trim()
    });

    if (existingAccount) {
      // FIXED: Allow reconnection of existing account if not active
      if (['connecting', 'ready', 'authenticated'].includes(existingAccount.status)) {
        return res.status(400).json({
          success: false,
          message: `Account "${accountName}" is already active. Use a different name or disconnect first.`,
          data: { accountId: existingAccount._id, status: existingAccount.status }
        });
      }

      // Reuse existing disconnected account with same name
      console.log(`🔄 Reusing existing account: ${existingAccount._id}`);
      existingAccount.status = 'connecting';
      existingAccount.errorMessage = null;
      if (phoneNumber) existingAccount.phoneNumber = validatePhone(phoneNumber);
      await existingAccount.save();

      try {
        await WhatsAppWebService.initializeClient(existingAccount._id.toString(), userId, io);
        
        return res.json({
          success: true,
          message: 'WhatsApp connection initiated. Scan QR code to proceed.',
          data: {
            accountId: existingAccount._id,
            accountName: existingAccount.accountName,
            phoneNumber: existingAccount.phoneNumber,
            status: 'connecting'
          }
        });
      } catch (error) {
        existingAccount.status = 'failed';
        existingAccount.errorMessage = error.message;
        await existingAccount.save();
        throw error;
      }
    }

    // FIXED: Create new account (no single account limit)
    const validatedPhone = validatePhone(phoneNumber);
    if (phoneNumber && !validatedPhone) {
      return res.status(400).json({ success: false, message: 'Invalid phone number' });
    }

    // Optional: Check user's account limit
    const userAccountCount = await WhatsAppAccount.countDocuments({ 
      user: userId, 
      status: { $nin: ['deleted'] } 
    });
    
    if (userAccountCount >= 10) { // Reasonable limit per user
      return res.status(400).json({ 
        success: false, 
        message: 'Maximum 10 WhatsApp accounts allowed per user' 
      });
    }

    const account = new WhatsAppAccount({
      user: userId,
      accountName: accountName.trim(),
      phoneNumber: validatedPhone,
      status: 'connecting'
    });

    await account.save();

    // Initialize WhatsApp client
    try {
      await WhatsAppWebService.initializeClient(account._id.toString(), userId, io);
      
      res.json({
        success: true,
        message: 'WhatsApp connection initiated. Scan QR code to proceed.',
        data: {
          accountId: account._id,
          accountName: account.accountName,
          phoneNumber: account.phoneNumber,
          status: 'connecting'
        }
      });
    } catch (error) {
      account.status = 'failed';
      account.errorMessage = error.message;
      await account.save();
      throw error;
    }
  } catch (error) {
    handleError(res, error, 'WhatsApp connection failed');
  }
});

// @route   POST /api/whatsapp-web/disconnect/:id
// @desc    Disconnect WhatsApp account
router.post('/disconnect/:id', auth, async (req, res) => {
  try {
    const account = await WhatsAppAccount.findOne({
      _id: req.params.id,
      user: req.user.id
    });

    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    await WhatsAppWebService.disconnectAccount(req.params.id);
    
    account.status = 'disconnected';
    account.updatedAt = new Date();
    await account.save();

    res.json({
      success: true,
      message: 'Account disconnected successfully',
      data: { accountId: account._id, status: 'disconnected' }
    });
  } catch (error) {
    handleError(res, error, 'Disconnect failed');
  }
});

// @route   DELETE /api/whatsapp-web/accounts/:id
// @desc    Delete WhatsApp account permanently
router.delete('/accounts/:id', auth, async (req, res) => {
  try {
    const account = await WhatsAppAccount.findOne({
      _id: req.params.id,
      user: req.user.id
    });

    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    // Cleanup WhatsApp service
    await WhatsAppWebService.disconnectAccount(req.params.id);

    // Delete related data
    await Promise.all([
      WhatsAppCampaign.deleteMany({ whatsappAccount: req.params.id }),
      WhatsAppMessage.deleteMany({ whatsappAccount: req.params.id }),
      WhatsAppAccount.findByIdAndDelete(req.params.id)
    ]);

    res.json({ success: true, message: 'Account permanently deleted' });
  } catch (error) {
    handleError(res, error, 'Delete failed');
  }
});

// @route   GET /api/whatsapp-web/accounts
// @desc    Get user's WhatsApp accounts
router.get('/accounts', auth, async (req, res) => {
  try {
    const accounts = await WhatsAppAccount.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .select('accountName phoneNumber status isActive lastActivity createdAt errorMessage');
    
    const enrichedAccounts = accounts.map(account => ({
      ...account.toObject(),
      canReconnect: ['disconnected', 'failed'].includes(account.status),
      isConnected: ['ready', 'authenticated'].includes(account.status)
    }));
    
    res.json({ success: true, data: enrichedAccounts });
  } catch (error) {
    handleError(res, error, 'Failed to fetch accounts');
  }
});

// @route   GET /api/whatsapp-web/account-status/:id
// @desc    Get real-time account status
router.get('/account-status/:id', auth, async (req, res) => {
  try {
    const account = await WhatsAppAccount.findOne({
      _id: req.params.id,
      user: req.user.id
    });

    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    // Get real-time status from service
    const realTimeStatus = await WhatsAppWebService.getAccountStatus(req.params.id);
    
    // Update database if status changed
    if (realTimeStatus.status !== account.status) {
      account.status = realTimeStatus.status;
      if (realTimeStatus.status === 'disconnected') {
        account.errorMessage = 'Connection lost';
      }
      await account.save();
    }

    res.json({
      success: true,
      data: {
        accountId: req.params.id,
        status: realTimeStatus.status,
        phoneNumber: realTimeStatus.phoneNumber || account.phoneNumber,
        profileName: realTimeStatus.profileName,
        lastActivity: account.lastActivity,
        errorMessage: account.errorMessage
      }
    });
  } catch (error) {
    handleError(res, error, 'Status check failed');
  }
});

// @route   GET /api/whatsapp-web/qr/:id
// @desc    Get QR code
router.get('/qr/:id', auth, async (req, res) => {
  try {
    const account = await WhatsAppAccount.findOne({
      _id: req.params.id,
      user: req.user.id
    });

    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    const qrCode = WhatsAppWebService.getQRCode(req.params.id);
    
    if (!qrCode) {
      return res.status(404).json({ 
        success: false, 
        message: 'QR code not available. Try reconnecting.' 
      });
    }

    res.json({ success: true, data: { qrCode, timestamp: new Date() } });
  } catch (error) {
    handleError(res, error, 'QR code fetch failed');
  }
});

// @route   POST /api/whatsapp-web/send
// @desc    Send WhatsApp messages
router.post('/send', [auth, upload.single('media')], async (req, res) => {
  try {
    const { accountId, recipients, content, options = '{}' } = req.body;

    // Validate inputs
    if (!accountId?.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ success: false, message: 'Invalid account ID' });
    }

    const recipientList = parseJSON(recipients);
    const messageContent = parseJSON(content);
    const sendOptions = parseJSON(options);

    if (!Array.isArray(recipientList) || recipientList.length === 0) {
      return res.status(400).json({ success: false, message: 'Recipients required' });
    }

    if (!messageContent?.type || !['text', 'image', 'video'].includes(messageContent.type)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid content type required (text, image, video)' 
      });
    }

    // Verify account
    const account = await WhatsAppAccount.findOne({
      _id: accountId,
      user: req.user.id,
      status: { $in: ['ready', 'authenticated'] }
    });

    if (!account) {
      return res.status(404).json({ 
        success: false, 
        message: 'Account not found or not ready' 
      });
    }

    // Add media file info
    if (req.file) {
      messageContent.mediaPath = req.file.path;
      messageContent.fileName = req.file.filename;
      messageContent.mimeType = req.file.mimetype;
    }

    // Validate content requirements
    if (messageContent.type === 'text' && !messageContent.text?.trim()) {
      return res.status(400).json({ success: false, message: 'Text content required' });
    }

    if (messageContent.type !== 'text' && !req.file) {
      return res.status(400).json({ success: false, message: 'Media file required' });
    }

    // Clean and validate phone numbers
    const validRecipients = recipientList
      .map(r => typeof r === 'string' ? r : r.phone)
      .map(validatePhone)
      .filter(Boolean);

    if (validRecipients.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid phone numbers' });
    }

    // Create campaign
    const campaign = new WhatsAppCampaign({
      user: req.user.id,
      name: `Bulk Send - ${new Date().toLocaleDateString()}`,
      whatsappAccount: accountId,
      messages: validRecipients.map(phone => ({
        recipient: { phone },
        content: messageContent,
        status: 'pending'
      })),
      status: 'running',
      antiBlockSettings: sendOptions
    });

    await campaign.save();

    // Process campaign asynchronously
    setImmediate(() => {
      WhatsAppWebService.processCampaign(campaign._id)
        .catch(async (error) => {
          console.error('Campaign processing failed:', error);
          await WhatsAppCampaign.findByIdAndUpdate(campaign._id, {
            status: 'failed',
            errorMessage: error.message,
            completedAt: new Date()
          });
        });
    });

    res.json({
      success: true,
      message: 'Messages queued for sending',
      data: {
        campaignId: campaign._id,
        recipientCount: validRecipients.length,
        accountName: account.accountName
      }
    });
  } catch (error) {
    handleError(res, error, 'Send message failed');
  }
});

// @route   GET /api/whatsapp-web/campaigns
// @desc    Get campaigns
router.get('/campaigns', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const query = { user: req.user.id };
    if (status) query.status = status;
    
    const [campaigns, total] = await Promise.all([
      WhatsAppCampaign.find(query)
        .populate('whatsappAccount', 'accountName phoneNumber')
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit),
      WhatsAppCampaign.countDocuments(query)
    ]);
    
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
    handleError(res, error, 'Failed to fetch campaigns');
  }
});

// @route   POST /api/whatsapp-web/contacts/lists
// @desc    Create contact list
router.post('/contacts/lists', [
  auth,
  body('name').trim().isLength({ min: 1 }).withMessage('List name required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { name, description, contacts = [] } = req.body;
    
    const contactList = new WhatsAppContactList({
      user: req.user.id,
      name,
      description: description || '',
      contacts,
      contactCount: contacts.length
    });

    await contactList.save();
    res.status(201).json({ success: true, message: 'Contact list created', data: contactList });
  } catch (error) {
    handleError(res, error, 'Failed to create contact list');
  }
});

// @route   POST /api/whatsapp-web/contacts/import
// @desc    Import contacts from CSV
router.post('/contacts/import', [auth, upload.single('csvFile')], async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'CSV file required' });
    }

    const { listName, listDescription } = req.body;
    const contacts = [];
    const errors = [];
    let lineNumber = 0;

    // Parse CSV
    await new Promise((resolve, reject) => {
      fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (row) => {
          lineNumber++;
          const phone = row.phone || row.Phone || row.number;
          const validatedPhone = validatePhone(phone);
          
          if (!validatedPhone) {
            errors.push(`Line ${lineNumber}: Invalid phone number`);
            return;
          }

          contacts.push({
            phone: validatedPhone,
            name: row.name || row.Name || '',
            email: row.email || row.Email || '',
            company: row.company || row.Company || '',
            customFields: Object.keys(row).reduce((acc, key) => {
              if (!['phone', 'name', 'email', 'company'].includes(key.toLowerCase())) {
                acc[key] = row[key];
              }
              return acc;
            }, {}),
            source: 'import'
          });
        })
        .on('end', resolve)
        .on('error', reject);
    });

    // Clean up file
    fs.unlinkSync(req.file.path);

    if (contacts.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid contacts found',
        errors
      });
    }

    // Create contact list
    const contactList = new WhatsAppContactList({
      user: req.user.id,
      name: listName || `Imported - ${new Date().toLocaleDateString()}`,
      description: listDescription || 'Imported from CSV',
      contacts,
      contactCount: contacts.length
    });

    await contactList.save();

    res.json({
      success: true,
      message: `${contacts.length} contacts imported`,
      data: {
        listId: contactList._id,
        imported: contacts.length,
        errors: errors.length
      }
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    handleError(res, error, 'Import failed');
  }
});

// @route   GET /api/whatsapp-web/messages
// @desc    Get message history
router.get('/messages', auth, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      status, 
      accountId, 
      campaignId,
      dateFrom,
      dateTo 
    } = req.query;
    
    const query = { user: req.user.id };
    
    if (status) query.status = status;
    if (accountId) query.whatsappAccount = accountId;
    if (campaignId) query.campaign = campaignId;
    
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }
    
    const [messages, total] = await Promise.all([
      WhatsAppMessage.find(query)
        .populate('whatsappAccount', 'accountName phoneNumber')
        .populate('campaign', 'name')
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit),
      WhatsAppMessage.countDocuments(query)
    ]);
    
    res.json({
      success: true,
      data: messages,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    handleError(res, error, 'Failed to fetch messages');
  }
});

// @route   GET /api/whatsapp-web/analytics
// @desc    Get comprehensive analytics
router.get('/analytics', auth, async (req, res) => {
  try {
    const { timeRange = '30d', accountId } = req.query;
    const userId = req.user.id;
    
    // Calculate date range
    const now = new Date();
    const days = timeRange === '7d' ? 7 : timeRange === '90d' ? 90 : 30;
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const baseQuery = { 
      user: userId,
      createdAt: { $gte: startDate }
    };
    
    if (accountId) baseQuery.whatsappAccount = accountId;

    // Parallel queries for better performance
    const [
      totalMessages,
      sentMessages,
      deliveredMessages,
      readMessages,
      failedMessages,
      dailyStats,
      topFailureReasons,
      messageTypes // ADD THIS: Message types aggregation
    ] = await Promise.all([
      WhatsAppMessage.countDocuments(baseQuery),
      WhatsAppMessage.countDocuments({ ...baseQuery, status: { $in: ['sent', 'delivered', 'read'] } }),
      WhatsAppMessage.countDocuments({ ...baseQuery, status: { $in: ['delivered', 'read'] } }),
      WhatsAppMessage.countDocuments({ ...baseQuery, status: 'read' }),
      WhatsAppMessage.countDocuments({ ...baseQuery, status: 'failed' }),
      
      // Daily statistics
      WhatsAppMessage.aggregate([
        { $match: baseQuery },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            total: { $sum: 1 },
            sent: { $sum: { $cond: [{ $in: ["$status", ["sent", "delivered", "read"]] }, 1, 0] } },
            delivered: { $sum: { $cond: [{ $in: ["$status", ["delivered", "read"]] }, 1, 0] } },
            read: { $sum: { $cond: [{ $eq: ["$status", "read"] }, 1, 0] } },
            failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      
      // Top failure reasons
      WhatsAppMessage.aggregate([
        { $match: { ...baseQuery, status: 'failed', failureReason: { $exists: true } } },
        { $group: { _id: "$failureReason", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 }
      ]),
      
      // NEW: Message types aggregation
      WhatsAppMessage.aggregate([
        { $match: baseQuery },
        {
          $group: {
            _id: "$content.type",
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } }
      ])
    ]);

    // Calculate rates
    const deliveryRate = sentMessages > 0 ? ((deliveredMessages / sentMessages) * 100) : 0;
    const readRate = deliveredMessages > 0 ? ((readMessages / deliveredMessages) * 100) : 0;
    const failureRate = totalMessages > 0 ? ((failedMessages / totalMessages) * 100) : 0;
    const successRate = totalMessages > 0 ? (((totalMessages - failedMessages) / totalMessages) * 100) : 0;

    // FIXED: Generate daily stats for entire date range (fill missing dates with zeros)
    const generateDailyStats = () => {
      const statsMap = new Map();
      
      // Fill with data from database
      dailyStats.forEach(stat => {
        statsMap.set(stat._id, {
          date: stat._id,
          total: stat.total,
          sent: stat.sent,
          delivered: stat.delivered,
          read: stat.read,
          failed: stat.failed
        });
      });
      
      // Fill missing dates with zeros
      const result = [];
      for (let i = 0; i < days; i++) {
        const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
        const dateStr = date.toISOString().split('T')[0];
        
        if (statsMap.has(dateStr)) {
          result.push(statsMap.get(dateStr));
        } else {
          result.push({
            date: dateStr,
            total: 0,
            sent: 0,
            delivered: 0,
            read: 0,
            failed: 0
          });
        }
      }
      
      return result;
    };

    // FIXED: Process message types with proper names
    const processedMessageTypes = messageTypes.length > 0 ? messageTypes.map(type => ({
      name: type._id || 'text', // Default to 'text' if null
      count: type.count,
      percentage: parseFloat(((type.count / totalMessages) * 100).toFixed(2))
    })) : [
      // Default data when no messages exist
      { name: 'text', count: 0, percentage: 0 },
      { name: 'image', count: 0, percentage: 0 },
      { name: 'video', count: 0, percentage: 0 }
    ];

    res.json({
      success: true,
      data: {
        overview: {
          totalMessages,
          sentMessages,
          deliveredMessages,
          readMessages,
          failedMessages,
          deliveryRate: parseFloat(deliveryRate.toFixed(2)),
          readRate: parseFloat(readRate.toFixed(2)),
          failureRate: parseFloat(failureRate.toFixed(2)),
          successRate: parseFloat(successRate.toFixed(2)),
          // ADD: Growth percentages (you can calculate vs previous period)
          messageGrowth: '+12.5%', // Calculate this based on previous period
          deliveryGrowth: '+2.3%',
          readGrowth: '+5.1%'
        },
        dailyStats: generateDailyStats(),
        messageTypes: processedMessageTypes, // ADD THIS
        failureReasons: topFailureReasons.map(reason => ({
          reason: reason._id,
          count: reason.count,
          percentage: parseFloat(((reason.count / (failedMessages || 1)) * 100).toFixed(2))
        })),
        timeRange: {
          start: startDate,
          end: now,
          days
        }
      }
    });
  } catch (error) {
    handleError(res, error, 'Analytics fetch failed');
  }
});

module.exports = router;