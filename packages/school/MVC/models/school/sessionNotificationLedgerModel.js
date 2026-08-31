const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { runByRepositoryBackend } = requireCoreModule('MVC/repositories/backend/repositoryBackendSelector');
const { getMongoCollection } = requireCoreModule('MVC/infrastructure/mongo/mongoConnection');
const { normalizeMongoDocument } = requireCoreModule('MVC/repositories/backend/mongoRepositoryUtils');

const dataPath = path.join(resolveCoreRoot(), 'data/school/sessionNotificationLedger.json');
const MONGO_COLLECTION = 'schoolSessionNotificationLedger';
const MONGO_DOC_ID = 'session-notification-ledger';

function buildDedupeKey({
  orgId = '',
  sessionId = '',
  teacherId = '',
  channel = '',
  sendWhenDate = ''
} = {}) {
  return [
    String(orgId || '').trim(),
    String(sessionId || '').trim(),
    String(teacherId || '').trim(),
    String(channel || '').trim(),
    String(sendWhenDate || '').trim()
  ].join('::');
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
  }, 'school.sessionNotificationLedger.readAllEntries');
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

async function markQueuedEntriesCancelled(dedupeKey) {
  const key = String(dedupeKey || '').trim();
  if (!key) return 0;

  const applyUpdate = (entries = []) => {
    let changed = 0;
    const next = entries.map((row) => {
      if (String(row?.dedupeKey || '') !== key) return row;
      if (String(row?.status || '').trim() !== 'queued') return row;
      changed += 1;
      return { ...row, status: 'cancelled', cancelledAt: new Date().toISOString() };
    });
    return { entries: next, changed };
  };

  return runByRepositoryBackend({}, {
    json: async () => {
      let changed = 0;
      await queueWrite(async () => {
        const existing = await readFileParsed();
        const result = applyUpdate(existing);
        changed = result.changed;
        if (changed > 0) {
          await fs.mkdir(path.dirname(dataPath), { recursive: true });
          await fs.writeFile(dataPath, JSON.stringify({ entries: result.entries }, null, 2), 'utf8');
        }
      });
      return changed;
    },
    mongo: async () => {
      const collection = getMongoCollection(MONGO_COLLECTION);
      const existing = await readMongoEntries();
      const result = applyUpdate(existing);
      if (result.changed > 0) {
        await collection.updateOne(
          { id: MONGO_DOC_ID },
          {
            $set: {
              id: MONGO_DOC_ID,
              entries: result.entries,
              updatedAt: new Date().toISOString()
            }
          },
          { upsert: true }
        );
      }
      return result.changed;
    }
  }, 'school.sessionNotificationLedger.markQueuedEntriesCancelled');
}

async function appendEntry(entry = {}) {
  const row = {
    id: `SNL_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    dedupeKey: String(entry.dedupeKey || '').trim(),
    orgId: String(entry.orgId || '').trim(),
    sessionId: String(entry.sessionId || '').trim(),
    teacherId: String(entry.teacherId || '').trim(),
    channel: String(entry.channel || '').trim(),
    sendWhenDate: String(entry.sendWhenDate || '').trim(),
    status: String(entry.status || 'sent').trim(),
    recipient: String(entry.recipient || '').trim(),
    message: String(entry.message || '').trim().slice(0, 500),
    createdAt: new Date().toISOString()
  };
  if (!row.dedupeKey) return row;

  await runByRepositoryBackend({}, {
    json: async () => {
      await queueWrite(async () => {
        const entries = await readFileParsed();
        entries.push(row);
        await fs.mkdir(path.dirname(dataPath), { recursive: true });
        await fs.writeFile(dataPath, JSON.stringify({ entries }, null, 2), 'utf8');
      });
    },
    mongo: async () => {
      const collection = getMongoCollection(MONGO_COLLECTION);
      const existing = await readMongoEntries();
      const entries = [...existing, row];
      await collection.updateOne(
        { id: MONGO_DOC_ID },
        {
          $set: {
            id: MONGO_DOC_ID,
            entries,
            updatedAt: new Date().toISOString()
          }
        },
        { upsert: true }
      );
    }
  }, 'school.sessionNotificationLedger.appendEntry');
  return row;
}

module.exports = {
  buildDedupeKey,
  hasSentEntry,
  markQueuedEntriesCancelled,
  appendEntry,
  readAllEntries
};
