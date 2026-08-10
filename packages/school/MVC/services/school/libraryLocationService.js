'use strict';

const schoolDataService = require('./schoolDataService');
const { LOCATION_TYPES } = require('../../models/school/libraryLocationModel');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

async function listOrgLocations(orgId, user) {
  const rows = await schoolDataService.fetchAllData('libraryLocations', {}, user);
  return (Array.isArray(rows) ? rows : []).filter((row) => idsEqual(row.orgId, orgId));
}

function sortLocations(rows = []) {
  return [...rows].sort((a, b) => {
    const orderA = Number(a?.sortOrder || 0);
    const orderB = Number(b?.sortOrder || 0);
    if (orderA !== orderB) return orderA - orderB;
    return String(a?.name || '').localeCompare(String(b?.name || ''));
  });
}

function buildLocationTree(rows = [], options = {}) {
  const includeInactive = options?.includeInactive === true;
  const filtered = sortLocations(
    (Array.isArray(rows) ? rows : []).filter((row) => includeInactive || row.active !== false)
  );
  const byId = new Map(filtered.map((row) => [String(row.id), { ...row, children: [] }]));
  const roots = [];
  filtered.forEach((row) => {
    const node = byId.get(String(row.id));
    if (!node) return;
    const parentId = String(row.parentId || '').trim();
    if (parentId && byId.has(parentId)) {
      byId.get(parentId).children.push(node);
    } else if (!parentId) {
      roots.push(node);
    }
  });
  return roots;
}

function buildLocationPath(locationId, rows = []) {
  const id = String(locationId || '').trim();
  if (!id) return '';
  const byId = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.id), row]));
  const parts = [];
  let current = byId.get(id);
  const guard = new Set();
  while (current) {
    if (guard.has(String(current.id))) break;
    guard.add(String(current.id));
    parts.unshift(String(current.name || current.id));
    const parentId = String(current.parentId || '').trim();
    current = parentId ? byId.get(parentId) : null;
  }
  return parts.join(' / ');
}

function listAssignableSpots(rows = []) {
  const sorted = sortLocations(rows);
  return sorted
    .filter((row) => String(row.locationType) === LOCATION_TYPES.SPOT && row.active !== false)
    .map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code || '',
      path: buildLocationPath(row.id, sorted)
    }));
}

async function buildLocationPathForId(locationId, user) {
  const row = await schoolDataService.getDataById('libraryLocations', locationId, user);
  if (!row) return '';
  const orgRows = await listOrgLocations(row.orgId, user);
  return buildLocationPath(locationId, orgRows);
}

async function countCopiesAtLocation(locationId, user) {
  const rows = await schoolDataService.fetchAllData('libraryCopies', {}, user);
  return (Array.isArray(rows) ? rows : []).filter((row) => String(row.locationId || '') === String(locationId)).length;
}

module.exports = {
  listOrgLocations,
  buildLocationTree,
  buildLocationPath,
  listAssignableSpots,
  buildLocationPathForId,
  countCopiesAtLocation,
  getChildTypeForParent: require('../../models/school/libraryLocationModel').getChildTypeForParent
};
