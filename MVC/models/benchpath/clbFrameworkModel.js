const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('../fileQueue');
const sourceModel = require('./sourceModel');
const sourceFragmentModel = require('./sourceFragmentModel');
const clbStageModel = require('./clbStageModel');

const dataPath = path.join(__dirname, '../../../data/benchpath/reference/clb.framework.json');

const FRAMEWORK_TYPES = ['framework_of_reference', 'curriculum_framework', 'assessment_framework', 'language_standard', 'other'];
const LANGUAGES = ['en', 'fr', 'bilingual', 'other'];
const PURPOSE_OPTIONS = ['planning', 'teaching', 'assessment', 'curriculum_development', 'resource_development', 'reporting', 'placement', 'policy', 'research'];
const NOT_INTENDED_OPTIONS = ['test', 'curriculum', 'syllabus', 'textbook', 'placement_only', 'other'];
const FRAMEWORK_FEATURES = ['task_based', 'competency_based', 'descriptive', 'multi_skill', 'real_world_oriented', 'portfolio_supportive', 'criterion_referenced', 'other'];
const RECORD_STATUSES = ['draft', 'reviewed', 'approved', 'archived', 'deleted'];
const REVIEW_STATUSES = ['pending', 'in_review', 'reviewed', 'rejected', 'not_required'];

function nowIso() { return new Date().toISOString(); }
function s(v) { return String(v == null ? '' : v).trim(); }
function sn(v) { const x = s(v); return x ? x : null; }
function arr(v, sep = ',') {
  if (Array.isArray(v)) return v.map((x) => s(x)).filter(Boolean);
  const x = s(v);
  if (!x) return [];
  return x.split(sep).map((p) => p.trim()).filter(Boolean);
}
function b(v, fallback = false) {
  if (typeof v === 'boolean') return v;
  const x = s(v).toLowerCase();
  if (!x) return fallback;
  if (['true', '1', 'yes', 'y', 'on'].includes(x)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(x)) return false;
  return fallback;
}
function i(v, fallback = null) {
  if (v === '' || v == null) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
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
    meta: { schemaVersion: '1.0.0', entityType: 'clbFramework', layer: 'reference', authority: 'official', isReadMostly: true, defaultLocale: 'en-CA', generatedAt: ts, updatedAt: ts },
    itemsById: {},
    allIds: [],
    indexes: { byCode: {}, byFrameworkType: {}, byStatus: {}, byReviewStatus: {}, byLanguage: {}, byOrgId: {} }
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
  const idx = { byCode: {}, byFrameworkType: {}, byStatus: {}, byReviewStatus: {}, byLanguage: {}, byOrgId: {} };
  for (const id of db.allIds) {
    const item = db.itemsById[id];
    if (!item) continue;
    const mapIn = (bucket, key) => {
      const k = s(key);
      if (!k) return;
      if (!idx[bucket][k]) idx[bucket][k] = [];
      idx[bucket][k].push(id);
    };
    mapIn('byCode', item.code);
    mapIn('byFrameworkType', item.frameworkType);
    mapIn('byStatus', item.status);
    mapIn('byReviewStatus', item.reviewStatus);
    mapIn('byLanguage', item.language);
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
  normalized.title = s(payload.title);
  normalized.shortTitle = sn(payload.shortTitle);
  normalized.edition = s(payload.edition);
  normalized.versionLabel = s(payload.versionLabel);
  normalized.frameworkType = s(payload.frameworkType);
  normalized.publisher = sn(payload.publisher);
  normalized.authors = arr(payload.authors);
  normalized.language = s(payload.language);
  normalized.country = sn(payload.country);
  normalized.description = sn(payload.description);
  normalized.purpose = arr(payload.purpose);
  normalized.notIntendedAs = arr(payload.notIntendedAs);
  normalized.stageIds = arr(payload.stageIds);
  normalized.skillIds = arr(payload.skillIds);
  normalized.globalNotes = arr(payload.globalNotes, '\n');
  normalized.frameworkFeatures = arr(payload.frameworkFeatures);
  normalized.supportedBenchmarks = jsonObjectOrDefault(payload.supportedBenchmarks, {});
  normalized.sourceRefs = jsonArrayOrDefault(payload.sourceRefs, []);
  normalized.tags = arr(payload.tags);
  normalized.status = s(payload.status);
  normalized.reviewStatus = s(payload.reviewStatus);
  normalized.isActive = b(payload.isActive, true);
  normalized.isSystem = b(payload.isSystem, false);
  normalized.isLocked = b(payload.isLocked, false);
  normalized.notes = sn(payload.notes);
  normalized.orgId = s(payload.orgId) || 'SYSTEM';
  normalized.approvedBy = sn(payload.approvedBy);
  normalized.approvedAt = sn(payload.approvedAt);
  normalized.extensions = payload.extensions && typeof payload.extensions === 'object' ? payload.extensions : {};
  normalized.version = i(payload.version, 1);

  ['id', 'slug', 'code', 'title', 'edition', 'versionLabel', 'frameworkType', 'language', 'status', 'reviewStatus'].forEach((field) => {
    if (!s(normalized[field])) errors.push(`${field} is required.`);
  });
  if (!normalized.purpose.length) errors.push('purpose is required.');
  if (!normalized.notIntendedAs.length) errors.push('notIntendedAs is required.');
  if (!normalized.stageIds.length) errors.push('stageIds is required.');
  if (!normalized.skillIds.length) errors.push('skillIds is required.');
  if (!normalized.globalNotes.length) errors.push('globalNotes is required.');
  if (!normalized.frameworkFeatures.length) errors.push('frameworkFeatures is required.');

  ensureAllowed('frameworkType', normalized.frameworkType, FRAMEWORK_TYPES, errors);
  ensureAllowed('language', normalized.language, LANGUAGES, errors);
  ensureAllowed('status', normalized.status, RECORD_STATUSES, errors);
  ensureAllowed('reviewStatus', normalized.reviewStatus, REVIEW_STATUSES, errors);
  if (normalized.purpose.some((x) => !PURPOSE_OPTIONS.includes(x))) errors.push(`purpose values must be from: ${PURPOSE_OPTIONS.join(', ')}`);
  if (normalized.notIntendedAs.some((x) => !NOT_INTENDED_OPTIONS.includes(x))) errors.push(`notIntendedAs values must be from: ${NOT_INTENDED_OPTIONS.join(', ')}`);
  if (normalized.frameworkFeatures.some((x) => !FRAMEWORK_FEATURES.includes(x))) errors.push(`frameworkFeatures values must be from: ${FRAMEWORK_FEATURES.join(', ')}`);

  // uniqueness
  const allItems = Object.values(db.itemsById || {});
  const compareItems = allItems.filter((item) => s(item.id) !== s(currentId || ''));
  if (compareItems.some((item) => s(item.id) === normalized.id)) errors.push(`id already exists: ${normalized.id}`);
  if (compareItems.some((item) => s(item.slug).toLowerCase() === normalized.slug)) errors.push(`slug already exists: ${normalized.slug}`);
  if (compareItems.some((item) => s(item.code) === normalized.code)) errors.push(`code already exists: ${normalized.code}`);
  if (!normalized.id.startsWith('framework:')) errors.push("id must start with 'framework:'.");
  if (!/^[a-z0-9-]+$/.test(normalized.slug)) errors.push('slug must be URL-safe lowercase (a-z, 0-9, dash).');

  if (new Set(normalized.stageIds).size !== normalized.stageIds.length) {
    errors.push('stageIds must be unique.');
  } else {
    for (const stageId of normalized.stageIds) {
      const stage = await clbStageModel.getStageById(stageId);
      if (!stage) {
        errors.push(`stageIds contains unknown stage: ${stageId}`);
        continue;
      }
      if (s(stage.frameworkId) !== normalized.id) {
        errors.push(`stage ${stageId} does not belong to framework ${normalized.id}.`);
      }
    }
  }

  // skillIds unique
  if (new Set(normalized.skillIds).size !== normalized.skillIds.length) {
    errors.push('skillIds must be unique.');
  }

  // supportedBenchmarks validation
  normalized.supportedBenchmarks = {
    minimum: i(normalized.supportedBenchmarks?.minimum, null),
    maximum: i(normalized.supportedBenchmarks?.maximum, null),
    totalCount: i(normalized.supportedBenchmarks?.totalCount, null)
  };
  if (normalized.supportedBenchmarks.minimum == null || normalized.supportedBenchmarks.maximum == null || normalized.supportedBenchmarks.totalCount == null) {
    errors.push('supportedBenchmarks minimum/maximum/totalCount are required.');
  } else {
    if (normalized.supportedBenchmarks.minimum > normalized.supportedBenchmarks.maximum) {
      errors.push('supportedBenchmarks.minimum must be <= supportedBenchmarks.maximum');
    }
    const implied = (normalized.supportedBenchmarks.maximum - normalized.supportedBenchmarks.minimum) + 1;
    if (implied !== normalized.supportedBenchmarks.totalCount) {
      errors.push('supportedBenchmarks.totalCount must match implied range count.');
    }
  }

  // sourceRefs validation
  normalized.sourceRefs = Array.isArray(normalized.sourceRefs) ? normalized.sourceRefs : [];
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

  if (!Number.isInteger(normalized.version) || normalized.version < 1) {
    errors.push('version must be >= 1');
  }

  return { isValid: errors.length === 0, errors, normalized };
}

function toListItem(item) {
  return {
    ...item,
    id: s(item.id),
    slug: s(item.slug),
    code: s(item.code),
    title: s(item.title),
    frameworkType: s(item.frameworkType),
    language: s(item.language),
    status: s(item.status),
    reviewStatus: s(item.reviewStatus),
    orgId: s(item.orgId) || 'SYSTEM',
    isActive: Boolean(item.isActive),
    isSystem: Boolean(item.isSystem),
    isLocked: Boolean(item.isLocked),
    stageCount: Array.isArray(item.stageIds) ? item.stageIds.length : 0
  };
}

async function getAllFrameworks() {
  const db = await readDb();
  return (db.allIds || []).map((id) => db.itemsById[id]).filter(Boolean).map(toListItem);
}
async function getFrameworkById(id) {
  const db = await readDb();
  const row = db.itemsById[s(id)];
  return row ? { ...row } : null;
}
async function addFramework(input, actor = 'system') {
  return queueWrite(async () => {
    const db = await readDb();
    const check = await validateRecord(input, db, null);
    if (!check.isValid) throw new Error(check.errors.join('<br>'));
    const now = nowIso();
    const item = { ...check.normalized, createdBy: s(input.createdBy) || actor, updatedBy: s(input.updatedBy) || actor, createdAt: sn(input.createdAt) || now, updatedAt: now };
    db.itemsById[item.id] = item;
    db.allIds = [...(db.allIds || []), item.id];
    rebuildIndexes(db);
    await writeDb(db);
    return item;
  });
}
async function updateFramework(id, updates, actor = 'system') {
  return queueWrite(async () => {
    const db = await readDb();
    const existing = db.itemsById[s(id)];
    if (!existing) throw new Error('Framework not found.');
    const merged = { ...existing, ...updates, id: existing.id };
    const check = await validateRecord(merged, db, existing.id);
    if (!check.isValid) throw new Error(check.errors.join('<br>'));
    const now = nowIso();
    const updated = { ...existing, ...check.normalized, id: existing.id, createdBy: existing.createdBy || 'system', createdAt: existing.createdAt || now, updatedBy: s(updates.updatedBy) || actor, updatedAt: now, version: i(existing.version, 1) + 1 };
    db.itemsById[existing.id] = updated;
    if (!db.allIds.includes(existing.id)) db.allIds.push(existing.id);
    rebuildIndexes(db);
    await writeDb(db);
    return updated;
  });
}
async function deleteFramework(id) {
  return queueWrite(async () => {
    const db = await readDb();
    const key = s(id);
    if (!db.itemsById[key]) throw new Error('Framework not found.');
    delete db.itemsById[key];
    db.allIds = (db.allIds || []).filter((rowId) => rowId !== key);
    rebuildIndexes(db);
    await writeDb(db);
    return true;
  });
}

module.exports = {
  FRAMEWORK_TYPES,
  LANGUAGES,
  PURPOSE_OPTIONS,
  NOT_INTENDED_OPTIONS,
  FRAMEWORK_FEATURES,
  RECORD_STATUSES,
  REVIEW_STATUSES,
  getAllFrameworks,
  getFrameworkById,
  addFramework,
  updateFramework,
  deleteFramework
};
