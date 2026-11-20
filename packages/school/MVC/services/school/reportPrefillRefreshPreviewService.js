const reportService = require('./reportService');
const reportRuleEngineService = require('./reportRuleEngineService');
const reportGenerationEngineService = require('./reportGenerationEngineService');
const reportAssignmentModel = require('../../models/school/reportAssignmentModel');
const { getPrefillValue } = require('./reportPrefillKeyUtils');
const {
  pickPrimaryMirrorKey,
  collapseMirrorPrefillChanges,
  isSnapshotKeyCoveredByPrimary,
  mirrorKeysForChange
} = require('./reportPrefillMirrorKeys');

function isVisualOnlyField(field = {}) {
  const type = String(field?.type || '').trim().toLowerCase();
  return type === 'section' || type === 'subheader' || type === 'row_break';
}

function stableValueToken(value) {
  return reportGenerationEngineService.stableValueToken(value);
}

function stableValueTokenForField(field, value) {
  const type = String(field?.type || '').trim().toLowerCase();
  if (type === 'date') {
    const coerced = reportGenerationEngineService.coerceDateFieldValue(value);
    if (coerced) return stableValueToken(coerced);
  }
  return stableValueToken(value);
}

function resolveStoredFieldValue(field, instance, assignment) {
  const fieldId = String(field?.id || '').trim();
  if (!fieldId) return undefined;
  if (field.sharedAcrossStudents === true && assignment) {
    const shared = reportAssignmentModel.resolveSharedAnswersForRow(
      assignment,
      instance?.assignmentRowId || assignment?.assignmentRowId || assignment?.rowId || ''
    );
    if (Object.prototype.hasOwnProperty.call(shared, fieldId)) {
      return shared[fieldId];
    }
  }
  return instance?.answers?.[fieldId];
}

function resolveRawCachedFieldValue(instance, template, fieldId) {
  const tid = String(template?.id || '').trim();
  const rc = instance?.renderCache;
  if (!rc?.mergedAnswers || typeof rc.mergedAnswers !== 'object') return undefined;
  if (tid && String(rc.templateId || '').trim() !== tid) return undefined;
  return rc.mergedAnswers[fieldId];
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

function resolveCurrentDisplayValue(field, persistedVal, gridVal, instance, assignment) {
  if (persistedVal !== undefined) return persistedVal;
  if (gridVal !== undefined) return gridVal;
  return resolveStoredFieldValue(field, instance, assignment);
}

function proposalDiffersFromCurrent(field, proposedValue, currentValue) {
  if (!field) {
    return stableValueToken(proposedValue) !== stableValueToken(currentValue);
  }
  return stableValueTokenForField(field, proposedValue) !== stableValueTokenForField(field, currentValue);
}

function resolveFieldPrefillPreviewOffer({
  field,
  instance,
  template,
  assignment,
  oldPrefill,
  refreshedPrefill,
  persistedDisplayAnswers,
  gridDisplay,
  refreshedAnswers
}) {
  const fieldId = String(field.id);
  const valueMode = reportRuleEngineService.normalizeValueMode(field?.valueMode);
  const type = String(field?.type || '').trim().toLowerCase();
  const persistedVal = persistedDisplayAnswers[fieldId];
  const gridVal = gridDisplay ? gridDisplay[fieldId] : undefined;
  const refreshedVal = refreshedAnswers[fieldId];
  const currentValue = resolveCurrentDisplayValue(field, persistedVal, gridVal, instance, assignment);
  const storedAnswerVal = resolveStoredFieldValue(field, instance, assignment);
  const rawCachedVal = resolveRawCachedFieldValue(instance, template, fieldId);

  if (valueMode === 'calculated' || valueMode === 'derived_editable') {
    const baselineVersusTarget = stableValueTokenForField(field, persistedVal) !== stableValueTokenForField(field, refreshedVal);
    const gridVersusTarget = gridDisplay
      && stableValueTokenForField(field, gridVal) !== stableValueTokenForField(field, refreshedVal);
    const storedVersusTarget = stableValueTokenForField(field, refreshedVal) !== stableValueTokenForField(field, storedAnswerVal);
    const cacheVersusTarget = stableValueTokenForField(field, refreshedVal) !== stableValueTokenForField(field, rawCachedVal);
    const proposedValue = refreshedVal;
    const shouldOffer = baselineVersusTarget || gridVersusTarget || storedVersusTarget || cacheVersusTarget
      || proposalDiffersFromCurrent(field, proposedValue, currentValue);
    const oldExprValue = evaluateExpressionFieldValue(field, instance?.answers || {}, oldPrefill);
    const newExprValue = evaluateExpressionFieldValue(field, instance?.answers || {}, refreshedPrefill);
    return {
      shouldOffer,
      kind: 'expression',
      currentValue,
      proposedValue,
      oldExprValue,
      newExprValue,
      skippedDueToOverride: valueMode === 'derived_editable' && instance?.derivedOverrides?.[fieldId] === true
    };
  }

  const prefillKey = reportService.normalizePrefillKey(field?.prefillKey || '');
  const oldResolved = prefillKey ? getPrefillValue(oldPrefill, prefillKey) : { found: false };
  const newResolved = prefillKey ? getPrefillValue(refreshedPrefill, prefillKey) : { found: false };
  const prefillRawChanged = prefillKey && newResolved.found
    && stableValueToken(oldResolved.found ? oldResolved.value : undefined) !== stableValueToken(newResolved.value);
  const coercedLivePrefill = prefillKey && newResolved.found
    ? coercePrefillValueForField(field, newResolved.value)
    : undefined;
  const proposedValue = prefillKey && newResolved.found ? coercedLivePrefill : refreshedVal;
  const baselineVersusTarget = stableValueTokenForField(field, persistedVal) !== stableValueTokenForField(field, refreshedVal);
  const gridVersusTarget = gridDisplay
    && stableValueTokenForField(field, gridVal) !== stableValueTokenForField(field, refreshedVal);
  const shouldOffer = proposalDiffersFromCurrent(field, proposedValue, currentValue)
    || prefillRawChanged
    || baselineVersusTarget
    || gridVersusTarget;

  const oldRawValue = prefillKey && oldResolved.found ? oldResolved.value : undefined;
  const newRawValue = prefillKey && newResolved.found ? newResolved.value : undefined;
  const oldValue = prefillKey ? coercePrefillValueForField(field, oldRawValue) : persistedVal;

  return {
    shouldOffer,
    kind: 'prefill',
    prefillKey,
    currentValue,
    proposedValue,
    oldValue,
    oldRawValue,
    newRawValue,
    type,
    skippedDueToOverride: instance?.derivedOverrides?.[fieldId] === true
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
  const reportScope = assignment?.reportScope || '';

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

  const changesByKey = new Map();

  fields.forEach((field) => {
    if (!field?.id || isVisualOnlyField(field)) return;
    if (scopeCtx.active
      && !reportService.fieldIsInSnapshotScope(field, scopeCtx.baseLowerSet, scopeCtx.placeholderMap)) {
      return;
    }

    const fieldId = String(field.id);
    const offer = resolveFieldPrefillPreviewOffer({
      field,
      instance,
      assignment,
      template,
      oldPrefill,
      refreshedPrefill,
      persistedDisplayAnswers,
      gridDisplay,
      refreshedAnswers
    });
    if (!offer.shouldOffer) return;

    if (offer.kind === 'expression') {
      const type = String(field?.type || '').trim().toLowerCase();
      const changeKey = `__field__${fieldId}`;
      const persistedVal = persistedDisplayAnswers[fieldId];
      const gridVal = gridDisplay ? gridDisplay[fieldId] : undefined;
      changesByKey.set(changeKey, {
        prefillKey: changeKey,
        expressionDriven: true,
        fieldId,
        oldRawValue: offer.oldExprValue,
        newRawValue: offer.newExprValue,
        fields: [{
          fieldId,
          label: String(field.label || field.id || ''),
          type,
          oldValue: coerceExpressionValueForField(field, offer.oldExprValue),
          newValue: offer.proposedValue,
          currentValue: persistedVal !== undefined ? persistedVal : gridVal,
          oldRawValue: offer.oldExprValue,
          newRawValue: offer.newExprValue,
          skippedDueToOverride: offer.skippedDueToOverride
        }]
      });
      return;
    }

    const changeKey = offer.prefillKey || `__field__${fieldId}`;
    if (!changesByKey.has(changeKey)) {
      changesByKey.set(changeKey, {
        prefillKey: changeKey,
        expressionDriven: false,
        oldRawValue: offer.oldRawValue,
        newRawValue: offer.newRawValue,
        fields: []
      });
    }
    changesByKey.get(changeKey).fields.push({
      fieldId,
      label: String(field.label || field.id || ''),
      type: offer.type,
      oldValue: offer.oldValue,
      newValue: offer.proposedValue,
      currentValue: offer.currentValue,
      oldRawValue: offer.oldRawValue,
      newRawValue: offer.newRawValue,
      skippedDueToOverride: offer.skippedDueToOverride
    });
  });

  const templateFillKeys = reportService.resolveTemplateFillKeys(template);
  const templateFillKeySet = new Set(
    [...templateFillKeys].map((key) => String(key || '').trim().toLowerCase()).filter(Boolean)
  );
  changedPrefillKeys.forEach((prefillKey) => {
    const normalized = reportService.normalizePrefillKey(prefillKey);
    if (!normalized) return;
    if (!templateFillKeySet.has(normalized.toLowerCase())) return;
    if (isSnapshotKeyCoveredByPrimary(changesByKey, reportScope, normalized)) return;
    const primary = pickPrimaryMirrorKey(reportScope, normalized);
    if (normalized.toLowerCase() !== primary.toLowerCase() && changesByKey.has(primary)) return;
    if (changesByKey.has(normalized)) return;
    const oldResolved = getPrefillValue(oldPrefill, normalized);
    const newResolved = getPrefillValue(refreshedPrefill, normalized);
    if (!newResolved.found) return;
    if (stableValueToken(oldResolved.found ? oldResolved.value : undefined) === stableValueToken(newResolved.value)) {
      return;
    }

    const mappedField = reportService.findFieldForSnapshotKey(template, normalized);
    let currentValue = oldResolved.found ? oldResolved.value : '';
    let newValue = newResolved.value;
    let fieldId = '';
    if (mappedField && !isVisualOnlyField(mappedField)) {
      fieldId = String(mappedField.id || '');
      currentValue = resolveCurrentDisplayValue(
        mappedField,
        persistedDisplayAnswers[fieldId],
        gridDisplay ? gridDisplay[fieldId] : undefined,
        instance,
        assignment
      );
      newValue = coercePrefillValueForField(mappedField, newResolved.value);
      if (!proposalDiffersFromCurrent(mappedField, newValue, currentValue)) return;
    }

    changesByKey.set(normalized, {
      prefillKey: normalized,
      expressionDriven: false,
      oldRawValue: oldResolved.found ? oldResolved.value : undefined,
      newRawValue: newResolved.value,
      fields: [{
        fieldId,
        label: reportService.resolveSnapshotKeyLabel(template, normalized)
          || reportService.getPrefillCatalogLabel(normalized)
          || normalized,
        type: mappedField ? String(mappedField.type || 'prefill') : 'prefill',
        prefillOnly: !fieldId,
        oldValue: oldResolved.found ? oldResolved.value : '',
        newValue,
        currentValue,
        oldRawValue: oldResolved.found ? oldResolved.value : undefined,
        newRawValue: newResolved.value,
        skippedDueToOverride: fieldId ? instance?.derivedOverrides?.[fieldId] === true : false
      }]
    });
  });

  const changes = Array.from(changesByKey.values())
    .map((change) => {
      const visibleFields = (change.fields || []).filter(Boolean);
      let prefillKeyLabel = '';
      if (change.expressionDriven) {
        prefillKeyLabel = String(visibleFields[0]?.label || '').trim() || 'Calculated field';
      } else if (String(change.prefillKey || '').startsWith('__field__')) {
        prefillKeyLabel = String(visibleFields[0]?.label || visibleFields[0]?.fieldId || '').trim();
      } else {
        prefillKeyLabel = reportService.resolveSnapshotKeyLabel(template, change.prefillKey);
      }
      if (!prefillKeyLabel) {
        prefillKeyLabel = reportService.getPrefillCatalogLabel(change.prefillKey)
          || String(change.prefillKey || '').trim();
      }
      return {
        ...change,
        prefillKeyLabel,
        fields: visibleFields
      };
    })
    .filter((change) => change.fields.length > 0)
    .map((change) => {
      const mirrors = mirrorKeysForChange(reportScope, change.prefillKey, refreshedPrefill);
      if (!mirrors.length) return change;
      const existing = new Set(Array.isArray(change.mirrorKeys) ? change.mirrorKeys : []);
      mirrors.forEach((key) => existing.add(key));
      return { ...change, mirrorKeys: [...existing] };
    });

  const collapsed = collapseMirrorPrefillChanges(changes, { reportScope, template });

  return {
    refreshedPrefill,
    changes: collapsed
  };
}

module.exports = {
  buildPrefillRefreshPreview
};