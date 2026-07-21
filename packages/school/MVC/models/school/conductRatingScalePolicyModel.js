const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { runByRepositoryBackend } = requireCoreModule('MVC/repositories/backend/repositoryBackendSelector');
const { getMongoCollection } = requireCoreModule('MVC/infrastructure/mongo/mongoConnection');
const { normalizeMongoDocument } = requireCoreModule('MVC/repositories/backend/mongoRepositoryUtils');
const conductRatingScaleService = require('../../services/school/conductRatingScaleService');

const dataPath = path.join(resolveCoreRoot(), 'data/school/conductRatingScalePolicy.json');

/** Must match jsonToMongoMigrationService transform for school.conductRatingScalePolicy */
const MONGO_COLLECTION = 'schoolConductRatingScalePolicy';
const MONGO_DOC_ID = 'conduct-rating-scale-policy';

const { DEFAULT_POLICY } = conductRatingScaleService;

function orgKey(activeOrgId) {
  const k = String(activeOrgId || '').trim();
  return k || 'SYSTEM';
}

function pickStoredPolicyFields(row) {
  if (!row || typeof row !== 'object') return {};
  return {
    levels: row.levels
  };
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
    return conductRatingScaleService.resolvePolicy(DEFAULT_POLICY);
  }
  return conductRatingScaleService.resolvePolicy(
    conductRatingScaleService.normalizePolicyFromStored(pickStoredPolicyFields(row))
  );
}

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
  }, 'school.conductRatingScalePolicy.getPolicyForOrg');
}

async function savePolicyForOrg(activeOrgId, patch, auditUserId) {
  const normalized = conductRatingScaleService.normalizePolicyFromForm(patch);
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
  }, 'school.conductRatingScalePolicy.savePolicyForOrg');
  return normalized;
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
  }, 'school.conductRatingScalePolicy.removePolicyForOrg');
}

async function readPolicyDocument() {
  return runByRepositoryBackend({}, {
    json: async () => readFileParsed(),
    mongo: async () => readMongoDoc()
  }, 'school.conductRatingScalePolicy.readDocument');
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
  const resolved = conductRatingScaleService.resolvePolicy(
    conductRatingScaleService.normalizePolicyFromStored(pickStoredPolicyFields(stored))
  );
  const levels = Array.isArray(resolved?.levels) ? resolved.levels : [];
  return {
    id: key,
    orgId: key,
    levels,
    levelCount: levels.length,
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
  orgKey
};
