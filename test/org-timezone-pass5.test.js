const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('AppOrgDateTime.formatDateKey is exported from orgDateTime.js', () => {
  const script = read('public/scripts/orgDateTime.js');
  assert.match(script, /function formatDateKey\(dateKey, options = \{\}\)/);
  assert.match(script, /formatDateKey,/);
});

test('holidays.ejs year picker uses controller yearOptions instead of bare getFullYear', () => {
  const view = read('packages/school/MVC/views/school/holiday/holidays.ejs');
  assert.match(view, /yearOptions/);
  assert.doesNotMatch(view, /new Date\(\)\.getFullYear\(\)/);
});

test('withdrawal dashboard uses formatOrgDateTime for request timestamps', () => {
  const view = read('packages/school/MVC/views/school/withdrawal/dashboard.ejs');
  assert.match(view, /formatOrgDateTime/);
});

test('school form helpers prefer AppOrgDateTime.today over UTC slice fallback', () => {
  const checks = [
    ['packages/school/MVC/views/school/program/programForm.ejs', 'getTodayIso'],
    ['packages/school/MVC/views/school/class/classForm.ejs', 'orgTodayFallback'],
    ['packages/school/MVC/views/school/class/rollingEnrollment.ejs', 'orgTodayFallback'],
    ['packages/school/MVC/views/school/partials/registrationStatusTransitionModal.ejs', 'orgTodayFallback']
  ];
  checks.forEach(([formPath, fnName]) => {
    const source = read(formPath);
    const anchor = source.indexOf(`function ${fnName}()`);
    assert.ok(anchor >= 0, `${fnName} not found in ${formPath}`);
    const snippet = source.slice(anchor, anchor + 240);
    assert.match(snippet, /AppOrgDateTime\.today/);
    assert.doesNotMatch(snippet, /toISOString\(\)\.slice\(0,\s*10\)/);
  });
});

test('consolidated school services import resolveOrgTodayFromContext', () => {
  const services = [
    'packages/school/MVC/services/school/registrationStatusLifecycleService.js',
    'packages/school/MVC/services/school/registrationIntegrityService.js',
    'packages/school/MVC/services/school/classEnrollmentPeriodService.js',
    'packages/school/MVC/services/school/studentEnrollmentDetailService.js',
    'packages/school/MVC/services/school/classEnrollmentReadService.js',
    'packages/school/MVC/services/school/termRegistrationViewService.js',
    'packages/school/MVC/services/school/withdrawal/withdrawalPolicyService.js'
  ];
  services.forEach((servicePath) => {
    const source = read(servicePath);
    assert.match(source, /resolveOrgTodayFromContext/);
  });
});

test('taskView uses formatOrgDateTime for comment timestamps', () => {
  const view = read('MVC/views/task/taskView.ejs');
  assert.match(view, /formatOrgDateTime\(c\.timestamp/);
});

test('schoolMasterAcademiaHubService resolveHolidayYear delegates to resolveOrgTodayFromContext', () => {
  const source = read('packages/school/MVC/services/school/schoolMasterAcademiaHubService.js');
  assert.match(source, /resolveOrgTodayFromContext\(\{ orgToday \}\)/);
  assert.doesNotMatch(source, /return String\(new Date\(\)\.getFullYear\(\)\)/);
});

test('timesheetController uses resolveOrgYearFromRequest for missing period year', () => {
  const source = read('packages/school/MVC/controllers/school/timesheetController.js');
  assert.match(source, /resolveOrgYearFromRequest\(req\)/);
});
