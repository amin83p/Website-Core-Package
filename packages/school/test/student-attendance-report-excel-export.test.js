const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');

const ROOT_DIR = path.resolve(__dirname, '..');
const attendanceExcelExportService = require('../MVC/services/school/attendanceExcelExportService');
const studentAttendanceReportService = require('../MVC/services/school/studentAttendanceReportService');

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

test('buildUnionSessionDatesFromExportEntries dedupes and sorts session dates', () => {
  const dates = studentAttendanceReportService.buildUnionSessionDatesFromExportEntries([
    { payload: { sessions: [{ date: '2026-09-09' }, { date: '2026-09-08' }] } },
    { payload: { sessions: [{ date: '2026-09-08' }] } }
  ]);
  assert.deepEqual(dates, ['2026-09-08', '2026-09-09']);
});

test('formatClaimNumbersDisplay joins number and label', () => {
  assert.equal(
    studentAttendanceReportService.formatClaimNumbersDisplay([{ number: '791 8022', label: 'WCB' }]),
    '791 8022 WCB'
  );
  assert.equal(
    studentAttendanceReportService.formatClaimNumbersDisplay([
      { number: 'WCB-2', label: '' },
      { number: 'WCB-1', label: 'Primary' }
    ]),
    'WCB-1 Primary, WCB-2'
  );
});

test('resolveClaimNumbersForEnrollmentPeriods collects distinct overlapping claims', () => {
  const numbers = studentAttendanceReportService.resolveClaimNumbersForEnrollmentPeriods({
    periodRows: [
      {
        studentId: 'stu-1',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        claimNumber: 'WCB-100'
      },
      {
        studentId: 'stu-1',
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        claimSelectToken: 'WCB-200'
      }
    ],
    studentToPersonMap: new Map(),
    personId: 'stu-1',
    windowStart: '2026-09-01',
    windowEnd: '2026-10-31'
  });
  assert.deepEqual(numbers, ['WCB-100', 'WCB-200']);
});

test('resolveOfficialClassBufferColumnWidth sizes column D from class names only', () => {
  const shortWidth = attendanceExcelExportService.resolveOfficialClassBufferColumnWidth([
    { className: 'AM PM', teacherName: '' }
  ]);
  const longWidth = attendanceExcelExportService.resolveOfficialClassBufferColumnWidth([
    { className: 'AM Low Intermediate Conversation Class', teacherName: '' }
  ]);
  assert.ok(longWidth > shortWidth);
  assert.ok(shortWidth >= 2);
});

test('formatOfficialExportClassName strips template tokens and teacher name', () => {
  assert.equal(
    attendanceExcelExportService.formatOfficialExportClassName('EAL-PM-I/G-JANE', 'Jane Doe'),
    'PM'
  );
  assert.equal(
    attendanceExcelExportService.formatOfficialExportClassName('EAL-AM-O/1-SAM', 'Sam'),
    'AM'
  );
});

test('buildOfficialStudentAttendanceExcelWorkbook uses class rows and union day columns', async () => {
  const exportModel = {
    student: { name: 'Ada Lovelace', email: 'ada@example.com' },
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    claimNumbersDisplay: '791 8022 WCB',
    enabledAttendanceStatuses: ['present', 'absent', 'not_applicable'],
    unionSessionDates: ['2026-09-08', '2026-09-09'],
    classRows: [
      {
        className: 'Alpha Class',
        studentRow: { funderType: 'wcb' },
        sessionDateSet: new Set(['2026-09-08', '2026-09-09']),
        recordsByDate: new Map([
          ['2026-09-08', { status: 'present', sessionId: 's1' }],
          ['2026-09-09', { status: 'absent', sessionId: 's2' }]
        ])
      },
      {
        className: 'Beta Class',
        studentRow: { funderType: 'ircc' },
        sessionDateSet: new Set(['2026-09-08']),
        recordsByDate: new Map([
          ['2026-09-08', { status: 'present', sessionId: 's3' }]
        ])
      }
    ]
  };

  const { buffer } = await attendanceExcelExportService.buildOfficialStudentAttendanceExcelWorkbook(exportModel, {
    studentName: 'Ada Lovelace',
    startDate: '2026-09-01',
    endDate: '2026-09-30'
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.equal(workbook.worksheets.length, 1);
  const sheet = workbook.getWorksheet(1);
  const text = collectWorksheetText(sheet);
  assert.match(text, /Student: Ada Lovelace/);
  assert.match(text, /Claim Number: 791 8022 WCB/);
  assert.match(text, /Alpha Class/);
  assert.match(text, /Beta Class/);
  assert.doesNotMatch(text, /Comment/);
  assert.doesNotMatch(text, /CLBs/);
  assert.doesNotMatch(text, /Att %/);
  assert.doesNotMatch(text, /Funder/);
  assert.doesNotMatch(text, /Last Name/);

  let betaRowNumber = null;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (String(cell.value) === 'Beta Class') betaRowNumber = rowNumber;
    });
  });
  assert.ok(betaRowNumber);
  const sep09Col = 6;
  const noClassCell = sheet.getCell(betaRowNumber, sep09Col);
  assert.equal(String(noClassCell.value), 'X');
});

test('normalizeStudentExcelExportTemplate recognizes official template', () => {
  assert.equal(
    attendanceExcelExportService.normalizeStudentExcelExportTemplate('officialAttendanceReport'),
    attendanceExcelExportService.STUDENT_EXCEL_TEMPLATE_OFFICIAL
  );
  assert.equal(
    attendanceExcelExportService.normalizeStudentExcelExportTemplate(''),
    attendanceExcelExportService.STUDENT_EXCEL_TEMPLATE_CLASS_MATRIX
  );
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
  assert.match(viewer, /exportTemplate/);
  assert.match(viewer, /officialAttendanceReport/);
  assert.match(viewer, /sarExcelExportTemplateOfficial/);
  assert.match(viewer, /\/school\/attendances\/report\/api\/export-excel\.xlsx/);
  assert.match(viewer, /canExportStudentMatrixExcel/);
  assert.match(controller, /sheetLayout/);
  assert.match(controller, /exportTemplate/);
  assert.match(exportService, /sheetLayout/);
  assert.match(exportService, /STUDENT_EXCEL_TEMPLATE_OFFICIAL/);
  assert.match(exportService, /buildOfficialStudentAttendanceExportModel/);
});
