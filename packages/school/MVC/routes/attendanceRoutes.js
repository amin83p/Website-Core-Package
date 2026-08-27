const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/attendanceController');
const settingsCtrl = require('../controllers/school/schoolSettingsController');
const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const {
  requireAuth,
  requireAccess,
  requireAccessAny,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

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
  requireAccess(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.READ_ALL),
  settingsCtrl.redirectLegacyAttendanceSettings);

router.post('/settings',
  requireAccess(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SETTINGS, OPERATIONS.UPDATE, { requireToken: true, keepActive: true }),
  settingsCtrl.saveAttendanceMatrix);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.showAttendancePage);

router.get('/report',
  requireAccess(SECTIONS.SCHOOL_ATTENDANCE_REPORT, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCE_REPORT, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.showStudentAttendanceReportPage);

router.get('/report/api/data',
  requireAccess(SECTIONS.SCHOOL_ATTENDANCE_REPORT, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCE_REPORT, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.getStudentAttendanceReportData);

router.post('/report/api/generate',
  requireAccess(SECTIONS.SCHOOL_ATTENDANCE_REPORT, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCE_REPORT, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.generateStudentAttendanceReport);

router.get('/report/api/export-plan',
  requireAccess(SECTIONS.SCHOOL_ATTENDANCE_REPORT, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCE_REPORT, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.getStudentAttendanceReportExportPlan);

router.post('/report/api/export',
  requireAccess(SECTIONS.SCHOOL_ATTENDANCE_REPORT, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCE_REPORT, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.exportStudentAttendanceReport);

router.get('/api/data',
  requireAccess(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.getAttendanceData);

router.post('/api/rollups',
  requireAccess(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  ctrl.postAttendanceRollups);

router.get('/api/export.xlsx',
  requireAccess(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.exportAttendanceExcel);

router.get('/api/active-classes',
  requireAccess(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE),
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

router.get('/api/change-log',
  requireAccess(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.getAttendanceChangeLog);

router.post('/api/change-log/query',
  requireAccess(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.queryAttendanceChangeLogs);

module.exports = router;
