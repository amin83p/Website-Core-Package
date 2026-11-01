'use strict';

const { resolveSchoolCreateId } = require('./schoolEntityIdAllocationService');

async function resolveJsonEntityCreateId(options = {}) {
  const existingIds = options.existingIds;
  const reserved = existingIds instanceof Set
    ? existingIds
    : new Set(Array.isArray(existingIds) ? existingIds : []);
  return resolveSchoolCreateId({
    requestedId: options.requestedId,
    reservedIds: reserved,
    allocateNext: () => options.allocate({
      existingIds: reserved,
      reservedIds: reserved,
      ...(options.context || {})
    })
  });
}

module.exports = {
  resolveJsonEntityCreateId
};
