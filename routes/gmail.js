const express = require('express');
const { body, validationResult } = require('express-validator');
const { auth } = require('../middleware/auth');
const User = require('../models/User');
const Campaign = require('../models/Campaign');

const router = express.Router();

// @route   POST /api/gmail/connect
// @desc    Connect Gmail account (OAuth flow)
// @access  Private
router.post('/connect', auth, async (req, res) => {
  try {
    const { email, accessToken, refreshToken } = req.body;
    const userId = req.user.id;

    if (!email || !accessToken) {
      return res.status(400).json({
        success: false,
        message: 'Email and access token are required'
      });
    }

    const user = await User.findById(userId);

    // Check if Gmail account already exists
    const existingAccount = user.emailAccounts.find(acc => acc.email === email && acc.type === 'gmail');
    
    if (existingAccount) {
      // Update existing account
      existingAccount.accessToken = accessToken;
      existingAccount.refreshToken = refreshToken;
      existingAccount.isConnected = true;
    } else {
      // Add new Gmail account
      user.emailAccounts.push({
        type: 'gmail',
        email,
        accessToken,
        refreshToken,
        isConnected: true,
        dailyLimit: 500
      });
    }

    await user.save();

    res.json({
      success: true,
      message: 'Gmail account connected successfully',
      data: {
        email,
        type: 'gmail',
        isConnected: true,
        dailyLimit: 500
      }
    });
  } catch (error) {
    console.error('Gmail connect error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/gmail/disconnect
// @desc    Disconnect Gmail account
// @access  Private
router.post('/disconnect', auth, async (req, res) => {
  try {
    const { email } = req.body;
    const userId = req.user.id;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    const user = await User.findById(userId);
    const account = user.emailAccounts.find(acc => acc.email === email && acc.type === 'gmail');

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Gmail account not found'
      });
    }

    account.isConnected = false;
    account.accessToken = undefined;
    account.refreshToken = undefined;

    await user.save();

    res.json({
      success: true,
      message: 'Gmail account disconnected successfully'
    });
  } catch (error) {
    console.error('Gmail disconnect error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/gmail/send
// @desc    Send email via Gmail
// @access  Private
router.post('/send', [
  auth,
  body('fromEmail').isEmail().withMessage('Valid from email is required'),
  body('to').isEmail().withMessage('Valid recipient email is required'),
  body('subject').trim().isLength({ min: 1 }).withMessage('Subject is required'),
  body('message').trim().isLength({ min: 1 }).withMessage('Message is required')
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

    const { fromEmail, to, subject, message } = req.body;
    const userId = req.user.id;

    const user = await User.findById(userId);
    const gmailAccount = user.emailAccounts.find(acc => acc.email === fromEmail && acc.type === 'gmail');

    if (!gmailAccount) {
      return res.status(404).json({
        success: false,
        message: 'Gmail account not found'
      });
    }

    if (!gmailAccount.isConnected) {
      return res.status(400).json({
        success: false,
        message: 'Gmail account is not connected'
      });
    }

    // Check daily limit
    user.resetDailyCount();
    if (!user.canSendEmail(gmailAccount._id)) {
      return res.status(429).json({
        success: false,
        message: 'Daily email limit reached for this account'
      });
    }

    // In a real implementation, you would:
    // 1. Use Gmail API to send the email
    // 2. Handle token refresh if needed
    // 3. Track delivery status

    // For now, simulate sending
    const emailSent = await sendGmailEmail({
      accessToken: gmailAccount.accessToken,
      from: fromEmail,
      to,
      subject,
      message
    });

    if (emailSent.success) {
      // Update sent count
      gmailAccount.sentToday += 1;
      user.usage.emailsSent += 1;
      await user.save();

      res.json({
        success: true,
        message: 'Email sent successfully via Gmail',
        data: {
          messageId: emailSent.messageId,
          from: fromEmail,
          to,
          subject
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Failed to send email',
        error: emailSent.error
      });
    }
  } catch (error) {
    console.error('Gmail send error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/gmail/accounts
// @desc    Get connected Gmail accounts
// @access  Private
router.get('/accounts', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    const gmailAccounts = user.emailAccounts
      .filter(acc => acc.type === 'gmail')
      .map(acc => ({
        id: acc._id,
        email: acc.email,
        isConnected: acc.isConnected,
        dailyLimit: acc.dailyLimit,
        sentToday: acc.sentToday,
        lastReset: acc.lastReset
      }));

    res.json({
      success: true,
      data: gmailAccounts
    });
  } catch (error) {
    console.error('Get Gmail accounts error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/gmail/quota/:email
// @desc    Get Gmail account quota
// @access  Private
router.get('/quota/:email', auth, async (req, res) => {
  try {
    const { email } = req.params;
    const userId = req.user.id;

    const user = await User.findById(userId);
    const gmailAccount = user.emailAccounts.find(acc => acc.email === email && acc.type === 'gmail');

    if (!gmailAccount) {
      return res.status(404).json({
        success: false,
        message: 'Gmail account not found'
      });
    }

    user.resetDailyCount();

    res.json({
      success: true,
      data: {
        email: gmailAccount.email,
        dailyLimit: gmailAccount.dailyLimit,
        sentToday: gmailAccount.sentToday,
        remaining: gmailAccount.dailyLimit - gmailAccount.sentToday,
        lastReset: gmailAccount.lastReset,
        canSend: user.canSendEmail(gmailAccount._id)
      }
    });
  } catch (error) {
    console.error('Get Gmail quota error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Helper function to send email via Gmail API
async function sendGmailEmail({ accessToken, from, to, subject, message }) {
  try {
    // In a real implementation, you would:
    // 1. Use Google APIs client library
    // 2. Create email message in RFC 2822 format
    // 3. Send via Gmail API
    // 4. Handle authentication and token refresh

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Simulate success/failure
    if (Math.random() > 0.1) { // 90% success rate
      return {
        success: true,
        messageId: `gmail_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };
    } else {
      return {
        success: false,
        error: 'Gmail API error: Rate limit exceeded'
      };
    }
  } catch (error) {
    console.error('Send Gmail email error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = router;