const express = require('express');
const { body, validationResult } = require('express-validator');
const { auth } = require('../middleware/auth');
const ContactList = require('../models/ContactList');
const EmailValidation = require('../models/EmailValidation');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');

const router = express.Router();

// Configure multer for CSV uploads
const upload = multer({
  dest: 'uploads/contacts/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  }
});

// @route   GET /api/contacts/lists
// @desc    Get user's contact lists
// @access  Private
router.get('/lists', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    
    const lists = await ContactList.find({
      user: req.user.id,
      isActive: true
    })
    .sort({ updatedAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .select('name description totalContacts validContacts invalidContacts tags createdAt updatedAt');
    
    const total = await ContactList.countDocuments({
      user: req.user.id,
      isActive: true
    });
    
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
      message: 'Server error'
    });
  }
});

// @route   GET /api/contacts/lists/:id
// @desc    Get contact list with contacts
// @access  Private
router.get('/lists/:id', auth, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    
    const list = await ContactList.findOne({
      _id: req.params.id,
      user: req.user.id
    });
    
    if (!list) {
      return res.status(404).json({
        success: false,
        message: 'Contact list not found'
      });
    }
    
    // Paginate contacts
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedContacts = list.contacts.slice(startIndex, endIndex);
    
    res.json({
      success: true,
      data: {
        ...list.toObject(),
        contacts: paginatedContacts
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: list.contacts.length,
        pages: Math.ceil(list.contacts.length / limit)
      }
    });
  } catch (error) {
    console.error('Get contact list error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/contacts/lists
// @desc    Create new contact list
// @access  Private
router.post('/lists', [
  auth,
  body('name').trim().isLength({ min: 1, max: 100 }).withMessage('List name is required'),
  body('description').optional().trim().isLength({ max: 500 })
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

    const { name, description, tags } = req.body;

    const contactList = new ContactList({
      user: req.user.id,
      name,
      description,
      tags: tags || []
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
      message: 'Server error'
    });
  }
});

// @route   POST /api/contacts/lists/:id/contacts
// @desc    Add contacts to list
// @access  Private
router.post('/lists/:id/contacts', [
  auth,
  body('contacts').isArray({ min: 1 }).withMessage('At least one contact is required'),
  body('contacts.*.email').isEmail().withMessage('Valid email is required for each contact')
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

    const list = await ContactList.findOne({
      _id: req.params.id,
      user: req.user.id
    });

    if (!list) {
      return res.status(404).json({
        success: false,
        message: 'Contact list not found'
      });
    }

    const { contacts } = req.body;
    const newContacts = [];
    const duplicates = [];

    for (const contact of contacts) {
      const email = contact.email.toLowerCase();
      
      // Check for duplicates in existing list
      const existingContact = list.contacts.find(c => c.email === email);
      if (existingContact) {
        duplicates.push(email);
        continue;
      }

      newContacts.push({
        email,
        firstName: contact.firstName || '',
        lastName: contact.lastName || '',
        company: contact.company || '',
        phone: contact.phone || '',
        tags: contact.tags || [],
        customFields: contact.customFields || {},
        source: 'manual'
      });
    }

    // Add new contacts to list
    list.contacts.push(...newContacts);
    await list.save();

    res.json({
      success: true,
      message: `${newContacts.length} contacts added successfully`,
      data: {
        added: newContacts.length,
        duplicates: duplicates.length,
        duplicateEmails: duplicates
      }
    });
  } catch (error) {
    console.error('Add contacts error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/contacts/lists/:id/import
// @desc    Import contacts from CSV
// @access  Private
router.post('/lists/:id/import', [auth, upload.single('csvFile')], async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'CSV file is required'
      });
    }

    const list = await ContactList.findOne({
      _id: req.params.id,
      user: req.user.id
    });

    if (!list) {
      return res.status(404).json({
        success: false,
        message: 'Contact list not found'
      });
    }

    const contacts = [];
    const errors = [];
    let lineNumber = 0;

    // Parse CSV file
    await new Promise((resolve, reject) => {
      fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (row) => {
          lineNumber++;
          
          // Validate email
          const email = row.email || row.Email || row.EMAIL;
          if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            errors.push(`Line ${lineNumber}: Invalid or missing email`);
            return;
          }

          contacts.push({
            email: email.toLowerCase(),
            firstName: row.firstName || row.first_name || row['First Name'] || '',
            lastName: row.lastName || row.last_name || row['Last Name'] || '',
            company: row.company || row.Company || '',
            phone: row.phone || row.Phone || '',
            tags: [],
            customFields: {},
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

    // Check for duplicates and add contacts
    const newContacts = [];
    const duplicates = [];

    for (const contact of contacts) {
      const existingContact = list.contacts.find(c => c.email === contact.email);
      if (existingContact) {
        duplicates.push(contact.email);
        continue;
      }
      newContacts.push(contact);
    }

    // Add new contacts to list
    list.contacts.push(...newContacts);
    await list.save();

    res.json({
      success: true,
      message: `${newContacts.length} contacts imported successfully`,
      data: {
        imported: newContacts.length,
        duplicates: duplicates.length,
        errors: errors.length,
        details: {
          duplicateEmails: duplicates,
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

// @route   POST /api/contacts/lists/:id/validate
// @desc    Validate emails in contact list
// @access  Private
router.post('/lists/:id/validate', auth, async (req, res) => {
  try {
    const list = await ContactList.findOne({
      _id: req.params.id,
      user: req.user.id
    });

    if (!list) {
      return res.status(404).json({
        success: false,
        message: 'Contact list not found'
      });
    }

    const { validateAll = false } = req.body;
    let contactsToValidate = list.contacts;

    // If not validating all, only validate unvalidated contacts
    if (!validateAll) {
      contactsToValidate = list.contacts.filter(c => !c.isValidated);
    }

    if (contactsToValidate.length === 0) {
      return res.json({
        success: true,
        message: 'All contacts are already validated',
        data: { validated: 0, total: list.contacts.length }
      });
    }

    // Process validation in batches
    const batchSize = 10;
    let validatedCount = 0;

    for (let i = 0; i < contactsToValidate.length; i += batchSize) {
      const batch = contactsToValidate.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (contact) => {
        try {
          // Check if validation already exists
          let validation = await EmailValidation.findOne({
            user: req.user.id,
            email: contact.email,
            validatedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // 24 hours
          });

          if (!validation) {
            // Perform validation (simplified version)
            const validationResult = await validateEmail(contact.email);
            
            validation = new EmailValidation({
              user: req.user.id,
              email: contact.email,
              status: validationResult.status,
              score: validationResult.score,
              reason: validationResult.reason,
              details: validationResult.details
            });
            
            await validation.save();
          }

          // Update contact with validation results
          contact.isValidated = true;
          contact.validationStatus = validation.status;
          contact.validationScore = validation.score;
          
          validatedCount++;
        } catch (error) {
          console.error(`Validation error for ${contact.email}:`, error);
          contact.validationStatus = 'unknown';
          contact.validationScore = 0;
        }
      });

      await Promise.all(batchPromises);
      
      // Add delay between batches
      if (i + batchSize < contactsToValidate.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    await list.save();

    res.json({
      success: true,
      message: `${validatedCount} contacts validated successfully`,
      data: {
        validated: validatedCount,
        total: list.contacts.length,
        valid: list.contacts.filter(c => c.validationStatus === 'valid').length,
        invalid: list.contacts.filter(c => c.validationStatus === 'invalid').length,
        risky: list.contacts.filter(c => c.validationStatus === 'risky').length
      }
    });
  } catch (error) {
    console.error('Validate contacts error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during validation'
    });
  }
});

// @route   DELETE /api/contacts/lists/:id
// @desc    Delete contact list
// @access  Private
router.delete('/lists/:id', auth, async (req, res) => {
  try {
    const list = await ContactList.findOne({
      _id: req.params.id,
      user: req.user.id
    });

    if (!list) {
      return res.status(404).json({
        success: false,
        message: 'Contact list not found'
      });
    }

    await ContactList.findByIdAndDelete(req.params.id);

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

// Helper function for email validation
async function validateEmail(email) {
  try {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        status: 'invalid',
        score: 0,
        reason: 'Invalid email format',
        details: { syntax: false, domain: false, mx: false, disposable: false, role: false, free: false, deliverable: false }
      };
    }

    const [localPart, domain] = email.split('@');
    
    // Check for disposable domains
    const disposableDomains = ['10minutemail.com', 'tempmail.org', 'guerrillamail.com', 'mailinator.com'];
    const isDisposable = disposableDomains.includes(domain.toLowerCase());

    // Check for role-based emails
    const roleKeywords = ['admin', 'support', 'info', 'contact', 'sales', 'marketing', 'noreply'];
    const isRole = roleKeywords.some(keyword => localPart.toLowerCase().includes(keyword));

    // Check for free providers
    const freeProviders = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'];
    const isFree = freeProviders.includes(domain.toLowerCase());

    let score = 50;
    if (!isDisposable) score += 20;
    if (!isRole) score += 15;
    if (domain.includes('.')) score += 15;

    let status;
    if (isDisposable) {
      status = 'risky';
      score = Math.min(score, 60);
    } else if (score >= 80) {
      status = 'valid';
    } else if (score >= 50) {
      status = 'risky';
    } else {
      status = 'invalid';
    }

    return {
      status,
      score,
      reason: status === 'valid' ? 'Deliverable' : status === 'risky' ? (isDisposable ? 'Disposable email' : 'Risky domain') : 'Invalid or non-existent',
      details: {
        syntax: true,
        domain: true,
        mx: !isDisposable,
        disposable: isDisposable,
        role: isRole,
        free: isFree,
        deliverable: status === 'valid'
      }
    };
  } catch (error) {
    return {
      status: 'unknown',
      score: 0,
      reason: 'Validation failed',
      details: { syntax: false, domain: false, mx: false, disposable: false, role: false, free: false, deliverable: false }
    };
  }
}

module.exports = router;