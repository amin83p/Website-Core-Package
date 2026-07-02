const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/schoolMasterAcademiaHubController');
const {
  requireAuth,
  requireAccess,
  requireAccessAny,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

const PEOPLE_READ_SECTIONS = Object.freeze([
  SECTIONS.SCHOOL_STUDENTS,
  SECTIONS.SCHOOL_TEACHERS,
  SECTIONS.SCHOOL_STAFF
]);

const WORKSPACE_READ_SECTIONS = Object.freeze([
  SECTIONS.SCHOOL_CLASSES,
  SECTIONS.SCHOOL_SESSIONS,
  SECTIONS.SCHOOL_SCHEDULES,
  SECTIONS.SCHOOL_ATTENDANCES,
  SECTIONS.SCHOOL_GRADEBOOK,
  SECTIONS.SCHOOL_TIMESHEET_PERIODS,
  SECTIONS.SCHOOL_TASKS,
  SECTIONS.SCHOOL_ACTIVITIES,
  SECTIONS.SCHOOL_REPORTS_ASSIGNMENT,
  SECTIONS.SCHOOL_REPORTS_INSTANCES,
  SECTIONS.SCHOOL_LEAVE_REQUESTS,
  SECTIONS.SCHOOL_HOLIDAYS
]);

router.use(requireAuth);

router.get('/',
  requireAccessAny(PEOPLE_READ_SECTIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_MASTER_ACADEMIA_HUB, OPERATIONS.READ_ALL),
  ctrl.showMasterAcademiaHubPage);

router.get('/api/list',
  requireAccessAny(PEOPLE_READ_SECTIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_MASTER_ACADEMIA_HUB, OPERATIONS.READ_ALL),
  ctrl.listPeoplePanel);

router.get('/api/task-count',
  requireAccess(SECTIONS.SCHOOL_TASKS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TASKS, OPERATIONS.READ_ALL),
  ctrl.getTaskCount);

router.get('/api/workspace/:sectionKey',
  requireAccessAny(WORKSPACE_READ_SECTIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_MASTER_ACADEMIA_HUB, OPERATIONS.READ_ALL),
  ctrl.getWorkspaceSection);

router.post('/api/workspace/sessions/lock',
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  ctrl.lockWorkspaceSessions);

router.post('/api/workspace/sessions/update',
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  ctrl.updateWorkspaceSession);

module.exports = router;
