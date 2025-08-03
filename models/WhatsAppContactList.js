const mongoose = require('mongoose');

const whatsAppContactSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true
  },
  name: String,
  email: String,
  company: String,
  tags: [String],
  customFields: {
    type: Map,
    of: String
  },
  isActive: {
    type: Boolean,
    default: true
  },
  addedAt: {
    type: Date,
    default: Date.now
  },
  lastMessageSent: Date,
  totalMessagesSent: { type: Number, default: 0 },
  totalMessagesRead: { type: Number, default: 0 },
  engagementScore: { type: Number, default: 0 },
  isBlocked: { type: Boolean, default: false },
  blockedAt: Date,
  source: {
    type: String,
    enum: ['manual', 'import', 'scraping', 'api'],
    default: 'manual'
  }
});

const whatsAppContactListSchema = new mongoose.Schema({
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
  description: String,
  contacts: [whatsAppContactSchema],
  totalContacts: {
    type: Number,
    default: 0
  },
  activeContacts: {
    type: Number,
    default: 0
  },
  blockedContacts: {
    type: Number,
    default: 0
  },
  tags: [String],
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

// Update stats before saving
whatsAppContactListSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  this.totalContacts = this.contacts.length;
  this.activeContacts = this.contacts.filter(c => c.isActive && !c.isBlocked).length;
  this.blockedContacts = this.contacts.filter(c => c.isBlocked).length;
  next();
});

// Index for faster queries
whatsAppContactListSchema.index({ user: 1, isActive: 1 });

module.exports = mongoose.model('WhatsAppContactList', whatsAppContactListSchema);