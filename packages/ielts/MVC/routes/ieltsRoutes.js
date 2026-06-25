// MVC/routes/ieltsRoutes.js
const express = require('express');
const router = express.Router();
const { requireCoreModule } = require('../services/ielts/ieltsCoreModuleResolver');
const ctrl = require('../controllers/ielts/ieltsController');
const promptCtrl = require('../controllers/ielts/promptController');
const apiProviderCtrl = require('../controllers/ielts/apiProviderController');
const aiTokenUsageCtrl = require('../controllers/ielts/aiTokenUsageController');

const { requireAuth } = requireCoreModule('MVC/middleware/authMiddleware');
const adminApproval = requireCoreModule('MVC/middleware/adminApproval');
const { requireAccess } = requireCoreModule('MVC/middleware/accessMiddleware');
const { trackActionState } = requireCoreModule('MVC/middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = requireCoreModule('config/accessConstants');
const upload = requireCoreModule('MVC/middleware/upload');

// --- Dashboard ---
router.get('/', requireAuth, ctrl.showDashboard);
router.get('/dashboard', requireAuth, ctrl.showDashboard);

/* =========================================
   1. WRITING TASK 2 SAMPLES
   ========================================= */

// List View
router.get('/task2samples', requireAuth, ctrl.showTask2Samples);

// New Sample (Form)
router.get('/task2samples/new', requireAuth, ctrl.showAddSampleForm);

// Create Action (Supports File Upload)
router.post('/task2samples/new', 
    requireAuth, 
    upload('ielts').single('attachment'), 
    ctrl.addSample
);

// Edit Sample (Form)
router.get('/task2samples/edit/:id', requireAuth, ctrl.showEditSampleForm);

// Update Action
router.post('/task2samples/edit/:id', 
    requireAuth, 
    upload('ielts').single('attachment'), 
    ctrl.editSample
);

// Delete Action
router.get('/task2samples/delete/:id', requireAuth, ctrl.deleteSample);


/* =========================================
   2. MICRO ASSESSMENTS
   ========================================= */

// List View
router.get('/task2microassessment', requireAuth, ctrl.showMicroAssessments); // Matches dashboard link

// Also allow standard plural URL for consistency
router.get('/microAssessments', requireAuth, ctrl.showMicroAssessments);

// Export full filtered micro-assessment data
router.post('/microAssessments/export', requireAuth, adminApproval, ctrl.exportMicroAssessments);

// New Assessment (Form)
router.get('/microAssessments/new', requireAuth, ctrl.showAddMicroAssessmentForm);

// Create Action
router.post('/microAssessments/new', requireAuth, ctrl.addMicroAssessment);

// Edit Assessment (Form)
router.get('/microAssessments/edit/:id', requireAuth, ctrl.showEditMicroAssessmentForm);

// Copy Assessment (Form -> New with prefilled data)
router.get('/microAssessments/copy/:id', requireAuth, ctrl.showCopyMicroAssessmentForm);

// Update Action
router.post('/microAssessments/edit/:id', requireAuth, ctrl.editMicroAssessment);

// Delete Action
router.get('/microAssessments/delete/:id', requireAuth, ctrl.deleteMicroAssessment);

/* =========================================
   5. PROMPT TUNING
   ========================================= */
router.get('/prompts', requireAuth, promptCtrl.showPromptSettings);
router.get('/prompts/new', requireAuth, promptCtrl.showAddPromptForm);
router.post('/prompts/new', requireAuth, promptCtrl.addPrompt);
router.get('/prompts/edit/:id', requireAuth, promptCtrl.showEditPromptForm);
router.post('/prompts/edit/:id', requireAuth, promptCtrl.editPrompt);
router.post('/prompts/save', requireAuth, promptCtrl.savePrompt);
router.get('/prompts/template/:id', requireAuth, promptCtrl.getPromptTemplate);
router.post('/prompts/delete/:id', requireAuth, promptCtrl.deletePrompt);

/* =========================================
   5.1 USER API PROVIDERS
   ========================================= */
router.get('/api-providers',
  requireAccess(SECTIONS.IELTS_API_PROVIDERS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.IELTS_API_PROVIDERS, OPERATIONS.READ_ALL),
  apiProviderCtrl.showApiProviderSettings
);
router.get('/api-providers/new',
  requireAccess(SECTIONS.IELTS_API_PROVIDERS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.IELTS_API_PROVIDERS, OPERATIONS.CREATE),
  apiProviderCtrl.showAddApiProviderForm
);
router.post('/api-providers/new',
  requireAccess(SECTIONS.IELTS_API_PROVIDERS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.IELTS_API_PROVIDERS, OPERATIONS.CREATE, { requireToken: true }),
  apiProviderCtrl.addApiProvider
);
router.get('/api-providers/edit/:id',
  requireAccess(SECTIONS.IELTS_API_PROVIDERS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.IELTS_API_PROVIDERS, OPERATIONS.UPDATE),
  apiProviderCtrl.showEditApiProviderForm
);
router.post('/api-providers/edit/:id',
  requireAccess(SECTIONS.IELTS_API_PROVIDERS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.IELTS_API_PROVIDERS, OPERATIONS.UPDATE, { requireToken: true }),
  apiProviderCtrl.editApiProvider
);
router.post('/api-providers/delete/:id',
  requireAccess(SECTIONS.IELTS_API_PROVIDERS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.IELTS_API_PROVIDERS, OPERATIONS.DELETE, { requireToken: false }),
  apiProviderCtrl.deleteApiProvider
);
router.post('/api-providers/default',
  requireAccess(SECTIONS.IELTS_API_PROVIDERS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.IELTS_API_PROVIDERS, OPERATIONS.UPDATE, { requireToken: false }),
  apiProviderCtrl.setDefaultApiProvider
);

/* =========================================
   5.2 AI TOKEN USAGE
   ========================================= */
router.get('/ai-token-usage',
  requireAccess(SECTIONS.IELTS_AI_TOKEN_USAGE, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.IELTS_AI_TOKEN_USAGE, OPERATIONS.READ_ALL),
  aiTokenUsageCtrl.showAiTokenUsageList
);
router.get('/ai-token-usage/analytics',
  requireAccess(SECTIONS.IELTS_AI_TOKEN_USAGE, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.IELTS_AI_TOKEN_USAGE, OPERATIONS.READ_ALL, { requireToken: false }),
  aiTokenUsageCtrl.showAiTokenUsageAnalytics
);
router.get('/ai-token-usage/edit/:id',
  requireAccess(SECTIONS.IELTS_AI_TOKEN_USAGE, OPERATIONS.READ),
  trackActionState(SECTIONS.IELTS_AI_TOKEN_USAGE, OPERATIONS.READ),
  aiTokenUsageCtrl.showEditAiTokenUsageForm
);
router.post('/ai-token-usage/edit/:id',
  requireAccess(SECTIONS.IELTS_AI_TOKEN_USAGE, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.IELTS_AI_TOKEN_USAGE, OPERATIONS.UPDATE, { requireToken: true }),
  aiTokenUsageCtrl.editAiTokenUsage
);

/* =========================================
   6. AI EXAM MODE (Batch Processing)
   ========================================= */
// Deleted
/* =========================================
   7. SCORING PIPELINE & HISTORY
   ========================================= */

// A. The Main Tool
// Keep /scoring as a stable entry point, but always serve the latest page.
router.get('/scoring', requireAuth, ctrl.showScoringPageV0323);
router.get('/scoring/classic', requireAuth, ctrl.showScoringPage);
router.get('/scoringV0225', requireAuth, ctrl.showScoringPageV0225);
router.get('/scoringV0323', requireAuth, ctrl.showScoringPageV0323);
router.get('/scoringV0326', requireAuth, ctrl.showScoringPageV0326);
router.get('/scoring-standard', requireAuth, ctrl.showScoringPageStandard);
router.get('/scoring/dashboard', requireAuth, ctrl.showScoringDashboard);
router.get('/scoring/tuning/step3', requireAuth, ctrl.showStep3TuningPage);
router.get('/scoring/tuning/step4', requireAuth, ctrl.showStep4TuningPage);
router.get('/scoringV0323/tuning/step3', requireAuth, ctrl.showStep3TuningPageV0323);
router.get('/scoringV0323/tuning/step4', requireAuth, ctrl.showStep4TuningPageV0323);
router.get('/scoringV0326/tuning/step3', requireAuth, ctrl.showStep3TuningPageV0326);
router.get('/scoringV0326/tuning/step4', requireAuth, ctrl.showStep4TuningPageV0326);
router.get('/commit-helper', requireAuth, ctrl.showCommitHelperPage);
router.get('/commit-helper/compare', requireAuth, ctrl.showCommitHelperComparePage);
router.post('/commit-helper/generate', requireAuth, ctrl.generateCommitPrompt);
router.post('/commit-helper/ai-json', requireAuth, ctrl.generateCommitModelJson);
router.post('/commit-helper/ingest', requireAuth, ctrl.ingestCommitModelOutput);
router.post('/commit-helper/auto', requireAuth, ctrl.runCommitHelperAuto);

// B. The 5 Processing Steps (API)
router.post('/scoring/step1/freeze', requireAuth, ctrl.freezeEssayInput);
router.post('/scoring/step2/analyze', requireAuth, ctrl.analyzeEssayFeatures);
router.post('/scoring/step3/extract', requireAuth, ctrl.extractEssayEvidence);
router.post('/scoring/step4/grade', requireAuth, ctrl.calculateGrades);
router.post('/scoring/step4/prompt/preview', requireAuth, ctrl.previewStep4Prompt);
router.post('/scoring/step5/feedback', requireAuth, ctrl.generateFeedback);
router.post('/scoring/step5/prompt/preview', requireAuth, ctrl.previewStep5Prompt);
router.post('/scoring/cancel', requireAuth, ctrl.cancelScoringRun);

// C. Session Management (Save/Load/List)
router.get(['/data/scoringHistory', '/scoring/history'], requireAuth, ctrl.showScoringHistory); // View List
router.post(['/data/scoringHistory', '/scoring/save'], requireAuth, ctrl.saveScoringSession); // Save
router.post('/scoring/history/duplicate', requireAuth, ctrl.duplicateScoringSessionSynthetic); // Superuser synthetic copies
router.post('/scoring/history/clone-up-to-step', requireAuth, ctrl.cloneScoringSessionUpToStep); // Create new session up to selected step
router.post('/scoring/history/archive', requireAuth, ctrl.archiveScoringSession); // Archive
router.post('/scoring/history/unarchive', requireAuth, ctrl.unarchiveScoringSession); // Restore from archive
router.post('/scoring/history/archive-many', requireAuth, ctrl.archiveScoringSessionsBulk); // Bulk archive
router.post('/scoring/history/unarchive-many', requireAuth, ctrl.unarchiveScoringSessionsBulk); // Bulk restore
router.post('/scoring/history/category-many', requireAuth, ctrl.assignScoringSessionsCategoryBulk); // Bulk category assignment
router.post('/scoring/history/delete-many', requireAuth, ctrl.deleteScoringSessionsBulk); // Bulk delete
router.get(['/data/scoringHistory/:id', '/scoring/load/:id'], requireAuth, ctrl.getScoringSession); // Load Single
router.get(['/scoring/delete/:id', '/scoring/history/delete/:id'], requireAuth, ctrl.deleteScoringSession); // Delete

// In Section 7 (Scoring History)
router.get('/scoring/fluctuation/three-run', requireAuth, ctrl.showThreeRunFluctuationPage);
router.get('/scoring/fluctuation/three-run/compare', requireAuth, ctrl.showThreeRunFluctuationComparePage);
router.get('/scoring/tuning/step3/compare', requireAuth, ctrl.showStep3TuningComparePage);
router.get('/scoring/tuning/step4/compare', requireAuth, ctrl.showStep4TuningComparePage);
router.get('/scoring/compare', requireAuth, ctrl.compareScoringSessions);
router.get('/scoring/compare/visual', requireAuth, ctrl.compareScoringSessionsVisual);
router.get('/scoring/repeated-run/export', requireAuth, ctrl.exportRepeatedRunAnalysis);
router.get('/scoring/benchmark/export', requireAuth, ctrl.exportBenchmarkCalibration);
/* =========================================
   FUTURE PLACEHOLDERS
   ========================================= */
// router.get('/task2reports', requireAuth, ctrl.showReports);
// router.get('/task2dataexport', requireAuth, ctrl.showDataExport);

module.exports = router;
