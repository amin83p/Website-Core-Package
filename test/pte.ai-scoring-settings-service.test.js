const test = require('node:test');
const assert = require('node:assert/strict');

const pteAiScoringSettingModel = require('../packages/pte/MVC/models/pte/pteAiScoringSettingModel');
const pteAiScoringSettingsDataService = require('../packages/pte/MVC/services/pte/pteAiScoringSettingsDataService');
const pteAiProviderDataService = require('../packages/pte/MVC/services/pte/pteAiProviderDataService');
const pteAiScoringSettingRepository = require('../packages/pte/MVC/repositories/pteAiScoringSettingRepository');
const pteAiProviderRepository = require('../packages/pte/MVC/repositories/pteAiProviderRepository');
const pteAiProviderModel = require('../packages/pte/MVC/models/pte/pteAiProviderModel');

const USER = Object.freeze({
  id: 'USER_001',
  activeOrgId: 'ORG_001',
  primaryOrgId: 'ORG_001',
  username: 'admin',
  email: 'admin@example.test'
});

const ORIGINALS = {
  settingsGetByOrgQuestionType: pteAiScoringSettingRepository.getByOrgQuestionType,
  settingsUpsertForOrgQuestionType: pteAiScoringSettingRepository.upsertForOrgQuestionType,
  settingsList: pteAiScoringSettingRepository.list,
  providerGetById: pteAiProviderRepository.getById,
  providerList: pteAiProviderRepository.list,
  getDecryptedApiKeyById: pteAiProviderModel.getDecryptedApiKeyById
};

test.afterEach(() => {
  pteAiScoringSettingRepository.getByOrgQuestionType = ORIGINALS.settingsGetByOrgQuestionType;
  pteAiScoringSettingRepository.upsertForOrgQuestionType = ORIGINALS.settingsUpsertForOrgQuestionType;
  pteAiScoringSettingRepository.list = ORIGINALS.settingsList;
  pteAiProviderRepository.getById = ORIGINALS.providerGetById;
  pteAiProviderRepository.list = ORIGINALS.providerList;
  pteAiProviderModel.getDecryptedApiKeyById = ORIGINALS.getDecryptedApiKeyById;
});

function providerRow(overrides = {}) {
  return {
    id: 'PROVIDER_DEFAULT',
    name: 'Default Gemini Flash',
    providerId: 'google-gemini',
    modelId: 'gemini-2.5-flash',
    orgId: 'ORG_001',
    userId: 'USER_001',
    isActive: true,
    isDefault: true,
    hasApiKey: true,
    apiKeyMasked: '***test',
    ...overrides
  };
}

test('PTE AI scoring setting normalization lowercases question type and keeps provider record id only', () => {
  const normalized = pteAiScoringSettingModel.normalizeScoringSettingRecord({
    orgId: 'ORG_001',
    questionType: 'SPEAKING_RESPOND_TO_SITUATION',
    providerRecordId: 'PROVIDER_PRO',
    notes: 'Use pro model',
    isActive: 'true'
  }, null, true);

  assert.equal(normalized.orgId, 'ORG_001');
  assert.equal(normalized.questionType, 'speaking_respond_to_situation');
  assert.equal(normalized.providerRecordId, 'PROVIDER_PRO');
  assert.equal(normalized.isActive, true);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, 'apiKey'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, 'apiKeyEncrypted'), false);
});

test('PTE AI scoring setting upsert writes one org-wide assignment for the scorer', async () => {
  let capturedPayload = null;
  pteAiProviderRepository.getById = async () => providerRow({ id: 'PROVIDER_PRO', modelId: 'gemini-2.5-pro' });
  pteAiScoringSettingRepository.getByOrgQuestionType = async () => ({
    id: 'SETTING_OLD',
    orgId: 'ORG_001',
    questionType: 'speaking_respond_to_situation',
    providerRecordId: 'PROVIDER_OLD',
    creator: { type: 'user', userId: 'USER_001', orgId: 'ORG_001' },
    audit: { createUser: 'USER_001', createDateTime: '2026-05-01T00:00:00.000Z' }
  });
  pteAiScoringSettingRepository.upsertForOrgQuestionType = async (payload) => {
    capturedPayload = payload;
    return {
      id: 'SETTING_OLD',
      ...payload,
      updatedAt: '2026-05-03T00:00:00.000Z'
    };
  };
  pteAiProviderRepository.list = async () => [providerRow({ id: 'PROVIDER_PRO', modelId: 'gemini-2.5-pro' })];

  const saved = await pteAiScoringSettingsDataService.upsertSetting({
    questionType: 'SPEAKING_RESPOND_TO_SITUATION',
    providerRecordId: 'PROVIDER_PRO',
    isActive: 'on',
    notes: 'Use stronger model for this scorer.'
  }, USER);

  assert.equal(capturedPayload.orgId, 'ORG_001');
  assert.equal(capturedPayload.questionType, 'speaking_respond_to_situation');
  assert.equal(capturedPayload.providerRecordId, 'PROVIDER_PRO');
  assert.equal(capturedPayload.isActive, true);
  assert.equal(saved.id, 'SETTING_OLD');
  assert.equal(saved.provider.id, 'PROVIDER_PRO');
});

test('runtime provider resolution uses the assigned scoring provider when it is active and has a key', async () => {
  pteAiScoringSettingRepository.getByOrgQuestionType = async () => ({
    id: 'SETTING_RESPOND',
    orgId: 'ORG_001',
    questionType: 'speaking_respond_to_situation',
    providerRecordId: 'PROVIDER_PRO',
    isActive: true
  });
  pteAiProviderRepository.getById = async () => providerRow({
    id: 'PROVIDER_PRO',
    name: 'Gemini Pro Scoring',
    modelId: 'gemini-2.5-pro',
    isDefault: false
  });
  pteAiProviderRepository.list = async () => {
    throw new Error('default provider should not be queried when scoring assignment is usable');
  };
  pteAiProviderModel.getDecryptedApiKeyById = async (id) => (id === 'PROVIDER_PRO' ? 'assigned-key' : '');

  const resolved = await pteAiProviderDataService.resolveRuntimeProvider(USER, {}, {
    purpose: 'pte_scoring',
    questionType: 'speaking_respond_to_situation'
  });

  assert.equal(resolved.providerRecord.id, 'PROVIDER_PRO');
  assert.equal(resolved.modelId, 'gemini-2.5-pro');
  assert.equal(resolved.credentials.apiKey, 'assigned-key');
  assert.equal(resolved.providerSelectionSource, 'scoring_setting');
  assert.equal(resolved.scoringSettingId, 'SETTING_RESPOND');
});

test('runtime provider resolution falls back to default when no scoring setting exists', async () => {
  pteAiScoringSettingRepository.getByOrgQuestionType = async () => null;
  pteAiProviderRepository.list = async () => [providerRow()];
  pteAiProviderModel.getDecryptedApiKeyById = async (id) => (id === 'PROVIDER_DEFAULT' ? 'default-key' : '');

  const resolved = await pteAiProviderDataService.resolveRuntimeProvider(USER, {}, {
    purpose: 'pte_scoring',
    questionType: 'speaking_read_aloud'
  });

  assert.equal(resolved.providerRecord.id, 'PROVIDER_DEFAULT');
  assert.equal(resolved.credentials.apiKey, 'default-key');
  assert.equal(resolved.providerSelectionSource, 'default_provider');
  assert.deepEqual(resolved.providerSelectionWarnings, []);
});

test('runtime provider resolution rejects another-org scoring provider and falls back with warning', async () => {
  pteAiScoringSettingRepository.getByOrgQuestionType = async () => ({
    id: 'SETTING_BAD',
    orgId: 'ORG_001',
    questionType: 'speaking_respond_to_situation',
    providerRecordId: 'PROVIDER_OTHER_ORG',
    isActive: true
  });
  pteAiProviderRepository.getById = async () => providerRow({
    id: 'PROVIDER_OTHER_ORG',
    orgId: 'ORG_999',
    userId: 'USER_999',
    isDefault: false
  });
  pteAiProviderRepository.list = async () => [providerRow()];
  pteAiProviderModel.getDecryptedApiKeyById = async (id) => (id === 'PROVIDER_DEFAULT' ? 'default-key' : '');

  const resolved = await pteAiProviderDataService.resolveRuntimeProvider(USER, {}, {
    purpose: 'pte_scoring',
    questionType: 'speaking_respond_to_situation'
  });

  assert.equal(resolved.providerRecord.id, 'PROVIDER_DEFAULT');
  assert.equal(resolved.providerSelectionSource, 'default_provider');
  assert.ok(resolved.providerSelectionWarnings.some((warning) => /outside the active organization/i.test(warning)));
});

test('runtime provider resolution falls back with warning when assigned scoring provider has no usable key', async () => {
  pteAiScoringSettingRepository.getByOrgQuestionType = async () => ({
    id: 'SETTING_NO_KEY',
    orgId: 'ORG_001',
    questionType: 'speaking_describe_image',
    providerRecordId: 'PROVIDER_NO_KEY',
    isActive: true
  });
  pteAiProviderRepository.getById = async () => providerRow({
    id: 'PROVIDER_NO_KEY',
    name: 'No Key Provider',
    hasApiKey: false,
    apiKeyMasked: '',
    isDefault: false
  });
  pteAiProviderRepository.list = async () => [providerRow()];
  pteAiProviderModel.getDecryptedApiKeyById = async (id) => (id === 'PROVIDER_DEFAULT' ? 'default-key' : '');

  const resolved = await pteAiProviderDataService.resolveRuntimeProvider(USER, {}, {
    purpose: 'pte_scoring',
    questionType: 'speaking_describe_image'
  });

  assert.equal(resolved.providerRecord.id, 'PROVIDER_DEFAULT');
  assert.equal(resolved.providerSelectionSource, 'default_provider');
  assert.ok(resolved.providerSelectionWarnings.some((warning) => /no usable API key/i.test(warning)));
});

test('runtime provider resolution explains when default provider key cannot be decrypted', async () => {
  pteAiScoringSettingRepository.getByOrgQuestionType = async () => null;
  pteAiProviderRepository.list = async () => [providerRow({
    name: 'Default Gemini With Broken Key',
    hasApiKey: true,
    apiKeyMasked: '***test'
  })];
  pteAiProviderModel.getDecryptedApiKeyById = async () => '';

  await assert.rejects(
    () => pteAiProviderDataService.resolveRuntimeProvider(USER, {}, {
      purpose: 'pte_scoring',
      questionType: 'speaking_read_aloud'
    }),
    (error) => {
      assert.equal(error.code, 'PTE_AI_PROVIDER_SELECTION_WARNING');
      assert.match(error.message, /stored API key/i);
      assert.match(error.message, /cannot be decrypted/i);
      assert.match(error.message, /SESSION_ENCRYPTION_KEY\/ENCRYPTION_KEY/i);
      return true;
    }
  );
});

test('runtime provider resolution never uses inactive assigned scoring provider and falls back to active default', async () => {
  pteAiScoringSettingRepository.getByOrgQuestionType = async () => ({
    id: 'SETTING_INACTIVE_PROVIDER',
    orgId: 'ORG_001',
    questionType: 'speaking_respond_to_situation',
    providerRecordId: 'PROVIDER_DISABLED',
    isActive: true
  });
  pteAiProviderRepository.getById = async () => providerRow({
    id: 'PROVIDER_DISABLED',
    name: 'Disabled Scoring Provider',
    modelId: 'gemini-2.5-pro',
    isActive: false,
    isDefault: false
  });
  pteAiProviderRepository.list = async () => [
    providerRow({
      id: 'PROVIDER_DISABLED',
      name: 'Disabled Scoring Provider',
      modelId: 'gemini-2.5-pro',
      isActive: false,
      isDefault: false
    }),
    providerRow()
  ];
  pteAiProviderModel.getDecryptedApiKeyById = async (id) => (id === 'PROVIDER_DEFAULT' ? 'default-key' : 'disabled-key');

  const resolved = await pteAiProviderDataService.resolveRuntimeProvider(USER, {}, {
    purpose: 'pte_scoring',
    questionType: 'speaking_respond_to_situation'
  });

  assert.equal(resolved.providerRecord.id, 'PROVIDER_DEFAULT');
  assert.equal(resolved.credentials.apiKey, 'default-key');
  assert.equal(resolved.providerSelectionSource, 'default_provider');
  assert.ok(resolved.providerSelectionWarnings.some((warning) => /inactive/i.test(warning)));
});

test('runtime provider resolution warns and stops when fallback has active providers but no active default', async () => {
  pteAiScoringSettingRepository.getByOrgQuestionType = async () => ({
    id: 'SETTING_INACTIVE_PROVIDER',
    orgId: 'ORG_001',
    questionType: 'speaking_respond_to_situation',
    providerRecordId: 'PROVIDER_DISABLED',
    isActive: true
  });
  pteAiProviderRepository.getById = async () => providerRow({
    id: 'PROVIDER_DISABLED',
    name: 'Disabled Scoring Provider',
    isActive: false,
    isDefault: false
  });
  pteAiProviderRepository.list = async () => [
    providerRow({
      id: 'PROVIDER_ACTIVE_NOT_DEFAULT',
      name: 'Active But Not Default',
      isActive: true,
      isDefault: false
    })
  ];
  pteAiProviderModel.getDecryptedApiKeyById = async () => 'active-key';

  await assert.rejects(
    () => pteAiProviderDataService.resolveRuntimeProvider(USER, {}, {
      purpose: 'pte_scoring',
      questionType: 'speaking_respond_to_situation'
    }),
    (error) => {
      assert.equal(error.code, 'PTE_AI_PROVIDER_SELECTION_WARNING');
      assert.match(error.message, /inactive/i);
      assert.match(error.message, /No active default PTE AI provider/i);
      return true;
    }
  );
});

test('runtime provider resolution does not use first active provider when no active default exists', async () => {
  pteAiScoringSettingRepository.getByOrgQuestionType = async () => null;
  pteAiProviderRepository.list = async () => [
    providerRow({
      id: 'PROVIDER_ACTIVE_NOT_DEFAULT',
      name: 'Active But Not Default',
      isActive: true,
      isDefault: false
    })
  ];
  pteAiProviderModel.getDecryptedApiKeyById = async () => 'active-key';

  await assert.rejects(
    () => pteAiProviderDataService.resolveRuntimeProvider(USER, {}, {
      purpose: 'pte_scoring',
      questionType: 'speaking_read_aloud'
    }),
    /No active default PTE AI provider/
  );
});
