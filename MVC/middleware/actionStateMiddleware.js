// MVC/middleware/actionStateMiddleware.js
const { resolveEntity } = require('../utils/entityResolver'); 
const { SYSTEM_CONTEXT } = require('../../config/constants');
const {
    mergeRequestContext,
    setRequestContextValue,
    getRequestContextValue
} = require('../utils/requestContextStore');

function parseJsonLikeString(value) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed) return value;

    const isObjectLike = trimmed.startsWith('{') && trimmed.endsWith('}');
    const isArrayLike = trimmed.startsWith('[') && trimmed.endsWith(']');
    if (!isObjectLike && !isArrayLike) return value;

    try {
        return JSON.parse(trimmed);
    } catch (_) {
        return value;
    }
}

const DATA_SERVICE_PATH = '../services/dataService';
let cachedDataService = null;

function getCachedDataService() {
  const modulePath = require.resolve(DATA_SERVICE_PATH);
  const cached = require.cache[modulePath];
  if (cached?.loaded && cached.exports) return cached.exports;
  return null;
}

async function resolveDataServiceWithRetry(maxAttempts = 6) {
  let dataService = getCachedDataService();
  if (dataService) return dataService;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      require(DATA_SERVICE_PATH);
    } catch (error) {
      console.error('ActionState Middleware: failed to require dataService module:', error.message);
      break;
    }

    dataService = getCachedDataService();
    if (dataService) return dataService;

    if (attempt < maxAttempts) {
      const waitMs = Math.min(6 + (attempt * 3), 30);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  return getCachedDataService();
}

async function requireTrackingDataService() {
  const dataService = await resolveDataServiceWithRetry();
  if (!dataService) {
    console.error('ActionState Middleware: dataService is not available yet');
    return null;
  }
  const requiredMethods = [
    'logActionStateAttempt',
    'updateActionStateProgress',
    'completeActionState',
    'recordActionStateRetryableError',
    'failActionState'
  ];
  const missingMethod = requiredMethods.find((method) => typeof dataService?.[method] !== 'function');
  if (missingMethod) {
    console.error(`ActionState Middleware: dataService.${missingMethod} is not available yet`);
    return null;
  }
  cachedDataService = dataService;
  return cachedDataService;
}

function normalizePayloadValue(value) {
    const parsedValue = parseJsonLikeString(value);

    if (Array.isArray(parsedValue)) {
        return parsedValue.map(normalizePayloadValue);
    }

    if (parsedValue && typeof parsedValue === 'object') {
        const normalized = {};
        for (const [key, nestedValue] of Object.entries(parsedValue)) {
            normalized[key] = normalizePayloadValue(nestedValue);
        }
        return normalized;
    }

    return parsedValue;
}

function buildActionStatePayload(method, reqBody, bodyOrChunk) {
    if (method === 'GET') return null;

    const source = (reqBody && typeof reqBody === 'object') ? reqBody : bodyOrChunk;
    if (!source || typeof source !== 'object') return source || null;

    const normalized = normalizePayloadValue(source);
    if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
        delete normalized.actionStateId;
        delete normalized.password;
    }
    return normalized;
}

const trackActionState = (sectionIdOrName, operationIdOrName, options = {}) => {
    return async (req, res, next) => {
        try {
            const dataService = await requireTrackingDataService();
            if (!dataService) {
              // Action-state tracking is best-effort and should not block page flow.
              return next();
            }

            // 1. RESOLVE ENTITIES
            const [section, operation] = await Promise.all([
                resolveEntity('sections', sectionIdOrName),
                resolveEntity('operations', operationIdOrName)
            ]);

            if (!section || !operation) return next();
            if (operation.trackState === false || section.trackState === false) {
                return next();
            }

            // -------------------------------------------------------------------------
            // 2. INTELLIGENT SECURITY CHECK
            // -------------------------------------------------------------------------
            const isMutatingRequest = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
            const operationNameToken = String(operation?.name || operationIdOrName || '').trim().toUpperCase();
            const isCreateOperation = operationNameToken === 'CREATE';
            let requiresToken = false;
            if (options.requireToken !== undefined) {
                requiresToken = options.requireToken;
            } else {
                requiresToken = (operation.keepActive === true) || (isMutatingRequest && isCreateOperation);
            }

            const sendError = (statusCode, message) => {
                 if(res.originalEnd) res.end = res.originalEnd; 
                 if(res.originalJson) res.json = res.originalJson;
                 if(res.originalSend) res.send = res.originalSend;

                 if (req.xhr || req.headers['x-ajax-request']) {
                     return res.status(statusCode).json({status:'error', message});
                 }
                 return res.status(statusCode).render('error', { title: 'Action Blocked', message, statusCode, user: req.user });
            };
            // Require a client-provided token for mutating requests when configured.
            if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && requiresToken) {
                const inboundId =
                    req.body?.actionStateId ||
                    req.query?.actionStateId ||
                    req.headers['x-action-state-id'];
                if (!inboundId) {
                    return sendError(403, "<b>Security Violation</b><br>Missing Action State Token. You must load the form before submitting data.");
                }
            }

            // -------------------------------------------------------------------------
            // 3. CAPTURE CONTEXT & LOG ATTEMPT
            // -------------------------------------------------------------------------
            const user = req.user;
            const limits = req.accessLimits || {}; 
            const routeParamKeys = Object.keys(req.params || {});
            const routeParamKey = routeParamKeys.length > 0 ? routeParamKeys[0] : null;
            const routeId = routeParamKey ? req.params[routeParamKey] : null;
            const bodyId = req.body?.id;
            const queryId = req.query?.id;
            // Prefer route param ID as canonical target when present.
            const targetKey = routeId || bodyId || queryId || 'GLOBAL_SCOPE';
            const inboundActionStateId =
                req.body?.actionStateId ||
                req.query?.actionStateId ||
                req.headers['x-action-state-id'];
            const shouldBindClientProvidedToken =
                isMutatingRequest &&
                (requiresToken || options.acceptOptionalToken === true || options.acceptClientToken === true);
            // Only bind to a client-provided token when the route asks for token validation.
            // Runtime endpoints with requireToken:false create a fresh state, so stale incidental
            // headers/body fields from shared page plumbing do not block the action.
            const clientProvidedId = shouldBindClientProvidedToken ? inboundActionStateId : null;

            // If multiple IDs are provided, they must agree with the canonical target.
            if (routeId && bodyId && String(routeId) !== String(bodyId)) {
                return sendError(403, "<b>Security Violation</b><br>Payload id does not match route target.");
            }
            if (routeId && queryId && String(routeId) !== String(queryId)) {
                return sendError(403, "<b>Security Violation</b><br>Query id does not match route target.");
            }

            // ✅ NEW: Capture Request Context
            const activeOrgId = String(user?.activeOrgId || user?.primaryOrgId || '').trim();
            const activeOrg = Array.isArray(user?.allowedOrgs)
                ? user.allowedOrgs.find((org) => String(org?.orgId || org?.id || '').trim() === activeOrgId)
                : null;
            const displayName = typeof user?.displayName === 'string' && user.displayName.trim()
                ? user.displayName.trim()
                : (typeof user?.name === 'string'
                    ? user.name.trim()
                    : (user?.name && typeof user.name === 'object'
                        ? `${user.name.first || ''} ${user.name.last || ''}`.trim()
                        : ''));

            const requestContext = {
                method: req.method,
                url: req.originalUrl || req.url,
                ip: req.ip || req.socket.remoteAddress,
                userAgent: req.headers['user-agent'] || 'Unknown',
                requestId: req.requestId || req.headers['x-request-id'] || '',
                userId: user?.id || '',
                username: user?.username || '',
                displayName,
                orgId: activeOrgId || '',
                orgName: activeOrg?.identity?.displayName || activeOrg?.name || activeOrg?.orgName || ''
            };

            mergeRequestContext({
                request: {
                    method: requestContext.method,
                    url: requestContext.url,
                    ip: requestContext.ip,
                    userAgent: requestContext.userAgent,
                    requestId: requestContext.requestId,
                    userId: requestContext.userId,
                    username: requestContext.username,
                    displayName: requestContext.displayName,
                    orgId: requestContext.orgId,
                    orgName: requestContext.orgName
                },
                actor: {
                    userId: requestContext.userId,
                    username: requestContext.username,
                    displayName: requestContext.displayName,
                    orgId: requestContext.orgId
                }
            });

            let state;
            try {
                // ✅ Pass requestContext to Service
                state = await dataService.logActionStateAttempt(
                    user.id, 
                    section.id, 
                    operation.id, 
                    targetKey, 
                    limits, 
                    clientProvidedId,
                    requestContext 
                );
            } catch (validationError) {
                const errorMessage = String(validationError?.message || 'Unknown action-state validation error.');
                const isSafeNavigation =
                    req.method === 'GET' &&
                    !clientProvidedId &&
                    !['XMLHttpRequest', 'fetch'].includes(String(req.headers['x-requested-with'] || '').trim());
                const isLookupMiss = /Action state not found/i.test(errorMessage);
                const allowInactiveTokenFallback = options.allowInactiveTokenFallback === true;
                const isOperationMismatch = /Action State Token does not belong to this operation/i.test(errorMessage);
                const isTargetMismatch = /Action State Token is not valid for this record/i.test(errorMessage);
                const isInactiveOrExpiredToken =
                    /Action State is no longer active/i.test(errorMessage) ||
                    /Action Session has expired/i.test(errorMessage) ||
                    /Invalid Action State ID/i.test(errorMessage) ||
                    /Action State not found/i.test(errorMessage);
                const canFallbackOperationToken =
                    isMutatingRequest &&
                    requiresToken &&
                    clientProvidedId &&
                    options.allowOperationTokenFallback === true &&
                    (isOperationMismatch || isTargetMismatch || (allowInactiveTokenFallback && isInactiveOrExpiredToken));

                if (canFallbackOperationToken) {
                    try {
                        state = await dataService.logActionStateAttempt(
                            user.id,
                            section.id,
                            operation.id,
                            targetKey,
                            limits,
                            null,
                            {
                                ...requestContext,
                                actionStateFallback: {
                                    reason: isOperationMismatch
                                        ? 'operation_token_mismatch'
                                        : (isTargetMismatch ? 'target_token_mismatch' : 'inactive_or_expired_token'),
                                    inboundActionStateId: String(clientProvidedId || '').trim()
                                }
                            }
                        );
                    } catch (fallbackError) {
                        return sendError(
                            403,
                            "<b>Security Violation</b><br>Session Validation Failed: " +
                                (String(fallbackError?.message || '').trim() || errorMessage)
                        );
                    }
                } else if (isSafeNavigation && isLookupMiss) {
                    try {
                        state = await dataService.logActionStateAttempt(
                            user.id,
                            section.id,
                            operation.id,
                            targetKey,
                            limits,
                            null,
                            requestContext
                        );
                    } catch (_) {
                        // Do not block plain page navigation when only tracking lookup fails.
                        req.actionStateId = null;
                        return next();
                    }
                } else {
                    return sendError(403, "<b>Security Violation</b><br>Session Validation Failed: " + errorMessage);
                }
            }

            // -------------------------------------------------------------------------
            // 3.1. BIND TOKEN TO TARGET KEY (ANTI-TAMPER)
            // -------------------------------------------------------------------------
            // If the client provided an ActionStateId, ensure it belongs to the same target.
            // This prevents using a valid token from Student A to mutate Student B.
            if (clientProvidedId && state?.targetKey && String(state.targetKey) !== String(targetKey)) {
                const canFallbackTargetToken =
                    isMutatingRequest &&
                    requiresToken &&
                    options.allowOperationTokenFallback === true;
                if (canFallbackTargetToken) {
                    try {
                        state = await dataService.logActionStateAttempt(
                            user.id,
                            section.id,
                            operation.id,
                            targetKey,
                            limits,
                            null,
                            {
                                ...requestContext,
                                actionStateFallback: {
                                    reason: 'target_token_mismatch',
                                    inboundActionStateId: String(clientProvidedId || '').trim(),
                                    inboundTargetKey: String(state.targetKey || '').trim(),
                                    resolvedTargetKey: String(targetKey || '').trim()
                                }
                            }
                        );
                    } catch (fallbackTargetError) {
                        return sendError(
                            403,
                            "<b>Security Violation</b><br>Session Validation Failed: " +
                                (String(fallbackTargetError?.message || '').trim() || 'Action State Token is not valid for this record.')
                        );
                    }
                } else {
                    // best-effort mark failed
                    dataService.failActionState(state.id, 0, requestContext).catch(console.error);
                    return sendError(403, "<b>Security Violation</b><br>Action State Token is not valid for this record.");
                }
            }

            if (limits.maxAttempts && state.attemptCount > limits.maxAttempts) {
                await dataService.failActionState(state.id, 0, requestContext);
                return sendError(429, `<b>Security Violation</b><br>Too many attempts. Limit is ${limits.maxAttempts}.`);
            }

            req.actionStateId = state.id;
            req.logSectionId = String(section.id || '').trim() || req.logSectionId;
            req.logOperationId = String(operation.id || '').trim() || req.logOperationId;
            setRequestContextValue('actionStateId', state.id);
            setRequestContextValue('actionState', {
                id: state.id,
                sectionId: req.logSectionId,
                operationId: req.logOperationId,
                targetKey
            });

            // -------------------------------------------------------------------------
            // 4. ROBUST RESPONSE INTERCEPTION
            // -------------------------------------------------------------------------
            
            // A. Determine Lifecycle
            let shouldKeepActive = false;
            if (options.keepActive !== undefined) shouldKeepActive = options.keepActive;
            else if (['POST', 'PUT', 'DELETE'].includes(req.method)) shouldKeepActive = false;
            else if (operation.keepActive) shouldKeepActive = true;

            // B. Capture Originals
            res.originalEnd = res.end;
            res.originalJson = res.json;
            res.originalSend = res.send;

            // C. State Finalizer Function
            const finalizeState = (bodyOrChunk) => {
                if (req._actionStateFinalized) return;
                req._actionStateFinalized = true;

                const statusCode = res.statusCode;
                
                let sizeKB = 0;
                if (bodyOrChunk) {
                    if (Buffer.isBuffer(bodyOrChunk)) sizeKB = bodyOrChunk.length / 1024;
                    else if (typeof bodyOrChunk === 'string') sizeKB = Buffer.byteLength(bodyOrChunk) / 1024;
                    else sizeKB = Buffer.byteLength(JSON.stringify(bodyOrChunk)) / 1024;
                }

                const isSuccess = (statusCode >= 200 && statusCode < 400);

                if (isSuccess) {
                    const hasStructuredChanges = Boolean(getRequestContextValue('actionStateHasStructuredChanges', false));
                    const hasCreateChangeEvent = Boolean(getRequestContextValue('actionStateHasCreateChangeEvent', false));
                    const shouldPersistPayload = !hasStructuredChanges || hasCreateChangeEvent;
                    const payloadToSave = shouldPersistPayload
                        ? buildActionStatePayload(req.method, req.body, bodyOrChunk)
                        : null;

                    if (shouldKeepActive) {
                        // ✅ Pass context to update
                        dataService.updateActionStateProgress(state.id, sizeKB, requestContext).catch(console.error);
                    } else {
                        // ✅ Pass context to completion
                        dataService.completeActionState(state.id, payloadToSave, sizeKB, requestContext).catch(console.error);
                    }
                } else if (statusCode < 500) {
                    let msg = 'Client Error';
                    try { if(typeof bodyOrChunk === 'object' && bodyOrChunk.message) msg = bodyOrChunk.message; } catch(e){}
                    
                    // ✅ Pass context to error
                    dataService.recordActionStateRetryableError(state.id, msg, sizeKB, requestContext).catch(console.error);

                } else {
                    // ✅ Pass context to fail
                    dataService.failActionState(state.id, sizeKB, requestContext).catch(console.error);
                }
            };

            res.json = function (body) {
                finalizeState(body);
                return res.originalJson.call(this, body);
            };

            res.send = function (body) {
                finalizeState(body);
                return res.originalSend.call(this, body);
            };

            res.end = function (chunk, encoding) {
                finalizeState(chunk); 
                return res.originalEnd.call(this, chunk, encoding);
            };

            next();

        } catch (error) {
            console.error("<b>Security Violation</b><br>ActionState Middleware Error:", error);
            next(error);
        }
    };
};

module.exports = { trackActionState };
