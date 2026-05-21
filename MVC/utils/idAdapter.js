function toPublicId(value) {
  if (value === null || value === undefined) return '';

  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }

  if (typeof value === 'object') {
    if (typeof value.toHexString === 'function') {
      return String(value.toHexString()).trim();
    }

    if (value._id !== undefined && value._id !== null) {
      return toPublicId(value._id);
    }

    if (value.id !== undefined && value.id !== null) {
      return toPublicId(value.id);
    }

    if (typeof value.toString === 'function') {
      const raw = String(value.toString()).trim();
      if (raw && raw !== '[object Object]') return raw;
    }
  }

  return '';
}

function toStorageId(value, options = {}) {
  const normalized = toPublicId(value);
  if (!normalized) return null;

  if (options?.preferNumber === true && /^-?\d+$/.test(normalized)) {
    return Number(normalized);
  }

  return normalized;
}

function idsEqual(left, right, options = {}) {
  const leftId = toPublicId(left);
  const rightId = toPublicId(right);
  if (!leftId || !rightId) return false;

  if (options?.caseInsensitive === true) {
    return leftId.toLowerCase() === rightId.toLowerCase();
  }

  return leftId === rightId;
}

function toIdArray(values) {
  if (!Array.isArray(values)) return [];
  return values.map((item) => toPublicId(item)).filter(Boolean);
}

module.exports = {
  toPublicId,
  toStorageId,
  idsEqual,
  toIdArray
};
