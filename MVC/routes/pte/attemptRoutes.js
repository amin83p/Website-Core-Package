const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/pte/attemptController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.PTE_ATTEMPT, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_ATTEMPT, OPERATIONS.READ_ALL),
  (req, res) => res.redirect('/pte/attempt/ledger'));

router.get('/ledger',
  requireAccess(SECTIONS.PTE_ATTEMPT_LEDGER, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_ATTEMPT_LEDGER, OPERATIONS.READ_ALL),
  ctrl.listAttemptLedger);

router.get('/ledger/picker/users',
  requireAccess(SECTIONS.PTE_ATTEMPT_LEDGER, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_ATTEMPT_LEDGER, OPERATIONS.READ_ALL),
  ctrl.pickerAttemptUsers);

router.get('/details',
  requireAccess(SECTIONS.PTE_ATTEMPT_DETAILS, OPERATIONS.READ),
  trackActionState(SECTIONS.PTE_ATTEMPT_DETAILS, OPERATIONS.READ),
  ctrl.showAttemptDetails);

router.get('/details/:sessionId',
  requireAccess(SECTIONS.PTE_ATTEMPT_DETAILS, OPERATIONS.READ),
  trackActionState(SECTIONS.PTE_ATTEMPT_DETAILS, OPERATIONS.READ),
  ctrl.showAttemptDetails);

router.get('/details/:sessionId/export',
  requireAccess(SECTIONS.PTE_ATTEMPT_DETAILS, OPERATIONS.READ),
  trackActionState(SECTIONS.PTE_ATTEMPT_DETAILS, OPERATIONS.READ),
  ctrl.exportAttemptDetailsLifecycle);

router.get('/overall-performance',
  requireAccess(SECTIONS.PTE_ATTEMPT_OVERALL_PERFORMANCE, OPERATIONS.READ),
  trackActionState(SECTIONS.PTE_ATTEMPT_OVERALL_PERFORMANCE, OPERATIONS.READ),
  ctrl.showOverallPerformance);

// Compatibility shim: prefer package-owned route implementation.
module.exports = require('../../../packages/pte/MVC/routes/attemptRoutes');
