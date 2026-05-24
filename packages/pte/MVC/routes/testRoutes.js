const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/testController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./pteRouteDependencies');

router.use(requireAuth);

const RUNTIME_ACTION_STATE_OPTIONS = Object.freeze({
  requireToken: true,
  allowOperationTokenFallback: true,
  keepActive: true
});

router.get('/',
  requireAccess(SECTIONS.PTE_TESTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_TESTS, OPERATIONS.READ_ALL),
  ctrl.listTests);

router.get('/blueprint-guide',
  requireAccess(SECTIONS.PTE_TESTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_TESTS, OPERATIONS.READ_ALL),
  ctrl.showBlueprintGuide);

router.get('/form-options',
  requireAccess(SECTIONS.PTE_TESTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_TESTS, OPERATIONS.READ_ALL),
  ctrl.getFormOptions);

router.get('/family/:familyId/revisions',
  requireAccess(SECTIONS.PTE_TESTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_TESTS, OPERATIONS.READ_ALL),
  ctrl.getFamilyRevisions);

router.get('/picker/published-questions',
  requireAccess(SECTIONS.PTE_TESTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_TESTS, OPERATIONS.READ_ALL),
  ctrl.listPublishedQuestionsPicker);

router.post('/validate',
  requireAccess(SECTIONS.PTE_TESTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_TESTS, OPERATIONS.READ_ALL),
  ctrl.validateDraft);

router.get('/preview/exam/:id',
  requireAccess(SECTIONS.PTE_TESTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_TESTS, OPERATIONS.READ_ALL),
  ctrl.showExamPreview);

router.post('/preview/exam',
  requireAccess(SECTIONS.PTE_TESTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_TESTS, OPERATIONS.READ_ALL),
  ctrl.showExamPreview);

router.get('/runtime/ledger',
  requireAccess(SECTIONS.PTE_ATTEMPT_LEDGER, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_ATTEMPT_LEDGER, OPERATIONS.READ_ALL),
  ctrl.listRuntimeLedger);

router.get('/runtime/ledger/picker/users',
  requireAccess(SECTIONS.PTE_ATTEMPT_LEDGER, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_ATTEMPT_LEDGER, OPERATIONS.READ_ALL),
  ctrl.pickerRuntimeUsers);

router.post('/runtime/start',
  requireAccess(SECTIONS.PTE_TESTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_TESTS, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  ctrl.startRuntimeAttempt);

router.post('/runtime/:sessionId/items/:itemId/start',
  requireAccess(SECTIONS.PTE_TESTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_TESTS, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  ctrl.startRuntimeAttemptItem);

router.post('/runtime/:sessionId/items/:itemId/save',
  requireAccess(SECTIONS.PTE_TESTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_TESTS, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  ctrl.saveRuntimeAttemptItem);

router.post('/runtime/:sessionId/items/:itemId/submit',
  requireAccess(SECTIONS.PTE_TESTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_TESTS, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  ctrl.submitRuntimeAttemptItem);

router.post('/runtime/:sessionId/items/:itemId/score',
  requireAccess(SECTIONS.PTE_TESTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_TESTS, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  ctrl.scoreRuntimeAttemptItem);

router.post('/runtime/:sessionId/items/:itemId/feedback',
  requireAccess(SECTIONS.PTE_TESTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_TESTS, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  ctrl.feedbackRuntimeAttemptItem);

router.post('/runtime/:sessionId/submit',
  requireAccess(SECTIONS.PTE_TESTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_TESTS, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  ctrl.submitRuntimeAttemptSession);

router.get('/runtime/sessions/:sessionId',
  requireAccess(SECTIONS.PTE_ATTEMPT_DETAILS, OPERATIONS.READ),
  trackActionState(SECTIONS.PTE_ATTEMPT_DETAILS, OPERATIONS.READ),
  ctrl.getRuntimeAttemptSession);

router.get('/runtime/analytics/me',
  requireAccess(SECTIONS.PTE_ATTEMPT_OVERALL_PERFORMANCE, OPERATIONS.READ),
  trackActionState(SECTIONS.PTE_ATTEMPT_OVERALL_PERFORMANCE, OPERATIONS.READ),
  ctrl.getRuntimeAnalyticsMe);

router.get('/new',
  requireAccess(SECTIONS.PTE_TESTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_TESTS, OPERATIONS.CREATE),
  ctrl.showForm);

router.post('/new',
  requireAccess(SECTIONS.PTE_TESTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_TESTS, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveTest);

router.get('/edit/:id',
  requireAccess(SECTIONS.PTE_TESTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_TESTS, OPERATIONS.UPDATE),
  ctrl.showForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.PTE_TESTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_TESTS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveTest);

router.post('/publish/:id',
  requireAccess(SECTIONS.PTE_TESTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_TESTS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.publishTest);

router.post('/revise/:id',
  requireAccess(SECTIONS.PTE_TESTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_TESTS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.reviseTest);

router.post('/archive/:id',
  requireAccess(SECTIONS.PTE_TESTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_TESTS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.archiveTest);

router.delete('/delete/:id',
  requireAccess(SECTIONS.PTE_TESTS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.PTE_TESTS, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteTest);

module.exports = router;
