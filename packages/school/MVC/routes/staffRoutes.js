const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/staffController');
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
  requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.READ_ALL),
  ctrl.listStaff);

router.get('/archived',
  requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.READ_ALL),
  ctrl.listArchivedStaff);

router.get('/api/eligible-persons',
  requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.CREATE, { requireToken: false, keepActive: true }),
  ctrl.listEligiblePersons);

router.get('/:id/attachments/:attId/download',
  requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.DOWNLOAD_FILE),
  trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.DOWNLOAD_FILE),
  ctrl.downloadAttachment);

router.delete('/:id/attachments/:attId',
  requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.DELETE_FILE),
  trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.DELETE_FILE, {
    requireToken: true,
    allowOperationTokenFallback: true
  }),
  ctrl.deleteAttachment);

router.get('/:id/system-id-impact', requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.UPDATE), trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }), ctrl.previewStaffSystemIdChange);
router.get('/:id/system-id-generate', requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.UPDATE), trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }), ctrl.generateStaffSystemId);
router.post('/:id/change-system-id', requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.UPDATE), trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.UPDATE, { requireToken: true, keepActive: true }), ctrl.changeStaffSystemId);

router.post('/recover/:id',
  requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.recoverStaff);

router.get('/archive/:id',
  requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.DELETE),
  ctrl.archiveStaff);

router.post('/archive/:id',
  requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.archiveStaff);

router.get('/new',
  requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.CREATE),
  ctrl.showForm);

router.post('/new',
  requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.CREATE, { requireToken: true }),
  upload('school-staff', true).array('files', 5),
  ctrl.saveStaff);

router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.UPDATE),
  ctrl.showForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.UPDATE, { requireToken: true }),
  upload('school-staff', true).array('files', 5),
  ctrl.saveStaff);

router.get('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.DELETE),
  ctrl.deleteStaff);

router.delete('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteStaff);

module.exports = router;
