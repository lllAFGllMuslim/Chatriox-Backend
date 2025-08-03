const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true
  },
  firstName: String,
  lastName: String,
  company: String,
  phone: String,
  tags: [String],
  customFields: {
    type: Map,
    of: String
  },
  isValidated: {
    type: Boolean,
    default: false
  },
  validationStatus: {
    type: String,
    enum: ['valid', 'invalid', 'risky', 'unknown'],
    default: 'unknown'
  },
  validationScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  source: {
    type: String,
    enum: ['manual', 'import', 'scraping', 'api'],
    default: 'manual'
  },
  addedAt: {
    type: Date,
    default: Date.now
  }
});

const contactListSchema = new mongoose.Schema({
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
  contacts: [contactSchema],
  totalContacts: {
    type: Number,
    default: 0
  },
  validContacts: {
    type: Number,
    default: 0
  },
  invalidContacts: {
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
contactListSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  this.totalContacts = this.contacts.length;
  this.validContacts = this.contacts.filter(c => c.validationStatus === 'valid').length;
  this.invalidContacts = this.contacts.filter(c => c.validationStatus === 'invalid').length;
  next();
});

// Index for faster queries
contactListSchema.index({ user: 1, isActive: 1 });
contactListSchema.index({ 'contacts.email': 1 });

module.exports = mongoose.model('ContactList', contactListSchema);