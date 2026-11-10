'use strict';

const DUPLICATE_MODES = new Set(['skip', 'replace', 'abort']);

function normalizeHolidayTitle(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function isLeapYear(year) {
  const y = Number(year);
  return (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
}

function shiftHolidayDateToYear(isoDate, targetYear) {
  const token = String(isoDate || '').trim();
  const match = token.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid holiday date: ${token || '(empty)'}`);
  }
  const month = match[2];
  let day = match[3];
  if (month === '02' && day === '29' && !isLeapYear(targetYear)) {
    day = '28';
  }
  return `${String(targetYear)}-${month}-${day}`;
}

function holidayInYear(holiday, year) {
  const date = String(holiday?.date || '').trim();
  return date.startsWith(`${year}-`);
}

function duplicateKey(date, title) {
  return `${String(date)}|${normalizeHolidayTitle(title)}`;
}

function buildTargetIndex(targetHolidays) {
  const map = new Map();
  (Array.isArray(targetHolidays) ? targetHolidays : []).forEach((row) => {
    const date = String(row?.date || '').trim();
    const title = String(row?.title || '').trim();
    if (!date || !title) return;
    map.set(duplicateKey(date, title), row);
  });
  return map;
}

function listDistinctHolidayYears(holidays) {
  const years = new Set();
  (Array.isArray(holidays) ? holidays : []).forEach((row) => {
    const date = String(row?.date || '').trim();
    if (date.length < 4) return;
    const year = date.slice(0, 4);
    if (/^\d{4}$/.test(year)) years.add(year);
  });
  return Array.from(years).sort((a, b) => Number(b) - Number(a));
}

function countHolidaysByYear(holidays) {
  const counts = {};
  (Array.isArray(holidays) ? holidays : []).forEach((row) => {
    const date = String(row?.date || '').trim();
    if (date.length < 4) return;
    const year = date.slice(0, 4);
    if (!/^\d{4}$/.test(year)) return;
    counts[year] = Number(counts[year] || 0) + 1;
  });
  return counts;
}

function normalizeDuplicateMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (!DUPLICATE_MODES.has(mode)) {
    throw new Error('duplicateMode must be skip, replace, or abort.');
  }
  return mode;
}

function assertCopyYears(sourceYear, targetYear) {
  const source = String(sourceYear || '').trim();
  const target = String(targetYear || '').trim();
  if (!/^\d{4}$/.test(source) || !/^\d{4}$/.test(target)) {
    throw new Error('sourceYear and targetYear must be four-digit years.');
  }
  if (source === target) {
    throw new Error('Source year and target year must be different.');
  }
  return { sourceYear: source, targetYear: target };
}

function selectSourceHolidays(holidays, sourceYear) {
  return (Array.isArray(holidays) ? holidays : []).filter((row) => holidayInYear(row, sourceYear));
}

function buildCopyCandidate(sourceRow, targetYear, orgId) {
  const shiftedDate = shiftHolidayDateToYear(sourceRow.date, targetYear);
  const payload = {
    orgId: String(orgId),
    date: shiftedDate,
    title: String(sourceRow.title || '').trim(),
    type: String(sourceRow.type || '').trim() || 'Holiday',
    notes: String(sourceRow.notes || '').trim()
  };
  if (sourceRow.statutoryHolidayPayable === true || sourceRow.statutoryHolidayPayable === false) {
    payload.statutoryHolidayPayable = sourceRow.statutoryHolidayPayable;
  }
  return payload;
}

function formatAbortMessage(conflict) {
  const date = String(conflict?.date || '').trim();
  const title = String(conflict?.title || '').trim() || 'Untitled';
  return `<b>Copy cancelled</b><br>A holiday already exists on <b>${date}</b> with title <b>${title}</b>. Choose Skip or Replace, or remove the existing row first.`;
}

async function copyHolidaysFromYear({
  holidays,
  orgId,
  sourceYear,
  targetYear,
  duplicateMode,
  addFn,
  updateFn
} = {}) {
  const years = assertCopyYears(sourceYear, targetYear);
  const mode = normalizeDuplicateMode(duplicateMode);
  const safeOrgId = String(orgId || '').trim();
  if (!safeOrgId) throw new Error('orgId is required to copy holidays.');

  const sourceRows = selectSourceHolidays(holidays, years.sourceYear);
  const targetRows = selectSourceHolidays(holidays, years.targetYear);
  const targetIndex = buildTargetIndex(targetRows);

  const summary = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };

  if (mode === 'abort') {
    for (const source of sourceRows) {
      const candidate = buildCopyCandidate(source, years.targetYear, safeOrgId);
      const existing = targetIndex.get(duplicateKey(candidate.date, candidate.title));
      if (existing) {
        const err = new Error(formatAbortMessage({ date: candidate.date, title: candidate.title }));
        err.code = 'HOLIDAY_COPY_ABORT';
        err.statusCode = 409;
        throw err;
      }
    }
  }

  for (const source of sourceRows) {
    try {
      const candidate = buildCopyCandidate(source, years.targetYear, safeOrgId);
      const existing = targetIndex.get(duplicateKey(candidate.date, candidate.title));

      if (existing) {
        if (mode === 'skip') {
          summary.skipped += 1;
          continue;
        }
        if (mode === 'replace') {
          await updateFn(existing.id, {
            orgId: existing.orgId || safeOrgId,
            date: candidate.date,
            title: candidate.title,
            type: candidate.type,
            notes: candidate.notes,
            statutoryHolidayPayable: candidate.statutoryHolidayPayable
          });
          summary.updated += 1;
          continue;
        }
      }

      await addFn(candidate);
      summary.created += 1;
      targetIndex.set(duplicateKey(candidate.date, candidate.title), { id: 'new', ...candidate });
    } catch (error) {
      summary.failed += 1;
      summary.errors.push({
        sourceId: source?.id || '',
        date: source?.date || '',
        title: source?.title || '',
        message: String(error?.message || error)
      });
    }
  }

  return summary;
}

module.exports = {
  DUPLICATE_MODES,
  shiftHolidayDateToYear,
  listDistinctHolidayYears,
  countHolidaysByYear,
  normalizeDuplicateMode,
  copyHolidaysFromYear
};
