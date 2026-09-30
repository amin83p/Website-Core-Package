const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/scheduleController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

router.get('/my',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ),
  ctrl.showMySchedulePage);
router.get('/api/my-schedule',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ),
  ctrl.getMyScheduleData);

router.get('/api/holiday-dates',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.getScheduleHolidayDatesInRange);

router.get(['/', '/viewer'],
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  ctrl.showSchedulePage);
router.get('/api/person-schedule',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  ctrl.getPersonSchedule);
router.get('/api/person-schedule-version',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.getPersonScheduleVersion);
router.get('/api/viewer-preferences',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.getScheduleViewerPreferences);
router.put('/api/viewer-preferences',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  ctrl.saveScheduleViewerPreferences);
router.get('/api/school-person-picker',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.pickerSchoolSchedulePersons);
router.get('/api/active-teachers',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.listActiveTeacherSchedulePersons);
router.get('/api/instructor-classes',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.listInstructorClassesForSchedule);
router.get('/api/session-attendance-list',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.getSessionAttendanceList);
router.get('/api/session-enrollment-list',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.getSessionEnrollmentList);
router.post('/api/commit-staged-sessions',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  requireAccess(SECTIONS.SCHOOL_CLASSES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  ctrl.postCommitStagedSessions);

const enrollStudentsRollingAccess = [
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  requireAccess(SECTIONS.SCHOOL_ROLLING_ENROLLMENT, OPERATIONS.UPDATE)
];
const enrollStudentsProgramAccess = [
  ...enrollStudentsRollingAccess,
  requireAccess(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.CREATE)
];
const enrollStudentsProgramMutationActionState = {
  requireToken: true,
  keepActive: true,
  allowOperationTokenFallback: true,
  allowInactiveTokenFallback: true
};

router.post('/api/enroll-students/prepare',
  ...enrollStudentsRollingAccess,
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.postEnrollStudentsPrepare);
router.post('/api/enroll-students/session-capacity-check',
  ...enrollStudentsRollingAccess,
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.postEnrollStudentsSessionCapacityCheck);
router.post('/api/enroll-students/student-picker-exclusions',
  ...enrollStudentsRollingAccess,
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.postEnrollStudentsStudentPickerExclusions);
router.post('/api/enroll-students/program-registrations',
  ...enrollStudentsProgramAccess,
  trackActionState(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.CREATE, { requireToken: false, keepActive: true }),
  ctrl.postEnrollStudentsProgramRegistrations);
router.post('/api/enroll-students/program-registrations/finalize',
  ...enrollStudentsProgramAccess,
  trackActionState(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.CREATE, enrollStudentsProgramMutationActionState),
  ctrl.postEnrollStudentsProgramRegistrationFinalize);

router.get('/api/session-management-policy',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.getSessionManagementPolicy);
router.post('/api/bulk-delete-sessions/preview',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.DELETE, { requireToken: false, keepActive: true }),
  ctrl.postBulkDeleteSessionsPreview);
router.post('/api/bulk-delete-sessions',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.DELETE, { requireToken: true, keepActive: true }),
  ctrl.postBulkDeleteSessions);
router.post('/api/update-class-session-schedule',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  requireAccess(SECTIONS.SCHOOL_CLASSES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  ctrl.postUpdateClassSessionSchedule);
router.post('/api/update-class-session-status',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  requireAccess(SECTIONS.SCHOOL_CLASSES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  ctrl.postUpdateClassSessionStatus);
router.post('/api/update-work-session-schedule',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  requireAccess(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  ctrl.postUpdateWorkSessionSchedule);

router.get('/global',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  ctrl.showGlobalSchedulePage);
router.get('/api/global-schedule',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  ctrl.getGlobalSchedule);

module.exports = router;
