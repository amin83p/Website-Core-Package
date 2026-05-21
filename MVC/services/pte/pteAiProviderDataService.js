const pteAiProviderRepository = require('../../repositories/pteAiProviderRepository');
const pteAiProviderModel = require('../../models/pte/pteAiProviderModel');
const adminChekersService = require('../adminChekersService');
const activityQuotaLedgerService = require('../activityQuotaLedgerService');
const settingService = require('../settingService');
const { normalizeQueryOptions } = require('../../utils/queryOptionsAdapter');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');
const { assertCreateOrgContextOrThrow } = require('../../utils/orgContextUtils');
const { decrypt } = require('../../utils/encyptors');
const { runByRepositoryBackend } = require('../../repositories/backend/repositoryBackendSelector');
const { getMongoCollection } = require('../../infrastructure/mongo/mongoConnection');

const PROVIDER_OPTIONS = Object.freeze([
  { id: 'google-gemini', label: 'Google Gemini' },
  { id: 'google-vertex', label: 'Google Vertex AI' },
  { id: 'openai', label: 'OpenAI (ChatGPT/API)' },
  { id: 'anthropic', label: 'Anthropic Claude' },
  { id: 'azure-openai', label: 'Azure OpenAI' },
  { id: 'custom', label: 'Custom Provider' }
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function cleanString(value, { max = 4000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function extractErrorText(error) {
  if (!error) return '';
  const chunks = [
    error?.message,
    error?.errmsg,
    error?.errorResponse?.errmsg
  ];
  return chunks
    .map((item) => cleanString(item, { max: 2000, allowEmpty: true }))
    .filter(Boolean)
    .join(' | ')
    .toLowerCase();
}

function isDuplicateNameError(error) {
  if (!error) return false;
  const message = extractErrorText(error);
  const duplicateSignal = Number(error?.code) === 11000
    || message.includes('e11000')
    || (message.includes('duplicate') && message.includes('key'))
    || message.includes('already exists');
  if (!duplicateSignal) return false;

  const keyPattern = isPlainObject(error?.keyPattern) ? error.keyPattern : null;
  if (keyPattern && hasOwn(keyPattern, 'name')) return true;

  const keyValue = isPlainObject(error?.keyValue) ? error.keyValue : null;
  if (keyValue && hasOwn(keyValue, 'name')) return true;

  return message.includes('name');
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const token = String(value ?? '').trim().toLowerCase();
  if (!token) return fallback;
  if (['true', '1', 'yes', 'y', 'on'].includes(token)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function resolveDefaultPageSize() {
  const configured = Number.parseInt(String(settingService.getValue('app', 'defaultPageSize') || ''), 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 20;
}

function normalizePagination(input = {}, fallback = {}) {
  const fromInput = isPlainObject(input) ? input : {};
  const fromFallback = isPlainObject(fallback) ? fallback : {};
  const defaultLimit = resolveDefaultPageSize();
  const page = Math.max(1, Number.parseInt(fromInput.page ?? fromFallback.page ?? 1, 10) || 1);
  const parsedLimit = Number.parseInt(fromInput.limit ?? fromFallback.limit ?? 0, 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : defaultLimit;
  return { page, limit };
}

function buildPaginationMeta(totalRows = 0, page = 1, limit = 0) {
  const safeTotal = Math.max(0, Number(totalRows) || 0);
  const safeLimit = Number(limit) > 0 ? Number(limit) : resolveDefaultPageSize();
  const totalPages = Math.max(1, Math.ceil(safeTotal / safeLimit));
  const currentPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const startIndex = (currentPage - 1) * safeLimit;
  const endIndex = Math.min(startIndex + safeLimit, safeTotal);
  return {
    currentPage,
    totalPages,
    totalItems: safeTotal,
    limit: safeLimit,
    startItem: safeTotal > 0 ? startIndex + 1 : 0,
    endItem: endIndex
  };
}

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const out = { ...query };
  delete out.page;
  delete out.limit;
  return out;
}

function resolveActiveOrgId(requestingUser) {
  return toPublicId(requestingUser?.activeOrgId || requestingUser?.primaryOrgId) || '';
}

function resolveRequesterUserId(requestingUser) {
  return toPublicId(requestingUser?.id) || '';
}

function resolveReadVisibility(requestingUser) {
  const activeOrgId = resolveActiveOrgId(requestingUser);
  const requesterUserId = resolveRequesterUserId(requestingUser);
  if (!activeOrgId || !requesterUserId) {
    return {
      mode: 'none',
      activeOrgId: '',
      requesterUserId: ''
    };
  }
  if (adminChekersService.isSuperAdmin(requestingUser) && String(activeOrgId).toUpperCase() === 'SYSTEM') {
    return {
      mode: 'all',
      activeOrgId,
      requesterUserId
    };
  }
  return {
    mode: 'owner',
    activeOrgId,
    requesterUserId
  };
}

function assertReadableVisibility(visibility = {}) {
  if (!visibility || visibility.mode === 'none') {
    throw new Error('No active organization context found.');
  }
}

function buildRepositoryScope(visibility = {}) {
  if (!visibility || visibility.mode === 'all') return { canViewAll: true };
  return {
    canViewAll: false,
    orgId: visibility.activeOrgId,
    userId: visibility.requesterUserId
  };
}

function isVisibleRow(row = {}, visibility = {}) {
  if (!row) return false;
  if (visibility.mode === 'all') return true;
  if (!idsEqual(row?.orgId, visibility.activeOrgId)) return false;
  return idsEqual(row?.userId, visibility.requesterUserId);
}

function buildAuditFromCreator(creator, existingAudit = {}, options = {}) {
  const nowIso = new Date().toISOString();
  const sourceAudit = isPlainObject(existingAudit) ? existingAudit : {};
  const isUpdate = options?.isUpdate === true;
  const creatorUser = String(creator?.type || '').toLowerCase() === 'system'
    ? 'System'
    : (toPublicId(creator?.userId) || 'System');

  return {
    createUser: isUpdate
      ? (cleanString(sourceAudit.createUser, { max: 120, allowEmpty: true }) || creatorUser)
      : creatorUser,
    createDateTime: isUpdate
      ? (cleanString(sourceAudit.createDateTime, { max: 80, allowEmpty: true }) || nowIso)
      : nowIso,
    lastUpdateUser: creatorUser,
    lastUpdateDateTime: nowIso
  };
}

function normalizeProviderPayload(payload = {}, existing = null, { isEdit = false } = {}) {
  const source = isPlainObject(payload) ? payload : {};
  const current = isPlainObject(existing) ? existing : {};

  const providerId = cleanString(source.providerId, { max: 80, allowEmpty: true }).toLowerCase()
    || cleanString(current.providerId, { max: 80, allowEmpty: true }).toLowerCase();
  if (!providerId) throw new Error('Provider selection is required.');

  const name = cleanString(source.name, { max: 220, allowEmpty: true })
    || cleanString(current.name, { max: 220, allowEmpty: true })
    || `${providerId} key`;

  const out = {
    name,
    providerId,
    modelId: cleanString(source.modelId, { max: 220, allowEmpty: true })
      || cleanString(current.modelId, { max: 220, allowEmpty: true })
      || '',
    project: cleanString(source.project, { max: 220, allowEmpty: true })
      || cleanString(current.project, { max: 220, allowEmpty: true })
      || '',
    location: cleanString(source.location, { max: 220, allowEmpty: true })
      || cleanString(current.location, { max: 220, allowEmpty: true })
      || '',
    notes: cleanString(source.notes, { max: 4000, allowEmpty: true })
      || cleanString(current.notes, { max: 4000, allowEmpty: true })
      || '',
    isActive: hasOwn(source, 'isActive')
      ? normalizeBoolean(source.isActive, true)
      : normalizeBoolean(current.isActive, true),
    isDefault: hasOwn(source, 'isDefault')
      ? normalizeBoolean(source.isDefault, false)
      : normalizeBoolean(current.isDefault, false)
  };

  const apiKey = cleanString(source.apiKey, { max: 8000, allowEmpty: true }) || '';
  if (apiKey) out.apiKey = apiKey;
  if (!isEdit && !apiKey) {
    throw new Error('API key is required.');
  }
  if (out.isActive === false) {
    out.isDefault = false;
  }
  return out;
}

function findProviderOptionLabel(providerId = '') {
  const token = cleanString(providerId, { max: 80, allowEmpty: true }).toLowerCase();
  if (!token) return '';
  const row = PROVIDER_OPTIONS.find((item) => cleanString(item?.id, { max: 80, allowEmpty: true }).toLowerCase() === token);
  return cleanString(row?.label, { max: 220, allowEmpty: true }) || token;
}

function buildRuntimeProviderPayload(selected = {}, decryptedApiKey = '', selectionMetadata = {}) {
  const providerId = cleanString(selected.providerId, { max: 80, allowEmpty: true }).toLowerCase();
  const modelId = cleanString(selected.modelId, { max: 220, allowEmpty: true }) || '';
  return {
    providerId,
    modelId,
    providerLabel: findProviderOptionLabel(providerId),
    providerSelectionSource: cleanString(selectionMetadata.providerSelectionSource, { max: 80, allowEmpty: true }) || 'default_provider',
    scoringSettingId: cleanString(selectionMetadata.scoringSettingId, { max: 160, allowEmpty: true }) || '',
    providerSelectionWarnings: Array.isArray(selectionMetadata.providerSelectionWarnings)
      ? selectionMetadata.providerSelectionWarnings
          .map((warning) => cleanString(warning, { max: 500, allowEmpty: true }))
          .filter(Boolean)
      : [],
    providerRecord: {
      id: selected.id,
      name: selected.name || '',
      providerId,
      modelId,
      orgId: selected.orgId || '',
      userId: selected.userId || ''
    },
    credentials: {
      apiKey: decryptedApiKey,
      endpoint: cleanString(selected.endpoint, { max: 400, allowEmpty: true }) || '',
      baseUrl: cleanString(selected.baseUrl, { max: 400, allowEmpty: true }) || '',
      apiVersion: cleanString(selected.apiVersion, { max: 120, allowEmpty: true }) || '',
      organization: cleanString(selected.organization, { max: 220, allowEmpty: true }) || '',
      project: cleanString(selected.project, { max: 220, allowEmpty: true }) || '',
      location: cleanString(selected.location, { max: 220, allowEmpty: true }) || ''
    }
  };
}

function buildProviderSelectionError(message = '', warnings = []) {
  const safeWarnings = (Array.isArray(warnings) ? warnings : [])
    .map((warning) => cleanString(warning, { max: 500, allowEmpty: true }))
    .filter(Boolean);
  const safeMessage = cleanString(message, { max: 800, allowEmpty: true }) || 'PTE AI provider selection failed.';
  const fullMessage = safeWarnings.length
    ? `${safeWarnings.join(' ')} ${safeMessage}`
    : safeMessage;
  const error = new Error(fullMessage);
  error.providerSelectionWarnings = safeWarnings;
  error.code = 'PTE_AI_PROVIDER_SELECTION_WARNING';
  return error;
}

function providerRecordHasStoredKey(providerRecord = {}) {
  if (providerRecord?.hasApiKey === true) return true;
  const hint = cleanString(providerRecord?.apiKeyHint || providerRecord?.apiKeyMasked, { max: 80, allowEmpty: true });
  if (!hint) return false;
  return hint.toLowerCase() !== 'not set';
}

function providerRecordLabel(providerRecord = {}) {
  return cleanString(providerRecord?.name, { max: 220, allowEmpty: true })
    || cleanString(providerRecord?.id, { max: 160, allowEmpty: true })
    || 'selected provider';
}

function buildNoUsableApiKeyMessage(providerRecord = {}, label = 'Selected provider') {
  const displayName = providerRecordLabel(providerRecord);
  if (providerRecordHasStoredKey(providerRecord)) {
    return `${label} "${displayName}" has a stored API key, but it cannot be decrypted with the current SESSION_ENCRYPTION_KEY/ENCRYPTION_KEY. Re-save the API key at /pte/ai-assisst/api-providers.`;
  }
  return `${label} "${displayName}" has no usable API key. Update it at /pte/ai-assisst/api-providers.`;
}

async function loadDecryptedApiKeyForProviderRecord(providerId = '') {
  const targetId = cleanString(providerId, { max: 120, allowEmpty: true });
  if (!targetId) return '';

  try {
    const value = await runByRepositoryBackend({}, {
      json: async () => pteAiProviderModel.getDecryptedApiKeyById(targetId),
      mongo: async () => {
        const collection = getMongoCollection('pteAiProviders');
        const row = await collection.findOne({ id: targetId });
        if (!row?.apiKeyEncrypted) return '';
        return decrypt(row.apiKeyEncrypted) || '';
      }
    }, 'pte.aiProviders.loadApiKeyForProviderRecord');
    return cleanString(value, { max: 8000, allowEmpty: true }) || '';
  } catch (_) {
    return '';
  }
}

const pteAiProviderDataService = {
  getProviderOptions() {
    return PROVIDER_OPTIONS.slice();
  },

  async resolveReadVisibility(requestingUser) {
    const visibility = resolveReadVisibility(requestingUser);
    assertReadableVisibility(visibility);
    return visibility;
  },

  async listProviders(query = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await this.resolveReadVisibility(requestingUser);
    const normalizedQuery = normalizeQueryOptions(stripPaginationFromQuery(query || {}));
    const scope = buildRepositoryScope(visibility);
    const paginationInput = normalizePagination(options?.pagination || {}, query || {});
    const paginated = options?.paginated === true || paginationInput.limit > 0;

    if (paginated) {
      const [totalRows, rows] = await Promise.all([
        pteAiProviderRepository.count({
          query: normalizedQuery,
          scope,
          backendMode: options?.backendMode
        }),
        pteAiProviderRepository.list({
          query: normalizedQuery,
          scope,
          sort: { isDefault: -1, updatedAt: -1, id: -1 },
          pagination: {
            page: paginationInput.page,
            limit: paginationInput.limit
          },
          backendMode: options?.backendMode
        })
      ]);
      const safeRows = (Array.isArray(rows) ? rows : []).filter((row) => isVisibleRow(row, visibility));
      return {
        rows: safeRows,
        totalRows: Math.max(totalRows, safeRows.length),
        pagination: buildPaginationMeta(totalRows, paginationInput.page, paginationInput.limit)
      };
    }

    const rows = await pteAiProviderRepository.list({
      query: normalizedQuery,
      scope,
      sort: { isDefault: -1, updatedAt: -1, id: -1 },
      backendMode: options?.backendMode
    });
    return (Array.isArray(rows) ? rows : []).filter((row) => isVisibleRow(row, visibility));
  },

  async getProviderById(id, requestingUser, accessContext = {}, options = {}) {
    const visibility = await this.resolveReadVisibility(requestingUser);
    const row = await pteAiProviderRepository.getById(id, {
      backendMode: options?.backendMode
    });
    if (!row || !isVisibleRow(row, visibility)) return null;
    return row;
  },

  async createProvider(payload = {}, requestingUser, accessContext = {}, options = {}) {
    const activeOrgId = await assertCreateOrgContextOrThrow(requestingUser, { scopeLabel: 'PTE AI providers' });
    const requesterUserId = resolveRequesterUserId(requestingUser);
    if (!requesterUserId) throw new Error('Authenticated user context is required.');

    const sanitized = normalizeProviderPayload(payload, null, { isEdit: false });
    const creator = activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, activeOrgId)
      || activityQuotaLedgerService.createSystemCreatorSnapshot(activeOrgId);
    const audit = buildAuditFromCreator(creator, null, { isUpdate: false });

    try {
      return await pteAiProviderRepository.create({
        ...sanitized,
        orgId: activeOrgId,
        userId: requesterUserId,
        creator,
        audit
      }, {
        backendMode: options?.backendMode
      });
    } catch (error) {
      if (isDuplicateNameError(error)) {
        throw new Error('The name is already available. Please choose another name.');
      }
      throw error;
    }
  },

  async updateProvider(id, payload = {}, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getProviderById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('API provider not found or inaccessible.');

    const sanitized = normalizeProviderPayload(payload, existing, { isEdit: true });
    const activeOrgId = existing.orgId;
    const creator = isPlainObject(existing.creator)
      ? existing.creator
      : (activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, activeOrgId)
        || activityQuotaLedgerService.createSystemCreatorSnapshot(activeOrgId));
    const audit = buildAuditFromCreator(creator, existing.audit || {}, { isUpdate: true });

    try {
      return await pteAiProviderRepository.update(existing.id, {
        ...sanitized,
        orgId: activeOrgId,
        userId: existing.userId,
        creator,
        audit
      }, {
        backendMode: options?.backendMode
      });
    } catch (error) {
      if (isDuplicateNameError(error)) {
        throw new Error('The name is already available. Please choose another name.');
      }
      throw error;
    }
  },

  async deleteProvider(id, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getProviderById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('API provider not found or inaccessible.');
    const visibility = await this.resolveReadVisibility(requestingUser);
    return pteAiProviderRepository.remove(existing.id, {
      scope: buildRepositoryScope(visibility),
      backendMode: options?.backendMode
    });
  },

  async setDefaultProvider(id, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getProviderById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('Selected API provider was not found.');
    if (existing.isActive === false) throw new Error('Inactive API providers cannot be set as default.');
    return this.updateProvider(existing.id, { isDefault: true }, requestingUser, accessContext, options);
  },

  async resolveRuntimeProvider(requestingUser, accessContext = {}, options = {}) {
    const visibility = await this.resolveReadVisibility(requestingUser);
    const providerSelectionWarnings = [];

    const scoringPurpose = cleanString(options?.purpose, { max: 80, allowEmpty: true }).toLowerCase() === 'pte_scoring';
    const scoringQuestionType = cleanString(options?.questionType || options?.scorerKey, { max: 120, allowEmpty: true }).toLowerCase();
    if (scoringPurpose && scoringQuestionType) {
      try {
        const pteAiScoringSettingsDataService = require('./pteAiScoringSettingsDataService');
        const candidate = await pteAiScoringSettingsDataService.resolveScoringProviderCandidate({
          requestingUser,
          questionType: scoringQuestionType,
          scorerKey: options?.scorerKey,
          backendMode: options?.backendMode
        });
        if (Array.isArray(candidate?.warnings)) providerSelectionWarnings.push(...candidate.warnings);

        if (candidate?.providerRecord) {
          const assignedApiKey = await loadDecryptedApiKeyForProviderRecord(candidate.providerRecord.id);
          if (assignedApiKey) {
            return buildRuntimeProviderPayload(candidate.providerRecord, assignedApiKey, {
              providerSelectionSource: 'scoring_setting',
              scoringSettingId: candidate?.setting?.id || '',
              providerSelectionWarnings
            });
          }
          providerSelectionWarnings.push(
            `${buildNoUsableApiKeyMessage(candidate.providerRecord, 'PTE AI scoring provider')} Default provider was used.`
          );
        }
      } catch (error) {
        providerSelectionWarnings.push(
          `PTE AI scoring provider setting could not be applied: ${cleanString(error?.message || error, { max: 400, allowEmpty: true }) || 'unknown error'}. Default provider was used.`
        );
      }
    }

    const scope = buildRepositoryScope(visibility);
    const rows = await pteAiProviderRepository.list({
      query: {},
      scope,
      sort: { isDefault: -1, updatedAt: -1, id: -1 },
      backendMode: options?.backendMode
    });

    const activeRows = (Array.isArray(rows) ? rows : [])
      .filter((row) => isVisibleRow(row, visibility))
      .filter((row) => row?.isActive !== false);

    if (!activeRows.length) {
      throw buildProviderSelectionError(
        'No active PTE AI provider key is configured. Configure one at /pte/ai-assisst/api-providers.',
        providerSelectionWarnings
      );
    }

    const selected = activeRows.find((row) => row?.isDefault === true) || null;
    if (!selected) {
      providerSelectionWarnings.push(
        'No active default PTE AI provider is configured; the AI operation was not run. Set one active API provider as default in /pte/ai-assisst/api-providers.'
      );
      throw buildProviderSelectionError(
        'AI operation requires an active default PTE AI provider.',
        providerSelectionWarnings
      );
    }

    const decryptedApiKey = await loadDecryptedApiKeyForProviderRecord(selected.id);
    if (!decryptedApiKey) {
      throw buildProviderSelectionError(
        buildNoUsableApiKeyMessage(selected, 'Selected default provider'),
        providerSelectionWarnings
      );
    }

    return buildRuntimeProviderPayload(selected, decryptedApiKey, {
      providerSelectionSource: 'default_provider',
      providerSelectionWarnings
    });
  }
};

module.exports = pteAiProviderDataService;
