'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const settingService = requireCoreModule('MVC/services/settingService');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const { getActiveOrgIdOrThrow } = requireCoreModule('MVC/utils/orgContextUtils');
const {
  isPlainObject,
  hasOwn,
  cleanString,
  normalizeBoolean,
  PROVIDER_VENDOR_OPTIONS
} = require('./schoolAiModelUtils');

function resolveDefaultPageSize() {
  const configured = Number.parseInt(String(settingService.getValue('app', 'defaultPageSize') || ''), 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 20;
}

function normalizePagination(query = {}) {
  const page = Math.max(1, Number.parseInt(query?.page, 10) || 1);
  const limitRaw = Number.parseInt(query?.limit, 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : resolveDefaultPageSize();
  return { page, limit };
}

function assertOrgRow(row, orgId) {
  if (!row || !idsEqual(row.orgId, orgId)) {
    throw new Error('<b>Security Violation</b><br>Unauthorized organization access.');
  }
}

function resolveRequesterUserId(requestingUser) {
  return toPublicId(requestingUser?.id) || '';
}

function normalizeProviderFormBody(body = {}, { isEdit = false } = {}) {
  const source = isPlainObject(body) ? body : {};
  let models = [];
  if (source.modelsJson) {
    try {
      const parsed = JSON.parse(String(source.modelsJson));
      models = Array.isArray(parsed) ? parsed : [];
    } catch (_err) {
      throw new Error('Models payload is invalid JSON.');
    }
  } else if (Array.isArray(source.models)) {
    models = source.models;
  }
  let bannedUserIds = source.bannedUserIds ?? source['bannedUserIds[]'];
  if (typeof bannedUserIds === 'string') {
    bannedUserIds = bannedUserIds.split(',').map((t) => t.trim()).filter(Boolean);
  }
  if (!Array.isArray(bannedUserIds)) bannedUserIds = [];
  const out = {
    name: cleanString(source.name, { max: 220, allowEmpty: true }) || '',
    providerId: cleanString(source.providerId, { max: 80, allowEmpty: true }).toLowerCase() || '',
    project: cleanString(source.project, { max: 220, allowEmpty: true }) || '',
    location: cleanString(source.location, { max: 220, allowEmpty: true }) || '',
    baseUrl: cleanString(source.baseUrl, { max: 500, allowEmpty: true }) || '',
    notes: cleanString(source.notes, { max: 4000, allowEmpty: true }) || '',
    models,
    bannedUserIds: bannedUserIds || [],
    isActive: hasOwn(source, 'isActive') ? normalizeBoolean(source.isActive, true) : true,
    isDefault: hasOwn(source, 'isDefault') ? normalizeBoolean(source.isDefault, false) : false,
    lastUpdateUser: resolveRequesterUserId(source.requestingUser) || 'SYSTEM'
  };
  const apiKey = cleanString(source.apiKey, { max: 8000, allowEmpty: true }) || '';
  if (apiKey) out.apiKey = apiKey;
  if (!isEdit && !apiKey) throw new Error('API key is required.');
  return out;
}

function periodWindowStart(periodType = 'monthly', now = new Date()) {
  const d = new Date(now.getTime());
  const type = cleanString(periodType, { max: 20, allowEmpty: true }).toLowerCase() || 'monthly';
  if (type === 'daily') {
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  if (type === 'weekly') {
    const day = d.getUTCDay();
    const diff = (day + 6) % 7;
    d.setUTCDate(d.getUTCDate() - diff);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

module.exports = {
  PROVIDER_VENDOR_OPTIONS,
  getActiveOrgIdOrThrow,
  toPublicId,
  idsEqual,
  isPlainObject,
  cleanString,
  normalizePagination,
  assertOrgRow,
  resolveRequesterUserId,
  normalizeProviderFormBody,
  periodWindowStart
};