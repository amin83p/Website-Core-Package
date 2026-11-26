'use strict';

const { requireCoreModule } = require('./schoolCoreModuleResolver');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function safeIdsEqual(a, b) {
  try {
    if (typeof idsEqual === 'function') return idsEqual(a, b);
  } catch (_) { /* optional */ }
  return String(a || '').trim() === String(b || '').trim();
}

function normalizeDayKey(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  return raw;
}

function dayKeyToBounds(dayKey) {
  const key = normalizeDayKey(dayKey);
  if (!key) return null;
  const start = new Date(`${key}T00:00:00.000Z`);
  const end = new Date(`${key}T23:59:59.999Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { startMs: start.getTime(), endMs: end.getTime() };
}

function parseTimestampMs(iso) {
  const raw = String(iso || '').trim();
  if (!raw) return NaN;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : NaN;
}

function timestampInInclusiveRange(iso, fromDay, toDay) {
  const ms = parseTimestampMs(iso);
  if (!Number.isFinite(ms)) return false;
  const from = dayKeyToBounds(fromDay);
  const to = dayKeyToBounds(toDay);
  if (!from && !to) return true;
  const startMs = from ? from.startMs : -Infinity;
  const endMs = to ? to.endMs : Infinity;
  if (startMs > endMs) return false;
  return ms >= startMs && ms <= endMs;
}

function rowMatchesDateRange(row, dateFrom, dateTo) {
  const from = normalizeDayKey(dateFrom);
  const to = normalizeDayKey(dateTo);
  if (!from && !to) return true;
  const created = row?.audit?.createDateTime;
  const modified = row?.audit?.lastUpdateDateTime || row?.audit?.createDateTime;
  return timestampInInclusiveRange(created, from, to)
    || timestampInInclusiveRange(modified, from, to);
}

function normalizeIdList(values) {
  if (!values) return [];
  const list = Array.isArray(values) ? values : String(values).split(',');
  return [...new Set(list.map((v) => toPublicId(v) || String(v || '').trim()).filter(Boolean))];
}

function rowMatchesAuthorIds(row, authorUserIds) {
  const ids = normalizeIdList(authorUserIds);
  if (!ids.length) return true;
  const author = toPublicId(row?.authorUserId) || String(row?.authorUserId || '').trim();
  const createdBy = toPublicId(row?.audit?.createdBy) || String(row?.audit?.createdBy || '').trim();
  return ids.some((id) => safeIdsEqual(id, author) || safeIdsEqual(id, createdBy));
}

function rowMatchesStatuses(row, statuses) {
  const list = (Array.isArray(statuses) ? statuses : String(statuses || '').split(','))
    .map((s) => String(s || '').trim().toLowerCase())
    .filter(Boolean);
  if (!list.length) return true;
  return list.includes(String(row?.status || '').toLowerCase());
}

function rowMatchesText(row, text) {
  const needle = String(text || '').trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    row?.word,
    row?.meaning,
    row?.authorName,
    row?.pronunciation
  ].map((v) => String(v || '').toLowerCase()).join(' ');
  return hay.includes(needle);
}

function applyReviewFilters(rows, filters = {}) {
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((row) => {
    if (!rowMatchesDateRange(row, filters.dateFrom, filters.dateTo)) return false;
    if (!rowMatchesAuthorIds(row, filters.authorUserIds)) return false;
    if (!rowMatchesStatuses(row, filters.statuses)) return false;
    if (!rowMatchesText(row, filters.text)) return false;
    return true;
  });
}

module.exports = {
  normalizeDayKey,
  dayKeyToBounds,
  timestampInInclusiveRange,
  rowMatchesDateRange,
  rowMatchesAuthorIds,
  rowMatchesStatuses,
  rowMatchesText,
  applyReviewFilters,
  normalizeIdList
};