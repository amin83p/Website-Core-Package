const SUPPORTED_DATA_BACKENDS = Object.freeze(['json', 'mongo']);
const DEFAULT_DATA_BACKEND = 'json';

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const token = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'y'].includes(token)) return true;
  if (['0', 'false', 'no', 'off', 'n'].includes(token)) return false;
  return fallback;
}

function normalizeBackendMode(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();

  if (!normalized) return DEFAULT_DATA_BACKEND;
  if (SUPPORTED_DATA_BACKENDS.includes(normalized)) return normalized;
  return DEFAULT_DATA_BACKEND;
}

function resolveDataBackendConfig(env = process.env, options = {}) {
  const nodeEnv = String(env?.NODE_ENV || '').trim().toLowerCase();
  const isProduction = nodeEnv === 'production';
  const envBackendRaw = String(env?.DATA_BACKEND || '').trim();
  const hasEnvOverride = Boolean(envBackendRaw);
  const requestedRaw = hasEnvOverride ? envBackendRaw : DEFAULT_DATA_BACKEND;
  const requested = String(requestedRaw || '').trim().toLowerCase();
  const mode = normalizeBackendMode(requestedRaw || DEFAULT_DATA_BACKEND);

  const warnings = [];
  if (requested && mode !== requested) {
    warnings.push(
      `Unsupported DATA_BACKEND="${requested}". Falling back to "${DEFAULT_DATA_BACKEND}".`
    );
  }

  const canonicalMongoUri = String(env?.MONGODB_URI || '').trim();
  const legacyMongoUri = String(env?.MONGO_URI || '').trim();
  const canonicalMongoDb = String(env?.MONGODB_DB || '').trim();
  const legacyMongoDb = String(env?.MONGO_DB || '').trim();
  const envMongoUri = String(canonicalMongoUri || legacyMongoUri || '').trim();
  const mongoUri = envMongoUri;
  const mongoReady = mongoUri.length > 0;
  const mongoSource = envMongoUri ? 'env' : 'none';
  const strictMode = parseBoolean(env?.DATA_BACKEND_STRICT, false);

  if (mode === 'mongo' && !mongoReady) {
    warnings.push('Mongo backend selected but no Mongo URI is configured. Set MONGODB_URI. Legacy MONGO_URI is still supported temporarily.');
  }
  if (canonicalMongoUri && legacyMongoUri && canonicalMongoUri !== legacyMongoUri) {
    warnings.push('Both MONGODB_URI and legacy MONGO_URI are set with different values. MONGODB_URI takes precedence; remove MONGO_URI to avoid confusion.');
  }
  if (!canonicalMongoUri && legacyMongoUri) {
    warnings.push('Using legacy MONGO_URI alias. Rename it to MONGODB_URI when possible.');
  }
  if (canonicalMongoDb && legacyMongoDb && canonicalMongoDb !== legacyMongoDb) {
    warnings.push('Both MONGODB_DB and legacy MONGO_DB are set with different values. MONGODB_DB takes precedence; remove MONGO_DB to avoid confusion.');
  }
  if (!canonicalMongoDb && legacyMongoDb) {
    warnings.push('Using legacy MONGO_DB alias. Rename it to MONGODB_DB when possible.');
  }
  if (isProduction && !hasEnvOverride) {
    warnings.push('Production mode requires DATA_BACKEND environment variable.');
  }
  if (isProduction && mode !== 'mongo') {
    warnings.push('Production mode requires DATA_BACKEND=mongo.');
  }
  if (isProduction && !envMongoUri) {
    warnings.push('Production mode requires MONGODB_URI environment variable. Legacy MONGO_URI is still supported temporarily.');
  }

  let source = 'default';
  if (hasEnvOverride) source = 'env';

  return {
    mode,
    requested: requested || DEFAULT_DATA_BACKEND,
    source,
    hasEnvOverride,
    preferredMode: mode,
    supported: [...SUPPORTED_DATA_BACKENDS],
    defaultMode: DEFAULT_DATA_BACKEND,
    env: {
      dataBackendSet: hasEnvOverride,
      mongoUriSet: Boolean(envMongoUri),
      mongoDbSet: Boolean(canonicalMongoDb || legacyMongoDb),
      mongoUriLegacyAliasSet: Boolean(legacyMongoUri),
      mongoDbLegacyAliasSet: Boolean(legacyMongoDb)
    },
    mongo: {
      uri: mongoUri,
      ready: mongoReady,
      source: mongoSource,
      hasEnvOverride: Boolean(envMongoUri)
    },
    production: {
      active: isProduction,
      lockedToEnv: isProduction
    },
    strict: {
      enabled: strictMode
    },
    fallback: {
      active: false,
      targetMode: 'json',
      reason: '',
      message: ''
    },
    warnings
  };
}

function getDataBackendMode(env = process.env) {
  return resolveDataBackendConfig(env).mode;
}

function isJsonBackend(env = process.env) {
  return getDataBackendMode(env) === 'json';
}

function isMongoBackend(env = process.env) {
  return getDataBackendMode(env) === 'mongo';
}

module.exports = {
  SUPPORTED_DATA_BACKENDS,
  DEFAULT_DATA_BACKEND,
  parseBoolean,
  normalizeBackendMode,
  resolveDataBackendConfig,
  getDataBackendMode,
  isJsonBackend,
  isMongoBackend
};
