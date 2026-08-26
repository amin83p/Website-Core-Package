'use strict';

const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const {
  cleanString,
  cleanId,
  cleanBoolean,
  generateEntityId,
  buildAudit
} = require('./libraryEntityCommon');

const dataPath = path.join(resolveCoreRoot(), 'data/school/bookCoveringReports.json');

const PERIOD_TYPES = Object.freeze({
  DAILY: 'daily',
  WEEKLY: 'weekly',
  BIWEEKLY: 'biweekly',
  MONTHLY: 'monthly'
});

const REPORT_STATUSES = Object.freeze({
  DRAFT: 'draft',
  SUBMITTED: 'submitted'
});

const UNIT_COVERAGE_MODES = Object.freeze({
  COUNT: 'count',
  TOC_PICK: 'toc_pick'
});

const PAGE_COVERAGE_MODES = Object.freeze({
  PAGES_TEXT: 'pages_text',
  PAGE_COUNT: 'page_count',
  TOC_PICK: 'toc_pick'
});

const USAGE_FREQUENCIES = Object.freeze({
  ONCE: 'once',
  TWICE: 'twice',
  MORE_THAN_TWICE: 'more_than_twice'
});

const VALID_PERIOD_TYPES = new Set(Object.values(PERIOD_TYPES));
const VALID_REPORT_STATUSES = new Set(Object.values(REPORT_STATUSES));
const VALID_UNIT_MODES = new Set(Object.values(UNIT_COVERAGE_MODES));
const VALID_PAGE_MODES = new Set(Object.values(PAGE_COVERAGE_MODES));
const VALID_USAGE_FREQUENCIES = new Set(Object.values(USAGE_FREQUENCIES));

function cleanDateOnly(value, { allowEmpty = false } = {}) {
  const s = cleanString(value, { max: 10, allowEmpty });
  if (s === null) return null;
  if (!s) return allowEmpty ? '' : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Invalid date format. Use YYYY-MM-DD.');
  return s;
}

function cleanNonNegativeInt(value, { fieldLabel = 'Value', allowEmpty = true } = {}) {
  if (value === undefined || value === null || value === '') return allowEmpty ? null : NaN;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`${fieldLabel} must be a whole number of 0 or greater.`);
  }
  return n;
}

function cleanPositiveInt(value, { fieldLabel = 'Value', allowEmpty = true } = {}) {
  if (value === undefined || value === null || value === '') return allowEmpty ? null : NaN;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new Error(`${fieldLabel} must be a positive integer.`);
  }
  return n;
}

function normalizePeriodType(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_PERIOD_TYPES.has(normalized) ? normalized : PERIOD_TYPES.DAILY;
}

function normalizeReportStatus(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_REPORT_STATUSES.has(normalized) ? normalized : REPORT_STATUSES.DRAFT;
}

function normalizeTocEntryIds(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((id) => cleanId(id, { max: 80, allowEmpty: true }))
    .filter(Boolean);
}

function sanitizeUnitCoverage(input = {}, periodType) {
  const mode = String(input.mode || '').trim().toLowerCase();
  const normalizedMode = VALID_UNIT_MODES.has(mode) ? mode : UNIT_COVERAGE_MODES.COUNT;
  const result = { mode: normalizedMode, tocEntryIds: [] };
  if (normalizedMode === UNIT_COVERAGE_MODES.COUNT) {
    result.unitCount = cleanNonNegativeInt(input.unitCount, { fieldLabel: 'Unit count', allowEmpty: false });
  } else {
    result.tocEntryIds = normalizeTocEntryIds(input.tocEntryIds);
    if (!result.tocEntryIds.length) throw new Error('Select at least one unit from the table of contents.');
  }
  return result;
}

function sanitizePageCoverage(input = {}) {
  const mode = String(input.mode || '').trim().toLowerCase();
  const normalizedMode = VALID_PAGE_MODES.has(mode) ? mode : PAGE_COVERAGE_MODES.PAGES_TEXT;
  const result = { mode: normalizedMode, tocEntryIds: [] };
  if (normalizedMode === PAGE_COVERAGE_MODES.PAGES_TEXT) {
    result.pagesText = cleanString(input.pagesText, { max: 500, allowEmpty: false });
    if (!result.pagesText) throw new Error('Pages covered text is required.');
  } else if (normalizedMode === PAGE_COVERAGE_MODES.PAGE_COUNT) {
    result.pageCount = cleanNonNegativeInt(input.pageCount, { fieldLabel: 'Page count', allowEmpty: false });
  } else {
    result.tocEntryIds = normalizeTocEntryIds(input.tocEntryIds);
    if (!result.tocEntryIds.length) throw new Error('Select at least one page range from the table of contents.');
  }
  return result;
}

function sanitizeUsageFrequency(value, periodType) {
  if (normalizePeriodType(periodType) === PERIOD_TYPES.DAILY) return null;
  const normalized = String(value || '').trim().toLowerCase();
  if (!VALID_USAGE_FREQUENCIES.has(normalized)) {
    throw new Error('Usage frequency is required for non-daily reports.');
  }
  return normalized;
}

function sanitizeUseInNextFourWeeks(value, periodType) {
  if (normalizePeriodType(periodType) === PERIOD_TYPES.DAILY) return null;
  return cleanBoolean(value, false);
}

function sanitizeEntry(input = {}, periodType, index = 0) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`Book entry ${index + 1}: invalid payload.`);
  }
  const bookId = cleanId(input.bookId, { max: 80, allowEmpty: false });
  if (!bookId) throw new Error(`Book entry ${index + 1}: book is required.`);
  const bookAssignmentId = cleanId(input.bookAssignmentId, { max: 80, allowEmpty: true });
  return {
    bookAssignmentId: bookAssignmentId || '',
    bookId: String(bookId),
    note: cleanString(input.note, { max: 2000, allowEmpty: true }),
    unitCoverage: sanitizeUnitCoverage(input.unitCoverage || {}, periodType),
    pageCoverage: sanitizePageCoverage(input.pageCoverage || {}),
    usageFrequency: sanitizeUsageFrequency(input.usageFrequency, periodType),
    useInNextFourWeeks: sanitizeUseInNextFourWeeks(input.useInNextFourWeeks, periodType)
  };
}

function sanitizeEntries(entries, periodType, { allowIncomplete = false } = {}) {
  const rows = Array.isArray(entries) ? entries : [];
  if (!rows.length && !allowIncomplete) throw new Error('At least one book entry is required.');
  if (!rows.length) return [];
  if (allowIncomplete) {
    return rows.map((entry, index) => {
      const bookId = cleanId(entry?.bookId, { max: 80, allowEmpty: true });
      if (!bookId) return null;
      return {
        bookAssignmentId: cleanId(entry?.bookAssignmentId, { max: 80, allowEmpty: true }) || '',
        bookId: String(bookId),
        note: cleanString(entry?.note, { max: 2000, allowEmpty: true }),
        unitCoverage: entry?.unitCoverage || { mode: UNIT_COVERAGE_MODES.COUNT, unitCount: null, tocEntryIds: [] },
        pageCoverage: entry?.pageCoverage || { mode: PAGE_COVERAGE_MODES.PAGES_TEXT, pagesText: '', tocEntryIds: [] },
        usageFrequency: entry?.usageFrequency || null,
        useInNextFourWeeks: entry?.useInNextFourWeeks ?? null
      };
    }).filter(Boolean);
  }
  return rows.map((entry, index) => sanitizeEntry(entry, periodType, index));
}

function normalizeStoredReport(row = {}) {
  const now = new Date().toISOString();
  const periodType = normalizePeriodType(row.periodType);
  return {
    id: cleanId(row.id || generateEntityId('BKCOV'), { max: 80, allowEmpty: false }),
    orgId: cleanId(row.orgId || '', { max: 64, allowEmpty: false }),
    classId: cleanId(row.classId || '', { max: 80, allowEmpty: false }),
    teacherId: cleanId(row.teacherId, { max: 80, allowEmpty: true }),
    teacherName: cleanString(row.teacherName, { max: 200, allowEmpty: true }),
    periodType,
    periodStartDate: cleanDateOnly(row.periodStartDate, { allowEmpty: false }) || '',
    periodEndDate: cleanDateOnly(row.periodEndDate, { allowEmpty: false }) || '',
    sessionId: cleanId(row.sessionId, { max: 80, allowEmpty: true }),
    status: normalizeReportStatus(row.status),
    notes: cleanString(row.notes, { max: 2000, allowEmpty: true }),
    entries: Array.isArray(row.entries) ? row.entries.map((entry, index) => {
      try {
        return sanitizeEntry(entry, periodType, index);
      } catch (_) {
        return entry;
      }
    }) : [],
    audit: {
      createUser: cleanString(row?.audit?.createUser, { max: 80, allowEmpty: true }) || 'SYSTEM',
      createDateTime: cleanString(row?.audit?.createDateTime, { max: 40, allowEmpty: true }) || now,
      lastUpdateUser: cleanString(row?.audit?.lastUpdateUser, { max: 80, allowEmpty: true }) || 'SYSTEM',
      lastUpdateDateTime: cleanString(row?.audit?.lastUpdateDateTime, { max: 40, allowEmpty: true }) || now
    }
  };
}

function sanitizeInput(input, { isUpdate = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid book covering report payload.');
  }
  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  const classId = cleanId(input.classId, { max: 80, allowEmpty: false });
  if (!orgId) throw new Error('Organization is required.');
  if (!classId) throw new Error('Class is required.');

  const periodType = normalizePeriodType(input.periodType);
  const periodStartDate = cleanDateOnly(input.periodStartDate, { allowEmpty: false });
  const periodEndDate = cleanDateOnly(input.periodEndDate, { allowEmpty: false });
  if (!periodStartDate || !periodEndDate) throw new Error('Period start and end dates are required.');
  if (periodStartDate > periodEndDate) throw new Error('Period end date must be on or after start date.');

  const status = normalizeReportStatus(input.status);
  const allowIncomplete = status === REPORT_STATUSES.DRAFT;

  const output = {
    orgId: String(orgId),
    classId: String(classId),
    teacherId: cleanId(input.teacherId, { max: 80, allowEmpty: true }),
    teacherName: cleanString(input.teacherName, { max: 200, allowEmpty: true }),
    periodType,
    periodStartDate,
    periodEndDate,
    sessionId: cleanId(input.sessionId, { max: 80, allowEmpty: true }),
    status,
    notes: cleanString(input.notes, { max: 2000, allowEmpty: true }),
    entries: sanitizeEntries(input.entries, periodType, { allowIncomplete })
  };
  if (!isUpdate && input.id) {
    output.id = cleanId(input.id, { max: 80, allowEmpty: false });
  }
  return output;
}

function validateTocEntryIdsAgainstBook(entries, bookToc = []) {
  const validIds = new Set(
    (Array.isArray(bookToc) ? bookToc : []).map((row) => String(row?.id || '').trim()).filter(Boolean)
  );
  for (const entry of entries) {
    const unitIds = entry?.unitCoverage?.tocEntryIds || [];
    const pageIds = entry?.pageCoverage?.tocEntryIds || [];
    const allIds = [...unitIds, ...pageIds];
    for (const id of allIds) {
      if (!validIds.has(String(id))) {
        throw new Error(`TOC entry "${id}" is not valid for book ${entry.bookId}.`);
      }
    }
  }
}

async function ensureDataFile() {
  if (!fsSync.existsSync(path.dirname(dataPath))) {
    fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
  }
  if (!fsSync.existsSync(dataPath)) {
    fsSync.writeFileSync(dataPath, '[]');
  }
}

async function getAllBookCoveringReports() {
  await ensureDataFile();
  const content = await fs.readFile(dataPath, 'utf8');
  let parsed = [];
  try {
    parsed = JSON.parse(String(content || '[]').replace(/^\uFEFF/, '') || '[]');
  } catch (_) {
    parsed = [];
  }
  return Array.isArray(parsed) ? parsed.map(normalizeStoredReport) : [];
}

async function getBookCoveringReportById(id) {
  const rows = await getAllBookCoveringReports();
  return rows.find((row) => String(row.id) === String(id)) || null;
}

async function addBookCoveringReport(payload) {
  return queueWrite(async () => {
    const rows = await getAllBookCoveringReports();
    const sanitized = sanitizeInput(payload, { isUpdate: false });
    const created = {
      id: sanitized.id || generateEntityId('BKCOV'),
      ...sanitized,
      audit: buildAudit(payload?.audit, payload?.audit?.createUser || 'SYSTEM')
    };
    rows.push(created);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return created;
  });
}

async function updateBookCoveringReport(id, payload) {
  return queueWrite(async () => {
    const rows = await getAllBookCoveringReports();
    const index = rows.findIndex((row) => String(row.id) === String(id));
    if (index < 0) throw new Error('Book covering report not found.');
    const current = rows[index];
    const sanitized = sanitizeInput({
      ...current,
      ...payload,
      orgId: current.orgId,
      classId: payload.classId || current.classId
    }, { isUpdate: true });
    rows[index] = {
      ...current,
      ...sanitized,
      orgId: current.orgId,
      audit: buildAudit(current.audit, payload?.audit?.lastUpdateUser || 'SYSTEM')
    };
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return rows[index];
  });
}

async function deleteBookCoveringReport(id) {
  return queueWrite(async () => {
    const rows = await getAllBookCoveringReports();
    const index = rows.findIndex((row) => String(row.id) === String(id));
    if (index < 0) throw new Error('Book covering report not found.');
    const removed = rows[index];
    rows.splice(index, 1);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return removed;
  });
}

module.exports = {
  PERIOD_TYPES,
  REPORT_STATUSES,
  UNIT_COVERAGE_MODES,
  PAGE_COVERAGE_MODES,
  USAGE_FREQUENCIES,
  normalizePeriodType,
  normalizeReportStatus,
  sanitizeEntry,
  validateTocEntryIdsAgainstBook,
  getAllBookCoveringReports,
  getBookCoveringReportById,
  addBookCoveringReport,
  updateBookCoveringReport,
  deleteBookCoveringReport
};
