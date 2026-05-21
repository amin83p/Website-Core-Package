const questionTypeRegistry = require('./questionTypeRegistry');
const pteQuestionScoringProfileService = require('./pteQuestionScoringProfileService');
const adminChekersService = require('../adminChekersService');
const { toPublicId } = require('../../utils/idAdapter');

function cleanText(value, { max = 4000 } = {}) {
  return String(value || '').replace(/\0/g, '').trim().slice(0, max);
}

function normalizeTestType(value, fallback = '') {
  const token = cleanText(value, { max: 40 }).toLowerCase();
  if (token === 'core' || token === 'academic') return token;
  const fallbackToken = cleanText(fallback, { max: 40 }).toLowerCase();
  return (fallbackToken === 'core' || fallbackToken === 'academic') ? fallbackToken : '';
}

function normalizeQuestionType(value) {
  return cleanText(value, { max: 120 }).toLowerCase();
}

function resolveActiveOrgId(requestingUser) {
  return toPublicId(requestingUser?.activeOrgId || '');
}

function ensureOrgContext(requestingUser, { scopeLabel = 'PTE scoring defaults' } = {}) {
  if (adminChekersService.isSuperAdmin(requestingUser)) {
    const orgId = resolveActiveOrgId(requestingUser);
    if (!orgId || orgId.toUpperCase() === 'SYSTEM') {
      throw new Error(`${scopeLabel} requires an active organization context.`);
    }
    return orgId;
  }

  const orgId = resolveActiveOrgId(requestingUser);
  if (!orgId || orgId.toUpperCase() === 'SYSTEM') {
    throw new Error(`${scopeLabel} is organization scoped. Switch to an organization first.`);
  }
  return orgId;
}

function resolveTypeDefinition(questionType = '') {
  const typeDef = questionTypeRegistry.getDefinition(normalizeQuestionType(questionType));
  if (!typeDef) throw new Error('A valid question type is required.');
  return typeDef;
}

function resolveTestTypeForQuestionType(inputTestType = '', questionType = '') {
  const fallback = questionTypeRegistry.inferDefaultTestTypeForType(questionType);
  const testType = normalizeTestType(inputTestType, fallback);
  if (!testType) throw new Error('A valid test type is required.');
  if (!questionTypeRegistry.isTypeAllowedForTestType(questionType, testType)) {
    throw new Error(`Question type '${questionType}' is not available for test type '${testType}'.`);
  }
  return testType;
}

function buildEditorTypeRows() {
  return questionTypeRegistry.getEditorRegistry()
    .map((row) => ({
      key: normalizeQuestionType(row?.key),
      label: cleanText(row?.label, { max: 240 }) || cleanText(row?.key, { max: 120 }),
      skill: cleanText(row?.skill, { max: 40 }).toLowerCase(),
      testTypes: Array.isArray(row?.testTypes)
        ? row.testTypes.map((item) => normalizeTestType(item)).filter(Boolean)
        : [],
      scoringFields: Array.isArray(row?.scoringFields) ? row.scoringFields : [],
      scoringDefaults: row?.scoringDefaults && typeof row.scoringDefaults === 'object' ? row.scoringDefaults : {}
    }))
    .filter((row) => row.key);
}

const pteScoringDefaultsDataService = {
  getFormOptions() {
    return {
      testTypes: questionTypeRegistry.listTestTypes(),
      questionTypes: buildEditorTypeRows()
    };
  },

  async getTypeProfile(input = {}, requestingUser, options = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const orgId = ensureOrgContext(requestingUser);
    const questionType = normalizeQuestionType(source.questionType);
    if (!questionType) throw new Error('Question type is required.');
    resolveTypeDefinition(questionType);
    const testType = resolveTestTypeForQuestionType(source.testType, questionType);

    const profile = await pteQuestionScoringProfileService.getOrCreateTypeProfile({
      orgId,
      testType,
      questionType,
      payload: {}
    }, {
      requestingUser,
      backendMode: options?.backendMode
    });

    const history = await pteQuestionScoringProfileService.listTypeProfileHistory({
      orgId,
      testType,
      questionType,
      profileId: profile?.profile?.id || '',
      limit: Number.parseInt(String(source.historyLimit || 25), 10) || 25
    }, {
      backendMode: options?.backendMode
    });

    return {
      orgId,
      testType,
      questionType,
      profile,
      history
    };
  },

  async updateTypeProfile(input = {}, requestingUser, options = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const orgId = ensureOrgContext(requestingUser);
    const questionType = normalizeQuestionType(source.questionType);
    if (!questionType) throw new Error('Question type is required.');
    resolveTypeDefinition(questionType);
    const testType = resolveTestTypeForQuestionType(source.testType, questionType);
    const scoringConfig = source.scoringConfig && typeof source.scoringConfig === 'object'
      ? source.scoringConfig
      : {};

    const profile = await pteQuestionScoringProfileService.updateTypeProfile({
      orgId,
      testType,
      questionType,
      payload: {},
      scoringConfig,
      changeNote: cleanText(source.changeNote, { max: 1000 }),
      metadata: {
        source: 'pte_scoring_defaults_page',
        uiVersion: cleanText(source.uiVersion, { max: 80 }) || 'v1'
      }
    }, {
      requestingUser,
      backendMode: options?.backendMode
    });

    const history = await pteQuestionScoringProfileService.listTypeProfileHistory({
      orgId,
      profileId: profile?.profile?.id || '',
      testType,
      questionType,
      limit: Number.parseInt(String(source.historyLimit || 25), 10) || 25
    }, {
      backendMode: options?.backendMode
    });

    return {
      orgId,
      testType,
      questionType,
      profile,
      history
    };
  }
};

module.exports = pteScoringDefaultsDataService;
