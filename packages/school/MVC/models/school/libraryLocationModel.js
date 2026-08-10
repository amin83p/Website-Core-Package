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

const dataPath = path.join(resolveCoreRoot(), 'data/school/libraryLocations.json');

const LOCATION_TYPES = Object.freeze({
  BUILDING: 'building',
  FLOOR: 'floor',
  ROOM: 'room',
  SHELF: 'shelf',
  SPOT: 'spot'
});

const VALID_TYPES = new Set(Object.values(LOCATION_TYPES));

const CHILD_TYPE_BY_PARENT = Object.freeze({
  [LOCATION_TYPES.BUILDING]: LOCATION_TYPES.FLOOR,
  [LOCATION_TYPES.FLOOR]: LOCATION_TYPES.ROOM,
  [LOCATION_TYPES.ROOM]: LOCATION_TYPES.SHELF,
  [LOCATION_TYPES.SHELF]: LOCATION_TYPES.SPOT
});

const ALLOWED_PARENT_BY_TYPE = Object.freeze({
  [LOCATION_TYPES.BUILDING]: null,
  [LOCATION_TYPES.FLOOR]: LOCATION_TYPES.BUILDING,
  [LOCATION_TYPES.ROOM]: LOCATION_TYPES.FLOOR,
  [LOCATION_TYPES.SHELF]: LOCATION_TYPES.ROOM,
  [LOCATION_TYPES.SPOT]: LOCATION_TYPES.SHELF
});

function normalizeLocationType(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_TYPES.has(normalized) ? normalized : '';
}

function normalizeStoredLocation(row = {}) {
  const now = new Date().toISOString();
  const locationType = normalizeLocationType(row.locationType);
  const parentId = cleanId(row.parentId, { max: 80, allowEmpty: true }) || null;
  return {
    id: cleanId(row.id || generateEntityId('LLoc'), { max: 80, allowEmpty: false }),
    orgId: cleanId(row.orgId || '', { max: 64, allowEmpty: false }),
    parentId,
    locationType,
    name: cleanString(row.name, { max: 160, allowEmpty: false }),
    code: cleanString(row.code, { max: 80, allowEmpty: true }),
    sortOrder: cleanInt(row.sortOrder, { min: 0, max: 99999, fallback: 100 }),
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

function assertParentTypeValid(locationType, parentRow) {
  const expectedParentType = ALLOWED_PARENT_BY_TYPE[locationType];
  if (!expectedParentType) {
    if (parentRow) throw new Error('Buildings cannot have a parent location.');
    return;
  }
  if (!parentRow) throw new Error(`A ${locationType} requires a parent location.`);
  if (String(parentRow.locationType) !== expectedParentType) {
    throw new Error(`A ${locationType} must be placed under a ${expectedParentType}.`);
  }
  if (parentRow.active === false) {
    throw new Error('Parent location is inactive.');
  }
}

function assertUniqueCode(rows, candidate, { excludeId = null } = {}) {
  const code = cleanString(candidate.code, { max: 80, allowEmpty: true });
  if (!code) return;
  const duplicate = (Array.isArray(rows) ? rows : []).some((row) => (
    (!excludeId || String(row.id) !== String(excludeId))
    && String(row.orgId || '') === String(candidate.orgId || '')
    && cleanString(row.code, { max: 80, allowEmpty: true }).toLowerCase() === code.toLowerCase()
  ));
  if (duplicate) throw new Error(`Location code "${code}" already exists for this organization.`);
}

function sanitizeInput(input, rows, { isUpdate = false, existing = null } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid library location payload.');
  }
  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  const locationType = normalizeLocationType(input.locationType);
  const name = cleanString(input.name, { max: 160, allowEmpty: false });
  if (!orgId) throw new Error('Organization is required.');
  if (!locationType) throw new Error('Location type is required.');
  if (!name) throw new Error('Location name is required.');

  const parentId = locationType === LOCATION_TYPES.BUILDING
    ? null
    : cleanId(input.parentId, { max: 80, allowEmpty: false });
  if (locationType !== LOCATION_TYPES.BUILDING && !parentId) {
    throw new Error('Parent location is required.');
  }

  const parentRow = parentId
    ? (Array.isArray(rows) ? rows : []).find((row) => String(row.id) === String(parentId))
    : null;
  if (locationType !== LOCATION_TYPES.BUILDING && !parentRow) {
    throw new Error('Parent location not found.');
  }
  if (parentRow && String(parentRow.orgId) !== String(orgId)) {
    throw new Error('Parent location belongs to a different organization.');
  }
  assertParentTypeValid(locationType, parentRow);

  const output = {
    orgId: String(orgId),
    parentId: parentId || null,
    locationType,
    name,
    code: cleanString(input.code, { max: 80, allowEmpty: true }),
    sortOrder: cleanInt(input.sortOrder, { min: 0, max: 99999, fallback: 100 }),
    active: cleanBoolean(input.active, true),
    notes: cleanString(input.notes, { max: 2000, allowEmpty: true })
  };
  if (!isUpdate && input.id) {
    output.id = cleanId(input.id, { max: 80, allowEmpty: false });
  }
  if (isUpdate && existing) {
    if (String(existing.locationType) !== locationType) {
      throw new Error('Location type cannot be changed after creation.');
    }
    if (String(existing.parentId || '') !== String(output.parentId || '')) {
      throw new Error('Parent location cannot be changed after creation.');
    }
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

async function getAllLibraryLocations() {
  await ensureDataFile();
  const content = await fs.readFile(dataPath, 'utf8');
  let parsed = [];
  try {
    parsed = JSON.parse(String(content || '[]').replace(/^\uFEFF/, '') || '[]');
  } catch (_) {
    parsed = [];
  }
  return Array.isArray(parsed) ? parsed.map(normalizeStoredLocation) : [];
}

async function getLibraryLocationById(id) {
  const rows = await getAllLibraryLocations();
  return rows.find((row) => String(row.id) === String(id)) || null;
}

function getChildTypeForParent(parentType) {
  return CHILD_TYPE_BY_PARENT[String(parentType || '').trim().toLowerCase()] || null;
}

async function addLibraryLocation(payload) {
  return queueWrite(async () => {
    const rows = await getAllLibraryLocations();
    const sanitized = sanitizeInput(payload, rows, { isUpdate: false });
    assertUniqueCode(rows, sanitized);
    const created = {
      id: sanitized.id || generateEntityId('LLoc'),
      ...sanitized,
      audit: buildAudit(payload?.audit, payload?.audit?.createUser || 'SYSTEM')
    };
    rows.push(created);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return created;
  });
}

async function updateLibraryLocation(id, payload) {
  return queueWrite(async () => {
    const rows = await getAllLibraryLocations();
    const index = rows.findIndex((row) => String(row.id) === String(id));
    if (index < 0) throw new Error('Library location not found.');
    const current = rows[index];
    const sanitized = sanitizeInput({
      ...current,
      ...payload,
      orgId: current.orgId,
      locationType: current.locationType,
      parentId: current.parentId
    }, rows, { isUpdate: true, existing: current });
    assertUniqueCode(rows, sanitized, { excludeId: current.id });
    rows[index] = {
      ...current,
      ...sanitized,
      orgId: current.orgId,
      locationType: current.locationType,
      parentId: current.parentId,
      audit: buildAudit(current.audit, payload?.audit?.lastUpdateUser || 'SYSTEM')
    };
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return rows[index];
  });
}

async function deleteLibraryLocation(id) {
  return queueWrite(async () => {
    const rows = await getAllLibraryLocations();
    const index = rows.findIndex((row) => String(row.id) === String(id));
    if (index < 0) throw new Error('Library location not found.');
    const current = rows[index];
    const hasChildren = rows.some((row) => String(row.parentId || '') === String(current.id));
    if (hasChildren) throw new Error('Cannot delete a location that has child locations.');
    const removed = rows[index];
    rows.splice(index, 1);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return removed;
  });
}

module.exports = {
  LOCATION_TYPES,
  CHILD_TYPE_BY_PARENT,
  ALLOWED_PARENT_BY_TYPE,
  normalizeLocationType,
  getChildTypeForParent,
  getAllLibraryLocations,
  getLibraryLocationById,
  addLibraryLocation,
  updateLibraryLocation,
  deleteLibraryLocation
};
