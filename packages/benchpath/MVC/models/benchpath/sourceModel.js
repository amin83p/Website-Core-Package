const fs = require('fs').promises;
const path = require('path');
const { requireCoreModule, resolveCoreRoot } = require('../../services/benchpath/benchpathCoreModuleResolver');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');

const dataPath = path.join(resolveCoreRoot(), 'data/benchpath/reference/source.json');

const SOURCE_TYPES = [
  'official_standard',
  'official_support_document',
  'implementation_guide',
  'portfolio_exemplar',
  'rating_scale',
  'rubric_sample',
  'assignment_handout',
  'facilitator_feedback',
  'student_submission',
  'teacher_resource',
  'research_article',
  'policy_document',
  'website',
  'other'
];

const AUTHORITY_LEVELS = ['official', 'derived', 'instructional', 'annotated', 'user_uploaded', 'internal'];
const LANGUAGES = ['en', 'fr', 'bilingual', 'other'];
const USAGE_RIGHTS = ['internal_reference_only', 'internal_editable', 'public_linked', 'restricted', 'unknown'];
const USABLE_FOR = [
  'reference_extraction',
  'citation',
  'audit',
  'training_examples',
  'validation_rules',
  'task_design',
  'rubric_design',
  'wizard_suggestions',
  'internal_review',
  'display_only'
];
const STATUSES = ['draft', 'reviewed', 'approved', 'archived', 'deleted'];
const REVIEW_STATUSES = ['pending', 'in_review', 'reviewed', 'rejected', 'not_required'];
const EXTRACTION_STATUSES = ['not_started', 'queued', 'processing', 'completed', 'failed', 'partially_completed', 'not_applicable'];
const FILE_EXTENSIONS = ['pdf', 'docx', 'doc', 'txt', 'html', 'json', 'md', 'other'];

const REQUIRED_CREATE_FIELDS = [
  'id',
  'slug',
  'title',
  'sourceType',
  'authorityLevel',
  'language',
  'usageRights',
  'usableFor',
  'status',
  'reviewStatus',
  'extractionStatus'
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

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeString(item)).filter(Boolean);
  }
  const raw = normalizeString(value);
  if (!raw) return [];
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
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
  const timestamp = nowIso();
  return {
    meta: {
      schemaVersion: '1.0.0',
      entityType: 'sources',
      layer: 'reference',
      authority: 'mixed',
      isReadMostly: true,
      defaultLocale: 'en-CA',
      generatedAt: timestamp,
      updatedAt: timestamp
    },
    itemsById: {},
    allIds: [],
    indexes: {
      bySourceType: {},
      byAuthorityLevel: {},
      byLanguage: {},
      byStatus: {},
      byReviewStatus: {},
      byOrgId: {}
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
    bySourceType: {},
    byAuthorityLevel: {},
    byLanguage: {},
    byStatus: {},
    byReviewStatus: {},
    byOrgId: {}
  };

  for (const id of db.allIds) {
    const item = db.itemsById[id];
    if (!item) continue;

    const mapIn = (mapName, key) => {
      if (!key) return;
      if (!indexes[mapName][key]) indexes[mapName][key] = [];
      indexes[mapName][key].push(id);
    };

    mapIn('bySourceType', normalizeString(item.sourceType));
    mapIn('byAuthorityLevel', normalizeString(item.authorityLevel));
    mapIn('byLanguage', normalizeString(item.language));
    mapIn('byStatus', normalizeString(item.status));
    mapIn('byReviewStatus', normalizeString(item.reviewStatus));
    mapIn('byOrgId', normalizeString(item.orgId) || 'SYSTEM');
  }

  db.indexes = indexes;
  return db;
}

function validateSourceInput(payload, existingDb, currentId = null) {
  const errors = [];
  const normalized = { ...payload };

  REQUIRED_CREATE_FIELDS.forEach((field) => {
    if (field === 'usableFor') {
      const arr = normalizeStringArray(payload.usableFor);
      if (!arr.length) errors.push('usableFor is required.');
      normalized.usableFor = arr;
      return;
    }
    if (!normalizeString(payload[field])) errors.push(`${field} is required.`);
  });

  normalized.id = normalizeString(payload.id);
  normalized.slug = normalizeString(payload.slug).toLowerCase();
  normalized.code = normalizeNullableString(payload.code);
  normalized.title = normalizeString(payload.title);
  normalized.shortTitle = normalizeNullableString(payload.shortTitle);
  normalized.sourceType = normalizeString(payload.sourceType);
  normalized.authorityLevel = normalizeString(payload.authorityLevel);
  normalized.framework = normalizeNullableString(payload.framework);
  normalized.publisher = normalizeNullableString(payload.publisher);
  normalized.authors = normalizeStringArray(payload.authors);
  normalized.edition = normalizeNullableString(payload.edition);
  normalized.year = parseInteger(payload.year, null);
  normalized.language = normalizeString(payload.language);
  normalized.country = normalizeNullableString(payload.country);
  normalized.fileName = normalizeNullableString(payload.fileName);
  normalized.originalFileName = normalizeNullableString(payload.originalFileName);
  normalized.storagePath = normalizeNullableString(payload.storagePath);
  normalized.mimeType = normalizeNullableString(payload.mimeType);
  normalized.fileExtension = normalizeNullableString(payload.fileExtension);
  normalized.fileSizeBytes = Math.max(0, parseInteger(payload.fileSizeBytes, 0) || 0);
  normalized.pageCount = parseInteger(payload.pageCount, null);
  if (normalized.pageCount != null && normalized.pageCount < 1) errors.push('pageCount must be >= 1 when provided.');
  normalized.url = normalizeNullableString(payload.url);
  normalized.isbn = normalizeNullableString(payload.isbn);
  normalized.tags = normalizeStringArray(payload.tags);
  normalized.description = normalizeNullableString(payload.description);
  normalized.usageRights = normalizeString(payload.usageRights);
  normalized.usableFor = normalizeStringArray(payload.usableFor);
  normalized.status = normalizeString(payload.status);
  normalized.reviewStatus = normalizeString(payload.reviewStatus);
  normalized.extractionStatus = normalizeString(payload.extractionStatus);
  normalized.isActive = parseBoolean(payload.isActive, true);
  normalized.isSystem = parseBoolean(payload.isSystem, false);
  normalized.importBatchId = normalizeNullableString(payload.importBatchId);
  normalized.checksum = normalizeNullableString(payload.checksum);
  normalized.notes = normalizeNullableString(payload.notes);
  normalized.orgId = normalizeString(payload.orgId) || 'SYSTEM';
  normalized.approvedBy = normalizeNullableString(payload.approvedBy);
  normalized.approvedAt = normalizeNullableString(payload.approvedAt);
  normalized.extensions = payload.extensions && typeof payload.extensions === 'object' ? payload.extensions : {};

  ensureAllowed('sourceType', normalized.sourceType, SOURCE_TYPES, errors);
  ensureAllowed('authorityLevel', normalized.authorityLevel, AUTHORITY_LEVELS, errors);
  ensureAllowed('language', normalized.language, LANGUAGES, errors);
  ensureAllowed('usageRights', normalized.usageRights, USAGE_RIGHTS, errors);
  ensureAllowed('status', normalized.status, STATUSES, errors);
  ensureAllowed('reviewStatus', normalized.reviewStatus, REVIEW_STATUSES, errors);
  ensureAllowed('extractionStatus', normalized.extractionStatus, EXTRACTION_STATUSES, errors);
  if (normalized.fileExtension) ensureAllowed('fileExtension', normalized.fileExtension, FILE_EXTENSIONS, errors, false);

  if (normalized.usableFor.some((value) => !USABLE_FOR.includes(value))) {
    errors.push(`usableFor values must be from: ${USABLE_FOR.join(', ')}`);
  }

  const allItems = Object.values(existingDb.itemsById || {});
  const compareItems = allItems.filter((item) => String(item.id) !== String(currentId || ''));
  if (compareItems.some((item) => normalizeString(item.id) === normalized.id)) errors.push(`id already exists: ${normalized.id}`);
  if (compareItems.some((item) => normalizeString(item.slug).toLowerCase() === normalized.slug)) errors.push(`slug already exists: ${normalized.slug}`);
  if (normalized.code && compareItems.some((item) => normalizeString(item.code) === normalized.code)) errors.push(`code already exists: ${normalized.code}`);

  if (!normalized.id.startsWith('source:')) errors.push("id must start with 'source:'.");
  if (!/^[a-z0-9-]+$/.test(normalized.slug)) errors.push('slug must be URL-safe lowercase (a-z, 0-9, dash).');

  return { isValid: errors.length === 0, errors, normalized };
}

function toListItem(item) {
  return {
    ...item,
    id: normalizeString(item.id),
    slug: normalizeString(item.slug),
    title: normalizeString(item.title),
    sourceType: normalizeString(item.sourceType),
    authorityLevel: normalizeString(item.authorityLevel),
    language: normalizeString(item.language),
    status: normalizeString(item.status),
    reviewStatus: normalizeString(item.reviewStatus),
    extractionStatus: normalizeString(item.extractionStatus),
    orgId: normalizeString(item.orgId) || 'SYSTEM',
    isActive: Boolean(item.isActive),
    isSystem: Boolean(item.isSystem)
  };
}

async function getAllSources() {
  const db = await readDb();
  return (db.allIds || []).map((id) => db.itemsById[id]).filter(Boolean).map(toListItem);
}

async function getSourceById(id) {
  const db = await readDb();
  const row = db.itemsById[normalizeString(id)];
  return row ? { ...row } : null;
}

async function addSource(input, actor = 'system') {
  return queueWrite(async () => {
    const db = await readDb();
    const check = validateSourceInput(input, db);
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

async function updateSource(id, updates, actor = 'system') {
  return queueWrite(async () => {
    const db = await readDb();
    const existing = db.itemsById[normalizeString(id)];
    if (!existing) throw new Error('Source not found.');

    const merged = {
      ...existing,
      ...updates,
      id: existing.id
    };

    const check = validateSourceInput(merged, db, existing.id);
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

async function deleteSource(id) {
  return queueWrite(async () => {
    const db = await readDb();
    const key = normalizeString(id);
    if (!db.itemsById[key]) throw new Error('Source not found.');

    delete db.itemsById[key];
    db.allIds = (db.allIds || []).filter((itemId) => itemId !== key);
    rebuildIndexes(db);
    await writeDb(db);
    return true;
  });
}

module.exports = {
  SOURCE_TYPES,
  AUTHORITY_LEVELS,
  LANGUAGES,
  USAGE_RIGHTS,
  USABLE_FOR,
  STATUSES,
  REVIEW_STATUSES,
  EXTRACTION_STATUSES,
  FILE_EXTENSIONS,
  REQUIRED_CREATE_FIELDS,
  getAllSources,
  getSourceById,
  addSource,
  updateSource,
  deleteSource
};
