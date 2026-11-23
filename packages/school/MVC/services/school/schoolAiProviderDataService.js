'use strict';

const schoolDataService = require('./schoolDataService');
const schoolRepositories = require('../../repositories/school');
const schoolAiProviderModel = require('../../models/school/schoolAiProviderModel');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { applyGenericFilter } = requireCoreModule('MVC/utils/queryEngine');
const { decrypt } = require('./schoolAiModelUtils');
const schoolAiProviderInvokeService = require('./schoolAiProviderInvokeService');
const {
  getActiveOrgIdOrThrow,
  idsEqual,
  normalizePagination,
  assertOrgRow,
  resolveRequesterUserId,
  normalizeProviderFormBody,
  PROVIDER_VENDOR_OPTIONS,
  cleanString
} = require('./schoolAiAssistCommon');

const ENTITY = 'schoolAiProviders';

function buildAccessContext(req) {
  return schoolDataService.buildRouteAccessContext ? schoolDataService.buildRouteAccessContext(req) : {};
}

function findModelEntry(provider = {}, modelEntryId = '') {
  const models = Array.isArray(provider?.models) ? provider.models : [];
  return models.find((row) => idsEqual(row?.id, modelEntryId)) || null;
}

const schoolAiProviderDataService = {
  getProviderOptions() {
    return PROVIDER_VENDOR_OPTIONS.map((row) => ({ ...row }));
  },

  async listProviders(requestingUser, query = {}, accessContext = {}) {
    const orgId = getActiveOrgIdOrThrow(requestingUser);
    const { page, limit } = normalizePagination(query);
    let rows = await schoolDataService.fetchAllData(ENTITY, { orgId__eq: orgId }, requestingUser, accessContext);
    rows = (Array.isArray(rows) ? rows : []).filter((row) => idsEqual(row?.orgId, orgId));
    rows = applyGenericFilter(rows, query, {
      defaultSearchFields: ['id', 'name', 'providerId', 'notes', 'project', 'location']
    });
    rows.sort((a, b) => String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')));
    const start = (page - 1) * limit;
    const data = rows.slice(start, start + limit);
    return {
      rows: data,
      pagination: {
        currentPage: page,
        totalPages: Math.max(1, Math.ceil(rows.length / limit)),
        totalItems: rows.length,
        limit,
        startItem: rows.length ? start + 1 : 0,
        endItem: Math.min(start + limit, rows.length)
      }
    };
  },

  async getProviderById(id, requestingUser, accessContext = {}) {
    const orgId = getActiveOrgIdOrThrow(requestingUser);
    const row = await schoolDataService.getDataById(ENTITY, id, requestingUser, accessContext);
    if (!row) return null;
    assertOrgRow(row, orgId);
    return schoolAiProviderModel.sanitizeProviderForRead(row);
  },

  async getRawProviderById(id, requestingUser, accessContext = {}) {
    const normalizedId = toPublicId(id);
    if (!normalizedId) return null;
    if (requestingUser) {
      const orgId = getActiveOrgIdOrThrow(requestingUser);
      const row = await schoolRepositories.schoolAiProviders.getById(normalizedId, {
        skipTransform: true,
        accessContext,
        scope: {
          orgId,
          scopeId: accessContext?.scopeId || ''
        }
      });
      if (row) {
        assertOrgRow(row, orgId);
        return row;
      }
    }
    return schoolAiProviderModel.getProviderById(normalizedId);
  },

  async decryptApiKeyForProvider(id, requestingUser, accessContext = {}) {
    const orgId = getActiveOrgIdOrThrow(requestingUser);
    const raw = await schoolAiProviderDataService.getRawProviderById(id, requestingUser, accessContext);
    if (!raw) throw new Error('AI provider not found.');
    assertOrgRow(raw, orgId);
    const legacyPlain = cleanString(raw.apiKey, { max: 8000, allowEmpty: true }) || '';
    if (!raw.apiKeyEncrypted) {
      if (legacyPlain) return legacyPlain;
      throw new Error('AI provider has no stored API key.');
    }
    try {
      return decrypt(raw.apiKeyEncrypted);
    } catch (error) {
      throw new Error(`Stored API key cannot be decrypted. Re-save the key in School AI Assist. (${error?.message || ''})`);
    }
  },

  async createProvider(payload, requestingUser, accessContext = {}) {
    const orgId = getActiveOrgIdOrThrow(requestingUser);
    const body = normalizeProviderFormBody(payload, { isEdit: false });
    body.orgId = orgId;
    body.audit = { lastUpdateUser: resolveRequesterUserId(requestingUser) };
    return schoolDataService.addData(ENTITY, body, requestingUser, { accessContext });
  },

  async updateProvider(id, payload, requestingUser, accessContext = {}) {
    const orgId = getActiveOrgIdOrThrow(requestingUser);
    const existing = await schoolDataService.getDataById(ENTITY, id, requestingUser, accessContext);
    if (!existing) throw new Error('AI provider not found.');
    assertOrgRow(existing, orgId);
    const body = normalizeProviderFormBody({ ...payload, requestingUser }, { isEdit: true });
    body.orgId = orgId;
    body.lastUpdateUser = resolveRequesterUserId(requestingUser);
    return schoolDataService.updateData(ENTITY, id, body, requestingUser, { accessContext });
  },

  async deleteProvider(id, requestingUser, accessContext = {}) {
    const orgId = getActiveOrgIdOrThrow(requestingUser);
    const existing = await schoolDataService.getDataById(ENTITY, id, requestingUser, accessContext);
    if (!existing) throw new Error('AI provider not found.');
    assertOrgRow(existing, orgId);
    return schoolDataService.deleteData(ENTITY, id, requestingUser, { accessContext });
  },

  async setDefaultProvider(id, requestingUser, accessContext = {}) {
    const orgId = getActiveOrgIdOrThrow(requestingUser);
    const existing = await schoolDataService.getDataById(ENTITY, id, requestingUser, accessContext);
    if (!existing) throw new Error('AI provider not found.');
    assertOrgRow(existing, orgId);
    if (existing.isActive === false) throw new Error('Inactive providers cannot be default.');
    const all = await schoolDataService.fetchAllData(ENTITY, { orgId__eq: orgId }, requestingUser, accessContext);
    await Promise.all((Array.isArray(all) ? all : [])
      .filter((row) => idsEqual(row?.orgId, orgId) && row.isDefault)
      .map((row) => schoolDataService.updateData(ENTITY, row.id, { isDefault: false }, requestingUser, { accessContext })));
    return schoolDataService.updateData(ENTITY, id, { isDefault: true }, requestingUser, { accessContext });
  },

  findModelEntry,

  async listVendorModels(requestingUser, params = {}, accessContext = {}) {
    const orgId = getActiveOrgIdOrThrow(requestingUser);
    const providerRecordId = toPublicId(params.providerRecordId || params.id);
    let vendorId = cleanString(params.providerId, { max: 80, allowEmpty: true }).toLowerCase();
    const credentials = {
      project: cleanString(params.project, { max: 220, allowEmpty: true }) || '',
      location: cleanString(params.location, { max: 220, allowEmpty: true }) || '',
      baseUrl: cleanString(params.baseUrl, { max: 500, allowEmpty: true }) || ''
    };
    const overrideKey = cleanString(params.apiKey, { max: 8000, allowEmpty: true }) || '';
    if (providerRecordId) {
      const raw = await schoolAiProviderDataService.getRawProviderById(providerRecordId, requestingUser, accessContext);
      if (!raw) throw new Error('AI provider not found.');
      assertOrgRow(raw, orgId);
      vendorId = cleanString(raw.providerId, { max: 80, allowEmpty: true }).toLowerCase() || vendorId;
      credentials.project = credentials.project || cleanString(raw.project, { max: 220, allowEmpty: true }) || '';
      credentials.location = credentials.location || cleanString(raw.location, { max: 220, allowEmpty: true }) || '';
      credentials.baseUrl = credentials.baseUrl || cleanString(raw.baseUrl, { max: 500, allowEmpty: true }) || '';
      credentials.apiKey = overrideKey || await schoolAiProviderDataService.decryptApiKeyForProvider(
        providerRecordId,
        requestingUser,
        accessContext
      );
    } else {
      if (!vendorId) throw new Error('Provider vendor is required to list models.');
      if (!overrideKey) throw new Error('API key is required to list models (save the provider or paste a key on the form).');
      credentials.apiKey = overrideKey;
    }
    if (!credentials.apiKey) throw new Error('API key is required to list models.');
    const rows = await schoolAiProviderInvokeService.listAvailableModels(vendorId, credentials);
    const models = (Array.isArray(rows) ? rows : [])
      .filter((row) => row?.supportsGenerateContent !== false)
      .map((row) => ({
        modelId: String(row.id || '').trim(),
        label: String(row.name || row.id || '').trim(),
        provider: row.provider || vendorId
      }))
      .filter((row) => row.modelId);
    return { providerId: vendorId, models };
  },

  assertUserNotBanned(providerRecord, userId) {
    const bans = Array.isArray(providerRecord?.bannedUserIds) ? providerRecord.bannedUserIds : [];
    if (bans.some((id) => idsEqual(id, userId))) {
      throw new Error('You are blocked from using this AI provider key for this organization.');
    }
  }
};

module.exports = schoolAiProviderDataService;