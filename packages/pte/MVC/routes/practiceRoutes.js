const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/practiceController');
const mockCtrl = require('../controllers/mockExamController');
const {
  upload,
  pteUploadContext,
  requireAuth,
  requireAccess,
  trackActionState,
  resolveActivityQuotaPolicy,
  SECTIONS,
  OPERATIONS
} = require('./pteRouteDependencies');

router.use(requireAuth);

const RUNTIME_ACTION_STATE_OPTIONS = Object.freeze({
  requireToken: true,
  allowOperationTokenFallback: true,
  allowInactiveTokenFallback: true,
  keepActive: true
});

function attachSmartRunnerConfig(req, res, next) {
  req.ptePracticeRunnerConfig = {
    mode: 'smart_practice',
    endpoints: {
      base: '/pte/practice/smart/api/runtime'
    },
    completionUrl: '/pte/practice/smart'
  };
  next();
}

router.get('/',
  requireAccess(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.READ),
  trackActionState(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.READ),
  (req, res) => res.redirect('/pte/practice/by-skills'));

router.get('/by-skills',
  requireAccess(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.READ),
  trackActionState(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.READ),
  ctrl.showBySkills);

router.get('/smart',
  requireAccess(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.READ),
  trackActionState(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.READ),
  ctrl.showSmartPractice);

router.get('/smart/recommendation',
  requireAccess(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.READ),
  trackActionState(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.READ),
  ctrl.apiSmartRecommendation);

router.post('/smart/start/token',
  requireAccess(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.CREATE, { requireToken: false, keepActive: true }),
  ctrl.issueSmartStartToken);

router.post('/smart/start',
  requireAccess(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.CREATE, RUNTIME_ACTION_STATE_OPTIONS),
  resolveActivityQuotaPolicy({
    section: SECTIONS.PTE_PRACTICE_BY_SKILLS,
    operation: OPERATIONS.CREATE,
    sourceEventType: 'practice_attempt_started'
  }),
  ctrl.startSmartPractice);

router.get('/smart/session/:sessionId',
  requireAccess(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.UPDATE),
  resolveActivityQuotaPolicy({
    section: SECTIONS.PTE_PRACTICE_BY_SKILLS,
    operation: OPERATIONS.UPDATE,
    sourceEventType: 'practice_attempt_reopened'
  }),
  attachSmartRunnerConfig,
  ctrl.showPracticeRunner);

router.post('/smart/api/runtime/:sessionId/items/:itemId/start',
  requireAccess(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  ctrl.startRuntimeItem);

router.post('/smart/api/runtime/:sessionId/items/:itemId/skip',
  requireAccess(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  ctrl.skipRuntimeItem);

router.post('/smart/api/runtime/:sessionId/items/:itemId/save',
  requireAccess(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  ctrl.saveRuntimeItem);

router.post('/smart/api/runtime/:sessionId/items/:itemId/upload-audio',
  requireAccess(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  pteUploadContext.setRuntimeAttemptContext('smart'),
  upload('pte-attempts', true).single('audioFile'),
  upload.cleanupUploadedFileOnFail,
  ctrl.uploadRuntimeItemAudio);

router.post('/smart/api/runtime/:sessionId/items/:itemId/submit',
  requireAccess(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  ctrl.submitRuntimeItem);

router.post('/smart/api/runtime/:sessionId/items/:itemId/score',
  requireAccess(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.AI_SCORING),
  resolveActivityQuotaPolicy({
    section: SECTIONS.PTE_PRACTICE_BY_SKILLS,
    operation: OPERATIONS.AI_SCORING,
    sourceEventType: 'practice_item_scored'
  }),
  ctrl.scoreRuntimeItem);

router.post('/smart/api/runtime/:sessionId/items/:itemId/rate',
  requireAccess(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  ctrl.rateRuntimeItem);

router.post('/smart/api/runtime/:sessionId/finish',
  requireAccess(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  ctrl.finishRuntime);

router.get('/smart/api/runtime/sessions/:sessionId',
  requireAccess(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_SMART_PRACTICE, OPERATIONS.UPDATE),
  ctrl.getRuntimeSession);

router.get('/mock-exams',
  requireAccess(SECTIONS.PTE_MOCK_EXAMS, OPERATIONS.READ),
  trackActionState(SECTIONS.PTE_MOCK_EXAMS, OPERATIONS.READ),
  mockCtrl.showMockExams);

router.get('/mock-exams/:testVersionId/ready',
  requireAccess(SECTIONS.PTE_MOCK_EXAMS, OPERATIONS.READ),
  trackActionState(SECTIONS.PTE_MOCK_EXAMS, OPERATIONS.READ),
  mockCtrl.showReady);

router.post('/mock-exams/start/token',
  requireAccess(SECTIONS.PTE_MOCK_EXAMS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_MOCK_EXAMS, OPERATIONS.CREATE, { requireToken: false, keepActive: true }),
  mockCtrl.issueStartToken);

router.post('/mock-exams/start',
  requireAccess(SECTIONS.PTE_MOCK_EXAMS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_MOCK_EXAMS, OPERATIONS.CREATE, RUNTIME_ACTION_STATE_OPTIONS),
  mockCtrl.startMockExam);

router.get('/mock-exams/session/:sessionId',
  requireAccess(SECTIONS.PTE_MOCK_EXAMS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_MOCK_EXAMS, OPERATIONS.UPDATE),
  mockCtrl.showRunner);

router.get('/mock-exams/session/:sessionId/complete',
  requireAccess(SECTIONS.PTE_MOCK_EXAMS, OPERATIONS.READ),
  trackActionState(SECTIONS.PTE_MOCK_EXAMS, OPERATIONS.READ),
  mockCtrl.showComplete);

router.post('/mock-exams/api/runtime/:sessionId/items/:itemId/start',
  requireAccess(SECTIONS.PTE_MOCK_EXAMS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_MOCK_EXAMS, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  mockCtrl.startRuntimeItem);

router.post('/mock-exams/api/runtime/:sessionId/items/:itemId/save',
  requireAccess(SECTIONS.PTE_MOCK_EXAMS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_MOCK_EXAMS, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  mockCtrl.saveRuntimeItem);

router.post('/mock-exams/api/runtime/:sessionId/items/:itemId/upload-audio',
  requireAccess(SECTIONS.PTE_MOCK_EXAMS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_MOCK_EXAMS, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  pteUploadContext.setRuntimeAttemptContext('mock'),
  upload('pte-attempts', true).single('audioFile'),
  upload.cleanupUploadedFileOnFail,
  mockCtrl.uploadRuntimeItemAudio);

router.post('/mock-exams/api/runtime/:sessionId/items/:itemId/submit',
  requireAccess(SECTIONS.PTE_MOCK_EXAMS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_MOCK_EXAMS, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  mockCtrl.submitRuntimeItem);

router.post('/mock-exams/api/runtime/:sessionId/items/:itemId/finish',
  requireAccess(SECTIONS.PTE_MOCK_EXAMS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_MOCK_EXAMS, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  mockCtrl.finishRuntime);

router.get('/mock-exams/api/runtime/sessions/:sessionId',
  requireAccess(SECTIONS.PTE_MOCK_EXAMS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_MOCK_EXAMS, OPERATIONS.UPDATE),
  mockCtrl.getRuntimeSession);

router.get('/attempts',
  requireAccess(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.READ_ALL),
  resolveActivityQuotaPolicy({
    section: SECTIONS.PTE_PRACTICE_BY_SKILLS,
    operation: OPERATIONS.READ_ALL,
    sourceEventType: 'practice_attempts_list_viewed'
  }),
  ctrl.showAttemptsList);

router.get('/attempts/:sessionId/feedback',
  requireAccess(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.READ),
  trackActionState(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.READ),
  ctrl.showAttemptFeedback);

router.get('/attempts/:sessionId/details',
  requireAccess(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.READ),
  trackActionState(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.READ),
  resolveActivityQuotaPolicy({
    section: SECTIONS.PTE_PRACTICE_BY_SKILLS,
    operation: OPERATIONS.READ,
    sourceEventType: 'practice_attempt_detail_viewed'
  }),
  ctrl.showAttemptDetails);

router.get('/attempts/:sessionId/details/export',
  requireAccess(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.READ),
  trackActionState(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.READ),
  ctrl.exportAttemptDetails);

router.post('/attempts/:sessionId/delete',
  requireAccess(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteAttempt);

router.post('/attempts/:sessionId/delete/token',
  requireAccess(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.DELETE, { requireToken: false, keepActive: true }),
  ctrl.issueAttemptDeleteToken);

router.get('/picker/users',
  requireAccess(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.READ_ALL),
  ctrl.pickerPracticeUsers);

router.get('/session/:sessionId',
  requireAccess(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.UPDATE),
  resolveActivityQuotaPolicy({
    section: SECTIONS.PTE_PRACTICE_BY_SKILLS,
    operation: OPERATIONS.UPDATE,
    sourceEventType: 'practice_attempt_reopened'
  }),
  ctrl.showPracticeRunner);

router.get('/api/overview',
  requireAccess(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.READ),
  trackActionState(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.READ),
  ctrl.apiOverview);

router.post('/api/runtime/start',
  requireAccess(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.CREATE, RUNTIME_ACTION_STATE_OPTIONS),
  resolveActivityQuotaPolicy({
    section: SECTIONS.PTE_PRACTICE_BY_SKILLS,
    operation: OPERATIONS.CREATE,
    sourceEventType: 'practice_attempt_started'
  }),
  ctrl.startRuntime);

router.post('/api/runtime/start/token',
  requireAccess(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.CREATE, { requireToken: false, keepActive: true }),
  ctrl.issueStartRuntimeToken);

router.post('/api/runtime/:sessionId/items/:itemId/start',
  requireAccess(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  ctrl.startRuntimeItem);

router.post('/api/runtime/:sessionId/items/:itemId/skip',
  requireAccess(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  ctrl.skipRuntimeItem);

router.post('/api/runtime/:sessionId/items/:itemId/save',
  requireAccess(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  ctrl.saveRuntimeItem);

router.post('/api/runtime/:sessionId/items/:itemId/upload-audio',
  requireAccess(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  pteUploadContext.setRuntimeAttemptContext('skills'),
  upload('pte-attempts', true).single('audioFile'),
  upload.cleanupUploadedFileOnFail,
  ctrl.uploadRuntimeItemAudio);

router.post('/api/runtime/:sessionId/items/:itemId/submit',
  requireAccess(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  ctrl.submitRuntimeItem);

router.post('/api/runtime/:sessionId/items/:itemId/score',
  requireAccess(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.AI_SCORING),
  resolveActivityQuotaPolicy({
    section: SECTIONS.PTE_PRACTICE_BY_SKILLS,
    operation: OPERATIONS.AI_SCORING,
    sourceEventType: 'practice_item_scored'
  }),
  ctrl.scoreRuntimeItem);

router.post('/api/runtime/:sessionId/items/:itemId/rate',
  requireAccess(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  ctrl.rateRuntimeItem);

router.post('/api/runtime/:sessionId/finish',
  requireAccess(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.UPDATE, RUNTIME_ACTION_STATE_OPTIONS),
  ctrl.finishRuntime);

router.get('/api/runtime/sessions/:sessionId',
  requireAccess(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.UPDATE),
  ctrl.getRuntimeSession);

module.exports = router;
