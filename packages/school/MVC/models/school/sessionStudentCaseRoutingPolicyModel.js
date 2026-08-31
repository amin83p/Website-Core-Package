const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { runByRepositoryBackend } = requireCoreModule('MVC/repositories/backend/repositoryBackendSelector');
const { getMongoCollection } = requireCoreModule('MVC/infrastructure/mongo/mongoConnection');
const { normalizeMongoDocument } = requireCoreModule('MVC/repositories/backend/mongoRepositoryUtils');

const dataPath = path.join(resolveCoreRoot(), 'data/school/sessionStudentCaseRoutingPolicy.json');
const MONGO_COLLECTION = 'schoolSessionStudentCaseRoutingPolicy';
const MONGO_DOC_ID = 'session-student-case-routing-policy';

fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
if (!fsSync.existsSync(dataPath)) fsSync.writeFileSync(dataPath, JSON.stringify({ byOrgId: {} }, null, 2));

function orgKey(activeOrgId) {
  const key = String(activeOrgId || '').trim();
  return key || 'SYSTEM';
}

async function readFileParsed() {
  try {
    const raw = await fs.readFile(dataPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { byOrgId: {} };
  } catch (error) {
    if (error.code === 'ENOENT') return { byOrgId: {} };
    throw error;
  }
}

async function readMongoDoc() {
  const collection = getMongoCollection(MONGO_COLLECTION);
  const row = normalizeMongoDocument(await collection.findOne({ id: MONGO_DOC_ID }));
  if (!row || typeof row !== 'object') return { byOrgId: {} };
  const byOrg = row.byOrgId && typeof row.byOrgId === 'object' ? row.byOrgId : {};
  return { byOrgId: byOrg };
}

async function readPolicyDocument() {
  return runByRepositoryBackend({}, {
    json: async () => readFileParsed(),
    mongo: async () => readMongoDoc()
  }, 'school.sessionStudentCaseRoutingPolicy.readPolicyDocument');
}

async function writePolicyDocument(mutator) {
  await runByRepositoryBackend({}, {
    json: async () => {
      await queueWrite(async () => {
        const doc = await readFileParsed();
        const next = await mutator(doc);
        await fs.mkdir(path.dirname(dataPath), { recursive: true });
        await fs.writeFile(dataPath, JSON.stringify(next, null, 2), 'utf8');
      });
    },
    mongo: async () => {
      const collection = getMongoCollection(MONGO_COLLECTION);
      const existing = await readMongoDoc();
      const next = await mutator(existing);
      const nowIso = new Date().toISOString();
      await collection.updateOne(
        { id: MONGO_DOC_ID },
        {
          $set: {
            id: MONGO_DOC_ID,
            byOrgId: next.byOrgId || {},
            updatedAt: nowIso
          }
        },
        { upsert: true }
      );
    }
  }, 'school.sessionStudentCaseRoutingPolicy.writePolicyDocument');
}

async function getOrgPolicyRow(activeOrgId) {
  const doc = await readPolicyDocument();
  const byOrg = doc.byOrgId && typeof doc.byOrgId === 'object' ? doc.byOrgId : {};
  const row = byOrg[orgKey(activeOrgId)];
  return row && typeof row === 'object' ? row : { categories: {} };
}

async function saveOrgPolicyRow(activeOrgId, row, auditUserId = '') {
  const normalized = row && typeof row === 'object' ? row : { categories: {} };
  await writePolicyDocument(async (doc) => {
    const next = doc && typeof doc === 'object' ? { ...doc } : { byOrgId: {} };
    if (!next.byOrgId || typeof next.byOrgId !== 'object') next.byOrgId = {};
    next.byOrgId[orgKey(activeOrgId)] = {
      ...normalized,
      audit: {
        lastUpdateUser: String(auditUserId || 'system'),
        lastUpdateDateTime: new Date().toISOString()
      }
    };
    return next;
  });
  return normalized;
}

module.exports = {
  orgKey,
  getOrgPolicyRow,
  saveOrgPolicyRow
};
