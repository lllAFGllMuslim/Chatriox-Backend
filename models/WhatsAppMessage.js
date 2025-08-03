const mongoose = require('mongoose');

const whatsAppMessageSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  campaign: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WhatsAppCampaign'
  },
  whatsappAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WhatsAppAccount',
    required: true
  },
  recipient: {
    phone: { type: String, required: true },
    name: String,
    customData: { type: Map, of: String }
  },
  content: {
    type: { type: String, enum: ['text', 'image', 'video', 'document', 'audio'], required: true },
    text: String,
    mediaUrl: String,
    mediaPath: String,
    fileName: String,
    caption: String,
    buttons: [{
      id: String,
      text: String,
      url: String,
      type: { type: String, enum: ['url', 'phone', 'quick_reply'] }
    }]
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'read', 'failed', 'blocked'],
    default: 'pending'
  },
  messageId: String,
  sentAt: Date,
  deliveredAt: Date,
  readAt: Date,
  failureReason: String,
  retryCount: { type: Number, default: 0 },
  maxRetries: { type: Number, default: 3 },
  analytics: {
    opens: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    buttonClicks: [{
      buttonId: String,
      clickedAt: Date,
      userAgent: String,
      ipAddress: String
    }],
    engagement: {
      timeToRead: Number, // milliseconds
      timeToClick: Number, // milliseconds
      deviceType: String,
      location: {
        country: String,
        city: String,
        region: String
      }
    }
  },
  metadata: {
    messageSize: Number,
    processingTime: Number,
    queueTime: Number,
    deliveryAttempts: { type: Number, default: 0 }
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
whatsAppMessageSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Indexes for faster queries
whatsAppMessageSchema.index({ user: 1, createdAt: -1 });
whatsAppMessageSchema.index({ campaign: 1 });
whatsAppMessageSchema.index({ whatsappAccount: 1 });
whatsAppMessageSchema.index({ status: 1 });
whatsAppMessageSchema.index({ 'recipient.phone': 1 });

module.exports = mongoose.model('WhatsAppMessage', whatsAppMessageSchema);