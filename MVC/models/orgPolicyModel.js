// MVC/models/orgPolicyModel.js
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { applyGenericFilter } = require('../utils/queryEngine');
const { toIdArray, toPublicId, idsEqual } = require('../utils/idAdapter');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');

const dataPath = path.join(__dirname, '../../data/orgPolicies.json');

/* ============================================================
   Helper: Ensure file exists
============================================================ */
async function ensureFile() {
  try {
    await fs.access(dataPath);
  } catch {
    await fs.writeFile(dataPath, JSON.stringify([], null, 2));
  }
}

/* ============================================================
   READ OPERATIONS
============================================================ */
async function getAllPolicies() {
  try {
    await ensureFile();
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (error) {
    console.error('Error reading orgPolicies.json:', error);
    throw new Error('Failed to retrieve organization policies');
  }
}

function applyOrgPolicyScope(rows, scope = {}) {
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

function buildOrgPolicyQueryPlan(options = {}) {
  const query = options?.query || {};
  const incomingScope = options?.scope || {};

  return {
    entity: 'orgpolicies',
    query,
    scope: {
      canViewAll: incomingScope?.canViewAll !== false,
      orgIds: Array.isArray(incomingScope?.orgIds) ? toIdArray(incomingScope.orgIds) : []
    },
    projection: options?.projection || null,
    pagination: options?.pagination || null,
    sort: options?.sort || null,
    fallback: {
      defaultSearchFields: ['id', 'orgId', 'name', 'description'],
      dateFields: ['createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
    }
  };
}

async function queryPolicies(options = {}) {
  const plan = buildOrgPolicyQueryPlan(options);
  const executor = getEntityQueryExecutor('orgpolicies');

  if (typeof executor === 'function') {
    const result = await executor(plan);
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.items)) return result.items;
  }

  const allPolicies = await getAllPolicies();
  const scopedPolicies = applyOrgPolicyScope(allPolicies, plan.scope);
  return applyGenericFilter(scopedPolicies, plan.query, plan.fallback);
}

async function getPolicyById(id) {
  const policies = await getAllPolicies();
  return policies.find((p) => idsEqual(p?.id, id));
}

async function getPolicyByOrgId(orgId) {
  const policies = await getAllPolicies();
  // Constraint: One policy per organization
  return policies.find((p) => idsEqual(p?.orgId, orgId));
}

/* ============================================================
   VALIDATION LOGIC
============================================================ */
function validateData(policy) {
  const errors = [];

  if (!policy || typeof policy !== 'object') {
    return { isValid: false, errors: ['Policy must be a valid object.'] };
  }

  // 1. Required Top-Level Fields
  if (!policy.orgId) errors.push('Organization ID is required.');
  if (!policy.policyName) errors.push('Policy Name is required.');

  // 2. Schedule Validation
  if (policy.globalSchedule && policy.globalSchedule.weekdays) {
    const validDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    Object.keys(policy.globalSchedule.weekdays).forEach(day => {
      if (!validDays.includes(day)) errors.push(`Invalid day: ${day}`);
      const slots = policy.globalSchedule.weekdays[day];
      if (Array.isArray(slots)) {
        slots.forEach(slot => {
          if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(slot.start) || 
              !/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(slot.end)) {
            errors.push(`Invalid time format in ${day}. Use HH:MM.`);
          }
        });
      }
    });
  }

  // 3. Network Validation
  if (policy.network) {
    if (policy.network.ipWhitelist && !Array.isArray(policy.network.ipWhitelist)) errors.push('IP Whitelist must be an array.');
    if (policy.network.ipBlacklist && !Array.isArray(policy.network.ipBlacklist)) errors.push('IP Blacklist must be an array.');
    if (policy.network.targetUserIds !== undefined && !Array.isArray(policy.network.targetUserIds)) {
      errors.push('Network policy targetUserIds must be an array when provided.');
    }
  }

  // 3b. Global Schedule/Session/Request targeting
  if (policy.globalSchedule && policy.globalSchedule.targetUserIds !== undefined && !Array.isArray(policy.globalSchedule.targetUserIds)) {
    errors.push('Global schedule targetUserIds must be an array when provided.');
  }
  if (policy.sessionControl && policy.sessionControl.targetUserIds !== undefined && !Array.isArray(policy.sessionControl.targetUserIds)) {
    errors.push('Session control targetUserIds must be an array when provided.');
  }
  if (policy.requestControl && policy.requestControl.targetUserIds !== undefined && !Array.isArray(policy.requestControl.targetUserIds)) {
    errors.push('Request control targetUserIds must be an array when provided.');
  }

  // 4. Banned Users
  if (policy.bannedUsers && !Array.isArray(policy.bannedUsers)) {
      errors.push('Banned Users list must be an array.');
  }

  // 5. Section-level target users
  if (policy.sections && !Array.isArray(policy.sections)) {
    errors.push('Sections must be an array.');
  } else if (Array.isArray(policy.sections)) {
    policy.sections.forEach((section, index) => {
      if (!section || typeof section !== 'object') return;
      if (section.targetUserIds !== undefined && !Array.isArray(section.targetUserIds)) {
        errors.push(`Section #${index + 1}: targetUserIds must be an array when provided.`);
      }
    });
  }

  return errors.length ? { isValid: false, errors } : { isValid: true };
}

/* ============================================================
   WRITE OPERATIONS
============================================================ */
function generateId() {
  return 'ORG_POL_' + Math.floor(100000 + Math.random() * 900000).toString();
}

function normalizeOrgPolicyId(value) {
  return toPublicId(value) || '';
}

async function addPolicy(policy) {
  await queueWrite(async () => {
    const policies = await getAllPolicies();
    
    // Constraint: Only one policy per organization
    const existing = policies.find((p) => idsEqual(p?.orgId, policy?.orgId));
    if (existing) {
      throw new Error(`A policy already exists for Org ID ${policy.orgId}. Edit existing policy.`);
    }

    policy.id = generateId();
    const validity = validateData(policy);
    if (!validity.isValid) throw new Error(validity.errors.join('\r\n'));

    policies.push(policy);
    await fs.writeFile(dataPath, JSON.stringify(policies, null, 2));
    return policy;
  });
}

async function updatePolicy(id, updates) {
  await queueWrite(async () => {
    const policies = await getAllPolicies();
    const index = policies.findIndex((p) => idsEqual(p?.id, id));
    if (index === -1) throw new Error('Policy not found');

    const current = policies[index];
    const originalOrgId = normalizeOrgPolicyId(current?.orgId);

    if (Object.prototype.hasOwnProperty.call(updates || {}, 'orgId')) {
      const incomingOrgId = normalizeOrgPolicyId(updates?.orgId);
      if (incomingOrgId !== originalOrgId) {
        throw new Error('Organization cannot be changed when editing an existing policy.');
      }
    }

    // Deep Merge Logic
    const merged = {
      ...current,
      ...updates,
      
      validityPeriod: { ...current.validityPeriod, ...(updates.validityPeriod || {}) },
      network: { ...current.network, ...(updates.network || {}) },
      security: { ...current.security, ...(updates.security || {}) },
      sessionControl: { ...current.sessionControl, ...(updates.sessionControl || {}) },
      requestControl: { ...current.requestControl, ...(updates.requestControl || {}) },
      globalSchedule: { ...current.globalSchedule, ...(updates.globalSchedule || {}) },
      
      // Arrays replaced completely
      sections: updates.sections ?? current.sections,
      bannedUsers: updates.bannedUsers ?? current.bannedUsers,
      
      audit: {
        ...current.audit,
        lastUpdateUser: updates.audit?.lastUpdateUser || current.audit.lastUpdateUser,
        lastUpdateDateTime: updates.audit?.lastUpdateDateTime || new Date().toISOString()
      }
    };

    const mergedOrgId = normalizeOrgPolicyId(merged?.orgId);
    const conflict = policies.find((row, rowIndex) => {
      if (rowIndex === index) return false;
      return normalizeOrgPolicyId(row?.orgId) === mergedOrgId;
    });
    if (conflict) {
      throw new Error('This organization already has a policy.');
    }

    const validity = validateData(merged);
    if (!validity.isValid) throw new Error(validity.errors.join('\r\n'));

    policies[index] = merged;
    await fs.writeFile(dataPath, JSON.stringify(policies, null, 2));
  });
}

async function deletePolicy(id) {
  await queueWrite(async () => {
    const policies = await getAllPolicies();
    const filtered = policies.filter((p) => !idsEqual(p?.id, id));
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
  });
}

module.exports = {
  getAllPolicies,
  queryPolicies,
  buildOrgPolicyQueryPlan,
  getPolicyById,
  getPolicyByOrgId,
  addPolicy,
  updatePolicy,
  deletePolicy
};
