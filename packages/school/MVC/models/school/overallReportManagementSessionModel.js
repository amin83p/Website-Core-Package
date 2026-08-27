const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const dataPath = path.join(resolveCoreRoot(), 'data/school/overallReportManagementSessions.json');
if (!fsSync.existsSync(dataPath)) fsSync.writeFileSync(dataPath, '[]');

const SESSION_STATUSES = new Set(['draft', 'archived']);
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

function sanitizeAddFilters(input = {}) {
  if (!isObject(input)) {
    return { studentIds: [], statuses: ['submitted', 'locked'] };
  }
  const statuses = [...new Set(
    (Array.isArray(input.statuses) ? input.statuses : String(input.statuses || '').split(','))
      .map((status) => clean(status, 20).toLowerCase())
      .filter((status) => ['draft', 'submitted', 'locked'].includes(status))
  )];
  return {
    studentIds: [...new Set(
      (Array.isArray(input.studentIds) ? input.studentIds : [])
        .map((id) => cleanId(id, { allowEmpty: true }))
        .filter(Boolean)
    )],
    statuses: statuses.length ? statuses : ['submitted', 'locked']
  };
}

function sanitizeRowInstance(row) {
  return {
    instanceId: cleanId(row?.instanceId),
    instanceTitle: clean(row?.instanceTitle, 240),
    sourceTemplateTitle: clean(row?.sourceTemplateTitle, 240),
    slotKey: clean(row?.slotKey, 30).toUpperCase()
  };
}

function sanitizeSourceSelection(row) {
  const slotKey = clean(row?.slotKey, 30).toUpperCase();
  if (!SLOT_KEY_PATTERN.test(slotKey)) {
    throw new Error(`Invalid source slot key "${slotKey}".`);
  }
  return {
    slotKey,
    instanceId: cleanId(row?.instanceId)
  };
}

function sanitizeRow(input) {
  if (!isObject(input)) throw new Error('Invalid management session row.');
  const studentId = cleanId(input.studentId);
  const sourceSelections = (Array.isArray(input.sourceSelections) ? input.sourceSelections : [])
    .map((row) => sanitizeSourceSelection(row));
  const seenSlots = new Set();
  sourceSelections.forEach((row) => {
    if (seenSlots.has(row.slotKey)) throw new Error(`Duplicate slot "${row.slotKey}" on student ${studentId}.`);
    seenSlots.add(row.slotKey);
  });
  return {
    studentId,
    studentName: clean(input.studentName, 240) || studentId,
    instances: (Array.isArray(input.instances) ? input.instances : []).map((row) => sanitizeRowInstance(row)),
    sourceSelections,
    selectedOverallTemplateId: cleanId(input.selectedOverallTemplateId, { allowEmpty: true }) || null,
    excludedOverallTemplateIds: [...new Set(
      (Array.isArray(input.excludedOverallTemplateIds) ? input.excludedOverallTemplateIds : [])
        .map((id) => cleanId(id, { allowEmpty: true }))
        .filter(Boolean)
    )],
    overallInstanceId: cleanId(input.overallInstanceId, { allowEmpty: true }) || null,
    selectedDocxKey: clean(input.selectedDocxKey, 100) || 'default',
    selectedPdfKey: clean(input.selectedPdfKey, 100) || 'default'
  };
}

function sanitizeRows(rows) {
  const seenStudents = new Set();
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const entry = sanitizeRow(row);
    if (seenStudents.has(entry.studentId)) {
      throw new Error(`Duplicate student "${entry.studentId}" in management session.`);
    }
    seenStudents.add(entry.studentId);
    return entry;
  });
}

function sanitizeSession(input, { existing = null, isUpdate = false } = {}) {
  if (!isObject(input)) throw new Error('Invalid overall report management session payload.');
  const status = clean(input.status || 'draft', 20).toLowerCase();
  if (!SESSION_STATUSES.has(status)) throw new Error('Invalid management session status.');
  const title = clean(input.title, 240);
  if (!title) throw new Error('Management session title is required.');
  const now = new Date().toISOString();
  const startDate = clean(input.startDate, 20);
  const endDate = clean(input.endDate, 20);
  if (!startDate || !endDate) throw new Error('Start and end dates are required.');
  if (existing && isUpdate) {
    if (startDate !== clean(existing.startDate, 20) || endDate !== clean(existing.endDate, 20)) {
      throw new Error('Date range cannot be changed after the session is saved.');
    }
  }
  return {
    id: existing?.id || cleanId(input.id, { allowEmpty: true }) || '',
    orgId: toPublicId(input.orgId || existing?.orgId),
    title,
    status,
    startDate,
    endDate,
    selectedTemplateIds: [...new Set(
      (Array.isArray(input.selectedTemplateIds) ? input.selectedTemplateIds : [])
        .map((id) => cleanId(id, { allowEmpty: true }))
        .filter(Boolean)
    )],
    addFilters: sanitizeAddFilters(input.addFilters),
    rows: sanitizeRows(input.rows),
    revision: Math.max(1, Number(existing?.revision || input.revision || 1) || 1),
    audit: {
      createUser: clean(existing?.audit?.createUser || input.audit?.createUser || '', 100),
      createDateTime: clean(existing?.audit?.createDateTime || input.audit?.createDateTime || now, 60),
      lastUpdateUser: clean(input.audit?.lastUpdateUser || '', 100),
      lastUpdateDateTime: clean(input.audit?.lastUpdateDateTime || now, 60)
    }
  };
}

async function getAllSessions() {
  try {
    return JSON.parse(await fs.readFile(dataPath, 'utf8') || '[]');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function getSessionById(id) {
  return (await getAllSessions()).find((row) => idsEqual(row?.id, id)) || null;
}

function generateId(existingIds) {
  const year = new Date().getFullYear();
  for (let i = 0; i < 50; i += 1) {
    const id = `OVRMSG-${year}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    if (!existingIds.has(id)) return id;
  }
  return `OVRMSG-${Date.now()}`;
}

async function addSession(input) {
  return queueWrite(async () => {
    const rows = await getAllSessions();
    const record = sanitizeSession(input);
    const ids = new Set(rows.map((row) => toPublicId(row?.id)).filter(Boolean));
    record.id = record.id || generateId(ids);
    if (ids.has(record.id)) throw new Error('Management session id already exists.');
    rows.push(record);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return record;
  });
}

async function updateSession(id, updates) {
  return queueWrite(async () => {
    const rows = await getAllSessions();
    const index = rows.findIndex((row) => idsEqual(row?.id, id));
    if (index < 0) throw new Error('Management session not found.');
    const existing = rows[index];
    const next = sanitizeSession({
      ...existing,
      ...updates,
      revision: Number(existing.revision || 1) + 1
    }, { existing, isUpdate: true });
    rows[index] = { ...existing, ...next, id: existing.id };
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return rows[index];
  });
}

async function deleteSession(id) {
  return queueWrite(async () => {
    const rows = await getAllSessions();
    await fs.writeFile(dataPath, JSON.stringify(rows.filter((row) => !idsEqual(row?.id, id)), null, 2));
  });
}

module.exports = {
  SESSION_STATUSES: Object.freeze([...SESSION_STATUSES]),
  sanitizeSession,
  sanitizeRow,
  sanitizeRows,
  sanitizeAddFilters,
  getAllSessions,
  getSessionById,
  addSession,
  updateSession,
  deleteSession
};
