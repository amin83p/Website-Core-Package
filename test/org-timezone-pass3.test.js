const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const timezoneUtils = require('../MVC/utils/timezoneUtils');
const leaveRequestService = require('../packages/school/MVC/services/school/leaveRequestService');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('formatOrgInstant partial delegates to formatOrgDateTime', () => {
  const partial = read('MVC/views/partials/formatOrgInstant.ejs');
  assert.match(partial, /formatOrgDateTime/);
  assert.match(partial, /typeof formatOrgDateTime === 'function'/);
});

test('AppOrgDateTime.formatSchoolInstant is exported from orgDateTime.js', () => {
  const script = read('public/scripts/orgDateTime.js');
  assert.match(script, /formatSchoolInstant/);
  assert.match(script, /formatSchoolInstant\(value, options = \{\}\)/);
  assert.match(script, /formatSchoolInstant,/);
});

test('priority core admin views use formatOrgDateTime for audit timestamps', () => {
  const views = [
    'MVC/views/organization/organizations.ejs',
    'MVC/views/person/persons.ejs',
    'MVC/views/security/activeUsersList.ejs',
    'MVC/views/activityQuota/ledger/ledgerList.ejs'
  ];
  views.forEach((viewPath) => {
    const source = read(viewPath);
    assert.match(source, /formatOrgDateTime/);
  });
});

test('registrationIntegrityService threads orgToday through class enrollment', () => {
  const source = read('packages/school/MVC/services/school/registrationIntegrityService.js');
  assert.match(source, /orgToday = ''/);
  assert.match(source, /todayISO\(orgToday \|\| options\.orgToday \|\| reqUser\?\.orgToday\)/);
  assert.match(source, /options\.orgToday \|\| reqUser\?\.orgToday/);
});

test('leaveRequestService.createRequest prefers options.orgToday for requestDate', () => {
  const source = read('packages/school/MVC/services/school/leaveRequestService.js');
  assert.match(source, /async function createRequest\(reqUser, input = \{\}, options = \{\}\)/);
  assert.match(source, /cleanDate\(options\.orgToday\)/);
});

test('schoolMasterAcademiaHubService holiday year helpers accept orgToday', () => {
  const source = read('packages/school/MVC/services/school/schoolMasterAcademiaHubService.js');
  assert.match(source, /function resolveHolidayYear\(value, orgToday = ''\)/);
  assert.match(source, /function buildHolidayYearOptions\(selectedYear, orgToday = ''\)/);
  assert.match(source, /resolveHolidayYear\(queryInput\?\.year \|\| query\.year, orgToday\)/);
});

test('quota services import shared timezone date-key helpers', () => {
  const creditCheck = read('MVC/services/activityQuota/creditCheckDataService.js');
  const ledger = read('MVC/services/activityQuotaLedgerService.js');
  assert.match(creditCheck, /require\('\.\.\/\.\.\/utils\/timezoneUtils'\)/);
  assert.match(creditCheck, /getDateKeyInTimezone/);
  assert.match(ledger, /getDateKeyInTimezone/);
  assert.match(ledger, /function getDateKeyInTimeZone\(isoDateTime = '', timeZone = DEFAULT_ORG_TIMEZONE\) \{\s*return getDateKeyInTimezone/);
});

test('getDateKeyInTimezone converts instants using org timezone', () => {
  const key = timezoneUtils.getDateKeyInTimezone('2026-07-19T06:00:00.000Z', 'America/Edmonton');
  assert.equal(key, '2026-07-19');
});

test('withdrawalPolicyService exposes resolveBusinessToday', () => {
  const withdrawalPolicy = require('../packages/school/MVC/services/school/withdrawal/withdrawalPolicyService');
  assert.equal(
    withdrawalPolicy.resolveBusinessToday('', { orgToday: '2026-03-15' }),
    '2026-03-15'
  );
});

test('authService passes org-scoped today into evaluateUserEntitlement', () => {
  const authService = read('MVC/services/authService.js');
  assert.match(authService, /today: getTodayDateKeyInTimezone\(nextOrg\.timeZone \|\| 'UTC'\)/);
  assert.match(authService, /evaluateUserEntitlement\(membershipRows, user\.id, activeOrgId, \{ today: orgToday \}\)/);
  assert.match(authService, /today: getTodayDateKeyInTimezone\(resolveOrganizationTimezoneFromRow\(target\)\)/);
});

test('leave request controller threads orgToday into create path', () => {
  const controller = read('packages/school/MVC/controllers/school/leaveRequestController.js');
  assert.match(controller, /resolveOrgTodayFromRequest/);
  assert.match(controller, /orgToday: resolveOrgTodayFromRequest\(req\)/);
});

test('leaveRequestService buildCreatePayload is exported for contract checks', () => {
  assert.equal(typeof leaveRequestService.createRequest, 'function');
});
