'use strict';

const { allocateWithRetry } = require('./schoolEntityIdAllocationService');
const { resolveSchoolCreateId } = require('./schoolEntityIdAllocationService');

function candidateWithdrawalId(type) {
  const normalized = String(type || '').trim().toLowerCase();
  const prefix = normalized === 'class' ? 'CWD' : normalized === 'term' ? 'TWD' : 'PWD';
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function allocateUniqueWithdrawalId(options = {}) {
  const withdrawalType = options.withdrawalType || options.type || options.payload?.type;
  return allocateWithRetry({
    collection: options.collection || null,
    existingIds: options.existingIds,
    reservedIds: options.reservedIds,
    maxAttempts: options.maxAttempts,
    generateCandidate: () => candidateWithdrawalId(withdrawalType)
  });
}

async function resolveWithdrawalCreateId(options = {}) {
  const payload = options.payload || options;
  return resolveSchoolCreateId({
    requestedId: options.requestedId ?? payload?.id,
    collection: options.collection || null,
    reservedIds: options.reservedIds ?? options.existingIds,
    allocateNext: () => allocateUniqueWithdrawalId({
      collection: options.collection || null,
      existingIds: options.existingIds,
      reservedIds: options.reservedIds,
      payload,
      withdrawalType: payload?.type
    })
  });
}

module.exports = {
  candidateWithdrawalId,
  allocateUniqueWithdrawalId,
  resolveWithdrawalCreateId
};
