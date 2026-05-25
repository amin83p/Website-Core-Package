const historyModel = require('../models/pte/pteQuestionTypeScoringProfileHistoryModel');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const { toPublicId } = require('../utils/idAdapter');
const { normalizeMongoDocument } = require('./backend/mongoRepositoryUtils');

const COLLECTION_NAME = 'pteQuestionTypeScoringProfileHistory';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanToken(value, { max = 120 } = {}) {
  return String(value || '').replace(/\0/g, '').trim().slice(0, max).toLowerCase();
}

function cleanTestType(value) {
  const token = cleanToken(value, { max: 40 });
  return token === 'core' || token === 'academic' ? token : '';
}

function cleanLimit(value, fallback = 100) {
  const numeric = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric) || numeric <= 0) return fallback;
  return Math.max(1, Math.min(1000, numeric));
}

function buildDateToken(value) {
  return String(value || new Date().toISOString()).slice(0, 10).replace(/-/g, '');
}

async function generateMongoHistoryId(collection, requestedId = '', isoDateTime = null) {
  const requested = toPublicId(requestedId);
  if (requested) return requested;
  const dateToken = buildDateToken(isoDateTime);
  for (let i = 0; i < 300; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `PTESH${dateToken}${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    const existing = await collection.findOne({ id: candidate }, { projection: { _id: 1 } });
    if (!existing) return candidate;
  }
  return `PTESH${Date.now()}`;
}

const pteQuestionTypeScoringProfileHistoryRepository = {
  async create(data = {}, options = {}) {
    const source = isPlainObject(data) ? data : {};
    return runByRepositoryBackend(options, {
      json: async () => historyModel.addHistory(source),
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const normalized = historyModel.sanitizeHistoryRecord(source, null);
        normalized.id = await generateMongoHistoryId(collection, normalized.id, normalized.updatedAt || new Date().toISOString());
        await collection.insertOne(normalized);
        const fresh = await collection.findOne({ id: normalized.id });
        return normalizeMongoDocument(fresh) || normalized;
      }
    }, 'pte.questionTypeScoringProfileHistory.create');
  },

  async list(filters = {}, options = {}) {
    const source = isPlainObject(filters) ? filters : {};
    const orgId = toPublicId(source.orgId || '');
    const testType = cleanTestType(source.testType || '');
    const questionType = cleanToken(source.questionType || '', { max: 120 });
    const profileId = toPublicId(source.profileId || '');
    const limit = cleanLimit(source.limit, 100);

    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await historyModel.getAllHistory();
        return (Array.isArray(rows) ? rows : [])
          .filter((row) => !orgId || toPublicId(row?.orgId) === orgId)
          .filter((row) => !testType || cleanTestType(row?.testType) === testType)
          .filter((row) => !questionType || cleanToken(row?.questionType, { max: 120 }) === questionType)
          .filter((row) => !profileId || toPublicId(row?.profileId) === profileId)
          .sort((a, b) => String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')))
          .slice(0, limit);
      },
      mongo: async () => {
        const query = {};
        if (orgId) query.orgId = orgId;
        if (testType) query.testType = testType;
        if (questionType) query.questionType = questionType;
        if (profileId) query.profileId = profileId;
        const rows = await getMongoCollection(COLLECTION_NAME)
          .find(query)
          .sort({ updatedAt: -1, id: -1 })
          .limit(limit)
          .toArray();
        return rows.map((row) => normalizeMongoDocument(row)).filter(Boolean);
      }
    }, 'pte.questionTypeScoringProfileHistory.list');
  }
};

module.exports = pteQuestionTypeScoringProfileHistoryRepository;
