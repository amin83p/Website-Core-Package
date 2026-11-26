'use strict';

const schoolAiTokenUsageDataService = require('./schoolAiTokenUsageDataService');
const schoolAiUserUsageLimitDataService = require('./schoolAiUserUsageLimitDataService');
const { periodWindowStart, toPublicId } = require('./schoolAiAssistCommon');

function limitAppliesToService(limit, serviceKey) {
  const appliesTo = String(limit?.appliesTo || 'all_services');
  if (appliesTo === 'all_services') return true;
  return String(appliesTo) === String(serviceKey || '');
}

function pickApplicableLimits(limits, serviceKey) {
  return (Array.isArray(limits) ? limits : []).filter((limit) => limitAppliesToService(limit, serviceKey));
}

function readLimitCaps(limit) {
  const maxTokens = Math.max(0, Number(limit?.maxTotalTokens) || 0);
  const maxRequests = Math.max(0, Number(limit?.maxRequestCount) || 0);
  return { maxTokens, maxRequests };
}

function limitHasRunnableQuota(limit) {
  const { maxTokens, maxRequests } = readLimitCaps(limit);
  return maxTokens > 0 || maxRequests > 0;
}

async function evaluateQuotaForLimit(limit, { orgToken, userToken, serviceKey, requestingUser }) {
  const appliesTo = String(limit?.appliesTo || 'all_services');
  const since = periodWindowStart(limit.periodType || 'monthly');
  const sums = await schoolAiTokenUsageDataService.sumUsageForUser(
    {
      orgId: orgToken,
      userId: userToken,
      sinceIso: since.toISOString(),
      serviceKey: appliesTo === 'all_services' ? null : serviceKey
    },
    requestingUser || { id: userToken, activeOrgId: orgToken },
    {}
  );
  const { maxTokens, maxRequests } = readLimitCaps(limit);
  const tokensUsed = Number(sums?.totalTokens) || 0;
  const requestsUsed = Number(sums?.requestCount) || 0;
  const noQuotaConfigured = !limitHasRunnableQuota(limit);
  const tokensBlocked = maxTokens > 0 && tokensUsed >= maxTokens;
  const requestsBlocked = maxRequests > 0 && requestsUsed >= maxRequests;
  return {
    periodType: limit.periodType || 'monthly',
    appliesTo,
    maxTokens,
    maxRequests,
    tokensUsed,
    requestsUsed,
    noQuotaConfigured,
    tokensBlocked,
    requestsBlocked,
    blocked: noQuotaConfigured || tokensBlocked || requestsBlocked
  };
}

async function evaluateServiceAccess({
  orgId,
  userId,
  serviceKey = null,
  requestingUser = null,
  accessContext = {},
  noLimitMessage = ''
} = {}) {
  const orgToken = toPublicId(orgId);
  const userToken = toPublicId(userId);
  const key = String(serviceKey || '').trim();
  const deniedNoLimit = {
    hasAssignedLimit: false,
    allowed: false,
    code: 'AI_USAGE_LIMIT_NOT_ASSIGNED',
    statusCode: 403,
    message: noLimitMessage
      || 'No School AI usage limit is assigned for this feature. Ask an admin to add one under AI Assist → Usage Limits.'
  };
  if (!orgToken || !userToken || !key) return { ...deniedNoLimit };

  const limits = await schoolAiUserUsageLimitDataService.listActiveLimitsForUser(
    orgToken,
    userToken,
    requestingUser || { id: userToken, activeOrgId: orgToken },
    accessContext
  );
  const applicable = pickApplicableLimits(limits, key);
  if (!applicable.length) return { ...deniedNoLimit };

  const quotaRows = [];
  for (const limit of applicable) {
    const row = await evaluateQuotaForLimit(limit, {
      orgToken,
      userToken,
      serviceKey: key,
      requestingUser: requestingUser || { id: userToken, activeOrgId: orgToken }
    });
    quotaRows.push(row);
    if (row.blocked) {
      let message = 'You have reached your allocated School AI limit for this period. Contact your administrator for more credit.';
      let code = 'AI_USAGE_LIMIT_EXCEEDED';
      if (row.noQuotaConfigured) {
        code = 'AI_USAGE_NO_QUOTA';
        message = 'No token or request credit is configured on your usage limit. Contact your administrator to assign a quota in AI Assist → Usage Limits.';
      } else if (row.tokensBlocked) {
        message = `You have used your allocated token limit (${row.periodType}: ${row.tokensUsed} of ${row.maxTokens}). Contact your administrator for more credit.`;
      } else if (row.requestsBlocked) {
        message = `You have used your allocated request limit (${row.periodType}: ${row.requestsUsed} of ${row.maxRequests}). Contact your administrator for more credit.`;
      }
      return {
        hasAssignedLimit: true,
        allowed: false,
        code,
        statusCode: 403,
        message,
        quotas: quotaRows
      };
    }
  }

  return {
    hasAssignedLimit: true,
    allowed: true,
    code: '',
    statusCode: 200,
    message: '',
    quotas: quotaRows
  };
}

async function assertWithinLimit({ orgId, userId, serviceKey = null, requestingUser = null }) {
  const orgToken = toPublicId(orgId);
  const userToken = toPublicId(userId);
  if (!orgToken || !userToken) return;

  const limits = await schoolAiUserUsageLimitDataService.listActiveLimitsForUser(
    orgToken,
    userToken,
    requestingUser || { id: userToken, activeOrgId: orgToken },
    {}
  );

  for (const limit of limits) {
    if (!limitAppliesToService(limit, serviceKey)) continue;
    const row = await evaluateQuotaForLimit(limit, {
      orgToken,
      userToken,
      serviceKey,
      requestingUser: requestingUser || { id: userToken, activeOrgId: orgToken }
    });
    if (row.noQuotaConfigured) {
      throw new Error('No token or request credit is configured on your usage limit. Contact your administrator.');
    }
    if (row.tokensBlocked) {
      throw new Error(`You have used your allocated token limit (${row.periodType}: ${row.tokensUsed} of ${row.maxTokens}). Contact your administrator for more credit.`);
    }
    if (row.requestsBlocked) {
      throw new Error(`You have used your allocated request limit (${row.periodType}: ${row.requestsUsed} of ${row.maxRequests}). Contact your administrator for more credit.`);
    }
  }
}

module.exports = {
  limitAppliesToService,
  limitHasRunnableQuota,
  evaluateServiceAccess,
  assertWithinLimit
};