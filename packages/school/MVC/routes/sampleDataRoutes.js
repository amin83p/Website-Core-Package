const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/schoolSampleDataController');
const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

const adminApproval = requireCoreModule('MVC/middleware/adminApproval');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_SAMPLE_DATA, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_SAMPLE_DATA, OPERATIONS.CREATE),
  ctrl.showForm);

router.post('/',
  requireAccess(SECTIONS.SCHOOL_SAMPLE_DATA, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_SAMPLE_DATA, OPERATIONS.CREATE, { requireToken: true }),
  adminApproval,
  ctrl.generate);

router.post('/clear-transactional',
  requireAccess(SECTIONS.SCHOOL_SAMPLE_DATA, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_SAMPLE_DATA, OPERATIONS.CREATE, { requireToken: true }),
  adminApproval,
  ctrl.clearTransactionalData);

router.get('/people-delete-preview',
  requireAccess(SECTIONS.SCHOOL_SAMPLE_DATA, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_SAMPLE_DATA, OPERATIONS.CREATE),
  ctrl.listPeopleDeletePreview);

router.post('/people-delete',
  requireAccess(SECTIONS.SCHOOL_SAMPLE_DATA, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_SAMPLE_DATA, OPERATIONS.CREATE, { requireToken: true }),
  adminApproval,
  ctrl.deleteSelectedSamplePeople);

module.exports = router;
