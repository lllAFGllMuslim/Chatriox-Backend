const express = require('express');
const { body, validationResult } = require('express-validator');
const { auth } = require('../middleware/auth');
const Template = require('../models/Template');
const multer = require('multer');
const path = require('path');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/templates/');
  },
  filename: (req, file, cb) => {
    cb(null, `template-${Date.now()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/html' || file.mimetype === 'text/plain') {
      cb(null, true);
    } else {
      cb(new Error('Only HTML and text files are allowed'));
    }
  }
});

// System templates data
const systemTemplates = [
  {
    _id: 'system_welcome',
    name: 'Welcome Email',
    subject: 'Welcome to {{company_name}}!',
    category: 'welcome',
    type: 'system',
    thumbnail: '/templates/welcome-thumb.jpg',
    content: `
      <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to {{company_name}}!</h1>
        </div>
        <div style="padding: 40px 20px; background: #f8f9fa;">
          <h2 style="color: #333; margin-bottom: 20px;">Hi {{first_name}},</h2>
          <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
            Thank you for joining {{company_name}}! We're excited to have you on board.
          </p>
          <p style="color: #666; line-height: 1.6; margin-bottom: 30px;">
            Here's what you can expect from us:
          </p>
          <ul style="color: #666; line-height: 1.8; margin-bottom: 30px;">
            <li>Regular updates about our products and services</li>
            <li>Exclusive offers and discounts</li>
            <li>Helpful tips and resources</li>
          </ul>
          <div style="text-align: center;">
            <a href="{{dashboard_url}}" style="background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Get Started
            </a>
          </div>
        </div>
        <div style="padding: 20px; text-align: center; color: #999; font-size: 12px;">
          <p>© {{year}} {{company_name}}. All rights reserved.</p>
        </div>
      </div>
    `
  },
  {
    _id: 'system_newsletter',
    name: 'Newsletter Template',
    subject: '{{company_name}} Newsletter - {{month}} {{year}}',
    category: 'newsletter',
    type: 'system',
    thumbnail: '/templates/newsletter-thumb.jpg',
    content: `
      <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
        <div style="background: #2c3e50; padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">{{company_name}} Newsletter</h1>
          <p style="color: #bdc3c7; margin: 10px 0 0 0;">{{month}} {{year}} Edition</p>
        </div>
        <div style="padding: 30px 20px; background: white;">
          <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">What's New</h2>
          <p style="color: #666; line-height: 1.6; margin-bottom: 25px;">
            {{newsletter_content}}
          </p>
          
          <h3 style="color: #2c3e50; margin-top: 30px;">Featured Article</h3>
          <p style="color: #666; line-height: 1.6;">
            {{featured_article}}
          </p>
          
          <div style="background: #ecf0f1; padding: 20px; margin: 30px 0; border-radius: 5px;">
            <h3 style="color: #2c3e50; margin-top: 0;">Quick Links</h3>
            <ul style="color: #666; line-height: 1.8;">
              <li><a href="{{website_url}}" style="color: #3498db;">Visit Our Website</a></li>
              <li><a href="{{blog_url}}" style="color: #3498db;">Read Our Blog</a></li>
              <li><a href="{{contact_url}}" style="color: #3498db;">Contact Us</a></li>
            </ul>
          </div>
        </div>
        <div style="padding: 20px; text-align: center; background: #34495e; color: white;">
          <p style="margin: 0;">Follow us on social media</p>
          <div style="margin-top: 15px;">
            <a href="{{facebook_url}}" style="color: white; margin: 0 10px;">Facebook</a>
            <a href="{{twitter_url}}" style="color: white; margin: 0 10px;">Twitter</a>
            <a href="{{linkedin_url}}" style="color: white; margin: 0 10px;">LinkedIn</a>
          </div>
        </div>
      </div>
    `
  },
  {
    _id: 'system_promotional',
    name: 'Promotional Email',
    subject: 'Special Offer: {{discount}}% Off Everything!',
    category: 'promotional',
    type: 'system',
    thumbnail: '/templates/promo-thumb.jpg',
    content: `
      <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
        <div style="background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%); padding: 40px 20px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 32px;">{{discount}}% OFF</h1>
          <p style="color: white; margin: 10px 0 0 0; font-size: 18px;">Everything Must Go!</p>
        </div>
        <div style="padding: 40px 20px; background: white; text-align: center;">
          <h2 style="color: #333; margin-bottom: 20px;">Limited Time Offer</h2>
          <p style="color: #666; line-height: 1.6; margin-bottom: 30px; font-size: 16px;">
            Don't miss out on this incredible deal! Get {{discount}}% off all products for a limited time only.
          </p>
          <div style="background: #fff5f5; border: 2px dashed #ff6b6b; padding: 20px; margin: 30px 0; border-radius: 10px;">
            <h3 style="color: #ff6b6b; margin: 0 0 10px 0;">Promo Code</h3>
            <div style="background: #ff6b6b; color: white; padding: 15px; font-size: 24px; font-weight: bold; letter-spacing: 2px; border-radius: 5px;">
              {{promo_code}}
            </div>
          </div>
          <p style="color: #999; font-size: 14px; margin-bottom: 30px;">
            Offer expires on {{expiry_date}}
          </p>
          <a href="{{shop_url}}" style="background: #ff6b6b; color: white; padding: 18px 40px; text-decoration: none; border-radius: 50px; display: inline-block; font-size: 18px; font-weight: bold;">
            Shop Now
          </a>
        </div>
        <div style="padding: 20px; text-align: center; color: #999; font-size: 12px; background: #f8f9fa;">
          <p>This offer cannot be combined with other promotions.</p>
          <p>© {{year}} {{company_name}}. All rights reserved.</p>
        </div>
      </div>
    `
  }
];

// @route   GET /api/templates
// @desc    Get user's templates and system templates
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const { category, type } = req.query;
    
    // Build query for user templates
    const query = { user: req.user.id, isActive: true };
    if (category) query.category = category;
    
    // Get user templates
    const userTemplates = await Template.find(query).sort({ updatedAt: -1 });
    
    // Filter system templates if needed
    let filteredSystemTemplates = systemTemplates;
    if (category) {
      filteredSystemTemplates = systemTemplates.filter(t => t.category === category);
    }
    if (type === 'custom') {
      filteredSystemTemplates = [];
    } else if (type === 'system') {
      return res.json({
        success: true,
        data: filteredSystemTemplates
      });
    }
    
    // Combine user and system templates
    const allTemplates = [...userTemplates, ...filteredSystemTemplates];
    
    res.json({
      success: true,
      data: allTemplates
    });
  } catch (error) {
    console.error('Get templates error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/templates/:id
// @desc    Get template by ID
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const templateId = req.params.id;
    
    // Check if it's a system template
    if (templateId.startsWith('system_')) {
      const systemTemplate = systemTemplates.find(t => t._id === templateId);
      if (!systemTemplate) {
        return res.status(404).json({
          success: false,
          message: 'Template not found'
        });
      }
      return res.json({
        success: true,
        data: systemTemplate
      });
    }
    
    // Get user template
    const template = await Template.findOne({
      _id: templateId,
      user: req.user.id
    });
    
    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found'
      });
    }
    
    res.json({
      success: true,
      data: template
    });
  } catch (error) {
    console.error('Get template error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/templates
// @desc    Create new template
// @access  Private
router.post('/', [
  auth,
  body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Template name is required'),
  body('subject').trim().isLength({ min: 1 }).withMessage('Subject is required'),
  body('content').trim().isLength({ min: 1 }).withMessage('Content is required'),
  body('category').optional().isIn(['newsletter', 'promotional', 'transactional', 'welcome', 'follow-up', 'other'])
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

    const { name, subject, content, category } = req.body;

    const template = new Template({
      user: req.user.id,
      name,
      subject,
      content,
      category: category || 'other',
      type: 'custom'
    });

    await template.save();

    res.status(201).json({
      success: true,
      message: 'Template created successfully',
      data: template
    });
  } catch (error) {
    console.error('Create template error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/templates/upload
// @desc    Upload template file
// @access  Private
router.post('/upload', [auth, upload.single('template')], async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const fs = require('fs');
    const content = fs.readFileSync(req.file.path, 'utf8');
    
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    const { name, subject, category } = req.body;

    const template = new Template({
      user: req.user.id,
      name: name || req.file.originalname,
      subject: subject || 'Imported Template',
      content,
      category: category || 'other',
      type: 'custom'
    });

    await template.save();

    res.status(201).json({
      success: true,
      message: 'Template uploaded successfully',
      data: template
    });
  } catch (error) {
    console.error('Upload template error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/templates/:id
// @desc    Update template
// @access  Private
router.put('/:id', [
  auth,
  body('name').optional().trim().isLength({ min: 1, max: 100 }),
  body('subject').optional().trim().isLength({ min: 1 }),
  body('content').optional().trim().isLength({ min: 1 }),
  body('category').optional().isIn(['newsletter', 'promotional', 'transactional', 'welcome', 'follow-up', 'other'])
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

    const template = await Template.findOne({
      _id: req.params.id,
      user: req.user.id
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found'
      });
    }

    Object.assign(template, req.body);
    await template.save();

    res.json({
      success: true,
      message: 'Template updated successfully',
      data: template
    });
  } catch (error) {
    console.error('Update template error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   DELETE /api/templates/:id
// @desc    Delete template
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const template = await Template.findOne({
      _id: req.params.id,
      user: req.user.id
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found'
      });
    }

    await Template.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Template deleted successfully'
    });
  } catch (error) {
    console.error('Delete template error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/templates/download/:id
// @desc    Download template
// @access  Private
router.get('/download/:id', auth, async (req, res) => {
  try {
    const templateId = req.params.id;
    let template;
    
    // Check if it's a system template
    if (templateId.startsWith('system_')) {
      template = systemTemplates.find(t => t._id === templateId);
    } else {
      template = await Template.findOne({
        _id: templateId,
        user: req.user.id
      });
    }
    
    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found'
      });
    }
    
    // Set headers for file download
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `attachment; filename="${template.name}.html"`);
    res.send(template.content);
  } catch (error) {
    console.error('Download template error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;
module.exports.systemTemplates = systemTemplates;
