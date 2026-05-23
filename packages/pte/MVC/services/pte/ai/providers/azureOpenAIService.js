const PROVIDER_ID = 'azure-openai';
const PROVIDER_LABEL = 'Azure OpenAI';
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_API_VERSION = '2024-10-21';

const MODEL_PREFERENCE = Object.freeze([
  'gpt-4.1-mini',
  'gpt-4.1',
  'gpt-4o-mini'
]);

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
    process.env.IELTS_AZURE_OPENAI_API_KEY,
    process.env.AZURE_OPENAI_API_KEY
  ]);
}

function resolveEndpoint(credentials = {}) {
  return firstNonEmpty([
    credentials.endpoint,
    credentials.baseUrl,
    process.env.IELTS_AZURE_OPENAI_ENDPOINT,
    process.env.AZURE_OPENAI_ENDPOINT
  ]).replace(/\/+$/, '');
}

function resolveApiVersion(credentials = {}) {
  return firstNonEmpty([
    credentials.apiVersion,
    process.env.IELTS_AZURE_OPENAI_API_VERSION,
    process.env.AZURE_OPENAI_API_VERSION,
    DEFAULT_API_VERSION
  ]);
}

function resolveConfiguredDeploymentId() {
  return firstNonEmpty([
    process.env.IELTS_AZURE_OPENAI_DEPLOYMENT,
    process.env.AZURE_OPENAI_DEPLOYMENT
  ]);
}

function assertApiKey(credentials = {}) {
  const apiKey = resolveApiKey(credentials);
  if (!apiKey) {
    const err = new Error('Azure OpenAI API key is missing. Provide credentials.apiKey or configure IELTS_AZURE_OPENAI_API_KEY / AZURE_OPENAI_API_KEY.');
    err.code = 'MISSING_API_KEY';
    throw err;
  }
  return apiKey;
}

function assertEndpoint(credentials = {}) {
  const endpoint = resolveEndpoint(credentials);
  if (!endpoint) {
    const err = new Error('Azure OpenAI endpoint is missing. Provide credentials.endpoint or configure IELTS_AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_ENDPOINT.');
    err.code = 'MISSING_ENDPOINT';
    throw err;
  }
  return endpoint;
}

function getProviderId() {
  return PROVIDER_ID;
}

function getDefaultGenerationConfig() {
  return {
    temperature: 1,
    topP: 1,
    maxOutputTokens: 4096
  };
}

function buildHeaders(credentials = {}) {
  return {
    'api-key': assertApiKey(credentials),
    'Content-Type': 'application/json'
  };
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

function inferAzureAudioFormat(mimeType = '') {
  const token = s(mimeType).toLowerCase();
  if (token.includes('wav')) return 'wav';
  if (token.includes('flac')) return 'flac';
  if (token.includes('mp3') || token.includes('mpeg')) return 'mp3';
  return 'mp3';
}

function toAzureContentBlocks(parts = []) {
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
            format: inferAzureAudioFormat(mimeType)
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

function toAzureMessages(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const role = ['system', 'user', 'assistant'].includes(s(row?.role).toLowerCase())
      ? s(row.role).toLowerCase()
      : 'user';
    const contentBlocks = toAzureContentBlocks(row?.parts || []);
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

function buildFallbackModels(credentials = {}) {
  const configured = resolveConfiguredDeploymentId();
  const ids = [];
  if (configured) ids.push(configured);
  ids.push(...MODEL_PREFERENCE);
  const deduped = Array.from(new Set(ids.filter(Boolean)));
  return deduped.map((id) => ({
    id,
    name: id,
    provider: PROVIDER_ID,
    supportsGenerateContent: true,
    isDefaultCandidate: MODEL_PREFERENCE.includes(id)
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

async function listAvailableModels(credentials = {}) {
  try {
    const endpoint = assertEndpoint(credentials);
    const apiVersion = resolveApiVersion(credentials);
    const response = await fetch(`${endpoint}/openai/models?api-version=${encodeURIComponent(apiVersion)}`, {
      method: 'GET',
      headers: buildHeaders(credentials)
    });
    if (!response.ok) throw new Error(`Model listing failed with status ${response.status}.`);
    const payload = await response.json();
    const rows = normalizeModelRows(payload?.data || []);
    if (rows.length) return rows;
  } catch (error) {
    return buildFallbackModels(credentials);
  }
  return buildFallbackModels(credentials);
}

async function resolveDefaultModel(preferredModelId = null, credentials = {}) {
  const explicit = s(preferredModelId);
  if (explicit) return explicit;

  const configured = resolveConfiguredDeploymentId();
  const rows = await listAvailableModels(credentials);
  const ids = rows.map((row) => row.id);

  const ordered = [];
  if (configured) ordered.push(configured);
  ordered.push(...MODEL_PREFERENCE);
  ordered.push(...ids);

  const seen = new Set();
  return ordered.find((candidate) => {
    const id = s(candidate);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return ids.includes(id);
  }) || configured || ids[0] || MODEL_PREFERENCE[0];
}

function isRestrictedSamplingModel(modelId = '') {
  const id = s(modelId).toLowerCase();
  return id.startsWith('gpt-5');
}

function buildRequestBody({
  modelId,
  messages,
  generationConfig = {},
  responseMimeType,
  responseSchema,
  omitSamplingControls = false
}) {
  const defaults = getDefaultGenerationConfig();
  const merged = { ...defaults, ...(generationConfig || {}) };
  const body = {
    messages
  };

  if (modelId) body.model = modelId;
  if (!omitSamplingControls) {
    if (merged.temperature !== undefined) body.temperature = Number(merged.temperature);
    if (merged.topP !== undefined) body.top_p = Number(merged.topP);
  }
  if (merged.maxOutputTokens !== undefined) body.max_tokens = Number(merged.maxOutputTokens);

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
      const err = new Error(`Azure OpenAI request timed out after ${timeoutMs}ms${label ? ` (${label})` : ''}.`);
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

function isModelNotFound(error) {
  const text = s(error?.message).toLowerCase();
  return text.includes('deployment') && text.includes('not found');
}

function isUnsupportedSamplingError(error) {
  const text = s(error?.message).toLowerCase();
  return (
    text.includes('unsupported value')
    && (text.includes('temperature') || text.includes('top_p') || text.includes('topp'))
  );
}

async function sendMessage(messages, options = {}) {
  const credentials = options?.credentials || {};
  const normalizedRows = normalizeMessages(messages);
  const normalizedMessages = toAzureMessages(normalizedRows);
  const explicitModelId = s(options?.modelId);
  const modelWasExplicitlyForced = Boolean(explicitModelId);
  let deploymentId = explicitModelId || await resolveDefaultModel(null, credentials);
  const timeoutMs = Number(options?.timeoutMs || DEFAULT_TIMEOUT_MS);

  const execute = async (activeDeployment, retriedFromModel = null, forceDefaultSampling = false) => {
    const endpoint = assertEndpoint(credentials);
    const apiVersion = resolveApiVersion(credentials);
    const omitSamplingControls = forceDefaultSampling || isRestrictedSamplingModel(activeDeployment);
    const body = buildRequestBody({
      modelId: activeDeployment,
      messages: normalizedMessages,
      generationConfig: options?.generationConfig || {},
      responseMimeType: options?.responseMimeType,
      responseSchema: options?.responseSchema,
      omitSamplingControls
    });

    const run = async () => {
      try {
        const response = await fetch(`${endpoint}/openai/deployments/${encodeURIComponent(activeDeployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`, {
          method: 'POST',
          headers: buildHeaders(credentials),
          body: JSON.stringify(body),
          signal: options?.abortSignal || undefined
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const err = new Error(payload?.error?.message || `Azure OpenAI request failed with status ${response.status}.`);
          err.status = response.status;
          throw err;
        }
        return payload;
      } catch (error) {
        const isAbort =
          String(error?.name || '').toLowerCase() === 'aborterror' ||
          String(error?.message || '').toLowerCase().includes('aborted');
        if (isAbort) {
          const abortErr = new Error('Azure OpenAI request aborted by caller.');
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
      modelUsed: activeDeployment,
      text: parseOutputText(payload),
      raw: payload,
      usage: buildUsage(payload),
      requestMeta: {
        providerId: PROVIDER_ID,
        providerLabel: PROVIDER_LABEL,
        requestLabel: s(options?.requestLabel) || null,
        timeoutMs,
        apiVersion,
        endpoint,
        retriedFromModel,
        omitSamplingControls,
        messageCount: normalizedRows.length,
        timestamp: new Date().toISOString()
      }
    };
  };

  try {
    return await execute(deploymentId, null, false);
  } catch (error) {
    if (isUnsupportedSamplingError(error)) {
      return await execute(deploymentId, null, true);
    }
    if (!modelWasExplicitlyForced && isModelNotFound(error)) {
      const retryDeployment = await resolveDefaultModel(null, credentials);
      if (retryDeployment && retryDeployment !== deploymentId) {
        deploymentId = retryDeployment;
        return await execute(retryDeployment, explicitModelId || null, false);
      }
    }
    throw error;
  }
}

function healthCheck(options = {}) {
  const credentials = options?.credentials || {};
  const apiKey = resolveApiKey(credentials);
  const endpoint = resolveEndpoint(credentials);
  return {
    provider: PROVIDER_ID,
    status: apiKey && endpoint ? 'ready' : 'missing_configuration',
    hasApiKey: Boolean(apiKey),
    hasEndpoint: Boolean(endpoint),
    configuredDeployment: resolveConfiguredDeploymentId() || null,
    apiVersion: resolveApiVersion(credentials),
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
