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
router.post('/api/schedule-viewer/refresh-sessions',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.postScheduleViewerRefreshSessions);
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
router.get('/api/person-schedule-note',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.getPersonScheduleNote);
router.put('/api/person-schedule-note',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  ctrl.savePersonScheduleNote);
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
router.post('/api/commit-staged-sessions/precheck',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  requireAccess(SECTIONS.SCHOOL_CLASSES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.postCommitStagedSessionsPrecheck);

const enrollStudentsRollingAccess = [
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  requireAccess(SECTIONS.SCHOOL_ROLLING_ENROLLMENT, OPERATIONS.UPDATE)
];
const enrollStudentsProgramAccess = [
  ...enrollStudentsRollingAccess,
  requireAccess(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.CREATE)
];
const enrollStudentsProgramMutationActionState = {
  requireToken: false,
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
router.post('/api/enroll-students/validate-pending-commit',
  ...enrollStudentsRollingAccess,
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.postValidatePendingEnrollmentsCommit);
router.post('/api/enroll-students/execute-pending-commit',
  ...enrollStudentsRollingAccess,
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL, {
    requireToken: false,
    keepActive: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.postExecutePendingEnrollmentsCommit);
router.post('/api/manage-enrollments/list',
  ...enrollStudentsRollingAccess,
  trackActionState(SECTIONS.SCHOOL_ROLLING_ENROLLMENT, OPERATIONS.UPDATE, {
    requireToken: false,
    keepActive: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.postManageEnrollmentsList);
router.get('/api/manage-enrollments/funder-options',
  ...enrollStudentsRollingAccess,
  trackActionState(SECTIONS.SCHOOL_ROLLING_ENROLLMENT, OPERATIONS.READ_ALL, {
    requireToken: false,
    keepActive: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.getManageEnrollmentFunderOptions);
router.post('/api/move-sessions/preview',
  ...enrollStudentsRollingAccess,
  requireAccess(SECTIONS.SCHOOL_CLASSES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.postMoveSessionsPreview);
router.post('/api/move-sessions/apply',
  ...enrollStudentsRollingAccess,
  requireAccess(SECTIONS.SCHOOL_CLASSES, OPERATIONS.UPDATE),
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.DELETE, {
    requireToken: false,
    keepActive: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.postMoveSessionsApply);
router.post('/api/merge-sessions/preview',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE, {
    requireToken: false,
    keepActive: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.postMergeSessionsPreview);
router.post('/api/merge-sessions/apply',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE, {
    requireToken: false,
    keepActive: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.postMergeSessionsApply);
router.post('/api/take-over-sessions/preview',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE, {
    requireToken: false,
    keepActive: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.postTakeOverSessionsPreview);
router.post('/api/take-over-sessions/apply',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE, {
    requireToken: false,
    keepActive: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.postTakeOverSessionsApply);
router.post('/api/take-over-sessions/undo-preview',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE, {
    requireToken: false,
    keepActive: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.postUndoTakeOverSessionsPreview);
router.post('/api/take-over-sessions/undo-apply',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE, {
    requireToken: false,
    keepActive: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.postUndoTakeOverSessionsApply);
router.post('/api/add-co-teacher/preview',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE, {
    requireToken: false,
    keepActive: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.postAddCoTeacherPreview);
router.post('/api/add-co-teacher/apply',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE, {
    requireToken: false,
    keepActive: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.postAddCoTeacherApply);

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
