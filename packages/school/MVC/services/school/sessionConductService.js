/**
 * Session class-conduct helpers for optional + report-gated conduct flows.
 * Ratings remain on session.roster[]; readiness is a session-level flag.
 */

const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const CONDUCT_PERCENT_KEYS = Object.freeze([
  'classEffortPercent',
  'classParticipationPercent',
  'respectsTeachersPercent',
  'respectsStudentsPercent'
]);

function personKey(value) {
  return String(toPublicId(value) || value || '').trim();
}

/**
 * Parse ready flag from request body. Defaults to true (Step 1 / legacy clients).
 * @param {unknown} value
 * @param {boolean} [defaultValue=true]
 * @returns {boolean}
 */
function parseConductReadyFlag(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') return defaultValue === true;
  if (typeof value === 'boolean') return value;
  const token = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
  return defaultValue === true;
}

/**
 * Normalize a conduct percent. Empty / N/A → null when allowEmpty is true.
 * @param {unknown} value
 * @param {{ allowEmpty?: boolean, fallback?: number|null }} [opts]
 * @returns {number|null}
 */
function normalizeConductPercent(value, opts = {}) {
  const allowEmpty = opts.allowEmpty === true;
  const raw = value === undefined || value === null ? '' : value;
  const token = String(raw).trim().toLowerCase();
  if (allowEmpty && (token === '' || token === 'n/a' || token === 'na' || token === 'null')) {
    return null;
  }
  const fallbackNumber = Number(opts.fallback);
  const safeFallback = Number.isFinite(fallbackNumber) ? fallbackNumber : (allowEmpty ? null : 100);
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    if (allowEmpty && (safeFallback === null || safeFallback === undefined)) return null;
    const fb = Number.isFinite(safeFallback) ? safeFallback : 100;
    return Math.max(0, Math.min(100, Math.round(fb * 100) / 100));
  }
  return Math.max(0, Math.min(100, Math.round(n * 100) / 100));
}

function extractConductPercents(row = {}) {
  const out = {};
  CONDUCT_PERCENT_KEYS.forEach((key) => {
    out[key] = normalizeConductPercent(row?.[key], { allowEmpty: true, fallback: null });
  });
  return out;
}

function rosterRowHasRatedConduct(row = {}) {
  return CONDUCT_PERCENT_KEYS.some((key) => {
    const value = normalizeConductPercent(row?.[key], { allowEmpty: true, fallback: null });
    return value !== null;
  });
}

function rosterRowHasSavedConduct(row = {}) {
  if (row?.conductSavedAt) return true;
  return rosterRowHasRatedConduct(row);
}

function parseDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

/**
 * Union report period dates from session-scoped assignments.
 * @param {Iterable<object>|Map} assignments
 * @param {string} sessionId
 * @returns {{ startDate: string, dueDate: string }}
 */
function resolveReportPeriodForSession(assignments, sessionId) {
  const cleanSessionId = String(sessionId || '').trim();
  const list = assignments instanceof Map
    ? Array.from(assignments.values())
    : (Array.isArray(assignments) ? assignments : []);
  let startDate = '';
  let dueDate = '';
  list.forEach((assignment) => {
    if (!cleanSessionId) return;
    const topSessionId = String(assignment?.sessionId || '').trim();
    const rows = Array.isArray(assignment?.targetRows) ? assignment.targetRows : [];
    const matches = idsEqual(topSessionId, cleanSessionId)
      || rows.some((row) => idsEqual(row?.sessionId, cleanSessionId));
    if (!matches) return;
    const start = parseDateOnly(assignment?.reportStartDate)
      || parseDateOnly(rows.find((row) => idsEqual(row?.sessionId, cleanSessionId))?.reportStartDate);
    const due = parseDateOnly(assignment?.reportDueDate || assignment?.dueDate)
      || parseDateOnly(rows.find((row) => idsEqual(row?.sessionId, cleanSessionId))?.reportDueDate
        || rows.find((row) => idsEqual(row?.sessionId, cleanSessionId))?.dueDate);
    if (start && (!startDate || start < startDate)) startDate = start;
    if (due && (!dueDate || due > dueDate)) dueDate = due;
  });
  return { startDate, dueDate };
}

/**
 * Resolve display/prefill conduct percents for one student.
 * Prefer this session's saved ratings; else latest rated values from other sessions in the report period; else all N/A (null).
 * @param {{ personId: string, currentSession?: object, allSessions?: object[], periodStart?: string, periodDue?: string }} args
 * @returns {{ classEffortPercent: number|null, classParticipationPercent: number|null, respectsTeachersPercent: number|null, respectsStudentsPercent: number|null, source: string }}
 */
function resolveConductPrefillForStudent({
  personId,
  currentSession = null,
  allSessions = [],
  periodStart = '',
  periodDue = ''
} = {}) {
  const pid = personKey(personId);
  const empty = {
    classEffortPercent: null,
    classParticipationPercent: null,
    respectsTeachersPercent: null,
    respectsStudentsPercent: null,
    source: 'default_na'
  };
  if (!pid) return empty;

  const currentRoster = Array.isArray(currentSession?.roster) ? currentSession.roster : [];
  const currentRow = currentRoster.find((row) => personKey(row?.personId) === pid);
  if (currentRow && rosterRowHasSavedConduct(currentRow)) {
    return { ...extractConductPercents(currentRow), source: 'session' };
  }

  const start = parseDateOnly(periodStart);
  const due = parseDateOnly(periodDue);
  const currentSessionId = String(currentSession?.sessionId || currentSession?.id || '').trim();
  const candidates = (Array.isArray(allSessions) ? allSessions : [])
    .filter((session) => {
      const sid = String(session?.sessionId || session?.id || '').trim();
      if (currentSessionId && (idsEqual(sid, currentSessionId) || sid === currentSessionId)) return false;
      const date = parseDateOnly(session?.date);
      if (!date) return false;
      if (start && date < start) return false;
      if (due && date > due) return false;
      return true;
    })
    .sort((a, b) => {
      const dateCompare = parseDateOnly(b?.date).localeCompare(parseDateOnly(a?.date));
      if (dateCompare) return dateCompare;
      return String(b?.startTime || '').localeCompare(String(a?.startTime || ''));
    });

  for (const session of candidates) {
    const row = (Array.isArray(session?.roster) ? session.roster : [])
      .find((entry) => personKey(entry?.personId) === pid);
    if (row && rosterRowHasRatedConduct(row)) {
      return { ...extractConductPercents(row), source: 'period' };
    }
  }

  return empty;
}

/**
 * Prefill map keyed by personId for a session roster.
 * @returns {Map<string, object>}
 */
function buildConductPrefillMap({
  roster = [],
  currentSession = null,
  allSessions = [],
  periodStart = '',
  periodDue = ''
} = {}) {
  const map = new Map();
  (Array.isArray(roster) ? roster : []).forEach((row) => {
    const pid = personKey(row?.personId);
    if (!pid || map.has(pid)) return;
    map.set(pid, resolveConductPrefillForStudent({
      personId: pid,
      currentSession,
      allSessions,
      periodStart,
      periodDue
    }));
  });
  return map;
}

function isSessionConductReady(session) {
  return session?.conductReadyForReports === true
    || String(session?.conductReadyForReports || '').trim().toLowerCase() === 'true';
}

function assertSessionConductReadyForReportsOrThrow(session, contextLabel = 'this session') {
  if (isSessionConductReady(session)) return;
  const err = new Error(
    `Class conduct must be completed for ${contextLabel} before opening or filling reports.`
  );
  err.code = 'CONDUCT_REQUIRED_BEFORE_REPORTS';
  err.statusCode = 400;
  throw err;
}

/**
 * Apply incoming conduct roster rows onto an existing session roster.
 * @param {object} session
 * @param {Array<object>} incomingRoster
 * @param {{ ready?: boolean, userId?: string }} [options]
 * @returns {object} mutated session
 */
function applyConductRosterToSession(session, incomingRoster, options = {}) {
  if (!session || typeof session !== 'object') throw new Error('Session is required.');
  const existingRoster = Array.isArray(session.roster) ? session.roster : [];
  const incoming = Array.isArray(incomingRoster) ? incomingRoster : [];
  const byPerson = new Map();
  existingRoster.forEach((row) => {
    const pid = personKey(row?.personId);
    if (pid) byPerson.set(pid, { ...row });
  });

  const savedAt = new Date().toISOString();
  incoming.forEach((inc) => {
    const pid = personKey(inc?.personId);
    if (!pid) return;
    const existing = byPerson.get(pid) || { personId: pid };
    const next = { ...existing, personId: existing.personId || pid };
    let touched = false;
    CONDUCT_PERCENT_KEYS.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(inc || {}, key)) return;
      next[key] = normalizeConductPercent(inc[key], { allowEmpty: true, fallback: null });
      touched = true;
    });
    if (touched) {
      next.conductSavedAt = savedAt;
    }
    byPerson.set(pid, next);
  });

  session.roster = Array.from(byPerson.values());

  if (options.ready === true) {
    session.conductReadyForReports = true;
    session.conductReadyAt = savedAt;
    if (options.userId) {
      session.conductReadyBy = String(options.userId);
    }
  }

  return session;
}

/**
 * Resolve session id from a report assignment / instance context.
 * @param {object} assignment
 * @param {object} [instance]
 * @returns {string}
 */
function resolveSessionIdFromAssignmentContext(assignment = {}, instance = {}) {
  const fromInstance = String(instance?.sessionId || '').trim();
  if (fromInstance) return fromInstance;
  const top = String(assignment?.sessionId || '').trim();
  if (top) return top;
  const rows = Array.isArray(assignment?.targetRows) ? assignment.targetRows : [];
  for (const row of rows) {
    const sid = String(row?.sessionId || '').trim();
    if (sid) return sid;
  }
  return '';
}

function assignmentTargetsSession(assignment = {}, instance = {}) {
  const targetType = String(assignment?.targetType || instance?.targetType || '').trim().toLowerCase();
  if (targetType === 'session') return true;
  return Boolean(resolveSessionIdFromAssignmentContext(assignment, instance));
}

/**
 * When the assignment/instance is session-scoped, refuse report fill until conduct is saved.
 * Non-session assignments (date/class-only with no session link) are skipped.
 * @param {{ assignment?: object, instance?: object, reqUser?: object, schoolDataService: object }} args
 */
async function assertAssignmentSessionConductReadyOrThrow({
  assignment = {},
  instance = {},
  reqUser = null,
  schoolDataService
} = {}) {
  if (!assignmentTargetsSession(assignment, instance)) return;
  const sessionId = resolveSessionIdFromAssignmentContext(assignment, instance);
  if (!sessionId) return;

  const classId = String(assignment?.classId || instance?.classId || '').trim();
  if (!classId) {
    const err = new Error('Class is required to verify class conduct for this report.');
    err.code = 'CONDUCT_REQUIRED_BEFORE_REPORTS';
    err.statusCode = 400;
    throw err;
  }
  if (!schoolDataService || typeof schoolDataService.getClassSessions !== 'function') {
    throw new Error('schoolDataService is required to verify class conduct.');
  }

  const sessions = await schoolDataService.getClassSessions(classId, reqUser);
  const session = (Array.isArray(sessions) ? sessions : []).find((row) => (
    idsEqual(row?.sessionId, sessionId) || String(row?.sessionId || '').trim() === sessionId
  ));
  if (!session) {
    const err = new Error('Session not found for this report assignment.');
    err.code = 'CONDUCT_REQUIRED_BEFORE_REPORTS';
    err.statusCode = 400;
    throw err;
  }
  assertSessionConductReadyForReportsOrThrow(session, 'this session');
}

module.exports = {
  CONDUCT_PERCENT_KEYS,
  normalizeConductPercent,
  parseConductReadyFlag,
  extractConductPercents,
  rosterRowHasRatedConduct,
  rosterRowHasSavedConduct,
  resolveReportPeriodForSession,
  resolveConductPrefillForStudent,
  buildConductPrefillMap,
  isSessionConductReady,
  assertSessionConductReadyForReportsOrThrow,
  applyConductRosterToSession,
  resolveSessionIdFromAssignmentContext,
  assignmentTargetsSession,
  assertAssignmentSessionConductReadyOrThrow
};
