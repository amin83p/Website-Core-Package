'use strict';

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const { getAiServiceByKey } = require('../../config/schoolAiServiceRegistry');
const {
  isPlainObject,
  hasOwn,
  cleanString,
  cleanId,
  normalizeBoolean,
  cleanIsoDateTime,
  generateDatedId,
  buildAudit
} = require('../../services/school/schoolAiModelUtils');

const DATA_PATH = path.join(resolveCoreRoot(), 'data/school/schoolAiServiceAssignments.json');
const ID_PREFIX = 'SCHAIASG';

if (!fsSync.existsSync(DATA_PATH)) fsSync.writeFileSync(DATA_PATH, '[]');

function normalizeAssignmentRecord(record = {}, existing = null, strict = false) {
  const input = isPlainObject(record) ? record : {};
  const base = isPlainObject(existing) ? existing : {};
  const orgId = cleanId(input.orgId || base.orgId, { max: 120, allowEmpty: false });
  const serviceKey = cleanString(input.serviceKey || base.serviceKey, { max: 120, allowEmpty: true });
  const providerRecordId = cleanId(input.providerRecordId || base.providerRecordId, { max: 120, allowEmpty: true }) || '';
  const modelEntryId = cleanId(input.modelEntryId || base.modelEntryId, { max: 120, allowEmpty: true }) || '';
  const isActive = hasOwn(input, 'isActive') ? normalizeBoolean(input.isActive, true) : normalizeBoolean(base.isActive, true);
  const notes = cleanString(input.notes, { max: 4000, allowEmpty: true }) || '';
  const audit = buildAudit(input.lastUpdateUser, input.audit || base.audit);
  if (strict) {
    if (!orgId) throw new Error('Organization is required.');
    if (!serviceKey) throw new Error('Service is required.');
    if (!getAiServiceByKey(serviceKey)) throw new Error('Unknown AI service key.');
    if (!providerRecordId) throw new Error('Provider key is required.');
    if (!modelEntryId) throw new Error('Model is required.');
  }
  return {
    ...base,
    id: cleanId(input.id || base.id, { max: 120, allowEmpty: true }) || '',
    orgId,
    serviceKey,
    providerRecordId,
    modelEntryId,
    isActive,
    notes,
    audit,
    updatedAt: cleanIsoDateTime(new Date().toISOString())
  };
}

async function getAllAssignments() {
  const raw = await fs.readFile(DATA_PATH, 'utf8');
  const parsed = JSON.parse(raw || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

async function getAssignmentById(id) {
  const rows = await getAllAssignments();
  return rows.find((row) => idsEqual(row?.id, id)) || null;
}

async function getByOrgServiceKey(orgId, serviceKey) {
  const rows = await getAllAssignments();
  return rows.find((row) => idsEqual(row?.orgId, orgId) && String(row?.serviceKey) === String(serviceKey)) || null;
}

async function upsertAssignment(payload = {}) {
  return queueWrite(async () => {
    const rows = await getAllAssignments();
    const normalized = normalizeAssignmentRecord(payload, null, true);
    const existingIndex = rows.findIndex(
      (row) => idsEqual(row?.orgId, normalized.orgId) && String(row?.serviceKey) === String(normalized.serviceKey)
    );
    if (existingIndex >= 0) {
      normalized.id = rows[existingIndex].id;
      normalized.audit = buildAudit(payload.lastUpdateUser, rows[existingIndex].audit);
      rows[existingIndex] = normalizeAssignmentRecord(normalized, rows[existingIndex], true);
      await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
      return rows[existingIndex];
    }
    normalized.id = generateDatedId(ID_PREFIX, rows);
    rows.push(normalized);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

async function deleteAssignment(id) {
  return queueWrite(async () => {
    const rows = await getAllAssignments();
    const next = rows.filter((row) => !idsEqual(row?.id, id));
    if (next.length === rows.length) throw new Error('Assignment not found.');
    await fs.writeFile(DATA_PATH, JSON.stringify(next, null, 2));
    return true;
  });
}

module.exports = {
  normalizeAssignmentRecord,
  getAllAssignments,
  getAssignmentById,
  getByOrgServiceKey,
  upsertAssignment,
  deleteAssignment
};