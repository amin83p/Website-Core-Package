function normalizeSearch(search) {
  if (!search) return {};
  if (typeof search === 'string') return { q: search };
  if (typeof search !== 'object') return {};

  const out = {};
  if (search.q !== undefined) out.q = search.q;
  else if (search.text !== undefined) out.q = search.text;
  else if (search.value !== undefined) out.q = search.value;

  if (search.type !== undefined) out.type = search.type;
  else if (search.operator !== undefined) out.type = search.operator;

  if (search.searchFields !== undefined) out.searchFields = search.searchFields;
  else if (search.fields !== undefined) out.searchFields = search.fields;

  return out;
}

function normalizeSort(sort) {
  if (!sort) return {};
  if (typeof sort === 'string') return { sort };
  if (typeof sort !== 'object') return {};

  const out = {};
  if (sort.sort !== undefined) out.sort = sort.sort;
  else if (sort.field !== undefined) out.sort = sort.field;
  else if (sort.by !== undefined) out.sort = sort.by;

  if (sort.order !== undefined) out.order = sort.order;
  else if (sort.direction !== undefined) out.order = sort.direction;

  return out;
}

function normalizePagination(pagination) {
  if (!pagination || typeof pagination !== 'object') return {};
  const out = {};
  if (pagination.page !== undefined) out.page = pagination.page;
  if (pagination.limit !== undefined) out.limit = pagination.limit;
  else if (pagination.pageSize !== undefined) out.limit = pagination.pageSize;
  return out;
}

function normalizeQueryOptions(input) {
  if (!input || typeof input !== 'object') return {};

  const hasStructuredShape =
    Object.prototype.hasOwnProperty.call(input, 'filters') ||
    Object.prototype.hasOwnProperty.call(input, 'search') ||
    Object.prototype.hasOwnProperty.call(input, 'sort') ||
    Object.prototype.hasOwnProperty.call(input, 'pagination');

  if (!hasStructuredShape) return input;

  const filters = input.filters && typeof input.filters === 'object' ? input.filters : {};
  const search = normalizeSearch(input.search);
  const sort = normalizeSort(input.sort);
  const pagination = normalizePagination(input.pagination);

  // Preserve explicit top-level legacy keys when provided.
  const passthrough = { ...input };
  delete passthrough.filters;
  delete passthrough.search;
  delete passthrough.sort;
  delete passthrough.pagination;

  return {
    ...filters,
    ...search,
    ...sort,
    ...pagination,
    ...passthrough
  };
}

module.exports = {
  normalizeQueryOptions
};
