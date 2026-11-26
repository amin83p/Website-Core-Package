const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { runByRepositoryBackend } = requireCoreModule('MVC/repositories/backend/repositoryBackendSelector');
const { getMongoCollection } = requireCoreModule('MVC/infrastructure/mongo/mongoConnection');
const { normalizeMongoDocument } = requireCoreModule('MVC/repositories/backend/mongoRepositoryUtils');
const wordOfDayPolicyService = require('../../services/school/wordOfDayPolicyService');

const dataPath = path.join(resolveCoreRoot(), 'data/school/wordOfDayPolicy.json');
const MONGO_COLLECTION = 'schoolWordOfDayPolicy';
const MONGO_DOC_ID = 'word-of-day-policy';

fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, JSON.stringify({ byOrgId: {} }, null, 2));
}

function orgKey(activeOrgId) {
  const k = String(activeOrgId || '').trim();
  return k || 'SYSTEM';
}

function pickStoredPolicyFields(row) {
  if (!row || typeof row !== 'object') return {};
  return {
    schoolDashboardEnabled: row.schoolDashboardEnabled,
    publicHomeEnabled: row.publicHomeEnabled,
    publicSourceOrgId: row.publicSourceOrgId
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
    return wordOfDayPolicyService.resolvePolicy(wordOfDayPolicyService.DEFAULT_POLICY);
  }
  return wordOfDayPolicyService.resolvePolicy(
    wordOfDayPolicyService.normalizePolicyFromStored(pickStoredPolicyFields(row))
  );
}

async function getPolicyForOrg(activeOrgId) {
  return runByRepositoryBackend({}, {
    json: async () => effectivePolicyFromDoc(await readFileParsed(), activeOrgId),
    mongo: async () => effectivePolicyFromDoc(await readMongoDoc(), activeOrgId)
  }, 'school.wordOfDayPolicy.getPolicyForOrg');
}

async function getGlobalPublicPolicy() {
  const doc = await runByRepositoryBackend({}, {
    json: async () => readFileParsed(),
    mongo: async () => readMongoDoc()
  }, 'school.wordOfDayPolicy.getGlobalPublicPolicy');
  const byOrg = doc.byOrgId && typeof doc.byOrgId === 'object' ? doc.byOrgId : {};
  for (const row of Object.values(byOrg)) {
    const policy = wordOfDayPolicyService.normalizePolicyFromStored(pickStoredPolicyFields(row));
    if (policy.publicHomeEnabled && policy.publicSourceOrgId) {
      return wordOfDayPolicyService.resolvePolicy(policy);
    }
  }
  return wordOfDayPolicyService.resolvePolicy({ publicHomeEnabled: false });
}

async function savePolicyForOrg(activeOrgId, patch, auditUserId) {
  const normalized = wordOfDayPolicyService.validatePolicyInput(patch);
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
        await fs.writeFile(dataPath, JSON.stringify(doc, null, 2));
      });
      return normalized;
    },
    mongo: async () => {
      const collection = getMongoCollection(MONGO_COLLECTION);
      const existing = normalizeMongoDocument(await collection.findOne({ id: MONGO_DOC_ID }));
      const byOrgId = existing?.byOrgId && typeof existing.byOrgId === 'object' ? { ...existing.byOrgId } : {};
      byOrgId[orgKey(activeOrgId)] = {
        ...normalized,
        audit: {
          lastUpdateUser: String(auditUserId || 'system'),
          lastUpdateDateTime: new Date().toISOString()
        }
      };
      const next = {
        id: MONGO_DOC_ID,
        byOrgId,
        audit: {
          lastUpdateUser: String(auditUserId || 'system'),
          lastUpdateDateTime: new Date().toISOString()
        }
      };
      await collection.updateOne(
        { id: MONGO_DOC_ID },
        { $set: next },
        { upsert: true }
      );
      return normalized;
    }
  }, 'school.wordOfDayPolicy.savePolicyForOrg');
  return normalized;
}

module.exports = {
  getPolicyForOrg,
  getGlobalPublicPolicy,
  savePolicyForOrg
};