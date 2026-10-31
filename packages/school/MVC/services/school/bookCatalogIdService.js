'use strict';

const { allocateWithRetry } = require('./schoolEntityIdAllocationService');

function formatBookCatalogId(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `BK-${random}-${hh}${mm}`;
}

async function allocateUniqueBookCatalogId(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  return allocateWithRetry({
    collection: options.collection || null,
    existingIds: options.existingIds,
    reservedIds: options.reservedIds,
    maxAttempts: options.maxAttempts,
    generateCandidate: (attempt) => {
      const tick = new Date(now.getTime() + attempt * 60000);
      return formatBookCatalogId(tick);
    }
  });
}

module.exports = {
  formatBookCatalogId,
  allocateUniqueBookCatalogId
};
