'use strict';

function cloneCacheValue(value) {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (_) {
      // Fall through to JSON clone.
    }
  }
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  cloneCacheValue
};
