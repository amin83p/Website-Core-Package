'use strict';

const schoolDataService = require('./schoolDataService');
const schoolRecordAccessService = require('./schoolRecordAccessService');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const sessionNavigationService = require('./sessionNavigationService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { getActiveOrgIdOrThrow, assertOrgAccess } = requireCoreModule('MVC/utils/orgContextUtils');

const ACCESS_CHECK_CATEGORY = 'sessionDeliveryEscalated';
const SESSION_DELIVERY_ORG_ACCESS_CONTEXT = { scopeId: 'SCP_ORG' };

function assertClassOrgAccess(classData, activeOrgId, reqUser) {
  assertOrgAccess(classData, activeOrgId, reqUser, { orgField: 'orgId', allowSystemBypass: true });
}

function findSessionInList(sessions, sessionId, sessionDate = '') {
  const list = Array.isArray(sessions) ? sessions : [];
  const normalizedDate = sessionNavigationService.normalizeSessionDate(sessionDate);
  if (normalizedDate) {
    const datedIndex = list.findIndex((row) => sessionNavigationService.sessionMatchesIdentity(row, sessionId, normalizedDate));
    if (datedIndex >= 0) return { index: datedIndex, session: list[datedIndex] };
  }
  const index = list.findIndex((row) => idsEqual(row?.sessionId || row?.id, sessionId));
  return { index, session: index >= 0 ? list[index] : null };
}

function assertSessionScopeForRequest(req, classData, session, context = 'manageSession') {
  schoolRecordAccessService.assertSessionAccessible({
    classRow: classData,
    session,
    access: schoolRecordAccessService.resolveAccessFromRequest(req),
    context
  });
}

async function loadClassForSessionManage(req, classId, { sessionId = '', sessionDate = '' } = {}) {
  const accessContext = schoolRecordAccessService.buildRouteAccessContext(req);
  const activeOrgId = getActiveOrgIdOrThrow(req.user);
  let classData = await schoolDataService.getDataById('classes', classId, req.user, accessContext);
  if (classData) {
    assertClassOrgAccess(classData, activeOrgId, req.user);
    return { classData, activeOrgId, escalated: false };
  }

  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) {
    throw schoolRecordAccessService.createAccessDeniedError(schoolRecordAccessService.CLASS_ACCESS_DENIED);
  }

  classData = await schoolDataService.getDataById('classes', classId, req.user, SESSION_DELIVERY_ORG_ACCESS_CONTEXT);
  if (!classData) {
    throw schoolRecordAccessService.createAccessDeniedError(schoolRecordAccessService.CLASS_ACCESS_DENIED);
  }
  assertClassOrgAccess(classData, activeOrgId, req.user);
  const sessions = Array.isArray(classData.sessions) ? classData.sessions : [];
  const { session } = findSessionInList(sessions, normalizedSessionId, sessionDate);
  if (!session) {
    throw schoolRecordAccessService.createAccessDeniedError(schoolRecordAccessService.CLASS_ACCESS_DENIED);
  }

  const sessionAccess = schoolRecordAccessService.resolveAccessFromRequest(req);
  try {
    schoolRecordAccessService.assertSessionAccessible({
      classRow: classData,
      session,
      access: sessionAccess,
      context: 'manageSession'
    });
  } catch (_) {
    schoolRecordAccessService.assertSessionAccessible({
      classRow: classData,
      session,
      access: sessionAccess,
      context: 'viewSession'
    });
  }

  return { classData, activeOrgId, escalated: true };
}

function cacheKey(classId, sessionId, sessionDate) {
  return `${toPublicId(classId)}::${toPublicId(sessionId)}::${sessionNavigationService.normalizeSessionDate(sessionDate) || ''}`;
}

async function loadSessionManageContext(req, { classId, sessionId, sessionDate = '' } = {}) {
  const normalizedClassId = toPublicId(classId);
  const normalizedSessionId = toPublicId(sessionId);
  if (!normalizedClassId || !normalizedSessionId) {
    throw schoolRecordAccessService.createAccessDeniedError(schoolRecordAccessService.CLASS_ACCESS_DENIED);
  }

  const key = cacheKey(normalizedClassId, normalizedSessionId, sessionDate);
  if (req._sessionDeliveryManageContext && req._sessionDeliveryManageContext.key === key) {
    return req._sessionDeliveryManageContext.payload;
  }

  const routeAccessContext = schoolRecordAccessService.buildRouteAccessContext(req);
  const { classData, activeOrgId, escalated } = await loadClassForSessionManage(req, normalizedClassId, {
    sessionId: normalizedSessionId,
    sessionDate
  });

  const scopedClassRow = await schoolDataService.getDataById('classes', normalizedClassId, req.user, routeAccessContext);
  const persistAccessContext = scopedClassRow ? routeAccessContext : SESSION_DELIVERY_ORG_ACCESS_CONTEXT;
  let sessions = await schoolDataService.getClassSessions(normalizedClassId, req.user, persistAccessContext);
  if (!sessions.length && Array.isArray(classData?.sessions) && classData.sessions.length) {
    sessions = classData.sessions;
  }

  const payload = {
    classData,
    activeOrgId,
    sessions,
    persistAccessContext,
    escalated,
    accessCategory: escalated ? ACCESS_CHECK_CATEGORY : ''
  };

  if (req && typeof req === 'object') {
    req.sessionDeliveryAccess = {
      category: escalated ? ACCESS_CHECK_CATEGORY : '',
      escalated,
      persistAccessContext
    };
    req._sessionDeliveryManageContext = { key, payload };
  }

  return payload;
}

function isMakeUpRequiredSessionByMap(statusMap, session = {}) {
  const resolved = sessionStatusPolicyService.resolveStatusDefinition(statusMap, {
    status: session?.status,
    notes: session?.notes
  });
  return resolved?.definition?.makeUpRequired === true;
}

async function assertSessionInstructionalActive(req, { classId, sessionId, sessionDate = '' } = {}) {
  const ctx = await loadSessionManageContext(req, { classId, sessionId, sessionDate });
  const { classData, sessions, persistAccessContext } = ctx;
  const sessionIndex = (Array.isArray(sessions) ? sessions : [])
    .findIndex((row) => idsEqual(row?.sessionId || row?.id, sessionId));
  if (sessionIndex < 0) throw new Error('Session not found.');
  const session = sessions[sessionIndex];
  if (req?.user) {
    assertSessionScopeForRequest(req, classData, session, 'manageSession');
  }
  const statusMap = await sessionStatusPolicyService.getStatusMap(classData?.orgId || getActiveOrgIdOrThrow(req.user), {
    includeInactive: true
  });
  if (isMakeUpRequiredSessionByMap(statusMap, session)) {
    throw new Error('This original session is inactive because its status requires a make-up session. Attendance, gradebook, content, cases, and files are not available for this session. Create or open the make-up session instead.');
  }
  return {
    ...ctx,
    sessionIndex,
    session,
    statusMap
  };
}

module.exports = {
  ACCESS_CHECK_CATEGORY,
  SESSION_DELIVERY_ORG_ACCESS_CONTEXT,
  findSessionInList,
  loadClassForSessionManage,
  loadSessionManageContext,
  assertSessionInstructionalActive
};
