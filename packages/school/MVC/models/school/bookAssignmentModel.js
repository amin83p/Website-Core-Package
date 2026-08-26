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

const dataPath = path.join(resolveCoreRoot(), 'data/school/bookAssignments.json');

const ASSIGNMENT_STATUSES = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  ARCHIVED: 'archived'
});

const BOOK_LINE_STATUSES = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive'
});

const VALID_STATUSES = new Set(Object.values(ASSIGNMENT_STATUSES));
const VALID_BOOK_STATUSES = new Set(Object.values(BOOK_LINE_STATUSES));

function normalizeStatus(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_STATUSES.has(normalized) ? normalized : ASSIGNMENT_STATUSES.ACTIVE;
}

function normalizeBookLineStatus(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_BOOK_STATUSES.has(normalized) ? normalized : BOOK_LINE_STATUSES.ACTIVE;
}

function isLegacyRow(row = {}) {
  const bookId = cleanId(row.bookId, { max: 80, allowEmpty: true });
  const hasBooks = Array.isArray(row.books) && row.books.length > 0;
  return Boolean(bookId) && !hasBooks;
}

function upgradeLegacyRow(row = {}) {
  const bookId = cleanId(row.bookId, { max: 80, allowEmpty: false });
  return {
    ...row,
    bookId: '',
    books: [{
      bookId: String(bookId),
      sortOrder: cleanInt(row.sortOrder, { min: 0, max: 99999, fallback: 100 }),
      notes: cleanString(row.notes, { max: 2000, allowEmpty: true }),
      status: normalizeBookLineStatus(row.status)
    }]
  };
}

function sanitizeBookLines(entries = [], { requireBooks = true } = {}) {
  const rows = Array.isArray(entries) ? entries : [];
  if (!rows.length && requireBooks) throw new Error('At least one book is required.');
  const seen = new Set();
  const normalized = rows.map((entry, index) => {
    const bookId = cleanId(entry?.bookId, { max: 80, allowEmpty: false });
    if (!bookId) throw new Error(`Book row ${index + 1}: book is required.`);
    if (seen.has(String(bookId))) throw new Error(`Duplicate book "${bookId}" in assignment.`);
    seen.add(String(bookId));
    return {
      bookId: String(bookId),
      sortOrder: cleanInt(entry?.sortOrder, { min: 0, max: 99999, fallback: (index + 1) * 10 }),
      notes: cleanString(entry?.notes, { max: 2000, allowEmpty: true }),
      status: normalizeBookLineStatus(entry?.status)
    };
  });
  normalized.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  return normalized;
}

function normalizeStoredAssignment(row = {}) {
  const now = new Date().toISOString();
  const source = isLegacyRow(row) ? upgradeLegacyRow(row) : row;
  const books = Array.isArray(source.books) ? source.books : [];
  return {
    id: cleanId(source.id || generateEntityId('BKASG'), { max: 80, allowEmpty: false }),
    orgId: cleanId(source.orgId || '', { max: 64, allowEmpty: false }),
    classId: cleanId(source.classId || '', { max: 80, allowEmpty: false }),
    status: normalizeStatus(source.status),
    notes: cleanString(source.notes, { max: 2000, allowEmpty: true }),
    books: books.map((entry, index) => {
      const bookId = cleanId(entry?.bookId, { max: 80, allowEmpty: true });
      if (!bookId) return null;
      return {
        bookId: String(bookId),
        sortOrder: cleanInt(entry?.sortOrder, { min: 0, max: 99999, fallback: (index + 1) * 10 }),
        notes: cleanString(entry?.notes, { max: 2000, allowEmpty: true }),
        status: normalizeBookLineStatus(entry?.status)
      };
    }).filter(Boolean),
    audit: {
      createUser: cleanString(source?.audit?.createUser, { max: 80, allowEmpty: true }) || 'SYSTEM',
      createDateTime: cleanString(source?.audit?.createDateTime, { max: 40, allowEmpty: true }) || now,
      lastUpdateUser: cleanString(source?.audit?.lastUpdateUser, { max: 80, allowEmpty: true }) || 'SYSTEM',
      lastUpdateDateTime: cleanString(source?.audit?.lastUpdateDateTime, { max: 40, allowEmpty: true }) || now
    }
  };
}

function parseBooksInput(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = String(value || '').trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      throw new Error('Invalid books payload.');
    }
  }
  return [];
}

function sanitizeInput(input, { isUpdate = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid book assignment payload.');
  }
  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  const classId = cleanId(input.classId, { max: 80, allowEmpty: false });
  if (!orgId) throw new Error('Organization is required.');
  if (!classId) throw new Error('Class is required.');

  const books = sanitizeBookLines(parseBooksInput(input.books), { requireBooks: true });
  const output = {
    orgId: String(orgId),
    classId: String(classId),
    status: normalizeStatus(input.status),
    notes: cleanString(input.notes, { max: 2000, allowEmpty: true }),
    books
  };
  if (!isUpdate && input.id) {
    output.id = cleanId(input.id, { max: 80, allowEmpty: false });
  }
  return output;
}

function assertUniqueClassAssignment(rows, candidate, { excludeId = null } = {}) {
  const classId = String(candidate.classId || '');
  const orgId = String(candidate.orgId || '');
  const duplicate = (Array.isArray(rows) ? rows : []).some((row) => (
    (!excludeId || String(row.id) !== String(excludeId))
    && String(row.orgId || '') === orgId
    && String(row.classId || '') === classId
  ));
  if (duplicate) {
    throw new Error('An assignment for this class already exists. Edit the existing assignment instead.');
  }
}

async function ensureDataFile() {
  if (!fsSync.existsSync(path.dirname(dataPath))) {
    fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
  }
  if (!fsSync.existsSync(dataPath)) {
    fsSync.writeFileSync(dataPath, '[]');
  }
}

async function getAllBookAssignments() {
  await ensureDataFile();
  const content = await fs.readFile(dataPath, 'utf8');
  let parsed = [];
  try {
    parsed = JSON.parse(String(content || '[]').replace(/^\uFEFF/, '') || '[]');
  } catch (_) {
    parsed = [];
  }
  return Array.isArray(parsed) ? parsed.map(normalizeStoredAssignment) : [];
}

async function getBookAssignmentById(id) {
  const rows = await getAllBookAssignments();
  return rows.find((row) => String(row.id) === String(id)) || null;
}

async function getBookAssignmentByClass(orgId, classId) {
  const rows = await getAllBookAssignments();
  return rows.find((row) => (
    String(row.orgId || '') === String(orgId || '')
    && String(row.classId || '') === String(classId || '')
  )) || null;
}

async function addBookAssignment(payload) {
  return queueWrite(async () => {
    const rows = await getAllBookAssignments();
    const sanitized = sanitizeInput(payload, { isUpdate: false });
    assertUniqueClassAssignment(rows, sanitized);
    const created = {
      id: sanitized.id || generateEntityId('BKASG'),
      ...sanitized,
      audit: buildAudit(payload?.audit, payload?.audit?.createUser || 'SYSTEM')
    };
    rows.push(created);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return created;
  });
}

async function updateBookAssignment(id, payload) {
  return queueWrite(async () => {
    const rows = await getAllBookAssignments();
    const index = rows.findIndex((row) => String(row.id) === String(id));
    if (index < 0) throw new Error('Book assignment not found.');
    const current = rows[index];
    const merged = {
      ...current,
      ...payload,
      orgId: current.orgId,
      classId: payload.classId || current.classId,
      books: payload.books !== undefined ? parseBooksInput(payload.books) : current.books
    };
    const sanitized = sanitizeInput(merged, { isUpdate: true });
    assertUniqueClassAssignment(rows, sanitized, { excludeId: current.id });
    rows[index] = {
      ...current,
      ...sanitized,
      orgId: current.orgId,
      audit: buildAudit(current.audit, payload?.audit?.lastUpdateUser || 'SYSTEM')
    };
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return rows[index];
  });
}

async function deleteBookAssignment(id) {
  return queueWrite(async () => {
    const rows = await getAllBookAssignments();
    const index = rows.findIndex((row) => String(row.id) === String(id));
    if (index < 0) throw new Error('Book assignment not found.');
    const removed = rows[index];
    rows.splice(index, 1);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return removed;
  });
}

module.exports = {
  ASSIGNMENT_STATUSES,
  BOOK_LINE_STATUSES,
  normalizeStatus,
  normalizeBookLineStatus,
  sanitizeBookLines,
  isLegacyRow,
  upgradeLegacyRow,
  getAllBookAssignments,
  getBookAssignmentById,
  getBookAssignmentByClass,
  addBookAssignment,
  updateBookAssignment,
  deleteBookAssignment
};
