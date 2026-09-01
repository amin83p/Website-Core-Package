'use strict';

const schoolDataService = require('./schoolDataService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');
const {
  SCOPE_MODES,
  buildSchoolListScope,
  getScopedPersonId
} = require('./schoolDataScopeBuilder');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const accessService = requireCoreModule('MVC/services/security/index');

const BOOK_COVERING_SECTION = SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING;

function createDeniedError(message = 'You do not have access to this book covering report.', statusCode = 403) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function buildRouteAccessContext(req) {
  return schoolDataService.buildRouteAccessContext(req);
}

function resolveAccessFromRequest(req, accessContext = null) {
  const context = accessContext || buildRouteAccessContext(req);
  const scope = buildSchoolListScope(req?.user, { accessContext: context });
  return {
    ...scope,
    userId: scope.userId || toPublicId(req?.user?.id || req?.user?.userId),
    personId: scope.personId || getScopedPersonId(req?.user)
  };
}

function isOrgWideAccess(access = {}) {
  if (access?.denyAll === true) return false;
  if (access?.canViewAll === true) return true;
  return access?.scopeMode === SCOPE_MODES.ORG_WIDE;
}

function readOwnerUserIds(record = {}) {
  return [
    record?.ownerUserId,
    record?.createdBy,
    record?.createdByUserId,
    record?.creator?.userId,
    record?.audit?.createUser
  ].map((value) => toPublicId(value)).filter(Boolean);
}

function isReportOwnedByUser(record = {}, userId = '') {
  const scopedUserId = toPublicId(userId);
  if (!scopedUserId || !record) return false;
  return readOwnerUserIds(record).some((ownerId) => idsEqual(ownerId, scopedUserId));
}

function isReportOwnedByViewer(report = {}, access = {}) {
  if (!report) return false;
  const personId = toPublicId(access?.personId);
  if (personId && idsEqual(report?.teacherId, personId)) return true;
  return isReportOwnedByUser(report, access?.userId);
}

function canAccessReport(report = {}, access = {}) {
  if (!report) return false;
  if (access?.denyAll === true || access?.scopeMode === SCOPE_MODES.USER) return false;
  if (isOrgWideAccess(access)) return true;
  if (access?.scopeMode === SCOPE_MODES.OWNER) {
    return isReportOwnedByUser(report, access.userId) || isReportOwnedByViewer(report, access);
  }
  if (access?.scopeMode === SCOPE_MODES.ASSIGNMENT) {
    return isReportOwnedByViewer(report, access);
  }
  return false;
}

async function evaluateOperation(req, operationId) {
  try {
    const evaluation = await accessService.evaluateAccess({
      user: req.user,
      sectionId: BOOK_COVERING_SECTION,
      operationId,
      ipAddress: req?.ip
    });
    return evaluation?.allowed === true;
  } catch (_) {
    return false;
  }
}

async function resolveListCapabilities(req) {
  const [canCreate, canRead, canReadAll, canUpdate, canDelete] = await Promise.all([
    evaluateOperation(req, OPERATIONS.CREATE),
    evaluateOperation(req, OPERATIONS.READ),
    evaluateOperation(req, OPERATIONS.READ_ALL),
    evaluateOperation(req, OPERATIONS.UPDATE),
    evaluateOperation(req, OPERATIONS.DELETE)
  ]);
  return {
    canCreate,
    canRead,
    canReadAll,
    canView: canRead || canReadAll,
    canUpdate,
    canDelete
  };
}

function hasViewCapability(capabilities = {}) {
  return Boolean(capabilities?.canRead || capabilities?.canReadAll || capabilities?.canView);
}

function resolveScopedTeacherIdForCreate(req, accessContext = null) {
  const access = resolveAccessFromRequest(req, accessContext);
  if (isOrgWideAccess(access)) return '';
  if (access?.scopeMode === SCOPE_MODES.ASSIGNMENT || access?.scopeMode === SCOPE_MODES.OWNER) {
    return toPublicId(access.personId) || '';
  }
  return '';
}

function assertCanReadReport(req, report, accessContext = null, capabilities = null) {
  const resolvedCapabilities = capabilities || null;
  if (resolvedCapabilities && !hasViewCapability(resolvedCapabilities)) {
    throw createDeniedError('You do not have permission to view book covering reports.');
  }
  const access = resolveAccessFromRequest(req, accessContext);
  if (canAccessReport(report, access)) return access;
  throw createDeniedError('You do not have permission to view this book covering report.');
}

function assertCanMutateReport(req, report, accessContext = null, capabilities = null) {
  if (capabilities && !capabilities?.canUpdate) {
    throw createDeniedError('You do not have permission to modify book covering reports.');
  }
  const access = resolveAccessFromRequest(req, accessContext);
  if (canAccessReport(report, access)) return access;
  throw createDeniedError('You do not have permission to modify this book covering report.');
}

function assertCanDeleteReport(req, report, accessContext = null, capabilities = null) {
  if (capabilities && !capabilities?.canDelete) {
    throw createDeniedError('You do not have permission to delete book covering reports.');
  }
  return assertCanMutateReport(req, report, accessContext, null);
}

function assertCanCreateForTeacher(req, teacherId, accessContext = null) {
  const access = resolveAccessFromRequest(req, accessContext);
  if (isOrgWideAccess(access)) return access;
  const scopedTeacherId = resolveScopedTeacherIdForCreate(req, accessContext);
  if (!scopedTeacherId) {
    throw createDeniedError('You do not have permission to create book covering reports for this teacher.');
  }
  if (!idsEqual(teacherId, scopedTeacherId)) {
    throw createDeniedError('You can only create book covering reports for yourself.');
  }
  return access;
}

function canDeleteReport(req, report, capabilities = {}, accessContext = null) {
  if (!capabilities?.canDelete) return false;
  const access = resolveAccessFromRequest(req, accessContext);
  if (isOrgWideAccess(access)) return true;
  return canAccessReport(report, access);
}

module.exports = {
  buildRouteAccessContext,
  resolveAccessFromRequest,
  resolveListCapabilities,
  resolveScopedTeacherIdForCreate,
  hasViewCapability,
  isOrgWideAccess,
  isReportOwnedByViewer,
  canAccessReport,
  assertCanReadReport,
  assertCanMutateReport,
  assertCanDeleteReport,
  assertCanCreateForTeacher,
  canDeleteReport,
  createDeniedError
};
