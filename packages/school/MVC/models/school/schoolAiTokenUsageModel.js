'use strict';

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const {
  isPlainObject,
  cleanString,
  cleanId,
  normalizeBoolean,
  generateDatedId
} = require('../../services/school/schoolAiModelUtils');

const DATA_PATH = path.join(resolveCoreRoot(), 'data/school/schoolAiTokenUsage.json');
const ID_PREFIX = 'SCHAIUSG';

if (!fsSync.existsSync(DATA_PATH)) fsSync.writeFileSync(DATA_PATH, '[]');

function cleanNonNegativeInt(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

const PAYLOAD_JSON_MAX_CHARS = 65536;

function sanitizeJsonPayload(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!isPlainObject(value) && !Array.isArray(value)) return null;
  try {
    const text = JSON.stringify(value);
    if (text.length <= PAYLOAD_JSON_MAX_CHARS) return JSON.parse(text);
    return { _payloadTruncated: true, preview: text.slice(0, 8000) };
  } catch (_) {
    return null;
  }
}

function normalizeUsageRecord(record = {}, strict = false) {
  const input = isPlainObject(record) ? record : {};
  const orgId = cleanId(input.orgId, { max: 120, allowEmpty: false });
  const userId = cleanId(input.userId, { max: 120, allowEmpty: true }) || '';
  const serviceKey = cleanString(input.serviceKey, { max: 120, allowEmpty: true }) || '';
  const statusToken = cleanString(input.status, { max: 20, allowEmpty: true }).toLowerCase();
  const status = statusToken === 'failed' ? 'failed' : 'success';
  if (strict && !orgId) throw new Error('Organization is required.');
  const now = new Date().toISOString();
  return {
    id: cleanId(input.id, { max: 120, allowEmpty: true }) || '',
    orgId,
    userId,
    serviceKey,
    providerRecordId: cleanId(input.providerRecordId, { max: 120, allowEmpty: true }) || '',
    providerId: cleanString(input.providerId, { max: 80, allowEmpty: true }) || '',
    modelId: cleanString(input.modelId, { max: 220, allowEmpty: true }) || '',
    status,
    errorMessage: cleanString(input.errorMessage, { max: 2000, allowEmpty: true }) || '',
    promptTokenCount: cleanNonNegativeInt(input.promptTokenCount, null),
    completionTokenCount: cleanNonNegativeInt(input.completionTokenCount, null),
    totalTokenCount: cleanNonNegativeInt(input.totalTokenCount, null),
    traceId: cleanString(input.traceId, { max: 120, allowEmpty: true }) || '',
    durationMs: cleanNonNegativeInt(input.durationMs, null),
    requestSummary: cleanString(input.requestSummary, { max: 500, allowEmpty: true }) || '',
    responseSummary: cleanString(input.responseSummary, { max: 500, allowEmpty: true }) || '',
    usageSource: cleanString(input.usageSource, { max: 80, allowEmpty: true }) || '',
    reportContext: cleanString(input.reportContext, { max: 20, allowEmpty: true }) || '',
    reportInstanceId: cleanId(input.reportInstanceId, { max: 120, allowEmpty: true }) || '',
    reportAssignmentId: cleanId(input.reportAssignmentId, { max: 120, allowEmpty: true }) || '',
    reportAssignmentRowId: cleanId(input.reportAssignmentRowId, { max: 120, allowEmpty: true }) || '',
    reportTeacherId: cleanId(input.reportTeacherId, { max: 120, allowEmpty: true }) || '',
    reportTemplateId: cleanId(input.reportTemplateId, { max: 120, allowEmpty: true }) || '',
    bindingRowId: cleanId(input.bindingRowId, { max: 120, allowEmpty: true }) || '',
    inputPayload: sanitizeJsonPayload(input.inputPayload),
    outputPayload: sanitizeJsonPayload(input.outputPayload),
    createdAt: cleanString(input.createdAt, { max: 80, allowEmpty: true }) || now
  };
}

async function getAllUsage() {
  const raw = await fs.readFile(DATA_PATH, 'utf8');
  const parsed = JSON.parse(raw || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

async function getUsageById(id) {
  const rows = await getAllUsage();
  return rows.find((row) => idsEqual(row?.id, id)) || null;
}

async function appendUsage(payload = {}) {
  return queueWrite(async () => {
    const rows = await getAllUsage();
    const normalized = normalizeUsageRecord(payload, true);
    normalized.id = normalized.id || generateDatedId(ID_PREFIX, rows);
    rows.push(normalized);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

async function patchUsageById(id, patch = {}) {
  return queueWrite(async () => {
    const rows = await getAllUsage();
    const index = rows.findIndex((row) => idsEqual(row?.id, id));
    if (index < 0) throw new Error('Usage record not found.');
    const merged = normalizeUsageRecord({ ...rows[index], ...patch, id: rows[index].id }, false);
    rows[index] = merged;
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return merged;
  });
}

module.exports = {
  normalizeUsageRecord,
  sanitizeJsonPayload,
  getAllUsage,
  getUsageById,
  appendUsage,
  patchUsageById
};