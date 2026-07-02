const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const timesheetModel = require('../packages/school/MVC/models/school/timesheetModel');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('timesheet editor manual modal uses activity definitions and class time inputs', () => {
  const source = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  assert.match(source, /manualActivities/);
  assert.match(source, /data-paid=/);
  assert.match(source, /id="man_startTime"/);
  assert.match(source, /id="man_endTime"/);
  assert.match(source, /Pending Approval/);
  assert.match(source, /INCOMPLETE_SESSIONS/);
  assert.match(source, /incomplete-sessions-table/);
  assert.match(source, /incompleteSessionsPanel/);
});

test('timesheet controller wires activity-based manual options and incomplete warnings', () => {
  const source = read('packages/school/MVC/controllers/school/timesheetController.js');
  assert.match(source, /activityService\.listActivities/);
  assert.match(source, /isPersonEligibleForActivity/);
  assert.match(source, /manualActivities/);
  assert.match(source, /incompleteSessions/);
  assert.match(source, /MANUAL_ENTRY_SCHEDULE_CONFLICT/);
  assert.match(source, /detectRoleAwareManualEntryConflicts/);
});

test('timesheet model stores manual approval fields and excludes pending rows from totals', () => {
  const payload = timesheetModel.sanitizeTimesheetPayload({
    orgId: '900000',
    periodId: 'TSP_RULE_1',
    teacherId: 'P_900',
    status: 'draft',
    entries: [{
      sessionId: 'MAN_1',
      date: '2026-07-01',
      className: 'School Activity - Paid',
      classId: null,
      requestedHours: 2.5,
      durationHours: 2.5,
      hours: 2.5,
      activityId: 'ACT_1',
      activityName: 'Parent Workshop',
      activityPaid: true,
      approvalStatus: 'pending_approval',
      excludeFromTotals: true,
      comment: 'Awaiting approval',
      isManual: true
    }]
  });

  assert.equal(payload.totalHours, 0);
  assert.equal(payload.entries.length, 1);
  assert.equal(payload.entries[0].requestedHours, 2.5);
  assert.equal(payload.entries[0].approvalStatus, 'pending_approval');
  assert.equal(payload.entries[0].excludeFromTotals, true);
  assert.equal(payload.entries[0].hours, 0);
});

test('timesheet model keeps backward compatibility for legacy manual rows', () => {
  const payload = timesheetModel.sanitizeTimesheetPayload({
    orgId: '900000',
    periodId: 'TSP_RULE_2',
    teacherId: 'P_901',
    status: 'draft',
    entries: [{
      sessionId: 'MAN_OLD',
      date: '2026-07-02',
      className: 'Legacy manual row',
      hours: 1.5,
      status: 'manual',
      comment: 'legacy',
      isManual: true
    }]
  });

  assert.equal(payload.totalHours, 1.5);
  assert.equal(payload.entries[0].hours, 1.5);
  assert.equal(payload.entries[0].approvalStatus, 'approved');
  assert.equal(payload.entries[0].excludeFromTotals, false);
});

test('manual conflict service is registered for role-aware schedule validation', () => {
  const source = read('packages/school/MVC/services/school/timesheetManualConflictService.js');
  assert.match(source, /findApprovedLeaveConflicts/);
  assert.match(source, /getScheduleEventsForPerson/);
  assert.match(source, /detectRoleAwareManualEntryConflicts/);
});
