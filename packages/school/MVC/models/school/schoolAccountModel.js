const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
// MVC/models/school/schoolAccountModel.js
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');

const dataPath = path.join(resolveCoreRoot(), 'data/school/accounts.json');

if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

const ACCOUNT_TYPES = Object.freeze(['asset', 'liability', 'equity', 'income', 'expense']);
const ACCOUNT_STATUSES = Object.freeze(['active', 'inactive', 'archived']);
const ACCOUNT_PARTY_ROLES = Object.freeze(['none', 'student', 'teacher', 'staff', 'parent', 'funder', 'vendor', 'organization', 'other']);
const ACCOUNT_HEAD_CATEGORIES = Object.freeze([
  'none',
  'students',
  'funders',
  'student_all',
  'student_domestic',
  'student_international',
  'student_corporate',
  'student_scholarship',
  'student_government_funded',
  'student_linc_alberta',
  'student_wcb_alberta',
  'student_other',
  'teachers',
  'staff',
  'parents',
  'vendors',
  'organizations',
  'other'
]);

function cleanString(v, { max = 500, allowEmpty = true } = {}) {
  if (v === undefined || v === null) return allowEmpty ? '' : null;
  const s = String(v).replace(/\0/g, '').trim();
  if (!allowEmpty && !s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function cleanId(v, { max = 64, allowEmpty = false } = {}) {
  const s = cleanString(v, { max, allowEmpty });
  if (s === null) return null;
  if (!s) return allowEmpty ? '' : null;
  if (!/^[A-Za-z0-9._-]+$/.test(s)) throw new Error('Invalid id format.');
  return s;
}

function cleanBool(v) {
  return v === true || v === 'true' || v === 'on' || v === 1 || v === '1';
}

function cleanInteger(v, { min = 1, max = 9 } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error('Invalid integer value.');
  if (n < min || n > max) throw new Error('Integer value out of range.');
  return n;
}

function normalizeCode(v) {
  return String(v || '').trim().toUpperCase();
}

function normalizeName(v) {
  return String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function sanitizeAccountInput(input, { isUpdate = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid account payload.');
  }

  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  const code = normalizeCode(cleanString(input.code, { max: 40, allowEmpty: false }));
  const name = cleanString(input.name, { max: 160, allowEmpty: false });
  const type = cleanString(input.type, { max: 20, allowEmpty: false }).toLowerCase();
  const status = (cleanString(input.status, { max: 20, allowEmpty: true }) || 'active').toLowerCase();
  const normalBalance = cleanString(input.normalBalance, { max: 10, allowEmpty: false }).toLowerCase();
  const partyRole = cleanString(input.partyRole, { max: 30, allowEmpty: true }).toLowerCase() || 'none';
  const headCategory = cleanString(input.headCategory, { max: 30, allowEmpty: true }).toLowerCase() || 'none';

  if (!orgId) throw new Error('orgId is required.');
  if (!code) throw new Error('Account code is required.');
  if (!name) throw new Error('Account name is required.');
  if (!ACCOUNT_TYPES.includes(type)) throw new Error('Invalid account type.');
  if (!ACCOUNT_STATUSES.includes(status)) throw new Error('Invalid account status.');
  if (!['debit', 'credit'].includes(normalBalance)) throw new Error('Invalid normal balance.');
  if (!ACCOUNT_PARTY_ROLES.includes(partyRole)) throw new Error('Invalid account party role.');
  if (!ACCOUNT_HEAD_CATEGORIES.includes(headCategory)) throw new Error('Invalid account head category.');

  const out = {
    orgId: String(orgId),
    code,
    name,
    type,
    level: cleanInteger(input.level ?? 1, { min: 1, max: 6 }),
    parentId: cleanId(input.parentId, { max: 64, allowEmpty: true }) || null,
    isControl: cleanBool(input.isControl),
    allowPost: cleanBool(input.allowPost),
    partyRole,
    headCategory,
    normalBalance,
    status,
    description: cleanString(input.description, { max: 2000, allowEmpty: true })
  };

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 64, allowEmpty: false });
  }

  return out;
}

function generateAccountId(existingIds) {
  for (let i = 0; i < 30; i++) {
    const candidate = `ACC_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `ACC_${Date.now()}`;
}

function assertUniqueInOrg(accounts, candidate, { excludeId = null } = {}) {
  const duplicateCode = accounts.some((a) => {
    if (excludeId && String(a.id) === String(excludeId)) return false;
    return String(a.orgId || '') === String(candidate.orgId || '') &&
      normalizeCode(a.code) === normalizeCode(candidate.code);
  });
  if (duplicateCode) throw new Error('Account code already exists in this organization.');

  const duplicateName = accounts.some((a) => {
    if (excludeId && String(a.id) === String(excludeId)) return false;
    return String(a.orgId || '') === String(candidate.orgId || '') &&
      normalizeName(a.name) === normalizeName(candidate.name);
  });
  if (duplicateName) throw new Error('Account name already exists in this organization.');
}

function assertHierarchyRules(accounts, candidate, { excludeId = null } = {}) {
  if (!candidate.parentId) return;

  const parent = accounts.find((a) => String(a.id) === String(candidate.parentId));
  if (!parent) throw new Error('Selected parent account was not found.');
  if (String(parent.orgId || '') !== String(candidate.orgId || '')) {
    throw new Error('Parent account must belong to the same organization.');
  }
  if (String(parent.type || '') !== String(candidate.type || '')) {
    throw new Error('Parent account type must match child account type.');
  }

  const expectedLevel = Number(parent.level || 1) + 1;
  if (Number(candidate.level) !== expectedLevel) {
    throw new Error(`Child level must be ${expectedLevel} based on selected parent.`);
  }

  if (excludeId && String(parent.id) === String(excludeId)) {
    throw new Error('Account cannot be its own parent.');
  }
}

function assertPartyRoleUnique(accounts, candidate, { excludeId = null } = {}) {
  return;
}

function assertHeadCategoryUnique(accounts, candidate, { excludeId = null } = {}) {
  if (String(candidate.headCategory || 'none') === 'none') return;
  if (String(candidate.status || '').toLowerCase() !== 'active') return;

  const duplicate = accounts.find((a) => {
    if (excludeId && String(a.id) === String(excludeId)) return false;
    if (String(a.orgId || '') !== String(candidate.orgId || '')) return false;
    if (String(a.status || '').toLowerCase() !== 'active') return false;
    return String(a.headCategory || 'none') === String(candidate.headCategory || 'none');
  });

  if (duplicate) {
    throw new Error(`An active head account already exists for "${candidate.headCategory}" in this organization.`);
  }
}

function assertCanDelete(accounts, id) {
  const hasChildren = accounts.some((a) => String(a.parentId || '') === String(id));
  if (hasChildren) throw new Error('Cannot delete an account that has child accounts.');
}

async function getAllAccounts() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve school accounts');
  }
}

async function getAccountById(id) {
  const all = await getAllAccounts();
  return all.find((a) => String(a.id) === String(id)) || null;
}

async function addAccount(data, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllAccounts();
    const sanitized = sanitizeAccountInput(data, { isUpdate: false });

    assertUniqueInOrg(all, sanitized);
    assertHierarchyRules(all, sanitized);
    assertPartyRoleUnique(all, sanitized);
    assertHeadCategoryUnique(all, sanitized);

    const existingIds = new Set(all.map((a) => String(a.id)));
    const newAccount = {
      id: sanitized.id || generateAccountId(existingIds),
      ...sanitized,
      audit: { createDateTime: new Date().toISOString() }
    };

    all.push(newAccount);
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return newAccount;
  });
}

async function updateAccount(id, data, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllAccounts();
    const index = all.findIndex((a) => String(a.id) === String(id));
    if (index === -1) throw new Error('Account not found');

    const existing = all[index];
    const sanitized = sanitizeAccountInput(
      { ...existing, ...data, orgId: existing.orgId || data?.orgId },
      { isUpdate: true }
    );

    if (existing.orgId && String(existing.orgId) !== String(sanitized.orgId)) {
      throw new Error('Security Violation: orgId mismatch.');
    }

    assertUniqueInOrg(all, sanitized, { excludeId: existing.id });
    assertHierarchyRules(all, sanitized, { excludeId: existing.id });
    assertPartyRoleUnique(all, sanitized, { excludeId: existing.id });
    assertHeadCategoryUnique(all, sanitized, { excludeId: existing.id });

    delete sanitized.id;
    sanitized.orgId = existing.orgId || sanitized.orgId;

    all[index] = {
      ...existing,
      ...sanitized,
      audit: {
        ...existing.audit,
        lastUpdateDateTime: new Date().toISOString()
      }
    };

    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return all[index];
  });
}

async function deleteAccount(id, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllAccounts();
    const index = all.findIndex((a) => String(a.id) === String(id));
    if (index === -1) return false;

    const target = all[index];
    if (String(target.status || '').toLowerCase() === 'archived') return target;

    const archived = {
      ...target,
      status: 'archived',
      allowPost: false,
      audit: {
        ...target.audit,
        lastUpdateDateTime: new Date().toISOString()
      }
    };
    all[index] = archived;
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return archived;
  });
}

async function purgeAccount(id, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllAccounts();
    const index = all.findIndex((a) => String(a.id) === String(id));
    if (index === -1) return false;

    assertCanDelete(all, id);
    const [removed] = all.splice(index, 1);
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return removed || false;
  });
}

module.exports = {
  getAllAccounts,
  getAccountById,
  addAccount,
  updateAccount,
  deleteAccount,
  purgeAccount,
  ACCOUNT_TYPES,
  ACCOUNT_STATUSES,
  ACCOUNT_PARTY_ROLES,
  ACCOUNT_HEAD_CATEGORIES
};


