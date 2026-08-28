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

test('School rolling enrollment manifest declares renamed section, symbol, and academia placement', () => {
  const manifest = readJson('packages/school/package.manifest.json');
  const section = (manifest.sections || []).find((row) => row.id === '445572');
  assert.ok(section, 'section 445572 should be declared');
  assert.equal(section.name, 'SCHOOL_ROLLING_ENROLLMENT');
  assert.equal(section.homeURL, '/school/rolling-enrollment');
  assert.equal(section.dashboardDisplay, true);
  assert.equal(section.trackState, true);

  const academia = (manifest.sections || []).find((row) => row.name === 'SCHOOL_ACADEMIA');
  assert.ok(academia, 'SCHOOL_ACADEMIA should exist');
  assert.ok((academia.subsections || []).some((row) => row.id === '445572'), 'section should be under SCHOOL_ACADEMIA');

  const symbol = (manifest.symbols || []).find((row) => row.id === 'SYM_SYSTEM_064');
  assert.ok(symbol, 'symbol SYM_SYSTEM_064 should be declared');
  assert.equal(symbol.name, 'SCHOOL_ROLLING_ENROLLMENT');
  assert.equal(symbol.orgId, 'SYSTEM');
  assert.ok((symbol.tags || []).includes('445572'));
});

test('School rolling enrollment access constants keep legacy alias', () => {
  const constants = require('../packages/school/config/accessConstants');
  assert.equal(constants.SECTIONS.SCHOOL_ROLLING_ENROLLMENT, 'SCHOOL_ROLLING_ENROLLMENT');
  assert.equal(constants.SECTIONS.SCHOOL_CLASS_ENROLLMENT_PERIODS, 'SCHOOL_ROLLING_ENROLLMENT');
});

test('School rolling enrollment routes and dashboard wiring use dedicated section', () => {
  const classRoutes = readText('packages/school/MVC/routes/classRoutes.js');
  assert.match(classRoutes, /rolling-enrollment[\s\S]*?SECTIONS\.SCHOOL_ROLLING_ENROLLMENT/);
  assert.doesNotMatch(classRoutes, /SECTIONS\.SCHOOL_CLASS_ENROLLMENT_PERIODS/);

  const landingRoutes = readText('packages/school/MVC/routes/rollingEnrollmentRoutes.js');
  assert.match(landingRoutes, /SECTIONS\.SCHOOL_ROLLING_ENROLLMENT/);
  assert.match(landingRoutes, /listRollingEnrollmentClasses/);

  const mainRoute = readText('packages/school/MVC/routes/schoolMainRoute.js');
  assert.match(mainRoute, /router\.use\('\/rolling-enrollment', require\('\.\/rollingEnrollmentRoutes'\)\)/);

  const dashboard = readText('packages/school/MVC/controllers/school/schoolDashboardController.js');
  assert.match(
    dashboard,
    /pattern:\s*\/\^\\\/school\\\/rolling-enrollment/
  );
  assert.match(
    dashboard,
    /pattern:\s*\/\^\\\/school\\\/classes\\\/\[\^\/\]\+\\\/rolling-enrollment/
  );
  assert.match(dashboard, /sectionId:\s*SECTIONS\.SCHOOL_ROLLING_ENROLLMENT/);
});

test('School rolling enrollment landing page lists rolling classes and links to class workflow', () => {
  const controller = readText('packages/school/MVC/controllers/school/classRollingEnrollmentController.js');
  assert.match(controller, /listRollingEnrollmentClasses/);
  assert.match(controller, /rollingEnrollmentClassList/);
  assert.match(controller, /getClassRegistrationModeKey\(row\) === 'rolling'/);

  const view = readText('packages/school/MVC/views/school/class/rollingEnrollmentClassList.ejs');
  assert.match(view, /Open Rolling Enrollment/);
  assert.match(view, /\/school\/classes\/<%= encodeURIComponent\(item\.id\) %>\/rolling-enrollment/);
  assert.match(view, /baseUrlPath: 'school\/rolling-enrollment'/);
});

test('School rolling enrollment entry points are access-gated in class form and hub', () => {
  const classForm = readText('packages/school/MVC/views/school/class/classForm.ejs');
  assert.match(classForm, /canAccessRollingEnrollment/);
  assert.match(classForm, /rolling-enrollment/);

  const classController = readText('packages/school/MVC/controllers/school/classController.js');
  assert.match(classController, /canAccessRollingEnrollment/);
  assert.match(classController, /SECTIONS\.SCHOOL_ROLLING_ENROLLMENT/);

  const hubService = readText('packages/school/MVC/services/school/schoolMasterAcademiaHubService.js');
  assert.match(hubService, /SECTIONS\.SCHOOL_ROLLING_ENROLLMENT/);
  assert.match(hubService, /canAccessRollingEnrollment/);
});

test('School rolling enrollment migration script renames section and attaches academia symbol', () => {
  const script = readText('packages/school/scripts/maintenance/rename-rolling-enrollment-section.mongosh.js');
  const nodeScript = readText('scripts/school/rename-rolling-enrollment-section.js');
  assert.match(script, /SECTION_ID = '445572'/);
  assert.match(script, /SECTION_NAME = 'SCHOOL_ROLLING_ENROLLMENT'/);
  assert.match(script, /SYM_SYSTEM_064/);
  assert.match(script, /ensureParentSubsection/);
  assert.match(nodeScript, /SECTION_NAME = 'SCHOOL_ROLLING_ENROLLMENT'/);
  assert.match(nodeScript, /SECTION_HOME_URL = '\/school\/rolling-enrollment'/);
});
