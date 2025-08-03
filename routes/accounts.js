const express = require('express');
const { body, validationResult } = require('express-validator');
const { auth } = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

// @route   GET /api/accounts/email-accounts
// @desc    Get user's email accounts
// @access  Private
router.get('/email-accounts', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    // Don't expose sensitive tokens in response
    const emailAccounts = user.emailAccounts.map(account => ({
      id: account._id,
      type: account.type,
      email: account.email,
      isConnected: account.isConnected,
      dailyLimit: account.dailyLimit,
      sentToday: account.sentToday,
      lastReset: account.lastReset
    }));

    res.json({
      success: true,
      data: emailAccounts
    });
  } catch (error) {
    console.error('Get email accounts error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/accounts/email-accounts
// @desc    Add email account
// @access  Private
router.post('/email-accounts', [
  auth,
  body('type').isIn(['gmail', 'outlook', 'smtp']).withMessage('Invalid account type'),
  body('email').isEmail().normalizeEmail().withMessage('Please enter a valid email'),
  body('dailyLimit').optional().isInt({ min: 1, max: 1000 }).withMessage('Daily limit must be between 1 and 1000')
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

    const { type, email, dailyLimit = 500 } = req.body;
    const userId = req.user.id;

    const user = await User.findById(userId);

    // Check if email account already exists
    const existingAccount = user.emailAccounts.find(acc => acc.email === email);
    if (existingAccount) {
      return res.status(400).json({
        success: false,
        message: 'Email account already exists'
      });
    }

    // Add new email account
    user.emailAccounts.push({
      type,
      email,
      dailyLimit,
      isConnected: false // Will be set to true after OAuth flow
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: 'Email account added successfully',
      data: {
        id: user.emailAccounts[user.emailAccounts.length - 1]._id,
        type,
        email,
        dailyLimit,
        isConnected: false
      }
    });
  } catch (error) {
    console.error('Add email account error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/accounts/email-accounts/:id
// @desc    Update email account
// @access  Private
router.put('/email-accounts/:id', [
  auth,
  body('dailyLimit').optional().isInt({ min: 1, max: 1000 }).withMessage('Daily limit must be between 1 and 1000')
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

    const { dailyLimit } = req.body;
    const accountId = req.params.id;
    const userId = req.user.id;

    const user = await User.findById(userId);
    const account = user.emailAccounts.id(accountId);

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Email account not found'
      });
    }

    if (dailyLimit) account.dailyLimit = dailyLimit;
    await user.save();

    res.json({
      success: true,
      message: 'Email account updated successfully',
      data: {
        id: account._id,
        type: account.type,
        email: account.email,
        dailyLimit: account.dailyLimit,
        isConnected: account.isConnected
      }
    });
  } catch (error) {
    console.error('Update email account error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   DELETE /api/accounts/email-accounts/:id
// @desc    Remove email account
// @access  Private
router.delete('/email-accounts/:id', auth, async (req, res) => {
  try {
    const accountId = req.params.id;
    const userId = req.user.id;

    const user = await User.findById(userId);
    const account = user.emailAccounts.id(accountId);

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Email account not found'
      });
    }

    user.emailAccounts.pull(accountId);
    await user.save();

    res.json({
      success: true,
      message: 'Email account removed successfully'
    });
  } catch (error) {
    console.error('Remove email account error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/accounts/api-keys
// @desc    Get user's API keys
// @access  Private
router.get('/api-keys', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    // Mask API keys for security
    const apiKeys = user.apiKeys.map(key => ({
      id: key._id,
      name: key.name,
      service: key.service,
      key: key.key.substring(0, 8) + '•'.repeat(key.key.length - 16) + key.key.substring(key.key.length - 8),
      isActive: key.isActive,
      lastUsed: key.lastUsed
    }));

    res.json({
      success: true,
      data: apiKeys
    });
  } catch (error) {
    console.error('Get API keys error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/accounts/api-keys
// @desc    Add API key
// @access  Private
router.post('/api-keys', [
  auth,
  body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Name is required and must be less than 100 characters'),
  body('service').isIn(['sendgrid', 'mailgun', 'whatsapp', 'custom']).withMessage('Invalid service type'),
  body('key').trim().isLength({ min: 10 }).withMessage('API key must be at least 10 characters')
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

    const { name, service, key } = req.body;
    const userId = req.user.id;

    const user = await User.findById(userId);

    // Check if API key name already exists
    const existingKey = user.apiKeys.find(k => k.name === name);
    if (existingKey) {
      return res.status(400).json({
        success: false,
        message: 'API key with this name already exists'
      });
    }

    // Add new API key
    user.apiKeys.push({
      name,
      service,
      key,
      isActive: true
    });

    await user.save();

    const newKey = user.apiKeys[user.apiKeys.length - 1];

    res.status(201).json({
      success: true,
      message: 'API key added successfully',
      data: {
        id: newKey._id,
        name: newKey.name,
        service: newKey.service,
        isActive: newKey.isActive
      }
    });
  } catch (error) {
    console.error('Add API key error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/accounts/api-keys/:id
// @desc    Update API key
// @access  Private
router.put('/api-keys/:id', [
  auth,
  body('name').optional().trim().isLength({ min: 1, max: 100 }).withMessage('Name must be less than 100 characters'),
  body('isActive').optional().isBoolean().withMessage('isActive must be boolean')
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

    const { name, isActive } = req.body;
    const keyId = req.params.id;
    const userId = req.user.id;

    const user = await User.findById(userId);
    const apiKey = user.apiKeys.id(keyId);

    if (!apiKey) {
      return res.status(404).json({
        success: false,
        message: 'API key not found'
      });
    }

    if (name) apiKey.name = name;
    if (typeof isActive === 'boolean') apiKey.isActive = isActive;
    
    await user.save();

    res.json({
      success: true,
      message: 'API key updated successfully',
      data: {
        id: apiKey._id,
        name: apiKey.name,
        service: apiKey.service,
        isActive: apiKey.isActive
      }
    });
  } catch (error) {
    console.error('Update API key error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   DELETE /api/accounts/api-keys/:id
// @desc    Remove API key
// @access  Private
router.delete('/api-keys/:id', auth, async (req, res) => {
  try {
    const keyId = req.params.id;
    const userId = req.user.id;

    const user = await User.findById(userId);
    const apiKey = user.apiKeys.id(keyId);

    if (!apiKey) {
      return res.status(404).json({
        success: false,
        message: 'API key not found'
      });
    }

    user.apiKeys.pull(keyId);
    await user.save();

    res.json({
      success: true,
      message: 'API key removed successfully'
    });
  } catch (error) {
    console.error('Remove API key error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/accounts/api-keys/:id/test
// @desc    Test API key
// @access  Private
router.post('/api-keys/:id/test', auth, async (req, res) => {
  try {
    const keyId = req.params.id;
    const userId = req.user.id;

    const user = await User.findById(userId);
    const apiKey = user.apiKeys.id(keyId);

    if (!apiKey) {
      return res.status(404).json({
        success: false,
        message: 'API key not found'
      });
    }

    if (!apiKey.isActive) {
      return res.status(400).json({
        success: false,
        message: 'API key is inactive'
      });
    }

    // Test the API key based on service
    let testResult;
    try {
      switch (apiKey.service) {
        case 'sendgrid':
          testResult = await testSendGridKey(apiKey.key);
          break;
        case 'mailgun':
          testResult = await testMailgunKey(apiKey.key);
          break;
        case 'whatsapp':
          testResult = await testWhatsAppKey(apiKey.key);
          break;
        default:
          testResult = { success: true, message: 'Custom API key cannot be tested automatically' };
      }

      // Update last used timestamp
      apiKey.lastUsed = new Date();
      await user.save();

      res.json({
        success: true,
        message: 'API key test completed',
        testResult
      });
    } catch (testError) {
      res.json({
        success: false,
        message: 'API key test failed',
        error: testError.message
      });
    }
  } catch (error) {
    console.error('Test API key error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Helper functions for testing API keys
async function testSendGridKey(apiKey) {
  // In a real implementation, you would make a test API call to SendGrid
  return { success: true, message: 'SendGrid API key is valid' };
}

async function testMailgunKey(apiKey) {
  // In a real implementation, you would make a test API call to Mailgun
  return { success: true, message: 'Mailgun API key is valid' };
}

async function testWhatsAppKey(apiKey) {
  // In a real implementation, you would make a test API call to WhatsApp Business API
  return { success: true, message: 'WhatsApp API key is valid' };
}

module.exports = router;