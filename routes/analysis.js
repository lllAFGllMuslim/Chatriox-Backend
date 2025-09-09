const express = require('express');
const { auth } = require('../middleware/auth');
const AIAnalysisService = require('../services/AIAnalysisService');

const router = express.Router();
const aiService = new AIAnalysisService();

// Rate limiting for AI analysis (to control costs)
const rateLimit = require('express-rate-limit');

const aiAnalysisLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each user to 10 AI analysis requests per hour
  message: {
    success: false,
    message: 'Too many AI analysis requests. Please try again later.',
    error: 'Rate limit exceeded'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// @route   POST /api/ai-analysis/campaign/:campaignId
// @desc    Get AI insights for a specific campaign
// @access  Private
router.post('/campaign/:campaignId', [auth, aiAnalysisLimiter], async (req, res) => {
  try {
    const { campaignId } = req.params;
    const userId = req.user.id;

    console.log(`🤖 AI Analysis requested for campaign: ${campaignId} by user: ${userId}`);

    if (!process.env.PERPLEXITY_API_KEY) {
      return res.status(503).json({
        success: false,
        message: 'AI analysis service is currently unavailable. Please contact support.',
        error: 'Perplexity API key not configured'
      });
    }

    const result = await aiService.analyzeCampaign(campaignId, userId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'AI analysis failed',
        error: result.error
      });
    }

    res.json({
      success: true,
      message: 'AI analysis completed successfully',
      data: result.data
    });

  } catch (error) {
    console.error('❌ AI campaign analysis error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during AI analysis',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @route   POST /api/ai-analysis/overview
// @desc    Get AI insights for all campaigns
// @access  Private
router.post('/overview', [auth, aiAnalysisLimiter], async (req, res) => {
  try {
    const userId = req.user.id;
    const { timeRange = '30d' } = req.body;

    console.log(`🤖 Overall AI Analysis requested for user: ${userId}, timeRange: ${timeRange}`);

    if (!process.env.PERPLEXITY_API_KEY) {
      return res.status(503).json({
        success: false,
        message: 'AI analysis service is currently unavailable. Please contact support.',
        error: 'Perplexity API key not configured'
      });
    }

    // Validate timeRange
    if (!['7d', '30d', '90d'].includes(timeRange)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid time range. Use 7d, 30d, or 90d.',
        error: 'Invalid timeRange parameter'
      });
    }

    const result = await aiService.analyzeAllCampaigns(userId, timeRange);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'AI analysis failed',
        error: result.error
      });
    }

    res.json({
      success: true,
      message: 'AI analysis completed successfully',
      data: result.data
    });

  } catch (error) {
    console.error('❌ AI overall analysis error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during AI analysis',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @route   GET /api/ai-analysis/usage
// @desc    Get AI analysis usage statistics
// @access  Private
router.get('/usage', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // This would require a usage tracking model in a real implementation
    // For now, we'll return basic rate limit info
    res.json({
      success: true,
      data: {
        hourlyLimit: 10,
        remainingRequests: 'Rate limit info not tracked in demo',
        resetTime: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
        costPerRequest: 0.001, // Rough estimate
        features: {
          campaignAnalysis: true,
          overallAnalysis: true,
          trendAnalysis: true,
          benchmarkComparison: true,
          actionableInsights: true
        }
      }
    });
  } catch (error) {
    console.error('❌ AI usage error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/ai-analysis/test-connection
// @desc    Test Perplexity AI connection
// @access  Private
router.post('/test-connection', auth, async (req, res) => {
  try {
    console.log(`🧪 Testing AI connection for user: ${req.user.id}`);

    if (!process.env.PERPLEXITY_API_KEY) {
      return res.status(503).json({
        success: false,
        message: 'Perplexity API key not configured',
        error: 'Service unavailable'
      });
    }

    // Test with a simple prompt
    const testMessages = [
      {
        role: "system",
        content: "You are a helpful assistant."
      },
      {
        role: "user",
        content: "Respond with exactly: 'Connection test successful'"
      }
    ];

    const response = await aiService.callPerplexityAPI(testMessages);
    
    res.json({
      success: true,
      message: 'AI connection test successful',
      data: {
        apiResponse: response,
        timestamp: new Date(),
        model: 'llama-3.1-sonar-small-128k-online'
      }
    });

  } catch (error) {
    console.error('❌ AI connection test error:', error);
    res.status(400).json({
      success: false,
      message: 'AI connection test failed',
      error: error.message
    });
  }
});

// @route   GET /api/ai-analysis/sample-insights
// @desc    Get sample AI insights for demo purposes
// @access  Private
router.get('/sample-insights', auth, async (req, res) => {
  try {
    const sampleInsights = {
      campaignInsights: {
        subject: "Your Weekly Newsletter - December Update",
        performance: "Above Average",
        insights: "This campaign performed exceptionally well with a 28.5% open rate, which is significantly higher than the industry average of 21.3% for newsletters. The subject line effectively created curiosity while maintaining professionalism. The Tuesday 10 AM send time appears optimal for your audience.",
        recommendations: [
          "Continue using curiosity-driven subject lines with dates for newsletters",
          "Maintain the Tuesday 10 AM send schedule as it shows strong engagement",
          "Consider A/B testing similar subject line formats for future campaigns",
          "The high click-to-open rate (15.2%) suggests strong content relevance - replicate this approach"
        ]
      },
      overallInsights: {
        summary: "Your email marketing program shows strong foundation with room for strategic improvements",
        keyFindings: [
          "Average open rate of 24.1% exceeds industry benchmark by 13%",
          "Click rates are consistent but could be improved with better CTAs",
          "Tuesday and Thursday sends show 18% higher engagement",
          "Promotional campaigns underperform compared to educational content"
        ],
        strategicRecommendations: [
          "Implement advanced segmentation to increase relevance",
          "Develop a content calendar focusing on educational topics",
          "Optimize send times based on audience time zones",
          "Create automated drip sequences for new subscribers",
          "A/B test subject lines more systematically"
        ]
      }
    };

    res.json({
      success: true,
      message: 'Sample AI insights generated',
      data: sampleInsights,
      note: 'These are sample insights for demo purposes'
    });

  } catch (error) {
    console.error('❌ Sample insights error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;