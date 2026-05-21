// MVC/models/actionStateModel.js
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { encrypt, decrypt } = require('../utils/encyptors');
const { ACTION_STATE_KEY } = require('../../config/security');
const { applyGenericFilter } = require('../utils/queryEngine');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');

const dataPath = path.join(__dirname, '../../data/actionStates.json');
const fsNormal = require('fs');

const ACTION_STATE_LIMITS = {
  COUNT_WARNING: 2500,
  COUNT_DANGER: 4500
};

/* ============================================================
   READERS (Unchanged)
============================================================ */
async function getAllActionStates() {
  try { return JSON.parse(await fs.readFile(dataPath, 'utf8')); } catch { return []; }
}
async function getActionStateById(id) { return (await getAllActionStates()).find(s => s.id === id); }

function buildActionStateQueryPlan(options = {}) {
  const query = options?.query || {};

  return {
    entity: 'actionstates',
    query,
    scope: options?.scope || {},
    projection: options?.projection || null,
    pagination: options?.pagination || null,
    sort: options?.sort || null,
    fallback: {
      defaultSearchFields: ['id', 'userId', 'sectionId', 'operationId', 'targetKey', 'status'],
      dateFields: ['startedAt', 'createdAt', 'updatedAt', 'lastActiveAt']
    }
  };
}

async function queryActionStates(options = {}) {
  const plan = buildActionStateQueryPlan(options);
  const executor = getEntityQueryExecutor('actionstates');

  if (typeof executor === 'function') {
    const result = await executor(plan);
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.items)) return result.items;
  }

  const allActionStates = await getAllActionStates();
  return applyGenericFilter(allActionStates, plan.query, plan.fallback);
}

async function getSystemActionStateStats() {
  let actionStateCount = 0;
  let actionStateHealth = 'success';
  let actionStateMessage = 'Healthy';

  try {
    if (fsNormal.existsSync(dataPath)) {
      const states = await getAllActionStates();
      actionStateCount = states.length;

      if (actionStateCount > ACTION_STATE_LIMITS.COUNT_DANGER) {
        actionStateHealth = 'danger';
        actionStateMessage = 'Critical Limit';
      } else if (actionStateCount > ACTION_STATE_LIMITS.COUNT_WARNING) {
        actionStateHealth = 'warning';
        actionStateMessage = 'High Volume';
      }
    }
  } catch (error) {
    console.error('Action State Stat Error:', error.message);
    actionStateHealth = 'secondary';
  }

  return { actionStateCount, actionStateHealth, actionStateMessage };
}

function generateId() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const date = `${yyyy}${mm}${dd}`;
  const time = Math.floor(now.getTime() / 1000);
  const n = Math.floor(Math.random() * 1000) + 1;
  const rand = n === 1000 ? "1000" : String(n).padStart(3, "0");
  return "ASI" + date + time + rand;
}

async function getActionStatesByQuery(query = {}) {
    const states = await getAllActionStates();
    return states.filter(s => {
        let match = true;
        if (query.userId) match = match && s.userId === query.userId;
        if (query.sectionId) match = match && s.sectionId === query.sectionId;
        if (query.operationId) match = match && s.operationId === query.operationId;
        if (query.status) match = match && s.status === query.status;
        if (query.targetKey) match = match && s.targetKey === query.targetKey;
        if (query.id) match = match && s.id === query.id;
        
        if (query.startDate) match = match && new Date(s.startedAt) >= new Date(query.startDate);
        if (query.endDate) match = match && new Date(s.startedAt) <= new Date(query.endDate);
        return match;
    });
}

async function getDecryptedData(id) {
    const state = await getActionStateById(id);
    if (!state || !state.finalData) return null;
    try {
        const jsonStr = decrypt(state.finalData, ACTION_STATE_KEY);
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error("Decryption Error for State ID:", id, e.message);
        return { error: "Failed to decrypt data. Key may have rotated." };
    }
}

function normalizeChangeEvent(changeEvent = {}) {
  const row = (changeEvent && typeof changeEvent === 'object') ? changeEvent : {};
  const changes = Array.isArray(row.changes)
    ? row.changes
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        path: String(entry.path || '').trim(),
        type: String(entry.type || '').trim() || 'changed',
        from: entry.from,
        to: entry.to
      }))
    : [];

  return {
    mode: String(row.mode || '').trim().toLowerCase() === 'create' ? 'create' : 'update',
    entityType: String(row.entityType || '').trim(),
    entityId: String(row.entityId || '').trim(),
    at: String(row.at || '').trim() || new Date().toISOString(),
    actionStateId: String(row.actionStateId || '').trim(),
    actor: row.actor && typeof row.actor === 'object' ? row.actor : {},
    summary: row.summary && typeof row.summary === 'object'
      ? {
        addedCount: Number(row.summary.addedCount || 0),
        changedCount: Number(row.summary.changedCount || 0),
        hiddenAuditCount: Number(row.summary.hiddenAuditCount || 0)
      }
      : { addedCount: 0, changedCount: 0, hiddenAuditCount: 0 },
    changes
  };
}

/* ============================================================
   WRITE OPERATIONS (Updated for Context)
============================================================ */

// ✅ Added `requestContext` param
async function logAttempt(userId, sectionId, operationId, targetKey, limits, forceId = null, requestContext = {}) {
  return await queueWrite(async () => {
    let states = await getAllActionStates();
    const now = new Date();
    let state = null;

    if (forceId) {
        state = states.find(s => s.id === forceId);
        
        if (!state) throw new Error("Invalid Action State ID.");
        if (state.userId !== userId) throw new Error("Security Violation: User mismatch.");
        if (state.status !== 'active') throw new Error("Action State is no longer active.");
        if (new Date(state.expiresAt) <= now) throw new Error("Action Session has expired.");

    } else {
        state = states.find(s => 
            s.userId === userId && 
            s.sectionId === sectionId && 
            s.operationId === operationId && 
            s.targetKey === targetKey &&
            s.status === 'active' &&
            new Date(s.expiresAt) > now
        );
    }

    if (!state) {
        if (forceId) throw new Error("Action State not found."); 

        const duration = limits.maxTimeMinutes || 60;
        state = {
            id: generateId(),
            userId,
            sectionId,
            operationId,
            targetKey,
            status: 'active',
            attemptCount: 0,
            volumeUsageKB: 0,
            startedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + duration * 60000).toISOString(),
            appliedLimits: limits || {}, 
            initialContext: requestContext, // ✅ Store initial context (URL, Method, IP)
            history: [],
            changeEvents: [],
            finalData: null
        };
        states.push(state);
    } else {
        state.appliedLimits = limits || {};
    }

    state.attemptCount = (state.attemptCount || 0) + 1;
    state.lastActiveAt = now.toISOString();
    
    // ✅ Store context in history
    state.history.push({ 
        ts: now.toISOString(), 
        status: 'attempt_started',
        details: forceId ? 'Session Resumed by Client' : 'New/Auto Session Started',
        context: requestContext // ✅ Capture specific URL/Method for this attempt
    });

    await fs.writeFile(dataPath, JSON.stringify(states, null, 2));
    return state; 
  });
}

// ✅ Added `context` param
async function updateProgress(id, volumeKB = 0, context = {}) {
  await queueWrite(async () => {
    const states = await getAllActionStates();
    const index = states.findIndex(s => s.id === id);
    if (index === -1) return;
    const current = states[index];
    current.volumeUsageKB = (current.volumeUsageKB || 0) + volumeKB;
    current.lastActiveAt = new Date().toISOString();
    
    // ✅ Store context
    current.history.push({ 
        ts: new Date().toISOString(), 
        status: 'step_completed', 
        details: 'Intermediate response sent', 
        volumeKB,
        context 
    });
    
    await fs.writeFile(dataPath, JSON.stringify(states, null, 2));
  });
}

// ✅ Added `context` param
async function completeState(id, dataPayload, volumeKB = 0, context = {}) {
  await queueWrite(async () => {
    const states = await getAllActionStates();
    const index = states.findIndex(s => s.id === id);
    if (index === -1) return;
    const current = states[index];
    if (dataPayload) current.finalData = encrypt(dataPayload, ACTION_STATE_KEY);
    current.volumeUsageKB = (current.volumeUsageKB || 0) + volumeKB;
    current.status = 'completed';
    current.lastActiveAt = new Date().toISOString();
    
    // ✅ Store context
    current.history.push({ 
        ts: new Date().toISOString(), 
        status: 'success_completed', 
        volumeKB,
        context 
    });
    
    await fs.writeFile(dataPath, JSON.stringify(states, null, 2));
  });
}

// ✅ Added `context` param
async function failAttempt(id, volumeKB = 0, context = {}) {
  await queueWrite(async () => {
    const states = await getAllActionStates();
    const index = states.findIndex(s => s.id === id);
    if (index === -1) return;
    const current = states[index];
    current.volumeUsageKB = (current.volumeUsageKB || 0) + volumeKB;
    current.status = 'failed';
    
    // ✅ Store context
    current.history.push({ 
        ts: new Date().toISOString(), 
        status: 'failed', 
        volumeKB,
        context 
    });
    
    await fs.writeFile(dataPath, JSON.stringify(states, null, 2));
  });
}

// ✅ Added `context` param
async function recordRetryableError(id, errorMessage, volumeKB = 0, context = {}) {
  await queueWrite(async () => {
    const states = await getAllActionStates();
    const index = states.findIndex(s => s.id === id);
    if (index === -1) return;

    const current = states[index];
    current.volumeUsageKB = (current.volumeUsageKB || 0) + volumeKB;
    current.lastActiveAt = new Date().toISOString();
    
    // ✅ Store context
    current.history.push({ 
        ts: new Date().toISOString(), 
        status: 'error_retryable', 
        details: errorMessage || 'Client side error', 
        volumeKB,
        context 
    });

    await fs.writeFile(dataPath, JSON.stringify(states, null, 2));
  });
}

async function cancelState(id) {
  await queueWrite(async () => {
    const states = await getAllActionStates();
    const index = states.findIndex(s => s.id === id);
    if (index === -1) return;

    const current = states[index];
    if (current.status === 'active') {
        current.status = 'cancelled';
        current.lastActiveAt = new Date().toISOString();
        current.history.push({ 
            ts: new Date().toISOString(), 
            status: 'cancelled', 
            details: 'User explicitly cancelled the action.' 
        });
        await fs.writeFile(dataPath, JSON.stringify(states, null, 2));
    }
  });
}

async function appendChangeEvent(id, changeEvent, context = {}) {
  await queueWrite(async () => {
    const states = await getAllActionStates();
    const index = states.findIndex((s) => s.id === id);
    if (index === -1) return;

    const current = states[index];
    const event = normalizeChangeEvent(changeEvent || {});
    if (!event.entityType || !event.entityId) return;

    current.changeEvents = Array.isArray(current.changeEvents) ? current.changeEvents : [];
    current.changeEvents.push(event);
    current.lastActiveAt = new Date().toISOString();
    current.history = Array.isArray(current.history) ? current.history : [];
    current.history.push({
      ts: current.lastActiveAt,
      status: 'change_event_recorded',
      details: `${event.mode}:${event.entityType}:${event.entityId}`,
      context: context && typeof context === 'object' ? context : {}
    });

    await fs.writeFile(dataPath, JSON.stringify(states, null, 2));
  });
}

async function deleteActionState(id) {
  await queueWrite(async () => {
    const states = await getAllActionStates();
    const filtered = states.filter(s => s.id !== id);
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
  });
}

async function deleteAllActionStates() {
  await queueWrite(async () => {
    await fs.writeFile(dataPath, JSON.stringify([], null, 2));
  });
}

module.exports = {
  getAllActionStates,
  queryActionStates,
  buildActionStateQueryPlan,
  getSystemActionStateStats,
  getActionStateById,
  getActionStatesByQuery,
  getDecryptedData,
  logAttempt,
  updateProgress,
  completeState,
  failAttempt,
  cancelState,
  deleteActionState,
  deleteAllActionStates,
  recordRetryableError,
  appendChangeEvent
};
