const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/helpController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

const HELP_SECTION = SECTIONS.HELP || 'HELP';

router.get('/',
  requireAuth,
  requireAccess(HELP_SECTION, OPERATIONS.READ_ALL),
  trackActionState(HELP_SECTION, OPERATIONS.READ_ALL),
  ctrl.helpHome);

router.get('/manage',
  requireAuth,
  requireAccess(HELP_SECTION, OPERATIONS.READ_ALL),
  trackActionState(HELP_SECTION, OPERATIONS.READ_ALL),
  ctrl.listHelpItems);

router.get('/manage/new',
  requireAuth,
  requireAccess(HELP_SECTION, OPERATIONS.CREATE),
  trackActionState(HELP_SECTION, OPERATIONS.CREATE),
  ctrl.showAddHelpForm);

router.post('/manage/new',
  requireAuth,
  requireAccess(HELP_SECTION, OPERATIONS.CREATE),
  trackActionState(HELP_SECTION, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.addHelpItem);

router.get('/manage/edit/:id',
  requireAuth,
  requireAccess(HELP_SECTION, OPERATIONS.UPDATE),
  trackActionState(HELP_SECTION, OPERATIONS.UPDATE),
  ctrl.showEditHelpForm);

router.post('/manage/edit/:id',
  requireAuth,
  requireAccess(HELP_SECTION, OPERATIONS.UPDATE),
  trackActionState(HELP_SECTION, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.editHelpItem);

router.get('/manage/delete/:id',
  requireAuth,
  requireAccess(HELP_SECTION, OPERATIONS.DELETE),
  trackActionState(HELP_SECTION, OPERATIONS.DELETE),
  ctrl.deleteHelpItem);

router.get('/manage/pages',
  requireAuth,
  requireAccess(HELP_SECTION, OPERATIONS.READ_ALL),
  trackActionState(HELP_SECTION, OPERATIONS.READ_ALL),
  ctrl.listHelpPages);

router.get('/manage/sections',
  requireAuth,
  requireAccess(HELP_SECTION, OPERATIONS.READ_ALL),
  trackActionState(HELP_SECTION, OPERATIONS.READ_ALL),
  ctrl.listHelpSections);

router.get('/manage/operations',
  requireAuth,
  requireAccess(HELP_SECTION, OPERATIONS.READ_ALL),
  trackActionState(HELP_SECTION, OPERATIONS.READ_ALL),
  ctrl.listHelpOperations);

// Fast resolver for contextual help links
router.get('/resolve',
  requireAuth,
  requireAccess(HELP_SECTION, OPERATIONS.READ),
  trackActionState(HELP_SECTION, OPERATIONS.READ),
  ctrl.resolveHelp);

router.get('/context/:sectionId/:operationId',
  requireAuth,
  requireAccess(HELP_SECTION, OPERATIONS.READ),
  trackActionState(HELP_SECTION, OPERATIONS.READ),
  ctrl.resolveHelp);

router.get('/context/:sectionId',
  requireAuth,
  requireAccess(HELP_SECTION, OPERATIONS.READ),
  trackActionState(HELP_SECTION, OPERATIONS.READ),
  ctrl.resolveHelp);

router.get('/center',
  requireAuth,
  requireAccess(HELP_SECTION, OPERATIONS.READ_ALL),
  trackActionState(HELP_SECTION, OPERATIONS.READ_ALL),
  ctrl.viewHelpCenter);

router.get('/article/:slug',
  requireAuth,
  requireAccess(HELP_SECTION, OPERATIONS.READ),
  trackActionState(HELP_SECTION, OPERATIONS.READ),
  ctrl.viewHelpArticle);

module.exports = router;
