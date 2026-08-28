const schoolDataService = require('./schoolDataService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const rollingEnrollmentSessionAlignmentService = require('./rollingEnrollmentSessionAlignmentService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const HOUR_STEP = 0.25;

function serializeStatusMap(statusMap = {}) {
  if (statusMap instanceof Map) {
    const out = {};
    statusMap.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  return statusMap && typeof statusMap === 'object' ? statusMap : {};
}

function slimSessionRow(session = {}) {
  const sessionId = toPublicId(session.sessionId || session.id || '');
  const date = String(session.date || session.sessionDate || session.startDate || '').trim();
  const startTime = String(session.startTime || session.start || '').trim();
  const endTime = String(session.endTime || session.end || '').trim();
  const storedHours = Number(session.durationHours);
  const durationHours = Number.isFinite(storedHours) && storedHours > 0
    ? Number(storedHours.toFixed(2))
    : rollingEnrollmentSessionAlignmentService.computeDurationHours(startTime, endTime);
  return {
    sessionId,
    id: sessionId,
    date,
    startTime,
    endTime,
    status: String(session.status || 'scheduled').trim().toLowerCase() || 'scheduled',
    notes: String(session.notes || '').trim(),
    room: String(session.room || '').trim(),
    durationHours,
    rosterCount: Number.isFinite(Number(session?.rosterCount)) && Number(session.rosterCount) >= 0
      ? Number(session.rosterCount)
      : (Array.isArray(session?.roster) ? session.roster.length : 0)
  };
}

function buildStudentToPersonMap(students = [], activeOrgId = '') {
  const map = new Map();
  (Array.isArray(students) ? students : []).forEach((row) => {
    if (activeOrgId && row?.orgId && !idsEqual(row.orgId, activeOrgId)) return;
    const studentId = toPublicId(row?.id);
    const personId = toPublicId(row?.personId);
    if (studentId && personId) map.set(studentId, personId);
  });
  return map;
}

function resolveSessionOccupiedStudentCount({
  session = {},
  periodRows = [],
  studentToPersonMap = new Map(),
  statusMap = new Map(),
  forceNotApplicableSessionKeys = new Set(),
  excludeStudentId = '',
  activeOrgId = ''
} = {}) {
  const sessionId = toPublicId(session?.sessionId || session?.id || '');
  const excludePersonId = toPublicId(studentToPersonMap.get(toPublicId(excludeStudentId)) || '');
  const roster = Array.isArray(session?.roster) ? session.roster : [];
  const rosterOthers = roster.filter((row) => {
    const personId = toPublicId(row?.personId);
    return personId && !idsEqual(personId, excludePersonId);
  }).length;

  const applicability = classEnrollmentSessionApplicabilityService.resolveRollingEnrollmentApplicability({
    sessions: [session],
    periodRows,
    studentToPersonMap,
    activeOrgId,
    allowedStatuses: classEnrollmentSessionApplicabilityService.OPEN_STATUSES,
    forceNotApplicableSessionKeys
  });

  let expectedOthers = 0;
  applicability.personIds.forEach((personId) => {
    if (excludePersonId && idsEqual(personId, excludePersonId)) return;
    const state = classEnrollmentSessionApplicabilityService.getApplicabilityState(
      applicability.stateByKey,
      personId,
      session,
      sessionId
    );
    if (state?.expected === true) expectedOthers += 1;
  });

  return Math.max(rosterOthers, expectedOthers);
}

function enrichSessionsWithEnrollmentOccupancy({
  sessions = [],
  periodRows = [],
  statusMap = {},
  students = [],
  excludeStudentId = '',
  activeOrgId = ''
} = {}) {
  const policyMap = statusMapToPolicyMap(statusMap);
  const studentToPersonMap = buildStudentToPersonMap(students, activeOrgId);
  const forceNotApplicableSessionKeys = sessionStatusPolicyService.buildForceNotApplicableAttendanceSessionKeys(
    policyMap,
    sessions
  );
  return (Array.isArray(sessions) ? sessions : []).map((session) => ({
    ...session,
    rosterCount: resolveSessionOccupiedStudentCount({
      session,
      periodRows,
      studentToPersonMap,
      statusMap: policyMap,
      forceNotApplicableSessionKeys,
      excludeStudentId,
      activeOrgId
    })
  }));
}

function buildRollingEnrollmentWorkspacePayload({
  classData = {},
  sessions = [],
  statusMap = {},
  scheduleDefaults = {},
  eligibility = null
} = {}) {
  return {
    classId: toPublicId(classData?.id || ''),
    orgId: toPublicId(classData?.orgId || ''),
    cycleStartDate: String(classData?.cycleStartDate || '').trim(),
    cycleEndDate: String(classData?.cycleEndDate || '').trim(),
    sessions: (Array.isArray(sessions) ? sessions : []).map(slimSessionRow).filter((row) => row.sessionId || row.date),
    statusMap: serializeStatusMap(statusMap),
    scheduleDefaults,
    eligibility
  };
}

async function buildRollingEnrollmentWorkspace({
  classData,
  studentId,
  reqUser,
  eligibilitySnapshot = null
} = {}) {
  const activeOrgId = toPublicId(classData?.orgId || reqUser?.activeOrgId || '');
  const [sessions, statusMap, periodRows, students] = await Promise.all([
    schoolDataService.getClassSessions(classData.id, reqUser),
    sessionStatusPolicyService.getStatusMap(activeOrgId, { includeInactive: true }),
    schoolDataService.getClassEnrollmentPeriodsByClassId(classData.id, reqUser),
    schoolDataService.fetchAllData('students', {}, reqUser)
  ]);
  const scheduleDefaults = rollingEnrollmentSessionAlignmentService.extractScheduleDefaults(classData);
  const enrichedSessions = enrichSessionsWithEnrollmentOccupancy({
    sessions,
    periodRows,
    statusMap,
    students,
    excludeStudentId: studentId,
    activeOrgId
  });
  return buildRollingEnrollmentWorkspacePayload({
    classData,
    sessions: enrichedSessions,
    statusMap,
    scheduleDefaults,
    eligibility: eligibilitySnapshot
  });
}

function statusMapToPolicyMap(statusMap = {}) {
  if (statusMap instanceof Map) return statusMap;
  const map = new Map();
  Object.keys(statusMap || {}).forEach((key) => {
    map.set(key, statusMap[key]);
  });
  return map;
}

function filterSessionsInEnrollmentWindow(sessions = [], startDate = '', endDate = '') {
  const normalizedStart = String(startDate || '').trim();
  const normalizedEnd = String(endDate || '').trim();
  if (!normalizedStart) return [];
  return (Array.isArray(sessions) ? sessions : []).filter((session) => {
    const sDate = String(session?.date || session?.sessionDate || '').trim();
    if (!sDate) return false;
    if (sDate < normalizedStart) return false;
    if (normalizedEnd && sDate > normalizedEnd) return false;
    return true;
  });
}
function mergeWorkspaceSessions(workspaceSessions = [], pendingStagedSessions = []) {
  const base = Array.isArray(workspaceSessions) ? workspaceSessions : [];
  const staged = Array.isArray(pendingStagedSessions) ? pendingStagedSessions : [];
  if (!staged.length) return base.slice();
  return [...base, ...staged.map(slimSessionRow)];
}

function evaluateWorkspaceAlignment({
  workspace = {},
  startDate = '',
  endDate = '',
  targetSessionCount = 0,
  targetHours = 0,
  pendingStagedSessions = [],
  pendingGapBatch = null
} = {}) {
  const normalizedStart = String(startDate || '').trim();
  const normalizedEnd = String(endDate || '').trim();
  const normalizedSessionTarget = Number.parseInt(String(targetSessionCount ?? '').trim(), 10);
  const sessionTarget = Number.isFinite(normalizedSessionTarget) && normalizedSessionTarget > 0
    ? normalizedSessionTarget
    : 0;
  const normalizedHourTarget = Number.parseFloat(String(targetHours ?? '').trim());
  const hourTarget = Number.isFinite(normalizedHourTarget) && normalizedHourTarget > 0
    ? Number((Math.round(normalizedHourTarget / HOUR_STEP) * HOUR_STEP).toFixed(2))
    : 0;
  if (sessionTarget > 0 && hourTarget > 0) {
    throw new Error('Set either a session target or an hour target, not both.');
  }

  const statusMap = statusMapToPolicyMap(workspace?.statusMap || {});
  const scheduleDefaults = workspace?.scheduleDefaults || {};
  const mergedSessions = mergeWorkspaceSessions(workspace?.sessions, pendingStagedSessions);
  const alignment = rollingEnrollmentSessionAlignmentService.evaluateAlignment({
    sessions: mergedSessions,
    startDate: normalizedStart,
    endDate: normalizedEnd,
    targetSessionCount: sessionTarget,
    targetHours: hourTarget,
    statusMap
  });

  return {
    ...alignment,
    startDate: normalizedStart,
    endDate: normalizedEnd,
    targetSessionCount: sessionTarget,
    targetHours: hourTarget,
    enforceSessionCount: rollingEnrollmentSessionAlignmentService.isTargetSessionCountEnforced(sessionTarget),
    enforceHours: rollingEnrollmentSessionAlignmentService.isTargetHoursEnforced(hourTarget),
    scheduleDefaults,
    hasPendingGapBatch: Boolean(pendingGapBatch),
    pendingStagedCount: Array.isArray(pendingStagedSessions) ? pendingStagedSessions.length : 0
  };
}

module.exports = {
  buildRollingEnrollmentWorkspace,
  buildRollingEnrollmentWorkspacePayload,
  evaluateWorkspaceAlignment,
  mergeWorkspaceSessions,
  serializeStatusMap,
  slimSessionRow,
  statusMapToPolicyMap,
  filterSessionsInEnrollmentWindow,
  buildStudentToPersonMap,
  resolveSessionOccupiedStudentCount,
  enrichSessionsWithEnrollmentOccupancy
};
