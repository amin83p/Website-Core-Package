const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const timesheetModel = require('../packages/school/MVC/models/school/timesheetModel');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('timesheet model sanitizes reviewHistory and requires revision notes', () => {
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
        event: 'returned',
        at: '2026-07-02T09:00:00.000Z',
        by: 'ADMIN_1',
        byName: 'Admin',
        note: 'Please fix Monday hours.',
        statusBefore: 'submitted',
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
      event: 'returned',
      at: '2026-07-02T09:00:00.000Z',
      by: 'ADMIN_1'
    });
  }, /note/i);
});

test('timesheet controller return sets draft status and requires note', () => {
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');
  assert.match(controller, /status: 'draft'/);
  assert.match(controller, /returnNote/);
  assert.match(controller, /A revision note is required/);
  assert.match(controller, /appendReviewHistory/);
  assert.match(controller, /event: 'returned'/);
  assert.match(controller, /event: reviewerEdit \? 'reviewer_edited' : 'submitted'/);
  assert.match(controller, /event: 'manager_approved'/);
  assert.match(controller, /event: 'processed'/);
  assert.match(controller, /exports\.reopenTimesheet = exports\.returnTimesheet/);
});

test('timesheet editor exposes review history panel and revision-note modal', () => {
  const editor = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  assert.match(editor, /Review History/);
  assert.match(editor, /reopenTimesheetModal/);
  assert.match(editor, /reopenTimesheetNote/);
  assert.match(editor, /btnConfirmReopenTimesheet/);
  assert.match(editor, /Send Back for Revision/);
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

test('submission snapshots refresh while reviewer edits preserve original submission time', () => {
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');
  assert.match(controller, /submittedAt: submittedAt \|\| new Date\(\)\.toISOString\(\)/);
  assert.match(controller, /submittedAt: reviewerEdit \? String\(existing\?\.submissionSnapshot\?\.submittedAt/);
  assert.match(controller, /lastModifiedAt: new Date\(\)\.toISOString\(\)/);
});
