const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  sanitizeTimesheetPayload,
  sanitizeReviewHistoryEntry,
  REVIEW_HISTORY_EVENTS
} = require('../MVC/models/school/timesheetModel');

const ROOT = path.resolve(__dirname, '../../..');

function readPackage(relativePath) {
  return fs.readFileSync(path.join(ROOT, 'packages/school', relativePath), 'utf8');
}

test('sanitizeTimesheetPayload persists allowLateSubmission boolean', () => {
  const base = {
    orgId: 'ORG1',
    periodId: 'PER1',
    teacherId: 'TCH1',
    status: 'draft',
    entries: []
  };
  const on = sanitizeTimesheetPayload({ ...base, allowLateSubmission: true });
  assert.equal(on.allowLateSubmission, true);
  const off = sanitizeTimesheetPayload({ ...base, allowLateSubmission: false });
  assert.equal(off.allowLateSubmission, false);
  const omitted = sanitizeTimesheetPayload(base);
  assert.equal(Object.prototype.hasOwnProperty.call(omitted, 'allowLateSubmission'), false);
});

test('late_submission_allowed is a valid review history event', () => {
  assert.ok(REVIEW_HISTORY_EVENTS.includes('late_submission_allowed'));
  const row = sanitizeReviewHistoryEntry({
    event: 'late_submission_allowed',
    at: '2026-07-21T18:00:00.000Z',
    by: 'MGR1',
    byName: 'Manager',
    note: 'Late submission allowed by manager.',
    statusBefore: 'draft',
    statusAfter: 'draft'
  });
  assert.equal(row.event, 'late_submission_allowed');
});

test('controller enforces deadline gate, clears flag on submit, grants on return', () => {
  const controller = readPackage('MVC/controllers/school/timesheetController.js');

  assert.match(controller, /function isPeriodSubmissionDeadlinePassed\s*\(/);
  assert.match(
    controller,
    /isPeriodSubmissionDeadlinePassed\(period,\s*orgTimeZone\)[\s\S]*allowLateSubmission !== true/
  );
  assert.match(
    controller,
    /Ask a timesheet manager to allow late submission/
  );
  assert.match(controller, /payload\.allowLateSubmission = false/);
  assert.match(
    controller,
    /allowLateSubmission:\s*grantLateSubmission\s*\?\s*true/
  );
  assert.match(controller, /exports\.allowLateSubmission\s*=/);
  assert.match(controller, /canAllowLateSubmission/);
  assert.match(controller, /isSubmissionDeadlinePassed/);
});

test('allow-late-submission route and editor UI are wired', () => {
  const routes = readPackage('MVC/routes/timesheetRoutes.js');
  const view = readPackage('MVC/views/school/timesheet/timesheetEditor.ejs');

  assert.match(routes, /\/editor\/:periodId\/allow-late-submission/);
  assert.match(routes, /OPERATIONS\.UPDATE[\s\S]*ctrl\.allowLateSubmission/);
  assert.match(view, /btnAllowLateSubmission/);
  assert.match(view, /Allow Late Submission/);
  assert.match(view, /IS_SUBMISSION_DEADLINE_PASSED/);
  assert.match(view, /ALLOW_LATE_SUBMISSION/);
  assert.match(view, /executeAdminTimesheetAction\('allow-late-submission'/);
  assert.match(view, /Deadline Passed/);
});
