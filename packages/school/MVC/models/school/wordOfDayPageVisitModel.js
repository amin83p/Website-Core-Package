'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { runByRepositoryBackend } = requireCoreModule('MVC/repositories/backend/repositoryBackendSelector');
const { getMongoCollection } = requireCoreModule('MVC/infrastructure/mongo/mongoConnection');
const { normalizeMongoDocument } = requireCoreModule('MVC/repositories/backend/mongoRepositoryUtils');

const dataPath = path.join(resolveCoreRoot(), 'data/school/wordOfDayPageVisits.json');
const MONGO_COLLECTION = 'schoolWordOfDayPageVisits';
const MONGO_DOC_ID = 'word-of-day-page-visits';
const MIN_DURATION_MS = 3000;

fs.mkdirSync(path.dirname(dataPath), { recursive: true });
if (!fs.existsSync(dataPath)) {
  fs.writeFileSync(dataPath, JSON.stringify({ entries: [] }, null, 2));
}

function sanitizeVoterDisplayName(value) {
  if (value === undefined || value === null) return '';
  const text = String(value).replace(/\0/g, '').trim();
  if (!text) return '';
  return text.length > 160 ? text.slice(0, 160) : text;
}

function buildDedupeKey({ entryId = '', viewSessionId = '' } = {}) {
  const entry = String(entryId || '').trim();
  const session = String(viewSessionId || '').trim();
  if (!entry || !session) return '';
  return `visit::${entry}::${session}`;
}

async function readFileParsed() {
  try {
    const raw = await fsPromises.readFile(dataPath, 'utf8');
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
  }, 'school.wordOfDayPageVisit.readAllEntries');
}

async function writeAllEntries(entries) {
  const payload = { entries: Array.isArray(entries) ? entries : [] };
  await runByRepositoryBackend({}, {
    json: async () => {
      await queueWrite(async () => fsPromises.writeFile(dataPath, JSON.stringify(payload, null, 2)));
    },
    mongo: async () => {
      const collection = getMongoCollection(MONGO_COLLECTION);
      await collection.updateOne(
        { id: MONGO_DOC_ID },
        { $set: { id: MONGO_DOC_ID, entries: payload.entries, updatedAt: new Date().toISOString() } },
        { upsert: true }
      );
    }
  }, 'school.wordOfDayPageVisit.writeAllEntries');
}

async function recordVisit(raw = {}) {
  const entryId = String(raw.entryId || '').trim();
  if (!entryId) throw new Error('Entry id is required.');

  const viewSessionId = String(raw.viewSessionId || '').trim();
  if (!viewSessionId) throw new Error('View session id is required.');

  const durationMs = Math.max(0, Number(raw.durationMs) || 0);
  if (durationMs < MIN_DURATION_MS) throw new Error('Visit duration too short.');

  const visitorUserId = String(raw.visitorUserId || '').trim() || null;
  const ipAddress = String(raw.ipAddress || '').trim() || null;
  if (!visitorUserId && !ipAddress) throw new Error('Visitor identity is required.');

  const dedupeKey = buildDedupeKey({ entryId, viewSessionId });
  if (!dedupeKey) throw new Error('Could not build visit dedupe key.');

  const now = new Date().toISOString();
  const entries = await readAllEntries();
  const index = entries.findIndex((row) => String(row?.dedupeKey || '') === dedupeKey);

  if (index >= 0) return entries[index];

  const row = {
    id: crypto.randomUUID(),
    entryId,
    orgId: String(raw.orgId || '').trim(),
    dateKey: String(raw.dateKey || '').trim(),
    visitorUserId,
    visitorDisplayName: sanitizeVoterDisplayName(raw.visitorDisplayName),
    ipAddress: visitorUserId ? (ipAddress || null) : ipAddress,
    userAgent: String(raw.userAgent || '').trim().slice(0, 500),
    viewSessionId,
    durationMs,
    dedupeKey,
    createdAt: now
  };

  entries.push(row);
  await writeAllEntries(entries);
  return row;
}

function listForEntry(entryId, entries = []) {
  const id = String(entryId || '').trim();
  if (!id) return [];
  return (Array.isArray(entries) ? entries : []).filter((row) => String(row?.entryId || '') === id);
}

module.exports = {
  MIN_DURATION_MS,
  buildDedupeKey,
  sanitizeVoterDisplayName,
  readAllEntries,
  recordVisit,
  listForEntry
};