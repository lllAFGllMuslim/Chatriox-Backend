const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  subject: {
    type: String,
    required: true
  },
  content: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['custom', 'system'],
    default: 'custom'
  },
  category: {
    type: String,
    enum: ['newsletter', 'promotional', 'transactional', 'welcome', 'follow-up', 'other'],
    default: 'other'
  },
  thumbnail: String,
  isActive: {
    type: Boolean,
    default: true
  },
  usageCount: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt field before saving
templateSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Index for faster queries
templateSchema.index({ user: 1, isActive: 1 });
templateSchema.index({ type: 1, category: 1 });

module.exports = mongoose.model('Template', templateSchema);