const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/timesheetController');
const {
  requireAuth,
  requireAccess,
  requireAccessAny,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

const timesheetEditorMutationActionState = {
  requireToken: true,
  keepActive: true,
  allowOperationTokenFallback: true,
  allowSectionTokenFallback: true,
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

router.get('/api/manual-entry-classes',
  requireAccess(SECTIONS.SCHOOL_TIMESHEETS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TIMESHEETS, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.listManualEntryClasses);

router.post('/editor/:periodId/api/validate-manual-row',
  requireAccess(SECTIONS.SCHOOL_TIMESHEETS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TIMESHEETS, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  ctrl.validateManualTimesheetRow);

router.get('/editor/:periodId',
  requireAccessAny([SECTIONS.SCHOOL_TIMESHEETS, SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT], OPERATIONS.READ_ALL),
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
  requireAccessAny([SECTIONS.SCHOOL_TIMESHEETS, SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT], OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TIMESHEETS, OPERATIONS.UPDATE, {
    requireToken: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.saveTimesheet);


router.post('/editor/:periodId/approve',
  requireAccess(SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS.UPDATE, timesheetEditorMutationActionState),
  ctrl.approveTimesheet);

router.post('/editor/:periodId/manual-entries/:entryId/decision',
  requireAccess(SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS.UPDATE, timesheetEditorMutationActionState),
  ctrl.decideManualTimesheetRow);

router.post('/editor/:periodId/process',
  requireAccess(SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS.CONFIGURE),
  trackActionState(SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS.CONFIGURE, timesheetEditorMutationActionState),
  ctrl.processTimesheet);

router.post('/editor/:periodId/unprocess',
  requireAccess(SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS.CONFIGURE),
  trackActionState(SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS.CONFIGURE, timesheetEditorMutationActionState),
  ctrl.unprocessTimesheet);

router.post('/editor/:periodId/return',
  requireAccess(SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS.UPDATE, timesheetEditorMutationActionState),
  ctrl.returnTimesheet);

router.post('/editor/:periodId/reopen',
  requireAccess(SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS.UPDATE, timesheetEditorMutationActionState),
  ctrl.returnTimesheet);

module.exports = router;
