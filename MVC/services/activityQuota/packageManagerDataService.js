const activityQuotaPackageAssignmentRepository = require('../../repositories/activityQuotaPackageAssignmentRepository');
const packageDataService = require('./packageDataService');
const adminChekersService = require('../adminChekersService');
const dataService = require('../dataService');
const activityQuotaLedgerService = require('../activityQuotaLedgerService');
const userMembershipRepository = require('../../repositories/userMembershipRepository');
const userAccessProfileService = require('../users/userAccessProfileService');
const { normalizeQueryOptions } = require('../../utils/queryOptionsAdapter');
const { resolveEntity } = require('../../utils/entityResolver');
const { applyGenericFilter } = require('../../utils/queryEngine');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');
const { assertCreateOrgContextOrThrow } = require('../../utils/orgContextUtils');

const ORGANIZATION_SCOPE_NAMES = new Set(['ADMIN', 'GLOBAL', 'ORGANIZATION', 'ORG']);
const EDITABLE_STATUSES = new Set(['active', 'paused']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 240, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const text = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeList(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function normalizeRoleToken(value, { allowEmpty = true } = {}) {
  const token = cleanString(value, { max: 120, allowEmpty: true }).toLowerCase();
  if (!token) return allowEmpty ? '' : null;
  if (!/^[a-z0-9_.:-]+$/.test(token)) {
    throw new Error('Role tokens may contain only letters, numbers, underscore, dot, colon, or dash.');
  }
  return token;
}

function normalizeRoleList(values = []) {
  const set = new Set();
  normalizeList(values).forEach((value) => {
    const token = normalizeRoleToken(
      isPlainObject(value) ? (value.id || value.role || value.value || value.name || '') : value,
      { allowEmpty: true }
    );
    if (token) set.add(token);
  });
  return Array.from(set.values());
}

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const out = { ...query };
  delete out.page;
  delete out.limit;
  return out;
}

function resolveActiveOrgId(requestingUser) {
  return toPublicId(requestingUser?.activeOrgId || requestingUser?.primaryOrgId) || '';
}

function resolveRequesterUserId(requestingUser) {
  return toPublicId(requestingUser?.id) || '';
}

function normalizeScopeName(scopeName = '') {
  const token = String(scopeName || '').trim().toUpperCase();
  if (!token) return '';
  if (token === 'GLOBAL') return 'GLOBAL';
  if (token === 'ORGANIZATION') return 'ORGANIZATION';
  if (token === 'ORG') return 'ORG';
  if (token === 'ADMIN') return 'ADMIN';
  if (token === 'OWNER') return 'OWNER';
  if (token === 'USER') return 'USER';
  if (token === 'DEPARTMENT') return 'DEPARTMENT';
  if (token === 'DIVISION') return 'DIVISION';
  return '';
}

async function resolveScopeNameById(scopeIdOrName = '') {
  const token = String(scopeIdOrName || '').trim();
  if (!token) return '';
  const byName = normalizeScopeName(token);
  if (byName) return byName;
  const scopeEntity = await resolveEntity('scopes', token);
  return normalizeScopeName(scopeEntity?.name || '');
}

function collectUserOrgIds(user = {}) {
  const out = new Set();
  const add = (value) => {
    const id = toPublicId(value);
    if (id) out.add(id);
  };

  add(user?.orgId);
  add(user?.activeOrgId);
  add(user?.primaryOrgId);
  add(user?.creator?.orgId);

  const organizations = Array.isArray(user?.organizations) ? user.organizations : [];
  organizations.forEach((org) => {
    add(org?.orgId);
    add(org?.id);
  });

  const allowedOrgs = Array.isArray(user?.allowedOrgs) ? user.allowedOrgs : [];
  allowedOrgs.forEach((org) => {
    add(org?.orgId);
    add(org?.id);
  });

  return Array.from(out.values());
}

function userBelongsToOrg(user = {}, orgId = '') {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) return false;
  return collectUserOrgIds(user).some((id) => idsEqual(id, targetOrgId));
}

function extractRoleTokensForOrg(user = {}, orgId = '') {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) return [];
  const organizations = Array.isArray(user?.organizations) ? user.organizations : [];
  const set = new Set();
  organizations.forEach((org) => {
    const orgIdToken = toPublicId(org?.orgId || org?.id || '');
    if (!orgIdToken || !idsEqual(orgIdToken, targetOrgId)) return;
    const roles = Array.isArray(org?.roles) && org.roles.length ? org.roles : (org?.role ? [org.role] : []);
    roles.forEach((role) => {
      let token = '';
      try {
        token = normalizeRoleToken(role, { allowEmpty: true });
      } catch (_) {
        token = '';
      }
      if (token) set.add(token);
    });
  });
  return Array.from(set.values());
}

function hasAllEligibleRoles(user = {}, orgId = '', eligibleRoles = []) {
  const required = normalizeRoleList(eligibleRoles);
  if (!required.length) return { ok: true, missingRoles: [], requiredRoles: [] };
  const userRoles = new Set(extractRoleTokensForOrg(user, orgId));
  const missingRoles = required.filter((token) => !userRoles.has(token));
  return {
    ok: missingRoles.length === 0,
    missingRoles,
    requiredRoles: required
  };
}

async function resolveVisibility(requestingUser, accessContext = {}) {
  const activeOrgId = resolveActiveOrgId(requestingUser);
  const requesterUserId = resolveRequesterUserId(requestingUser);

  if (adminChekersService.isSuperAdmin(requestingUser)) {
    return {
      mode: 'all',
      activeOrgId,
      requesterUserId,
      scopeName: 'ADMIN'
    };
  }

  if (!activeOrgId) {
    return {
      mode: 'none',
      activeOrgId: '',
      requesterUserId,
      scopeName: ''
    };
  }

  if (adminChekersService.isOrgAdmin(requestingUser)) {
    return {
      mode: 'org',
      activeOrgId,
      requesterUserId,
      scopeName: 'ADMIN'
    };
  }

  const scopeName = await resolveScopeNameById(
    accessContext.scopeId
    || accessContext.accessScope
    || accessContext.scope
    || ''
  );

  if (ORGANIZATION_SCOPE_NAMES.has(scopeName)) {
    return {
      mode: 'org',
      activeOrgId,
      requesterUserId,
      scopeName
    };
  }

  return {
    mode: 'creator',
    activeOrgId,
    requesterUserId,
    scopeName: scopeName || 'OWNER'
  };
}

function assertReadableVisibility(visibility) {
  if (!visibility || visibility.mode === 'none') {
    throw new Error('No active organization context found.');
  }
  if (visibility.mode !== 'all' && !visibility.activeOrgId) {
    throw new Error('No active organization context found.');
  }
  if (!visibility.requesterUserId && visibility.mode !== 'all') {
    throw new Error('Authenticated user context is required.');
  }
}

function buildRepositoryScope(visibility = {}) {
  if (!visibility || visibility.mode === 'all') return { canViewAll: true };
  return {
    canViewAll: false,
    orgId: visibility.activeOrgId
  };
}

function isVisibleAssignmentRow(row = {}, visibility = {}) {
  if (!row) return false;
  if (visibility.mode === 'all') return true;
  if (!idsEqual(row?.orgId, visibility.activeOrgId)) return false;
  if (visibility.mode === 'org') return true;
  const creatorUserId = toPublicId(row?.creator?.userId || row?.audit?.createUser || '');
  const targetUserId = toPublicId(row?.targetUserId || '');
  return idsEqual(creatorUserId, visibility.requesterUserId) || idsEqual(targetUserId, visibility.requesterUserId);
}

function canManageAssignmentRow(row = {}, visibility = {}) {
  if (!row) return false;
  if (visibility.mode === 'all' || visibility.mode === 'org') return true;
  const creatorUserId = toPublicId(row?.creator?.userId || row?.audit?.createUser || '');
  return creatorUserId && idsEqual(creatorUserId, visibility.requesterUserId);
}

function buildCreatorAndAudit(requestingUser, orgId = '', existingAudit = null, { isUpdate = false } = {}) {
  const creator = activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, orgId)
    || activityQuotaLedgerService.createSystemCreatorSnapshot(orgId);
  const nowIso = new Date().toISOString();
  const currentAudit = isPlainObject(existingAudit) ? existingAudit : {};
  const createUser = creator?.type === 'system' ? 'System' : (toPublicId(creator?.userId || '') || 'System');
  const audit = isUpdate
    ? {
      createUser: cleanString(currentAudit.createUser, { max: 120, allowEmpty: true }) || createUser,
      createDateTime: cleanString(currentAudit.createDateTime, { max: 80, allowEmpty: true }) || nowIso,
      lastUpdateUser: createUser,
      lastUpdateDateTime: nowIso
    }
    : {
      createUser,
      createDateTime: nowIso,
      lastUpdateUser: createUser,
      lastUpdateDateTime: nowIso
    };
  return { creator, audit };
}

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(token) ? token : '';
}

function addDurationToDate(startDate, years, months, days) {
  const parsed = new Date(`${startDate}T00:00:00.000Z`);
  parsed.setUTCFullYear(parsed.getUTCFullYear() + Number(years || 0));
  parsed.setUTCMonth(parsed.getUTCMonth() + Number(months || 0));
  parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
  return parsed.toISOString().slice(0, 10);
}

function calculatePackagePeriod(packageRecord = {}, assignmentId = '', orgId = '') {
  const validity = isPlainObject(packageRecord?.validity) ? packageRecord.validity : {};
  const mode = cleanString(validity.mode, { max: 20, allowEmpty: true }).toLowerCase() === 'date_range'
    ? 'date_range'
    : 'duration';
  const today = new Date().toISOString().slice(0, 10);

  let startDate = today;
  let endDate = today;
  if (mode === 'date_range') {
    startDate = normalizeDateOnly(validity.startDate) || today;
    endDate = normalizeDateOnly(validity.endDate) || startDate;
    if (endDate < startDate) endDate = startDate;
  } else {
    const years = Math.max(0, Number.parseInt(String(validity.years || '0'), 10) || 0);
    const months = Math.max(0, Number.parseInt(String(validity.months || '0'), 10) || 0);
    const days = Math.max(0, Number.parseInt(String(validity.days || '0'), 10) || 0);
    startDate = today;
    const rawEnd = addDurationToDate(startDate, years, months, days);
    const inclusiveEnd = addDurationToDate(rawEnd, 0, 0, -1);
    endDate = inclusiveEnd < startDate ? startDate : inclusiveEnd;
  }

  return {
    id: `AQPKG_${String(assignmentId || '').trim()}`,
    startDate,
    endDate,
    orgId: toPublicId(orgId) || '',
    sourceType: 'activity_quota_package',
    sourceRef: toPublicId(packageRecord?.id) || '',
    note: `Activity quota package assignment (${toPublicId(packageRecord?.id) || ''})`
  };
}

async function upsertUserMembershipPeriodForPackage({
  userId,
  orgId,
  period,
  requestingUser,
  options = {}
}) {
  const normalizedUserId = toPublicId(userId);
  const normalizedOrgId = toPublicId(orgId);
  if (!normalizedUserId || !normalizedOrgId) return null;

  const rows = await userMembershipRepository.list({
    query: {
      userId__eq: normalizedUserId
    },
    scope: { canViewAll: true },
    backendMode: options?.backendMode
  });
  const target = (Array.isArray(rows) ? rows : []).find((row) => idsEqual(row?.orgId, normalizedOrgId));

  if (!target) {
    const { creator, audit } = buildCreatorAndAudit(requestingUser, normalizedOrgId, null, { isUpdate: false });
    return userMembershipRepository.create({
      userId: normalizedUserId,
      orgId: normalizedOrgId,
      active: true,
      status: 'active',
      periods: [period],
      notes: '',
      source: {},
      creator,
      audit
    }, {
      backendMode: options?.backendMode
    });
  }

  const nextPeriods = Array.isArray(target.periods) ? target.periods.filter((row) => String(row?.id || '') !== String(period.id || '')) : [];
  nextPeriods.push(period);
  const { creator, audit } = buildCreatorAndAudit(requestingUser, normalizedOrgId, target.audit || {}, { isUpdate: true });

  return userMembershipRepository.update(target.id, {
    periods: nextPeriods,
    active: true,
    creator,
    audit
  }, {
    backendMode: options?.backendMode
  });
}

async function removeUserMembershipPeriodForPackage({
  userId,
  orgId,
  periodId,
  fallbackPeriodIds = [],
  requestingUser,
  options = {}
}) {
  const normalizedUserId = toPublicId(userId);
  const normalizedOrgId = toPublicId(orgId);
  const targetPeriodIds = new Set();
  const normalizedPeriodId = cleanString(periodId, { max: 180, allowEmpty: true });
  if (normalizedPeriodId) targetPeriodIds.add(normalizedPeriodId);
  normalizeList(fallbackPeriodIds).forEach((value) => {
    const normalized = cleanString(value, { max: 180, allowEmpty: true });
    if (!normalized) return;
    targetPeriodIds.add(normalized);
  });
  if (!normalizedUserId || !normalizedOrgId || !targetPeriodIds.size) return null;

  const rows = await userMembershipRepository.list({
    query: {
      userId__eq: normalizedUserId
    },
    scope: { canViewAll: true },
    backendMode: options?.backendMode
  });
  const target = (Array.isArray(rows) ? rows : []).find((row) => idsEqual(row?.orgId, normalizedOrgId));
  if (!target) return null;

  const currentPeriods = Array.isArray(target.periods) ? target.periods : [];
  const nextPeriods = currentPeriods.filter((row) => !targetPeriodIds.has(String(row?.id || '')));
  if (nextPeriods.length === currentPeriods.length) return target;

  const { creator, audit } = buildCreatorAndAudit(requestingUser, normalizedOrgId, target.audit || {}, { isUpdate: true });

  return userMembershipRepository.update(target.id, {
    periods: nextPeriods,
    creator,
    audit
  }, {
    backendMode: options?.backendMode
  });
}

function buildPackageLedgerRows(packageRecord = {}) {
  const rows = [];
  const sections = Array.isArray(packageRecord?.sections) ? packageRecord.sections : [];
  sections.forEach((section) => {
    const sectionId = toPublicId(section?.name || section?.id || '');
    if (!sectionId) return;
    const operations = Array.isArray(section?.operations) ? section.operations : [];
    operations.forEach((operation) => {
      const operationId = toPublicId(operation?.name || operation?.id || '');
      if (!operationId) return;
      const call = Number(operation?.call || 0) || 0;
      const amount = Number(operation?.amount || 0) || 0;
      const token = Number(operation?.token || 0) || 0;
      const volume = Number(operation?.volume || 0) || 0;
      if (call <= 0 && amount <= 0 && token <= 0 && volume <= 0) return;
      rows.push({
        section: sectionId,
        operation: operationId,
        call,
        amount,
        token,
        volume
      });
    });
  });
  return rows;
}

async function recordPackageCreditLedgerRows({
  packageRecord,
  assignmentId,
  userId,
  orgId,
  period,
  requestingUser,
  options = {}
}) {
  const rows = buildPackageLedgerRows(packageRecord);
  const createdIds = [];
  const validity = {
    mode: 'date_range',
    startDate: cleanString(period?.startDate, { max: 20, allowEmpty: true }) || '',
    endDate: cleanString(period?.endDate, { max: 20, allowEmpty: true }) || ''
  };
  let index = 0;
  for (const row of rows) {
    const source = {
      module: 'activity_quota_package_manager',
      eventType: 'package_credit',
      eventId: String(assignmentId || ''),
      idempotencyKey: `${assignmentId}:credit:${index}`
    };
    // eslint-disable-next-line no-await-in-loop
    const created = await activityQuotaLedgerService.recordCredit({
      dateTime: new Date().toISOString(),
      userId,
      orgId,
      section: row.section,
      operation: row.operation,
      call: row.call,
      amount: row.amount,
      token: row.token,
      volume: row.volume,
      source,
      validity
    }, {
      requestUser: requestingUser,
      backendMode: options?.backendMode
    });
    if (created?.id) createdIds.push(created.id);
    index += 1;
  }
  return createdIds;
}

async function recordPackageReversalLedgerRows({
  packageRecord,
  assignmentId,
  userId,
  orgId,
  requestingUser,
  options = {}
}) {
  const rows = buildPackageLedgerRows(packageRecord);
  const createdIds = [];
  let index = 0;
  for (const row of rows) {
    const source = {
      module: 'activity_quota_package_manager',
      eventType: 'package_credit_reversal',
      eventId: String(assignmentId || ''),
      idempotencyKey: `${assignmentId}:reversal:${index}`
    };
    // eslint-disable-next-line no-await-in-loop
    const created = await activityQuotaLedgerService.recordAdjustment({
      dateTime: new Date().toISOString(),
      userId,
      orgId,
      section: row.section,
      operation: row.operation,
      call: -Math.abs(row.call || 0),
      amount: -Math.abs(row.amount || 0),
      token: -Math.abs(row.token || 0),
      volume: -Math.abs(row.volume || 0),
      source
    }, {
      requestUser: requestingUser,
      backendMode: options?.backendMode
    });
    if (created?.id) createdIds.push(created.id);
    index += 1;
  }
  return createdIds;
}

function sanitizeCreatePayload(payload = {}) {
  const input = isPlainObject(payload) ? payload : {};
  return {
    packageId: toPublicId(input.packageId || input.package?.id || ''),
    targetUserId: toPublicId(input.targetUserId || input.userId || ''),
    notes: cleanString(input.notes, { max: 3000, allowEmpty: true }) || ''
  };
}

function sanitizeMetadataPayload(payload = {}, existing = {}) {
  const input = isPlainObject(payload) ? payload : {};
  const statusRaw = cleanString(input.status, { max: 40, allowEmpty: true }).toLowerCase();
  const existingStatus = cleanString(existing.status, { max: 40, allowEmpty: true }).toLowerCase();
  const status = existingStatus === 'removed'
    ? 'removed'
    : (EDITABLE_STATUSES.has(statusRaw) ? statusRaw : (EDITABLE_STATUSES.has(existingStatus) ? existingStatus : 'active'));
  return {
    notes: cleanString(input.notes, { max: 3000, allowEmpty: true }) || '',
    status
  };
}

async function fetchUserById(id = '', requestingUser, options = {}) {
  const normalizedId = toPublicId(id);
  if (!normalizedId) return null;
  const row = await dataService.getDataById('users', normalizedId, requestingUser, options?.backendMode ? { backendMode: options.backendMode } : {});
  if (row) return row;
  const rows = await dataService.fetchData('users', {
    id__eq: normalizedId,
    limit: 1
  }, requestingUser, options?.backendMode ? { backendMode: options.backendMode } : {});
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function toPickerUser(row = {}) {
  const id = toPublicId(row?.id || '');
  const username = cleanString(row?.username, { max: 120, allowEmpty: true }) || '';
  const email = cleanString(row?.email, { max: 200, allowEmpty: true }) || '';
  const name = cleanString(row?.name, { max: 220, allowEmpty: true }) || username || email || id;
  const roles = extractRoleTokensForOrg(row, toPublicId(row?.activeOrgId || row?.orgId || ''));
  return { id, name, username, email, roles };
}

function buildAssignmentSummary(row = {}) {
  const eligibleRoles = normalizeRoleList(row?.eligibleRoles || row?.packageSnapshot?.eligibleRoles || []);
  return {
    eligibleRoleCount: eligibleRoles.length,
    accessProfileCount: Array.isArray(row?.packageProfileIds) ? row.packageProfileIds.length : 0,
    ledgerEntryCount: Array.isArray(row?.ledgerEntryIds) ? row.ledgerEntryIds.length : 0,
    reversalLedgerEntryCount: Array.isArray(row?.reversalLedgerEntryIds) ? row.reversalLedgerEntryIds.length : 0
  };
}

const packageManagerDataService = {
  async assertCreateContext(requestingUser) {
    return assertCreateOrgContextOrThrow(requestingUser, { scopeLabel: 'activity quota package manager' });
  },

  async listAssignments(query = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const normalizedQuery = normalizeQueryOptions(query || {});
    const rows = await activityQuotaPackageAssignmentRepository.list({
      query: normalizedQuery,
      scope: buildRepositoryScope(visibility),
      sort: options?.sort || { appliedAt: -1, id: -1 },
      pagination: options?.pagination || null,
      backendMode: options?.backendMode
    });

    return (Array.isArray(rows) ? rows : [])
      .filter((row) => isVisibleAssignmentRow(row, visibility))
      .map((row) => ({
        ...row,
        summary: buildAssignmentSummary(row),
        canManage: canManageAssignmentRow(row, visibility)
      }));
  },

  async getAssignmentById(id, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const row = await activityQuotaPackageAssignmentRepository.getById(id, {
      backendMode: options?.backendMode
    });
    if (!row || !isVisibleAssignmentRow(row, visibility)) return null;
    return {
      ...row,
      summary: buildAssignmentSummary(row),
      canManage: canManageAssignmentRow(row, visibility)
    };
  },

  async createAssignment(payload = {}, requestingUser, accessContext = {}, options = {}) {
    const activeOrgId = await this.assertCreateContext(requestingUser);
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const sanitized = sanitizeCreatePayload(payload);
    if (!sanitized.packageId) throw new Error('packageId is required.');
    if (!sanitized.targetUserId) throw new Error('targetUserId is required.');

    const packageRecord = await packageDataService.getPackageById(sanitized.packageId, requestingUser, accessContext, options);
    if (!packageRecord) throw new Error(`Package '${sanitized.packageId}' was not found or is outside your scope.`);
    if (packageRecord.active === false) throw new Error('Selected package is inactive.');
    if (!adminChekersService.isSuperAdmin(requestingUser) && !idsEqual(packageRecord.orgId, activeOrgId)) {
      throw new Error('Package organization does not match your active organization.');
    }

    const duplicateRows = await activityQuotaPackageAssignmentRepository.list({
      query: {
        orgId__eq: activeOrgId,
        targetUserId__eq: sanitized.targetUserId,
        packageId__eq: packageRecord.id,
        limit: 200
      },
      scope: { canViewAll: true },
      backendMode: options?.backendMode
    });
    const hasLiveDuplicate = (Array.isArray(duplicateRows) ? duplicateRows : [])
      .some((row) => String(row?.status || '').toLowerCase() !== 'removed');
    if (hasLiveDuplicate) {
      throw new Error('An active assignment already exists for this package and user.');
    }

    const targetUser = await fetchUserById(sanitized.targetUserId, requestingUser, options);
    if (!targetUser) throw new Error(`Target user '${sanitized.targetUserId}' was not found.`);
    if (!userBelongsToOrg(targetUser, activeOrgId)) {
      throw new Error(`Target user '${sanitized.targetUserId}' is not a member of your active organization.`);
    }

    const bannedUsers = Array.isArray(packageRecord.bannedUsers) ? packageRecord.bannedUsers : [];
    if (bannedUsers.some((row) => idsEqual(row?.id, sanitized.targetUserId))) {
      throw new Error('The selected user is explicitly banned by this package.');
    }

    const eligibleRoles = normalizeRoleList(packageRecord.eligibleRoles || []);
    const roleCheck = hasAllEligibleRoles(targetUser, activeOrgId, eligibleRoles);
    if (!roleCheck.ok) {
      throw new Error(
        `Target user does not satisfy package role requirements. Missing roles: ${roleCheck.missingRoles.join(', ')}.`
      );
    }

    const { creator, audit } = buildCreatorAndAudit(requestingUser, activeOrgId, null, { isUpdate: false });
    const baseAssignment = await activityQuotaPackageAssignmentRepository.create({
      orgId: activeOrgId,
      targetUserId: sanitized.targetUserId,
      targetUserName: cleanString(targetUser?.name || targetUser?.username || targetUser?.email, { max: 220, allowEmpty: true }) || sanitized.targetUserId,
      packageId: packageRecord.id,
      packageName: packageRecord.name,
      packageSnapshot: {
        id: packageRecord.id,
        name: packageRecord.name,
        category: packageRecord.category || '',
        eligibleRoles,
        sections: Array.isArray(packageRecord.sections) ? packageRecord.sections : [],
        accessProfiles: Array.isArray(packageRecord.accessProfiles) ? packageRecord.accessProfiles : [],
        validity: isPlainObject(packageRecord.validity) ? packageRecord.validity : {}
      },
      eligibleRoles,
      packageProfileIds: normalizeList(packageRecord.accessProfiles).map((item) => toPublicId(item?.id || '')).filter(Boolean),
      preExistingProfileIds: [],
      addedProfileIds: [],
      membershipPeriodId: '',
      ledgerEntryIds: [],
      reversalLedgerEntryIds: [],
      status: 'active',
      notes: sanitized.notes,
      appliedAt: new Date().toISOString(),
      removedAt: '',
      creator,
      audit
    }, {
      backendMode: options?.backendMode
    });

    const profileIds = normalizeList(packageRecord.accessProfiles).map((item) => toPublicId(item?.id || '')).filter(Boolean);
    const profileSummary = await userAccessProfileService.applyPackageProfiles({
      targetUserId: sanitized.targetUserId,
      orgId: activeOrgId,
      packageProfileIds: profileIds,
      sourceType: 'activity_quota_package',
      sourceRefId: baseAssignment.id,
      sourceLabel: cleanString(packageRecord.name || packageRecord.id, { max: 220, allowEmpty: true }) || packageRecord.id,
      requestingUser,
      options
    });

    const period = calculatePackagePeriod(packageRecord, baseAssignment.id, activeOrgId);
    await upsertUserMembershipPeriodForPackage({
      userId: sanitized.targetUserId,
      orgId: activeOrgId,
      period,
      requestingUser,
      options
    });

    const ledgerEntryIds = await recordPackageCreditLedgerRows({
      packageRecord,
      assignmentId: baseAssignment.id,
      userId: sanitized.targetUserId,
      orgId: activeOrgId,
      period,
      requestingUser,
      options
    });

    return activityQuotaPackageAssignmentRepository.update(baseAssignment.id, {
      packageProfileIds: profileIds,
      preExistingProfileIds: profileSummary.preExistingProfileIds || [],
      addedProfileIds: profileSummary.addedProfileIds || [],
      membershipPeriodId: period.id,
      ledgerEntryIds
    }, {
      backendMode: options?.backendMode
    });
  },

  async updateAssignmentMetadata(id, payload = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const existing = await this.getAssignmentById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('Assignment not found or inaccessible.');
    if (!canManageAssignmentRow(existing, visibility)) {
      throw new Error('You can only edit assignments that you created.');
    }

    const sanitized = sanitizeMetadataPayload(payload, existing);
    const { creator, audit } = buildCreatorAndAudit(requestingUser, existing.orgId, existing.audit || {}, { isUpdate: true });
    return activityQuotaPackageAssignmentRepository.update(existing.id, {
      notes: sanitized.notes,
      status: sanitized.status,
      creator: existing.creator || creator,
      audit
    }, {
      backendMode: options?.backendMode
    });
  },

  async removeAssignment(id, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const existing = await this.getAssignmentById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('Assignment not found or inaccessible.');
    if (!canManageAssignmentRow(existing, visibility)) {
      throw new Error('You can only remove assignments that you created.');
    }
    if (String(existing.status || '').toLowerCase() === 'removed') return existing;

    const packageSnapshot = isPlainObject(existing.packageSnapshot) ? existing.packageSnapshot : {};
    const reversalLedgerEntryIds = await recordPackageReversalLedgerRows({
      packageRecord: packageSnapshot,
      assignmentId: existing.id,
      userId: existing.targetUserId,
      orgId: existing.orgId,
      requestingUser,
      options
    });

    await removeUserMembershipPeriodForPackage({
      userId: existing.targetUserId,
      orgId: existing.orgId,
      periodId: existing.membershipPeriodId,
      fallbackPeriodIds: [`AQPKG_${toPublicId(existing.id || '')}`],
      requestingUser,
      options
    });

    await userAccessProfileService.removePackageProfiles({
      targetUserId: existing.targetUserId,
      orgId: existing.orgId,
      packageProfileIds: existing.packageProfileIds || [],
      preExistingProfileIds: existing.preExistingProfileIds || [],
      sourceType: 'activity_quota_package',
      sourceRefId: toPublicId(existing.id || ''),
      requestingUser,
      options
    });

    const { creator, audit } = buildCreatorAndAudit(requestingUser, existing.orgId, existing.audit || {}, { isUpdate: true });
    return activityQuotaPackageAssignmentRepository.update(existing.id, {
      status: 'removed',
      removedAt: new Date().toISOString(),
      reversalLedgerEntryIds,
      creator: existing.creator || creator,
      audit
    }, {
      backendMode: options?.backendMode
    });
  },

  async listPickerPackages(query = {}, requestingUser, accessContext = {}, options = {}) {
    const rows = await packageDataService.listPickerPackages(query, requestingUser, accessContext, options);
    return (Array.isArray(rows) ? rows : []).filter((row) => row.active !== false);
  },

  async listPickerUsers(query = {}, packageId = '', requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const activeOrgId = toPublicId(visibility.activeOrgId || '');
    if (!activeOrgId) return [];

    const packageRecord = await packageDataService.getPackageById(packageId, requestingUser, accessContext, options);
    if (!packageRecord) throw new Error('Select a valid package first.');
    const requiredRoles = normalizeRoleList(packageRecord.eligibleRoles || []);

    const normalizedQuery = normalizeQueryOptions(stripPaginationFromQuery(query));
    const rows = await dataService.fetchData('users', {
      ...normalizedQuery,
      limit: Math.max(Number(normalizedQuery.limit || 0) || 0, 1000)
    }, requestingUser, options?.backendMode ? { backendMode: options.backendMode } : {});

    const filtered = (Array.isArray(rows) ? rows : []).filter((row) => {
      if (!userBelongsToOrg(row, activeOrgId)) return false;
      const roleCheck = hasAllEligibleRoles(row, activeOrgId, requiredRoles);
      return roleCheck.ok;
    });

    const pickerRows = filtered.map((row) => {
      const roles = extractRoleTokensForOrg(row, activeOrgId);
      return {
        id: toPublicId(row?.id || ''),
        name: cleanString(row?.name, { max: 220, allowEmpty: true })
          || cleanString(row?.username, { max: 120, allowEmpty: true })
          || cleanString(row?.email, { max: 200, allowEmpty: true })
          || toPublicId(row?.id || ''),
        username: cleanString(row?.username, { max: 120, allowEmpty: true }) || '',
        email: cleanString(row?.email, { max: 200, allowEmpty: true }) || '',
        roles
      };
    }).filter((row) => row.id);

    return applyGenericFilter(pickerRows, normalizedQuery, {
      defaultSearchFields: ['id', 'name', 'username', 'email', 'roles'],
      dateFields: []
    });
  },

  async resolveReadVisibility(requestingUser, accessContext = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    return visibility;
  }
};

module.exports = packageManagerDataService;
