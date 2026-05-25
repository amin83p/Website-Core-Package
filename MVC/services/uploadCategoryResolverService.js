const resolvers = new Map();

function cleanCategory(value = '') {
  return String(value || '').trim().toLowerCase();
}

function assertResolverKey(category = '') {
  const key = cleanCategory(category);
  if (!key) throw new Error('Upload category resolver requires a category key.');
  return key;
}

function registerUploadCategoryResolver(category = '', resolver) {
  const key = assertResolverKey(category);
  if (typeof resolver !== 'function') {
    throw new Error('Upload category resolver must be a function.');
  }
  resolvers.set(key, resolver);
  return key;
}

function unregisterUploadCategoryResolver(category = '') {
  const key = assertResolverKey(category);
  return resolvers.delete(key);
}

function hasUploadCategoryResolver(category = '') {
  return resolvers.has(cleanCategory(category));
}

function resolveUploadCategory(category = '', context = {}) {
  const key = cleanCategory(category);
  if (!key || !resolvers.has(key)) return '';
  const resolver = resolvers.get(key);
  const resolved = resolver({
    ...context,
    category,
    normalizedCategory: key
  });
  return String(resolved || '').trim();
}

function resetUploadCategoryResolvers() {
  resolvers.clear();
}

module.exports = {
  registerUploadCategoryResolver,
  unregisterUploadCategoryResolver,
  hasUploadCategoryResolver,
  resolveUploadCategory,
  resetUploadCategoryResolvers
};
