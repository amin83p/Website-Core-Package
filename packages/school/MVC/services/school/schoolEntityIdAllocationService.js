'use strict';

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

module.exports = {
  isIdAvailable,
  allocateWithRetry
};
