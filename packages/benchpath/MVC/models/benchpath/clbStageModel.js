const fs = require('fs').promises;
const path = require('path');
const { requireCoreModule, resolveCoreRoot } = require('../../services/benchpath/benchpathCoreModuleResolver');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const sourceModel = require('./sourceModel');
const sourceFragmentModel = require('./sourceFragmentModel');

const dataPath = path.join(resolveCoreRoot(), 'data/benchpath/reference/clb.stages.json');

const RECORD_STATUSES = ['draft', 'reviewed', 'approved', 'archived', 'deleted'];
const REVIEW_STATUSES = ['pending', 'in_review', 'reviewed', 'rejected', 'not_required'];
const DESCRIPTORS = ['basic', 'intermediate', 'advanced', 'other'];

function nowIso() { return new Date().toISOString(); }
function s(v) { return String(v == null ? '' : v).trim(); }
function sn(v) { const x = s(v); return x ? x : null; }
function i(v, fallback = null) {
  if (v === '' || v == null) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
function b(v, fallback = false) {
  if (typeof v === 'boolean') return v;
  const x = s(v).toLowerCase();
  if (!x) return fallback;
  if (['true', '1', 'yes', 'y', 'on'].includes(x)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(x)) return false;
  return fallback;
}
function arr(v, sep = ',') {
  if (Array.isArray(v)) return v.map((x) => s(x)).filter(Boolean);
  const x = s(v);
  if (!x) return [];
  return x.split(sep).map((p) => p.trim()).filter(Boolean);
}
function jsonArrayOrDefault(v, fallback = []) {
  if (Array.isArray(v)) return v;
  const x = s(v);
  if (!x) return fallback;
  try {
    const p = JSON.parse(x);
    return Array.isArray(p) ? p : fallback;
  } catch (_) {
    return fallback;
  }
}
function jsonObjectOrDefault(v, fallback = {}) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  const x = s(v);
  if (!x) return fallback;
  try {
    const p = JSON.parse(x);
    return p && typeof p === 'object' && !Array.isArray(p) ? p : fallback;
  } catch (_) {
    return fallback;
  }
}
function ensureAllowed(field, value, allowed, errors, required = true) {
  const x = s(value);
  if (!x) {
    if (required) errors.push(`${field} is required.`);
    return;
  }
  if (!allowed.includes(x)) errors.push(`${field} must be one of: ${allowed.join(', ')}`);
}

async function ensureDataDir() {
  const dir = path.dirname(dataPath);
  try { await fs.access(dir); } catch (_) { await fs.mkdir(dir, { recursive: true }); }
}
function emptyDb() {
  const ts = nowIso();
  return {
    meta: {
      schemaVersion: '1.0.0',
      entityType: 'clbStages',
      layer: 'reference',
      authority: 'official',
      isReadMostly: true,
      defaultLocale: 'en-CA',
      generatedAt: ts,
      updatedAt: ts
    },
    itemsById: {},
    allIds: [],
    indexes: {
      byFrameworkId: {},
      byStatus: {},
      byReviewStatus: {},
      byCode: {},
      byOrgId: {}
    }
  };
}
async function readDb() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(dataPath, 'utf8');
    const parsed = JSON.parse(String(raw || '').replace(/^\uFEFF/, ''));
    if (!parsed || typeof parsed !== 'object') return emptyDb();
    if (!parsed.itemsById || typeof parsed.itemsById !== 'object') parsed.itemsById = {};
    if (!Array.isArray(parsed.allIds)) parsed.allIds = Object.keys(parsed.itemsById);
    if (!parsed.indexes || typeof parsed.indexes !== 'object') parsed.indexes = {};
    if (!parsed.meta || typeof parsed.meta !== 'object') parsed.meta = emptyDb().meta;
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return emptyDb();
    throw error;
  }
}
async function writeDb(db) {
  const payload = { ...db, meta: { ...(db.meta || {}), updatedAt: nowIso() } };
  await fs.writeFile(dataPath, JSON.stringify(payload, null, 2), 'utf8');
}
function rebuildIndexes(db) {
  const idx = { byFrameworkId: {}, byStatus: {}, byReviewStatus: {}, byCode: {}, byOrgId: {} };
  for (const id of db.allIds || []) {
    const item = db.itemsById[id];
    if (!item) continue;
    const mapIn = (bucket, key) => {
      const k = s(key);
      if (!k) return;
      if (!idx[bucket][k]) idx[bucket][k] = [];
      idx[bucket][k].push(id);
    };
    mapIn('byFrameworkId', item.frameworkId);
    mapIn('byStatus', item.status);
    mapIn('byReviewStatus', item.reviewStatus);
    mapIn('byCode', item.code);
    mapIn('byOrgId', item.orgId || 'SYSTEM');
  }
  db.indexes = idx;
  return db;
}

async function validateRecord(payload, db, currentId = null) {
  const errors = [];
  const normalized = { ...payload };

  normalized.id = s(payload.id);
  normalized.slug = s(payload.slug).toLowerCase();
  normalized.code = s(payload.code);
  normalized.label = s(payload.label || payload.title);
  normalized.shortLabel = sn(payload.shortLabel);
  normalized.frameworkId = s(payload.frameworkId);
  normalized.benchmarkRange = jsonObjectOrDefault(payload.benchmarkRange, {});
  normalized.descriptor = s(payload.descriptor);
  normalized.description = sn(payload.description);
  normalized.displayOrder = i(payload.displayOrder, null);
  normalized.status = s(payload.status);
  normalized.reviewStatus = s(payload.reviewStatus);
  normalized.isActive = b(payload.isActive, true);
  normalized.isSystem = b(payload.isSystem, false);
  normalized.isLocked = b(payload.isLocked, false);
  normalized.tags = arr(payload.tags);
  normalized.sourceRefs = jsonArrayOrDefault(payload.sourceRefs, []);
  normalized.notes = sn(payload.notes);
  normalized.orgId = s(payload.orgId) || 'SYSTEM';
  normalized.approvedBy = sn(payload.approvedBy);
  normalized.approvedAt = sn(payload.approvedAt);
  normalized.extensions = payload.extensions && typeof payload.extensions === 'object' ? payload.extensions : {};
  normalized.version = i(payload.version, 1);

  ['id', 'slug', 'code', 'label', 'frameworkId', 'status', 'reviewStatus'].forEach((field) => {
    if (!s(normalized[field])) errors.push(`${field} is required.`);
  });
  ensureAllowed('status', normalized.status, RECORD_STATUSES, errors);
  ensureAllowed('reviewStatus', normalized.reviewStatus, REVIEW_STATUSES, errors);
  ensureAllowed('descriptor', normalized.descriptor, DESCRIPTORS, errors);

  if (!normalized.id.startsWith('stage:')) errors.push("id must start with 'stage:'.");
  if (!/^[a-z0-9-]+$/.test(normalized.slug)) errors.push('slug must be URL-safe lowercase (a-z, 0-9, dash).');
  if (!Number.isInteger(normalized.displayOrder) || normalized.displayOrder < 1) errors.push('displayOrder must be >= 1.');

  normalized.benchmarkRange = {
    minimum: i(normalized.benchmarkRange?.minimum, null),
    maximum: i(normalized.benchmarkRange?.maximum, null)
  };
  if (!Number.isInteger(normalized.benchmarkRange.minimum) || !Number.isInteger(normalized.benchmarkRange.maximum)) {
    errors.push('benchmarkRange.minimum and benchmarkRange.maximum must be integers.');
  } else if (normalized.benchmarkRange.minimum > normalized.benchmarkRange.maximum) {
    errors.push('benchmarkRange.minimum must be <= benchmarkRange.maximum.');
  }

  const allItems = Object.values(db.itemsById || {});
  const compareItems = allItems.filter((item) => s(item.id) !== s(currentId || ''));
  if (compareItems.some((item) => s(item.id) === normalized.id)) errors.push(`id already exists: ${normalized.id}`);
  if (compareItems.some((item) => s(item.slug).toLowerCase() === normalized.slug)) errors.push(`slug already exists: ${normalized.slug}`);
  if (compareItems.some((item) => s(item.code) === normalized.code)) errors.push(`code already exists: ${normalized.code}`);

  for (let idx = 0; idx < normalized.sourceRefs.length; idx += 1) {
    const ref = normalized.sourceRefs[idx] || {};
    const sourceId = s(ref.sourceId);
    const fragmentId = sn(ref.fragmentId);
    if (!sourceId) {
      errors.push(`sourceRefs[${idx}].sourceId is required.`);
      continue;
    }
    const source = await sourceModel.getSourceById(sourceId);
    if (!source) errors.push(`sourceRefs[${idx}].sourceId not found: ${sourceId}`);
    if (fragmentId) {
      const fragment = await sourceFragmentModel.getFragmentById(fragmentId);
      if (!fragment) errors.push(`sourceRefs[${idx}].fragmentId not found: ${fragmentId}`);
    }
    normalized.sourceRefs[idx] = {
      sourceId,
      fragmentId,
      pages: Array.isArray(ref.pages) ? ref.pages.map((n) => i(n, null)).filter(Number.isInteger) : null,
      note: sn(ref.note)
    };
  }

  if (!Number.isInteger(normalized.version) || normalized.version < 1) errors.push('version must be >= 1');
  return { isValid: errors.length === 0, errors, normalized };
}

function toListItem(item) {
  return {
    ...item,
    id: s(item.id),
    slug: s(item.slug),
    code: s(item.code),
    label: s(item.label),
    title: s(item.label),
    frameworkId: s(item.frameworkId),
    minBenchmark: i(item?.benchmarkRange?.minimum, null),
    maxBenchmark: i(item?.benchmarkRange?.maximum, null),
    displayOrder: i(item.displayOrder, 0),
    status: s(item.status),
    reviewStatus: s(item.reviewStatus),
    orgId: s(item.orgId) || 'SYSTEM',
    isActive: Boolean(item.isActive),
    isSystem: Boolean(item.isSystem),
    isLocked: Boolean(item.isLocked)
  };
}

async function getAllStages() {
  const db = await readDb();
  return (db.allIds || [])
    .map((id) => db.itemsById[id])
    .filter(Boolean)
    .map(toListItem)
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
}
async function getStageById(id) {
  const db = await readDb();
  const row = db.itemsById[s(id)];
  return row ? { ...row } : null;
}
async function getStagesByFrameworkId(frameworkId) {
  const all = await getAllStages();
  const fid = s(frameworkId);
  return all.filter((stage) => s(stage.frameworkId) === fid);
}
async function addStage(input, actor = 'system') {
  return queueWrite(async () => {
    const db = await readDb();
    const check = await validateRecord(input, db, null);
    if (!check.isValid) throw new Error(check.errors.join('<br>'));
    const now = nowIso();
    const item = {
      ...check.normalized,
      createdBy: s(input.createdBy) || actor,
      updatedBy: s(input.updatedBy) || actor,
      createdAt: sn(input.createdAt) || now,
      updatedAt: now
    };
    db.itemsById[item.id] = item;
    db.allIds = [...(db.allIds || []), item.id];
    rebuildIndexes(db);
    await writeDb(db);
    return item;
  });
}
async function updateStage(id, updates, actor = 'system') {
  return queueWrite(async () => {
    const db = await readDb();
    const existing = db.itemsById[s(id)];
    if (!existing) throw new Error('Stage not found.');
    const merged = { ...existing, ...updates, id: existing.id };
    const check = await validateRecord(merged, db, existing.id);
    if (!check.isValid) throw new Error(check.errors.join('<br>'));
    const now = nowIso();
    const updated = {
      ...existing,
      ...check.normalized,
      id: existing.id,
      createdBy: existing.createdBy || 'system',
      createdAt: existing.createdAt || now,
      updatedBy: s(updates.updatedBy) || actor,
      updatedAt: now,
      version: i(existing.version, 1) + 1
    };
    db.itemsById[existing.id] = updated;
    if (!db.allIds.includes(existing.id)) db.allIds.push(existing.id);
    rebuildIndexes(db);
    await writeDb(db);
    return updated;
  });
}
async function deleteStage(id) {
  return queueWrite(async () => {
    const db = await readDb();
    const key = s(id);
    if (!db.itemsById[key]) throw new Error('Stage not found.');
    delete db.itemsById[key];
    db.allIds = (db.allIds || []).filter((rowId) => rowId !== key);
    rebuildIndexes(db);
    await writeDb(db);
    return true;
  });
}

module.exports = {
  RECORD_STATUSES,
  REVIEW_STATUSES,
  DESCRIPTORS,
  getAllStages,
  getStageById,
  getStagesByFrameworkId,
  addStage,
  updateStage,
  deleteStage
};
