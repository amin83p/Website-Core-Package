'use strict';

const schoolDataService = require('./schoolDataService');
const reportService = require('./reportService');
const reportRuleEngineService = require('./reportRuleEngineService');
const reportViewService = require('./reportViewService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function clean(value) {
  return String(value || '').trim();
}

function isVisualOnlyField(field = {}) {
  const type = String(field?.type || '').trim().toLowerCase();
  return type === 'section' || type === 'subheader' || type === 'row_break';
}

function isSharedReportField(field = {}, assignment = null) {
  return reportService.isStudentTargetedScope(assignment?.reportScope)
    && field?.sharedAcrossStudents === true;
}

function buildSharedExclusivePrefillKeySet(fields = [], assignment = null) {
  const countsByKey = new Map();
  (Array.isArray(fields) ? fields : []).forEach((field) => {
    if (isVisualOnlyField(field) || !field?.id) return;
    const key = reportService.normalizePrefillKey(field?.prefillKey || '');
    if (!key) return;
    const row = countsByKey.get(key) || { shared: 0, private: 0 };
    if (isSharedReportField(field, assignment)) row.shared += 1;
    else row.private += 1;
    countsByKey.set(key, row);
  });
  const exclusive = new Set();
  countsByKey.forEach((counts, key) => {
    if (counts.shared > 0 && counts.private === 0) exclusive.add(key);
  });
  return exclusive;
}

function preserveSharedOnlyPrefillSnapshotKeys(nextPrefill, previousPrefill, exclusiveKeys) {
  if (!(exclusiveKeys instanceof Set) || !exclusiveKeys.size) return nextPrefill;
  const out = { ...(nextPrefill && typeof nextPrefill === 'object' ? nextPrefill : {}) };
  const prior = previousPrefill && typeof previousPrefill === 'object' ? previousPrefill : {};
  exclusiveKeys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(prior, key)) {
      out[key] = prior[key];
    }
  });
  return out;
}

/**
 * Replace prefill snapshot and prefill-linked answers from live data; recompute calculated fields.
 */
async function applyFullLivePrefillToInstance({
  instance,
  template,
  assignment,
  reqUser,
  persist = true
} = {}) {
  if (!instance?.id) {
    const error = new Error('Report instance is required.');
    error.statusCode = 400;
    throw error;
  }
  if (!template) {
    const error = new Error('Template not found.');
    error.statusCode = 400;
    throw error;
  }

  const effectiveAssignment = reportViewService.applyAssignmentRow(
    assignment,
    reportViewService.findAssignmentRow(assignment, instance.assignmentRowId || '')
  );

  const refreshedPrefill = await reportService.buildPrefillSnapshot({
    assignment: effectiveAssignment || instance,
    teacherId: instance.teacherId,
    studentId: instance.studentId,
    reqUser,
    requiredKeys: reportService.resolveTemplateFillKeys(template)
  });

  const editorMergeOptions = reportService.templateUsesSnapshotScope(template)
    ? { respectSnapshotKeys: true }
    : {};
  const scopeCtx = reportService.resolveSnapshotScopeContext(template);
  const fields = Array.isArray(template?.schema?.fields) ? template.schema.fields : [];
  const sharedExclusivePrefillKeys = buildSharedExclusivePrefillKeySet(fields, effectiveAssignment);
  const previousPrefillSnapshot = instance?.prefillSnapshot && typeof instance.prefillSnapshot === 'object'
    ? instance.prefillSnapshot
    : {};

  const refreshedMerged = reportService.mergeTemplateDataLivePersisted(
    template,
    {
      ...instance,
      prefillSnapshot: refreshedPrefill,
      answers: {},
      derivedOverrides: {}
    },
    effectiveAssignment,
    { scopeOptions: editorMergeOptions }
  );

  const nextPrefill = preserveSharedOnlyPrefillSnapshotKeys(
    refreshedPrefill,
    previousPrefillSnapshot,
    sharedExclusivePrefillKeys
  );
  const nextAnswers = {};
  const nextDerivedOverrides = {};

  fields.forEach((field) => {
    const type = String(field?.type || '').trim().toLowerCase();
    if (!field?.id || isVisualOnlyField(field)) return;
    if (scopeCtx.active
      && !reportService.fieldIsInSnapshotScope(field, scopeCtx.baseLowerSet, scopeCtx.placeholderMap)) {
      return;
    }
    if (isSharedReportField(field, effectiveAssignment)) {
      return;
    }

    const fieldId = String(field.id);
    const valueMode = reportRuleEngineService.normalizeValueMode(field?.valueMode);
    const prefillKey = reportService.normalizePrefillKey(field?.prefillKey || '');

    if (valueMode === 'calculated') {
      return;
    }

    if (prefillKey || valueMode === 'derived_editable') {
      if (Object.prototype.hasOwnProperty.call(refreshedMerged, fieldId)) {
        nextAnswers[fieldId] = refreshedMerged[fieldId];
      }
      nextDerivedOverrides[fieldId] = false;
      return;
    }

    if (instance?.answers && Object.prototype.hasOwnProperty.call(instance.answers, fieldId)) {
      nextAnswers[fieldId] = instance.answers[fieldId];
    }
  });

  const mergedAfterPrefillRefresh = reportService.mergeTemplateData(
    template,
    {
      ...instance,
      prefillSnapshot: nextPrefill,
      answers: nextAnswers,
      derivedOverrides: nextDerivedOverrides
    },
    effectiveAssignment
  );
  const recomputedAfterPrefillRefresh = reportService.recomputeCalculatedAnswers({
    template,
    mergedAnswers: mergedAfterPrefillRefresh,
    prefill: nextPrefill
  });

  fields.forEach((field) => {
    const type = String(field?.type || '').trim().toLowerCase();
    if (!field?.id || isVisualOnlyField(field)) return;
    if (scopeCtx.active
      && !reportService.fieldIsInSnapshotScope(field, scopeCtx.baseLowerSet, scopeCtx.placeholderMap)) {
      return;
    }
    if (isSharedReportField(field, effectiveAssignment)) {
      return;
    }
    if (reportRuleEngineService.normalizeValueMode(field?.valueMode) !== 'calculated') return;
    nextAnswers[field.id] = recomputedAfterPrefillRefresh.answers[field.id];
  });

  const mergedForRenderCache = reportService.mergeTemplateData(
    template,
    {
      ...instance,
      prefillSnapshot: nextPrefill,
      answers: nextAnswers,
      derivedOverrides: nextDerivedOverrides
    },
    effectiveAssignment
  );
  const templateVersionForCache = Number(template?.version || instance.templateVersion || 1) || 1;
  const renderCacheUpdatedAt = new Date().toISOString();
  const renderCache = {
    templateId: String(template?.id || instance.templateId || '').trim(),
    templateVersion: templateVersionForCache,
    capturedAt: renderCacheUpdatedAt,
    mergedAnswers: { ...mergedForRenderCache }
  };

  const auditPatch = {
    lastUpdateUser: reqUser?.id || '',
    lastUpdateDateTime: renderCacheUpdatedAt,
    prefillRefreshedAt: renderCacheUpdatedAt
  };
  if (!instance.audit?.firstSavedAt) {
    auditPatch.firstSavedAt = renderCacheUpdatedAt;
  }

  if (persist) {
    await schoolDataService.updateData('reportInstances', instance.id, {
      prefillSnapshot: nextPrefill,
      answers: nextAnswers,
      derivedOverrides: nextDerivedOverrides,
      renderCache,
      audit: {
        ...(instance.audit && typeof instance.audit === 'object' ? instance.audit : {}),
        ...auditPatch
      }
    }, reqUser);
  }

  return {
    prefillSnapshot: nextPrefill,
    answers: nextAnswers,
    derivedOverrides: nextDerivedOverrides,
    renderCache,
    updatedAt: renderCacheUpdatedAt
  };
}

async function resetInstanceFromLivePrefill({ instanceId, reqUser }) {
  const reportIntegrityService = require('./reportIntegrityService');
  const instance = await reportIntegrityService.getEditableInstanceOrThrow(instanceId, reqUser);
  const statusLower = clean(instance.status).toLowerCase();
  if (statusLower === 'locked') {
    const error = new Error('Locked report instances cannot be reset from live data.');
    error.statusCode = 400;
    throw error;
  }
  if (statusLower === 'submitted') {
    const isAdminEditor = await reportViewService.isReportInstanceAdminEditor(reqUser);
    if (!isAdminEditor) {
      const error = new Error('Only an administrator can reset a submitted report from live data.');
      error.statusCode = 403;
      throw error;
    }
  }

  const [template, assignment] = await Promise.all([
    schoolDataService.getDataById('reportTemplates', instance.templateId, reqUser),
    schoolDataService.getDataById('reportAssignments', instance.assignmentId, reqUser)
  ]);
  if (!template) {
    const error = new Error('Template not found.');
    error.statusCode = 400;
    throw error;
  }

  await applyFullLivePrefillToInstance({
    instance,
    template,
    assignment,
    reqUser,
    persist: true
  });

  return {
    status: 'success',
    instanceId: toPublicId(instance.id) || instance.id,
    message: 'Private report fields were reset from live data. Shared fields were not changed.'
  };
}

module.exports = {
  applyFullLivePrefillToInstance,
  resetInstanceFromLivePrefill,
  isSharedReportField,
  buildSharedExclusivePrefillKeySet
};
