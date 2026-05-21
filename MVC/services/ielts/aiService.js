// MVC/services/ielts/aiService.js
const { toPublicId } = require("../../utils/idAdapter");
const { decrypt } = require("../../utils/encyptors");
const ieltsService = require("./ieltsDataService");
const apiProviderModel = require("../../models/ielts/apiProviderModel");
const aiProviderService = require("./ai/aiProviderService");
const { runByRepositoryBackend } = require("../../repositories/backend/repositoryBackendSelector");
const { getMongoCollection } = require("../../infrastructure/mongo/mongoConnection");
const {
  assertCreateOrgContextOrThrow: assertCreateOrgContextOrThrowShared
} = require("../../utils/orgContextUtils");

const DEFAULT_TIMEOUT_MS = 60000;
const LEGACY_FALLBACK_MODEL = "gemini-2.5-flash";
const GEMINI_MODEL_ID = String(process.env.GEMINI_MODEL_ID || "").trim();

function s(value) {
  return String(value ?? "").trim();
}

function normalizeModelId(value) {
  return s(value).replace(/^models\//i, "");
}

function normalizeRole(value) {
  const role = s(value).toLowerCase();
  if (role === "assistant" || role === "model") return "assistant";
  if (role === "system") return "system";
  return "user";
}

function normalizeMessageContent(content) {
  if (content === undefined || content === null) return "";
  if (typeof content === "string") return content.trim();
  if (typeof content === "number" || typeof content === "boolean") return String(content);
  try {
    return JSON.stringify(content, null, 2);
  } catch (_) {
    return String(content);
  }
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("sendMessage requires a non-empty messages array.");
  }

  const normalized = messages.map((m, index) => {
    const role = normalizeRole(m?.role);
    const content = normalizeMessageContent(m?.content);
    if (!content) throw new Error(`Message at index ${index} has empty content.`);
    return { role, content };
  });

  const nonSystem = normalized.filter((m) => m.role !== "system");
  if (!nonSystem.length) {
    throw new Error("sendMessage requires at least one non-system message.");
  }
  if (nonSystem[nonSystem.length - 1].role !== "user") {
    throw new Error("The last non-system message must have role='user'.");
  }

  return normalized;
}

function validateGenerationConfig(config = {}) {
  const out = { ...config };

  if (out.temperature !== undefined) {
    const n = Number(out.temperature);
    if (!Number.isFinite(n) || n < 0 || n > 2) throw new Error("Invalid generationConfig.temperature (expected 0..2).");
    out.temperature = n;
  }
  if (out.topP !== undefined) {
    const n = Number(out.topP);
    if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error("Invalid generationConfig.topP (expected 0..1).");
    out.topP = n;
  }
  if (out.topK !== undefined) {
    const n = Number(out.topK);
    if (!Number.isFinite(n) || n < 1) throw new Error("Invalid generationConfig.topK (expected >= 1).");
    out.topK = Math.floor(n);
  }
  if (out.candidateCount !== undefined) {
    const n = Number(out.candidateCount);
    if (!Number.isFinite(n) || n < 1) throw new Error("Invalid generationConfig.candidateCount (expected >= 1).");
    out.candidateCount = Math.floor(n);
  }
  if (out.maxOutputTokens !== undefined) {
    const n = Number(out.maxOutputTokens);
    if (!Number.isFinite(n) || n < 1) throw new Error("Invalid generationConfig.maxOutputTokens (expected >= 1).");
    out.maxOutputTokens = Math.floor(n);
  }

  return out;
}

function getDefaultGenerationConfig() {
  return {
    maxOutputTokens: 8192,
    temperature: 0,
    topP: 1,
    topK: 1,
    candidateCount: 1
  };
}

function getRequestingUser(context = {}) {
  return context?.requestingUser || context?.user || null;
}

function normalizeProviderId(value) {
  return s(value).toLowerCase();
}

function buildProviderCredentialsFromRecord(record = {}, apiKey = "") {
  return {
    apiKey: s(apiKey),
    endpoint: s(record?.endpoint || ""),
    baseUrl: s(record?.baseUrl || ""),
    apiVersion: s(record?.apiVersion || ""),
    organization: s(record?.organization || ""),
    project: s(record?.project || ""),
    location: s(record?.location || "")
  };
}

function mergeCredentials(primary = {}, overrides = {}) {
  return {
    apiKey: s(overrides?.apiKey || primary?.apiKey || ""),
    endpoint: s(overrides?.endpoint || primary?.endpoint || ""),
    baseUrl: s(overrides?.baseUrl || primary?.baseUrl || ""),
    apiVersion: s(overrides?.apiVersion || primary?.apiVersion || ""),
    organization: s(overrides?.organization || primary?.organization || ""),
    project: s(overrides?.project || primary?.project || ""),
    location: s(overrides?.location || primary?.location || "")
  };
}

async function loadApiKeyForProviderRecord(providerId) {
  const targetId = s(providerId);
  if (!targetId) return "";

  try {
    const value = await runByRepositoryBackend({}, {
      json: async () => apiProviderModel.getDecryptedApiKeyById(targetId),
      mongo: async () => {
        const collection = getMongoCollection("ieltsApiProviders");
        const row = await collection.findOne({ id: targetId });
        if (!row?.apiKeyEncrypted) return "";
        return decrypt(row.apiKeyEncrypted) || "";
      }
    }, "ielts.ai.loadApiKeyForProviderRecord");
    return s(value);
  } catch (_) {
    return "";
  }
}

function sortProvidersForSelection(rows = []) {
  return rows.slice().sort((a, b) => {
    const aDefault = a?.isDefault ? 1 : 0;
    const bDefault = b?.isDefault ? 1 : 0;
    if (aDefault !== bDefault) return bDefault - aDefault;

    const aUpdated = Date.parse(a?.updatedAt || a?.createdAt || 0) || 0;
    const bUpdated = Date.parse(b?.updatedAt || b?.createdAt || 0) || 0;
    return bUpdated - aUpdated;
  });
}

function isSameId(a, b) {
  return toPublicId(a) === toPublicId(b);
}

async function resolveUserApiProvider(context = {}) {
  const requestingUser = getRequestingUser(context);
  const userId = toPublicId(requestingUser?.id);
  const activeOrgId = toPublicId(requestingUser?.activeOrgId);
  if (!requestingUser || !userId || !activeOrgId) return null;

  let rows = [];
  try {
    rows = await ieltsService.fetchData("apiProviders", {}, requestingUser);
  } catch (_) {
    rows = [];
  }

  const explicitApiProviderId = toPublicId(context?.apiProviderId);
  const explicitProviderId = normalizeProviderId(context?.providerId);

  let candidates = Array.isArray(rows) ? rows.filter((row) => row && row.isActive !== false) : [];
  if (explicitApiProviderId) {
    candidates = candidates.filter((row) => isSameId(row?.id, explicitApiProviderId));
  }
  if (explicitProviderId) {
    candidates = candidates.filter((row) => normalizeProviderId(row?.providerId) === explicitProviderId);
  }

  if (!candidates.length) return null;

  const picked = sortProvidersForSelection(candidates)[0];
  if (!picked) return null;

  const apiKey = await loadApiKeyForProviderRecord(picked.id);
  return {
    record: picked,
    credentials: buildProviderCredentialsFromRecord(picked, apiKey)
  };
}

function extractSendConfig(config) {
  const defaults = {
    generationConfig: getDefaultGenerationConfig(),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    requestLabel: null,
    responseMimeType: null,
    responseSchema: null,
    providerId: "",
    apiProviderId: "",
    requestingUser: null,
    abortSignal: null,
    credentials: {}
  };

  if (typeof config === "number") {
    return {
      ...defaults,
      generationConfig: validateGenerationConfig({
        ...defaults.generationConfig,
        temperature: config
      })
    };
  }

  if (!config || typeof config !== "object") {
    return defaults;
  }

  const raw = { ...config };
  const nestedGeneration = raw.generationConfig && typeof raw.generationConfig === "object"
    ? { ...raw.generationConfig }
    : {};

  const passthroughKeys = new Set([
    "timeoutMs",
    "requestLabel",
    "responseMimeType",
    "responseSchema",
    "providerId",
    "apiProviderId",
    "requestingUser",
    "user",
    "abortSignal",
    "credentials",
    "generationConfig"
  ]);

  const directGeneration = {};
  for (const [key, value] of Object.entries(raw)) {
    if (passthroughKeys.has(key)) continue;
    directGeneration[key] = value;
  }

  const generationConfig = validateGenerationConfig({
    ...defaults.generationConfig,
    ...directGeneration,
    ...nestedGeneration
  });

  const timeoutMsRaw = Number(raw.timeoutMs);
  const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
    ? timeoutMsRaw
    : DEFAULT_TIMEOUT_MS;

  return {
    generationConfig,
    timeoutMs,
    requestLabel: s(raw.requestLabel) || null,
    responseMimeType: s(raw.responseMimeType) || null,
    responseSchema: raw.responseSchema && typeof raw.responseSchema === "object"
      ? raw.responseSchema
      : null,
    providerId: normalizeProviderId(raw.providerId),
    apiProviderId: toPublicId(raw.apiProviderId) || "",
    requestingUser: getRequestingUser(raw),
    abortSignal: raw.abortSignal || null,
    credentials: raw.credentials && typeof raw.credentials === "object" ? raw.credentials : {}
  };
}

async function resolveExecutionContext({
  modelId = null,
  providerId = "",
  apiProviderId = "",
  requestingUser = null,
  credentials = {}
} = {}) {
  const explicitModelId = normalizeModelId(modelId);
  const explicitProviderId = normalizeProviderId(providerId);
  const explicitApiProviderId = toPublicId(apiProviderId) || "";

  let providerRecord = null;
  let resolvedCredentials = {};
  let resolvedProviderId = explicitProviderId || aiProviderService.getDefaultProviderId();
  let resolvedModelId = explicitModelId;
  let resolutionSource = explicitProviderId ? "explicit-provider" : "default-provider";

  const userContext = await resolveUserApiProvider({
    requestingUser,
    providerId: explicitProviderId,
    apiProviderId: explicitApiProviderId
  });

  if (userContext?.record) {
    providerRecord = userContext.record;
    resolvedProviderId = normalizeProviderId(providerRecord.providerId) || resolvedProviderId;
    resolvedCredentials = userContext.credentials || {};
    resolutionSource = explicitApiProviderId
      ? "explicit-api-provider"
      : (explicitProviderId ? "user-provider-match" : "user-default-provider");

    if (!resolvedModelId) {
      resolvedModelId = normalizeModelId(providerRecord.modelId);
    }
  }

  resolvedCredentials = mergeCredentials(resolvedCredentials, credentials || {});

  if (providerRecord && !s(resolvedCredentials.apiKey)) {
    throw new Error(
      `Selected API provider "${s(providerRecord.name || providerRecord.id)}" has no usable API key. Update the key and try again.`
    );
  }

  const resolvedModel = await aiProviderService.resolveModel({
    providerId: resolvedProviderId,
    modelId: resolvedModelId || null,
    credentials: resolvedCredentials
  });

  return {
    providerId: resolvedModel.providerId,
    modelId: resolvedModel.modelId,
    modelLabel: resolvedModel.modelLabel,
    providerRecordId: toPublicId(providerRecord?.id) || null,
    providerRecordName: s(providerRecord?.name) || null,
    resolutionSource,
    credentials: resolvedCredentials
  };
}

function normalizeUsageSnapshot(usage = {}) {
  const snapshot = usage && typeof usage === "object" ? usage : {};
  const normalize = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  return {
    promptTokenCount: normalize(snapshot.promptTokenCount),
    candidatesTokenCount: normalize(snapshot.candidatesTokenCount),
    totalTokenCount: normalize(snapshot.totalTokenCount),
    cachedContentTokenCount: normalize(snapshot.cachedContentTokenCount)
  };
}

function buildAiTokenUsagePayload({
  cfg,
  resolved,
  normalizedMessages,
  responseText,
  usage,
  requestMeta,
  status = "success",
  errorMessage = null
} = {}) {
  const usageSnapshot = normalizeUsageSnapshot(usage || {});
  return {
    userId: toPublicId(cfg?.requestingUser?.id),
    providerId: normalizeProviderId(requestMeta?.providerId || resolved?.providerId),
    providerRecordId: toPublicId(resolved?.providerRecordId) || null,
    providerRecordName: s(resolved?.providerRecordName) || null,
    modelUsed: normalizeModelId(requestMeta?.modelUsed || resolved?.modelId) || null,
    requestLabel: s(requestMeta?.requestLabel) || null,
    messageCount: Number(normalizedMessages?.length || 0),
    hasSystemInstruction: Array.isArray(normalizedMessages)
      ? normalizedMessages.some((row) => row.role === "system")
      : false,
    status: String(status || "success").toLowerCase() === "failed" ? "failed" : "success",
    errorMessage: s(errorMessage) || null,
    usage: usageSnapshot,
    promptTokenCount: usageSnapshot.promptTokenCount,
    candidatesTokenCount: usageSnapshot.candidatesTokenCount,
    totalTokenCount: usageSnapshot.totalTokenCount,
    cachedContentTokenCount: usageSnapshot.cachedContentTokenCount,
    requestMeta: {
      ...requestMeta,
      responseChars: Number(s(responseText).length || 0)
    },
    consumedAt: new Date().toISOString(),
    billingStatus: "unbilled",
    billingReference: null,
    billingNotes: ""
  };
}

async function persistAiTokenUsageRecord(payload = {}, requestingUser = null) {
  if (!requestingUser) return null;
  const userId = toPublicId(requestingUser?.id);
  const activeOrgId = toPublicId(requestingUser?.activeOrgId);
  if (!userId || !activeOrgId) return null;
  return await ieltsService.addData("aiTokenUsages", payload, requestingUser);
}

async function getProviderLabelMap() {
  try {
    const rows = await aiProviderService.getAvailableProviders();
    const map = new Map();
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const id = normalizeProviderId(row?.id);
      if (!id) continue;
      map.set(id, s(row?.label) || id);
    }
    return map;
  } catch (_) {
    return new Map();
  }
}

function normalizeDiscoveredModelRows(rows = [], {
  providerId = "",
  providerLabel = "",
  providerRecordId = null,
  providerRecordName = null,
  providerIsDefault = false
} = {}) {
  const normalizedProviderId = normalizeProviderId(providerId);
  const normalizedProviderLabel = s(providerLabel) || normalizedProviderId;
  const normalizedProviderRecordId = toPublicId(providerRecordId) || null;
  const normalizedProviderRecordName = s(providerRecordName) || null;
  const providerChoiceId = normalizedProviderRecordId || normalizedProviderId;
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: row.id,
    name: row.name || row.id,
    provider: normalizeProviderId(row.provider || normalizedProviderId),
    providerLabel: normalizedProviderLabel,
    providerRecordId: normalizedProviderRecordId,
    providerRecordName: normalizedProviderRecordName,
    providerChoiceId,
    providerDisplayLabel: normalizedProviderRecordName || normalizedProviderLabel,
    providerIsDefault: providerIsDefault === true,
    isDefaultCandidate: row.isDefaultCandidate === true,
    modelListStatus: s(row?.modelListStatus),
    modelListSource: s(row?.modelListSource),
    modelListWarning: s(row?.modelListWarning),
    modelListRouteUsed: s(row?.modelListRouteUsed),
    modelListErrorSummary: s(row?.modelListErrorSummary)
  }));
}

async function discoverModelsAcrossActiveProviders(context = {}) {
  const requestingUser = getRequestingUser(context);
  if (!requestingUser) return [];

  let rows = [];
  try {
    rows = await ieltsService.fetchData("apiProviders", {}, requestingUser);
  } catch (_) {
    rows = [];
  }

  const activeRows = sortProvidersForSelection(
    (Array.isArray(rows) ? rows : []).filter((row) => row && row.isActive !== false)
  );
  if (!activeRows.length) return [];

  const providerLabelMap = await getProviderLabelMap();
  const discovered = [];
  for (const providerRecord of activeRows) {
    const providerId = normalizeProviderId(providerRecord?.providerId);
    if (!providerId) continue;
    const apiKey = await loadApiKeyForProviderRecord(providerRecord?.id);
    const credentials = buildProviderCredentialsFromRecord(providerRecord, apiKey);

    try {
      const models = await aiProviderService.listAvailableModels(providerId, credentials);
      discovered.push(
        ...normalizeDiscoveredModelRows(models, {
          providerId,
          providerLabel: providerLabelMap.get(providerId) || providerId,
          providerRecordId: providerRecord?.id,
          providerRecordName: providerRecord?.name,
          providerIsDefault: providerRecord?.isDefault === true
        })
      );
    } catch (error) {
      console.warn(`[AI Service] discoverAvailableModels skipped provider "${providerId}":`, error.message);
    }
  }

  return discovered.sort((a, b) => {
    const aDefault = a?.providerIsDefault ? 1 : 0;
    const bDefault = b?.providerIsDefault ? 1 : 0;
    if (aDefault !== bDefault) return bDefault - aDefault;
    const aProvider = s(a?.providerDisplayLabel || a?.providerRecordName || a?.providerLabel || a?.provider);
    const bProvider = s(b?.providerDisplayLabel || b?.providerRecordName || b?.providerLabel || b?.provider);
    if (aProvider !== bProvider) return aProvider.localeCompare(bProvider);
    return s(a?.name || a?.id).localeCompare(s(b?.name || b?.id));
  });
}

const aiService = {
  activeModelId: null,
  activeProviderId: null,

  getActiveModelId: function () {
    return this.activeModelId;
  },

  getDefaultGenerationConfig,

  discoverBestModel: async function (context = {}) {
    const explicitModelId = normalizeModelId(context?.modelId || null);
    const resolved = await resolveExecutionContext({
      modelId: explicitModelId || null,
      providerId: normalizeProviderId(context?.providerId),
      apiProviderId: context?.apiProviderId,
      requestingUser: getRequestingUser(context),
      credentials: context?.credentials || {}
    });
    this.activeModelId = resolved.modelId;
    this.activeProviderId = resolved.providerId;
    return resolved.modelId || normalizeModelId(GEMINI_MODEL_ID) || LEGACY_FALLBACK_MODEL;
  },

  discoverAvailableModels: async function (context = {}) {
    const includeAllActiveProviders = context?.includeAllActiveProviders === true;
    if (includeAllActiveProviders) {
      const discovered = await discoverModelsAcrossActiveProviders(context);
      if (discovered.length) return discovered;
    }

    const providerLabelMap = await getProviderLabelMap();
    try {
      const resolved = await resolveExecutionContext({
        modelId: null,
        providerId: normalizeProviderId(context?.providerId),
        apiProviderId: context?.apiProviderId,
        requestingUser: getRequestingUser(context),
        credentials: context?.credentials || {}
      });

      const rows = await aiProviderService.listAvailableModels(
        resolved.providerId,
        resolved.credentials
      );

      if (Array.isArray(rows) && rows.length) {
        return normalizeDiscoveredModelRows(rows, {
          providerId: resolved.providerId,
          providerLabel: providerLabelMap.get(resolved.providerId) || resolved.providerId,
          providerRecordId: resolved.providerRecordId,
          providerRecordName: resolved.providerRecordName,
          providerIsDefault: resolved.resolutionSource === "user-default-provider"
            || resolved.resolutionSource === "explicit-api-provider"
        });
      }
    } catch (error) {
      console.warn("[AI Service] discoverAvailableModels fallback:", error.message);
    }

    const fallbackId = normalizeModelId(GEMINI_MODEL_ID) || LEGACY_FALLBACK_MODEL;
    return [{
      id: fallbackId,
      name: fallbackId,
      provider: "google-gemini",
      providerLabel: "Google Gemini",
      providerDisplayLabel: "Google Gemini",
      providerRecordId: null,
      providerRecordName: null,
      providerChoiceId: "google-gemini",
      providerIsDefault: true,
      isDefaultCandidate: true
    }];
  },

  sendMessage: async function (messages, modelId = null, config = 0) {
    const startTs = Date.now();
    const normalizedMessages = validateMessages(messages);
    const cfg = extractSendConfig(config);
    if (cfg.requestingUser) {
      await assertCreateOrgContextOrThrowShared(cfg.requestingUser, { scopeLabel: "IELTS scoring records" });
    }

    const resolved = await resolveExecutionContext({
      modelId,
      providerId: cfg.providerId,
      apiProviderId: cfg.apiProviderId,
      requestingUser: cfg.requestingUser,
      credentials: cfg.credentials
    });

    let response = null;
    try {
      response = await aiProviderService.sendPrompt({
        messages: normalizedMessages,
        providerId: resolved.providerId,
        modelId: resolved.modelId,
        generationConfig: cfg.generationConfig,
        responseMimeType: cfg.responseMimeType || undefined,
        responseSchema: cfg.responseSchema || undefined,
        requestLabel: cfg.requestLabel || undefined,
        timeoutMs: cfg.timeoutMs,
        credentials: resolved.credentials,
        abortSignal: cfg.abortSignal || null
      });
    } catch (error) {
      const elapsedMs = Date.now() - startTs;
      const failedMeta = {
        elapsedMs,
        timeoutMs: cfg.timeoutMs,
        requestLabel: cfg.requestLabel || null,
        modelRequested: normalizeModelId(modelId) || null,
        modelUsed: normalizeModelId(resolved.modelId) || null,
        providerId: normalizeProviderId(resolved.providerId),
        providerRecordId: resolved.providerRecordId,
        providerRecordName: resolved.providerRecordName,
        resolutionSource: resolved.resolutionSource,
        messageCount: normalizedMessages.length,
        hasSystemInstruction: normalizedMessages.some((m) => m.role === "system"),
        generationConfig: {
          ...cfg.generationConfig,
          responseMimeType: cfg.responseMimeType || null,
          hasResponseSchema: Boolean(cfg.responseSchema)
        },
        failed: true
      };
      const failedUsagePayload = buildAiTokenUsagePayload({
        cfg,
        resolved,
        normalizedMessages,
        responseText: "",
        usage: null,
        requestMeta: failedMeta,
        status: "failed",
        errorMessage: error?.message || "Unknown AI provider error"
      });
      await persistAiTokenUsageRecord(failedUsagePayload, cfg.requestingUser);
      throw error;
    }

    this.activeModelId = normalizeModelId(response?.modelUsed || resolved.modelId);
    this.activeProviderId = normalizeProviderId(response?.provider || resolved.providerId);

    const elapsedMs = Date.now() - startTs;
    const responseMeta = response?.requestMeta && typeof response.requestMeta === "object"
      ? response.requestMeta
      : {};

    const requestMeta = {
      ...responseMeta,
      elapsedMs,
      timeoutMs: cfg.timeoutMs,
      requestLabel: cfg.requestLabel || responseMeta.requestLabel || null,
      modelRequested: normalizeModelId(modelId) || null,
      modelUsed: this.activeModelId,
      providerId: this.activeProviderId,
      providerRecordId: resolved.providerRecordId,
      providerRecordName: resolved.providerRecordName,
      resolutionSource: resolved.resolutionSource,
      messageCount: normalizedMessages.length,
      hasSystemInstruction: normalizedMessages.some((m) => m.role === "system"),
      generationConfig: {
        ...cfg.generationConfig,
        responseMimeType: cfg.responseMimeType || null,
        hasResponseSchema: Boolean(cfg.responseSchema)
      }
    };

    const tokenUsagePayload = buildAiTokenUsagePayload({
      cfg,
      resolved,
      normalizedMessages,
      responseText: response?.text,
      usage: response?.usage || null,
      requestMeta
    });
    const savedUsage = await persistAiTokenUsageRecord(tokenUsagePayload, cfg.requestingUser);
    if (savedUsage?.id) {
      requestMeta.tokenUsageRecordId = savedUsage.id;
    }

    return {
      text: s(response?.text),
      modelUsed: this.activeModelId,
      usage: response?.usage || null,
      requestMeta
    };
  },

  // Helpers (legacy)
  buildSampleContext: (sample) => {
    const cleanText = sample.text ? sample.text.replace(/<[^>]*>?/gm, "") : "No text content.";
    return `You are an expert IELTS Writing Tutor. Context: Question: "${sample.question}". Essay: "${cleanText}"`;
  },

  buildAssessmentContext: (assessment) => {
    return `IELTS Coach Review. Title: ${assessment.title}.`;
  },

  buildAnalysisContext: (sample, questionObj) => {
    const cleanText = sample.text ? sample.text.replace(/<[^>]*>?/gm, "") : "";
    return `IELTS Examiner Analysis. Question: ${questionObj.question}. Criteria: ${questionObj.criteria}. Essay: "${cleanText}".`;
  }
};

module.exports = aiService;
