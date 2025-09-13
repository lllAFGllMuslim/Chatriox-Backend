// services/AIAnalysisService.js
const axios = require('axios');
const Campaign = require('../models/Campaign');
const EmailActivity = require('../models/EmailActivity');

class AIAnalysisService {
  constructor() {
    this.perplexityApiUrl = 'https://api.perplexity.ai/chat/completions';
    this.apiKey = process.env.PERPLEXITY_API_KEY;
    this.model = 'sonar';

    if (!this.apiKey) {
      console.warn('⚠ PERPLEXITY_API_KEY not found in environment variables');
    }
  }

  async callPerplexityAPI(messages, options = {}) {
    if (!this.apiKey) {
      throw new Error('Perplexity API key not configured');
    }

    try {
      console.log('🤖 Calling Perplexity API with model:', this.model);

      const requestData = {
        model: this.model,
        messages: messages,
        max_tokens: 500,
        temperature: options.temperature || 0.1,
        top_p: options.topP || 0.8,
        return_citations: false,
        return_images: false,
        return_related_questions: false,
        search_recency_filter: 'month',
        stream: false,
        presence_penalty: 0,
        frequency_penalty: 1
      };

      console.log('📤 Request payload:', JSON.stringify(requestData, null, 2));

      const response = await axios.post(this.perplexityApiUrl, requestData, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 25000
      });

      console.log('📥 Raw API response:', JSON.stringify(response.data, null, 2));

      // Enhanced response validation with detailed logging
      if (!response.data) {
        console.error('❌ No response data received');
        throw new Error('No response data received from Perplexity API');
      }

      if (!response.data.choices) {
        console.error('❌ No choices array in response:', response.data);
        throw new Error('Invalid response structure: missing choices array');
      }

      if (!Array.isArray(response.data.choices)) {
        console.error('❌ Choices is not an array:', typeof response.data.choices);
        throw new Error('Invalid response structure: choices is not an array');
      }

      if (response.data.choices.length === 0) {
        console.error('❌ Empty choices array');
        throw new Error('Invalid response structure: empty choices array');
      }

      const firstChoice = response.data.choices[0];
      console.log('🔍 First choice structure:', JSON.stringify(firstChoice, null, 2));

      if (!firstChoice) {
        console.error('❌ First choice is undefined');
        throw new Error('Invalid response structure: first choice is undefined');
      }

      if (!firstChoice.message) {
        console.error('❌ No message in first choice:', firstChoice);
        throw new Error('Invalid response structure: missing message in first choice');
      }

      if (!firstChoice.message.content) {
        console.error('❌ No content in message:', firstChoice.message);
        throw new Error('Invalid response structure: missing content in message');
      }

      const content = firstChoice.message.content;
      console.log('✅ Successfully extracted content:', content.substring(0, 200) + '...');
      
      return content;

    } catch (error) {
      console.error('❌ Perplexity API error details:');
      console.error('Error type:', error.constructor.name);
      console.error('Error message:', error.message);
      
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response headers:', error.response.headers);
        console.error('Response data:', error.response.data);
      }
      
      if (error.request) {
        console.error('Request details:', {
          url: error.config?.url,
          method: error.config?.method,
          headers: error.config?.headers
        });
      }

      throw new Error(`AI analysis failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  async analyzeCampaign(campaignId, userId) {
    try {
      console.log(`🤖 Analyzing campaign: ${campaignId} for user: ${userId}`);

      const campaign = await Campaign.findOne({
        _id: campaignId,
        user: userId
      });

      if (!campaign) {
        return {
          success: false,
          error: 'Campaign not found or access denied'
        };
      }

      const activities = await EmailActivity.find({
        campaign: campaignId,
        user: userId
      }).sort({ createdAt: -1 });

      if (activities.length === 0) {
        return {
          success: false,
          error: 'No email activities found for this campaign'
        };
      }

      const metrics = this.calculateCampaignMetrics(activities);
      const analysisPrompt = this.createCampaignAnalysisPrompt(campaign, metrics);

      const messages = [
        {
          role: 'system',
          content: 'You are an email marketing expert. Analyze campaign performance and provide ONLY actionable recommendations that the client must fix to improve results. No insights or explanations - only specific fixes.'
        },
        {
          role: 'user',
          content: analysisPrompt
        }
      ];

      const aiResponse = await this.callPerplexityAPI(messages);
      const structured = this.parseAIResponse(aiResponse);

      return {
        success: true,
        data: {
          campaignId,
          campaignName: campaign.name,
          subject: campaign.subject,
          metrics,
          recommendations: structured.recommendations,
          riskAssessment: structured.riskAssessment,
          generatedAt: new Date(),
          rawResponse: aiResponse
        }
      };
    } catch (error) {
      console.error('❌ Campaign analysis error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async analyzeAllCampaigns(userId, timeRange = '30d') {
    try {
      console.log(`🤖 Analyzing all campaigns for user: ${userId}`);

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
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      const campaigns = await Campaign.find({
        user: userId,
        createdAt: { $gte: startDate },
        status: { $in: ['completed', 'failed', 'sending'] }
      });

      if (campaigns.length === 0) {
        return {
          success: false,
          error: 'No campaigns found in the specified time range'
        };
      }

      const campaignIds = campaigns.map((c) => c._id);
      const activities = await EmailActivity.find({
        campaign: { $in: campaignIds },
        user: userId,
        createdAt: { $gte: startDate }
      });

      if (activities.length === 0) {
        return {
          success: false,
          error: 'No email activities found for campaigns in this time range'
        };
      }

      const overallMetrics = this.calculateOverallMetrics(activities);
      const trends = this.calculateTrends(activities, timeRange);
      const analysisPrompt = this.createOverallAnalysisPrompt(
        overallMetrics,
        campaigns.length,
        trends,
        timeRange
      );

      const messages = [
        {
          role: 'system',
          content: 'You are an email marketing strategist. Analyze overall performance and provide ONLY critical fixes the client must implement immediately. No insights - only urgent action items to resolve performance issues.'
        },
        {
          role: 'user',
          content: analysisPrompt
        }
      ];

      const aiResponse = await this.callPerplexityAPI(messages);
      const structured = this.parseOverallAIResponse(aiResponse);

      return {
        success: true,
        data: {
          userId,
          timeRange,
          campaignCount: campaigns.length,
          totalEmails: activities.length,
          overallMetrics,
          trends,
          recommendations: structured.recommendations,
          riskAssessment: structured.riskAssessment,
          generatedAt: new Date(),
          rawResponse: aiResponse
        }
      };
    } catch (error) {
      console.error('❌ Overall analysis error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  calculateCampaignMetrics(activities) {
    const total = activities.length;
    if (total === 0) return {};

    const delivered = activities.filter((a) =>
      ['delivered', 'opened', 'clicked'].includes(a.status)
    ).length;
    const opened = activities.filter((a) => ['opened', 'clicked'].includes(a.status)).length;
    const clicked = activities.filter((a) => a.status === 'clicked').length;
    const bounced = activities.filter((a) => a.status === 'bounced').length;

    return {
      totalSent: total,
      delivered,
      opened,
      clicked,
      bounced,
      deliveryRate: delivered > 0 ? (delivered / total * 100).toFixed(2) : 0,
      openRate: delivered > 0 ? (opened / delivered * 100).toFixed(2) : 0,
      clickRate: opened > 0 ? (clicked / opened * 100).toFixed(2) : 0,
      bounceRate: total > 0 ? (bounced / total * 100).toFixed(2) : 0,
      clickToOpenRate: opened > 0 ? (clicked / opened * 100).toFixed(2) : 0
    };
  }

  calculateOverallMetrics(activities) {
    return this.calculateCampaignMetrics(activities);
  }

  calculateTrends(activities, timeRange) {
    const groupBy = timeRange === '7d' ? 'day' : timeRange === '30d' ? 'week' : 'month';

    const grouped = {};
    activities.forEach((activity) => {
      const date = new Date(activity.createdAt);
      let key;

      if (groupBy === 'day') {
        key = date.toISOString().split('T')[0];
      } else if (groupBy === 'week') {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        key = weekStart.toISOString().split('T')[0];
      } else {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      }

      if (!grouped[key]) {
        grouped[key] = { sent: 0, opened: 0, clicked: 0 };
      }

      grouped[key].sent++;
      if (['opened', 'clicked'].includes(activity.status)) {
        grouped[key].opened++;
      }
      if (activity.status === 'clicked') {
        grouped[key].clicked++;
      }
    });

    return {
      engagementTrend: this.calculateEngagementTrend(grouped),
      averageOpenRate: this.calculateAverageMetric(grouped, 'opened', 'sent'),
      averageClickRate: this.calculateAverageMetric(grouped, 'clicked', 'opened')
    };
  }

  calculateAverageMetric(grouped, numerator, denominator) {
    const values = Object.values(grouped);
    const totalNum = values.reduce((sum, val) => sum + val[numerator], 0);
    const totalDen = values.reduce((sum, val) => sum + val[denominator], 0);

    return totalDen > 0 ? (totalNum / totalDen * 100).toFixed(2) : 0;
  }

  calculateEngagementTrend(grouped) {
    const sortedKeys = Object.keys(grouped).sort();
    if (sortedKeys.length < 2) return 'insufficient_data';

    const firstHalf = sortedKeys.slice(0, Math.floor(sortedKeys.length / 2));
    const secondHalf = sortedKeys.slice(Math.floor(sortedKeys.length / 2));

    const firstHalfRate = this.calculateAverageMetricForKeys(grouped, firstHalf, 'opened', 'sent');
    const secondHalfRate = this.calculateAverageMetricForKeys(grouped, secondHalf, 'opened', 'sent');

    if (secondHalfRate > firstHalfRate * 1.05) return 'improving';
    if (secondHalfRate < firstHalfRate * 0.95) return 'declining';
    return 'stable';
  }

  calculateAverageMetricForKeys(grouped, keys, numerator, denominator) {
    const totalNum = keys.reduce((sum, key) => sum + grouped[key][numerator], 0);
    const totalDen = keys.reduce((sum, key) => sum + grouped[key][denominator], 0);
    return totalDen > 0 ? (totalNum / totalDen * 100) : 0;
  }

  createCampaignAnalysisPrompt(campaign, metrics) {
    return `URGENT: Campaign "${campaign.name}" needs immediate fixes.

Subject Line: "${campaign.subject}"

CRITICAL PERFORMANCE ISSUES:
- ${metrics.totalSent} emails sent, only ${metrics.deliveryRate}% delivered
- Open rate: ${metrics.openRate}% (Industry standard: 20-25%)
- Click rate: ${metrics.clickRate}% (Industry standard: 2-5%) 
- Bounce rate: ${metrics.bounceRate}% (Should be <2%)
- Click-to-open rate: ${metrics.clickToOpenRate}% (Should be 10-15%)

CLIENT MUST FIX THESE 7 CRITICAL ISSUES IMMEDIATELY:
Provide exactly 7 high-priority action items in this format:
"HIGH: [Specific fix the client must implement]"
"MEDIUM: [Specific fix the client must implement]"
"LOW: [Specific fix the client must implement]"

Focus on fixes for deliverability, subject lines, content, timing, and list hygiene.`;
  }

  createOverallAnalysisPrompt(metrics, campaignCount, trends, timeRange) {
    return `URGENT: Email program requires immediate intervention (${timeRange} analysis).

CRITICAL PROGRAM FAILURES:
- ${campaignCount} campaigns sent ${metrics.totalSent} emails
- Overall delivery rate: ${metrics.deliveryRate}%
- Program-wide open rate: ${metrics.openRate}%
- Program-wide click rate: ${metrics.clickRate}%
- Bounce rate crisis: ${metrics.bounceRate}%
- Performance trend: ${trends.engagementTrend}

CLIENT MUST FIX THESE 7 CRITICAL PROGRAM ISSUES:
Provide exactly 7 urgent fixes in this format:
"HIGH: [Critical system fix required]"
"MEDIUM: [Important process fix needed]" 
"LOW: [Optimization fix recommended]"

Focus on infrastructure, automation, segmentation, and ROI optimization fixes.`;
  }

  parseAIResponse(response) {
    const items = this.extractPriorityRecommendations(response);
    return {
      recommendations: items.map((i) => ({
        priority: i.riskLevel,
        action: i.recommendation
      })),
      riskAssessment: items.reduce((acc, i) => {
        acc[i.riskLevel.toLowerCase()] = (acc[i.riskLevel.toLowerCase()] || 0) + 1;
        return acc;
      }, {})
    };
  }

  parseOverallAIResponse(response) {
    const items = this.extractPriorityRecommendations(response);
    return {
      recommendations: items.map((i) => ({
        priority: i.riskLevel,
        action: i.recommendation
      })),
      riskAssessment: items.reduce((acc, i) => {
        acc[i.riskLevel.toLowerCase()] = (acc[i.riskLevel.toLowerCase()] || 0) + 1;
        return acc;
      }, {})
    };
  }

  extractPriorityRecommendations(text) {
    const recs = [];

    // Extract priority-based recommendations
    const recPattern = /(HIGH|MEDIUM|LOW)\s*[:\-]\s*(.*?)(?=\n(?:HIGH|MEDIUM|LOW)|$)/gi;
    const matches = [...text.matchAll(recPattern)];
    
    for (const match of matches) {
      const [, riskLevel, recommendation] = match;
      const cleaned = this.cleanText(recommendation || '');
      if (cleaned.length > 10) {
        recs.push({ 
          riskLevel: riskLevel.toUpperCase(), 
          recommendation: `Fix required: ${cleaned}`
        });
      }
    }

    // Fallback for unstructured responses
    if (recs.length < 7) {
      const lines = text.split('\n').filter(line => line.trim().length > 20);
      for (const line of lines.slice(0, 7 - recs.length)) {
        const cleaned = this.cleanText(line);
        if (cleaned.length > 20) {
          recs.push({
            riskLevel: 'MEDIUM',
            recommendation: `Action needed: ${cleaned}`
          });
        }
      }
    }

    // Ensure we have exactly 7 recommendations
    const defaultFixes = [
      'Implement email authentication (SPF, DKIM, DMARC)',
      'Clean email list and remove invalid addresses',
      'A/B test subject lines for better open rates',
      'Optimize send timing based on audience timezone',
      'Segment email list for personalized content',
      'Set up automated re-engagement campaigns',
      'Monitor and improve email deliverability score'
    ];

    while (recs.length < 7) {
      recs.push({
        riskLevel: 'LOW',
        recommendation: `Critical fix: ${defaultFixes[recs.length % defaultFixes.length]}`
      });
    }

    const priorityOrder = { HIGH: 1, MEDIUM: 2, LOW: 3 };
    return recs.sort((a, b) => priorityOrder[a.riskLevel] - priorityOrder[b.riskLevel]).slice(0, 7);
  }

  cleanText(text) {
    return text
      .replace(/^[^a-zA-Z]*/, '')
      .replace(/[.!?]*$/, '')
      .trim()
      .replace(/\s+/g, ' ')
      .substring(0, 200)
      .trim();
  }
}

module.exports = AIAnalysisService;