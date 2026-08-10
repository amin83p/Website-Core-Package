'use strict';

const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const {
  cleanString,
  cleanId,
  cleanBoolean,
  cleanInt,
  generateEntityId,
  buildAudit
} = require('./libraryEntityCommon');
const { normalizePatronRole, PATRON_ROLES } = require('./libraryPatronModel');

const dataPath = path.join(resolveCoreRoot(), 'data/school/libraryPolicies.json');

const DEFAULT_POLICIES = Object.freeze({
  [PATRON_ROLES.STUDENT]: {
    maxConcurrentLoans: 3,
    loanPeriodDays: 14,
    digitalAccessDays: 30,
    allowDigitalDownload: true,
    maxRenewals: 1
  },
  [PATRON_ROLES.TEACHER]: {
    maxConcurrentLoans: 5,
    loanPeriodDays: 30,
    digitalAccessDays: 60,
    allowDigitalDownload: true,
    maxRenewals: 2
  },
  [PATRON_ROLES.STAFF]: {
    maxConcurrentLoans: 5,
    loanPeriodDays: 21,
    digitalAccessDays: 30,
    allowDigitalDownload: true,
    maxRenewals: 1
  }
});

function normalizeStoredPolicy(row = {}) {
  const now = new Date().toISOString();
  const patronRole = normalizePatronRole(row.patronRole);
  const defaults = DEFAULT_POLICIES[patronRole] || DEFAULT_POLICIES[PATRON_ROLES.STUDENT];
  return {
    id: cleanId(row.id || generateEntityId('LPLY'), { max: 80, allowEmpty: false }),
    orgId: cleanId(row.orgId || '', { max: 64, allowEmpty: false }),
    patronRole,
    maxConcurrentLoans: cleanInt(row.maxConcurrentLoans, { min: 0, max: 99, fallback: defaults.maxConcurrentLoans }),
    loanPeriodDays: cleanInt(row.loanPeriodDays, { min: 1, max: 365, fallback: defaults.loanPeriodDays }),
    digitalAccessDays: cleanInt(row.digitalAccessDays, { min: 1, max: 365, fallback: defaults.digitalAccessDays }),
    allowDigitalDownload: cleanBoolean(row.allowDigitalDownload, defaults.allowDigitalDownload),
    maxRenewals: cleanInt(row.maxRenewals, { min: 0, max: 20, fallback: defaults.maxRenewals }),
    active: cleanBoolean(row.active, true),
    notes: cleanString(row.notes, { max: 2000, allowEmpty: true }),
    audit: {
      createUser: cleanString(row?.audit?.createUser, { max: 80, allowEmpty: true }) || 'SYSTEM',
      createDateTime: cleanString(row?.audit?.createDateTime, { max: 40, allowEmpty: true }) || now,
      lastUpdateUser: cleanString(row?.audit?.lastUpdateUser, { max: 80, allowEmpty: true }) || 'SYSTEM',
      lastUpdateDateTime: cleanString(row?.audit?.lastUpdateDateTime, { max: 40, allowEmpty: true }) || now
    }
  };
}

function sanitizeInput(input, { isUpdate = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid library policy payload.');
  }
  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  if (!orgId) throw new Error('Organization is required.');
  const patronRole = normalizePatronRole(input.patronRole);
  const defaults = DEFAULT_POLICIES[patronRole] || DEFAULT_POLICIES[PATRON_ROLES.STUDENT];

  const output = {
    orgId: String(orgId),
    patronRole,
    maxConcurrentLoans: cleanInt(input.maxConcurrentLoans, { min: 0, max: 99, fallback: defaults.maxConcurrentLoans }),
    loanPeriodDays: cleanInt(input.loanPeriodDays, { min: 1, max: 365, fallback: defaults.loanPeriodDays }),
    digitalAccessDays: cleanInt(input.digitalAccessDays, { min: 1, max: 365, fallback: defaults.digitalAccessDays }),
    allowDigitalDownload: cleanBoolean(input.allowDigitalDownload, defaults.allowDigitalDownload),
    maxRenewals: cleanInt(input.maxRenewals, { min: 0, max: 20, fallback: defaults.maxRenewals }),
    active: cleanBoolean(input.active, true),
    notes: cleanString(input.notes, { max: 2000, allowEmpty: true })
  };
  if (!isUpdate && input.id) {
    output.id = cleanId(input.id, { max: 80, allowEmpty: false });
  }
  return output;
}

async function ensureDataFile() {
  if (!fsSync.existsSync(path.dirname(dataPath))) {
    fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
  }
  if (!fsSync.existsSync(dataPath)) {
    fsSync.writeFileSync(dataPath, '[]');
  }
}

async function getAllLibraryPolicies() {
  await ensureDataFile();
  const content = await fs.readFile(dataPath, 'utf8');
  let parsed = [];
  try {
    parsed = JSON.parse(String(content || '[]').replace(/^\uFEFF/, '') || '[]');
  } catch (_) {
    parsed = [];
  }
  return Array.isArray(parsed) ? parsed.map(normalizeStoredPolicy) : [];
}

async function getLibraryPolicyById(id) {
  const rows = await getAllLibraryPolicies();
  return rows.find((row) => String(row.id) === String(id)) || null;
}

async function addLibraryPolicy(payload) {
  return queueWrite(async () => {
    const rows = await getAllLibraryPolicies();
    const sanitized = sanitizeInput(payload, { isUpdate: false });
    const duplicate = rows.some((row) => (
      String(row.orgId) === String(sanitized.orgId)
      && String(row.patronRole) === String(sanitized.patronRole)
    ));
    if (duplicate) throw new Error(`A policy for role "${sanitized.patronRole}" already exists.`);
    const created = {
      id: sanitized.id || generateEntityId('LPLY'),
      ...sanitized,
      audit: buildAudit(payload?.audit, payload?.audit?.createUser || 'SYSTEM')
    };
    rows.push(created);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return created;
  });
}

async function updateLibraryPolicy(id, payload) {
  return queueWrite(async () => {
    const rows = await getAllLibraryPolicies();
    const index = rows.findIndex((row) => String(row.id) === String(id));
    if (index < 0) throw new Error('Library policy not found.');
    const current = rows[index];
    const sanitized = sanitizeInput({
      ...current,
      ...payload,
      orgId: current.orgId,
      patronRole: current.patronRole
    }, { isUpdate: true });
    rows[index] = {
      ...current,
      ...sanitized,
      orgId: current.orgId,
      patronRole: current.patronRole,
      audit: buildAudit(current.audit, payload?.audit?.lastUpdateUser || 'SYSTEM')
    };
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return rows[index];
  });
}

async function deleteLibraryPolicy(id) {
  return queueWrite(async () => {
    const rows = await getAllLibraryPolicies();
    const index = rows.findIndex((row) => String(row.id) === String(id));
    if (index < 0) throw new Error('Library policy not found.');
    const removed = rows[index];
    rows.splice(index, 1);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return removed;
  });
}

function buildDefaultPolicyDoc(orgId, patronRole, userId = 'SYSTEM') {
  const defaults = DEFAULT_POLICIES[patronRole] || DEFAULT_POLICIES[PATRON_ROLES.STUDENT];
  return normalizeStoredPolicy({
    id: generateEntityId('LPLY'),
    orgId,
    patronRole,
    ...defaults,
    active: true,
    audit: { createUser: userId, lastUpdateUser: userId }
  });
}

module.exports = {
  DEFAULT_POLICIES,
  getAllLibraryPolicies,
  getLibraryPolicyById,
  addLibraryPolicy,
  updateLibraryPolicy,
  deleteLibraryPolicy,
  buildDefaultPolicyDoc
};
