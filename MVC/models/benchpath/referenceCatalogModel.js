const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('../fileQueue');
const sourceModel = require('./sourceModel');
const sourceFragmentModel = require('./sourceFragmentModel');

const REFERENCE_DIR = path.join(__dirname, '../../../data/benchpath/reference');

const ENTITY_DEFS = {
  competencyAreas: {
    key: 'competencyAreas',
    fileName: 'clb.competency-areas.json',
    entityType: 'clbCompetencyAreas',
    title: 'CLB Competency Areas',
    routeBase: 'clb-competency-areas'
  },
  benchmarks: {
    key: 'benchmarks',
    fileName: 'clb.benchmarks.json',
    entityType: 'clbBenchmarks',
    title: 'CLB Benchmarks',
    routeBase: 'clb-benchmarks'
  },
  competencies: {
    key: 'competencies',
    fileName: 'clb.competencies.json',
    entityType: 'clbCompetencies',
    title: 'CLB Competencies',
    routeBase: 'clb-competencies'
  },
  indicators: {
    key: 'indicators',
    fileName: 'clb.indicators.json',
    entityType: 'clbIndicators',
    title: 'CLB Indicators',
    routeBase: 'clb-indicators'
  },
  profileOfAbility: {
    key: 'profileOfAbility',
    fileName: 'clb.profile-of-ability.json',
    entityType: 'clbProfileOfAbility',
    title: 'CLB Profile Of Ability',
    routeBase: 'clb-profile-of-ability'
  },
  featuresOfCommunication: {
    key: 'featuresOfCommunication',
    fileName: 'clb.features-of-communication.json',
    entityType: 'clbFeaturesOfCommunication',
    title: 'CLB Features Of Communication',
    routeBase: 'clb-features-of-communication'
  },
  sampleTaskLabels: {
    key: 'sampleTaskLabels',
    fileName: 'clb.sample-task-labels.json',
    entityType: 'clbSampleTaskLabels',
    title: 'CLB Sample Task Labels',
    routeBase: 'clb-sample-task-labels'
  }
};

const STATUSES = ['draft', 'reviewed', 'approved', 'archived', 'deleted'];
const REVIEW_STATUSES = ['pending', 'in_review', 'reviewed', 'rejected', 'not_required'];
const FEATURE_SCOPE_TYPES = ['benchmark', 'competency', 'skill', 'global'];

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
function ensureAllowed(field, value, allowed, errors, required = true) {
  const x = s(value);
  if (!x) {
    if (required) errors.push(`${field} is required.`);
    return;
  }
  if (!allowed.includes(x)) errors.push(`${field} must be one of: ${allowed.join(', ')}`);
}

function normalizeSemanticFields(entityKey, payload, normalized, errors) {
  if (entityKey === 'competencyAreas') {
    normalized.areaFamilyCode = sn(payload.areaFamilyCode);
    normalized.communicativeContexts = arr(payload.communicativeContexts);
    normalized.progressionNotes = sn(payload.progressionNotes);
  }

  if (entityKey === 'benchmarks') {
    normalized.benchmarkNumber = i(payload.benchmarkNumber, null);
    normalized.stageBandLabel = sn(payload.stageBandLabel);
    normalized.summaryStatement = sn(payload.summaryStatement);
    normalized.profileOfAbilityId = sn(payload.profileOfAbilityId);
    normalized.competencyIds = arr(payload.competencyIds);
    normalized.featureIds = arr(payload.featureIds);
    normalized.sampleTaskLabelIds = arr(payload.sampleTaskLabelIds);

    if (normalized.benchmarkNumber != null && (normalized.benchmarkNumber < 1 || normalized.benchmarkNumber > 12)) {
      errors.push('benchmarkNumber must be between 1 and 12.');
    }
  }

  if (entityKey === 'competencies') {
    normalized.competencyStatement = sn(payload.competencyStatement);
    normalized.communicativePurpose = sn(payload.communicativePurpose);
    normalized.indicatorIds = arr(payload.indicatorIds);
    normalized.featureIds = arr(payload.featureIds);
    normalized.sampleTaskLabelIds = arr(payload.sampleTaskLabelIds);
  }

  if (entityKey === 'indicators') {
    normalized.indicatorText = sn(payload.indicatorText);
    normalized.indicatorCategory = sn(payload.indicatorCategory);
    normalized.indicatorDimension = sn(payload.indicatorDimension);
    normalized.evidenceType = sn(payload.evidenceType);
  }

  if (entityKey === 'profileOfAbility') {
    normalized.descriptorSummary = sn(payload.descriptorSummary);
    normalized.descriptorDimensions = arr(payload.descriptorDimensions);
    normalized.featureIds = arr(payload.featureIds);
  }

  if (entityKey === 'featuresOfCommunication') {
    normalized.scopeType = sn(payload.scopeType);
    normalized.scopeSkillId = sn(payload.scopeSkillId);
    normalized.scopeBenchmarkId = sn(payload.scopeBenchmarkId);
    normalized.scopeCompetencyId = sn(payload.scopeCompetencyId);
    normalized.featureDimension = sn(payload.featureDimension);
    normalized.featureValue = sn(payload.featureValue);
    normalized.complexityLevel = sn(payload.complexityLevel);

    if (normalized.scopeType) {
      ensureAllowed('scopeType', normalized.scopeType, FEATURE_SCOPE_TYPES, errors);
    }
  }

  if (entityKey === 'sampleTaskLabels') {
    normalized.taskLabelText = sn(payload.taskLabelText);
    normalized.contextDomain = sn(payload.contextDomain);
    normalized.taskType = sn(payload.taskType);
    normalized.officialSample = b(payload.officialSample, false);
    normalized.linkedBenchmarkId = sn(payload.linkedBenchmarkId);
    normalized.linkedCompetencyId = sn(payload.linkedCompetencyId);
  }
}
function getDef(entityKey) {
  const def = ENTITY_DEFS[entityKey];
  if (!def) throw new Error(`Unknown reference entity: ${entityKey}`);
  return def;
}
function filePath(entityKey) {
  const def = getDef(entityKey);
  return path.join(REFERENCE_DIR, def.fileName);
}
async function ensureDir() {
  try { await fs.access(REFERENCE_DIR); } catch (_) { await fs.mkdir(REFERENCE_DIR, { recursive: true }); }
}
function emptyDb(def) {
  const ts = nowIso();
  return {
    meta: {
      schemaVersion: '1.0.0',
      entityType: def.entityType,
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
      byStatus: {},
      byReviewStatus: {},
      byFrameworkId: {},
      bySkillId: {},
      byBenchmarkId: {},
      byOrgId: {}
    }
  };
}
async function readDb(entityKey) {
  await ensureDir();
  const def = getDef(entityKey);
  const p = filePath(entityKey);
  try {
    const raw = await fs.readFile(p, 'utf8');
    const parsed = JSON.parse(String(raw || '').replace(/^\uFEFF/, ''));
    if (!parsed || typeof parsed !== 'object') return emptyDb(def);
    if (!parsed.meta || typeof parsed.meta !== 'object') parsed.meta = emptyDb(def).meta;
    if (!parsed.itemsById || typeof parsed.itemsById !== 'object') parsed.itemsById = {};
    if (!Array.isArray(parsed.allIds)) parsed.allIds = Object.keys(parsed.itemsById);
    if (!parsed.indexes || typeof parsed.indexes !== 'object') parsed.indexes = {};
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') {
      const db = emptyDb(def);
      await fs.writeFile(p, JSON.stringify(db, null, 2), 'utf8');
      return db;
    }
    throw error;
  }
}
async function writeDb(entityKey, db) {
  const p = filePath(entityKey);
  const payload = { ...db, meta: { ...(db.meta || {}), updatedAt: nowIso() } };
  await fs.writeFile(p, JSON.stringify(payload, null, 2), 'utf8');
}
function rebuildIndexes(db) {
  const idx = {
    byStatus: {},
    byReviewStatus: {},
    byFrameworkId: {},
    bySkillId: {},
    byBenchmarkId: {},
    byOrgId: {}
  };
  for (const id of db.allIds || []) {
    const item = db.itemsById[id];
    if (!item) continue;
    const mapIn = (bucket, key) => {
      const k = s(key);
      if (!k) return;
      if (!idx[bucket][k]) idx[bucket][k] = [];
      idx[bucket][k].push(id);
    };
    mapIn('byStatus', item.status);
    mapIn('byReviewStatus', item.reviewStatus);
    mapIn('byFrameworkId', item.frameworkId);
    mapIn('bySkillId', item.skillId);
    mapIn('byBenchmarkId', item.benchmarkId);
    mapIn('byOrgId', item.orgId || 'SYSTEM');
  }
  db.indexes = idx;
  return db;
}

async function validateRecord(entityKey, payload, db, currentId = null) {
  const errors = [];
  const normalized = { ...payload };

  normalized.id = s(payload.id);
  normalized.slug = s(payload.slug).toLowerCase();
  normalized.code = sn(payload.code);
  normalized.title = s(payload.title);
  normalized.shortTitle = sn(payload.shortTitle);
  normalized.frameworkId = sn(payload.frameworkId);
  normalized.skillId = sn(payload.skillId);
  normalized.stageId = sn(payload.stageId);
  normalized.benchmarkId = sn(payload.benchmarkId);
  normalized.competencyAreaId = sn(payload.competencyAreaId);
  normalized.competencyId = sn(payload.competencyId);
  normalized.description = sn(payload.description);
  normalized.domainNotes = sn(payload.domainNotes);
  normalized.relatedIds = arr(payload.relatedIds);
  normalized.tags = arr(payload.tags);
  normalized.sourceRefs = jsonArrayOrDefault(payload.sourceRefs, []);
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
  normalizeSemanticFields(entityKey, payload, normalized, errors);

  ['id', 'slug', 'title', 'status', 'reviewStatus'].forEach((field) => {
    if (!s(normalized[field])) errors.push(`${field} is required.`);
  });
  if (!normalized.id.includes(':')) errors.push('id must use stable namespaced format (for example: type:scope:key).');
  if (!/^[a-z0-9-]+$/.test(normalized.slug)) errors.push('slug must be URL-safe lowercase (a-z, 0-9, dash).');

  ensureAllowed('status', normalized.status, STATUSES, errors);
  ensureAllowed('reviewStatus', normalized.reviewStatus, REVIEW_STATUSES, errors);

  const allItems = Object.values(db.itemsById || {});
  const compareItems = allItems.filter((item) => s(item.id) !== s(currentId || ''));
  if (compareItems.some((item) => s(item.id) === normalized.id)) errors.push(`id already exists: ${normalized.id}`);
  if (compareItems.some((item) => s(item.slug).toLowerCase() === normalized.slug)) errors.push(`slug already exists: ${normalized.slug}`);
  if (normalized.code && compareItems.some((item) => s(item.code) === normalized.code)) errors.push(`code already exists: ${normalized.code}`);

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

  normalized.entityKey = entityKey;
  return { isValid: errors.length === 0, errors, normalized };
}

function toListItem(item) {
  return {
    ...item,
    id: s(item.id),
    slug: s(item.slug),
    title: s(item.title),
    code: sn(item.code),
    frameworkId: sn(item.frameworkId),
    skillId: sn(item.skillId),
    benchmarkId: sn(item.benchmarkId),
    orgId: s(item.orgId) || 'SYSTEM',
    status: s(item.status),
    reviewStatus: s(item.reviewStatus),
    isActive: Boolean(item.isActive),
    isSystem: Boolean(item.isSystem),
    isLocked: Boolean(item.isLocked)
  };
}

async function getAll(entityKey) {
  const db = await readDb(entityKey);
  return (db.allIds || []).map((id) => db.itemsById[id]).filter(Boolean).map(toListItem);
}
async function getById(entityKey, id) {
  const db = await readDb(entityKey);
  const row = db.itemsById[s(id)];
  return row ? { ...row } : null;
}
async function add(entityKey, input, actor = 'system') {
  return queueWrite(async () => {
    const db = await readDb(entityKey);
    const check = await validateRecord(entityKey, input, db, null);
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
    await writeDb(entityKey, db);
    return item;
  });
}
async function update(entityKey, id, updates, actor = 'system') {
  return queueWrite(async () => {
    const db = await readDb(entityKey);
    const existing = db.itemsById[s(id)];
    if (!existing) throw new Error('Record not found.');
    const merged = { ...existing, ...updates, id: existing.id };
    const check = await validateRecord(entityKey, merged, db, existing.id);
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
    await writeDb(entityKey, db);
    return updated;
  });
}
async function remove(entityKey, id) {
  return queueWrite(async () => {
    const db = await readDb(entityKey);
    const key = s(id);
    if (!db.itemsById[key]) throw new Error('Record not found.');
    delete db.itemsById[key];
    db.allIds = (db.allIds || []).filter((rowId) => rowId !== key);
    rebuildIndexes(db);
    await writeDb(entityKey, db);
    return true;
  });
}

module.exports = {
  ENTITY_DEFS,
  STATUSES,
  REVIEW_STATUSES,
  getDef,
  getAll,
  getById,
  add,
  update,
  remove
};
