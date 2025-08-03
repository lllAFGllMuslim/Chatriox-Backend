const express = require('express');
const { auth } = require('../middleware/auth');
const Campaign = require('../models/Campaign');
const User = require('../models/User');

const router = express.Router();

// @route   GET /api/dashboard/stats
// @desc    Get dashboard statistics
// @access  Private
router.get('/stats', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { timeRange = '7d' } = req.query;
    
    // Calculate date range
    const now = new Date();
    let startDate;
    
    switch (timeRange) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    // Get campaigns in date range
    const campaigns = await Campaign.find({
      user: userId,
      createdAt: { $gte: startDate }
    });

    // Calculate totals
    const totalEmailsSent = campaigns.reduce((sum, campaign) => sum + campaign.stats.sent, 0);
    const totalOpened = campaigns.reduce((sum, campaign) => sum + campaign.stats.opened, 0);
    const totalClicked = campaigns.reduce((sum, campaign) => sum + campaign.stats.clicked, 0);
    const activeCampaigns = campaigns.filter(c => c.status === 'sending' || c.status === 'scheduled').length;

    // Calculate rates
    const openRate = totalEmailsSent > 0 ? (totalOpened / totalEmailsSent) * 100 : 0;
    const clickRate = totalEmailsSent > 0 ? (totalClicked / totalEmailsSent) * 100 : 0;

    // Get previous period for comparison
    const prevStartDate = new Date(startDate.getTime() - (now.getTime() - startDate.getTime()));
    const prevCampaigns = await Campaign.find({
      user: userId,
      createdAt: { $gte: prevStartDate, $lt: startDate }
    });

    const prevTotalEmailsSent = prevCampaigns.reduce((sum, campaign) => sum + campaign.stats.sent, 0);
    const prevTotalOpened = prevCampaigns.reduce((sum, campaign) => sum + campaign.stats.opened, 0);
    const prevTotalClicked = prevCampaigns.reduce((sum, campaign) => sum + campaign.stats.clicked, 0);
    const prevOpenRate = prevTotalEmailsSent > 0 ? (prevTotalOpened / prevTotalEmailsSent) * 100 : 0;
    const prevClickRate = prevTotalEmailsSent > 0 ? (prevTotalClicked / prevTotalEmailsSent) * 100 : 0;

    // Calculate changes
    const emailsChange = prevTotalEmailsSent > 0 ? ((totalEmailsSent - prevTotalEmailsSent) / prevTotalEmailsSent) * 100 : 0;
    const openRateChange = prevOpenRate > 0 ? ((openRate - prevOpenRate) / prevOpenRate) * 100 : 0;
    const clickRateChange = prevClickRate > 0 ? ((clickRate - prevClickRate) / prevClickRate) * 100 : 0;

    res.json({
      success: true,
      data: {
        totalEmailsSent,
        openRate: parseFloat(openRate.toFixed(1)),
        clickRate: parseFloat(clickRate.toFixed(1)),
        activeCampaigns,
        changes: {
          emails: parseFloat(emailsChange.toFixed(1)),
          openRate: parseFloat(openRateChange.toFixed(1)),
          clickRate: parseFloat(clickRateChange.toFixed(1)),
          campaigns: 0 // You can implement this based on your needs
        }
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/dashboard/analytics
// @desc    Get analytics data for charts
// @access  Private
router.get('/analytics', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { timeRange = '7d' } = req.query;
    
    // Calculate date range
    const now = new Date();
    let startDate, groupBy;
    
    switch (timeRange) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        groupBy = 'day';
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        groupBy = 'day';
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        groupBy = 'week';
        break;
      default:
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        groupBy = 'day';
    }

    // Email performance data (last 7 days)
    const emailData = [];
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dayStart = new Date(date.setHours(0, 0, 0, 0));
      const dayEnd = new Date(date.setHours(23, 59, 59, 999));
      
      const dayCampaigns = await Campaign.find({
        user: userId,
        createdAt: { $gte: dayStart, $lte: dayEnd }
      });
      
      const sent = dayCampaigns.reduce((sum, campaign) => sum + campaign.stats.sent, 0);
      const opened = dayCampaigns.reduce((sum, campaign) => sum + campaign.stats.opened, 0);
      const clicked = dayCampaigns.reduce((sum, campaign) => sum + campaign.stats.clicked, 0);
      
      emailData.push({
        name: days[date.getDay() === 0 ? 6 : date.getDay() - 1],
        sent,
        opened,
        clicked
      });
    }

    // Device breakdown (mock data - you can implement real device tracking)
    const deviceData = [
      { name: 'Desktop', value: 45, color: '#3B82F6' },
      { name: 'Mobile', value: 35, color: '#10B981' },
      { name: 'Tablet', value: 20, color: '#F59E0B' }
    ];

    // Email volume data (last 6 months)
    const emailVolumeData = [];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
    
    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      
      const monthCampaigns = await Campaign.find({
        user: userId,
        createdAt: { $gte: monthStart, $lte: monthEnd }
      });
      
      const emails = monthCampaigns.reduce((sum, campaign) => sum + campaign.stats.sent, 0);
      
      emailVolumeData.push({
        month: months[date.getMonth()],
        emails
      });
    }

    res.json({
      success: true,
      data: {
        emailData,
        deviceData,
        emailVolumeData
      }
    });
  } catch (error) {
    console.error('Dashboard analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/dashboard/campaigns
// @desc    Get top performing campaigns
// @access  Private
router.get('/campaigns', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 5 } = req.query;
    
    const campaigns = await Campaign.find({
      user: userId,
      status: { $in: ['sent', 'completed'] }
    })
    .sort({ 'stats.clickRate': -1 })
    .limit(parseInt(limit))
    .select('name stats createdAt');

    const formattedCampaigns = campaigns.map(campaign => ({
      name: campaign.name,
      sent: campaign.stats.sent,
      opens: campaign.stats.opened,
      clicks: campaign.stats.clicked,
      ctr: campaign.stats.clickRate
    }));

    res.json({
      success: true,
      data: formattedCampaigns
    });
  } catch (error) {
    console.error('Dashboard campaigns error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;