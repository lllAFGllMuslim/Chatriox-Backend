const EmailTemplate = require('../models/EmailTemplate');
const AITemplateService = require('../services/AITemplateService');
const aiService = new AITemplateService();

// Get all templates with filtering and pagination
const getTemplates = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 12,
      category,
      search,
      tags,
      isPublic,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const filter = {};

    // User can see their own templates + public templates
    filter.$or = [
      { user: req.user._id },
      { isPublic: true }
    ];

    if (category) filter.category = category;
    if (isPublic !== undefined) filter.isPublic = isPublic === 'true';
    if (tags) filter.tags = { $in: tags.split(',') };
    if (search) {
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { subject: { $regex: search, $options: 'i' } },
          { tags: { $regex: search, $options: 'i' } }
        ]
      });
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const templates = await EmailTemplate.find(filter)
      .populate('user', 'name email')
      .populate('parentTemplate', 'name')
      .select('-htmlContent -textContent') // Exclude large content fields for list view
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await EmailTemplate.countDocuments(filter);

    res.json({
      success: true,
      data: templates,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
        limit
      }
    });
  } catch (error) {
    console.error('❌ Get templates error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get single template by ID
const getTemplate = async (req, res) => {
  try {
    const template = await EmailTemplate.findById(req.params.id)
      .populate('user', 'name email')
      .populate('parentTemplate', 'name subject');

    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    // Check permission - user can view their own templates or public templates
    if (template.user._id.toString() !== req.user._id.toString() && !template.isPublic) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Increment view count
    template.incrementViews();

    res.json({ success: true, data: template });
  } catch (error) {
    console.error('❌ Get template error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create new template
const createTemplate = async (req, res) => {
  try {
    const templateData = {
      ...req.body,
      user: req.user._id
    };

    const template = new EmailTemplate(templateData);
    await template.save();

    const populatedTemplate = await EmailTemplate.findById(template._id)
      .populate('user', 'name email');

    res.status(201).json({ success: true, data: populatedTemplate });
  } catch (error) {
    console.error('❌ Create template error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

// Update template
const updateTemplate = async (req, res) => {
  try {
    const template = await EmailTemplate.findById(req.params.id);

    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    // Check permission
    if (template.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Update fields
    Object.keys(req.body).forEach(key => {
      if (req.body[key] !== undefined) {
        template[key] = req.body[key];
      }
    });

    await template.save();

    const updatedTemplate = await EmailTemplate.findById(template._id)
      .populate('user', 'name email');

    res.json({ success: true, data: updatedTemplate });
  } catch (error) {
    console.error('❌ Update template error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
};

// Delete template
const deleteTemplate = async (req, res) => {
  try {
    const template = await EmailTemplate.findById(req.params.id);

    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    // Check permission
    if (template.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    await template.deleteOne();
    res.json({ success: true, message: 'Template deleted successfully' });
  } catch (error) {
    console.error('❌ Delete template error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// AI Generate template
const generateTemplate = async (req, res) => {
  try {
    const { prompt, category, tone, length, industry, requirements, name } = req.body;

    if (!prompt || !category) {
      return res.status(400).json({ 
        success: false, 
        error: 'Prompt and category are required' 
      });
    }

    console.log(`🤖 Generating AI template for user: ${req.user._id}`);

    const aiResult = await aiService.generateTemplate(
      prompt, 
      category, 
      tone, 
      length, 
      industry, 
      requirements
    );

    const templateData = {
      name: name || `AI Generated ${category} Template`,
      subject: aiResult.subject,
      htmlContent: aiResult.htmlContent,
      textContent: aiResult.textContent,
      category,
      tone: tone || 'professional',
      length: length || 'medium',
      industry: industry || '',
      aiGenerated: true,
      aiPrompt: prompt,
      user: req.user._id,
      tags: ['ai-generated', category, tone].filter(Boolean)
    };

    const template = new EmailTemplate(templateData);
    await template.save();

    const populatedTemplate = await EmailTemplate.findById(template._id)
      .populate('user', 'name email');

    res.status(201).json({ success: true, data: populatedTemplate });
  } catch (error) {
    console.error('❌ AI template generation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Improve existing template with AI
const improveTemplate = async (req, res) => {
  try {
    const { improvements } = req.body;
    
    const template = await EmailTemplate.findById(req.params.id);

    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    if (template.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    console.log(`🤖 Improving template: ${template.name}`);

    const aiResult = await aiService.improveTemplate(template, improvements);

    // Create new version or update existing
    template.htmlContent = aiResult.htmlContent;
    template.textContent = aiResult.textContent;
    template.subject = aiResult.subject || template.subject;
    template.version += 1;
    
    await template.save();

    const updatedTemplate = await EmailTemplate.findById(template._id)
      .populate('user', 'name email');

    res.json({ success: true, data: updatedTemplate });
  } catch (error) {
    console.error('❌ Template improvement error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Clone template
const cloneTemplate = async (req, res) => {
  try {
    const { name } = req.body;
    
    const original = await EmailTemplate.findById(req.params.id);

    if (!original) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    // Check permission to clone (can clone own templates or public templates)
    if (original.user.toString() !== req.user._id.toString() && !original.isPublic) {
      return res.status(403).json({ success: false, error: 'Cannot clone this template' });
    }

    const clonedData = {
      name: name || `Copy of ${original.name}`,
      subject: original.subject,
      htmlContent: original.htmlContent,
      textContent: original.textContent,
      category: original.category,
      tags: [...original.tags, 'cloned'],
      tone: original.tone,
      length: original.length,
      industry: original.industry,
      user: req.user._id,
      parentTemplate: original._id,
      aiGenerated: false
    };

    const clonedTemplate = new EmailTemplate(clonedData);
    await clonedTemplate.save();

    const populatedClone = await EmailTemplate.findById(clonedTemplate._id)
      .populate('user', 'name email')
      .populate('parentTemplate', 'name');

    res.status(201).json({ success: true, data: populatedClone });
  } catch (error) {
    console.error('❌ Clone template error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get template categories with counts
const getCategories = async (req, res) => {
  try {
    const pipeline = [
      {
        $match: {
          $or: [
            { user: req.user._id },
            { isPublic: true }
          ]
        }
      },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          lastUsed: { $max: '$updatedAt' }
        }
      },
      {
        $sort: { count: -1 }
      }
    ];

    const categories = await EmailTemplate.aggregate(pipeline);

    res.json({ success: true, data: categories });
  } catch (error) {
    console.error('❌ Get categories error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Generate subject lines for template
const generateSubjectLines = async (req, res) => {
  try {
    const { count = 5 } = req.body;
    
    const template = await EmailTemplate.findById(req.params.id);

    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    if (template.user.toString() !== req.user._id.toString() && !template.isPublic) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    console.log(`🤖 Generating ${count} subject lines for template: ${template.name}`);

    const subjectLines = await aiService.generateSubjectLines(
      template.htmlContent,
      template.category,
      template.tone,
      count
    );

    res.json({ success: true, data: subjectLines });
  } catch (error) {
    console.error('❌ Generate subject lines error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Preview template with test data
const previewTemplate = async (req, res) => {
  try {
    const { testData = {} } = req.body;
    
    const template = await EmailTemplate.findById(req.params.id);

    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    if (template.user.toString() !== req.user._id.toString() && !template.isPublic) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Default test data
    const defaultData = {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@example.com',
      companyName: 'Acme Corp',
      productName: 'Our Product',
      currentDate: new Date().toLocaleDateString(),
      unsubscribeLink: '#unsubscribe'
    };

    const mergedData = { ...defaultData, ...testData };

    // Replace variables in HTML content
    let previewHtml = template.htmlContent;
    let previewSubject = template.subject;

    Object.keys(mergedData).forEach(key => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      previewHtml = previewHtml.replace(regex, mergedData[key]);
      previewSubject = previewSubject.replace(regex, mergedData[key]);
    });

    // Replace any remaining variables with placeholder text
    previewHtml = previewHtml.replace(/{{([^}]+)}}/g, '[Variable: $1]');
    previewSubject = previewSubject.replace(/{{([^}]+)}}/g, '[Variable: $1]');

    res.json({
      success: true,
      data: {
        htmlContent: previewHtml,
        subject: previewSubject,
        testData: mergedData
      }
    });
  } catch (error) {
    console.error('❌ Preview template error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  generateTemplate,
  improveTemplate,
  cloneTemplate,
  getCategories,
  generateSubjectLines,
  previewTemplate
};