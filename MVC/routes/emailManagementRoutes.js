const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/emailManagementController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess, requireAccessAny } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

router.use(requireAuth);

const TEMPLATE_SECTION_ACCESS_IDS = [
  SECTIONS.EMAIL_TEMPLATES,
  SECTIONS.EMAIL_MANAGEMENT
];

router.get(
  '/',
  (req, res) => res.redirect('/dashboard/section-nav/EMAIL_MANAGEMENT')
);

router.get(
  '/ledger',
  requireAccess(SECTIONS.EMAIL_LEDGER, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.EMAIL_LEDGER, OPERATIONS.READ_ALL),
  ctrl.showEmailLedgerList
);

router.get(
  '/ledger/:id',
  requireAccess(SECTIONS.EMAIL_LEDGER, OPERATIONS.READ),
  trackActionState(SECTIONS.EMAIL_LEDGER, OPERATIONS.READ),
  ctrl.showEmailLedgerDetail
);

router.get(
  '/templates',
  requireAccessAny(TEMPLATE_SECTION_ACCESS_IDS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.EMAIL_TEMPLATES, OPERATIONS.READ_ALL),
  ctrl.showTemplateList
);

router.get(
  '/templates/new',
  requireAccessAny(TEMPLATE_SECTION_ACCESS_IDS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.EMAIL_TEMPLATES, OPERATIONS.CREATE, { keepActive: true }),
  ctrl.showAddTemplateForm
);

router.get(
  '/templates/picker/events',
  requireAccessAny(TEMPLATE_SECTION_ACCESS_IDS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.EMAIL_TEMPLATES, OPERATIONS.READ_ALL, { keepActive: true }),
  ctrl.pickerEmailEvents
);

router.get(
  '/templates/media/library',
  requireAccessAny(TEMPLATE_SECTION_ACCESS_IDS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.EMAIL_TEMPLATES, OPERATIONS.READ_ALL, { keepActive: true }),
  ctrl.listTemplateMediaLibrary
);

router.post(
  '/templates/new',
  requireAccessAny(TEMPLATE_SECTION_ACCESS_IDS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.EMAIL_TEMPLATES, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.addTemplate
);

router.get(
  '/templates/:id',
  requireAccessAny(TEMPLATE_SECTION_ACCESS_IDS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.EMAIL_TEMPLATES, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.showEditTemplateForm
);

router.post(
  '/templates/:id',
  requireAccessAny(TEMPLATE_SECTION_ACCESS_IDS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.EMAIL_TEMPLATES, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.editTemplate
);

router.post(
  '/templates/:id/delete',
  requireAccessAny(TEMPLATE_SECTION_ACCESS_IDS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.EMAIL_TEMPLATES, OPERATIONS.DELETE, { requireToken: false }),
  ctrl.deleteTemplate
);

module.exports = router;
