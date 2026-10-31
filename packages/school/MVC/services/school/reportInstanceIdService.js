'use strict';

const { allocateWithRetry } = require('./schoolEntityIdAllocationService');

function formatReportInstanceId(now = new Date(), attempt = 0) {
  const date = now instanceof Date ? now : new Date(now);
  const tick = new Date(date.getTime() + attempt * 17);
  const year = tick.getFullYear();
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `RPTINS-${year}-${random}`;
}

function formatOverallReportInstanceId(now = new Date(), attempt = 0) {
  const date = now instanceof Date ? now : new Date(now);
  const tick = new Date(date.getTime() + attempt * 17);
  const year = tick.getFullYear();
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `OVRINS-${year}-${random}`;
}

function formatOverallReportManagementSessionId(now = new Date(), attempt = 0) {
  const date = now instanceof Date ? now : new Date(now);
  const tick = new Date(date.getTime() + attempt * 17);
  const year = tick.getFullYear();
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `OVRMSG-${year}-${random}`;
}

async function allocateUniqueReportInstanceId(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  return allocateWithRetry({
    collection: options.collection || null,
    existingIds: options.existingIds,
    reservedIds: options.reservedIds,
    maxAttempts: options.maxAttempts,
    generateCandidate: (attempt) => formatReportInstanceId(now, attempt)
  });
}

async function allocateUniqueOverallReportInstanceId(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  return allocateWithRetry({
    collection: options.collection || null,
    existingIds: options.existingIds,
    reservedIds: options.reservedIds,
    maxAttempts: options.maxAttempts,
    generateCandidate: (attempt) => formatOverallReportInstanceId(now, attempt)
  });
}

async function allocateUniqueOverallReportManagementSessionId(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  return allocateWithRetry({
    collection: options.collection || null,
    existingIds: options.existingIds,
    reservedIds: options.reservedIds,
    maxAttempts: options.maxAttempts,
    generateCandidate: (attempt) => formatOverallReportManagementSessionId(now, attempt)
  });
}

module.exports = {
  formatReportInstanceId,
  formatOverallReportInstanceId,
  formatOverallReportManagementSessionId,
  allocateUniqueReportInstanceId,
  allocateUniqueOverallReportInstanceId,
  allocateUniqueOverallReportManagementSessionId
};
