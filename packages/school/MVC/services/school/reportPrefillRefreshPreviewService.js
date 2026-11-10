const reportService = require('./reportService');
const reportRuleEngineService = require('./reportRuleEngineService');
const reportGenerationEngineService = require('./reportGenerationEngineService');
const { getPrefillValue, isAutoRefreshPrefillKey } = require('./reportPrefillKeyUtils');

function isVisualOnlyField(field = {}) {
  const type = String(field?.type || '').trim().toLowerCase();
  return type === 'section' || type === 'subheader' || type === 'row_break';
}

function stableValueToken(value) {
  return reportGenerationEngineService.stableValueToken(value);
}

function coercePrefillValueForField(field, rawPrefill) {
  return reportGenerationEngineService.coercePrefillValueForField(field, rawPrefill);
}

function coerceExpressionValueForField(field, rawValue) {
  return reportGenerationEngineService.coerceExpressionValueForField(field, rawValue);
}

function evaluateExpressionFieldValue(field, answers, prefill) {
  return reportGenerationEngineService.evaluateExpressionFieldValue(field, answers, prefill);
}

function buildAssignmentSnapshotFallback(instance, assignment) {
  return assignment || {
    classId: instance.classId,
    orgId: instance.orgId,
    sessionId: instance.sessionId,
    sessionDate: instance.sessionDate,
    teacherIds: [instance.teacherId].filter(Boolean),
    reportStartDate: instance.reportStartDate,
    reportDueDate: instance.reportDueDate,
    dueDate: instance.dueDate
  };
}

function collectChangedPrefillKeys(oldPrefill = {}, refreshedPrefill = {}) {
  const keys = new Set([...Object.keys(oldPrefill), ...Object.keys(refreshedPrefill)]);
  const changed = [];
  keys.forEach((key) => {
    if (stableValueToken(oldPrefill[key]) !== stableValueToken(refreshedPrefill[key])) {
      changed.push(key);
    }
  });
  return changed;
}

function fieldUsesPrefillKey(field, prefillKey) {
  const normalized = reportService.normalizePrefillKey(field?.prefillKey || '');
  if (normalized && normalized === prefillKey) return true;
  const expression = String(field?.calculationRule?.expression || '');
  return expression.includes(`prefill.${prefillKey}`);
}

function pickRenderCacheMerged(template, renderCache) {
  const tid = String(template?.id || '').trim();
  if (!renderCache?.mergedAnswers || typeof renderCache.mergedAnswers !== 'object') return null;
  if (tid && String(renderCache.templateId || '').trim() !== tid) return null;
  return { ...renderCache.mergedAnswers };
}

function resolvePrefillPreviewBaselineMerged(template, instance, assignment, editorMergeOptions) {
  const fromLiveCache = pickRenderCacheMerged(template, instance?.renderCache);
  if (fromLiveCache) return { merged: fromLiveCache, source: 'renderCache', skipRecalculation: true };
  const fromReopenBaseline = pickRenderCacheMerged(template, instance?.audit?.prefillPreviewBaselineCache);
  if (fromReopenBaseline) {
    return { merged: fromReopenBaseline, source: 'reopenBaseline', skipRecalculation: true };
  }
  return {
    merged: reportService.mergeTemplateDataLivePersisted(
      template,
      instance,
      assignment,
      { scopeOptions: editorMergeOptions }
    ),
    source: 'livePersisted',
    skipRecalculation: false
  };
}

/**
 * Compare last-saved display (render cache when present) vs merge after fresh prefill,
 * keeping stored private answers (selective prefill refresh — not full live reset).
 */
async function buildPrefillRefreshPreview({ instance, template, assignment, reqUser, gridDisplayAnswers = null }) {
  const oldPrefill = instance?.prefillSnapshot && typeof instance.prefillSnapshot === 'object'
    ? instance.prefillSnapshot
    : {};
  const refreshedPrefill = await reportService.buildPrefillSnapshot({
    assignment: buildAssignmentSnapshotFallback(instance, assignment),
    teacherId: instance.teacherId,
    studentId: instance.studentId,
    reqUser,
    requiredKeys: reportService.resolveTemplateFillKeys(template)
  });
  const fields = Array.isArray(template?.schema?.fields) ? template.schema.fields : [];
  const scopeCtx = reportService.resolveSnapshotScopeContext(template);
  const editorMergeOptions = reportService.templateUsesSnapshotScope(template)
    ? { respectSnapshotKeys: true }
    : {};

  const baselineResolved = resolvePrefillPreviewBaselineMerged(template, instance, assignment, editorMergeOptions);
  const baselinePrepared = reportRuleEngineService.prepareReportAnswersForUI({
    template,
    mergedAnswers: baselineResolved.merged,
    prefill: oldPrefill,
    skipRecalculation: baselineResolved.skipRecalculation
  });
  const persistedDisplayAnswers = baselinePrepared.displayAnswers || {};
  const gridDisplay = gridDisplayAnswers && typeof gridDisplayAnswers === 'object'
    ? gridDisplayAnswers
    : null;

  const targetMergedRaw = reportService.mergeTemplateDataLivePersisted(
    template,
    {
      ...instance,
      prefillSnapshot: refreshedPrefill
    },
    assignment,
    { scopeOptions: editorMergeOptions }
  );
  const targetPrepared = reportRuleEngineService.prepareReportAnswersForUI({
    template,
    mergedAnswers: targetMergedRaw,
    prefill: refreshedPrefill,
    skipRecalculation: false
  });
  const refreshedAnswers = targetPrepared.displayAnswers || {};

  const changedPrefillKeys = collectChangedPrefillKeys(oldPrefill, refreshedPrefill);
  const changedAutoRefreshKeys = changedPrefillKeys.filter((key) => isAutoRefreshPrefillKey(key));

  const changesByKey = new Map();

  fields.forEach((field) => {
    const type = String(field?.type || '').trim().toLowerCase();
    if (!field?.id || isVisualOnlyField(field)) return;
    if (scopeCtx.active
      && !reportService.fieldIsInSnapshotScope(field, scopeCtx.baseLowerSet, scopeCtx.placeholderMap)) {
      return;
    }

    const fieldId = String(field.id);
    const valueMode = reportRuleEngineService.normalizeValueMode(field?.valueMode);
    const persistedVal = persistedDisplayAnswers[fieldId];
    const gridVal = gridDisplay ? gridDisplay[fieldId] : undefined;
    const refreshedVal = refreshedAnswers[fieldId];
    const baselineVersusTarget = stableValueToken(persistedVal) !== stableValueToken(refreshedVal);
    const gridVersusTarget = gridDisplay && stableValueToken(gridVal) !== stableValueToken(refreshedVal);

    const prefillKey = reportService.normalizePrefillKey(field?.prefillKey || '');
    const oldResolved = prefillKey ? getPrefillValue(oldPrefill, prefillKey) : { found: false };
    const newResolved = prefillKey ? getPrefillValue(refreshedPrefill, prefillKey) : { found: false };
    const prefillRawChanged = prefillKey && newResolved.found
      && stableValueToken(oldResolved.found ? oldResolved.value : undefined) !== stableValueToken(newResolved.value);

    if (!baselineVersusTarget && !gridVersusTarget) {
      return;
    }

    if (valueMode === 'calculated' || valueMode === 'derived_editable') {
      const oldExprValue = evaluateExpressionFieldValue(field, instance?.answers || {}, oldPrefill);
      const newExprValue = evaluateExpressionFieldValue(field, instance?.answers || {}, refreshedPrefill);
      const changeKey = `__field__${fieldId}`;
      const skippedDueToOverride = valueMode === 'derived_editable'
        && instance?.derivedOverrides?.[fieldId] === true;

      changesByKey.set(changeKey, {
        prefillKey: changeKey,
        expressionDriven: true,
        fieldId,
        oldRawValue: oldExprValue,
        newRawValue: newExprValue,
        fields: [{
          fieldId,
          label: String(field.label || field.id || ''),
          type,
          oldValue: coerceExpressionValueForField(field, oldExprValue),
          newValue: refreshedVal,
          currentValue: persistedVal !== undefined ? persistedVal : gridVal,
          oldRawValue: oldExprValue,
          newRawValue: newExprValue,
          skippedDueToOverride
        }]
      });
      return;
    }

    const oldRawValue = prefillKey && oldResolved.found ? oldResolved.value : undefined;
    const newRawValue = prefillKey && newResolved.found ? newResolved.value : undefined;
    const oldValue = prefillKey ? coercePrefillValueForField(field, oldRawValue) : persistedVal;
    const changeKey = prefillKey || `__field__${fieldId}`;
    if (!changesByKey.has(changeKey)) {
      changesByKey.set(changeKey, {
        prefillKey: changeKey,
        expressionDriven: false,
        oldRawValue,
        newRawValue,
        fields: []
      });
    }
    changesByKey.get(changeKey).fields.push({
      fieldId,
      label: String(field.label || field.id || ''),
      type,
      oldValue,
      newValue: refreshedVal,
      currentValue: persistedVal !== undefined ? persistedVal : gridVal,
      oldRawValue,
      newRawValue,
      skippedDueToOverride: instance?.derivedOverrides?.[fieldId] === true
    });
  });

  function fieldDisplayWouldChange(fieldId) {
    const persisted = persistedDisplayAnswers[fieldId];
    const grid = gridDisplay ? gridDisplay[fieldId] : undefined;
    const refreshed = refreshedAnswers[fieldId];
    return stableValueToken(persisted) !== stableValueToken(refreshed)
      || (gridDisplay && stableValueToken(grid) !== stableValueToken(refreshed));
  }

  const changes = Array.from(changesByKey.values())
    .map((change) => ({
      ...change,
      fields: (change.fields || []).filter((field) => fieldDisplayWouldChange(field.fieldId))
    }))
    .filter((change) => change.fields.length > 0);

  return {
    refreshedPrefill,
    changes
  };
}

module.exports = {
  buildPrefillRefreshPreview
};
