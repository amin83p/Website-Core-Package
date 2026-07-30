const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const dataPath = path.join(resolveCoreRoot(), 'data/school/overallReportInstances.json');
if (!fsSync.existsSync(dataPath)) fsSync.writeFileSync(dataPath, '[]');

const INSTANCE_STATUSES = new Set(['draft', 'submitted', 'locked', 'archived']);
const SLOT_KEY_PATTERN = /^T[1-9]\d*$/;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clean(value, max = 4000) {
  const text = String(value ?? '').replace(/\0/g, '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function cleanId(value, { allowEmpty = false } = {}) {
  const text = clean(value, 100);
  if (!text && allowEmpty) return '';
  if (!text || !/^[A-Za-z0-9:_-]+$/.test(text)) throw new Error('Invalid id format.');
  return text;
}

function clone(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallback;
  }
}

function sanitizeGeneratedDocs(value) {
  return (Array.isArray(value) ? value : []).map((row) => ({
    fileName: clean(row?.fileName, 260),
    path: clean(row?.path, 600),
    url: clean(row?.url, 600),
    docxKey: clean(row?.docxKey, 100),
    generatedAt: clean(row?.generatedAt, 60) || new Date().toISOString(),
    generatedBy: clean(row?.generatedBy, 100),
    revision: Math.max(1, Number(row?.revision || 1) || 1)
  })).filter((row) => row.fileName);
}

function sanitizeInstance(input, { existing = null, isUpdate = false } = {}) {
  if (!isObject(input)) throw new Error('Invalid overall report instance payload.');
  const status = clean(input.status || 'draft', 20).toLowerCase();
  if (!INSTANCE_STATUSES.has(status)) throw new Error('Invalid overall report status.');
  const seenSlots = new Set();
  const sourceSelections = (Array.isArray(input.sourceSelections) ? input.sourceSelections : []).map((row) => {
    const slotKey = clean(row?.slotKey, 30).toUpperCase();
    if (!SLOT_KEY_PATTERN.test(slotKey) || seenSlots.has(slotKey)) {
      throw new Error(`Invalid or duplicate overall report source slot "${slotKey}".`);
    }
    seenSlots.add(slotKey);
    return {
      slotKey,
      templateId: cleanId(row?.templateId),
      templateTitle: clean(row?.templateTitle, 240),
      templateVersion: Math.max(1, Number(row?.templateVersion || 1) || 1),
      instanceId: cleanId(row?.instanceId),
      instanceTitle: clean(row?.instanceTitle, 240),
      instanceStatus: clean(row?.instanceStatus, 20),
      capturedAt: clean(row?.capturedAt, 60) || new Date().toISOString()
    };
  });
  if (sourceSelections.length < 2) throw new Error('Overall reports require at least two source report instances.');
  const now = new Date().toISOString();
  const title = clean(input.title, 240);
  if (!title) throw new Error('Overall report title is required.');
  const templateSnapshot = clone(input.templateSnapshot, {});
  const snapshotSlots = Array.isArray(templateSnapshot?.sourceSlots) ? templateSnapshot.sourceSlots : [];
  if (snapshotSlots.length < 2) throw new Error('Overall report template snapshot is missing source slots.');
  snapshotSlots.forEach((slot) => {
    const selection = sourceSelections.find((row) => row.slotKey === clean(slot?.slotKey, 30).toUpperCase());
    if (!selection || !idsEqual(selection.templateId, slot?.templateId)) {
      throw new Error(`Overall report source selection does not match snapshot slot ${slot?.slotKey || ''}.`);
    }
  });
  const derivedOverrides = {};
  if (isObject(input.derivedOverrides)) {
    Object.entries(input.derivedOverrides).forEach(([fieldId, overridden]) => {
      derivedOverrides[clean(fieldId, 100)] = overridden === true || String(overridden).toLowerCase() === 'true';
    });
  }
  const out = {
    orgId: cleanId(input.orgId),
    overallTemplateId: cleanId(input.overallTemplateId),
    overallTemplateVersion: Math.max(1, Number(input.overallTemplateVersion || 1) || 1),
    title,
    status,
    selectedDocxKey: clean(input.selectedDocxKey || 'default', 100) || 'default',
    templateSnapshot,
    sourceSelections,
    sourceValues: isObject(input.sourceValues) ? clone(input.sourceValues, {}) : {},
    answers: isObject(input.answers) ? clone(input.answers, {}) : {},
    derivedOverrides,
    generatedDocs: sanitizeGeneratedDocs(input.generatedDocs),
    revision: Math.max(1, Number(input.revision || existing?.revision || 1) || 1),
    audit: {
      createUser: clean(input?.audit?.createUser || existing?.audit?.createUser, 100),
      createDateTime: clean(input?.audit?.createDateTime || existing?.audit?.createDateTime, 60) || now,
      lastUpdateUser: clean(input?.audit?.lastUpdateUser, 100),
      lastUpdateDateTime: clean(input?.audit?.lastUpdateDateTime, 60) || now,
      submittedAt: clean(input?.audit?.submittedAt || existing?.audit?.submittedAt, 60),
      lockedAt: clean(input?.audit?.lockedAt || existing?.audit?.lockedAt, 60),
      unlockedAt: clean(input?.audit?.unlockedAt || existing?.audit?.unlockedAt, 60),
      unlockedBy: clean(input?.audit?.unlockedBy || existing?.audit?.unlockedBy, 100),
      archivedAt: clean(input?.audit?.archivedAt || existing?.audit?.archivedAt, 60)
    }
  };
  if (!isUpdate && input.id) out.id = cleanId(input.id);
  return out;
}

async function getAllInstances() {
  try {
    return JSON.parse(await fs.readFile(dataPath, 'utf8') || '[]');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function getInstanceById(id) {
  return (await getAllInstances()).find((row) => idsEqual(row?.id, id)) || null;
}

function generateId(existingIds) {
  const year = new Date().getFullYear();
  for (let i = 0; i < 50; i += 1) {
    const id = `OVRINS-${year}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    if (!existingIds.has(id)) return id;
  }
  return `OVRINS-${Date.now()}`;
}

async function addInstance(input) {
  return queueWrite(async () => {
    const rows = await getAllInstances();
    const record = sanitizeInstance(input);
    const ids = new Set(rows.map((row) => toPublicId(row?.id)).filter(Boolean));
    record.id = record.id || generateId(ids);
    if (ids.has(record.id)) throw new Error('Overall report instance id already exists.');
    rows.push(record);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return record;
  });
}

async function updateInstance(id, updates) {
  return queueWrite(async () => {
    const rows = await getAllInstances();
    const index = rows.findIndex((row) => idsEqual(row?.id, id));
    if (index < 0) throw new Error('Overall report instance not found.');
    const existing = rows[index];
    const next = sanitizeInstance({
      ...existing,
      ...updates,
      revision: Number(existing.revision || 1) + 1
    }, { existing, isUpdate: true });
    rows[index] = { ...existing, ...next, id: existing.id };
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return rows[index];
  });
}

async function deleteInstance(id) {
  return queueWrite(async () => {
    const rows = await getAllInstances();
    await fs.writeFile(dataPath, JSON.stringify(rows.filter((row) => !idsEqual(row?.id, id)), null, 2));
  });
}

module.exports = {
  INSTANCE_STATUSES: Object.freeze([...INSTANCE_STATUSES]),
  sanitizeInstance,
  getAllInstances,
  getInstanceById,
  addInstance,
  updateInstance,
  deleteInstance
};
