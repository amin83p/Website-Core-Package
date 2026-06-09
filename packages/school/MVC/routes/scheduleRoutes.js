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

router.get(['/', '/viewer'],
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  ctrl.showSchedulePage);
router.get('/api/person-schedule',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  ctrl.getPersonSchedule);
router.get('/api/school-person-picker',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  ctrl.pickerSchoolSchedulePersons);

router.get('/global',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  ctrl.showGlobalSchedulePage);
router.get('/api/global-schedule',
  requireAccess(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SCHEDULES, OPERATIONS.READ_ALL),
  ctrl.getGlobalSchedule);

module.exports = router;
