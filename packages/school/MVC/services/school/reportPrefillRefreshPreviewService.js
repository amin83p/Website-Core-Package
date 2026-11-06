const reportService = require('./reportService');
const reportRuleEngineService = require('./reportRuleEngineService');
const reportGenerationEngineService = require('./reportGenerationEngineService');
const { getPrefillValue } = require('./reportPrefillKeyUtils');

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

/**
 * Compare live merge baseline (stored answers + prefill) vs full merge after fresh prefill.
 */
async function buildPrefillRefreshPreview({ instance, template, assignment, reqUser }) {
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

  const baselineMerged = reportService.mergeTemplateDataLivePersisted(
    template,
    instance,
    assignment,
    { scopeOptions: editorMergeOptions }
  );
  const refreshedMerged = reportService.mergeTemplateDataLivePersisted(
    template,
    {
      ...instance,
      prefillSnapshot: refreshedPrefill
    },
    assignment,
    { scopeOptions: editorMergeOptions }
  );

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
    const baselineVal = baselineMerged[fieldId];
    const refreshedVal = refreshedMerged[fieldId];

    if (valueMode === 'calculated' || valueMode === 'derived_editable') {
      if (stableValueToken(baselineVal) === stableValueToken(refreshedVal)) return;

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
          currentValue: baselineVal,
          oldRawValue: oldExprValue,
          newRawValue: newExprValue,
          skippedDueToOverride
        }]
      });
      return;
    }

    const prefillKey = reportService.normalizePrefillKey(field?.prefillKey || '');
    if (!prefillKey) return;

    const oldResolved = getPrefillValue(oldPrefill, prefillKey);
    const newResolved = getPrefillValue(refreshedPrefill, prefillKey);
    if (!newResolved.found) return;

    const oldRawValue = oldResolved.found ? oldResolved.value : undefined;
    const newRawValue = newResolved.value;
    const oldValue = coercePrefillValueForField(field, oldRawValue);
    const baselineVersusRefreshed = stableValueToken(baselineVal) !== stableValueToken(refreshedVal);
    const prefillRawChanged = stableValueToken(oldRawValue) !== stableValueToken(newRawValue);
    if (!baselineVersusRefreshed && !prefillRawChanged) return;

    if (!changesByKey.has(prefillKey)) {
      changesByKey.set(prefillKey, {
        prefillKey,
        oldRawValue,
        newRawValue,
        fields: []
      });
    }

    changesByKey.get(prefillKey).fields.push({
      fieldId,
      label: String(field.label || field.id || ''),
      type,
      oldValue,
      newValue: refreshedVal,
      currentValue: baselineVal,
      oldRawValue,
      newRawValue,
      skippedDueToOverride: instance?.derivedOverrides?.[fieldId] === true
    });
  });

  return {
    refreshedPrefill,
    changes: Array.from(changesByKey.values())
  };
}

module.exports = {
  buildPrefillRefreshPreview
};
