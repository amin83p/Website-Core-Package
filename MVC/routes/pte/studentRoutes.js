const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/pte/studentController');
const upload = require('../../middleware/upload');
const pteUploadContext = require('../../middleware/pteUploadContextMiddleware');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.PTE_STUDENTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_STUDENTS, OPERATIONS.READ_ALL),
  ctrl.listStudents);

router.get('/archived',
  requireAccess(SECTIONS.PTE_STUDENTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_STUDENTS, OPERATIONS.READ_ALL),
  ctrl.listArchivedStudents);

router.post('/recover/:id',
  requireAccess(SECTIONS.PTE_STUDENTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_STUDENTS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.recoverApplicant);

router.get('/picker/persons',
  requireAccess(SECTIONS.PTE_STUDENTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_STUDENTS, OPERATIONS.READ_ALL),
  ctrl.pickerPersons);

router.get('/picker/courses',
  requireAccess(SECTIONS.PTE_STUDENTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_STUDENTS, OPERATIONS.READ_ALL),
  ctrl.pickerCourses);

router.get('/picker/packages',
  requireAccess(SECTIONS.PTE_STUDENTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_STUDENTS, OPERATIONS.READ_ALL),
  ctrl.pickerPackages);

router.get('/media/library',
  requireAccess(SECTIONS.PTE_STUDENTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_STUDENTS, OPERATIONS.READ_ALL),
  ctrl.listOrgMediaLibrary);

router.post('/media/upload',
  requireAccess(SECTIONS.PTE_STUDENTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_STUDENTS, OPERATIONS.UPDATE, { requireToken: true }),
  pteUploadContext.setStudentContext({ publicApplicant: false }),
  upload('pte-students', false).array('files', 10),
  ctrl.uploadMedia);

router.get('/:id/attachments/:attId/download',
  requireAccess(SECTIONS.PTE_STUDENTS, OPERATIONS.DOWNLOAD_FILE),
  trackActionState(SECTIONS.PTE_STUDENTS, OPERATIONS.DOWNLOAD_FILE),
  ctrl.downloadAttachment);

router.delete('/:id/attachments/:attId',
  requireAccess(SECTIONS.PTE_STUDENTS, OPERATIONS.DELETE_FILE),
  trackActionState(SECTIONS.PTE_STUDENTS, OPERATIONS.DELETE_FILE, { requireToken: true }),
  ctrl.deleteAttachment);

router.get('/new',
  requireAccess(SECTIONS.PTE_STUDENTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_STUDENTS, OPERATIONS.CREATE),
  ctrl.showForm);

router.post('/new',
  requireAccess(SECTIONS.PTE_STUDENTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_STUDENTS, OPERATIONS.CREATE, { requireToken: true }),
  pteUploadContext.setStudentContext({ publicApplicant: false }),
  upload('pte-students', true).array('files', 5),
  ctrl.saveApplicant);

router.get('/edit/:id',
  requireAccess(SECTIONS.PTE_STUDENTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_STUDENTS, OPERATIONS.UPDATE),
  ctrl.showForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.PTE_STUDENTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_STUDENTS, OPERATIONS.UPDATE, { requireToken: true }),
  pteUploadContext.setStudentContext({ publicApplicant: false }),
  upload('pte-students', true).array('files', 5),
  ctrl.saveApplicant);

router.get('/delete/:id',
  requireAccess(SECTIONS.PTE_STUDENTS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.PTE_STUDENTS, OPERATIONS.DELETE),
  ctrl.archiveApplicant);

router.delete('/delete/:id',
  requireAccess(SECTIONS.PTE_STUDENTS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.PTE_STUDENTS, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.archiveApplicant);

// Compatibility shim: prefer package-owned route implementation.
module.exports = require('../../../packages/pte/MVC/routes/studentRoutes');
