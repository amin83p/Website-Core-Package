const fs = require('fs').promises;
const path = require('path');
const { requireCoreModule, resolveCoreRoot } = require('../../services/ielts/ieltsCoreModuleResolver');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');

const dataPath = path.join(resolveCoreRoot(), 'data/ielts/aiTokenUsages.json');
const DEFAULT_ORG_ID = 'SYSTEM';
const DEFAULT_STATUS = 'success';
const DEFAULT_BILLING_STATUS = 'unbilled';
const VALID_STATUSES = new Set(['success', 'failed']);
const VALID_BILLING_STATUSES = new Set(['unbilled', 'billed', 'waived']);

function s(value, fallback = '') {
  const out = String(value ?? '').trim();
  return out || fallback;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeStatus(value) {
  const normalized = s(value, DEFAULT_STATUS).toLowerCase();
  return VALID_STATUSES.has(normalized) ? normalized : DEFAULT_STATUS;
}

function normalizeBillingStatus(value) {
  const normalized = s(value, DEFAULT_BILLING_STATUS).toLowerCase();
  return VALID_BILLING_STATUSES.has(normalized) ? normalized : DEFAULT_BILLING_STATUS;
}

function normalizeIsoDate(value, fallback = null) {
  const raw = s(value);
  if (!raw) return fallback;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

function normalizeUsage(value = {}) {
  const usage = value && typeof value === 'object' ? value : {};
  return {
    promptTokenCount: toNumberOrNull(usage.promptTokenCount),
    candidatesTokenCount: toNumberOrNull(usage.candidatesTokenCount),
    totalTokenCount: toNumberOrNull(usage.totalTokenCount),
    cachedContentTokenCount: toNumberOrNull(usage.cachedContentTokenCount)
  };
}

function generateId() {
  return `ATU_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
}

async function ensureDataDir() {
  const dir = path.dirname(dataPath);
  try {
    await fs.access(dir);
  } catch (_) {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function getRawRows() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(dataPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.writeFile(dataPath, JSON.stringify([], null, 2));
      return [];
    }
    throw error;
  }
}

function normalizeCreatePayload(payload = {}) {
  const now = new Date().toISOString();
  const usage = normalizeUsage(payload.usage || payload);
  const consumedAt = normalizeIsoDate(payload.consumedAt, now);
  const createdAt = normalizeIsoDate(payload.createdAt, consumedAt || now) || now;
  const updatedAt = normalizeIsoDate(payload.updatedAt, createdAt) || createdAt;

  const record = {
    id: s(payload.id) || generateId(),
    orgId: s(payload.orgId, DEFAULT_ORG_ID),
    userId: s(payload.userId),
    providerId: s(payload.providerId),
    providerRecordId: s(payload.providerRecordId) || null,
    providerRecordName: s(payload.providerRecordName) || null,
    modelUsed: s(payload.modelUsed) || null,
    requestLabel: s(payload.requestLabel) || null,
    messageCount: toNumberOrNull(payload.messageCount),
    hasSystemInstruction: Boolean(payload.hasSystemInstruction),
    status: normalizeStatus(payload.status),
    errorMessage: s(payload.errorMessage) || null,
    usage,
    promptTokenCount: usage.promptTokenCount,
    candidatesTokenCount: usage.candidatesTokenCount,
    totalTokenCount: usage.totalTokenCount,
    cachedContentTokenCount: usage.cachedContentTokenCount,
    requestMeta: payload.requestMeta && typeof payload.requestMeta === 'object'
      ? payload.requestMeta
      : {},
    billingStatus: normalizeBillingStatus(payload.billingStatus),
    billingReference: s(payload.billingReference) || null,
    billingNotes: s(payload.billingNotes),
    billedAt: normalizeIsoDate(payload.billedAt, null),
    createdAt,
    updatedAt,
    consumedAt
  };

  if (!record.userId) throw new Error('AI token usage requires userId.');
  if (!record.providerId) throw new Error('AI token usage requires providerId.');
  return record;
}

function normalizeUpdatePayload(existing = {}, payload = {}) {
  const now = new Date().toISOString();
  const nextBillingStatus = normalizeBillingStatus(payload.billingStatus ?? existing.billingStatus);
  const requestedBilledAt = normalizeIsoDate(payload.billedAt, null);
  const shouldAutoSetBilledAt = nextBillingStatus === 'billed' && !requestedBilledAt && !existing.billedAt;
  const billedAt = nextBillingStatus === 'billed'
    ? (requestedBilledAt || existing.billedAt || (shouldAutoSetBilledAt ? now : null))
    : null;

  return {
    ...existing,
    billingStatus: nextBillingStatus,
    billingReference: s(payload.billingReference ?? existing.billingReference) || null,
    billingNotes: s(payload.billingNotes ?? existing.billingNotes),
    billedAt,
    updatedAt: now
  };
}

async function getAllAiTokenUsages() {
  return await getRawRows();
}

async function getAiTokenUsageById(id) {
  const rows = await getRawRows();
  const targetId = s(id);
  if (!targetId) return null;
  return rows.find((row) => s(row?.id) === targetId) || null;
}

async function addAiTokenUsage(payload = {}) {
  return queueWrite(async () => {
    const rows = await getRawRows();
    const record = normalizeCreatePayload(payload);
    rows.push(record);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return record;
  });
}

async function updateAiTokenUsage(id, payload = {}) {
  return queueWrite(async () => {
    const rows = await getRawRows();
    const targetId = s(id);
    const index = rows.findIndex((row) => s(row?.id) === targetId);
    if (index < 0) throw new Error('AI token usage record not found.');
    const existing = rows[index];
    const updated = normalizeUpdatePayload(existing, payload);
    rows[index] = updated;
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return updated;
  });
}

async function deleteAiTokenUsage(id) {
  return queueWrite(async () => {
    const rows = await getRawRows();
    const targetId = s(id);
    const next = rows.filter((row) => s(row?.id) !== targetId);
    if (next.length === rows.length) throw new Error('AI token usage record not found.');
    await fs.writeFile(dataPath, JSON.stringify(next, null, 2));
    return true;
  });
}

module.exports = {
  getAllAiTokenUsages,
  getAiTokenUsageById,
  addAiTokenUsage,
  updateAiTokenUsage,
  deleteAiTokenUsage
};
