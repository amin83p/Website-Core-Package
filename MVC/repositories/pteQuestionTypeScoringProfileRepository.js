const profileModel = require('../models/pte/pteQuestionTypeScoringProfileModel');
const { runByRepositoryBackend } = require('./backend/repositoryBackendSelector');
const { getMongoCollection } = require('../infrastructure/mongo/mongoConnection');
const { toPublicId } = require('../utils/idAdapter');
const { normalizeMongoDocument } = require('./backend/mongoRepositoryUtils');

const COLLECTION_NAME = 'pteQuestionTypeScoringProfiles';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanTypeToken(value, { max = 120 } = {}) {
  return String(value || '').replace(/\0/g, '').trim().slice(0, max).toLowerCase();
}

function cleanTestType(value) {
  const token = cleanTypeToken(value, { max: 40 });
  return token === 'core' || token === 'academic' ? token : '';
}

function cleanLimit(value, fallback = 200) {
  const numeric = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric) || numeric <= 0) return fallback;
  return Math.max(1, Math.min(1000, numeric));
}

function buildTypeFilter(orgId, testType, questionType) {
  const tokenOrgId = toPublicId(orgId);
  const tokenTestType = cleanTestType(testType);
  const tokenQuestionType = cleanTypeToken(questionType, { max: 120 });
  if (!tokenOrgId || !tokenTestType || !tokenQuestionType) return null;
  return {
    orgId: tokenOrgId,
    testType: tokenTestType,
    questionType: tokenQuestionType
  };
}

function buildDateToken(value) {
  return String(value || new Date().toISOString()).slice(0, 10).replace(/-/g, '');
}

async function generateMongoProfileId(collection, requestedId = '', isoDateTime = null) {
  const requested = toPublicId(requestedId);
  if (requested) return requested;
  const dateToken = buildDateToken(isoDateTime);
  for (let i = 0; i < 300; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `PTESP${dateToken}${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    const existing = await collection.findOne({ id: candidate }, { projection: { _id: 1 } });
    if (!existing) return candidate;
  }
  return `PTESP${Date.now()}`;
}

const pteQuestionTypeScoringProfileRepository = {
  async getByType(orgId, testType, questionType, options = {}) {
    const filter = buildTypeFilter(orgId, testType, questionType);
    if (!filter) return null;
    return runByRepositoryBackend(options, {
      json: async () => profileModel.getProfileByType(filter.orgId, filter.testType, filter.questionType),
      mongo: async () => {
        const row = await getMongoCollection(COLLECTION_NAME).findOne(filter);
        return normalizeMongoDocument(row);
      }
    }, 'pte.questionTypeScoringProfiles.getByType');
  },

  async list(filters = {}, options = {}) {
    const source = isPlainObject(filters) ? filters : {};
    const orgId = toPublicId(source.orgId || '');
    const testType = cleanTestType(source.testType || '');
    const questionType = cleanTypeToken(source.questionType || '', { max: 120 });
    const limit = cleanLimit(source.limit, 300);

    return runByRepositoryBackend(options, {
      json: async () => {
        const rows = await profileModel.getAllProfiles();
        return (Array.isArray(rows) ? rows : [])
          .filter((row) => !orgId || toPublicId(row?.orgId) === orgId)
          .filter((row) => !testType || cleanTestType(row?.testType) === testType)
          .filter((row) => !questionType || cleanTypeToken(row?.questionType, { max: 120 }) === questionType)
          .sort((a, b) => String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')))
          .slice(0, limit);
      },
      mongo: async () => {
        const query = {};
        if (orgId) query.orgId = orgId;
        if (testType) query.testType = testType;
        if (questionType) query.questionType = questionType;
        const rows = await getMongoCollection(COLLECTION_NAME)
          .find(query)
          .sort({ updatedAt: -1, id: -1 })
          .limit(limit)
          .toArray();
        return rows.map((row) => normalizeMongoDocument(row)).filter(Boolean);
      }
    }, 'pte.questionTypeScoringProfiles.list');
  },

  async upsertByType(data = {}, options = {}) {
    const source = isPlainObject(data) ? data : {};
    const filter = buildTypeFilter(source.orgId, source.testType, source.questionType);
    if (!filter) throw new Error('orgId, testType, and questionType are required for scoring profile upsert.');

    return runByRepositoryBackend(options, {
      json: async () => profileModel.upsertProfileByType({
        ...source,
        orgId: filter.orgId,
        testType: filter.testType,
        questionType: filter.questionType
      }),
      mongo: async () => {
        const collection = getMongoCollection(COLLECTION_NAME);
        const existing = await collection.findOne(filter);
        const existingNormalized = normalizeMongoDocument(existing);
        const normalized = profileModel.sanitizeProfileRecord(
          {
            ...(existingNormalized || {}),
            ...source,
            orgId: filter.orgId,
            testType: filter.testType,
            questionType: filter.questionType
          },
          existingNormalized || null
        );

        if (existing?._id) {
          const { _id, ...toSet } = normalized;
          await collection.updateOne({ _id: existing._id }, { $set: toSet });
          const fresh = await collection.findOne({ _id: existing._id });
          return normalizeMongoDocument(fresh) || normalized;
        }

        normalized.id = await generateMongoProfileId(collection, normalized.id, normalized.updatedAt || new Date().toISOString());
        await collection.insertOne(normalized);
        const fresh = await collection.findOne({ id: normalized.id });
        return normalizeMongoDocument(fresh) || normalized;
      }
    }, 'pte.questionTypeScoringProfiles.upsertByType');
  }
};

module.exports = pteQuestionTypeScoringProfileRepository;
