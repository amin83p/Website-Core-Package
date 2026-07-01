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
  assert.match(service, /normalizeActivityVisibilityScope/);
  assert.match(service, /visibilityScope: activity\.visibilityScope/);

  const model = readText('packages/school/MVC/models/school/activityModel.js');
  assert.match(model, /const rolesSource = Array\.isArray\(input\.roles\)/);
  assert.match(model, /roles: roles\.length \? roles : \[role\]/);
  assert.match(model, /public.*school/);
  assert.match(model, /private.*individual/);

  const form = readText('packages/school/MVC/views/school/activity/activityForm.ejs');
  assert.match(form, /multiselect: true/);
  assert.match(form, /renderRoleSelect/);
  assert.match(form, /pickDefaultRole/);
  assert.match(form, /safeShowMessage/);
  assert.match(form, /buildPersonDisplayName/);
  assert.doesNotMatch(form, /window\.alert|\balert\(/);
  assert.match(form, /activityAttendeesInput/);
  assert.match(form, /name="visibilityScope"/);
  assert.match(form, /School \/ Public/);
  assert.match(form, /Individual \/ Assigned people only/);
  assert.match(form, /activityEntriesTable/);
  assert.match(form, /activityEntriesTbody/);
  assert.match(form, /data-floating-row-actions="true"/);
  assert.match(form, /btn-row-actions-toggle/);
  assert.match(form, /row-actions-menu/);
  assert.match(form, /bi-three-dots-vertical/);
  assert.match(form, /js-entry-edit/);
  assert.match(form, /Edit details/);
  assert.match(form, /activityEntryModal/);
  assert.match(form, /activityEntryModalBody/);
  assert.match(form, /renderEntryModal/);
  assert.match(form, /activityBatchModal/);
  assert.match(form, /activityBatchCount/);
  assert.match(form, /activityBatchStartDate/);
  assert.match(form, /activityBatchEndDate/);
  assert.match(form, /activity-batch-day/);
  assert.match(form, /activityBatchAddAssignees/);
  assert.match(form, /activityBatchAssignees/);
  assert.match(form, /activityBatchSkipHolidays/);
  assert.match(form, /generateActivityEntries/);
  assert.match(form, /openActivityBatchModal/);
  assert.match(form, /openBatchAssigneePicker/);
  assert.match(form, /generateActivityBatchEntries/);
  assert.match(form, /buildBatchDateTokens/);
  assert.match(form, /\/school\/holidays\/api\/range/);

  const list = readText('packages/school/MVC/views/school/activity/activityList.ejs');
  assert.match(list, /visibilityScope/);
  assert.match(list, /School \/ Public/);
  assert.match(list, /Individual \/ Assigned only/);

  const controller = readText('packages/school/MVC/controllers/school/activityController.js');
  assert.match(controller, /normalizeActivityVisibilityScope\(rawVisibilityScope\)/);

  const calendarService = readText('packages/school/MVC/services/school/schoolCalendarService.js');
  assert.match(calendarService, /normalizeActivityVisibilityScope\(row\.visibilityScope\) === 'school'/);
  assert.match(calendarService, /activityScope === 'school' \? 'purple'/);

  const calendarView = readText('packages/school/MVC/views/school/calendar/calendar.ejs');
  assert.match(calendarView, /\.tone-purple/);
});

test('School activities support multi-session entries with legacy compatibility', () => {
  const activityModel = require('../packages/school/MVC/models/school/activityModel');
  const activityService = require('../packages/school/MVC/services/school/activityService');

  const legacy = activityModel.sanitizeActivityPayload({
    orgId: 'ORG1',
    title: 'Content Preparation',
    categoryId: 'CAT1',
    departmentId: 'DEP1',
    date: '2026-07-01',
    startTime: '09:00',
    endTime: '11:00',
    paid: 'on',
    status: 'posted',
    attendees: JSON.stringify([{ personId: 'P1', personName: 'Teacher One', roles: ['teacher'] }])
  });
  assert.equal(legacy.entries.length, 1);
  assert.equal(legacy.entries[0].entryId, 'ENTRY-1');
  assert.equal(legacy.entries[0].assignees[0].paidHours, 2);
  assert.equal(legacy.visibilityScope, 'school');

  const multi = activityModel.sanitizeActivityPayload({
    orgId: 'ORG1',
    title: 'Website Build',
    categoryId: 'CAT1',
    departmentId: 'DEP1',
    paid: 'on',
    status: 'posted',
    visibilityScope: 'private',
    entries: JSON.stringify([
      {
        entryId: 'ENTRY-A',
        title: 'Wireframe',
        date: '2026-07-01',
        startTime: '09:00',
        endTime: '10:30',
        assignees: [{ personId: 'P1', personName: 'Staff One', roles: ['staff'] }]
      },
      {
        entryId: 'ENTRY-B',
        title: 'Build',
        date: '2026-07-03',
        startTime: '13:00',
        endTime: '16:00',
        assignees: [{ personId: 'P1', personName: 'Staff One', roles: ['staff'], paidHours: 3 }]
      }
    ])
  });

  assert.equal(multi.entries.length, 2);
  assert.equal(multi.date, '2026-07-01');
  assert.equal(multi.durationHours, 1.5);
  assert.equal(multi.totalDurationHours, 4.5);
  assert.equal(multi.visibilityScope, 'individual');
  assert.equal(multi.attendees.length, 1);
  assert.equal(multi.attendees[0].paidHours, 4.5);
  assert.deepEqual(activityService.getActivityEntries(multi).map((entry) => entry.entryId), ['ENTRY-A', 'ENTRY-B']);
  assert.equal(activityService.normalizeActivityVisibilityScope('public'), 'school');
  assert.equal(activityService.normalizeActivityVisibilityScope('assigned-only'), 'individual');
  assert.throws(() => activityService.normalizeActivityVisibilityScope('classroom'), /Invalid activity calendar scope/);
});
