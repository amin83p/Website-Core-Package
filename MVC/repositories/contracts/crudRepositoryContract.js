const REQUIRED_CRUD_METHODS = Object.freeze(['list', 'getById', 'create', 'update', 'remove']);
const REQUIRED_QUERY_METHODS = Object.freeze(['count', 'exists']);

function assertCrudRepository(name, repository) {
  const repoName = String(name || 'repository');
  if (!repository || typeof repository !== 'object') {
    throw new Error(`${repoName} must be an object.`);
  }

  const missing = REQUIRED_CRUD_METHODS.filter((methodName) => typeof repository[methodName] !== 'function');
  if (missing.length > 0) {
    throw new Error(`${repoName} is missing required method(s): ${missing.join(', ')}.`);
  }
}

function assertQueryableCrudRepository(name, repository) {
  assertCrudRepository(name, repository);

  const repoName = String(name || 'repository');
  const missing = REQUIRED_QUERY_METHODS.filter((methodName) => typeof repository?.[methodName] !== 'function');
  if (missing.length > 0) {
    throw new Error(`${repoName} is missing required query method(s): ${missing.join(', ')}.`);
  }
}

module.exports = {
  REQUIRED_CRUD_METHODS,
  REQUIRED_QUERY_METHODS,
  assertCrudRepository,
  assertQueryableCrudRepository
};
