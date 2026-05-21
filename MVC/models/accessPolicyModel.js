// MVC/models/accessPolicyModel.js
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { applyGenericFilter } = require('../utils/queryEngine');
const { toIdArray, toPublicId, idsEqual } = require('../utils/idAdapter');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');

const dataPath = path.join(__dirname, '../../data/accessPolicies.json');

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
    console.error('Error reading accessPolicies.json:', error);
    throw new Error('Failed to retrieve access policies');
  }
}

function applyAccessPolicyScope(rows, scope = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (scope?.canViewAll !== false) return list;

  const allowedUserIds = Array.isArray(scope?.userIds)
    ? new Set(toIdArray(scope.userIds))
    : null;

  if (allowedUserIds && allowedUserIds.size > 0) {
    return list.filter((row) => allowedUserIds.has(toPublicId(row?.userId)));
  }

  return [];
}

function buildAccessPolicyQueryPlan(options = {}) {
  const query = options?.query || {};
  const incomingScope = options?.scope || {};

  return {
    entity: 'accesspolicies',
    query,
    scope: {
      canViewAll: incomingScope?.canViewAll !== false,
      userIds: Array.isArray(incomingScope?.userIds) ? toIdArray(incomingScope.userIds) : []
    },
    projection: options?.projection || null,
    pagination: options?.pagination || null,
    sort: options?.sort || null,
    fallback: {
      defaultSearchFields: ['id', 'userId', 'name', 'description'],
      dateFields: ['createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
    }
  };
}

async function queryPolicies(options = {}) {
  const plan = buildAccessPolicyQueryPlan(options);
  const executor = getEntityQueryExecutor('accesspolicies');

  if (typeof executor === 'function') {
    const result = await executor(plan);
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.items)) return result.items;
  }

  const allPolicies = await getAllPolicies();
  const scopedPolicies = applyAccessPolicyScope(allPolicies, plan.scope);
  return applyGenericFilter(scopedPolicies, plan.query, plan.fallback);
}

async function getPolicyById(id) {
  const policies = await getAllPolicies();
  return policies.find((p) => idsEqual(p?.id, id));
}

async function getPolicyByUserId(userId) {
  const policies = await getAllPolicies();
  return policies.find((p) => idsEqual(p?.userId, userId));
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
  if (!policy.userId) errors.push('User ID is required.');
  if (!policy.policyName) errors.push('Policy Name is required.');

  // 2. Schedule Validation
  if (policy.globalSchedule && policy.globalSchedule.weekdays) {
    const validDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const keys = Object.keys(policy.globalSchedule.weekdays);
    keys.forEach(day => {
      if (!validDays.includes(day)) {
        errors.push(`Invalid day in schedule: ${day}`);
      }
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
    if (policy.network.ipWhitelist && !Array.isArray(policy.network.ipWhitelist)) {
      errors.push('IP Whitelist must be an array.');
    }
  }

  // ✅ 4. Session Control Validation (NEW)
  if (policy.sessionControl) {
      const sess = policy.sessionControl;
      
      if (sess.maxSessions !== undefined) {
          if (typeof sess.maxSessions !== 'number' || sess.maxSessions < 1) {
              errors.push('Max Sessions must be a positive number (minimum 1).');
          }
      }
      
      if (sess.maxDuration !== undefined) {
          if (typeof sess.maxDuration !== 'number' || sess.maxDuration < 1) {
              errors.push('Max Duration must be a positive number of minutes.');
          }
      }

      if (sess.idleTimeout !== undefined) {
          if (typeof sess.idleTimeout !== 'number' || sess.idleTimeout < 1) {
              errors.push('Idle Timeout must be a positive number of minutes.');
          }
      }
  }

  // 5. Sections Array
  if (policy.sections && !Array.isArray(policy.sections)) {
    errors.push('Sections must be an array.');
  }

  // 6. Audit
  if (!policy.audit || !policy.audit.createUser) {
    errors.push('Audit data (createUser) is missing.');
  }

  return errors.length ? { isValid: false, errors } : { isValid: true };
}

/* ============================================================
   WRITE OPERATIONS
============================================================ */
function generateId() {
  return 'POL_' + Math.floor(100000 + Math.random() * 900000).toString();
}

function normalizeUserPolicyId(value) {
  return toPublicId(value) || '';
}

function normalizeOrgScopeId(value) {
  const token = String(toPublicId(value) || '').trim();
  if (!token || token.toLowerCase() === 'global') return '';
  return token;
}

async function addPolicy(policy) {
  await queueWrite(async () => {
    const policies = await getAllPolicies();
    
    const existing = policies.find((p) => 
        idsEqual(p?.userId, policy?.userId) && 
        idsEqual(p?.orgId || '', policy?.orgId || '')
    );

    if (existing) {
      const scope = policy.orgId ? `in Org #${policy.orgId}` : 'Globally';
      throw new Error(`A policy already exists for User ID ${policy.userId} ${scope}. Please edit the existing one.`);
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
    const originalUserId = normalizeUserPolicyId(current?.userId);
    const originalOrgId = normalizeOrgScopeId(current?.orgId);

    if (Object.prototype.hasOwnProperty.call(updates || {}, 'userId')) {
      const incomingUserId = normalizeUserPolicyId(updates?.userId);
      if (incomingUserId !== originalUserId) {
        throw new Error('User cannot be changed when editing an existing policy.');
      }
    }
    if (Object.prototype.hasOwnProperty.call(updates || {}, 'orgId')) {
      const incomingOrgId = normalizeOrgScopeId(updates?.orgId);
      if (incomingOrgId !== originalOrgId) {
        throw new Error('Organization scope cannot be changed when editing an existing policy.');
      }
    }

    // Deep Merge Logic
    const merged = {
      ...current,
      ...updates,
      
      validityPeriod: { ...current.validityPeriod, ...(updates.validityPeriod || {}) },
      network: { ...current.network, ...(updates.network || {}) },
      security: { ...current.security, ...(updates.security || {}) },
      // ✅ Ensure sessionControl merges correctly
      sessionControl: { ...current.sessionControl, ...(updates.sessionControl || {}) }, 
      globalSchedule: { ...current.globalSchedule, ...(updates.globalSchedule || {}) },
      
      sections: updates.sections ?? current.sections, 
      
      audit: {
        ...current.audit,
        lastUpdateUser: updates.audit?.lastUpdateUser || current.audit.lastUpdateUser,
        lastUpdateDateTime: updates.audit?.lastUpdateDateTime || new Date().toISOString()
      }
    };

    const mergedUserId = normalizeUserPolicyId(merged?.userId);
    const mergedOrgId = normalizeOrgScopeId(merged?.orgId);
    const conflict = policies.find((row, rowIndex) => {
      if (rowIndex === index) return false;
      return normalizeUserPolicyId(row?.userId) === mergedUserId
        && normalizeOrgScopeId(row?.orgId) === mergedOrgId;
    });
    if (conflict) {
      throw new Error('A policy already exists for this user in the selected scope.');
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
  buildAccessPolicyQueryPlan,
  getPolicyById,
  getPolicyByUserId,
  addPolicy,
  updatePolicy,
  deletePolicy
};
