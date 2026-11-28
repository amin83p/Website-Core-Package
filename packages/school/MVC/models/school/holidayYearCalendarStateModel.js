'use strict';

const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const schoolCatalogEntityIdService = require('../../services/school/schoolCatalogEntityIdService');
const { resolveJsonEntityCreateId } = require('../../services/school/schoolJsonEntityCreateIdService');

const dataPath = path.join(resolveCoreRoot(), 'data/school/holidayYearCalendarStates.json');

if (!fsSync.existsSync(path.dirname(dataPath))) {
  fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
}
if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

const BATCH_STATUSES = new Set(['applied', 'undone']);

function cleanString(v, { max = 2000, allowEmpty = true } = {}) {
  if (v === undefined || v === null) return allowEmpty ? '' : null;
  const s = String(v).replace(/\0/g, '').trim();
  if (!allowEmpty && !s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function cleanId(v, { max = 64, allowEmpty = false } = {}) {
  const s = cleanString(v, { max, allowEmpty });
  if (s === null) return null;
  if (!s) return allowEmpty ? '' : null;
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('Invalid id format.');
  return s;
}

function cleanYear(v) {
  const token = cleanString(v, { max: 4, allowEmpty: false });
  if (!/^\d{4}$/.test(token)) throw new Error('Invalid calendar year.');
  return token;
}

function sanitizeImportedRow(row = {}) {
  return {
    holidayId: cleanId(row.holidayId, { allowEmpty: false }),
    date: cleanString(row.date, { max: 10, allowEmpty: false }),
    title: cleanString(row.title, { max: 500, allowEmpty: false })
  };
}

function sanitizeBatch(batch = {}) {
  const status = cleanString(batch.status, { max: 20, allowEmpty: true }).toLowerCase() || 'applied';
  if (!BATCH_STATUSES.has(status)) throw new Error('Invalid AI batch status.');
  return {
    batchId: cleanId(batch.batchId, { allowEmpty: false }),
    status,
    createdAt: cleanString(batch.createdAt, { max: 40, allowEmpty: true }) || new Date().toISOString(),
    createdByUserId: cleanId(batch.createdByUserId, { allowEmpty: true }) || '',
    occasionInput: cleanString(batch.occasionInput, { max: 2000 }),
    regionHint: cleanString(batch.regionHint, { max: 500 }),
    traceId: cleanString(batch.traceId, { max: 120 }),
    usageRecordId: cleanString(batch.usageRecordId, { max: 120 }),
    holidayIds: (Array.isArray(batch.holidayIds) ? batch.holidayIds : [])
      .map((id) => cleanId(id, { allowEmpty: false }))
      .filter(Boolean),
    importedRows: (Array.isArray(batch.importedRows) ? batch.importedRows : [])
      .map(sanitizeImportedRow)
      .filter((row) => row.holidayId),
    stats: batch.stats && typeof batch.stats === 'object' ? { ...batch.stats } : {},
    undoneAt: cleanString(batch.undoneAt, { max: 40, allowEmpty: true }) || '',
    undoneByUserId: cleanId(batch.undoneByUserId, { allowEmpty: true }) || ''
  };
}

function sanitizeStateInput(input = {}) {
  const orgId = cleanId(input.orgId, { allowEmpty: false });
  const year = cleanYear(input.year);
  if (!orgId) throw new Error('orgId is required.');
  const aiBatches = (Array.isArray(input.aiBatches) ? input.aiBatches : []).map(sanitizeBatch);
  return { orgId, year, aiBatches };
}

async function getAllHolidayYearCalendarStates() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      await fs.mkdir(path.dirname(dataPath), { recursive: true });
      await fs.writeFile(dataPath, JSON.stringify([]));
      return [];
    }
    throw new Error('Failed to retrieve holiday year calendar states');
  }
}

async function getHolidayYearCalendarStateById(id) {
  const rows = await getAllHolidayYearCalendarStates();
  return rows.find((row) => String(row.id) === String(id)) || null;
}

function generateBatchId() {
  return `HYB-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

async function addHolidayYearCalendarState(payload) {
  let saved = null;
  await queueWrite(async () => {
    const rows = await getAllHolidayYearCalendarStates();
    const sanitized = sanitizeStateInput(payload);
    const exists = rows.some(
      (row) => String(row.orgId) === sanitized.orgId && String(row.year) === sanitized.year
    );
    if (exists) throw new Error('Holiday year calendar state already exists for this org and year.');
    const existingIds = new Set(rows.map((row) => String(row?.id || '').trim()).filter(Boolean));
    const id = await resolveJsonEntityCreateId({
      requestedId: payload.id,
      existingIds: [...existingIds],
      allocate: (opts) => schoolCatalogEntityIdService.allocateUniqueHolidayYearCalendarStateId(opts)
    });
    saved = { id, ...sanitized };
    rows.push(saved);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
  });
  return saved;
}

async function updateHolidayYearCalendarState(id, payload) {
  let saved = null;
  await queueWrite(async () => {
    const rows = await getAllHolidayYearCalendarStates();
    const idx = rows.findIndex((row) => String(row.id) === String(id));
    if (idx < 0) throw new Error('Holiday year calendar state not found.');
    const sanitized = sanitizeStateInput({
      ...rows[idx],
      ...payload,
      orgId: rows[idx].orgId,
      year: rows[idx].year
    });
    rows[idx] = { ...rows[idx], ...sanitized, id: rows[idx].id };
    saved = rows[idx];
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
  });
  return saved;
}

async function deleteHolidayYearCalendarState(id) {
  await queueWrite(async () => {
    const rows = await getAllHolidayYearCalendarStates();
    const filtered = rows.filter((row) => String(row.id) !== String(id));
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
  });
}

module.exports = {
  getAllHolidayYearCalendarStates,
  getHolidayYearCalendarStateById,
  addHolidayYearCalendarState,
  updateHolidayYearCalendarState,
  deleteHolidayYearCalendarState,
  sanitizeStateInput,
  sanitizeBatch,
  generateBatchId
};