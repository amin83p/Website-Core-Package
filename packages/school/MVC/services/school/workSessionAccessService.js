'use strict';

const schoolDataService = require('./schoolDataService');
const schoolRecordAccessService = require('./schoolRecordAccessService');
const schoolAdminAccessService = require('./schoolAdminAccessService');
const activityService = require('./activityService');
const { requireCoreModule } = require('./schoolCoreContracts');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');
const accessService = requireCoreModule('MVC/services/security/accessControl');
const effectiveAccessResolverService = requireCoreModule('MVC/services/security/effectiveAccessResolverService');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const {
  SCOPE_MODES,
  buildSchoolListScope,
  resolveScopeModeFromName,
  normalizeScopeName
} = require('./schoolDataScopeBuilder');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

const WORK_SESSION_SECTIONS = [SECTIONS.SCHOOL_WORK_SESSIONS, SECTIONS.SCHOOL_ACTIVITIES];

function createDeniedError(message = 'You do not have access to this work session.', statusCode = 403) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeId(value) {
  return String(value || '').trim();
}

function normalizeStatus(value, fallback = '') {
  return String(value || fallback || '').trim().toLowerCase();
}

function isAssigneeOnActivityEntry(entry = {}, personId = '') {
  const normalizedPersonId = toPublicId(personId);
  if (!normalizedPersonId || !entry) return false;
  return (Array.isArray(entry.assignees) ? entry.assignees : [])
    .some((row) => idsEqual(row?.personId, normalizedPersonId));
}

function entryHasLockedAssignees(entry = {}) {
  return normalizeAssigneeRows(entry.assignees).some((row) => (
    activityService.isWorkSessionAssigneeLocked(entry, row)
  ));
}

function normalizeAssigneeRows(rows = []) {
  if (typeof activityService.normalizeActivityAssigneeRows === 'function') {
    return activityService.normalizeActivityAssigneeRows(rows);
  }
  return (Array.isArray(rows) ? rows : []).filter(Boolean);
}

function buildRouteAccessContext(req) {
  return schoolDataService.buildRouteAccessContext(req);
}

function resolveAccess(reqUser, accessContext = {}) {
  const scope = buildSchoolListScope(reqUser, { accessContext });
  return {
    ...scope,
    userId: scope.userId || toPublicId(reqUser?.id || reqUser?.userId),
    personId: scope.personId || toPublicId(reqUser?.personId)
  };
}

function requiresAssigneeVisibilityForScope(scopeName = '') {
  const normalized = normalizeScopeName(scopeName);
  return normalized === 'OWNER' || normalized === 'DIVISION' || normalized === 'DEPARTMENT';
}

function buildBypassCapabilities(scopeName = 'ADMIN') {
  return Object.freeze({
    canUpdate: true,
    isBypassAdmin: true,
    scopeName,
    scopeMode: SCOPE_MODES.ORG_WIDE,
    requiresAssigneeVisibility: false,
    canEditSessionMetadataFull: true,
    canEditSessionMetadataPartial: true,
    canManageAssigneeRoster: true,
    canEditAnyAssigneeRow: true,
    canEditOwnAssigneeStatus: true,
    canEditOwnAssigneeRole: true,
    canEditOwnAssigneeTiming: true,
    canEditOwnAssigneeNotes: true,
    canEditOwnAssigneePayable: true,
    canEditOwnAssigneePaidHours: true
  });
}

function buildDeniedCapabilities(scopeName = 'USER') {
  return Object.freeze({
    canUpdate: false,
    isBypassAdmin: false,
    scopeName,
    scopeMode: resolveScopeModeFromName(scopeName),
    requiresAssigneeVisibility: false,
    canEditSessionMetadataFull: false,
    canEditSessionMetadataPartial: false,
    canManageAssigneeRoster: false,
    canEditAnyAssigneeRow: false,
    canEditOwnAssigneeStatus: false,
    canEditOwnAssigneeRole: false,
    canEditOwnAssigneeTiming: false,
    canEditOwnAssigneeNotes: false,
    canEditOwnAssigneePayable: false,
    canEditOwnAssigneePaidHours: false
  });
}

function buildOrgWideCapabilities(scopeName = 'ORGANIZATION', { hasLockedAssignees = false } = {}) {
  const locked = Boolean(hasLockedAssignees);
  return Object.freeze({
    canUpdate: true,
    isBypassAdmin: false,
    scopeName: normalizeScopeName(scopeName) || 'ORGANIZATION',
    scopeMode: SCOPE_MODES.ORG_WIDE,
    requiresAssigneeVisibility: false,
    canEditSessionMetadataFull: !locked,
    canEditSessionMetadataPartial: locked,
    canManageAssigneeRoster: true,
    canEditAnyAssigneeRow: true,
    canEditOwnAssigneeStatus: true,
    canEditOwnAssigneeRole: true,
    canEditOwnAssigneeTiming: true,
    canEditOwnAssigneeNotes: true,
    canEditOwnAssigneePayable: true,
    canEditOwnAssigneePaidHours: true
  });
}

function buildCapabilitiesForScope(scopeName = '', options = {}) {
  const normalized = normalizeScopeName(scopeName) || 'USER';
  if (normalized === 'USER') return buildDeniedCapabilities('USER');
  if (['ORGANIZATION', 'ADMIN', 'GLOBAL', 'ORG'].includes(normalized)) {
    return buildOrgWideCapabilities(normalized, options);
  }
  if (normalized === 'OWNER') {
    return Object.freeze({
      canUpdate: true,
      isBypassAdmin: false,
      scopeName: 'OWNER',
      scopeMode: SCOPE_MODES.OWNER,
      requiresAssigneeVisibility: true,
      canEditSessionMetadataFull: false,
      canEditSessionMetadataPartial: false,
      canManageAssigneeRoster: false,
      canEditAnyAssigneeRow: false,
      canEditOwnAssigneeStatus: true,
      canEditOwnAssigneeRole: false,
      canEditOwnAssigneeTiming: false,
      canEditOwnAssigneeNotes: false,
      canEditOwnAssigneePayable: false,
      canEditOwnAssigneePaidHours: false
    });
  }
  if (normalized === 'DIVISION') {
    return Object.freeze({
      canUpdate: true,
      isBypassAdmin: false,
      scopeName: 'DIVISION',
      scopeMode: SCOPE_MODES.ASSIGNMENT,
      requiresAssigneeVisibility: true,
      canEditSessionMetadataFull: false,
      canEditSessionMetadataPartial: false,
      canManageAssigneeRoster: false,
      canEditAnyAssigneeRow: false,
      canEditOwnAssigneeStatus: true,
      canEditOwnAssigneeRole: true,
      canEditOwnAssigneeTiming: true,
      canEditOwnAssigneeNotes: true,
      canEditOwnAssigneePayable: false,
      canEditOwnAssigneePaidHours: false
    });
  }
  if (normalized === 'DEPARTMENT') {
    return Object.freeze({
      canUpdate: true,
      isBypassAdmin: false,
      scopeName: 'DEPARTMENT',
      scopeMode: SCOPE_MODES.ASSIGNMENT,
      requiresAssigneeVisibility: true,
      canEditSessionMetadataFull: false,
      canEditSessionMetadataPartial: false,
      canManageAssigneeRoster: false,
      canEditAnyAssigneeRow: false,
      canEditOwnAssigneeStatus: true,
      canEditOwnAssigneeRole: true,
      canEditOwnAssigneeTiming: true,
      canEditOwnAssigneeNotes: true,
      canEditOwnAssigneePayable: true,
      canEditOwnAssigneePaidHours: true
    });
  }
  return buildOrgWideCapabilities('ORGANIZATION', options);
}

async function evaluateSectionUpdate(user, sectionId, orgId) {
  return evaluateSectionOperation(user, sectionId, OPERATIONS.UPDATE, orgId);
}

async function evaluateSectionOperation(user, sectionId, operationId, orgId) {
  return accessService.evaluateAccess({
    user,
    sectionId,
    operationId,
    orgId,
    ipAddress: ''
  });
}

async function resolveBypassForOperation(reqUser, operationId, orgId) {
  for (const sectionId of WORK_SESSION_SECTIONS) {
    const authority = await adminAuthorityService.resolveAdminAuthorityAsync({
      user: reqUser,
      sectionId,
      operationId,
      orgId,
      section: { id: sectionId, category: 'SCHOOL' }
    });
    if (schoolAdminAccessService.isFamilyABypassAdminAuthority(authority)) {
      return { bypass: true, scopeName: 'ADMIN' };
    }
    if (authority.isOperationAdminForRequest) {
      return { bypass: true, scopeName: 'ADMIN' };
    }
  }
  return { bypass: false, scopeName: '' };
}

async function resolveEvaluationForOperation(reqUser, operationId, accessContext = {}) {
  if (!reqUser) return { allowed: false, scopeName: 'USER' };
  const orgId = reqUser?.activeOrgId;
  const bypass = await resolveBypassForOperation(reqUser, operationId, orgId);
  if (bypass.bypass) {
    return { allowed: true, scopeName: bypass.scopeName, isBypassAdmin: true, evaluation: null };
  }

  let evaluation = null;
  for (const sectionId of WORK_SESSION_SECTIONS) {
    const candidate = await evaluateSectionOperation(reqUser, sectionId, operationId, orgId);
    if (candidate?.allowed) {
      evaluation = candidate;
      break;
    }
  }

  if (!evaluation?.allowed) {
    const access = resolveAccess(reqUser, accessContext);
    return { allowed: false, scopeName: access.scopeName || 'USER', isBypassAdmin: false, evaluation: null };
  }

  if (schoolAdminAccessService.isFamilyABypassAdminAuthority(evaluation.adminContext || {})) {
    return { allowed: true, scopeName: 'ADMIN', isBypassAdmin: true, evaluation };
  }

  const scopeName = await resolveScopeNameFromEvaluation(evaluation);
  return { allowed: true, scopeName, isBypassAdmin: false, evaluation };
}

function buildReadCapabilitiesForScope(scopeName = '') {
  const normalized = normalizeScopeName(scopeName) || 'USER';
  if (normalized === 'USER') {
    return Object.freeze({ canOpenPage: false, scopeName: 'USER', isBypassAdmin: false });
  }
  return Object.freeze({
    canOpenPage: true,
    scopeName: normalized,
    isBypassAdmin: false
  });
}

function buildReadAllCapabilitiesForScope(scopeName = '') {
  const normalized = normalizeScopeName(scopeName) || 'USER';
  if (normalized === 'USER') {
    return Object.freeze({
      canViewAnyData: false,
      requiresAssigneeEntryFilter: false,
      canViewAllAssignees: false,
      canViewSessionDetailsReadOnly: false,
      scopeName: 'USER',
      isBypassAdmin: false
    });
  }
  if (['ORGANIZATION', 'ADMIN', 'GLOBAL', 'ORG'].includes(normalized)) {
    return Object.freeze({
      canViewAnyData: true,
      requiresAssigneeEntryFilter: false,
      canViewAllAssignees: true,
      canViewSessionDetailsReadOnly: false,
      scopeName: normalized,
      isBypassAdmin: false
    });
  }
  return Object.freeze({
    canViewAnyData: true,
    requiresAssigneeEntryFilter: true,
    canViewAllAssignees: false,
    canViewSessionDetailsReadOnly: true,
    scopeName: normalized,
    isBypassAdmin: false
  });
}

function buildCreateCapabilitiesForScope(scopeName = '') {
  const normalized = normalizeScopeName(scopeName) || 'USER';
  const allowed = ['ORGANIZATION', 'ADMIN', 'GLOBAL', 'ORG'].includes(normalized);
  return Object.freeze({
    canAddAssignees: allowed,
    scopeName: normalized,
    isBypassAdmin: false
  });
}

function buildDeleteCapabilitiesForScope(scopeName = '') {
  const normalized = normalizeScopeName(scopeName) || 'USER';
  const allowed = ['ORGANIZATION', 'ADMIN', 'GLOBAL', 'ORG'].includes(normalized);
  return Object.freeze({
    canRemoveAssignees: allowed,
    scopeName: normalized,
    isBypassAdmin: false
  });
}

function buildBypassReadCapabilities() {
  return Object.freeze({ canOpenPage: true, scopeName: 'ADMIN', isBypassAdmin: true });
}

function buildBypassReadAllCapabilities() {
  return Object.freeze({
    canViewAnyData: true,
    requiresAssigneeEntryFilter: false,
    canViewAllAssignees: true,
    canViewSessionDetailsReadOnly: false,
    scopeName: 'ADMIN',
    isBypassAdmin: true
  });
}

function buildBypassCreateCapabilities() {
  return Object.freeze({ canAddAssignees: true, scopeName: 'ADMIN', isBypassAdmin: true });
}

function buildBypassDeleteCapabilities() {
  return Object.freeze({ canRemoveAssignees: true, scopeName: 'ADMIN', isBypassAdmin: true });
}

async function resolveReadCapabilities(reqUser, accessContext = {}) {
  const resolved = await resolveEvaluationForOperation(reqUser, OPERATIONS.READ, accessContext);
  if (resolved.isBypassAdmin) return buildBypassReadCapabilities();
  if (!resolved.allowed) return buildReadCapabilitiesForScope('USER');
  return buildReadCapabilitiesForScope(resolved.scopeName);
}

async function resolveReadAllCapabilities(reqUser, accessContext = {}) {
  const resolved = await resolveEvaluationForOperation(reqUser, OPERATIONS.READ_ALL, accessContext);
  if (resolved.isBypassAdmin) return buildBypassReadAllCapabilities();
  if (!resolved.allowed) return buildReadAllCapabilitiesForScope('USER');
  return buildReadAllCapabilitiesForScope(resolved.scopeName);
}

async function resolveCreateCapabilities(reqUser, accessContext = {}) {
  const resolved = await resolveEvaluationForOperation(reqUser, OPERATIONS.CREATE, accessContext);
  if (resolved.isBypassAdmin) return buildBypassCreateCapabilities();
  if (!resolved.allowed) return buildCreateCapabilitiesForScope('USER');
  return buildCreateCapabilitiesForScope(resolved.scopeName);
}

async function resolveDeleteCapabilities(reqUser, accessContext = {}) {
  const resolved = await resolveEvaluationForOperation(reqUser, OPERATIONS.DELETE, accessContext);
  if (resolved.isBypassAdmin) return buildBypassDeleteCapabilities();
  if (!resolved.allowed) return buildDeleteCapabilitiesForScope('USER');
  return buildDeleteCapabilitiesForScope(resolved.scopeName);
}

async function resolveWorkSessionAccessBundle(reqUser, accessContext = {}, options = {}) {
  const [readCaps, readAllCaps, createCaps, deleteCaps, updateCaps] = await Promise.all([
    resolveReadCapabilities(reqUser, accessContext),
    resolveReadAllCapabilities(reqUser, accessContext),
    resolveCreateCapabilities(reqUser, accessContext),
    resolveDeleteCapabilities(reqUser, accessContext),
    resolveUpdateCapabilities(reqUser, accessContext, options)
  ]);
  return Object.freeze({
    read: readCaps,
    readAll: readAllCaps,
    create: createCaps,
    delete: deleteCaps,
    update: updateCaps
  });
}

function assertCanReadWorkSession({
  activity,
  entry,
  reqUser,
  accessContext = {},
  readCapabilities = null,
  readAllCapabilities = null
} = {}) {
  const readCaps = readCapabilities || { canOpenPage: false };
  const readAllCaps = readAllCapabilities || { canViewAnyData: false };
  if (!readCaps.canOpenPage) {
    throw createDeniedError('You do not have permission to open Manage Work Session.');
  }
  if (!readAllCaps.canViewAnyData) {
    throw createDeniedError('You do not have permission to view this work session.');
  }
  const access = resolveAccess(reqUser, accessContext);
  if (readAllCaps.requiresAssigneeEntryFilter) {
    if (!isAssigneeOnActivityEntry(entry, access.personId)) {
      throw createDeniedError('You do not have access to this work session.');
    }
  }
  schoolRecordAccessService.assertActivityWorkSessionAccessible({
    activity,
    entry,
    access,
    context: 'manageWorkSession'
  });
}

function assertCanMutateWorkSession({
  activity,
  entry,
  reqUser,
  accessContext = {},
  updateCapabilities = null
} = {}) {
  if (!updateCapabilities?.canUpdate) {
    throw createDeniedError('You do not have permission to update this work session.');
  }
  assertCanReadWorkSession({
    activity,
    entry,
    reqUser,
    accessContext,
    readCapabilities: { canOpenPage: true },
    readAllCapabilities: {
      canViewAnyData: true,
      requiresAssigneeEntryFilter: Boolean(updateCapabilities.requiresAssigneeVisibility)
    }
  });
}

function assertCanAddAssignees({ createCapabilities = {} } = {}) {
  if (!createCapabilities.canAddAssignees && !createCapabilities.isBypassAdmin) {
    throw createDeniedError('You cannot add assignees to this work session.');
  }
}

function assertCanRemoveAssignees({ deleteCapabilities = {} } = {}) {
  if (!deleteCapabilities.canRemoveAssignees && !deleteCapabilities.isBypassAdmin) {
    throw createDeniedError('You cannot remove assignees from this work session.');
  }
}

function detectAssigneeRosterChanges(priorAssignees = [], nextPersonIds = []) {
  const priorIds = new Set(normalizeAssigneeRows(priorAssignees).map((row) => normalizeId(row.personId)).filter(Boolean));
  const nextIds = new Set((Array.isArray(nextPersonIds) ? nextPersonIds : []).map(normalizeId).filter(Boolean));
  const added = [...nextIds].filter((id) => !priorIds.has(id));
  const removed = [...priorIds].filter((id) => !nextIds.has(id));
  return { added, removed };
}

function assertAssigneeRosterChanges({
  priorEntryAssignees = [],
  nextAssigneePersonIds = [],
  createCapabilities = {},
  deleteCapabilities = {}
} = {}) {
  const { added, removed } = detectAssigneeRosterChanges(priorEntryAssignees, nextAssigneePersonIds);
  if (added.length) assertCanAddAssignees({ createCapabilities });
  if (removed.length) assertCanRemoveAssignees({ deleteCapabilities });
}

async function resolveScopeNameFromEvaluation(evaluation = {}) {
  const scopeId = String(
    evaluation.scopeId || evaluation.effectiveAccess?.operation?.scopeId || ''
  ).trim();
  if (!scopeId) return 'ORGANIZATION';
  const scopeMode = await effectiveAccessResolverService.getScopeMode(scopeId);
  const fromMode = normalizeScopeName(scopeMode);
  if (fromMode) return fromMode;
  return normalizeScopeName(scopeId) || 'ORGANIZATION';
}

async function resolveUpdateCapabilities(reqUser, accessContext = {}, options = {}) {
  if (!reqUser) return buildDeniedCapabilities('USER');
  const resolved = await resolveEvaluationForOperation(reqUser, OPERATIONS.UPDATE, accessContext);
  if (resolved.isBypassAdmin) return buildBypassCapabilities('ADMIN');
  if (!resolved.allowed) {
    return buildDeniedCapabilities(resolved.scopeName || 'USER');
  }
  return buildCapabilitiesForScope(resolved.scopeName, {
    hasLockedAssignees: Boolean(options.hasLockedAssignees)
  });
}

function assertCanOpenWorkSession(options = {}) {
  const updateCapabilities = options.updateCapabilities || options.capabilities;
  assertCanMutateWorkSession({ ...options, updateCapabilities });
}

function fieldChanged(before, after) {
  return String(before ?? '') !== String(after ?? '');
}

function assertAssigneeFieldChanges({
  capabilities = {},
  assignee = {},
  prior = {},
  isSelf = false,
  input = {},
  evaluationType = 'attendance'
} = {}) {
  if (capabilities.canEditAnyAssigneeRow) return;

  const can = (flag) => isSelf && capabilities[flag] === true;

  if (input.role !== undefined && fieldChanged(prior.role, input.role) && !can('canEditOwnAssigneeRole')) {
    throw createDeniedError('You cannot change assignee role.');
  }
  if (input.startTime !== undefined && fieldChanged(prior.startTime, input.startTime) && !can('canEditOwnAssigneeTiming')) {
    throw createDeniedError('You cannot change assignee start time.');
  }
  if (input.endTime !== undefined && fieldChanged(prior.endTime, input.endTime) && !can('canEditOwnAssigneeTiming')) {
    throw createDeniedError('You cannot change assignee end time.');
  }
  if (input.notes !== undefined && fieldChanged(prior.notes, input.notes) && !can('canEditOwnAssigneeNotes')) {
    throw createDeniedError('You cannot change assignee notes.');
  }
  if (input.paid !== undefined && Boolean(prior.paid !== false) !== Boolean(input.paid === true || input.paid === 'true' || input.paid === 'on') && !can('canEditOwnAssigneePayable')) {
    throw createDeniedError('You cannot change assignee payable status.');
  }
  if (input.paidHours !== undefined && Number(prior.paidHours || 0) !== Number(input.paidHours || 0) && !can('canEditOwnAssigneePaidHours')) {
    throw createDeniedError('You cannot change assignee paid hours.');
  }
  if (evaluationType === 'attendance' && input.status !== undefined && fieldChanged(prior.status, input.status) && !can('canEditOwnAssigneeStatus')) {
    throw createDeniedError('You cannot change assignee attendance status.');
  }
  if (input.completionStatus !== undefined && fieldChanged(prior.completionStatus, input.completionStatus) && !can('canEditOwnAssigneeStatus')) {
    throw createDeniedError('You cannot change assignee completion status.');
  }
}

function assertSessionMetadataChanges({
  capabilities = {},
  priorEntry = {},
  input = {},
  nextAssigneePersonIds = [],
  priorEntryAssignees = []
} = {}) {
  if (capabilities.isBypassAdmin || capabilities.canEditSessionMetadataFull) return;

  if (!capabilities.canEditSessionMetadataPartial) {
    throw createDeniedError('You cannot edit work session metadata.');
  }

  const structuralFields = ['date', 'startTime', 'endTime', 'status'];
  structuralFields.forEach((field) => {
    const before = priorEntry[field];
    const after = input[field] === undefined ? before : input[field];
    if (fieldChanged(before, after)) {
      throw createDeniedError('Date, time, and status cannot be changed while assignees are locked by a submitted timesheet.');
    }
  });

  const priorDuration = Number(priorEntry.durationHours || 0);
  const nextStart = input.startTime === undefined ? priorEntry.startTime : input.startTime;
  const nextEnd = input.endTime === undefined ? priorEntry.endTime : input.endTime;
  if (input.startTime !== undefined || input.endTime !== undefined) {
    if (fieldChanged(priorEntry.startTime, nextStart) || fieldChanged(priorEntry.endTime, nextEnd)) {
      throw createDeniedError('Date, time, and status cannot be changed while assignees are locked by a submitted timesheet.');
    }
  }
  if (input.durationHours !== undefined && Number(input.durationHours) !== priorDuration) {
    throw createDeniedError('Date, time, and status cannot be changed while assignees are locked by a submitted timesheet.');
  }

  const priorIds = new Set(normalizeAssigneeRows(priorEntryAssignees).map((row) => normalizeId(row.personId)).filter(Boolean));
  const nextIds = new Set((Array.isArray(nextAssigneePersonIds) ? nextAssigneePersonIds : []).map(normalizeId).filter(Boolean));
  for (const priorId of priorIds) {
    if (!nextIds.has(priorId)) {
      const priorRow = normalizeAssigneeRows(priorEntryAssignees).find((row) => idsEqual(row.personId, priorId));
      if (priorRow && activityService.isAssigneeTimesheetLocked(priorRow)) {
        throw createDeniedError('Locked assignees cannot be removed from this work session.');
      }
      if (priorRow && activityService.isWorkSessionAssigneeLocked(priorEntry, priorRow)) {
        throw createDeniedError('Locked assignees cannot be removed from this work session.');
      }
    }
  }
}

function buildAssigneeFieldCapabilities(capabilities = {}, { isSelf = false, locked = false } = {}) {
  if (locked || !capabilities.canUpdate) {
    return {
      canEditStatus: false,
      canEditRole: false,
      canEditTiming: false,
      canEditNotes: false,
      canEditPayable: false,
      canEditPaidHours: false
    };
  }
  if (capabilities.canEditAnyAssigneeRow) {
    return {
      canEditStatus: true,
      canEditRole: true,
      canEditTiming: true,
      canEditNotes: true,
      canEditPayable: true,
      canEditPaidHours: true
    };
  }
  if (!isSelf) {
    return {
      canEditStatus: false,
      canEditRole: false,
      canEditTiming: false,
      canEditNotes: false,
      canEditPayable: false,
      canEditPaidHours: false
    };
  }
  return {
    canEditStatus: Boolean(capabilities.canEditOwnAssigneeStatus),
    canEditRole: Boolean(capabilities.canEditOwnAssigneeRole),
    canEditTiming: Boolean(capabilities.canEditOwnAssigneeTiming),
    canEditNotes: Boolean(capabilities.canEditOwnAssigneeNotes),
    canEditPayable: Boolean(capabilities.canEditOwnAssigneePayable),
    canEditPaidHours: Boolean(capabilities.canEditOwnAssigneePaidHours)
  };
}

function canEditAssigneeRow(capabilities = {}, { isSelf = false, locked = false } = {}) {
  if (locked || !capabilities.canUpdate) return false;
  if (capabilities.canEditAnyAssigneeRow) return true;
  if (!isSelf) return false;
  const fields = buildAssigneeFieldCapabilities(capabilities, { isSelf, locked });
  return Object.values(fields).some(Boolean);
}

module.exports = {
  buildRouteAccessContext,
  resolveAccess,
  resolveReadCapabilities,
  resolveReadAllCapabilities,
  resolveCreateCapabilities,
  resolveDeleteCapabilities,
  resolveUpdateCapabilities,
  resolveWorkSessionAccessBundle,
  assertCanReadWorkSession,
  assertCanMutateWorkSession,
  assertCanOpenWorkSession,
  assertCanAddAssignees,
  assertCanRemoveAssignees,
  assertAssigneeRosterChanges,
  detectAssigneeRosterChanges,
  assertAssigneeFieldChanges,
  assertSessionMetadataChanges,
  buildAssigneeFieldCapabilities,
  canEditAssigneeRow,
  requiresAssigneeVisibilityForScope,
  isAssigneeOnActivityEntry,
  entryHasLockedAssignees,
  buildCapabilitiesForScope,
  buildReadAllCapabilitiesForScope,
  buildReadCapabilitiesForScope,
  buildCreateCapabilitiesForScope,
  buildDeleteCapabilitiesForScope,
  buildBypassCapabilities,
  buildBypassReadCapabilities,
  buildBypassReadAllCapabilities,
  buildBypassCreateCapabilities,
  buildBypassDeleteCapabilities,
  buildDeniedCapabilities
};
