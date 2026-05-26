const packageDataOwnershipRepository = require('../repositories/packageDataOwnershipRepository');

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizePackageId(value = '') {
  return cleanText(value, 120).toLowerCase();
}

function sanitizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function sanitizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildActor(actor = null) {
  if (actor && typeof actor === 'object') {
    return {
      id: cleanText(actor.id || actor.username || actor.email || '', 160) || 'SYSTEM',
      username: cleanText(actor.username || actor.email || actor.id || '', 200) || 'SYSTEM'
    };
  }
  return { id: 'SYSTEM', username: 'SYSTEM' };
}

function createDependencies(overrides = {}) {
  return {
    repository: overrides.repository || packageDataOwnershipRepository
  };
}

function createService(overrides = {}) {
  const deps = createDependencies(overrides);

  async function registerOwnershipRecords(records = [], options = {}) {
    const actor = buildActor(options.actor || null);
    const backendMode = cleanText(options.backendMode, 40).toLowerCase();
    const outputs = [];
    for (const record of sanitizeArray(records)) {
      const entityType = cleanText(record?.entityType, 80).toLowerCase();
      const identityKey = cleanText(record?.identityKey, 400);
      if (!entityType || !identityKey) continue;
      const row = await deps.repository.upsertByIdentity(entityType, identityKey, {
        packageId: normalizePackageId(record?.packageId),
        packageVersion: cleanText(record?.packageVersion, 120),
        backendMode,
        baselineHash: cleanText(record?.baselineHash, 120),
        baselineSnapshot: record?.baselineSnapshot,
        metadata: sanitizeObject(record?.metadata)
      }, {
        backendMode,
        actor
      });
      outputs.push(row);
    }
    return outputs;
  }

  async function getOwnership(entityType = '', identityKey = '', options = {}) {
    return deps.repository.getByIdentity(entityType, identityKey, {
      backendMode: options.backendMode
    });
  }

  async function listOwnershipByPackage(packageId = '', options = {}) {
    const normalizedPackageId = normalizePackageId(packageId);
    if (!normalizedPackageId) return [];
    return deps.repository.list({
      backendMode: options.backendMode,
      query: {
        packageId__eq: normalizedPackageId,
        limit: Number.parseInt(String(options.limit || '2000'), 10) || 2000
      }
    });
  }

  async function detectOwnershipConflicts(records = [], options = {}) {
    const packageId = normalizePackageId(options.packageId);
    const conflicts = [];
    for (const record of sanitizeArray(records)) {
      const entityType = cleanText(record?.entityType, 80).toLowerCase();
      const identityKey = cleanText(record?.identityKey, 400);
      if (!entityType || !identityKey) continue;
      // eslint-disable-next-line no-await-in-loop
      const owner = await getOwnership(entityType, identityKey, options);
      const ownerPackageId = normalizePackageId(owner?.packageId || '');
      if (!ownerPackageId || !packageId) continue;
      if (ownerPackageId !== packageId) {
        conflicts.push({
          entityType,
          identityKey,
          ownerPackageId,
          ownerPackageVersion: cleanText(owner?.packageVersion, 120)
        });
      }
    }
    return conflicts;
  }

  return {
    registerOwnershipRecords,
    getOwnership,
    listOwnershipByPackage,
    detectOwnershipConflicts
  };
}

module.exports = {
  ...createService(),
  createService,
  createDependencies
};
