function normalizeSearchType(type) {
  return String(type || 'contains').trim().toLowerCase().replace(/_/g, '');
}

function parseSearchFieldTokens(searchFields) {
  return String(searchFields || '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token !== 'all');
}

function valueMatchesSearchQuery(rawValue, qLower, normalizedType) {
  const value = String(rawValue ?? '').trim().toLowerCase();
  if (!value) return false;
  if (normalizedType === 'exactmatch') return value === qLower;
  if (normalizedType === 'startswith') return value.startsWith(qLower);
  return value.includes(qLower);
}

function recordMatchesMultiFieldSearch(record, { q, type, searchFields } = {}, options = {}) {
  const qLower = String(q || '').trim().toLowerCase();
  if (!qLower) return true;

  const normalizedType = normalizeSearchType(type);
  const fieldTokens = parseSearchFieldTokens(searchFields);
  const useAll = !fieldTokens.length;
  const readFieldValues = options.readFieldValues;
  const getHaystack = options.getHaystack;

  if (useAll) {
    const haystack = typeof getHaystack === 'function' ? getHaystack(record) : '';
    return String(haystack || '').trim().toLowerCase().includes(qLower);
  }

  if (typeof readFieldValues !== 'function') return false;

  return fieldTokens.some((fieldToken) => {
    const values = readFieldValues(record, fieldToken);
    const list = Array.isArray(values) ? values : [values];
    return list.some((raw) => valueMatchesSearchQuery(raw, qLower, normalizedType));
  });
}

module.exports = {
  normalizeSearchType,
  parseSearchFieldTokens,
  valueMatchesSearchQuery,
  recordMatchesMultiFieldSearch
};
