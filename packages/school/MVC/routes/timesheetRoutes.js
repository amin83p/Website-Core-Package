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

const timesheetEditorMutationActionState = {
  requireToken: true,
  keepActive: true,
  allowOperationTokenFallback: true,
  allowInactiveTokenFallback: true
};

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
  trackActionState(SECTIONS.SCHOOL_TIMESHEETS, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.listEligibleTimesheetPersons);

router.get('/editor/:periodId',
  requireAccess(SECTIONS.SCHOOL_TIMESHEETS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TIMESHEETS, OPERATIONS.UPDATE),
  ctrl.viewTimesheet);

router.get('/editor/:periodId/prior-adjustments',
  requireAccess(SECTIONS.SCHOOL_TIMESHEETS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TIMESHEETS, OPERATIONS.READ_ALL, { requireToken: false }),
  ctrl.getPriorAdjustments);

router.post('/editor/:periodId/apply-prior-adjustments',
  requireAccess(SECTIONS.SCHOOL_TIMESHEETS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TIMESHEETS, OPERATIONS.UPDATE, timesheetEditorMutationActionState),
  ctrl.applyPriorAdjustments);

router.post('/editor/:periodId/save',
  requireAccess(SECTIONS.SCHOOL_TIMESHEETS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TIMESHEETS, OPERATIONS.UPDATE, {
    requireToken: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.saveTimesheet);

module.exports = router;
