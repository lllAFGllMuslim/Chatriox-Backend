const mongoose = require('mongoose');

const emailActivitySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  campaign: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign'
  },
  recipient: {
    email: { type: String, required: true },
    name: String
  },
  sender: {
    email: { type: String, required: true },
    name: String
  },
  template: {
    // FIXED: Allow both ObjectId (user templates) and String (system templates)
    id: { 
      type: mongoose.Schema.Types.Mixed, // Allows both ObjectId and String
      required: false // Make it optional since system templates don't have ObjectId
    },
    name: String,
    subject: String,
    content: String,
    // NEW: Add fields to distinguish template types
    type: {
      type: String,
      enum: ['user', 'system'],
      default: 'user'
    },
    systemId: String // Store original system template ID like "system_newsletter"
  },
  emailDetails: {
    subject: { type: String, required: true },
    content: { type: String, required: true },
    messageId: String,
    smtpConfig: String
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'pending', 'opened', 'clicked', 'bounced', 'failed'],
    default: 'sent'
  },
  tracking: {
    sentAt: { type: Date, default: Date.now },
    deliveredAt: Date,
    openedAt: Date,
    clickedAt: Date,
    bouncedAt: Date,
    opens: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    userAgent: String,
    ipAddress: String,
    location: {
      country: String,
      city: String,
      region: String
    }
  },
  response: {
    smtpResponse: String,
    errorMessage: String,
    deliveryStatus: String
  },
  metadata: {
    emailSize: Number,
    attachments: [String],
    tags: [String],
    customFields: { type: Map, of: String }
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for faster queries
emailActivitySchema.index({ user: 1, createdAt: -1 });
emailActivitySchema.index({ 'recipient.email': 1 });
emailActivitySchema.index({ campaign: 1 });
emailActivitySchema.index({ status: 1 });
emailActivitySchema.index({ 'tracking.sentAt': -1 });
// NEW: Index for template queries
emailActivitySchema.index({ 'template.type': 1, 'template.id': 1 });

module.exports = mongoose.model('EmailActivity', emailActivitySchema);