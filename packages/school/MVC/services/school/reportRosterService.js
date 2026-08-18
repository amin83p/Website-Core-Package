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

async function resolveEachStudentTargetPersonIds({
  assignment,
  classData,
  sessions = [],
  session = null,
  sessionRoster = null,
  reqUser,
  resolveEnrollmentPersonIds
} = {}) {
  const reportScope = inferAssignmentReportScope(assignment);
  if (reportScope !== 'each_student') return [];

  const sessionId = String(assignment?.sessionId || '').trim();
  if (sessionId || (Array.isArray(sessionRoster) && sessionRoster.length)) {
    if (Array.isArray(sessionRoster) && sessionRoster.length) {
      return resolveSessionRosterPersonIds(sessionRoster);
    }
    const resolvedSession = session || findSessionInList(sessions, sessionId);
    return resolveSessionRosterPersonIds(resolvedSession);
  }

  if (typeof resolveEnrollmentPersonIds === 'function') {
    return resolveEnrollmentPersonIds({ assignment, classData, sessions, reqUser });
  }
  return [];
}

module.exports = {
  findSessionInList,
  resolveSessionRosterPersonIds,
  resolveEachStudentTargetPersonIds,
  inferAssignmentReportScope
};
