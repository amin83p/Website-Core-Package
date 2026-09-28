const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const viewSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/class/sessionManager.ejs'),
  'utf8'
);

test('Manage Session details modal includes per-student reset attendance control', () => {
  assert.match(viewSource, /id="btnResetStudentAttendance"/);
  assert.match(viewSource, /Reset attendance/);
  assert.match(viewSource, /attendanceDetailsModal/);
});

test('Manage Session shares single-row reset helper with bulk reset', () => {
  assert.match(viewSource, /function resetAttendanceForRosterRow/);
  const bulkBlock = viewSource.slice(
    viewSource.indexOf('function resetBulkAttendance'),
    viewSource.indexOf('/* --- Session content stream')
  );
  assert.match(bulkBlock, /resetAttendanceForRosterRow\(row\)/);
});

test('per-student reset marks roster dirty after confirm', () => {
  const handlerBlock = viewSource.slice(
    viewSource.indexOf("document.getElementById('btnResetStudentAttendance')"),
    viewSource.indexOf('function applyBulkAttendance')
  );
  assert.match(handlerBlock, /sessionConfirmBox/);
  assert.match(handlerBlock, /resetAttendanceForRosterRow\(row\)/);
  assert.match(handlerBlock, /markSessionAutosaveRosterDirty/);
});

test('openDetailsModal toggles per-student reset button with attendance locks', () => {
  const openBlock = viewSource.slice(
    viewSource.indexOf('function openDetailsModal'),
    viewSource.length
  );
  assert.match(openBlock, /btnResetStudentAttendance/);
  assert.match(openBlock, /resetStudentAttendanceBtn\.disabled = timingDisabled/);
});
