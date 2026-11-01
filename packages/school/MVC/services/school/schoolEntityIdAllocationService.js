'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function toIdSet(existingIds, reservedIds) {
  const set = new Set();
  if (existingIds instanceof Set) {
    existingIds.forEach((id) => {
      const token = String(id || '').trim();
      if (token) set.add(token);
    });
  } else if (Array.isArray(existingIds)) {
    existingIds.forEach((id) => {
      const token = String(id || '').trim();
      if (token) set.add(token);
    });
  }
  if (reservedIds instanceof Set) {
    reservedIds.forEach((id) => {
      const token = String(id || '').trim();
      if (token) set.add(token);
    });
  } else if (Array.isArray(reservedIds)) {
    reservedIds.forEach((id) => {
      const token = String(id || '').trim();
      if (token) set.add(token);
    });
  }
  return set;
}

async function isIdAvailable(id, options = {}) {
  const token = String(id || '').trim();
  if (!token) return false;

  const taken = toIdSet(options.existingIds, options.reservedIds);
  if (taken.has(token)) return false;

  if (options.collection) {
    const exists = await options.collection.findOne({ id: token }, { projection: { _id: 1 } });
    if (exists) return false;
  }

  return true;
}

async function allocateWithRetry(options = {}) {
  const generateCandidate = options.generateCandidate;
  if (typeof generateCandidate !== 'function') {
    throw new Error('generateCandidate is required to allocate an id.');
  }

  const maxAttempts = Number.isFinite(options.maxAttempts) ? options.maxAttempts : 1000;
  const collection = options.collection || null;
  const baseReserved = toIdSet(options.existingIds, options.reservedIds);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const candidateRaw = await generateCandidate(attempt);
    const candidate = String(candidateRaw || '').trim();
    if (!candidate) continue;

    // eslint-disable-next-line no-await-in-loop
    const free = await isIdAvailable(candidate, {
      collection,
      existingIds: baseReserved,
      reservedIds: null
    });
    if (free) return candidate;
    baseReserved.add(candidate);
  }

  throw new Error('Unable to allocate a unique id.');
}

async function resolveSchoolCreateId(options = {}) {
  const allocateNext = options.allocateNext;
  if (typeof allocateNext !== 'function') {
    throw new Error('allocateNext is required to resolve a school create id.');
  }

  const requested = toPublicId(options.requestedId);
  const collection = options.collection || null;

  if (requested) {
    const free = await isIdAvailable(requested, {
      collection,
      existingIds: options.reservedIds,
      reservedIds: null
    });
    if (free) return requested;
  }

  return allocateNext();
}

function createPrefixedRandomAllocator(prefix, options = {}) {
  const safePrefix = String(prefix || '').trim();
  if (!safePrefix) throw new Error('prefix is required to create a prefixed random allocator.');
  const style = String(options.style || 'yearRandom').trim();

  return async function allocateUniquePrefixedId(allocOptions = {}) {
    const now = allocOptions.now ? new Date(allocOptions.now) : new Date();
    return allocateWithRetry({
      collection: allocOptions.collection || null,
      existingIds: allocOptions.existingIds,
      reservedIds: allocOptions.reservedIds,
      maxAttempts: allocOptions.maxAttempts,
      generateCandidate: (attempt) => {
        if (style === 'numeric') {
          return `${safePrefix}${Math.floor(10000 + Math.random() * 90000)}`;
        }
        if (style === 'exam') {
          return `${safePrefix}-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
        }
        if (style === 'notification') {
          return `${safePrefix}-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
        }
        if (style === 'timestampUnderscore') {
          return `${safePrefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        }
        const tick = new Date(now.getTime() + attempt * 17);
        const year = tick.getFullYear();
        const random = Math.random().toString(36).slice(2, 8).toUpperCase();
        return `${safePrefix}-${year}-${random}`;
      }
    });
  };
}

module.exports = {
  isIdAvailable,
  allocateWithRetry,
  resolveSchoolCreateId,
  createPrefixedRandomAllocator
};
