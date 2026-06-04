const fs = require('fs').promises;
const path = require('path');
const { requireCoreModule, resolveCoreRoot } = require('../../services/benchpath/benchpathCoreModuleResolver');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const sourceModel = require('./sourceModel');
const sourceFragmentModel = require('./sourceFragmentModel');
const clbFrameworkModel = require('./clbFrameworkModel');
const clbStageModel = require('./clbStageModel');

const dataPath = path.join(resolveCoreRoot(), 'data/benchpath/reference/clb.skills.json');

const MODALITY_OPTIONS = ['receptive', 'productive'];
const RECORD_STATUSES = ['draft', 'reviewed', 'approved', 'archived', 'deleted'];
const REVIEW_STATUSES = ['pending', 'in_review', 'reviewed', 'rejected', 'not_required'];
const EVIDENCE_MODES = ['audio', 'video', 'text', 'live', 'selected_response', 'short_answer', 'long_answer', 'checklist', 'teacher_observation', 'upload'];
const ASSESSMENT_APPROACHES = ['criterion_referenced', 'holistic', 'analytic', 'mixed'];

function nowIso() { return new Date().toISOString(); }
function s(v) { return String(v == null ? '' : v).trim(); }
function sn(v) { const x = s(v); return x ? x : null; }
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
    meta: { schemaVersion: '1.0.0', entityType: 'clbSkills', layer: 'reference', authority: 'official', isReadMostly: true, defaultLocale: 'en-CA', generatedAt: ts, updatedAt: ts },
    itemsById: {},
    allIds: [],
    indexes: { byFrameworkId: {}, byModality: {}, byStatus: {}, byReviewStatus: {}, byCode: {}, byOrgId: {} }
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
  const idx = { byFrameworkId: {}, byModality: {}, byStatus: {}, byReviewStatus: {}, byCode: {}, byOrgId: {} };
  for (const id of db.allIds) {
    const item = db.itemsById[id];
    if (!item) continue;
    const mapIn = (bucket, key) => {
      const k = s(key);
      if (!k) return;
      if (!idx[bucket][k]) idx[bucket][k] = [];
      idx[bucket][k].push(id);
    };
    mapIn('byFrameworkId', item.frameworkId);
    mapIn('byModality', item.modality);
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
  normalized.code = s(payload.code).toUpperCase();
  normalized.title = s(payload.title);
  normalized.shortTitle = sn(payload.shortTitle);
  normalized.frameworkId = s(payload.frameworkId);
  normalized.frameworkCode = sn(payload.frameworkCode);
  normalized.modality = s(payload.modality);
  normalized.displayOrder = i(payload.displayOrder, 0);
  normalized.description = sn(payload.description);
  normalized.stageIds = arr(payload.stageIds);
  normalized.supportedBenchmarkRange = jsonObjectOrDefault(payload.supportedBenchmarkRange, {});
  normalized.benchmarkIds = arr(payload.benchmarkIds);
  normalized.competencyAreaIds = arr(payload.competencyAreaIds);
  normalized.assessmentCharacteristics = jsonObjectOrDefault(payload.assessmentCharacteristics, {});
  normalized.teachingCharacteristics = jsonObjectOrDefault(payload.teachingCharacteristics, {});
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

  ['id', 'slug', 'code', 'title', 'frameworkId', 'modality', 'status', 'reviewStatus'].forEach((field) => {
    if (!s(normalized[field])) errors.push(`${field} is required.`);
  });
  if (!normalized.stageIds.length) errors.push('stageIds is required.');
  if (!normalized.benchmarkIds.length) errors.push('benchmarkIds is required.');
  if (!normalized.competencyAreaIds.length) errors.push('competencyAreaIds is required.');

  ensureAllowed('modality', normalized.modality, MODALITY_OPTIONS, errors);
  ensureAllowed('status', normalized.status, RECORD_STATUSES, errors);
  ensureAllowed('reviewStatus', normalized.reviewStatus, REVIEW_STATUSES, errors);

  const allItems = Object.values(db.itemsById || {});
  const compareItems = allItems.filter((item) => s(item.id) !== s(currentId || ''));
  if (compareItems.some((item) => s(item.id) === normalized.id)) errors.push(`id already exists: ${normalized.id}`);
  if (compareItems.some((item) => s(item.slug).toLowerCase() === normalized.slug)) errors.push(`slug already exists: ${normalized.slug}`);
  if (compareItems.some((item) => s(item.code).toUpperCase() === normalized.code)) errors.push(`code already exists: ${normalized.code}`);
  if (!normalized.id.startsWith('skill:')) errors.push("id must start with 'skill:'.");
  if (!/^[a-z0-9-]+$/.test(normalized.slug)) errors.push('slug must be URL-safe lowercase (a-z, 0-9, dash).');
  if (normalized.displayOrder == null || normalized.displayOrder < 1) errors.push('displayOrder must be >= 1.');
  if (new Set(normalized.stageIds).size !== normalized.stageIds.length) errors.push('stageIds must be unique.');
  if (new Set(normalized.benchmarkIds).size !== normalized.benchmarkIds.length) errors.push('benchmarkIds must be unique.');
  if (new Set(normalized.competencyAreaIds).size !== normalized.competencyAreaIds.length) errors.push('competencyAreaIds must be unique.');

  const framework = await clbFrameworkModel.getFrameworkById(normalized.frameworkId);
  if (!framework) {
    errors.push(`frameworkId not found: ${normalized.frameworkId}`);
  } else {
    const frameworkStages = await clbStageModel.getStagesByFrameworkId(normalized.frameworkId);
    const stageSet = new Set((frameworkStages || []).map((stage) => s(stage.id)));
    if (normalized.stageIds.some((id) => !stageSet.has(id))) {
      errors.push('stageIds must exist in referenced framework.');
    }
  }

  normalized.supportedBenchmarkRange = {
    minimum: i(normalized.supportedBenchmarkRange?.minimum, null),
    maximum: i(normalized.supportedBenchmarkRange?.maximum, null),
    totalCount: i(normalized.supportedBenchmarkRange?.totalCount, null)
  };
  if (normalized.supportedBenchmarkRange.minimum == null || normalized.supportedBenchmarkRange.maximum == null || normalized.supportedBenchmarkRange.totalCount == null) {
    errors.push('supportedBenchmarkRange minimum/maximum/totalCount are required.');
  } else {
    if (normalized.supportedBenchmarkRange.minimum > normalized.supportedBenchmarkRange.maximum) {
      errors.push('supportedBenchmarkRange.minimum must be <= supportedBenchmarkRange.maximum');
    }
    const implied = (normalized.supportedBenchmarkRange.maximum - normalized.supportedBenchmarkRange.minimum) + 1;
    if (implied !== normalized.supportedBenchmarkRange.totalCount) {
      errors.push('supportedBenchmarkRange.totalCount must match implied range count.');
    }
  }

  const ac = normalized.assessmentCharacteristics || {};
  normalized.assessmentCharacteristics = {
    primaryEvidenceModes: arr(ac.primaryEvidenceModes),
    defaultAssessmentApproach: s(ac.defaultAssessmentApproach),
    supportsPortfolioEvidence: b(ac.supportsPortfolioEvidence, false),
    supportsDeterministicChecks: b(ac.supportsDeterministicChecks, false),
    supportsAiAssistance: b(ac.supportsAiAssistance, false)
  };
  if (!normalized.assessmentCharacteristics.primaryEvidenceModes.length) {
    errors.push('assessmentCharacteristics.primaryEvidenceModes is required.');
  } else if (normalized.assessmentCharacteristics.primaryEvidenceModes.some((x) => !EVIDENCE_MODES.includes(x))) {
    errors.push(`assessmentCharacteristics.primaryEvidenceModes values must be from: ${EVIDENCE_MODES.join(', ')}`);
  }
  ensureAllowed('assessmentCharacteristics.defaultAssessmentApproach', normalized.assessmentCharacteristics.defaultAssessmentApproach, ASSESSMENT_APPROACHES, errors);

  const tc = normalized.teachingCharacteristics || {};
  normalized.teachingCharacteristics = {
    taskBased: b(tc.taskBased, false),
    realWorldOriented: b(tc.realWorldOriented, false),
    oftenIntegratedWithOtherSkills: b(tc.oftenIntegratedWithOtherSkills, false),
    canUseVisualSupport: b(tc.canUseVisualSupport, false)
  };

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
    frameworkId: s(item.frameworkId),
    modality: s(item.modality),
    status: s(item.status),
    reviewStatus: s(item.reviewStatus),
    orgId: s(item.orgId) || 'SYSTEM',
    isActive: Boolean(item.isActive),
    isSystem: Boolean(item.isSystem),
    isLocked: Boolean(item.isLocked),
    benchmarkCount: Array.isArray(item.benchmarkIds) ? item.benchmarkIds.length : 0,
    competencyAreaCount: Array.isArray(item.competencyAreaIds) ? item.competencyAreaIds.length : 0
  };
}

async function getAllSkills() {
  const db = await readDb();
  return (db.allIds || []).map((id) => db.itemsById[id]).filter(Boolean).map(toListItem);
}
async function getSkillById(id) {
  const db = await readDb();
  const row = db.itemsById[s(id)];
  return row ? { ...row } : null;
}
async function addSkill(input, actor = 'system') {
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
async function updateSkill(id, updates, actor = 'system') {
  return queueWrite(async () => {
    const db = await readDb();
    const existing = db.itemsById[s(id)];
    if (!existing) throw new Error('Skill not found.');
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
async function deleteSkill(id) {
  return queueWrite(async () => {
    const db = await readDb();
    const key = s(id);
    if (!db.itemsById[key]) throw new Error('Skill not found.');
    delete db.itemsById[key];
    db.allIds = (db.allIds || []).filter((rowId) => rowId !== key);
    rebuildIndexes(db);
    await writeDb(db);
    return true;
  });
}

module.exports = {
  MODALITY_OPTIONS,
  RECORD_STATUSES,
  REVIEW_STATUSES,
  EVIDENCE_MODES,
  ASSESSMENT_APPROACHES,
  getAllSkills,
  getSkillById,
  addSkill,
  updateSkill,
  deleteSkill
};
