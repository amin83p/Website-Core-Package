const { DEFAULT_SESSION_STATUS_TEMPLATES } = require('../../models/school/sessionStatusModel');
const schoolRepositories = require('../../repositories/school');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const { evaluateSimpleFormula } = requireCoreModule('MVC/utils/simpleFormulaEvaluator');

const CACHE_TTL_MS = 60 * 1000;
const statusCache = new Map();

function normalizeStatusCode(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function isHolidayOff(notes) {
  const normalized = String(notes || '').trim().toLowerCase();
  return normalized === 'holiday/off' || normalized === 'holiday off' || normalized === 'holiday';
}

function normalizeSessionStatus(status, notes = '') {
  if (isHolidayOff(notes)) return 'holiday';
  return normalizeStatusCode(status) || 'scheduled';
}

function getCacheKey(orgId) {
  return toPublicId(orgId) || '__GLOBAL__';
}

function getVirtualHolidayDefinition() {
  return {
    id: 'VIRTUAL_HOLIDAY',
    orgId: 'SYSTEM',
    code: 'holiday',
    label: 'Holiday',
    description: 'Session marked as holiday/off.',
    timesheetFormula: '0',
    isFinal: true,
    makeUpRequired: false,
    excludeFromAttendance: true,
    excludeFromTeacherIndex: true,
    excludeFromStudentIndex: true,
    active: true,
    sortOrder: 9998,
    colorBg: '#fff3cd',
    colorText: '#664d03',
    colorBorder: '#ffe69c'
  };
}

function generateStatusId() {
  const year = new Date().getFullYear();
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `SSS-${year}-${rand}`;
}

function buildDefaultFallbackByCode() {
  const out = new Map();
  (DEFAULT_SESSION_STATUS_TEMPLATES || []).forEach((row) => {
    const code = normalizeStatusCode(row.code);
    if (!code) return;
    out.set(code, { ...row, code });
  });
  out.set('holiday', getVirtualHolidayDefinition());
  return out;
}

function sortStatusRows(a, b) {
  const orderA = Number(a?.sortOrder || 0);
  const orderB = Number(b?.sortOrder || 0);
  if (orderA !== orderB) return orderA - orderB;
  return String(a?.label || a?.code || '').localeCompare(String(b?.label || b?.code || ''));
}

async function buildStatusBundle(orgId, { includeInactive = false } = {}) {
  const all = await schoolRepositories.sessionStatuses.list({
    query: {},
    scope: { canViewAll: true }
  });
  const targetOrgId = toPublicId(orgId) || '';
  const fallbackByCode = buildDefaultFallbackByCode();

  const applicable = all.filter((row) => {
    const rowOrg = toPublicId(row?.orgId) || '';
    if (rowOrg === 'SYSTEM') return true;
    if (!targetOrgId) return false;
    return idsEqual(rowOrg, targetOrgId);
  });

  const byCode = new Map();
  applicable.forEach((row) => {
    const code = normalizeStatusCode(row?.code);
    if (!code) return;
    if (!includeInactive && row.active === false) return;

    const existing = byCode.get(code);
    const rowOrg = toPublicId(row?.orgId) || '';
    const existingOrg = toPublicId(existing?.orgId) || '';

    if (!existing) {
      byCode.set(code, { ...row, code });
      return;
    }

    // org row overrides SYSTEM fallback
    if (existingOrg === 'SYSTEM' && rowOrg !== 'SYSTEM') {
      byCode.set(code, { ...row, code });
      return;
    }

    // keep the latest update for same org scope
    const rowTs = Date.parse(row?.audit?.lastUpdateDateTime || row?.audit?.createDateTime || 0) || 0;
    const existingTs = Date.parse(existing?.audit?.lastUpdateDateTime || existing?.audit?.createDateTime || 0) || 0;
    if (rowTs >= existingTs) byCode.set(code, { ...row, code });
  });

  fallbackByCode.forEach((fallback, code) => {
    if (!byCode.has(code)) byCode.set(code, { ...fallback, code });
  });

  const list = [...byCode.values()].sort(sortStatusRows);
  return { list, byCode };
}

async function ensureOrgDefaultSessionStatuses(orgId, userId = 'SYSTEM') {
  const targetOrgId = toPublicId(orgId) || '';
  if (!targetOrgId) throw new Error('Organization is required.');

  const existing = await schoolRepositories.sessionStatuses.list({
    query: { orgId__eq: targetOrgId },
    scope: { canViewAll: true }
  });
  if ((existing || []).length > 0) return existing;

  const now = new Date().toISOString();
  const defaults = (DEFAULT_SESSION_STATUS_TEMPLATES || []).map((tpl) => ({
    id: generateStatusId(),
    orgId: targetOrgId,
    ...tpl,
    audit: {
      createUser: String(userId || 'SYSTEM'),
      createDateTime: now,
      lastUpdateUser: String(userId || 'SYSTEM'),
      lastUpdateDateTime: now
    }
  }));

  const created = [];
  for (const row of defaults) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const saved = await schoolRepositories.sessionStatuses.create(row);
      if (saved) created.push(saved);
    } catch (error) {
      const message = String(error?.message || '').toLowerCase();
      if (!message.includes('already exists')) throw error;
    }
  }

  clearStatusCache(targetOrgId);
  if (created.length) return created;
  return await schoolRepositories.sessionStatuses.list({
    query: { orgId__eq: targetOrgId },
    scope: { canViewAll: true }
  });
}

async function getStatusBundle(orgId, { includeInactive = false, forceRefresh = false } = {}) {
  const key = getCacheKey(orgId);
  const now = Date.now();
  const cached = statusCache.get(key);
  if (!forceRefresh && !includeInactive && cached && (now - cached.at) <= CACHE_TTL_MS) {
    return cached.bundle;
  }

  const bundle = await buildStatusBundle(orgId, { includeInactive });
  if (!includeInactive) {
    statusCache.set(key, { at: now, bundle });
  }
  return bundle;
}

async function getStatusDefinitions(orgId, options = {}) {
  const bundle = await getStatusBundle(orgId, options);
  return bundle.list;
}

async function getStatusMap(orgId, options = {}) {
  const bundle = await getStatusBundle(orgId, options);
  return bundle.byCode;
}

async function getClientStatusMeta(orgId, options = {}) {
  const definitions = await getStatusDefinitions(orgId, options);
  return buildClientStatusMeta(definitions);
}

function getStatusMetaMap(statusMeta = []) {
  const map = new Map();
  (Array.isArray(statusMeta) ? statusMeta : []).forEach((row) => {
    const code = normalizeStatusCode(row?.code);
    if (!code) return;
    map.set(code, row);
  });
  return map;
}

function getFallbackFormula(statusCode) {
  const code = normalizeStatusCode(statusCode);
  if (code === 'cancelled' || code === 'holiday') return '0';
  return 'duration';
}

function resolveStatusDefinition(statusMap, { status, notes = '' } = {}) {
  const map = statusMap instanceof Map ? statusMap : new Map();
  const normalized = normalizeSessionStatus(status, notes);
  const definition = map.get(normalized) || null;
  return { normalized, definition };
}

function isFinalStatusByMap(statusMap, { status, notes = '' } = {}) {
  const { normalized, definition } = resolveStatusDefinition(statusMap, { status, notes });
  if (normalized === 'holiday') return true;
  if (!definition) return normalized !== 'scheduled';
  return definition.isFinal === true;
}

function shouldExcludeFromAttendanceByMap(statusMap, { status, notes = '' } = {}) {
  const { normalized, definition } = resolveStatusDefinition(statusMap, { status, notes });
  if (normalized === 'holiday') return true;
  if (!definition) return normalized === 'cancelled';
  return definition.excludeFromAttendance === true || definition.makeUpRequired === true;
}

function shouldExcludeFromTeacherIndexByMap(statusMap, { status, notes = '' } = {}) {
  const { normalized, definition } = resolveStatusDefinition(statusMap, { status, notes });
  if (normalized === 'holiday') return true;
  if (!definition) return normalized === 'cancelled';
  return definition.excludeFromTeacherIndex === true || definition.makeUpRequired === true;
}

function shouldExcludeFromStudentIndexByMap(statusMap, { status, notes = '' } = {}) {
  const { normalized, definition } = resolveStatusDefinition(statusMap, { status, notes });
  if (normalized === 'holiday') return true;
  if (!definition) return normalized === 'cancelled';
  return definition.excludeFromStudentIndex === true || definition.makeUpRequired === true;
}

function evaluateTimesheetFormula(formula, durationHours) {
  const duration = Number(durationHours);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  if (safeDuration <= 0) return 0;
  const expression = String(formula || 'duration').trim() || 'duration';
  const raw = evaluateSimpleFormula(expression, { duration: safeDuration, hours: safeDuration });
  if (!Number.isFinite(raw)) return 0;
  if (raw < 0) return 0;
  return Number(raw.toFixed(2));
}

function calculateTimesheetHoursByMap(statusMap, { status, notes = '', durationHours = 0 } = {}) {
  const { normalized, definition } = resolveStatusDefinition(statusMap, { status, notes });
  if (normalized === 'holiday') return 0;
  const formula = String(definition?.timesheetFormula || getFallbackFormula(normalized));
  try {
    return evaluateTimesheetFormula(formula, durationHours);
  } catch (_) {
    return evaluateTimesheetFormula(getFallbackFormula(normalized), durationHours);
  }
}

async function calculateTimesheetHours({ orgId, status, notes = '', durationHours = 0 }) {
  const normalized = normalizeSessionStatus(status, notes);
  if (normalized === 'holiday') return 0;

  const statusMap = await getStatusMap(orgId);
  return calculateTimesheetHoursByMap(statusMap, { status: normalized, notes, durationHours });
}

async function isFinalStatus({ orgId, status, notes = '' }) {
  const normalized = normalizeSessionStatus(status, notes);
  if (normalized === 'holiday') return true;
  const statusMap = await getStatusMap(orgId);
  return isFinalStatusByMap(statusMap, { status: normalized, notes });
}

async function shouldExcludeFromAttendance({ orgId, status, notes = '' }) {
  const normalized = normalizeSessionStatus(status, notes);
  if (normalized === 'holiday') return true;
  const statusMap = await getStatusMap(orgId);
  return shouldExcludeFromAttendanceByMap(statusMap, { status: normalized, notes });
}

async function shouldExcludeFromTeacherIndex({ orgId, status, notes = '' }) {
  const normalized = normalizeSessionStatus(status, notes);
  if (normalized === 'holiday') return true;
  const statusMap = await getStatusMap(orgId);
  return shouldExcludeFromTeacherIndexByMap(statusMap, { status: normalized, notes });
}

async function shouldExcludeFromStudentIndex({ orgId, status, notes = '' }) {
  const normalized = normalizeSessionStatus(status, notes);
  if (normalized === 'holiday') return true;
  const statusMap = await getStatusMap(orgId);
  return shouldExcludeFromStudentIndexByMap(statusMap, { status: normalized, notes });
}

function buildClientStatusMeta(definitions) {
  const list = Array.isArray(definitions) ? definitions : [];
  return list.map((row) => ({
    code: normalizeStatusCode(row?.code),
    label: String(row?.label || row?.code || ''),
    timesheetFormula: String(row?.timesheetFormula || ''),
    isFinal: row?.isFinal === true,
    makeUpRequired: row?.makeUpRequired === true,
    excludeFromAttendance: row?.excludeFromAttendance === true,
    excludeFromTeacherIndex: row?.excludeFromTeacherIndex === true,
    excludeFromStudentIndex: row?.excludeFromStudentIndex === true,
    active: row?.active !== false,
    sortOrder: Number(row?.sortOrder || 0),
    colorBg: String(row?.colorBg || '#e2e3e5'),
    colorText: String(row?.colorText || '#41464b'),
    colorBorder: String(row?.colorBorder || '#c6c8ca')
  })).filter((row) => row.code);
}

function clearStatusCache(orgId = null) {
  if (orgId) {
    statusCache.delete(getCacheKey(orgId));
    return;
  }
  statusCache.clear();
}

module.exports = {
  normalizeStatusCode,
  normalizeSessionStatus,
  ensureOrgDefaultSessionStatuses,
  getStatusDefinitions,
  getStatusMap,
  getClientStatusMeta,
  getStatusMetaMap,
  resolveStatusDefinition,
  isFinalStatusByMap,
  shouldExcludeFromAttendanceByMap,
  shouldExcludeFromTeacherIndexByMap,
  shouldExcludeFromStudentIndexByMap,
  calculateTimesheetHoursByMap,
  buildClientStatusMeta,
  calculateTimesheetHours,
  isFinalStatus,
  shouldExcludeFromAttendance,
  shouldExcludeFromTeacherIndex,
  shouldExcludeFromStudentIndex,
  clearStatusCache
};
