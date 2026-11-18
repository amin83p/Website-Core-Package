'use strict';

const schoolDataService = require('./schoolDataService');
const schoolIdentityLookupService = require('./schoolIdentityLookupService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { applyGenericFilter } = requireCoreModule('MVC/utils/queryEngine');
const {
  getActiveOrgIdOrThrow,
  idsEqual,
  normalizePagination,
  cleanString,
  assertOrgRow
} = require('./schoolAiAssistCommon');

const ENTITY = 'schoolAiUserUsageLimits';

const schoolAiUserUsageLimitDataService = {
  async listLimits(requestingUser, query = {}, accessContext = {}) {
    const orgId = getActiveOrgIdOrThrow(requestingUser);
    const { page, limit } = normalizePagination(query);
    let rows = await schoolDataService.fetchAllData(ENTITY, { orgId__eq: orgId }, requestingUser, accessContext);
    rows = applyGenericFilter(rows, query, {
      defaultSearchFields: ['id', 'userId', 'periodType', 'appliesTo', 'notes']
    });
    const start = (page - 1) * limit;
    const data = rows.slice(start, start + limit);
    const nameMap = await schoolIdentityLookupService.mapUserDisplayNames(
      requestingUser,
      data.map((row) => row.userId)
    );
    const enriched = data.map((row) => {
      const userId = String(row.userId || '').trim();
      return {
        ...row,
        userDisplayName: nameMap.get(userId) || userId
      };
    });
    return {
      rows: enriched,
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

  buildLimitBody(payload, requestingUser) {
    const orgId = getActiveOrgIdOrThrow(requestingUser);
    return {
      orgId,
      userId: cleanString(payload?.userId, { max: 120, allowEmpty: false }),
      periodType: cleanString(payload?.periodType, { max: 20, allowEmpty: true }) || 'monthly',
      appliesTo: cleanString(payload?.appliesTo, { max: 120, allowEmpty: true }) || 'all_services',
      maxTotalTokens: Number.parseInt(String(payload?.maxTotalTokens ?? 0), 10) || 0,
      maxRequestCount: Number.parseInt(String(payload?.maxRequestCount ?? 0), 10) || 0,
      isActive: payload?.isActive !== false && String(payload?.isActive) !== 'false',
      notes: cleanString(payload?.notes, { max: 4000, allowEmpty: true }) || '',
      lastUpdateUser: String(requestingUser?.id || 'SYSTEM')
    };
  },

  async getLimitById(id, requestingUser, accessContext = {}) {
    const orgId = getActiveOrgIdOrThrow(requestingUser);
    const row = await schoolDataService.getDataById(ENTITY, id, requestingUser, accessContext);
    if (!row || !idsEqual(row.orgId, orgId)) return null;
    return row;
  },

  async createLimit(payload, requestingUser, accessContext = {}) {
    const body = this.buildLimitBody(payload, requestingUser);
    return schoolDataService.addData(ENTITY, body, requestingUser, { accessContext });
  },

  async updateLimit(id, payload, requestingUser, accessContext = {}) {
    const orgId = getActiveOrgIdOrThrow(requestingUser);
    const existing = await schoolDataService.getDataById(ENTITY, id, requestingUser, accessContext);
    if (!existing) throw new Error('Usage limit not found.');
    assertOrgRow(existing, orgId);
    const body = this.buildLimitBody(payload, requestingUser);
    return schoolDataService.updateData(ENTITY, id, body, requestingUser, { accessContext });
  },

  async deleteLimit(id, requestingUser, accessContext = {}) {
    const orgId = getActiveOrgIdOrThrow(requestingUser);
    const row = await schoolDataService.getDataById(ENTITY, id, requestingUser, accessContext);
    if (!row) throw new Error('Usage limit not found.');
    assertOrgRow(row, orgId);
    return schoolDataService.deleteData(ENTITY, id, requestingUser, { accessContext });
  },

  async listActiveLimitsForUser(orgId, userId, requestingUser, accessContext = {}) {
    const rows = await schoolDataService.fetchAllData(
      ENTITY,
      { orgId__eq: orgId, userId__eq: userId },
      requestingUser,
      accessContext
    );
    return (Array.isArray(rows) ? rows : []).filter((row) => (
      idsEqual(row?.orgId, orgId) && idsEqual(row?.userId, userId) && row?.isActive !== false
    ));
  }
};

module.exports = schoolAiUserUsageLimitDataService;