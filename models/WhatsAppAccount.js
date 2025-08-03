const mongoose = require('mongoose');

const whatsappAccountSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  accountName: {
    type: String,
    required: true,
    trim: true
  },
  phoneNumber: {
    type: String,
    required: false
  },
  status: {
    type: String,
    enum: ['disconnected', 'connecting', 'connected', 'authenticated', 'ready', 'blocked'],
    default: 'disconnected'
  },
  sessionData: {
    type: String, // Encrypted session data
  },
  qrCode: {
    type: String,
    expires: Date
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  dailyMessageCount: {
    type: Number,
    default: 0
  },
  dailyLimit: {
    type: Number,
    default: 1000
  },
  lastReset: {
    type: Date,
    default: Date.now
  },
  riskScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  antiBlockSettings: {
    messageDelay: { type: Number, default: 3000 }, // milliseconds
    randomDelay: { type: Boolean, default: true },
    humanTyping: { type: Boolean, default: true },
    contentVariation: { type: Boolean, default: true },
    maxMessagesPerHour: { type: Number, default: 100 }
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
whatsappAccountSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Reset daily count
whatsappAccountSchema.methods.resetDailyCount = function() {
  const now = new Date();
  const lastReset = new Date(this.lastReset || 0);
  
  if (now.getDate() !== lastReset.getDate()) {
    this.dailyMessageCount = 0;
    this.lastReset = now;
  }
};

module.exports = mongoose.model('WhatsAppAccount', whatsappAccountSchema);