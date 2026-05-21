const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/school/schoolSampleDataController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const adminApproval = require('../../middleware/adminApproval');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

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
