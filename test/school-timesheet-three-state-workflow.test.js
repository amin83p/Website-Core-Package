const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const timesheetModel = require('../packages/school/MVC/models/school/timesheetModel');
const materializationService = require('../packages/school/MVC/services/school/timesheetManualMaterializationService');
const { buildTimesheetLifecycleBackfillPatch } = require('../scripts/school/migration/backfillTimesheetThreeStateLifecycle');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('timesheets store exactly Draft, Submitted, and Processed states', () => {
  assert.deepEqual(timesheetModel.TIMESHEET_STATUSES, ['draft', 'submitted', 'processed']);
  assert.throws(() => timesheetModel.sanitizeTimesheetPayload({
    orgId: 'ORG_1',
    periodId: 'PERIOD_1',
    teacherId: 'PERSON_1',
    status: 'reviewed',
    entries: []
  }), /Invalid timesheet status/);
});

test('pending, rejected, and unpaid manual rows stay visible but contribute zero payable hours', () => {
  const submittedAt = '2026-07-15T12:00:00.000Z';
  const rows = [
    { sessionId: 'AUTO_1', date: '2026-07-15', hours: 1, status: 'completed' },
    { sessionId: 'MAN_PENDING', date: '2026-07-15', hours: 2, requestedHours: 2, durationHours: 2, isManual: true, activityId: 'ACT_1', activityPaid: true, approvalStatus: 'pending_approval' },
    { sessionId: 'MAN_APPROVED', date: '2026-07-15', hours: 3, requestedHours: 3, durationHours: 3, isManual: true, activityId: 'ACT_1', activityPaid: true, approvalStatus: 'approved' },
    { sessionId: 'MAN_REJECTED', date: '2026-07-15', hours: 4, requestedHours: 4, durationHours: 4, isManual: true, activityId: 'ACT_1', activityPaid: true, approvalStatus: 'rejected', decisionNote: 'Not eligible.' },
    { sessionId: 'MAN_UNPAID', date: '2026-07-15', hours: 5, requestedHours: 5, durationHours: 5, isManual: true, activityId: 'ACT_2', activityPaid: false, approvalStatus: 'unpaid' }
  ];
  const payload = timesheetModel.sanitizeTimesheetPayload({
    orgId: 'ORG_1',
    periodId: 'PERIOD_1',
    teacherId: 'PERSON_1',
    status: 'submitted',
    reviewVersion: 2,
    entries: rows,
    submissionSnapshot: {
      submittedAt,
      reviewVersion: 2,
      sourcePeriodId: 'PERIOD_1',
      sourcePeriodName: 'July',
      entries: rows
    }
  });

  assert.equal(payload.totalHours, 4);
  assert.equal(payload.entries.length, 5);
  assert.equal(payload.submissionSnapshot.entries.length, 5);
  assert.equal(payload.entries.find((row) => row.sessionId === 'MAN_PENDING').hours, 0);
  assert.equal(payload.entries.find((row) => row.sessionId === 'MAN_REJECTED').hours, 0);
  assert.equal(payload.entries.find((row) => row.sessionId === 'MAN_UNPAID').hours, 0);
});

test('only approved manual rows are eligible for processing materialization', () => {
  const base = { sessionId: 'MAN_1', date: '2026-07-15', classId: 'CLASS_1', isManual: true };
  assert.equal(materializationService.isManualMaterializationCandidate({ ...base, approvalStatus: 'approved' }), true);
  assert.equal(materializationService.isManualMaterializationCandidate({ ...base, approvalStatus: 'pending_approval' }), false);
  assert.equal(materializationService.isManualMaterializationCandidate({ ...base, approvalStatus: 'rejected' }), false);
  assert.equal(materializationService.isManualMaterializationCandidate({ ...base, approvalStatus: 'unpaid' }), false);
});

test('legacy Approved backfill is idempotent and derives manager-review metadata', () => {
  const legacy = {
    id: 'TS_1',
    status: 'approved',
    approvedAt: '2026-07-16T09:30:00.000Z',
    approvedBy: 'MANAGER_1',
    submissionSnapshot: {
      submittedAt: '2026-07-15T18:00:00.000Z',
      sourcePeriodId: 'PERIOD_1',
      entries: []
    },
    lockedSourceRefs: [{ type: 'classSession', classId: 'CLASS_1', sessionId: 'SESSION_1' }],
    materializationSummary: { classSessions: 1 }
  };
  const patch = buildTimesheetLifecycleBackfillPatch(legacy);
  assert.equal(patch.status, 'submitted');
  assert.equal(patch.managerReview.status, 'approved');
  assert.equal(patch.managerReview.reviewedAt, legacy.approvedAt);
  assert.equal(patch.managerReview.reviewedBy, legacy.approvedBy);
  const migrated = { ...legacy, ...patch };
  assert.equal(buildTimesheetLifecycleBackfillPatch(migrated), null);
  assert.deepEqual(migrated.lockedSourceRefs, legacy.lockedSourceRefs);
  assert.deepEqual(migrated.materializationSummary, legacy.materializationSummary);
});

test('routes separate manager UPDATE actions from finance CONFIGURE processing', () => {
  const routes = read('packages/school/MVC/routes/timesheetRoutes.js');
  assert.match(routes, /manual-entries\/:entryId\/decision[\s\S]*SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS\.UPDATE/);
  assert.match(routes, /editor\/:periodId\/return[\s\S]*SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS\.UPDATE/);
  assert.match(routes, /editor\/:periodId\/process[\s\S]*SCHOOL_TIMESHEET_MANAGEMENT, OPERATIONS\.CONFIGURE/);
  assert.match(routes, /editor\/:periodId\/reopen[\s\S]*ctrl\.returnTimesheet/);
  assert.match(routes, /requireAccessAny\(\[SECTIONS\.SCHOOL_TIMESHEETS, SECTIONS\.SCHOOL_TIMESHEET_MANAGEMENT\], OPERATIONS\.UPDATE\)/);
});

test('submission ignores pending manual approvals but still blocks incomplete automatic sessions', () => {
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');
  const editor = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  assert.match(controller, /Some auto sessions are not in a final status\. Update session statuses before submission/);
  assert.match(controller, /paid manual row\(s\) still require approval or rejection before manager approval/);
  assert.match(editor, /if \(hasUncompletedSessions\) return;/);
  assert.doesNotMatch(editor, /if \(hasPendingApprovals\) return;/);
  assert.match(editor, /if \(ls\.isManual === true\) return;/);
});

test('review edits invalidate manager approval and Processed timesheets are immutable', () => {
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');
  assert.match(controller, /event: reviewerEdit \? 'reviewer_edited' : 'submitted'/);
  assert.match(controller, /managerReview: nextStatus === 'submitted'[\s\S]*resetManagerReview\(nextReviewVersion\)/);
  assert.match(controller, /status: 'processed'/);
  assert.match(controller, /Processed timesheets are permanently locked and cannot be returned/);
  assert.match(controller, /This timesheet has been processed and is permanently locked/);
});
