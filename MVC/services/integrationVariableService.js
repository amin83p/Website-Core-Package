const settingService = require('./settingService');
const integrationVariableModel = require('../models/integrationVariableModel');
const {
  findRegistryEntriesByKey,
  isMicrosoftAuthRegistryKey,
  getMicrosoftAuthEnvKeys
} = require('../../config/integrationVariableRegistry');
const {
  getMicrosoftAuthConfig,
  validateMicrosoftAuthConfig
} = require('../../config/microsoftAuth');

function readRows() {
  const app = settingService.get()?.app || {};
  return Array.isArray(app.integrationVariables) ? app.integrationVariables : [];
}

function findStoredRow(normalizedKey) {
  return readRows().find((item) => String(item?.key || '').trim().toUpperCase() === normalizedKey) || null;
}

function readStoredValueFromRow(row) {
  if (!row) return '';
  if (row.isSecret) {
    const decrypted = integrationVariableModel.decryptStoredValue(row);
    return decrypted ? String(decrypted).trim() : '';
  }
  if (row.value !== undefined && row.value !== null) {
    return String(row.value).trim();
  }
  return '';
}

function getIntegrationVariable(key = '', options = {}) {
  const normalizedKey = String(key || '').trim().toUpperCase();
  if (!normalizedKey) return '';

  const row = findStoredRow(normalizedKey);
  if (row) {
    const stored = readStoredValueFromRow(row);
    if (stored) return stored;
  }

  if (options.allowEnvFallback !== false && process.env[normalizedKey]) {
    return String(process.env[normalizedKey]).trim();
  }
  return '';
}

function buildEffectiveEnvForKeys(keys = []) {
  const env = { ...process.env };
  const uniqueKeys = [...new Set(
    (Array.isArray(keys) ? keys : [])
      .map((key) => String(key || '').trim().toUpperCase())
      .filter(Boolean)
  )];
  uniqueKeys.forEach((normalizedKey) => {
    const effective = getIntegrationVariable(normalizedKey);
    if (effective) {
      env[normalizedKey] = effective;
    }
  });
  return env;
}

function buildMicrosoftAuthEffectiveEnv() {
  return buildEffectiveEnvForKeys(getMicrosoftAuthEnvKeys());
}

function resolveValueSource(normalizedKey) {
  const row = findStoredRow(normalizedKey);
  const stored = readStoredValueFromRow(row);
  const envValue = process.env[normalizedKey] ? String(process.env[normalizedKey]).trim() : '';
  const hasStored = Boolean(stored);
  const hasEnv = Boolean(envValue);
  if (hasStored && hasEnv) return 'integration_and_env';
  if (hasStored) return 'integration';
  if (hasEnv) return 'env';
  return 'none';
}

function describeIntegrationVariable(key = '') {
  const normalizedKey = String(key || '').trim().toUpperCase();
  const entries = findRegistryEntriesByKey(normalizedKey);
  const linked = entries.length > 0;
  const effectiveValue = normalizedKey ? getIntegrationVariable(normalizedKey) : '';
  const valueSource = normalizedKey ? resolveValueSource(normalizedKey) : 'none';

  const payload = {
    key: normalizedKey,
    linked,
    entries: entries.map((entry) => ({
      group: entry.group,
      description: entry.description,
      consumers: Array.isArray(entry.consumers) ? entry.consumers : [],
      secretRecommended: Boolean(entry.secretRecommended),
      optional: Boolean(entry.optional)
    })),
    valueSource,
    hasEffectiveValue: Boolean(effectiveValue),
    configHint: null
  };

  if (linked && isMicrosoftAuthRegistryKey(normalizedKey)) {
    const config = getMicrosoftAuthConfig(buildMicrosoftAuthEffectiveEnv());
    const validation = validateMicrosoftAuthConfig(config);
    if (!config.enabled) {
      payload.configHint = { ok: false, message: 'Microsoft login is disabled (MICROSOFT_AUTH_ENABLED).' };
    } else if (!validation.ok) {
      payload.configHint = {
        ok: false,
        message: validation.reason === 'missing_config'
          ? `Microsoft OAuth incomplete. Missing: ${(validation.missing || []).join(', ')}`
          : 'Microsoft OAuth configuration is invalid.'
      };
    } else {
      payload.configHint = {
        ok: true,
        message: `Microsoft OAuth configured (${config.redirectUris.length} redirect URI(s)).`
      };
    }
  }

  return payload;
}

function validateIntegrationVariable(key = '') {
  try {
    const normalizedKey = integrationVariableModel.normalizeIntegrationVariableKey(key);
    const description = describeIntegrationVariable(normalizedKey);
    return {
      status: 'success',
      ...description
    };
  } catch (error) {
    return {
      status: 'error',
      key: String(key || '').trim(),
      linked: false,
      entries: [],
      valueSource: 'none',
      hasEffectiveValue: false,
      message: error.message || 'Invalid integration variable key.'
    };
  }
}

module.exports = {
  getIntegrationVariable,
  readRows,
  buildEffectiveEnvForKeys,
  buildMicrosoftAuthEffectiveEnv,
  describeIntegrationVariable,
  validateIntegrationVariable
};
