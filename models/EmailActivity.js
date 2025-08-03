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
    id: { type: mongoose.Schema.Types.ObjectId, ref: 'Template' },
    name: String,
    subject: String,
    content: String
  },
  emailDetails: {
    subject: { type: String, required: true },
    content: { type: String, required: true },
    messageId: String,
    smtpConfig: String
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed'],
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

module.exports = mongoose.model('EmailActivity', emailActivitySchema);