const pteAiScoringSettingRepository = require('../../repositories/pteAiScoringSettingRepository');
const pteAiProviderRepository = require('../../repositories/pteAiProviderRepository');
const pteAiProviderDataService = require('./pteAiProviderDataService');
const questionTypeRegistry = require('./questionTypeRegistry');
const pteScoringRubricRegistry = require('./pteScoringRubricRegistry');
const {
  activityQuotaLedgerService,
  normalizeQueryOptions,
  idsEqual,
  toPublicId
} = require('./pteCoreDependencies');

const SCORER_RECOMMENDATIONS = Object.freeze({
  speaking_respond_to_situation: 'Pro model recommended for situational appropriacy and full-rubric audio scoring.',
  speaking_describe_image: 'Use a reliable multimodal/audio model when prompt images are available.',
  speaking_read_aloud: 'Default or lower-cost audio models are usually acceptable if transcript quality is stable.',
  speaking_repeat_sentence: 'Default or lower-cost audio models are usually acceptable if transcript quality is stable.',
  speaking_answer_short_question: 'Default or lower-cost audio models are usually acceptable if short-answer transcripts are stable.'
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 4000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const token = String(value ?? '').trim().toLowerCase();
  if (!token) return fallback;
  if (['true', '1', 'yes', 'y', 'on'].includes(token)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function normalizeQuestionType(value = '') {
  return cleanString(value, { max: 120, allowEmpty: true }).toLowerCase();
}

function resolveActiveOrgId(requestingUser) {
  return toPublicId(requestingUser?.activeOrgId || requestingUser?.primaryOrgId) || '';
}

function resolveRequesterUserId(requestingUser) {
  return toPublicId(requestingUser?.id) || '';
}

function assertOrgContext(requestingUser) {
  const orgId = resolveActiveOrgId(requestingUser);
  if (!orgId) throw new Error('No active organization context found.');
  return orgId;
}

function buildOrgScope(orgId) {
  const token = toPublicId(orgId);
  if (!token) return { canViewAll: false, orgId: '__NO_MATCH__' };
  return { canViewAll: false, orgId: token };
}

function buildCreator(requestingUser, orgId) {
  return activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, orgId)
    || activityQuotaLedgerService.createSystemCreatorSnapshot(orgId);
}

function buildAuditFromCreator(creator, existingAudit = {}, options = {}) {
  const nowIso = new Date().toISOString();
  const sourceAudit = isPlainObject(existingAudit) ? existingAudit : {};
  const isUpdate = options?.isUpdate === true;
  const creatorUser = String(creator?.type || '').toLowerCase() === 'system'
    ? 'System'
    : (toPublicId(creator?.userId) || 'System');

  return {
    createUser: isUpdate
      ? (cleanString(sourceAudit.createUser, { max: 160, allowEmpty: true }) || creatorUser)
      : creatorUser,
    createDateTime: isUpdate
      ? (cleanString(sourceAudit.createDateTime, { max: 80, allowEmpty: true }) || nowIso)
      : nowIso,
    lastUpdateUser: creatorUser,
    lastUpdateDateTime: nowIso
  };
}

function getImplementedScorerOptions() {
  return pteScoringRubricRegistry.listRubrics()
    .filter((rubric) => {
      if (rubric?.implemented !== true) return false;
      const methodToken = cleanString(rubric?.method, { max: 160, allowEmpty: true }).toLowerCase();
      return methodToken.includes('ai');
    })
    .map((rubric) => {
      const questionType = normalizeQuestionType(rubric.questionType || rubric.scorerKey);
      const definition = questionTypeRegistry.getDefinition(questionType) || {};
      return {
        questionType,
        scorerKey: cleanString(rubric.scorerKey || questionType, { max: 120, allowEmpty: true }) || questionType,
        scorerVersion: cleanString(rubric.scorerVersion, { max: 120, allowEmpty: true }) || '',
        label: cleanString(definition.label, { max: 220, allowEmpty: true }) || questionType,
        skill: cleanString(definition.skill, { max: 80, allowEmpty: true }) || '',
        method: cleanString(rubric.method, { max: 120, allowEmpty: true }) || '',
        recommendation: SCORER_RECOMMENDATIONS[questionType] || 'Use the default provider unless this scorer needs a stronger model in your testing.'
      };
    })
    .sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
}

function assertImplementedQuestionType(questionType = '') {
  const token = normalizeQuestionType(questionType);
  if (!token) throw new Error('Question type is required.');
  if (!pteScoringRubricRegistry.isImplemented(token)) {
    throw new Error('Only implemented PTE scorers can be configured.');
  }
  return token;
}

function summarizeProviderRecord(row = {}) {
  const providerOptions = pteAiProviderDataService.getProviderOptions();
  const providerId = cleanString(row?.providerId, { max: 80, allowEmpty: true }).toLowerCase();
  const providerLabel = providerOptions.find((item) => cleanString(item?.id, { max: 80, allowEmpty: true }).toLowerCase() === providerId)?.label || providerId;
  return {
    id: cleanString(row?.id, { max: 160, allowEmpty: true }) || '',
    name: cleanString(row?.name, { max: 220, allowEmpty: true }) || '',
    providerId,
    providerLabel,
    modelId: cleanString(row?.modelId, { max: 220, allowEmpty: true }) || '',
    project: cleanString(row?.project, { max: 220, allowEmpty: true }) || '',
    location: cleanString(row?.location, { max: 220, allowEmpty: true }) || '',
    isDefault: row?.isDefault === true,
    isActive: row?.isActive !== false,
    hasApiKey: row?.hasApiKey === true || Boolean(cleanString(row?.apiKeyMasked, { max: 80, allowEmpty: true })),
    apiKeyMasked: cleanString(row?.apiKeyMasked, { max: 80, allowEmpty: true }) || '',
    orgId: cleanString(row?.orgId, { max: 160, allowEmpty: true }) || '',
    userId: cleanString(row?.userId, { max: 160, allowEmpty: true }) || ''
  };
}

async function listOrgProviderOptions(orgId, options = {}) {
  const rows = await pteAiProviderRepository.list({
    query: normalizeQueryOptions({}),
    scope: buildOrgScope(orgId),
    sort: { isDefault: -1, isActive: -1, updatedAt: -1, id: -1 },
    backendMode: options?.backendMode
  });
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => idsEqual(row?.orgId, orgId))
    .map((row) => summarizeProviderRecord(row));
}

async function enrichSettings(rows = [], orgId, options = {}) {
  const providerOptions = await listOrgProviderOptions(orgId, options);
  const providerById = new Map(providerOptions.map((provider) => [String(provider.id || ''), provider]));
  const scorerByType = new Map(getImplementedScorerOptions().map((scorer) => [scorer.questionType, scorer]));
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const questionType = normalizeQuestionType(row?.questionType);
    const provider = providerById.get(String(row?.providerRecordId || '')) || null;
    return {
      ...row,
      questionType,
      scorer: scorerByType.get(questionType) || null,
      provider
    };
  });
}

const pteAiScoringSettingsDataService = {
  getImplementedScorerOptions,

  async listSettings(requestingUser, accessContext = {}, options = {}) {
    const orgId = assertOrgContext(requestingUser);
    const rows = await pteAiScoringSettingRepository.list({
      query: normalizeQueryOptions(options?.query || {}),
      scope: buildOrgScope(orgId),
      sort: { questionType: 1, updatedAt: -1 },
      backendMode: options?.backendMode
    });
    return {
      orgId,
      scorers: getImplementedScorerOptions(),
      providerOptions: await listOrgProviderOptions(orgId, options),
      assignments: await enrichSettings(rows, orgId, options)
    };
  },

  async upsertSetting(payload = {}, requestingUser, accessContext = {}, options = {}) {
    const orgId = assertOrgContext(requestingUser);
    const questionType = assertImplementedQuestionType(payload?.questionType);
    const providerRecordId = cleanString(payload?.providerRecordId, { max: 160, allowEmpty: true });
    if (!providerRecordId) throw new Error('API provider selection is required.');

    const providerRecord = await pteAiProviderRepository.getById(providerRecordId, {
      backendMode: options?.backendMode
    });
    if (!providerRecord || !idsEqual(providerRecord?.orgId, orgId)) {
      throw new Error('Selected API provider was not found in the active organization.');
    }
    if (providerRecord.isActive === false) {
      throw new Error('Inactive API providers cannot be assigned to scoring settings.');
    }
    if (!(providerRecord.hasApiKey === true || cleanString(providerRecord.apiKeyMasked, { max: 80, allowEmpty: true }))) {
      throw new Error('Selected API provider does not have a usable API key.');
    }

    const existing = await pteAiScoringSettingRepository.getByOrgQuestionType(orgId, questionType, {
      scope: buildOrgScope(orgId),
      backendMode: options?.backendMode
    });
    const creator = isPlainObject(existing?.creator)
      ? existing.creator
      : buildCreator(requestingUser, orgId);
    const audit = buildAuditFromCreator(creator, existing?.audit || {}, { isUpdate: Boolean(existing) });

    const saved = await pteAiScoringSettingRepository.upsertForOrgQuestionType({
      orgId,
      questionType,
      providerRecordId,
      isActive: normalizeBoolean(payload?.isActive, true),
      notes: cleanString(payload?.notes, { max: 4000, allowEmpty: true }) || '',
      creator,
      audit
    }, {
      scope: buildOrgScope(orgId),
      backendMode: options?.backendMode
    });

    const enriched = await enrichSettings([saved], orgId, options);
    return enriched[0] || saved;
  },

  async deleteSetting(id, requestingUser, accessContext = {}, options = {}) {
    const orgId = assertOrgContext(requestingUser);
    const existing = await pteAiScoringSettingRepository.getById(id, {
      scope: buildOrgScope(orgId),
      backendMode: options?.backendMode
    });
    if (!existing) throw new Error('PTE AI scoring setting was not found.');
    return pteAiScoringSettingRepository.remove(existing.id, {
      scope: buildOrgScope(orgId),
      backendMode: options?.backendMode
    });
  },

  async resolveScoringProviderCandidate({
    requestingUser = null,
    questionType = '',
    scorerKey = '',
    backendMode = undefined
  } = {}) {
    const orgId = resolveActiveOrgId(requestingUser);
    const targetType = assertImplementedQuestionType(questionType || scorerKey);
    const warnings = [];
    if (!orgId) {
      warnings.push('No active organization context was available for scoring provider settings; default provider was used.');
      return {
        providerRecord: null,
        setting: null,
        warnings,
        providerSelectionSource: 'default_provider'
      };
    }

    const setting = await pteAiScoringSettingRepository.getByOrgQuestionType(orgId, targetType, {
      scope: buildOrgScope(orgId),
      backendMode
    });
    if (!setting) {
      return {
        providerRecord: null,
        setting: null,
        warnings,
        providerSelectionSource: 'default_provider'
      };
    }

    if (setting.isActive === false) {
      warnings.push(`PTE AI scoring setting for ${targetType} is inactive; default provider was used.`);
      return {
        providerRecord: null,
        setting,
        warnings,
        providerSelectionSource: 'default_provider'
      };
    }

    const providerRecordId = cleanString(setting.providerRecordId, { max: 160, allowEmpty: true });
    if (!providerRecordId) {
      warnings.push(`PTE AI scoring setting for ${targetType} has no provider record; default provider was used.`);
      return {
        providerRecord: null,
        setting,
        warnings,
        providerSelectionSource: 'default_provider'
      };
    }

    const providerRecord = await pteAiProviderRepository.getById(providerRecordId, { backendMode });
    if (!providerRecord) {
      warnings.push(`PTE AI scoring setting for ${targetType} references a missing provider; default provider was used.`);
      return {
        providerRecord: null,
        setting,
        warnings,
        providerSelectionSource: 'default_provider'
      };
    }
    if (!idsEqual(providerRecord.orgId, orgId)) {
      warnings.push(`PTE AI scoring setting for ${targetType} references a provider outside the active organization; default provider was used.`);
      return {
        providerRecord: null,
        setting,
        warnings,
        providerSelectionSource: 'default_provider'
      };
    }
    if (providerRecord.isActive === false) {
      warnings.push(`PTE AI scoring provider "${providerRecord.name || providerRecord.id}" is inactive; default provider was used.`);
      return {
        providerRecord: null,
        setting,
        warnings,
        providerSelectionSource: 'default_provider'
      };
    }
    if (!(providerRecord.hasApiKey === true || cleanString(providerRecord.apiKeyMasked, { max: 80, allowEmpty: true }))) {
      warnings.push(`PTE AI scoring provider "${providerRecord.name || providerRecord.id}" has no usable API key; default provider was used.`);
      return {
        providerRecord: null,
        setting,
        warnings,
        providerSelectionSource: 'default_provider'
      };
    }

    return {
      providerRecord,
      setting,
      warnings,
      providerSelectionSource: 'scoring_setting'
    };
  }
};

module.exports = pteAiScoringSettingsDataService;
