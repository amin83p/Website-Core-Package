'use strict';

const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { runByRepositoryBackend } = requireCoreModule('MVC/repositories/backend/repositoryBackendSelector');
const { getMongoCollection } = requireCoreModule('MVC/infrastructure/mongo/mongoConnection');
const { normalizeMongoDocument } = requireCoreModule('MVC/repositories/backend/mongoRepositoryUtils');
const schedulingTimePolicyService = require('../../services/school/schedulingTimePolicyService');

const dataPath = path.join(resolveCoreRoot(), 'data/school/schedulingTimePolicy.json');

const MONGO_COLLECTION = 'schoolSchedulingTimePolicy';
const MONGO_DOC_ID = 'scheduling-time-policy';

function orgKey(activeOrgId) {
  const k = String(activeOrgId || '').trim();
  return k || 'SYSTEM';
}

function pickStoredPolicyFields(row) {
  if (!row || typeof row !== 'object') return {};
  return {
    dayBounds: row.dayBounds,
    timeFrames: row.timeFrames
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
    return schedulingTimePolicyService.resolvePolicy({});
  }
  return schedulingTimePolicyService.resolvePolicy(
    schedulingTimePolicyService.normalizePolicyFromStored(pickStoredPolicyFields(row))
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
  }, 'school.schedulingTimePolicy.getPolicyForOrg');
}

async function savePolicyForOrg(activeOrgId, patch, auditUserId) {
  const normalized = schedulingTimePolicyService.validatePolicyInput(patch);
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
  }, 'school.schedulingTimePolicy.savePolicyForOrg');
  return schedulingTimePolicyService.resolvePolicy(normalized);
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
  }, 'school.schedulingTimePolicy.removePolicyForOrg');
}

module.exports = {
  getPolicyForOrg,
  savePolicyForOrg,
  removePolicyForOrg,
  orgKey
};
