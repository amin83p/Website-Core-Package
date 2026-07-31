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

router.get('/api/data',
  requireAccess(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ATTENDANCES, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.getAttendanceData);

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

module.exports = router;
