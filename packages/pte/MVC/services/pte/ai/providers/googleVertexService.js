const PROVIDER_ID = 'google-vertex';
const PROVIDER_LABEL = 'Google Vertex AI';
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_LOCATION = 'us-central1';
const MODEL_LIST_CACHE_TTL_MS = 5 * 60 * 1000;
const MODEL_LIST_PAGE_SIZE = 200;
const MODEL_LIST_MAX_PAGES = 20;

const MODEL_PREFERENCE = Object.freeze([
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-1.5-pro',
  'gemini-1.5-flash'
]);

let cachedModelRows = null;
let cachedModelRowsAt = 0;
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

function normalizeModelId(value) {
  const token = s(value).replace(/^models\//i, '');
  return token;
}

function normalizeModelResource(value) {
  const token = s(value).replace(/^\/+/, '').replace(/^v\d+\/+/i, '');
  if (!token) return '';
  if (/^projects\/[^/]+\/locations\/[^/]+\/publishers\/google\/models\/[^/]+$/i.test(token)) {
    return token;
  }
  if (/^publishers\/google\/models\/[^/]+$/i.test(token)) {
    return token;
  }
  return '';
}

function extractModelIdFromResource(value) {
  const resource = normalizeModelResource(value);
  if (!resource) return normalizeModelId(value);
  const segments = resource.split('/');
  return normalizeModelId(segments[segments.length - 1]);
}

function parseProjectLocationFromResource(modelResource = '') {
  const resource = normalizeModelResource(modelResource);
  if (!resource || !resource.startsWith('projects/')) return { project: null, location: null };
  const segments = resource.split('/');
  return {
    project: s(segments[1]) || null,
    location: s(segments[3]) || null
  };
}

function resolveApiKey(credentials = {}) {
  const explicitApiKey = s(credentials.apiKey);
  if (explicitApiKey) return explicitApiKey;
  return firstNonEmpty([
    process.env.PTE_VERTEX_API_KEY,
    process.env.IELTS_VERTEX_API_KEY,
    process.env.VERTEX_API_KEY,
    process.env.GOOGLE_API_KEY
  ]);
}

function resolveAccessToken(credentials = {}) {
  const explicitAccessToken = s(credentials.accessToken);
  if (explicitAccessToken) return explicitAccessToken;
  return firstNonEmpty([
    process.env.PTE_VERTEX_ACCESS_TOKEN,
    process.env.IELTS_VERTEX_ACCESS_TOKEN,
    process.env.VERTEX_ACCESS_TOKEN,
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN
  ]);
}

function resolveProjectId(credentials = {}) {
  return firstNonEmpty([
    credentials.project,
    process.env.PTE_VERTEX_PROJECT_ID,
    process.env.IELTS_VERTEX_PROJECT_ID,
    process.env.VERTEX_PROJECT_ID,
    process.env.GOOGLE_CLOUD_PROJECT,
    process.env.GCLOUD_PROJECT
  ]);
}

function resolveLocation(credentials = {}) {
  return firstNonEmpty([
    credentials.location,
    process.env.PTE_VERTEX_LOCATION,
    process.env.IELTS_VERTEX_LOCATION,
    process.env.VERTEX_LOCATION,
    DEFAULT_LOCATION
  ]);
}

function resolveBaseUrl(credentials = {}, location = DEFAULT_LOCATION, options = {}) {
  const expressMode = options?.expressMode === true;
  const defaultEndpoint = expressMode
    ? 'https://aiplatform.googleapis.com'
    : `https://${location || DEFAULT_LOCATION}-aiplatform.googleapis.com`;
  return firstNonEmpty([
    credentials.baseUrl,
    process.env.PTE_VERTEX_BASE_URL,
    process.env.IELTS_VERTEX_BASE_URL,
    process.env.VERTEX_BASE_URL,
    defaultEndpoint
  ]).replace(/\/+$/, '');
}

function resolveGeminiBaseUrl(credentials = {}) {
  return firstNonEmpty([
    credentials.geminiBaseUrl,
    process.env.PTE_GEMINI_BASE_URL,
    process.env.IELTS_GEMINI_BASE_URL,
    process.env.GEMINI_BASE_URL,
    'https://generativelanguage.googleapis.com'
  ]).replace(/\/+$/, '');
}

function resolveConfiguredModelId() {
  return normalizeModelId(firstNonEmpty([
    process.env.PTE_VERTEX_MODEL_ID,
    process.env.IELTS_VERTEX_MODEL_ID,
    process.env.VERTEX_MODEL_ID
  ]));
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
  const rawName = s(row.name || row.id);
  if (!rawName) return null;
  const id = extractModelIdFromResource(rawName);
  if (!id) return null;
  if (id.includes('/')) return null;

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

function dedupeModelRows(rows = []) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const id = normalizeModelId(row?.id);
    if (!id) return;
    const incoming = {
      id,
      name: s(row?.name) || id,
      provider: PROVIDER_ID,
      supportsGenerateContent: row?.supportsGenerateContent !== false,
      isDefaultCandidate: Boolean(row?.isDefaultCandidate)
    };
    const existing = map.get(id);
    if (!existing) {
      map.set(id, incoming);
      return;
    }

    existing.supportsGenerateContent = existing.supportsGenerateContent || incoming.supportsGenerateContent;
    existing.isDefaultCandidate = existing.isDefaultCandidate || incoming.isDefaultCandidate;
    if ((!existing.name || existing.name === existing.id) && incoming.name && incoming.name !== incoming.id) {
      existing.name = incoming.name;
    }
  });
  return Array.from(map.values());
}

function filterGenerationCapableRows(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const generationRows = list.filter((row) => row?.supportsGenerateContent !== false);
  return generationRows.length ? generationRows : list;
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

function attachModelListDiagnostics(rows = [], diagnostics = {}) {
  const warning = s(diagnostics?.warning);
  const status = s(diagnostics?.status || 'ok');
  const source = s(diagnostics?.source || 'api');
  const routeUsed = s(diagnostics?.routeUsed || '');
  const errorSummary = s(diagnostics?.errorSummary || '');
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    modelListStatus: status,
    modelListSource: source,
    modelListWarning: warning,
    modelListRouteUsed: routeUsed,
    modelListErrorSummary: errorSummary
  }));
}

function buildAuthContext(credentials = {}) {
  const apiKey = resolveApiKey(credentials);
  const accessToken = resolveAccessToken(credentials);
  const hasExplicitApiKey = Boolean(s(credentials.apiKey));
  const hasExplicitAccessToken = Boolean(s(credentials.accessToken));
  let authMode = '';

  // Prefer explicit record-level credentials over env fallbacks.
  if (hasExplicitApiKey) {
    authMode = 'api_key';
  } else if (hasExplicitAccessToken) {
    authMode = 'bearer';
  } else if (apiKey) {
    authMode = 'api_key';
  } else if (accessToken) {
    authMode = 'bearer';
  }

  if (!authMode) {
    const err = new Error(
      'Vertex credentials are missing. Provide an OAuth access token (credentials.accessToken / PTE_VERTEX_ACCESS_TOKEN / IELTS_VERTEX_ACCESS_TOKEN) or an API key (credentials.apiKey / PTE_VERTEX_API_KEY / IELTS_VERTEX_API_KEY).'
    );
    err.code = 'MISSING_CREDENTIALS';
    throw err;
  }

  return {
    authMode,
    accessToken,
    apiKey
  };
}

function buildRequestUrl(baseUrl, path, auth = {}) {
  const root = String(baseUrl || '').replace(/\/+$/, '');
  const cleanPath = String(path || '').replace(/^\/+/, '');
  const url = new URL(`${root}/${cleanPath}`);
  if (auth.authMode === 'api_key' && s(auth.apiKey)) {
    url.searchParams.set('key', s(auth.apiKey));
  }
  return url.toString();
}

function buildHeaders(auth = {}) {
  const headers = {
    'Content-Type': 'application/json'
  };
  if (auth.authMode === 'bearer' && s(auth.accessToken)) {
    headers.Authorization = `Bearer ${s(auth.accessToken)}`;
  } else if (auth.authMode === 'api_key' && s(auth.apiKey)) {
    headers['x-goog-api-key'] = s(auth.apiKey);
  }
  return headers;
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

function buildGenerationConfig(options = {}) {
  const base = getDefaultGenerationConfig();
  const provided = options && typeof options === 'object' ? { ...options } : {};
  delete provided.reasoningEffort;
  delete provided.reasoning_effort;
  delete provided.reasoning;
  const config = { ...base, ...provided };

  if (s(options.responseMimeType)) config.responseMimeType = s(options.responseMimeType);
  if (options.responseSchema && typeof options.responseSchema === 'object') {
    config.responseSchema = options.responseSchema;
  }

  return config;
}

function sanitizeGenerationConfigForMeta(config = {}) {
  const clone = { ...config };
  if (clone.responseSchema) clone.responseSchema = '[provided]';
  return clone;
}

function withTimeout(promise, timeoutMs, label) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const timeoutError = new Error(`Vertex request timed out after ${timeoutMs}ms${label ? ` (${label})` : ''}.`);
      timeoutError.code = 'AI_TIMEOUT';
      reject(timeoutError);
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

function normalizeRole(role) {
  const normalized = s(role).toLowerCase();
  if (normalized === 'assistant' || normalized === 'model') return 'assistant';
  if (normalized === 'system') return 'system';
  return 'user';
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
  const inlineMimeType = s(inlineData?.mimeType);
  const inlineBase64 = s(inlineData?.data);
  if (inlineMimeType && inlineBase64) {
    return {
      inlineData: {
        mimeType: inlineMimeType,
        data: inlineBase64
      }
    };
  }

  const fileData = isPlainObject(part.fileData) ? part.fileData : null;
  const fileMimeType = s(fileData?.mimeType);
  const fileUri = s(fileData?.fileUri);
  if (fileMimeType && fileUri) {
    return {
      fileData: {
        mimeType: fileMimeType,
        fileUri
      }
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
      return text ? [{ text }] : [];
    } catch (_) {
      return [];
    }
  }
  const fallback = s(content);
  return fallback ? [{ text: fallback }] : [];
}

function collectTextFromParts(parts = []) {
  return (Array.isArray(parts) ? parts : [])
    .map((part) => s(part?.text))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function normalizeMessages(messages = []) {
  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) throw new Error('sendMessage requires a non-empty messages array.');

  const normalized = list.map((item) => ({
    role: normalizeRole(item?.role),
    parts: normalizeMessageParts(item?.content)
  })).filter((item) => item.parts.length > 0);
  if (!normalized.length) throw new Error('No usable message content was provided.');

  const systemInstruction = normalized
    .filter((item) => item.role === 'system')
    .map((item) => collectTextFromParts(item.parts))
    .filter(Boolean)
    .join('\n\n')
    .trim();

  const dialogRows = normalized.filter((item) => item.role !== 'system');
  if (!dialogRows.length) throw new Error('At least one user/assistant message is required after system messages.');

  const last = dialogRows[dialogRows.length - 1];
  if (last.role !== 'user') {
    throw new Error('The last non-system message must have role="user".');
  }

  return {
    systemInstruction: systemInstruction || undefined,
    dialogRows,
    normalizedMessages: normalized
  };
}

function toVertexSystemInstruction(content) {
  const text = s(content);
  if (!text) return undefined;
  return { parts: [{ text }] };
}

function toVertexContents(dialogRows = []) {
  return (Array.isArray(dialogRows) ? dialogRows : []).map((item) => ({
    role: item.role === 'assistant' ? 'model' : 'user',
    parts: item.parts
  }));
}

function extractUsage(payload = {}) {
  const usage = payload?.usageMetadata || null;
  if (!usage || typeof usage !== 'object') return null;
  return {
    promptTokenCount: usage.promptTokenCount ?? null,
    candidatesTokenCount: usage.candidatesTokenCount ?? null,
    totalTokenCount: usage.totalTokenCount ?? null,
    cachedContentTokenCount: usage.cachedContentTokenCount ?? null
  };
}

function parseResponseText(payload = {}) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const first = candidates[0] || {};
  const parts = Array.isArray(first?.content?.parts) ? first.content.parts : [];
  return parts
    .map((part) => s(part?.text))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function parseErrorPayload(payload = {}, fallbackMessage = '') {
  const message = s(payload?.error?.message || payload?.message || fallbackMessage);
  if (message) return message;
  return 'Vertex request failed.';
}

function isModelNotFoundError(error) {
  const text = s(error?.message).toLowerCase();
  return text.includes('404') || (text.includes('model') && text.includes('not found'));
}

function buildModelResource(modelId = '', credentials = {}) {
  const explicitResource = normalizeModelResource(modelId);
  if (explicitResource) {
    const parsed = parseProjectLocationFromResource(explicitResource);
    return {
      modelResource: explicitResource,
      project: parsed.project,
      location: parsed.location,
      routeMode: explicitResource.startsWith('projects/') ? 'project' : 'express'
    };
  }

  const shortModelId = normalizeModelId(modelId);
  if (!shortModelId) {
    const err = new Error('Vertex model ID is missing.');
    err.code = 'MISSING_MODEL';
    throw err;
  }

  const project = resolveProjectId(credentials);
  const location = resolveLocation(credentials);
  if (!project) {
    return {
      modelResource: `publishers/google/models/${shortModelId}`,
      project: null,
      location: null,
      routeMode: 'express'
    };
  }

  return {
    modelResource: `projects/${project}/locations/${location}/publishers/google/models/${shortModelId}`,
    project,
    location,
    routeMode: 'project'
  };
}

function normalizeModelRowsFromPayload(payload = {}) {
  const candidates = Array.isArray(payload?.models)
    ? payload.models
    : (Array.isArray(payload?.publisherModels) ? payload.publisherModels : []);
  return candidates.map(normalizeModelRow).filter(Boolean);
}

async function fetchPagedModelRows({
  baseUrl,
  path,
  auth,
  query = {},
  pageSize = MODEL_LIST_PAGE_SIZE,
  maxPages = MODEL_LIST_MAX_PAGES
} = {}) {
  const allRows = [];
  let pageToken = '';

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const url = new URL(buildRequestUrl(baseUrl, path, auth));
    Object.entries(query || {}).forEach(([key, value]) => {
      const token = s(value);
      if (token) url.searchParams.set(key, token);
    });
    if (Number.isFinite(pageSize) && pageSize > 0) {
      url.searchParams.set('pageSize', String(Math.floor(pageSize)));
    }
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: buildHeaders(auth)
    });
    if (!response.ok) throw new Error(`Model listing failed with status ${response.status}.`);
    const payload = await response.json().catch(() => ({}));
    allRows.push(...normalizeModelRowsFromPayload(payload));

    const nextPageToken = s(payload?.nextPageToken || payload?.next_page_token);
    if (!nextPageToken) break;
    if (nextPageToken === pageToken) break;
    pageToken = nextPageToken;
  }

  return allRows;
}

async function fetchModelRows(credentials = {}, options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  const useSharedCache = !s(credentials.apiKey) && !s(credentials.accessToken) && !s(credentials.project);
  const listErrors = [];
  const successfulRoutes = new Set();

  if (useSharedCache) {
    const hasFreshCache = cachedModelRows && (now() - cachedModelRowsAt) < MODEL_LIST_CACHE_TTL_MS;
    if (!forceRefresh && hasFreshCache) return cachedModelRows.slice();
  }

  let auth = null;
  try {
    auth = buildAuthContext(credentials);
  } catch (_) {
    auth = null;
  }

  const project = resolveProjectId(credentials);
  const location = resolveLocation(credentials);
  const mergedRows = [];

  // Project-scoped Vertex listing typically requires bearer/OAuth auth.
  if (auth && project && auth.authMode === 'bearer') {
    const baseUrl = resolveBaseUrl(credentials, location, { expressMode: false });
    const projectRoutes = [
      {
        path: `v1/projects/${project}/locations/${location}/publishers/google/models`,
        query: { listAllVersions: 'true' }
      },
      {
        // Matches Vertex ModelServiceClient.listModels(parent=projects/{project}/locations/{location})
        path: `v1/projects/${project}/locations/${location}/models`,
        query: {}
      }
    ];

    for (const route of projectRoutes) {
      try {
        const projectRows = await fetchPagedModelRows({
          baseUrl,
          path: route.path,
          auth,
          query: route.query
        });
        mergedRows.push(...projectRows);
        if (projectRows.length) {
          successfulRoutes.add(route.path);
        }
      } catch (error) {
        listErrors.push(`project-list failed (${route.path}): ${s(error?.message) || 'unknown error'}`);
      }
    }
  }

  const tryExpressListing = async () => {
    if (!auth) return false;
    const baseUrl = resolveBaseUrl(credentials, null, { expressMode: true });
    const expressRoutes = [
      { path: 'v1beta1/publishers/google/models', query: { listAllVersions: 'true' } },
      { path: 'v1/publishers/google/models', query: { listAllVersions: 'true' } },
      { path: 'v1/publishers/google/models', query: {} }
    ];

    for (const route of expressRoutes) {
      try {
        const expressRows = await fetchPagedModelRows({
          baseUrl,
          path: route.path,
          auth,
          query: route.query
        });
        mergedRows.push(...expressRows);
        if (expressRows.length) {
          successfulRoutes.add(route.path);
          break;
        }
      } catch (error) {
        listErrors.push(`express-list failed (${route.path}): ${s(error?.message) || 'unknown error'}`);
      }
    }
    return false;
  };

  const tryGeminiListing = async () => {
    if (!auth || auth.authMode !== 'api_key') return false;
    const geminiBaseUrl = resolveGeminiBaseUrl(credentials);
    const geminiRoutes = [
      { path: 'v1beta/models', query: {} },
      { path: 'v1/models', query: {} }
    ];

    for (const route of geminiRoutes) {
      try {
        const geminiRows = await fetchPagedModelRows({
          baseUrl: geminiBaseUrl,
          path: route.path,
          auth,
          query: route.query
        });
        mergedRows.push(...geminiRows);
        if (geminiRows.length) {
          successfulRoutes.add(`${geminiBaseUrl.replace(/^https?:\/\//i, '')}/${route.path}`);
          return true;
        }
      } catch (error) {
        listErrors.push(`gemini-list failed (${route.path}): ${s(error?.message) || 'unknown error'}`);
      }
    }
    return false;
  };

  // API-key flows are usually provisioned for Gemini listing endpoints.
  // Try Gemini first to avoid noisy expected 401/404 failures on legacy express routes.
  if (auth && auth.authMode === 'api_key') {
    const geminiFound = await tryGeminiListing();
    if (!geminiFound) {
      await tryExpressListing();
    }
  } else {
    await tryExpressListing();
  }

  const normalizedMergedRows = sortModelsByPreference(
    filterGenerationCapableRows(
      dedupeModelRows(mergedRows)
    )
  );
  if (normalizedMergedRows.length) {
    const routeUsed = Array.from(successfulRoutes).join(', ');
    const errorSummary = listErrors.join(' | ');
    const warning = listErrors.length
      ? `Vertex model listing partially failed and recovered with available endpoints. ${errorSummary}`
      : '';
    const diagnosedRows = attachModelListDiagnostics(normalizedMergedRows, {
      status: listErrors.length ? 'partial' : 'ok',
      source: 'api',
      warning,
      routeUsed,
      errorSummary
    });
    if (useSharedCache) {
      cachedModelRows = diagnosedRows;
      cachedModelRowsAt = now();
    }
    return diagnosedRows.slice();
  }

  const fallback = buildFallbackModelRows();
  const errorSummary = listErrors.join(' | ');
  const warning = listErrors.length
    ? `Vertex model listing fallback list is in use. ${errorSummary}`
    : 'Vertex model listing fallback list is in use because no models were returned.';
  if (listErrors.length) {
    console.warn(`[Vertex Models] Falling back to default model list. ${listErrors.join(' | ')}`);
  }
  const diagnosedFallback = attachModelListDiagnostics(fallback, {
    status: 'fallback',
    source: 'fallback',
    warning,
    routeUsed: '',
    errorSummary
  });
  if (useSharedCache) {
    cachedModelRows = diagnosedFallback;
    cachedModelRowsAt = now();
  }
  return diagnosedFallback.slice();
}

async function listAvailableModels(credentials = {}) {
  return await fetchModelRows(credentials, { forceRefresh: false });
}

async function resolveDefaultModelInternal(preferredModelId = null, credentials = {}, options = {}) {
  const explicit = normalizeModelId(preferredModelId);
  if (explicit) return explicit;

  const forceRefresh = Boolean(options.forceRefresh);
  const ignoreConfigured = Boolean(options.ignoreConfigured);
  const useSharedCache = !s(credentials.apiKey) && !s(credentials.accessToken) && !s(credentials.project);
  if (useSharedCache && !forceRefresh && cachedDefaultModelId) return cachedDefaultModelId;

  const configuredModelId = ignoreConfigured ? '' : resolveConfiguredModelId();
  const models = await fetchModelRows(credentials, { forceRefresh });
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

  if (useSharedCache) cachedDefaultModelId = resolved;
  return resolved;
}

async function resolveDefaultModel(preferredModelId = null, credentials = {}) {
  return await resolveDefaultModelInternal(preferredModelId, credentials, { forceRefresh: false, ignoreConfigured: false });
}

function buildRequestMeta({
  requestLabel,
  timeoutMs,
  generationConfig,
  normalizedPayload,
  retriedFromModel,
  authMode,
  project,
  location,
  routeMode
}) {
  return {
    providerId: PROVIDER_ID,
    providerLabel: PROVIDER_LABEL,
    requestLabel: s(requestLabel) || null,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : null,
    messageCount: Array.isArray(normalizedPayload?.normalizedMessages) ? normalizedPayload.normalizedMessages.length : 0,
    hasSystemInstruction: Boolean(normalizedPayload?.systemInstruction),
    generationConfig: sanitizeGenerationConfigForMeta(generationConfig),
    retriedFromModel: retriedFromModel || null,
    authMode: s(authMode) || null,
    project: s(project) || null,
    location: s(location) || null,
    routeMode: s(routeMode) || null,
    timestamp: new Date().toISOString()
  };
}

async function sendMessage(messages, options = {}) {
  const credentials = options?.credentials || {};
  const explicitModelId = normalizeModelId(options?.modelId);
  const modelWasExplicitlyForced = Boolean(explicitModelId);
  const generationConfig = buildGenerationConfig({
    ...(options?.generationConfig || {}),
    responseMimeType: options?.responseMimeType,
    responseSchema: options?.responseSchema
  });
  const timeoutMs = Number(options?.timeoutMs || DEFAULT_TIMEOUT_MS);
  const normalizedPayload = normalizeMessages(messages);

  let modelToUse = await resolveDefaultModelInternal(explicitModelId, credentials, { forceRefresh: false, ignoreConfigured: false });

  const executeRequest = async (activeModelId, retriedFromModel = null) => {
    const auth = buildAuthContext(credentials);
    const {
      modelResource,
      project,
      location,
      routeMode
    } = buildModelResource(activeModelId, credentials);
    const resolvedLocation = routeMode === 'project'
      ? (location || resolveLocation(credentials))
      : null;
    const baseUrl = resolveBaseUrl(credentials, resolvedLocation, { expressMode: routeMode !== 'project' });
    const requestPath = `v1/${modelResource}:generateContent`;
    const requestUrl = buildRequestUrl(baseUrl, requestPath, auth);
    const requestBody = {
      contents: toVertexContents(normalizedPayload.dialogRows),
      generationConfig
    };
    if (normalizedPayload.systemInstruction) {
      requestBody.systemInstruction = toVertexSystemInstruction(normalizedPayload.systemInstruction);
    }

    const run = async () => {
      try {
        const response = await fetch(requestUrl, {
          method: 'POST',
          headers: buildHeaders(auth),
          body: JSON.stringify(requestBody),
          signal: options?.abortSignal || undefined
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(parseErrorPayload(payload, `Vertex request failed with status ${response.status}.`));
          error.status = response.status;
          throw error;
        }
        return payload;
      } catch (error) {
        const isAbort =
          String(error?.name || '').toLowerCase() === 'aborterror' ||
          String(error?.message || '').toLowerCase().includes('aborted');
        if (isAbort) {
          const abortErr = new Error('Vertex request aborted by caller.');
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
      modelUsed: extractModelIdFromResource(activeModelId),
      text: parseResponseText(payload),
      raw: payload,
      usage: extractUsage(payload),
      requestMeta: buildRequestMeta({
        requestLabel: options?.requestLabel,
        timeoutMs,
        generationConfig,
        normalizedPayload,
        retriedFromModel,
        authMode: auth.authMode,
        project,
        location: resolvedLocation,
        routeMode
      })
    };
  };

  try {
    return await executeRequest(modelToUse, null);
  } catch (error) {
    if (isModelNotFoundError(error)) {
      const retriedModel = await resolveDefaultModelInternal(null, credentials, {
        forceRefresh: true,
        ignoreConfigured: true
      });
      if (retriedModel && retriedModel !== modelToUse) {
        modelToUse = retriedModel;
        return await executeRequest(retriedModel, explicitModelId || modelToUse || null);
      }

      if (modelWasExplicitlyForced) {
        const explicitError = new Error(`Vertex model "${explicitModelId}" was not found and no alternative model could be resolved. Choose a valid model ID or leave modelId empty to auto-resolve.`);
        explicitError.code = 'INVALID_MODEL';
        throw explicitError;
      }

      const invalidError = new Error(`Vertex default model "${modelToUse}" is unavailable and no alternative model could be resolved.`);
      invalidError.code = 'INVALID_MODEL';
      throw invalidError;
    }
    throw error;
  }
}

function healthCheck(options = {}) {
  const credentials = options?.credentials || {};
  const apiKey = resolveApiKey(credentials);
  const accessToken = resolveAccessToken(credentials);
  const project = resolveProjectId(credentials);
  const location = resolveLocation(credentials);
  const hasProjectScopedAuth = Boolean(project && (apiKey || accessToken));
  const hasExpressAuth = Boolean(apiKey);

  return {
    provider: PROVIDER_ID,
    status: (hasProjectScopedAuth || hasExpressAuth) ? 'ready' : 'missing_configuration',
    hasApiKey: Boolean(apiKey),
    hasAccessToken: Boolean(accessToken),
    hasProject: Boolean(project),
    supportsExpressMode: hasExpressAuth,
    supportsProjectScopedMode: hasProjectScopedAuth,
    location: location || null,
    configuredModelId: resolveConfiguredModelId() || null,
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
