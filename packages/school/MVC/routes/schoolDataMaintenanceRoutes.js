const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/schoolDataMaintenanceController');
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
  requireAccess(SECTIONS.SCHOOL_DATA_MAINTENANCE, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_DATA_MAINTENANCE, OPERATIONS.CREATE),
  ctrl.showPage);

router.get('/api/summary',
  requireAccess(SECTIONS.SCHOOL_DATA_MAINTENANCE, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_DATA_MAINTENANCE, OPERATIONS.CREATE),
  ctrl.getSummary);

router.get('/api/:entityType/rows',
  requireAccess(SECTIONS.SCHOOL_DATA_MAINTENANCE, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_DATA_MAINTENANCE, OPERATIONS.CREATE),
  ctrl.listRows);

router.post('/api/:entityType/delete-preview',
  requireAccess(SECTIONS.SCHOOL_DATA_MAINTENANCE, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_DATA_MAINTENANCE, OPERATIONS.CREATE),
  ctrl.previewDelete);

router.post('/api/:entityType/delete',
  requireAccess(SECTIONS.SCHOOL_DATA_MAINTENANCE, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_DATA_MAINTENANCE, OPERATIONS.CREATE, { requireToken: true }),
  adminApproval,
  ctrl.deleteSelected);

router.post('/api/:entityType/clear-all',
  requireAccess(SECTIONS.SCHOOL_DATA_MAINTENANCE, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_DATA_MAINTENANCE, OPERATIONS.CREATE, { requireToken: true }),
  adminApproval,
  ctrl.clearAll);

module.exports = router;
