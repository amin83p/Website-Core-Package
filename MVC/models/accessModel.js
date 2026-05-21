// MVC/models/accessModel.js
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('../utils/fileQueue');
const { applyGenericFilter } = require('../utils/queryEngine');
const { toPublicId, idsEqual } = require('../utils/idAdapter');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');
const dataPath = path.join(__dirname, '../../data/accesses.json');
// ✅ Import valid categories to ensure data integrity
const { VALID_CATEGORIES } = require('./sectionModel'); 

async function getAllAccesses() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function applyAccessScope(rows, scope = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (scope?.canViewAll !== false) return list;

  const includeGlobal = scope?.includeGlobal !== false;
  const orgId = toPublicId(scope?.orgId) || null;

  return list.filter((row) => {
    const itemOrgId = toPublicId(row?.orgId) || null;
    if (includeGlobal && !itemOrgId) return true;
    if (orgId && itemOrgId === orgId) return true;
    return false;
  });
}

function buildAccessQueryPlan(options = {}) {
  const query = options?.query || {};
  const incomingScope = options?.scope || {};

  return {
    entity: 'accesses',
    query,
    scope: {
      canViewAll: incomingScope?.canViewAll !== false,
      includeGlobal: incomingScope?.includeGlobal !== false,
      orgId: toPublicId(incomingScope?.orgId) || null
    },
    projection: options?.projection || null,
    pagination: options?.pagination || null,
    sort: options?.sort || null,
    fallback: {
      defaultSearchFields: ['id', 'name', 'orgId', 'description', 'status'],
      dateFields: ['createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
    }
  };
}

async function queryAccesses(options = {}) {
  const plan = buildAccessQueryPlan(options);
  const executor = getEntityQueryExecutor('accesses');

  if (typeof executor === 'function') {
    const result = await executor(plan);
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.items)) return result.items;
  }

  const getAllAccessesFn = module.exports?.getAllAccesses;
  const allAccesses = await (typeof getAllAccessesFn === 'function'
    ? getAllAccessesFn()
    : getAllAccesses());
  const scopedAccesses = applyAccessScope(allAccesses, plan.scope);
  return applyGenericFilter(scopedAccesses, plan.query, plan.fallback);
}

async function getAccessById(id) {
  const list = await getAllAccesses();
  return list.find((a) => idsEqual(a?.id, id));
}

function generateId() {
  return 'ACC' + Math.floor(100000 + Math.random() * 900000);
}

function validateData(item, allItems = []) {
  const errors = [];

  if (!item.name) {
    errors.push('Name is required.');
  } else if (!/^[A-Z0-9_]+$/.test(item.name)) {
    errors.push('Name must be uppercase letters, numbers, and underscores only.');
  }

  // Duplicate Name Check
  const duplicate = allItems.find(a => {
    const sameName = a.name === item.name;
    const distinctId = !idsEqual(a?.id, item?.id);
    const sameOrg = toPublicId(a?.orgId || 'global') === toPublicId(item?.orgId || 'global');
    return sameName && distinctId && sameOrg;
  });

  if (duplicate) {
    const scopeName = item.orgId ? `in Organization ${item.orgId}` : 'Globally';
    errors.push(`Access Profile "${item.name}" already exists ${scopeName}.`);
  }
  
  if (item.fullAdmin !== undefined && typeof item.fullAdmin !== 'boolean') {
      errors.push('Full Admin flag must be a boolean.');
  }

  // ✅ NEW: Validate Admin Categories
  if (item.adminCategories) {
      if (!Array.isArray(item.adminCategories)) {
          errors.push('Admin Categories must be an array.');
      } else {
          item.adminCategories.forEach(cat => {
              if (!VALID_CATEGORIES.includes(cat)) {
                  errors.push(`Invalid Admin Category: ${cat}`);
              }
          });
      }
  }

  // Validation of Sections and Operations
  if (item.sections && Array.isArray(item.sections)) {
    item.sections.forEach((sec, sIdx) => {
      if (sec.adminAccess === true) return;

      if (sec.operations && Array.isArray(sec.operations)) {
        sec.operations.forEach((op, oIdx) => {
          const checkLimit = (fieldName, val) => {
            if (val === null || val === undefined) return;
            if (!Number.isInteger(val) || val < 0) {
              errors.push(`Section[${sIdx}] Op[${oIdx}] (${op.operationId}): ${fieldName} must be a positive integer or 0.`);
            }
          };
          checkLimit('maxAttemptsPerSession', op.maxAttemptsPerSession);
          checkLimit('maxSessionDurationMinutes', op.maxSessionDurationMinutes);
          checkLimit('maxFetchUploadVolumeKB', op.maxFetchUploadVolumeKB);
        });
      }
    });
  }

  return errors.length ? { isValid: false, errors } : { isValid: true };
}

/* ---------------- CRUD ---------------- */

async function addAccess(item) {
  await queueWrite(async () => {
    const list = await getAllAccesses();
    item.id = generateId();
    const v = validateData(item, list);
    if(!v.isValid) throw new Error(v.errors.join('\n'));
    list.push(item);
    await fs.writeFile(dataPath, JSON.stringify(list, null, 2));
  });
}

async function updateAccess(id, updates) {
  await queueWrite(async () => {
    const list = await getAllAccesses();
    const idx = list.findIndex((a) => idsEqual(a?.id, id));
    if (idx === -1) throw new Error('Access Definition not found');

    const current = list[idx];
    const merged = {
      ...current,
      ...updates,
      audit: { ...current.audit, ...(updates.audit || {}) },
      // Ensure arrays are replaced if provided, or kept if not
      adminCategories: updates.adminCategories !== undefined ? updates.adminCategories : current.adminCategories
    };

    const v = validateData(merged, list);
    if(!v.isValid) throw new Error(v.errors.join('\n'));

    list[idx] = merged;
    await fs.writeFile(dataPath, JSON.stringify(list, null, 2));
  });
}

async function deleteAccess(id) {
  await queueWrite(async () => {
    const list = await getAllAccesses();
    const filtered = list.filter((a) => !idsEqual(a?.id, id));
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
  });
}

module.exports = {
  getAllAccesses,
  queryAccesses,
  buildAccessQueryPlan,
  getAccessById,
  addAccess,
  updateAccess,
  deleteAccess
};
