'use strict';

const aiProviderService = require('./ai/aiProviderService');
const schoolAiTokenUsageDataService = require('./schoolAiTokenUsageDataService');

function tokenSummary(response = {}) {
  const usage = response?.usage && typeof response.usage === 'object' ? response.usage : {};
  return {
    promptTokenCount: usage.promptTokenCount ?? null,
    completionTokenCount: usage.candidatesTokenCount ?? usage.completionTokenCount ?? null,
    totalTokenCount: usage.totalTokenCount ?? null
  };
}

async function sendTextPrompt({ binding, prompt, requestingUser, systemPrompt, requestLabel, timeoutMs } = {}) {
  if (!binding) throw new Error('AI binding is required.');
  const started = Date.now();
  const traceId = `school-ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  try {
    const response = await aiProviderService.sendTextPrompt({
      prompt,
      systemPrompt,
      providerId: binding.providerId,
      modelId: binding.modelId,
      credentials: binding.credentials,
      requestLabel: requestLabel || binding.serviceKey,
      timeoutMs
    });
    const usage = tokenSummary(response);
    await schoolAiTokenUsageDataService.recordCall({
      orgId: binding.orgId,
      userId: binding.userId,
      serviceKey: binding.serviceKey,
      providerRecordId: binding.providerRecordId,
      providerId: binding.providerId,
      modelId: response.modelUsed || binding.modelId,
      status: 'success',
      traceId,
      durationMs: Date.now() - started,
      requestSummary: String(prompt || '').slice(0, 500),
      responseSummary: String(response?.text || '').slice(0, 500),
      usage
    }, requestingUser);
    return { ...response, traceId };
  } catch (error) {
    await schoolAiTokenUsageDataService.recordCall({
      orgId: binding.orgId,
      userId: binding.userId,
      serviceKey: binding.serviceKey,
      providerRecordId: binding.providerRecordId,
      providerId: binding.providerId,
      modelId: binding.modelId,
      status: 'failed',
      errorMessage: error?.message || 'AI request failed',
      traceId,
      durationMs: Date.now() - started,
      requestSummary: String(prompt || '').slice(0, 500)
    }, requestingUser);
    throw error;
  }
}

module.exports = {
  sendTextPrompt,
  getAvailableProviders: aiProviderService.getAvailableProviders,
  listAvailableModels: aiProviderService.listAvailableModels,
  getProviderHealth: aiProviderService.getProviderHealth
};