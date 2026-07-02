const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('report assignments list view exposes teacher, multi-class, and report scope filters', () => {
  const viewSource = read('packages/school/MVC/views/school/report/assignmentList.ejs');

  assert.match(viewSource, /name="teacherPersonId"/);
  assert.match(viewSource, /id="teacherPersonIdFilterInput"/);
  assert.match(viewSource, /id="teacherNameFilterInput"/);
  assert.match(viewSource, /id="btnPickTeacherFilter"/);
  assert.match(viewSource, /id="btnClearTeacherFilter"/);

  assert.match(viewSource, /name="classIds"/);
  assert.match(viewSource, /id="classIdsFilterInput"/);
  assert.match(viewSource, /id="classFilterChips"/);
  assert.match(viewSource, /multiselect:\s*true/);

  assert.match(viewSource, /name="reportScope"/);
  assert.match(viewSource, /id="reportScopeFilterInput"/);
  assert.match(viewSource, /value="each_student"/);
  assert.match(viewSource, /value="selected_students"/);
});

test('report assignments list view picker script supports multi-class chips and teacher picker', () => {
  const viewSource = read('packages/school/MVC/views/school/report/assignmentList.ejs');

  assert.match(viewSource, /let selectedClassItems =/);
  assert.match(viewSource, /function renderClassChips\(\)/);
  assert.match(viewSource, /data-class-chip-remove=/);
  assert.match(viewSource, /GenericPickerPresets\.class/);
  assert.match(viewSource, /GenericPickerPresets\.teacher/);
  assert.match(viewSource, /teacherPersonIdFilterInput/);
  assert.match(viewSource, /classIdsFilterInput/);
});

test('report assignment list backend wiring parses and applies new filter inputs', () => {
  const controllerSource = read('packages/school/MVC/controllers/school/reportController.js');
  const serviceSource = read('packages/school/MVC/services/school/reportViewService.js');

  assert.match(controllerSource, /const classIds = parseIdList\(req\.query\.classIds\)/);
  assert.match(controllerSource, /teacherPersonId = String\(req\.query\.teacherPersonId \|\| ''\)/);
  assert.match(controllerSource, /reportScope = String\(req\.query\.reportScope \|\| ''\)/);
  assert.match(controllerSource, /buildAssignmentListContext\(\{[\s\S]*classIds,[\s\S]*teacherPersonId,[\s\S]*reportScope/);
  assert.match(controllerSource, /selectedTeacherId:/);
  assert.match(controllerSource, /selectedReportScope/);

  assert.match(serviceSource, /async function buildAssignmentListContext\(\{[\s\S]*classIds = \[\],[\s\S]*teacherPersonId = '',[\s\S]*reportScope = ''/);
  assert.match(serviceSource, /requestedTeacherPersonId/);
  assert.match(serviceSource, /requestedReportScope/);
  assert.match(serviceSource, /rowTeacherIds/);
  assert.match(serviceSource, /selectedClasses/);
  assert.match(serviceSource, /selectedTeacherName/);
  assert.match(serviceSource, /selectedReportScope/);
});
