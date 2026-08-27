const { DEFAULT_SESSION_STATUS_TEMPLATES } = require('../../models/school/sessionStatusModel');
const schoolRepositories = require('../../repositories/school');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const { evaluateSimpleFormula } = requireCoreModule('MVC/utils/simpleFormulaEvaluator');
const { resolveOrgTodayFromContext } = requireCoreModule('MVC/utils/timezoneUtils');

const CACHE_TTL_MS = 60 * 1000;
const statusCache = new Map();

function normalizeStatusCode(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeSessionStatus(status, notes = '') {
  void notes;
  const normalized = normalizeStatusCode(status) || 'scheduled';
  if (normalized === 'holiday') return 'cancelled';
  return normalized;
}

function getCacheKey(orgId) {
  return toPublicId(orgId) || '__GLOBAL__';
}

function generateStatusId(orgToday = '') {
  const year = resolveOrgTodayFromContext({ orgToday }).slice(0, 4);
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
  return out;
}

function sortStatusRows(a, b) {
  const orderA = Number(a?.sortOrder || 0);
  const orderB = Number(b?.sortOrder || 0);
  if (orderA !== orderB) return orderA - orderB;
  return String(a?.label || a?.code || '').localeCompare(String(b?.label || b?.code || ''));
}

async function buildStatusBundle(orgId, { includeInactive = false } = {}) {
  const repository = Object.prototype.hasOwnProperty.call(schoolRepositories, 'sessionStatuses') ? schoolRepositories.sessionStatuses : null;
  const all = repository && typeof repository.list === 'function'
    ? await repository.list({
      query: {},
      scope: { canViewAll: true }
    })
    : [];
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
    if (code === 'holiday') return;
    if (!byCode.has(code)) byCode.set(code, { ...fallback, code });
  });
  byCode.delete('holiday');

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
  const orgRows = Array.isArray(existing) ? existing : [];
  const existingCodes = new Set(
    orgRows.map((row) => normalizeStatusCode(row?.code)).filter(Boolean)
  );
  const templatesToCreate = (DEFAULT_SESSION_STATUS_TEMPLATES || []).filter((tpl) => {
    const code = normalizeStatusCode(tpl?.code);
    return code && !existingCodes.has(code);
  });
  if (!templatesToCreate.length) return orgRows;

  const now = new Date().toISOString();
  const defaults = templatesToCreate.map((tpl) => ({
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
  if (created.length) {
    return [...orgRows, ...created];
  }
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
  if (code === 'cancelled') return '0';
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
  if (!definition) return normalized !== 'scheduled';
  return definition.isFinal === true;
}

function isSessionCompletionStatusByMap(statusMap, { status, notes = '' } = {}) {
  const { definition } = resolveStatusDefinition(statusMap, { status, notes });
  if (!definition) return normalizeSessionStatus(status, notes) === 'completed';
  return definition.isFinal === true
    && definition.makeUpRequired !== true
    && definition.mergedSessionRequired !== true
    && definition.excludeFromAttendance !== true;
}

function shouldForceNotApplicableAttendanceByMap(statusMap, { status, notes = '' } = {}) {
  const { definition } = resolveStatusDefinition(statusMap, { status, notes });
  return definition?.makeUpRequired === true;
}

function isMakeUpRequiredByMap(statusMap, { status, notes = '' } = {}) {
  const { definition } = resolveStatusDefinition(statusMap, { status, notes });
  return definition?.makeUpRequired === true;
}

function isMergedSessionRequiredByMap(statusMap, { status, notes = '' } = {}) {
  const { definition } = resolveStatusDefinition(statusMap, { status, notes });
  return definition?.mergedSessionRequired === true;
}

function shouldExcludeFromAttendanceByMap(statusMap, { status, notes = '' } = {}) {
  const { normalized, definition } = resolveStatusDefinition(statusMap, { status, notes });
  if (!definition) return normalized === 'cancelled';
  if (definition.makeUpRequired === true) return false;
  return definition.excludeFromAttendance === true;
}

function buildForceNotApplicableAttendanceSessionKeys(statusMap, sessions = []) {
  const out = new Set();
  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    if (!shouldForceNotApplicableAttendanceByMap(statusMap, {
      status: session?.status,
      notes: session?.notes
    })) return;
    const sessionId = toPublicId(session?.sessionId || session?.id || '');
    const date = String(session?.date || session?.sessionDate || '').trim();
    if (sessionId) out.add(sessionId);
    if (date) out.add(date);
  });
  return out;
}


function shouldExcludeFromTeacherIndexByMap(statusMap, { status, notes = '' } = {}) {
  const { normalized, definition } = resolveStatusDefinition(statusMap, { status, notes });
  if (!definition) return normalized === 'cancelled';
  return definition.excludeFromTeacherIndex === true || definition.makeUpRequired === true;
}

function shouldExcludeFromStudentIndexByMap(statusMap, { status, notes = '' } = {}) {
  const { normalized, definition } = resolveStatusDefinition(statusMap, { status, notes });
  if (!definition) return normalized === 'cancelled';
  return definition.excludeFromStudentIndex === true || definition.makeUpRequired === true;
}

function normalizeMakeupDurationPercent(value, fallback = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Math.max(1, Math.min(100, Math.round(Number(fallback) || 100)));
  return Math.max(1, Math.min(100, Math.round(n)));
}

function resolveMakeupSchedulingContext(session = {}, definition = null) {
  const scheduling = session?.makeupScheduling && typeof session.makeupScheduling === 'object'
    ? session.makeupScheduling
    : {};
  const makeupPercent = normalizeMakeupDurationPercent(
    scheduling.durationPercent ?? definition?.makeupDurationPercent,
    definition?.makeupDurationPercent ?? 100
  );
  return { makeupPercent };
}

function calculateMakeupSessionDurationHours(originalDurationHours, makeupDurationPercent) {
  const safeOriginal = Number(originalDurationHours);
  if (!Number.isFinite(safeOriginal) || safeOriginal <= 0) return 0;
  const percent = normalizeMakeupDurationPercent(makeupDurationPercent, 100);
  return Number((safeOriginal * (percent / 100)).toFixed(4));
}

function addMinutesToClockTime(startTime, minutesToAdd) {
  const start = String(startTime || '').trim();
  if (!/^\d{2}:\d{2}$/.test(start)) return '';
  const [h, m] = start.split(':').map(Number);
  const totalMinutes = (h * 60) + m + Number(minutesToAdd || 0);
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return '';
  const endH = Math.floor(totalMinutes / 60) % 24;
  const endM = totalMinutes % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
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

function calculateTimesheetHoursByMap(statusMap, { status, notes = '', durationHours = 0, session = null } = {}) {
  const { normalized, definition } = resolveStatusDefinition(statusMap, { status, notes });
  const safeDuration = Number(durationHours);
  const effectiveDuration = Number.isFinite(safeDuration) && safeDuration > 0 ? safeDuration : 0;
  const formula = String(definition?.timesheetFormula || getFallbackFormula(normalized));
  try {
    return evaluateTimesheetFormula(formula, effectiveDuration);
  } catch (_) {
    return evaluateTimesheetFormula(getFallbackFormula(normalized), effectiveDuration);
  }
}

async function calculateTimesheetHours({ orgId, status, notes = '', durationHours = 0, session = null }) {
  const normalized = normalizeSessionStatus(status, notes);
  const statusMap = await getStatusMap(orgId);
  return calculateTimesheetHoursByMap(statusMap, { status: normalized, notes, durationHours, session });
}

async function isFinalStatus({ orgId, status, notes = '' }) {
  const normalized = normalizeSessionStatus(status, notes);
  const statusMap = await getStatusMap(orgId);
  return isFinalStatusByMap(statusMap, { status: normalized, notes });
}

async function shouldExcludeFromAttendance({ orgId, status, notes = '' }) {
  const normalized = normalizeSessionStatus(status, notes);
  const statusMap = await getStatusMap(orgId);
  return shouldExcludeFromAttendanceByMap(statusMap, { status: normalized, notes });
}

async function shouldExcludeFromTeacherIndex({ orgId, status, notes = '' }) {
  const normalized = normalizeSessionStatus(status, notes);
  const statusMap = await getStatusMap(orgId);
  return shouldExcludeFromTeacherIndexByMap(statusMap, { status: normalized, notes });
}

async function shouldExcludeFromStudentIndex({ orgId, status, notes = '' }) {
  const normalized = normalizeSessionStatus(status, notes);
  const statusMap = await getStatusMap(orgId);
  return shouldExcludeFromStudentIndexByMap(statusMap, { status: normalized, notes });
}

function normalizeAccessType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'admins' || normalized === 'admin') return 'admins';
  return 'users';
}

function normalizeClassCapacity(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) return 'both';
  if (normalized === 'group') return 'group';
  if (normalized === 'one_on_one' || normalized === '1_on_1' || normalized === 'oneonone') return 'one_on_one';
  return 'both';
}

function statusMatchesCapacityMode(statusRow, capacityMode) {
  const mode = String(capacityMode || '').trim().toLowerCase();
  if (!mode || mode === 'both') return true;
  const capacity = normalizeClassCapacity(statusRow?.classCapacity);
  if (capacity === 'both') return true;
  return capacity === mode;
}

function buildClientStatusMeta(definitions) {
  const list = Array.isArray(definitions) ? definitions : [];
  return list.map((row) => ({
    code: normalizeStatusCode(row?.code),
    label: String(row?.label || row?.code || ''),
    timesheetFormula: String(row?.timesheetFormula || ''),
    isFinal: row?.isFinal === true,
    makeUpRequired: row?.makeUpRequired === true,
    makeupDurationPercent: normalizeMakeupDurationPercent(row?.makeupDurationPercent, 100),
    mergedSessionRequired: row?.mergedSessionRequired === true,
    excludeFromAttendance: row?.excludeFromAttendance === true,
    excludeFromTeacherIndex: row?.excludeFromTeacherIndex === true,
    excludeFromStudentIndex: row?.excludeFromStudentIndex === true,
    active: row?.active !== false,
    sortOrder: Number(row?.sortOrder || 0),
    accessType: normalizeAccessType(row?.accessType),
    classCapacity: normalizeClassCapacity(row?.classCapacity),
    colorBg: String(row?.colorBg || '#e2e3e5'),
    colorText: String(row?.colorText || '#41464b'),
    colorBorder: String(row?.colorBorder || '#c6c8ca')
  })).filter((row) => row.code && row.code !== 'holiday');
}

function filterSelectableStatusMeta(meta = [], options = {}) {
  const rows = Array.isArray(meta) ? meta : [];
  const allowAdminStatuses = options.allowAdminStatuses === true;
  if (allowAdminStatuses) return rows.slice();
  return rows.filter((row) => normalizeAccessType(row?.accessType) !== 'admins');
}

function filterSelectableStatusMetaByCapacity(meta = [], options = {}) {
  const capacityMode = String(options?.capacityMode || '').trim().toLowerCase();
  if (!capacityMode) return Array.isArray(meta) ? meta.slice() : [];
  const rows = Array.isArray(meta) ? meta : [];
  return rows.filter((row) => statusMatchesCapacityMode(row, capacityMode));
}

function assertStatusSelectableByAccess(statusCode, statusMap = new Map(), options = {}) {
  const normalized = normalizeStatusCode(statusCode);
  if (!normalized) throw new Error('Session status is required.');
  const row = statusMap instanceof Map
    ? statusMap.get(normalized)
    : null;
  if (!row) throw new Error('Invalid session status.');
  if (options.allowAdminStatuses === true) return;
  if (normalizeAccessType(row?.accessType) === 'admins') {
    throw new Error('This session status is restricted to school session administrators.');
  }
  const capacityMode = String(options?.capacityMode || '').trim().toLowerCase();
  if (capacityMode && !statusMatchesCapacityMode(row, capacityMode)) {
    throw new Error('This session status is not available for this session capacity type.');
  }
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
  isSessionCompletionStatusByMap,
  isMakeUpRequiredByMap,
  isMergedSessionRequiredByMap,
  shouldForceNotApplicableAttendanceByMap,
  buildForceNotApplicableAttendanceSessionKeys,
  shouldExcludeFromAttendanceByMap,
  shouldExcludeFromTeacherIndexByMap,
  shouldExcludeFromStudentIndexByMap,
  calculateTimesheetHoursByMap,
  buildClientStatusMeta,
  normalizeAccessType,
  normalizeClassCapacity,
  statusMatchesCapacityMode,
  filterSelectableStatusMeta,
  filterSelectableStatusMetaByCapacity,
  assertStatusSelectableByAccess,
  calculateTimesheetHours,
  normalizeMakeupDurationPercent,
  resolveMakeupSchedulingContext,
  calculateMakeupSessionDurationHours,
  addMinutesToClockTime,
  isFinalStatus,
  shouldExcludeFromAttendance,
  shouldExcludeFromTeacherIndex,
  shouldExcludeFromStudentIndex,
  clearStatusCache
};
