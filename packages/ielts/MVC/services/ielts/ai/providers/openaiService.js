const PROVIDER_ID = 'openai';
const PROVIDER_LABEL = 'OpenAI';
const DEFAULT_TIMEOUT_MS = 60000;
const MODEL_LIST_CACHE_TTL_MS = 5 * 60 * 1000;

const MODEL_PREFERENCE = Object.freeze([
  'gpt-5-mini',
  'gpt-5',
  'gpt-4.1-mini',
  'gpt-4.1'
]);
const REASONING_EFFORT_VALUES = new Set(['minimal', 'low', 'medium', 'high']);

let cachedModels = null;
let cachedModelsAt = 0;
let cachedDefaultModelId = null;

function now() {
  return Date.now();
}

function s(value) {
  return String(value ?? '').trim();
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function firstNonEmpty(values = []) {
  for (const value of values) {
    const normalized = s(value);
    if (normalized) return normalized;
  }
  return '';
}

function resolveApiKey(credentials = {}) {
  return firstNonEmpty([
    credentials.apiKey,
    process.env.IELTS_OPENAI_API_KEY,
    process.env.OPENAI_API_KEY
  ]);
}

function resolveBaseUrl(credentials = {}) {
  return firstNonEmpty([
    credentials.baseUrl,
    process.env.IELTS_OPENAI_BASE_URL,
    process.env.OPENAI_BASE_URL,
    'https://api.openai.com/v1'
  ]).replace(/\/+$/, '');
}

function resolveConfiguredModelId() {
  return firstNonEmpty([
    process.env.IELTS_OPENAI_MODEL_ID,
    process.env.OPENAI_MODEL_ID
  ]);
}

function assertApiKey(credentials = {}) {
  const apiKey = resolveApiKey(credentials);
  if (!apiKey) {
    const err = new Error('OpenAI API key is missing. Provide credentials.apiKey or configure IELTS_OPENAI_API_KEY / OPENAI_API_KEY.');
    err.code = 'MISSING_API_KEY';
    throw err;
  }
  return apiKey;
}

function getProviderId() {
  return PROVIDER_ID;
}

function getDefaultGenerationConfig() {
  return {
    temperature: 1,
    topP: 1,
    maxOutputTokens: 4096,
    reasoningEffort: 'high'
  };
}

function normalizeReasoningEffort(value) {
  const token = s(value).toLowerCase();
  if (!token) return '';
  if (token === 'hard') return 'high';
  if (token === 'xhigh' || token === 'very_high' || token === 'very-high') return 'high';
  return REASONING_EFFORT_VALUES.has(token) ? token : '';
}

function resolveReasoningEffort(generationConfig = {}) {
  const explicit = normalizeReasoningEffort(
    generationConfig?.reasoningEffort
    || generationConfig?.reasoning_effort
    || generationConfig?.reasoning?.effort
  );
  if (explicit) return explicit;

  const fromEnv = normalizeReasoningEffort(firstNonEmpty([
    process.env.IELTS_OPENAI_REASONING_EFFORT,
    process.env.OPENAI_REASONING_EFFORT,
    'high'
  ]));
  return fromEnv || 'high';
}

function buildHeaders(credentials = {}) {
  const apiKey = assertApiKey(credentials);
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
  const organization = s(credentials.organization);
  const project = s(credentials.project);
  if (organization) headers['OpenAI-Organization'] = organization;
  if (project) headers['OpenAI-Project'] = project;
  return headers;
}

function buildFallbackModels() {
  return MODEL_PREFERENCE.map((id) => ({
    id,
    name: id,
    provider: PROVIDER_ID,
    supportsGenerateContent: true,
    isDefaultCandidate: true
  }));
}

function normalizeModelRows(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((row) => {
      const id = s(row?.id);
      if (!id) return null;
      return {
        id,
        name: id,
        provider: PROVIDER_ID,
        supportsGenerateContent: true,
        isDefaultCandidate: MODEL_PREFERENCE.includes(id)
      };
    })
    .filter(Boolean);
}

function sortModelsByPreference(rows = []) {
  return rows.slice().sort((a, b) => {
    const ai = MODEL_PREFERENCE.indexOf(a.id);
    const bi = MODEL_PREFERENCE.indexOf(b.id);
    const aRank = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
    const bRank = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
    if (aRank !== bRank) return aRank - bRank;
    return a.id.localeCompare(b.id);
  });
}

async function fetchModelRows(credentials = {}, options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  const useSharedCache = !s(credentials.apiKey) && !s(credentials.baseUrl);
  if (useSharedCache) {
    const hasFresh = cachedModels && (now() - cachedModelsAt) < MODEL_LIST_CACHE_TTL_MS;
    if (!forceRefresh && hasFresh) return cachedModels.slice();
  }

  try {
    const baseUrl = resolveBaseUrl(credentials);
    const response = await fetch(`${baseUrl}/models`, { headers: buildHeaders(credentials) });
    if (!response.ok) throw new Error(`Model listing failed with status ${response.status}.`);
    const payload = await response.json();
    const rows = sortModelsByPreference(normalizeModelRows(payload?.data || []));
    if (rows.length) {
      if (useSharedCache) {
        cachedModels = rows;
        cachedModelsAt = now();
      }
      return rows.slice();
    }
  } catch (error) {
    const fallback = buildFallbackModels();
    if (useSharedCache) {
      cachedModels = fallback;
      cachedModelsAt = now();
    }
    return fallback.slice();
  }

  const fallback = buildFallbackModels();
  if (useSharedCache) {
    cachedModels = fallback;
    cachedModelsAt = now();
  }
  return fallback.slice();
}

async function listAvailableModels(credentials = {}) {
  return await fetchModelRows(credentials, { forceRefresh: false });
}

async function resolveDefaultModel(preferredModelId = null, credentials = {}) {
  const explicit = s(preferredModelId);
  if (explicit) return explicit;
  const useSharedCache = !s(credentials.apiKey) && !s(credentials.baseUrl);
  if (useSharedCache && cachedDefaultModelId) return cachedDefaultModelId;

  const configured = resolveConfiguredModelId();
  const models = await fetchModelRows(credentials, { forceRefresh: false });
  const ids = models.map((m) => m.id);

  const ordered = [];
  if (configured) ordered.push(configured);
  ordered.push(...MODEL_PREFERENCE);
  ordered.push(...ids);

  const seen = new Set();
  const resolved = ordered.find((candidate) => {
    const id = s(candidate);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return ids.includes(id);
  }) || configured || ids[0] || MODEL_PREFERENCE[0];

  if (useSharedCache) cachedDefaultModelId = resolved;
  return resolved;
}

function normalizeMessagePart(part) {
  if (part === undefined || part === null) return null;
  if (typeof part === 'string' || typeof part === 'number' || typeof part === 'boolean') {
    const text = s(part);
    return text ? { type: 'text', text } : null;
  }
  if (!isPlainObject(part)) return null;

  const textValue = s(part.text);
  if (textValue) return { type: 'text', text: textValue };

  const inlineData = isPlainObject(part.inlineData) ? part.inlineData : null;
  const mimeType = s(inlineData?.mimeType).toLowerCase();
  const data = s(inlineData?.data);
  if (mimeType && data) {
    return {
      type: 'inlineData',
      mimeType,
      data
    };
  }

  const fileData = isPlainObject(part.fileData) ? part.fileData : null;
  const fileMimeType = s(fileData?.mimeType).toLowerCase();
  const fileUri = s(fileData?.fileUri);
  if (fileMimeType && fileUri) {
    return {
      type: 'fileData',
      mimeType: fileMimeType,
      fileUri
    };
  }

  return null;
}

function normalizeMessageParts(content) {
  if (Array.isArray(content)) {
    return content.map(normalizeMessagePart).filter(Boolean);
  }
  const single = normalizeMessagePart(content);
  if (single) return [single];
  if (isPlainObject(content)) {
    try {
      const text = JSON.stringify(content, null, 2);
      return text ? [{ type: 'text', text }] : [];
    } catch (_) {
      return [];
    }
  }
  const fallback = s(content);
  return fallback ? [{ type: 'text', text: fallback }] : [];
}

function inferOpenAiAudioFormat(mimeType = '') {
  const token = s(mimeType).toLowerCase();
  if (token.includes('wav')) return 'wav';
  if (token.includes('flac')) return 'flac';
  if (token.includes('mp3') || token.includes('mpeg')) return 'mp3';
  return 'mp3';
}

function toOpenAiContentBlocks(parts = []) {
  const out = [];
  (Array.isArray(parts) ? parts : []).forEach((part) => {
    if (!part || typeof part !== 'object') return;
    if (part.type === 'text') {
      const text = s(part.text);
      if (!text) return;
      out.push({ type: 'text', text });
      return;
    }

    if (part.type === 'inlineData') {
      const mimeType = s(part.mimeType).toLowerCase();
      const data = s(part.data);
      if (!mimeType || !data) return;
      if (mimeType.startsWith('image/')) {
        out.push({
          type: 'image_url',
          image_url: { url: `data:${mimeType};base64,${data}` }
        });
        return;
      }
      if (mimeType.startsWith('audio/')) {
        out.push({
          type: 'input_audio',
          input_audio: {
            data,
            format: inferOpenAiAudioFormat(mimeType)
          }
        });
      }
      return;
    }

    if (part.type === 'fileData') {
      const mimeType = s(part.mimeType).toLowerCase();
      const fileUri = s(part.fileUri);
      if (!mimeType || !fileUri) return;
      if (mimeType.startsWith('image/')) {
        out.push({
          type: 'image_url',
          image_url: { url: fileUri }
        });
      }
    }
  });
  return out;
}

function collectTextFromParts(parts = []) {
  return (Array.isArray(parts) ? parts : [])
    .filter((part) => part?.type === 'text')
    .map((part) => s(part?.text))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function toOpenAiMessages(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const role = ['system', 'user', 'assistant'].includes(s(row?.role).toLowerCase())
      ? s(row.role).toLowerCase()
      : 'user';
    const contentBlocks = toOpenAiContentBlocks(row?.parts || []);
    if (role === 'system') {
      return {
        role,
        content: collectTextFromParts(row?.parts || [])
      };
    }
    if (!contentBlocks.length) {
      return {
        role,
        content: collectTextFromParts(row?.parts || [])
      };
    }
    if (contentBlocks.length === 1 && contentBlocks[0]?.type === 'text') {
      return {
        role,
        content: s(contentBlocks[0].text)
      };
    }
    return {
      role,
      content: contentBlocks
    };
  }).filter((row) => s(row?.content) || Array.isArray(row?.content));
}

function normalizeMessages(messages = []) {
  const rows = (Array.isArray(messages) ? messages : [])
    .map((m) => ({
      role: ['system', 'user', 'assistant'].includes(s(m?.role).toLowerCase()) ? s(m?.role).toLowerCase() : 'user',
      parts: normalizeMessageParts(m?.content)
    }))
    .filter((m) => Array.isArray(m.parts) && m.parts.length > 0);

  if (!rows.length) throw new Error('sendMessage requires a non-empty messages array.');
  return rows;
}

function isRestrictedSamplingModel(modelId = '') {
  const id = s(modelId).toLowerCase();
  return id.startsWith('gpt-5');
}

function supportsReasoningEffort(modelId = '') {
  const id = s(modelId).toLowerCase();
  return id.startsWith('gpt-5') || /^o\d/.test(id);
}

function buildRequestBody({
  modelId,
  messages,
  generationConfig = {},
  responseMimeType,
  responseSchema,
  omitSamplingControls = false,
  omitReasoningEffort = false
}) {
  const defaults = getDefaultGenerationConfig();
  const merged = { ...defaults, ...(generationConfig || {}) };
  const body = {
    model: modelId,
    messages
  };

  if (!omitSamplingControls) {
    if (merged.temperature !== undefined) body.temperature = Number(merged.temperature);
    if (merged.topP !== undefined) body.top_p = Number(merged.topP);
  }
  if (merged.maxOutputTokens !== undefined) body.max_completion_tokens = Number(merged.maxOutputTokens);
  if (!omitReasoningEffort && supportsReasoningEffort(modelId)) {
    const effort = resolveReasoningEffort(merged);
    if (effort) body.reasoning_effort = effort;
  }

  const mime = s(responseMimeType).toLowerCase();
  if (mime.includes('application/json')) {
    if (responseSchema && typeof responseSchema === 'object') {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'ielts_response_schema',
          schema: responseSchema
        }
      };
    } else {
      body.response_format = { type: 'json_object' };
    }
  }

  return body;
}

function withTimeout(promise, timeoutMs, label) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`OpenAI request timed out after ${timeoutMs}ms${label ? ` (${label})` : ''}.`);
      err.code = 'AI_TIMEOUT';
      reject(err);
    }, timeoutMs);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }).catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function isModelNotFound(error) {
  const text = s(error?.message).toLowerCase();
  return text.includes('model') && text.includes('not found');
}

function isUnsupportedSamplingError(error) {
  const text = s(error?.message).toLowerCase();
  return (
    text.includes('unsupported value')
    && (text.includes('temperature') || text.includes('top_p') || text.includes('topp'))
  );
}

function isUnsupportedReasoningEffortError(error) {
  const text = s(error?.message).toLowerCase();
  if (!text.includes('reasoning') && !text.includes('reasoning_effort')) return false;
  return (
    text.includes('unsupported')
    || text.includes('invalid')
    || text.includes('unknown')
    || text.includes('unrecognized')
    || text.includes('not allowed')
  );
}

function isTimeoutError(error) {
  const code = s(error?.code).toUpperCase();
  if (code === 'AI_TIMEOUT') return true;
  const text = s(error?.message).toLowerCase();
  return text.includes('timed out');
}

function parseOutputText(payload = {}) {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const content = choice?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

function buildUsage(payload = {}) {
  const usage = payload?.usage || null;
  if (!usage || typeof usage !== 'object') return null;
  return {
    promptTokenCount: usage.prompt_tokens ?? null,
    candidatesTokenCount: usage.completion_tokens ?? null,
    totalTokenCount: usage.total_tokens ?? null,
    cachedContentTokenCount: null
  };
}

async function sendMessage(messages, options = {}) {
  const credentials = options?.credentials || {};
  const normalizedRows = normalizeMessages(messages);
  const normalizedMessages = toOpenAiMessages(normalizedRows);
  const explicitModelId = s(options?.modelId);
  const modelWasExplicitlyForced = Boolean(explicitModelId);
  let modelId = explicitModelId || await resolveDefaultModel(null, credentials);
  const timeoutMs = Number(options?.timeoutMs || DEFAULT_TIMEOUT_MS);

  const execute = async (
    activeModelId,
    retriedFromModel = null,
    forceDefaultSampling = false,
    forceNoReasoningEffort = false
  ) => {
    const baseUrl = resolveBaseUrl(credentials);
    const omitSamplingControls = forceDefaultSampling || isRestrictedSamplingModel(activeModelId);
    const body = buildRequestBody({
      modelId: activeModelId,
      messages: normalizedMessages,
      generationConfig: options?.generationConfig || {},
      responseMimeType: options?.responseMimeType,
      responseSchema: options?.responseSchema,
      omitSamplingControls,
      omitReasoningEffort: forceNoReasoningEffort
    });

    const run = async () => {
      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: buildHeaders(credentials),
          body: JSON.stringify(body),
          signal: options?.abortSignal || undefined
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const err = new Error(payload?.error?.message || `OpenAI request failed with status ${response.status}.`);
          err.status = response.status;
          throw err;
        }
        return payload;
      } catch (error) {
        const isAbort =
          String(error?.name || '').toLowerCase() === 'aborterror' ||
          String(error?.message || '').toLowerCase().includes('aborted');
        if (isAbort) {
          const abortErr = new Error('OpenAI request aborted by caller.');
          abortErr.name = 'AbortError';
          abortErr.code = 'RUN_CANCELLED';
          throw abortErr;
        }
        throw error;
      }
    };

    const payload = await withTimeout(run(), timeoutMs, s(options?.requestLabel));
    return {
      provider: PROVIDER_ID,
      modelUsed: activeModelId,
      text: parseOutputText(payload),
      raw: payload,
      usage: buildUsage(payload),
      requestMeta: {
        providerId: PROVIDER_ID,
        providerLabel: PROVIDER_LABEL,
        requestLabel: s(options?.requestLabel) || null,
        timeoutMs,
        retriedFromModel,
        omitSamplingControls,
        omitReasoningEffort: forceNoReasoningEffort,
        messageCount: normalizedRows.length,
        timestamp: new Date().toISOString()
      }
    };
  };

  try {
    return await execute(modelId, null, false);
  } catch (error) {
    if (isTimeoutError(error) && supportsReasoningEffort(modelId)) {
      try {
        return await execute(modelId, null, false, true);
      } catch (innerError) {
        if (isUnsupportedSamplingError(innerError)) {
          return await execute(modelId, null, true, true);
        }
        throw innerError;
      }
    }
    if (isUnsupportedReasoningEffortError(error)) {
      return await execute(modelId, null, false, true);
    }
    if (isUnsupportedSamplingError(error)) {
      try {
        return await execute(modelId, null, true, false);
      } catch (innerError) {
        if (isUnsupportedReasoningEffortError(innerError)) {
          return await execute(modelId, null, true, true);
        }
        throw innerError;
      }
    }
    if (!modelWasExplicitlyForced && isModelNotFound(error)) {
      const retriedModel = await resolveDefaultModel(null, credentials);
      if (retriedModel && retriedModel !== modelId) {
        modelId = retriedModel;
        return await execute(retriedModel, explicitModelId || null, false);
      }
    }
    throw error;
  }
}

function healthCheck(options = {}) {
  const credentials = options?.credentials || {};
  const apiKey = resolveApiKey(credentials);
  return {
    provider: PROVIDER_ID,
    status: apiKey ? 'ready' : 'missing_api_key',
    hasApiKey: Boolean(apiKey),
    configuredModelId: resolveConfiguredModelId() || null,
    baseUrl: resolveBaseUrl(credentials),
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
