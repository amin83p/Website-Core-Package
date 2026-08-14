const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('school entity picker partial owns the modal and package script reference', () => {
  const partial = read('packages/school/MVC/views/school/partials/modal_SchoolEntityPicker.ejs');
  assert.match(partial, /id="schoolEntityPickerModal"/);
  assert.match(partial, /schoolEntityPicker\.js/);
  assert.doesNotMatch(partial, /include\(\s*['"]\.\.\//);
});

test('school entity picker script exposes the expected API and controls', () => {
  const script = read('packages/school/public/scripts/schoolEntityPicker.js');
  assert.match(script, /global\.SchoolEntityPicker/);
  assert.match(script, /open/);
  assert.match(script, /selectAllInClass/);
  assert.match(script, /clearSelectedClass/);
  assert.match(script, /clickedCheckbox/);
  assert.match(script, /!wasChecked/);
  assert.match(script, /\/school\/entity-picker\/api\/options/);
});

test('school main route mounts the entity picker route before regular entity routes', () => {
  const mainRoute = read('packages/school/MVC/routes/schoolMainRoute.js');
  assert.match(mainRoute, /router\.use\('\/entity-picker',\s*require\('\.\/schoolEntityPickerRoutes'\)\)/);
  assert.ok(
    mainRoute.indexOf("router.use('/entity-picker'") < mainRoute.indexOf("router.use('/students'"),
    'entity picker route must be mounted before /students and other entity routes'
  );
});

test('student attendance report keeps search picker and adds class browse picker', () => {
  const view = read('packages/school/MVC/views/school/attendance/studentAttendanceReportViewer.ejs');

  assert.match(view, /id="btn_openStudentPicker"/);
  assert.match(view, /id="btn_openSchoolStudentPicker"/);
  assert.match(view, /include\('partials\/modal_GenericPicker'\)/);
  assert.match(view, /include\('school\/partials\/modal_SchoolEntityPicker'\)/);
  assert.match(view, /function openStudentPicker\(\)/);
  assert.match(view, /function openHierarchicalStudentPicker\(\)/);
  assert.match(view, /SchoolEntityPicker\.open/);
  assert.match(view, /normalizeSelectedStudentItems/);
});
