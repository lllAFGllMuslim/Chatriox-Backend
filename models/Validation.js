// models/Validation.js or models/ValidationResult.js
const mongoose = require('mongoose');

// Schema for individual check results
const CheckResultSchema = new mongoose.Schema({
  passed: {
    type: Boolean,
    required: true,
    default: false
  },
  message: {
    type: String,
    default: ''
  },
  response: {
    type: String,
    default: ''
  },
  skipped: {
    type: Boolean,
    default: false
  }
}, { _id: false });

// Schema for MX record check results
const MXCheckResultSchema = new mongoose.Schema({
  passed: {
    type: Boolean,
    required: true,
    default: false
  },
  message: {
    type: String,
    default: ''
  },
  records: [{
    exchange: {
      type: String,
      required: true
    },
    priority: {
      type: Number,
      required: true
    }
  }]
}, { _id: false });

// Main validation result schema
const ValidationResultSchema = new mongoose.Schema({
  // User identification (using IP address as per your router)
  userId: {
    type: String,
    required: true,
    index: true // Index for faster queries by user
  },
  
  // Email being validated
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true // Index for faster email lookups
  },
  
  // Validation result summary
  status: {
    type: String,
    required: true,
    enum: ['valid', 'invalid', 'risky', 'unknown'],
    index: true // Index for filtering by status
  },
  
  reason: {
    type: String,
    required: true
  },
  
  score: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  
  isValid: {
    type: Boolean,
    required: true,
    index: true // Index for filtering valid/invalid emails
  },
  
  // Detailed check results
  checks: {
    syntax: {
      type: CheckResultSchema,
      required: true
    },
    domain: {
      type: CheckResultSchema,
      required: true
    },
    mx: {
      type: MXCheckResultSchema,
      required: true
    },
    smtp: {
      type: CheckResultSchema,
      required: true
    },
    disposable: {
      type: CheckResultSchema,
      required: true
    },
    roleBased: {
      type: CheckResultSchema,
      required: true
    }
  },
  
  // Performance metrics
  executionTime: {
    type: Number,
    required: true,
    min: 0
  },
  
  // Request metadata
  ipAddress: {
    type: String,
    required: true
  },
  
  // Additional metadata
  userAgent: {
    type: String,
    default: ''
  },
  
  // Bulk validation batch ID (optional)
  batchId: {
    type: String,
    default: null,
    index: true
  }
}, {
  timestamps: true, // Adds createdAt and updatedAt automatically
  collection: 'validation_results' // Explicit collection name
});

// Compound indexes for better query performance
ValidationResultSchema.index({ userId: 1, createdAt: -1 }); // For recent results by user
ValidationResultSchema.index({ userId: 1, status: 1 }); // For filtering by user and status
ValidationResultSchema.index({ email: 1, createdAt: -1 }); // For email history
ValidationResultSchema.index({ createdAt: -1 }); // For general time-based queries

// Instance methods
ValidationResultSchema.methods.toSummary = function() {
  return {
    id: this._id,
    email: this.email,
    status: this.status,
    reason: this.reason,
    score: this.score,
    isValid: this.isValid,
    executionTime: this.executionTime,
    createdAt: this.createdAt
  };
};

// Static methods
ValidationResultSchema.statics.getStatsByUser = async function(userId) {
  const stats = await this.aggregate([
    { $match: { userId } },
    {
      $group: {
        _id: null,
        totalValidations: { $sum: 1 },
        validEmails: { $sum: { $cond: [{ $eq: ['$status', 'valid'] }, 1, 0] }},
        invalidEmails: { $sum: { $cond: [{ $eq: ['$status', 'invalid'] }, 1, 0] }},
        riskyEmails: { $sum: { $cond: [{ $eq: ['$status', 'risky'] }, 1, 0] }},
        unknownEmails: { $sum: { $cond: [{ $eq: ['$status', 'unknown'] }, 1, 0] }},
        avgExecutionTime: { $avg: '$executionTime' },
        lastValidation: { $max: '$createdAt' },
        firstValidation: { $min: '$createdAt' }
      }
    }
  ]);
  
  return stats[0] || {
    totalValidations: 0,
    validEmails: 0,
    invalidEmails: 0,
    riskyEmails: 0,
    unknownEmails: 0,
    avgExecutionTime: 0,
    lastValidation: null,
    firstValidation: null
  };
};

ValidationResultSchema.statics.getRecentByUser = async function(userId, limit = 50, page = 1) {
  const skip = (page - 1) * limit;
  
  const results = await this.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip)
    .select('email status reason score executionTime createdAt')
    .lean();
    
  const total = await this.countDocuments({ userId });
  
  return {
    results,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

// Pre-save middleware for additional validation
ValidationResultSchema.pre('save', function(next) {
  // Ensure email is lowercase
  if (this.email) {
    this.email = this.email.toLowerCase().trim();
  }
  
  // Validate score range
  if (this.score < 0) this.score = 0;
  if (this.score > 100) this.score = 100;
  
  // Ensure consistency between isValid and status
  if (this.status === 'valid' && !this.isValid) {
    this.isValid = true;
  } else if (this.status !== 'valid' && this.isValid) {
    this.isValid = false;
  }
  
  next();
});

// Export the model
module.exports = mongoose.model('ValidationResult', ValidationResultSchema);