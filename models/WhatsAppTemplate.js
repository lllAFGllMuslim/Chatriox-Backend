const mongoose = require('mongoose');

const whatsappTemplateSchema = new mongoose.Schema({
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
  category: {
    type: String,
    enum: ['marketing', 'utility', 'authentication', 'promotional', 'transactional'],
    default: 'marketing'
  },
  language: {
    type: String,
    default: 'en'
  },
  content: {
    type: { type: String, enum: ['text', 'media'], default: 'text' },
    text: { type: String, required: true },
    mediaType: { type: String, enum: ['image', 'video', 'document'] },
    mediaUrl: String,
    fileName: String,
    caption: String
  },
  variables: [{
    name: String,
    placeholder: String,
    required: { type: Boolean, default: false },
    defaultValue: String
  }],
  buttons: [{
    type: { type: String, enum: ['url', 'phone', 'quick_reply'], required: true },
    text: { type: String, required: true },
    url: String,
    phoneNumber: String
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  usageCount: {
    type: Number,
    default: 0
  },
  performance: {
    totalSent: { type: Number, default: 0 },
    deliveryRate: { type: Number, default: 0 },
    readRate: { type: Number, default: 0 },
    clickRate: { type: Number, default: 0 }
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
whatsappTemplateSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('WhatsAppTemplate', whatsappTemplateSchema);