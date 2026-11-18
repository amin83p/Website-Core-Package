'use strict';

const schoolAiTokenUsageDataService = require('./schoolAiTokenUsageDataService');
const schoolAiUserUsageLimitDataService = require('./schoolAiUserUsageLimitDataService');
const { periodWindowStart, toPublicId } = require('./schoolAiAssistCommon');

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
    const appliesTo = String(limit?.appliesTo || 'all_services');
    if (appliesTo !== 'all_services' && String(appliesTo) !== String(serviceKey || '')) continue;

    const since = periodWindowStart(limit.periodType || 'monthly');
    const sums = await schoolAiTokenUsageDataService.sumUsageForUser(
      { orgId: orgToken, userId: userToken, sinceIso: since.toISOString(), serviceKey: appliesTo === 'all_services' ? null : serviceKey },
      requestingUser || { id: userToken, activeOrgId: orgToken },
      {}
    );

    const maxTokens = Number(limit?.maxTotalTokens) || 0;
    const maxRequests = Number(limit?.maxRequestCount) || 0;
    if (maxTokens > 0 && sums.totalTokens >= maxTokens) {
      throw new Error(`AI token quota exceeded (${limit.periodType}, max ${maxTokens} tokens).`);
    }
    if (maxRequests > 0 && sums.requestCount >= maxRequests) {
      throw new Error(`AI request quota exceeded (${limit.periodType}, max ${maxRequests} requests).`);
    }
  }
}

module.exports = {
  assertWithinLimit
};