const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/attendanceController');
const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

const { requireAttendanceMatrixPolicyAdmin } = requireCoreModule('MVC/middleware/attendanceMatrixPolicyAdminMiddleware');

router.use(requireAuth);

router.get('/settings',
  requireAttendanceMatrixPolicyAdmin(),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.showAttendanceMatrixSettings);

router.post('/settings',
  requireAttendanceMatrixPolicyAdmin(),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveAttendanceMatrixSettings);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.READ_ALL),
  ctrl.showAttendancePage);

router.get('/api/data',
  requireAccess(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.READ_ALL),
  ctrl.getAttendanceData);

router.post('/api/comment',
  requireAccess(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.addAttendanceComment);

router.post('/api/update-roster-cell',
  requireAccess(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.updateAttendanceRosterCell);

module.exports = router;
