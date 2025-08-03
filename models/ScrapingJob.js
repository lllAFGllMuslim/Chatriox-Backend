const mongoose = require('mongoose');

const scrapingJobSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['website', 'business_search'],
    default: 'website'
  },
  url: {
    type: String,
    required: function() { return this.type === 'website'; }
  },
  searchQuery: {
    type: String,
    required: function() { return this.type === 'business_search'; }
  },
  location: {
    country: String,
    city: String,
    state: String
  },
  settings: {
    depth: { type: Number, default: 1 },
    maxPages: { type: Number, default: 50 },
    delay: { type: Number, default: 2 },
    pattern: { type: String, default: 'all' },
    maxResults: { type: Number, default: 100 }
  },
  status: {
    type: String,
    enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  progress: {
    pagesScraped: { type: Number, default: 0 },
    businessesFound: { type: Number, default: 0 },
    emailsFound: { type: Number, default: 0 },
    phonesFound: { type: Number, default: 0 },
    validEmails: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 }
  },
  results: [{
    businessName: String,
    email: { type: String, required: true },
    phone: String,
    website: String,
    address: String,
    source: { type: String, required: true },
    domain: String,
    status: {
      type: String,
      enum: ['valid', 'invalid', 'risky', 'unknown'],
      default: 'unknown'
    },
    foundAt: { type: Date, default: Date.now }
  }],
  csvFilePath: String,
  error: String,
  startedAt: Date,
  completedAt: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index for faster queries
scrapingJobSchema.index({ user: 1, createdAt: -1 });
scrapingJobSchema.index({ status: 1 });

module.exports = mongoose.model('ScrapingJob', scrapingJobSchema);