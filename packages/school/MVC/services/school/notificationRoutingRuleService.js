const schoolRepositories = require('../../repositories/school');
const routingRuleModel = require('../../models/school/notificationRoutingRuleModel');
const personDisplayNameService = require('./personDisplayNameService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const adminChekersService = requireCoreModule('MVC/services/adminChekersService');
const { SECTIONS, OPERATIONS } = requireCoreModule('config/accessConstants');

function cleanString(value, max = 5000) {
  if (value === undefined || value === null) return '';
  const text = String(value).replace(/\0/g, '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeSourceType(value, fallback = 'leave_request') {
  const token = cleanString(value, 80).toLowerCase();
  return routingRuleModel.NOTIFICATION_ROUTING_SOURCE_TYPES.includes(token) ? token : fallback;
}

function getActiveOrgId(user) {
  return toPublicId(user?.activeOrgId || user?.activeOrganization?.id || user?.primaryOrgId || '');
}

function getActorId(user) {
  return toPublicId(user?.id || user?._id || user?.userId || user?.username || '');
}

function isAdminViewer(user) {
  return Boolean(adminChekersService.isAdminForRequest(user, SECTIONS.SCHOOL_NOTIFICATIONS, OPERATIONS.CONFIGURE, {
    orgId: getActiveOrgId(user),
    section: { id: SECTIONS.SCHOOL_NOTIFICATIONS, category: 'SCHOOL' }
  }));
}

function assertAdmin(user) {
  if (isAdminViewer(user)) return;
  const error = new Error('Only school administrators can manage notification routing rules.');
  error.statusCode = 403;
  throw error;
}

function normalizeScope(reqUser, query = {}) {
  return {
    query,
    scope: {
      activeOrgId: getActiveOrgId(reqUser)
    }
  };
}

async function resolveAssigneeName(personId, fallback = '') {
  const id = toPublicId(personId);
  if (!id) return '';
  return personDisplayNameService.resolvePersonDisplayName(id, {
    fallback: cleanString(fallback || id, 160)
  });
}

async function enrichRuleForDisplay(row) {
  if (!row || typeof row !== 'object') return row;
  const assigneePersonId = toPublicId(row.assigneePersonId || '');
  const next = { ...row };
  if (assigneePersonId) {
    next.assigneePersonName = await resolveAssigneeName(assigneePersonId, row.assigneePersonName || assigneePersonId);
  }
  return next;
}

async function listRoutingRules(reqUser, filters = {}) {
  assertAdmin(reqUser);
  const query = {};
  const sourceType = cleanString(filters.sourceType, 80).toLowerCase();
  if (sourceType) query.sourceType = sourceType;
  if (filters.active !== undefined && filters.active !== '') {
    const token = cleanString(filters.active, 20).toLowerCase();
    if (['true', '1', 'active'].includes(token)) query.active = true;
    if (['false', '0', 'inactive'].includes(token)) query.active = false;
  }
  const rows = await schoolRepositories.notificationRoutingRules.list(normalizeScope(reqUser, query));
  return Promise.all((Array.isArray(rows) ? rows : [])
    .sort((a, b) => String(a.sourceType || '').localeCompare(String(b.sourceType || '')))
    .map(enrichRuleForDisplay));
}

async function getActiveRuleForSource({ orgId, sourceType, reqUser } = {}) {
  const targetOrgId = toPublicId(orgId || getActiveOrgId(reqUser));
  const normalizedSource = normalizeSourceType(sourceType, '');
  if (!targetOrgId || !normalizedSource) return null;
  const rows = await schoolRepositories.notificationRoutingRules.list({
    query: {
      sourceType: normalizedSource,
      active: true
    },
    scope: { activeOrgId: targetOrgId },
    skipExecutor: true
  });
  const match = (Array.isArray(rows) ? rows : []).find((row) => (
    idsEqual(row?.orgId, targetOrgId) &&
    String(row?.sourceType || '').toLowerCase() === normalizedSource &&
    row?.active !== false &&
    toPublicId(row?.assigneePersonId)
  ));
  return match ? enrichRuleForDisplay(match) : null;
}

async function saveRoutingRule(reqUser, input = {}) {
  assertAdmin(reqUser);
  const orgId = getActiveOrgId(reqUser);
  if (!orgId) throw new Error('Active organization is required.');

  const sourceType = normalizeSourceType(input.sourceType, 'leave_request');
  const assigneePersonId = toPublicId(input.assigneePersonId || '');
  const active = input.active === false || String(input.active || '').toLowerCase() === 'false' ? false : true;
  if (active && !assigneePersonId) {
    const error = new Error('Select a primary assignee before activating this routing rule.');
    error.statusCode = 400;
    throw error;
  }

  const assigneePersonName = assigneePersonId
    ? await resolveAssigneeName(assigneePersonId, input.assigneePersonName || assigneePersonId)
    : '';
  const payload = {
    orgId,
    sourceType,
    active,
    assigneePersonId,
    assigneePersonName,
    label: cleanString(input.label || (sourceType === 'leave_request' ? 'Leave Request Reviewer' : (sourceType === 'student_session_case' ? 'Student Case Reviewer' : '')), 160),
    notes: cleanString(input.notes, 2000),
    audit: {
      updatedBy: getActorId(reqUser)
    }
  };

  const requestedId = toPublicId(input.id || '');
  const existingById = requestedId
    ? await schoolRepositories.notificationRoutingRules.getById(requestedId, { skipExecutor: true })
    : null;
  if (existingById) {
    if (!idsEqual(existingById.orgId, orgId)) {
      const error = new Error('Notification routing rule is outside the active organization.');
      error.statusCode = 403;
      throw error;
    }
    return enrichRuleForDisplay(
      await schoolRepositories.notificationRoutingRules.update(existingById.id, payload, normalizeScope(reqUser))
    );
  }

  const existingRows = await schoolRepositories.notificationRoutingRules.list({
    query: { sourceType },
    scope: { activeOrgId: orgId },
    skipExecutor: true
  });
  const existingForSource = (Array.isArray(existingRows) ? existingRows : []).find((row) => (
    idsEqual(row?.orgId, orgId) && String(row?.sourceType || '').toLowerCase() === sourceType
  ));

  if (existingForSource) {
    return enrichRuleForDisplay(
      await schoolRepositories.notificationRoutingRules.update(existingForSource.id, payload, normalizeScope(reqUser))
    );
  }

  payload.audit.createdBy = getActorId(reqUser);
  return enrichRuleForDisplay(
    await schoolRepositories.notificationRoutingRules.create(payload, normalizeScope(reqUser))
  );
}

module.exports = {
  getActiveOrgId,
  getActorId,
  isAdminViewer,
  listRoutingRules,
  getActiveRuleForSource,
  saveRoutingRule,
  _private: {
    assertAdmin,
    normalizeSourceType,
    resolveAssigneeName
  }
};
