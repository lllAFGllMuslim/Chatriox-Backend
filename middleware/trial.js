const User = require('../models/User');

// Check if user has access to feature based on plan and trial status
const checkFeatureAccess = (feature) => {
  return async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const isInTrial = user.isInTrial();
      const isTrialExpired = user.isTrialExpired();
      
      // If trial expired and no active plan
      if (isTrialExpired && user.planStatus !== 'active') {
        return res.status(403).json({
          success: false,
          message: 'Trial period expired. Please upgrade to continue using this feature.',
          trialExpired: true,
          requiresUpgrade: true
        });
      }

      // Get plan limits
      const PLANS = {
        starter: {
          features: {
            emailsPerMonth: 5000,
            emailAccounts: 1,
            whatsappAccounts: 1,
            validation: true,
            scraper: false,
            whatsapp: false
          },
          trialLimits: {
            emailsPerMonth: 100,
            emailAccounts: 1,
            whatsappAccounts: 1,
            validation: 50,
            scraper: false,
            whatsapp: false
          }
        },
        professional: {
          features: {
            emailsPerMonth: 25000,
            emailAccounts: 5,
            whatsappAccounts: 3,
            validation: true,
            scraper: true,
            whatsapp: true
          },
          trialLimits: {
            emailsPerMonth: 500,
            emailAccounts: 2,
            whatsappAccounts: 1,
            validation: 200,
            scraper: true,
            whatsapp: true
          }
        },
        enterprise: {
          features: {
            emailsPerMonth: -1,
            emailAccounts: -1,
            whatsappAccounts: 10,
            validation: true,
            scraper: true,
            whatsapp: true
          },
          trialLimits: {
            emailsPerMonth: 1000,
            emailAccounts: 3,
            whatsappAccounts: 2,
            validation: 500,
            scraper: true,
            whatsapp: true
          }
        }
      };

      const currentPlan = PLANS[user.plan];
      const limits = isInTrial ? currentPlan.trialLimits : currentPlan.features;

      // Check specific feature access
      switch (feature) {
        case 'whatsapp':
          if (!limits.whatsapp) {
            return res.status(403).json({
              success: false,
              message: isInTrial ? 
                'WhatsApp feature not available in trial. Please upgrade to access.' :
                'WhatsApp feature requires Professional plan or higher.',
              requiresUpgrade: true,
              feature: 'whatsapp'
            });
          }
          break;

        case 'scraper':
          if (!limits.scraper) {
            return res.status(403).json({
              success: false,
              message: isInTrial ?
                'Lead scraper not available in trial. Please upgrade to access.' :
                'Lead scraper requires Professional plan or higher.',
              requiresUpgrade: true,
              feature: 'scraper'
            });
          }
          break;

        case 'email_sending':
          if (limits.emailsPerMonth !== -1 && user.usage.emailsSent >= limits.emailsPerMonth) {
            return res.status(403).json({
              success: false,
              message: `Monthly email limit reached (${limits.emailsPerMonth}). Please upgrade for higher limits.`,
              requiresUpgrade: true,
              feature: 'email_sending',
              currentUsage: user.usage.emailsSent,
              limit: limits.emailsPerMonth
            });
          }
          break;

        case 'email_validation':
          if (limits.validation !== true && user.usage.emailsValidated >= limits.validation) {
            return res.status(403).json({
              success: false,
              message: `Email validation limit reached (${limits.validation}). Please upgrade for higher limits.`,
              requiresUpgrade: true,
              feature: 'email_validation',
              currentUsage: user.usage.emailsValidated,
              limit: limits.validation
            });
          }
          break;
      }

      // Add limits to request for use in controllers
      req.userLimits = limits;
      req.isInTrial = isInTrial;
      req.trialDaysRemaining = user.getTrialDaysRemaining();

      next();
    } catch (error) {
      console.error('Feature access check error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  };
};

module.exports = { checkFeatureAccess };