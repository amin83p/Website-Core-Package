const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/subjectController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');
const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const upload = requireCoreModule('MVC/middleware/upload');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.READ_ALL),
  ctrl.listSubjects);

router.get('/new',
  requireAccess(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.CREATE),
  ctrl.showAddForm);

router.get('/new-wizard',
  requireAccess(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.CREATE),
  ctrl.showAddWizardForm);
router.post('/new',
  requireAccess(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.addSubject);

router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.UPDATE),
  ctrl.showEditForm);

router.post('/:id/attachments/upload',
  requireAccess(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.UPDATE),
  upload('school-subject-workspace', true).single('file'),
  trackActionState(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.UPDATE, { requireToken: true, keepActive: true, allowOperationTokenFallback: true, allowInactiveTokenFallback: true }),
  ctrl.uploadSubjectAttachment);

router.delete('/:id/attachments/:attId',
  requireAccess(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.UPDATE, { requireToken: true, keepActive: true, allowOperationTokenFallback: true, allowInactiveTokenFallback: true }),
  ctrl.deleteSubjectAttachment);

router.get('/edit-wizard/:id',
  requireAccess(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.UPDATE),
  ctrl.showEditWizardForm);
router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.editSubject);

router.get('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.DELETE),
  ctrl.deleteSubject);
router.delete('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteSubject);

module.exports = router;
