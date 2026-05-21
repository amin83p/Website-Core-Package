// MVC/models/sessionModel.js
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('./fileQueue'); // Ensure this utility exists or is shared
const { applyGenericFilter } = require('../utils/queryEngine');
const { toPublicId, idsEqual } = require('../utils/idAdapter');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');

const dataPath = path.join(__dirname, '../../data/sessions.json');

/* ---------------- HELPERS ---------------- */

async function getAllSessions() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function applySessionScope(rows, scope = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (scope?.canViewAll !== false) return list;

  const userId = toPublicId(scope?.userId) || null;
  if (!userId) return [];

  return list.filter((row) => toPublicId(row?.userId) === userId);
}

function buildSessionQueryPlan(options = {}) {
  const query = options?.query || {};
  const incomingScope = options?.scope || {};

  return {
    entity: 'sessions',
    query,
    scope: {
      canViewAll: incomingScope?.canViewAll !== false,
      userId: toPublicId(incomingScope?.userId) || null
    },
    projection: options?.projection || null,
    pagination: options?.pagination || null,
    sort: options?.sort || null,
    fallback: {
      defaultSearchFields: ['id', 'userId', 'username', 'ip', 'userAgent'],
      dateFields: ['createdAt', 'updatedAt', 'expiresAt', 'lastSeenAt']
    }
  };
}

async function querySessions(options = {}) {
  const plan = buildSessionQueryPlan(options);
  const executor = getEntityQueryExecutor('sessions');

  if (typeof executor === 'function') {
    const result = await executor(plan);
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.items)) return result.items;
  }

  const getAllSessionsFn = module.exports?.getAllSessions;
  const allSessions = await (typeof getAllSessionsFn === 'function'
    ? getAllSessionsFn()
    : getAllSessions());
  const scopedSessions = applySessionScope(allSessions, plan.scope);
  return applyGenericFilter(scopedSessions, plan.query, plan.fallback);
}

async function getSessionById(id) {
  const sessions = await getAllSessions();
  return sessions.find((s) => idsEqual(s?.id, id));
}

// Helper to generate a unique Session ID
// (Used only if the Service didn't provide a Token Signature ID)
function generateSessionId() {
  return 'sess_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
}

/* ---------------- VALIDATION ---------------- */

function validateData(session) {
  const errors = [];

  if (!session || typeof session !== 'object') {
    return { isValid: false, errors: ['Session must be a valid object.'] };
  }

  // Required Fields
  if (!session.userId || typeof session.userId !== 'string') {
    errors.push('User ID is required.');
  }

  // Strict check: tokenHash is required
  if (!session.tokenHash || typeof session.tokenHash !== 'string') {
    errors.push('Token Hash is required.');
  }

  // Device Info Validation
  if (!session.deviceFingerprint || typeof session.deviceFingerprint !== 'object') {
    errors.push('Device Fingerprint must be an object.');
  }

  // Timestamps
  if (!session.createdAt || isNaN(Date.parse(session.createdAt))) {
    errors.push('Invalid Creation Date.');
  }
  
  if (!session.lastActivityAt || isNaN(Date.parse(session.lastActivityAt))) {
    errors.push('Invalid Last Activity Date.');
  }

  if (!session.absoluteExpiry || isNaN(Date.parse(session.absoluteExpiry))) {
    errors.push('Invalid Absolute Expiry Date.');
  }

  // Limits - Strict Type Check
  if (typeof session.idleTimeoutMinutes !== 'number') {
    errors.push('Idle Timeout must be a number.');
  }

  // Status Check
  if (!['active', 'expired', 'revoked'].includes(session.status)) {
    errors.push('Invalid session status.');
  }

  return errors.length ? { isValid: false, errors } : { isValid: true };
}

/* ---------------- CRUD ACTIONS ---------------- */

async function addSession(session) {
  // Use return await to ensure we pass back the result from queueWrite
  return await queueWrite(async () => {
    const sessions = await getAllSessions();

    // 1. Use provided ID (Token Signature) or generate one
    if (!session.id) {
      session.id = generateSessionId();
    }

    // 2. Validate
    const resultValidity = validateData(session);
    if (!resultValidity.isValid) {
      throw new Error(resultValidity.errors.join("\r\n"));
    }

    // 3. Save
    sessions.push(session);
    await fs.writeFile(dataPath, JSON.stringify(sessions, null, 2));
    
    return session; 
  });
}

async function updateSession(id, updates) {
  return await queueWrite(async () => {
    const sessions = await getAllSessions();
    const index = sessions.findIndex((s) => idsEqual(s?.id, id));
    
    if (index === -1) return null; 
    
    const currentSession = sessions[index];

    // 1. Deep Merge Logic
    const merged = {
      ...currentSession,
      ...updates,
      // Protect critical fields
      id: currentSession.id,
      userId: currentSession.userId 
    };

    // 2. Validate
    const resultValidity = validateData(merged);
    if (!resultValidity.isValid) {
      throw new Error(resultValidity.errors.join("\r\n"));
    }

    sessions[index] = merged;

    try {
      await fs.writeFile(dataPath, JSON.stringify(sessions, null, 2));
    } catch (writeError) {
      throw new Error(`Failed to write session data: ${writeError.message}`);
    }
    
    return merged;
  });
}

async function deleteSession(id) {
  return await queueWrite(async () => {
    const sessions = await getAllSessions();
    const index = sessions.findIndex((s) => idsEqual(s?.id, id));
    
    // ✅ SAFE RETURN: Do not throw error if session is already gone
    if (index === -1) {
        return { success: true, message: 'Session already deleted.' }; 
    }

    sessions.splice(index, 1);
    await fs.writeFile(dataPath, JSON.stringify(sessions, null, 2));
    return { success: true };
  });
}

module.exports = { 
  getAllSessions, 
  querySessions,
  buildSessionQueryPlan,
  getSessionById, 
  addSession, 
  updateSession, 
  deleteSession 
};
