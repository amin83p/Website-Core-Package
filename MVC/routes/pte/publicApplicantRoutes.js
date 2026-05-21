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
  requireAccess(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.READ_ALL),
  ctrl.listPublicApplicants);

router.get('/archived',
  requireAccess(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.READ_ALL),
  ctrl.listArchivedPublicApplicants);

router.post('/recover/:id',
  requireAccess(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.recoverPublicApplicant);

router.post('/promote/:id',
  requireAccess(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.promotePublicApplicant);

router.get('/picker/persons',
  requireAccess(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.READ_ALL),
  ctrl.pickerPersons);

router.get('/picker/courses',
  requireAccess(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.READ_ALL),
  ctrl.pickerCourses);

router.get('/picker/packages',
  requireAccess(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.READ_ALL),
  ctrl.pickerPackages);

router.get('/media/library',
  requireAccess(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.READ_ALL),
  ctrl.listOrgMediaLibrary);

router.post('/media/upload',
  requireAccess(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.UPDATE, { requireToken: true }),
  pteUploadContext.setStudentContext({ publicApplicant: true }),
  upload('pte-students', false).array('files', 10),
  ctrl.uploadMedia);

router.get('/:id/attachments/:attId/download',
  requireAccess(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.DOWNLOAD_FILE),
  trackActionState(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.DOWNLOAD_FILE),
  ctrl.downloadPublicAttachment);

router.delete('/:id/attachments/:attId',
  requireAccess(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.DELETE_FILE),
  trackActionState(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.DELETE_FILE, { requireToken: true }),
  ctrl.deletePublicAttachment);

router.get('/edit/:id',
  requireAccess(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.UPDATE),
  ctrl.showPublicApplicantForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.UPDATE, { requireToken: true }),
  pteUploadContext.setStudentContext({ publicApplicant: true }),
  upload('pte-students', true).array('files', 5),
  ctrl.savePublicApplicant);

router.get('/delete/:id',
  requireAccess(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.DELETE),
  ctrl.archivePublicApplicant);

router.delete('/delete/:id',
  requireAccess(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.PTE_PUBLIC_APPLICANTS, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.archivePublicApplicant);

module.exports = router;
