const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { runByRepositoryBackend } = requireCoreModule('MVC/repositories/backend/repositoryBackendSelector');
const { getMongoCollection } = requireCoreModule('MVC/infrastructure/mongo/mongoConnection');
const { normalizeMongoDocument } = requireCoreModule('MVC/repositories/backend/mongoRepositoryUtils');
const enrollmentCloseReasonPolicyService = require('../../services/school/enrollmentCloseReasonPolicyService');

const dataPath = path.join(resolveCoreRoot(), 'data/school/enrollmentCloseReasonPolicy.json');

const MONGO_COLLECTION = 'schoolEnrollmentCloseReasonPolicy';
const MONGO_DOC_ID = 'enrollment-close-reason-policy';

const { DEFAULT_POLICY } = enrollmentCloseReasonPolicyService;

function orgKey(activeOrgId) {
  const k = String(activeOrgId || '').trim();
  return k || 'SYSTEM';
}

function pickStoredPolicyFields(row) {
  if (!row || typeof row !== 'object') return {};
  return {
    reasons: row.reasons
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
    return enrollmentCloseReasonPolicyService.resolvePolicy(DEFAULT_POLICY);
  }
  return enrollmentCloseReasonPolicyService.resolvePolicy(
    enrollmentCloseReasonPolicyService.normalizePolicyFromStored(pickStoredPolicyFields(row))
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
  }, 'school.enrollmentCloseReasonPolicy.getPolicyForOrg');
}

async function savePolicyForOrg(activeOrgId, patch, auditUserId) {
  const normalized = enrollmentCloseReasonPolicyService.normalizePolicyFromForm(patch);
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
  }, 'school.enrollmentCloseReasonPolicy.savePolicyForOrg');
  return normalized;
}

module.exports = {
  DEFAULT_POLICY,
  getPolicyForOrg,
  savePolicyForOrg,
  orgKey
};
