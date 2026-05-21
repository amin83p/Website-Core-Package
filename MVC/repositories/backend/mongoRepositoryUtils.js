const { ObjectId } = require('mongodb');
const { toPublicId } = require('../../utils/idAdapter');

const RESERVED_QUERY_KEYS = new Set([
  'q',
  'type',
  'searchFields',
  'page',
  'limit',
  'sort',
  'order',
  'startDate',
  'endDate'
]);

const STRICT_EQUALITY_FIELD_PATTERN = /(^|\.)(id|_id|code|slug|username|email|orgid|userid|personid|sectionid|operationid)$/i;

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeOperator(value, fallback = 'contains') {
  const token = String(value || '').trim().toLowerCase();
  if (!token) return fallback;
  if (token === 'exact_match' || token === 'exact') return 'eq';
  if (token === 'ne' || token === 'not_equal' || token === 'not_equals') return 'neq';
  if (token === 'eq' || token === 'neq' || token === 'in' || token === 'starts_with' || token === 'contains') return token;
  return fallback;
}

function parseSortOrder(order, fallback = 1) {
  const token = String(order || '').trim().toLowerCase();
  if (token === 'desc' || token === 'descending' || token === '-1') return -1;
  if (token === 'asc' || token === 'ascending' || token === '1') return 1;
  return fallback;
}

function parsePositiveInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function parseInValues(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBooleanLike(value) {
  if (typeof value === 'boolean') return value;
  const token = String(value ?? '').trim().toLowerCase();
  if (token === 'true') return true;
  if (token === 'false') return false;
  return null;
}

function parseDateRangeBoundary(value, boundary = 'start') {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const year = Number.parseInt(dateOnly[1], 10);
    const month = Number.parseInt(dateOnly[2], 10);
    const day = Number.parseInt(dateOnly[3], 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    if (boundary === 'end') return new Date(year, month - 1, day, 23, 59, 59, 999);
    return new Date(year, month - 1, day, 0, 0, 0, 0);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  if (boundary === 'end') {
    parsed.setHours(23, 59, 59, 999);
  } else {
    parsed.setHours(0, 0, 0, 0);
  }
  return parsed;
}

function parseFieldFilter(fieldKey, rawValue) {
  let field = String(fieldKey || '').trim();
  let value = rawValue;
  let operator = null;

  const markerIndex = field.lastIndexOf('__');
  if (markerIndex > 0) {
    const op = normalizeOperator(field.slice(markerIndex + 2), null);
    if (op) {
      operator = op;
      field = field.slice(0, markerIndex);
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const op = normalizeOperator(value.op || value.operator, null);
    if (op) {
      operator = op;
      if (Object.prototype.hasOwnProperty.call(value, 'value')) value = value.value;
      else if (Object.prototype.hasOwnProperty.call(value, 'values')) value = value.values;
    }
  }

  if (!operator) {
    const booleanLike = parseBooleanLike(value);
    if (booleanLike !== null) operator = 'eq';
    else operator = Array.isArray(value) ? 'in' : (STRICT_EQUALITY_FIELD_PATTERN.test(field) ? 'eq' : 'contains');
  }

  return { field, operator, value };
}

function buildFieldClause(field, operator, value) {
  if (!field) return null;
  if (value === undefined || value === null || value === '') return null;

  if (operator === 'in') {
    const values = parseInValues(value);
    if (!values.length) return null;
    return { [field]: { $in: values } };
  }

  if (operator === 'eq') {
    const booleanLike = parseBooleanLike(value);
    if (booleanLike !== null) {
      // Support both canonical boolean storage and legacy string storage.
      return { [field]: { $in: [booleanLike, String(booleanLike)] } };
    }
    if (STRICT_EQUALITY_FIELD_PATTERN.test(field)) return { [field]: String(value).trim() };
    return { [field]: { $regex: new RegExp(`^${escapeRegex(value)}$`, 'i') } };
  }

  if (operator === 'neq') {
    const booleanLike = parseBooleanLike(value);
    if (booleanLike !== null) {
      // Keep legacy string compatibility and include records with missing field.
      return { [field]: { $nin: [booleanLike, String(booleanLike)] } };
    }
    if (STRICT_EQUALITY_FIELD_PATTERN.test(field)) return { [field]: { $ne: String(value).trim() } };
    return { [field]: { $not: new RegExp(`^${escapeRegex(value)}$`, 'i') } };
  }

  if (operator === 'starts_with') {
    return { [field]: { $regex: new RegExp(`^${escapeRegex(value)}`, 'i') } };
  }

  return { [field]: { $regex: new RegExp(escapeRegex(value), 'i') } };
}

function buildTextSearchClause(query = {}, defaultSearchFields = []) {
  const searchQuery = String(query?.q || '').trim();
  if (!searchQuery) return null;

  const searchOperator = normalizeOperator(query?.type, 'contains');
  const fields = Array.isArray(query?.searchFields)
    ? query.searchFields
    : String(query?.searchFields || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  const targetFields = fields.length ? fields : defaultSearchFields;
  if (!targetFields.length) return null;

  const clauses = targetFields
    .map((field) => buildFieldClause(field, searchOperator, searchQuery))
    .filter(Boolean);
  if (!clauses.length) return null;
  return { $or: clauses };
}

function buildDateRangeClause(query = {}, dateFields = []) {
  const startDate = String(query?.startDate || '').trim();
  const endDate = String(query?.endDate || '').trim();
  if (!startDate && !endDate) return null;
  if (!Array.isArray(dateFields) || !dateFields.length) return null;

  const range = {};
  if (startDate) {
    const parsedStart = parseDateRangeBoundary(startDate, 'start');
    if (parsedStart) range.$gte = parsedStart;
  }
  if (endDate) {
    const parsedEnd = parseDateRangeBoundary(endDate, 'end');
    if (parsedEnd) range.$lte = parsedEnd;
  }
  if (!Object.keys(range).length) return null;

  return {
    $or: dateFields.map((field) => ({ [field]: range }))
  };
}

function buildMongoFilterFromQuery(query = {}, options = {}) {
  const clauses = [];
  const fieldFilters = { ...(query || {}) };
  RESERVED_QUERY_KEYS.forEach((key) => delete fieldFilters[key]);

  Object.entries(fieldFilters).forEach(([key, rawValue]) => {
    const { field, operator, value } = parseFieldFilter(key, rawValue);
    const clause = buildFieldClause(field, operator, value);
    if (clause) clauses.push(clause);
  });

  const textClause = buildTextSearchClause(query, options?.defaultSearchFields || []);
  if (textClause) clauses.push(textClause);

  const dateClause = buildDateRangeClause(query, options?.dateFields || []);
  if (dateClause) clauses.push(dateClause);

  if (!clauses.length) return {};
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
}

function buildMongoSortFromQuery(query = {}, explicitSort = null) {
  if (explicitSort && typeof explicitSort === 'object' && !Array.isArray(explicitSort)) {
    const keys = Object.keys(explicitSort);
    if (keys.length) return explicitSort;
  }

  const rawSort = query?.sort;
  if (!rawSort) return { id: 1 };

  const fields = Array.isArray(rawSort)
    ? rawSort
    : String(rawSort)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  if (!fields.length) return { id: 1 };

  const baseOrder = parseSortOrder(query?.order, 1);
  return fields.reduce((acc, field) => {
    if (!field) return acc;
    if (field.startsWith('-')) {
      acc[field.slice(1)] = -1;
      return acc;
    }
    acc[field] = baseOrder;
    return acc;
  }, {});
}

function resolveMongoPagination(query = {}, pagination = null) {
  const limit = parsePositiveInt(query?.limit, parsePositiveInt(pagination?.limit, 0));
  const page = parsePositiveInt(query?.page, parsePositiveInt(pagination?.page, 1));
  const skip = limit > 0 ? Math.max(0, (page - 1) * limit) : 0;
  return { page, limit, skip };
}

function normalizeMongoDocument(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const output = { ...doc };
  const publicId = toPublicId(output?.id || output?._id);
  output.id = publicId;
  delete output._id;
  return output;
}

function combineMongoFilters(...filters) {
  const parts = filters
    .filter((value) => value && typeof value === 'object')
    .filter((value) => Object.keys(value).length > 0);
  if (!parts.length) return {};
  if (parts.length === 1) return parts[0];
  return { $and: parts };
}

function resolveMongoIdFilter(id) {
  const publicId = toPublicId(id);
  if (!publicId) return { _id: null };
  // Support both canonical `id` and legacy/custom string `_id` records.
  const clauses = [{ id: publicId }, { _id: publicId }];
  if (ObjectId.isValid(publicId)) clauses.push({ _id: new ObjectId(publicId) });
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

async function generateUniqueStringId(collection, requestedId = null, options = {}) {
  const requested = toPublicId(requestedId);
  if (requested) return requested;

  const min = Number.isFinite(options?.min) ? options.min : 100000;
  const max = Number.isFinite(options?.max) ? options.max : 999999;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = String(Math.floor(min + Math.random() * (max - min + 1)));
    // eslint-disable-next-line no-await-in-loop
    const exists = await collection.findOne({ id: candidate }, { projection: { _id: 1 } });
    if (!exists) return candidate;
  }

  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function deepMerge(target, source) {
  const base = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) return base;

  Object.keys(source).forEach((key) => {
    const value = source[key];
    if (Array.isArray(value)) {
      base[key] = [...value];
      return;
    }
    if (value && typeof value === 'object') {
      const current = base[key];
      base[key] = deepMerge(current && typeof current === 'object' ? current : {}, value);
      return;
    }
    base[key] = value;
  });

  return base;
}

module.exports = {
  buildMongoFilterFromQuery,
  buildMongoSortFromQuery,
  resolveMongoPagination,
  normalizeMongoDocument,
  combineMongoFilters,
  resolveMongoIdFilter,
  generateUniqueStringId,
  deepMerge
};
