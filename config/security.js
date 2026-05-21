// config/security.js
const crypto = require('crypto');

const NODE_ENV = String(process.env.NODE_ENV || '').trim().toLowerCase();
const IS_PRODUCTION = NODE_ENV === 'production';

function warnDev(message) {
  if (!IS_PRODUCTION) {
    console.warn(`[security] ${message}`);
  }
}

function generateEphemeral(length) {
  const byteLength = Math.max(16, Math.ceil(length / 2));
  return crypto.randomBytes(byteLength).toString('hex').slice(0, length);
}

function coerceToLength(value, length, name) {
  const raw = String(value || '');
  if (raw.length === length) return raw;

  if (IS_PRODUCTION) {
    throw new Error(`[security] ${name} must be exactly ${length} characters.`);
  }

  warnDev(`${name} was provided with invalid length (${raw.length}). Deriving an ephemeral-compatible ${length}-character key for development.`);
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, length);
}

function normalizeEnvSecretValue(value) {
  let raw = String(value || '').trim();
  if (raw.endsWith(';')) raw = raw.slice(0, -1).trim();
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    raw = raw.slice(1, -1);
  }
  return raw.trim();
}

function readRequiredEnv(name, options = {}) {
  const names = Array.isArray(name) ? name.filter(Boolean) : [name];
  const displayName = names.join(' or ');
  const requiredLength = Number(options.length) || null;
  let value = '';
  let matchedName = names[0];

  for (const candidate of names) {
    const normalized = normalizeEnvSecretValue(process.env[candidate]);
    if (normalized) {
      value = normalized;
      matchedName = candidate;
      break;
    }
  }

  if (!value) {
    if (IS_PRODUCTION) {
      throw new Error(`[security] Missing required environment variable: ${displayName}`);
    }

    if (requiredLength) {
      warnDev(`${displayName} is missing. Using an ephemeral development key. Set this env var to persist sessions/data across restarts.`);
      return generateEphemeral(requiredLength);
    }

    warnDev(`${displayName} is missing. Using an ephemeral development secret. Set this env var to keep token/session continuity across restarts.`);
    return generateEphemeral(64);
  }

  if (requiredLength) {
    return coerceToLength(value, requiredLength, matchedName);
  }

  return value;
}

function readOptionalEnv(name) {
  const names = Array.isArray(name) ? name.filter(Boolean) : [name];
  for (const candidate of names) {
    const value = normalizeEnvSecretValue(process.env[candidate]);
    if (value) {
      return {
        name: candidate,
        value
      };
    }
  }
  return {
    name: names[0] || '',
    value: ''
  };
}

function deriveFixedLengthSecret(value, length, purpose = '') {
  const raw = normalizeEnvSecretValue(value);
  if (!raw) return '';
  const salt = purpose ? `${purpose}:` : '';
  return crypto.createHash('sha256').update(`${salt}${raw}`).digest('hex').slice(0, length);
}

const SECRET_KEY = readRequiredEnv(['MAIN_SECRET_KEY', 'SECRET_KEY']);
const SESSION_SECRET = readRequiredEnv(['SESSION_SECRET', 'EXPRESS_SESSION_SECRET']);

function readDataEncryptionKey() {
  const configured = readOptionalEnv(['SESSION_ENCRYPTION_KEY', 'ENCRYPTION_KEY']);
  if (configured.value) {
    return coerceToLength(configured.value, 32, configured.name);
  }

  const fallback = readOptionalEnv(['SESSION_SECRET', 'EXPRESS_SESSION_SECRET', 'MAIN_SECRET_KEY', 'SECRET_KEY']);
  if (fallback.value) {
    warnDev(
      `SESSION_ENCRYPTION_KEY or ENCRYPTION_KEY is missing. Deriving a stable 32-character data encryption key from ${fallback.name}. Set SESSION_ENCRYPTION_KEY to a dedicated value before rotating secrets.`
    );
    return deriveFixedLengthSecret(fallback.value, 32, 'data-encryption');
  }

  return readRequiredEnv(['SESSION_ENCRYPTION_KEY', 'ENCRYPTION_KEY'], { length: 32 });
}

// AES-256 key for persisted app secrets, session/admin encryption, and saved AI provider keys.
const ENCRYPTION_KEY = readDataEncryptionKey();

// AES-256 key for action-state payload encryption.
const ACTION_STATE_KEY = readRequiredEnv('ACTION_STATE_KEY', { length: 32 });

// Optional at startup; API key is intentionally not sourced from this file.
// AI services should use user-saved provider keys and/or environment variables.
const GEMINI_API_KEY = null;
const GEMINI_MODEL_ID = String(process.env.GEMINI_MODEL_ID || '').trim();

module.exports = {
  SECRET_KEY,
  SESSION_SECRET,
  ENCRYPTION_KEY,
  ACTION_STATE_KEY,
  IV_LENGTH: 16,
  VALIDITY_TIME: 10 * 60 * 1000,
  GEMINI_API_KEY,
  GEMINI_MODEL_ID
};
