const express = require('express');
const { body, validationResult } = require('express-validator');
const { auth } = require('../middleware/auth');
const SMTPConfig = require('../models/SMTPConfig');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const router = express.Router();

// Encryption functions for storing SMTP passwords
const algorithm = 'aes-256-cbc';
const secretKey = Buffer.from(process.env.ENCRYPTION_KEY, 'hex'); // exactly 32 bytes

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, secretKey, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
  const [ivHex, encryptedText] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(algorithm, secretKey, iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// SMTP verification helper
async function verifySMTPConfig(config) {
  try {
    const decryptedPassword = decrypt(config.password);

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.username,
        pass: decryptedPassword,
      },
      // Optional TLS settings:
      // tls: { rejectUnauthorized: false }
    });

    await transporter.verify(); // throws if fails

    return { success: true, message: 'SMTP verified successfully' };
  } catch (error) {
    return { success: false, message: error.message || 'SMTP verification failed' };
  }
}

// @route   GET /api/smtp/configs
// @desc    Get user's SMTP configurations
// @access  Private
router.get('/configs', auth, async (req, res) => {
  try {
    const configs = await SMTPConfig.find({
      user: req.user.id,
      isActive: true,
    }).select('-password');

    res.json({
      success: true,
      data: configs,
    });
  } catch (error) {
    console.error('Get SMTP configs error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

// @route   POST /api/smtp/configs
// @desc    Add new SMTP configuration with verification
// @access  Private
router.post(
  '/configs',
  [
    auth,
    body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Name is required'),
    body('host').trim().isLength({ min: 1 }).withMessage('SMTP host is required'),
    body('port').isInt({ min: 1, max: 65535 }).withMessage('Valid port number is required'),
    body('username').trim().isLength({ min: 1 }).withMessage('Username is required'),
    body('password').isLength({ min: 1 }).withMessage('Password is required'),
    body('fromName').trim().isLength({ min: 1 }).withMessage('From name is required'),
    body('fromEmail').isEmail().withMessage('Valid from email is required'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
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
        fromEmail,
        isVerified: false, // initially false
      });

      await smtpConfig.save();

      // Verify SMTP config after save
      const verificationResult = await verifySMTPConfig(smtpConfig);

      // Update verification status based on result
      smtpConfig.isVerified = verificationResult.success;
      await smtpConfig.save();

      // Prepare response data without password
      const configResponse = smtpConfig.toObject();
      delete configResponse.password;

      if (!verificationResult.success) {
        return res.status(400).json({
          success: false,
          message:
            'SMTP configuration saved but verification failed. Please check your credentials or server settings.',
          error: verificationResult.message,
          data: configResponse,
        });
      }

      // Success response
      res.status(201).json({
        success: true,
        message: 'SMTP configuration added and verified successfully',
        data: configResponse,
      });
    } catch (error) {
      console.error('Add SMTP config error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error',
      });
    }
  }
);

// @route   PUT /api/smtp/configs/:id
// @desc    Update SMTP configuration with verification
// @access  Private
router.put(
  '/configs/:id',
  [
    auth,
    body('name').optional().trim().isLength({ min: 1, max: 100 }),
    body('host').optional().trim().isLength({ min: 1 }),
    body('port').optional().isInt({ min: 1, max: 65535 }),
    body('username').optional().trim().isLength({ min: 1 }),
    body('password').optional().isLength({ min: 1 }),
    body('fromName').optional().trim().isLength({ min: 1 }),
    body('fromEmail').optional().isEmail(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const config = await SMTPConfig.findOne({
        _id: req.params.id,
        user: req.user.id,
      });

      if (!config) {
        return res.status(404).json({
          success: false,
          message: 'SMTP configuration not found',
        });
      }

      const updateData = { ...req.body };

      // Encrypt password if provided and reset verification status
      if (updateData.password) {
        updateData.password = encrypt(updateData.password);
        updateData.isVerified = false;
      }

      Object.assign(config, updateData);
      await config.save();

      // Verify SMTP config after update
      const verificationResult = await verifySMTPConfig(config);

      // Update verification status based on result
      config.isVerified = verificationResult.success;
      await config.save();

      // Prepare response data without password
      const configResponse = config.toObject();
      delete configResponse.password;

      if (!verificationResult.success) {
        return res.status(400).json({
          success: false,
          message:
            'SMTP configuration updated but verification failed. Please check your credentials or server settings.',
          error: verificationResult.message,
          data: configResponse,
        });
      }

      // Success response
      res.json({
        success: true,
        message: 'SMTP configuration updated and verified successfully',
        data: configResponse,
      });
    } catch (error) {
      console.error('Update SMTP config error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error',
      });
    }
  }
);

// @route   DELETE /api/smtp/configs/:id
// @desc    Delete SMTP configuration
// @access  Private
router.delete('/configs/:id', auth, async (req, res) => {
  try {
    const config = await SMTPConfig.findOne({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'SMTP configuration not found',
      });
    }

    await SMTPConfig.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'SMTP configuration deleted successfully',
    });
  } catch (error) {
    console.error('Delete SMTP config error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

module.exports = router;
