const mongoose = require('mongoose');

const resultSchema = new mongoose.Schema({
  email: {
    type: String,
    required: false
  },
  businessName: {
    type: String,
    required: false
  },
  phone: {
    type: String,
    required: false
  },
  address: {
    type: String,
    required: false
  },
  website: {
    type: String,
    required: false
  },
  rating: {
    type: String,
    required: false
  },
  source: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['valid', 'invalid', 'pending'],
    default: 'pending'
  },
  mapUrl: {
    type: String,
    required: false
  },
  snippet: {
    type: String,
    required: false
  }
}, { _id: false });

const progressSchema = new mongoose.Schema({
  percentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  emailsFound: {
    type: Number,
    default: 0
  },
  validEmails: {
    type: Number,
    default: 0
  },
  businessesFound: {
    type: Number,
    default: 0
  },
  phonesFound: {
    type: Number,
    default: 0
  },
  pagesProcessed: {
    type: Number,
    default: 0
  },
  totalPages: {
    type: Number,
    default: 0
  },
  currentStatus: {
    type: String,
    default: 'Initializing...'
  }
}, { _id: false });

const settingsSchema = new mongoose.Schema({
  depth: {
    type: Number,
    default: 1,
    min: 1,
    max: 5
  },
  maxPages: {
    type: Number,
    default: 50,
    min: 1,
    max: 1000
  },
  delay: {
    type: Number,
    default: 2,
    min: 1,
    max: 10
  },
  pattern: {
    type: String,
    enum: ['all', 'business', 'personal'],
    default: 'all'
  },
  maxResults: {
    type: Number,
    default: 100,
    min: 10,
    max: 10000
  }
}, { _id: false });

const locationSchema = new mongoose.Schema({
  country: {
    type: String,
    required: false
  },
  state: {
    type: String,
    required: false
  },
  city: {
    type: String,
    required: false
  }
}, { _id: false });

const jobSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['website', 'business_search'],
    required: true
  },
  url: {
    type: String,
    required: function() {
      return this.type === 'website';
    }
  },
  searchQuery: {
    type: String,
    required: function() {
      return this.type === 'business_search';
    }
  },
  location: {
    type: locationSchema,
    required: function() {
      return this.type === 'business_search';
    }
  },
  settings: {
    type: settingsSchema,
    default: () => ({})
  },
  status: {
    type: String,
    enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  progress: {
    type: progressSchema,
    default: () => ({})
  },
  results: [resultSchema],
  sources: [{
    type: String,
    enum: ['google_maps', 'bing_search', 'yellow_pages', 'website_enhancement']
  }],
  stats: {
    withEmail: {
      type: Number,
      default: 0
    },
    withPhone: {
      type: Number,
      default: 0
    },
    withBoth: {
      type: Number,
      default: 0
    },
    enhanced: {
      type: Number,
      default: 0
    }
  },
  duration: {
    type: String,
    default: null
  },
  errorMessage: {
    type: String,
    default: null
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Indexes for better performance
jobSchema.index({ user: 1, createdAt: -1 });
jobSchema.index({ status: 1 });
jobSchema.index({ type: 1 });

// Virtual for display name
jobSchema.virtual('displayName').get(function() {
  if (this.type === 'website') {
    return this.url;
  } else {
    return this.searchQuery;
  }
});

// Virtual for location display
jobSchema.virtual('locationDisplay').get(function() {
  if (this.type === 'business_search' && this.location) {
    return [this.location.city, this.location.state, this.location.country]
      .filter(Boolean)
      .join(', ');
  }
  return '';
});

jobSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Job', jobSchema);