const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/timesheetController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

router.get('/manage',
  requireAccess(SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS.READ_ALL),
  ctrl.showTimesheetManagement);

router.get('/manage/api/periods',
  requireAccess(SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS.READ_ALL),
  ctrl.listTimesheetManagementPeriods);

router.get('/manage/api/roster',
  requireAccess(SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS.READ_ALL),
  ctrl.getTimesheetManagementRoster);

router.get('/manage/api/department-summary',
  requireAccess(SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS.READ_ALL),
  ctrl.getTimesheetDepartmentSummary);

router.get('/my-timesheets',
  requireAccess(SECTIONS.SCHOOL_TIMESHEETS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TIMESHEETS, OPERATIONS.READ_ALL),
  ctrl.listMyTimesheets);

router.get('/api/eligible-persons',
  requireAccess(SECTIONS.SCHOOL_TIMESHEETS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TIMESHEETS, OPERATIONS.READ_ALL),
  ctrl.listEligibleTimesheetPersons);

router.get('/editor/:periodId',
  requireAccess(SECTIONS.SCHOOL_TIMESHEETS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TIMESHEETS, OPERATIONS.READ_ALL),
  ctrl.viewTimesheet);

router.post('/editor/:periodId/save',
  requireAccess(SECTIONS.SCHOOL_TIMESHEETS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TIMESHEETS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveTimesheet);

module.exports = router;
