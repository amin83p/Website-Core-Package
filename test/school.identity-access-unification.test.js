const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('school identity routes include cross-section read gates', () => {
  const routeSource = read('packages/school/MVC/routes/schoolIdentityRoutes.js');
  assert.match(routeSource, /SECTIONS\.SCHOOL_REPORTS/);
  assert.match(routeSource, /SECTIONS\.SCHOOL_EXAMS/);
  assert.match(routeSource, /SECTIONS\.SCHOOL_PROGRAMS/);
  assert.match(routeSource, /SECTIONS\.SCHOOL_WITHDRAWAL/);
  assert.match(routeSource, /requireAccessAny\(SCHOOL_IDENTITY_READ_SECTIONS,\s*OPERATIONS\.READ_ALL\)/);
});

test('school identity controller supports role-filtered person lookup', () => {
  const controllerSource = read('packages/school/MVC/controllers/school/schoolIdentityController.js');
  assert.match(controllerSource, /function parseAllowedSchoolRoles/);
  assert.match(controllerSource, /allowedSchoolRoles:\s*parseAllowedSchoolRoles\(req\.query \|\| {}\)/);
  assert.match(controllerSource, /items:\s*rows/);
});

test('generic picker presets guard school pages from global persons endpoint', () => {
  const presetSource = read('public/scripts/genericPickerPresets.js');
  assert.match(presetSource, /function applySchoolIdentityGuardrails/);
  assert.match(presetSource, /if \(normalizedName === 'person' && !hasExplicitEndpointOverride\)/);
  assert.match(presetSource, /next\.apiEndpoint = '\/school\/identity\/api\/persons'/);
  assert.match(presetSource, /if \(normalizedEndpoint === '\/persons'\)/);
});

test('school core contracts bridge dataService persons calls', () => {
  const contractsSource = read('packages/school/MVC/services/school/schoolCoreContracts.js');
  assert.match(contractsSource, /function shouldBridgeSchoolPersons/);
  assert.match(contractsSource, /if \(normalizeEntityType\(entityType\) !== 'persons'\)/);
  assert.match(contractsSource, /schoolIdentityLookupService\.listSchoolPersonRecords/);
  assert.match(contractsSource, /if \(normalized === 'MVC\/services\/dataService'\)/);
});

test('cross-section school views use school identity endpoint for role pickers', () => {
  const scheduleMySource = read('packages/school/MVC/views/school/schedule/mySchedule.ejs');
  const scheduleGlobalSource = read('packages/school/MVC/views/school/schedule/globalSchedule.ejs');
  const reportPersonSource = read('packages/school/MVC/views/school/report/personReportList.ejs');
  const leaveFormSource = read('packages/school/MVC/views/school/leaveRequest/form.ejs');

  assert.match(scheduleMySource, /const identityEndpointForRole = \(role\)/);
  assert.match(scheduleMySource, /identityEndpointForRole\('teacher'\)/);
  assert.match(scheduleMySource, /identityEndpointForRole\('student'\)/);
  assert.match(scheduleMySource, /identityEndpointForRole\('staff'\)/);

  assert.match(scheduleGlobalSource, /\/school\/identity\/api\/persons\?allowedSchoolRoles=teacher/);
  assert.match(reportPersonSource, /\/school\/identity\/api\/persons\?allowedSchoolRoles=teacher/);
  assert.match(reportPersonSource, /\/school\/identity\/api\/persons\?allowedSchoolRoles=staff/);
  assert.match(reportPersonSource, /\/school\/identity\/api\/persons\?allowedSchoolRoles=student/);

  assert.match(leaveFormSource, /\/school\/identity\/api\/persons\?allowedSchoolRoles=teacher/);
  assert.match(leaveFormSource, /\/school\/identity\/api\/persons\?allowedSchoolRoles=staff/);
});

test('eligible person endpoints expose normalized picker response payload', () => {
  const taskController = read('packages/school/MVC/controllers/school/taskController.js');
  const timesheetController = read('packages/school/MVC/controllers/school/timesheetController.js');
  const payRateController = read('packages/school/MVC/controllers/school/payRateController.js');
  const activityController = read('packages/school/MVC/controllers/school/activityController.js');
  const scheduleController = read('packages/school/MVC/controllers/school/scheduleController.js');

  assert.match(taskController, /return res\.json\(\{\s*status:\s*'success',\s*data,/s);
  assert.match(taskController, /results:\s*data/);
  assert.match(taskController, /items:\s*data/);

  assert.match(timesheetController, /status:\s*'success',\s*data,\s*results:\s*data,\s*items:\s*data,\s*pagination/s);
  assert.match(payRateController, /data:\s*filtered/);
  assert.match(activityController, /data:\s*results/);
  assert.match(scheduleController, /results:\s*items/);
  assert.match(scheduleController, /pagination/);
});

test('school role directory pickers use package person access helper', () => {
  const studentController = read('packages/school/MVC/controllers/school/studentController.js');
  const teacherController = read('packages/school/MVC/controllers/school/teacherController.js');
  const staffController = read('packages/school/MVC/controllers/school/staffController.js');

  for (const source of [studentController, teacherController, staffController]) {
    assert.match(source, /schoolPersonAccessService\.listPickerPersons/);
    assert.match(source, /schoolPersonAccessService\.ensurePersonHasSchoolRole/);
    assert.match(source, /schoolPersonAccessService\.removePersonSchoolRole/);
    assert.doesNotMatch(source, /dataServiceGlobal\.fetchData\('persons'/);
    assert.doesNotMatch(source, /dataServiceGlobal\.updateData\('persons'/);
  }
});

test('school package read-only person enrichments use package helper', () => {
  const checkedSources = [
    read('packages/school/MVC/controllers/school/programController.js'),
    read('packages/school/MVC/controllers/school/classRollingEnrollmentController.js'),
    read('packages/school/MVC/controllers/school/academicLedgerController.js'),
    read('packages/school/MVC/controllers/school/gradesMatrixController.js'),
    read('packages/school/MVC/controllers/school/reportController.js'),
    read('packages/school/MVC/controllers/school/studentProgramPriorSubjectController.js'),
    read('packages/school/MVC/services/school/programRegistrationViewService.js'),
    read('packages/school/MVC/services/school/termRegistrationViewService.js'),
    read('packages/school/MVC/services/school/schoolMasterAcademiaHubService.js'),
    read('packages/school/MVC/services/school/sessionExplorerService.js'),
    read('packages/school/MVC/services/school/schoolAccountDomainService.js')
  ];

  for (const source of checkedSources) {
    assert.match(source, /schoolPersonAccessService/);
    assert.doesNotMatch(source, /fetchData\('persons'/);
    assert.doesNotMatch(source, /getDataById\('persons'/);
  }
});

test('school views do not point pickers at the global persons endpoint', () => {
  const viewPaths = [
    'packages/school/MVC/views/school/staff/staffForm.ejs',
    'packages/school/MVC/views/school/teacher/teacherForm.ejs',
    'packages/school/MVC/views/school/student/studentForm.ejs',
    'packages/school/MVC/views/school/schedule/mySchedule.ejs',
    'packages/school/MVC/views/school/schedule/globalSchedule.ejs',
    'packages/school/MVC/views/school/report/personReportList.ejs',
    'packages/school/MVC/views/school/timesheet/timesheetList.ejs',
    'packages/school/MVC/views/school/payRate/payRateForm.ejs'
  ];

  for (const viewPath of viewPaths) {
    const source = read(viewPath);
    assert.doesNotMatch(source, /apiEndpoint:\s*['"]\/persons['"]/);
    assert.doesNotMatch(source, /url:\s*['"]\/persons['"]/);
  }
});
