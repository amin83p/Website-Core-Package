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
const { normalizePatronRole } = require('./libraryPatronModel');
const { normalizeCopyType, COPY_TYPES } = require('./libraryCopyModel');

const dataPath = path.join(resolveCoreRoot(), 'data/school/libraryLoans.json');

const LOAN_STATUSES = Object.freeze({
  ACTIVE: 'active',
  RETURNED: 'returned',
  OVERDUE: 'overdue',
  LOST: 'lost',
  CANCELLED: 'cancelled'
});

const VALID_STATUSES = new Set(Object.values(LOAN_STATUSES));
const OPEN_STATUSES = new Set([LOAN_STATUSES.ACTIVE, LOAN_STATUSES.OVERDUE]);

function normalizeLoanStatus(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_STATUSES.has(normalized) ? normalized : LOAN_STATUSES.ACTIVE;
}

function normalizeIsoDate(value) {
  const cleaned = cleanString(value, { max: 40, allowEmpty: true });
  if (!cleaned) return null;
  const parsed = new Date(cleaned);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid date value.');
  return parsed.toISOString();
}

function normalizeStoredLoan(row = {}) {
  const now = new Date().toISOString();
  return {
    id: cleanId(row.id || generateEntityId('LL'), { max: 80, allowEmpty: false }),
    orgId: cleanId(row.orgId || '', { max: 64, allowEmpty: false }),
    patronId: cleanId(row.patronId || '', { max: 80, allowEmpty: false }),
    personId: cleanId(row.personId || '', { max: 64, allowEmpty: false }),
    patronRole: normalizePatronRole(row.patronRole),
    copyId: cleanId(row.copyId || '', { max: 80, allowEmpty: false }),
    bookId: cleanId(row.bookId || '', { max: 80, allowEmpty: false }),
    copyType: normalizeCopyType(row.copyType),
    status: normalizeLoanStatus(row.status),
    checkoutAt: normalizeIsoDate(row.checkoutAt) || now,
    dueAt: normalizeIsoDate(row.dueAt) || now,
    returnedAt: normalizeIsoDate(row.returnedAt),
    renewalCount: cleanInt(row.renewalCount, { min: 0, max: 99, fallback: 0 }),
    checkedOutByUserId: cleanId(row.checkedOutByUserId || '', { max: 80, allowEmpty: true }),
    returnedByUserId: cleanId(row.returnedByUserId || '', { max: 80, allowEmpty: true }),
    digitalAccessExpiresAt: normalizeIsoDate(row.digitalAccessExpiresAt),
    notes: cleanString(row.notes, { max: 2000, allowEmpty: true }),
    audit: {
      createUser: cleanString(row?.audit?.createUser, { max: 80, allowEmpty: true }) || 'SYSTEM',
      createDateTime: cleanString(row?.audit?.createDateTime, { max: 40, allowEmpty: true }) || now,
      lastUpdateUser: cleanString(row?.audit?.lastUpdateUser, { max: 80, allowEmpty: true }) || 'SYSTEM',
      lastUpdateDateTime: cleanString(row?.audit?.lastUpdateDateTime, { max: 40, allowEmpty: true }) || now
    }
  };
}

function sanitizeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid library loan payload.');
  }
  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  const patronId = cleanId(input.patronId, { max: 80, allowEmpty: false });
  const personId = cleanId(input.personId, { max: 64, allowEmpty: false });
  const copyId = cleanId(input.copyId, { max: 80, allowEmpty: false });
  const bookId = cleanId(input.bookId, { max: 80, allowEmpty: false });
  if (!orgId || !patronId || !personId || !copyId || !bookId) {
    throw new Error('Loan requires organization, patron, copy, and book identifiers.');
  }

  const copyType = normalizeCopyType(input.copyType);
  const checkoutAt = normalizeIsoDate(input.checkoutAt) || new Date().toISOString();
  const dueAt = normalizeIsoDate(input.dueAt);
  if (!dueAt) throw new Error('Loan due date is required.');

  return {
    orgId: String(orgId),
    patronId: String(patronId),
    personId: String(personId),
    patronRole: normalizePatronRole(input.patronRole),
    copyId: String(copyId),
    bookId: String(bookId),
    copyType,
    status: normalizeLoanStatus(input.status),
    checkoutAt,
    dueAt,
    returnedAt: normalizeIsoDate(input.returnedAt),
    renewalCount: cleanInt(input.renewalCount, { min: 0, max: 99, fallback: 0 }),
    checkedOutByUserId: cleanId(input.checkedOutByUserId || '', { max: 80, allowEmpty: true }),
    returnedByUserId: cleanId(input.returnedByUserId || '', { max: 80, allowEmpty: true }),
    digitalAccessExpiresAt: copyType === COPY_TYPES.DIGITAL
      ? normalizeIsoDate(input.digitalAccessExpiresAt) || dueAt
      : normalizeIsoDate(input.digitalAccessExpiresAt),
    notes: cleanString(input.notes, { max: 2000, allowEmpty: true })
  };
}

async function ensureDataFile() {
  if (!fsSync.existsSync(path.dirname(dataPath))) {
    fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
  }
  if (!fsSync.existsSync(dataPath)) {
    fsSync.writeFileSync(dataPath, '[]');
  }
}

async function getAllLibraryLoans() {
  await ensureDataFile();
  const content = await fs.readFile(dataPath, 'utf8');
  let parsed = [];
  try {
    parsed = JSON.parse(String(content || '[]').replace(/^\uFEFF/, '') || '[]');
  } catch (_) {
    parsed = [];
  }
  return Array.isArray(parsed) ? parsed.map(normalizeStoredLoan) : [];
}

async function getLibraryLoanById(id) {
  const rows = await getAllLibraryLoans();
  return rows.find((row) => String(row.id) === String(id)) || null;
}

async function addLibraryLoan(payload) {
  return queueWrite(async () => {
    const rows = await getAllLibraryLoans();
    const sanitized = sanitizeInput(payload);
    const created = {
      id: payload.id || generateEntityId('LL'),
      ...sanitized,
      audit: buildAudit(payload?.audit, payload?.audit?.createUser || 'SYSTEM')
    };
    rows.push(created);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return created;
  });
}

async function updateLibraryLoan(id, payload) {
  return queueWrite(async () => {
    const rows = await getAllLibraryLoans();
    const index = rows.findIndex((row) => String(row.id) === String(id));
    if (index < 0) throw new Error('Library loan not found.');
    const current = rows[index];
    const merged = {
      ...current,
      ...payload,
      orgId: current.orgId,
      patronId: current.patronId,
      personId: current.personId,
      copyId: current.copyId,
      bookId: current.bookId
    };
    const sanitized = sanitizeInput(merged);
    rows[index] = {
      ...current,
      ...sanitized,
      id: current.id,
      orgId: current.orgId,
      audit: buildAudit(current.audit, payload?.audit?.lastUpdateUser || 'SYSTEM')
    };
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return rows[index];
  });
}

async function deleteLibraryLoan(id) {
  return queueWrite(async () => {
    const rows = await getAllLibraryLoans();
    const index = rows.findIndex((row) => String(row.id) === String(id));
    if (index < 0) throw new Error('Library loan not found.');
    const removed = rows[index];
    rows.splice(index, 1);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return removed;
  });
}

module.exports = {
  LOAN_STATUSES,
  OPEN_STATUSES,
  COPY_TYPES,
  normalizeLoanStatus,
  getAllLibraryLoans,
  getLibraryLoanById,
  addLibraryLoan,
  updateLibraryLoan,
  deleteLibraryLoan
};
