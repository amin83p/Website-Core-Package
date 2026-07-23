const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { runByRepositoryBackend } = requireCoreModule('MVC/repositories/backend/repositoryBackendSelector');
const { getMongoCollection } = requireCoreModule('MVC/infrastructure/mongo/mongoConnection');
const { normalizeMongoDocument } = requireCoreModule('MVC/repositories/backend/mongoRepositoryUtils');

const dataPath = path.join(resolveCoreRoot(), 'data/school/attendanceMatrixPolicy.json');

/** Must match jsonToMongoMigrationService transform for school.attendanceMatrixPolicy */
const MONGO_COLLECTION = 'schoolAttendanceMatrixPolicy';
const MONGO_DOC_ID = 'attendance-matrix-policy';

const DEFAULT_POLICY = Object.freeze({
  scheduledMinutes: 180,
  disqualifyLateMinutes: 30,
  disqualifyEarlyLeaveMinutes: 30,
  disqualifyCombinedMissedMinutes: null
});

function orgKey(activeOrgId) {
  const k = String(activeOrgId || '').trim();
  return k || 'SYSTEM';
}

function newItemId() {
  return `amp_${crypto.randomBytes(6).toString('hex')}`;
}

function pickStoredPolicyFields(row) {
  if (!row || typeof row !== 'object') return {};
  return {
    scheduledMinutes: row.scheduledMinutes,
    disqualifyLateMinutes: row.disqualifyLateMinutes,
    disqualifyEarlyLeaveMinutes: row.disqualifyEarlyLeaveMinutes,
    disqualifyCombinedMissedMinutes: row.disqualifyCombinedMissedMinutes
  };
}

function applyNumericPolicyFields(input, out) {
  const n = (v, fallback) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : fallback;
  };
  if (input.scheduledMinutes !== undefined && input.scheduledMinutes !== '') {
    const s = n(input.scheduledMinutes, DEFAULT_POLICY.scheduledMinutes);
    out.scheduledMinutes = s > 0 && s <= 24 * 60 ? s : DEFAULT_POLICY.scheduledMinutes;
  }
  if (input.disqualifyLateMinutes !== undefined && input.disqualifyLateMinutes !== '') {
    const v = n(input.disqualifyLateMinutes, DEFAULT_POLICY.disqualifyLateMinutes);
    out.disqualifyLateMinutes = v >= 0 && v <= 24 * 60 ? v : DEFAULT_POLICY.disqualifyLateMinutes;
  }
  if (input.disqualifyEarlyLeaveMinutes !== undefined && input.disqualifyEarlyLeaveMinutes !== '') {
    const v = n(input.disqualifyEarlyLeaveMinutes, DEFAULT_POLICY.disqualifyEarlyLeaveMinutes);
    out.disqualifyEarlyLeaveMinutes = v >= 0 && v <= 24 * 60 ? v : DEFAULT_POLICY.disqualifyEarlyLeaveMinutes;
  }
}

/** Merge persisted row fields with defaults (no form checkbox). */
function normalizePolicyFromStored(input = {}) {
  const out = { ...DEFAULT_POLICY };
  applyNumericPolicyFields(input, out);
  const c = input.disqualifyCombinedMissedMinutes;
  if (c === null || c === undefined || c === '') {
    out.disqualifyCombinedMissedMinutes = null;
  } else {
    const v = Number(c);
    out.disqualifyCombinedMissedMinutes = Number.isFinite(v) && v > 0 && v <= 24 * 60 ? v : null;
  }
  return out;
}

/**
 * Full policy from POST body. Checkbox omitted when unchecked - combined rule off.
 */
function normalizePolicyFromForm(input = {}) {
  const out = { ...DEFAULT_POLICY };
  applyNumericPolicyFields(input, out);
  const combinedOn =
    input.useCombinedThreshold === true ||
    input.useCombinedThreshold === 'on' ||
    input.useCombinedThreshold === 'true' ||
    input.useCombinedThreshold === '1';
  if (!combinedOn) {
    out.disqualifyCombinedMissedMinutes = null;
  } else {
    const v = Number(input.disqualifyCombinedMissedMinutes);
    out.disqualifyCombinedMissedMinutes = Number.isFinite(v) && v > 0 && v <= 24 * 60 ? v : null;
  }
  return out;
}

function isLegacyFlatPolicyRow(row) {
  if (!row || typeof row !== 'object') return false;
  if (Array.isArray(row.items)) return false;
  return row.scheduledMinutes !== undefined
    || row.disqualifyLateMinutes !== undefined
    || row.disqualifyEarlyLeaveMinutes !== undefined
    || row.disqualifyCombinedMissedMinutes !== undefined;
}

function normalizePolicyItem(input = {}, opts = {}) {
  const fields = normalizePolicyFromStored(pickStoredPolicyFields(input));
  const id = String(input.id || opts.forceId || '').trim() || newItemId();
  const isDefault = input.isDefault === true || input.isDefault === 'true' || input.isDefault === 'on' || input.isDefault === '1'
    || opts.forceDefault === true;
  return {
    id,
    ...fields,
    isDefault: Boolean(isDefault)
  };
}

function ensureDefaultItem(storage) {
  const items = Array.isArray(storage.items) ? storage.items.map((item) => ({ ...item })) : [];
  if (!items.length) {
    return { items: [], audit: storage.audit || null };
  }
  const defaultCount = items.filter((item) => item.isDefault).length;
  if (defaultCount === 0) {
    const prefer180 = items.find((item) => Number(item.scheduledMinutes) === DEFAULT_POLICY.scheduledMinutes);
    (prefer180 || items[0]).isDefault = true;
  } else if (defaultCount > 1) {
    let seen = false;
    items.forEach((item) => {
      if (item.isDefault && !seen) {
        seen = true;
        return;
      }
      item.isDefault = false;
    });
  }
  const seenMins = new Set();
  const unique = [];
  for (const item of items) {
    const key = Number(item.scheduledMinutes);
    if (seenMins.has(key)) continue;
    seenMins.add(key);
    unique.push(item);
  }
  if (!unique.some((item) => item.isDefault) && unique.length) {
    unique[0].isDefault = true;
  }
  return { items: unique, audit: storage.audit || null };
}

/**
 * Normalize org storage to { items, audit? }. Migrates legacy flat rows.
 */
function normalizeOrgPolicyStorage(row) {
  if (!row || typeof row !== 'object') {
    return { items: [] };
  }
  if (Array.isArray(row.items)) {
    const items = row.items.map((item) => normalizePolicyItem(item));
    return ensureDefaultItem({ items, audit: row.audit || null });
  }
  if (isLegacyFlatPolicyRow(row)) {
    const item = normalizePolicyItem(pickStoredPolicyFields(row), { forceDefault: true });
    return ensureDefaultItem({ items: [item], audit: row.audit || null });
  }
  return { items: [], audit: row.audit || null };
}

function policyFieldsFromItem(item) {
  if (!item || typeof item !== 'object') return { ...DEFAULT_POLICY };
  return normalizePolicyFromStored(pickStoredPolicyFields(item));
}

function getDefaultItemFromStorage(storage) {
  const normalized = normalizeOrgPolicyStorage(storage);
  const items = normalized.items || [];
  if (!items.length) return null;
  return items.find((item) => item.isDefault) || items[0] || null;
}

/**
 * Exact match on scheduledMinutes; else default item; else built-in defaults.
 */
function resolvePolicyFieldsForScheduledMinutes(storage, scheduledMinutes) {
  const normalized = normalizeOrgPolicyStorage(storage);
  const items = normalized.items || [];
  const mins = Number(scheduledMinutes);
  if (Number.isFinite(mins) && mins > 0 && items.length) {
    const exact = items.find((item) => Number(item.scheduledMinutes) === mins);
    if (exact) return policyFieldsFromItem(exact);
  }
  const defaultItem = getDefaultItemFromStorage(normalized);
  if (defaultItem) return policyFieldsFromItem(defaultItem);
  return { ...DEFAULT_POLICY };
}

async function readFileParsed() {
  try {
    const raw = await fs.readFile(dataPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { byOrgId: {} };
  } catch (err) {
    if (err.code === 'ENOENT') return { byOrgId: {} };
    throw err;
  }
}

async function readMongoDoc() {
  const collection = getMongoCollection(MONGO_COLLECTION);
  const row = normalizeMongoDocument(await collection.findOne({ id: MONGO_DOC_ID }));
  if (!row || typeof row !== 'object') return { byOrgId: {} };
  const byOrg = row.byOrgId && typeof row.byOrgId === 'object' ? row.byOrgId : {};
  return { byOrgId: byOrg };
}

function effectivePolicyFromDoc(doc, activeOrgId) {
  const byOrg = doc.byOrgId && typeof doc.byOrgId === 'object' ? doc.byOrgId : {};
  const key = orgKey(activeOrgId);
  const row = byOrg[key];
  if (!row || typeof row !== 'object') {
    return { ...DEFAULT_POLICY };
  }
  const storage = normalizeOrgPolicyStorage(row);
  const defaultItem = getDefaultItemFromStorage(storage);
  return defaultItem ? policyFieldsFromItem(defaultItem) : { ...DEFAULT_POLICY };
}

function itemsFromDoc(doc, activeOrgId) {
  const byOrg = doc.byOrgId && typeof doc.byOrgId === 'object' ? doc.byOrgId : {};
  const key = orgKey(activeOrgId);
  const row = byOrg[key];
  if (!row || typeof row !== 'object') return [];
  return normalizeOrgPolicyStorage(row).items;
}

/**
 * Effective default policy for an organization (defaults if unset).
 * Backward-compatible: returns flat policy fields of the default duration item.
 */
async function getPolicyForOrg(activeOrgId) {
  return runByRepositoryBackend({}, {
    json: async () => {
      const doc = await readFileParsed();
      return effectivePolicyFromDoc(doc, activeOrgId);
    },
    mongo: async () => {
      const doc = await readMongoDoc();
      return effectivePolicyFromDoc(doc, activeOrgId);
    }
  }, 'school.attendanceMatrixPolicy.getPolicyForOrg');
}

async function listPolicyItemsForOrg(activeOrgId) {
  return runByRepositoryBackend({}, {
    json: async () => {
      const doc = await readFileParsed();
      return itemsFromDoc(doc, activeOrgId);
    },
    mongo: async () => {
      const doc = await readMongoDoc();
      return itemsFromDoc(doc, activeOrgId);
    }
  }, 'school.attendanceMatrixPolicy.listPolicyItemsForOrg');
}

/**
 * Resolve thresholds for a session length: exact item -> default item -> built-in.
 */
async function resolveOrgPolicyForScheduledMinutes(activeOrgId, scheduledMinutes) {
  return runByRepositoryBackend({}, {
    json: async () => {
      const doc = await readFileParsed();
      const byOrg = doc.byOrgId && typeof doc.byOrgId === 'object' ? doc.byOrgId : {};
      return resolvePolicyFieldsForScheduledMinutes(byOrg[orgKey(activeOrgId)], scheduledMinutes);
    },
    mongo: async () => {
      const doc = await readMongoDoc();
      const byOrg = doc.byOrgId && typeof doc.byOrgId === 'object' ? doc.byOrgId : {};
      return resolvePolicyFieldsForScheduledMinutes(byOrg[orgKey(activeOrgId)], scheduledMinutes);
    }
  }, 'school.attendanceMatrixPolicy.resolveOrgPolicyForScheduledMinutes');
}

/**
 * Parse items from settings form or JSON API body.
 */
function parsePolicyItemsFromBody(body = {}) {
  let rawItems = body.items;
  if (typeof rawItems === 'string' && rawItems.trim()) {
    try {
      rawItems = JSON.parse(rawItems);
    } catch (_) {
      throw new Error('Invalid policy items JSON.');
    }
  }
  if (!Array.isArray(rawItems) && body && typeof body === 'object') {
    const indexed = [];
    Object.keys(body).forEach((key) => {
      const m = /^items\[(\d+)\]\[(\w+)\]$/.exec(key)
        || /^item_(\d+)_(\w+)$/.exec(key);
      if (!m) return;
      const idx = Number(m[1]);
      if (!indexed[idx]) indexed[idx] = {};
      indexed[idx][m[2]] = body[key];
    });
    if (indexed.length) rawItems = indexed.filter(Boolean);
  }
  if (!Array.isArray(rawItems)) {
    if (isLegacyFlatPolicyRow(body) || body.scheduledMinutes !== undefined) {
      rawItems = [{ ...normalizePolicyFromForm(body), isDefault: true }];
    } else {
      rawItems = [];
    }
  }
  return rawItems;
}

function normalizePolicyItemsForSave(rawItems) {
  const items = (Array.isArray(rawItems) ? rawItems : []).map((item) => {
    const combinedOn =
      item.useCombinedThreshold === true
      || item.useCombinedThreshold === 'on'
      || item.useCombinedThreshold === 'true'
      || item.useCombinedThreshold === '1'
      || (item.disqualifyCombinedMissedMinutes !== null
        && item.disqualifyCombinedMissedMinutes !== undefined
        && item.disqualifyCombinedMissedMinutes !== '');
    const fields = normalizePolicyFromStored({
      ...item,
      disqualifyCombinedMissedMinutes: combinedOn
        ? item.disqualifyCombinedMissedMinutes
        : null
    });
    return normalizePolicyItem({
      id: item.id,
      ...fields,
      isDefault: item.isDefault
    });
  });
  if (!items.length) {
    return ensureDefaultItem({
      items: [normalizePolicyItem({ ...DEFAULT_POLICY, isDefault: true })]
    }).items;
  }
  const mins = items.map((item) => Number(item.scheduledMinutes));
  if (new Set(mins).size !== mins.length) {
    throw new Error('Each duration item must have a unique scheduled minutes value.');
  }
  return ensureDefaultItem({ items }).items;
}

async function savePolicyItemsForOrg(activeOrgId, rawItems, auditUserId) {
  const items = normalizePolicyItemsForSave(rawItems);
  const stored = {
    items,
    audit: {
      lastUpdateUser: String(auditUserId || 'system'),
      lastUpdateDateTime: new Date().toISOString()
    }
  };
  await runByRepositoryBackend({}, {
    json: async () => {
      await queueWrite(async () => {
        const doc = await readFileParsed();
        if (!doc.byOrgId || typeof doc.byOrgId !== 'object') doc.byOrgId = {};
        doc.byOrgId[orgKey(activeOrgId)] = stored;
        await fs.mkdir(path.dirname(dataPath), { recursive: true });
        await fs.writeFile(dataPath, JSON.stringify(doc, null, 2), 'utf8');
      });
    },
    mongo: async () => {
      const collection = getMongoCollection(MONGO_COLLECTION);
      const existing = await readMongoDoc();
      if (!existing.byOrgId || typeof existing.byOrgId !== 'object') existing.byOrgId = {};
      const byOrgId = { ...existing.byOrgId };
      byOrgId[orgKey(activeOrgId)] = stored;
      const nowIso = new Date().toISOString();
      await collection.updateOne(
        { id: MONGO_DOC_ID },
        {
          $set: {
            id: MONGO_DOC_ID,
            byOrgId,
            updatedAt: nowIso
          }
        },
        { upsert: true }
      );
    }
  }, 'school.attendanceMatrixPolicy.savePolicyItemsForOrg');
  return items;
}

/** Prefer savePolicyItemsForOrg — still saves as a single default item. */
async function savePolicyForOrg(activeOrgId, patch, auditUserId) {
  const normalized = normalizePolicyFromForm(patch);
  const items = await savePolicyItemsForOrg(
    activeOrgId,
    [{ ...normalized, isDefault: true, id: patch.id }],
    auditUserId
  );
  return items[0] ? policyFieldsFromItem(items[0]) : normalized;
}

async function removePolicyForOrg(activeOrgId) {
  const key = orgKey(activeOrgId);
  return runByRepositoryBackend({}, {
    json: async () => {
      let removed = 0;
      await queueWrite(async () => {
        const doc = await readFileParsed();
        if (doc.byOrgId && typeof doc.byOrgId === 'object' && Object.prototype.hasOwnProperty.call(doc.byOrgId, key)) {
          delete doc.byOrgId[key];
          removed = 1;
          await fs.mkdir(path.dirname(dataPath), { recursive: true });
          await fs.writeFile(dataPath, JSON.stringify(doc, null, 2), 'utf8');
        }
      });
      return { removed };
    },
    mongo: async () => {
      const collection = getMongoCollection(MONGO_COLLECTION);
      const existing = await collection.findOne({ id: MONGO_DOC_ID });
      const byOrg = existing?.byOrgId && typeof existing.byOrgId === 'object' ? existing.byOrgId : {};
      if (!Object.prototype.hasOwnProperty.call(byOrg, key)) {
        return { removed: 0 };
      }
      const nowIso = new Date().toISOString();
      await collection.updateOne(
        { id: MONGO_DOC_ID },
        { $unset: { [`byOrgId.${key}`]: '' }, $set: { updatedAt: nowIso } }
      );
      return { removed: 1 };
    }
  }, 'school.attendanceMatrixPolicy.removePolicyForOrg');
}

async function readPolicyDocument() {
  return runByRepositoryBackend({}, {
    json: async () => readFileParsed(),
    mongo: async () => readMongoDoc()
  }, 'school.attendanceMatrixPolicy.readDocument');
}

async function hasStoredPolicyForOrg(activeOrgId) {
  const key = orgKey(activeOrgId);
  const doc = await readPolicyDocument();
  const byOrg = doc?.byOrgId && typeof doc.byOrgId === 'object' ? doc.byOrgId : {};
  return Object.prototype.hasOwnProperty.call(byOrg, key)
    && byOrg[key]
    && typeof byOrg[key] === 'object';
}

async function getStoredPolicyRowForOrg(activeOrgId) {
  const key = orgKey(activeOrgId);
  const doc = await readPolicyDocument();
  const byOrg = doc?.byOrgId && typeof doc.byOrgId === 'object' ? doc.byOrgId : {};
  const stored = byOrg[key];
  if (!stored || typeof stored !== 'object') return null;
  const storage = normalizeOrgPolicyStorage(stored);
  const defaultItem = getDefaultItemFromStorage(storage);
  const normalized = defaultItem ? policyFieldsFromItem(defaultItem) : { ...DEFAULT_POLICY };
  return {
    id: key,
    orgId: key,
    ...normalized,
    items: storage.items,
    status: 'stored',
    updatedAt: String(stored?.audit?.lastUpdateDateTime || storage.audit?.lastUpdateDateTime || '').trim(),
    audit: stored.audit || storage.audit || null
  };
}

module.exports = {
  DEFAULT_POLICY,
  getPolicyForOrg,
  listPolicyItemsForOrg,
  resolveOrgPolicyForScheduledMinutes,
  resolvePolicyFieldsForScheduledMinutes,
  normalizeOrgPolicyStorage,
  parsePolicyItemsFromBody,
  normalizePolicyItemsForSave,
  savePolicyItemsForOrg,
  savePolicyForOrg,
  removePolicyForOrg,
  hasStoredPolicyForOrg,
  getStoredPolicyRowForOrg,
  normalizePolicyPatch: normalizePolicyFromForm,
  normalizePolicyFromStored,
  normalizePolicyFromForm,
  pickStoredPolicyFields,
  policyFieldsFromItem,
  orgKey
};
