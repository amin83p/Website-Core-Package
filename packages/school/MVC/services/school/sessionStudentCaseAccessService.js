'use strict';

const schoolRecordAccessService = require('./schoolRecordAccessService');
const sessionStudentCaseRoutingService = require('./sessionStudentCaseRoutingService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

const accessService = requireCoreModule('MVC/services/security/index');

const CASE_SECTION = SECTIONS.SCHOOL_SESSION_STUDENT_CASES;

function createDeniedError(message = 'You do not have access to this student case.', statusCode = 403) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function evaluateOperation(req, operationId) {
  try {
    const evaluation = await accessService.evaluateAccess({
      user: req.user,
      sectionId: CASE_SECTION,
      operationId,
      ipAddress: req?.ip
    });
    return evaluation?.allowed === true;
  } catch (_) {
    return false;
  }
}

function resolveSessionMutationOk(req, classData, session) {
  if (!classData || !session) return true;
  const access = schoolRecordAccessService.resolveAccessFromRequest(req);
  return schoolRecordAccessService.isSessionAccessible({
    classRow: classData,
    session,
    access,
    context: 'mutation'
  });
}

async function isCaseRoutedToViewer(req, caseRow = null) {
  if (!caseRow) return false;
  const orgId = sessionStudentCaseRoutingService.getActiveOrgId(req.user);
  const personId = sessionStudentCaseRoutingService.getViewerPersonId(req.user);
  if (!orgId || !personId) return false;
  const policy = await sessionStudentCaseRoutingService.getRoutingPolicyForOrg(orgId);
  return sessionStudentCaseRoutingService.isCaseRoutedToPerson(caseRow, personId, policy);
}

async function applyRoutedCaseCapabilityOverrides(req, capabilities, caseRow = null) {
  if (!caseRow) return capabilities;
  const isRouted = await isCaseRoutedToViewer(req, caseRow);
  if (!isRouted) return capabilities;

  const next = {
    ...capabilities,
    canRead: true,
    canReadAll: capabilities.canReadAll || true
  };
  const canResolveOp = await evaluateOperation(req, OPERATIONS.RESOLVE);
  if (canResolveOp) {
    next.canResolve = true;
  }
  return next;
}

async function resolveCaseCapabilities(req, { classData = null, session = null, caseRow = null } = {}) {
  const [
    canCreateOp,
    canReadOp,
    canReadAllOp,
    canUpdateOp,
    canResolveOp,
    canDeleteOp
  ] = await Promise.all([
    evaluateOperation(req, OPERATIONS.CREATE),
    evaluateOperation(req, OPERATIONS.READ),
    evaluateOperation(req, OPERATIONS.READ_ALL),
    evaluateOperation(req, OPERATIONS.UPDATE),
    evaluateOperation(req, OPERATIONS.RESOLVE),
    evaluateOperation(req, OPERATIONS.DELETE)
  ]);

  const sessionMutationOk = resolveSessionMutationOk(req, classData, session);

  const canCreate = canCreateOp && sessionMutationOk;
  const canUpdate = canUpdateOp && sessionMutationOk;
  let canResolve = canResolveOp && sessionMutationOk;
  const canDelete = canDeleteOp && sessionMutationOk;
  const canRead = canReadOp;
  const canReadAll = canReadAllOp;
  const readOnly = (canRead || canReadAll) && !canUpdate;

  let capabilities = {
    canCreate,
    canRead,
    canReadAll,
    canUpdate,
    canResolve,
    canDelete,
    readOnly,
    canEdit: canUpdate
  };

  if (caseRow) {
    capabilities = await applyRoutedCaseCapabilityOverrides(req, capabilities, caseRow);
    capabilities.readOnly = (capabilities.canRead || capabilities.canReadAll) && !capabilities.canUpdate;
    capabilities.canEdit = capabilities.canUpdate;
  }

  return capabilities;
}

async function resolveListCapabilities(req) {
  return resolveCaseCapabilities(req);
}

async function assertCapability(req, capabilities, key, message) {
  if (capabilities?.[key] === true) return;
  throw createDeniedError(message);
}

async function assertCanCreate(req, classData, session) {
  const capabilities = await resolveCaseCapabilities(req, { classData, session });
  await assertCapability(req, capabilities, 'canCreate', 'You do not have permission to create student cases.');
  return capabilities;
}

async function assertCanRead(req, classData, session, caseRow = null) {
  const capabilities = await resolveCaseCapabilities(req, { classData, session, caseRow });
  if (capabilities.canRead || capabilities.canReadAll) return capabilities;
  throw createDeniedError('You do not have permission to view this student case.');
}

async function assertCanUpdate(req, classData, session, caseRow = null) {
  const capabilities = await resolveCaseCapabilities(req, { classData, session, caseRow });
  await assertCapability(req, capabilities, 'canUpdate', 'You do not have permission to edit this case.');
  return capabilities;
}

async function assertCanResolve(req, classData, session, caseRow = null) {
  const capabilities = await resolveCaseCapabilities(req, { classData, session, caseRow });
  await assertCapability(req, capabilities, 'canResolve', 'You do not have permission to resolve this case.');
  return capabilities;
}

async function assertCanDelete(req, classData, session, caseRow = null) {
  const capabilities = await resolveCaseCapabilities(req, { classData, session, caseRow });
  await assertCapability(req, capabilities, 'canDelete', 'You do not have permission to delete this case.');
  return capabilities;
}

async function assertCanSave(req, classData, session, { isCreate = false, resolve = false, caseRow = null } = {}) {
  const capabilities = await resolveCaseCapabilities(req, { classData, session, caseRow });
  if (isCreate) {
    await assertCapability(req, capabilities, 'canCreate', 'You do not have permission to create student cases.');
  } else {
    await assertCapability(req, capabilities, 'canUpdate', 'You do not have permission to edit this case.');
  }
  if (resolve) {
    await assertCapability(req, capabilities, 'canResolve', 'You do not have permission to resolve this case.');
  }
  return capabilities;
}

module.exports = {
  resolveCaseCapabilities,
  resolveListCapabilities,
  assertCanCreate,
  assertCanRead,
  assertCanUpdate,
  assertCanResolve,
  assertCanDelete,
  assertCanSave,
  createDeniedError,
  isCaseRoutedToViewer,
  applyRoutedCaseCapabilityOverrides
};
