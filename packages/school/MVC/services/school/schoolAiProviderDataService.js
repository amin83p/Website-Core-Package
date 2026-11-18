'use strict';

const schoolDataService = require('./schoolDataService');
const schoolAiProviderModel = require('../../models/school/schoolAiProviderModel');
const { requireCoreModule } = require('./schoolCoreContracts');
const { applyGenericFilter } = requireCoreModule('MVC/utils/queryEngine');
const { decrypt } = require('./schoolAiModelUtils');
const {
  getActiveOrgIdOrThrow,
  idsEqual,
  normalizePagination,
  assertOrgRow,
  resolveRequesterUserId,
  normalizeProviderFormBody,
  PROVIDER_VENDOR_OPTIONS
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

  async getRawProviderById(id) {
    return schoolAiProviderModel.getProviderById(id);
  },

  async decryptApiKeyForProvider(id, requestingUser) {
    const orgId = getActiveOrgIdOrThrow(requestingUser);
    const raw = await schoolAiProviderModel.getProviderById(id);
    if (!raw) throw new Error('AI provider not found.');
    assertOrgRow(raw, orgId);
    if (!raw.apiKeyEncrypted) throw new Error('AI provider has no stored API key.');
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

  assertUserNotBanned(providerRecord, userId) {
    const bans = Array.isArray(providerRecord?.bannedUserIds) ? providerRecord.bannedUserIds : [];
    if (bans.some((id) => idsEqual(id, userId))) {
      throw new Error('You are blocked from using this AI provider key for this organization.');
    }
  }
};

module.exports = schoolAiProviderDataService;