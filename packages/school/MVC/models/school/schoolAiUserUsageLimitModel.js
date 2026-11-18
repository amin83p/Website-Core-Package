'use strict';

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const {
  USAGE_PERIOD_TYPES,
  isPlainObject,
  hasOwn,
  cleanString,
  cleanId,
  normalizeBoolean,
  generateDatedId,
  buildAudit
} = require('../../services/school/schoolAiModelUtils');

const DATA_PATH = path.join(resolveCoreRoot(), 'data/school/schoolAiUserUsageLimits.json');
const ID_PREFIX = 'SCHAILIM';

if (!fsSync.existsSync(DATA_PATH)) fsSync.writeFileSync(DATA_PATH, '[]');

function normalizePeriodType(value) {
  const token = cleanString(value, { max: 20, allowEmpty: true }).toLowerCase();
  return USAGE_PERIOD_TYPES.includes(token) ? token : 'monthly';
}

function normalizeAppliesTo(value) {
  const token = cleanString(value, { max: 120, allowEmpty: true }) || 'all_services';
  if (token === 'all_services') return 'all_services';
  return token;
}

function cleanPositiveInt(value, fallback = 0) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function normalizeLimitRecord(record = {}, existing = null, strict = false) {
  const input = isPlainObject(record) ? record : {};
  const base = isPlainObject(existing) ? existing : {};
  const orgId = cleanId(input.orgId || base.orgId, { max: 120, allowEmpty: false });
  const userId = cleanId(input.userId || base.userId, { max: 120, allowEmpty: false });
  const periodType = normalizePeriodType(input.periodType || base.periodType);
  const appliesTo = normalizeAppliesTo(input.appliesTo || base.appliesTo);
  const maxTotalTokens = cleanPositiveInt(input.maxTotalTokens, 0);
  const maxRequestCount = cleanPositiveInt(input.maxRequestCount, 0);
  const isActive = hasOwn(input, 'isActive') ? normalizeBoolean(input.isActive, true) : normalizeBoolean(base.isActive, true);
  const notes = cleanString(input.notes, { max: 4000, allowEmpty: true }) || '';
  const audit = buildAudit(input.lastUpdateUser, input.audit || base.audit);
  if (strict) {
    if (!orgId) throw new Error('Organization is required.');
    if (!userId) throw new Error('User is required.');
    if (!maxTotalTokens && !maxRequestCount) throw new Error('Set at least one limit (tokens or requests).');
  }
  return {
    ...base,
    id: cleanId(input.id || base.id, { max: 120, allowEmpty: true }) || '',
    orgId,
    userId,
    periodType,
    appliesTo,
    maxTotalTokens,
    maxRequestCount,
    isActive,
    notes,
    audit,
    updatedAt: new Date().toISOString()
  };
}

async function getAllLimits() {
  const raw = await fs.readFile(DATA_PATH, 'utf8');
  const parsed = JSON.parse(raw || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

async function getLimitById(id) {
  const rows = await getAllLimits();
  return rows.find((row) => idsEqual(row?.id, id)) || null;
}

async function upsertLimit(payload = {}) {
  return queueWrite(async () => {
    const rows = await getAllLimits();
    const draft = normalizeLimitRecord(payload, null, true);
    const index = rows.findIndex((row) => (
      idsEqual(row?.orgId, draft.orgId)
      && idsEqual(row?.userId, draft.userId)
      && String(row?.periodType) === draft.periodType
      && String(row?.appliesTo) === draft.appliesTo
    ));
    if (index >= 0) {
      const merged = normalizeLimitRecord(draft, rows[index], true);
      merged.id = rows[index].id;
      rows[index] = merged;
      await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
      return merged;
    }
    draft.id = generateDatedId(ID_PREFIX, rows);
    rows.push(draft);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return draft;
  });
}

async function deleteLimit(id) {
  return queueWrite(async () => {
    const rows = await getAllLimits();
    const next = rows.filter((row) => !idsEqual(row?.id, id));
    if (next.length === rows.length) throw new Error('Usage limit not found.');
    await fs.writeFile(DATA_PATH, JSON.stringify(next, null, 2));
    return true;
  });
}

module.exports = {
  normalizeLimitRecord,
  getAllLimits,
  getLimitById,
  upsertLimit,
  deleteLimit
};