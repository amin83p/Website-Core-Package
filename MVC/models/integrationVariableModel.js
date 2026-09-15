const { encrypt, decrypt } = require('../utils/encyptors');

const MAX_VARIABLES = 100;
const MAX_KEY_LENGTH = 80;
const MAX_VALUE_LENGTH = 8000;

function cleanString(value, max = MAX_VALUE_LENGTH) {
  if (value === undefined || value === null) return '';
  const token = String(value).replace(/\0/g, '').trim();
  return token.length > max ? token.slice(0, max) : token;
}

function normalizeIntegrationVariableKey(value = '') {
  const token = cleanString(value, MAX_KEY_LENGTH)
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!token) throw new Error('Integration variable key is required.');
  if (!/^[A-Z][A-Z0-9_]*$/.test(token)) {
    throw new Error(`Invalid integration variable key '${token}'. Use letters, numbers, and underscores.`);
  }
  return token;
}

function buildValueHint(rawValue = '') {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  if (value.length <= 4) return `***${value}`;
  return `***${value.slice(-4)}`;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const token = String(value ?? '').trim().toLowerCase();
  if (!token) return fallback;
  if (['true', '1', 'yes', 'y', 'on'].includes(token)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function findExistingRow(existingRows, key) {
  return (Array.isArray(existingRows) ? existingRows : [])
    .find((row) => String(row?.key || '').trim().toUpperCase() === key);
}

function decryptStoredValue(row = {}) {
  if (!row?.isSecret) return cleanString(row?.value);
  if (!row?.valueEncrypted) return '';
  try {
    return decrypt(row.valueEncrypted);
  } catch (_) {
    return '';
  }
}

function maskRowForForm(row = {}) {
  const key = cleanString(row?.key, MAX_KEY_LENGTH);
  const isSecret = normalizeBoolean(row?.isSecret, false);
  if (!key) return null;
  if (!isSecret) {
    return {
      key,
      isSecret: false,
      value: cleanString(row?.value),
      valueHint: '',
      hasStoredSecret: false
    };
  }
  const hint = cleanString(row?.valueHint) || buildValueHint(decryptStoredValue(row));
  return {
    key,
    isSecret: true,
    value: '',
    valueHint: hint,
    hasStoredSecret: Boolean(row?.valueEncrypted || hint)
  };
}

function sanitizeIntegrationVariablesFromForm(body = {}, existingRows = []) {
  const keys = asArray(body.integrationVarKey);
  const values = asArray(body.integrationVarValue);
  const secrets = asArray(body.integrationVarSecret);
  const count = Math.max(keys.length, values.length, secrets.length);
  const seen = new Set();
  const rows = [];

  for (let index = 0; index < count && rows.length < MAX_VARIABLES; index += 1) {
    const rawKey = cleanString(keys[index], MAX_KEY_LENGTH);
    if (!rawKey) continue;
    const key = normalizeIntegrationVariableKey(rawKey);
    if (seen.has(key)) {
      throw new Error(`Duplicate integration variable key '${key}'.`);
    }
    seen.add(key);

    const isSecret = normalizeBoolean(secrets[index], false);
    const incomingValue = cleanString(values[index], MAX_VALUE_LENGTH);
    const existing = findExistingRow(existingRows, key);

    if (isSecret) {
      let valueEncrypted = '';
      let valueHint = '';
      if (incomingValue) {
        valueEncrypted = encrypt(incomingValue);
        valueHint = buildValueHint(incomingValue);
      } else if (existing?.valueEncrypted) {
        valueEncrypted = existing.valueEncrypted;
        valueHint = cleanString(existing.valueHint) || buildValueHint(decryptStoredValue(existing));
      }
      rows.push({ key, isSecret: true, valueEncrypted, valueHint });
      continue;
    }

    rows.push({
      key,
      isSecret: false,
      value: incomingValue
    });
  }

  return rows;
}

function listRowsForForm(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => maskRowForForm(row))
    .filter(Boolean);
}

module.exports = {
  MAX_VARIABLES,
  normalizeIntegrationVariableKey,
  sanitizeIntegrationVariablesFromForm,
  decryptStoredValue,
  maskRowForForm,
  listRowsForForm,
  buildValueHint
};
