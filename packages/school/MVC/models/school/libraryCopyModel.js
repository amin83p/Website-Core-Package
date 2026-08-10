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
  generateEntityId,
  buildAudit
} = require('./libraryEntityCommon');

const dataPath = path.join(resolveCoreRoot(), 'data/school/libraryCopies.json');

const COPY_TYPES = Object.freeze({
  PHYSICAL: 'physical',
  DIGITAL: 'digital'
});
const COPY_STATUSES = Object.freeze({
  AVAILABLE: 'available',
  LOANED: 'loaned',
  LOST: 'lost',
  DAMAGED: 'damaged',
  RETIRED: 'retired'
});

const VALID_TYPES = new Set(Object.values(COPY_TYPES));
const VALID_STATUSES = new Set(Object.values(COPY_STATUSES));

function normalizeCopyType(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_TYPES.has(normalized) ? normalized : COPY_TYPES.PHYSICAL;
}

function normalizeCopyStatus(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_STATUSES.has(normalized) ? normalized : COPY_STATUSES.AVAILABLE;
}

function sanitizeDigitalAsset(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fileName = cleanString(value.fileName || value.filename, { max: 260, allowEmpty: true });
  const pathValue = cleanString(value.path || value.storagePath, { max: 600, allowEmpty: true });
  const url = cleanString(value.url, { max: 600, allowEmpty: true });
  if (!fileName && !pathValue && !url) return null;
  return {
    fileName,
    originalName: cleanString(value.originalName || value.name, { max: 260, allowEmpty: true }),
    path: pathValue,
    url,
    uploadedAt: cleanString(value.uploadedAt, { max: 40, allowEmpty: true }) || new Date().toISOString()
  };
}

function normalizeStoredCopy(row = {}) {
  const now = new Date().toISOString();
  return {
    id: cleanId(row.id || generateEntityId('LC'), { max: 80, allowEmpty: false }),
    orgId: cleanId(row.orgId || '', { max: 64, allowEmpty: false }),
    bookId: cleanId(row.bookId || '', { max: 80, allowEmpty: false }),
    copyType: normalizeCopyType(row.copyType),
    copyCode: cleanString(row.copyCode, { max: 120, allowEmpty: true }),
    status: normalizeCopyStatus(row.status),
    locationId: cleanId(row.locationId, { max: 80, allowEmpty: true }),
    location: cleanString(row.location, { max: 200, allowEmpty: true }),
    digitalAsset: sanitizeDigitalAsset(row.digitalAsset),
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
    throw new Error('Invalid library copy payload.');
  }
  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  const bookId = cleanId(input.bookId, { max: 80, allowEmpty: false });
  if (!orgId) throw new Error('Organization is required.');
  if (!bookId) throw new Error('Catalog book is required.');

  const copyType = normalizeCopyType(input.copyType);
  const copyCode = cleanString(input.copyCode, { max: 120, allowEmpty: copyType === COPY_TYPES.DIGITAL });
  if (!copyCode) throw new Error('Copy code or barcode is required.');

  const output = {
    orgId: String(orgId),
    bookId: String(bookId),
    copyType,
    copyCode,
    status: normalizeCopyStatus(input.status),
    locationId: cleanId(input.locationId, { max: 80, allowEmpty: true }),
    location: cleanString(input.location, { max: 200, allowEmpty: true }),
    digitalAsset: sanitizeDigitalAsset(input.digitalAsset),
    notes: cleanString(input.notes, { max: 2000, allowEmpty: true })
  };
  if (!isUpdate && input.id) {
    output.id = cleanId(input.id, { max: 80, allowEmpty: false });
  }
  return output;
}

function assertUniqueCopyCode(rows, candidate, { excludeId = null } = {}) {
  const code = cleanString(candidate.copyCode, { max: 120, allowEmpty: true });
  if (!code) return;
  const duplicate = (Array.isArray(rows) ? rows : []).some((row) => (
    (!excludeId || String(row.id) !== String(excludeId))
    && String(row.orgId || '') === String(candidate.orgId || '')
    && cleanString(row.copyCode, { max: 120, allowEmpty: true }) === code
  ));
  if (duplicate) throw new Error(`Copy code "${code}" already exists for this organization.`);
}

async function ensureDataFile() {
  if (!fsSync.existsSync(path.dirname(dataPath))) {
    fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
  }
  if (!fsSync.existsSync(dataPath)) {
    fsSync.writeFileSync(dataPath, '[]');
  }
}

async function getAllLibraryCopies() {
  await ensureDataFile();
  const content = await fs.readFile(dataPath, 'utf8');
  let parsed = [];
  try {
    parsed = JSON.parse(String(content || '[]').replace(/^\uFEFF/, '') || '[]');
  } catch (_) {
    parsed = [];
  }
  return Array.isArray(parsed) ? parsed.map(normalizeStoredCopy) : [];
}

async function getLibraryCopyById(id) {
  const rows = await getAllLibraryCopies();
  return rows.find((row) => String(row.id) === String(id)) || null;
}

async function addLibraryCopy(payload) {
  return queueWrite(async () => {
    const rows = await getAllLibraryCopies();
    const sanitized = sanitizeInput(payload, { isUpdate: false });
    assertUniqueCopyCode(rows, sanitized);
    const created = {
      id: sanitized.id || generateEntityId('LC'),
      ...sanitized,
      audit: buildAudit(payload?.audit, payload?.audit?.createUser || 'SYSTEM')
    };
    rows.push(created);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return created;
  });
}

async function updateLibraryCopy(id, payload) {
  return queueWrite(async () => {
    const rows = await getAllLibraryCopies();
    const index = rows.findIndex((row) => String(row.id) === String(id));
    if (index < 0) throw new Error('Library copy not found.');
    const current = rows[index];
    const sanitized = sanitizeInput({
      ...current,
      ...payload,
      orgId: current.orgId,
      bookId: payload.bookId || current.bookId
    }, { isUpdate: true });
    assertUniqueCopyCode(rows, sanitized, { excludeId: current.id });
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

async function deleteLibraryCopy(id) {
  return queueWrite(async () => {
    const rows = await getAllLibraryCopies();
    const index = rows.findIndex((row) => String(row.id) === String(id));
    if (index < 0) throw new Error('Library copy not found.');
    const removed = rows[index];
    rows.splice(index, 1);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return removed;
  });
}

module.exports = {
  COPY_TYPES,
  COPY_STATUSES,
  normalizeCopyType,
  normalizeCopyStatus,
  getAllLibraryCopies,
  getLibraryCopyById,
  addLibraryCopy,
  updateLibraryCopy,
  deleteLibraryCopy
};
