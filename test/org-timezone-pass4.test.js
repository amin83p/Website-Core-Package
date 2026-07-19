const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const timezoneUtils = require('../MVC/utils/timezoneUtils');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('core MVC display tail views use formatOrgDateTime for instants', () => {
  const views = [
    'MVC/views/user/users.ejs',
    'MVC/views/symbol/list.ejs',
    'MVC/views/files/fileList.ejs',
    'MVC/views/session/mySessions.ejs',
    'MVC/views/admin/chatList.ejs'
  ];
  views.forEach((viewPath) => {
    const source = read(viewPath);
    assert.match(source, /formatOrgDateTime/);
  });
});

test('registrationStatusLifecycleService accepts orgToday in todayISO', () => {
  const source = read('packages/school/MVC/services/school/registrationStatusLifecycleService.js');
  assert.match(source, /function todayISO\(orgToday = '', options = \{\}\)/);
  assert.match(source, /todayISO\(input\.orgToday, options\)/);
});

test('registration status controllers pass orgToday into lifecycle service', () => {
  const controllers = [
    'packages/school/MVC/controllers/school/termRegistrationController.js',
    'packages/school/MVC/controllers/school/programRegistrationController.js',
    'packages/school/MVC/controllers/school/classRollingEnrollmentController.js'
  ];
  controllers.forEach((controllerPath) => {
    const source = read(controllerPath);
    assert.match(source, /orgToday: resolveOrgTodayFromRequest\(req\)/);
  });
});

test('holidayController uses resolveOrgYearFromRequest for default year filter', () => {
  const source = read('packages/school/MVC/controllers/school/holidayController.js');
  assert.match(source, /resolveOrgYearFromRequest\(req\)/);
  assert.doesNotMatch(source, /new Date\(\)\.getFullYear\(\)/);
});

test('sessionController formats instants with formatInstantInTimezone', () => {
  const source = read('MVC/controllers/sessionController.js');
  assert.match(source, /formatInstantInTimezone/);
  assert.doesNotMatch(source, /formattedCreated:.*toLocaleString/);
});

test('appSettings exposes defaultTimezone picker', () => {
  const view = read('MVC/views/systemSettings/appSettings.ejs');
  assert.match(view, /defaultTimezoneSelect/);
  assert.match(view, /name="timeZone"/);
  const controller = read('MVC/controllers/systemSettingsController.js');
  assert.match(controller, /defaultTimezone: timezoneParse\.timeZone/);
});

test('resolveOrgTodayFromContext is exported and follows fallback policy', () => {
  assert.equal(typeof timezoneUtils.resolveOrgTodayFromContext, 'function');
  assert.equal(
    timezoneUtils.resolveOrgTodayFromContext({ orgToday: '2026-03-15' }),
    '2026-03-15'
  );
  assert.equal(
    timezoneUtils.resolveOrgTodayFromContext({ user: { orgToday: '2026-04-01' } }),
    '2026-04-01'
  );
  const fromTz = timezoneUtils.resolveOrgTodayFromContext({
    orgTimeZone: 'America/Edmonton',
    user: {}
  });
  assert.match(fromTz, /^\d{4}-\d{2}-\d{2}$/);
});

test('classEnrollmentPeriodService close/reopen fallbacks use options.orgToday', () => {
  const source = read('packages/school/MVC/services/school/classEnrollmentPeriodService.js');
  assert.match(source, /todayISO\(options\.orgToday\)/);
});
