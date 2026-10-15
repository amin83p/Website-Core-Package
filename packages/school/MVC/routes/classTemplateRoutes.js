const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/classTemplateController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

const SECTION_ID = SECTIONS.SCHOOL_CLASS_TEMPLATES;

router.get('/',
  requireAccess(SECTION_ID, OPERATIONS.READ_ALL),
  trackActionState(SECTION_ID, OPERATIONS.READ_ALL),
  ctrl.listClassTemplates);

router.get('/new',
  requireAccess(SECTION_ID, OPERATIONS.CREATE),
  trackActionState(SECTION_ID, OPERATIONS.CREATE),
  ctrl.showAddForm);

router.get('/api/template/:id',
  requireAccess(SECTION_ID, OPERATIONS.READ_ALL),
  trackActionState(SECTION_ID, OPERATIONS.READ_ALL),
  ctrl.getDefinitionTemplateCopyPayload);

router.post('/new',
  requireAccess(SECTION_ID, OPERATIONS.CREATE),
  trackActionState(SECTION_ID, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.addTemplate);

router.get('/edit/:id',
  requireAccess(SECTION_ID, OPERATIONS.UPDATE),
  trackActionState(SECTION_ID, OPERATIONS.UPDATE),
  ctrl.showEditForm);

router.post('/edit/:id',
  requireAccess(SECTION_ID, OPERATIONS.UPDATE),
  trackActionState(SECTION_ID, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.editTemplate);

router.get('/delete/:id',
  requireAccess(SECTION_ID, OPERATIONS.DELETE),
  trackActionState(SECTION_ID, OPERATIONS.DELETE),
  ctrl.deleteTemplate);

router.delete('/delete/:id',
  requireAccess(SECTION_ID, OPERATIONS.DELETE),
  trackActionState(SECTION_ID, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteTemplate);

module.exports = router;
