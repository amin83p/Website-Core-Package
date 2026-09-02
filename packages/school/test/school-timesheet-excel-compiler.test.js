const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');

const equilibriumParser = require('../MVC/services/school/timesheetExcel/parsers/equilibriumTimesheetParser');
const { parseFilenamePeriod } = require('../MVC/services/school/timesheetExcel/timesheetExcelCellUtils');
const { matchTimesheetPeriod, filterPeriodsForYear } = require('../MVC/services/school/timesheetExcel/timesheetPeriodMatchService');
const { compileTimesheetExcelFiles } = require('../MVC/services/school/timesheetExcel/timesheetExcelCompilerService');
const timesheetController = require('../MVC/controllers/school/timesheetController');
const timesheetRoutes = require('../MVC/routes/timesheetRoutes');

const ROOT = path.resolve(__dirname, '../../..');
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'timesheet-equilibrium-march-2026.xlsx');
const SAMPLE_DOWNLOAD_PATH = 'c:/Users/Amin/Downloads/Time Sheet March 16-31,2026.xlsx';

async function buildEquilibriumWorkbook(options = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(options.sheetName || 'Timesheet');
  ws.getCell('A1').value = 'Employee Time Sheet';
  ws.getCell('A3').value = 'Equilibrium School';
  ws.getCell('F3').value = 'Employee Name:';
  ws.getCell('H3').value = options.employeeName || 'Test Teacher';
  if (options.includePeriodMetadata !== false) {
    ws.getCell('E6').value = 'Start Date:';
    ws.getCell('F6').value = new Date(`${options.startDate || '2026-03-16'}T00:00:00.000Z`);
    ws.getCell('H6').value = 'End Date:';
    ws.getCell('I6').value = new Date(`${options.endDate || '2026-03-31'}T00:00:00.000Z`);
  }
  ws.getRow(7).values = [
    null,
    'Day of Week',
    'Class Name',
    'Hours',
    'Student Name (One on One)',
    'Optional hours (Student Cancelation)',
    'Comment',
    'TOTAL Hrs'
  ];
  const rows = options.rows || [
    { date: '2026-03-16T00:00:00.000Z', className: 'LINC', hours: 6 },
    { date: '2026-03-16T00:00:00.000Z', className: '1 on 1 EAL', hours: 3, studentName: 'Student A', comment: 'Notes' },
    { date: '2026-03-17T00:00:00.000Z', className: 'LINC', hours: 6 }
  ];
  let rowIndex = 8;
  rows.forEach((row) => {
    ws.getRow(rowIndex).values = [
      null,
      new Date(row.date),
      row.className,
      row.hours,
      row.studentName || '',
      row.optionalHours == null ? '' : row.optionalHours,
      row.comment || '',
      '',
      Number(row.hours || 0)
    ];
    rowIndex += 1;
  });
  return wb;
}

async function workbookToBuffer(workbook) {
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

test('parseFilenamePeriod extracts month range from legacy filename', () => {
  const parsed = parseFilenamePeriod('Time Sheet March 16-31,2026.xlsx');
  assert.deepEqual(parsed, { startDate: '2026-03-16', endDate: '2026-03-31' });
});

test('equilibrium parser extracts period, rows, and employee name', async () => {
  const workbook = await buildEquilibriumWorkbook();
  const parsed = equilibriumParser.parse(workbook, {
    fileName: 'Time Sheet March 16-31,2026.xlsx',
    personName: 'Test Teacher'
  });
  assert.equal(parsed.templateId, 'equilibrium-v1');
  assert.equal(parsed.sourcePeriod.startDate, '2026-03-16');
  assert.equal(parsed.sourcePeriod.endDate, '2026-03-31');
  assert.equal(parsed.employeeNameFromFile, 'Test Teacher');
  assert.ok(parsed.rows.length >= 2);
  assert.equal(parsed.rows[0].className, 'LINC');
  assert.equal(parsed.rows[1].studentName, 'Student A');
});

test('equilibrium parser falls back to filename dates when metadata is missing', async () => {
  const workbook = await buildEquilibriumWorkbook({ includePeriodMetadata: false });
  const parsed = equilibriumParser.parse(workbook, {
    fileName: 'Time Sheet March 16-31,2026.xlsx',
    personName: 'Test Teacher'
  });
  assert.equal(parsed.sourcePeriod.startDate, '2026-03-16');
  assert.equal(parsed.sourcePeriod.endDate, '2026-03-31');
});

test('matchTimesheetPeriod supports exact, partial, and none matches', () => {
  const periods = [
    { id: 'TSP_2026_MAR_16', name: '2026-MAR-16', startDate: '2026-03-16', endDate: '2026-03-31' },
    { id: 'TSP_2026_MAR_01', name: '2026-MAR-01', startDate: '2026-03-01', endDate: '2026-03-15' }
  ];
  const exact = matchTimesheetPeriod({ startDate: '2026-03-16', endDate: '2026-03-31' }, periods, '2026');
  assert.equal(exact.matchStatus, 'exact');
  assert.equal(exact.matchedPeriod.id, 'TSP_2026_MAR_16');

  const partial = matchTimesheetPeriod({ startDate: '2026-03-10', endDate: '2026-03-20' }, periods, '2026');
  assert.equal(partial.matchStatus, 'partial');

  const none = matchTimesheetPeriod({ startDate: '2025-01-01', endDate: '2025-01-15' }, periods, '2026');
  assert.equal(none.matchStatus, 'none');
  assert.equal(none.matchedPeriod, null);
});

test('filterPeriodsForYear limits periods to selected year', () => {
  const periods = [
    { id: 'A', startDate: '2025-12-15', endDate: '2026-01-15' },
    { id: 'B', startDate: '2026-03-16', endDate: '2026-03-31' },
    { id: 'C', startDate: '2027-01-01', endDate: '2027-01-15' }
  ];
  const filtered = filterPeriodsForYear(periods, '2026');
  assert.deepEqual(filtered.map((row) => row.id), ['A', 'B']);
});

test('compileTimesheetExcelFiles returns per-file ok and error results', async () => {
  const workbook = await buildEquilibriumWorkbook();
  const buffer = await workbookToBuffer(workbook);
  const compiled = await compileTimesheetExcelFiles({
    files: [
      { originalname: 'Time Sheet March 16-31,2026.xlsx', buffer },
      { originalname: 'bad.txt', buffer: Buffer.from('not excel') }
    ],
    personId: 'P1',
    personName: 'Test Teacher',
    year: '2026',
    periods: [{ id: 'TSP_2026_MAR_16', name: '2026-MAR-16', startDate: '2026-03-16', endDate: '2026-03-31' }]
  });

  assert.equal(compiled.results.length, 2);
  assert.equal(compiled.results[0].status, 'ok');
  assert.equal(compiled.results[0].matchedPeriod.matchStatus, 'exact');
  assert.equal(compiled.results[1].status, 'error');
  assert.ok(Array.isArray(compiled.results[1].error.messages));
});

test('compileTimesheetExcelFiles handles empty upload buffer', async () => {
  const compiled = await compileTimesheetExcelFiles({
    files: [{ originalname: 'empty.xlsx', buffer: Buffer.alloc(0) }],
    personId: 'P1',
    personName: 'Test Teacher',
    year: '2026',
    periods: []
  });
  assert.equal(compiled.results[0].status, 'error');
});

test('sample download workbook compiles when fixture file is available', async () => {
  const sourcePath = fs.existsSync(FIXTURE_PATH)
    ? FIXTURE_PATH
    : (fs.existsSync(SAMPLE_DOWNLOAD_PATH) ? SAMPLE_DOWNLOAD_PATH : '');
  if (!sourcePath) {
    const workbook = await buildEquilibriumWorkbook();
    const buffer = await workbookToBuffer(workbook);
    fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
    fs.writeFileSync(FIXTURE_PATH, buffer);
  }

  const buffer = fs.readFileSync(fs.existsSync(FIXTURE_PATH) ? FIXTURE_PATH : sourcePath);
  const compiled = await compileTimesheetExcelFiles({
    files: [{ originalname: 'Time Sheet March 16-31,2026.xlsx', buffer }],
    personId: 'P1',
    personName: 'Amin Paknejad',
    year: '2026',
    periods: [{ id: 'TSP_2026_MAR_16', name: '2026-MAR-16', startDate: '2026-03-16', endDate: '2026-03-31' }]
  });
  const result = compiled.results[0];
  assert.equal(result.status, 'ok');
  assert.equal(result.sourcePeriod.startDate, '2026-03-16');
  assert.equal(result.sourcePeriod.endDate, '2026-03-31');
  assert.ok(result.rows.length > 0);
});

test('timesheet import route and controller wiring exist', () => {
  const routeSource = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/routes/timesheetRoutes.js'), 'utf8');
  assert.match(routeSource, /\/manage\/api\/import\/compile/);
  assert.equal(typeof timesheetController.compileTimesheetExcelImports, 'function');
  assert.ok(timesheetRoutes);
});

test('timesheet manage view includes import modals and entry button', () => {
  const viewSource = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/timesheet/timesheetManage.ejs'), 'utf8');
  assert.match(viewSource, /id="timesheetImportSetupModal"/);
  assert.match(viewSource, /id="timesheetImportReviewModal"/);
  assert.match(viewSource, /id="importReviewSummary"/);
  assert.match(viewSource, /ts-import-ledger-table/);
  assert.match(viewSource, /id="btnOpenTimesheetImport"/);
  assert.match(viewSource, /\/school\/timesheets\/manage\/api\/import\/compile/);
});
