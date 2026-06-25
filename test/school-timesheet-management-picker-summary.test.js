const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('timesheet management uses generic picker instead of preloaded period dropdown', () => {
  const view = read('packages/school/MVC/views/school/timesheet/timesheetManage.ejs');
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');

  assert.doesNotMatch(view, /<select\s+id=["']periodSelect["']/);
  assert.doesNotMatch(view, /\(periods \|\| \[\]\)\.forEach/);
  assert.match(view, /type="hidden" id="periodSelect"/);
  assert.match(view, /id="periodDisplay"/);
  assert.match(view, /modal_GenericPicker/);
  assert.match(view, /GenericPicker\.open\(window\.GenericPickerPresets\.normalizeConfig/);
  assert.match(view, /apiEndpoint:\s*'\/school\/timesheets\/manage\/api\/periods'/);
  assert.match(view, /searchFields:\s*'id,name,startDate,endDate,status,submissionDeadline,submissionDeadlineTime'/);

  const showManagementBody = controller.match(/exports\.showTimesheetManagement = async \(req, res\) => \{([\s\S]*?)\n\};/)[1];
  assert.doesNotMatch(showManagementBody, /loadTimesheetManagementPeriods\(req, \{\}\)/);
  assert.doesNotMatch(showManagementBody, /periods,/);
});

test('timesheet management period API returns picker-friendly rows', () => {
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');

  assert.match(controller, /function shapeTimesheetPeriodPickerRow\(period\)/);
  assert.match(controller, /const deadlineLabel = formatPeriodDeadlineLabel\(period\)/);
  assert.match(controller, /periodWindowLabel/);
  assert.match(controller, /results: data\.map\(shapeTimesheetPeriodPickerRow\)/);
});

test('timesheet management department summary includes pay rate labels', () => {
  const view = read('packages/school/MVC/views/school/timesheet/timesheetManage.ejs');
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');

  assert.match(controller, /function resolvePayRateForDepartment/);
  assert.match(controller, /dataService\.fetchData\('payRates', \{ orgId__eq: activeOrgId, personId__eq: personId \}/);
  assert.match(controller, /payRateLabel: resolvedRate \? formatHourlyRateLabel\(resolvedRate\.hourlyRate\) : 'N\/D'/);
  assert.match(controller, /dateOrBoundary\(b\.effectiveFrom, '0001-01-01'\)/);

  assert.match(view, /<th class="text-end">Pay Rate<\/th>/);
  assert.match(view, /row\.payRateLabel \|\| 'N\/D'/);
});
test('master academia hub timesheet summary mirrors pay rate display', () => {
  const view = read('packages/school/MVC/views/school/masterAcademiaHub.ejs');

  assert.match(view, /function renderHubTimesheetManagementSummary\(payload\)/);
  assert.match(view, /hubTimesheetManagementSummaryModal/);
  assert.match(view, /modal-dialog modal-xl modal-dialog-scrollable/);
  assert.match(view, /<th>Pay Rate<\/th>/);
  assert.match(view, /row\.payRateLabel \|\| 'N\/D'/);
});
test('master academia hub timesheet management filters periods by available year', () => {
  const view = read('packages/school/MVC/views/school/masterAcademiaHub.ejs');

  assert.match(view, /id="hubTimesheetManagementYear"/);
  assert.match(view, /function getHubTimesheetPeriodYear\(period\)/);
  assert.match(view, /function refreshHubTimesheetManagementYears\(\)/);
  assert.match(view, /function renderHubTimesheetManagementYearOptions\(\)/);
  assert.match(view, /getHubTimesheetPeriodYear\(period\) === selectedYear/);
  assert.match(view, /Timesheet Periods In Selected Year/);
  assert.match(view, /params\.set\('limit', '1000'\)/);
  assert.doesNotMatch(view, /hubTimesheetManagementPeriodSearch/);
  assert.doesNotMatch(view, /hubTimesheetManagementFindPeriods/);
});
test('timesheet management roster can be filtered by timesheet status', () => {
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');
  const manageView = read('packages/school/MVC/views/school/timesheet/timesheetManage.ejs');
  const hubView = read('packages/school/MVC/views/school/masterAcademiaHub.ejs');

  assert.match(controller, /req\.query\.timesheetStatus/);
  assert.match(controller, /status = String\(timesheet\?\.status \|\| 'not_started'\)\.toLowerCase\(\)/);
  assert.match(controller, /!requestedTimesheetStatus \|\| row\.status === requestedTimesheetStatus/);

  assert.match(manageView, /id="timesheetStatusFilter"/);
  assert.match(manageView, /rosterParams\.set\('timesheetStatus', requestedStatus\)/);
  assert.match(manageView, /timesheetStatusFilter\?\.addEventListener\('change'/);

  assert.match(hubView, /id="hubTimesheetManagementStatusFilter"/);
  assert.match(hubView, /rosterParams\.set\('timesheetStatus', requestedStatus\)/);
  assert.match(hubView, /const statusFilter = document\.getElementById\('hubTimesheetManagementStatusFilter'\)/);
});