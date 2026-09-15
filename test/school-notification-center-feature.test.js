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

  const academia = (manifest.sections || []).find((row) => row.name === 'SCHOOL_ACADEMIA');
  assert.ok((academia.subsections || []).some((row) => row.id === '445586'), 'section should be under SCHOOL_ACADEMIA');

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
  assert.match(routes, /router\.post\('\/runs\/:id\/dispatch'/);
  assert.match(controller, /notificationCenterRunService/);

  const dataService = readText('packages/school/MVC/services/school/schoolDataService.js');
  assert.match(dataService, /notificationRules: \{ repository: schoolRepositories\.notificationRules \}/);
  assert.match(dataService, /notificationRuns: \{ repository: schoolRepositories\.notificationRuns \}/);

  const repo = readText('packages/school/MVC/repositories/school/index.js');
  assert.match(repo, /collectionName: 'schoolNotificationRules'/);
  assert.match(repo, /collectionName: 'schoolNotificationRuns'/);

  const listView = readText('packages/school/MVC/views/school/notificationCenter/list.ejs');
  const runView = readText('packages/school/MVC/views/school/notificationCenter/runDetail.ejs');
  assert.match(listView, /Notification Centre|notification-center/);
  assert.match(runView, /Queue email\/SMS/);

  const registry = readText('packages/school/MVC/services/school/notificationCenterEvaluatorRegistry.js');
  assert.match(registry, /session_not_final/);
  assert.match(registry, /session_attendance_incomplete/);
  assert.match(registry, /timesheet_not_submitted/);
});
