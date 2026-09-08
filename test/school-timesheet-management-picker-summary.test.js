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

  assert.match(controller, /function shapeTimesheetPeriodPickerRow\(period/);
  assert.match(controller, /const deadlineLabel = formatPeriodDeadlineLabel\(period\)/);
  assert.match(controller, /periodWindowLabel/);
  assert.match(controller, /results: data\.map\(\(period\) => shapeTimesheetPeriodPickerRow\(/);
});

test('timesheet management department summary includes role-aware pay rate labels', () => {
  const view = read('packages/school/MVC/views/school/timesheet/timesheetManage.ejs');
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');

  assert.match(controller, /timesheetPayRateService\.resolveHourlyRate/);
  assert.match(controller, /timesheetPayrollContextService\.resolvePayrollPersonContext/);
  assert.match(controller, /payRateLabel: resolvedRate \? timesheetPayRateService\.formatHourlyRateLabel\(resolvedRate\.hourlyRate\) : 'N\/D'/);
  assert.match(controller, /grossPayLabel/);
  assert.match(controller, /roleTotals/);
  assert.doesNotMatch(controller, /function resolvePayRateForDepartment/);

  assert.match(view, /<th>Role<\/th>/);
  assert.match(view, /<th>Account<\/th>/);
  assert.match(view, /<th class="text-end">Gross Pay<\/th>/);
  assert.match(view, /row\.payRateLabel \|\| 'N\/D'/);
  assert.match(view, /payload\.roleTotals/);
  assert.match(view, /payload\.payrollWarnings/);
});

test('timesheet management department summary includes shared hours-by-department totals', () => {
  const view = read('packages/school/MVC/views/school/timesheet/timesheetManage.ejs');
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');
  const renderer = read('packages/school/public/scripts/timesheetDepartmentHoursView.js');
  const masterHub = read('packages/school/MVC/views/school/masterAcademiaHub.ejs');
  const reportHub = read('packages/school/MVC/views/school/reportHub.ejs');

  assert.match(controller, /timesheetPrintService\.buildDepartmentTotalsFromEffective\(effective\)/);
  assert.match(controller, /departmentTotals/);

  assert.match(view, /timesheetDepartmentHoursView\.js/);
  assert.match(view, /TimesheetDepartmentHoursView\.renderTable\(payload\.departmentTotals\)/);
  assert.match(view, /\$\{departmentHoursHtml\}/);

  assert.match(renderer, /global\.TimesheetDepartmentHoursView/);
  assert.match(renderer, />Group Hours</);
  assert.match(renderer, />One-on-One Optional</);

  assert.match(masterHub, /timesheetDepartmentHoursView\.js/);
  assert.match(masterHub, /TimesheetDepartmentHoursView\.renderTable\(payload\.departmentTotals\)/);
  assert.match(reportHub, /timesheetDepartmentHoursView\.js/);
  assert.match(reportHub, /TimesheetDepartmentHoursView\.renderTable\(payload\.departmentTotals\)/);
});

test('timesheet department hours view renders split rows and totals footer', () => {
  const renderer = read('packages/school/public/scripts/timesheetDepartmentHoursView.js');
  const renderTable = new Function(`${renderer}; return TimesheetDepartmentHoursView.renderTable;`)();
  const html = renderTable({
    rows: [{
      departmentName: 'LINC',
      groupHours: 10,
      oneOnOneHours: 5,
      oneOnOneOptionalHours: 1.5,
      groupPendingHours: 0,
      oneOnOnePendingHours: 2,
      totalHours: 17
    }],
    totals: {
      groupHours: 10,
      oneOnOneHours: 5,
      oneOnOneOptionalHours: 1.5,
      groupPendingHours: 0,
      oneOnOnePendingHours: 2,
      totalHours: 17
    }
  });

  assert.match(html, /Hours by Department/);
  assert.match(html, /LINC/);
  assert.match(html, />10\.00</);
  assert.match(html, />5\.00</);
  assert.match(html, />1\.50</);
  assert.match(html, />2\.00</);
  assert.match(html, />17\.00</);
});

test('master academia hub timesheet summary mirrors role-aware pay display', () => {
  const view = read('packages/school/MVC/views/school/masterAcademiaHub.ejs');

  assert.match(view, /function renderHubTimesheetManagementSummary\(payload\)/);
  assert.match(view, /hubTimesheetManagementSummaryModal/);
  assert.match(view, /modal-dialog modal-xl modal-dialog-scrollable/);
  assert.match(view, /<th class="ps-3">Role<\/th>/);
  assert.match(view, /<th>Account<\/th>/);
  assert.match(view, /<th class="pe-3">Gross Pay<\/th>/);
  assert.match(view, /row\.payRateLabel \|\| 'N\/D'/);
  assert.match(view, /row\.grossPayLabel/);
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
  assert.match(controller, /if \(!requestedTimesheetStatus\) return true/);
  assert.match(controller, /requestedTimesheetStatus === 'approved'/);
  assert.match(controller, /return row\.status === requestedTimesheetStatus/);

  assert.match(manageView, /id="timesheetStatusFilter"/);
  assert.match(manageView, /rosterParams\.set\('timesheetStatus', requestedStatus\)/);
  assert.match(manageView, /timesheetStatusFilter\?\.addEventListener\('change'/);

  assert.match(hubView, /id="hubTimesheetManagementStatusFilter"/);
  assert.match(hubView, /rosterParams\.set\('timesheetStatus', requestedStatus\)/);
  assert.match(hubView, /const statusFilter = document\.getElementById\('hubTimesheetManagementStatusFilter'\)/);
});

test('timesheet management roster uses three-dot row actions menu with print and late submission options', () => {
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');
  const manageView = read('packages/school/MVC/views/school/timesheet/timesheetManage.ejs');

  assert.match(controller, /canAllowLateSubmission/);
  assert.match(controller, /allowLateSubmission,/);
  assert.match(controller, /canOpenLateSubmission,/);
  assert.match(controller, /isSubmissionDeadlinePassed/);

  assert.match(manageView, /CAN_ALLOW_LATE_SUBMISSION/);
  assert.match(manageView, /btn-row-actions-toggle/);
  assert.match(manageView, /data-floating-row-actions="true"/);
  assert.match(manageView, /row-actions-menu/);
  assert.match(manageView, /renderActionMenu/);
  assert.match(manageView, /Open Timesheet submission/);
  assert.match(manageView, /data-print-person/);
  assert.match(manageView, /openLateSubmission/);
  assert.match(manageView, /openRowPrintPreview/);
  assert.match(manageView, /handleTimesheetManageRowActionClick/);
  assert.match(manageView, /isTimesheetManageRowActionTarget/);
  assert.match(manageView, /void loadRoster\(\)/);
  assert.doesNotMatch(manageView, /btn-group btn-group-sm/);
});

test('timesheet management exposes legacy import apply/delete wiring when enabled', () => {
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');
  const routes = read('packages/school/MVC/routes/timesheetRoutes.js');
  const manageView = read('packages/school/MVC/views/school/timesheet/timesheetManage.ejs');
  const listView = read('packages/school/MVC/views/school/timesheet/timesheetList.ejs');

  assert.match(controller, /canImportTimesheets/);
  assert.match(controller, /hasLegacyImport/);
  assert.match(controller, /applyTimesheetLegacyImports/);
  assert.match(controller, /deleteTimesheetLegacyImport/);
  assert.match(routes, /\/manage\/api\/import\/apply/);
  assert.match(routes, /\/manage\/api\/import\/legacy/);
  assert.match(routes, /\/api\/import\/compile/);
  assert.match(routes, /\/api\/import\/apply/);

  assert.match(manageView, /CAN_IMPORT_TIMESHEETS/);
  assert.match(manageView, /Delete imported file/);
  assert.match(manageView, /btnConfirmTimesheetImport/);
  assert.match(manageView, /applyLegacyImport/);
  assert.match(manageView, /deleteLegacyImport/);
  assert.match(manageView, /actionStateId/);
  assert.match(manageView, /applyActionStateFromResult/);
  assert.match(manageView, /hideBootstrapModalAndWait/);
  assert.match(manageView, /showImportApplySuccessMessage/);
  assert.match(manageView, /text: 'Open Timesheet'/);

  assert.match(listView, /canImportMyTimesheets/);
  assert.match(listView, /data-my-import-period/);
  assert.match(listView, /data-my-delete-import-period/);
  assert.match(manageView, /async function uiConfirm/);
  assert.match(listView, /async function uiConfirm/);
  assert.match(listView, /beginImportApplyLoading/);
  assert.match(listView, /showImportApplySuccessMessage/);
  assert.match(listView, /text: 'Open Timesheet'/);
  assert.doesNotMatch(listView, /ensureModalOnBody\(myImportReviewModalEl\)\?\.hide\(\);\s*\n\s*window\.location\.reload\(\)/);

  assert.match(controller, /buildTimesheetEditorLinks/);
  assert.match(controller, /editorLinks: buildTimesheetEditorLinks\(personId, outcome\.applied\)/);
});
