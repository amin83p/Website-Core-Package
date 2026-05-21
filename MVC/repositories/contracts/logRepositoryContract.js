const { assertQueryableCrudRepository } = require('./crudRepositoryContract');

const REQUIRED_LOG_METHODS = Object.freeze([
  'addLog',
  'getReport',
  'deleteAllLog',
  'getSystemLogStats'
]);

function assertLogRepository(name, repository) {
  assertQueryableCrudRepository(name, repository);

  const repoName = String(name || 'logRepository');
  const missing = REQUIRED_LOG_METHODS.filter((methodName) => typeof repository?.[methodName] !== 'function');
  if (missing.length > 0) {
    throw new Error(`${repoName} is missing required log method(s): ${missing.join(', ')}.`);
  }
}

module.exports = {
  REQUIRED_LOG_METHODS,
  assertLogRepository
};
