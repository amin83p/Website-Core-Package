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

const dataPath = path.join(resolveCoreRoot(), 'data/school/wordOfDayReactions.json');
const MONGO_COLLECTION = 'schoolWordOfDayReactions';
const MONGO_DOC_ID = 'word-of-day-reactions';

const VOTES = Object.freeze(['like', 'dislike']);
const DISLIKE_COMMENT_MAX = 2000;

function sanitizeDislikeComment(value, { vote } = {}) {
  if (vote !== 'dislike') return null;
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/\0/g, '').trim();
  if (!text) return null;
  return text.length > DISLIKE_COMMENT_MAX ? text.slice(0, DISLIKE_COMMENT_MAX) : text;
}

function sanitizeVoterDisplayName(value) {
  if (value === undefined || value === null) return '';
  const text = String(value).replace(/\0/g, '').trim();
  if (!text) return '';
  return text.length > 160 ? text.slice(0, 160) : text;
}

fs.mkdirSync(path.dirname(dataPath), { recursive: true });
if (!fs.existsSync(dataPath)) {
  fs.writeFileSync(dataPath, JSON.stringify({ entries: [] }, null, 2));
}

function buildDedupeKey({ entryId = '', voterUserId = '', ipAddress = '' } = {}) {
  const entry = String(entryId || '').trim();
  const userId = String(voterUserId || '').trim();
  if (userId) return `user::${entry}::${userId}`;
  const ip = String(ipAddress || '').trim();
  if (ip) return `ip::${entry}::${ip}`;
  return '';
}

function normalizeVote(value) {
  const token = String(value || '').trim().toLowerCase();
  return VOTES.includes(token) ? token : null;
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
  }, 'school.wordOfDayReaction.readAllEntries');
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
  }, 'school.wordOfDayReaction.writeAllEntries');
}

async function upsertReaction(raw = {}) {
  const vote = normalizeVote(raw.vote);
  if (!vote) throw new Error('Invalid reaction vote.');

  const entryId = String(raw.entryId || '').trim();
  if (!entryId) throw new Error('Entry id is required.');

  const voterUserId = String(raw.voterUserId || '').trim() || null;
  const ipAddress = String(raw.ipAddress || '').trim() || null;
  if (!voterUserId && !ipAddress) throw new Error('Voter identity is required.');

  const dedupeKey = buildDedupeKey({ entryId, voterUserId, ipAddress });
  if (!dedupeKey) throw new Error('Could not build reaction dedupe key.');

  const now = new Date().toISOString();
  const entries = await readAllEntries();
  const index = entries.findIndex((row) => String(row?.dedupeKey || '') === dedupeKey);

  const prior = index >= 0 ? entries[index] : null;
  const voterDisplayName = sanitizeVoterDisplayName(raw.voterDisplayName);
  let dislikeComment = null;
  if (vote === 'dislike') {
    if (raw.dislikeComment !== undefined) {
      dislikeComment = sanitizeDislikeComment(raw.dislikeComment, { vote });
    } else if (prior && prior.vote === 'dislike') {
      dislikeComment = sanitizeDislikeComment(prior.dislikeComment, { vote: 'dislike' });
    }
  }

  const row = {
    id: prior?.id || crypto.randomUUID(),
    entryId,
    orgId: String(raw.orgId || '').trim(),
    dateKey: String(raw.dateKey || '').trim(),
    vote,
    voterUserId,
    voterDisplayName: voterDisplayName || prior?.voterDisplayName || '',
    ipAddress: voterUserId ? (prior?.ipAddress || ipAddress) : ipAddress,
    userAgent: String(raw.userAgent || '').trim().slice(0, 500),
    dedupeKey,
    dislikeComment,
    createdAt: prior?.createdAt || now,
    updatedAt: now
  };

  if (index >= 0) entries[index] = { ...entries[index], ...row };
  else entries.push(row);
  await writeAllEntries(entries);
  return row;
}

function listForEntry(entryId, entries = []) {
  const id = String(entryId || '').trim();
  if (!id) return [];
  return (Array.isArray(entries) ? entries : []).filter((row) => String(row?.entryId || '') === id);
}

module.exports = {
  VOTES,
  DISLIKE_COMMENT_MAX,
  buildDedupeKey,
  normalizeVote,
  sanitizeDislikeComment,
  sanitizeVoterDisplayName,
  readAllEntries,
  upsertReaction,
  listForEntry
};