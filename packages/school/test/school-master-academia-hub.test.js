const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('master hub section panel uses seven columns per row', () => {
  const view = read('MVC/views/school/masterAcademiaHub.ejs');
  assert.match(view, /hub-section-panel-inner[\s\S]*grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(view, /@media \(max-width: 991\.98px\)[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
});

test('master hub exposes academic ledger workspace section', () => {
  const view = read('MVC/views/school/masterAcademiaHub.ejs');
  const routes = read('MVC/routes/schoolMasterAcademiaHubRoutes.js');
  const service = read('MVC/services/school/schoolMasterAcademiaHubService.js');

  assert.match(view, /data-hub-workspace-section="academic-ledger"/);
  assert.match(view, /Academic Ledger/);
  assert.match(view, /renderAcademicLedgerWorkspace/);
  assert.match(view, /openHubAcademicLedgerStudentPicker/);
  assert.match(view, /\/school\/academic-ledger\/student-overview\//);
  assert.match(view, /academicLedgerStudents/);
  assert.match(routes, /SCHOOL_ACADEMIC_LEDGER/);
  assert.match(service, /key === 'academic-ledger'/);
  assert.match(service, /SECTIONS\.SCHOOL_ACADEMIC_LEDGER/);
});

test('master hub people search only submits from Search or Enter', () => {
  const view = read('MVC/views/school/masterAcademiaHub.ejs');

  assert.match(view, /id="schoolMasterHubSearchButton"/);
  assert.match(view, /els\.search\.addEventListener\('keydown'/);
  assert.match(view, /event\.key !== 'Enter'/);
  assert.match(view, /els\.searchButton\.addEventListener\('click'/);
  assert.doesNotMatch(view, /els\.search\.addEventListener\('input'/);
  assert.doesNotMatch(view, /window\.setTimeout\(searchCurrent,\s*280\)/);
  assert.match(view, /opts\.append === true[\s\S]*state\.lastSearch/);
});

test('master hub people results expose role-aware current-month schedule actions and student overview', () => {
  const view = read('MVC/views/school/masterAcademiaHub.ejs');
  const service = read('MVC/services/school/schoolMasterAcademiaHubService.js');

  assert.match(service, /label: 'Student Overview Ledger'/);
  assert.match(service, /academic-ledger\/student-overview\/\$\{encodedStudentId\}/);
  assert.match(service, /command: 'person-current-month-schedule'/);
  assert.match(service, /personId: normalizeText\(row\?\.personId\)/);
  assert.match(service, /role: normalizeText\(moduleConfig\.singular\)\.toLowerCase\(\)/);
  assert.match(view, /function openPersonCurrentMonthSchedule\(personInput\)/);
  assert.match(view, /openWorkspaceSection\('schedule'\)/);
  assert.match(view, /hubScheduleState\.persons\.find/);
  assert.match(view, /person\.selectedRole = role/);
  assert.match(view, /setHubScheduleRange\('month'\)/);
  assert.match(view, /await loadHubSchedulePerson\(person\)/);
});
