const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const timesheetModel = require('../packages/school/MVC/models/school/timesheetModel');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('timesheet model sanitizes reviewHistory and requires reopen notes', () => {
  const payload = timesheetModel.sanitizeTimesheetPayload({
    orgId: '900000',
    periodId: 'TSP_1',
    teacherId: 'P_1',
    status: 'draft',
    entries: [],
    reviewHistory: [
      {
        event: 'submitted',
        at: '2026-07-01T12:00:00.000Z',
        by: 'P_1',
        byName: 'Teacher One',
        statusBefore: 'draft',
        statusAfter: 'submitted',
        submissionSnapshotAt: '2026-07-01T12:00:00.000Z',
        totalHours: 10,
        entryCount: 3,
        submissionSnapshot: {
          submittedAt: '2026-07-01T12:00:00.000Z',
          sourcePeriodId: 'TSP_1',
          sourcePeriodName: 'July',
          entries: [{ sessionId: 'SES-001', date: '2026-07-01', hours: 2 }]
        }
      },
      {
        event: 'reopened',
        at: '2026-07-02T09:00:00.000Z',
        by: 'ADMIN_1',
        byName: 'Admin',
        note: 'Please fix Monday hours.',
        statusBefore: 'approved',
        statusAfter: 'draft',
        totalHours: 10,
        entryCount: 3
      }
    ]
  });

  assert.equal(payload.reviewHistory.length, 2);
  assert.equal(payload.reviewHistory[1].note, 'Please fix Monday hours.');
  assert.equal(payload.reviewHistory[0].submissionSnapshot.entries[0].sessionId, 'SES-001');

  assert.throws(() => {
    timesheetModel.sanitizeReviewHistoryEntry({
      event: 'reopened',
      at: '2026-07-02T09:00:00.000Z',
      by: 'ADMIN_1'
    });
  }, /note/i);
});

test('timesheet controller reopen sets draft status and requires note', () => {
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');
  assert.match(controller, /status: 'draft'/);
  assert.match(controller, /reopenNote/);
  assert.match(controller, /A reopen note is required/);
  assert.match(controller, /appendReviewHistory/);
  assert.match(controller, /event: 'reopened'/);
  assert.match(controller, /event: 'submitted'/);
  assert.match(controller, /event: 'approved'/);
  assert.doesNotMatch(controller, /status: 'submitted',\s*\n\s*reopenedAt/);
});

test('timesheet editor exposes review history panel and reopen note modal', () => {
  const editor = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  assert.match(editor, /Review History/);
  assert.match(editor, /reopenTimesheetModal/);
  assert.match(editor, /reopenTimesheetNote/);
  assert.match(editor, /btnConfirmReopenTimesheet/);
  assert.match(editor, /admin reopens it for revision/);
  assert.match(editor, /requestBody: \{ note \}/);
});

test('timesheet manage roster exposes revision count metadata', () => {
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');
  const manage = read('packages/school/MVC/views/school/timesheet/timesheetManage.ejs');
  assert.match(controller, /revisionCount: countReviewReopenCycles/);
  assert.match(controller, /lastReopenNote: getLastReopenNote/);
  assert.match(manage, /revisionCount/);
  assert.match(manage, /lastReopenNote/);
});

test('buildSubmissionSnapshot always creates a fresh submittedAt on resubmit', () => {
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');
  assert.doesNotMatch(controller, /existingTimesheet\?\.submissionSnapshot\?\.submittedAt/);
  assert.match(controller, /submittedAt: new Date\(\)\.toISOString\(\)/);
});
