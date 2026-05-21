const { resolveDataBackendConfig } = require('../../config/dataBackend');
const {
  setActiveDataBackendConfig,
  getActiveDataBackendConfig,
  isDataBackendRecoveryModeActive
} = require('../infrastructure/runtime/dataBackendRuntime');
const { connectMongo } = require('../infrastructure/mongo/mongoConnection');
const startupLogger = require('../utils/startupLogger');

function maskMongoUri(uri = '') {
  const raw = String(uri || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.username) parsed.username = '***';
    if (parsed.password) parsed.password = '***';
    return parsed.toString().replace(/%2A/g, '*');
  } catch (_) {
    return '[configured]';
  }
}

function getNowIso() {
  return new Date().toISOString();
}

function getStrictBootError(config) {
  const isProduction = Boolean(config?.production?.active);
  if (!isProduction) return '';
  if (!config?.hasEnvOverride) return 'Production requires DATA_BACKEND=mongo in environment variables.';
  if (config?.mode !== 'mongo') return 'Production requires DATA_BACKEND=mongo.';
  if (!config?.mongo?.hasEnvOverride || !config?.mongo?.ready) {
    return 'Production requires MONGODB_URI in environment variables. Legacy MONGO_URI is still supported temporarily.';
  }
  return '';
}

function normalizeError(error) {
  if (!error) return null;
  return {
    name: String(error.name || 'Error'),
    message: String(error.message || error),
    code: String(error.code || ''),
    stack: process.env.NODE_ENV === 'production' ? '' : String(error.stack || '')
  };
}

function withRuntimeStatus(config = {}, runtime = {}) {
  const mongo = config.mongo || {};
  return {
    ...config,
    mongo: {
      ...mongo,
      uriMasked: maskMongoUri(mongo.uri || '')
    },
    runtime: {
      requestedMode: String(config.requested || config.mode || 'json').trim().toLowerCase(),
      activeMode: String(config.mode || 'json').trim().toLowerCase(),
      initializedAt: runtime.initializedAt || getNowIso(),
      lastMongoCheckAt: runtime.lastMongoCheckAt || '',
      lastMongoError: runtime.lastMongoError || null,
      ...(config.runtime || {}),
      ...runtime
    }
  };
}

function activateJsonFallback(requestedConfig, reason, message, error = null) {
  const fallbackConfig = withRuntimeStatus({
    ...requestedConfig,
    mode: 'json',
    preferredMode: requestedConfig?.mode || 'mongo',
    fallback: {
      active: true,
      targetMode: 'json',
      reason,
      message,
      startedAt: getNowIso()
    }
  }, {
    requestedMode: requestedConfig?.mode || 'mongo',
    activeMode: 'json',
    lastMongoCheckAt: getNowIso(),
    lastMongoError: normalizeError(error)
  });

  setActiveDataBackendConfig(fallbackConfig);
  startupLogger.warn('DATABACKEND', 'RECOVERY_MODE', message, {
    requestedMode: requestedConfig?.mode || '',
    activeMode: 'json',
    reason,
    error: error?.message || ''
  });
  return fallbackConfig;
}

async function initializeDataBackend(env = process.env) {
  const requestedConfig = resolveDataBackendConfig(env);
  const strictMode = Boolean(requestedConfig?.strict?.enabled);

  if (Array.isArray(requestedConfig.warnings) && requestedConfig.warnings.length > 0) {
    requestedConfig.warnings.forEach((message) => startupLogger.warn('DATABACKEND', 'BOOT', message));
  }

  if (strictMode) {
    const strictProductionError = getStrictBootError(requestedConfig);
    if (strictProductionError) throw new Error(strictProductionError);
  }

  if (requestedConfig.mode !== 'mongo') {
    const activeConfig = withRuntimeStatus(requestedConfig, {
      requestedMode: requestedConfig.requested || requestedConfig.mode,
      activeMode: requestedConfig.mode,
      lastMongoCheckAt: ''
    });
    setActiveDataBackendConfig(activeConfig);
    startupLogger.info('DATABACKEND', 'BOOT', 'Active mode resolved.', { mode: activeConfig.mode });
    return activeConfig;
  }

  if (!requestedConfig?.mongo?.ready) {
    const baseMessage = 'Mongo backend was requested, but no Mongo URI is configured.';
    if (strictMode) throw new Error(`${baseMessage} DATA_BACKEND_STRICT=true prevents JSON recovery mode.`);
    const message = `${baseMessage} Running in JSON recovery mode.`;
    return activateJsonFallback(requestedConfig, 'missing_mongo_uri', message);
  }

  try {
    setActiveDataBackendConfig(withRuntimeStatus(requestedConfig, {
      requestedMode: 'mongo',
      activeMode: 'mongo',
      lastMongoCheckAt: getNowIso()
    }));
    await connectMongo({ uri: requestedConfig.mongo.uri });
    const activeConfig = withRuntimeStatus(requestedConfig, {
      requestedMode: 'mongo',
      activeMode: 'mongo',
      lastMongoCheckAt: getNowIso(),
      lastMongoError: null
    });
    setActiveDataBackendConfig(activeConfig);
    startupLogger.success('DATABACKEND', 'MONGO_CONNECTION', 'Mongo connection established.');
    return activeConfig;
  } catch (error) {
    if (strictMode) throw error;
    const message = 'Mongo backend was requested, but the connection failed. Running in JSON recovery mode.';
    return activateJsonFallback(requestedConfig, 'mongo_connection_failed', message, error);
  }
}

async function retryMongoConnection(env = process.env) {
  const requestedConfig = resolveDataBackendConfig(env);
  if (requestedConfig.mode !== 'mongo') {
    throw new Error('DATA_BACKEND is not set to mongo, so there is no Mongo connection to retry.');
  }
  if (!requestedConfig?.mongo?.ready) {
    throw new Error('Mongo URI is missing. Set MONGODB_URI, then restart or retry. Legacy MONGO_URI is still supported temporarily.');
  }

  const checkTime = getNowIso();
  try {
    await connectMongo({ uri: requestedConfig.mongo.uri });
    const activeConfig = withRuntimeStatus({
      ...requestedConfig,
      fallback: {
        active: false,
        targetMode: 'json',
        reason: '',
        message: ''
      }
    }, {
      requestedMode: 'mongo',
      activeMode: 'mongo',
      lastMongoCheckAt: checkTime || getNowIso(),
      lastMongoError: null
    });
    setActiveDataBackendConfig(activeConfig);
    startupLogger.success('DATABACKEND', 'MONGO_RETRY', 'Mongo retry succeeded; active backend is mongo.');
    return activeConfig;
  } catch (error) {
    const fallbackConfig = activateJsonFallback(
      requestedConfig,
      'mongo_retry_failed',
      'Mongo retry failed. The app remains in JSON recovery mode.',
      error
    );
    throw Object.assign(new Error(error?.message || 'Mongo retry failed.'), {
      backendConfig: fallbackConfig,
      originalError: error
    });
  }
}

function getPublicBackendStatus() {
  const activeConfig = getActiveDataBackendConfig();
  const sanitized = withRuntimeStatus(activeConfig, activeConfig.runtime || {});
  if (sanitized?.mongo) {
    sanitized.mongo = {
      ...sanitized.mongo,
      uri: sanitized.mongo.uri ? '[hidden]' : ''
    };
  }
  return sanitized;
}

function isRecoveryModeActive() {
  return isDataBackendRecoveryModeActive();
}

module.exports = {
  initializeDataBackend,
  retryMongoConnection,
  getPublicBackendStatus,
  isRecoveryModeActive,
  maskMongoUri
};
