const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { runByRepositoryBackend } = requireCoreModule('MVC/repositories/backend/repositoryBackendSelector');
const { getMongoCollection } = requireCoreModule('MVC/infrastructure/mongo/mongoConnection');
const { normalizeMongoDocument } = requireCoreModule('MVC/repositories/backend/mongoRepositoryUtils');
const schedulePersonNoteService = require('../../services/school/schedulePersonNoteService');

const dataPath = path.join(resolveCoreRoot(), 'data/school/schedulePersonNotes.json');

/** Must match jsonToMongoMigrationService transform for school.schedulePersonNotes */
const MONGO_COLLECTION = 'schoolSchedulePersonNotes';
const MONGO_DOC_ID = 'schedule-person-notes';

function orgKey(activeOrgId) {
  const k = String(activeOrgId || '').trim();
  return k || 'SYSTEM';
}

function personKey(personId) {
  return schedulePersonNoteService.normalizePersonId(personId);
}

function emptyDoc() {
  return { byOrgId: {} };
}

function cloneDoc(doc) {
  const source = doc && typeof doc === 'object' ? doc : emptyDoc();
  const byOrgId = source.byOrgId && typeof source.byOrgId === 'object' ? source.byOrgId : {};
  return { byOrgId: JSON.parse(JSON.stringify(byOrgId)) };
}

async function readFileParsed() {
  try {
    const raw = await fs.readFile(dataPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : emptyDoc();
  } catch (err) {
    if (err.code === 'ENOENT') return emptyDoc();
    throw err;
  }
}

async function readMongoDoc() {
  const collection = getMongoCollection(MONGO_COLLECTION);
  const row = normalizeMongoDocument(await collection.findOne({ id: MONGO_DOC_ID }));
  if (!row || typeof row !== 'object') return emptyDoc();
  const byOrg = row.byOrgId && typeof row.byOrgId === 'object' ? row.byOrgId : {};
  return { byOrgId: byOrg };
}

function readNoteFromDoc(doc, activeOrgId, personId) {
  const byOrg = doc.byOrgId && typeof doc.byOrgId === 'object' ? doc.byOrgId : {};
  const orgRow = byOrg[orgKey(activeOrgId)];
  const byPersonId = orgRow?.byPersonId && typeof orgRow.byPersonId === 'object' ? orgRow.byPersonId : {};
  const stored = byPersonId[personKey(personId)] || null;
  return schedulePersonNoteService.toNoteDto(personId, stored);
}

async function getNoteForPerson(activeOrgId, personId) {
  const pid = personKey(personId);
  if (!pid) return schedulePersonNoteService.emptyNoteDto();
  return runByRepositoryBackend({}, {
    json: async () => {
      const doc = await readFileParsed();
      return readNoteFromDoc(doc, activeOrgId, pid);
    },
    mongo: async () => {
      const doc = await readMongoDoc();
      return readNoteFromDoc(doc, activeOrgId, pid);
    }
  }, 'school.schedulePersonNotes.getNoteForPerson');
}

function applyNoteToDoc(doc, activeOrgId, personId, stored) {
  const next = cloneDoc(doc);
  const key = orgKey(activeOrgId);
  const pid = personKey(personId);
  if (!next.byOrgId[key] || typeof next.byOrgId[key] !== 'object') {
    next.byOrgId[key] = { byPersonId: {} };
  }
  if (!next.byOrgId[key].byPersonId || typeof next.byOrgId[key].byPersonId !== 'object') {
    next.byOrgId[key].byPersonId = {};
  }
  if (!stored) {
    delete next.byOrgId[key].byPersonId[pid];
  } else {
    next.byOrgId[key].byPersonId[pid] = stored;
  }
  return next;
}

async function persistDoc(doc) {
  await runByRepositoryBackend({}, {
    json: async () => {
      await queueWrite(async () => {
        await fs.mkdir(path.dirname(dataPath), { recursive: true });
        await fs.writeFile(dataPath, JSON.stringify(doc, null, 2), 'utf8');
      });
    },
    mongo: async () => {
      const collection = getMongoCollection(MONGO_COLLECTION);
      const nowIso = new Date().toISOString();
      await collection.updateOne(
        { id: MONGO_DOC_ID },
        {
          $set: {
            id: MONGO_DOC_ID,
            byOrgId: doc.byOrgId || {},
            updatedAt: nowIso
          }
        },
        { upsert: true }
      );
    }
  }, 'school.schedulePersonNotes.persistDoc');
}

async function saveNoteForPerson(activeOrgId, personId, noteText, auditUserId) {
  const pid = personKey(personId);
  if (!pid) throw new Error('Person is required.');
  const stored = schedulePersonNoteService.buildStoredNote(noteText, auditUserId);

  await runByRepositoryBackend({}, {
    json: async () => {
      const doc = applyNoteToDoc(await readFileParsed(), activeOrgId, pid, stored);
      await persistDoc(doc);
    },
    mongo: async () => {
      const doc = applyNoteToDoc(await readMongoDoc(), activeOrgId, pid, stored);
      await persistDoc(doc);
    }
  }, 'school.schedulePersonNotes.saveNoteForPerson');

  return stored
    ? schedulePersonNoteService.toNoteDto(pid, stored)
    : schedulePersonNoteService.emptyNoteDto(pid);
}

module.exports = {
  getNoteForPerson,
  saveNoteForPerson,
  orgKey,
  MONGO_COLLECTION,
  MONGO_DOC_ID
};
