const mongoose = require('mongoose');

const whatsappContactSchema = new mongoose.Schema({
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
  phone: {
    type: String,
    required: true
  },
  email: String,
  company: String,
  tags: [String],
  customFields: {
    type: Map,
    of: String
  },
  lists: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WhatsAppContactList'
  }],
  engagement: {
    totalMessagesSent: { type: Number, default: 0 },
    totalMessagesRead: { type: Number, default: 0 },
    lastMessageSent: Date,
    lastMessageRead: Date,
    engagementScore: { type: Number, default: 0 },
    isBlocked: { type: Boolean, default: false },
    blockedAt: Date
  },
  preferences: {
    optedOut: { type: Boolean, default: false },
    optedOutAt: Date,
    preferredLanguage: { type: String, default: 'en' },
    timezone: String
  },
  source: {
    type: String,
    enum: ['manual', 'import', 'scraping', 'api', 'form'],
    default: 'manual'
  },
  isActive: {
    type: Boolean,
    default: true
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
whatsappContactSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  // Calculate engagement score
  if (this.engagement.totalMessagesSent > 0) {
    const readRate = this.engagement.totalMessagesRead / this.engagement.totalMessagesSent;
    const recencyScore = this.engagement.lastMessageRead ? 
      Math.max(0, 100 - ((Date.now() - this.engagement.lastMessageRead) / (1000 * 60 * 60 * 24))) : 0;
    
    this.engagement.engagementScore = (readRate * 70) + (recencyScore * 0.3);
  }
  
  next();
});

// Index for faster queries
whatsappContactSchema.index({ user: 1, phone: 1 }, { unique: true });
whatsappContactSchema.index({ user: 1, isActive: 1 });

module.exports = mongoose.model('WhatsAppContact', whatsappContactSchema);