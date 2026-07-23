const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/attendanceController');
const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const {
  requireAuth,
  requireAccess,
  requireAccessAny,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

const { requireAttendanceMatrixPolicyAdmin } = require('../middleware/attendanceMatrixPolicyAdminMiddleware');
const upload = requireCoreModule('MVC/middleware/upload');

router.use(requireAuth);

const attendanceMatrixMutationActionState = Object.freeze({
  requireToken: true,
  keepActive: true,
  allowOperationTokenFallback: true,
  allowSectionTokenFallback: true,
  allowInactiveTokenFallback: true
});

router.get('/settings',
  requireAttendanceMatrixPolicyAdmin(),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.showAttendanceMatrixSettings);

router.post('/settings',
  requireAttendanceMatrixPolicyAdmin(),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveAttendanceMatrixSettings);

router.get('/',
  requireAttendanceMatrixPolicyAdmin(),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.showAttendancePage);

router.get('/api/data',
  requireAttendanceMatrixPolicyAdmin(),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.getAttendanceData);

router.get('/api/export.xlsx',
  requireAttendanceMatrixPolicyAdmin(),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.exportAttendanceExcel);

router.get('/api/active-classes',
  requireAttendanceMatrixPolicyAdmin(),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.listActiveAttendanceClasses);

router.post('/api/comment',
  requireAccessAny([SECTIONS.SCHOOL_ATTENDANCES, SECTIONS.SCHOOL_SESSIONS].filter(Boolean), OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, attendanceMatrixMutationActionState),
  ctrl.addAttendanceComment);

router.post('/api/files/upload',
  requireAccessAny([SECTIONS.SCHOOL_ATTENDANCES, SECTIONS.SCHOOL_SESSIONS].filter(Boolean), OPERATIONS.UPDATE),
  upload('school-class-workspace', true).single('file'),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, attendanceMatrixMutationActionState),
  ctrl.uploadAttendanceFile);

router.post('/api/update-roster-cell',
  requireAccess(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, attendanceMatrixMutationActionState),
  ctrl.updateAttendanceRosterCell);

module.exports = router;
