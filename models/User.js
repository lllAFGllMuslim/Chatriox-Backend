  const mongoose = require('mongoose');
  const bcrypt = require('bcryptjs');

  const userSchema = new mongoose.Schema({
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [50, 'Name cannot exceed 50 characters']
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
    },
    phone: {
      type: String,
      required: false,
      trim: true,
      match: [/^\+?[\d\s\-\(\)]+$/, 'Please enter a valid phone number']
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user'
    },
    plan: {
      type: String,
      enum: ['starter', 'professional','business', 'enterprise'],
      default: 'starter'
    },
    planStatus: {
      type: String,
      enum: ['trial', 'active', 'expired', 'cancelled'],
      default: 'trial'
    },
    planExpiry: {
      type: Date,
      default: function() {
        return new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days trial
      }
    },
    trialStartDate: {
      type: Date,
      default: Date.now
    },
    trialEndDate: {
      type: Date,
      default: function() {
        return new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days trial
      }
    },
    isEmailVerified: {
      type: Boolean,
      default: false
    },
    emailVerificationToken: String,
    emailVerificationExpires: Date,
    passwordResetToken: String,
    passwordResetExpires: Date,
    isActive: {
      type: Boolean,
      default: true
    },
    lastLogin: Date,
    settings: {
      theme: { type: String, enum: ['light', 'dark'], default: 'light' },
      language: { type: String, default: 'en' },
      timezone: { type: String, default: 'UTC' },
      notifications: {
        email: { type: Boolean, default: true },
        push: { type: Boolean, default: false },
        sms: { type: Boolean, default: false },
        marketing: { type: Boolean, default: true }
      }
    },
    usage: {
      emailsSent: { type: Number, default: 0 },
      emailsValidated: { type: Number, default: 0 },
      websitesScraped: { type: Number, default: 0 },
      whatsappMessagesSent: { type: Number, default: 0 },
      lastReset: { type: Date, default: Date.now }
    },
    emailAccounts: [{
      type: { type: String, enum: ['gmail', 'outlook', 'smtp'], required: true },
      email: { type: String, required: true },
      accessToken: String,
      refreshToken: String,
      isConnected: { type: Boolean, default: false },
      dailyLimit: { type: Number, default: 500 },
      sentToday: { type: Number, default: 0 },
      lastReset: { type: Date, default: Date.now }
    }],
    apiKeys: [{
      name: { type: String, required: true },
      service: { type: String, enum: ['sendgrid', 'mailgun', 'whatsapp', 'custom'], required: true },
      key: { type: String, required: true },
      isActive: { type: Boolean, default: true },
      lastUsed: Date
    }],
    paymentHistory: [{
      orderId: String,
      paymentId: String,
      amount: Number,
      currency: { type: String, default: 'INR' },
      status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
      plan: String,
      billingCycle: { type: String, enum: ['monthly', 'yearly'] },
      paidAt: Date
    }],
    createdAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  });

  // Hash password before saving
  userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    
    try {
      const salt = await bcrypt.genSalt(12);
      this.password = await bcrypt.hash(this.password, salt);
      next();
    } catch (error) {
      next(error);
    }
  });

  // Update the updatedAt field before saving
  userSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
  });

  // Compare password method
  userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
  };

  // Reset daily email count
  userSchema.methods.resetDailyCount = function() {
    const now = new Date();
    const lastReset = new Date(this.usage.lastReset || 0);
    
    if (now.getDate() !== lastReset.getDate()) {
      this.usage.emailsSent = 0;
      this.usage.lastReset = now;
      
      // Reset email account daily counts
      this.emailAccounts.forEach(account => {
        const accountLastReset = new Date(account.lastReset || 0);
        if (now.getDate() !== accountLastReset.getDate()) {
          account.sentToday = 0;
          account.lastReset = now;
        }
      });
    }
  };

  // Check if user can send email
  userSchema.methods.canSendEmail = function(accountId) {
    this.resetDailyCount();
    
    if (accountId) {
      const account = this.emailAccounts.id(accountId);
      return account && account.sentToday < account.dailyLimit;
    }
    
    return true;
  };

  // Check if user is in trial
  userSchema.methods.isInTrial = function() {
    return this.planStatus === 'trial' && new Date() < this.trialEndDate;
  };

  // Check if trial is expired
  userSchema.methods.isTrialExpired = function() {
    return this.planStatus === 'trial' && new Date() >= this.trialEndDate;
  };

  // Get trial days remaining
  userSchema.methods.getTrialDaysRemaining = function() {
    if (this.planStatus !== 'trial') return 0;
    
    const now = new Date();
    const trialEnd = new Date(this.trialEndDate);
    const diffTime = trialEnd - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return Math.max(0, diffDays);
  };

  // Index for faster queries
  userSchema.index({ email: 1 });
  userSchema.index({ phone: 1 });
  userSchema.index({ planStatus: 1 });
  userSchema.index({ createdAt: -1 });

  module.exports = mongoose.model('User', userSchema);