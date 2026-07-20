/**
 * Session class-conduct helpers for the report-gated conduct flow.
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

  incoming.forEach((inc) => {
    const pid = personKey(inc?.personId);
    if (!pid) return;
    const existing = byPerson.get(pid) || { personId: pid };
    const next = { ...existing, personId: existing.personId || pid };
    CONDUCT_PERCENT_KEYS.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(inc || {}, key)) return;
      next[key] = normalizeConductPercent(inc[key], { allowEmpty: true, fallback: null });
    });
    byPerson.set(pid, next);
  });

  session.roster = Array.from(byPerson.values());

  if (options.ready === true) {
    session.conductReadyForReports = true;
    session.conductReadyAt = new Date().toISOString();
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
  isSessionConductReady,
  assertSessionConductReadyForReportsOrThrow,
  applyConductRosterToSession,
  resolveSessionIdFromAssignmentContext,
  assignmentTargetsSession,
  assertAssignmentSessionConductReadyOrThrow
};
