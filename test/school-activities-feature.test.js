const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

process.env.MAIN_SECRET_KEY ||= '0123456789abcdef0123456789abcdef';
process.env.SESSION_SECRET ||= 'fedcba9876543210fedcba9876543210';
process.env.SESSION_ENCRYPTION_KEY ||= '00112233445566778899aabbccddeeff';
process.env.ACTION_STATE_KEY ||= 'ffeeddccbbaa99887766554433221100';
process.env.DATA_BACKEND = 'json';
process.env.DATA_BACKEND_STRICT = 'false';

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

test('School activities manifest declares section, symbol, navigation, data entities, and staff grants', () => {
  const manifest = readJson('packages/school/package.manifest.json');
  const section = (manifest.sections || []).find((row) => row.id === '445580');
  assert.ok(section, 'section 445580 should be declared');
  assert.equal(section.name, 'SCHOOL_ACTIVITIES');
  assert.equal(section.homeURL, '/school/activities');
  assert.equal(section.trackState, true);

  const academia = (manifest.sections || []).find((row) => row.name === 'SCHOOL_ACADEMIA');
  assert.ok((academia.subsections || []).some((row) => row.id === '445580'), 'section should be under SCHOOL_ACADEMIA');

  const symbol = (manifest.symbols || []).find((row) => row.id === 'SYM_SYSTEM_062');
  assert.ok(symbol, 'symbol SYM_SYSTEM_062 should be declared');
  assert.equal(symbol.name, 'SCHOOL_ACTIVITIES');
  assert.equal(symbol.orgId, 'SYSTEM');
  assert.deepEqual(symbol.tags, ['SCHOOL_ACTIVITIES', '445580']);

  assert.ok((manifest.menuEntries || []).some((row) => row.id === 'school-menu-activities' && row.href === '/school/activities'));
  assert.ok((manifest.dashboardEntries || []).some((row) => row.id === 'school-dashboard-activities' && row.href === '/school/activities'));
  assert.ok((manifest.dataEntities || []).some((row) => row.entityType === 'activityCategories' && row.collectionName === 'schoolActivityCategories'));
  assert.ok((manifest.dataEntities || []).some((row) => row.entityType === 'activities' && row.collectionName === 'schoolActivities'));

  const profile = (manifest.accesses || []).find((row) => row.name === 'SCHOOL_STAFF');
  assert.ok(profile, 'SCHOOL_STAFF profile should exist');
  const grant = (profile.sections || []).find((row) => row.sectionId === '445580');
  assert.ok(grant, 'SCHOOL_STAFF should include school activities section');
  assert.equal(grant.adminAccess, false);
  assert.deepEqual((grant.operations || []).map((row) => `${row.operationId}:${row.scopeId}`), [
    'OP1001:SCP_ORG',
    'OP1002:SCP_ORG',
    'OP1003:SCP_ORG',
    'OP1004:SCP_ORG',
    'OP1005:SCP_ORG'
  ]);
});

test('School activities package route, repository, service, views, and seed script are wired', () => {
  const schoolRoute = readText('packages/school/MVC/routes/schoolMainRoute.js');
  assert.match(schoolRoute, /router\.use\('\/activities', require\('\.\/activityRoutes'\)\)/);

  const activityRoute = readText('packages/school/MVC/routes/activityRoutes.js');
  assert.match(activityRoute, /SECTIONS\.SCHOOL_ACTIVITIES/);
  assert.match(activityRoute, /router\.get\('\/api\/eligible-persons'/);
  assert.match(activityRoute, /router\.get\('\/categories'/);

  const dataService = readText('packages/school/MVC/services/school/schoolDataService.js');
  assert.match(dataService, /activityCategories: \{ repository: schoolRepositories\.activityCategories \}/);
  assert.match(dataService, /activities: \{ repository: schoolRepositories\.activities \}/);

  const repo = readText('packages/school/MVC/repositories/school/index.js');
  assert.match(repo, /collectionName: 'schoolActivityCategories'/);
  assert.match(repo, /collectionName: 'schoolActivities'/);
  assert.match(repo, /assertQueryableCrudRepository\('schoolRepositories\.activities'/);

  const scheduleController = readText('packages/school/MVC/controllers/school/scheduleController.js');
  assert.match(scheduleController, /activityService\.getScheduleEventsForPerson/);

  const timesheetController = readText('packages/school/MVC/controllers/school/timesheetController.js');
  assert.match(timesheetController, /activityService\.getTimesheetEntriesForPerson/);

  const timesheetModel = readText('packages/school/MVC/models/school/timesheetModel.js');
  assert.match(timesheetModel, /isSchoolActivity/);
  assert.match(timesheetModel, /compensationLookup/);

  assert.ok(fs.existsSync(path.join(ROOT, 'packages/school/MVC/views/school/activity/activityList.ejs')));
  assert.ok(fs.existsSync(path.join(ROOT, 'packages/school/MVC/views/school/activity/activityForm.ejs')));
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts/mongo-railway/insert-school-activities-section.mongosh.js')));
  assert.ok(fs.existsSync(path.join(ROOT, 'packages/school/scripts/maintenance/insert-school-activities-section.mongosh.js')));
});



test('School activities attendee picker and save path preserve selected attendees and roles', () => {
  const service = readText('packages/school/MVC/services/school/activityService.js');
  assert.match(service, /activityModel\.sanitizeActivityPayload/);
  assert.match(service, /normalizeActivityRecord/);
  assert.match(service, /enrichActivityAttendeeNames/);
  assert.match(service, /parseJsonArray\(activity\.attendees\)/);
  assert.match(service, /schoolDataService\.fetchData\('students'/);
  assert.match(service, /add\('student', row\)/);
  assert.match(service, /schoolDataService\.fetchData\('teachers'/);
  assert.match(service, /schoolDataService\.fetchData\('staff'/);

  const model = readText('packages/school/MVC/models/school/activityModel.js');
  assert.match(model, /const rolesSource = Array\.isArray\(input\.roles\)/);
  assert.match(model, /roles: roles\.length \? roles : \[role\]/);

  const form = readText('packages/school/MVC/views/school/activity/activityForm.ejs');
  assert.match(form, /multiselect: true/);
  assert.match(form, /renderRoleSelect/);
  assert.match(form, /pickDefaultRole/);
  assert.match(form, /safeShowMessage/);
  assert.match(form, /buildPersonDisplayName/);
  assert.doesNotMatch(form, /window\.alert|\balert\(/);
  assert.match(form, /activityAttendeesInput/);
});
