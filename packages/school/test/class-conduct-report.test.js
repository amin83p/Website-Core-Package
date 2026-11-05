'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('classConductReportRoutes mounts under school main routes', () => {
  const src = read('packages/school/MVC/routes/schoolMainRoute.js');
  assert.match(src, /class-conduct-report/);
  assert.match(src, /classConductReportRoutes/);
});

test('classConductReportRoutes uses SCHOOL_CLASS_CONDUCT_REPORT access', () => {
  const src = read('packages/school/MVC/routes/classConductReportRoutes.js');
  assert.match(src, /SECTIONS\.SCHOOL_CLASS_CONDUCT_REPORT/);
  assert.match(src, /OPERATIONS\.READ/);
  assert.doesNotMatch(src, /OPERATIONS\.EXPORT/);
  assert.doesNotMatch(src, /\/api\/export/);
});

test('access constants expose SCHOOL_CLASS_CONDUCT_REPORT', () => {
  const { SCHOOL_SECTIONS } = require('../config/accessConstants');
  assert.equal(SCHOOL_SECTIONS.SCHOOL_CLASS_CONDUCT_REPORT, 'SCHOOL_CLASS_CONDUCT_REPORT');
});

test('manifest lists Class Conduct Report under School Reports', () => {
  const manifest = read('packages/school/package.manifest.json');
  assert.match(manifest, /"name": "SCHOOL_CLASS_CONDUCT_REPORT"/);
  assert.match(manifest, /"homeURL": "\/school\/class-conduct-report"/);
  assert.match(manifest, /"id": "778773"/);
  const reportsBlock = manifest.match(/"name": "SCHOOL_REPORTS"[\s\S]*?"subsections": \[([\s\S]*?)\]/);
  assert.ok(reportsBlock, 'SCHOOL_REPORTS subsections');
  assert.match(reportsBlock[1], /778773/);
});

test('classConductReportService exports buildClassConductReportPayload', () => {
  const service = require('../MVC/services/school/classConductReportService');
  assert.equal(typeof service.buildClassConductReportPayload, 'function');
  assert.equal(typeof service.buildClassConductDayCells, 'function');
});

test('buildClassConductDayCells uses first shown session per day', () => {
  const service = require('../MVC/services/school/classConductReportService');
  const sessions = [
    { sessionId: 's1', date: '2026-03-01', conductRequiredForReports: true },
    { sessionId: 's2', date: '2026-03-01', conductReportStepEnabled: true },
    { sessionId: 's3', date: '2026-03-02', conductReportStepEnabled: true }
  ];
  const cells = {
    p1: {
      s1: { onRoster: true, value: { summary: 'S/S/S/S', labels: {}, percents: {} } },
      s2: { onRoster: true, value: { summary: 'U/U/U/U', labels: {}, percents: {} } }
    }
  };
  const days = service.buildClassConductDayCells(['2026-03-01', '2026-03-02'], sessions, 'p1', cells);
  assert.equal(days.length, 2);
  assert.equal(days[0].sessionId, 's1');
  assert.match(days[0].multiSessionHint, /2 sessions/);
  assert.equal(days[1].sessionId, 's3');
});

test('class conduct report view and client exist', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'packages/school/MVC/views/school/report/classConductReport.ejs')));
  assert.ok(fs.existsSync(path.join(ROOT, 'packages/school/public/scripts/classConductReportClient.js')));
  const view = read('packages/school/MVC/views/school/report/classConductReport.ejs');
  assert.match(view, /btn_export: false/);
  assert.doesNotMatch(view, /btn_exportSar|Export attendance|Report By Funder/i);
});

test('class conduct report quick ranges use chip row; conduct matrix uses schedule date menu', () => {
  const matrixView = read('packages/school/MVC/views/school/report/conductMatrix.ejs');
  const reportView = read('packages/school/MVC/views/school/report/classConductReport.ejs');
  const client = read('packages/school/public/scripts/classConductReportClient.js');
  const matrixClient = read('packages/school/public/scripts/conductMatrixClient.js');
  assert.doesNotMatch(matrixView, /Quick Ranges/);
  assert.match(matrixView, /cmDateRangeMenu/);
  assert.match(matrixView, /schoolDateRangeShortcuts\.js/);
  assert.match(matrixClient, /SchoolDateRangeShortcuts/);
  assert.match(matrixClient, /applyConductRangeSelection/);
  assert.match(matrixClient, /m0-full/);
  ['lastMonthFirstHalf', 'lastMonthSecondHalf', 'data-range="allTime"'].forEach((token) => {
    assert.match(reportView, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
  assert.match(reportView, /Quick Ranges/);
  assert.match(client, /lastMonthFirstHalf/);
  assert.match(client, /allTime/);
});

test('class conduct report student filter matches attendance report structure', () => {
  const sarView = read('packages/school/MVC/views/school/attendance/studentAttendanceReportViewer.ejs');
  const reportView = read('packages/school/MVC/views/school/report/classConductReport.ejs');
  const client = read('packages/school/public/scripts/classConductReportClient.js');
  assert.match(sarView, /Browse Classes/);
  assert.match(reportView, /ccr_btnBrowseClasses/);
  assert.match(reportView, /Browse Classes/);
  assert.match(reportView, /ccr_selectedStudentsList/);
  assert.match(reportView, /Order sets report precedence/);
  assert.match(reportView, /modal_SchoolEntityPicker/);
  assert.match(reportView, /ccr_btnExpandAllStudents/);
  assert.match(client, /openHierarchicalStudentPicker/);
  assert.match(client, /data-remove-student-index/);
  assert.match(client, /data-move-student-up/);
});

test('school report section header omits School Dashboard button', () => {
  const { attachReportSectionNavLocals } = require('../MVC/services/school/reportSectionNavLocals');
  const res = { locals: {} };
  attachReportSectionNavLocals(res);
  const headerHtml = res.locals.reportListHeaderManageBtns.join('\n');
  assert.doesNotMatch(headerHtml, /School Dashboard/);
  assert.match(headerHtml, /School Reports/);
  const ccrView = read('packages/school/MVC/views/school/report/classConductReport.ejs');
  assert.match(ccrView, /reportMessageHelpers/);
  const sarView = read('packages/school/MVC/views/school/attendance/studentAttendanceReportViewer.ejs');
  const smmrView = read('packages/school/MVC/views/school/report/semiMonthlyReportViewer.ejs');
  [ccrView, sarView, smmrView].forEach((view) => {
    assert.doesNotMatch(view, /bi-speedometer2 me-1"><\/i> School Dashboard/);
    assert.match(view, /School Reports/);
    assert.match(view, /report-filter-main-row/);
    assert.match(view, /report-filter-actions/);
    assert.match(view, /report-filter-control/);
    assert.match(view, /report-filter-field-date/);
  });
});

test('class conduct report print button and preview helpers', () => {
  const view = read('packages/school/MVC/views/school/report/classConductReport.ejs');
  const client = read('packages/school/public/scripts/classConductReportClient.js');
  const controller = read('packages/school/MVC/controllers/school/classConductReportController.js');
  assert.match(view, /optionalBtnsBeforePrint/);
  assert.match(view, /btn_printClassConductReport/);
  assert.match(client, /function buildClassConductPrintDocument/);
  assert.match(client, /function openClassConductPrint/);
  assert.match(client, /function setClassConductPrintEnabled/);
  assert.match(client, /class-conduct-report/);
  assert.match(client, /promptLoadReportFromUrlLink/);
  assert.match(client, /ccrOpenedFromUrlQuery/);
  assert.doesNotMatch(client, /if \(INITIAL\.startDate && INITIAL\.endDate\) void loadReport\(\)/);
  assert.match(controller, /includePrintManager:\s*true/);
});
