'use strict';

const fs = require('fs');
const path = require('path');

const schoolDataService = require('./schoolDataService');
const sessionConductService = require('./sessionConductService');
const schoolAdminAccessService = require('./schoolAdminAccessService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');
const effectiveAccessResolverService = requireCoreModule('MVC/services/security/effectiveAccessResolverService');
const accessService = requireCoreModule('MVC/services/security/accessControl');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

const CONDUCT_LOCK_FIELDS = Object.freeze([
  'conductLockedByReportAt',
  'conductLockedByReportInstanceId'
]);

const DEBUG_LOG_PATH = path.join(__dirname, '../../../../../.cursor/debug-81b8ef.log');

// #region agent log
function debugConductLockLog(location, message, data = {}, hypothesisId = 'H0') {
  try {
    const line = `${JSON.stringify({
      sessionId: '81b8ef',
      location,
      message,
      data,
      hypothesisId,
      timestamp: Date.now(),
      runId: 'conduct-lock'
    })}\n`;
    fs.appendFileSync(DEBUG_LOG_PATH, line, { encoding: 'utf8' });
  } catch (_) {
    /* ignore */
  }
}
// #endregion

function personKey(value) {
  return String(toPublicId(value) || value || '').trim();
}

function instanceLinksConductForLock(assignment = {}, instance = {}) {
  if (!sessionConductService.assignmentTargetsSession(assignment, instance)) return false;
  return sessionConductService.assignmentRequiresConductBeforeFill(assignment, instance);
}

function isRosterConductLockedByReport(row = {}) {
  return Boolean(String(row?.conductLockedByReportAt || '').trim());
}

async function buildSubmittedConductLockPersonIdSet({
  classId = '',
  sessionId = '',
  reqUser = null
} = {}) {
  const cleanClassId = toPublicId(classId);
  const cleanSessionId = String(sessionId || '').trim();
  if (!cleanClassId || !cleanSessionId) return new Set();

  const [instances, assignments] = await Promise.all([
    schoolDataService.fetchData('reportInstances', {
      classId__eq: cleanClassId,
      sessionId__eq: cleanSessionId,
      page: 1,
      limit: 10000
    }, reqUser),
    schoolDataService.fetchData('reportAssignments', {
      classId__eq: cleanClassId,
      page: 1,
      limit: 10000
    }, reqUser)
  ]);
  const assignmentMap = new Map(
    (Array.isArray(assignments) ? assignments : [])
      .map((row) => [toPublicId(row?.id), row])
      .filter(([id]) => Boolean(id))
  );
  const lockedPersonIds = new Set();
  for (const instance of Array.isArray(instances) ? instances : []) {
    const status = String(instance?.status || '').trim().toLowerCase();
    if (status !== 'submitted') continue;
    const assignment = assignmentMap.get(toPublicId(instance?.assignmentId));
    if (!assignment || !instanceLinksConductForLock(assignment, instance)) continue;
    const personId = await resolvePersonIdForInstanceStudent(instance?.studentId, reqUser);
    if (personId) lockedPersonIds.add(personKey(personId));
  }
  // #region agent log
  debugConductLockLog(
    'sessionConductReportLockService:buildSubmittedConductLockPersonIdSet',
    'computed submitted conduct lock set',
  {
    classId: cleanClassId,
    sessionId: cleanSessionId,
    instanceCount: Array.isArray(instances) ? instances.length : 0,
    lockedCount: lockedPersonIds.size
  },
    'H2'
  );
  // #endregion
  return lockedPersonIds;
}

async function isPersonConductLockedForSession({
  personId = '',
  rosterRow = null,
  submittedLockSet = null,
  classId = '',
  sessionId = '',
  reqUser = null
} = {}) {
  if (isRosterConductLockedByReport(rosterRow)) return true;
  const pid = personKey(personId || rosterRow?.personId);
  if (!pid) return false;
  const lockSet = submittedLockSet instanceof Set
    ? submittedLockSet
    : await buildSubmittedConductLockPersonIdSet({ classId, sessionId, reqUser });
  return lockSet.has(pid);
}

async function resolvePersonIdForInstanceStudent(studentId = '', reqUser = null) {
  const token = personKey(studentId);
  if (!token) return '';
  try {
    const student = await schoolDataService.getDataById('students', token, reqUser);
    const fromRecord = personKey(student?.personId);
    if (fromRecord) return fromRecord;
  } catch (_) {
    // studentId may already be a person id
  }
  return token;
}

function applyLockFieldsToRosterRow(row = {}, { instanceId = '', lockedAt = '' } = {}) {
  const next = { ...row };
  const at = String(lockedAt || new Date().toISOString()).trim();
  const iid = personKey(instanceId);
  next.conductLockedByReportAt = at;
  next.conductLockedByReportInstanceId = iid;
  return next;
}

function clearLockFieldsFromRosterRow(row = {}) {
  const next = { ...row };
  CONDUCT_LOCK_FIELDS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(next, key)) delete next[key];
  });
  return next;
}

async function lockConductForSubmittedReport({
  instance = null,
  assignment = null,
  reqUser = null
} = {}) {
  if (!instance || !assignment) {
    const out = { applied: false, reason: 'missing_context' };
    debugConductLockLog('sessionConductReportLockService:lockConductForSubmittedReport', 'lock skipped', out, 'H1');
    return out;
  }
  if (!instanceLinksConductForLock(assignment, instance)) {
    const out = { applied: false, reason: 'not_linked' };
    debugConductLockLog('sessionConductReportLockService:lockConductForSubmittedReport', 'lock skipped', {
      ...out,
      assignmentId: toPublicId(assignment?.id),
      sessionId: sessionConductService.resolveSessionIdFromAssignmentContext(assignment, instance),
      conductRequired: assignment?.conductRequiredBeforeFill
    }, 'H3');
    return out;
  }
  const classId = toPublicId(assignment?.classId || instance?.classId);
  const sessionId = sessionConductService.resolveSessionIdFromAssignmentContext(assignment, instance);
  if (!classId || !sessionId) return { applied: false, reason: 'missing_session' };

  const personId = await resolvePersonIdForInstanceStudent(instance?.studentId, reqUser);
  if (!personId) return { applied: false, reason: 'missing_person' };

  const sessions = await schoolDataService.getClassSessions(classId, reqUser);
  const sessionIndex = (Array.isArray(sessions) ? sessions : []).findIndex((row) => (
    idsEqual(row?.sessionId || row?.id, sessionId)
  ));
  if (sessionIndex < 0) return { applied: false, reason: 'session_not_found' };

  const session = sessions[sessionIndex];
  const roster = Array.isArray(session?.roster) ? session.roster : [];
  let rowIndex = roster.findIndex((row) => idsEqual(row?.personId, personId));
  if (rowIndex < 0) {
    roster.push({ personId });
    rowIndex = roster.length - 1;
    debugConductLockLog(
      'sessionConductReportLockService:lockConductForSubmittedReport',
      'upserted missing roster row for lock',
      { classId, sessionId, personId },
      'H1'
    );
  }

  const existing = roster[rowIndex] || {};
  const existingInstanceLock = personKey(existing?.conductLockedByReportInstanceId);
  const targetInstanceId = personKey(instance?.id);
  if (
    isRosterConductLockedByReport(existing)
    && existingInstanceLock
    && targetInstanceId
    && !idsEqual(existingInstanceLock, targetInstanceId)
  ) {
    return { applied: false, reason: 'already_locked_other_instance' };
  }

  const lockedAt = String(instance?.audit?.submittedAt || new Date().toISOString()).trim();
  roster[rowIndex] = applyLockFieldsToRosterRow(existing, {
    instanceId: targetInstanceId,
    lockedAt
  });
  sessions[sessionIndex] = { ...session, roster };
  await schoolDataService.saveClassSessions(classId, sessions, reqUser);
  const result = { applied: true, classId, sessionId, personId };
  // #region agent log
  debugConductLockLog('sessionConductReportLockService:lockConductForSubmittedReport', 'lock applied', result, 'H1');
  // #endregion
  return result;
}

async function unlockConductForReopenedReport({
  instance = null,
  assignment = null,
  reqUser = null
} = {}) {
  if (!instance || !assignment) return { applied: false, reason: 'missing_context' };
  if (!instanceLinksConductForLock(assignment, instance)) {
    return { applied: false, reason: 'not_linked' };
  }
  const classId = toPublicId(assignment?.classId || instance?.classId);
  const sessionId = sessionConductService.resolveSessionIdFromAssignmentContext(assignment, instance);
  if (!classId || !sessionId) return { applied: false, reason: 'missing_session' };

  const personId = await resolvePersonIdForInstanceStudent(instance?.studentId, reqUser);
  if (!personId) return { applied: false, reason: 'missing_person' };

  const targetInstanceId = personKey(instance?.id);
  const sessions = await schoolDataService.getClassSessions(classId, reqUser);
  const sessionIndex = (Array.isArray(sessions) ? sessions : []).findIndex((row) => (
    idsEqual(row?.sessionId || row?.id, sessionId)
  ));
  if (sessionIndex < 0) return { applied: false, reason: 'session_not_found' };

  const session = sessions[sessionIndex];
  const roster = Array.isArray(session?.roster) ? session.roster : [];
  const rowIndex = roster.findIndex((row) => idsEqual(row?.personId, personId));
  if (rowIndex < 0) return { applied: false, reason: 'roster_row_not_found' };

  const existing = roster[rowIndex] || {};
  if (!isRosterConductLockedByReport(existing)) {
    return { applied: false, reason: 'not_locked' };
  }
  const lockInstanceId = personKey(existing?.conductLockedByReportInstanceId);
  if (lockInstanceId && targetInstanceId && !idsEqual(lockInstanceId, targetInstanceId)) {
    return { applied: false, reason: 'locked_by_other_instance' };
  }

  roster[rowIndex] = clearLockFieldsFromRosterRow(existing);
  sessions[sessionIndex] = { ...session, roster };
  await schoolDataService.saveClassSessions(classId, sessions, reqUser);
  return { applied: true, classId, sessionId, personId };
}

async function canOverrideReportLinkedConductLock(reqUser = null, ipAddress = '') {
  if (!reqUser) return false;
  const orgId = reqUser?.activeOrgId;
  const sectionId = SECTIONS.SCHOOL_CLASS_CONDUCT_MATRIX;
  const operationId = OPERATIONS.UPDATE;

  const authority = await adminAuthorityService.resolveAdminAuthorityAsync({
    user: reqUser,
    sectionId,
    operationId,
    orgId,
    section: { id: sectionId, category: 'SCHOOL' }
  });
  if (schoolAdminAccessService.isFamilyABypassAdminAuthority(authority)) return true;
  if (authority.isOperationAdminForRequest) return true;

  const evaluation = await accessService.evaluateAccess({
    user: reqUser,
    sectionId,
    operationId,
    orgId,
    ipAddress: String(ipAddress || '').trim()
  });
  if (!evaluation?.allowed) return false;
  if (schoolAdminAccessService.isFamilyABypassAdminAuthority(evaluation.adminContext || {})) {
    return true;
  }
  const scopeId = String(
    evaluation.scopeId || evaluation.effectiveAccess?.operation?.scopeId || ''
  ).trim();
  const scopeMode = scopeId ? await effectiveAccessResolverService.getScopeMode(scopeId) : '';
  return scopeMode === 'organization' || scopeMode === 'admin';
}

function conductPayloadDiffers(existing = {}, incoming = {}) {
  const keys = sessionConductService.CONDUCT_PERCENT_KEYS;
  return keys.some((key) => {
    if (!Object.prototype.hasOwnProperty.call(incoming, key)) return false;
    const inc = incoming[key];
    const ex = existing[key];
    return String(inc ?? '') !== String(ex ?? '');
  });
}

async function assertCanEditRosterConduct({
  existingRow = null,
  incomingRow = null,
  reqUser = null,
  ipAddress = '',
  classId = '',
  sessionId = '',
  submittedLockSet = null
} = {}) {
  const personId = personKey(incomingRow?.personId || existingRow?.personId);
  const locked = await isPersonConductLockedForSession({
    personId,
    rosterRow: existingRow,
    submittedLockSet,
    classId,
    sessionId,
    reqUser
  });
  if (!locked) return;
  const overrideAllowed = await canOverrideReportLinkedConductLock(reqUser, ipAddress);
  if (overrideAllowed) return;
  if (incomingRow && !conductPayloadDiffers(existingRow, incomingRow)) return;
  // #region agent log
  debugConductLockLog(
    'sessionConductReportLockService:assertCanEditRosterConduct',
    'blocked conduct edit',
    { personId, classId: toPublicId(classId), sessionId: String(sessionId || '').trim() },
    'H4'
  );
  // #endregion
  const err = new Error('Class conduct for this student is locked because a linked report was submitted.');
  err.code = 'CONDUCT_LOCKED_BY_REPORT';
  err.statusCode = 403;
  throw err;
}

module.exports = {
  CONDUCT_LOCK_FIELDS,
  instanceLinksConductForLock,
  isRosterConductLockedByReport,
  buildSubmittedConductLockPersonIdSet,
  isPersonConductLockedForSession,
  resolvePersonIdForInstanceStudent,
  lockConductForSubmittedReport,
  unlockConductForReopenedReport,
  canOverrideReportLinkedConductLock,
  assertCanEditRosterConduct,
  applyLockFieldsToRosterRow,
  clearLockFieldsFromRosterRow,
  conductPayloadDiffers,
  debugConductLockLog
};
