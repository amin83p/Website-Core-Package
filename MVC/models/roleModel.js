const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { applyGenericFilter } = require('../utils/queryEngine');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');
const roleRegistryService = require('../services/person/roleRegistryService');

const dataPath = path.join(__dirname, '../../data/roles.json');
const ROLE_KEY_REGEX = /^[a-z][a-z0-9_-]*$/;
const PACKAGE_NAME_REGEX = /^[A-Z][A-Z0-9_]*$/;

function normalizeRoleToken(value) {
  return roleRegistryService.normalizeRoleToken(value);
}

function dedupe(values = []) {
  return roleRegistryService.dedupe(values);
}

async function readAllRolesRaw() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    const cleaned = String(data || '').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function isDeprecatedRoleRow(row = {}) {
  return roleRegistryService.isDeprecatedRoleKey(row?.key);
}

async function getAllRoles() {
  const rows = await readAllRolesRaw();
  if (rows.length) return rows.filter((row) => !isDeprecatedRoleRow(row));
  return roleRegistryService.buildBuiltInRoleSeedRows();
}

function normalizeRoleInput(raw = {}, existing = null) {
  const key = normalizeRoleToken(raw.key || existing?.key || '');
  const aliases = dedupe(raw.aliases || existing?.aliases || [])
    .filter((token) => token !== key);
  const packageName = String(raw.packageName || existing?.packageName || '').trim().toUpperCase();
  const domain = normalizeRoleToken(raw.domain || existing?.domain || '');

  return {
    ...(existing || {}),
    ...(raw || {}),
    key,
    label: String(raw.label || existing?.label || '').trim(),
    description: String(raw.description || existing?.description || '').trim(),
    packageName,
    domain,
    aliases,
    active: raw.active !== undefined ? Boolean(raw.active) : (existing?.active !== false),
    system: raw.system !== undefined ? Boolean(raw.system) : (existing?.system === true)
  };
}

function validateRoleData(role = {}, options = {}) {
  const errors = [];
  const mode = String(options.mode || 'create').trim().toLowerCase();

  if (!role || typeof role !== 'object') {
    return { isValid: false, errors: ['Role payload is required.'] };
  }

  if (!role.key || !ROLE_KEY_REGEX.test(role.key)) {
    errors.push('Role key is required and must contain lowercase letters, numbers, "_" or "-".');
  } else if (roleRegistryService.isDeprecatedRoleKey(role.key)) {
    errors.push('Deprecated role key. Use school_student, school_teacher, school_staff, or pte_student as appropriate.');
  }

  if (!role.label || !String(role.label).trim()) {
    errors.push('Role label is required.');
  }

  if (!role.packageName || !PACKAGE_NAME_REGEX.test(role.packageName)) {
    errors.push('Package name is required and must be uppercase (e.g. CORE, SCHOOL, PTE).');
  }

  if (!role.domain || !ROLE_KEY_REGEX.test(role.domain)) {
    errors.push('Domain is required and must be a lowercase token.');
  }

  if (!Array.isArray(role.aliases)) {
    errors.push('Aliases must be an array.');
  } else {
    const aliasSet = new Set();
    role.aliases.forEach((alias) => {
      const normalized = normalizeRoleToken(alias);
      if (!normalized) {
        errors.push('Aliases cannot contain empty values.');
        return;
      }
      if (!ROLE_KEY_REGEX.test(normalized)) {
        errors.push(`Alias "${alias}" is invalid.`);
        return;
      }
      if (normalized === role.key) {
        errors.push('Aliases cannot include the role key itself.');
      }
      if (roleRegistryService.isDeprecatedRoleToken(normalized)) {
        errors.push(`Alias "${normalized}" is deprecated. Use a canonical role alias instead.`);
      }
      if (aliasSet.has(normalized)) {
        errors.push(`Duplicate alias "${normalized}" is not allowed.`);
      }
      aliasSet.add(normalized);
    });
  }

  if (typeof role.active !== 'boolean') {
    errors.push('Active must be a boolean.');
  }

  if (typeof role.system !== 'boolean') {
    errors.push('System must be a boolean.');
  }

  if (mode === 'update' && role.system === true && options?.isSystemEditAttempt) {
    errors.push('System roles are read-only and cannot be modified.');
  }

  return errors.length ? { isValid: false, errors } : { isValid: true };
}

function generateNextRoleId(rows = []) {
  let maxValue = 1000;
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const token = String(row?.id || '').trim();
    if (!/^ROL\d+$/i.test(token)) return;
    const parsed = Number.parseInt(token.slice(3), 10);
    if (Number.isFinite(parsed) && parsed > maxValue) maxValue = parsed;
  });
  return `ROL${maxValue + 1}`;
}

function validateUniqueness(rows = [], role = {}, currentId = null) {
  const takenKey = (Array.isArray(rows) ? rows : []).find((row) => {
    if (currentId && String(row?.id || '') === String(currentId)) return false;
    return normalizeRoleToken(row?.key) === role.key;
  });
  if (takenKey) throw new Error(`Role key "${role.key}" already exists.`);

  const aliasIndex = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (currentId && String(row?.id || '') === String(currentId)) return;
    const ownerKey = normalizeRoleToken(row?.key || '');
    if (ownerKey) aliasIndex.set(ownerKey, ownerKey);
    dedupe(row?.aliases || []).forEach((alias) => {
      aliasIndex.set(alias, ownerKey || String(row?.id || ''));
    });
  });

  const clashes = [];
  dedupe([role.key, ...(role.aliases || [])]).forEach((alias) => {
    const existingOwner = aliasIndex.get(alias);
    if (existingOwner && existingOwner !== role.key) {
      clashes.push(`${alias} (used by ${existingOwner})`);
    }
  });
  if (clashes.length) {
    throw new Error(`Role aliases conflict with existing roles: ${clashes.join(', ')}.`);
  }
}

function buildRoleQueryPlan(options = {}) {
  const query = options?.query || {};
  return {
    entity: 'roles',
    query,
    scope: options?.scope || {},
    projection: options?.projection || null,
    pagination: options?.pagination || null,
    sort: options?.sort || null,
    fallback: {
      defaultSearchFields: ['id', 'key', 'label', 'domain', 'packageName', 'description', 'aliases'],
      dateFields: ['audit.createDateTime', 'audit.lastUpdateDateTime', 'createdAt']
    }
  };
}

async function queryRoles(options = {}) {
  const plan = buildRoleQueryPlan(options);
  const executor = getEntityQueryExecutor('roles');

  if (typeof executor === 'function') {
    const result = await executor(plan);
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.items)) return result.items;
  }

  const allRows = await getAllRoles();
  return applyGenericFilter(allRows, plan.query, plan.fallback);
}

async function getRoleById(id) {
  const rows = await getAllRoles();
  return rows.find((row) => String(row?.id || '') === String(id || '')) || null;
}

async function getRoleByKey(key) {
  const target = normalizeRoleToken(key);
  if (!target) return null;
  const rows = await getAllRoles();
  return rows.find((row) => normalizeRoleToken(row?.key) === target) || null;
}

async function addRole(input = {}) {
  return await queueWrite(async () => {
    const rows = await getAllRoles();
    const role = normalizeRoleInput(input);
    role.id = String(input?.id || '').trim() || generateNextRoleId(rows);

    const now = new Date().toISOString();
    role.audit = {
      createUser: input?.audit?.createUser || 'SYSTEM',
      createDateTime: input?.audit?.createDateTime || now,
      lastUpdateUser: input?.audit?.lastUpdateUser || input?.audit?.createUser || 'SYSTEM',
      lastUpdateDateTime: input?.audit?.lastUpdateDateTime || now
    };

    const validation = validateRoleData(role, { mode: 'create' });
    if (!validation.isValid) throw new Error(validation.errors.join('\r\n'));
    validateUniqueness(rows, role);

    rows.push(role);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    roleRegistryService.clearRoleRegistryCache();
    return role;
  });
}

async function updateRole(id, updates = {}) {
  return await queueWrite(async () => {
    const rows = await getAllRoles();
    const index = rows.findIndex((row) => String(row?.id || '') === String(id || ''));
    if (index < 0) throw new Error('Role not found.');

    const current = rows[index];
    if (current.system === true) {
      throw new Error('System roles are read-only and cannot be modified.');
    }

    const merged = normalizeRoleInput({
      ...updates,
      system: current.system,
      key: updates?.key !== undefined ? updates.key : current.key
    }, current);

    const now = new Date().toISOString();
    merged.id = String(current.id || id);
    merged.audit = {
      ...(current.audit || {}),
      ...(updates.audit || {}),
      lastUpdateDateTime: updates?.audit?.lastUpdateDateTime || now
    };

    const validation = validateRoleData(merged, { mode: 'update' });
    if (!validation.isValid) throw new Error(validation.errors.join('\r\n'));
    validateUniqueness(rows, merged, current.id);

    rows[index] = merged;
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    roleRegistryService.clearRoleRegistryCache();
    return merged;
  });
}

async function deleteRole(id) {
  return await queueWrite(async () => {
    const rows = await getAllRoles();
    const index = rows.findIndex((row) => String(row?.id || '') === String(id || ''));
    if (index < 0) throw new Error('Role not found.');

    const current = rows[index];
    if (current.system === true) {
      throw new Error('System roles cannot be deleted.');
    }

    rows.splice(index, 1);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    roleRegistryService.clearRoleRegistryCache();
    return current;
  });
}

module.exports = {
  getAllRoles,
  queryRoles,
  buildRoleQueryPlan,
  getRoleById,
  getRoleByKey,
  addRole,
  updateRole,
  deleteRole,
  validateRoleData
};
