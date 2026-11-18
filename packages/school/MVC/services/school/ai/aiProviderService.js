const googleGeminiService = require('./providers/googleGeminiService');
const googleVertexService = require('./providers/googleVertexService');
const openaiService = require('./providers/openaiService');
const anthropicService = require('./providers/anthropicService');
const azureOpenAIService = require('./providers/azureOpenAIService');

const PROVIDERS = Object.freeze({
  'google-gemini': googleGeminiService,
  'google-vertex': googleVertexService,
  openai: openaiService,
  anthropic: anthropicService,
  'azure-openai': azureOpenAIService
});

const PROVIDER_LABELS = Object.freeze({
  'google-gemini': 'Google Gemini',
  'google-vertex': 'Google Vertex AI',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  'azure-openai': 'Azure OpenAI'
});

const DEFAULT_PROVIDER_ID = 'google-gemini';

function s(value) {
  return String(value ?? '').trim();
}

function normalizeProviderId(providerId) {
  return s(providerId).toLowerCase() || DEFAULT_PROVIDER_ID;
}

function normalizeTextMessages(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => ({
      role: String(message?.role || '').trim().toLowerCase() || 'user',
      content: String(message?.content ?? '').trim()
    }))
    .filter((message) => message.content);
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

async function getAvailableProviders() {
  return Object.keys(PROVIDERS).map((id) => ({
    id,
    label: PROVIDER_LABELS[id] || id,
    isDefault: id === DEFAULT_PROVIDER_ID
  }));
}

function getDefaultProviderId() {
  return DEFAULT_PROVIDER_ID;
}

async function listAvailableModels(providerId = null, options = {}) {
  const resolved = resolveProvider(providerId);
  const rows = await resolved.provider.listAvailableModels(options);
  return Array.isArray(rows)
    ? rows.map((row) => ({
      ...row,
      provider: row?.provider || resolved.providerId
    }))
    : [];
}

async function resolveModel({ providerId, modelId, credentials } = {}) {
  const resolved = resolveProvider(providerId);
  const resolvedModelId = await resolved.provider.resolveDefaultModel(modelId || null, credentials || {});
  const rows = await resolved.provider.listAvailableModels(credentials || {});
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
  requestLabel,
  timeoutMs,
  credentials,
  abortSignal
} = {}) {
  const normalizedMessages = normalizeTextMessages(messages);
  if (!normalizedMessages.length) {
    throw new Error('sendPrompt requires a non-empty messages array with content.');
  }

  const resolved = resolveProvider(providerId);
  const modelResolution = await resolveModel({
    providerId: resolved.providerId,
    modelId,
    credentials: credentials || {}
  });

  const response = await resolved.provider.sendMessage(normalizedMessages, {
    modelId: modelResolution.modelId,
    generationConfig,
    responseMimeType,
    responseSchema,
    requestLabel,
    timeoutMs,
    credentials: credentials || {},
    abortSignal: abortSignal || null
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
  requestLabel,
  timeoutMs,
  credentials,
  abortSignal
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
    requestLabel,
    timeoutMs,
    credentials,
    abortSignal
  });
}

async function getProviderHealth(providerId = null, options = {}) {
  const resolved = resolveProvider(providerId);
  const health = await resolved.provider.healthCheck(options || {});
  return {
    providerId: resolved.providerId,
    providerLabel: PROVIDER_LABELS[resolved.providerId] || resolved.providerId,
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
