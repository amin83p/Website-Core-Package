const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');

const ROOT_DIR = path.resolve(__dirname, '..');
const CORE_ROOT = path.resolve(__dirname, '../../..');
const rollingEnrollmentExcelExportService = require('../MVC/services/school/rollingEnrollmentExcelExportService');

function read(relativePath, baseDir = ROOT_DIR) {
  return fs.readFileSync(path.join(baseDir, relativePath), 'utf8');
}

test('rolling enrollment view passes exportExcelUrl to tablePages-start', () => {
  const view = read('MVC/views/school/class/rollingEnrollment.ejs');
  assert.match(view, /exportExcelUrl:\s*`\/school\/classes\/\$\{encClassId\}\/rolling-enrollment\/export\.xlsx`/);
});

test('tablePages-start wires optional data-excel-export-url on Export button', () => {
  const partial = read('MVC/views/partials/tablePages-start.ejs', CORE_ROOT);
  assert.match(partial, /exportExcelUrl/);
  assert.match(partial, /data-excel-export-url/);
});

test('export modal includes hidden Excel format option', () => {
  const modal = read('MVC/views/partials/modal_FileExport.ejs', CORE_ROOT);
  assert.match(modal, /value="xlsx"/);
  assert.match(modal, /id="exportFormatExcelOption"/);
  assert.match(modal, /hidden/);
  assert.match(modal, /Excel Format/);
});

test('modal_FileExport.js shows Excel option and redirects for xlsx', () => {
  const script = read('public/scripts/modal_FileExport.js', CORE_ROOT);
  assert.match(script, /data-excel-export-url|excelExportUrl/);
  assert.match(script, /exportFormatExcelOption/);
  assert.match(script, /format === 'xlsx'/);
  assert.match(script, /handleExcelExport/);
  assert.match(script, /window\.location\.href/);
});

test('class routes expose rolling-enrollment export.xlsx with READ_ALL access', () => {
  const routes = read('MVC/routes/classRoutes.js');
  assert.match(routes, /rolling-enrollment\/export\.xlsx/);
  assert.match(routes, /exportRollingEnrollmentExcel/);
  assert.match(
    routes,
    /rolling-enrollment\/export\.xlsx'[\s\S]*?requireAccess\(SECTIONS\.SCHOOL_ROLLING_ENROLLMENT,\s*OPERATIONS\.READ_ALL\)/
  );
});

test('rolling enrollment controller exports Excel handler and shared row builder', () => {
  const controller = read('MVC/controllers/school/classRollingEnrollmentController.js');
  assert.match(controller, /buildRollingEnrollmentExportRows/);
  assert.match(controller, /exportRollingEnrollmentExcel/);
  assert.match(controller, /rollingEnrollmentExcelExportService/);
  assert.match(controller, /resolveClassTeacherName/);
});

test('format helpers mirror rolling enrollment table display rules', () => {
  assert.equal(rollingEnrollmentExcelExportService.formatPeriodStatusLabel('to_be_confirmed'), 'To be Confirmed');
  assert.equal(rollingEnrollmentExcelExportService.formatPeriodStatusLabel('waiting_list'), 'Waiting list');
  assert.equal(rollingEnrollmentExcelExportService.formatEndDateCell({ targetSessionCount: 12 }), 'Target-based');
  assert.equal(rollingEnrollmentExcelExportService.formatEndDateCell({ endDate: '2026-07-31' }), '2026-07-31');
  assert.equal(rollingEnrollmentExcelExportService.formatEndDateCell({}), 'Open');

  const unresolved = rollingEnrollmentExcelExportService.resolveFinancialStatus({
    transactionSummary: {
      unresolvedTransactionIds: ['tx1'],
      postingCycles: [{ cycleNo: 1, status: 'posted' }]
    }
  });
  assert.equal(unresolved, 'unresolved');

  const draft = rollingEnrollmentExcelExportService.resolveFinancialStatus({
    transactionSummary: {
      draftTransactionIds: ['tx2'],
      postingCycles: []
    }
  });
  assert.equal(draft, 'draft');
});

test('buildExportFilename sanitizes class title and id', () => {
  const filename = rollingEnrollmentExcelExportService.buildExportFilename({
    className: 'EAL Morning',
    classId: 'CLS_1'
  });
  assert.match(filename, /^RollingEnrollment_EAL_Morning_CLS_1\.xlsx$/);
});

test('workbook builds enrollment columns without attendance day columns', async () => {
  const { buffer, filename, title } = await rollingEnrollmentExcelExportService.buildRollingEnrollmentExcelWorkbook({
    classData: {
      id: 'CLS_1',
      title: 'EAL Morning',
      cycleStartDate: '2026-01-01',
      cycleEndDate: '2026-06-30'
    },
    className: 'EAL Morning',
    teacherName: 'Fatima Majoka',
    periodRows: [
      {
        studentLabel: 'Foroozan Haidari (1001)',
        funderLabel: 'IRCC',
        startDate: '2026-01-15',
        targetSessionCount: 40,
        consumedSessionCount: 12,
        remainingSessionCount: 28,
        status: 'active',
        transactionSummary: {
          postingCycles: [{ cycleNo: 1, status: 'posted' }],
          activePostingCycleNo: 1
        }
      },
      {
        studentLabel: 'Jose Alvarenga',
        funderLabel: 'Self Fund',
        startDate: '2026-02-01',
        endDate: '2026-07-24',
        consumedSessionCount: 5,
        effectiveTargetSessionCount: 20,
        completionDate: '2026-07-20',
        completionSessionId: 'SES_99',
        status: 'completed',
        transactionSummary: {
          draftTransactionIds: ['draft1'],
          postingCycles: []
        }
      }
    ]
  });

  assert.match(filename, /RollingEnrollment_EAL_Morning_CLS_1\.xlsx/);
  assert.equal(title, 'Rolling Enrollment — EAL Morning (2026-01-01 – 2026-06-30)');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.name, 'Rolling Enrollment');

  assert.equal(String(sheet.getCell(1, 5).value), title);
  assert.equal(String(sheet.getCell(2, 5).value), 'Class: EAL Morning');
  assert.equal(String(sheet.getCell(3, 5).value), 'Teacher: Fatima Majoka');

  const headerRow = 5;
  assert.equal(sheet.getCell(headerRow, 1).value, 'Funder');
  assert.equal(sheet.getCell(headerRow, 2).value, '#');
  assert.equal(sheet.getCell(headerRow, 3).value, 'Last Name');
  assert.equal(sheet.getCell(headerRow, 4).value, 'First Name');
  assert.equal(sheet.getCell(headerRow, 5).value, 'Start Date');
  assert.equal(sheet.getCell(headerRow, 6).value, 'End Date');
  assert.equal(sheet.getCell(headerRow, 7).value, 'Target');
  assert.equal(sheet.getCell(headerRow, 8).value, 'Consumed');
  assert.equal(sheet.getCell(headerRow, 9).value, 'Remaining');
  assert.equal(sheet.getCell(headerRow, 10).value, 'Completion');
  assert.equal(sheet.getCell(headerRow, 11).value, 'Period Status');
  assert.equal(sheet.getCell(headerRow, 12).value, 'Finance Status');
  assert.equal(sheet.getCell(headerRow, 1).fill?.fgColor?.argb, 'FF5B9BD5');

  assert.equal(sheet.getCell(headerRow + 1, 1).value, 'IRCC');
  assert.equal(sheet.getCell(headerRow + 1, 2).value, 1);
  assert.equal(sheet.getCell(headerRow + 1, 5).value, '2026-01-15');
  assert.equal(sheet.getCell(headerRow + 1, 6).value, 'Target-based');
  assert.equal(sheet.getCell(headerRow + 1, 7).value, '40');
  assert.equal(sheet.getCell(headerRow + 1, 8).value, '12');
  assert.equal(sheet.getCell(headerRow + 1, 9).value, '28');
  assert.equal(sheet.getCell(headerRow + 1, 11).value, 'Active');
  assert.equal(sheet.getCell(headerRow + 1, 12).value, 'posted');

  assert.equal(sheet.getCell(headerRow + 2, 1).value, 'Self Fund');
  assert.equal(sheet.getCell(headerRow + 2, 6).value, '2026-07-24');
  assert.equal(sheet.getCell(headerRow + 2, 7).value, '20');
  assert.equal(String(sheet.getCell(headerRow + 2, 10).value), '2026-07-20\nSES_99');
  assert.equal(sheet.getCell(headerRow + 2, 11).value, 'Completed');
  assert.equal(sheet.getCell(headerRow + 2, 12).value, 'draft');

  assert.equal(sheet.getCell(headerRow, 13).value, null);
  assert.equal(sheet.getCell(headerRow + 1, 13).value, null);
});
