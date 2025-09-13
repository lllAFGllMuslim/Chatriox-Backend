const mongoose = require('mongoose');

const emailTemplateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  subject: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  htmlContent: {
    type: String,
    required: true
  },
  textContent: {
    type: String,
    default: ''
  },
  category: {
    type: String,
    enum: ['marketing', 'transactional', 'newsletter', 'promotional'],
    required: true,
    default: 'marketing'
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  isPublic: {
    type: Boolean,
    default: false
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  usage: {
    type: Number,
    default: 0
  },
  aiGenerated: {
    type: Boolean,
    default: false
  },
  aiPrompt: {
    type: String,
    default: ''
  },
  industry: {
    type: String,
    default: ''
  },
  tone: {
    type: String,
    enum: ['professional', 'friendly', 'urgent', 'casual'],
    default: 'professional'
  },
  length: {
    type: String,
    enum: ['short', 'medium', 'long'],
    default: 'medium'
  },
  version: {
    type: Number,
    default: 1
  },
  parentTemplate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EmailTemplate',
    default: null
  },
  preview: {
    thumbnail: String,
    previewText: String
  },
  analytics: {
    views: { type: Number, default: 0 },
    uses: { type: Number, default: 0 },
    lastUsed: Date
  }
}, {
  timestamps: true
});

// Indexes for better query performance
emailTemplateSchema.index({ user: 1, category: 1 });
emailTemplateSchema.index({ isPublic: 1, category: 1 });
emailTemplateSchema.index({ tags: 1 });
emailTemplateSchema.index({ createdAt: -1 });

// Pre-save hook to generate preview text
emailTemplateSchema.pre('save', function(next) {
  if (this.htmlContent) {
    // Extract plain text from HTML for preview
    this.preview.previewText = this.htmlContent
      .replace(/<[^>]*>/g, '')
      .substring(0, 150)
      .trim() + '...';
  }
  next();
});

// Methods
emailTemplateSchema.methods.incrementUsage = function() {
  this.usage += 1;
  this.analytics.uses += 1;
  this.analytics.lastUsed = new Date();
  return this.save();
};

emailTemplateSchema.methods.incrementViews = function() {
  this.analytics.views += 1;
  return this.save();
};

module.exports = mongoose.model('EmailTemplate', emailTemplateSchema);