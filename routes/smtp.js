const express = require('express');
const { body, validationResult } = require('express-validator');
const { auth } = require('../middleware/auth');
const SMTPConfig = require('../models/SMTPConfig');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const router = express.Router();

// Encryption functions for storing SMTP passwords
const algorithm = 'aes-256-cbc';
const secretKey = process.env.ENCRYPTION_KEY || crypto.randomBytes(32);

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipher(algorithm, secretKey);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
  const textParts = text.split(':');
  const iv = Buffer.from(textParts.shift(), 'hex');
  const encryptedText = textParts.join(':');
  const decipher = crypto.createDecipher(algorithm, secretKey);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// @route   GET /api/smtp/configs
// @desc    Get user's SMTP configurations
// @access  Private
router.get('/configs', auth, async (req, res) => {
  try {
    const configs = await SMTPConfig.find({ 
      user: req.user.id,
      isActive: true 
    }).select('-password');

    res.json({
      success: true,
      data: configs
    });
  } catch (error) {
    console.error('Get SMTP configs error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/smtp/configs
// @desc    Add new SMTP configuration
// @access  Private
router.post('/configs', [
  auth,
  body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Name is required'),
  body('host').trim().isLength({ min: 1 }).withMessage('SMTP host is required'),
  body('port').isInt({ min: 1, max: 65535 }).withMessage('Valid port number is required'),
  body('username').trim().isLength({ min: 1 }).withMessage('Username is required'),
  body('password').isLength({ min: 1 }).withMessage('Password is required'),
  body('fromName').trim().isLength({ min: 1 }).withMessage('From name is required'),
  body('fromEmail').isEmail().withMessage('Valid from email is required')
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

    const { name, host, port, secure, username, password, fromName, fromEmail } = req.body;

    // Encrypt password before storing
    const encryptedPassword = encrypt(password);

    const smtpConfig = new SMTPConfig({
      user: req.user.id,
      name,
      host,
      port: parseInt(port),
      secure: secure || false,
      username,
      password: encryptedPassword,
      fromName,
      fromEmail
    });

    await smtpConfig.save();

    // Return config without password
    const configResponse = smtpConfig.toObject();
    delete configResponse.password;

    res.status(201).json({
      success: true,
      message: 'SMTP configuration added successfully',
      data: configResponse
    });
  } catch (error) {
    console.error('Add SMTP config error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/smtp/test/:id
// @desc    Test SMTP configuration
// @access  Private
router.post('/test/:id', auth, async (req, res) => {
  try {
    const config = await SMTPConfig.findOne({
      _id: req.params.id,
      user: req.user.id
    });

    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'SMTP configuration not found'
      });
    }

    // Decrypt password for testing
    const decryptedPassword = decrypt(config.password);

    // Create transporter
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.username,
        pass: decryptedPassword
      }
    });

    // Test connection
    await transporter.verify();

    // Send test email
    const testEmail = {
      from: `${config.fromName} <${config.fromEmail}>`,
      to: config.fromEmail,
      subject: 'SMTP Configuration Test - MarketingHub',
      html: `
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
          <h2 style="color: #3B82F6;">SMTP Test Successful!</h2>
          <p>Your SMTP configuration is working correctly.</p>
          <p><strong>Configuration:</strong> ${config.name}</p>
          <p><strong>Host:</strong> ${config.host}:${config.port}</p>
          <p><strong>From:</strong> ${config.fromName} &lt;${config.fromEmail}&gt;</p>
          <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
          <p style="color: #666; font-size: 12px;">This is a test email from MarketingHub</p>
        </div>
      `
    };

    await transporter.sendMail(testEmail);

    // Update config as verified
    config.isVerified = true;
    config.lastTested = new Date();
    await config.save();

    res.json({
      success: true,
      message: 'SMTP configuration tested successfully. Test email sent!'
    });
  } catch (error) {
    console.error('Test SMTP config error:', error);
    res.status(400).json({
      success: false,
      message: `SMTP test failed: ${error.message}`
    });
  }
});

// @route   PUT /api/smtp/configs/:id
// @desc    Update SMTP configuration
// @access  Private
router.put('/configs/:id', [
  auth,
  body('name').optional().trim().isLength({ min: 1, max: 100 }),
  body('host').optional().trim().isLength({ min: 1 }),
  body('port').optional().isInt({ min: 1, max: 65535 }),
  body('username').optional().trim().isLength({ min: 1 }),
  body('password').optional().isLength({ min: 1 }),
  body('fromName').optional().trim().isLength({ min: 1 }),
  body('fromEmail').optional().isEmail()
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

    const config = await SMTPConfig.findOne({
      _id: req.params.id,
      user: req.user.id
    });

    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'SMTP configuration not found'
      });
    }

    const updateData = { ...req.body };
    
    // Encrypt password if provided
    if (updateData.password) {
      updateData.password = encrypt(updateData.password);
      updateData.isVerified = false; // Reset verification status
    }

    Object.assign(config, updateData);
    await config.save();

    // Return config without password
    const configResponse = config.toObject();
    delete configResponse.password;

    res.json({
      success: true,
      message: 'SMTP configuration updated successfully',
      data: configResponse
    });
  } catch (error) {
    console.error('Update SMTP config error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   DELETE /api/smtp/configs/:id
// @desc    Delete SMTP configuration
// @access  Private
router.delete('/configs/:id', auth, async (req, res) => {
  try {
    const config = await SMTPConfig.findOne({
      _id: req.params.id,
      user: req.user.id
    });

    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'SMTP configuration not found'
      });
    }

    await SMTPConfig.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'SMTP configuration deleted successfully'
    });
  } catch (error) {
    console.error('Delete SMTP config error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;