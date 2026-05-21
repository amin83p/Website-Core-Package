const entityQueryExecutors = new Map();

function normalizeEntityName(entityName) {
  return String(entityName || '').trim().toLowerCase();
}

function registerEntityQueryExecutor(entityName, executor) {
  const key = normalizeEntityName(entityName);
  if (!key) throw new Error('Entity name is required to register query executor.');
  if (typeof executor !== 'function') {
    throw new Error(`Query executor for "${key}" must be a function.`);
  }
  entityQueryExecutors.set(key, executor);
}

function getEntityQueryExecutor(entityName) {
  const key = normalizeEntityName(entityName);
  if (!key) return null;
  return entityQueryExecutors.get(key) || null;
}

function clearEntityQueryExecutors() {
  entityQueryExecutors.clear();
}

module.exports = {
  registerEntityQueryExecutor,
  getEntityQueryExecutor,
  clearEntityQueryExecutors
};

