'use strict';

function normalizeHolidayTitle(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

const MAX_OCCASION_NAMES = 30;
const MAX_RANGE_DAYS = 45;

function parseOccasionNames(raw) {
  const names = String(raw || '')
    .split(',')
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  const unique = [];
  const seen = new Set();
  names.forEach((name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(name);
  });
  if (!unique.length) throw new Error('Enter at least one occasion name (comma-separated).');
  if (unique.length > MAX_OCCASION_NAMES) {
    throw new Error(`Enter at most ${MAX_OCCASION_NAMES} occasion names.`);
  }
  return unique;
}

function assertYear(year) {
  const token = String(year || '').trim();
  if (!/^\d{4}$/.test(token)) throw new Error('Year must be a four-digit value.');
  return token;
}

function parseIsoDateToken(value) {
  const token = String(value || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) return '';
  return token;
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetweenInclusive(start, end) {
  const s = new Date(`${start}T12:00:00Z`);
  const e = new Date(`${end}T12:00:00Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
  const diff = Math.round((e - s) / 86400000);
  return diff + 1;
}

function buildDuplicateIndex(existingHolidays = []) {
  const map = new Set();
  (Array.isArray(existingHolidays) ? existingHolidays : []).forEach((row) => {
    const date = parseIsoDateToken(row?.date);
    const title = normalizeHolidayTitle(row?.title);
    if (!date || !title) return;
    map.add(`${date}|${title}`);
  });
  return map;
}

function expandOccasionRange({
  occasion,
  year,
  existingIndex
}) {
  const name = String(occasion?.name || '').trim();
  const startDate = parseIsoDateToken(occasion?.startDate);
  const endDate = parseIsoDateToken(occasion?.endDate);
  if (!name || !startDate || !endDate) return { items: [], warnings: [`Skipped invalid range for "${name || 'occasion'}".`] };
  if (!startDate.startsWith(`${year}-`) || !endDate.startsWith(`${year}-`)) {
    return { items: [], warnings: [`${name}: dates must fall in ${year}.`] };
  }
  if (endDate < startDate) {
    return { items: [], warnings: [`${name}: end date is before start date.`] };
  }
  const span = daysBetweenInclusive(startDate, endDate);
  if (span > MAX_RANGE_DAYS) {
    return {
      items: [],
      warnings: [`${name}: range spans ${span} days (max ${MAX_RANGE_DAYS}). Narrow the range or split the occasion.`]
    };
  }
  const notes = String(occasion?.notes || '').trim();
  const confidence = String(occasion?.confidence || '').toLowerCase() || 'medium';
  const calendarSystem = String(occasion?.calendarSystem || '').trim() || 'other';
  const items = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    const title = name;
    const duplicate = existingIndex.has(`${cursor}|${normalizeHolidayTitle(title)}`);
    items.push({
      occasionName: name,
      date: cursor,
      title,
      notes,
      confidence,
      calendarSystem,
      selected: !duplicate,
      duplicate
    });
    cursor = addDays(cursor, 1);
  }
  return { items, warnings: [] };
}

function buildPreviewFromAiOccasions({
  aiOccasions = [],
  year,
  existingHolidays = []
} = {}) {
  const targetYear = assertYear(year);
  const existingIndex = buildDuplicateIndex(existingHolidays);
  const previewItems = [];
  const warnings = [];
  const occasionSummaries = [];

  (Array.isArray(aiOccasions) ? aiOccasions : []).forEach((occasion) => {
    const { items, warnings: localWarnings } = expandOccasionRange({
      occasion,
      year: targetYear,
      existingIndex
    });
    warnings.push(...localWarnings);
    if (!items.length) return;
    previewItems.push(...items);
    occasionSummaries.push({
      name: String(occasion?.name || '').trim(),
      startDate: parseIsoDateToken(occasion?.startDate),
      endDate: parseIsoDateToken(occasion?.endDate),
      confidence: String(occasion?.confidence || 'medium'),
      calendarSystem: String(occasion?.calendarSystem || 'other'),
      dayCount: items.length,
      notes: String(occasion?.notes || '').trim()
    });
  });

  return {
    year: targetYear,
    previewItems,
    occasionSummaries,
    warnings
  };
}

module.exports = {
  MAX_OCCASION_NAMES,
  MAX_RANGE_DAYS,
  parseOccasionNames,
  assertYear,
  buildPreviewFromAiOccasions
};