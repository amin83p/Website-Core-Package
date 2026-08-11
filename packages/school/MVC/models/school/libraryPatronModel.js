'use strict';

const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const {
  cleanString,
  cleanId,
  cleanInt,
  generateEntityId,
  buildAudit
} = require('./libraryEntityCommon');

const dataPath = path.join(resolveCoreRoot(), 'data/school/libraryPatrons.json');

const PATRON_ROLES = Object.freeze({
  STUDENT: 'student',
  TEACHER: 'teacher',
  STAFF: 'staff'
});
const PATRON_STATUSES = Object.freeze({
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  BLOCKED: 'blocked'
});

const VALID_ROLES = new Set(Object.values(PATRON_ROLES));
const VALID_STATUSES = new Set(Object.values(PATRON_STATUSES));
const POLICY_OVERRIDE_FIELDS = Object.freeze([
  'maxConcurrentLoans',
  'loanPeriodDays',
  'digitalAccessDays',
  'allowDigitalDownload',
  'maxRenewals'
]);

function normalizePatronRole(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_ROLES.has(normalized) ? normalized : PATRON_ROLES.STUDENT;
}

function normalizePatronStatus(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_STATUSES.has(normalized) ? normalized : PATRON_STATUSES.ACTIVE;
}

function requirePatronRole(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!VALID_ROLES.has(normalized)) {
    throw new Error('Patron role is required.');
  }
  return normalized;
}

function requirePatronStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!VALID_STATUSES.has(normalized)) {
    throw new Error('Patron status is required.');
  }
  return normalized;
}

function cleanOptionalInt(value, options = {}) {
  if (value === undefined || value === null || value === '') return null;
  return cleanInt(value, options);
}

function cleanOptionalBoolean(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function normalizePolicyOverrideDate(value) {
  const cleaned = cleanString(value, { max: 20, allowEmpty: true });
  if (!cleaned) return '';
  const match = cleaned.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return '';
  const parsed = new Date(`${match[1]}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? '' : match[1];
}

function normalizePolicyOverrides(input = {}, legacy = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    maxConcurrentLoans: cleanOptionalInt(
      source.maxConcurrentLoans !== undefined ? source.maxConcurrentLoans : legacy.maxConcurrentLoans,
      { min: 0, max: 99, fallback: 0 }
    ),
    loanPeriodDays: cleanOptionalInt(source.loanPeriodDays, { min: 1, max: 365, fallback: 14 }),
    digitalAccessDays: cleanOptionalInt(source.digitalAccessDays, { min: 1, max: 365, fallback: 30 }),
    allowDigitalDownload: cleanOptionalBoolean(source.allowDigitalDownload),
    maxRenewals: cleanOptionalInt(source.maxRenewals, { min: 0, max: 20, fallback: 0 })
  };
}

function hasPolicyOverrideValue(overrides = {}) {
  return POLICY_OVERRIDE_FIELDS.some((field) => (
    overrides[field] !== undefined
    && overrides[field] !== null
    && overrides[field] !== ''
  ));
}

function normalizePolicyOverrideRecord(row = {}, legacy = {}, index = 0) {
  const overrides = normalizePolicyOverrides(row.policyOverrides || row, legacy);
  const validFrom = normalizePolicyOverrideDate(row.validFrom || row.policyOverrideStartsAt || row.startDate);
  const validTo = normalizePolicyOverrideDate(row.validTo || row.policyOverrideExpiresAt || row.endDate);
  return {
    id: cleanId(row.id || generateEntityId('LPO'), { max: 80, allowEmpty: false }),
    validFrom,
    validTo,
    policyOverrides: overrides,
    notes: cleanString(row.notes, { max: 500, allowEmpty: true }),
    sortOrder: cleanInt(row.sortOrder, { min: 0, max: 999, fallback: index })
  };
}

function toPolicyOverrideRecordArray(input) {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== 'object') return [];
  return Object.keys(input)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => input[key]);
}

function normalizePolicyOverrideRecords(input = [], legacy = {}) {
  const source = toPolicyOverrideRecordArray(input)
    .map((row, index) => normalizePolicyOverrideRecord(row, legacy, index))
    .filter((row) => hasPolicyOverrideValue(row.policyOverrides));

  if (source.length === 0) {
    const legacyOverrides = normalizePolicyOverrides(legacy.policyOverrides, legacy);
    if (hasPolicyOverrideValue(legacyOverrides)) {
      source.push(normalizePolicyOverrideRecord({
        validFrom: legacy.policyOverrideStartsAt || legacy.policyOverrideValidFrom || '1900-01-01',
        validTo: legacy.policyOverrideExpiresAt || '9999-12-31',
        policyOverrides: legacyOverrides
      }, {}, 0));
    }
  }

  return source.sort((a, b) => (
    String(a.validFrom || '').localeCompare(String(b.validFrom || ''))
    || String(a.validTo || '').localeCompare(String(b.validTo || ''))
    || Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
  )).map((row, index) => ({ ...row, sortOrder: index }));
}

function validatePolicyOverrideRecords(records = []) {
  const meaningful = (Array.isArray(records) ? records : []).filter((row) => hasPolicyOverrideValue(row.policyOverrides));
  meaningful.forEach((row) => {
    if (!row.validFrom || !row.validTo) {
      throw new Error('Policy override start and end dates are required.');
    }
    if (row.validTo < row.validFrom) {
      throw new Error('Policy override end date must be on or after the start date.');
    }
  });
  const sorted = [...meaningful].sort((a, b) => String(a.validFrom).localeCompare(String(b.validFrom)));
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (String(current.validFrom) <= String(previous.validTo)) {
      throw new Error('Policy override date ranges cannot overlap.');
    }
  }
}

function validatePatronAccountValidity({ validFrom = '', validTo = '' } = {}) {
  if (validFrom && validTo && validTo < validFrom) {
    throw new Error('Patron account valid-to date must be on or after the valid-from date.');
  }
}

function dateKey(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = validDate.getFullYear();
  const month = String(validDate.getMonth() + 1).padStart(2, '0');
  const day = String(validDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getActivePolicyOverrideRecord(records = [], now = new Date()) {
  const today = dateKey(now);
  return (Array.isArray(records) ? records : []).find((row) => (
    hasPolicyOverrideValue(row.policyOverrides)
    && String(row.validFrom || '') <= today
    && String(row.validTo || '') >= today
  )) || null;
}

function isPatronAccountValid(patron = {}, now = new Date()) {
  const today = dateKey(now);
  const validFrom = String(patron.validFrom || '').trim();
  const validTo = String(patron.validTo || '').trim();
  if (validFrom && today < validFrom) return false;
  if (validTo && today > validTo) return false;
  return true;
}

function normalizeStoredPatron(row = {}) {
  const now = new Date().toISOString();
  const policyOverrideRecords = normalizePolicyOverrideRecords(row.policyOverrideRecords, row);
  const activeOverrideRecord = getActivePolicyOverrideRecord(policyOverrideRecords);
  const policyOverrides = activeOverrideRecord?.policyOverrides || normalizePolicyOverrides({}, {});
  const maxConcurrentLoans = policyOverrides.maxConcurrentLoans;
  return {
    id: cleanId(row.id || generateEntityId('LP'), { max: 80, allowEmpty: false }),
    orgId: cleanId(row.orgId || '', { max: 64, allowEmpty: false }),
    personId: cleanId(row.personId || '', { max: 64, allowEmpty: false }),
    patronRole: normalizePatronRole(row.patronRole),
    roleRecordId: cleanId(row.roleRecordId || '', { max: 80, allowEmpty: true }),
    status: normalizePatronStatus(row.status),
    validFrom: normalizePolicyOverrideDate(row.validFrom),
    validTo: normalizePolicyOverrideDate(row.validTo),
    libraryCardNumber: cleanString(row.libraryCardNumber, { max: 80, allowEmpty: true }),
    maxConcurrentLoans,
    policyOverrides,
    policyOverrideRecords,
    policyOverrideStartsAt: activeOverrideRecord?.validFrom || '',
    policyOverrideExpiresAt: activeOverrideRecord?.validTo || '',
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
    throw new Error('Invalid library patron payload.');
  }
  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  const personId = cleanId(input.personId, { max: 64, allowEmpty: false });
  if (!orgId) throw new Error('Organization is required.');
  if (!personId) throw new Error('Person is required.');
  const patronRole = requirePatronRole(input.patronRole);
  const status = requirePatronStatus(input.status);
  const libraryCardNumber = cleanString(input.libraryCardNumber, { max: 80, allowEmpty: false });
  if (!libraryCardNumber) throw new Error('Library card number is required.');

  const policyOverrideRecords = normalizePolicyOverrideRecords(input.policyOverrideRecords, input);
  validatePolicyOverrideRecords(policyOverrideRecords);
  const validFrom = normalizePolicyOverrideDate(input.validFrom);
  const validTo = normalizePolicyOverrideDate(input.validTo);
  validatePatronAccountValidity({ validFrom, validTo });
  const activeOverrideRecord = getActivePolicyOverrideRecord(policyOverrideRecords);
  const policyOverrides = activeOverrideRecord?.policyOverrides || normalizePolicyOverrides({}, {});
  const maxConcurrentLoans = policyOverrides.maxConcurrentLoans;

  const output = {
    orgId: String(orgId),
    personId: String(personId),
    patronRole,
    roleRecordId: cleanId(input.roleRecordId || '', { max: 80, allowEmpty: true }),
    status,
    validFrom,
    validTo,
    libraryCardNumber,
    maxConcurrentLoans,
    policyOverrides,
    policyOverrideRecords,
    policyOverrideStartsAt: activeOverrideRecord?.validFrom || '',
    policyOverrideExpiresAt: activeOverrideRecord?.validTo || '',
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

async function getAllLibraryPatrons() {
  await ensureDataFile();
  const content = await fs.readFile(dataPath, 'utf8');
  let parsed = [];
  try {
    parsed = JSON.parse(String(content || '[]').replace(/^\uFEFF/, '') || '[]');
  } catch (_) {
    parsed = [];
  }
  return Array.isArray(parsed) ? parsed.map(normalizeStoredPatron) : [];
}

async function getLibraryPatronById(id) {
  const rows = await getAllLibraryPatrons();
  return rows.find((row) => String(row.id) === String(id)) || null;
}

async function addLibraryPatron(payload) {
  return queueWrite(async () => {
    const rows = await getAllLibraryPatrons();
    const sanitized = sanitizeInput(payload, { isUpdate: false });
    const duplicate = rows.some((row) => (
      String(row.orgId) === String(sanitized.orgId)
      && String(row.personId) === String(sanitized.personId)
    ));
    if (duplicate) throw new Error('This person is already registered as a library patron.');
    const created = {
      id: sanitized.id || generateEntityId('LP'),
      ...sanitized,
      audit: buildAudit(payload?.audit, payload?.audit?.createUser || 'SYSTEM')
    };
    rows.push(created);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return created;
  });
}

async function updateLibraryPatron(id, payload) {
  return queueWrite(async () => {
    const rows = await getAllLibraryPatrons();
    const index = rows.findIndex((row) => String(row.id) === String(id));
    if (index < 0) throw new Error('Library patron not found.');
    const current = rows[index];
    const sanitized = sanitizeInput({
      ...current,
      ...payload,
      orgId: current.orgId,
      personId: current.personId
    }, { isUpdate: true });
    rows[index] = {
      ...current,
      ...sanitized,
      orgId: current.orgId,
      personId: current.personId,
      audit: buildAudit(current.audit, payload?.audit?.lastUpdateUser || 'SYSTEM')
    };
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return rows[index];
  });
}

async function deleteLibraryPatron(id) {
  return queueWrite(async () => {
    const rows = await getAllLibraryPatrons();
    const index = rows.findIndex((row) => String(row.id) === String(id));
    if (index < 0) throw new Error('Library patron not found.');
    const removed = rows[index];
    rows.splice(index, 1);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return removed;
  });
}

module.exports = {
  PATRON_ROLES,
  PATRON_STATUSES,
  normalizePatronRole,
  normalizePatronStatus,
  normalizePolicyOverrides,
  normalizePolicyOverrideDate,
  normalizePolicyOverrideRecords,
  validatePolicyOverrideRecords,
  validatePatronAccountValidity,
  getActivePolicyOverrideRecord,
  isPatronAccountValid,
  normalizeStoredPatron,
  sanitizeInput,
  getAllLibraryPatrons,
  getLibraryPatronById,
  addLibraryPatron,
  updateLibraryPatron,
  deleteLibraryPatron
};
