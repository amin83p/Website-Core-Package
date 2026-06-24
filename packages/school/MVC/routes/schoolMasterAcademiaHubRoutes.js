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
  SECTIONS.SCHOOL_NOTIFICATIONS,
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

router.get('/api/notification-count',
  requireAccess(SECTIONS.SCHOOL_NOTIFICATIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_NOTIFICATIONS, OPERATIONS.READ_ALL),
  ctrl.getNotificationCount);

router.get('/api/workspace/:sectionKey',
  requireAccessAny(WORKSPACE_READ_SECTIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_MASTER_ACADEMIA_HUB, OPERATIONS.READ_ALL),
  ctrl.getWorkspaceSection);

module.exports = router;
