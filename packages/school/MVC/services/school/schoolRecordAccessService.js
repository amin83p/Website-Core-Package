const { requireCoreModule } = require('./schoolCoreContracts');
const {
  SCOPE_MODES,
  buildSchoolListScope,
  getScopedPersonId,
  getScopedUserId
} = require('./schoolDataScopeBuilder');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const SESSION_ACCESS_DENIED = 'You do not have access to this session.';
const CLASS_ACCESS_DENIED = 'You do not have access to this class.';
const DATA_ACCESS_DENIED = 'You do not have access to this record.';

function readOwnerUserIds(record = {}) {
  return [
    record?.ownerUserId,
    record?.createdBy,
    record?.createdByUserId,
    record?.creator?.userId,
    record?.audit?.createUser
  ].map((value) => toPublicId(value)).filter(Boolean);
}

function readSessionCreatorUserIds(session = {}) {
  return [
    session?.audit?.createUser,
    session?.makeup?.createdBy,
    session?.createdBy,
    session?.createdByUserId
  ].map((value) => toPublicId(value)).filter(Boolean);
}

function isActiveInstructor(personId, classRow) {
  const normalizedPersonId = toPublicId(personId);
  if (!normalizedPersonId) return false;
  const instructors = Array.isArray(classRow?.instructors) ? classRow.instructors : [];
  return instructors.some((row) => {
    if (!idsEqual(row?.personId, normalizedPersonId)) return false;
    return String(row?.status || 'active').trim().toLowerCase() !== 'inactive';
  });
}

function isSessionDeliveredByPerson(session, personId) {
  const normalizedPersonId = toPublicId(personId);
  if (!normalizedPersonId || !session) return false;
  return idsEqual(session?.delivery?.deliveredBy, normalizedPersonId);
}

function isRecordOwnedByUser(record, userId) {
  const scopedUserId = toPublicId(userId);
  if (!scopedUserId || !record) return false;
  return readOwnerUserIds(record).some((ownerId) => idsEqual(ownerId, scopedUserId));
}

function isSessionOwnedByUser(session, userId) {
  const scopedUserId = toPublicId(userId);
  if (!scopedUserId || !session) return false;
  return readSessionCreatorUserIds(session).some((ownerId) => idsEqual(ownerId, scopedUserId));
}

function buildRouteAccessContext(req) {
  return { scopeId: req?.accessScope || '' };
}

function resolveAccessFromRequest(req, options = {}) {
  const scope = buildSchoolListScope(req?.user, {
    allowSystemFallback: options?.allowSystemFallback === true,
    accessContext: {
      scopeId: req?.accessScope || options?.scopeId || ''
    }
  });
  return {
    ...scope,
    userId: scope.userId || getScopedUserId(req?.user),
    personId: scope.personId || getScopedPersonId(req?.user)
  };
}

function resolveAccessFromUser(reqUser, accessContext = {}, options = {}) {
  return buildSchoolListScope(reqUser, {
    allowSystemFallback: options?.allowSystemFallback === true,
    accessContext
  });
}

function isOrgWideScope(access = {}) {
  if (access?.denyAll === true) return false;
  if (access?.canViewAll === true) return true;
  return access?.scopeMode === SCOPE_MODES.ORG_WIDE;
}

function isClassAccessible(classRow, access = {}) {
  if (!classRow) return false;
  if (access?.denyAll === true || access?.scopeMode === SCOPE_MODES.USER) return false;
  if (isOrgWideScope(access)) return true;
  if (access?.scopeMode === SCOPE_MODES.OWNER) {
    return isRecordOwnedByUser(classRow, access.userId);
  }
  if (access?.scopeMode === SCOPE_MODES.ASSIGNMENT) {
    return isActiveInstructor(access.personId, classRow)
      || isRecordOwnedByUser(classRow, access.userId);
  }
  return true;
}

function isSessionAccessible({ classRow, session, access = {}, context = 'list' } = {}) {
  if (!session) return false;
  if (access?.denyAll === true || access?.scopeMode === SCOPE_MODES.USER) return false;
  if (isOrgWideScope(access)) return true;

  if (context === 'manageSession' || context === 'mutation') {
    if (access?.scopeMode === SCOPE_MODES.ASSIGNMENT) {
      return isSessionDeliveredByPerson(session, access.personId);
    }
    if (access?.scopeMode === SCOPE_MODES.OWNER) {
      return isSessionOwnedByUser(session, access.userId);
    }
    return isOrgWideScope(access);
  }

  if (access?.scopeMode === SCOPE_MODES.OWNER) {
    return isSessionOwnedByUser(session, access.userId)
      || isRecordOwnedByUser(classRow, access.userId);
  }
  if (access?.scopeMode === SCOPE_MODES.ASSIGNMENT) {
    return isSessionDeliveredByPerson(session, access.personId)
      || isActiveInstructor(access.personId, classRow);
  }
  return true;
}

function assertClassAccessible(classRow, access = {}, message = CLASS_ACCESS_DENIED) {
  if (!isClassAccessible(classRow, access)) {
    throw new Error(message);
  }
}

function assertSessionAccessible({
  classRow,
  session,
  access = {},
  context = 'manageSession',
  message = SESSION_ACCESS_DENIED
} = {}) {
  if (!isSessionAccessible({ classRow, session, access, context })) {
    throw new Error(message);
  }
}

function assertRecordAccessible(record, access = {}, message = DATA_ACCESS_DENIED) {
  if (access?.denyAll === true || access?.scopeMode === SCOPE_MODES.USER) {
    throw new Error(message);
  }
  if (isOrgWideScope(access)) return;
  if (!isClassAccessible(record, access)) {
    throw new Error(message);
  }
}

module.exports = {
  SESSION_ACCESS_DENIED,
  CLASS_ACCESS_DENIED,
  DATA_ACCESS_DENIED,
  readOwnerUserIds,
  readSessionCreatorUserIds,
  isActiveInstructor,
  isSessionDeliveredByPerson,
  isRecordOwnedByUser,
  isSessionOwnedByUser,
  resolveAccessFromRequest,
  resolveAccessFromUser,
  isOrgWideScope,
  isClassAccessible,
  isSessionAccessible,
  assertClassAccessible,
  assertSessionAccessible,
  assertRecordAccessible,
  buildRouteAccessContext
};
