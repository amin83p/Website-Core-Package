const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/calendarController');
const {
  requireAuth,
  requireAccessAny,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

const CALENDAR_READ_SECTIONS = Object.freeze([
  SECTIONS.SCHOOL_CALENDAR
].filter(Boolean));

router.use(requireAuth);

router.get('/',
  requireAccessAny(CALENDAR_READ_SECTIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_CALENDAR, OPERATIONS.READ_ALL),
  ctrl.showCalendarPage);

router.get('/api/events',
  requireAccessAny(CALENDAR_READ_SECTIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_CALENDAR, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.getCalendarEvents);

router.get('/api/person-picker',
  requireAccessAny(CALENDAR_READ_SECTIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_CALENDAR, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.pickCalendarPersons);

module.exports = router;
