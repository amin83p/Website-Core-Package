'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ejs = require('ejs');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('named custom print pages use the shared print manager', () => {
  const grades = read('packages/school/MVC/views/school/grades/gradesMatrix.ejs');
  const attendance = read('packages/school/MVC/views/school/attendance/attendanceViewer.ejs');
  const timesheetManage = read('packages/school/MVC/views/school/timesheet/timesheetManage.ejs');
  const timesheetEditor = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  const gradesController = read('packages/school/MVC/controllers/school/gradesMatrixController.js');
  const attendanceController = read('packages/school/MVC/controllers/school/attendanceController.js');
  const timesheetController = read('packages/school/MVC/controllers/school/timesheetController.js');

  [grades, attendance].forEach((source) => {
    assert.match(source, /AppPrintManager\.openSettings/);
    assert.match(source, /AppPrintManager\.openHtmlPreview/);
    assert.match(source, /AppPrintManager\.buildPreviewControlsHtml/);
    assert.match(source, /PrintDocumentBuilder\.buildPageCss/);
    assert.match(source, /print-logo/);
    assert.match(source, /id="print-page-orientation-css"/);
    assert.match(source, /mode:\s*'(grades-matrix|attendance-matrix)'/);
    assert.doesNotMatch(source, /size:\s*letter/i);
  });

  assert.match(timesheetManage, /AppPrintManager\.openSettings/);
  assert.match(timesheetManage, /appendSettingsToSearchParams/);
  assert.match(timesheetEditor, /AppPrintManager\.openSettings/);
  assert.match(timesheetEditor, /appendSettingsToSearchParams/);
  assert.match(gradesController, /includePrintManager:\s*true/);
  assert.match(attendanceController, /includePrintManager:\s*true/);
  assert.match(timesheetController, /includePrintManager:\s*true/);
});

test('edited print-capable EJS views compile', () => {
  [
    'MVC/views/partials/printSettingsModal.ejs',
    'packages/school/MVC/views/school/grades/gradesMatrix.ejs',
    'packages/school/MVC/views/school/attendance/attendanceViewer.ejs',
    'packages/school/MVC/views/school/timesheet/timesheetManage.ejs',
    'packages/school/MVC/views/school/timesheet/timesheetEditor.ejs',
    'packages/school/MVC/views/school/timesheet/timesheetPrint.ejs'
  ].forEach((relativePath) => {
    const filename = path.join(ROOT_DIR, relativePath);
    assert.doesNotThrow(() => ejs.compile(read(relativePath), { filename }));
  });
});

test('timesheet print settings are normalized and passed to the print view', () => {
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');
  const view = read('packages/school/MVC/views/school/timesheet/timesheetPrint.ejs');

  assert.match(controller, /function parseTimesheetPrintSettings/);
  assert.match(controller, /printSettings:\s*parseTimesheetPrintSettings\(req\.body\)/);
  assert.match(controller, /printSettings,/);
  assert.match(view, /rawPrintSettings/);
  assert.match(view, /String\(rawPrintSettings\.orientation \|\| ''\)[\s\S]*?=== 'landscape'[\s\S]*?\? 'landscape'[\s\S]*?: 'portrait'/);
  assert.match(view, /data-print-orientation/);
  assert.match(view, /data-print-orientation="landscape"/);
  assert.match(view, /data-print-orientation="portrait"/);
  assert.match(view, /print-sheet-frame/);
  assert.match(view, /print-sheet-bottom/);
  assert.match(view, /fitPrintSheetsToPage/);
  assert.match(view, /body\[data-print-orientation="portrait"\] \.print-sheet-frame/);
  assert.match(view, /var layoutWidth = bounds\.width \/ Math\.max\(scale, 0\.01\);/);
  assert.doesNotMatch(view, /readableScaleFloor/);
  assert.match(view, /session-class-time-line/);
  assert.match(view, /entry\.department\?\.code \|\| entry\.primaryLabel/);
  assert.match(view, /row\.departmentCode \|\| row\.departmentName/);
  assert.match(view, /sheet\.style\.transform = 'scale\(' \+ scale\.toFixed\(4\) \+ '\)'/);
  assert.match(view, /printHeaderNote/);
  assert.match(view, /applyPrintOrientation/);
  assert.doesNotMatch(view, /size:\s*letter/i);
});

test('remaining direct browser print buttons are marked as native content prints', () => {
  const article = read('MVC/views/news/article.ejs');
  const coverage = read('packages/school/MVC/views/school/teachingOutline/studentCoverage.ejs');
  const packageView = read('packages/benchpath/MVC/views/benchpath/task/taskPackageView.ejs');

  assert.match(article, /data-print-native="article"/);
  assert.match(coverage, /data-print-native="content-report"/);
  assert.match(packageView, /data-print-native="document-package"/);
});
