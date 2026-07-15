const schoolDataService = require('./schoolDataService');
const reportService = require('./reportService');
const reportViewService = require('./reportViewService');
const reportRuleEngineService = require('./reportRuleEngineService');

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

  const assignmentForValidation = studentTargeted
    ? {
        ...(assignment || {}),
        sharedAnswers: {
          ...((assignment?.sharedAnswers && typeof assignment.sharedAnswers === 'object') ? assignment.sharedAnswers : {}),
          ...nextShared
        }
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
    await schoolDataService.updateData('reportAssignments', assignment.id, {
      sharedAnswers: nextShared
    }, reqUser);
  }

  const updatedInstance = await schoolDataService.updateData('reportInstances', instance.id, {
    answers: studentAnswers,
    status: nextStatus,
    audit: {
      lastUpdateUser: reqUser?.id || '',
      lastUpdateDateTime: new Date().toISOString(),
      submittedAt: nextStatus === 'submitted'
        ? (instance.audit?.submittedAt || new Date().toISOString())
        : instance.audit?.submittedAt
    }
  }, reqUser);

  return {
    updatedInstance,
    nextStatus,
    studentAnswers,
    sharedAnswers: nextShared,
    validationSummary,
    mergedAnswers: mergedForValidation
  };
}

module.exports = {
  isVisualOnlyField,
  persistInstanceAnswers
};
