const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/pte/questionBankController');
const upload = require('../../middleware/upload');
const pteUploadContext = require('../../middleware/pteUploadContextMiddleware');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.use(requireAuth);

const MUTATION_TOKEN_OPTIONS = Object.freeze({
  requireToken: false,
  keepActive: true
});
const REQUIRED_UPDATE_TOKEN_OPTIONS = Object.freeze({
  requireToken: true,
  allowOperationTokenFallback: true
});
const REQUIRED_CREATE_TOKEN_OPTIONS = Object.freeze({
  requireToken: true,
  allowOperationTokenFallback: true
});
const REQUIRED_DELETE_TOKEN_OPTIONS = Object.freeze({
  requireToken: true,
  allowOperationTokenFallback: true
});

router.get('/',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.READ_ALL),
  ctrl.listQuestions);

router.get('/form-options',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.READ_ALL),
  ctrl.getFormOptions);

router.get('/question-types',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.READ_ALL),
  ctrl.listQuestionTypes);

router.get('/family/:familyId/revisions',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.READ_ALL),
  ctrl.getFamilyRevisions);

router.post('/validate',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.READ_ALL, { requireToken: true, allowOperationTokenFallback: true }),
  ctrl.validateDraft);

router.post('/ai-assist/type-fields',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE, REQUIRED_UPDATE_TOKEN_OPTIONS),
  ctrl.aiAssistTypeFields);

router.get('/scoring/profile',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.READ_ALL),
  ctrl.getTypeScoringProfile);

router.get('/media/library',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.READ_ALL),
  ctrl.listOrgMediaLibrary);

router.get('/api/template/:id',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.READ_ALL),
  ctrl.getQuestionTemplate);

router.get('/preview/exam/:id',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.READ_ALL),
  ctrl.showExamPreview);

router.post('/preview/exam',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.READ_ALL),
  ctrl.showExamPreview);

router.post('/media/upload',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE, { requireToken: true }),
  pteUploadContext.setQuestionBankContext,
  upload('pte-question-bank', false).array('files', 10),
  ctrl.uploadMedia);

router.get('/:id/media/:mediaId/download',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.DOWNLOAD_FILE),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.DOWNLOAD_FILE),
  ctrl.downloadMedia);

router.get('/new',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.CREATE),
  ctrl.showForm);

router.post('/new',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.CREATE, REQUIRED_CREATE_TOKEN_OPTIONS),
  pteUploadContext.setQuestionBankContext,
  upload('pte-question-bank', false).array('mediaFiles', 10),
  ctrl.saveQuestion);

router.get('/edit/:id',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE),
  ctrl.showForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE, REQUIRED_UPDATE_TOKEN_OPTIONS),
  pteUploadContext.setQuestionBankContext,
  upload('pte-question-bank', false).array('mediaFiles', 10),
  ctrl.saveQuestion);

router.post('/mutation-token/update/:id',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE, MUTATION_TOKEN_OPTIONS),
  ctrl.issueMutationToken);

router.post('/mutation-token/update',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE, MUTATION_TOKEN_OPTIONS),
  ctrl.issueMutationToken);

router.post('/mutation-token/read-all',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.READ_ALL, MUTATION_TOKEN_OPTIONS),
  ctrl.issueMutationToken);

router.post('/mutation-token/read-all/:id',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.READ_ALL, MUTATION_TOKEN_OPTIONS),
  ctrl.issueMutationToken);

router.post('/mutation-token/create/:id',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.CREATE, MUTATION_TOKEN_OPTIONS),
  ctrl.issueMutationToken);

router.post('/mutation-token/create',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.CREATE, MUTATION_TOKEN_OPTIONS),
  ctrl.issueMutationToken);

router.post('/mutation-token/delete/:id',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.DELETE),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.DELETE, MUTATION_TOKEN_OPTIONS),
  ctrl.issueMutationToken);

router.post('/bulk/mutation-token/update',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE, MUTATION_TOKEN_OPTIONS),
  ctrl.issueMutationToken);

router.post('/publish/:id',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE, REQUIRED_UPDATE_TOKEN_OPTIONS),
  ctrl.publishQuestion);

router.post('/bulk/publish',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE, REQUIRED_UPDATE_TOKEN_OPTIONS),
  ctrl.bulkPublishQuestions);

router.post('/unpublish/:id',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE, REQUIRED_UPDATE_TOKEN_OPTIONS),
  ctrl.unpublishQuestion);

router.post('/bulk/unpublish',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE, REQUIRED_UPDATE_TOKEN_OPTIONS),
  ctrl.bulkUnpublishQuestions);

router.post('/revise/:id',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE, REQUIRED_UPDATE_TOKEN_OPTIONS),
  ctrl.reviseQuestion);

router.post('/retire/:id',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE, REQUIRED_UPDATE_TOKEN_OPTIONS),
  ctrl.retireQuestion);

router.post('/archive/:id',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.UPDATE, REQUIRED_UPDATE_TOKEN_OPTIONS),
  ctrl.archiveQuestion);

router.post('/duplicate-family/:id',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.CREATE, REQUIRED_CREATE_TOKEN_OPTIONS),
  ctrl.duplicateFamily);

router.delete('/delete/:id',
  requireAccess(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.DELETE),
  trackActionState(SECTIONS.PTE_QUESTIONS_BANK, OPERATIONS.DELETE, REQUIRED_DELETE_TOKEN_OPTIONS),
  ctrl.deleteQuestion);

module.exports = router;
