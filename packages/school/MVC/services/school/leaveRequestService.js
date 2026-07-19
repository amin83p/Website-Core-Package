const schoolRepositories = require('../../repositories/school');
const schoolDataService = require('./schoolDataService');
const leaveRequestModel = require('../../models/school/leaveRequestModel');
const leaveSessionResolutionService = require('./leaveSessionResolutionService');
const taskService = require('./taskService');
const personDisplayNameService = require('./personDisplayNameService');
const schoolIdentityLookupService = require('./schoolIdentityLookupService');
const schoolRecordAccessService = require('./schoolRecordAccessService');
const { SCOPE_MODES } = require('./schoolDataScopeBuilder');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const adminChekersService = requireCoreModule('MVC/services/adminChekersService');
const { resolveOrgTodayFromContext } = requireCoreModule('MVC/utils/timezoneUtils');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

const ACTIVE_REVIEW_STATUSES = new Set(['submitted', 'pending_reapproval']);
const FINAL_STATUSES = new Set(['rejected', 'cancelled']);
const LEAVE_REQUEST_PERSON_ROLES = Object.freeze(['teacher', 'staff']);

function cleanString(value, max = 5000) {
  if (value === undefined || value === null) return '';
  const text = String(value).replace(/\0/g, '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function cleanDate(value) {
  const text = cleanString(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function cleanTime(value) {
  const text = cleanString(value, 8);
  return /^\d{2}:\d{2}$/.test(text) ? text : '';
}

function normalizeBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function getActiveOrgId(user) {
  return toPublicId(user?.activeOrgId || user?.activeOrganization?.id || user?.primaryOrgId || '');
}

function isSystemOrgId(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/^ORG_/, '');
  return normalized === 'SYSTEM';
}

function canCreateRequest(reqUser) {
  return !isSystemOrgId(getActiveOrgId(reqUser));
}

function assertCreateAllowed(reqUser) {
  if (!canCreateRequest(reqUser)) {
    const error = new Error('Leave requests cannot be created in the System organization.');
    error.code = 'LEAVE_REQUESTS_SYSTEM_ORG_BLOCKED';
    error.statusCode = 403;
    throw error;
  }
}

function getActorId(user) {
  return toPublicId(user?.id || user?._id || user?.userId || user?.username || '');
}

function getActorName(user) {
  const direct = cleanString(user?.displayName || user?.fullName, 160);
  if (direct) return direct;
  if (user?.name && typeof user.name === 'object') {
    return cleanString(`${user.name.first || ''} ${user.name.last || ''}`, 160);
  }
  return getActorId(user) || 'System';
}

async function resolveActorName(user) {
  return personDisplayNameService.resolveUserDisplayName(user, {
    fallback: getActorId(user) || 'System'
  });
}

function isAdminViewer(user) {
  return Boolean(adminChekersService.isAdminForRequest(user, SECTIONS.SCHOOL_LEAVE_REQUESTS, OPERATIONS.READ_ALL, {
    orgId: getActiveOrgId(user),
    section: { id: SECTIONS.SCHOOL_LEAVE_REQUESTS, category: 'SCHOOL' }
  }));
}

function resolveLeaveAccess(reqUser, accessContext = {}) {
  return schoolRecordAccessService.resolveAccessFromUser(reqUser, {
    scopeId: accessContext?.scopeId || accessContext?.accessScope || ''
  });
}

function canViewAllLeaveRequests(reqUser, accessContext = {}) {
  if (isAdminViewer(reqUser)) return true;
  return schoolRecordAccessService.isOrgWideScope(resolveLeaveAccess(reqUser, accessContext));
}

function getRequesterPersonId(user) {
  return toPublicId(user?.personId || user?.profile?.personId || user?.person?.id || '');
}

function collectRoleTokens(value, out = [], depth = 0) {
  if (value === undefined || value === null || depth > 4) return out;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const token = cleanString(value, 120).toLowerCase();
    if (token) out.push(token);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectRoleTokens(item, out, depth + 1));
    return out;
  }
  if (typeof value !== 'object') return out;

  [
    'role',
    'roleName',
    'name',
    'type',
    'code',
    'key',
    'id',
    'label',
    'value',
    'title',
    'accountType'
  ].forEach((key) => collectRoleTokens(value[key], out, depth + 1));

  [
    'roles',
    'orgRoles',
    'schoolRoles',
    'systemTags',
    'manualTags',
    'tags',
    'audienceTags'
  ].forEach((key) => collectRoleTokens(value[key], out, depth + 1));

  return out;
}

function pushRequesterRoleFromToken(roles, token) {
  const normalized = cleanString(token, 120).toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) return;
  if (normalized.includes('school_student') || normalized.includes('student')) roles.add('student');
  if (normalized.includes('school_teacher') || normalized.includes('teacher')) roles.add('teacher');
  if (normalized.includes('school_staff') || normalized.includes('staff')) roles.add('staff');
  if (normalized.includes('school_admin') || normalized === 'admin' || normalized.includes('administrator')) roles.add('admin');
}

function collectOrgRoleTokens(org, tokens) {
  if (!org || typeof org !== 'object') return;
  [
    'role',
    'roleName',
    'accountType',
    'roles',
    'orgRoles',
    'schoolRoles',
    'systemTags',
    'manualTags',
    'tags',
    'audienceTags'
  ].forEach((key) => collectRoleTokens(org[key], tokens));
}

function extractSchoolRequesterRoles(user) {
  const roles = new Set();
  const activeOrgId = getActiveOrgId(user);
  const tokens = [];

  collectRoleTokens(user?.role, tokens);
  collectRoleTokens(user?.accountType, tokens);
  collectRoleTokens(user?.roles, tokens);
  collectRoleTokens(user?.orgRoles, tokens);
  collectRoleTokens(user?.schoolRoles, tokens);
  collectRoleTokens(user?.systemTags, tokens);
  collectRoleTokens(user?.manualTags, tokens);
  collectRoleTokens(user?.tags, tokens);
  collectOrgRoleTokens(user?.activeOrganization, tokens);

  const allowedOrgs = Array.isArray(user?.allowedOrgs) ? user.allowedOrgs : [];
  allowedOrgs.forEach((org) => {
    const orgId = toPublicId(org?.orgId || org?.id || org?.organizationId || '');
    if (activeOrgId && orgId && !idsEqual(orgId, activeOrgId)) return;
    collectOrgRoleTokens(org, tokens);
  });

  tokens.forEach((token) => pushRequesterRoleFromToken(roles, token));
  return leaveRequestModel.REQUESTER_ROLES.filter((role) => roles.has(role));
}

function getRequesterRoleOptions(user) {
  if (isAdminViewer(user)) return [...LEAVE_REQUEST_PERSON_ROLES];
  const roles = extractSchoolRequesterRoles(user)
    .filter((role) => LEAVE_REQUEST_PERSON_ROLES.includes(role));
  return roles.length ? roles : ['staff'];
}

async function getSelfRequesterContext(user) {
  const requesterRoles = getRequesterRoleOptions(user);
  const requesterPersonId = getRequesterPersonId(user);
  return {
    requesterPersonId,
    requesterName: await personDisplayNameService.resolvePersonDisplayName(requesterPersonId, {
      fallback: requesterPersonId
    }),
    requesterRole: requesterRoles[0] || 'staff',
    requesterRoles
  };
}

async function assertLeavePersonHasRole(reqUser, personId, requesterRole, label = 'Leave request person') {
  const role = cleanString(requesterRole, 40).toLowerCase();
  if (!LEAVE_REQUEST_PERSON_ROLES.includes(role)) {
    const error = new Error('Leave requests can only be assigned to School teachers or staff.');
    error.code = 'LEAVE_REQUEST_PERSON_ROLE_NOT_ALLOWED';
    error.statusCode = 400;
    throw error;
  }
  const eligiblePeople = await schoolIdentityLookupService.listSchoolPersons({
    reqUser,
    q: '',
    query: { limit: 100 },
    requireSchoolRole: true,
    allowedSchoolRoles: [role]
  });
  const found = (eligiblePeople.allRows || eligiblePeople.rows || [])
    .some((row) => idsEqual(row?.personId || row?.id, personId));
  if (!found) {
    const error = new Error(`${label} must be a School ${role} in the active organization.`);
    error.code = 'LEAVE_REQUEST_PERSON_NOT_TEACHER_OR_STAFF';
    error.statusCode = 400;
    throw error;
  }
}

function inferRequesterRole(user, preferredRole = '', options = {}) {
  const requested = cleanString(preferredRole, 40).toLowerCase();
  const allowedRoles = Array.isArray(options.allowedRoles) && options.allowedRoles.length
    ? options.allowedRoles
    : getRequesterRoleOptions(user);
  if (LEAVE_REQUEST_PERSON_ROLES.includes(requested) && (isAdminViewer(user) || allowedRoles.includes(requested))) {
    return requested;
  }
  if (allowedRoles.length) return allowedRoles[0];
  if (isAdminViewer(user)) return 'admin';
  return 'staff';
}

function normalizeQueryScope(reqUser, query = {}, accessContext = {}) {
  const orgId = getActiveOrgId(reqUser);
  const viewAll = canViewAllLeaveRequests(reqUser, accessContext);
  if (viewAll) {
    return {
      query,
      scope: { canViewAll: true, activeOrgId: orgId, scopeMode: SCOPE_MODES.ORG_WIDE }
    };
  }
  return {
    query,
    scope: { activeOrgId: orgId, scopeMode: SCOPE_MODES.ORG_WIDE }
  };
}

async function buildLifecycleEvent({ action, actorUser, oldStatus = '', newStatus = '', note = '', snapshot = {} }) {
  return {
    at: new Date().toISOString(),
    action: cleanString(action, 60),
    actorId: getActorId(actorUser),
    actorName: await resolveActorName(actorUser),
    oldStatus: cleanString(oldStatus, 40),
    newStatus: cleanString(newStatus, 40),
    note: cleanString(note, 1000),
    snapshot
  };
}

function buildRequestSummary(row) {
  return {
    id: toPublicId(row?.id),
    orgId: toPublicId(row?.orgId),
    requesterPersonId: toPublicId(row?.requesterPersonId),
    requesterName: cleanString(row?.requesterName, 160),
    requesterRole: cleanString(row?.requesterRole, 40),
    status: cleanString(row?.status, 40),
    startDate: cleanDate(row?.startDate),
    endDate: cleanDate(row?.endDate || row?.startDate),
    allDay: row?.allDay !== false,
    startTime: cleanTime(row?.startTime),
    endTime: cleanTime(row?.endTime),
    reason: cleanString(row?.reason, 60)
  };
}

function isOwner(row, reqUser) {
  const personId = getRequesterPersonId(reqUser);
  return Boolean(personId && idsEqual(row?.requesterPersonId, personId));
}

function assertCanView(row, reqUser, accessContext = {}) {
  if (!row) throw new Error('Leave request was not found.');
  const orgId = getActiveOrgId(reqUser);
  if (isAdminViewer(reqUser)) return;
  if (canViewAllLeaveRequests(reqUser, accessContext) && (!orgId || idsEqual(row?.orgId, orgId))) return;
  if (isOwner(row, reqUser)) return;
  const error = new Error('You can only view your own leave requests.');
  error.statusCode = 403;
  throw error;
}

function assertCanEdit(row, reqUser, accessContext = {}) {
  assertCanView(row, reqUser, accessContext);
  if (isAdminViewer(reqUser)) return;
  if (FINAL_STATUSES.has(String(row?.status || '').toLowerCase())) {
    const error = new Error('Finalized leave requests cannot be edited.');
    error.statusCode = 409;
    throw error;
  }
}

function assertAdmin(reqUser) {
  if (isAdminViewer(reqUser)) return;
  const error = new Error('Only school administrators can review leave requests.');
  error.statusCode = 403;
  throw error;
}

async function enrichLifecycleForDisplay(lifecycle = []) {
  const events = Array.isArray(lifecycle) ? lifecycle : [];
  return Promise.all(events.map(async (event) => {
    const actorName = await personDisplayNameService.resolveUserIdDisplayName(event?.actorId, {
      fallback: cleanString(event?.actorName || event?.actorId || 'System', 160)
    });
    return { ...event, actorName };
  }));
}

async function enrichApprovalForDisplay(approval = null) {
  if (!approval || typeof approval !== 'object') return approval;
  const next = { ...approval };
  if (next.approvedBy) {
    next.approvedByName = await personDisplayNameService.resolveUserIdDisplayName(next.approvedBy, {
      fallback: cleanString(next.approvedByName || next.approvedBy, 160)
    });
  }
  if (next.rejectedBy) {
    next.rejectedByName = await personDisplayNameService.resolveUserIdDisplayName(next.rejectedBy, {
      fallback: cleanString(next.rejectedByName || next.rejectedBy, 160)
    });
  }
  if (next.cancelledBy) {
    next.cancelledByName = await personDisplayNameService.resolveUserIdDisplayName(next.cancelledBy, {
      fallback: cleanString(next.cancelledByName || next.cancelledBy, 160)
    });
  }
  return next;
}

async function enrichLeaveRequestForDisplay(row, reqUser = null) {
  if (!row || typeof row !== 'object') return row;
  const requesterPersonId = toPublicId(row.requesterPersonId);
  const requesterName = await personDisplayNameService.resolvePersonDisplayName(requesterPersonId, {
    fallback: requesterPersonId || row.requesterName || ''
  });
  const next = {
    ...row,
    requesterName: requesterName || cleanString(row.requesterName || requesterPersonId, 160),
    lifecycle: await enrichLifecycleForDisplay(row.lifecycle),
    approval: await enrichApprovalForDisplay(row.approval)
  };
  if (next.lastApprovedSnapshot && typeof next.lastApprovedSnapshot === 'object') {
    next.lastApprovedSnapshot = {
      ...next.lastApprovedSnapshot,
      requesterName: await personDisplayNameService.resolvePersonDisplayName(next.lastApprovedSnapshot.requesterPersonId || requesterPersonId, {
        fallback: next.lastApprovedSnapshot.requesterName || requesterName || requesterPersonId
      })
    };
  }
  return next;
}

async function getRequestById(id, reqUser, options = {}) {
  const accessContext = options?.accessContext || {};
  const row = await schoolRepositories.leaveRequests.getById(id, normalizeQueryScope(reqUser, {}, accessContext));
  if (!row) return null;
  assertCanView(row, reqUser, accessContext);
  return enrichLeaveRequestForDisplay(row, reqUser);
}

async function listVisibleRequests(reqUser, filters = {}, accessContext = {}) {
  const orgId = getActiveOrgId(reqUser);
  const query = {};
  const status = cleanString(filters.status, 40).toLowerCase();
  if (status) query.status = status;
  const reason = cleanString(filters.reason, 60).toLowerCase();
  if (reason) query.reason = reason;
  const viewAll = canViewAllLeaveRequests(reqUser, accessContext);
  const requesterPersonId = viewAll
    ? toPublicId(filters.requesterPersonId || '')
    : getRequesterPersonId(reqUser);
  if (requesterPersonId) query.requesterPersonId = requesterPersonId;

  const rows = await schoolRepositories.leaveRequests.list(normalizeQueryScope(reqUser, query, accessContext));
  const sorted = (Array.isArray(rows) ? rows : [])
    .filter((row) => !orgId || idsEqual(row?.orgId, orgId))
    .sort((a, b) => String(b?.audit?.createDateTime || b?.requestDate || '').localeCompare(String(a?.audit?.createDateTime || a?.requestDate || '')));
  return Promise.all(sorted.map((row) => enrichLeaveRequestForDisplay(row, reqUser)));
}

async function buildCreatePayload(reqUser, input = {}, options = {}) {
  assertCreateAllowed(reqUser);
  const admin = isAdminViewer(reqUser);
  const ownPersonId = getRequesterPersonId(reqUser);
  const requesterRoleOptions = getRequesterRoleOptions(reqUser);
  const requesterPersonId = admin
    ? toPublicId(input.requesterPersonId || ownPersonId)
    : ownPersonId;
  if (!requesterPersonId) {
    throw new Error('Your user account is not linked to a person record.');
  }
  const requesterName = await personDisplayNameService.resolvePersonDisplayName(requesterPersonId, {
    fallback: admin ? cleanString(input.requesterName || requesterPersonId, 160) : requesterPersonId
  });
  const requesterRole = inferRequesterRole(reqUser, input.requesterRole, { allowedRoles: requesterRoleOptions });
  await assertLeavePersonHasRole(reqUser, requesterPersonId, requesterRole, 'Leave requester');

  return {
    ...input,
    orgId: getActiveOrgId(reqUser),
    requesterPersonId,
    requesterRecordId: admin ? cleanString(input.requesterRecordId, 100) : '',
    requesterName,
    requesterRole,
    status: 'submitted',
    requestDate: cleanDate(input.requestDate)
      || cleanDate(options.orgToday)
      || cleanDate(reqUser?.orgToday)
      || resolveOrgTodayFromContext({ orgToday: options.orgToday || reqUser?.orgToday, user: reqUser }),
    audit: {
      createdBy: getActorId(reqUser),
      updatedBy: getActorId(reqUser)
    },
    lifecycle: [
      await buildLifecycleEvent({
        action: 'submitted',
        actorUser: reqUser,
        oldStatus: '',
        newStatus: 'submitted',
        note: 'Leave request submitted.'
      })
    ]
  };
}

async function createRequest(reqUser, input = {}, options = {}) {
  const payload = await buildCreatePayload(reqUser, input, options);
  const created = await schoolRepositories.leaveRequests.create(payload, normalizeQueryScope(reqUser));
  await syncLeaveRequestTask('upsert', created, reqUser);
  return created;
}

function hasMaterialScheduleChange(existing, next) {
  const fields = ['startDate', 'endDate', 'allDay', 'startTime', 'endTime', 'reason', 'details'];
  return fields.some((field) => String(existing?.[field] ?? '') !== String(next?.[field] ?? ''));
}

async function updateRequest(reqUser, id, input = {}, options = {}) {
  const accessContext = options?.accessContext || {};
  const existing = await schoolRepositories.leaveRequests.getById(id, normalizeQueryScope(reqUser, {}, accessContext));
  if (!existing) throw new Error('Leave request was not found.');
  assertCanEdit(existing, reqUser, accessContext);

  const wasApproved = String(existing.status || '').toLowerCase() === 'approved';
  const confirmReapproval = normalizeBool(options.confirmReapproval ?? input.confirmReapproval, false);
  const nextRequesterPersonId = isAdminViewer(reqUser)
    ? toPublicId(input.requesterPersonId || existing.requesterPersonId)
    : existing.requesterPersonId;
  const nextRequesterName = await personDisplayNameService.resolvePersonDisplayName(nextRequesterPersonId, {
    fallback: cleanString(input.requesterName || existing.requesterName || nextRequesterPersonId, 160)
  });
  const nextRequesterRole = isAdminViewer(reqUser)
    ? inferRequesterRole(reqUser, input.requesterRole || existing.requesterRole)
    : inferRequesterRole(reqUser, input.requesterRole || existing.requesterRole, { allowedRoles: getRequesterRoleOptions(reqUser) });
  await assertLeavePersonHasRole(reqUser, nextRequesterPersonId, nextRequesterRole, 'Leave requester');
  const next = {
    ...existing,
    ...input,
    orgId: existing.orgId,
    requesterPersonId: nextRequesterPersonId,
    requesterRecordId: isAdminViewer(reqUser)
      ? toPublicId(input.requesterRecordId || existing.requesterRecordId)
      : existing.requesterRecordId,
    requesterRole: nextRequesterRole,
    requesterName: nextRequesterName,
    audit: {
      ...(existing.audit || {}),
      updatedBy: getActorId(reqUser)
    }
  };

  if (wasApproved && hasMaterialScheduleChange(existing, next)) {
    if (!confirmReapproval) {
      const error = new Error('Changing an approved leave request requires approval again. Confirm reapproval before saving.');
      error.code = 'REAPPROVAL_CONFIRMATION_REQUIRED';
      error.statusCode = 409;
      throw error;
    }
    next.status = 'pending_reapproval';
    const priorSnapshot = existing.lastApprovedSnapshot || leaveRequestModel.buildLeaveWindowSnapshot(existing);
    next.lastApprovedSnapshot = priorSnapshot ? { ...priorSnapshot, active: false } : null;
  } else if (!isAdminViewer(reqUser)) {
    next.status = existing.status === 'pending_reapproval' ? 'pending_reapproval' : 'submitted';
  }

  next.revisionNo = Math.max(1, Number(existing.revisionNo || 1) + 1);
  next.lifecycle = [
    ...(Array.isArray(existing.lifecycle) ? existing.lifecycle : []),
    await buildLifecycleEvent({
      action: wasApproved && next.status === 'pending_reapproval' ? 'approved_request_modified' : 'request_modified',
      actorUser: reqUser,
      oldStatus: existing.status,
      newStatus: next.status,
      note: cleanString(input.changeNote || input.adminNote || '', 1000),
      snapshot: buildRequestSummary(next)
    })
  ];

  const updated = await schoolRepositories.leaveRequests.update(id, next, normalizeQueryScope(reqUser, {}, accessContext));
  if (ACTIVE_REVIEW_STATUSES.has(String(updated?.status || '').toLowerCase())) {
    await syncLeaveRequestTask('upsert', updated, reqUser);
  } else if (String(updated?.status || '').toLowerCase() === 'approved' || FINAL_STATUSES.has(String(updated?.status || '').toLowerCase())) {
    await syncLeaveRequestTask('resolve', updated, reqUser);
  }
  return updated;
}

async function approveRequest(reqUser, id, note = '') {
  assertAdmin(reqUser);
  const existing = await schoolRepositories.leaveRequests.getById(id, normalizeQueryScope(reqUser));
  if (!existing) throw new Error('Leave request was not found.');

  await leaveSessionResolutionService.assertReadyForApproval(existing, reqUser);

  const now = new Date().toISOString();
  const actorName = await resolveActorName(reqUser);
  const requesterPersonId = toPublicId(existing.requesterPersonId);
  const requesterName = await personDisplayNameService.resolvePersonDisplayName(requesterPersonId, {
    fallback: existing.requesterName || requesterPersonId
  });
  const next = {
    ...existing,
    requesterName,
    status: 'approved',
    adminNote: cleanString(note || existing.adminNote, 5000),
    approval: {
      ...(existing.approval || {}),
      approvedBy: getActorId(reqUser),
      approvedByName: actorName,
      approvedAt: now,
      note: cleanString(note, 2000)
    },
    audit: {
      ...(existing.audit || {}),
      updatedBy: getActorId(reqUser)
    }
  };
  next.lastApprovedSnapshot = leaveRequestModel.buildLeaveWindowSnapshot(next);
  next.lifecycle = [
    ...(Array.isArray(existing.lifecycle) ? existing.lifecycle : []),
    await buildLifecycleEvent({
      action: 'approved',
      actorUser: reqUser,
      oldStatus: existing.status,
      newStatus: 'approved',
      note,
      snapshot: buildRequestSummary(next)
    })
  ];

  const updated = await schoolRepositories.leaveRequests.update(id, next, normalizeQueryScope(reqUser));
  await syncLeaveRequestTask('resolve', updated, reqUser, { note });
  return updated;
}

async function rejectRequest(reqUser, id, note = '') {
  assertAdmin(reqUser);
  const existing = await schoolRepositories.leaveRequests.getById(id, normalizeQueryScope(reqUser));
  if (!existing) throw new Error('Leave request was not found.');
  const actorName = await resolveActorName(reqUser);

  const snapshot = existing.lastApprovedSnapshot
    ? { ...existing.lastApprovedSnapshot, active: false }
    : null;
  const next = {
    ...existing,
    status: 'rejected',
    adminNote: cleanString(note || existing.adminNote, 5000),
    lastApprovedSnapshot: snapshot,
    approval: {
      ...(existing.approval || {}),
      rejectedBy: getActorId(reqUser),
      rejectedByName: actorName,
      rejectedAt: new Date().toISOString(),
      note: cleanString(note, 2000)
    },
    audit: {
      ...(existing.audit || {}),
      updatedBy: getActorId(reqUser)
    },
    lifecycle: [
      ...(Array.isArray(existing.lifecycle) ? existing.lifecycle : []),
      await buildLifecycleEvent({
        action: 'rejected',
        actorUser: reqUser,
        oldStatus: existing.status,
        newStatus: 'rejected',
        note,
        snapshot: buildRequestSummary(existing)
      })
    ]
  };

  const updated = await schoolRepositories.leaveRequests.update(id, next, normalizeQueryScope(reqUser));
  await syncLeaveRequestTask('resolve', updated, reqUser, { note });
  return updated;
}

async function cancelRequest(reqUser, id, note = '', options = {}) {
  const accessContext = options?.accessContext || {};
  const existing = await schoolRepositories.leaveRequests.getById(id, normalizeQueryScope(reqUser, {}, accessContext));
  if (!existing) throw new Error('Leave request was not found.');
  assertCanView(existing, reqUser, accessContext);
  if (!isAdminViewer(reqUser) && !isOwner(existing, reqUser)) {
    throw new Error('You can only cancel your own leave requests.');
  }
  const actorName = await resolveActorName(reqUser);

  const snapshot = existing.lastApprovedSnapshot
    ? { ...existing.lastApprovedSnapshot, active: false }
    : null;
  const next = {
    ...existing,
    status: 'cancelled',
    adminNote: isAdminViewer(reqUser) ? cleanString(note || existing.adminNote, 5000) : existing.adminNote,
    lastApprovedSnapshot: snapshot,
    approval: {
      ...(existing.approval || {}),
      cancelledBy: getActorId(reqUser),
      cancelledByName: actorName,
      cancelledAt: new Date().toISOString()
    },
    audit: {
      ...(existing.audit || {}),
      updatedBy: getActorId(reqUser)
    },
    lifecycle: [
      ...(Array.isArray(existing.lifecycle) ? existing.lifecycle : []),
      await buildLifecycleEvent({
        action: 'cancelled',
        actorUser: reqUser,
        oldStatus: existing.status,
        newStatus: 'cancelled',
        note,
        snapshot: buildRequestSummary(existing)
      })
    ]
  };

  const updated = await schoolRepositories.leaveRequests.update(id, next, normalizeQueryScope(reqUser, {}, accessContext));
  await syncLeaveRequestTask('resolve', updated, reqUser, { note });
  return updated;
}

async function deleteRequest(reqUser, id) {
  assertAdmin(reqUser);
  const existing = await schoolRepositories.leaveRequests.getById(id, normalizeQueryScope(reqUser));
  if (!existing) {
    const error = new Error('Leave request was not found.');
    error.statusCode = 404;
    throw error;
  }
  try {
    await taskService.deleteSourceTask({
      orgId: existing.orgId,
      sourceType: 'leave_request',
      sourceId: existing.id
    }, reqUser);
  } catch (error) {
    console.warn(`School task sync skipped for delete leave request ${existing.id || ''}: ${error.message}`);
  }
  const removed = await schoolDataService.deleteData('leaveRequests', existing.id, reqUser);
  if (removed === false) {
    const error = new Error('Leave request could not be deleted.');
    error.statusCode = 404;
    throw error;
  }
  return {
    id: existing.id,
    removed: removed !== false
  };
}

async function syncLeaveRequestTask(action, row, reqUser, options = {}) {
  try {
    if (action === 'resolve') {
      await taskService.resolveLeaveRequestTask(row, reqUser, options);
      return;
    }
    const status = String(row?.status || '').toLowerCase();
    if (ACTIVE_REVIEW_STATUSES.has(status)) {
      await taskService.upsertLeaveRequestTask(row, reqUser, options);
      return;
    }
    if (status === 'approved' || FINAL_STATUSES.has(status)) {
      await taskService.resolveLeaveRequestTask(row, reqUser, options);
    }
  } catch (error) {
    console.warn(`School task sync skipped for leave request ${row?.id || ''}: ${error.message}`);
  }
}

async function createTaskForRequest(reqUser, id, input = {}, options = {}) {
  const accessContext = options?.accessContext || {};
  const existing = await schoolRepositories.leaveRequests.getById(id, normalizeQueryScope(reqUser, {}, accessContext));
  if (!existing) throw new Error('Leave request was not found.');
  assertCanView(existing, reqUser, accessContext);

  const assignedPersonId = toPublicId(input.assignedPersonId || '');
  if (!assignedPersonId) {
    const error = new Error('Select a person before creating the School Task.');
    error.statusCode = 400;
    throw error;
  }

  const eligibleAssignees = await schoolIdentityLookupService.listSchoolPersons({
    reqUser,
    q: '',
    query: { limit: 100 },
    requireSchoolRole: true,
    allowedSchoolRoles: ['teacher', 'staff']
  });
  const isEligibleAssignee = (eligibleAssignees.allRows || eligibleAssignees.rows || [])
    .some((row) => idsEqual(row?.personId || row?.id, assignedPersonId));
  if (!isEligibleAssignee) {
    const error = new Error('Leave request tasks can only be assigned to School teachers or staff in the active organization.');
    error.statusCode = 400;
    error.code = 'LEAVE_TASK_ASSIGNEE_NOT_TEACHER_OR_STAFF';
    throw error;
  }

  const taskTitle = cleanString(input.title || '', 220);
  if (!taskTitle) {
    const error = new Error('Task title is required.');
    error.statusCode = 400;
    throw error;
  }

  const taskDescription = cleanString(input.description || input.details || '', 2000);
  if (!taskDescription) {
    const error = new Error('Task details are required.');
    error.statusCode = 400;
    throw error;
  }

  const requesterPersonId = toPublicId(existing.requesterPersonId || '');
  const requesterName = await personDisplayNameService.resolvePersonDisplayName(requesterPersonId, {
    fallback: cleanString(existing.requesterName || requesterPersonId || 'Requester', 160)
  }) || 'Requester';
  const assignedPersonName = await personDisplayNameService.resolvePersonDisplayName(assignedPersonId, {
    fallback: cleanString(input.assignedPersonName || assignedPersonId, 160)
  });

  return taskService.upsertSourceTask({
    orgId: existing.orgId,
    sourceType: 'leave_request',
    sourceId: existing.id,
    sourceUrl: `/school/leave-requests/detail/${encodeURIComponent(existing.id)}`,
    title: taskTitle,
    message: taskDescription,
    severity: cleanString(input.severity || 'warning', 40).toLowerCase() || 'warning',
    assignedPersonId,
    assignedPersonName,
    assignedRole: cleanString(input.assignedRole || '', 120),
    dueDate: cleanDate(input.dueDate),
    taskTitle,
    taskDescription,
    note: cleanString(input.note || '', 1000),
    metadata: {
      leaveRequestStatus: existing.status,
      requesterPersonId: existing.requesterPersonId,
      requesterName,
      requesterRole: existing.requesterRole,
      startDate: existing.startDate,
      endDate: existing.endDate || existing.startDate,
      reason: existing.reason
    }
  }, reqUser, { requireActiveRoutingRule: false });
}

function getActiveApprovedSnapshot(row) {
  if (!row) return null;
  if (String(row.status || '').toLowerCase() === 'approved') {
    return leaveRequestModel.buildLeaveWindowSnapshot(row);
  }
  const snapshot = row.lastApprovedSnapshot;
  if (snapshot && snapshot.active !== false) return snapshot;
  return null;
}

function dateRangesOverlap(aStart, aEnd, bStart, bEnd) {
  const startA = cleanDate(aStart);
  const endA = cleanDate(aEnd || aStart);
  const startB = cleanDate(bStart);
  const endB = cleanDate(bEnd || bStart);
  if (!startA || !endA || !startB || !endB) return false;
  return startA <= endB && endA >= startB;
}

function timeRangesOverlap(aStart, aEnd, bStart, bEnd) {
  const startA = cleanTime(aStart) || '00:00';
  const endA = cleanTime(aEnd) || '23:59';
  const startB = cleanTime(bStart) || '00:00';
  const endB = cleanTime(bEnd) || '23:59';
  return startA < endB && endA > startB;
}

function computeDurationHours(startTime, endTime) {
  const start = cleanTime(startTime);
  const end = cleanTime(endTime);
  if (!start || !end || end <= start) return 0;
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  const minutes = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
  return Math.max(0, Number((minutes / 60).toFixed(2)));
}

function snapshotOverlapsWindow(snapshot, window) {
  if (!snapshot || !window) return false;
  if (!dateRangesOverlap(snapshot.startDate, snapshot.endDate, window.date || window.startDate, window.date || window.endDate)) return false;
  if (snapshot.allDay !== false || window.allDay === true) return true;
  return timeRangesOverlap(snapshot.startTime, snapshot.endTime, window.startTime, window.endTime);
}

async function listApprovedSnapshotsInRange({ orgId, startDate, endDate, personId = '', reqUser } = {}) {
  const targetOrgId = toPublicId(orgId || getActiveOrgId(reqUser));
  if (!targetOrgId) return [];
  const rows = await schoolRepositories.leaveRequests.list({
    query: {},
    scope: { canViewAll: true, activeOrgId: targetOrgId },
    skipExecutor: true
  });
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => idsEqual(row?.orgId, targetOrgId))
    .map((row) => ({ row, snapshot: getActiveApprovedSnapshot(row) }))
    .filter(({ snapshot }) => snapshot && snapshot.active !== false)
    .filter(({ snapshot }) => !personId || idsEqual(snapshot.requesterPersonId, personId))
    .filter(({ snapshot }) => dateRangesOverlap(snapshot.startDate, snapshot.endDate, startDate, endDate));
}

async function findApprovedLeaveConflicts({ orgId, windows = [], reqUser } = {}) {
  const rows = Array.isArray(windows) ? windows : [];
  const validWindows = rows
    .map((window, index) => ({
      ...window,
      sessionIndex: window.sessionIndex ?? window.index ?? index,
      personId: toPublicId(window.personId || window.requesterPersonId || ''),
      date: cleanDate(window.date || window.startDate),
      startTime: cleanTime(window.startTime),
      endTime: cleanTime(window.endTime)
    }))
    .filter((window) => window.personId && window.date);
  if (!validWindows.length) return [];

  const dates = validWindows.map((window) => window.date).sort();
  const snapshots = await listApprovedSnapshotsInRange({
    orgId,
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    reqUser
  });
  const conflicts = [];

  validWindows.forEach((window) => {
    snapshots.forEach(({ row, snapshot }) => {
      if (!idsEqual(snapshot.requesterPersonId, window.personId)) return;
      if (!snapshotOverlapsWindow(snapshot, window)) return;
      conflicts.push({
        sessionIndex: window.sessionIndex,
        personId: window.personId,
        personName: snapshot.requesterName || row?.requesterName || window.personName || window.personId,
        date: window.date,
        startTime: snapshot.allDay === false ? snapshot.startTime : 'All day',
        endTime: snapshot.allDay === false ? snapshot.endTime : '',
        leaveRequestId: snapshot.requestId || row?.id,
        leaveLabel: snapshot.allDay === false
          ? `${snapshot.startTime || '--:--'} - ${snapshot.endTime || '--:--'}`
          : `${snapshot.startDate}${snapshot.endDate && snapshot.endDate !== snapshot.startDate ? ` to ${snapshot.endDate}` : ''}`,
        reason: snapshot.reason,
        status: row?.status
      });
    });
  });

  return conflicts;
}

async function getApprovedLeaveEventsForPerson({ orgId, personId, startDate, endDate, reqUser } = {}) {
  const targetPersonId = toPublicId(personId);
  if (!targetPersonId) return [];
  const snapshots = await listApprovedSnapshotsInRange({
    orgId,
    startDate,
    endDate,
    personId: targetPersonId,
    reqUser
  });

  const rangeStart = cleanDate(startDate) || '0000-01-01';
  const rangeEnd = cleanDate(endDate) || '9999-12-31';
  const events = [];

  function addDays(day, amount) {
    const parsed = new Date(`${day}T00:00:00Z`);
    parsed.setUTCDate(parsed.getUTCDate() + amount);
    return parsed.toISOString().slice(0, 10);
  }

  snapshots.forEach(({ row, snapshot }) => {
    const requesterRole = cleanString(snapshot.requesterRole || row?.requesterRole, 40);
    let day = snapshot.startDate < rangeStart ? rangeStart : snapshot.startDate;
    const lastDay = snapshot.endDate > rangeEnd ? rangeEnd : snapshot.endDate;
    while (day && day <= lastDay) {
      events.push({
        id: `leave-${snapshot.requestId || row?.id}-${day}`,
        targetType: 'leave_request',
        conflictPermitted: false,
        personId: targetPersonId,
        date: day,
        start: snapshot.allDay === false ? snapshot.startTime : '00:00',
        end: snapshot.allDay === false ? snapshot.endTime : '23:59',
        classId: '',
        className: 'Approved Leave',
        duration: snapshot.allDay === false ? computeDurationHours(snapshot.startTime, snapshot.endTime) : 8,
        status: row?.status === 'approved' ? 'approved_leave' : 'approved_leave_snapshot',
        locked: true,
        roles: requesterRole ? [requesterRole, 'Leave'] : ['Leave'],
        requesterRole,
        schoolRole: requesterRole,
        roleLabel: 'Leave',
        hasOverlap: false,
        eventType: 'leave_request',
        detailsUrl: `/school/leave-requests/detail/${encodeURIComponent(snapshot.requestId || row?.id || '')}`,
        title: 'Approved Leave',
        note: leaveRequestModel.LEAVE_REQUEST_REASON_LABELS[snapshot.reason] || snapshot.reason || ''
      });
      day = addDays(day, 1);
    }
  });

  return events;
}

module.exports = {
  ACTIVE_REVIEW_STATUSES,
  getActiveOrgId,
  canCreateRequest,
  assertCreateAllowed,
  isAdminViewer,
  resolveLeaveAccess,
  canViewAllLeaveRequests,
  getRequesterRoleOptions,
  getSelfRequesterContext,
  isOwner,
  listVisibleRequests,
  getRequestById,
  createRequest,
  updateRequest,
  approveRequest,
  rejectRequest,
  cancelRequest,
  deleteRequest,
  createTaskForRequest,
  syncLeaveRequestTask,
  getActiveApprovedSnapshot,
  findApprovedLeaveConflicts,
  getApprovedLeaveEventsForPerson,
  _private: {
    dateRangesOverlap,
    timeRangesOverlap,
    computeDurationHours,
    snapshotOverlapsWindow,
    hasMaterialScheduleChange,
    assertCanView
  }
};
