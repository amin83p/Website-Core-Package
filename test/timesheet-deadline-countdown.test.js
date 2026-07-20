const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const {
  zonedWallClockToUtcMs,
  zonedWallClockToIso,
  getDateTimePartsInTimezone
} = require('../MVC/utils/timezoneUtils');

test('zonedWallClockToUtcMs resolves a known America/Toronto wall clock', () => {
  // 2024-01-15 23:59 EST = UTC-5 => 2024-01-16T04:59:00.000Z
  const ms = zonedWallClockToUtcMs('2024-01-15', '23:59', 'America/Toronto');
  assert.ok(Number.isFinite(ms));
  assert.equal(new Date(ms).toISOString(), '2024-01-16T04:59:00.000Z');

  const parts = getDateTimePartsInTimezone(ms, 'America/Toronto');
  assert.equal(parts.year, '2024');
  assert.equal(parts.month, '01');
  assert.equal(parts.day, '15');
  assert.equal(Number(parts.hour) === 24 ? 0 : Number(parts.hour), 23);
  assert.equal(parts.minute, '59');
});

test('zonedWallClockToIso returns empty for invalid date keys', () => {
  assert.equal(zonedWallClockToIso('', '23:59', 'UTC'), '');
  assert.equal(zonedWallClockToIso('not-a-date', '23:59', 'UTC'), '');
});

test('timesheetController passes submissionDeadlineAt into the editor view', () => {
  const source = read('packages/school/MVC/controllers/school/timesheetController.js');
  assert.match(source, /zonedWallClockToIso/);
  assert.match(source, /resolvePeriodSubmissionDeadlineAt/);
  assert.match(source, /submissionDeadlineAt,/);
});

test('timesheetEditor includes deadline status chip markup and countdown script', () => {
  const view = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  assert.match(view, /id="tsDeadlineStatusChip"/);
  assert.match(view, /data-deadline-at=/);
  assert.match(view, /data-manager-approved=/);
  assert.match(view, /ts-deadline-chip/);
  assert.match(view, /is-stamp/);
  assert.match(view, /DEADLINE PASSED/);
  assert.match(view, /initTimesheetDeadlineStatusChip/);
  assert.match(view, /pad2\(days\)/);
  assert.match(view, /pad2\(hours\)/);
  assert.match(view, /pad2\(minutes\)/);
  assert.match(view, /pad2\(seconds\)/);
});
