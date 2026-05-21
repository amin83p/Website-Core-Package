const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('../fileQueue');

const dataPath = path.join(__dirname, '../../../data/benchpath/runtime/tasks.json');

const TASK_STATUSES = ['draft', 'published', 'archived'];
const TASK_TYPES = ['assessment', 'enabling'];
const PBLA_FIT_CLASSES = ['suitable', 'review_required', 'not_suitable'];

const REQUIRED_CREATE_FIELDS = [
  'id',
  'slug',
  'title',
  'skill',
  'selectedBenchmarkId',
  'taskType',
  'status'
];

function nowIso() {
  return new Date().toISOString();
}

function s(value) {
  return String(value == null ? '' : value).trim();
}

function sn(value) {
  const normalized = s(value);
  return normalized || null;
}

function b(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = s(value).toLowerCase();
  if (!normalized) return fallback;
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function arr(value, separator = ',') {
  if (Array.isArray(value)) return value.map((entry) => s(entry)).filter(Boolean);
  const normalized = s(value);
  if (!normalized) return [];
  return normalized.split(separator).map((entry) => entry.trim()).filter(Boolean);
}

function asJsonArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  const normalized = s(value);
  if (!normalized) return fallback;
  try {
    const parsed = JSON.parse(normalized);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function asJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const normalized = s(value);
  if (!normalized) return fallback;
  try {
    const parsed = JSON.parse(normalized);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : fallback;
  } catch (_) {
    return fallback;
  }
}

function ensureAllowed(field, value, allowed, errors, required = true) {
  const normalized = s(value);
  if (!normalized) {
    if (required) errors.push(`${field} is required.`);
    return;
  }
  if (!allowed.includes(normalized)) errors.push(`${field} must be one of: ${allowed.join(', ')}`);
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
      entityType: 'benchpathTasks',
      layer: 'runtime',
      authority: 'internal',
      isReadMostly: false,
      defaultLocale: 'en-CA',
      generatedAt: timestamp,
      updatedAt: timestamp
    },
    itemsById: {},
    allIds: [],
    indexes: {
      byStatus: {},
      byOrgId: {},
      bySkill: {},
      byTaskType: {},
      bySelectedBenchmarkId: {},
      byCreatedBy: {},
      byPortfolioFitClass: {}
    }
  };
}

async function readDb() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(dataPath, 'utf8');
    const parsed = JSON.parse(String(raw || '').replace(/^\uFEFF/, ''));
    if (!parsed || typeof parsed !== 'object') return buildEmptyDb();
    if (!parsed.meta || typeof parsed.meta !== 'object') parsed.meta = buildEmptyDb().meta;
    if (!parsed.itemsById || typeof parsed.itemsById !== 'object') parsed.itemsById = {};
    if (!Array.isArray(parsed.allIds)) parsed.allIds = Object.keys(parsed.itemsById);
    if (!parsed.indexes || typeof parsed.indexes !== 'object') parsed.indexes = {};
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
    byStatus: {},
    byOrgId: {},
    bySkill: {},
    byTaskType: {},
    bySelectedBenchmarkId: {},
    byCreatedBy: {},
    byPortfolioFitClass: {}
  };

  const mapIn = (bucket, key, id) => {
    const normalized = s(key);
    if (!normalized) return;
    if (!indexes[bucket][normalized]) indexes[bucket][normalized] = [];
    indexes[bucket][normalized].push(id);
  };

  (db.allIds || []).forEach((id) => {
    const item = db.itemsById[id];
    if (!item) return;
    mapIn('byStatus', item.status, id);
    mapIn('byOrgId', item.orgId || 'SYSTEM', id);
    mapIn('bySkill', item.skill, id);
    mapIn('byTaskType', item.taskType, id);
    mapIn('bySelectedBenchmarkId', item.selectedBenchmarkId, id);
    mapIn('byCreatedBy', item.createdBy || 'system', id);
    mapIn('byPortfolioFitClass', item?.portfolioFit?.classification, id);
  });

  db.indexes = indexes;
  return db;
}

function normalizeTaskInput(payload = {}, existingDb, currentId = null) {
  const errors = [];
  const normalized = {};

  normalized.id = s(payload.id);
  normalized.slug = s(payload.slug).toLowerCase();
  normalized.title = s(payload.title);
  normalized.orgId = s(payload.orgId) || 'SYSTEM';
  normalized.createdBy = s(payload.createdBy) || 'system';

  normalized.learnerContext = asJsonObject(payload.learnerContext, {});
  normalized.classContext = asJsonObject(payload.classContext, {});
  normalized.skill = s(payload.skill);

  normalized.suggestedBenchmarkId = sn(payload.suggestedBenchmarkId);
  normalized.selectedBenchmarkId = sn(payload.selectedBenchmarkId);
  normalized.competencyAreaIds = arr(payload.competencyAreaIds);
  normalized.competencyIds = arr(payload.competencyIds);
  normalized.profileOfAbilityRefs = arr(payload.profileOfAbilityRefs);
  normalized.indicatorIds = arr(payload.indicatorIds);
  normalized.featureOfCommunicationIds = arr(payload.featureOfCommunicationIds);
  normalized.sampleTaskLabelIds = arr(payload.sampleTaskLabelIds);

  normalized.taskType = s(payload.taskType);
  normalized.realWorldScenario = sn(payload.realWorldScenario);
  normalized.learnerInstructions = sn(payload.learnerInstructions);
  normalized.teacherInstructions = sn(payload.teacherInstructions);
  normalized.taskConditions = asJsonObject(payload.taskConditions, {});
  normalized.evidencePlan = asJsonObject(payload.evidencePlan, {});
  normalized.criteriaForSuccess = asJsonArray(payload.criteriaForSuccess, []);
  normalized.rubricDraft = asJsonObject(payload.rubricDraft, {});
  normalized.portfolioFit = asJsonObject(payload.portfolioFit, {});
  normalized.validation = asJsonObject(payload.validation, {});
  normalized.wizardTrace = asJsonObject(payload.wizardTrace, {});

  normalized.status = s(payload.status) || 'draft';
  normalized.isActive = b(payload.isActive, true);
  normalized.notes = sn(payload.notes);
  normalized.tags = arr(payload.tags);
  normalized.version = Number.isInteger(Number(payload.version)) ? Number(payload.version) : 1;
  normalized.extensions = asJsonObject(payload.extensions, {});

  REQUIRED_CREATE_FIELDS.forEach((field) => {
    if (!s(normalized[field])) errors.push(`${field} is required.`);
  });

  if (normalized.id && !normalized.id.startsWith('task:')) {
    errors.push("id must start with 'task:'.");
  }
  if (normalized.slug && !/^[a-z0-9-]+$/.test(normalized.slug)) {
    errors.push('slug must be URL-safe lowercase (a-z, 0-9, dash).');
  }

  ensureAllowed('taskType', normalized.taskType, TASK_TYPES, errors);
  ensureAllowed('status', normalized.status, TASK_STATUSES, errors);

  const portfolioClassification = s(normalized?.portfolioFit?.classification);
  if (portfolioClassification) {
    ensureAllowed('portfolioFit.classification', portfolioClassification, PBLA_FIT_CLASSES, errors, false);
  }

  const allItems = Object.values(existingDb.itemsById || {});
  const compareItems = allItems.filter((item) => s(item.id) !== s(currentId));
  if (compareItems.some((item) => s(item.id) === normalized.id)) errors.push(`id already exists: ${normalized.id}`);
  if (compareItems.some((item) => s(item.slug).toLowerCase() === normalized.slug)) errors.push(`slug already exists: ${normalized.slug}`);

  return { isValid: errors.length === 0, errors, normalized };
}

function toListItem(item) {
  const wizard = item?.extensions && typeof item.extensions === 'object' && item.extensions.wizard && typeof item.extensions.wizard === 'object'
    ? item.extensions.wizard
    : {};
  return {
    id: s(item.id),
    slug: s(item.slug),
    title: s(item.title),
    orgId: s(item.orgId) || 'SYSTEM',
    createdBy: s(item.createdBy) || 'system',
    skill: s(item.skill),
    selectedBenchmarkId: sn(item.selectedBenchmarkId),
    taskType: s(item.taskType),
    status: s(item.status),
    updatedAt: sn(item.updatedAt),
    validation: asJsonObject(item.validation, {}),
    portfolioFit: asJsonObject(item.portfolioFit, {}),
    wizardStep: Number.isFinite(Number(wizard.currentStep)) ? Number(wizard.currentStep) : 1,
    wizardLastSavedStep: Number.isFinite(Number(wizard.lastSavedStep)) ? Number(wizard.lastSavedStep) : 1
  };
}

async function getAllTasks() {
  const db = await readDb();
  return (db.allIds || []).map((id) => db.itemsById[id]).filter(Boolean).map(toListItem);
}

async function getTaskById(id) {
  const db = await readDb();
  const row = db.itemsById[s(id)];
  return row ? { ...row } : null;
}

async function addTask(input, actor = 'system') {
  return queueWrite(async () => {
    const db = await readDb();
    const check = normalizeTaskInput(input, db, null);
    if (!check.isValid) throw new Error(check.errors.join('<br>'));

    const timestamp = nowIso();
    const item = {
      ...check.normalized,
      createdBy: check.normalized.createdBy || actor,
      updatedBy: actor,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1
    };

    db.itemsById[item.id] = item;
    db.allIds = [...(db.allIds || []), item.id];
    rebuildIndexes(db);
    await writeDb(db);
    return item;
  });
}

async function updateTask(id, updates, actor = 'system') {
  return queueWrite(async () => {
    const db = await readDb();
    const existing = db.itemsById[s(id)];
    if (!existing) throw new Error('Task not found.');

    const merged = {
      ...existing,
      ...updates,
      id: existing.id
    };

    const check = normalizeTaskInput(merged, db, existing.id);
    if (!check.isValid) throw new Error(check.errors.join('<br>'));

    const updated = {
      ...existing,
      ...check.normalized,
      id: existing.id,
      createdBy: existing.createdBy || actor,
      createdAt: existing.createdAt || nowIso(),
      updatedBy: actor,
      updatedAt: nowIso(),
      version: Number.isInteger(Number(existing.version)) ? Number(existing.version) + 1 : 1
    };

    db.itemsById[existing.id] = updated;
    if (!db.allIds.includes(existing.id)) db.allIds.push(existing.id);
    rebuildIndexes(db);
    await writeDb(db);
    return updated;
  });
}

async function deleteTask(id) {
  return queueWrite(async () => {
    const db = await readDb();
    const key = s(id);
    if (!db.itemsById[key]) throw new Error('Task not found.');

    delete db.itemsById[key];
    db.allIds = (db.allIds || []).filter((itemId) => itemId !== key);
    rebuildIndexes(db);
    await writeDb(db);
    return true;
  });
}

module.exports = {
  TASK_STATUSES,
  TASK_TYPES,
  PBLA_FIT_CLASSES,
  REQUIRED_CREATE_FIELDS,
  getAllTasks,
  getTaskById,
  addTask,
  updateTask,
  deleteTask
};
