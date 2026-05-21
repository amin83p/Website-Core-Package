const { isDeepStrictEqual } = require('node:util');

const DEFAULT_HIDDEN_PATH_PREFIXES = Object.freeze([
  'updatedAt',
  'lastActiveAt',
  'createdAt',
  'audit.createUser',
  'audit.createDateTime',
  'audit.lastUpdateUser',
  'audit.lastUpdateDateTime',
  'audit.updatedAt',
  'audit.modifiedAt'
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizePrimitive(value) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function sanitizeComparable(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeComparable(item));
  }

  if (isPlainObject(value)) {
    const out = {};
    Object.keys(value).forEach((key) => {
      out[key] = sanitizeComparable(value[key]);
    });
    return out;
  }

  return normalizePrimitive(value);
}

function pathIsHidden(pathToken = '', hiddenPrefixes = []) {
  const path = String(pathToken || '').trim();
  if (!path) return false;
  const prefixes = Array.isArray(hiddenPrefixes) ? hiddenPrefixes : [];
  return prefixes.some((prefixRaw) => {
    const prefix = String(prefixRaw || '').trim();
    if (!prefix) return false;
    return path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`);
  });
}

function pushChange(target, change, hiddenPrefixes) {
  const row = change && typeof change === 'object' ? change : null;
  if (!row) return;

  if (pathIsHidden(row.path, hiddenPrefixes)) {
    target.hiddenAuditCount += 1;
    return;
  }

  target.changes.push(row);
  if (row.type === 'added') target.addedCount += 1;
  if (row.type === 'changed') target.changedCount += 1;
}

function buildPath(parentPath = '', token = '') {
  const parent = String(parentPath || '').trim();
  const key = String(token || '').trim();
  if (!parent) return key;
  if (!key) return parent;
  if (key.startsWith('[')) return `${parent}${key}`;
  return `${parent}.${key}`;
}

function walkAddedSubtree(afterValue, path, state, hiddenPrefixes) {
  if (Array.isArray(afterValue)) {
    if (!afterValue.length) {
      pushChange(state, {
        path,
        type: 'added',
        from: undefined,
        to: sanitizeComparable(afterValue)
      }, hiddenPrefixes);
      return;
    }

    afterValue.forEach((item, index) => {
      walkAddedSubtree(item, buildPath(path, `[${index}]`), state, hiddenPrefixes);
    });
    return;
  }

  if (isPlainObject(afterValue)) {
    const keys = Object.keys(afterValue);
    if (!keys.length) {
      pushChange(state, {
        path,
        type: 'added',
        from: undefined,
        to: sanitizeComparable(afterValue)
      }, hiddenPrefixes);
      return;
    }

    keys.forEach((key) => {
      walkAddedSubtree(afterValue[key], buildPath(path, key), state, hiddenPrefixes);
    });
    return;
  }

  pushChange(state, {
    path,
    type: 'added',
    from: undefined,
    to: sanitizeComparable(afterValue)
  }, hiddenPrefixes);
}

function walkDiff(afterValue, beforeValue, path, hasBefore, state, hiddenPrefixes) {
  const afterIsArray = Array.isArray(afterValue);
  const beforeIsArray = Array.isArray(beforeValue);
  const afterIsObject = isPlainObject(afterValue);
  const beforeIsObject = isPlainObject(beforeValue);

  if (!hasBefore) {
    walkAddedSubtree(afterValue, path, state, hiddenPrefixes);
    return;
  }

  if (afterIsArray && beforeIsArray) {
    const maxLength = afterValue.length;
    for (let index = 0; index < maxLength; index += 1) {
      const childPath = buildPath(path, `[${index}]`);
      const childHasBefore = index < beforeValue.length;
      walkDiff(afterValue[index], beforeValue[index], childPath, childHasBefore, state, hiddenPrefixes);
    }
    return;
  }

  if (afterIsObject && beforeIsObject) {
    Object.keys(afterValue).forEach((key) => {
      const childPath = buildPath(path, key);
      const childHasBefore = Object.prototype.hasOwnProperty.call(beforeValue, key);
      walkDiff(afterValue[key], beforeValue[key], childPath, childHasBefore, state, hiddenPrefixes);
    });
    return;
  }

  if ((afterIsArray || afterIsObject) !== (beforeIsArray || beforeIsObject)) {
    if (!isDeepStrictEqual(sanitizeComparable(afterValue), sanitizeComparable(beforeValue))) {
      pushChange(state, {
        path,
        type: 'changed',
        from: sanitizeComparable(beforeValue),
        to: sanitizeComparable(afterValue)
      }, hiddenPrefixes);
    }
    return;
  }

  if (!isDeepStrictEqual(sanitizeComparable(afterValue), sanitizeComparable(beforeValue))) {
    pushChange(state, {
      path,
      type: 'changed',
      from: sanitizeComparable(beforeValue),
      to: sanitizeComparable(afterValue)
    }, hiddenPrefixes);
  }
}

function buildActionStateDiff(beforeSnapshot, afterSnapshot, options = {}) {
  const hiddenPrefixes = Array.isArray(options?.hiddenPathPrefixes)
    ? options.hiddenPathPrefixes
    : DEFAULT_HIDDEN_PATH_PREFIXES;

  const beforeValue = beforeSnapshot === undefined || beforeSnapshot === null ? {} : beforeSnapshot;
  const afterValue = afterSnapshot === undefined || afterSnapshot === null ? {} : afterSnapshot;

  const state = {
    addedCount: 0,
    changedCount: 0,
    hiddenAuditCount: 0,
    changes: []
  };

  if (Array.isArray(afterValue)) {
    afterValue.forEach((item, index) => {
      const hasBefore = Array.isArray(beforeValue) && index < beforeValue.length;
      const beforeItem = Array.isArray(beforeValue) ? beforeValue[index] : undefined;
      walkDiff(item, beforeItem, `[${index}]`, hasBefore, state, hiddenPrefixes);
    });
  } else if (isPlainObject(afterValue)) {
    Object.keys(afterValue).forEach((key) => {
      const hasBefore = isPlainObject(beforeValue) && Object.prototype.hasOwnProperty.call(beforeValue, key);
      const beforeItem = isPlainObject(beforeValue) ? beforeValue[key] : undefined;
      walkDiff(afterValue[key], beforeItem, key, hasBefore, state, hiddenPrefixes);
    });
  } else {
    walkDiff(afterValue, beforeValue, 'value', true, state, hiddenPrefixes);
  }

  return {
    changes: state.changes,
    summary: {
      addedCount: state.addedCount,
      changedCount: state.changedCount,
      hiddenAuditCount: state.hiddenAuditCount
    }
  };
}

module.exports = {
  DEFAULT_HIDDEN_PATH_PREFIXES,
  buildActionStateDiff
};
