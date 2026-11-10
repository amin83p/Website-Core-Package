const schoolDataService = require('./schoolDataService');
const reportService = require('./reportService');
const reportViewService = require('./reportViewService');
const reportRuleEngineService = require('./reportRuleEngineService');
const reportGenerationEngineService = require('./reportGenerationEngineService');
const reportAssignmentModel = require('../../models/school/reportAssignmentModel');
const sessionConductReportLockService = require('./sessionConductReportLockService');
const { getPrefillValue, isAutoRefreshPrefillKey } = require('./reportPrefillKeyUtils');

function isVisualOnlyField(field = {}) {
  const type = String(field?.type || '').trim().toLowerCase();
  return type === 'section' || type === 'subheader' || type === 'row_break';
}

async function persistInstanceAnswers({
  instance,
  template,
  assignment,
  body = {},
  submitAction = '',
  reqUser
} = {}) {
  if (!instance?.id) throw new Error('Report instance is required.');
  if (!template) throw new Error('Template not found.');

  function stableValueToken(value) {
    if (value === undefined) return '__undefined__';
    try {
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }

  const mergedBeforeSave = reportService.mergeTemplateData(template, instance, assignment);
  const parsedAnswers = reportViewService.buildInstanceAnswers(template, body, mergedBeforeSave);
  const recomputedBeforeSave = reportService.recomputeCalculatedAnswers({
    template,
    mergedAnswers: parsedAnswers.answers,
    prefill: instance?.prefillSnapshot || {}
  });
  const fullAnswers = recomputedBeforeSave.answers;
  const { studentAnswers, sharedAnswers } = reportService.partitionInstanceSave(template, assignment, fullAnswers);
  const requestedAction = String(submitAction || body?.submitAction || '').trim().toLowerCase();
  const nextStatus = reportViewService.resolveInstanceNextStatus(instance, requestedAction);
  const fields = Array.isArray(template?.schema?.fields) ? template.schema.fields : [];
  const derivedOverrides = {
    ...(instance?.derivedOverrides && typeof instance.derivedOverrides === 'object' ? instance.derivedOverrides : {})
  };
  const prefillSnapshot = instance?.prefillSnapshot && typeof instance.prefillSnapshot === 'object'
    ? instance.prefillSnapshot
    : {};
  fields.forEach((field) => {
    if (!field?.id || isVisualOnlyField(field)) return;
    const autoRefreshKey = isAutoRefreshPrefillKey(field?.prefillKey);
    if (autoRefreshKey) {
      const resolved = getPrefillValue(prefillSnapshot, field.prefillKey);
      if (resolved.found) {
        const prefillValue = reportGenerationEngineService.coercePrefillValueForField(field, resolved.value);
        const submitted = studentAnswers[field.id];
        derivedOverrides[field.id] = stableValueToken(submitted) !== stableValueToken(prefillValue);
      }
      return;
    }
    if (!reportRuleEngineService.isDerivedEditableField(field)) return;
    const rule = reportRuleEngineService.normalizeCalculationRule(field?.calculationRule || {});
    if (!rule.expression) return;
    try {
      const computed = reportRuleEngineService.evaluateSafeExpression(rule.expression, {
        value: studentAnswers[field.id],
        answers: studentAnswers,
        prefill: prefillSnapshot
      });
      const submitted = studentAnswers[field.id];
      derivedOverrides[field.id] = stableValueToken(computed) !== stableValueToken(submitted);
    } catch (_) {
      derivedOverrides[field.id] = true;
    }
  });

  const sharedFieldIds = fields
    .filter((field) => !isVisualOnlyField(field) && field?.sharedAcrossStudents === true && field?.id)
    .map((field) => String(field.id));
  const studentTargeted = reportService.isStudentTargetedScope(assignment?.reportScope);
  const nextShared = {};

  if (studentTargeted) {
    sharedFieldIds.forEach((fieldId) => {
      nextShared[fieldId] = sharedAnswers[fieldId];
    });
  }

  let sharedAnswersSkipped = false;
  let sharedAnswersSkipReason = '';
  if (studentTargeted && sharedFieldIds.length > 0 && assignment?.id) {
    const assignmentRowIdForGate = instance.assignmentRowId || '';
    const siblingInstances = await reportViewService.loadAssignmentInstancesForSharedGate(assignment.id, reqUser, {
      assignmentRowId: assignmentRowIdForGate
    });
    const allowAdminOverride = await reportViewService.isReportInstanceAdminEditor(reqUser);
    const sharedGate = reportViewService.evaluateSharedFieldsEditability({
      assignment,
      template,
      instances: siblingInstances,
      currentInstanceId: instance.id,
      assignmentRowId: assignmentRowIdForGate,
      allowAdminOverride
    });
    if (!sharedGate.sharedFieldsEditable) {
      sharedAnswersSkipped = true;
      sharedAnswersSkipReason = sharedGate.reason || 'Shared fields are locked while other reports are not draft.';
    }
  }

  const assignmentRowIdForSave = String(instance?.assignmentRowId || assignment?.assignmentRowId || '').trim();
  const rowSharedBaseline = reportAssignmentModel.resolveSharedAnswersForRow(assignment, assignmentRowIdForSave);

  const effectiveSharedForValidation = sharedAnswersSkipped
    ? rowSharedBaseline
    : {
        ...rowSharedBaseline,
        ...nextShared
      };
  const assignmentForValidation = studentTargeted
    ? {
        ...(assignment || {}),
        sharedAnswers: effectiveSharedForValidation
      }
    : assignment;
  const mergedForValidation = reportService.mergeTemplateData(
    template,
    {
      ...(instance || {}),
      answers: studentAnswers,
      prefillSnapshot: instance?.prefillSnapshot || {}
    },
    assignmentForValidation
  );
  const validationSummary = reportRuleEngineService.evaluateTemplateValidations({
    template,
    mergedAnswers: mergedForValidation,
    prefill: instance?.prefillSnapshot || {},
    extraIssues: parsedAnswers.issues
  });
  const isSubmitAction = requestedAction === 'submit';

  if (isSubmitAction && validationSummary.hasBlockingErrors) {
    const firstError = validationSummary.errors[0];
    const error = new Error(validationSummary.errors.length > 1
      ? `${firstError.message} (+${validationSummary.errors.length - 1} more validation error(s)).`
      : firstError.message);
    error.validationSummary = validationSummary;
    throw error;
  }

  if (studentTargeted && sharedFieldIds.length > 0 && assignment?.id) {
    if (!sharedAnswersSkipped) {
      const sharedUpdate = reportAssignmentModel.buildSharedAnswersByRowUpdate(
        assignment,
        assignmentRowIdForSave,
        nextShared
      );
      await schoolDataService.updateData('reportAssignments', assignment.id, sharedUpdate, reqUser);
    }
  }

  const nowIso = new Date().toISOString();
  const templateVersionForCache = Number(template?.version || instance.templateVersion || 1) || 1;
  const renderCache = {
    templateId: String(template?.id || instance.templateId || '').trim(),
    templateVersion: templateVersionForCache,
    capturedAt: nowIso,
    mergedAnswers: { ...mergedForValidation }
  };

  const sharedAuditBase = {
    lastUpdateUser: reqUser?.id || '',
    lastUpdateDateTime: nowIso,
    lastDraftSavedAt: nowIso,
    ...(instance.audit?.firstSavedAt ? {} : { firstSavedAt: nowIso })
  };

  let updatedInstance;
  if (isSubmitAction && nextStatus === 'submitted') {
    // Two-step persist: same answers/renderCache as draft, then status submitted (audit trail).
    await schoolDataService.updateData('reportInstances', instance.id, {
      answers: studentAnswers,
      derivedOverrides,
      status: 'draft',
      renderCache,
      audit: {
        ...sharedAuditBase,
        submittedAt: instance.audit?.submittedAt
      }
    }, reqUser);
    const submittedAtIso = new Date().toISOString();
    updatedInstance = await schoolDataService.updateData('reportInstances', instance.id, {
      status: 'submitted',
      audit: {
        lastUpdateUser: reqUser?.id || '',
        lastUpdateDateTime: submittedAtIso,
        submittedAt: submittedAtIso
      }
    }, reqUser);
    try {
      await sessionConductReportLockService.lockConductForSubmittedReport({
        instance: { ...instance, ...updatedInstance, audit: { ...(instance.audit || {}), ...(updatedInstance?.audit || {}), submittedAt: submittedAtIso } },
        assignment,
        reqUser
      });
    } catch (_) {
      /* conduct lock is best-effort */
    }
  } else {
    updatedInstance = await schoolDataService.updateData('reportInstances', instance.id, {
      answers: studentAnswers,
      derivedOverrides,
      status: nextStatus,
      renderCache,
      audit: {
        ...sharedAuditBase,
        submittedAt: instance.audit?.submittedAt
      }
    }, reqUser);
  }

  return {
    updatedInstance,
    nextStatus,
    studentAnswers,
    sharedAnswers: sharedAnswersSkipped
      ? rowSharedBaseline
      : { ...rowSharedBaseline, ...nextShared },
    sharedAnswersSkipped,
    sharedAnswersSkipReason,
    validationSummary,
    mergedAnswers: mergedForValidation
  };
}

module.exports = {
  isVisualOnlyField,
  persistInstanceAnswers
};
