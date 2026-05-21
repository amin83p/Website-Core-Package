const { normalizeBackendMode } = require('../../../config/dataBackend');
const { getActiveDataBackendMode } = require('../../infrastructure/runtime/dataBackendRuntime');

function resolveRepositoryBackendMode(options = {}) {
  if (options?.backendMode) {
    return normalizeBackendMode(options.backendMode);
  }
  return normalizeBackendMode(getActiveDataBackendMode());
}

async function runByRepositoryBackend(options = {}, handlers = {}, context = 'repository') {
  const mode = resolveRepositoryBackendMode(options);

  if (mode === 'mongo') {
    if (typeof handlers.mongo === 'function') return handlers.mongo();
    throw new Error(`[${context}] Mongo backend is selected but this repository method is not implemented yet.`);
  }

  if (typeof handlers.json === 'function') return handlers.json();
  throw new Error(`[${context}] JSON backend handler is not implemented.`);
}

module.exports = {
  resolveRepositoryBackendMode,
  runByRepositoryBackend
};
