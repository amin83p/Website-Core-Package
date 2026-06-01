const actionStateRepository = require('../repositories/actionStateRepository');
const { buildActionStateDiff } = require('../utils/actionStateDiff');
const {
  getRequestContext,
  setRequestContextValue
} = require('../utils/requestContextStore');

const CORE_EXCLUDED_ENTITY_TYPES = new Set([
  'logs',
  'actionStates',
  'sessions'
]);

function normalizeEntityToken(value) {
  return String(value || '').trim();
}

function resolveActionStateContext() {
  const context = getRequestContext();
  if (!context || typeof context !== 'object') return null;

  const actionStateId = String(
    context.actionStateId
    || context?.actionState?.id
    || ''
  ).trim();
  if (!actionStateId) return null;

  const request = context?.request && typeof context.request === 'object' ? context.request : {};
  const actor = context?.actor && typeof context.actor === 'object' ? context.actor : {};

  return {
    actionStateId,
    actor: {
      userId: String(actor.userId || request.userId || '').trim(),
      username: String(actor.username || request.username || '').trim(),
      displayName: String(actor.displayName || request.displayName || '').trim(),
      orgId: String(actor.orgId || request.orgId || '').trim()
    },
    requestContext: request
  };
}

function shouldTrackEntity(entityType, source = 'core') {
  const token = normalizeEntityToken(entityType);
  if (!token) return false;
  return !CORE_EXCLUDED_ENTITY_TYPES.has(token);
}

async function appendChangeEvent({ mode, entityType, entityId, changes = [], summary = {} } = {}) {
  const scope = resolveActionStateContext();
  if (!scope) return null;

  const normalizedEntityType = normalizeEntityToken(entityType);
  const normalizedEntityId = normalizeEntityToken(entityId);
  if (!normalizedEntityType || !normalizedEntityId) return null;

  const event = {
    mode: mode === 'create' ? 'create' : 'update',
    entityType: normalizedEntityType,
    entityId: normalizedEntityId,
    at: new Date().toISOString(),
    actionStateId: scope.actionStateId,
    actor: scope.actor,
    summary: {
      addedCount: Number(summary?.addedCount || 0),
      changedCount: Number(summary?.changedCount || 0),
      hiddenAuditCount: Number(summary?.hiddenAuditCount || 0)
    },
    changes: Array.isArray(changes) ? changes : []
  };

  try {
    await actionStateRepository.appendChangeEvent(scope.actionStateId, event, scope.requestContext || {});
    setRequestContextValue('actionStateHasStructuredChanges', true);
    if (event.mode === 'create') {
      // Keep create payload snapshots available in finalData while retaining structured events.
      setRequestContextValue('actionStateHasCreateChangeEvent', true);
    }
    return event;
  } catch (error) {
    console.error('Action state change-event append failed:', error?.message || error);
    return null;
  }
}

const actionStateChangeTrackerService = {
  async trackCreate({ source = 'core', entityType, entityId }) {
    if (!shouldTrackEntity(entityType, source)) return null;
    return appendChangeEvent({
      mode: 'create',
      entityType,
      entityId,
      changes: [],
      summary: { addedCount: 0, changedCount: 0, hiddenAuditCount: 0 }
    });
  },

  async trackUpdate({ source = 'core', entityType, entityId, before = {}, after = {} } = {}) {
    if (!shouldTrackEntity(entityType, source)) return null;

    const diff = buildActionStateDiff(before || {}, after || {});
    return appendChangeEvent({
      mode: 'update',
      entityType,
      entityId,
      changes: diff?.changes || [],
      summary: diff?.summary || {}
    });
  }
};

module.exports = actionStateChangeTrackerService;
