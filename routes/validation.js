const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const EmailValidator = require('../services/EmailValidator'); 
const ValidationResult = require('../models/Validation');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  }
});

// Initialize email validator with balanced speed/accuracy settings
const validator = new EmailValidator({
  verbose: false, // Reduce logging overhead
  timeout: 4000,  // Reduced from 10000ms but keep reasonable for SMTP
  retryAttempts: 1, // Reduced from 2 to 1
  skipSMTPValidation: false, // Keep SMTP for accuracy
  treatGreylistingAsValid: true,
  smtpTimeout: 3000, // Specific SMTP timeout
  concurrent: true, // Enable concurrent processing if supported
  dns: {
    timeout: 2000, // Faster DNS lookups
    retries: 1
  }
});

// Optimized analysis function with proper SMTP handling
function analyzeValidationResult(result) {
  // Quick validation checks - order matters for performance
  if (!result.checks.syntax.passed) {
    return { status: 'invalid', reason: 'Invalid syntax', score: 10 };
  }
  
  if (!result.checks.domain.passed) {
    return { status: 'invalid', reason: 'Domain not found', score: 15 };
  }
  
  if (!result.checks.mx.passed) {
    return { status: 'invalid', reason: 'No MX records', score: 20 };
  }

  // SMTP check is critical for accuracy
  if (!result.checks.smtp.passed && !result.checks.smtp.skipped) {
    if (result.checks.smtp.message && 
        (result.checks.smtp.message.toLowerCase().includes('greylisting') ||
         result.checks.smtp.message.toLowerCase().includes('temporary') ||
         result.checks.smtp.message.toLowerCase().includes('try again'))) {
      return { status: 'risky', reason: 'Temporary failure', score: 60 };
    } else {
      return { status: 'invalid', reason: 'Mailbox not found', score: 25 };
    }
  }

  // Check other risk factors
  if (!result.checks.disposable.passed) {
    return { status: 'risky', reason: 'Disposable email', score: 40 };
  }
  
  if (!result.checks.roleBased.passed) {
    return { status: 'risky', reason: 'Role-based email', score: 70 };
  }

  // All checks passed - email is valid
  return { status: 'valid', reason: 'Deliverable', score: 100 };
}

// Batch database operations for better performance
async function saveBulkValidations(validations) {
  try {
    if (validations.length === 0) return;
    
    // Use insertMany for better performance
    await ValidationResult.insertMany(validations, { 
      ordered: false, // Continue on individual errors
      writeConcern: { w: 1, j: false } // Faster write concern
    });
  } catch (error) {
    console.error('Bulk save error:', error);
    // Individual saves as fallback
    for (const validation of validations) {
      try {
        await new ValidationResult(validation).save();
      } catch (saveError) {
        console.error('Individual save error:', saveError);
      }
    }
  }
}

// Single email validation endpoint
router.post('/single', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ 
        success: false,
        error: 'Valid email address is required' 
      });
    }

    const trimmedEmail = email.trim().toLowerCase();

    console.log(`Validating single email: ${trimmedEmail}`);
    const startTime = Date.now();
    const result = await validator.validateEmail(trimmedEmail);
    
    // Analyze the result
    const { status, reason, score } = analyzeValidationResult(result);

    const responseData = {
      ...result,
      status,
      reason,
      score,
      isValid: status === 'valid',
      executionTime: Date.now() - startTime
    };

    // Save to database asynchronously (don't wait)
    setImmediate(async () => {
      try {
        const validationRecord = new ValidationResult({
          userId: req.ip,
          email: result.email,
          status,
          reason,
          score,
          isValid: status === 'valid',
          checks: {
            ...result.checks,
            mx: {
              passed: result.checks.mx.passed,
              message: result.checks.mx.message,
              records: result.checks.mx.records  
            }
          },
          executionTime: responseData.executionTime,
          ipAddress: req.ip
        });
        await validationRecord.save();
      } catch (error) {
        console.error('Async save error:', error);
      }
    });

    // Return immediately
    res.json({
      success: true,
      data: responseData
    });

  } catch (error) {
    console.error('Single validation error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Validation failed', 
      message: error.message 
    });
  }
});

// Optimized bulk email validation endpoint
router.post('/bulk', upload.single('file'), async (req, res) => {
  let filePath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        error: 'CSV file is required' 
      });
    }

    filePath = req.file.path;
    const emails = [];
    
    console.log(`Processing bulk validation for file: ${req.file.originalname}`);
    
    // Parse CSV file
    const parsePromise = new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          const email = row.email || row.Email || row.EMAIL || 
                       row['Email Address'] || row['email_address'] ||
                       Object.values(row)[0];
          
          if (email && typeof email === 'string' && email.includes('@')) {
            emails.push(email.trim().toLowerCase());
          }
        })
        .on('end', () => {
          resolve(emails);
        })
        .on('error', (error) => {
          reject(error);
        });
    });

    const parsedEmails = await parsePromise;
    
    // Remove duplicates for efficiency
    const uniqueEmails = [...new Set(parsedEmails)];
    
    if (uniqueEmails.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid email addresses found in the CSV file'
      });
    }

    if (uniqueEmails.length > 10000) {
      return res.status(400).json({
        success: false,
        error: 'Too many emails. Maximum 10,000 emails per file.'
      });
    }

    console.log(`Found ${uniqueEmails.length} unique emails to validate`);
    
    // Set headers for streaming response
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Credentials': 'true'
    });

    // Process in smaller batches
    const BATCH_SIZE = 20;
    
    for (let i = 0; i < uniqueEmails.length; i += BATCH_SIZE) {
      const batch = uniqueEmails.slice(i, i + BATCH_SIZE);
      
      // Process batch concurrently
      const batchPromises = batch.map(async (email, batchIndex) => {
        const globalIndex = i + batchIndex;
        
        try {
          console.log(`Validating bulk email: ${email}`);
          const startTime = Date.now();
          const result = await validator.validateEmail(email);
          
          // Analyze the result
          const { status, reason, score } = analyzeValidationResult(result);

          const responseData = {
            ...result,
            status,
            reason,
            score,
            isValid: status === 'valid',
            executionTime: Date.now() - startTime
          };

          // Save to database asynchronously (SAME AS SINGLE) - don't wait
          setImmediate(async () => {
            try {
              const validationRecord = new ValidationResult({
                userId: req.ip,
                email: result.email,
                status,
                reason,
                score,
                isValid: status === 'valid',
                checks: {
                  ...result.checks,
                  mx: {
                    passed: result.checks.mx.passed,
                    message: result.checks.mx.message,
                    records: result.checks.mx.records  
                  }
                },
                executionTime: responseData.executionTime,
                ipAddress: req.ip
              });
              await validationRecord.save();
            } catch (error) {
              console.error(`Async save error for ${email}:`, error);
            }
          });

          return { 
            email, 
            result: responseData, 
            cached: false, 
            index: globalIndex 
          };
          
        } catch (error) {
          console.error(`Error validating ${email}:`, error);
          return { 
            email, 
            result: null, 
            error: error.message, 
            index: globalIndex 
          };
        }
      });

      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);
      
      // Send results
      for (const { email, result, cached, error, index } of batchResults) {
        if (result) {
          res.write(JSON.stringify({ 
            type: 'result', 
            result: { ...result, cached } 
          }) + '\n');
        } else if (error) {
          res.write(JSON.stringify({ 
            type: 'error', 
            email,
            error 
          }) + '\n');
        }
        
        const progress = Math.round(((index + 1) / uniqueEmails.length) * 100);
        res.write(JSON.stringify({ type: 'progress', progress }) + '\n');
      }
      
      // Small delay between batches to prevent overwhelming
      if (i + BATCH_SIZE < uniqueEmails.length) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    
    res.end();
    
  } catch (error) {
    console.error('Bulk validation error:', error);
    
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false,
        error: 'Bulk validation failed', 
        message: error.message 
      });
    }
  } finally {
    // Clean up uploaded file
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log('Cleaned up uploaded file');
      } catch (cleanupError) {
        console.error('Error cleaning up file:', cleanupError);
      }
    }
  }
});

// Get validation statistics (optimized query)
router.get('/stats', async (req, res) => {
  try {
    const userId = req.ip;
    
    const stats = await ValidationResult.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          totalValidations: { $sum: 1 },
          validEmails: { $sum: { $cond: [{ $eq: ['$status', 'valid'] }, 1, 0] }},
          invalidEmails: { $sum: { $cond: [{ $eq: ['$status', 'invalid'] }, 1, 0] }},
          riskyEmails: { $sum: { $cond: [{ $eq: ['$status', 'risky'] }, 1, 0] }},
          unknownEmails: { $sum: { $cond: [{ $eq: ['$status', 'unknown'] }, 1, 0] }},
          lastValidation: { $max: '$createdAt' }
        }
      }
    ]);

    const result = stats[0] || {
      totalValidations: 0, 
      validEmails: 0, 
      invalidEmails: 0, 
      riskyEmails: 0, 
      unknownEmails: 0,
      lastValidation: null
    };

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to get statistics' });
  }
});

// Get recent validation results (with pagination optimization)
router.get('/recent', async (req, res) => {
  try {
    const userId = req.ip;
    const limit = Math.min(parseInt(req.query.limit) || 50, 500); // Cap at 500
    const page = parseInt(req.query.page) || 1;
    const skip = (page - 1) * limit;

    // Use lean() for faster queries
    const results = await ValidationResult.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .select('email status reason score executionTime createdAt')
      .lean();

    const total = await ValidationResult.countDocuments({ userId });

    res.json({
      success: true,
      data: {
        results,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Recent results error:', error);
    res.status(500).json({ success: false, error: 'Failed to get recent results' });
  }
});

module.exports = router;