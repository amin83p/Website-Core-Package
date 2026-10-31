'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { isIdAvailable } = require('./schoolEntityIdAllocationService');

async function resolveReportCreateId(options = {}) {
  const allocateNext = options.allocateNext;
  if (typeof allocateNext !== 'function') {
    throw new Error('allocateNext is required to resolve a report create id.');
  }

  const requested = toPublicId(options.requestedId);
  const reservedIds = options.reservedIds;
  const collection = options.collection || null;

  if (requested) {
    const free = await isIdAvailable(requested, {
      collection,
      existingIds: reservedIds,
      reservedIds: null
    });
    if (free) return requested;
  }

  return allocateNext();
}

module.exports = {
  resolveReportCreateId
};
