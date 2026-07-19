const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const timezoneUtils = require('../MVC/utils/timezoneUtils');
const orgTimezoneLocalsMiddleware = require('../MVC/middleware/orgTimezoneLocalsMiddleware');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('resolveOrganizationTimezoneFromRow reads settings.timeZone', () => {
  assert.equal(
    timezoneUtils.resolveOrganizationTimezoneFromRow({ settings: { timeZone: 'Asia/Tehran' } }),
    'Asia/Tehran'
  );
  assert.equal(
    timezoneUtils.resolveOrganizationTimezoneFromRow({ timeZone: 'America/Edmonton' }),
    'America/Edmonton'
  );
});

test('buildOrgTimezoneContext returns timezone and today for mocked user', () => {
  const context = timezoneUtils.buildOrgTimezoneContext({
    activeOrgId: '1001',
    activeOrgTimeZone: 'America/Edmonton',
    orgToday: '2026-07-18',
    allowedOrgs: [{ orgId: '1001', timeZone: 'America/Edmonton' }]
  });
  assert.equal(context.timeZone, 'America/Edmonton');
  assert.equal(context.today, '2026-07-18');
  assert.equal(context.source, 'user');
});

test('getTodayDateKeyInTimezone returns stable YYYY-MM-DD shape', () => {
  const key = timezoneUtils.getTodayDateKeyInTimezone('UTC', Date.UTC(2026, 6, 18, 15, 30, 0));
  assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(key, '2026-07-18');
});

test('formatInstantInTimezone formats a known UTC instant into a target zone', () => {
  const formatted = timezoneUtils.formatInstantInTimezone(
    '2026-01-15T18:30:00.000Z',
    'America/Edmonton',
    { hour12: false }
  );
  assert.match(formatted, /Jan/);
  assert.match(formatted, /15/);
  assert.match(formatted, /11:30/);
});

test('authService attaches activeOrgTimeZone and orgToday during hydration', () => {
  const authService = read('MVC/services/authService.js');
  assert.match(authService, /activeOrgTimeZone/);
  assert.match(authService, /orgToday/);
  assert.match(authService, /resolveActiveOrgTimezoneFromUser/);
  assert.match(authService, /getTodayDateKeyInTimezone/);
  assert.match(authService, /timeZone:\s*resolveOrganizationTimezoneFromRow/);
});

test('orgTimezoneLocalsMiddleware sets res.locals.orgTimeZone', () => {
  const req = {
    user: {
      activeOrgId: '1001',
      activeOrgTimeZone: 'Asia/Tehran',
      orgToday: '2026-07-19'
    }
  };
  const res = { locals: {} };
  let nextCalled = false;
  orgTimezoneLocalsMiddleware(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(res.locals.orgTimeZone, 'Asia/Tehran');
  assert.equal(res.locals.orgToday, '2026-07-19');
  assert.equal(typeof res.locals.formatOrgDateTime, 'function');
  assert.match(res.locals.formatOrgDateTime('2026-01-15T18:30:00.000Z'), /2026/);
});

test('layout injects orgDateTime.js and AppOrgDateTime bootstrap', () => {
  const layout = read('MVC/views/layouts/layout.ejs');
  assert.match(layout, /__APP_ORG_DATETIME__/);
  assert.match(layout, /\/scripts\/orgDateTime\.js/);
  assert.match(layout, /orgTimeZone/);
  assert.match(layout, /orgToday/);
});

test('school pilot views reference org timezone display helpers', () => {
  const hub = read('packages/school/MVC/views/school/masterAcademiaHub.ejs');
  const timesheet = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  const timesheetController = read('packages/school/MVC/controllers/school/timesheetController.js');

  assert.match(hub, /AppOrgDateTime/);
  assert.match(hub, /formatHubInstant/);
  assert.match(hub, /hubTodayIso/);
  assert.match(timesheet, /formatOrgDateTime/);
  assert.match(timesheet, /ORG_TODAY/);
  assert.match(timesheet, /ORG_TIMEZONE/);
  assert.match(timesheetController, /resolveOrgTodayFromRequest/);
});

test('resolveOrgTodayFromRequest and resolveOrgYearFromRequest are exported from timezoneUtils', () => {
  assert.equal(typeof timezoneUtils.resolveOrgTodayFromRequest, 'function');
  assert.equal(typeof timezoneUtils.resolveOrgYearFromRequest, 'function');
  assert.equal(timezoneUtils.resolveOrgYearFromRequest({ orgToday: '2026-03-15' }), '2026');
});

test('track activity and activity quota prefer shared timezone utils', () => {
  const trackActivity = read('MVC/services/security/trackActivityService.js');
  const activityQuota = read('MVC/services/activityQuotaLedgerService.js');

  assert.match(trackActivity, /require\('\.\.\/\.\.\/utils\/timezoneUtils'\)/);
  assert.match(trackActivity, /activeOrgTimeZone/);
  assert.doesNotMatch(trackActivity, /function resolveOrganizationTimezoneFromRow/);

  assert.match(activityQuota, /require\('\.\.\/utils\/timezoneUtils'\)/);
  assert.match(activityQuota, /requestUser\.activeOrgTimeZone/);
  assert.doesNotMatch(activityQuota, /function resolveOrganizationTimezoneFromRow/);
});
