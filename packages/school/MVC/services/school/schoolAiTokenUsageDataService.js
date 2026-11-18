'use strict';

const schoolDataService = require('./schoolDataService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { applyGenericFilter } = requireCoreModule('MVC/utils/queryEngine');
const {
  getActiveOrgIdOrThrow,
  idsEqual,
  normalizePagination,
  cleanString,
  isPlainObject
} = require('./schoolAiAssistCommon');

const ENTITY = 'schoolAiTokenUsage';

function createTraceId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `school-ai-${Date.now().toString(36)}-${rand}`;
}

const schoolAiTokenUsageDataService = {
  async listUsage(requestingUser, query = {}, accessContext = {}) {
    const orgId = getActiveOrgIdOrThrow(requestingUser);
    const { page, limit } = normalizePagination(query);
    let rows = await schoolDataService.fetchAllData(ENTITY, { orgId__eq: orgId }, requestingUser, accessContext);
    rows = applyGenericFilter(rows, query, {
      defaultSearchFields: ['id', 'userId', 'serviceKey', 'providerId', 'modelId', 'traceId', 'status']
    });
    rows.sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')));
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

  async getUsageById(id, requestingUser, accessContext = {}) {
    const orgId = getActiveOrgIdOrThrow(requestingUser);
    const row = await schoolDataService.getDataById(ENTITY, id, requestingUser, accessContext);
    if (!row || !idsEqual(row.orgId, orgId)) return null;
    return row;
  },

  async recordCall(payload = {}, requestingUser = null) {
    const source = isPlainObject(payload) ? payload : {};
    const orgId = cleanString(source.orgId, { max: 120, allowEmpty: false });
    if (!orgId) return null;
    const traceId = cleanString(source.traceId, { max: 120, allowEmpty: true }) || createTraceId();
    const usage = source.usage && typeof source.usage === 'object' ? source.usage : {};
    const body = {
      orgId,
      userId: cleanString(source.userId, { max: 120, allowEmpty: true }) || '',
      serviceKey: cleanString(source.serviceKey, { max: 120, allowEmpty: true }) || '',
      providerRecordId: cleanString(source.providerRecordId, { max: 120, allowEmpty: true }) || '',
      providerId: cleanString(source.providerId, { max: 80, allowEmpty: true }) || '',
      modelId: cleanString(source.modelId, { max: 220, allowEmpty: true }) || '',
      status: cleanString(source.status, { max: 20, allowEmpty: true }).toLowerCase() === 'failed' ? 'failed' : 'success',
      errorMessage: cleanString(source.errorMessage, { max: 2000, allowEmpty: true }) || '',
      promptTokenCount: usage.promptTokenCount ?? source.promptTokenCount ?? null,
      completionTokenCount: usage.completionTokenCount ?? usage.candidatesTokenCount ?? source.completionTokenCount ?? null,
      totalTokenCount: usage.totalTokenCount ?? source.totalTokenCount ?? null,
      traceId,
      durationMs: source.durationMs ?? null,
      requestSummary: cleanString(source.requestSummary, { max: 500, allowEmpty: true }) || '',
      responseSummary: cleanString(source.responseSummary, { max: 500, allowEmpty: true }) || ''
    };
    return schoolDataService.addData(ENTITY, body, requestingUser || { id: body.userId, activeOrgId: orgId }, {});
  },

  async sumUsageForUser({ orgId, userId, sinceIso, serviceKey = null }, requestingUser, accessContext = {}) {
    const rows = await schoolDataService.fetchAllData(
      ENTITY,
      { orgId__eq: orgId, userId__eq: userId },
      requestingUser,
      accessContext
    );
    const sinceMs = sinceIso ? new Date(sinceIso).getTime() : 0;
    return (Array.isArray(rows) ? rows : []).reduce((acc, row) => {
      const createdMs = new Date(row?.createdAt || 0).getTime();
      if (sinceMs && (!Number.isFinite(createdMs) || createdMs < sinceMs)) return acc;
      if (serviceKey && String(row?.serviceKey) !== String(serviceKey)) return acc;
      acc.requestCount += 1;
      acc.totalTokens += Number(row?.totalTokenCount) || 0;
      return acc;
    }, { requestCount: 0, totalTokens: 0 });
  }
};

module.exports = schoolAiTokenUsageDataService;