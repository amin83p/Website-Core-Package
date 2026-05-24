const PROVIDER_ID = 'anthropic';
const PROVIDER_LABEL = 'Anthropic';
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_API_VERSION = '2023-06-01';
const MODEL_LIST_CACHE_TTL_MS = 5 * 60 * 1000;

const MODEL_PREFERENCE = Object.freeze([
  'claude-3-5-sonnet-latest',
  'claude-3-5-haiku-latest',
  'claude-3-opus-latest'
]);

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
    process.env.PTE_ANTHROPIC_API_KEY,
    process.env.IELTS_ANTHROPIC_API_KEY,
    process.env.ANTHROPIC_API_KEY
  ]);
}

function resolveBaseUrl(credentials = {}) {
  return firstNonEmpty([
    credentials.baseUrl,
    process.env.PTE_ANTHROPIC_BASE_URL,
    process.env.IELTS_ANTHROPIC_BASE_URL,
    process.env.ANTHROPIC_BASE_URL,
    'https://api.anthropic.com'
  ]).replace(/\/+$/, '');
}

function resolveApiVersion(credentials = {}) {
  return firstNonEmpty([
    credentials.apiVersion,
    process.env.PTE_ANTHROPIC_API_VERSION,
    process.env.IELTS_ANTHROPIC_API_VERSION,
    process.env.ANTHROPIC_API_VERSION,
    DEFAULT_API_VERSION
  ]);
}

function resolveConfiguredModelId() {
  return firstNonEmpty([
    process.env.PTE_ANTHROPIC_MODEL_ID,
    process.env.IELTS_ANTHROPIC_MODEL_ID,
    process.env.ANTHROPIC_MODEL_ID
  ]);
}

function assertApiKey(credentials = {}) {
  const apiKey = resolveApiKey(credentials);
  if (!apiKey) {
    const err = new Error('Anthropic API key is missing. Provide credentials.apiKey or configure PTE_ANTHROPIC_API_KEY / IELTS_ANTHROPIC_API_KEY / ANTHROPIC_API_KEY.');
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
    temperature: 0,
    topP: 1,
    maxOutputTokens: 4096
  };
}

function buildHeaders(credentials = {}) {
  return {
    'x-api-key': assertApiKey(credentials),
    'anthropic-version': resolveApiVersion(credentials),
    'Content-Type': 'application/json'
  };
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
      const id = s(row?.id || row?.name);
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
    const response = await fetch(`${baseUrl}/v1/models`, {
      method: 'GET',
      headers: buildHeaders(credentials)
    });
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

function collectTextFromParts(parts = []) {
  return (Array.isArray(parts) ? parts : [])
    .filter((part) => part?.type === 'text')
    .map((part) => s(part?.text))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function toAnthropicContentBlocks(parts = []) {
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
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeType,
            data
          }
        });
        return;
      }
      if (mimeType.startsWith('audio/')) {
        out.push({
          type: 'input_audio',
          source: {
            type: 'base64',
            media_type: mimeType,
            data
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
          type: 'image',
          source: {
            type: 'url',
            url: fileUri
          }
        });
      }
    }
  });
  return out;
}

function normalizeMessages(messages = []) {
  const rows = (Array.isArray(messages) ? messages : [])
    .map((m) => ({
      role: s(m?.role).toLowerCase(),
      parts: normalizeMessageParts(m?.content)
    }))
    .filter((m) => Array.isArray(m.parts) && m.parts.length > 0);

  if (!rows.length) throw new Error('sendMessage requires a non-empty messages array.');
  return rows;
}

function convertToAnthropicMessages(rows = []) {
  const system = rows
    .filter((m) => m.role === 'system')
    .map((m) => collectTextFromParts(m.parts))
    .filter(Boolean)
    .join('\n\n')
    .trim();

  const messages = rows
    .filter((m) => m.role !== 'system')
    .map((m) => {
      const contentBlocks = toAnthropicContentBlocks(m.parts);
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      if (!contentBlocks.length) {
        return {
          role,
          content: collectTextFromParts(m.parts)
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
    })
    .filter((row) => s(row?.content) || Array.isArray(row?.content));

  if (!messages.length) {
    throw new Error('At least one user/assistant message is required after system messages.');
  }

  return { system: system || undefined, messages };
}

function buildRequestBody({ modelId, rows, generationConfig = {}, responseMimeType }) {
  const defaults = getDefaultGenerationConfig();
  const merged = { ...defaults, ...(generationConfig || {}) };
  const converted = convertToAnthropicMessages(rows);

  const body = {
    model: modelId,
    messages: converted.messages,
    max_tokens: Number(merged.maxOutputTokens || defaults.maxOutputTokens)
  };

  if (converted.system) body.system = converted.system;
  if (merged.temperature !== undefined) body.temperature = Number(merged.temperature);
  if (merged.topP !== undefined) body.top_p = Number(merged.topP);

  const mime = s(responseMimeType).toLowerCase();
  if (mime.includes('application/json')) {
    const jsonInstruction = 'Return strict JSON only. Do not include markdown or prose outside JSON.';
    body.system = body.system ? `${body.system}\n\n${jsonInstruction}` : jsonInstruction;
  }

  return body;
}

function withTimeout(promise, timeoutMs, label) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`Anthropic request timed out after ${timeoutMs}ms${label ? ` (${label})` : ''}.`);
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

function parseOutputText(payload = {}) {
  const content = Array.isArray(payload?.content) ? payload.content : [];
  return content
    .map((part) => (part?.type === 'text' ? String(part?.text || '') : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function buildUsage(payload = {}) {
  const usage = payload?.usage || null;
  if (!usage || typeof usage !== 'object') return null;
  return {
    promptTokenCount: usage.input_tokens ?? null,
    candidatesTokenCount: usage.output_tokens ?? null,
    totalTokenCount: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) || null,
    cachedContentTokenCount: null
  };
}

function isModelNotFound(error) {
  const text = s(error?.message).toLowerCase();
  return text.includes('model') && text.includes('not found');
}

async function sendMessage(messages, options = {}) {
  const credentials = options?.credentials || {};
  const rows = normalizeMessages(messages);
  const explicitModelId = s(options?.modelId);
  const modelWasExplicitlyForced = Boolean(explicitModelId);
  let modelId = explicitModelId || await resolveDefaultModel(null, credentials);
  const timeoutMs = Number(options?.timeoutMs || DEFAULT_TIMEOUT_MS);

  const execute = async (activeModelId, retriedFromModel = null) => {
    const body = buildRequestBody({
      modelId: activeModelId,
      rows,
      generationConfig: options?.generationConfig || {},
      responseMimeType: options?.responseMimeType
    });

    const run = async () => {
      try {
        const baseUrl = resolveBaseUrl(credentials);
        const response = await fetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: buildHeaders(credentials),
          body: JSON.stringify(body),
          signal: options?.abortSignal || undefined
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const err = new Error(payload?.error?.message || `Anthropic request failed with status ${response.status}.`);
          err.status = response.status;
          throw err;
        }
        return payload;
      } catch (error) {
        const isAbort =
          String(error?.name || '').toLowerCase() === 'aborterror' ||
          String(error?.message || '').toLowerCase().includes('aborted');
        if (isAbort) {
          const abortErr = new Error('Anthropic request aborted by caller.');
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
        messageCount: rows.length,
        timestamp: new Date().toISOString()
      }
    };
  };

  try {
    return await execute(modelId, null);
  } catch (error) {
    if (!modelWasExplicitlyForced && isModelNotFound(error)) {
      const retryModel = await resolveDefaultModel(null, credentials);
      if (retryModel && retryModel !== modelId) {
        modelId = retryModel;
        return await execute(retryModel, explicitModelId || null);
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
