const axios = require('axios');
const EmailTemplate = require('../models/EmailTemplate');

class AITemplateService {
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
      console.log('🤖 Calling Perplexity API for template generation');

      const requestData = {
        model: this.model,
        messages: messages,
        max_tokens: options.maxTokens || 1000,
        temperature: options.temperature || 0.7,
        top_p: options.topP || 0.9,
        return_citations: false,
        return_images: false,
        return_related_questions: false,
        search_recency_filter: 'month',
        stream: false,
        presence_penalty: 0,
        frequency_penalty: 0.5
      };

      const response = await axios.post(this.perplexityApiUrl, requestData, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      if (!response.data?.choices?.[0]?.message?.content) {
        throw new Error('Invalid response structure from AI API');
      }

      return response.data.choices[0].message.content;

    } catch (error) {
      console.error('❌ AI Template Generation Error:', error.message);
      throw new Error(`AI template generation failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  async generateTemplate(prompt, category, tone = 'professional', length = 'medium', industry = '', requirements = '') {
    try {
      console.log(`🤖 Generating template: ${category} - ${tone} - ${length}`);

      const templatePrompt = this.createTemplatePrompt({
        prompt,
        category,
        tone,
        length,
        industry,
        requirements
      });

      const messages = [
        {
          role: 'system',
          content: 'You are an expert email template designer. Create professional, responsive HTML email templates with modern design practices. Always include proper CSS styling and mobile optimization.'
        },
        {
          role: 'user',
          content: templatePrompt
        }
      ];

      const response = await this.callPerplexityAPI(messages, { 
        temperature: 0.8,
        maxTokens: 1500 
      });
      
      return this.parseTemplateResponse(response);

    } catch (error) {
      console.error('❌ Template generation error:', error);
      throw error;
    }
  }

  async improveTemplate(existingTemplate, improvements) {
    try {
      console.log(`🤖 Improving template: ${existingTemplate.name}`);

      const improvementPrompt = this.createImprovementPrompt(existingTemplate, improvements);

      const messages = [
        {
          role: 'system',
          content: 'You are an email marketing optimization expert. Improve existing email templates based on specific feedback while maintaining the core design and structure.'
        },
        {
          role: 'user',
          content: improvementPrompt
        }
      ];

      const response = await this.callPerplexityAPI(messages, { 
        temperature: 0.6,
        maxTokens: 1200 
      });
      
      return this.parseTemplateResponse(response);

    } catch (error) {
      console.error('❌ Template improvement error:', error);
      throw error;
    }
  }

  async generateSubjectLines(content, category, tone = 'professional', count = 5) {
    try {
      console.log(`🤖 Generating ${count} subject lines for ${category} - ${tone}`);

      const subjectPrompt = this.createSubjectPrompt(content, category, tone, count);

      const messages = [
        {
          role: 'system',
          content: 'You are a copywriting expert specializing in email subject lines. Create compelling subject lines that maximize open rates while avoiding spam triggers.'
        },
        {
          role: 'user',
          content: subjectPrompt
        }
      ];

      const response = await this.callPerplexityAPI(messages, { 
        temperature: 0.9,
        maxTokens: 300 
      });

      return this.parseSubjectLinesResponse(response);

    } catch (error) {
      console.error('❌ Subject line generation error:', error);
      throw error;
    }
  }

  createTemplatePrompt({ prompt, category, tone, length, industry, requirements }) {
    return `Create a professional HTML email template with the following specifications:

PURPOSE: ${prompt}
CATEGORY: ${category}
TONE: ${tone}
LENGTH: ${length}
INDUSTRY: ${industry || 'General business'}
SPECIAL REQUIREMENTS: ${requirements || 'Standard email best practices'}

REQUIREMENTS:
1. Create a complete HTML email template with inline CSS
2. Make it mobile-responsive using media queries
3. Include a clear call-to-action button
4. Use modern, clean design with proper spacing
5. Include placeholder content with {{variable}} syntax for personalization
6. Follow email client compatibility best practices
7. Include proper alt text for images
8. Use web-safe fonts and colors
9. Optimize for both desktop and mobile viewing
10. Include unsubscribe footer

STRUCTURE REQUIRED:
- Header section
- Main content area
- Call-to-action section  
- Footer with unsubscribe

Return ONLY the HTML template code, no explanations or additional text.`;
  }

  createImprovementPrompt(template, improvements) {
    return `Improve this existing email template based on the feedback provided:

CURRENT TEMPLATE:
Subject: ${template.subject}
HTML: ${template.htmlContent}

IMPROVEMENT REQUESTS:
${improvements}

INSTRUCTIONS:
1. Keep the overall structure and branding consistent
2. Apply the requested improvements while maintaining email best practices
3. Ensure mobile responsiveness is maintained
4. Keep all existing {{variable}} placeholders
5. Optimize for better engagement and conversion

Return the improved HTML template code only, no explanations.`;
  }

  createSubjectPrompt(content, category, tone, count) {
    const contentPreview = content.replace(/<[^>]*>/g, '').substring(0, 300);
    
    return `Generate ${count} compelling email subject lines for this ${category} email:

EMAIL CONTENT PREVIEW: ${contentPreview}...
TONE: ${tone}
CATEGORY: ${category}

REQUIREMENTS:
1. Maximum 50 characters per subject line
2. Avoid spam trigger words
3. Create urgency or curiosity where appropriate
4. Match the ${tone} tone
5. Optimize for high open rates
6. Include power words and emotional triggers
7. Vary the approach (question, statement, urgency, benefit, etc.)

Return only the subject lines, one per line, numbered 1-${count}.`;
  }

  parseTemplateResponse(response) {
    try {
      // Extract HTML content from the response
      let htmlMatch = response.match(/```html\n?([\s\S]*?)\n?```/i);
      if (!htmlMatch) {
        htmlMatch = response.match(/<html[\s\S]*<\/html>/i);
      }
      
      const htmlContent = htmlMatch ? htmlMatch[1] || htmlMatch[0] : response;
      
      // Extract subject line if present
      const subjectMatch = response.match(/subject:\s*(.+)/i);
      const subject = subjectMatch ? subjectMatch[1].trim().replace(/["']/g, '') : '';

      // Clean up the HTML
      const cleanedHtml = this.cleanHtmlTemplate(htmlContent);
      
      return {
        htmlContent: cleanedHtml,
        subject: subject || 'New AI Generated Email Template',
        textContent: this.htmlToText(cleanedHtml)
      };
    } catch (error) {
      console.error('❌ Error parsing template response:', error);
      throw new Error('Failed to parse AI-generated template');
    }
  }

  parseSubjectLinesResponse(response) {
    try {
      const lines = response.split('\n').filter(line => line.trim());
      const subjectLines = [];

      for (const line of lines) {
        const cleaned = line.replace(/^\d+\.\s*/, '').replace(/^-\s*/, '').trim().replace(/["']/g, '');
        if (cleaned.length > 5 && cleaned.length <= 100) {
          subjectLines.push(cleaned);
        }
      }

      return subjectLines.slice(0, 10); // Return max 10 subject lines
    } catch (error) {
      console.error('❌ Error parsing subject lines:', error);
      return ['New Email Campaign', 'Important Update', 'Don\'t Miss Out'];
    }
  }

  cleanHtmlTemplate(html) {
    // Remove any explanatory text and keep only HTML
    let cleaned = html
      .replace(/^[^<]*/, '') // Remove text before first HTML tag
      .replace(/>[^<]*$/, '>') // Remove text after last HTML tag
      .replace(/```html/gi, '')
      .replace(/```/g, '')
      .trim();

    // Ensure we have a complete HTML structure
    if (!cleaned.includes('<html')) {
      cleaned = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Email Template</title>
</head>
<body>
${cleaned}
</body>
</html>`;
    }

    return cleaned;
  }

  htmlToText(html) {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 1000);
  }
}

module.exports = AITemplateService;