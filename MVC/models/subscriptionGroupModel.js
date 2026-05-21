// MVC/models/subscriptionGroupModel.js
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('./fileQueue'); // Assumes this utility exists based on your provided files
const { applyGenericFilter } = require('../utils/queryEngine');
const { toIdArray, toPublicId, idsEqual } = require('../utils/idAdapter');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');

const dataPath = path.join(__dirname, '../../data/subscriptionGroups.json');

// --- Helpers ---

async function getAllGroups() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function applySubscriptionGroupScope(rows, scope = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (scope?.canViewAll !== false) return list;

  const allowedOrgIds = Array.isArray(scope?.orgIds)
    ? new Set(toIdArray(scope.orgIds))
    : null;

  if (allowedOrgIds && allowedOrgIds.size > 0) {
    return list.filter((row) => allowedOrgIds.has(toPublicId(row?.orgId)));
  }

  return [];
}

function buildSubscriptionGroupQueryPlan(options = {}) {
  const query = options?.query || {};
  const incomingScope = options?.scope || {};

  return {
    entity: 'subscriptiongroups',
    query,
    scope: {
      canViewAll: incomingScope?.canViewAll !== false,
      orgIds: Array.isArray(incomingScope?.orgIds) ? toIdArray(incomingScope.orgIds) : []
    },
    projection: options?.projection || null,
    pagination: options?.pagination || null,
    sort: options?.sort || null,
    fallback: {
      defaultSearchFields: ['id', 'name', 'orgId', 'description'],
      dateFields: ['createdAt', 'updatedAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
    }
  };
}

async function queryGroups(options = {}) {
  const plan = buildSubscriptionGroupQueryPlan(options);
  const executor = getEntityQueryExecutor('subscriptiongroups');

  if (typeof executor === 'function') {
    const result = await executor(plan);
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.items)) return result.items;
  }

  const allGroups = await getAllGroups();
  const scopedGroups = applySubscriptionGroupScope(allGroups, plan.scope);
  return applyGenericFilter(scopedGroups, plan.query, plan.fallback);
}

async function getGroupById(id) {
  const groups = await getAllGroups();
  return groups.find((g) => idsEqual(g?.id, id));
}

/**
 * Get groups specifically for an Organization
 */
async function getGroupsByOrg(orgId) {
  const groups = await getAllGroups();
  return groups.filter((g) => idsEqual(g?.orgId, orgId));
}

function generateNextId(groups) {
  let maxId = 1000;
  
  groups.forEach(g => {
    if (g.id && g.id.startsWith('GRP')) {
      const numPart = parseInt(g.id.substring(3), 10);
      if (!isNaN(numPart) && numPart > maxId && numPart < 9000) {
        maxId = numPart;
      }
    }
  });

  const nextIdVal = maxId + 1;
  if (nextIdVal > 8999) throw new Error('Maximum Group ID limit (GRP8999) reached.');
  return 'GRP' + nextIdVal;
}

// --- Validation ---

function validateGroup(group, existingGroups = []) {
  const errors = [];

  if (!group || typeof group !== 'object') {
    return { isValid: false, errors: ['Group data must be a valid object.'] };
  }

  // 1. Required Fields
  if (!group.orgId) errors.push('Organization ID is required.');
  if (!group.name || typeof group.name !== 'string' || !group.name.trim()) {
    errors.push('Group Name is required.');
  }

  // 2. Data Types
  if (typeof group.active !== 'boolean') errors.push('Active status must be a boolean.');
  if (group.description && typeof group.description !== 'string') {
    errors.push('Description must be a string.');
  }

  // 3. Uniqueness Check (Name must be unique within the Org)
  // We filter existingGroups to those in the same Org, excluding the current item (if update)
  const duplicate = existingGroups.find(g => 
    idsEqual(g?.orgId, group?.orgId) && 
    !idsEqual(g?.id, group?.id) && // Ignore self
    g.name.trim().toLowerCase() === group.name.trim().toLowerCase()
  );

  if (duplicate) {
    errors.push(`A group named "${group.name}" already exists in this organization.`);
  }

  return errors.length ? { isValid: false, errors } : { isValid: true };
}

// --- CRUD Operations ---

async function addGroup(groupData) {
  await queueWrite(async () => {
    const groups = await getAllGroups();

    // Prepare new object
    const newGroup = {
      id: generateNextId(groups),
      orgId: groupData.orgId, // Critical: link to Org
      name: groupData.name.trim(),
      description: (groupData.description || '').trim(),
      active: groupData.active === true,
      audit: groupData.audit || {}
    };

    // Validate
    const v = validateGroup(newGroup, groups);
    if (!v.isValid) throw new Error(v.errors.join('\r\n'));

    groups.push(newGroup);
    await fs.writeFile(dataPath, JSON.stringify(groups, null, 2));
    
    return newGroup;
  });
}

async function updateGroup(id, updates) {
  await queueWrite(async () => {
    const groups = await getAllGroups();
    const index = groups.findIndex((g) => idsEqual(g?.id, id));

    if (index === -1) throw new Error('Subscription Group not found.');
    
    const current = groups[index];

    // Security: Ensure we aren't changing the OrgId accidentally
    if (updates.orgId && !idsEqual(updates?.orgId, current?.orgId)) {
      throw new Error('Cannot move a group to a different organization.');
    }

    const merged = {
      ...current,
      ...updates,
      id: current.id, // Immutable
      orgId: current.orgId, // Immutable
      audit: { ...current.audit, ...(updates.audit || {}) }
    };

    const v = validateGroup(merged, groups);
    if (!v.isValid) throw new Error(v.errors.join('\r\n'));

    groups[index] = merged;
    await fs.writeFile(dataPath, JSON.stringify(groups, null, 2));
  });
}

async function deleteGroup(id, orgId) {
  await queueWrite(async () => {
    const groups = await getAllGroups();
    const index = groups.findIndex((g) => idsEqual(g?.id, id));

    if (index === -1) throw new Error('Subscription Group not found.');

    // Security check: Ensure the group belongs to the requesting Org
    if (!idsEqual(groups[index]?.orgId, orgId)) {
      throw new Error('Permission denied: Cannot delete group from another organization.');
    }

    groups.splice(index, 1);
    await fs.writeFile(dataPath, JSON.stringify(groups, null, 2));
  });
}

module.exports = {
  getAllGroups,
  queryGroups,
  buildSubscriptionGroupQueryPlan,
  getGroupsByOrg,
  getGroupById,
  addGroup,
  updateGroup,
  deleteGroup
};
