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

test('cell modal save captures roster note-only path before modal hide and blocks it when attendance chosen', () => {
  const saveBlock = viewSource.slice(viewSource.indexOf("btnSaveAttendance.addEventListener('click'"));
  const hideIdx = saveBlock.indexOf('detailsModalInstance.hide()');
  const rosterIdx = saveBlock.indexOf('rosterNoteOrExcuseOnly');
  assert.ok(rosterIdx > 0 && hideIdx > 0, 'expected modal save handler');
  assert.ok(rosterIdx < hideIdx, 'roster save mode must be decided before closing the modal');
  assert.match(saveBlock, /if \(attendance\) rosterNoteOrExcuseOnly = false/);
  assert.match(viewSource, /baselineUnmarked && noStatusSelected && !attendanceDirty/);
});

test('cell modal remembers attendance radio choice when save resolves status', () => {
  assert.match(viewSource, /matrixCellModalUserAttendanceChoice/);
  assert.match(viewSource, /const userChoice = String\(matrixCellModalUserAttendanceChoice/);
  assert.match(viewSource, /matrixCellModalUserAttendanceChoice = String\(el\.value/);
});

test('cell modal stacks excuse file input under excuse notes', () => {
  const editorBlock = viewSource.slice(
    viewSource.indexOf('id="wrap_cellExcuseNotesEditor"'),
    viewSource.indexOf('id="wrap_cellExcuseNotesReadonly"')
  );
  assert.doesNotMatch(editorBlock, /col-md-8/);
  assert.doesNotMatch(editorBlock, /col-md-4/);
  assert.match(editorBlock, /inp_cellExcuseRef[\s\S]*inp_cellExcuseFile/);
});