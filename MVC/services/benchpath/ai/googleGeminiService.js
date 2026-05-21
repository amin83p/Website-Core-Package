const { GoogleGenerativeAI } = require('@google/generative-ai');

const PROVIDER_ID = 'google-gemini';
const PROVIDER_LABEL = 'Google Gemini';

const MODEL_PREFERENCE = Object.freeze([
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-1.5-pro',
  'gemini-1.5-flash'
]);
const GEMINI_RESPONSE_SCHEMA_UNSUPPORTED_KEYS = new Set([
  'additionalProperties'
]);

const MODEL_LIST_CACHE_TTL_MS = 5 * 60 * 1000;

let _client = null;
let _cachedDefaultModelId = null;
let _cachedModelRows = null;
let _cachedModelRowsAt = 0;

function now() {
  return Date.now();
}

function s(value) {
  return String(value ?? '').trim();
}

function normalizeModelId(value) {
  return s(value).replace(/^models\//i, '');
}

function firstNonEmpty(values = []) {
  for (const value of values) {
    const normalized = s(value);
    if (normalized) return normalized;
  }
  return '';
}

function resolveApiKey() {
  return firstNonEmpty([
    process.env.BENCHPATH_GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.GEMINI_API_KEY
  ]);
}

function resolveConfiguredModelId() {
  return normalizeModelId(
    firstNonEmpty([
      process.env.BENCHPATH_GEMINI_MODEL_ID,
      process.env.GEMINI_MODEL_ID
    ])
  );
}

function assertApiKey() {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    const err = new Error('Gemini API key is missing. Set BENCHPATH_GEMINI_API_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY.');
    err.code = 'MISSING_API_KEY';
    throw err;
  }
  return apiKey;
}

function getClient() {
  if (_client) return _client;
  const apiKey = assertApiKey();
  _client = new GoogleGenerativeAI(apiKey);
  return _client;
}

function getProviderId() {
  return PROVIDER_ID;
}

function getDefaultGenerationConfig() {
  return {
    temperature: 0,
    topP: 1,
    topK: 1,
    candidateCount: 1,
    maxOutputTokens: 8192
  };
}

function buildFallbackModelRows() {
  return MODEL_PREFERENCE.map((id) => ({
    id,
    name: id,
    provider: PROVIDER_ID,
    supportsGenerateContent: true,
    isDefaultCandidate: true
  }));
}

function normalizeModelRow(row = {}) {
  const id = normalizeModelId(row.name || row.id);
  if (!id) return null;

  const supportsGenerateContent = Array.isArray(row.supportedGenerationMethods)
    ? row.supportedGenerationMethods.includes('generateContent')
    : true;

  return {
    id,
    name: s(row.displayName) || id,
    provider: PROVIDER_ID,
    supportsGenerateContent,
    isDefaultCandidate: MODEL_PREFERENCE.includes(id)
  };
}

function sortModelsByPreference(rows = []) {
  return rows.slice().sort((a, b) => {
    const ai = MODEL_PREFERENCE.indexOf(a.id);
    const bi = MODEL_PREFERENCE.indexOf(b.id);
    const aRank = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
    const bRank = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
    if (aRank !== bRank) return aRank - bRank;
    return s(a.id).localeCompare(s(b.id));
  });
}

async function fetchModelRows(options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  const hasFreshCache = _cachedModelRows && (now() - _cachedModelRowsAt) < MODEL_LIST_CACHE_TTL_MS;
  if (!forceRefresh && hasFreshCache) return _cachedModelRows.slice();

  const apiKey = resolveApiKey();
  if (!apiKey) {
    const fallback = buildFallbackModelRows();
    _cachedModelRows = fallback;
    _cachedModelRowsAt = now();
    return fallback.slice();
  }

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
    if (!response.ok) {
      throw new Error(`Model listing failed with status ${response.status}.`);
    }
    const payload = await response.json();
    const normalizedRows = Array.isArray(payload?.models)
      ? payload.models.map(normalizeModelRow).filter(Boolean)
      : [];
    const sorted = sortModelsByPreference(normalizedRows);
    if (sorted.length) {
      _cachedModelRows = sorted;
      _cachedModelRowsAt = now();
      return sorted.slice();
    }
  } catch (error) {
    const fallback = buildFallbackModelRows();
    _cachedModelRows = fallback;
    _cachedModelRowsAt = now();
    return fallback.slice();
  }

  const fallback = buildFallbackModelRows();
  _cachedModelRows = fallback;
  _cachedModelRowsAt = now();
  return fallback.slice();
}

async function listAvailableModels() {
  return await fetchModelRows();
}

async function resolveDefaultModelInternal(preferredModelId = null, options = {}) {
  const explicit = normalizeModelId(preferredModelId);
  if (explicit) return explicit;

  const forceRefresh = Boolean(options.forceRefresh);
  const ignoreConfigured = Boolean(options.ignoreConfigured);

  if (!forceRefresh && _cachedDefaultModelId) return _cachedDefaultModelId;

  const configuredModelId = ignoreConfigured ? '' : resolveConfiguredModelId();
  const models = await fetchModelRows({ forceRefresh });
  const supports = models.filter((row) => row.supportsGenerateContent !== false);
  const availableIds = supports.map((row) => row.id);

  const candidateOrder = [];
  if (configuredModelId) candidateOrder.push(configuredModelId);
  candidateOrder.push(...MODEL_PREFERENCE);
  candidateOrder.push(...availableIds);

  const seen = new Set();
  const firstMatch = candidateOrder.find((candidate) => {
    const id = normalizeModelId(candidate);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return availableIds.includes(id);
  });

  const resolved = firstMatch
    || configuredModelId
    || normalizeModelId(availableIds[0])
    || MODEL_PREFERENCE[0];

  _cachedDefaultModelId = resolved;
  return resolved;
}

async function resolveDefaultModel(preferredModelId = null) {
  return await resolveDefaultModelInternal(preferredModelId, { forceRefresh: false, ignoreConfigured: false });
}

function normalizeRole(role) {
  const normalized = s(role).toLowerCase();
  if (normalized === 'assistant' || normalized === 'model') return 'assistant';
  if (normalized === 'system') return 'system';
  return 'user';
}

function normalizeMessageContent(content) {
  if (content === undefined || content === null) return '';
  if (typeof content === 'string') return content;
  if (typeof content === 'number' || typeof content === 'boolean') return String(content);
  try {
    return JSON.stringify(content, null, 2);
  } catch (error) {
    return String(content);
  }
}

function normalizeMessages(messages = []) {
  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) {
    throw new Error('sendMessage requires a non-empty messages array.');
  }

  const normalized = list.map((item) => ({
    role: normalizeRole(item?.role),
    content: normalizeMessageContent(item?.content).trim()
  })).filter((item) => item.content);

  if (!normalized.length) {
    throw new Error('No usable message content was provided.');
  }

  const systemInstruction = normalized
    .filter((item) => item.role === 'system')
    .map((item) => item.content)
    .join('\n\n')
    .trim();

  const chatMessages = normalized.filter((item) => item.role !== 'system');
  if (!chatMessages.length) {
    throw new Error('At least one user/assistant message is required after system messages.');
  }

  const last = chatMessages[chatMessages.length - 1];
  if (last.role !== 'user') {
    throw new Error('The last non-system message must have role="user".');
  }

  const history = chatMessages.slice(0, -1).map((item) => ({
    role: item.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: item.content }]
  }));

  return {
    systemInstruction: systemInstruction || undefined,
    history,
    lastMessage: last.content,
    normalizedMessages: normalized
  };
}

function toGeminiSystemInstruction(content) {
  const text = s(content);
  if (!text) return undefined;
  return {
    parts: [{ text }]
  };
}

function sanitizeGeminiResponseSchema(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitizeGeminiResponseSchema);
  const out = {};
  Object.entries(value).forEach(([key, nested]) => {
    if (GEMINI_RESPONSE_SCHEMA_UNSUPPORTED_KEYS.has(key)) return;
    out[key] = sanitizeGeminiResponseSchema(nested);
  });
  return out;
}

function buildGenerationConfig(options = {}) {
  const base = getDefaultGenerationConfig();
  const provided = options && typeof options === 'object'
    ? { ...options }
    : {};

  const config = {
    ...base,
    ...provided
  };

  if (s(options.responseMimeType)) config.responseMimeType = s(options.responseMimeType);
  if (options.responseSchema && typeof options.responseSchema === 'object') {
    config.responseSchema = sanitizeGeminiResponseSchema(options.responseSchema);
  }

  return config;
}

function sanitizeGenerationConfigForMeta(config = {}) {
  const clone = { ...config };
  if (clone.responseSchema) clone.responseSchema = '[provided]';
  return clone;
}

function extractUsage(result, response) {
  const usage = response?.usageMetadata || result?.response?.usageMetadata || null;
  if (!usage || typeof usage !== 'object') return null;
  return {
    promptTokenCount: usage.promptTokenCount ?? null,
    candidatesTokenCount: usage.candidatesTokenCount ?? null,
    totalTokenCount: usage.totalTokenCount ?? null,
    cachedContentTokenCount: usage.cachedContentTokenCount ?? null
  };
}

function isModelNotFoundError(error) {
  const text = s(error?.message).toLowerCase();
  return Boolean(
    text.includes('404')
    || text.includes('model not found')
    || text.includes('not found')
  );
}

function withTimeout(promise, timeoutMs, label) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const timeoutError = new Error(`Gemini request timed out after ${timeoutMs}ms${label ? ` (${label})` : ''}.`);
      timeoutError.code = 'AI_TIMEOUT';
      reject(timeoutError);
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function buildRequestMeta({
  requestLabel,
  timeoutMs,
  generationConfig,
  normalizedPayload,
  retriedFromModel
}) {
  return {
    providerId: PROVIDER_ID,
    providerLabel: PROVIDER_LABEL,
    requestLabel: s(requestLabel) || null,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : null,
    messageCount: Array.isArray(normalizedPayload?.normalizedMessages) ? normalizedPayload.normalizedMessages.length : 0,
    historyCount: Array.isArray(normalizedPayload?.history) ? normalizedPayload.history.length : 0,
    hasSystemInstruction: Boolean(normalizedPayload?.systemInstruction),
    generationConfig: sanitizeGenerationConfigForMeta(generationConfig),
    retriedFromModel: retriedFromModel || null,
    timestamp: new Date().toISOString()
  };
}

async function sendMessage(messages, options = {}) {
  const explicitModelId = normalizeModelId(options?.modelId);
  const modelWasExplicitlyForced = Boolean(explicitModelId);
  const generationConfig = buildGenerationConfig({
    ...(options?.generationConfig || {}),
    responseMimeType: options?.responseMimeType,
    responseSchema: options?.responseSchema
  });

  const timeoutMs = Number(options?.timeoutMs);
  const normalizedPayload = normalizeMessages(messages);

  let modelToUse = await resolveDefaultModelInternal(explicitModelId, { forceRefresh: false, ignoreConfigured: false });

  const executeRequest = async (activeModelId, retriedFromModel = null) => {
    const client = getClient();
    const model = client.getGenerativeModel({ model: activeModelId });
    const chatOptions = {
      history: normalizedPayload.history,
      generationConfig
    };
    if (normalizedPayload.systemInstruction) {
      chatOptions.systemInstruction = toGeminiSystemInstruction(normalizedPayload.systemInstruction);
    }

    const chat = model.startChat(chatOptions);
    const run = async () => {
      const result = await chat.sendMessage(normalizedPayload.lastMessage);
      const response = await result.response;
      return { result, response };
    };

    const { result, response } = await withTimeout(run(), timeoutMs, s(options?.requestLabel));
    return {
      provider: PROVIDER_ID,
      modelUsed: activeModelId,
      text: String(response?.text?.() || ''),
      raw: response,
      usage: extractUsage(result, response),
      requestMeta: buildRequestMeta({
        requestLabel: options?.requestLabel,
        timeoutMs,
        generationConfig,
        normalizedPayload,
        retriedFromModel
      })
    };
  };

  try {
    return await executeRequest(modelToUse, null);
  } catch (error) {
    if (isModelNotFoundError(error)) {
      if (modelWasExplicitlyForced) {
        const explicitError = new Error(`Gemini model "${explicitModelId}" was not found. Choose a valid model ID or leave modelId empty to auto-resolve.`);
        explicitError.code = 'INVALID_MODEL';
        throw explicitError;
      }

      const retriedModel = await resolveDefaultModelInternal(null, {
        forceRefresh: true,
        ignoreConfigured: true
      });

      if (retriedModel && retriedModel !== modelToUse) {
        console.warn(`[BenchPath AI][${PROVIDER_ID}] Model "${modelToUse}" unavailable. Retrying with "${retriedModel}".`);
        _cachedDefaultModelId = retriedModel;
        return await executeRequest(retriedModel, modelToUse);
      }

      const invalidError = new Error(`Gemini default model "${modelToUse}" is unavailable and no alternative model could be resolved.`);
      invalidError.code = 'INVALID_MODEL';
      throw invalidError;
    }

    throw error;
  }
}

function healthCheck() {
  const apiKey = resolveApiKey();
  return {
    provider: PROVIDER_ID,
    status: apiKey ? 'ready' : 'missing_api_key',
    hasApiKey: Boolean(apiKey),
    configuredModelId: resolveConfiguredModelId() || null,
    cachedDefaultModelId: _cachedDefaultModelId || null,
    cache: {
      modelListCached: Boolean(_cachedModelRows),
      modelListAgeMs: _cachedModelRowsAt ? Math.max(0, now() - _cachedModelRowsAt) : null
    },
    checkedAt: new Date().toISOString()
  };
}

module.exports = {
  getProviderId,
  getDefaultGenerationConfig,
  listAvailableModels,
  resolveDefaultModel,
  normalizeMessages,
  sendMessage,
  healthCheck
};
