const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/teacherController');
const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

const upload = requireCoreModule('MVC/middleware/upload');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.READ_ALL),
  ctrl.listTeachers);

router.get('/archived',
  requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.READ_ALL),
  ctrl.listArchivedTeachers);

router.get('/api/eligible-persons',
  requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.CREATE, { requireToken: false, keepActive: true }),
  ctrl.listEligiblePersons);

router.get('/api/name-matches',
  requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.CREATE, { requireToken: false, keepActive: true }),
  ctrl.listNameMatches);

router.get('/:id/attachments/:attId/download',
  requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.DOWNLOAD_FILE),
  trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.DOWNLOAD_FILE),
  ctrl.downloadAttachment);

router.delete('/:id/attachments/:attId',
  requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.DELETE_FILE),
  trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.DELETE_FILE, {
    requireToken: true,
    allowOperationTokenFallback: true
  }),
  ctrl.deleteAttachment);

router.get('/:id/system-id-impact', requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.UPDATE), trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }), ctrl.previewTeacherSystemIdChange);
router.get('/:id/system-id-generate', requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.UPDATE), trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }), ctrl.generateTeacherSystemId);
router.post('/:id/change-system-id', requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.UPDATE), trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.UPDATE, { requireToken: true, keepActive: true }), ctrl.changeTeacherSystemId);

router.post('/recover/:id',
  requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.recoverTeacher);

router.get('/archive/:id',
  requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.DELETE),
  ctrl.archiveTeacher);

router.post('/archive/:id',
  requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.archiveTeacher);

router.get('/new',
  requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.CREATE),
  ctrl.showForm);

router.post('/new',
  requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.CREATE, { requireToken: true }),
  upload('school-teachers', true).array('files', 5),
  ctrl.saveTeacher);

router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.UPDATE),
  ctrl.showForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.UPDATE, { requireToken: true }),
  upload('school-teachers', true).array('files', 5),
  ctrl.saveTeacher);

router.get('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.DELETE),
  ctrl.deleteTeacher);

router.delete('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_TEACHERS, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteTeacher);

module.exports = router;
