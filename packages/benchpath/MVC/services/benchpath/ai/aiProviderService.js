const googleGeminiService = require('./googleGeminiService');

const PROVIDERS = Object.freeze({
  'google-gemini': googleGeminiService
});

const DEFAULT_PROVIDER_ID = 'google-gemini';

function s(value) {
  return String(value ?? '').trim();
}

function normalizeProviderId(providerId) {
  const candidate = s(providerId).toLowerCase();
  return candidate || DEFAULT_PROVIDER_ID;
}

function resolveProvider(providerId) {
  const id = normalizeProviderId(providerId);
  const provider = PROVIDERS[id];
  if (!provider) {
    const supported = Object.keys(PROVIDERS).join(', ');
    throw new Error(`Unsupported AI provider "${providerId}". Supported providers: ${supported}.`);
  }
  return { providerId: id, provider };
}

function normalizeTextMessages(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => ({
      role: String(message?.role || '').trim().toLowerCase() || 'user',
      content: String(message?.content ?? '').trim()
    }))
    .filter((message) => message.content);
}

async function getAvailableProviders() {
  return Object.keys(PROVIDERS).map((id) => ({
    id,
    label: id === 'google-gemini' ? 'Google Gemini' : id,
    isDefault: id === DEFAULT_PROVIDER_ID
  }));
}

function getDefaultProviderId() {
  return DEFAULT_PROVIDER_ID;
}

async function listAvailableModels(providerId = null) {
  const resolved = resolveProvider(providerId);
  const rows = await resolved.provider.listAvailableModels();
  return Array.isArray(rows)
    ? rows.map((row) => ({
      ...row,
      provider: row?.provider || resolved.providerId
    }))
    : [];
}

async function resolveModel({ providerId, modelId } = {}) {
  const resolved = resolveProvider(providerId);
  const resolvedModelId = await resolved.provider.resolveDefaultModel(modelId || null);
  const rows = await resolved.provider.listAvailableModels();
  const match = (Array.isArray(rows) ? rows : []).find((row) => s(row?.id) === s(resolvedModelId));

  return {
    providerId: resolved.providerId,
    modelId: resolvedModelId,
    modelLabel: s(match?.name) || resolvedModelId
  };
}

async function sendPrompt({
  messages,
  providerId,
  modelId,
  generationConfig,
  responseMimeType,
  responseSchema,
  requestLabel
} = {}) {
  const normalizedMessages = normalizeTextMessages(messages);
  if (!normalizedMessages.length) {
    throw new Error('sendPrompt requires a non-empty messages array with content.');
  }

  const resolved = resolveProvider(providerId);
  const modelResolution = await resolveModel({
    providerId: resolved.providerId,
    modelId
  });

  const response = await resolved.provider.sendMessage(normalizedMessages, {
    modelId: modelResolution.modelId,
    generationConfig,
    responseMimeType,
    responseSchema,
    requestLabel
  });

  return {
    ...response,
    provider: response?.provider || modelResolution.providerId,
    modelUsed: s(response?.modelUsed) || modelResolution.modelId
  };
}

async function sendTextPrompt({
  prompt,
  systemPrompt,
  providerId,
  modelId,
  generationConfig,
  responseMimeType,
  responseSchema,
  requestLabel
} = {}) {
  const userPrompt = s(prompt);
  if (!userPrompt) {
    throw new Error('sendTextPrompt requires a non-empty prompt string.');
  }

  const messages = [];
  if (s(systemPrompt)) {
    messages.push({ role: 'system', content: s(systemPrompt) });
  }
  messages.push({ role: 'user', content: userPrompt });

  return await sendPrompt({
    messages,
    providerId,
    modelId,
    generationConfig,
    responseMimeType,
    responseSchema,
    requestLabel
  });
}

async function getProviderHealth(providerId = null) {
  const resolved = resolveProvider(providerId);
  const health = await resolved.provider.healthCheck();
  return {
    providerId: resolved.providerId,
    ...health
  };
}

module.exports = {
  getAvailableProviders,
  getDefaultProviderId,
  listAvailableModels,
  resolveModel,
  sendPrompt,
  sendTextPrompt,
  getProviderHealth
};

