const googleGeminiService = require('./providers/googleGeminiService');
const googleVertexService = require('./providers/googleVertexService');
const openaiService = require('./providers/openaiService');
const anthropicService = require('./providers/anthropicService');
const azureOpenAIService = require('./providers/azureOpenAIService');
const pteAiTokenUsageDataService = require('../pteAiTokenUsageDataService');

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
const PTE_AI_LOG_PREFIX = '[PTE AI]';

function s(value) {
  return String(value ?? '').trim();
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createRequestTraceId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `pte-ai-${Date.now().toString(36)}-${rand}`;
}

function sumContentChars(content) {
  if (typeof content === 'string') return s(content).length;
  if (Array.isArray(content)) {
    return content.reduce((sum, part) => {
      if (typeof part === 'string') return sum + s(part).length;
      if (isPlainObject(part) && Object.prototype.hasOwnProperty.call(part, 'text')) {
        return sum + s(part.text).length;
      }
      return sum;
    }, 0);
  }
  if (isPlainObject(content) && Object.prototype.hasOwnProperty.call(content, 'text')) {
    return s(content.text).length;
  }
  return 0;
}

function sumMessageChars(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .reduce((sum, message) => sum + sumContentChars(message?.content), 0);
}

function toPositiveInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function tokenUsageSummary(usage = null) {
  const row = usage && typeof usage === 'object' ? usage : {};
  const promptTokenCount = Number.isFinite(Number(row.promptTokenCount)) ? Number(row.promptTokenCount) : null;
  const candidatesTokenCount = Number.isFinite(Number(row.candidatesTokenCount)) ? Number(row.candidatesTokenCount) : null;
  const totalTokenCount = Number.isFinite(Number(row.totalTokenCount)) ? Number(row.totalTokenCount) : null;
  const cachedContentTokenCount = Number.isFinite(Number(row.cachedContentTokenCount)) ? Number(row.cachedContentTokenCount) : null;
  return {
    promptTokenCount,
    candidatesTokenCount,
    totalTokenCount,
    cachedContentTokenCount
  };
}

function normalizeUsageContext(rawContext = null) {
  const source = isPlainObject(rawContext) ? rawContext : {};
  const nestedSource = isPlainObject(source.source) ? source.source : {};
  return {
    requestingUser: source.requestingUser || null,
    section: s(source.section).toUpperCase() || 'PTE_AI_ASSISST',
    operation: s(source.operation).toUpperCase() || 'UPDATE',
    objectId: s(source.objectId) || '',
    requestLabel: s(source.requestLabel) || '',
    providerRecordId: s(source.providerRecordId || nestedSource.providerRecordId),
    providerRecordName: s(source.providerRecordName || nestedSource.providerRecordName),
    source: {
      module: s(source.sourceModule || nestedSource.module),
      eventType: s(source.sourceEventType || nestedSource.eventType),
      eventId: s(source.sourceEventId || nestedSource.eventId),
      idempotencyKey: s(source.sourceIdempotencyKey || nestedSource.idempotencyKey)
    }
  };
}

async function persistUsageLog({
  usageContext,
  response,
  error,
  startedAtMs,
  traceId,
  requestLabel,
  messageCount,
  hasSystemInstruction,
  messageChars,
  timeoutMs,
  requestedProviderId,
  requestedModelId,
  resolvedProviderId,
  resolvedModelId
} = {}) {
  try {
    const normalizedContext = normalizeUsageContext(usageContext);
    if (!normalizedContext.requestingUser) return;

    const usage = tokenUsageSummary(response?.usage);
    const modelUsed = s(response?.modelUsed || resolvedModelId || requestedModelId);
    const providerId = s(response?.provider || resolvedProviderId || requestedProviderId).toLowerCase();
    const consumedAt = new Date().toISOString();
    const durationMs = Math.max(0, Date.now() - Number(startedAtMs || Date.now()));
    const status = error ? 'failed' : 'success';
    const effectiveRequestLabel = normalizedContext.requestLabel || s(requestLabel);
    const source = {
      ...normalizedContext.source,
      traceId: s(traceId),
      timeoutMs: Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : null
    };

    await pteAiTokenUsageDataService.recordUsage({
      consumedAt,
      section: normalizedContext.section,
      operation: normalizedContext.operation,
      objectId: normalizedContext.objectId || 'DRAFT:unknown',
      providerId,
      providerRecordId: normalizedContext.providerRecordId || null,
      providerRecordName: normalizedContext.providerRecordName || null,
      modelUsed: modelUsed || null,
      requestLabel: effectiveRequestLabel || null,
      status,
      errorMessage: error ? s(error?.message) || 'Unknown AI runtime failure.' : null,
      usage: {
        promptTokenCount: usage.promptTokenCount,
        candidatesTokenCount: usage.candidatesTokenCount,
        totalTokenCount: usage.totalTokenCount,
        cachedContentTokenCount: usage.cachedContentTokenCount
      },
      promptTokenCount: usage.promptTokenCount,
      candidatesTokenCount: usage.candidatesTokenCount,
      totalTokenCount: usage.totalTokenCount,
      cachedContentTokenCount: usage.cachedContentTokenCount,
      messageCount: Number.isFinite(Number(messageCount)) ? Number(messageCount) : 0,
      hasSystemInstruction: Boolean(hasSystemInstruction),
      requestMeta: {
        durationMs,
        messageCount: Number.isFinite(Number(messageCount)) ? Number(messageCount) : 0,
        hasSystemInstruction: Boolean(hasSystemInstruction),
        messageChars: Number.isFinite(Number(messageChars)) ? Number(messageChars) : 0,
        responseChars: s(response?.text).length,
        source
      }
    }, normalizedContext.requestingUser);
  } catch (loggingError) {
    console.warn(
      `${PTE_AI_LOG_PREFIX} [usage-log] Unable to persist token usage entry: ${s(loggingError?.message) || 'unknown error'}`
    );
  }
}

function normalizeProviderId(providerId) {
  return s(providerId).toLowerCase() || DEFAULT_PROVIDER_ID;
}

function normalizeMessagePart(part) {
  if (part === undefined || part === null) return null;
  if (typeof part === 'string' || typeof part === 'number' || typeof part === 'boolean') {
    const text = s(part);
    return text ? { text } : null;
  }
  if (!isPlainObject(part)) return null;

  const textValue = s(part.text);
  if (textValue) return { text: textValue };

  const inlineData = isPlainObject(part.inlineData) ? part.inlineData : null;
  const mimeType = s(inlineData?.mimeType);
  const data = s(inlineData?.data);
  if (mimeType && data) {
    return {
      inlineData: {
        mimeType,
        data
      }
    };
  }

  return null;
}

function normalizeMessageContent(content) {
  if (Array.isArray(content)) {
    const parts = content.map(normalizeMessagePart).filter(Boolean);
    if (!parts.length) return '';
    if (parts.length === 1 && Object.prototype.hasOwnProperty.call(parts[0], 'text')) {
      return parts[0].text;
    }
    return parts;
  }

  const singlePart = normalizeMessagePart(content);
  if (singlePart) {
    if (Object.prototype.hasOwnProperty.call(singlePart, 'text')) return singlePart.text;
    return [singlePart];
  }

  if (isPlainObject(content)) {
    try {
      return JSON.stringify(content, null, 2);
    } catch (_) {
      return '';
    }
  }

  return s(content);
}

function normalizeTextMessages(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => {
      const content = normalizeMessageContent(message?.content);
      const hasContent = typeof content === 'string'
        ? s(content).length > 0
        : Array.isArray(content) && content.length > 0;
      return {
        role: String(message?.role || '').trim().toLowerCase() || 'user',
        content,
        _hasContent: hasContent
      };
    })
    .filter((message) => message._hasContent)
    .map((message) => ({
      role: message.role,
      content: message.content
    }));
}

function resolveProvider(providerId) {
  const id = normalizeProviderId(providerId);
  const provider = PROVIDERS[id];
  if (!provider) {
    const supported = Object.keys(PROVIDERS).join(', ');
    throw new Error(`Unsupported PTE AI provider "${providerId}". Supported providers: ${supported}.`);
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

async function listAvailableModels(providerId = null, credentials = {}) {
  const resolved = resolveProvider(providerId);
  const rows = await resolved.provider.listAvailableModels(credentials);
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
  disableCache,
  requestLabel,
  timeoutMs,
  credentials,
  abortSignal,
  usageContext
} = {}) {
  const normalizedMessages = normalizeTextMessages(messages);
  if (!normalizedMessages.length) {
    throw new Error('sendPrompt requires a non-empty messages array with content.');
  }

  const traceId = createRequestTraceId();
  const startedAtMs = Date.now();
  const requestedProviderId = normalizeProviderId(providerId);
  const requestedModelId = s(modelId);
  const messageCount = normalizedMessages.length;
  const messageChars = sumMessageChars(normalizedMessages);
  const label = s(requestLabel) || 'pte-ai-request';
  const timeout = toPositiveInt(timeoutMs, 0);
  const noCache = Boolean(disableCache);
  const hasResponseSchema = Boolean(responseSchema && typeof responseSchema === 'object');
  const hasSystemInstruction = normalizedMessages.some((message) => s(message?.role).toLowerCase() === 'system');
  const normalizedUsageContext = normalizeUsageContext(usageContext);
  console.log(
    `${PTE_AI_LOG_PREFIX} [${traceId}] START label=${label} provider=${requestedProviderId} modelRequested=${requestedModelId || 'auto'} messages=${messageCount} chars=${messageChars} timeoutMs=${timeout || 'default'} mime=${s(responseMimeType) || 'default'} schema=${hasResponseSchema ? 'yes' : 'no'} noCache=${noCache ? 'yes' : 'no'}`
  );

  try {
    const resolved = resolveProvider(providerId);
    const modelResolution = await resolveModel({
      providerId: resolved.providerId,
      modelId,
      credentials: credentials || {}
    });

    console.log(
      `${PTE_AI_LOG_PREFIX} [${traceId}] RESOLVED provider=${modelResolution.providerId} model=${modelResolution.modelId}`
    );

    const response = await resolved.provider.sendMessage(normalizedMessages, {
      modelId: modelResolution.modelId,
      generationConfig,
      responseMimeType,
      responseSchema,
      disableCache: noCache,
      requestLabel,
      timeoutMs,
      credentials: credentials || {},
      abortSignal: abortSignal || null
    });

    const normalizedResponse = {
      ...response,
      provider: response?.provider || modelResolution.providerId,
      modelUsed: s(response?.modelUsed) || modelResolution.modelId
    };
    const elapsedMs = Date.now() - startedAtMs;
    const usage = tokenUsageSummary(normalizedResponse?.usage);
    const responseChars = s(normalizedResponse?.text).length;
    console.log(
      `${PTE_AI_LOG_PREFIX} [${traceId}] SUCCESS label=${label} provider=${normalizedResponse.provider} model=${normalizedResponse.modelUsed} durationMs=${elapsedMs} responseChars=${responseChars} promptTokens=${usage.promptTokenCount ?? 'n/a'} completionTokens=${usage.candidatesTokenCount ?? 'n/a'} totalTokens=${usage.totalTokenCount ?? 'n/a'}`
    );

    await persistUsageLog({
      usageContext: normalizedUsageContext,
      response: normalizedResponse,
      error: null,
      startedAtMs,
      traceId,
      requestLabel: label,
      messageCount,
      hasSystemInstruction,
      messageChars,
      timeoutMs,
      requestedProviderId,
      requestedModelId,
      resolvedProviderId: modelResolution.providerId,
      resolvedModelId: modelResolution.modelId
    });

    return normalizedResponse;
  } catch (error) {
    const elapsedMs = Date.now() - startedAtMs;
    console.error(
      `${PTE_AI_LOG_PREFIX} [${traceId}] ERROR label=${label} provider=${requestedProviderId} modelRequested=${requestedModelId || 'auto'} durationMs=${elapsedMs} code=${s(error?.code) || 'n/a'} message="${s(error?.message)}"`
    );

    await persistUsageLog({
      usageContext: normalizedUsageContext,
      response: null,
      error,
      startedAtMs,
      traceId,
      requestLabel: label,
      messageCount,
      hasSystemInstruction,
      messageChars,
      timeoutMs,
      requestedProviderId,
      requestedModelId,
      resolvedProviderId: requestedProviderId,
      resolvedModelId: requestedModelId
    });
    throw error;
  }
}

async function sendTextPrompt({
  prompt,
  systemPrompt,
  providerId,
  modelId,
  generationConfig,
  responseMimeType,
  responseSchema,
  disableCache,
  requestLabel,
  timeoutMs,
  credentials,
  abortSignal,
  usageContext
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
    disableCache,
    requestLabel,
    timeoutMs,
    credentials,
    abortSignal,
    usageContext: {
      ...normalizeUsageContext(usageContext),
      requestLabel: s(usageContext?.requestLabel || requestLabel)
    }
  });
}

module.exports = {
  getAvailableProviders,
  getDefaultProviderId,
  listAvailableModels,
  resolveModel,
  sendPrompt,
  sendTextPrompt
};
