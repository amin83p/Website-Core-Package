const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/feedbackController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./pteRouteDependencies');


router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.PTE_FEEDBACK_ON_PRACTICE, OPERATIONS.READ),
  trackActionState(SECTIONS.PTE_FEEDBACK_ON_PRACTICE, OPERATIONS.READ),
  (req, res) => res.redirect('/pte/feedback/practice'));

router.get('/practice',
  requireAccess(SECTIONS.PTE_FEEDBACK_ON_PRACTICE, OPERATIONS.READ),
  trackActionState(SECTIONS.PTE_FEEDBACK_ON_PRACTICE, OPERATIONS.READ),
  ctrl.listPracticeFeedback);

router.get('/practice/:sessionId',
  requireAccess(SECTIONS.PTE_FEEDBACK_ON_PRACTICE, OPERATIONS.READ),
  trackActionState(SECTIONS.PTE_FEEDBACK_ON_PRACTICE, OPERATIONS.READ),
  ctrl.viewPracticeFeedbackSession);

router.get('/practice/:sessionId/edit',
  requireAccess(SECTIONS.PTE_FEEDBACK_ON_PRACTICE, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_FEEDBACK_ON_PRACTICE, OPERATIONS.CREATE),
  ctrl.editPracticeFeedbackSession);

router.post('/practice/:sessionId/items/:itemId/feedback',
  requireAccess(SECTIONS.PTE_FEEDBACK_ON_PRACTICE, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_FEEDBACK_ON_PRACTICE, OPERATIONS.CREATE, { requireToken: true, keepActive: true }),
  ctrl.savePracticeItemFeedback);

router.post('/practice/:sessionId/generate-detailed-feedback',
  requireAccess(SECTIONS.PTE_FEEDBACK_ON_PRACTICE, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_FEEDBACK_ON_PRACTICE, OPERATIONS.CREATE, { requireToken: true, keepActive: true }),
  ctrl.generatePracticeDetailedFeedback);

router.post('/practice/:sessionId/save-detailed-feedback',
  requireAccess(SECTIONS.PTE_FEEDBACK_ON_PRACTICE, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_FEEDBACK_ON_PRACTICE, OPERATIONS.CREATE, { requireToken: true, keepActive: true }),
  ctrl.savePracticeDetailedFeedback);

module.exports = router;

