const questionTypeRegistry = require('./questionTypeRegistry');
const pteQuestionTypeScoringProfileRepository = require('../../repositories/pteQuestionTypeScoringProfileRepository');
const pteQuestionTypeScoringProfileHistoryRepository = require('../../repositories/pteQuestionTypeScoringProfileHistoryRepository');
const activityQuotaLedgerService = require('../activityQuotaLedgerService');
const { toPublicId } = require('../../utils/idAdapter');

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanToken(value, { max = 120 } = {}) {
  return String(value || '').replace(/\0/g, '').trim().slice(0, max).toLowerCase();
}

function cleanText(value, { max = 120 } = {}) {
  return String(value || '').replace(/\0/g, '').trim().slice(0, max);
}

function deepClone(value, fallback = {}) {
  try {
    if (value === undefined) return fallback;
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallback;
  }
}

function deepEqual(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch (_) {
    return false;
  }
}

function mergeScoring(profileScoring = {}, overrideScoring = {}) {
  const base = isPlainObject(profileScoring) ? profileScoring : {};
  const override = isPlainObject(overrideScoring) ? overrideScoring : {};
  return { ...base, ...override };
}

function resolveScoringFieldKeys(questionType = '') {
  const typeDef = questionTypeRegistry.getDefinition(questionType);
  if (!typeDef) throw new Error(`Unsupported question type '${questionType}'.`);
  return Array.isArray(typeDef.scoringFields)
    ? typeDef.scoringFields.map((row) => cleanToken(row?.key, { max: 120 })).filter(Boolean)
    : [];
}

function normalizeScoring(questionType = '', scoringInput = {}, payloadInput = {}) {
  const normalized = questionTypeRegistry.normalizeQuestionContracts(
    questionType,
    isPlainObject(payloadInput) ? payloadInput : {},
    isPlainObject(scoringInput) ? scoringInput : {}
  );
  return isPlainObject(normalized?.scoringConfig) ? normalized.scoringConfig : {};
}

function normalizeDefaultScoring(questionType = '', payloadInput = {}) {
  const typeDef = questionTypeRegistry.getDefinition(questionType);
  if (!typeDef) throw new Error(`Unsupported question type '${questionType}'.`);
  const defaults = isPlainObject(typeDef.scoringDefaults) ? typeDef.scoringDefaults : {};
  return normalizeScoring(questionType, defaults, payloadInput);
}

function buildOverridesFromEffective(questionType = '', effectiveScoring = {}, profileScoring = {}) {
  const keys = resolveScoringFieldKeys(questionType);
  const effective = isPlainObject(effectiveScoring) ? effectiveScoring : {};
  const profile = isPlainObject(profileScoring) ? profileScoring : {};
  const out = {};
  keys.forEach((key) => {
    const effectiveValue = effective[key];
    const profileValue = profile[key];
    if (!deepEqual(effectiveValue, profileValue)) {
      out[key] = deepClone(effectiveValue, effectiveValue);
    }
  });
  return out;
}

function buildProfileCacheKey(orgId = '', testType = '', questionType = '') {
  return `${toPublicId(orgId) || ''}::${cleanToken(testType, { max: 40 })}::${cleanToken(questionType, { max: 120 })}`;
}

function cloneProfileRow(profile = null) {
  if (!isPlainObject(profile)) return null;
  return deepClone(profile, null);
}

function normalizeVersion(value, fallback = 1) {
  const numeric = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric) || numeric < 1) return Math.max(1, Number(fallback || 1));
  return numeric;
}

function cleanLimit(value, fallback = 100) {
  const numeric = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric) || numeric <= 0) return fallback;
  return Math.max(1, Math.min(1000, numeric));
}

function resolveCreatorSnapshot(requestingUser, orgId = '') {
  return activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, orgId)
    || activityQuotaLedgerService.createSystemCreatorSnapshot(orgId);
}

async function getOrCreateProfile({
  orgId = '',
  testType = '',
  questionType = '',
  payload = {},
  scoringSeed = {},
  requestingUser = null,
  backendMode = '',
  cacheMap = null
} = {}) {
  const tokenOrgId = toPublicId(orgId);
  const tokenTestType = cleanToken(testType, { max: 40 });
  const tokenQuestionType = cleanToken(questionType, { max: 120 });
  if (!tokenOrgId) throw new Error('Organization context is required for scoring profiles.');
  if (!tokenTestType) throw new Error('testType is required for scoring profiles.');
  if (!tokenQuestionType) throw new Error('questionType is required for scoring profiles.');

  const cacheKey = buildProfileCacheKey(tokenOrgId, tokenTestType, tokenQuestionType);
  if (cacheMap instanceof Map && cacheMap.has(cacheKey)) {
    return cloneProfileRow(cacheMap.get(cacheKey));
  }

  const existing = await pteQuestionTypeScoringProfileRepository.getByType(
    tokenOrgId,
    tokenTestType,
    tokenQuestionType,
    { backendMode }
  );
  if (isPlainObject(existing)) {
    const out = cloneProfileRow(existing);
    if (cacheMap instanceof Map) cacheMap.set(cacheKey, out);
    return cloneProfileRow(out);
  }

  let bootstrapScoring = {};
  if (isPlainObject(scoringSeed) && Object.keys(scoringSeed).length) {
    bootstrapScoring = normalizeScoring(tokenQuestionType, scoringSeed, payload);
  } else {
    bootstrapScoring = normalizeDefaultScoring(tokenQuestionType, payload);
  }
  const creator = resolveCreatorSnapshot(requestingUser, tokenOrgId);
  const nowIso = new Date().toISOString();
  const created = await pteQuestionTypeScoringProfileRepository.upsertByType({
    orgId: tokenOrgId,
    testType: tokenTestType,
    questionType: tokenQuestionType,
    scoringConfig: bootstrapScoring,
    profileVersion: 1,
    creator,
    audit: {
      createUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
      createDateTime: nowIso,
      lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
      lastUpdateDateTime: nowIso
    }
  }, {
    backendMode
  });
  const out = cloneProfileRow(created);
  if (cacheMap instanceof Map) cacheMap.set(cacheKey, out);
  return cloneProfileRow(out);
}

async function updateGlobalProfile({
  orgId = '',
  testType = '',
  questionType = '',
  payload = {},
  nextScoringConfig = {},
  changeNote = '',
  metadata = {},
  requestingUser = null,
  backendMode = '',
  cacheMap = null
} = {}) {
  const existing = await getOrCreateProfile({
    orgId,
    testType,
    questionType,
    payload,
    scoringSeed: nextScoringConfig,
    requestingUser,
    backendMode,
    cacheMap
  });
  const normalizedNext = normalizeScoring(questionType, nextScoringConfig, payload);
  const normalizedCurrent = normalizeScoring(questionType, existing?.scoringConfig || {}, payload);
  if (deepEqual(normalizedCurrent, normalizedNext)) {
    return cloneProfileRow(existing);
  }

  const creator = resolveCreatorSnapshot(requestingUser, toPublicId(orgId));
  const nextVersion = normalizeVersion(existing?.profileVersion, 1) + 1;
  const nowIso = new Date().toISOString();

  const updated = await pteQuestionTypeScoringProfileRepository.upsertByType({
    orgId: toPublicId(orgId),
    testType: cleanToken(testType, { max: 40 }),
    questionType: cleanToken(questionType, { max: 120 }),
    scoringConfig: normalizedNext,
    profileVersion: nextVersion,
    creator,
    audit: {
      createUser: cleanText(existing?.audit?.createUser, { max: 120 }) || (creator.type === 'system' ? 'System' : (creator.userId || 'System')),
      createDateTime: existing?.audit?.createDateTime || nowIso,
      lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
      lastUpdateDateTime: nowIso
    }
  }, {
    backendMode
  });

  const cacheKey = buildProfileCacheKey(orgId, testType, questionType);
  if (cacheMap instanceof Map) cacheMap.set(cacheKey, cloneProfileRow(updated));

  await pteQuestionTypeScoringProfileHistoryRepository.create({
    orgId: toPublicId(orgId),
    profileId: toPublicId(updated?.id),
    testType: cleanToken(testType, { max: 40 }),
    questionType: cleanToken(questionType, { max: 120 }),
    fromVersion: normalizeVersion(existing?.profileVersion, 1),
    toVersion: normalizeVersion(updated?.profileVersion, nextVersion),
    previousScoringConfig: normalizedCurrent,
    nextScoringConfig: normalizedNext,
    changeNote: cleanText(changeNote, { max: 1000 }),
    metadata: isPlainObject(metadata) ? metadata : {},
    creator,
    audit: {
      createUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
      createDateTime: nowIso,
      lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
      lastUpdateDateTime: nowIso
    }
  }, {
    backendMode
  });

  return cloneProfileRow(updated);
}

function resolveQuestionMode(questionRow = {}) {
  if (questionRow?.useQuestionScoringOverride === false) return 'global';
  if (questionRow?.useQuestionScoringOverride === true) return 'override';
  const token = cleanToken(questionRow?.scoringConfigMode, { max: 40 });
  if (token === 'global') return 'global';
  return token === 'override' ? 'override' : 'legacy_full';
}

const pteQuestionScoringProfileService = {
  async resolveQuestionScoring(questionRow = {}, options = {}) {
    if (!isPlainObject(questionRow)) {
      throw new Error('Question row is required to resolve scoring profile.');
    }

    const orgId = toPublicId(questionRow.orgId);
    const testType = cleanToken(questionRow.testType, { max: 40 });
    const questionType = cleanToken(questionRow.questionType, { max: 120 });
    const payload = isPlainObject(questionRow.payload) ? questionRow.payload : {};
    const storedScoring = isPlainObject(questionRow.scoringConfig) ? questionRow.scoringConfig : {};

    const profile = await getOrCreateProfile({
      orgId,
      testType,
      questionType,
      payload,
      scoringSeed: storedScoring,
      requestingUser: options?.requestingUser || null,
      backendMode: options?.backendMode,
      cacheMap: options?.cacheMap || null
    });

    const profileScoring = normalizeScoring(questionType, profile?.scoringConfig || {}, payload);
    const mode = resolveQuestionMode(questionRow);
    const normalizedStored = normalizeScoring(questionType, storedScoring, payload);
    const overrides = mode === 'global'
      ? {}
      : (mode === 'override'
        ? buildOverridesFromEffective(questionType, mergeScoring(profileScoring, storedScoring), profileScoring)
        : buildOverridesFromEffective(questionType, normalizedStored, profileScoring));
    const effective = mode === 'global'
      ? profileScoring
      : normalizeScoring(questionType, mergeScoring(profileScoring, overrides), payload);
    const normalizedOverrides = buildOverridesFromEffective(questionType, effective, profileScoring);
    const hasStoredScoring = Object.keys(storedScoring || {}).length > 0;
    const useQuestionScoringOverride = typeof questionRow.useQuestionScoringOverride === 'boolean'
      ? questionRow.useQuestionScoringOverride
      : (mode === 'override'
        ? hasStoredScoring
        : (mode === 'legacy_full' && Object.keys(normalizedOverrides || {}).length > 0));

    return {
      profile: cloneProfileRow(profile),
      profileVersion: normalizeVersion(profile?.profileVersion, 1),
      profileScoringConfig: profileScoring,
      questionScoringOverrides: normalizedOverrides,
      effectiveScoringConfig: effective,
      useQuestionScoringOverride,
      mode
    };
  },

  async buildQuestionSaveScoringState(input = {}, options = {}) {
    const source = isPlainObject(input) ? input : {};
    const orgId = toPublicId(source.orgId || '');
    const testType = cleanToken(source.testType, { max: 40 });
    const questionType = cleanToken(source.questionType, { max: 120 });
    const payload = isPlainObject(source.payload) ? source.payload : {};
    const requestedScoring = isPlainObject(source.scoringConfig) ? source.scoringConfig : {};
    const applyGlobalProfile = source.applyGlobalProfile === true;
    const useQuestionScoringOverride = source.useQuestionScoringOverride !== false;

    const profile = await getOrCreateProfile({
      orgId,
      testType,
      questionType,
      payload,
      scoringSeed: isPlainObject(source?.existingQuestion?.scoringConfig)
        ? source.existingQuestion.scoringConfig
        : requestedScoring,
      requestingUser: options?.requestingUser || null,
      backendMode: options?.backendMode,
      cacheMap: options?.cacheMap || null
    });

    const normalizedRequested = normalizeScoring(questionType, requestedScoring, payload);
    const profileScoring = normalizeScoring(questionType, profile?.scoringConfig || {}, payload);

    if (applyGlobalProfile) {
      const updatedProfile = await updateGlobalProfile({
        orgId,
        testType,
        questionType,
        payload,
        nextScoringConfig: normalizedRequested,
        changeNote: cleanText(source.changeNote, { max: 1000 }),
        metadata: {
          source: cleanText(source.changeSource, { max: 120 }) || 'question_form_apply_global'
        },
        requestingUser: options?.requestingUser || null,
        backendMode: options?.backendMode,
        cacheMap: options?.cacheMap || null
      });
      const updatedProfileScoring = normalizeScoring(questionType, updatedProfile?.scoringConfig || {}, payload);
      return {
        profile: cloneProfileRow(updatedProfile),
        profileVersion: normalizeVersion(updatedProfile?.profileVersion, 1),
        profileScoringConfig: updatedProfileScoring,
        effectiveScoringConfig: updatedProfileScoring,
        questionScoringOverrides: {},
        useQuestionScoringOverride,
        scoringConfigMode: useQuestionScoringOverride ? 'override' : 'global'
      };
    }

    if (!useQuestionScoringOverride) {
      return {
        profile: cloneProfileRow(profile),
        profileVersion: normalizeVersion(profile?.profileVersion, 1),
        profileScoringConfig: profileScoring,
        effectiveScoringConfig: profileScoring,
        questionScoringOverrides: {},
        useQuestionScoringOverride: false,
        scoringConfigMode: 'global'
      };
    }

    const overrides = buildOverridesFromEffective(questionType, normalizedRequested, profileScoring);
    const effective = normalizeScoring(questionType, mergeScoring(profileScoring, overrides), payload);
    return {
      profile: cloneProfileRow(profile),
      profileVersion: normalizeVersion(profile?.profileVersion, 1),
      profileScoringConfig: profileScoring,
      effectiveScoringConfig: effective,
      questionScoringOverrides: overrides,
      useQuestionScoringOverride: true,
      scoringConfigMode: 'override'
    };
  },

  async getOrCreateTypeProfile(input = {}, options = {}) {
    const source = isPlainObject(input) ? input : {};
    const payload = isPlainObject(source.payload) ? source.payload : {};
    const scoringSeed = isPlainObject(source.scoringSeed) ? source.scoringSeed : {};
    const profile = await getOrCreateProfile({
      orgId: toPublicId(source.orgId || ''),
      testType: cleanToken(source.testType, { max: 40 }),
      questionType: cleanToken(source.questionType, { max: 120 }),
      payload,
      scoringSeed,
      requestingUser: options?.requestingUser || null,
      backendMode: options?.backendMode,
      cacheMap: options?.cacheMap || null
    });
    const profileScoring = normalizeScoring(
      cleanToken(source.questionType, { max: 120 }),
      profile?.scoringConfig || {},
      payload
    );
    return {
      profile: cloneProfileRow(profile),
      profileVersion: normalizeVersion(profile?.profileVersion, 1),
      scoringConfig: profileScoring
    };
  },

  async updateTypeProfile(input = {}, options = {}) {
    const source = isPlainObject(input) ? input : {};
    const payload = isPlainObject(source.payload) ? source.payload : {};
    const updated = await updateGlobalProfile({
      orgId: toPublicId(source.orgId || ''),
      testType: cleanToken(source.testType, { max: 40 }),
      questionType: cleanToken(source.questionType, { max: 120 }),
      payload,
      nextScoringConfig: isPlainObject(source.scoringConfig) ? source.scoringConfig : {},
      changeNote: cleanText(source.changeNote, { max: 1000 }),
      metadata: isPlainObject(source.metadata) ? source.metadata : {},
      requestingUser: options?.requestingUser || null,
      backendMode: options?.backendMode,
      cacheMap: options?.cacheMap || null
    });
    const scoringConfig = normalizeScoring(
      cleanToken(source.questionType, { max: 120 }),
      updated?.scoringConfig || {},
      payload
    );
    return {
      profile: cloneProfileRow(updated),
      profileVersion: normalizeVersion(updated?.profileVersion, 1),
      scoringConfig
    };
  },

  async listTypeProfiles(input = {}, options = {}) {
    const source = isPlainObject(input) ? input : {};
    const rows = await pteQuestionTypeScoringProfileRepository.list({
      orgId: toPublicId(source.orgId || ''),
      testType: cleanToken(source.testType, { max: 40 }),
      questionType: cleanToken(source.questionType, { max: 120 }),
      limit: cleanLimit(source.limit, 300)
    }, {
      backendMode: options?.backendMode
    });
    return Array.isArray(rows) ? rows.map((row) => cloneProfileRow(row)).filter(Boolean) : [];
  },

  async listTypeProfileHistory(input = {}, options = {}) {
    const source = isPlainObject(input) ? input : {};
    const rows = await pteQuestionTypeScoringProfileHistoryRepository.list({
      orgId: toPublicId(source.orgId || ''),
      profileId: toPublicId(source.profileId || ''),
      testType: cleanToken(source.testType, { max: 40 }),
      questionType: cleanToken(source.questionType, { max: 120 }),
      limit: cleanLimit(source.limit, 100)
    }, {
      backendMode: options?.backendMode
    });
    return Array.isArray(rows) ? rows.map((row) => deepClone(row, null)).filter(Boolean) : [];
  }
};

module.exports = pteQuestionScoringProfileService;
module.exports = require('../../../packages/pte/MVC/services/pte/pteQuestionScoringProfileService.js');
