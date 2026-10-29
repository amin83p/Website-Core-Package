const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const schoolSemiMonthlyReportService = require('../packages/school/MVC/services/school/schoolSemiMonthlyReportService');
const { listSchoolSettingsGroups } = require('../packages/school/MVC/config/schoolSettingsCatalog');

test('filterReportInstancesForClass matches template, date, class, and student', () => {
  const templateIdSet = schoolSemiMonthlyReportService.buildTemplateIdSet(['TPL-1']);
  const instances = [
    {
      id: 'INS-1',
      classId: 'CLS-1',
      templateId: 'TPL-1',
      sessionDate: '2026-01-10',
      studentId: 'STU-1',
      status: 'submitted'
    },
    {
      id: 'INS-2',
      classId: 'CLS-1',
      templateId: 'TPL-2',
      sessionDate: '2026-01-10',
      studentId: 'STU-1',
      status: 'draft'
    },
    {
      id: 'INS-3',
      classId: 'CLS-1',
      templateId: 'TPL-1',
      sessionDate: '2026-02-01',
      studentId: 'STU-1',
      status: 'draft'
    },
    {
      id: 'INS-4',
      classId: 'CLS-1',
      templateId: 'TPL-1',
      sessionDate: '2026-01-12',
      studentId: '',
      status: 'draft'
    }
  ];
  const matched = schoolSemiMonthlyReportService.filterReportInstancesForClass({
    instances,
    templateIdSet,
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    classId: 'CLS-1',
    studentRecordId: 'STU-1',
    personId: 'STU-1'
  });
  assert.deepEqual(matched.map((row) => row.id).sort(), ['INS-1', 'INS-4']);
});

test('instanceMatchesStudent allows class-level instances without studentId', () => {
  assert.equal(schoolSemiMonthlyReportService.instanceMatchesStudent({ studentId: '' }, 'STU-9'), true);
  assert.equal(schoolSemiMonthlyReportService.instanceMatchesStudent({ studentId: 'STU-9' }, 'STU-9'), true);
  assert.equal(schoolSemiMonthlyReportService.instanceMatchesStudent({ studentId: 'STU-1' }, 'STU-9'), false);
});

test('instanceMatchesStudent matches person id on instance studentId', () => {
  assert.equal(
    schoolSemiMonthlyReportService.instanceMatchesStudent({ studentId: '663857' }, 'STU28435', '663857'),
    true
  );
  assert.equal(
    schoolSemiMonthlyReportService.instanceMatchesStudent({
      studentId: '995578',
      prefillSnapshot: { student_record_id: 'STU16893' }
    }, 'STU16893'),
    true
  );
});

test('semi-monthly report header shortcut targets reports dashboard', () => {
  const view = fs.readFileSync(
    path.join(__dirname, '../packages/school/MVC/views/school/report/semiMonthlyReportViewer.ejs'),
    'utf8'
  );
  assert.match(view, /school-navigator-reports-dashboard/);
  assert.match(view, /\/dashboard\/section-nav\/SCHOOL_REPORTS/);
  assert.doesNotMatch(view, /SCHOOL_ACADEMIA/);
  assert.match(view, /aria-keyshortcuts="Alt\+Shift\+R"/);
});

test('semi-monthly report toolbar second row links Report By Funder and settings only', () => {
  const view = fs.readFileSync(
    path.join(__dirname, '../packages/school/MVC/views/school/report/semiMonthlyReportViewer.ejs'),
    'utf8'
  );
  const manageBlock = view.slice(view.indexOf('const manageBtns = ['), view.indexOf('];', view.indexOf('const manageBtns = [')) + 2);
  assert.match(manageBlock, /Report By Funder/);
  assert.match(manageBlock, /btn btn-outline-primary btn-md mb-2/);
  assert.match(manageBlock, /id="btn_openReportByFunderModal"/);
  assert.doesNotMatch(manageBlock, /\/school\/reports\/semi-monthly\/by-funder/);
  assert.doesNotMatch(manageBlock, /Report Instances/);
  assert.doesNotMatch(manageBlock, /School Reports/);
});

test('semi-monthly report viewer includes Report By Funder modal and API', () => {
  const view = fs.readFileSync(
    path.join(__dirname, '../packages/school/MVC/views/school/report/semiMonthlyReportViewer.ejs'),
    'utf8'
  );
  const modalPartial = fs.readFileSync(
    path.join(__dirname, '../packages/school/MVC/views/school/report/partials/reportByFunderModal.ejs'),
    'utf8'
  );
  const modalJs = fs.readFileSync(
    path.join(__dirname, '../packages/school/public/scripts/reportByFunderModal.js'),
    'utf8'
  );
  assert.match(view, /reportByFunderModal/);
  assert.match(view, /reportByFunderModal\.js/);
  assert.match(view, /apiUrl: '\/school\/reports\/semi-monthly\/api\/funder-students'/);
  assert.match(modalPartial, /id="reportByFunderModal"/);
  assert.match(modalPartial, /report-by-funder-range-chip/);
  assert.match(modalPartial, /js-report-by-funder-sort/);
  assert.match(modalJs, /defaultOpenDateRange/);
  assert.match(modalJs, /report-by-funder-modal-dialog--expanded/);
  assert.match(modalJs, /ctx\?\.apiUrl/);
});

test('Report By Funder modal date range helpers use calendar half-months', () => {
  const vm = require('node:vm');
  const modalJs = fs.readFileSync(
    path.join(__dirname, '../packages/school/public/scripts/reportByFunderModal.js'),
    'utf8'
  );
  const sandbox = { window: {}, bootstrap: { Modal: { getOrCreateInstance: () => ({ show() {}, hide() {} }) } } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(modalJs, sandbox);
  const api = sandbox.ReportByFunderModal.dateRangeApi;
  const ref = new Date(2026, 9, 29);
  const fullMonth = api.defaultOpenDateRange(ref);
  assert.equal(fullMonth.start, '2026-10-01');
  assert.equal(fullMonth.end, '2026-10-31');
  const curFirst = api.resolveRangeChip('currentMonthFirstHalf', ref);
  assert.equal(curFirst.start, '2026-10-01');
  assert.equal(curFirst.end, '2026-10-15');
  const curSecond = api.resolveRangeChip('currentMonthSecondHalf', ref);
  assert.equal(curSecond.start, '2026-10-16');
  assert.equal(curSecond.end, '2026-10-31');
  const lastFirst = api.resolveRangeChip('lastMonthFirstHalf', ref);
  assert.equal(lastFirst.start, '2026-09-01');
  assert.equal(lastFirst.end, '2026-09-15');
  const lastSecond = api.resolveRangeChip('lastMonthSecondHalf', ref);
  assert.equal(lastSecond.start, '2026-09-16');
  assert.equal(lastSecond.end, '2026-09-30');
});

test('semi-monthly report viewer wires picker and data API', () => {
  const view = fs.readFileSync(
    path.join(__dirname, '../packages/school/MVC/views/school/report/semiMonthlyReportViewer.ejs'),
    'utf8'
  );
  assert.match(view, /id="btn_openStudentPicker"/);
  assert.match(view, /id="btn_openSchoolStudentPicker"/);
  assert.match(view, /\/school\/reports\/semi-monthly\/api\/data/);
  assert.match(view, /student-report-table/);
  assert.match(view, /matrix-sticky-class/);
  assert.match(view, /sar-matrix-link/);
  assert.match(view, /include\('partials\/modal_GenericPicker'\)/);
  assert.match(view, /include\('school\/partials\/modal_SchoolEntityPicker'\)/);
  assert.match(view, /id="btn_exportSmmr"/);
  assert.match(view, /id="smmrExportModal"/);
  assert.match(view, /\/school\/reports\/semi-monthly\/api\/report-plan/);
});

test('semi-monthly export routes are registered', () => {
  const routes = fs.readFileSync(
    path.join(__dirname, '../packages/school/MVC/routes/reportRoutes.js'),
    'utf8'
  );
  assert.match(routes, /\/semi-monthly\/api\/report-plan/);
  assert.match(routes, /\/semi-monthly\/api\/data-async/);
  assert.match(routes, /\/semi-monthly\/api\/report-jobs\/:jobId/);
  assert.match(routes, /\/semi-monthly\/api\/export/);
  assert.match(routes, /\/semi-monthly\/api\/funder-students/);
  assert.match(routes, /semiMonthlyCtrl\.getExportPlan/);
  assert.match(routes, /semiMonthlyCtrl\.startSemiMonthlyReportDataJob/);
  assert.match(routes, /semiMonthlyCtrl\.getSemiMonthlyReportJob/);
  assert.match(routes, /semiMonthlyCtrl\.getFunderStudentSelection/);
  assert.match(routes, /semiMonthlyCtrl\.exportSelections/);
});

test('semi-monthly viewer wires shared-link prompt and report load progress', () => {
  const view = fs.readFileSync(
    path.join(__dirname, '../packages/school/MVC/views/school/report/semiMonthlyReportViewer.ejs'),
    'utf8'
  );
  assert.match(view, /promptLoadReportFromUrlLink/);
  assert.match(view, /runWhenReportMessageModalReady/);
  assert.match(view, /\/semi-monthly\/api\/data-async/);
  assert.match(view, /\/semi-monthly\/api\/report-jobs\//);
  assert.match(view, /showSmmrReportWaiting/);
  assert.match(view, /SMMR_REPORT_ASYNC_MIN_STUDENTS/);
  assert.match(view, /buildSmmrSharedLinkConfirmHtml/);
});

test('school settings semi-monthly panel includes overall templates and export toggles', () => {
  const settings = fs.readFileSync(
    path.join(__dirname, '../packages/school/MVC/views/school/settings/index.ejs'),
    'utf8'
  );
  assert.match(settings, /id="smmrOverallTemplatesTable"/);
  assert.match(settings, /js-smmr-report-export-docx/);
  assert.match(settings, /js-smmr-overall-export-docx/);
  assert.match(settings, /initializeSmmrOverallTemplates/);
});

test('school settings catalog includes semi-monthly report group', () => {
  const groups = listSchoolSettingsGroups();
  assert.ok(groups.some((row) => row.key === 'school-semi-monthly-report'));
});
