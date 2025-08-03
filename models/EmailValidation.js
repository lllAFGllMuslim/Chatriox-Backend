const mongoose = require('mongoose');

const emailValidationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true
  },
  status: {
    type: String,
    enum: ['valid', 'invalid', 'risky', 'unknown'],
    required: true
  },
  score: {
    type: Number,
    min: 0,
    max: 100,
    required: true
  },
  reason: {
    type: String,
    required: true
  },
  details: {
    syntax: { type: Boolean },
    domain: { type: Boolean },
    mx: { type: Boolean },
    disposable: { type: Boolean },
    role: { type: Boolean },
    free: { type: Boolean },
    deliverable: { type: Boolean }
  },
  validatedAt: {
    type: Date,
    default: Date.now
  }
});

// Index for faster queries
emailValidationSchema.index({ user: 1, email: 1 });
emailValidationSchema.index({ user: 1, validatedAt: -1 });

module.exports = mongoose.model('EmailValidation', emailValidationSchema);