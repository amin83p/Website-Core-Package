'use strict';

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'session-auth-diagnostics.ndjson');

let writeChain = Promise.resolve();

function sanitizePath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw, 'http://local');
    return `${parsed.pathname || ''}${parsed.search || ''}`.slice(0, 500);
  } catch (_) {
    return raw.slice(0, 500);
  }
}

function resolveUsername({ req, session, user } = {}) {
  const candidates = [
    user?.username,
    user?.email,
    req?.user?.username,
    req?.user?.email
  ];
  for (const value of candidates) {
    const token = String(value || '').trim();
    if (token) return token;
  }
  return '';
}

function resolveUserId({ req, session, user } = {}) {
  return String(
    user?.id
    || req?.user?.id
    || session?.userId
    || ''
  ).trim();
}

function buildSessionSnapshot(session = {}) {
  if (!session || typeof session !== 'object') return null;
  return {
    sessionId: String(session.id || '').trim(),
    userId: String(session.userId || '').trim(),
    currentOrgId: String(session.currentOrgId || '').trim(),
    status: String(session.status || '').trim(),
    lastActivityAt: String(session.lastActivityAt || '').trim(),
    absoluteExpiry: String(session.absoluteExpiry || '').trim(),
    createdAt: String(session.createdAt || '').trim(),
    idleTimeoutMinutes: Number(session.idleTimeoutMinutes || 0),
    currentPath: String(session.currentPath || '').trim()
  };
}

function buildRequestSnapshot(req = {}) {
  let cookieSessionId = '';
  try {
    const token = req?.cookies?.auth_token;
    const parts = token ? String(token).split('.') : [];
    if (parts.length === 3) cookieSessionId = String(parts[2] || '').trim();
  } catch (_) {
    cookieSessionId = '';
  }
  return {
    method: String(req.method || '').trim().toUpperCase(),
    path: sanitizePath(req.originalUrl || req.url || req.path || ''),
    isAjax: Boolean(req.xhr || req.headers?.['x-ajax-request'] || String(req.headers?.accept || '').includes('json')),
    ip: String(req.ip || req.socket?.remoteAddress || '').trim(),
    cookieSessionId
  };
}

function appendLine(entry) {
  writeChain = writeChain.then(async () => {
    await fs.promises.mkdir(LOG_DIR, { recursive: true });
    await fs.promises.appendFile(LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
  }).catch((error) => {
    console.warn('[session-auth-diagnostic] Failed to write log entry:', error.message);
  });
  return writeChain;
}

function logSessionAuthEvent({
  event,
  reason = '',
  req = null,
  session = null,
  user = null,
  details = null
} = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    event: String(event || 'UNKNOWN').trim(),
    reason: String(reason || '').trim(),
    username: resolveUsername({ req, session, user }),
    userId: resolveUserId({ req, session, user }),
    request: req ? buildRequestSnapshot(req) : null,
    session: buildSessionSnapshot(session),
    details: details && typeof details === 'object' ? details : undefined
  };
  void appendLine(payload);
  return payload;
}

function initializeSessionAuthDiagnostics() {
  const entry = logSessionAuthEvent({
    event: 'DIAGNOSTIC_STARTUP',
    reason: 'logger_initialized',
    details: {
      cwd: process.cwd(),
      logFile: LOG_FILE
    }
  });
  return { logFile: LOG_FILE, logDir: LOG_DIR, entry };
}

module.exports = {
  LOG_FILE,
  LOG_DIR,
  logSessionAuthEvent,
  initializeSessionAuthDiagnostics,
  buildSessionSnapshot,
  buildRequestSnapshot
};
