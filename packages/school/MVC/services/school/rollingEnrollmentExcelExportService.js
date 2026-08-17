// packages/school/MVC/services/school/rollingEnrollmentExcelExportService.js
const ExcelJS = require('exceljs');
const classEnrollmentPeriodProgressService = require('./classEnrollmentPeriodProgressService');
const {
  splitDisplayName,
  fitColumnWidthToContent,
  HEADER_FILL_ARGB
} = require('./attendanceExcelExportService');

const ROW_BAND_FILL_ARGB = 'FFDDEBF7';
const DARK_TEXT_ARGB = 'FF000000';
const WHITE_TEXT_ARGB = 'FFFFFFFF';

const THIN_BLACK_BORDER = Object.freeze({
  top: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } }
});

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function colLetter(colNumber) {
  let n = colNumber;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function mergeHeaderBlock(sheet, row, startCol, endCol) {
  if (endCol <= startCol) return;
  sheet.mergeCells(`${colLetter(startCol)}${row}:${colLetter(endCol)}${row}`);
}

function applySolidFill(cell, argb) {
  if (!argb) return;
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb }
  };
}

function applyTableCellBorder(cell) {
  cell.border = { ...THIN_BLACK_BORDER };
}

function applyVerticalMiddle(cell, { horizontal = null, wrapText = false } = {}) {
  const alignment = { vertical: 'middle' };
  if (horizontal) alignment.horizontal = horizontal;
  if (wrapText) alignment.wrapText = true;
  cell.alignment = alignment;
}

function applyHeaderCellStyle(cell) {
  applySolidFill(cell, HEADER_FILL_ARGB);
  cell.font = { bold: true, size: 11, color: { argb: WHITE_TEXT_ARGB }, name: 'Calibri' };
  applyTableCellBorder(cell);
  applyVerticalMiddle(cell, { horizontal: 'center' });
}

function applyBodyMetaCellStyle(cell, { banded = false, center = false, wrapText = false } = {}) {
  if (banded) applySolidFill(cell, ROW_BAND_FILL_ARGB);
  applyTableCellBorder(cell);
  applyVerticalMiddle(cell, {
    horizontal: center ? 'center' : null,
    wrapText
  });
}

function sanitizeFilenamePart(value) {
  return clean(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Class';
}

function buildExportFilename({ className, classId } = {}) {
  const classPart = sanitizeFilenamePart(className || classId);
  const idPart = sanitizeFilenamePart(classId);
  return `RollingEnrollment_${classPart}_${idPart}.xlsx`.replace(/\s+/g, '_');
}

function formatPeriodStatusLabel(status) {
  const s = clean(status).toLowerCase();
  if (s === 'to_be_confirmed') return 'To be Confirmed';
  if (s === 'waiting_list') return 'Waiting list';
  if (!s) return '-';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function resolveFinancialStatus(row = {}) {
  const transactionSummary = row?.transactionSummary && typeof row.transactionSummary === 'object'
    ? row.transactionSummary
    : {};
  const postingCycles = Array.isArray(transactionSummary.postingCycles) ? transactionSummary.postingCycles : [];
  const activePostingCycle = postingCycles.find(
    (cycle) => Number(cycle?.cycleNo || 0) === Number(transactionSummary.activePostingCycleNo || 0)
  ) || postingCycles[postingCycles.length - 1] || null;
  if ((transactionSummary.unresolvedTransactionIds || []).length
    || (transactionSummary.reconciliationIssues || []).length) {
    return 'unresolved';
  }
  return String(
    activePostingCycle?.status
    || ((transactionSummary.draftTransactionIds || []).length ? 'draft' : 'none')
  ).trim().toLowerCase();
}

function formatEndDateCell(row = {}) {
  const explicitTargetSessionCount = Number(row?.targetSessionCount || 0);
  const explicitTargetHours = Number(row?.targetHours || 0);
  if (explicitTargetHours > 0 || explicitTargetSessionCount > 0) return 'Target-based';
  const endDate = clean(row?.endDate);
  return endDate || 'Open';
}

function formatCompletionCell(row = {}) {
  const completion = row?.sessionCompletion
    || (row?.completionDate
      ? { date: row.completionDate, sessionId: row?.completionSessionId || '' }
      : null);
  if (!completion?.date) return '';
  const sessionId = clean(completion.sessionId);
  return sessionId ? `${completion.date}\n${sessionId}` : String(completion.date);
}

function resolveTargetConsumedRemaining(row = {}) {
  const target = classEnrollmentPeriodProgressService.formatEnrollmentCapDisplay(row, 'target');
  const consumed = classEnrollmentPeriodProgressService.formatEnrollmentCapDisplay(row, 'consumed');
  const remaining = classEnrollmentPeriodProgressService.formatEnrollmentCapDisplay(row, 'remaining');
  return {
    target: target || '',
    consumed: consumed || '',
    remaining: remaining || ''
  };
}

function resolveRollingEnrollmentTitle({ className, cycleStartDate, cycleEndDate } = {}) {
  const title = `Rolling Enrollment — ${clean(className) || 'Class'}`;
  const start = clean(cycleStartDate);
  const end = clean(cycleEndDate);
  if (start && end) return `${title} (${start} – ${end})`;
  if (start) return `${title} (from ${start})`;
  return title;
}

async function buildRollingEnrollmentExcelWorkbook({
  classData = {},
  className = '',
  teacherName = '',
  periodRows = []
} = {}) {
  const rows = Array.isArray(periodRows) ? periodRows : [];
  const resolvedClassName = clean(className) || clean(classData?.title) || clean(classData?.id) || 'Class';
  const title = resolveRollingEnrollmentTitle({
    className: resolvedClassName,
    cycleStartDate: classData?.cycleStartDate,
    cycleEndDate: classData?.cycleEndDate
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'School Rolling Enrollment';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Rolling Enrollment', {
    views: [{ state: 'frozen', xSplit: 4, ySplit: 0 }]
  });

  const funderCol = 1;
  const numCol = 2;
  const lastNameCol = 3;
  const firstNameCol = 4;
  const startDateCol = 5;
  const endDateCol = 6;
  const targetCol = 7;
  const consumedCol = 8;
  const remainingCol = 9;
  const completionCol = 10;
  const statusCol = 11;
  const financeCol = 12;
  const mergeEndCol = financeCol;

  sheet.getCell(1, startDateCol).value = title;
  sheet.getCell(1, startDateCol).font = { bold: true, size: 14, name: 'Calibri', color: { argb: DARK_TEXT_ARGB } };
  mergeHeaderBlock(sheet, 1, startDateCol, mergeEndCol);

  sheet.getCell(2, startDateCol).value = `Class: ${resolvedClassName}`;
  sheet.getCell(2, startDateCol).font = { size: 12, name: 'Calibri', color: { argb: DARK_TEXT_ARGB } };
  mergeHeaderBlock(sheet, 2, startDateCol, mergeEndCol);

  sheet.getCell(3, startDateCol).value = `Teacher: ${clean(teacherName) || '—'}`;
  sheet.getCell(3, startDateCol).font = { size: 12, name: 'Calibri', color: { argb: DARK_TEXT_ARGB } };
  mergeHeaderBlock(sheet, 3, startDateCol, mergeEndCol);

  const headerRowIndex = 5;
  const headerColumns = [
    [funderCol, 'Funder'],
    [numCol, '#'],
    [lastNameCol, 'Last Name'],
    [firstNameCol, 'First Name'],
    [startDateCol, 'Start Date'],
    [endDateCol, 'End Date'],
    [targetCol, 'Target'],
    [consumedCol, 'Consumed'],
    [remainingCol, 'Remaining'],
    [completionCol, 'Completion'],
    [statusCol, 'Period Status'],
    [financeCol, 'Finance Status']
  ];
  headerColumns.forEach(([col, label]) => {
    const cell = sheet.getCell(headerRowIndex, col);
    cell.value = label;
    applyHeaderCellStyle(cell);
  });

  let bodyRow = headerRowIndex + 1;
  rows.forEach((row, idx) => {
    const studentLabel = clean(row?.studentLabel || row?.studentId);
    const { firstName, lastName } = splitDisplayName({
      firstName: row?.studentFirstName,
      lastName: row?.studentLastName,
      name: studentLabel,
      displayName: studentLabel
    });
    const counts = resolveTargetConsumedRemaining(row);
    const banded = idx % 2 === 1;

    const values = [
      [funderCol, clean(row?.funderLabel || 'Self Fund'), { center: false }],
      [numCol, idx + 1, { center: true }],
      [lastNameCol, lastName, { center: false }],
      [firstNameCol, firstName, { center: false }],
      [startDateCol, clean(row?.startDate) || '-', { center: false }],
      [endDateCol, formatEndDateCell(row), { center: false }],
      [targetCol, counts.target || '-', { center: true }],
      [consumedCol, counts.consumed || '-', { center: true }],
      [remainingCol, counts.remaining || '-', { center: true }],
      [completionCol, formatCompletionCell(row), { center: false, wrapText: true }],
      [statusCol, formatPeriodStatusLabel(row?.status), { center: false }],
      [financeCol, resolveFinancialStatus(row), { center: false }]
    ];

    values.forEach(([col, value, style]) => {
      const cell = sheet.getCell(bodyRow, col);
      cell.value = value;
      applyBodyMetaCellStyle(cell, {
        banded,
        center: style.center,
        wrapText: style.wrapText
      });
    });
    bodyRow += 1;
  });

  sheet.getColumn(funderCol).width = 14;
  sheet.getColumn(numCol).width = 6;
  sheet.getColumn(lastNameCol).width = 18;
  sheet.getColumn(firstNameCol).width = 18;
  sheet.getColumn(startDateCol).width = 12;
  sheet.getColumn(endDateCol).width = 14;
  sheet.getColumn(targetCol).width = 8;
  sheet.getColumn(consumedCol).width = 10;
  sheet.getColumn(remainingCol).width = 10;
  fitColumnWidthToContent(sheet, completionCol, { min: 14, max: 28, padding: 2 });
  fitColumnWidthToContent(sheet, statusCol, { min: 12, max: 24, padding: 2 });
  fitColumnWidthToContent(sheet, financeCol, { min: 10, max: 20, padding: 2 });

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return {
    buffer,
    filename: buildExportFilename({
      className: resolvedClassName,
      classId: classData?.id
    }),
    title
  };
}

module.exports = {
  buildExportFilename,
  formatPeriodStatusLabel,
  resolveFinancialStatus,
  formatEndDateCell,
  buildRollingEnrollmentExcelWorkbook
};
