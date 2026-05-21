const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('../utils/fileQueue');
const { applyGenericFilter } = require('../utils/queryEngine');
const { idsEqual, toPublicId } = require('../utils/idAdapter');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');
const { normalizeMembershipPayload } = require('../services/security/entitlementService');

const dataPath = path.join(__dirname, '../../data/userMemberships.json');

async function getAllUserMemberships() {
  try {
    const raw = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function applyMembershipScope(rows, scope = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (scope?.canViewAll !== false) return list;

  const includeGlobal = scope?.includeGlobal === true;
  const orgId = toPublicId(scope?.orgId) || null;
  const userId = toPublicId(scope?.userId) || null;

  return list.filter((row) => {
    if (userId && idsEqual(row?.userId, userId)) return true;
    const rowOrgId = toPublicId(row?.orgId) || null;
    if (orgId && idsEqual(rowOrgId, orgId)) return true;
    if (includeGlobal && !rowOrgId) return true;
    return false;
  });
}

function buildUserMembershipQueryPlan(options = {}) {
  const query = options?.query || {};
  const incomingScope = options?.scope || {};

  return {
    entity: 'userMemberships',
    query,
    scope: {
      canViewAll: incomingScope?.canViewAll !== false,
      includeGlobal: incomingScope?.includeGlobal === true,
      orgId: toPublicId(incomingScope?.orgId) || null,
      userId: toPublicId(incomingScope?.userId) || null
    },
    projection: options?.projection || null,
    pagination: options?.pagination || null,
    sort: options?.sort || null,
    fallback: {
      defaultSearchFields: ['id', 'userId', 'orgId', 'status', 'notes'],
      dateFields: ['audit.createDateTime', 'audit.lastUpdateDateTime', 'summary.effectiveEndDate']
    }
  };
}

async function queryUserMemberships(options = {}) {
  const plan = buildUserMembershipQueryPlan(options);
  const executor = getEntityQueryExecutor('userMemberships');
  if (typeof executor === 'function') {
    const result = await executor(plan);
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.items)) return result.items;
  }

  const getAllFn = module.exports?.getAllUserMemberships;
  const allRows = await (typeof getAllFn === 'function' ? getAllFn() : getAllUserMemberships());
  const scopedRows = applyMembershipScope(allRows, plan.scope);
  return applyGenericFilter(scopedRows, plan.query, plan.fallback);
}

async function getUserMembershipById(id) {
  const rows = await getAllUserMemberships();
  return rows.find((row) => idsEqual(row?.id, id));
}

function generateId() {
  return `MEM${Math.floor(100000 + Math.random() * 900000)}`;
}

function validateData(item, allItems = []) {
  const errors = [];
  if (!item || typeof item !== 'object') {
    return { isValid: false, errors: ['Membership payload is required.'] };
  }

  if (!item.userId) errors.push('userId is required.');
  const duplicates = allItems.filter((row) => {
    if (idsEqual(row?.id, item?.id)) return false;
    if (!idsEqual(row?.userId, item?.userId)) return false;
    return true;
  });

  const itemOrgId = toPublicId(item?.orgId) || null;
  const duplicate = duplicates.find((row) => {
    const rowOrgId = toPublicId(row?.orgId) || null;
    return idsEqual(rowOrgId, itemOrgId);
  });
  const existingGlobal = duplicates.find((row) => !(toPublicId(row?.orgId) || null));

  if (duplicate) {
    errors.push('A membership record already exists for this user and the same organization scope. Edit the existing record instead.');
  }
  if (!itemOrgId && duplicates.length > 0) {
    errors.push('Cannot create a Global membership when organization-specific memberships already exist for this user.');
  }
  if (itemOrgId && existingGlobal) {
    errors.push('Cannot create an organization membership while a Global membership exists for this user.');
  }

  return errors.length ? { isValid: false, errors } : { isValid: true };
}

async function addUserMembership(input) {
  await queueWrite(async () => {
    const rows = await getAllUserMemberships();
    const normalized = normalizeMembershipPayload(input || {});
    const item = {
      ...normalized,
      id: generateId(),
      status: normalized.summary?.status || 'no_period'
    };
    const check = validateData(item, rows);
    if (!check.isValid) throw new Error(check.errors.join('\n'));
    rows.push(item);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
  });
}

async function updateUserMembership(id, updates) {
  await queueWrite(async () => {
    const rows = await getAllUserMemberships();
    const idx = rows.findIndex((row) => idsEqual(row?.id, id));
    if (idx === -1) throw new Error('Membership record not found.');

    const current = rows[idx];
    const mergedInput = {
      ...current,
      ...updates,
      periods: updates?.periods !== undefined ? updates.periods : current.periods,
      source: { ...(current.source || {}), ...(updates?.source || {}) }
    };
    const normalized = normalizeMembershipPayload(mergedInput);
    const nextItem = {
      ...current,
      ...normalized,
      id: current.id,
      audit: { ...(current.audit || {}), ...(updates?.audit || {}) },
      status: normalized.summary?.status || 'no_period'
    };
    const check = validateData(nextItem, rows);
    if (!check.isValid) throw new Error(check.errors.join('\n'));
    rows[idx] = nextItem;
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
  });
}

async function deleteUserMembership(id) {
  await queueWrite(async () => {
    const rows = await getAllUserMemberships();
    const filtered = rows.filter((row) => !idsEqual(row?.id, id));
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
  });
}

module.exports = {
  getAllUserMemberships,
  queryUserMemberships,
  buildUserMembershipQueryPlan,
  getUserMembershipById,
  addUserMembership,
  updateUserMembership,
  deleteUserMembership
};
