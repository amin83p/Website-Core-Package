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
const LOAD_STATUSES = new Set(['draft', 'submitted', 'locked']);

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
    pdfKey: clean(row?.pdfKey, 100),
    studentId: clean(row?.studentId, 100),
    generatedAt: clean(row?.generatedAt, 60) || new Date().toISOString(),
    generatedBy: clean(row?.generatedBy, 100),
    revision: Math.max(1, Number(row?.revision || 1) || 1)
  })).filter((row) => row.fileName);
}

function sanitizeDerivedOverrides(value) {
  const derivedOverrides = {};
  if (!isObject(value)) return derivedOverrides;
  Object.entries(value).forEach(([fieldId, overridden]) => {
    derivedOverrides[clean(fieldId, 100)] = overridden === true || String(overridden).toLowerCase() === 'true';
  });
  return derivedOverrides;
}

function isOptionalSnapshotSlot(slot) {
  return String(slot?.requirement || 'necessary').trim().toLowerCase() === 'optional';
}

function sanitizeSourceSelection(row, { snapshotSlot = null } = {}) {
  const slotKey = clean(row?.slotKey, 30).toUpperCase();
  if (!SLOT_KEY_PATTERN.test(slotKey)) {
    throw new Error(`Invalid overall report source slot "${slotKey}".`);
  }
  const skipped = row?.skipped === true || String(row?.skipped || '').trim().toLowerCase() === 'true';
  const instanceIdRaw = clean(row?.instanceId, 100);
  const optionalSlot = isOptionalSnapshotSlot(snapshotSlot);
  if (!instanceIdRaw) {
    if (skipped && optionalSlot) {
      return {
        slotKey,
        templateId: cleanId(row?.templateId),
        templateTitle: clean(row?.templateTitle, 240),
        templateVersion: Math.max(1, Number(row?.templateVersion || 1) || 1),
        instanceId: '',
        instanceTitle: '',
        instanceStatus: '',
        skipped: true,
        capturedAt: clean(row?.capturedAt, 60) || new Date().toISOString()
      };
    }
    throw new Error(`Overall report source slot "${slotKey}" requires a source report instance.`);
  }
  return {
    slotKey,
    templateId: cleanId(row?.templateId),
    templateTitle: clean(row?.templateTitle, 240),
    templateVersion: Math.max(1, Number(row?.templateVersion || 1) || 1),
    instanceId: cleanId(instanceIdRaw),
    instanceTitle: clean(row?.instanceTitle, 240),
    instanceStatus: clean(row?.instanceStatus, 20),
    skipped: false,
    capturedAt: clean(row?.capturedAt, 60) || new Date().toISOString()
  };
}

function sanitizeSourceSelections(rows, snapshotSlots = []) {
  const seenSlots = new Set();
  const snapshotSlotMap = new Map(
    (Array.isArray(snapshotSlots) ? snapshotSlots : []).map((slot) => [
      clean(slot?.slotKey, 30).toUpperCase(),
      slot
    ])
  );
  const sourceSelections = (Array.isArray(rows) ? rows : []).map((row) => {
    const slotKey = clean(row?.slotKey, 30).toUpperCase();
    const selection = sanitizeSourceSelection(row, { snapshotSlot: snapshotSlotMap.get(slotKey) });
    if (seenSlots.has(selection.slotKey)) {
      throw new Error(`Invalid or duplicate overall report source slot "${selection.slotKey}".`);
    }
    seenSlots.add(selection.slotKey);
    return selection;
  });
  if (sourceSelections.length < 1) {
    throw new Error('Overall reports require at least one source report instance.');
  }
  (Array.isArray(snapshotSlots) ? snapshotSlots : []).forEach((slot) => {
    const slotKey = clean(slot?.slotKey, 30).toUpperCase();
    const selection = sourceSelections.find((row) => row.slotKey === slotKey);
    if (!selection || !idsEqual(selection.templateId, slot?.templateId)) {
      throw new Error(`Overall report source selection does not match snapshot slot ${slot?.slotKey || ''}.`);
    }
    if (!selection.instanceId && !selection.skipped) {
      throw new Error(`Overall report source slot "${slotKey}" requires a source report instance.`);
    }
    if (!selection.instanceId && selection.skipped && !isOptionalSnapshotSlot(slot)) {
      throw new Error(`Overall report source slot "${slotKey}" cannot be skipped because it is necessary.`);
    }
  });
  const usedInstanceIds = new Set();
  sourceSelections.forEach((selection) => {
    const key = String(selection.instanceId || '');
    if (!key) return;
    if (usedInstanceIds.has(key)) {
      throw new Error(`Source report ${selection.instanceId} cannot be used in more than one slot.`);
    }
    usedInstanceIds.add(key);
  });
  return sourceSelections;
}

function sanitizeFiltersSnapshot(input = {}) {
  if (!isObject(input)) {
    return { startDate: '', endDate: '', studentIds: [], statuses: ['submitted', 'locked'] };
  }
  const statuses = [...new Set(
    (Array.isArray(input.statuses) ? input.statuses : String(input.statuses || '').split(','))
      .map((status) => clean(status, 20).toLowerCase())
      .filter((status) => LOAD_STATUSES.has(status))
  )];
  return {
    startDate: clean(input.startDate, 20),
    endDate: clean(input.endDate, 20),
    studentIds: [...new Set(
      (Array.isArray(input.studentIds) ? input.studentIds : [])
        .map((id) => cleanId(id, { allowEmpty: true }))
        .filter(Boolean)
    )],
    statuses: statuses.length ? statuses : ['submitted', 'locked']
  };
}

function sanitizeStudentEntry(input, snapshotSlots = []) {
  if (!isObject(input)) throw new Error('Invalid overall report student entry.');
  const studentId = cleanId(input.studentId);
  const sourceSelections = sanitizeSourceSelections(input.sourceSelections, snapshotSlots);
  return {
    studentId,
    studentName: clean(input.studentName, 240) || studentId,
    sourceSelections,
    sourceValues: isObject(input.sourceValues) ? clone(input.sourceValues, {}) : {},
    answers: isObject(input.answers) ? clone(input.answers, {}) : {},
    derivedOverrides: sanitizeDerivedOverrides(input.derivedOverrides),
    generatedDocs: sanitizeGeneratedDocs(input.generatedDocs),
    included: input.included !== false
  };
}

function sanitizeStudentEntries(rows, snapshotSlots = {}) {
  const seenStudents = new Set();
  const entries = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const entry = sanitizeStudentEntry(row, snapshotSlots);
    if (seenStudents.has(entry.studentId)) {
      throw new Error(`Duplicate student "${entry.studentId}" in overall report.`);
    }
    seenStudents.add(entry.studentId);
    if (entry.included) entries.push(entry);
  });
  return entries;
}

function wrapLegacyAsStudentEntries(instance = {}) {
  if (Array.isArray(instance.studentEntries) && instance.studentEntries.length) {
    return instance.studentEntries;
  }
  const selections = Array.isArray(instance.sourceSelections) ? instance.sourceSelections : [];
  if (!selections.length) return [];
  return [{
    studentId: clean(instance.legacyStudentId || 'LEGACY', 100) || 'LEGACY',
    studentName: clean(instance.legacyStudentName || instance.title || 'Legacy report', 240),
    sourceSelections: selections,
    sourceValues: isObject(instance.sourceValues) ? clone(instance.sourceValues, {}) : {},
    answers: isObject(instance.answers) ? clone(instance.answers, {}) : {},
    derivedOverrides: sanitizeDerivedOverrides(instance.derivedOverrides),
    generatedDocs: sanitizeGeneratedDocs(instance.generatedDocs),
    included: true
  }];
}

function sanitizeInstance(input, { existing = null, isUpdate = false } = {}) {
  if (!isObject(input)) throw new Error('Invalid overall report instance payload.');
  const status = clean(input.status || 'draft', 20).toLowerCase();
  if (!INSTANCE_STATUSES.has(status)) throw new Error('Invalid overall report status.');
  const now = new Date().toISOString();
  const title = clean(input.title, 240);
  if (!title) throw new Error('Overall report title is required.');
  const templateSnapshot = clone(input.templateSnapshot, {});
  const snapshotSlots = Array.isArray(templateSnapshot?.sourceSlots) ? templateSnapshot.sourceSlots : [];
  if (snapshotSlots.length < 1) throw new Error('Overall report template snapshot is missing source slots.');

  const hasStudentEntriesInput = Array.isArray(input.studentEntries);
  let studentEntries = hasStudentEntriesInput
    ? sanitizeStudentEntries(input.studentEntries, snapshotSlots)
    : [];
  let sourceSelections;
  let sourceValues;
  let answers;
  let derivedOverrides;

  if (studentEntries.length) {
    sourceSelections = studentEntries[0].sourceSelections;
    sourceValues = clone(studentEntries[0].sourceValues, {});
    answers = clone(studentEntries[0].answers, {});
    derivedOverrides = clone(studentEntries[0].derivedOverrides, {});
  } else {
    sourceSelections = sanitizeSourceSelections(input.sourceSelections, snapshotSlots);
    sourceValues = isObject(input.sourceValues) ? clone(input.sourceValues, {}) : {};
    answers = isObject(input.answers) ? clone(input.answers, {}) : {};
    derivedOverrides = sanitizeDerivedOverrides(input.derivedOverrides);
    if (hasStudentEntriesInput) {
      throw new Error('Overall reports require at least one included student.');
    }
  }

  const filtersSnapshot = sanitizeFiltersSnapshot(
    input.filtersSnapshot != null ? input.filtersSnapshot : existing?.filtersSnapshot
  );

  const out = {
    orgId: cleanId(input.orgId),
    overallTemplateId: cleanId(input.overallTemplateId),
    overallTemplateVersion: Math.max(1, Number(input.overallTemplateVersion || 1) || 1),
    title,
    status,
    selectedDocxKey: clean(input.selectedDocxKey || 'default', 100) || 'default',
    selectedPdfKey: clean(input.selectedPdfKey || 'default', 100) || 'default',
    templateSnapshot,
    filtersSnapshot,
    studentEntries,
    sourceSelections,
    sourceValues,
    answers,
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
  LOAD_STATUSES: Object.freeze([...LOAD_STATUSES]),
  sanitizeInstance,
  sanitizeStudentEntry,
  sanitizeFiltersSnapshot,
  wrapLegacyAsStudentEntries,
  getAllInstances,
  getInstanceById,
  addInstance,
  updateInstance,
  deleteInstance
};
