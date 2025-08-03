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
const User = require('../models/User');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads/whatsapp');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi|pdf|doc|docx|csv|txt|mp3|wav|ogg/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// @route   POST /api/whatsapp-web/connect
// @desc    Connect WhatsApp account
// @access  Private
router.post('/connect', [
  auth,
  body('accountName').trim().isLength({ min: 1 }).withMessage('Account name is required'),
  body('phoneNumber').optional().matches(/^\+?[\d\s\-\(\)]+$/).withMessage('Please enter a valid phone number')
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

    const { accountName, phoneNumber } = req.body;
    const userId = req.user.id;

    console.log('Connect request:', { 
      accountName, 
      phoneNumber: phoneNumber || 'not provided', 
      userId 
    });

    // Get user details
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Try to get phone number from request body or user profile (completely optional)
    let finalPhoneNumber = phoneNumber || user.phone;
    
    // Clean and validate phone number only if provided
    if (finalPhoneNumber) {
      finalPhoneNumber = finalPhoneNumber.replace(/\D/g, ''); // Remove non-digits
      
      if (finalPhoneNumber.length < 10) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid phone number with at least 10 digits'
        });
      }

      // Add country code if not present
      if (!finalPhoneNumber.startsWith('91') && finalPhoneNumber.length === 10) {
        finalPhoneNumber = '91' + finalPhoneNumber;
      }

      // Check if account with this phone number already exists for this user
      const existingAccount = await WhatsAppAccount.findOne({
        user: userId,
        phoneNumber: finalPhoneNumber
      });

      if (existingAccount) {
        return res.status(400).json({
          success: false,
          message: 'WhatsApp account with this phone number already exists',
          data: {
            accountId: existingAccount._id,
            status: existingAccount.status
          }
        });
      }
    }

    // Create new WhatsApp account (phone number can be null initially)
    const account = new WhatsAppAccount({
      user: userId,
      accountName,
      phoneNumber: finalPhoneNumber || null, // Phone number is completely optional
      status: 'connecting'
    });

    await account.save();
    console.log('Account created:', account._id);

    // Initialize WhatsApp client with error handling
    try {
      // CRITICAL FIX: Get io instance from app or global
      const io = req.app.get('io') || global.io;
      
      if (!io) {
        console.error('Socket.IO instance not found!');
        throw new Error('Socket.IO not available');
      }

      console.log('Initializing WhatsApp client with IO instance...');
      
      // Pass io instance to the service
      await WhatsAppWebService.initializeClient(account._id.toString(), userId, io);
      
      res.status(201).json({
        success: true,
        message: finalPhoneNumber ? 
          'WhatsApp account connection initiated. Please scan the QR code.' :
          'WhatsApp account connection initiated. Phone number will be detected after QR scan.',
        data: {
          accountId: account._id,
          accountName: account.accountName,
          phoneNumber: account.phoneNumber,
          status: account.status
        }
      });
    } catch (error) {
      console.error('WhatsApp client initialization error:', error);
      
      // Safely update account status with error handling
      try {
        await WhatsAppAccount.findByIdAndUpdate(
          account._id,
          { 
            status: 'failed',
            errorMessage: error.message,
            updatedAt: new Date()
          },
          { new: true }
        );
      } catch (updateError) {
        console.error('Error updating account status:', updateError);
      }
      
      return res.status(500).json({
        success: false,
        message: 'Failed to initialize WhatsApp client',
        error: error.message
      });
    }
  } catch (error) {
    console.error('Connect WhatsApp account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to connect WhatsApp account',
      error: error.message
    });
  }
});


// @route   GET /api/whatsapp-web/accounts
// @desc    Get all WhatsApp accounts for user
// @access  Private
router.get('/accounts', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const accounts = await WhatsAppAccount.find({ user: userId })
      .sort({ createdAt: -1 })
      .select('accountName phoneNumber status isActive lastSeen createdAt errorMessage');
    
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

// @route   DELETE /api/whatsapp-web/accounts/:id
// @desc    Delete WhatsApp account (NEW ROUTE)
// @access  Private
router.delete('/accounts/:id', auth, async (req, res) => {
  try {
    const accountId = req.params.id;
    const userId = req.user.id;

    // Check if account exists and belongs to user
    const account = await WhatsAppAccount.findOne({
      _id: accountId,
      user: userId
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'WhatsApp account not found'
      });
    }

    // Disconnect from WhatsApp Web service if connected
    try {
      await WhatsAppWebService.disconnectAccount(accountId);
    } catch (error) {
      console.error('Error disconnecting from WhatsApp service:', error);
      // Continue with deletion even if disconnect fails
    }

    // Delete related campaigns and messages
    await WhatsAppCampaign.deleteMany({ whatsappAccount: accountId });
    await WhatsAppMessage.deleteMany({ whatsappAccount: accountId });

    // Delete the account
    await WhatsAppAccount.findByIdAndDelete(accountId);

    res.json({
      success: true,
      message: 'WhatsApp account deleted successfully'
    });
  } catch (error) {
    console.error('Delete WhatsApp account error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   GET /api/whatsapp-web/account-status/:id
// @desc    Get real-time account status
// @access  Private
router.get('/account-status/:id', auth, async (req, res) => {
  try {
    const accountId = req.params.id;
    const userId = req.user.id;

    // Verify account ownership
    const account = await WhatsAppAccount.findOne({
      _id: accountId,
      user: userId
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'WhatsApp account not found'
      });
    }

    // Get real-time status from service
    const serviceStatus = WhatsAppWebService.getAccountStatus(accountId);
    
    res.json({
      success: true,
      data: {
        accountId,
        dbStatus: account.status,
        serviceStatus: serviceStatus.status,
        phoneNumber: serviceStatus.phoneNumber,
        profileName: serviceStatus.profileName,
        lastActivity: account.lastActivity,
        dailyMessageCount: account.dailyMessageCount,
        dailyLimit: account.dailyLimit
      }
    });
  } catch (error) {
    console.error('Get account status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/whatsapp-web/campaigns
// @desc    Get all campaigns for user
// @access  Private
router.get('/campaigns', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const userId = req.user.id;
    
    const query = { user: userId };
    if (status) query.status = status;
    
    const campaigns = await WhatsAppCampaign.find(query)
      .populate('whatsappAccount', 'accountName phoneNumber')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await WhatsAppCampaign.countDocuments(query);
    
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

// @route   GET /api/whatsapp-web/contacts/lists
// @desc    Get all contact lists
// @access  Private
router.get('/contacts/lists', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const userId = req.user.id;
    
    const query = { user: userId };
    
    // Add search functionality
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    
    const lists = await WhatsAppContactList.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('name description contactCount createdAt updatedAt');
    
    const total = await WhatsAppContactList.countDocuments(query);
    
    res.json({
      success: true,
      data: lists,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get contact lists error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   POST /api/whatsapp-web/contacts/lists
// @desc    Create new contact list
// @access  Private
router.post('/contacts/lists', [
  auth,
  body('name').trim().isLength({ min: 1 }).withMessage('List name is required'),
  body('description').optional().trim()
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

    const { name, description, contacts = [] } = req.body;
    const userId = req.user.id;

    const contactList = new WhatsAppContactList({
      user: userId,
      name,
      description: description || '',
      contacts: contacts,
      contactCount: contacts.length
    });

    await contactList.save();

    res.status(201).json({
      success: true,
      message: 'Contact list created successfully',
      data: contactList
    });
  } catch (error) {
    console.error('Create contact list error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   GET /api/whatsapp-web/contacts/lists/:id
// @desc    Get specific contact list with contacts
// @access  Private
router.get('/contacts/lists/:id', auth, async (req, res) => {
  try {
    const listId = req.params.id;
    const userId = req.user.id;
    
    const list = await WhatsAppContactList.findOne({
      _id: listId,
      user: userId
    });
    
    if (!list) {
      return res.status(404).json({
        success: false,
        message: 'Contact list not found'
      });
    }
    
    res.json({
      success: true,
      data: list
    });
  } catch (error) {
    console.error('Get contact list error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/whatsapp-web/contacts/lists/:id
// @desc    Update contact list
// @access  Private
router.put('/contacts/lists/:id', [
  auth,
  body('name').trim().isLength({ min: 1 }).withMessage('List name is required')
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
    
    const listId = req.params.id;
    const userId = req.user.id;
    const { name, description, contacts } = req.body;
    
    const updateData = { 
      name, 
      description, 
      updatedAt: new Date() 
    };
    
    if (contacts) {
      updateData.contacts = contacts;
      updateData.contactCount = contacts.length;
    }
    
    const list = await WhatsAppContactList.findOneAndUpdate(
      { _id: listId, user: userId },
      updateData,
      { new: true }
    );
    
    if (!list) {
      return res.status(404).json({
        success: false,
        message: 'Contact list not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Contact list updated successfully',
      data: list
    });
  } catch (error) {
    console.error('Update contact list error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   DELETE /api/whatsapp-web/contacts/lists/:id
// @desc    Delete contact list
// @access  Private
router.delete('/contacts/lists/:id', auth, async (req, res) => {
  try {
    const listId = req.params.id;
    const userId = req.user.id;
    
    const list = await WhatsAppContactList.findOneAndDelete({
      _id: listId,
      user: userId
    });
    
    if (!list) {
      return res.status(404).json({
        success: false,
        message: 'Contact list not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Contact list deleted successfully'
    });
  } catch (error) {
    console.error('Delete contact list error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/whatsapp-web/disconnect/:id
// @desc    Disconnect WhatsApp account
// @access  Private
router.post('/disconnect/:id', auth, async (req, res) => {
  try {
    const accountId = req.params.id;
    const userId = req.user.id;

    const account = await WhatsAppAccount.findOne({
      _id: accountId,
      user: userId
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'WhatsApp account not found'
      });
    }

    // Disconnect from WhatsApp Web
    try {
      await WhatsAppWebService.disconnectAccount(accountId);
    } catch (error) {
      console.error('Error disconnecting from WhatsApp service:', error);
    }

    // Update account status with error handling
    try {
      await WhatsAppAccount.findByIdAndUpdate(
        accountId,
        { 
          status: 'disconnected',
          updatedAt: new Date()
        },
        { new: true }
      );
    } catch (updateError) {
      console.error('Error updating account status:', updateError);
    }

    res.json({
      success: true,
      message: 'WhatsApp account disconnected successfully'
    });
  } catch (error) {
    console.error('Disconnect WhatsApp account error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/whatsapp-web/qr/:id
// @desc    Get QR code for account
// @access  Private
router.get('/qr/:id', auth, async (req, res) => {
  try {
    const accountId = req.params.id;
    const userId = req.user.id;

    // Verify account ownership
    const account = await WhatsAppAccount.findOne({
      _id: accountId,
      user: userId
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'WhatsApp account not found'
      });
    }

    const qrCode = WhatsAppWebService.getQRCode(accountId);

    if (!qrCode) {
      return res.status(404).json({
        success: false,
        message: 'QR code not available. Please try connecting again.'
      });
    }

    res.json({
      success: true,
      data: {
        qrCode,
        timestamp: new Date()
      }
    });
  } catch (error) {
    console.error('Get QR code error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/whatsapp-web/send
// @desc    Send WhatsApp message
// @access  Private
router.post('/send', [
  auth,
  upload.single('media')
], async (req, res) => {
  try {
    console.log('Request body:', req.body);
    console.log('Request file:', req.file);

    const { accountId, recipients, content, options = {} } = req.body;
    const userId = req.user.id;

    // Validate required fields
    if (!accountId) {
      return res.status(400).json({
        success: false,
        message: 'Account ID is required'
      });
    }

    // Validate accountId format
    if (!accountId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid account ID format'
      });
    }

    // Parse and validate recipients
    let recipientList;
    try {
      recipientList = typeof recipients === 'string' ? JSON.parse(recipients) : recipients;
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid recipients format. Must be valid JSON array.'
      });
    }

    if (!Array.isArray(recipientList) || recipientList.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one recipient is required'
      });
    }

    // Parse and validate content
    let messageContent;
    try {
      messageContent = typeof content === 'string' ? JSON.parse(content) : content;
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid content format. Must be valid JSON object.'
      });
    }

    if (!messageContent || !messageContent.type) {
      return res.status(400).json({
        success: false,
        message: 'Content type is required'
      });
    }

    // Validate content type
    const validContentTypes = ['text', 'image', 'video'];
    if (!validContentTypes.includes(messageContent.type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid content type. Must be one of: ${validContentTypes.join(', ')}`
      });
    }

    // Verify account ownership and status
    const account = await WhatsAppAccount.findOne({
      _id: accountId,
      user: userId,
      status: { $in: ['ready', 'connected', 'authenticated'] }
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'WhatsApp account not found or not ready. Please ensure your WhatsApp is connected.'
      });
    }

    // Add media file path if uploaded
    if (req.file) {
      messageContent.mediaPath = req.file.path;
      messageContent.fileName = req.file.filename;
      messageContent.mimeType = req.file.mimetype;
    }

    // Validate that media file exists for non-text content types
    if (messageContent.type !== 'text' && !req.file) {
      return res.status(400).json({
        success: false,
        message: `Media file is required for content type: ${messageContent.type}`
      });
    }
    
    // Validate text content for text messages
    if (messageContent.type === 'text' && (!messageContent.text || messageContent.text.trim() === '')) {
      return res.status(400).json({
        success: false,
        message: 'Text content is required for text messages'
      });
    }
    
    // Clean and validate phone numbers
    const validatedRecipients = [];
    for (const recipient of recipientList) {
      const phone = typeof recipient === 'string' ? recipient : recipient.phone;
      if (!phone) {
        continue; // Skip invalid recipients
      }
      
      // Clean phone number
      const cleanPhone = phone.replace(/\D/g, '');
      if (cleanPhone.length >= 10) {
        validatedRecipients.push(cleanPhone);
      }
    }
    
    if (validatedRecipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid phone numbers found in recipients list'
      });
    }

    // Create campaign for bulk send
    const campaign = new WhatsAppCampaign({
      user: userId,
      name: `Bulk Send - ${new Date().toLocaleDateString()}`,
      whatsappAccount: accountId,
      messages: validatedRecipients.map(phone => ({
        recipient: { phone },
        content: messageContent,
        status: 'pending'
      })),
      status: 'running'
    });

    await campaign.save();

    // Process campaign (this should be handled by a background job)
    try {
      // Process campaign asynchronously
      setImmediate(() => {
        WhatsAppWebService.processCampaign(campaign._id)
          .catch(async (error) => {
            console.error('Error processing campaign:', error);
            try {
              await WhatsAppCampaign.findByIdAndUpdate(campaign._id, {
                status: 'failed',
                errorMessage: error.message,
                updatedAt: new Date()
              });
            } catch (updateError) {
              console.error('Error updating campaign status:', updateError);
            }
          });
      });
    } catch (error) {
      console.error('Error initiating campaign processing:', error);
      campaign.status = 'failed';
      campaign.errorMessage = error.message;
      await campaign.save();
    }

    res.json({
      success: true,
      message: 'Messages queued for sending',
      data: {
        campaignId: campaign._id,
        recipientCount: validatedRecipients.length,
        accountName: account.accountName
      }
    });
  } catch (error) {
    console.error('Send WhatsApp message error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});
// @route   POST /api/whatsapp-web/contacts/import
// @desc    Import contacts from CSV
// @access  Private
router.post('/contacts/import', [auth, upload.single('csvFile')], async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'CSV file is required'
      });
    }

    const { listName, listDescription } = req.body;
    const userId = req.user.id;

    const contacts = [];
    const errors = [];
    let lineNumber = 0;

    // Parse CSV file
    await new Promise((resolve, reject) => {
      fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (row) => {
          lineNumber++;
          
          // Validate phone number
          const phone = row.phone || row.Phone || row.PHONE || row.number;
          if (!phone || !/^\+?[\d\s\-\(\)]+$/.test(phone)) {
            errors.push(`Line ${lineNumber}: Invalid or missing phone number`);
            return;
          }

          contacts.push({
            phone: phone.replace(/\D/g, ''), // Remove non-digits
            name: row.name || row.Name || row.NAME || '',
            email: row.email || row.Email || row.EMAIL || '',
            company: row.company || row.Company || row.COMPANY || '',
            customFields: {
              ...Object.keys(row).reduce((acc, key) => {
                if (!['phone', 'name', 'email', 'company'].includes(key.toLowerCase())) {
                  acc[key] = row[key];
                }
                return acc;
              }, {})
            },
            source: 'import'
          });
        })
        .on('end', resolve)
        .on('error', reject);
    });

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    if (contacts.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid contacts found in CSV file',
        errors
      });
    }

    // Create contact list
    const contactList = new WhatsAppContactList({
      user: userId,
      name: listName || `Imported List ${new Date().toLocaleDateString()}`,
      description: listDescription || 'Imported from CSV',
      contacts,
      contactCount: contacts.length
    });

    await contactList.save();

    res.json({
      success: true,
      message: `${contacts.length} contacts imported successfully`,
      data: {
        listId: contactList._id,
        imported: contacts.length,
        errors: errors.length,
        details: {
          importErrors: errors
        }
      }
    });
  } catch (error) {
    console.error('Import contacts error:', error);
    
    // Clean up file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error during import'
    });
  }
});

// @route   GET /api/whatsapp-web/messages
// @desc    Get message history
// @access  Private
router.get('/messages', auth, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      status, 
      accountId, 
      recipient,
      campaignId,
      dateFrom,
      dateTo 
    } = req.query;
    
    const query = { user: req.user.id };
    
    // Apply filters
    if (status) query.status = status;
    if (accountId) query.whatsappAccount = accountId;
    if (campaignId) query.campaign = campaignId;
    if (recipient) query['recipient.phone'] = { $regex: recipient, $options: 'i' };
    
    // Date range filter
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }
    
    const messages = await WhatsAppMessage.find(query)
      .populate('whatsappAccount', 'accountName phoneNumber')
      .populate('campaign', 'name')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await WhatsAppMessage.countDocuments(query);
    
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
    console.error('Get messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/whatsapp-web/analytics
// @desc    Get WhatsApp analytics
// @access  Private
router.get('/analytics', auth, async (req, res) => {
  try {
    const { timeRange = '30d', accountId } = req.query;
    const userId = req.user.id;
    
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

    const query = { 
      user: userId,
      createdAt: { $gte: startDate }
    };
    
    if (accountId) {
      query.whatsappAccount = accountId;
    }

    // Get message statistics
    const totalMessages = await WhatsAppMessage.countDocuments(query);
    const sentMessages = await WhatsAppMessage.countDocuments({ ...query, status: { $in: ['sent', 'delivered', 'read'] } });
    const deliveredMessages = await WhatsAppMessage.countDocuments({ ...query, status: { $in: ['delivered', 'read'] } });
    const readMessages = await WhatsAppMessage.countDocuments({ ...query, status: 'read' });
    const failedMessages = await WhatsAppMessage.countDocuments({ ...query, status: 'failed' });

    // Calculate rates
    const deliveryRate = sentMessages > 0 ? (deliveredMessages / sentMessages) * 100 : 0;
    const readRate = deliveredMessages > 0 ? (readMessages / deliveredMessages) * 100 : 0;
    const failureRate = totalMessages > 0 ? (failedMessages / totalMessages) * 100 : 0;

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
          failureRate: parseFloat(failureRate.toFixed(2))
        }
      }
    });
  } catch (error) {
    console.error('Get WhatsApp analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;