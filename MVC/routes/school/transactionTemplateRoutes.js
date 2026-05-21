// MVC/routes/school/transactionTemplateRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/school/transactionDefinitionController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.use(requireAuth);

const SECTION_ID = SECTIONS.SCHOOL_TRANSACTION_TEMPLATES;

router.get('/',
  requireAccess(SECTION_ID, OPERATIONS.READ_ALL),
  trackActionState(SECTION_ID, OPERATIONS.READ_ALL),
  ctrl.listTransactionDefinitions);

router.get('/new',
  requireAccess(SECTION_ID, OPERATIONS.CREATE),
  trackActionState(SECTION_ID, OPERATIONS.CREATE),
  ctrl.showForm);

router.get('/new-wizard',
  requireAccess(SECTION_ID, OPERATIONS.CREATE),
  trackActionState(SECTION_ID, OPERATIONS.CREATE),
  ctrl.showAddWizardForm);

router.post('/new',
  requireAccess(SECTION_ID, OPERATIONS.CREATE),
  trackActionState(SECTION_ID, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveTransactionDefinition);

router.get('/edit/:id',
  requireAccess(SECTION_ID, OPERATIONS.UPDATE),
  trackActionState(SECTION_ID, OPERATIONS.UPDATE),
  ctrl.showForm);

router.get('/edit-wizard/:id',
  requireAccess(SECTION_ID, OPERATIONS.UPDATE),
  trackActionState(SECTION_ID, OPERATIONS.UPDATE),
  ctrl.showEditWizardForm);

router.post('/edit/:id',
  requireAccess(SECTION_ID, OPERATIONS.UPDATE),
  trackActionState(SECTION_ID, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveTransactionDefinition);

router.post('/apply/:id',
  requireAccess(SECTION_ID, OPERATIONS.CREATE),
  trackActionState(SECTION_ID, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.previewOrApplyTransactionDefinition);

router.get('/delete/:id',
  requireAccess(SECTION_ID, OPERATIONS.DELETE),
  trackActionState(SECTION_ID, OPERATIONS.DELETE),
  ctrl.deleteTransactionDefinition);

router.delete('/delete/:id',
  requireAccess(SECTION_ID, OPERATIONS.DELETE),
  trackActionState(SECTION_ID, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteTransactionDefinition);

module.exports = router;

