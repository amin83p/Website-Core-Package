const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const attendanceMatrixMetricsService = require('../MVC/services/school/attendanceMatrixMetricsService');

const sessionManagerSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/class/sessionManager.ejs'),
  'utf8'
);
const classControllerSource = fs.readFileSync(
  path.join(__dirname, '../MVC/controllers/school/classController.js'),
  'utf8'
);

test('listRosterRowsWithUnmarkedAttendance returns only rows with empty attendance', () => {
  const roster = [
    { personId: 'p1', attendance: 'present', name: 'Alice' },
    { personId: 'p2', attendance: '', name: 'Bob' },
    { personId: 'p3', attendance: 'not_applicable', name: 'Carol' },
    { personId: '', attendance: '' }
  ];
  const unmarked = attendanceMatrixMetricsService.listRosterRowsWithUnmarkedAttendance(roster);
  assert.equal(unmarked.length, 1);
  assert.equal(unmarked[0].personId, 'p2');
  assert.equal(unmarked[0].name, 'Bob');
});

test('listRosterRowsWithUnmarkedAttendance omits name when not provided', () => {
  const unmarked = attendanceMatrixMetricsService.listRosterRowsWithUnmarkedAttendance([
    { personId: 'p9', attendance: null }
  ]);
  assert.deepEqual(unmarked, [{ personId: 'p9' }]);
});

test('sessionManager gates completion save on unmarked attendance without blocking status picker', () => {
  assert.match(sessionManagerSource, /function getUnmarkedRosterAttendanceRows\(/);
  assert.match(sessionManagerSource, /showUnmarkedAttendanceBlockModal/);
  assert.match(sessionManagerSource, /UNMARKED_ATTENDANCE_BLOCK_COMPLETION/);
  assert.match(sessionManagerSource, /syncPendingAttendanceHint/);
  assert.match(sessionManagerSource, /reason: 'unmarked-attendance'/);
  assert.match(sessionManagerSource, /getUnmarkedRosterAttendanceRows\(\)/);
  assert.doesNotMatch(
    sessionManagerSource,
    /wouldBlockCompletionStatus[\s\S]{0,120}getUnmarkedRosterAttendanceRows/
  );
});

test('saveSession enforces UNMARKED_ATTENDANCE_BLOCK_COMPLETION after roster merge', () => {
  assert.match(classControllerSource, /UNMARKED_ATTENDANCE_BLOCK_COMPLETION/);
  assert.match(classControllerSource, /listRosterRowsWithUnmarkedAttendance/);
  assert.match(classControllerSource, /rosterForCompletionAttendanceCheck/);
});
