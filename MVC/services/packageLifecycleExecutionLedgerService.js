const crypto = require('crypto');
const packageLifecycleExecutionLedgerRepository = require('../repositories/packageLifecycleExecutionLedgerRepository');

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizePackageId(value = '') {
  return cleanText(value, 120).toLowerCase();
}

function hashChecksum(input = '') {
  const token = String(input || '');
  return crypto.createHash('sha256').update(token).digest('hex');
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
    repository: overrides.repository || packageLifecycleExecutionLedgerRepository
  };
}

function createService(overrides = {}) {
  const deps = createDependencies(overrides);

  async function createStepEntry(input = {}, options = {}) {
    const actor = buildActor(options.actor || input.actor || null);
    const packageId = normalizePackageId(input.packageId);
    if (!packageId) throw new Error('packageId is required.');
    const scriptPath = cleanText(input.scriptPath, 1800);
    const packageVersion = cleanText(input.packageVersion, 120);
    const manifestChecksum = cleanText(input.manifestChecksum, 200) || hashChecksum(`${packageId}:${packageVersion}`);
    const scriptChecksum = cleanText(input.scriptChecksum, 200) || hashChecksum(`${scriptPath}:${packageVersion}:${cleanText(input.stepId, 200)}`);
    return deps.repository.create({
      packageId,
      packageVersion,
      stepId: cleanText(input.stepId, 200),
      stepType: cleanText(input.stepType, 40).toLowerCase(),
      direction: cleanText(input.direction, 40).toLowerCase(),
      backendMode: cleanText(input.backendMode, 40).toLowerCase(),
      scriptPath,
      scriptChecksum,
      manifestChecksum,
      transactionId: cleanText(input.transactionId, 180),
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: '',
      error: '',
      artifacts: sanitizeObject(input.artifacts),
      ownershipRecords: sanitizeArray(input.ownershipRecords),
      metadata: sanitizeObject(input.metadata)
    }, {
      backendMode: options.backendMode,
      actor
    });
  }

  async function completeStepEntry(ledgerId = '', patch = {}, options = {}) {
    const actor = buildActor(options.actor || patch.actor || null);
    const id = cleanText(ledgerId, 180);
    if (!id) throw new Error('ledgerId is required.');
    return deps.repository.update(id, {
      status: cleanText(patch.status, 40).toLowerCase() || 'success',
      finishedAt: cleanText(patch.finishedAt, 80) || new Date().toISOString(),
      error: cleanText(patch.error, 4000),
      artifacts: patch.artifacts !== undefined ? sanitizeObject(patch.artifacts) : undefined,
      ownershipRecords: patch.ownershipRecords !== undefined ? sanitizeArray(patch.ownershipRecords) : undefined,
      metadata: patch.metadata !== undefined ? sanitizeObject(patch.metadata) : undefined
    }, {
      backendMode: options.backendMode,
      actor
    });
  }

  async function listEntries(options = {}) {
    return deps.repository.list({
      backendMode: options.backendMode,
      query: options.query || {}
    });
  }

  async function findLatestSuccessfulEntry(criteria = {}, options = {}) {
    const rows = await listEntries({
      backendMode: options.backendMode,
      query: {
        packageId__eq: normalizePackageId(criteria.packageId),
        stepId__eq: cleanText(criteria.stepId, 200),
        stepType__eq: cleanText(criteria.stepType, 40).toLowerCase(),
        direction__eq: cleanText(criteria.direction, 40).toLowerCase(),
        backendMode__eq: cleanText(criteria.backendMode || options.backendMode, 40).toLowerCase(),
        status__eq: 'success',
        limit: 200
      }
    });
    const list = sanitizeArray(rows);
    if (!list.length) return null;
    return list.sort((a, b) => String(b.finishedAt || '').localeCompare(String(a.finishedAt || '')))[0] || null;
  }

  return {
    hashChecksum,
    createStepEntry,
    completeStepEntry,
    listEntries,
    findLatestSuccessfulEntry
  };
}

module.exports = {
  ...createService(),
  createService,
  createDependencies
};
