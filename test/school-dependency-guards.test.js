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

test('timesheet model reads legacy approved records as submitted manager-approved records', () => {
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

  assert.equal(payload.status, 'submitted');
  assert.equal(payload.managerReview.status, 'approved');
  assert.equal(payload.managerReview.reviewVersion, payload.reviewVersion);
  assert.equal(payload.approvedAt, '2026-07-02T10:00:00.000Z');
  assert.equal(payload.approvedBy, 'admin_1');
  assert.equal(payload.lockedSourceRefs.length, 1);
  assert.equal(payload.lockedSourceRefs[0].sessionId, 'SES_1');
});

test('timesheet routes expose manager approval, return compatibility, and finance processing endpoints', () => {
  const source = read('packages/school/MVC/routes/timesheetRoutes.js');
  assert.match(source, /approveTimesheet/);
  assert.match(source, /returnTimesheet/);
  assert.match(source, /processTimesheet/);
  assert.match(source, /\/editor\/:periodId\/approve/);
  assert.match(source, /\/editor\/:periodId\/return/);
  assert.match(source, /\/editor\/:periodId\/reopen/);
  assert.match(source, /\/editor\/:periodId\/process/);
});

test('timesheet editor renders frozen snapshot rows and admin approval controls', () => {
  const source = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  assert.match(source, /USE_FROZEN_SNAPSHOT/);
  assert.match(source, /SNAPSHOT_ENTRIES/);
  assert.match(source, /btnApproveTimesheet/);
  assert.match(source, /btnReopenTimesheet/);
  assert.match(source, /executeAdminTimesheetAction/);
});

test('activity delete path is protected by the centralized deletion guard', () => {
  const controllerSource = read('packages/school/MVC/controllers/school/activityController.js');
  const dataServiceSource = read('packages/school/MVC/services/school/schoolDataService.js');
  const ruleRegistrySource = read('packages/school/MVC/services/school/schoolDeletionRuleRegistry.js');
  assert.match(controllerSource, /schoolDataService\.deleteData\('activities'/);
  assert.match(dataServiceSource, /schoolDeletionGuardService\.assertCanDelete/);
  assert.match(ruleRegistrySource, /scanActivityTimesheetLock/);
  assert.match(ruleRegistrySource, /sourceType:\s*'activity'/);
});

test('class delete path is protected against sessions, locks, and timesheet references', () => {
  const controllerSource = read('packages/school/MVC/controllers/school/classController.js');
  const ruleRegistrySource = read('packages/school/MVC/services/school/schoolDeletionRuleRegistry.js');
  assert.match(controllerSource, /schoolDataService\.deleteData\('classes'/);
  assert.match(ruleRegistrySource, /code:\s*'CLASS_SESSION'/);
  assert.match(ruleRegistrySource, /scanClassLockedSessions/);
  assert.match(ruleRegistrySource, /scanClassAllSessionTimesheetRefs/);
  assert.match(ruleRegistrySource, /scanSessionTimesheetLock/);
});

test('timesheet period delete is centrally blocked when timesheets exist', () => {
  const controllerSource = read('packages/school/MVC/controllers/school/timesheetPeriodController.js');
  const ruleRegistrySource = read('packages/school/MVC/services/school/schoolDeletionRuleRegistry.js');
  assert.match(controllerSource, /dataService\.deleteData\('timesheetPeriods'/);
  assert.match(ruleRegistrySource, /scanTimesheetPeriodAnyTimesheets/);
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

test('assertClassSessionLedgerPreservesTimesheetLocks blocks removing timesheet-locked sessions', async () => {
  await assert.rejects(async () => {
    await schoolDependencyService.assertClassSessionLedgerPreservesTimesheetLocks({
      classId: 'CLS_1',
      orgId: '900000',
      existingSessions: [
        { sessionId: 'SES_LOCK', locked: true, lockReason: 'timesheet_approved', date: '2026-07-01' },
        { sessionId: 'SES_OPEN', locked: false, date: '2026-07-02' }
      ],
      incomingSessions: [
        { sessionId: 'SES_OPEN', locked: false, date: '2026-07-02' }
      ],
      reqUser: { id: 'U1' }
    });
  }, /timesheet-locked session\(s\) were removed/i);
});

test('assertClassSessionLedgerPreservesTimesheetLocks blocks unlocking timesheet-locked sessions', async () => {
  await assert.rejects(async () => {
    await schoolDependencyService.assertClassSessionLedgerPreservesTimesheetLocks({
      classId: 'CLS_1',
      orgId: '900000',
      existingSessions: [
        { sessionId: 'SES_LOCK', locked: true, lockReason: 'timesheet_approved', date: '2026-07-01' }
      ],
      incomingSessions: [
        { sessionId: 'SES_LOCK', locked: false, date: '2026-07-01' }
      ],
      reqUser: { id: 'U1' }
    });
  }, /timesheet-locked session\(s\) were unlocked/i);
});

test('assertClassSessionLedgerPreservesTimesheetLocks allows preserving locked sessions', async () => {
  await schoolDependencyService.assertClassSessionLedgerPreservesTimesheetLocks({
    classId: 'CLS_1',
    orgId: '900000',
    existingSessions: [
      { sessionId: 'SES_LOCK', locked: true, lockReason: 'timesheet_approved', date: '2026-07-01' }
    ],
    incomingSessions: [
      { sessionId: 'SES_LOCK', locked: true, lockReason: 'timesheet_approved', date: '2026-07-01' },
      { sessionId: 'SES_NEW', locked: false, date: '2026-07-03' }
    ],
    reqUser: { id: 'U1' }
  });
});

test('class edit save and form guard timesheet-locked session ledger changes', () => {
  const controllerSource = read('packages/school/MVC/controllers/school/classController.js');
  const formSource = read('packages/school/MVC/views/school/class/classForm.ejs');
  assert.match(controllerSource, /assertClassSessionLedgerPreservesTimesheetLocks/);
  assert.match(formSource, /function isTimesheetApprovedLock/);
  assert.match(formSource, /timesheet-locked session\(s\) will be kept/);
  assert.match(formSource, /Locked by an approved timesheet/);
});

test('meetsMinTimesheetStatus treats approved as guarded status', () => {
  assert.equal(schoolDependencyService.meetsMinTimesheetStatus('submitted', 'approved'), false);
  assert.equal(schoolDependencyService.meetsMinTimesheetStatus('approved', 'approved'), true);
  assert.equal(schoolDependencyService.meetsMinTimesheetStatus('processed', 'approved'), true);
});

test('timesheet list and manage views expose only three states and a manager-approved badge', () => {
  const listSource = read('packages/school/MVC/views/school/timesheet/timesheetList.ejs');
  const manageSource = read('packages/school/MVC/views/school/timesheet/timesheetManage.ejs');
  assert.doesNotMatch(listSource, /value="approved"/);
  assert.doesNotMatch(manageSource, /value="approved"/);
  assert.match(listSource, /MANAGER APPROVED/i);
  assert.match(manageSource, /MANAGER APPROVED/i);
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
