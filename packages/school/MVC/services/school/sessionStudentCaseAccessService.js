'use strict';

const schoolRecordAccessService = require('./schoolRecordAccessService');
const sessionStudentCaseRoutingService = require('./sessionStudentCaseRoutingService');
const studentCaseAccessService = require('./studentCaseAccessService');

function createDeniedError(message = 'You do not have access to this student case.', statusCode = 403) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function loadStudentCaseAccess(req) {
  if (req._studentCaseAccess) return req._studentCaseAccess;
  const access = await studentCaseAccessService.buildStudentCaseAccess(req.user, req.ip);
  req._studentCaseAccess = access;
  return access;
}

function resolveSessionMutationOk(user, classData, session, sectionAccess) {
  if (!classData || !session) return true;
  const access = sectionAccess
    || studentCaseAccessService.buildStudentCaseSectionAccessContext(user, {});
  return schoolRecordAccessService.isSessionAccessible({
    classRow: classData,
    session,
    access,
    context: 'mutation'
  });
}

function mapAccessToCapabilities(sectionAccess, sessionMutationOk) {
  const canRead = Boolean(sectionAccess.canOpenList || sectionAccess.adminFlags?.read);
  const canReadAll = Boolean(sectionAccess.canViewCases);
  const canCreate = Boolean(sectionAccess.canCreateCases && sessionMutationOk);
  const canUpdate = Boolean(sectionAccess.canUpdateCases && sessionMutationOk);
  const canResolve = Boolean(sectionAccess.canResolveCases && sessionMutationOk);
  const canDelete = Boolean(sectionAccess.canDeleteCases && sessionMutationOk);
  const readOnly = (canRead || canReadAll) && !canUpdate;

  return {
    canCreate,
    canRead,
    canReadAll,
    canUpdate,
    canResolve,
    canDelete,
    canOverrideLockedCaseEdit: Boolean(sectionAccess.canOverrideLockedCaseEdit),
    canOverrideLockedCaseDelete: Boolean(sectionAccess.canOverrideLockedCaseDelete),
    readOnly,
    canEdit: canUpdate
  };
}

async function isCaseRoutedToViewer(req, caseRow = null) {
  if (!caseRow) return false;
  const orgId = sessionStudentCaseRoutingService.getActiveOrgId(req.user);
  const personId = sessionStudentCaseRoutingService.getViewerPersonId(req.user);
  if (!orgId || !personId) return false;
  const policy = await sessionStudentCaseRoutingService.getRoutingPolicyForOrg(orgId);
  return sessionStudentCaseRoutingService.isCaseRoutedToPerson(caseRow, personId, policy);
}

async function applyRoutedCaseCapabilityOverrides(req, capabilities, caseRow = null, sectionAccess = null) {
  if (!caseRow) return capabilities;
  const access = sectionAccess || await loadStudentCaseAccess(req);
  if (!access.canViewCases) return capabilities;

  const isRouted = await isCaseRoutedToViewer(req, caseRow);
  if (!isRouted) return capabilities;

  const next = {
    ...capabilities,
    canRead: true,
    canReadAll: true
  };
  if (access.canResolveCases) {
    next.canResolve = true;
  }
  return next;
}

async function resolveCaseCapabilities(req, { classData = null, session = null, caseRow = null } = {}) {
  const sectionAccess = await loadStudentCaseAccess(req);
  const sectionContext = studentCaseAccessService.buildStudentCaseSectionAccessContext(req.user, sectionAccess);
  const sessionMutationOk = resolveSessionMutationOk(req.user, classData, session, sectionContext);

  let capabilities = mapAccessToCapabilities(sectionAccess, sessionMutationOk);

  if (caseRow) {
    capabilities = await applyRoutedCaseCapabilityOverrides(req, capabilities, caseRow, sectionAccess);
    capabilities.readOnly = (capabilities.canRead || capabilities.canReadAll) && !capabilities.canUpdate;
    capabilities.canEdit = capabilities.canUpdate;
  }

  return capabilities;
}

async function resolveListCapabilities(req) {
  const sectionAccess = await loadStudentCaseAccess(req);
  return mapAccessToCapabilities(sectionAccess, true);
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

async function assertCanViewCases(req, classData = null, session = null, caseRow = null) {
  const capabilities = await resolveCaseCapabilities(req, { classData, session, caseRow });
  await assertCapability(req, capabilities, 'canReadAll', 'Student case list data requires READ_ALL access.');
  return capabilities;
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
  assertCanViewCases,
  assertCanUpdate,
  assertCanResolve,
  assertCanDelete,
  assertCanSave,
  createDeniedError,
  isCaseRoutedToViewer,
  applyRoutedCaseCapabilityOverrides,
  loadStudentCaseAccess
};
