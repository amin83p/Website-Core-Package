'use strict';

const { allocateWithRetry } = require('./schoolEntityIdAllocationService');

async function allocateUniqueActivityId(options = {}) {
  return allocateWithRetry({
    collection: options.collection || null,
    existingIds: options.existingIds,
    reservedIds: options.reservedIds,
    maxAttempts: options.maxAttempts,
    generateCandidate: () => `ACT-${Math.floor(100000 + Math.random() * 900000)}`
  });
}

async function allocateUniqueActivityCategoryId(options = {}) {
  return allocateWithRetry({
    collection: options.collection || null,
    existingIds: options.existingIds,
    reservedIds: options.reservedIds,
    maxAttempts: options.maxAttempts,
    generateCandidate: () => `ACTCAT-${Math.floor(100000 + Math.random() * 900000)}`
  });
}

module.exports = {
  allocateUniqueActivityId,
  allocateUniqueActivityCategoryId
};
