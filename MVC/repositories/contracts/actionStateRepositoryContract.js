const { assertQueryableCrudRepository } = require('./crudRepositoryContract');

const REQUIRED_ACTION_STATE_METHODS = Object.freeze([
  'logAttempt',
  'updateProgress',
  'completeState',
  'failAttempt',
  'recordRetryableError',
  'cancelState',
  'deleteAllActionStates'
]);

function assertActionStateRepository(name, repository) {
  assertQueryableCrudRepository(name, repository);

  const repoName = String(name || 'actionStateRepository');
  const missing = REQUIRED_ACTION_STATE_METHODS.filter((methodName) => typeof repository?.[methodName] !== 'function');
  if (missing.length > 0) {
    throw new Error(`${repoName} is missing required action-state method(s): ${missing.join(', ')}.`);
  }
}

module.exports = {
  REQUIRED_ACTION_STATE_METHODS,
  assertActionStateRepository
};
