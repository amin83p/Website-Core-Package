'use strict';

const schoolDataService = require('./schoolDataService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { applyGenericFilter } = requireCoreModule('MVC/utils/queryEngine');
const schoolAiTokenUsageModel = require('../../models/school/schoolAiTokenUsageModel');
const {
  getActiveOrgIdOrThrow,
  idsEqual,
  normalizePagination,
  cleanString,
  isPlainObject
} = require('./schoolAiAssistCommon');
const { cleanId } = require('./schoolAiModelUtils');

const ENTITY = 'schoolAiTokenUsage';
const REPORT_AI_SOURCE = 'report_ai_assist';
const DEFAULT_REPORT_HISTORY_LIMIT = 30;

function createTraceId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `school-ai-${Date.now().toString(36)}-${rand}`;
}

function pickReportFields(source = {}) {
  const input = isPlainObject(source) ? source : {};
  return {
    usageSource: cleanString(input.usageSource, { max: 80, allowEmpty: true }) || '',
    reportContext: cleanString(input.reportContext, { max: 20, allowEmpty: true }) || '',
    reportInstanceId: cleanId(input.reportInstanceId, { max: 120, allowEmpty: true }) || '',
    reportAssignmentId: cleanId(input.reportAssignmentId, { max: 120, allowEmpty: true }) || '',
    reportAssignmentRowId: cleanId(input.reportAssignmentRowId, { max: 120, allowEmpty: true }) || '',
    reportTeacherId: cleanId(input.reportTeacherId, { max: 120, allowEmpty: true }) || '',
    reportTemplateId: cleanId(input.reportTemplateId, { max: 120, allowEmpty: true }) || '',
    bindingRowId: cleanId(input.bindingRowId, { max: 120, allowEmpty: true }) || ''
  };
}

function buildReportInputPayloadSnapshot(resolvedInputs = {}, coercedInputs = null) {
  const resolved = isPlainObject(resolvedInputs) ? resolvedInputs : {};
  const snapshot = { resolved: { ...resolved } };
  if (coercedInputs !== undefined && coercedInputs !== null && isPlainObject(coercedInputs)) {
    snapshot.coerced = { ...coercedInputs };
  }
  return schoolAiTokenUsageModel.sanitizeJsonPayload(snapshot);
}

function resolveReportInputPayload(payload) {
  if (!isPlainObject(payload)) return {};
  if (isPlainObject(payload.resolved)) return payload.resolved;
  return payload;
}

function buildOutputPayloadSnapshot(result = {}) {
  if (!isPlainObject(result)) return null;
  return schoolAiTokenUsageModel.sanitizeJsonPayload({
    ok: result.ok !== false,
    mode: result.mode,
    data: result.data,
    displayText: result.displayText,
    error: result.error,
    rawText: result.rawText != null ? String(result.rawText).slice(0, 12000) : undefined,
    traceId: result.traceId,
    serviceKey: result.serviceKey,
    modelId: result.modelId
  });
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
      responseSummary: cleanString(source.responseSummary, { max: 500, allowEmpty: true }) || '',
      ...pickReportFields(source),
      inputPayload: schoolAiTokenUsageModel.sanitizeJsonPayload(source.inputPayload),
      outputPayload: schoolAiTokenUsageModel.sanitizeJsonPayload(source.outputPayload)
    };
    return schoolDataService.addData(ENTITY, body, requestingUser || { id: body.userId, activeOrgId: orgId }, { accessContext: source.accessContext });
  },

  async enrichUsageRecord(id, patch = {}, requestingUser, accessContext = {}) {
    const rowId = cleanId(id, { max: 120, allowEmpty: false });
    if (!rowId) return null;
    const existing = await schoolAiTokenUsageDataService.getUsageById(rowId, requestingUser, accessContext);
    if (!existing) return null;
    const source = isPlainObject(patch) ? patch : {};
    const next = {
      ...existing,
      ...pickReportFields({ ...existing, ...source }),
      inputPayload: source.inputPayload !== undefined
        ? schoolAiTokenUsageModel.sanitizeJsonPayload(source.inputPayload)
        : existing.inputPayload,
      outputPayload: source.outputPayload !== undefined
        ? schoolAiTokenUsageModel.sanitizeJsonPayload(source.outputPayload)
        : existing.outputPayload,
      status: source.status !== undefined
        ? (cleanString(source.status, { max: 20, allowEmpty: true }).toLowerCase() === 'failed' ? 'failed' : 'success')
        : existing.status,
      errorMessage: source.errorMessage !== undefined
        ? cleanString(source.errorMessage, { max: 2000, allowEmpty: true }) || ''
        : existing.errorMessage,
      responseSummary: source.responseSummary !== undefined
        ? cleanString(source.responseSummary, { max: 500, allowEmpty: true }) || ''
        : existing.responseSummary
    };
    return schoolDataService.updateData(ENTITY, rowId, next, requestingUser, { accessContext });
  },

  async listReportAiAssistHistory(filters = {}, requestingUser, accessContext = {}) {
    const orgId = getActiveOrgIdOrThrow(requestingUser);
    const context = cleanString(filters.reportContext, { max: 20, allowEmpty: true }).toLowerCase();
    const bindingRowId = cleanId(filters.bindingRowId, { max: 120, allowEmpty: true }) || '';
    const limit = Math.min(
      Math.max(Number.parseInt(String(filters.limit || DEFAULT_REPORT_HISTORY_LIMIT), 10) || DEFAULT_REPORT_HISTORY_LIMIT, 1),
      100
    );
    let rows = await schoolDataService.fetchAllData(ENTITY, { orgId__eq: orgId }, requestingUser, accessContext);
    rows = (Array.isArray(rows) ? rows : []).filter((row) => String(row?.usageSource || '') === REPORT_AI_SOURCE);
    if (context === 'matrix') {
      const assignmentId = cleanId(filters.reportAssignmentId, { max: 120, allowEmpty: false });
      const assignmentRowId = cleanId(filters.reportAssignmentRowId, { max: 120, allowEmpty: true }) || '';
      const teacherId = cleanId(filters.reportTeacherId, { max: 120, allowEmpty: true }) || '';
      rows = rows.filter((row) => (
        String(row?.reportContext || '').toLowerCase() === 'matrix'
        && idsEqual(row?.reportAssignmentId, assignmentId)
        && String(row?.reportAssignmentRowId || '') === String(assignmentRowId)
        && String(row?.reportTeacherId || '') === String(teacherId)
      ));
    } else {
      const instanceId = cleanId(filters.reportInstanceId, { max: 120, allowEmpty: false });
      rows = rows.filter((row) => (
        String(row?.reportContext || '').toLowerCase() === 'instance'
        && idsEqual(row?.reportInstanceId, instanceId)
      ));
    }
    if (bindingRowId) {
      rows = rows.filter((row) => String(row?.bindingRowId || '') === String(bindingRowId));
    }
    rows.sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')));
    return rows.slice(0, limit);
  },

  buildOutputPayloadSnapshot,
  buildReportInputPayloadSnapshot,
  resolveReportInputPayload,
  REPORT_AI_SOURCE
};

module.exports = schoolAiTokenUsageDataService;