const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('../fileQueue');

const sourceModel = require('./sourceModel');

const dataPath = path.join(__dirname, '../../../data/benchpath/reference/source-fragments.json');

const FRAGMENT_TYPES = [
  'section_excerpt',
  'page_excerpt',
  'paragraph_excerpt',
  'table_excerpt',
  'heading_excerpt',
  'note_excerpt',
  'quote_excerpt',
  'rubric_excerpt',
  'criteria_excerpt',
  'feedback_excerpt',
  'sample_task_excerpt',
  'profile_excerpt',
  'feature_excerpt',
  'competency_excerpt',
  'indicator_excerpt',
  'validation_note',
  'mapping_note',
  'other'
];

const LANGUAGES = ['en', 'fr', 'bilingual', 'other'];
const USAGE_TAGS = [
  'reference_extraction',
  'citation',
  'audit',
  'task_design',
  'rubric_design',
  'wizard_support',
  'validation_rules',
  'training_examples',
  'internal_review',
  'display_only'
];
const REVIEW_STATUSES = ['pending', 'in_review', 'reviewed', 'rejected', 'not_required'];
const STATUSES = ['draft', 'reviewed', 'approved', 'archived', 'deleted'];
const SEMANTIC_ROLES = [
  'definition',
  'descriptor',
  'example',
  'sample_task',
  'indicator',
  'criterion_seed',
  'profile_seed',
  'feature_seed',
  'feedback_rule',
  'validation_rule',
  'explanation',
  'note',
  'other'
];
const EXTRACTION_METHODS = ['manual_seed', 'manual_reviewed', 'ocr', 'parser', 'llm_extraction', 'migrated', 'other'];

const MAPPED_ENTITY_TYPES = [
  'framework',
  'skill',
  'competencyArea',
  'benchmark',
  'competency',
  'indicator',
  'profileOfAbility',
  'featureOfCommunication',
  'sampleTaskLabel',
  'source',
  'other'
];

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeNullableString(value) {
  const v = normalizeString(value);
  return v === '' ? null : v;
}

function normalizeStringArray(value, splitBy = ',') {
  if (Array.isArray(value)) return value.map((v) => normalizeString(v)).filter(Boolean);
  const raw = normalizeString(value);
  if (!raw) return [];
  return raw.split(splitBy).map((v) => v.trim()).filter(Boolean);
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const raw = normalizeString(value).toLowerCase();
  if (!raw) return fallback;
  if (['true', '1', 'yes', 'y', 'on'].includes(raw)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(raw)) return false;
  return fallback;
}

function parseInteger(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseFloatNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function ensureAllowed(field, value, allowed, errors, required = true) {
  const v = normalizeString(value);
  if (!v) {
    if (required) errors.push(`${field} is required.`);
    return;
  }
  if (!allowed.includes(v)) errors.push(`${field} must be one of: ${allowed.join(', ')}`);
}

async function ensureDataDir() {
  const dir = path.dirname(dataPath);
  try {
    await fs.access(dir);
  } catch (_) {
    await fs.mkdir(dir, { recursive: true });
  }
}

function buildEmptyDb() {
  const ts = nowIso();
  return {
    meta: {
      schemaVersion: '1.0.0',
      entityType: 'sourceFragments',
      layer: 'reference',
      authority: 'mixed',
      isReadMostly: true,
      defaultLocale: 'en-CA',
      generatedAt: ts,
      updatedAt: ts
    },
    itemsById: {},
    allIds: [],
    indexes: {
      bySourceId: {},
      byFragmentType: {},
      byMappedEntityType: {},
      bySemanticRole: {},
      byStatus: {},
      byReviewStatus: {},
      byLanguage: {},
      byOrgId: {},
      byBenchmarkId: {},
      bySkillId: {}
    }
  };
}

async function readDb() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(dataPath, 'utf8');
    const clean = String(raw || '').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(clean);
    if (!parsed || typeof parsed !== 'object') return buildEmptyDb();
    if (!parsed.itemsById || typeof parsed.itemsById !== 'object') parsed.itemsById = {};
    if (!Array.isArray(parsed.allIds)) parsed.allIds = Object.keys(parsed.itemsById);
    if (!parsed.indexes || typeof parsed.indexes !== 'object') parsed.indexes = {};
    if (!parsed.meta || typeof parsed.meta !== 'object') parsed.meta = buildEmptyDb().meta;
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return buildEmptyDb();
    throw error;
  }
}

async function writeDb(db) {
  const payload = {
    ...db,
    meta: {
      ...(db.meta || {}),
      updatedAt: nowIso()
    }
  };
  await fs.writeFile(dataPath, JSON.stringify(payload, null, 2), 'utf8');
}

function rebuildIndexes(db) {
  const indexes = {
    bySourceId: {},
    byFragmentType: {},
    byMappedEntityType: {},
    bySemanticRole: {},
    byStatus: {},
    byReviewStatus: {},
    byLanguage: {},
    byOrgId: {},
    byBenchmarkId: {},
    bySkillId: {}
  };

  for (const id of db.allIds) {
    const item = db.itemsById[id];
    if (!item) continue;
    const mapIn = (key, value) => {
      const v = normalizeString(value);
      if (!v) return;
      if (!indexes[key][v]) indexes[key][v] = [];
      indexes[key][v].push(id);
    };
    mapIn('bySourceId', item.sourceId);
    mapIn('byFragmentType', item.fragmentType);
    mapIn('byMappedEntityType', item.mappedEntityType);
    mapIn('bySemanticRole', item.semanticRole);
    mapIn('byStatus', item.status);
    mapIn('byReviewStatus', item.reviewStatus);
    mapIn('byLanguage', item.language);
    mapIn('byOrgId', item.orgId || 'SYSTEM');
    for (const mappedId of normalizeStringArray(item.mappedEntityIds)) {
      if (mappedId.startsWith('benchmark:')) mapIn('byBenchmarkId', mappedId);
      if (mappedId.startsWith('skill:')) mapIn('bySkillId', mappedId);
    }
  }
  db.indexes = indexes;
  return db;
}

async function validateSourceIdExists(sourceId, errors) {
  const id = normalizeString(sourceId);
  if (!id) {
    errors.push('sourceId is required.');
    return;
  }
  const src = await sourceModel.getSourceById(id);
  if (!src) errors.push(`sourceId does not exist in sources: ${id}`);
}

async function validateInput(payload, db, currentId = null) {
  const errors = [];
  const normalized = { ...payload };

  normalized.id = normalizeString(payload.id);
  normalized.slug = normalizeString(payload.slug).toLowerCase();
  normalized.code = normalizeNullableString(payload.code);
  normalized.sourceId = normalizeString(payload.sourceId);
  normalized.sourceType = normalizeNullableString(payload.sourceType);
  normalized.authorityLevel = normalizeNullableString(payload.authorityLevel);
  normalized.framework = normalizeNullableString(payload.framework);
  normalized.title = normalizeString(payload.title);
  normalized.shortTitle = normalizeNullableString(payload.shortTitle);
  normalized.fragmentType = normalizeString(payload.fragmentType);
  normalized.sectionPath = normalizeStringArray(payload.sectionPath, '>');
  normalized.pageStart = parseInteger(payload.pageStart, null);
  normalized.pageEnd = parseInteger(payload.pageEnd, null);
  normalized.paragraphStart = parseInteger(payload.paragraphStart, null);
  normalized.paragraphEnd = parseInteger(payload.paragraphEnd, null);
  normalized.lineStart = parseInteger(payload.lineStart, null);
  normalized.lineEnd = parseInteger(payload.lineEnd, null);
  normalized.text = normalizeString(payload.text);
  normalized.normalizedText = normalizeNullableString(payload.normalizedText);
  normalized.summary = normalizeNullableString(payload.summary);
  normalized.excerptLabel = normalizeNullableString(payload.excerptLabel);
  normalized.language = normalizeString(payload.language);
  normalized.contextTags = normalizeStringArray(payload.contextTags);
  normalized.usageTags = normalizeStringArray(payload.usageTags);
  normalized.mappedEntityType = normalizeNullableString(payload.mappedEntityType);
  normalized.mappedEntityIds = normalizeStringArray(payload.mappedEntityIds);
  normalized.semanticRole = normalizeString(payload.semanticRole);
  normalized.isDirectQuote = parseBoolean(payload.isDirectQuote, false);
  normalized.quoteConfidence = parseFloatNumber(payload.quoteConfidence, null);
  normalized.extractionMethod = normalizeString(payload.extractionMethod);
  normalized.reviewStatus = normalizeString(payload.reviewStatus);
  normalized.status = normalizeString(payload.status);
  normalized.isActive = parseBoolean(payload.isActive, true);
  normalized.isSystem = parseBoolean(payload.isSystem, false);
  normalized.isLocked = parseBoolean(payload.isLocked, false);
  normalized.validationNotes = normalizeNullableString(payload.validationNotes);
  normalized.notes = normalizeNullableString(payload.notes);
  normalized.orgId = normalizeString(payload.orgId) || 'SYSTEM';
  normalized.tags = normalizeStringArray(payload.tags);
  normalized.approvedBy = normalizeNullableString(payload.approvedBy);
  normalized.approvedAt = normalizeNullableString(payload.approvedAt);
  normalized.extensions = payload.extensions && typeof payload.extensions === 'object' ? payload.extensions : {
    embeddingText: null,
    reviewChecklist: [],
    uiColor: null
  };

  if (!normalized.id) errors.push('id is required.');
  if (!normalized.slug) errors.push('slug is required.');
  if (!normalized.title) errors.push('title is required.');
  if (!normalized.fragmentType) errors.push('fragmentType is required.');
  if (!normalized.text) errors.push('text is required.');
  if (!normalized.language) errors.push('language is required.');
  if (!normalized.usageTags.length) errors.push('usageTags is required.');
  if (!normalized.mappedEntityIds.length) errors.push('mappedEntityIds is required.');
  if (!normalized.semanticRole) errors.push('semanticRole is required.');
  if (!normalized.extractionMethod) errors.push('extractionMethod is required.');
  if (!normalized.reviewStatus) errors.push('reviewStatus is required.');
  if (!normalized.status) errors.push('status is required.');

  await validateSourceIdExists(normalized.sourceId, errors);

  ensureAllowed('fragmentType', normalized.fragmentType, FRAGMENT_TYPES, errors);
  ensureAllowed('language', normalized.language, LANGUAGES, errors);
  ensureAllowed('reviewStatus', normalized.reviewStatus, REVIEW_STATUSES, errors);
  ensureAllowed('status', normalized.status, STATUSES, errors);
  ensureAllowed('semanticRole', normalized.semanticRole, SEMANTIC_ROLES, errors);
  ensureAllowed('extractionMethod', normalized.extractionMethod, EXTRACTION_METHODS, errors);
  if (normalized.mappedEntityType) ensureAllowed('mappedEntityType', normalized.mappedEntityType, MAPPED_ENTITY_TYPES, errors, false);

  if (normalized.usageTags.some((tag) => !USAGE_TAGS.includes(tag))) {
    errors.push(`usageTags values must be from: ${USAGE_TAGS.join(', ')}`);
  }
  if (normalized.quoteConfidence != null && (normalized.quoteConfidence < 0 || normalized.quoteConfidence > 1)) {
    errors.push('quoteConfidence must be between 0 and 1.');
  }
  if (normalized.pageStart != null && normalized.pageStart < 1) errors.push('pageStart must be >= 1.');
  if (normalized.pageEnd != null && normalized.pageEnd < 1) errors.push('pageEnd must be >= 1.');
  if (normalized.pageStart != null && normalized.pageEnd != null && normalized.pageEnd < normalized.pageStart) {
    errors.push('pageEnd must be >= pageStart.');
  }

  const allItems = Object.values(db.itemsById || {});
  const compareItems = allItems.filter((item) => normalizeString(item.id) !== normalizeString(currentId || ''));
  if (compareItems.some((item) => normalizeString(item.id) === normalized.id)) errors.push(`id already exists: ${normalized.id}`);
  if (compareItems.some((item) => normalizeString(item.slug).toLowerCase() === normalized.slug)) errors.push(`slug already exists: ${normalized.slug}`);
  if (normalized.code && compareItems.some((item) => normalizeString(item.code) === normalized.code)) errors.push(`code already exists: ${normalized.code}`);
  if (!normalized.id.startsWith('fragment:')) errors.push("id must start with 'fragment:'.");
  if (!/^[a-z0-9-]+$/.test(normalized.slug)) errors.push('slug must be URL-safe lowercase (a-z, 0-9, dash).');

  return { isValid: errors.length === 0, errors, normalized };
}

function toListItem(item) {
  return {
    ...item,
    id: normalizeString(item.id),
    slug: normalizeString(item.slug),
    sourceId: normalizeString(item.sourceId),
    title: normalizeString(item.title),
    fragmentType: normalizeString(item.fragmentType),
    semanticRole: normalizeString(item.semanticRole),
    language: normalizeString(item.language),
    orgId: normalizeString(item.orgId) || 'SYSTEM',
    status: normalizeString(item.status),
    reviewStatus: normalizeString(item.reviewStatus),
    isActive: Boolean(item.isActive),
    isSystem: Boolean(item.isSystem),
    isLocked: Boolean(item.isLocked)
  };
}

async function getAllFragments() {
  const db = await readDb();
  return (db.allIds || []).map((id) => db.itemsById[id]).filter(Boolean).map(toListItem);
}

async function getFragmentById(id) {
  const db = await readDb();
  const row = db.itemsById[normalizeString(id)];
  return row ? { ...row } : null;
}

async function addFragment(input, actor = 'system') {
  return queueWrite(async () => {
    const db = await readDb();
    const check = await validateInput(input, db, null);
    if (!check.isValid) throw new Error(check.errors.join('<br>'));

    const now = nowIso();
    const item = {
      ...check.normalized,
      createdBy: normalizeString(input.createdBy) || actor,
      updatedBy: normalizeString(input.updatedBy) || actor,
      createdAt: normalizeNullableString(input.createdAt) || now,
      updatedAt: now,
      version: 1
    };
    db.itemsById[item.id] = item;
    db.allIds = [...(db.allIds || []), item.id];
    rebuildIndexes(db);
    await writeDb(db);
    return item;
  });
}

async function updateFragment(id, updates, actor = 'system') {
  return queueWrite(async () => {
    const db = await readDb();
    const existing = db.itemsById[normalizeString(id)];
    if (!existing) throw new Error('Source fragment not found.');

    const merged = { ...existing, ...updates, id: existing.id };
    const check = await validateInput(merged, db, existing.id);
    if (!check.isValid) throw new Error(check.errors.join('<br>'));

    const now = nowIso();
    const updated = {
      ...existing,
      ...check.normalized,
      id: existing.id,
      createdBy: existing.createdBy || 'system',
      createdAt: existing.createdAt || now,
      updatedBy: normalizeString(updates.updatedBy) || actor,
      updatedAt: now,
      version: parseInteger(existing.version, 1) + 1
    };

    db.itemsById[existing.id] = updated;
    if (!db.allIds.includes(existing.id)) db.allIds.push(existing.id);
    rebuildIndexes(db);
    await writeDb(db);
    return updated;
  });
}

async function deleteFragment(id) {
  return queueWrite(async () => {
    const db = await readDb();
    const key = normalizeString(id);
    if (!db.itemsById[key]) throw new Error('Source fragment not found.');
    delete db.itemsById[key];
    db.allIds = (db.allIds || []).filter((rowId) => rowId !== key);
    rebuildIndexes(db);
    await writeDb(db);
    return true;
  });
}

module.exports = {
  FRAGMENT_TYPES,
  LANGUAGES,
  USAGE_TAGS,
  REVIEW_STATUSES,
  STATUSES,
  SEMANTIC_ROLES,
  EXTRACTION_METHODS,
  MAPPED_ENTITY_TYPES,
  getAllFragments,
  getFragmentById,
  addFragment,
  updateFragment,
  deleteFragment
};
