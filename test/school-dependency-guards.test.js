const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const schoolDependencyService = require('../packages/school/MVC/services/school/schoolDependencyService');
const timesheetModel = require('../packages/school/MVC/models/school/timesheetModel');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('schoolDependencyService extracts class, activity, and report refs from timesheet entries', () => {
  const refs = schoolDependencyService.collectTimesheetSourceRefs({
    status: 'submitted',
    submissionSnapshot: {
      submittedAt: '2026-07-01T12:00:00.000Z',
      sourcePeriodId: 'TSP_1',
      entries: [
        { sessionId: 'SES_1', classId: 'CLS_1', hours: 2 },
        { sessionId: 'act-ACT_9-ENTRY-1-P_100', hours: 1.5, activityId: 'ACT_9' },
        { sessionId: 'rptref-RA_55', hours: 1, isReportReflection: true }
      ]
    }
  });

  assert.ok(refs.some((ref) => ref.type === 'classSession' && ref.classId === 'CLS_1' && ref.sessionId === 'SES_1'));
  assert.ok(refs.some((ref) => ref.type === 'activity' && ref.activityId === 'ACT_9'));
  assert.ok(refs.some((ref) => ref.type === 'reportAssignment' && ref.assignmentId === 'RA_55'));
});

test('schoolDependencyService parses activity session ids', () => {
  const parsed = schoolDependencyService.parseActivitySessionId('act-ACT_9-ENTRY-1-P_100');
  assert.deepEqual(parsed, {
    activityId: 'ACT_9',
    activityEntryId: 'ENTRY-1',
    personId: 'P_100'
  });
});

test('timesheet model accepts approved status and approval metadata', () => {
  const payload = timesheetModel.sanitizeTimesheetPayload({
    orgId: '900000',
    periodId: 'TSP_APPROVE_1',
    teacherId: 'P_900',
    status: 'approved',
    approvedAt: '2026-07-02T10:00:00.000Z',
    approvedBy: 'admin_1',
    lockedSourceRefs: [{ type: 'classSession', classId: 'CLS_1', sessionId: 'SES_1' }],
    entries: [{
      sessionId: 'SES_1',
      classId: 'CLS_1',
      date: '2026-07-01',
      hours: 2,
      status: 'taught'
    }]
  });

  assert.equal(payload.status, 'approved');
  assert.equal(payload.approvedAt, '2026-07-02T10:00:00.000Z');
  assert.equal(payload.approvedBy, 'admin_1');
  assert.equal(payload.lockedSourceRefs.length, 1);
  assert.equal(payload.lockedSourceRefs[0].sessionId, 'SES_1');
});

test('timesheet routes expose approve and reopen admin endpoints', () => {
  const source = read('packages/school/MVC/routes/timesheetRoutes.js');
  assert.match(source, /approveTimesheet/);
  assert.match(source, /reopenTimesheet/);
  assert.match(source, /\/editor\/:periodId\/approve/);
  assert.match(source, /\/editor\/:periodId\/reopen/);
});

test('timesheet editor renders frozen snapshot rows and admin approval controls', () => {
  const source = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  assert.match(source, /USE_FROZEN_SNAPSHOT/);
  assert.match(source, /SNAPSHOT_ENTRIES/);
  assert.match(source, /btnApproveTimesheet/);
  assert.match(source, /btnReopenTimesheet/);
  assert.match(source, /executeAdminTimesheetAction/);
});

test('activity delete path checks dependency service before removal', () => {
  const source = read('packages/school/MVC/controllers/school/activityController.js');
  assert.match(source, /assertSourceNotReferenced/);
  assert.match(source, /assertActivityNotTimesheetLocked/);
});

test('class delete path checks locked sessions and approved timesheet references', () => {
  const source = read('packages/school/MVC/controllers/school/classController.js');
  assert.match(source, /assertClassHasNoLockedSessions/);
  assert.match(source, /assertClassSessionsNotReferencedByApprovedTimesheets/);
  assert.match(source, /assertSessionNotTimesheetLocked/);
});

test('timesheet period delete is blocked when timesheets exist', () => {
  const source = read('packages/school/MVC/controllers/school/timesheetPeriodController.js');
  assert.match(source, /assertPeriodHasNoTimesheets/);
});

test('assertActivityNotTimesheetLocked rejects timesheet-locked activities', () => {
  assert.throws(() => {
    schoolDependencyService.assertActivityNotTimesheetLocked({
      locked: true,
      lockReason: 'timesheet_approved',
      entries: []
    }, 'Locked activity');
  }, /locked by an approved timesheet/i);
});

test('meetsMinTimesheetStatus treats approved as guarded status', () => {
  assert.equal(schoolDependencyService.meetsMinTimesheetStatus('submitted', 'approved'), false);
  assert.equal(schoolDependencyService.meetsMinTimesheetStatus('approved', 'approved'), true);
  assert.equal(schoolDependencyService.meetsMinTimesheetStatus('processed', 'approved'), true);
});

test('timesheet list and manage views surface approved status', () => {
  const listSource = read('packages/school/MVC/views/school/timesheet/timesheetList.ejs');
  const manageSource = read('packages/school/MVC/views/school/timesheet/timesheetManage.ejs');
  assert.match(listSource, /'approved'/);
  assert.match(listSource, /tsStatus === 'approved'/);
  assert.match(manageSource, /value="approved"/);
  assert.match(manageSource, /approved:/);
});

test('timesheet editor shows admin approve independently of teacher read-only state', () => {
  const source = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  assert.match(source, /adminCanApprove/);
  assert.match(source, /adminCanReopen/);
  assert.match(source, /isEditorLocked/);
  assert.match(source, /btnApproveTimesheet[\s\S]*btnReopenTimesheet/);
});

test('prior period adjustment service treats approved timesheets as frozen', () => {
  const source = read('packages/school/MVC/services/school/timesheetPriorPeriodAdjustmentService.js');
  assert.match(source, /tsStatus === 'approved'/);
});
