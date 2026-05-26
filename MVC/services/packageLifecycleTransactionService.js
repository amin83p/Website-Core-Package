const crypto = require('crypto');
const packageLifecycleTransactionRepository = require('../repositories/packageLifecycleTransactionRepository');

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

function hashPayload(value) {
  const raw = JSON.stringify(value === undefined ? null : value);
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function summarizeEntityOperations(entityOperations = []) {
  const rows = sanitizeArray(entityOperations);
  const summary = {};
  rows.forEach((row) => {
    const entityType = cleanText(row?.entityType, 80).toLowerCase() || 'other';
    const operation = cleanText(row?.operation, 80).toLowerCase() || 'recorded';
    if (!summary[entityType]) summary[entityType] = {};
    summary[entityType][operation] = Number(summary[entityType][operation] || 0) + 1;
  });
  return summary;
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
    repository: overrides.repository || packageLifecycleTransactionRepository
  };
}

function createService(overrides = {}) {
  const deps = createDependencies(overrides);

  async function startTransaction(input = {}, options = {}) {
    const now = new Date().toISOString();
    const actor = buildActor(options.actor || input.actor || null);
    const packageId = normalizePackageId(input.packageId);
    if (!packageId) throw new Error('packageId is required to start lifecycle transaction.');
    const action = cleanText(input.action, 80).toLowerCase() || 'unknown';
    const id = cleanText(input.transactionId || input.id, 160) || `PKG_TXN_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return deps.repository.create({
      id,
      transactionId: id,
      packageId,
      packageName: cleanText(input.packageName, 200),
      packageVersion: cleanText(input.packageVersion || input.version, 120),
      action,
      status: 'running',
      phase: 'preflight',
      startedAt: now,
      finishedAt: '',
      backendMode: cleanText(options.backendMode || input.backendMode, 40).toLowerCase(),
      actor,
      phases: [{ name: 'preflight', status: 'in_progress', startedAt: now, finishedAt: '', details: {} }],
      entityOperations: [],
      summaryByEntity: {},
      warnings: [],
      blockedReasons: [],
      modifiedRecords: [],
      rollback: {},
      artifacts: sanitizeObject(input.artifacts),
      metadata: sanitizeObject(input.metadata)
    }, {
      backendMode: options.backendMode,
      actor
    });
  }

  async function updateTransaction(transactionId = '', patch = {}, options = {}) {
    const token = cleanText(transactionId, 160);
    if (!token) throw new Error('transactionId is required.');
    return deps.repository.update(token, patch, {
      backendMode: options.backendMode,
      actor: options.actor || null
    });
  }

  async function markPhase(transactionId = '', phaseName = '', status = 'in_progress', details = {}, options = {}) {
    const tx = await deps.repository.getById(transactionId, { backendMode: options.backendMode });
    if (!tx) throw new Error('Lifecycle transaction not found.');
    const now = new Date().toISOString();
    const phase = cleanText(phaseName, 80).toLowerCase();
    const normalizedStatus = cleanText(status, 80).toLowerCase() || 'in_progress';
    const phases = sanitizeArray(tx.phases).map((row) => ({ ...row }));
    const index = phases.findIndex((row) => cleanText(row?.name, 80).toLowerCase() === phase);

    if (index >= 0) {
      phases[index] = {
        ...phases[index],
        status: normalizedStatus,
        details: sanitizeObject(details)
      };
      if (normalizedStatus === 'in_progress' && !cleanText(phases[index].startedAt, 80)) phases[index].startedAt = now;
      if (normalizedStatus !== 'in_progress') phases[index].finishedAt = now;
    } else {
      phases.push({
        name: phase,
        status: normalizedStatus,
        startedAt: normalizedStatus === 'in_progress' ? now : now,
        finishedAt: normalizedStatus === 'in_progress' ? '' : now,
        details: sanitizeObject(details)
      });
    }

    return updateTransaction(transactionId, {
      phase,
      phases
    }, options);
  }

  async function appendEntityOperations(transactionId = '', rows = [], options = {}) {
    const tx = await deps.repository.getById(transactionId, { backendMode: options.backendMode });
    if (!tx) throw new Error('Lifecycle transaction not found.');
    const now = new Date().toISOString();
    const existing = sanitizeArray(tx.entityOperations).map((row) => ({ ...row }));
    const normalized = sanitizeArray(rows).map((row) => {
      const beforePayload = row?.beforePayload === undefined ? null : row.beforePayload;
      const afterPayload = row?.afterPayload === undefined ? null : row.afterPayload;
      return {
        entityType: cleanText(row?.entityType, 80).toLowerCase(),
        identityKey: cleanText(row?.identityKey || row?.key, 400),
        ownership: sanitizeObject(row?.ownership),
        operation: cleanText(row?.operation || row?.status, 80).toLowerCase(),
        reason: cleanText(row?.reason || row?.message, 1200),
        beforeHash: cleanText(row?.beforeHash, 120) || hashPayload(beforePayload),
        afterHash: cleanText(row?.afterHash, 120) || hashPayload(afterPayload),
        beforePayload,
        afterPayload,
        recordedAt: cleanText(row?.recordedAt, 80) || now
      };
    }).filter((row) => row.entityType && row.identityKey);
    const next = [...existing, ...normalized];
    return updateTransaction(transactionId, {
      entityOperations: next,
      summaryByEntity: summarizeEntityOperations(next)
    }, options);
  }

  async function completeTransaction(transactionId = '', patch = {}, options = {}) {
    const now = new Date().toISOString();
    const status = cleanText(patch.status, 80).toLowerCase() || 'success';
    const tx = await deps.repository.getById(transactionId, { backendMode: options.backendMode });
    if (!tx) throw new Error('Lifecycle transaction not found.');
    const entityOperations = sanitizeArray(patch.entityOperations).length
      ? sanitizeArray(patch.entityOperations)
      : sanitizeArray(tx.entityOperations);

    return updateTransaction(transactionId, {
      status,
      phase: status === 'success' ? 'commit' : cleanText(patch.phase || tx.phase, 80).toLowerCase(),
      finishedAt: now,
      warnings: sanitizeArray(patch.warnings).map((row) => cleanText(row, 1200)).filter(Boolean),
      blockedReasons: sanitizeArray(patch.blockedReasons).map((row) => cleanText(row, 1200)).filter(Boolean),
      modifiedRecords: sanitizeArray(patch.modifiedRecords),
      rollback: sanitizeObject(patch.rollback),
      artifacts: sanitizeObject({ ...sanitizeObject(tx.artifacts), ...sanitizeObject(patch.artifacts) }),
      metadata: sanitizeObject({ ...sanitizeObject(tx.metadata), ...sanitizeObject(patch.metadata) }),
      entityOperations,
      summaryByEntity: summarizeEntityOperations(entityOperations)
    }, options);
  }

  async function listPackageTransactions(packageId = '', options = {}) {
    const token = normalizePackageId(packageId);
    const query = {
      ...(options.query || {}),
      ...(token ? { packageId__eq: token } : {})
    };
    return deps.repository.list({
      query,
      backendMode: options.backendMode
    });
  }

  async function getTransactionById(transactionId = '', options = {}) {
    return deps.repository.getById(transactionId, {
      backendMode: options.backendMode
    });
  }

  return {
    hashPayload,
    summarizeEntityOperations,
    startTransaction,
    markPhase,
    updateTransaction,
    appendEntityOperations,
    completeTransaction,
    listPackageTransactions,
    getTransactionById
  };
}

module.exports = {
  ...createService(),
  createService,
  createDependencies
};
