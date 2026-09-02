'use strict';

const {
  readSheetMatrix,
  findLabelValue,
  findHeaderRowIndex,
  buildHeaderIndexMap,
  resolveHeaderIndex,
  normalizeDateToken,
  parseHours,
  parseFilenamePeriod,
  deriveDayOfWeek
} = require('../timesheetExcelCellUtils');

const TEMPLATE_ID = 'equilibrium-v1';

function normalizeClassKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildClassAliasMap(workbook) {
  const aliasMap = new Map();
  if (!workbook || typeof workbook.eachSheet !== 'function') return aliasMap;

  workbook.eachSheet((ws) => {
    const name = String(ws.name || '').toLowerCase();
    if (!name.includes('class') && name !== 'sheet2') return;
    const matrix = readSheetMatrix(ws, 40);
    matrix.forEach((row) => {
      const left = String(row[0] || '').trim();
      const right = String(row[row.length - 1] || '').trim();
      if (left && right && left !== right) {
        aliasMap.set(normalizeClassKey(left), right);
        aliasMap.set(normalizeClassKey(right), left);
      }
      if (right) aliasMap.set(normalizeClassKey(right), right);
      if (left) aliasMap.set(normalizeClassKey(left), left);
    });
  });
  return aliasMap;
}

function normalizeClassName(className, aliasMap) {
  const raw = String(className || '').trim();
  if (!raw) return '';
  const key = normalizeClassKey(raw);
  return aliasMap.get(key) || raw;
}

function sheetDetectionScore(matrix) {
  const flat = matrix.flat().join(' ').toLowerCase();
  let score = 0;
  if (flat.includes('employee time sheet')) score += 3;
  if (flat.includes('start date')) score += 2;
  if (flat.includes('end date')) score += 2;
  if (flat.includes('class name') && flat.includes('hours')) score += 4;
  if (findHeaderRowIndex(matrix, ['class name', 'hours']) >= 0) score += 3;
  return score;
}

function findMainSheet(workbook) {
  let best = null;
  workbook.eachSheet((ws) => {
    const matrix = readSheetMatrix(ws, 90);
    const score = sheetDetectionScore(matrix);
    if (!best || score > best.score) {
      best = { ws, matrix, score };
    }
  });
  return best && best.score >= 5 ? best : null;
}

function detect(workbook) {
  const main = findMainSheet(workbook);
  return main ? main.score : 0;
}

function extractEmployeeName(matrix) {
  const fromLabel = findLabelValue(matrix, /^employee name:?$/i, {
    skipValueRegex: /^employee name:?$/i
  });
  if (fromLabel) return fromLabel;
  for (let r = 0; r < Math.min(matrix.length, 8); r++) {
    const row = matrix[r] || [];
    for (let c = 0; c < row.length - 1; c++) {
      if (!/^employee name:?$/i.test(String(row[c] || '').trim())) continue;
      for (let offset = 1; offset <= 4; offset++) {
        const candidate = String(row[c + offset] || '').trim();
        if (!candidate || /^employee name:?$/i.test(candidate)) continue;
        return candidate;
      }
    }
  }
  return '';
}

function extractSourcePeriod(matrix, fileName) {
  const startRaw = findLabelValue(matrix, /^start date:?$/i);
  const endRaw = findLabelValue(matrix, /^end date:?$/i);
  const startDate = normalizeDateToken(startRaw);
  const endDate = normalizeDateToken(endRaw);
  if (startDate && endDate) return { startDate, endDate };
  return parseFilenamePeriod(fileName) || { startDate: '', endDate: '' };
}

function extractRows(matrix, headerRowIndex, aliasMap, sourcePeriod) {
  const headerRow = matrix[headerRowIndex] || [];
  const headerMap = buildHeaderIndexMap(headerRow);
  const idxDate = resolveHeaderIndex(headerMap, ['day of week', 'date', 'day']);
  const idxClass = resolveHeaderIndex(headerMap, ['class name', 'class']);
  const idxHours = resolveHeaderIndex(headerMap, ['hours']);
  const idxStudent = resolveHeaderIndex(headerMap, ['student name', 'one on one']);
  const idxOptional = resolveHeaderIndex(headerMap, ['optional hours', 'cancelation', 'cancellation']);
  const idxComment = resolveHeaderIndex(headerMap, ['comment']);

  if (idxClass < 0 || idxHours < 0) {
    throw new Error('Could not locate required columns (Class Name, Hours) in the timesheet header row.');
  }

  const rows = [];
  let currentDate = '';
  let currentDay = '';

  for (let r = headerRowIndex + 1; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const sourceRowNumber = r + 1;
    const dateToken = idxDate >= 0 ? normalizeDateToken(row[idxDate]) : '';
    if (dateToken) {
      currentDate = dateToken;
      currentDay = String(row[idxDate] || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(currentDay)) {
        currentDay = deriveDayOfWeek(currentDay);
      }
    }

    const className = normalizeClassName(row[idxClass], aliasMap);
    const hours = parseHours(row[idxHours]);
    const studentName = idxStudent >= 0 ? String(row[idxStudent] || '').trim() : '';
    const optionalHours = idxOptional >= 0 ? parseHours(row[idxOptional]) : null;
    const commentParts = [];
    if (idxComment >= 0) {
      const base = String(row[idxComment] || '').trim();
      if (base) commentParts.push(base);
      for (let c = idxComment + 1; c < row.length; c++) {
        const extra = String(row[c] || '').trim();
        if (!extra || /^total/i.test(extra)) break;
        if (!commentParts.includes(extra)) commentParts.push(extra);
      }
    }

    if (!className && (hours == null || hours === 0) && !studentName && !commentParts.length) {
      continue;
    }
    if (!className && hours == null) continue;

    const effectiveDate = currentDate || dateToken;
    rows.push({
      date: effectiveDate,
      dayOfWeek: currentDay || deriveDayOfWeek(effectiveDate),
      className,
      hours: hours == null ? 0 : hours,
      studentName,
      optionalHours: optionalHours == null ? null : optionalHours,
      comment: commentParts.join(' | '),
      sourceRowNumber
    });
  }

  const warnings = [];
  if (sourcePeriod?.startDate && sourcePeriod?.endDate) {
    rows.forEach((entry) => {
      if (!entry.date) return;
      if (entry.date < sourcePeriod.startDate || entry.date > sourcePeriod.endDate) {
        warnings.push(`Row ${entry.sourceRowNumber}: date ${entry.date} is outside the sheet period (${sourcePeriod.startDate} to ${sourcePeriod.endDate}).`);
      }
    });
  }

  return { rows, warnings };
}

function parse(workbook, options = {}) {
  const fileName = String(options.fileName || '').trim();
  const main = findMainSheet(workbook);
  if (!main) {
    throw new Error('Unrecognized timesheet format. Expected an Equilibrium School Employee Time Sheet workbook.');
  }

  const aliasMap = buildClassAliasMap(workbook);
  const employeeNameFromFile = extractEmployeeName(main.matrix);
  const sourcePeriod = extractSourcePeriod(main.matrix, fileName);
  if (!sourcePeriod.startDate || !sourcePeriod.endDate) {
    throw new Error('Could not determine the timesheet period start/end dates from the workbook or filename.');
  }

  const headerRowIndex = findHeaderRowIndex(main.matrix, ['class name', 'hours']);
  if (headerRowIndex < 0) {
    throw new Error('Could not find the timesheet data header row (Class Name, Hours).');
  }

  const { rows, warnings } = extractRows(main.matrix, headerRowIndex, aliasMap, sourcePeriod);
  if (!rows.length) {
    throw new Error('No billable rows were found in this timesheet file.');
  }

  const selectedTeacherName = String(options.personName || '').trim();
  if (employeeNameFromFile && selectedTeacherName
    && normalizeClassKey(employeeNameFromFile) !== normalizeClassKey(selectedTeacherName)) {
    warnings.push(`Employee name in file (${employeeNameFromFile}) differs from selected teacher (${selectedTeacherName}).`);
  }

  const totalHours = rows.reduce((sum, row) => sum + (Number(row.hours) || 0), 0);
  return {
    templateId: TEMPLATE_ID,
    employeeNameFromFile,
    sourcePeriod,
    rows,
    warnings,
    stats: {
      rowCount: rows.length,
      totalHours: Math.round(totalHours * 100) / 100
    }
  };
}

module.exports = {
  id: TEMPLATE_ID,
  detect,
  parse
};
