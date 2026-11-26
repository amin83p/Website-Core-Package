'use strict';

const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { runByRepositoryBackend } = requireCoreModule('MVC/repositories/backend/repositoryBackendSelector');
const { getMongoCollection } = requireCoreModule('MVC/infrastructure/mongo/mongoConnection');
const { normalizeMongoDocument } = requireCoreModule('MVC/repositories/backend/mongoRepositoryUtils');

const dataPath = path.join(resolveCoreRoot(), 'data/school/wordOfDayDisplaySchedule.json');
const MONGO_COLLECTION = 'schoolWordOfDayDisplaySchedule';
const MONGO_DOC_ID = 'word-of-day-display-schedule';

fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, JSON.stringify({ byOrgId: {} }, null, 2));
}

function orgKey(activeOrgId) {
  const k = String(activeOrgId || '').trim();
  return k || 'SYSTEM';
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
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

async function readDocument() {
  return runByRepositoryBackend({}, {
    json: async () => readFileParsed(),
    mongo: async () => readMongoDoc()
  }, 'school.wordOfDayDisplaySchedule.readDocument');
}

function orgScheduleFromDoc(doc, activeOrgId) {
  const byOrg = doc.byOrgId && typeof doc.byOrgId === 'object' ? doc.byOrgId : {};
  const key = orgKey(activeOrgId);
  const row = byOrg[key];
  if (!row || typeof row !== 'object') return { byDate: {} };
  const byDate = row.byDate && typeof row.byDate === 'object' ? { ...row.byDate } : {};
  return { byDate };
}

async function getScheduleForOrg(activeOrgId) {
  const doc = await readDocument();
  return orgScheduleFromDoc(doc, activeOrgId);
}

async function getScheduledEntryId(activeOrgId, dateKey) {
  if (!isDateKey(dateKey)) return null;
  const { byDate } = await getScheduleForOrg(activeOrgId);
  const slot = byDate[String(dateKey).trim()];
  if (!slot || typeof slot !== 'object') return null;
  const entryId = String(slot.entryId || '').trim();
  return entryId || null;
}

async function saveScheduleMutation(activeOrgId, mutator, auditUserId) {
  const key = orgKey(activeOrgId);
  const now = new Date().toISOString();
  const audit = {
    lastUpdateUser: String(auditUserId || 'system'),
    lastUpdateDateTime: now
  };

  await runByRepositoryBackend({}, {
    json: async () => {
      await queueWrite(async () => {
        const doc = await readFileParsed();
        if (!doc.byOrgId || typeof doc.byOrgId !== 'object') doc.byOrgId = {};
        const current = orgScheduleFromDoc(doc, activeOrgId);
        const next = mutator({ ...current.byDate });
        doc.byOrgId[key] = { byDate: next, audit };
        await fs.writeFile(dataPath, JSON.stringify(doc, null, 2));
      });
    },
    mongo: async () => {
      const collection = getMongoCollection(MONGO_COLLECTION);
      const existing = normalizeMongoDocument(await collection.findOne({ id: MONGO_DOC_ID }));
      const byOrgId = existing?.byOrgId && typeof existing.byOrgId === 'object' ? { ...existing.byOrgId } : {};
      const current = orgScheduleFromDoc({ byOrgId }, activeOrgId);
      const next = mutator({ ...current.byDate });
      byOrgId[key] = { byDate: next, audit };
      await collection.updateOne(
        { id: MONGO_DOC_ID },
        {
          $set: {
            id: MONGO_DOC_ID,
            byOrgId,
            audit: {
              lastUpdateUser: String(auditUserId || 'system'),
              lastUpdateDateTime: now
            }
          }
        },
        { upsert: true }
      );
    }
  }, 'school.wordOfDayDisplaySchedule.saveScheduleMutation');
}

async function assignDate(activeOrgId, dateKey, entryId, auditUserId) {
  const dk = String(dateKey || '').trim();
  if (!isDateKey(dk)) {
    const error = new Error('A valid date (YYYY-MM-DD) is required.');
    error.statusCode = 400;
    throw error;
  }
  const eid = String(entryId || '').trim();
  if (!eid) {
    const error = new Error('Entry id is required.');
    error.statusCode = 400;
    throw error;
  }
  const now = new Date().toISOString();
  await saveScheduleMutation(activeOrgId, (byDate) => {
    byDate[dk] = {
      entryId: eid,
      audit: {
        assignedBy: String(auditUserId || 'system'),
        assignedAt: now
      }
    };
    return byDate;
  }, auditUserId);
  return { dateKey: dk, entryId: eid };
}

async function clearDate(activeOrgId, dateKey, auditUserId) {
  const dk = String(dateKey || '').trim();
  if (!isDateKey(dk)) {
    const error = new Error('A valid date (YYYY-MM-DD) is required.');
    error.statusCode = 400;
    throw error;
  }
  await saveScheduleMutation(activeOrgId, (byDate) => {
    delete byDate[dk];
    return byDate;
  }, auditUserId);
  return { dateKey: dk, cleared: true };
}

module.exports = {
  isDateKey,
  getScheduleForOrg,
  getScheduledEntryId,
  assignDate,
  clearDate
};