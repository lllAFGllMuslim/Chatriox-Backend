const cron = require('node-cron');
const User = require('../models/User');
const nodemailer = require('nodemailer');

// Configure email transporter (use your email service)
const transporter = nodemailer.createTransporter({
  // Configure your email service here
  service: 'gmail', // or your preferred service
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Send expiry reminder email
const sendExpiryReminder = async (user, daysLeft) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: `Your subscription expires in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`,
      html: `
        <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
          <h2>Hi ${user.name},</h2>
          <p>Your <strong>${user.plan}</strong> subscription will expire in ${daysLeft} day${daysLeft > 1 ? 's' : ''}.</p>
          <p>Don't miss out on your premium features! Renew now to continue enjoying:</p>
          <ul>
            <li>Unlimited email sending</li>
            <li>Advanced analytics</li>
            <li>Priority support</li>
          </ul>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.FRONTEND_URL}/pricing" 
               style="background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">
              Renew Subscription
            </a>
          </div>
          <p>Thanks,<br>Your Team</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`Expiry reminder sent to ${user.email}`);
  } catch (error) {
    console.error('Error sending expiry reminder:', error);
  }
};

// Send subscription expired email
const sendExpiredEmail = async (user) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'Your subscription has expired',
      html: `
        <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
          <h2>Hi ${user.name},</h2>
          <p>Your <strong>${user.plan}</strong> subscription has expired.</p>
          <p>You've been moved to our <strong>Starter</strong> plan with limited features.</p>
          <p>To restore your premium features, please renew your subscription:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.FRONTEND_URL}/pricing" 
               style="background: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">
              Renew Now
            </a>
          </div>
          <p>Thanks,<br>Your Team</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`Expiry notification sent to ${user.email}`);
  } catch (error) {
    console.error('Error sending expired email:', error);
  }
};

// Check subscriptions daily at 9 AM
const checkSubscriptions = cron.schedule('0 9 * * *', async () => {
  try {
    console.log('Running subscription check...');
    
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const oneDayFromNow = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);

    // Find users with subscriptions expiring in 3 days
    const expiring3Days = await User.find({
      planStatus: 'active',
      planExpiry: {
        $gte: now,
        $lte: threeDaysFromNow
      },
      plan: { $ne: 'starter' } // Don't send reminders for free plans
    });

    for (const user of expiring3Days) {
      const daysLeft = Math.ceil((user.planExpiry - now) / (1000 * 60 * 60 * 24));
      if (daysLeft === 3) {
        await sendExpiryReminder(user, 3);
      }
    }

    // Find users with subscriptions expiring in 1 day
    const expiring1Day = await User.find({
      planStatus: 'active',
      planExpiry: {
        $gte: now,
        $lte: oneDayFromNow
      },
      plan: { $ne: 'starter' }
    });

    for (const user of expiring1Day) {
      const daysLeft = Math.ceil((user.planExpiry - now) / (1000 * 60 * 60 * 24));
      if (daysLeft === 1) {
        await sendExpiryReminder(user, 1);
      }
    }

    // Find expired subscriptions
    const expiredUsers = await User.find({
      planStatus: 'active',
      planExpiry: { $lt: now },
      plan: { $ne: 'starter' }
    });

    for (const user of expiredUsers) {
      // Move to starter plan
      user.plan = 'starter';
      user.planStatus = 'expired';
      await user.save();

      await sendExpiredEmail(user);
      console.log(`User ${user.email} subscription expired, moved to starter plan`);
    }

    console.log(`Subscription check completed. Found ${expiring3Days.length} expiring in 3 days, ${expiring1Day.length} expiring in 1 day, ${expiredUsers.length} expired.`);

  } catch (error) {
    console.error('Error in subscription check:', error);
  }
}, {
  scheduled: false
});

// Reset daily usage counters at midnight
const resetDailyUsage = cron.schedule('0 0 * * *', async () => {
  try {
    console.log('Resetting daily usage counters...');
    
    const users = await User.find({});
    let resetCount = 0;

    for (const user of users) {
      user.resetDailyCount();
      await user.save();
      resetCount++;
    }

    console.log(`Daily usage reset completed for ${resetCount} users.`);

  } catch (error) {
    console.error('Error resetting daily usage:', error);
  }
}, {
  scheduled: false
});

// Start cron jobs
const startCronJobs = () => {
  checkSubscriptions.start();
  resetDailyUsage.start();
  console.log('Subscription cron jobs started');
};

// Stop cron jobs
const stopCronJobs = () => {
  checkSubscriptions.stop();
  resetDailyUsage.stop();
  console.log('Subscription cron jobs stopped');
};

module.exports = {
  startCronJobs,
  stopCronJobs,
  checkSubscriptions,
  resetDailyUsage
};