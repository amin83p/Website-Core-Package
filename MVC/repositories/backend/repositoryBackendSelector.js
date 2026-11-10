const { normalizeBackendMode } = require('../../../config/dataBackend');
const { getActiveDataBackendMode } = require('../../infrastructure/runtime/dataBackendRuntime');
const dataBackendRuntimeService = require('../../services/dataBackendRuntimeService');

function resolveRepositoryBackendMode(options = {}) {
  if (options?.backendMode) {
    return normalizeBackendMode(options.backendMode);
  }
  return normalizeBackendMode(getActiveDataBackendMode());
}

async function runMongoRepositoryHandler(handlers, context, options = {}) {
  if (typeof handlers.mongo !== 'function') {
    throw new Error(`[${context}] Mongo backend is selected but this repository method is not implemented yet.`);
  }

  try {
    return await handlers.mongo();
  } catch (error) {
    if (options?.backendMode || !dataBackendRuntimeService.isRecoverableMongoError(error)) {
      throw error;
    }
    if (typeof handlers.json !== 'function') {
      await dataBackendRuntimeService.recoverFromMongoRepositoryFailure(error);
      throw error;
    }
    await dataBackendRuntimeService.recoverFromMongoRepositoryFailure(error);
    return handlers.json();
  }
}

async function runByRepositoryBackend(options = {}, handlers = {}, context = 'repository') {
  if (!options?.backendMode) {
    await dataBackendRuntimeService.syncActiveDataBackendForRepositoryAccess();
  }
  const mode = resolveRepositoryBackendMode(options);

  if (mode === 'mongo') {
    return runMongoRepositoryHandler(handlers, context, options);
  }

  if (typeof handlers.json === 'function') return handlers.json();
  throw new Error(`[${context}] JSON backend handler is not implemented.`);
}

module.exports = {
  resolveRepositoryBackendMode,
  runByRepositoryBackend
};
