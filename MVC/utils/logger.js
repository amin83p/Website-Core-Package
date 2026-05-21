// MVC/utils/logger.js
const dataService = require('../services/dataService');

const SECTION_SYSTEM = '000000';

const OPS = {
  GET: 'OP9002',
  POST: 'OP9001',
  PUT: 'OP9005',
  DELETE: 'OP9004',
  PATCH: 'OP9006',
  UNKNOWN: 'OP9003'
};

function resolveRequestId(req = null) {
  if (!req || typeof req !== 'object') return '';
  const headerValue = String(req.headers?.['x-request-id'] || '').trim();
  if (headerValue) return headerValue;
  return String(req.requestId || '').trim();
}

function resolveRequestActionStateId(req = null) {
  if (!req || typeof req !== 'object') return '';
  const fromRequestState = String(req.actionStateId || '').trim();
  if (fromRequestState) return fromRequestState;
  const fromBody = String(req.body?.actionStateId || '').trim();
  if (fromBody) return fromBody;
  const fromQuery = String(req.query?.actionStateId || '').trim();
  if (fromQuery) return fromQuery;
  const fromHeader = String(req.headers?.['x-action-state-id'] || '').trim();
  if (fromHeader) return fromHeader;
  return '';
}

function buildDetailsFromRequest(req = null, details = {}) {
  const next = (details && typeof details === 'object' && !Array.isArray(details))
    ? { ...details }
    : {};

  if (req && !next.ip) next.ip = req.ip;
  const requestId = resolveRequestId(req);
  if (requestId && !next.requestId) next.requestId = requestId;
  const actionStateId = resolveRequestActionStateId(req);
  if (actionStateId && !next.actionStateId) next.actionStateId = actionStateId;
  return next;
}

function resolveRequestSectionId(req = null) {
  if (!req || typeof req !== 'object') return '';
  const token = String(req.logSectionId || '').trim();
  return token;
}

function resolveRequestOperationId(req = null) {
  if (!req || typeof req !== 'object') return '';
  const token = String(req.logOperationId || '').trim();
  return token;
}

const logger = {
  /**
   * Fire-and-forget logging write.
   * Keep signature backward compatible for all existing call sites.
   */
  _push: (sectionId, operationId, user, status, details = {}) => {
    const actionStateId = String(details?.actionStateId || '').trim();
    const payload = {
      sectionId,
      operationId,
      status,
      details,
      actionStateId
    };

    dataService.addData('logs', payload, user).catch((err) => {
      console.error('CRITICAL: Logger failed to write to DataService', err);
    });
  },

  record: (req, sectionId, operationId, details = {}) => {
    const user = req?.user || null;
    const payloadDetails = buildDetailsFromRequest(req, details);
    logger._push(sectionId, operationId, user, 'SUCCESS', payloadDetails);
  },

  error: (req, sectionId, operationId, errorObj) => {
    const user = req?.user || null;
    const payloadDetails = buildDetailsFromRequest(req, {
      errorMessage: errorObj?.message,
      stack: errorObj?.stack
    });
    logger._push(sectionId, operationId, user, 'FAILURE', payloadDetails);
  },

  denied: (req, sectionId, operationId, reason) => {
    const user = req?.user || null;
    const payloadDetails = buildDetailsFromRequest(req, { reason });
    logger._push(sectionId, operationId, user, 'DENIED', payloadDetails);
  },

  http: (req, res, duration) => {
    const methodOpId = OPS[req.method] || OPS.UNKNOWN;
    const contextualOpId = resolveRequestOperationId(req);
    const contextualSectionId = resolveRequestSectionId(req);
    const sectionId = contextualSectionId || SECTION_SYSTEM;
    const operationId = contextualOpId || methodOpId;
    const logStatus = res.statusCode >= 400 ? 'FAILURE' : 'SUCCESS';
    const details = buildDetailsFromRequest(req, {
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs: duration,
      userAgent: req.get('User-Agent'),
      methodOperationId: methodOpId
    });

    const user = req.user || null;
    logger._push(sectionId, operationId, user, logStatus, details);
  }
};

module.exports = logger;
