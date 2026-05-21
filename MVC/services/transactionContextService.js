function generateContextId() {
  return `TXC-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function normalizeMetadata(metadata) {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...metadata }
    : {};
}

function createTransactionContext(config = {}) {
  const contextId = String(config.id || '').trim() || generateContextId();
  const contextName = String(config.name || 'transaction').trim() || 'transaction';
  const metadata = normalizeMetadata(config.metadata);
  const startedAt = new Date().toISOString();
  const operations = [];
  const compensations = [];
  const rollbackIssues = [];

  let status = 'open';
  let committedAt = '';
  let rolledBackAt = '';

  const context = {
    id: contextId,
    name: contextName,
    metadata,
    startedAt,
    get status() {
      return status;
    },
    get committedAt() {
      return committedAt;
    },
    get rolledBackAt() {
      return rolledBackAt;
    },
    get operations() {
      return [...operations];
    },
    get rollbackIssues() {
      return [...rollbackIssues];
    },

    recordOperation(operation = {}) {
      operations.push({
        ...normalizeMetadata(operation),
        at: new Date().toISOString()
      });
    },

    addCompensation(handler, metadata = {}) {
      if (typeof handler !== 'function') return;
      compensations.push({
        handler,
        metadata: normalizeMetadata(metadata),
        addedAt: new Date().toISOString()
      });
    },

    async commit(extra = {}) {
      if (status === 'committed') return this.getSummary(extra);
      if (status === 'rolled_back') return this.getSummary(extra);
      status = 'committed';
      committedAt = new Date().toISOString();
      return this.getSummary(extra);
    },

    async rollback(extra = {}) {
      if (status === 'rolled_back') return this.getSummary(extra);
      if (status === 'committed') return this.getSummary(extra);

      status = 'rolling_back';
      const runList = [...compensations].reverse();
      for (const item of runList) {
        try {
          await item.handler(this, extra);
        } catch (error) {
          rollbackIssues.push({
            at: new Date().toISOString(),
            message: error?.message || String(error),
            metadata: item.metadata
          });
        }
      }
      status = 'rolled_back';
      rolledBackAt = new Date().toISOString();
      return this.getSummary(extra);
    },

    getSummary(extra = {}) {
      return {
        id: contextId,
        name: contextName,
        status,
        startedAt,
        committedAt,
        rolledBackAt,
        operationCount: operations.length,
        rollbackIssueCount: rollbackIssues.length,
        metadata: { ...metadata, ...normalizeMetadata(extra) }
      };
    }
  };

  return context;
}

function getTransactionContext(options = {}) {
  const context = options?.transactionContext;
  if (!context || typeof context !== 'object') return null;
  if (typeof context.recordOperation !== 'function') return null;
  return context;
}

function recordTransactionOperation(options = {}, operation = {}) {
  const context = getTransactionContext(options);
  if (!context) return;
  context.recordOperation(operation);
}

function addDeleteCompensation(context, config = {}) {
  if (!context || typeof context.addCompensation !== 'function') return;
  const service = config?.service;
  const entityType = String(config?.entityType || '').trim();
  const targetId = String(config?.id || '').trim();
  const requestingUser = config?.requestingUser || null;
  const metadata = normalizeMetadata({
    type: 'delete_compensation',
    entityType,
    id: targetId,
    label: config?.label || ''
  });

  if (!service || typeof service.deleteData !== 'function') return;
  if (!entityType || !targetId) return;

  context.addCompensation(async () => {
    await service.deleteData(entityType, targetId, requestingUser, { transactionContext: context });
  }, metadata);
}

async function runInTransaction(config = {}, runner) {
  const context = createTransactionContext(config);
  try {
    const result = await runner(context);
    await context.commit();
    return { result, context };
  } catch (error) {
    await context.rollback({ reason: error?.message || 'Transaction runner failed' });
    throw error;
  }
}

module.exports = {
  createTransactionContext,
  getTransactionContext,
  recordTransactionOperation,
  addDeleteCompensation,
  runInTransaction
};
