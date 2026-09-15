const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { runByRepositoryBackend } = requireCoreModule('MVC/repositories/backend/repositoryBackendSelector');
const { getMongoCollection } = requireCoreModule('MVC/infrastructure/mongo/mongoConnection');
const { normalizeMongoDocument } = requireCoreModule('MVC/repositories/backend/mongoRepositoryUtils');

const dataPath = path.join(resolveCoreRoot(), 'data/school/notificationSendLedger.json');
const MONGO_COLLECTION = 'schoolNotificationSendLedger';
const MONGO_DOC_ID = 'notification-send-ledger';

function buildDedupeKey({
  orgId = '',
  ruleId = '',
  recipientPersonId = '',
  channel = '',
  cycleDate = '',
  semanticKey = ''
} = {}) {
  return [
    String(orgId || '').trim(),
    String(ruleId || '').trim(),
    String(recipientPersonId || '').trim(),
    String(channel || '').trim(),
    String(cycleDate || '').trim(),
    String(semanticKey || '').trim()
  ].filter(Boolean).join('::');
}

async function readFileParsed() {
  try {
    const raw = await fs.readFile(dataPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function readMongoEntries() {
  const collection = getMongoCollection(MONGO_COLLECTION);
  const row = normalizeMongoDocument(await collection.findOne({ id: MONGO_DOC_ID }));
  return Array.isArray(row?.entries) ? row.entries : [];
}

async function readAllEntries() {
  return runByRepositoryBackend({}, {
    json: async () => readFileParsed(),
    mongo: async () => readMongoEntries()
  }, 'school.notificationSendLedger.readAllEntries');
}

async function writeAllEntries(entries) {
  const payload = { entries: Array.isArray(entries) ? entries : [] };
  await runByRepositoryBackend({}, {
    json: async () => {
      await queueWrite(async () => fs.writeFile(dataPath, JSON.stringify(payload, null, 2)));
    },
    mongo: async () => {
      const collection = getMongoCollection(MONGO_COLLECTION);
      await collection.updateOne(
        { id: MONGO_DOC_ID },
        { $set: { id: MONGO_DOC_ID, entries: payload.entries, updatedAt: new Date().toISOString() } },
        { upsert: true }
      );
    }
  }, 'school.notificationSendLedger.writeAllEntries');
}

async function hasSentEntry(dedupeKey) {
  const key = String(dedupeKey || '').trim();
  if (!key) return false;
  const entries = await readAllEntries();
  return entries.some((row) => {
    if (String(row?.dedupeKey || '') !== key) return false;
    const status = String(row?.status || '').trim();
    return status === 'sent' || status === 'queued';
  });
}

async function appendEntry(entry = {}) {
  const dedupeKey = String(entry.dedupeKey || '').trim();
  if (!dedupeKey) return null;
  const entries = await readAllEntries();
  const row = {
    dedupeKey,
    orgId: String(entry.orgId || '').trim(),
    ruleId: String(entry.ruleId || '').trim(),
    runId: String(entry.runId || '').trim(),
    batchId: String(entry.batchId || '').trim(),
    recipientPersonId: String(entry.recipientPersonId || entry.teacherId || '').trim(),
    channel: String(entry.channel || '').trim(),
    cycleDate: String(entry.cycleDate || entry.sendWhenDate || '').trim(),
    status: String(entry.status || 'queued').trim(),
    recipient: String(entry.recipient || '').trim(),
    message: String(entry.message || '').trim(),
    createdAt: new Date().toISOString()
  };
  const index = entries.findIndex((item) => String(item?.dedupeKey || '') === dedupeKey);
  if (index >= 0) entries[index] = { ...entries[index], ...row };
  else entries.push(row);
  await writeAllEntries(entries);
  return row;
}

module.exports = {
  buildDedupeKey,
  readAllEntries,
  hasSentEntry,
  appendEntry
};
