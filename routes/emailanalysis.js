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

module.exports = router;