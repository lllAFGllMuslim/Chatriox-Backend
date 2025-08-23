const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: [true, 'Campaign name is required'],
    trim: true,
    maxlength: [100, 'Campaign name cannot exceed 100 characters']
  },
  type: {
    type: String,
    enum: ['email', 'whatsapp'],
    required: true
  },
  subject: {
    type: String,
    required: function() { return this.type === 'email'; }
  },
  content: {
    type: String,
    required: true
  },
  recipients: [{
    email: String,
    phone: String,
    name: String,
    status: {
      type: String,
      enum: ['pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed'],
      default: 'pending'
    },
    sentAt: Date,
    deliveredAt: Date,
    openedAt: Date,
    clickedAt: Date,
    errorMessage: String
  }],
  settings: {
    fromName: String,
    fromEmail: String,
    replyTo: String,
    trackOpens: { type: Boolean, default: true },
    trackClicks: { type: Boolean, default: true },
    // ✅ ADD THESE MISSING FIELDS:
    smtpConfigId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'SMTPConfig',
      required: function() { return this.type === 'email'; }
    },
    templateId: { 
      type: mongoose.Schema.Types.Mixed, // Can be ObjectId or String (for system templates)
      required: true
    },
    contactListId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'ContactList',
      required: true
    }
  },
  schedule: {
    isScheduled: { type: Boolean, default: false },
    scheduledAt: Date,
    timezone: String
  },
  status: {
    type: String,
    enum: ['draft', 'pending','scheduled', 'sending', 'sent', 'completed', 'failed', 'cancelled'],
    default: 'draft'
  },
  stats: {
    totalRecipients: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    opened: { type: Number, default: 0 },
    clicked: { type: Number, default: 0 },
    bounced: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    pending: { type: Number, default: 0 }, // ✅ ADD THIS
    unsubscribed: { type: Number, default: 0 }, // ✅ ADD THIS
    openRate: { type: Number, default: 0 },
    clickRate: { type: Number, default: 0 },
    bounceRate: { type: Number, default: 0 }
  },
  // ✅ ADD ERROR FIELD:
  error: String,
  
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  sentAt: Date,
  completedAt: Date
});

// Update stats before saving
campaignSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  // Calculate stats
  const recipients = this.recipients;
  this.stats.totalRecipients = recipients.length;
  this.stats.sent = recipients.filter(r => ['sent', 'delivered', 'opened', 'clicked'].includes(r.status)).length;
  this.stats.delivered = recipients.filter(r => ['delivered', 'opened', 'clicked'].includes(r.status)).length;
  this.stats.opened = recipients.filter(r => ['opened', 'clicked'].includes(r.status)).length;
  this.stats.clicked = recipients.filter(r => r.status === 'clicked').length;
  this.stats.bounced = recipients.filter(r => r.status === 'bounced').length;
  this.stats.failed = recipients.filter(r => r.status === 'failed').length;
  this.stats.pending = recipients.filter(r => r.status === 'pending').length;
  
  // Calculate rates
  if (this.stats.sent > 0) {
    this.stats.openRate = Math.round((this.stats.opened / this.stats.sent) * 100 * 100) / 100; // Round to 2 decimals
    this.stats.clickRate = Math.round((this.stats.clicked / this.stats.sent) * 100 * 100) / 100;
    this.stats.bounceRate = Math.round((this.stats.bounced / this.stats.sent) * 100 * 100) / 100;
  }
  
  next();
});

// ✅ ADD USEFUL INDEXES:
campaignSchema.index({ user: 1, createdAt: -1 });
campaignSchema.index({ status: 1 });
campaignSchema.index({ 'schedule.scheduledAt': 1, status: 1 });

module.exports = mongoose.model('Campaign', campaignSchema);