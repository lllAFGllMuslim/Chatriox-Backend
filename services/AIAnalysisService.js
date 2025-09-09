// services/AIAnalysisService.js
const axios = require('axios');
const Campaign = require('../models/Campaign');
const EmailActivity = require('../models/EmailActivity');

class AIAnalysisService {
  constructor() {
    this.perplexityApiUrl = 'https://api.perplexity.ai/chat/completions';
    this.apiKey = process.env.PERPLEXITY_API_KEY;
    // Updated to use current valid model
    this.model = 'sonar'; 
    
    if (!this.apiKey) {
      console.warn('⚠️ PERPLEXITY_API_KEY not found in environment variables');
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
        max_tokens: 700,
        temperature: options.temperature || 0.2,
        top_p: options.topP || 0.9,
        return_citations: true,
        search_domain_filter: ["perplexity.ai"],
        return_images: false,
        return_related_questions: false,
        search_recency_filter: "month",
        top_k: 0,
        stream: false,
        presence_penalty: 0,
        frequency_penalty: 1
      };

      const response = await axios.post(this.perplexityApiUrl, requestData, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 seconds timeout
      });

      if (response.data && response.data.choices && response.data.choices[0]) {
        return response.data.choices[0].message.content;
      } else {
        throw new Error('Invalid response structure from Perplexity API');
      }

    } catch (error) {
      console.error('❌ Perplexity API error:', error.response?.data || error.message);
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

      // Get email activities for this campaign
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

      // Calculate campaign metrics
      const metrics = this.calculateCampaignMetrics(activities);

      // Create analysis prompt
      const analysisPrompt = this.createCampaignAnalysisPrompt(campaign, metrics, activities);

      const messages = [
        {
          role: "system",
          content: "You are an expert email marketing analyst. Provide detailed, actionable insights based on campaign performance data. Focus on practical recommendations that can improve future campaigns."
        },
        {
          role: "user",
          content: analysisPrompt
        }
      ];

      // Get AI analysis
      const aiResponse = await this.callPerplexityAPI(messages);

      // Parse the response into structured data
      const structuredInsights = this.parseAIResponse(aiResponse);

      return {
        success: true,
        data: {
          campaignId,
          campaignName: campaign.name,
          subject: campaign.subject,
          metrics,
          insights: structuredInsights.insights,
          recommendations: structuredInsights.recommendations,
          performance: structuredInsights.performance,
          benchmarks: structuredInsights.benchmarks,
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
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      // Get all campaigns in the time range - Remove template population or make it conditional
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

      // Get all email activities for these campaigns
      const campaignIds = campaigns.map(c => c._id);
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

      // Calculate overall metrics
      const overallMetrics = this.calculateOverallMetrics(activities);
      const campaignAnalysis = this.analyzeCampaignPerformance(campaigns, activities);
      const trends = this.calculateTrends(activities, timeRange);

      // Create comprehensive analysis prompt
      const analysisPrompt = this.createOverallAnalysisPrompt(
        overallMetrics,
        campaignAnalysis,
        trends,
        timeRange
      );

      const messages = [
        {
          role: "system",
          content: "You are a senior email marketing strategist with expertise in campaign optimization, audience engagement, and performance analysis. Provide strategic insights that help businesses improve their email marketing ROI."
        },
        {
          role: "user",
          content: analysisPrompt
        }
      ];

      // Get AI analysis
      const aiResponse = await this.callPerplexityAPI(messages);

      // Parse the response
      const structuredInsights = this.parseOverallAIResponse(aiResponse);

      return {
        success: true,
        data: {
          userId,
          timeRange,
          campaignCount: campaigns.length,
          totalEmails: activities.length,
          overallMetrics,
          trends,
          insights: structuredInsights.insights,
          strategicRecommendations: structuredInsights.strategicRecommendations,
          keyFindings: structuredInsights.keyFindings,
          priorityActions: structuredInsights.priorityActions,
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

    const delivered = activities.filter(a => ['delivered', 'opened', 'clicked'].includes(a.status)).length;
    const opened = activities.filter(a => ['opened', 'clicked'].includes(a.status)).length;
    const clicked = activities.filter(a => a.status === 'clicked').length;
    const bounced = activities.filter(a => a.status === 'bounced').length;

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

  analyzeCampaignPerformance(campaigns, activities) {
    return campaigns.map(campaign => {
      const campaignActivities = activities.filter(a => 
        a.campaign && a.campaign.toString() === campaign._id.toString()
      );
      const metrics = this.calculateCampaignMetrics(campaignActivities);
      
      return {
        id: campaign._id,
        name: campaign.name,
        subject: campaign.subject,
        createdAt: campaign.createdAt,
        metrics,
        templateName: campaign.settings?.templateId || 'Unknown'
      };
    });
  }

  calculateTrends(activities, timeRange) {
    // Group activities by day/week based on timeRange
    const groupBy = timeRange === '7d' ? 'day' : timeRange === '30d' ? 'week' : 'month';
    
    const grouped = {};
    activities.forEach(activity => {
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
      dailyEngagement: grouped,
      averageOpenRate: this.calculateAverageMetric(grouped, 'opened', 'sent'),
      averageClickRate: this.calculateAverageMetric(grouped, 'clicked', 'opened'),
      engagementTrend: this.calculateEngagementTrend(grouped)
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

  createCampaignAnalysisPrompt(campaign, metrics, activities) {
    return `
Analyze this email campaign performance:

CAMPAIGN DETAILS:
- Name: ${campaign.name}
- Subject: ${campaign.subject}
- Template: ${campaign.settings?.templateId?.name || campaign.templateName || 'Custom'}
- Sent Date: ${campaign.createdAt}

PERFORMANCE METRICS:
- Total Sent: ${metrics.totalSent}
- Delivery Rate: ${metrics.deliveryRate}%
- Open Rate: ${metrics.openRate}%
- Click Rate: ${metrics.clickRate}%
- Bounce Rate: ${metrics.bounceRate}%
- Click-to-Open Rate: ${metrics.clickToOpenRate}%

ANALYSIS REQUEST:
1. Evaluate this campaign's performance against industry benchmarks
2. Identify what worked well and what could be improved
3. Provide specific, actionable recommendations for similar future campaigns
4. Consider subject line effectiveness, send timing, and content engagement

Please provide insights in a structured format covering performance assessment, key insights, and specific recommendations.
    `.trim();
  }

  createOverallAnalysisPrompt(metrics, campaignAnalysis, trends, timeRange) {
    const topCampaigns = campaignAnalysis
      .sort((a, b) => parseFloat(b.metrics.openRate) - parseFloat(a.metrics.openRate))
      .slice(0, 5);

    return `
Analyze this email marketing program performance over the last ${timeRange}:

OVERALL METRICS:
- Total Emails Sent: ${metrics.totalSent}
- Average Delivery Rate: ${metrics.deliveryRate}%
- Average Open Rate: ${metrics.openRate}%
- Average Click Rate: ${metrics.clickRate}%
- Average Bounce Rate: ${metrics.bounceRate}%

CAMPAIGN SUMMARY:
- Total Campaigns: ${campaignAnalysis.length}
- Engagement Trend: ${trends.engagementTrend}

TOP PERFORMING CAMPAIGNS:
${topCampaigns.map(c => `- ${c.name}: ${c.metrics.openRate}% open rate, ${c.metrics.clickRate}% click rate`).join('\n')}

ANALYSIS REQUEST:
1. Provide strategic recommendations for program improvement
2. Suggest optimization opportunities for better ROI
3. Recommend testing strategies and best practices

Please provide comprehensive insights covering program assessment, key findings, strategic recommendations, and priority actions.
    `.trim();
  }

  // UPDATED PARSING METHODS - MAIN CHANGES HERE
  parseAIResponse(response) {
    const insights = this.extractKeyInsights(response, 5, 10); // 5-10 points
    const recommendations = this.extractRecommendations(response, 3, 5); // 3-5 points
    
    return {
      insights: this.limitWordCount(insights, 200), 
      recommendations: this.limitWordCount(recommendations, 150), // ~80 words for recommendations
      performance: this.extractPerformanceAssessment(response),
      benchmarks: this.extractBenchmarks(response)
    };
  }

  parseOverallAIResponse(response) {
    const insights = this.extractKeyInsights(response, 6, 10); // 6-10 points for overall analysis
    const recommendations = this.extractRecommendations(response, 3, 5); // 3-5 strategic recommendations
    
    return {
      insights: this.limitWordCount(insights, 120),
      strategicRecommendations: this.limitWordCount(recommendations, 80),
      keyFindings: this.extractKeyFindings(response, 3, 5),
      priorityActions: this.extractPriorityActions(response, 2, 4)
    };
  }

  extractKeyInsights(text, minPoints = 5, maxPoints = 10) {
    const insights = [];
    
    // Look for insights in different patterns
    const patterns = [
      /(?:insight|finding|result|shows|indicates|reveals|demonstrates)[:\-\s]*([^.!?]+[.!?])/gi,
      /(?:performance|engagement|campaign)[:\-\s]*([^.!?]+[.!?])/gi,
      /(?:rate|percentage|metric)[:\-\s]*([^.!?]+[.!?])/gi
    ];
    
    patterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach(match => {
          const clean = match.replace(/^[^a-zA-Z]*/, '').trim();
          if (clean.length > 15 && clean.length < 100 && !insights.includes(clean)) {
            insights.push(clean);
          }
        });
      }
    });
    
    // If not enough insights found, extract from sentences
    if (insights.length < minPoints) {
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
      sentences.forEach(sentence => {
        const trimmed = sentence.trim();
        if (trimmed.length > 15 && trimmed.length < 120 && 
            !insights.some(insight => insight.toLowerCase().includes(trimmed.toLowerCase().substring(0, 20)))) {
          insights.push(trimmed + '.');
        }
      });
    }
    
    // Return the specified number of insights
    return insights.slice(0, maxPoints).slice(0, Math.max(minPoints, insights.length));
  }

  extractRecommendations(text, minRecs = 3, maxRecs = 5) {
    const recommendations = [];
    
    // Look for recommendation patterns
    const patterns = [
      /(?:recommend|suggest|should|consider|improve|optimize|try)[:\-\s]*([^.!?]+[.!?])/gi,
      /(?:^|\n)\s*[\-\•\*]\s*([^.!?\n]+)/gm,
      /(?:^|\n)\s*\d+\.\s*([^.!?\n]+)/gm
    ];
    
    patterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach(match => {
          let clean = match.replace(/^[^a-zA-Z]*/, '').replace(/^(recommend|suggest|should|consider|improve|optimize|try)[:\-\s]*/i, '').trim();
          if (clean.length > 10 && clean.length < 150 && !recommendations.includes(clean)) {
            // Ensure it ends with proper punctuation
            if (!clean.endsWith('.') && !clean.endsWith('!') && !clean.endsWith('?')) {
              clean += '.';
            }
            recommendations.push(clean);
          }
        });
      }
    });
    
    // If not enough recommendations, look for action-oriented sentences
    if (recommendations.length < minRecs) {
      const actionWords = ['increase', 'decrease', 'test', 'focus', 'target', 'avoid', 'use', 'implement'];
      const sentences = text.split(/[.!?]+/);
      
      sentences.forEach(sentence => {
        const trimmed = sentence.trim();
        const hasActionWord = actionWords.some(word => trimmed.toLowerCase().includes(word));
        
        if (hasActionWord && trimmed.length > 15 && trimmed.length < 120 && 
            !recommendations.some(rec => rec.toLowerCase().includes(trimmed.toLowerCase().substring(0, 15)))) {
          recommendations.push(trimmed + '.');
        }
      });
    }
    
    return recommendations.slice(0, maxRecs).slice(0, Math.max(minRecs, recommendations.length));
  }

  extractKeyFindings(text, minFindings = 3, maxFindings = 5) {
    const findings = [];
    
    const patterns = [
      /(?:finding|discovered|observed|noted)[:\-\s]*([^.!?]+[.!?])/gi,
      /(?:data shows|analysis reveals|results indicate)[:\-\s]*([^.!?]+[.!?])/gi
    ];
    
    patterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach(match => {
          const clean = match.replace(/^[^a-zA-Z]*/, '').trim();
          if (clean.length > 15 && clean.length < 100 && !findings.includes(clean)) {
            findings.push(clean);
          }
        });
      }
    });
    
    return findings.slice(0, maxFindings).slice(0, Math.max(minFindings, findings.length));
  }

  extractPerformanceAssessment(text) {
    if (text.toLowerCase().includes('excellent') || text.toLowerCase().includes('outstanding')) {
      return 'Excellent';
    } else if (text.toLowerCase().includes('good') || text.toLowerCase().includes('above average')) {
      return 'Above Average';
    } else if (text.toLowerCase().includes('average') || text.toLowerCase().includes('typical')) {
      return 'Average';
    } else if (text.toLowerCase().includes('below') || text.toLowerCase().includes('poor')) {
      return 'Below Average';
    }
    return 'Mixed Results';
  }

  extractBenchmarks(text) {
    // Extract any mentioned benchmarks or industry standards
    const benchmarkMatches = text.match(/(\d+\.?\d*)%/g);
    return benchmarkMatches ? benchmarkMatches.slice(0, 3) : [];
  }

  extractPriorityActions(text, minActions = 2, maxActions = 4) {
    const actions = [];
    
    const priorityWords = ['priority', 'urgent', 'immediate', 'critical', 'important', 'first', 'next', 'start', 'begin', 'implement'];
    const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 15);
    
    sentences.forEach(sentence => {
      const hasPriorityWord = priorityWords.some(word => sentence.toLowerCase().includes(word));
      
      if (hasPriorityWord && sentence.length > 15 && sentence.length < 150) {
        let cleanSentence = sentence.replace(/^\s*[^a-zA-Z]*/, '').trim();
        cleanSentence = cleanSentence.charAt(0).toUpperCase() + cleanSentence.slice(1);
        
        if (!actions.some(action => action.toLowerCase().includes(cleanSentence.toLowerCase().substring(0, 15)))) {
          actions.push(cleanSentence);
        }
      }
    });
    
    return actions.slice(0, maxActions);
  }

  // NEW METHOD: Format everything as clean bullet points
  formatAsPoints(items) {
    if (!Array.isArray(items)) return items;
    
    return items.map(item => {
      // Remove any existing bullet points or numbers
      let cleaned = item.replace(/^[\s\-\•\*\d\.\)]*/, '').trim();
      
      // Ensure proper capitalization
      if (cleaned.length > 0) {
        cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
      }
      
      // Ensure it ends with period if it doesn't have punctuation
      if (cleaned && !cleaned.match(/[.!?]$/)) {
        cleaned += '.';
      }
      
      return cleaned;
    }).filter(item => item.length > 10); // Filter out too short items
  }

  limitWordCount(items, maxWords) {
    if (!Array.isArray(items)) return items;
    
    let totalWords = 0;
    const result = [];
    
    for (const item of items) {
      const words = item.split(/\s+/).length;
      if (totalWords + words <= maxWords) {
        result.push(item);
        totalWords += words;
      } else {
        // Try to fit a shortened version
        const remainingWords = maxWords - totalWords;
        if (remainingWords > 8) {
          const shortened = item.split(/\s+/).slice(0, remainingWords - 2).join(' ') + '...';
          result.push(shortened);
        }
        break;
      }
    }
    
    return result;
  }
}

module.exports = AIAnalysisService;