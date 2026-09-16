const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

test('School notification centre manifest declares section, menus, and data entities', () => {
  const manifest = readJson('packages/school/package.manifest.json');
  const section = (manifest.sections || []).find((row) => row.id === '445586');
  assert.ok(section, 'section 445586 should be declared');
  assert.equal(section.name, 'SCHOOL_NOTIFICATION_CENTER');
  assert.equal(section.homeURL, '/school/notification-center');

  const reports = (manifest.sections || []).find((row) => row.name === 'SCHOOL_REPORTS');
  assert.ok(reports, 'SCHOOL_REPORTS section should exist');
  assert.ok((reports.subsections || []).some((row) => row.id === '445586'), 'section should be under SCHOOL_REPORTS');

  const academia = (manifest.sections || []).find((row) => row.name === 'SCHOOL_ACADEMIA');
  assert.ok(!(academia.subsections || []).some((row) => row.id === '445586'), 'section should not be under SCHOOL_ACADEMIA');

  assert.ok((manifest.menuEntries || []).some((row) => row.id === 'school-menu-notification-center' && row.href === '/school/notification-center'));
  assert.ok((manifest.dashboardEntries || []).some((row) => row.id === 'school-dashboard-notification-center' && row.href === '/school/notification-center'));
  assert.ok((manifest.dataEntities || []).some((row) => row.entityType === 'notificationRules' && row.collectionName === 'schoolNotificationRules'));
  assert.ok((manifest.dataEntities || []).some((row) => row.entityType === 'notificationRuns' && row.collectionName === 'schoolNotificationRuns'));
});

test('School notification centre routes, services, repositories, and views are wired', () => {
  const schoolRoute = readText('packages/school/MVC/routes/schoolMainRoute.js');
  assert.match(schoolRoute, /router\.use\('\/notification-center', require\('\.\/notificationCenterRoutes'\)\)/);

  const routes = readText('packages/school/MVC/routes/notificationCenterRoutes.js');
  const controller = readText('packages/school/MVC/controllers/school/notificationCenterController.js');
  assert.match(routes, /SECTIONS\.SCHOOL_NOTIFICATION_CENTER/);
  assert.match(routes, /router\.get\('\/'/);
  assert.match(routes, /router\.post\('\/rules\/:id\/run'/);
  assert.match(routes, /schedule-email/);
  assert.match(routes, /\/outbox'/);
  assert.match(routes, /\/outbox\/:id\/cancel'/);
  assert.doesNotMatch(routes, /runs\/:id\/dispatch/);
  assert.match(controller, /disableNotificationCenterScheduledTasks/);
  assert.match(controller, /notificationCenterComposeService/);
  assert.match(controller, /applyGenericFilter/);
  assert.match(controller, /paginate\(/);
  assert.match(controller, /includeModal_Table: true/);
  assert.match(controller, /School_NotificationCenter_Rules/);

  const ruleForm = readText('packages/school/MVC/views/school/notificationCenter/ruleForm.ejs');
  assert.match(ruleForm, /sections-page/);
  assert.match(ruleForm, /form-container wide/);
  assert.match(ruleForm, /formatLabel\(type\)/);

  const ruleModel = readText('packages/school/MVC/models/school/notificationRuleModel.js');
  assert.match(ruleModel, /formatNotificationTokenLabel/);

  const dashboardController = readText('packages/school/MVC/controllers/school/schoolDashboardController.js');
  assert.match(dashboardController, /sectionId: SECTIONS\.SCHOOL_NOTIFICATION_CENTER/);
  assert.match(dashboardController, /priority: 136/);

  const dataService = readText('packages/school/MVC/services/school/schoolDataService.js');
  assert.match(dataService, /notificationRules: \{ repository: schoolRepositories\.notificationRules \}/);
  assert.match(dataService, /notificationRuns: \{ repository: schoolRepositories\.notificationRuns \}/);

  const repo = readText('packages/school/MVC/repositories/school/index.js');
  assert.match(repo, /collectionName: 'schoolNotificationRules'/);
  assert.match(repo, /collectionName: 'schoolNotificationRuns'/);

  const listView = readText('packages/school/MVC/views/school/notificationCenter/list.ejs');
  const runView = readText('packages/school/MVC/views/school/notificationCenter/runDetail.ejs');
  assert.match(listView, /id="first-table"/);
  assert.match(listView, /tablePages-search/);
  assert.match(listView, /data-floating-row-actions="true"/);
  assert.match(listView, /formatNotificationTokenLabel|rule\.ruleType/);
  assert.match(listView, /notification-center/);
  assert.match(listView, /Scheduled emails/);
  assert.match(runView, /ncTeacherAccordion/);
  assert.match(runView, /nc-matrix-table/);
  assert.match(runView, /Days passed/);
  assert.match(runView, /Schedule email for selection/);
  assert.match(runView, /ncScheduleEmailModal/);
  assert.doesNotMatch(runView, /Queue email\/SMS/);

  const registry = readText('packages/school/MVC/services/school/notificationCenterEvaluatorRegistry.js');
  assert.match(registry, /session_not_final/);
  assert.match(registry, /session_attendance_incomplete/);
  assert.match(registry, /timesheet_not_submitted/);
});
