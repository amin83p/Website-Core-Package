const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const path = require('path');
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
 * Full policy from POST body. Checkbox omitted when unchecked â†’ combined rule off.
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
  return normalizePolicyFromStored(pickStoredPolicyFields(row));
}

/**
 * Effective policy for an organization (defaults if unset).
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

async function savePolicyForOrg(activeOrgId, patch, auditUserId) {
  const normalized = normalizePolicyFromForm(patch);
  await runByRepositoryBackend({}, {
    json: async () => {
      await queueWrite(async () => {
        const doc = await readFileParsed();
        if (!doc.byOrgId || typeof doc.byOrgId !== 'object') doc.byOrgId = {};
        doc.byOrgId[orgKey(activeOrgId)] = {
          ...normalized,
          audit: {
            lastUpdateUser: String(auditUserId || 'system'),
            lastUpdateDateTime: new Date().toISOString()
          }
        };
        await fs.mkdir(path.dirname(dataPath), { recursive: true });
        await fs.writeFile(dataPath, JSON.stringify(doc, null, 2), 'utf8');
      });
    },
    mongo: async () => {
      const collection = getMongoCollection(MONGO_COLLECTION);
      const existing = await readMongoDoc();
      if (!existing.byOrgId || typeof existing.byOrgId !== 'object') existing.byOrgId = {};
      const byOrgId = { ...existing.byOrgId };
      byOrgId[orgKey(activeOrgId)] = {
        ...normalized,
        audit: {
          lastUpdateUser: String(auditUserId || 'system'),
          lastUpdateDateTime: new Date().toISOString()
        }
      };
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
  }, 'school.attendanceMatrixPolicy.savePolicyForOrg');
  return normalized;
}

/**
 * Remove stored org-specific policy (JSON file or Mongo singleton). Used by sample-data / org reset tools.
 */
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
  const normalized = normalizePolicyFromStored(pickStoredPolicyFields(stored));
  return {
    id: key,
    orgId: key,
    ...normalized,
    status: 'stored',
    updatedAt: String(stored?.audit?.lastUpdateDateTime || '').trim(),
    audit: stored.audit || null
  };
}

module.exports = {
  DEFAULT_POLICY,
  getPolicyForOrg,
  savePolicyForOrg,
  removePolicyForOrg,
  hasStoredPolicyForOrg,
  getStoredPolicyRowForOrg,
  normalizePolicyPatch: normalizePolicyFromForm,
  normalizePolicyFromStored,
  normalizePolicyFromForm,
  pickStoredPolicyFields,
  orgKey
};


