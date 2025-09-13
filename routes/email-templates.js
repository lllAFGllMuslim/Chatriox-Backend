const express = require('express');
const router = express.Router();
const {
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
} = require('../controllers/templateController');
const { auth } = require('../middleware/auth');
router.use(auth);

// Template CRUD routes
router.get('/', getTemplates);
router.get('/categories', getCategories);
router.get('/:id', getTemplate);
router.post('/', createTemplate);
router.put('/:id', updateTemplate);
router.delete('/:id', deleteTemplate);

// AI-powered routes
router.post('/generate', generateTemplate);
router.post('/:id/improve', improveTemplate);
router.post('/:id/subject-lines', generateSubjectLines);

// Template management routes
router.post('/:id/clone', cloneTemplate);
router.post('/:id/preview', previewTemplate);

module.exports = router;