const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { runByRepositoryBackend } = requireCoreModule('MVC/repositories/backend/repositoryBackendSelector');
const { getMongoCollection } = requireCoreModule('MVC/infrastructure/mongo/mongoConnection');
const { normalizeMongoDocument } = requireCoreModule('MVC/repositories/backend/mongoRepositoryUtils');
const sessionAccessPolicyService = require('../../services/school/sessionAccessPolicyService');

const dataPath = path.join(resolveCoreRoot(), 'data/school/sessionAccessPolicy.json');
const MONGO_COLLECTION = 'schoolSessionAccessPolicy';
const MONGO_DOC_ID = 'session-access-policy';
const { DEFAULT_POLICY } = sessionAccessPolicyService;

function orgKey(activeOrgId) {
  const k = String(activeOrgId || '').trim();
  return k || 'SYSTEM';
}

function pickStoredPolicyFields(row) {
  if (!row || typeof row !== 'object') return {};
  return {
    uncompletedSessionNotification: row.uncompletedSessionNotification,
    completedSessionAttendanceEdit: row.completedSessionAttendanceEdit
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
    return sessionAccessPolicyService.resolvePolicy(DEFAULT_POLICY);
  }
  return sessionAccessPolicyService.resolvePolicy(
    sessionAccessPolicyService.normalizePolicyFromStored(pickStoredPolicyFields(row))
  );
}

async function getPolicyForOrg(activeOrgId) {
  return runByRepositoryBackend({}, {
    json: async () => effectivePolicyFromDoc(await readFileParsed(), activeOrgId),
    mongo: async () => effectivePolicyFromDoc(await readMongoDoc(), activeOrgId)
  }, 'school.sessionAccessPolicy.getPolicyForOrg');
}

async function savePolicyForOrg(activeOrgId, patch, auditUserId) {
  const normalized = sessionAccessPolicyService.validatePolicyInput(patch);
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
  }, 'school.sessionAccessPolicy.savePolicyForOrg');
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
  }, 'school.sessionAccessPolicy.removePolicyForOrg');
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
  const resolved = sessionAccessPolicyService.resolvePolicy(
    sessionAccessPolicyService.normalizePolicyFromStored(pickStoredPolicyFields(stored))
  );
  return {
    id: key,
    orgId: key,
    notificationEnabled: resolved.uncompletedSessionNotification?.enabled === true,
    attendanceEditEnabled: resolved.completedSessionAttendanceEdit?.enabled === true,
    windowType: resolved.completedSessionAttendanceEdit?.windowType || '',
    status: 'stored',
    updatedAt: String(stored?.audit?.lastUpdateDateTime || '').trim(),
    audit: stored.audit || null
  };
}

async function readPolicyDocument() {
  return runByRepositoryBackend({}, {
    json: async () => readFileParsed(),
    mongo: async () => readMongoDoc()
  }, 'school.sessionAccessPolicy.readDocument');
}

module.exports = {
  DEFAULT_POLICY,
  getPolicyForOrg,
  savePolicyForOrg,
  removePolicyForOrg,
  hasStoredPolicyForOrg,
  getStoredPolicyRowForOrg,
  readPolicyDocument,
  orgKey
};
