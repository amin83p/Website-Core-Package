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

function normalizePatronRole(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_ROLES.has(normalized) ? normalized : PATRON_ROLES.STUDENT;
}

function normalizePatronStatus(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_STATUSES.has(normalized) ? normalized : PATRON_STATUSES.ACTIVE;
}

function normalizeStoredPatron(row = {}) {
  const now = new Date().toISOString();
  const maxConcurrentLoans = row.maxConcurrentLoans === null || row.maxConcurrentLoans === undefined || row.maxConcurrentLoans === ''
    ? null
    : cleanInt(row.maxConcurrentLoans, { min: 0, max: 99, fallback: 0 });
  return {
    id: cleanId(row.id || generateEntityId('LP'), { max: 80, allowEmpty: false }),
    orgId: cleanId(row.orgId || '', { max: 64, allowEmpty: false }),
    personId: cleanId(row.personId || '', { max: 64, allowEmpty: false }),
    patronRole: normalizePatronRole(row.patronRole),
    roleRecordId: cleanId(row.roleRecordId || '', { max: 80, allowEmpty: true }),
    status: normalizePatronStatus(row.status),
    libraryCardNumber: cleanString(row.libraryCardNumber, { max: 80, allowEmpty: true }),
    maxConcurrentLoans,
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

  const maxConcurrentLoans = input.maxConcurrentLoans === undefined || input.maxConcurrentLoans === null || input.maxConcurrentLoans === ''
    ? null
    : cleanInt(input.maxConcurrentLoans, { min: 0, max: 99, fallback: 0 });

  const output = {
    orgId: String(orgId),
    personId: String(personId),
    patronRole: normalizePatronRole(input.patronRole),
    roleRecordId: cleanId(input.roleRecordId || '', { max: 80, allowEmpty: true }),
    status: normalizePatronStatus(input.status),
    libraryCardNumber: cleanString(input.libraryCardNumber, { max: 80, allowEmpty: true }),
    maxConcurrentLoans,
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
  getAllLibraryPatrons,
  getLibraryPatronById,
  addLibraryPatron,
  updateLibraryPatron,
  deleteLibraryPatron
};
