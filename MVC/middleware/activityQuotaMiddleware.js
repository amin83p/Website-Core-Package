const activityQuotaLedgerService = require('../services/activityQuotaLedgerService');
const { toPublicId } = require('../utils/idAdapter');
const consumptionDefinitionPolicyService = require('../services/activityQuota/consumptionDefinitionPolicyService');
const adminAuthorityService = require('../services/adminAuthorityService');

const DEFAULT_SECTION = 'ACTIVITY_QUOTA';
const DEFAULT_OPERATION = 'CONFIGURE';
const METRIC_FIELDS = Object.freeze(['call', 'amount', 'token', 'volume']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isJsonRequest(req) {
  return Boolean(req?.xhr || req?.headers?.['x-ajax-request'] || String(req?.headers?.accept || '').includes('json'));
}

function sendError(req, res, statusCode, message, details = {}) {
  if (isJsonRequest(req)) {
    return res.status(statusCode).json({
      status: 'error',
      message,
      ...details
    });
  }

  return res.status(statusCode).render('error', {
    title: statusCode === 403 ? 'Quota Exceeded' : 'Error',
    message,
    user: req.user || null
  });
}

function resolveValue(value, req) {
  if (typeof value === 'function') return value(req);
  return value;
}

function normalizeString(value, fallback = '') {
  const out = String(value || '').trim();
  return out || fallback;
}

function normalizeNeeds(rawNeeds = {}) {
  const normalized = activityQuotaLedgerService.normalizeNeeds(rawNeeds);
  return METRIC_FIELDS.reduce((acc, field) => {
    acc[field] = Number(normalized[field] || 0);
    return acc;
  }, {});
}

function hasNeeds(needs = {}) {
  return METRIC_FIELDS.some((field) => Number(needs[field] || 0) > 0);
}

async function isAdminQuotaBypass(req, context = {}) {
  if (req?.adminContext?.isRequestAdmin === true) return true;
  return await adminAuthorityService.isAdminForRequestAsync(
    req?.user,
    context.section,
    context.operation,
    {
      orgId: context.orgId,
      section: {
        id: context.section,
        category: req?.adminContext?.category || ''
      }
    }
  );
}

function resolveOrgId(req, config = {}) {
  const override = toPublicId(resolveValue(config.orgId, req));
  if (override) return override;
  const userOrg = toPublicId(req?.user?.activeOrgId || req?.user?.primaryOrgId);
  if (userOrg) return userOrg;
  return toPublicId(req?.body?.orgId || req?.query?.orgId || req?.params?.orgId);
}

function resolveUserId(req, config = {}) {
  const override = toPublicId(resolveValue(config.userId, req));
  if (override) return override;
  const authUserId = toPublicId(req?.user?.id);
  if (authUserId) return authUserId;
  return toPublicId(req?.body?.userId || req?.query?.userId || req?.params?.userId);
}

function buildContextFromRequest(req, config = {}) {
  const section = normalizeString(resolveValue(config.section, req), DEFAULT_SECTION);
  const operation = normalizeString(resolveValue(config.operation, req), DEFAULT_OPERATION);
  const needs = normalizeNeeds(resolveValue(config.needs, req) || {});
  const orgId = resolveOrgId(req, config);
  const userId = resolveUserId(req, config);

  return {
    section,
    operation,
    needs,
    orgId,
    userId
  };
}

function mergeContextValues(base = {}, extra = {}) {
  const baseObj = isPlainObject(base) ? base : {};
  const extraObj = isPlainObject(extra) ? extra : {};
  return {
    ...baseObj,
    ...extraObj
  };
}

function applyEntryDefaults(payload, context) {
  const incoming = isPlainObject(payload) ? payload : {};
  return {
    ...incoming,
    orgId: toPublicId(incoming.orgId || context.orgId),
    userId: toPublicId(incoming.userId || context.userId),
    section: normalizeString(incoming.section, context.section),
    operation: normalizeString(incoming.operation, context.operation)
  };
}

function attachRecorderHooks(req, context, evaluation) {
  const previous = isPlainObject(req.activityQuota) ? req.activityQuota : {};

  req.activityQuota = {
    ...previous,
    orgId: context.orgId,
    userId: context.userId,
    section: context.section,
    operation: context.operation,
    needs: context.needs,
    evaluation,
    async recordCredit(payload = {}, options = {}) {
      const entry = applyEntryDefaults(payload, context);
      return activityQuotaLedgerService.recordCredit(entry, {
        requestUser: req.user,
        backendMode: options?.backendMode
      });
    },
    async recordConsumption(payload = {}, options = {}) {
      const entry = applyEntryDefaults(payload, context);
      return activityQuotaLedgerService.recordConsumption(entry, {
        requestUser: req.user,
        backendMode: options?.backendMode
      });
    },
    async recordAdjustment(payload = {}, options = {}) {
      const entry = applyEntryDefaults(payload, context);
      return activityQuotaLedgerService.recordAdjustment(entry, {
        requestUser: req.user,
        backendMode: options?.backendMode
      });
    },
    async recordSystemCredit(payload = {}, options = {}) {
      const entry = applyEntryDefaults(payload, context);
      return activityQuotaLedgerService.recordSystemEntry(
        { ...entry, entryType: 'credit' },
        { forceSystem: true, backendMode: options?.backendMode }
      );
    },
    async recordSystemConsumption(payload = {}, options = {}) {
      const entry = applyEntryDefaults(payload, context);
      return activityQuotaLedgerService.recordSystemEntry(
        { ...entry, entryType: 'consumption' },
        { forceSystem: true, backendMode: options?.backendMode }
      );
    }
  };
}

function requireActivityQuota(config = {}) {
  return async (req, res, next) => {
    try {
      const context = buildContextFromRequest(req, config);
      if (!context.orgId || !context.userId) {
        return sendError(req, res, 400, 'Activity quota context requires orgId and userId.');
      }

      let evaluation = {
        allowed: true,
        message: 'Quota available.',
        needs: context.needs,
        deficits: METRIC_FIELDS.reduce((acc, field) => {
          acc[field] = 0;
          return acc;
        }, {}),
        snapshot: null
      };

      const bypassAvailabilityCheck = await isAdminQuotaBypass(req, context);

      if (hasNeeds(context.needs) && !bypassAvailabilityCheck) {
        evaluation = await activityQuotaLedgerService.evaluateQuota({
          orgId: context.orgId,
          userId: context.userId,
          section: context.section,
          operation: context.operation,
          needs: context.needs
        });

        if (!evaluation.allowed) {
          return sendError(req, res, 403, evaluation.message, {
            quota: {
              needs: evaluation.needs,
              deficits: evaluation.deficits,
              available: evaluation.snapshot?.totals?.available || {}
            }
          });
        }
      } else if (hasNeeds(context.needs) && bypassAvailabilityCheck) {
        evaluation = {
          ...evaluation,
          allowed: true,
          message: 'Quota availability bypassed for admin request; usage can still be recorded.',
          bypassAvailabilityCheck: true
        };
      }

      attachRecorderHooks(req, context, evaluation);
      return next();
    } catch (error) {
      console.error('Activity quota middleware error:', error);
      return sendError(req, res, 500, error.message || 'Activity quota middleware error.');
    }
  };
}

function attachActivityQuotaContext(config = {}) {
  return async (req, res, next) => {
    try {
      const context = buildContextFromRequest(req, config);
      if (!context.orgId || !context.userId) {
        return sendError(req, res, 400, 'Activity quota context requires orgId and userId.');
      }

      attachRecorderHooks(req, context, {
        allowed: true,
        message: 'Quota context attached.',
        needs: context.needs,
        deficits: METRIC_FIELDS.reduce((acc, field) => {
          acc[field] = 0;
          return acc;
        }, {}),
        snapshot: null
      });
      return next();
    } catch (error) {
      console.error('Activity quota context middleware error:', error);
      return sendError(req, res, 500, error.message || 'Activity quota context middleware error.');
    }
  };
}

function resolveActivityQuotaPolicy(config = {}) {
  return async (req, res, next) => {
    try {
      const context = buildContextFromRequest(req, config);
      if (!context.orgId || !context.userId) {
        return sendError(req, res, 400, 'Activity quota context requires orgId and userId.');
      }

      const sourceEventType = normalizeString(resolveValue(config.sourceEventType, req), '');
      const consumeTiming = normalizeString(resolveValue(config.consumeTiming, req), 'on_attempt').toLowerCase() || 'on_attempt';
      const extraContext = mergeContextValues(
        {
          orgId: context.orgId,
          userId: context.userId,
          sectionId: context.section,
          operationId: context.operation,
          sourceEventType
        },
        resolveValue(config.context, req) || {}
      );

      const resolved = await consumptionDefinitionPolicyService.resolvePolicyDefinition({
        orgId: context.orgId,
        userId: context.userId,
        sectionId: context.section,
        operationId: context.operation,
        sourceEventType
      }, {
        backendMode: resolveValue(config.backendMode, req)
      });

      req.activityQuotaPolicy = {
        ...(isPlainObject(req.activityQuotaPolicy) ? req.activityQuotaPolicy : {}),
        definition: resolved.definition,
        resolvedContext: resolved.context,
        context: extraContext,
        consumeTiming,
        sourceEventType,
        section: context.section,
        operation: context.operation,
        orgId: context.orgId,
        userId: context.userId
      };

      return next();
    } catch (error) {
      const message = error?.message || 'Activity quota policy resolution error.';
      if (error?.code === 'QUOTA_POLICY_NOT_FOUND' || error?.code === 'QUOTA_POLICY_FALLBACK_MISSING') {
        return sendError(req, res, 403, message);
      }
      console.error('Activity quota policy middleware error:', error);
      return sendError(req, res, 500, message);
    }
  };
}

module.exports = {
  requireActivityQuota,
  attachActivityQuotaContext,
  resolveActivityQuotaPolicy
};
