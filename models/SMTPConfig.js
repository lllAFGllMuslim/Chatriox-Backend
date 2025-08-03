const mongoose = require('mongoose');

const smtpConfigSchema = new mongoose.Schema({
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
  host: {
    type: String,
    required: true
  },
  port: {
    type: Number,
    required: true
  },
  secure: {
    type: Boolean,
    default: false
  },
  username: {
    type: String,
    required: true
  },
  password: {
    type: String,
    required: true
  },
  fromName: {
    type: String,
    required: true
  },
  fromEmail: {
    type: String,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  lastTested: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index for faster queries
smtpConfigSchema.index({ user: 1, isActive: 1 });

module.exports = mongoose.model('SMTPConfig', smtpConfigSchema);