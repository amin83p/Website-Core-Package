const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/studentController');
const studentImportCtrl = require('../controllers/school/studentImportController');
const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

const upload = requireCoreModule('MVC/middleware/upload');
const adminApproval = requireCoreModule('MVC/middleware/adminApproval');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.READ_ALL),
  ctrl.listStudents);

router.get('/archived',
  requireAccess(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.READ_ALL),
  ctrl.listArchivedStudents);

router.post('/import',
  requireAccess(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.IMPORT),
  trackActionState(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.IMPORT, { requireToken: false }),
  adminApproval,
  upload('imports').single('importFile'),
  studentImportCtrl.startImport);

router.get('/import/stream/:jobId',
  requireAuth,
  studentImportCtrl.streamImportStatus);

router.post('/import/abort/:jobId',
  requireAuth,
  studentImportCtrl.abortImport);

router.get('/import/report/:jobId',
  requireAuth,
  studentImportCtrl.downloadImportReport);

router.get('/api/eligible-persons',
  requireAccess(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.CREATE, { requireToken: false, keepActive: true }),
  ctrl.listEligiblePersons);

router.get('/api/name-matches',
  requireAccess(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.CREATE, { requireToken: false, keepActive: true }),
  ctrl.listNameMatches);

router.post('/recover/:id',
  requireAccess(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.recoverStudent);

router.get('/archive/:id',
  requireAccess(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.DELETE),
  ctrl.archiveStudent);

router.post('/archive/:id',
  requireAccess(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.archiveStudent);

router.get('/:id/attachments/:attId/download',
  requireAccess(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.DOWNLOAD_FILE),
  trackActionState(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.DOWNLOAD_FILE),
  ctrl.downloadAttachment);

router.delete('/:id/attachments/:attId',
  requireAccess(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.DELETE_FILE),
  trackActionState(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.DELETE_FILE, {
    requireToken: true,
    allowOperationTokenFallback: true
  }),
  ctrl.deleteAttachment);

router.get('/:id/system-id-generate',
  requireAccess(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  ctrl.generateStudentSystemId);

router.get('/:id/system-id-impact',
  requireAccess(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  ctrl.previewStudentSystemIdChange);

router.post('/system-id-migrations/:migrationId/recover',
  requireAccess(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.recoverStudentSystemIdMigration);

router.post('/:id/change-system-id',
  requireAccess(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.changeStudentSystemId);

router.get('/new',
  requireAccess(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.CREATE),
  ctrl.showForm);
router.post('/new',
  requireAccess(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.CREATE, { requireToken: true }),
  upload('school-students', true).array('files', 5),
  ctrl.saveStudent);

router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.UPDATE),
  ctrl.showForm);
router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.UPDATE, { requireToken: true }),
  upload('school-students', true).array('files', 5),
  ctrl.saveStudent);

router.get('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.DELETE),
  ctrl.deleteStudent);
router.delete('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_STUDENTS, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteStudent);

module.exports = router;
