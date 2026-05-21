const ALLOWED_OPERATORS = Object.freeze(['eq', 'neq', 'in', 'starts_with', 'contains']);
const RESERVED_QUERY_KEYS = Object.freeze([
  'q',
  'type',
  'searchFields',
  'page',
  'limit',
  'sort',
  'order'
]);

const STRICT_EQUALITY_FIELD_PATTERN = /(^|\.)(id|_id|code|slug|username|email|orgId|userId|personId|sectionId|operationId)$/i;

function getNestedValue(item, field) {
  if (!item || !field) return undefined;
  const parts = String(field).split('.');
  let value = item;

  for (const part of parts) {
    const match = part.match(/^([a-zA-Z_$][\w$]*)(\[(\d+)\])?$/);
    if (!match) return undefined;

    const key = match[1];
    const index = match[3];
    if (value === null || value === undefined || !(key in value)) return undefined;

    value = value[key];
    if (index !== undefined) {
      if (!Array.isArray(value)) return undefined;
      value = value[Number(index)];
    }
  }

  return value;
}

function resolveSearchFields(query, defaultSearchFields) {
  let targetFields = [];
  if (query?.searchFields) {
    if (Array.isArray(query.searchFields)) targetFields = query.searchFields;
    else if (typeof query.searchFields === 'string') {
      targetFields = query.searchFields.split(',').map((field) => field.trim()).filter(Boolean);
    }
  }
  return targetFields.length > 0 ? targetFields : defaultSearchFields;
}

function resolveItemDate(item, dateFields) {
  for (const field of dateFields) {
    const value = getNestedValue(item, field);
    if (value) return value;
  }
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

function normalizeString(value) {
  return String(value ?? '').toLowerCase().trim();
}

function normalizeOperator(operator, fallback = 'contains') {
  const normalized = normalizeString(operator);
  if (!normalized) return fallback;
  if (normalized === 'exact_match' || normalized === 'exact') return 'eq';
  if (normalized === 'ne' || normalized === 'not_equal' || normalized === 'not_equals') return 'neq';
  if (ALLOWED_OPERATORS.includes(normalized)) return normalized;
  return fallback;
}

function parsePositiveInteger(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeSortOrder(order, fallback = 'asc') {
  const normalized = normalizeString(order);
  if (normalized === 'desc' || normalized === 'descending' || normalized === '-1') return 'desc';
  if (normalized === 'asc' || normalized === 'ascending' || normalized === '1') return 'asc';
  return fallback;
}

function parseSortInstructions(sortValue, orderValue) {
  if (!sortValue) return [];

  const baseOrder = normalizeSortOrder(orderValue, 'asc');
  const rawFields = Array.isArray(sortValue)
    ? sortValue
    : String(sortValue)
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean);

  return rawFields
    .map((field) => {
      const hasPrefix = field.startsWith('-');
      const cleanField = hasPrefix ? field.slice(1).trim() : field;
      if (!cleanField) return null;
      return {
        field: cleanField,
        order: hasPrefix ? 'desc' : baseOrder
      };
    })
    .filter(Boolean);
}

function compareUnknownValues(left, right) {
  if (left === right) return 0;
  if (left === undefined || left === null) return 1;
  if (right === undefined || right === null) return -1;

  const leftType = typeof left;
  const rightType = typeof right;

  if (leftType === 'number' && rightType === 'number') return left - right;
  if (leftType === 'boolean' && rightType === 'boolean') return Number(left) - Number(right);

  const leftDate = Date.parse(left);
  const rightDate = Date.parse(right);
  if (!Number.isNaN(leftDate) && !Number.isNaN(rightDate)) return leftDate - rightDate;

  return String(left).localeCompare(String(right), undefined, { sensitivity: 'base' });
}

function applySort(rows, query) {
  const instructions = parseSortInstructions(query?.sort, query?.order);
  if (!instructions.length) return rows;

  const output = [...rows];
  output.sort((a, b) => {
    for (const instruction of instructions) {
      const left = getNestedValue(a, instruction.field);
      const right = getNestedValue(b, instruction.field);
      const comparison = compareUnknownValues(left, right);
      if (comparison !== 0) return instruction.order === 'desc' ? -comparison : comparison;
    }
    return 0;
  });
  return output;
}

function applyPagination(rows, query) {
  const limit = parsePositiveInteger(query?.limit, null);
  const page = parsePositiveInteger(query?.page, 1) || 1;
  if (!limit) return rows;

  const startIndex = Math.max(0, (page - 1) * limit);
  return rows.slice(startIndex, startIndex + limit);
}

function isEmptyQueryValue(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function asComparableList(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeString(item));
  return [normalizeString(value)];
}

function parseInValues(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeString(item)).filter(Boolean);
  return normalizeString(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function matchesOperator(itemValue, filterValue, operator) {
  const itemCandidates = asComparableList(itemValue).filter((item) => item !== '');
  if (itemCandidates.length === 0) return false;

  if (operator === 'in') {
    const allowed = new Set(parseInValues(filterValue));
    if (allowed.size === 0) return false;
    return itemCandidates.some((candidate) => allowed.has(candidate));
  }

  const target = normalizeString(filterValue);
  if (!target) return false;

  if (operator === 'eq') {
    return itemCandidates.some((candidate) => candidate === target);
  }

  if (operator === 'neq') {
    return itemCandidates.every((candidate) => candidate !== target);
  }

  if (operator === 'starts_with') {
    return itemCandidates.some((candidate) => candidate.startsWith(target));
  }

  // contains
  return itemCandidates.some((candidate) => candidate.includes(target));
}

function useStrictEqualityByDefault(fieldName) {
  if (!fieldName) return false;
  return STRICT_EQUALITY_FIELD_PATTERN.test(String(fieldName));
}

function resolveFieldFilter(fieldKey, rawValue) {
  let field = String(fieldKey || '');
  let operator = null;
  let value = rawValue;

  // Supports query key syntax: field__eq, field__in, field__starts_with, field__contains
  const markerIndex = field.lastIndexOf('__');
  if (markerIndex > 0) {
    const opCandidate = normalizeOperator(field.slice(markerIndex + 2), null);
    if (opCandidate) {
      operator = opCandidate;
      field = field.slice(0, markerIndex);
    }
  }

  // Supports query value syntax: { op: 'eq'|'in'|'starts_with'|'contains', value: ... }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const maybeOperator = normalizeOperator(value.op || value.operator, null);
    if (maybeOperator) {
      operator = maybeOperator;
      if ('value' in value) value = value.value;
      else if ('values' in value) value = value.values;
    }
  }

  if (!operator) {
    if (Array.isArray(value)) operator = 'in';
    else operator = useStrictEqualityByDefault(field) ? 'eq' : 'contains';
  }

  return { field, operator, value };
}

function applyGenericFilter(data, query, options = {}) {
  if (!Array.isArray(data)) return [];
  if (!query || Object.keys(query).length === 0) return data;

  const defaultSearchFields = Array.isArray(options.defaultSearchFields) && options.defaultSearchFields.length
    ? options.defaultSearchFields
    : ['id', 'name', 'email', 'username', 'description'];
  const dateFields = Array.isArray(options.dateFields) && options.dateFields.length
    ? options.dateFields
    : ['startedAt', 'createdAt', 'timestamp', 'date', 'joinedAt'];

  const rawSearchQuery = query.q;
  const searchQuery = normalizeString(rawSearchQuery);
  const searchOperator = normalizeOperator(query.type, 'contains');
  const targetFields = resolveSearchFields(query, defaultSearchFields);

  const filters = { ...query };
  RESERVED_QUERY_KEYS.forEach((key) => delete filters[key]);
  const { startDate, endDate, ...fieldFilters } = filters;

  const filtered = data.filter((item) => {
    const matchesStandard = Object.keys(fieldFilters).every((fieldKey) => {
      const { field, operator, value } = resolveFieldFilter(fieldKey, fieldFilters[fieldKey]);
      if (isEmptyQueryValue(value)) return true;

      const itemValue = getNestedValue(item, field);
      if (itemValue === undefined || itemValue === null) {
        if (operator === 'neq') return true;
        return false;
      }

      return matchesOperator(itemValue, value, operator);
    });
    if (!matchesStandard) return false;

    if (startDate || endDate) {
      const dateVal = resolveItemDate(item, dateFields);
      if (!dateVal) return false;
      const itemDate = new Date(dateVal).getTime();
      if (Number.isNaN(itemDate)) return false;

      if (startDate) {
        const start = parseDateRangeBoundary(startDate, 'start');
        if (start && itemDate < start.getTime()) return false;
      }
      if (endDate) {
        const end = parseDateRangeBoundary(endDate, 'end');
        if (end && itemDate > end.getTime()) return false;
      }
    }

    if (searchQuery !== '') {
      const matchesSearch = targetFields.some((field) => {
        const itemValue = getNestedValue(item, field);
        if (itemValue === undefined || itemValue === null || itemValue === '') return false;
        return matchesOperator(itemValue, rawSearchQuery, searchOperator);
      });
      if (!matchesSearch) return false;
    }

    return true;
  });

  const sorted = applySort(filtered, query);
  return applyPagination(sorted, query);
}

module.exports = {
  ALLOWED_OPERATORS,
  applyGenericFilter,
  getNestedValue,
  normalizeOperator
};
