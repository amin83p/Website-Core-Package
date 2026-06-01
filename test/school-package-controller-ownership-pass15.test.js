const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('school package pass15 owns sessionController implementation', () => {
  const source = read('packages/school/MVC/controllers/school/sessionController.js');
  assert.equal(source.includes("requireCoreModule('MVC/controllers/school/sessionController.js')"), false);
  assert.match(source, /requireCoreModule\('MVC\/services\/dataService'\)/);
  assert.match(source, /requireCoreModule\('MVC\/utils\/idAdapter'\)/);
  assert.match(source, /module\.exports\s*=\s*\{/);
});

test('school package pass15 owns termController implementation', () => {
  const source = read('packages/school/MVC/controllers/school/termController.js');
  assert.equal(source.includes("requireCoreModule('MVC/controllers/school/termController.js')"), false);
  assert.match(source, /requireCoreModule\('MVC\/utils\/paginationHelper'\)/);
  assert.match(source, /requireCoreModule\('MVC\/utils\/generalTools'\)/);
  assert.match(source, /requireCoreModule\('MVC\/utils\/orgContextUtils'\)/);
  assert.match(source, /module\.exports\s*=\s*\{/);
});

test('school package pass15 owns subjectController implementation', () => {
  const source = read('packages/school/MVC/controllers/school/subjectController.js');
  assert.equal(source.includes("requireCoreModule('MVC/controllers/school/subjectController.js')"), false);
  assert.match(source, /requireCoreModule\('MVC\/services\/dataService'\)/);
  assert.match(source, /requireCoreModule\('MVC\/utils\/generalTools'\)/);
  assert.match(source, /requireCoreModule\('MVC\/utils\/orgContextUtils'\)/);
  assert.match(source, /module\.exports\s*=\s*\{/);
});

test('school package pass15 owns holidayController implementation', () => {
  const source = read('packages/school/MVC/controllers/school/holidayController.js');
  assert.equal(source.includes("requireCoreModule('MVC/controllers/school/holidayController.js')"), false);
  assert.match(source, /requireCoreModule\('MVC\/utils\/generalTools'\)/);
  assert.match(source, /requireCoreModule\('MVC\/services\/adminChekersService'\)/);
  assert.match(source, /requireCoreModule\('MVC\/utils\/idAdapter'\)/);
  assert.match(source, /module\.exports\s*=\s*\{/);
});

test('school package pass16 owns payRateController implementation', () => {
  const source = read('packages/school/MVC/controllers/school/payRateController.js');
  assert.equal(source.includes("requireCoreModule('MVC/controllers/school/payRateController.js')"), false);
  assert.match(source, /requireCoreModule\('MVC\/services\/dataService'\)/);
  assert.match(source, /requireCoreModule\('MVC\/utils\/idAdapter'\)/);
  assert.match(source, /exports\.listPayRates/);
});

test('school package pass16 owns sessionStatusController implementation', () => {
  const source = read('packages/school/MVC/controllers/school/sessionStatusController.js');
  assert.equal(source.includes("requireCoreModule('MVC/controllers/school/sessionStatusController.js')"), false);
  assert.match(source, /requireCoreModule\('MVC\/services\/adminChekersService'\)/);
  assert.match(source, /requireCoreModule\('MVC\/utils\/paginationHelper'\)/);
  assert.match(source, /exports\.saveSessionStatus/);
});

test('school package pass16 owns timesheetPeriodController implementation', () => {
  const source = read('packages/school/MVC/controllers/school/timesheetPeriodController.js');
  assert.equal(source.includes("requireCoreModule('MVC/controllers/school/timesheetPeriodController.js')"), false);
  assert.match(source, /requireCoreModule\('MVC\/utils\/orgContextUtils'\)/);
  assert.match(source, /requireCoreModule\('MVC\/utils\/generalTools'\)/);
  assert.match(source, /exports\.saveTimesheetPeriod/);
});

test('school package pass16 owns schoolSampleDataController implementation', () => {
  const source = read('packages/school/MVC/controllers/school/schoolSampleDataController.js');
  assert.equal(source.includes("requireCoreModule('MVC/controllers/school/schoolSampleDataController.js')"), false);
  assert.match(source, /requireCoreModule\('MVC\/utils\/orgContextUtils'\)/);
  assert.match(source, /requireCoreModule\('MVC\/utils\/generalTools'\)/);
  assert.match(source, /exports\.deleteSelectedSamplePeople/);
});

test('school package pass17 owns departmentController implementation', () => {
  const source = read('packages/school/MVC/controllers/school/departmentController.js');
  assert.equal(source.includes("requireCoreModule('MVC/controllers/school/departmentController.js')"), false);
  assert.match(source, /requireCoreModule\('MVC\/utils\/orgContextUtils'\)/);
  assert.match(source, /requireCoreModule\('MVC\/utils\/paginationHelper'\)/);
  assert.match(source, /exports\.listDepartments/);
});

test('school package pass17 owns transactionDefinitionController implementation', () => {
  const source = read('packages/school/MVC/controllers/school/transactionDefinitionController.js');
  assert.equal(source.includes("requireCoreModule('MVC/controllers/school/transactionDefinitionController.js')"), false);
  assert.match(source, /requireCoreModule\('MVC\/services\/adminChekersService'\)/);
  assert.match(source, /requireCoreModule\('MVC\/utils\/orgContextUtils'\)/);
  assert.match(source, /exports\.saveTransactionDefinition/);
});

test('school package pass17 owns gradesMatrixController implementation', () => {
  const source = read('packages/school/MVC/controllers/school/gradesMatrixController.js');
  assert.equal(source.includes("requireCoreModule('MVC/controllers/school/gradesMatrixController.js')"), false);
  assert.match(source, /requireCoreModule\('MVC\/services\/dataService'\)/);
  assert.match(source, /requireCoreModule\('MVC\/utils\/idAdapter'\)/);
  assert.match(source, /module\.exports\s*=\s*\{/);
});

test('school package pass17 owns schoolDashboardController implementation', () => {
  const source = read('packages/school/MVC/controllers/school/schoolDashboardController.js');
  assert.equal(source.includes("requireCoreModule('MVC/controllers/school/schoolDashboardController.js')"), false);
  assert.match(source, /requireCoreModule\('MVC\/services\/security'\)/);
  assert.match(source, /requireCoreModule\('MVC\/controllers\/dashboardController'\)/);
  assert.match(source, /config\/accessConstants/);
  assert.match(source, /module\.exports\s*=\s*\{/);
});
test('school package pass18 owns attendanceController implementation', () => {
  const source = read('packages/school/MVC/controllers/school/attendanceController.js');
  assert.equal(source.includes("requireCoreModule('MVC/controllers/school/attendanceController.js')"), false);
  assert.match(source, /requireCoreModule\('MVC\/services\/dataService'\)/);
  assert.match(source, /requireCoreModule\('MVC\/services\/security\/index'\)/);
  assert.match(source, /config\/accessConstants/);
  assert.match(source, /module\.exports\s*=\s*\{/);
});

test('school package pass18 owns schoolAccountController implementation', () => {
  const source = read('packages/school/MVC/controllers/school/schoolAccountController.js');
  assert.equal(source.includes("requireCoreModule('MVC/controllers/school/schoolAccountController.js')"), false);
  assert.match(source, /requireCoreModule\('MVC\/utils\/paginationHelper'\)/);
  assert.match(source, /requireCoreModule\('MVC\/services\/adminChekersService'\)/);
  assert.match(source, /exports\.saveAccount/);
});

test('school package pass18 owns timesheetController implementation', () => {
  const source = read('packages/school/MVC/controllers/school/timesheetController.js');
  assert.equal(source.includes("requireCoreModule('MVC/controllers/school/timesheetController.js')"), false);
  assert.match(source, /requireCoreModule\('MVC\/utils\/orgContextUtils'\)/);
  assert.match(source, /requireCoreModule\('MVC\/services\/dataService'\)/);
  assert.match(source, /exports\.saveTimesheet/);
});

test('school package pass18 owns withdrawalController implementation', () => {
  const source = read('packages/school/MVC/controllers/school/withdrawalController.js');
  assert.equal(source.includes("requireCoreModule('MVC/controllers/school/withdrawalController.js')"), false);
  assert.match(source, /require\('\.\.\/\.\.\/services\/school\/withdrawal'\)/);
  assert.match(source, /module\.exports\s*=\s*\{/);
});