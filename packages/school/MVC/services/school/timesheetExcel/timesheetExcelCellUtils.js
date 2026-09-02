'use strict';

const MONTH_NAMES = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12
};

function cellValue(cell) {
  if (!cell || cell.value == null) return '';
  const v = cell.value;
  if (typeof v === 'object') {
    if (v.result != null) return v.result;
    if (v.text != null) return v.text;
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v instanceof Date) return v;
    if (Array.isArray(v)) return v.map((x) => (x && x.text) || x).join('');
    if (v.hyperlink) return v.text || v.hyperlink;
    if (v.formula) return v.result != null ? v.result : '';
    return '';
  }
  return v;
}

function cellText(cell) {
  const v = cellValue(cell);
  if (v instanceof Date) return formatDateToken(v);
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return String(v == null ? '' : v).trim();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateToken(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '';
  // Excel date-only cells are stored as UTC midnight; use UTC parts to avoid timezone shifts.
  return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
}

function normalizeDateToken(value) {
  if (value instanceof Date) return formatDateToken(value);
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoMatch) return isoMatch[1];
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return formatDateToken(new Date(parsed));
  return '';
}

function parseHours(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value).trim().replace(/,/g, '');
  if (!raw) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

function readSheetMatrix(ws, maxRows = 120) {
  const matrix = [];
  const rowCount = Math.min(maxRows, ws.rowCount || 0);
  const colCount = ws.columnCount || 0;
  for (let r = 1; r <= rowCount; r++) {
    const row = ws.getRow(r);
    const vals = [];
    for (let c = 1; c <= colCount; c++) {
      vals.push(cellText(row.getCell(c)));
    }
    while (vals.length && vals[vals.length - 1] === '') vals.pop();
    matrix.push(vals);
  }
  return matrix;
}

function findLabelValue(matrix, labelRegex, options = {}) {
  const maxCols = Number(options.maxCols || 12);
  const skipValueRegex = options.skipValueRegex || null;
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] || [];
    for (let c = 0; c < Math.min(row.length, maxCols); c++) {
      const label = String(row[c] || '').trim();
      if (!labelRegex.test(label)) continue;
      for (let offset = 1; offset <= 5; offset++) {
        const candidate = String(row[c + offset] || '').trim();
        if (!candidate) continue;
        if (skipValueRegex && skipValueRegex.test(candidate)) continue;
        if (candidate.toLowerCase() === label.toLowerCase()) continue;
        return candidate;
      }
    }
  }
  return '';
}

function findHeaderRowIndex(matrix, requiredHeaders = []) {
  const normalizedRequired = requiredHeaders.map((h) => String(h).trim().toLowerCase());
  for (let r = 0; r < matrix.length; r++) {
    const row = (matrix[r] || []).map((v) => String(v || '').trim().toLowerCase());
    const hits = normalizedRequired.filter((token) => row.some((cell) => cell.includes(token)));
    if (hits.length === normalizedRequired.length) return r;
  }
  return -1;
}

function buildHeaderIndexMap(headerRow = []) {
  const map = new Map();
  headerRow.forEach((label, index) => {
    const key = String(label || '').trim().toLowerCase();
    if (!key) return;
    if (!map.has(key)) map.set(key, index);
  });
  return map;
}

function resolveHeaderIndex(headerMap, patterns = []) {
  for (const pattern of patterns) {
    const token = String(pattern).trim().toLowerCase();
    for (const [key, index] of headerMap.entries()) {
      if (key.includes(token)) return index;
    }
  }
  return -1;
}

function parseFilenamePeriod(fileName = '') {
  const base = String(fileName || '').replace(/\.xlsx?$/i, '').trim();
  const monthRange = base.match(/([A-Za-z]+)\s+(\d{1,2})\s*-\s*(\d{1,2})\s*,?\s*(\d{4})/i);
  if (monthRange) {
    const monthToken = monthRange[1].toLowerCase();
    const month = MONTH_NAMES[monthToken];
    const year = Number(monthRange[4]);
    const startDay = Number(monthRange[2]);
    const endDay = Number(monthRange[3]);
    if (month && Number.isFinite(year) && Number.isFinite(startDay) && Number.isFinite(endDay)) {
      return {
        startDate: `${year}-${pad2(month)}-${pad2(startDay)}`,
        endDate: `${year}-${pad2(month)}-${pad2(endDay)}`
      };
    }
  }
  const isoRange = base.match(/(\d{4}-\d{2}-\d{2}).*?(\d{4}-\d{2}-\d{2})/);
  if (isoRange) {
    return { startDate: isoRange[1], endDate: isoRange[2] };
  }
  return null;
}

function deriveDayOfWeek(dateToken) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateToken || ''))) return '';
  const parsed = Date.parse(`${dateToken}T12:00:00`);
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toLocaleDateString('en-US', { weekday: 'short' });
}

module.exports = {
  cellValue,
  cellText,
  formatDateToken,
  normalizeDateToken,
  parseHours,
  readSheetMatrix,
  findLabelValue,
  findHeaderRowIndex,
  buildHeaderIndexMap,
  resolveHeaderIndex,
  parseFilenamePeriod,
  deriveDayOfWeek
};
