const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');

const ROOT_DIR = path.resolve(__dirname, '..');
const attendanceExcelExportService = require('../MVC/services/school/attendanceExcelExportService');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function sampleClassPayload(className, sessionDate) {
  return {
    className,
    teacherName: 'Teacher One',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    enabledAttendanceStatuses: ['present', 'absent', 'not_applicable'],
    sessions: [{ id: 's1', date: sessionDate }],
    matrix: [{
      firstName: 'Ada',
      lastName: 'Lovelace',
      records: [{ sessionId: 's1', date: sessionDate, status: 'present' }],
      summary: { performancePercent: 100 }
    }]
  };
}

test('sanitizeExcelSheetName enforces length and uniqueness', () => {
  const used = new Set();
  const first = attendanceExcelExportService.sanitizeExcelSheetName('Morning EAL Class A', used);
  const second = attendanceExcelExportService.sanitizeExcelSheetName('Morning EAL Class A', used);
  assert.ok(first.length <= 31);
  assert.notEqual(first, second);
  assert.match(second, /_2$/);
});

test('buildStudentAttendanceExcelWorkbook creates one sheet per class', async () => {
  const { buffer, filename } = await attendanceExcelExportService.buildStudentAttendanceExcelWorkbook([
    { payload: sampleClassPayload('Alpha Class', '2026-09-08'), sheetName: 'Alpha Class' },
    { payload: sampleClassPayload('Beta Class', '2026-09-09'), sheetName: 'Beta Class' }
  ], {
    studentName: 'Ada Lovelace',
    startDate: '2026-09-01',
    endDate: '2026-09-30'
  });

  assert.match(filename, /Attendance_Ada_Lovelace_/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.equal(workbook.worksheets.length, 2);
  assert.equal(workbook.getWorksheet(1).name, 'Alpha Class');
  assert.equal(workbook.getWorksheet(2).name, 'Beta Class');
});

function collectWorksheetText(worksheet) {
  const parts = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cell.value != null && cell.value !== '') parts.push(String(cell.value));
    });
  });
  return parts.join('\n');
}

test('buildStudentAttendanceExcelWorkbook singleSheet stacks all classes on one worksheet', async () => {
  const { buffer } = await attendanceExcelExportService.buildStudentAttendanceExcelWorkbook([
    { payload: sampleClassPayload('Alpha Class', '2026-09-08'), sheetName: 'Alpha Class' },
    { payload: sampleClassPayload('Beta Class', '2026-09-09'), sheetName: 'Beta Class' }
  ], {
    studentName: 'Ada Lovelace',
    startDate: '2026-09-01',
    endDate: '2026-09-30'
  }, {
    sheetLayout: 'singleSheet'
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.equal(workbook.worksheets.length, 1);
  const text = collectWorksheetText(workbook.getWorksheet(1));
  assert.match(text, /Class: Alpha Class/);
  assert.match(text, /Class: Beta Class/);
});

test('normalizeStudentExcelSheetLayout accepts singleSheet alias', () => {
  assert.equal(
    attendanceExcelExportService.normalizeStudentExcelSheetLayout('singleSheet'),
    attendanceExcelExportService.STUDENT_EXCEL_SHEET_LAYOUT_SINGLE
  );
  assert.equal(
    attendanceExcelExportService.normalizeStudentExcelSheetLayout(''),
    attendanceExcelExportService.STUDENT_EXCEL_SHEET_LAYOUT_PER_CLASS
  );
});

test('attendance routes expose student report export-excel.xlsx', () => {
  const routes = read('MVC/routes/attendanceRoutes.js');
  assert.match(routes, /\/report\/api\/export-excel\.xlsx/);
  assert.match(routes, /exportStudentAttendanceReportExcel/);
  assert.match(
    routes,
    /\/report\/api\/export-excel\.xlsx[\s\S]*?requireAccess\(SECTIONS\.SCHOOL_ATTENDANCE_REPORT,\s*OPERATIONS\.READ\)/
  );
});

test('student attendance report viewer wires per-student matrix Excel export', () => {
  const viewer = read('MVC/views/school/attendance/studentAttendanceReportViewer.ejs');
  const controller = read('MVC/controllers/school/attendanceController.js');
  const exportService = read('MVC/services/school/studentAttendanceReportExcelExportService.js');
  assert.match(viewer, /js-sar-student-excel-export/);
  assert.match(viewer, /btn-filled btn-success/);
  assert.match(viewer, /bi-cloud-download/);
  assert.match(viewer, /exportStudentAttendanceExcel/);
  assert.match(viewer, /openSarExcelExportModal/);
  assert.match(viewer, /sarExcelExportModal/);
  assert.match(viewer, /sheetLayout/);
  assert.match(viewer, /\/school\/attendances\/report\/api\/export-excel\.xlsx/);
  assert.match(viewer, /canExportStudentMatrixExcel/);
  assert.match(controller, /sheetLayout/);
  assert.match(exportService, /sheetLayout/);
});
