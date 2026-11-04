/**
 * Session class-conduct helpers for optional + report-gated conduct flows.
 * Ratings remain on session.roster[]; readiness is a session-level flag.
 */

const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const reportAssignmentSessionUtils = requireCoreModule('MVC/utils/reportAssignmentSessionUtils');
const reportRosterService = require('./reportRosterService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const classEnrollmentReadService = require('./classEnrollmentReadService');

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
 * Report period dates for the current session (gradebook skill gate, conduct prefill).
 * Uses only target rows that match sessionContext—not assignment-level dates from other rows.
 * @param {Iterable<object>|Map} assignments
 * @param {{ classId?: string, sessionId?: string, sessionDate?: string }|string} sessionContextOrSessionId
 * @returns {{ startDate: string, dueDate: string }}
 */
function normalizeSessionContextForReportPeriod(sessionContextOrSessionId) {
  if (typeof sessionContextOrSessionId === 'string') {
    return {
      classId: '',
      sessionId: String(sessionContextOrSessionId || '').trim(),
      sessionDate: ''
    };
  }
  const ctx = sessionContextOrSessionId && typeof sessionContextOrSessionId === 'object'
    ? sessionContextOrSessionId
    : {};
  return {
    classId: String(ctx.classId || '').trim(),
    sessionId: String(ctx.sessionId || '').trim(),
    sessionDate: parseDateOnly(ctx.sessionDate)
  };
}

function reportPeriodFromTargetRow(row = {}) {
  const startDate = parseDateOnly(row?.reportStartDate);
  const dueDate = parseDateOnly(row?.reportDueDate || row?.dueDate || row?.sessionDate);
  if (!startDate || !dueDate) return null;
  return { startDate, dueDate };
}

function reportPeriodContainsSessionDate(period, sessionDate) {
  const day = parseDateOnly(sessionDate);
  if (!day || !period) return false;
  return period.startDate <= day && day <= period.dueDate;
}

function unionReportPeriods(periods = []) {
  let startDate = '';
  let dueDate = '';
  (Array.isArray(periods) ? periods : []).forEach((period) => {
    if (!period) return;
    if (period.startDate && (!startDate || period.startDate < startDate)) startDate = period.startDate;
    if (period.dueDate && (!dueDate || period.dueDate > dueDate)) dueDate = period.dueDate;
  });
  return { startDate, dueDate };
}

function resolveReportPeriodFromMatchingTargetRows(matchingRows = [], sessionDate = '') {
  const periods = (Array.isArray(matchingRows) ? matchingRows : [])
    .map((row) => reportPeriodFromTargetRow(row))
    .filter(Boolean);
  if (!periods.length) return { startDate: '', dueDate: '' };
  if (periods.length === 1) return periods[0];

  const day = parseDateOnly(sessionDate);
  if (day) {
    const containing = periods.filter((period) => reportPeriodContainsSessionDate(period, day));
    if (containing.length === 1) return containing[0];
    if (containing.length > 1) return unionReportPeriods(containing);
  }
  return unionReportPeriods(periods);
}

function assignmentMatchesSessionForReportPeriod(assignment, sessionContext = {}) {
  const status = String(assignment?.status || 'active').trim().toLowerCase();
  if (status !== 'active') return false;
  if (String(sessionContext.classId || '').trim()) {
    return reportAssignmentSessionUtils.reportAssignmentMatchesSession(assignment, sessionContext);
  }
  const cleanSessionId = String(sessionContext.sessionId || '').trim();
  if (!cleanSessionId) return false;
  const topSessionId = String(assignment?.sessionId || '').trim();
  if (idsEqual(topSessionId, cleanSessionId)) return true;
  return reportAssignmentSessionUtils.getEffectiveTargetRows(assignment).some((row) => (
    String(row?.status || 'active').trim().toLowerCase() === 'active'
    && idsEqual(row?.sessionId, cleanSessionId)
  ));
}

function resolveReportPeriodForSession(assignments, sessionContextOrSessionId) {
  const sessionContext = normalizeSessionContextForReportPeriod(sessionContextOrSessionId);
  const list = assignments instanceof Map
    ? Array.from(assignments.values())
    : (Array.isArray(assignments) ? assignments : []);
  const matchingRows = [];
  list.forEach((assignment) => {
    if (!assignmentMatchesSessionForReportPeriod(assignment, sessionContext)) return;
    reportAssignmentSessionUtils.getEffectiveTargetRows(assignment)
      .filter((row) => String(row?.status || 'active').trim().toLowerCase() === 'active')
      .filter((row) => targetRowMatchesSessionContext(row, sessionContext))
      .forEach((row) => matchingRows.push(row));
  });
  return resolveReportPeriodFromMatchingTargetRows(matchingRows, sessionContext.sessionDate);
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
function targetRowMatchesSessionContext(row = {}, sessionContext = {}) {
  const cleanSessionId = String(sessionContext?.sessionId || '').trim();
  const cleanSessionDate = parseDateOnly(sessionContext?.sessionDate);
  const targetType = String(row?.targetType || 'session').trim().toLowerCase();
  if (targetType === 'session') {
    return idsEqual(row?.sessionId, cleanSessionId);
  }
  const rowDate = parseDateOnly(row?.dueDate || row?.sessionDate || row?.reportDueDate);
  return Boolean(cleanSessionDate && rowDate && rowDate === cleanSessionDate);
}

/**
 * Union of person IDs that need report-gated class conduct on a session.
 * Uses targetStudentIds when present; otherwise falls back to the session roster for
 * class-scope assignments and each_student rows with no explicit targets.
 * @param {{ assignments?: Iterable<object>|Map, sessionContext?: object, sessionRoster?: object[] }} args
 * @returns {string[]}
 */
function resolveSessionReportConductPersonIds({
  assignments = [],
  sessionContext = {},
  sessionRoster = []
} = {}) {
  const union = new Set();
  const rosterPersonIds = reportRosterService.resolveSessionRosterPersonIds(sessionRoster);
  const list = assignments instanceof Map
    ? Array.from(assignments.values())
    : (Array.isArray(assignments) ? assignments : []);

  list.forEach((assignment) => {
    if (!reportAssignmentSessionUtils.reportAssignmentMatchesSession(assignment, sessionContext)) return;
    const scope = reportAssignmentSessionUtils.inferAssignmentReportScope(assignment);

    const activeRows = reportAssignmentSessionUtils.getEffectiveTargetRows(assignment)
      .filter((row) => String(row?.status || 'active').trim().toLowerCase() === 'active')
      .filter((row) => targetRowMatchesSessionContext(row, sessionContext));

    activeRows.forEach((targetRow) => {
      if (!assignmentRequiresConductBeforeFill(assignment, { assignmentRowId: targetRow?.rowId })) return;
      if (scope === 'class') {
        rosterPersonIds.forEach((id) => union.add(id));
        return;
      }
      if (scope !== 'each_student' && scope !== 'selected_students') return;

      const configured = reportRosterService.resolveConfiguredTargetStudentIds(assignment, targetRow);
      configured.forEach((id) => union.add(id));
      if (!configured.length) {
        rosterPersonIds.forEach((id) => union.add(id));
      }
    });
  });

  return [...union];
}

/**
 * Person IDs for voluntary class conduct (enrollment valid on the session date).
 */
async function resolveVoluntaryConductPersonIds({
  reqUser = null,
  classData = null,
  classId = '',
  session = null,
  studentToPersonMap = null
} = {}) {
  const cleanClassId = String(classId || classData?.id || '').trim();
  const sessionDay = parseDateOnly(session?.date);
  if (!cleanClassId || !sessionDay || !reqUser) {
    return reportRosterService.resolveSessionRosterPersonIds(session?.roster);
  }
  const overlap = await classEnrollmentReadService.listPersonIdsOverlappingEnrollmentWindow({
    classId: cleanClassId,
    classItem: classData,
    reqUser,
    activeOrgId: String(classData?.orgId || reqUser?.activeOrgId || '').trim(),
    sessionDates: [sessionDay],
    startDate: sessionDay,
    endDate: sessionDay,
    canonicalStatuses: classEnrollmentReadService.getReportRosterStatusesForClass(classData),
    studentToPersonMap: studentToPersonMap instanceof Map ? studentToPersonMap : new Map()
  });
  const enrolled = overlap?.personIds instanceof Set ? [...overlap.personIds] : [];
  const normalized = enrolled.map(personKey).filter(Boolean);
  if (normalized.length) return normalized;
  return reportRosterService.resolveSessionRosterPersonIds(session?.roster);
}

/**
 * Build conduct UI roster rows for report-gated conduct (selected students only).
 * @param {{ personIds?: string[], sessionRoster?: object[], prefetchedStudents?: object[], prefetchedPersons?: object[] }} args
 * @returns {object[]}
 */
function buildReportConductRoster({
  personIds = [],
  sessionRoster = [],
  prefetchedStudents = [],
  prefetchedPersons = []
} = {}) {
  const sessionRosterByPerson = new Map();
  (Array.isArray(sessionRoster) ? sessionRoster : []).forEach((row) => {
    const pid = personKey(row?.personId);
    if (pid) sessionRosterByPerson.set(pid, row);
  });
  const studentsByPerson = new Map();
  (Array.isArray(prefetchedStudents) ? prefetchedStudents : []).forEach((row) => {
    const pid = personKey(row?.personId);
    if (pid) studentsByPerson.set(pid, row);
  });
  const personsByPerson = new Map();
  (Array.isArray(prefetchedPersons) ? prefetchedPersons : []).forEach((row) => {
    const pid = personKey(row?.id || row?.personId);
    if (pid) personsByPerson.set(pid, row);
  });
  const studentsByRecordId = new Map();
  (Array.isArray(prefetchedStudents) ? prefetchedStudents : []).forEach((row) => {
    const recordId = personKey(row?.id);
    if (recordId) studentsByRecordId.set(recordId, row);
  });

  function resolveConductPersonId(rawId) {
    const token = personKey(rawId);
    if (!token) return '';
    if (sessionRosterByPerson.has(token)) return token;
    if (studentsByPerson.has(token)) return token;
    const student = studentsByRecordId.get(token);
    const fromRecord = personKey(student?.personId);
    if (fromRecord && sessionRosterByPerson.has(fromRecord)) return fromRecord;
    if (fromRecord) return fromRecord;
    return token;
  }

  const seen = new Set();
  const result = [];
  (Array.isArray(personIds) ? personIds : []).forEach((rawId) => {
    const pid = resolveConductPersonId(rawId);
    if (!pid || seen.has(pid)) return;
    seen.add(pid);
    const rosterRow = sessionRosterByPerson.get(pid);
    if (rosterRow) {
      const student = studentsByPerson.get(pid);
      const person = personsByPerson.get(pid);
      const resolvedName = schoolPersonAccessService.formatPersonName(
        person,
        String(rosterRow?.name || student?.name || student?.firstName || '').trim()
      );
      const displayName = resolvedName || pid;
      result.push({
        ...rosterRow,
        personId: pid,
        name: displayName,
        studentRecordId: String(rosterRow?.studentRecordId || student?.id || '').trim() || undefined
      });
      return;
    }
    const student = studentsByPerson.get(pid);
    const person = personsByPerson.get(pid);
    const resolvedName = schoolPersonAccessService.formatPersonName(
      person,
      String(student?.name || student?.firstName || pid).trim()
    );
    result.push({
      personId: pid,
      name: resolvedName,
      studentRecordId: String(student?.id || '').trim() || undefined,
      classEffortPercent: null,
      classParticipationPercent: null,
      respectsTeachersPercent: null,
      respectsStudentsPercent: null
    });
  });
  return result;
}

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

function parseConductReportStepEnabled(session) {
  return session?.conductReportStepEnabled === true
    || String(session?.conductReportStepEnabled || '').trim().toLowerCase() === 'true';
}

function sessionHasAnySavedConduct(session) {
  return (Array.isArray(session?.roster) ? session.roster : []).some((row) => rosterRowHasRatedConduct(row));
}

function sessionShowsReportConductStep(session, assignmentConductRequired) {
  return Boolean(assignmentConductRequired) || parseConductReportStepEnabled(session);
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

function parseConductRequiredFlag(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const raw = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

function assignmentRequiresConductBeforeFill(assignment = {}, instance = {}) {
  const assignmentRowId = String(instance?.assignmentRowId || assignment?.assignmentRowId || '').trim();
  const rows = Array.isArray(assignment?.targetRows) ? assignment.targetRows : [];
  if (assignmentRowId && rows.length) {
    const row = rows.find((entry) => String(entry?.rowId || '').trim() === assignmentRowId);
    if (row) return parseConductRequiredFlag(row.conductRequiredBeforeFill, true);
  }
  if (rows.length === 1) {
    return parseConductRequiredFlag(rows[0]?.conductRequiredBeforeFill, true);
  }
  return parseConductRequiredFlag(assignment?.conductRequiredBeforeFill, true);
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
  if (!assignmentRequiresConductBeforeFill(assignment, instance)) return;
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

function resolveSessionHasConductRequiredReports({
  instanceRows = [],
  sessionMatchedAssignments = [],
  sessionContext = {}
} = {}) {
  const rows = Array.isArray(instanceRows) ? instanceRows : [];
  if (rows.some((row) => row?.conductRequiredBeforeFill)) {
    return true;
  }
  return (Array.isArray(sessionMatchedAssignments) ? sessionMatchedAssignments : []).some((assignment) => {
    const activeRows = reportAssignmentSessionUtils.getEffectiveTargetRows(assignment)
      .filter((row) => String(row?.status || 'active').trim().toLowerCase() === 'active');
    if (!activeRows.length) {
      return assignmentRequiresConductBeforeFill(assignment);
    }
    return activeRows.some((targetRow) => {
      const rowAssignment = reportAssignmentSessionUtils.applyTargetRow(assignment, targetRow);
      if (!reportAssignmentSessionUtils.reportAssignmentMatchesSession(rowAssignment, sessionContext)) {
        return false;
      }
      return assignmentRequiresConductBeforeFill(assignment, { assignmentRowId: targetRow?.rowId });
    });
  });
}

/**
 * Conduct UI payload for manage-session and post-assignment refresh.
 * @param {object} args
 * @returns {{ sessionHasConductRequiredReports: boolean, conductReadyForReports: boolean, reportConductRoster: object[] }}
 */
async function buildSessionReportConductUiPayload({
  session = null,
  sessions = [],
  sessionRoster = [],
  assignmentMap = null,
  instanceRows = [],
  sessionId = '',
  classId = '',
  prefetchedStudents = [],
  prefetchedPersons = [],
  reqUser = null,
  classData = null,
  studentToPersonMap = null
} = {}) {
  const sessionContext = {
    classId: String(classId || '').trim(),
    sessionId: String(sessionId || '').trim(),
    sessionDate: session?.date
  };
  const assignments = assignmentMap instanceof Map
    ? [...assignmentMap.values()]
    : (Array.isArray(assignmentMap) ? assignmentMap : []);
  const sessionMatchedAssignments = assignments.filter((assignment) => (
    reportAssignmentSessionUtils.reportAssignmentMatchesSession(assignment, sessionContext)
  ));

  const conductRequiredByAssignment = resolveSessionHasConductRequiredReports({
    instanceRows,
    sessionMatchedAssignments,
    sessionContext
  });
  const conductReportStepEnabled = parseConductReportStepEnabled(session);
  const sessionHasConductRequiredReports = sessionShowsReportConductStep(
    session,
    conductRequiredByAssignment
  );
  const conductReadyForReports = isSessionConductReady(session);

  if (!sessionHasConductRequiredReports) {
    return {
      sessionHasConductRequiredReports: false,
      conductRequiredByAssignment: false,
      conductReportStepEnabled,
      conductReadyForReports,
      reportConductRoster: []
    };
  }

  const sessionConductReportPeriod = resolveReportPeriodForSession(assignmentMap, sessionContext);
  let reportConductPersonIds = resolveSessionReportConductPersonIds({
    assignments: sessionMatchedAssignments,
    sessionContext,
    sessionRoster
  });
  if (!conductRequiredByAssignment && conductReportStepEnabled) {
    reportConductPersonIds = await resolveVoluntaryConductPersonIds({
      reqUser,
      classData,
      classId: sessionContext.classId,
      session,
      studentToPersonMap
    });
  }
  const reportConductRoster = buildReportConductRoster({
    personIds: reportConductPersonIds,
    sessionRoster,
    prefetchedStudents,
    prefetchedPersons
  });
  const persistedSession = (Array.isArray(sessions) ? sessions : []).find((row) => (
    idsEqual(row?.sessionId, sessionId) || String(row?.sessionId || '').trim() === String(sessionId || '').trim()
  )) || session;
  const prefillMap = buildConductPrefillMap({
    roster: reportConductRoster,
    currentSession: {
      ...(persistedSession || {}),
      roster: sessionRoster
    },
    allSessions: sessions,
    periodStart: sessionConductReportPeriod.startDate,
    periodDue: sessionConductReportPeriod.dueDate
  });

  const rosterForClient = reportConductRoster.map((row) => {
    const pid = personKey(row?.personId);
    const prefill = pid ? (prefillMap.get(pid) || {}) : {};
    const merged = { ...row };
    CONDUCT_PERCENT_KEYS.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(prefill, key)) {
        merged[key] = prefill[key];
      }
    });
    return {
      personId: merged.personId,
      name: merged.name,
      studentRecordId: merged.studentRecordId || '',
      classEffortPercent: merged.classEffortPercent ?? null,
      classParticipationPercent: merged.classParticipationPercent ?? null,
      respectsTeachersPercent: merged.respectsTeachersPercent ?? null,
      respectsStudentsPercent: merged.respectsStudentsPercent ?? null
    };
  });

  return {
    sessionHasConductRequiredReports: true,
    conductRequiredByAssignment,
    conductReportStepEnabled,
    conductReadyForReports,
    reportConductRoster: rosterForClient
  };
}

module.exports = {
  CONDUCT_PERCENT_KEYS,
  normalizeConductPercent,
  parseConductReadyFlag,
  extractConductPercents,
  rosterRowHasRatedConduct,
  rosterRowHasSavedConduct,
  resolveReportPeriodForSession,
  targetRowMatchesSessionContext,
  resolveSessionReportConductPersonIds,
  resolveVoluntaryConductPersonIds,
  buildReportConductRoster,
  resolveConductPrefillForStudent,
  buildConductPrefillMap,
  isSessionConductReady,
  parseConductReportStepEnabled,
  sessionHasAnySavedConduct,
  sessionShowsReportConductStep,
  assertSessionConductReadyForReportsOrThrow,
  applyConductRosterToSession,
  resolveSessionIdFromAssignmentContext,
  assignmentTargetsSession,
  assignmentRequiresConductBeforeFill,
  parseConductRequiredFlag,
  assertAssignmentSessionConductReadyOrThrow,
  resolveSessionHasConductRequiredReports,
  buildSessionReportConductUiPayload
};
