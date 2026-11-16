const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const viewSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/attendance/attendanceViewer.ejs'),
  'utf8'
);

test('attendance matrix detail modal includes per-student reset attendance control', () => {
  assert.match(viewSource, /id="btn_reset_cell_attendance"/);
  assert.match(viewSource, /Reset attendance/);
  assert.match(viewSource, /id="cellDetailsModal"/);
});

test('openInteractiveModal does not default unmarked cells to absent', () => {
  const block = viewSource.slice(viewSource.indexOf('window.openInteractiveModal = function'));
  assert.match(block, /let effStatus = known\.includes\(record\.status\) \? record\.status : ''/);
  assert.doesNotMatch(block, /record\.status : 'absent'/);
});

test('matrix reset shares resetMatrixAttendanceCell helper and reset payload builder', () => {
  assert.match(viewSource, /function buildMatrixAttendanceResetPayload/);
  assert.match(viewSource, /async function resetMatrixAttendanceCell/);
  assert.match(viewSource, /attendance: ''/);
});

test('cell modal save resolves attendance from baseline when radios are unchecked', () => {
  assert.match(viewSource, /function resolveCellModalSaveAttendance/);
  assert.match(viewSource, /resolveCellModalSaveAttendance\(\)/);
});