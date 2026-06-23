const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');

const dataPath = path.join(resolveCoreRoot(), 'data/school/activityCategories.json');

if (!fsSync.existsSync(dataPath)) {
  fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
  fsSync.writeFileSync(dataPath, '[]');
}

function cleanString(value, { max = 500, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function cleanId(value, { max = 64, allowEmpty = false } = {}) {
  const out = cleanString(value, { max, allowEmpty });
  if (out === null) return null;
  if (!out) return allowEmpty ? '' : null;
  if (!/^[A-Za-z0-9_-]+$/.test(out)) throw new Error('Invalid id format.');
  return out;
}

function normalizeCode(value) {
  return cleanString(value, { max: 40, allowEmpty: false })
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .toUpperCase();
}

function generateId() {
  return `ACTCAT-${Math.floor(100000 + Math.random() * 900000)}`;
}

async function getAllCategories() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve school activity categories.');
  }
}

function sanitizeCategoryPayload(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid activity category payload.');
  }
  const orgId = cleanId(input.orgId, { allowEmpty: false });
  const name = cleanString(input.name, { max: 160, allowEmpty: false });
  const code = normalizeCode(input.code || name);
  if (!orgId) throw new Error('Organization is required.');
  if (!name) throw new Error('Category name is required.');
  if (!code) throw new Error('Category code is required.');
  return {
    orgId,
    code,
    name,
    description: cleanString(input.description, { max: 1000, allowEmpty: true }),
    defaultPaid: input.defaultPaid === true || input.defaultPaid === 'true' || input.defaultPaid === 'on',
    active: !(input.active === false || input.active === 'false' || input.active === 'inactive')
  };
}

function assertUnique(rows, candidate, excludeId = '') {
  const exists = (Array.isArray(rows) ? rows : []).some((row) => {
    if (excludeId && String(row.id) === String(excludeId)) return false;
    return String(row.orgId || '') === String(candidate.orgId || '')
      && String(row.code || '').toUpperCase() === String(candidate.code || '').toUpperCase();
  });
  if (exists) throw new Error('This activity category code already exists in this organization.');
}

async function getCategoryById(id) {
  const rows = await getAllCategories();
  return rows.find((row) => String(row.id) === String(id)) || null;
}

async function addCategory(payload) {
  return queueWrite(async () => {
    const rows = await getAllCategories();
    const sanitized = sanitizeCategoryPayload(payload);
    assertUnique(rows, sanitized);
    const row = {
      id: generateId(),
      ...sanitized,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    rows.push(row);
    rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return row;
  });
}

async function updateCategory(id, payload) {
  return queueWrite(async () => {
    const rows = await getAllCategories();
    const index = rows.findIndex((row) => String(row.id) === String(id));
    if (index < 0) throw new Error('Activity category not found.');
    const existing = rows[index];
    const sanitized = sanitizeCategoryPayload({ ...payload, orgId: existing.orgId || payload.orgId });
    assertUnique(rows, sanitized, existing.id);
    rows[index] = {
      ...existing,
      ...sanitized,
      updatedAt: new Date().toISOString()
    };
    rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return rows[index];
  });
}

async function deleteCategory(id) {
  return queueWrite(async () => {
    const rows = await getAllCategories();
    await fs.writeFile(dataPath, JSON.stringify(rows.filter((row) => String(row.id) !== String(id)), null, 2));
  });
}

module.exports = {
  getAllCategories,
  getCategoryById,
  addCategory,
  updateCategory,
  deleteCategory,
  sanitizeCategoryPayload
};
