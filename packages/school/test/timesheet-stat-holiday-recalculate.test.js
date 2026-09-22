'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const timesheetPrintService = require('../MVC/services/school/timesheetPrintService');
const timesheetStatHolidayRecalculationService = require('../MVC/services/school/timesheetStatHolidayRecalculationService');
const statutoryHolidayTimesheetLifecycleService = require('../MVC/services/school/statutoryHolidayTimesheetLifecycleService');

test('materializeStatHolidayForEntryRows uses reviewer path on reviewer save', async () => {
  const originalUpdate = statutoryHolidayTimesheetLifecycleService.updateStatHolidayOnReviewerSave;
  let capturedMode = '';
  statutoryHolidayTimesheetLifecycleService.updateStatHolidayOnReviewerSave = async (ctx) => {
    capturedMode = 'reviewer';
    return { rows: [], warnings: [], usesActivityMode: true, blockingErrors: [] };
  };
  statutoryHolidayTimesheetLifecycleService.isStatHolidayPayEnabled = () => true;
  statutoryHolidayTimesheetLifecycleService.resolveStatHolidayOverridePermission = async () => false;
  statutoryHolidayTimesheetLifecycleService.mergeStatHolidayRowsIntoEntries = ({ entries }) => entries;

  const dataService = require('../MVC/services/school/schoolDataService');
  const originalHolidays = dataService.fetchAllData;
  dataService.fetchAllData = async (entity) => (entity === 'holidays' ? [] : originalHolidays(entity));

  const activityService = require('../MVC/services/school/activityService');
  const originalActivity = activityService.getTimesheetEntriesForPerson;
  activityService.getTimesheetEntriesForPerson = async () => [];

  try {
    await timesheetStatHolidayRecalculationService.materializeStatHolidayForEntryRows({
      activeOrgId: 'ORG_1',
      period: { id: 'P1', startDate: '2026-01-01', endDate: '2026-01-31' },
      teacherContext: { targetTeacherId: 'T1' },
      entryRows: [{
        isManual: true,
        approvalStatus: 'pending_approval',
        requestedHours: 5,
        date: '2026-01-10',
        deliveryDepartmentId: 'DEPT_1'
      }],
      existing: { id: 'TS1', status: 'submitted' },
      existingEntriesBySessionId: new Map(),
      reqUser: { id: 'U1', activeOrgId: 'ORG_1' },
      timesheetParametersPolicy: { statutoryHolidayPay: { enabled: true, activityId: 'ACT_1' } },
      payrollContext: { personName: 'Teacher' },
      supplementalLiveSessions: [],
      materializeMode: 'reviewer',
      reviewerEdit: true
    });
    assert.equal(capturedMode, 'reviewer');
  } finally {
    statutoryHolidayTimesheetLifecycleService.updateStatHolidayOnReviewerSave = originalUpdate;
    dataService.fetchAllData = originalHolidays;
    activityService.getTimesheetEntriesForPerson = originalActivity;
  }
});

test('planning hours still exclude pending manual from payable totals', () => {
  const pending = {
    isManual: true,
    approvalStatus: 'pending_approval',
    requestedHours: 6
  };
  assert.equal(timesheetPrintService.resolvePayableHours(pending), 0);
  assert.equal(timesheetPrintService.resolveStatHolidayPlanningHours(pending), 6);
});
