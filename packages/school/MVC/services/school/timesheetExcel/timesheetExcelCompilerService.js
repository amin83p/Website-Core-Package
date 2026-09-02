'use strict';

const ExcelJS = require('exceljs');
const equilibriumParser = require('./parsers/equilibriumTimesheetParser');
const { matchTimesheetPeriod } = require('./timesheetPeriodMatchService');

const PARSERS = [equilibriumParser];

function buildErrorResult(fileName, messages = []) {
  const list = (Array.isArray(messages) ? messages : [messages])
    .map((msg) => String(msg || '').trim())
    .filter(Boolean);
  return {
    fileName,
    status: 'error',
    error: {
      title: 'Error',
      messages: list.length ? list : ['The file could not be compiled.']
    },
    templateId: null,
    sourcePeriod: { startDate: '', endDate: '' },
    matchedPeriod: null,
    rows: [],
    warnings: [],
    stats: { rowCount: 0, totalHours: 0 }
  };
}

function buildOkResult(fileName, parsed, periodMatch) {
  const warnings = [...(parsed.warnings || [])];
  if (periodMatch.matchStatus === 'partial' && periodMatch.matchNote) {
    warnings.push(periodMatch.matchNote);
  }
  if (periodMatch.matchStatus === 'none' && periodMatch.matchNote) {
    warnings.push(periodMatch.matchNote);
  }

  return {
    fileName,
    status: 'ok',
    error: null,
    templateId: parsed.templateId || null,
    sourcePeriod: parsed.sourcePeriod || { startDate: '', endDate: '' },
    matchedPeriod: periodMatch.matchedPeriod,
    matchStatus: periodMatch.matchStatus,
    matchNote: periodMatch.matchNote,
    employeeNameFromFile: parsed.employeeNameFromFile || '',
    rows: parsed.rows || [],
    warnings,
    stats: parsed.stats || { rowCount: 0, totalHours: 0 }
  };
}

function selectParser(workbook) {
  let best = null;
  for (const parser of PARSERS) {
    const score = typeof parser.detect === 'function' ? Number(parser.detect(workbook) || 0) : 0;
    if (!best || score > best.score) best = { parser, score };
  }
  if (!best || best.score <= 0) return null;
  return best.parser;
}

async function loadWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

async function compileTimesheetExcelFile(file, options = {}) {
  const fileName = String(file?.originalname || file?.fileName || 'timesheet.xlsx').trim();
  const buffer = file?.buffer;
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    return buildErrorResult(fileName, 'The uploaded file is empty or unreadable.');
  }

  try {
    const workbook = await loadWorkbook(buffer);
    const parser = selectParser(workbook);
    if (!parser) {
      return buildErrorResult(fileName, 'Unrecognized timesheet format. Expected an Equilibrium School Employee Time Sheet workbook.');
    }

    const parsed = parser.parse(workbook, {
      fileName,
      personId: options.personId,
      personName: options.personName
    });
    const periodMatch = matchTimesheetPeriod(
      parsed.sourcePeriod,
      options.periods || [],
      options.year
    );
    return buildOkResult(fileName, parsed, periodMatch);
  } catch (error) {
    return buildErrorResult(fileName, error?.message || String(error));
  }
}

async function compileTimesheetExcelFiles(options = {}) {
  const files = Array.isArray(options.files) ? options.files : [];
  const results = [];
  for (const file of files) {
    results.push(await compileTimesheetExcelFile(file, options));
  }
  return { results };
}

module.exports = {
  compileTimesheetExcelFile,
  compileTimesheetExcelFiles,
  PARSERS
};
