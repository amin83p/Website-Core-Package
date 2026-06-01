const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/timesheetPeriodController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_TIMESHEET_PERIODS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TIMESHEET_PERIODS, OPERATIONS.READ_ALL),
  ctrl.listTimesheetPeriods);

router.get('/new',
  requireAccess(SECTIONS.SCHOOL_TIMESHEET_PERIODS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TIMESHEET_PERIODS, OPERATIONS.CREATE),
  ctrl.showCreateForm);
router.post('/new',
  requireAccess(SECTIONS.SCHOOL_TIMESHEET_PERIODS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TIMESHEET_PERIODS, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveTimesheetPeriod);

router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_TIMESHEET_PERIODS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TIMESHEET_PERIODS, OPERATIONS.UPDATE),
  ctrl.showEditForm);
router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_TIMESHEET_PERIODS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TIMESHEET_PERIODS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveTimesheetPeriod);

router.get('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_TIMESHEET_PERIODS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_TIMESHEET_PERIODS, OPERATIONS.DELETE),
  ctrl.deleteTimesheetPeriod);

router.delete('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_TIMESHEET_PERIODS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_TIMESHEET_PERIODS, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteTimesheetPeriod);

module.exports = router;
