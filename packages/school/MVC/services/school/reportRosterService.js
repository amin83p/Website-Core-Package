const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const reportScopePolicy = require('./reportScopePolicy');

function inferAssignmentReportScope(assignment) {
  try {
    return reportScopePolicy.normalizeReportScope(assignment?.reportScope);
  } catch (_) {
    return 'class';
  }
}

function findSessionInList(sessions, sessionId) {
  const cleanSessionId = String(sessionId || '').trim();
  if (!cleanSessionId) return null;
  return (Array.isArray(sessions) ? sessions : [])
    .find((row) => idsEqual(row?.sessionId || row?.id, cleanSessionId)) || null;
}

function resolveSessionRosterPersonIds(sessionOrRoster) {
  const roster = Array.isArray(sessionOrRoster)
    ? sessionOrRoster
    : (Array.isArray(sessionOrRoster?.roster) ? sessionOrRoster.roster : []);
  const seen = new Set();
  const personIds = [];
  roster.forEach((row) => {
    const personId = toPublicId(row?.personId);
    if (!personId || seen.has(personId)) return;
    seen.add(personId);
    personIds.push(personId);
  });
  return personIds;
}

function resolveConfiguredTargetStudentIds(assignment = {}, targetRow = null) {
  const rowIds = Array.isArray(targetRow?.targetStudentIds)
    ? targetRow.targetStudentIds.map((id) => toPublicId(id)).filter(Boolean)
    : [];
  if (rowIds.length) return rowIds;
  return Array.isArray(assignment?.targetStudentIds)
    ? assignment.targetStudentIds.map((id) => toPublicId(id)).filter(Boolean)
    : [];
}

async function resolveEachStudentTargetPersonIds({
  assignment,
  targetRow = null,
  classData,
  sessions = [],
  session = null,
  sessionRoster = null,
  reqUser,
  resolveEnrollmentPersonIds
} = {}) {
  const reportScope = inferAssignmentReportScope(assignment);
  if (reportScope !== 'each_student') return [];

  const configured = resolveConfiguredTargetStudentIds(assignment, targetRow);
  if (configured.length) return configured;

  if (typeof resolveEnrollmentPersonIds === 'function') {
    return resolveEnrollmentPersonIds({ assignment, targetRow, classData, sessions, reqUser });
  }
  return [];
}

async function resolveSelectedStudentTargetPersonIds({
  assignment,
  targetRow = null,
  classStudentSet = new Set(),
  resolveEnrollmentPersonIds
} = {}) {
  const configured = resolveConfiguredTargetStudentIds(assignment, targetRow);
  if (configured.length) {
    return configured.filter((id) => classStudentSet.has(id));
  }
  if (typeof resolveEnrollmentPersonIds === 'function') {
    const fallback = await resolveEnrollmentPersonIds({ assignment, targetRow });
    return Array.isArray(fallback) ? fallback.filter((id) => classStudentSet.has(id)) : [];
  }
  return [];
}

module.exports = {
  findSessionInList,
  resolveSessionRosterPersonIds,
  resolveConfiguredTargetStudentIds,
  resolveEachStudentTargetPersonIds,
  resolveSelectedStudentTargetPersonIds,
  inferAssignmentReportScope
};
