const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  validateUnprocessEligibility,
  buildPreservedManagerReview,
  buildUnprocessTimesheetUpdate
} = require('../MVC/services/school/timesheetUnprocessService');

const ROOT = path.resolve(__dirname, '../../..');

function readPackage(relativePath) {
  return fs.readFileSync(path.join(ROOT, 'packages/school', relativePath), 'utf8');
}

test('validateUnprocessEligibility rejects processed periods', () => {
  const result = validateUnprocessEligibility({
    period: { status: 'processed' },
    timesheet: { status: 'processed' },
    note: 'Need correction'
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /period has been processed/i);
});

test('validateUnprocessEligibility rejects non-processed timesheets', () => {
  const result = validateUnprocessEligibility({
    period: { status: 'open' },
    timesheet: { status: 'submitted' },
    note: 'Need correction'
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /only processed timesheets/i);
});

test('validateUnprocessEligibility requires a reopen note', () => {
  const result = validateUnprocessEligibility({
    period: { status: 'open' },
    timesheet: { status: 'processed' },
    note: '   '
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /reopen note is required/i);
});

test('validateUnprocessEligibility accepts processed timesheet with note', () => {
  const result = validateUnprocessEligibility({
    period: { status: 'open' },
    timesheet: { status: 'processed' },
    note: 'Payroll correction needed'
  });
  assert.equal(result.ok, true);
});

test('buildUnprocessTimesheetUpdate restores submitted + manager approved and clears process locks', () => {
  const existing = {
    id: 'TS_1',
    status: 'processed',
    reviewVersion: 3,
    managerReview: {
      status: 'approved',
      reviewVersion: 3,
      reviewedAt: '2026-07-01T10:00:00.000Z',
      reviewedBy: 'MGR_1',
      reviewedByName: 'Manager One',
      note: 'Looks good'
    },
    processedAt: '2026-07-02T12:00:00.000Z',
    processedBy: 'FIN_1',
    processedByName: 'Finance One',
    lockedSourceRefs: [{ type: 'class_session', sessionId: 'SES-001' }],
    materializationSummary: { created: 1 },
    entries: []
  };
  const restoredEntries = [
    {
      sessionId: 'MAN_1',
      isManual: true,
      activityPaid: true,
      approvalStatus: 'approved',
      requestedHours: 2,
      hours: 2
    }
  ];
  const snapshot = { submittedAt: '2026-07-01T09:00:00.000Z', entries: restoredEntries };
  const update = buildUnprocessTimesheetUpdate({
    existing,
    restoredEntries,
    submissionSnapshot: snapshot,
    now: '2026-07-21T18:00:00.000Z',
    actorId: 'FIN_2',
    actorName: 'Finance Two',
    totalHours: 2
  });

  assert.equal(update.status, 'submitted');
  assert.equal(update.managerReview.status, 'approved');
  assert.equal(update.managerReview.reviewVersion, 3);
  assert.equal(update.managerReview.reviewedBy, 'MGR_1');
  assert.equal(update.processedAt, '');
  assert.equal(update.processedBy, '');
  assert.equal(update.processedByName, '');
  assert.deepEqual(update.lockedSourceRefs, []);
  assert.equal(update.materializationSummary, null);
  assert.equal(update.entries[0].approvalStatus, 'approved');
  assert.equal(update.submissionSnapshot, snapshot);
});

test('buildPreservedManagerReview keeps matching reviewVersion for isManagerApproved compatibility', () => {
  const review = buildPreservedManagerReview({
    reviewVersion: 4,
    managerReview: { status: 'approved', reviewVersion: 4, reviewedBy: 'MGR_2' },
    processedAt: '2026-07-02T12:00:00.000Z'
  }, { now: '2026-07-21T18:00:00.000Z', actorId: 'X', actorName: 'Y' });
  assert.equal(review.status, 'approved');
  assert.equal(review.reviewVersion, 4);
  assert.equal(review.reviewedBy, 'MGR_2');
});

test('unprocess route is CONFIGURE-gated and controller/UI are wired', () => {
  const routes = readPackage('MVC/routes/timesheetRoutes.js');
  const controller = readPackage('MVC/controllers/school/timesheetController.js');
  const view = readPackage('MVC/views/school/timesheet/timesheetEditor.ejs');

  assert.match(routes, /\/editor\/:periodId\/unprocess/);
  assert.match(routes, /OPERATIONS\.CONFIGURE[\s\S]*ctrl\.unprocessTimesheet/);
  assert.match(controller, /exports\.unprocessTimesheet\s*=/);
  assert.match(controller, /canUnprocessProcessed/);
  assert.match(controller, /timesheetUnprocessService/);
  assert.match(controller, /revertMaterializedRecordsForTimesheet/);
  assert.match(controller, /unlockSourcesForTimesheet/);
  assert.doesNotMatch(
    controller.slice(controller.indexOf('exports.unprocessTimesheet'), controller.indexOf('exports.returnTimesheet')),
    /approvalStatus:\s*'pending_approval'/
  );
  assert.match(view, /canUnprocessProcessed/);
  assert.match(view, /btnUnprocessTimesheet/);
  assert.match(view, /Reopen to Manager Approved/);
  assert.match(view, /executeAdminTimesheetAction\('unprocess'/);
});
