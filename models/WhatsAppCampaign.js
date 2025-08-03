const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  recipient: {
    phone: { type: String, required: true },
    name: String,
    customData: { type: Map, of: String }
  },
  content: {
    type: { type: String, enum: ['text', 'image', 'video'], required: true },
    text: String,
    mediaUrl: String,
    fileName: String,
    caption: String,
    buttons: [{
      id: String,
      text: String,
      url: String
    }]
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'read', 'failed', 'partial', 'blocked'],
    default: 'pending'
  },
  sentAt: Date,
  deliveredAt: Date,
  readAt: Date,
  failureReason: String,
  messageId: String,
  clickData: [{
    buttonId: String,
    clickedAt: Date,
    userAgent: String
  }]
});

const whatsappCampaignSchema = new mongoose.Schema({
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
  whatsappAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WhatsAppAccount',
    required: true
  },
  template: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WhatsAppTemplate'
  },
  messages: [messageSchema],
  schedule: {
    isScheduled: { type: Boolean, default: false },
    scheduledAt: Date,
    timezone: String,
    repeatType: { type: String, enum: ['none', 'daily', 'weekly', 'monthly'], default: 'none' },
    repeatUntil: Date
  },
  antiBlockSettings: {
    enabled: { type: Boolean, default: true },
    messageDelay: { type: Number, default: 5000 },
    randomDelayRange: { min: Number, max: Number },
    humanTypingDelay: { type: Boolean, default: true },
    contentVariation: { type: Boolean, default: true },
    accountRotation: { type: Boolean, default: false },
    maxMessagesPerBatch: { type: Number, default: 50 },
    batchDelay: { type: Number, default: 300000 } // 5 minutes
  },
  abTesting: {
    enabled: { type: Boolean, default: false },
    variants: [{
      name: String,
      content: String,
      percentage: Number,
      results: {
        sent: { type: Number, default: 0 },
        delivered: { type: Number, default: 0 },
        read: { type: Number, default: 0 },
        clicked: { type: Number, default: 0 }
      }
    }]
  },
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'running', 'paused', 'completed', 'failed', 'partial', 'cancelled'],
    default: 'draft'
  },
  progress: {
    total: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    read: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 }
  },
  analytics: {
    deliveryRate: { type: Number, default: 0 },
    readRate: { type: Number, default: 0 },
    clickRate: { type: Number, default: 0 },
    engagementScore: { type: Number, default: 0 },
    riskScore: { type: Number, default: 0 }
  },
  startedAt: Date,
  completedAt: Date,
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
whatsappCampaignSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  // Calculate progress
  this.progress.total = this.messages.length;
  this.progress.sent = this.messages.filter(m => m.status !== 'pending' && m.status !== 'failed').length;
  this.progress.delivered = this.messages.filter(m => m.status === 'delivered' || m.status === 'read').length;
  this.progress.read = this.messages.filter(m => m.status === 'read').length;
  this.progress.failed = this.messages.filter(m => m.status === 'failed').length;
  this.progress.percentage = this.progress.total > 0 ? (this.progress.sent / this.progress.total) * 100 : 0;
  
  // Calculate analytics
  if (this.progress.sent > 0) {
    this.analytics.deliveryRate = (this.progress.delivered / this.progress.sent) * 100;
    this.analytics.readRate = (this.progress.read / this.progress.sent) * 100;
    
    const totalClicks = this.messages.reduce((sum, msg) => sum + (msg.clickData?.length || 0), 0);
    this.analytics.clickRate = (totalClicks / this.progress.sent) * 100;
    
    this.analytics.engagementScore = (this.analytics.readRate * 0.6) + (this.analytics.clickRate * 0.4);
  }
  
  next();
});

module.exports = mongoose.model('WhatsAppCampaign', whatsappCampaignSchema);