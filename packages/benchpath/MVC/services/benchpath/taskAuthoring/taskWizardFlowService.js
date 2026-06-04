const { s, arr } = require('./taskAuthoringCommon');

const WIZARD_STEPS = Object.freeze([
  Object.freeze({ number: 1, key: 'context', title: 'Context + Task Type' }),
  Object.freeze({ number: 2, key: 'intent', title: 'Intent Review' }),
  Object.freeze({ number: 3, key: 'mapping', title: 'CLB Mapping Suggestions' }),
  Object.freeze({ number: 4, key: 'construction', title: 'Task Construction' }),
  Object.freeze({ number: 5, key: 'evidence', title: 'Evidence + Assessment Design' }),
  Object.freeze({ number: 6, key: 'review', title: 'Review + Publish' })
]);

const WIZARD_STEP_COUNT = WIZARD_STEPS.length;

const STEP_INDEX = new Map(WIZARD_STEPS.map((step) => [step.number, step]));

function normalizeWizardStep(rawStep) {
  const parsed = Number.parseInt(rawStep, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(WIZARD_STEP_COUNT, parsed));
}

function getWizardStepMeta(stepNumber) {
  return STEP_INDEX.get(normalizeWizardStep(stepNumber)) || WIZARD_STEPS[0];
}

function getWizardStepList() {
  return WIZARD_STEPS.slice();
}

function nextWizardStep(stepNumber) {
  return normalizeWizardStep(stepNumber) >= WIZARD_STEP_COUNT
    ? WIZARD_STEP_COUNT
    : normalizeWizardStep(stepNumber) + 1;
}

function previousWizardStep(stepNumber) {
  return normalizeWizardStep(stepNumber) <= 1
    ? 1
    : normalizeWizardStep(stepNumber) - 1;
}

function parseListInput(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => s(entry)).filter(Boolean);
  }

  const normalized = s(value);
  if (!normalized) return [];

  return normalized
    .split(/\r?\n|,/g)
    .map((entry) => s(entry))
    .filter(Boolean);
}

function parseIdListInput(value) {
  return Array.from(new Set(parseListInput(value)));
}

function buildWizardState(task = {}) {
  const extensions = task?.extensions && typeof task.extensions === 'object'
    ? task.extensions
    : {};
  const wizard = extensions?.wizard && typeof extensions.wizard === 'object'
    ? extensions.wizard
    : {};

  return {
    currentStep: normalizeWizardStep(wizard.currentStep || 1),
    lastSavedStep: normalizeWizardStep(wizard.lastSavedStep || 1),
    completedSteps: Array.from(
      new Set(arr(wizard.completedSteps).map((entry) => normalizeWizardStep(entry)).filter((step) => step >= 1 && step <= WIZARD_STEP_COUNT))
    ).sort((a, b) => a - b),
    startedAt: s(wizard.startedAt) || null,
    lastSavedAt: s(wizard.lastSavedAt) || null,
    isPublished: s(task.status).toLowerCase() === 'published'
  };
}

function withWizardState(task = {}, nextState = {}) {
  const existingExtensions = task?.extensions && typeof task.extensions === 'object'
    ? task.extensions
    : {};
  const existingWizard = existingExtensions?.wizard && typeof existingExtensions.wizard === 'object'
    ? existingExtensions.wizard
    : {};
  const timestamp = new Date().toISOString();

  return {
    ...task,
    extensions: {
      ...existingExtensions,
      wizard: {
        ...existingWizard,
        ...nextState,
        currentStep: normalizeWizardStep(nextState.currentStep || existingWizard.currentStep || 1),
        lastSavedStep: normalizeWizardStep(nextState.lastSavedStep || existingWizard.lastSavedStep || nextState.currentStep || 1),
        completedSteps: Array.from(
          new Set(
            arr(nextState.completedSteps || existingWizard.completedSteps || [])
              .map((entry) => normalizeWizardStep(entry))
              .filter((step) => step >= 1 && step <= WIZARD_STEP_COUNT)
          )
        ).sort((a, b) => a - b),
        startedAt: s(existingWizard.startedAt) || timestamp,
        lastSavedAt: timestamp
      }
    }
  };
}

function validateWizardStep(stepNumber, taskDraft = {}) {
  const step = normalizeWizardStep(stepNumber);
  const errors = [];
  const warnings = [];

  const learnerContext = taskDraft?.learnerContext && typeof taskDraft.learnerContext === 'object'
    ? taskDraft.learnerContext
    : {};
  const classContext = taskDraft?.classContext && typeof taskDraft.classContext === 'object'
    ? taskDraft.classContext
    : {};
  const taskConditions = taskDraft?.taskConditions && typeof taskDraft.taskConditions === 'object'
    ? taskDraft.taskConditions
    : {};
  const evidencePlan = taskDraft?.evidencePlan && typeof taskDraft.evidencePlan === 'object'
    ? taskDraft.evidencePlan
    : {};

  if (step === 1) {
    if (!s(taskDraft.skill)) errors.push('Skill is required.');
    if (!s(learnerContext.goal)) errors.push('Learner goal is required.');
    if (!s(classContext.summary)) errors.push('Class context is required.');
    if (!s(learnerContext.realWorldNeed)) errors.push('Real-world need is required.');
    if (!s(taskDraft.taskType)) errors.push('Task type is required.');
    if (!s(learnerContext.clbRange) && !s(learnerContext.approximateLevel)) {
      warnings.push('Add CLB range or approximate level to improve benchmark recommendations.');
    }
  }

  if (step === 2) {
    if (!s(classContext.desiredModality)) errors.push('Desired modality/output is required.');
    if (!s(classContext.contextDomain)) errors.push('Context domain is required.');
    if (!s(taskConditions.authenticityGuidance)) errors.push('Authenticity guidance is required.');
  }

  if (step === 3) {
    if (!s(taskDraft.selectedBenchmarkId)) errors.push('Selected benchmark is required.');
    if (!arr(taskDraft.competencyIds).length) errors.push('Select at least one competency.');
    if (arr(taskDraft.competencyIds).length > 2) {
      errors.push('For a normal task, keep competency selection to 1 primary competency and at most 1 secondary competency.');
    }
    if (arr(taskDraft.competencyAreaIds).length > 2) {
      warnings.push('Competency areas look broad for a single classroom task; keep to 1 (or 2 when strongly justified).');
    }
    if (arr(taskDraft.indicatorIds).length > 4) {
      warnings.push('Indicator set looks broad; target 2-4 indicators tied to selected competencies.');
    }
    if (arr(taskDraft.featureOfCommunicationIds).length > 2) {
      warnings.push('Features of communication should stay narrow (1-2) for one assessment artifact.');
    }
    if (!arr(taskDraft.indicatorIds).length) warnings.push('Indicators are recommended for observable evidence planning.');
    if (!arr(taskDraft.sampleTaskLabelIds).length) warnings.push('Add one best-fit sample task label to keep task purpose clear.');
    if (arr(taskDraft.sampleTaskLabelIds).length > 2) {
      warnings.push('Sample task labels should usually be 1 primary and optional 1 alternate.');
    }
  }

  if (step === 4) {
    if (!s(taskDraft.realWorldScenario)) errors.push('Real-world scenario is required.');
    if (!s(taskDraft.learnerInstructions)) errors.push('Learner instructions are required.');
    if (!s(taskDraft.teacherInstructions)) errors.push('Teacher instructions are required.');
    if (!s(taskConditions.supportLevel)) warnings.push('Support level is recommended.');
  }

  if (step === 5) {
    if (!arr(evidencePlan.observableEvidence).length && !arr(evidencePlan.artifacts).length) {
      errors.push('Add observable evidence and/or artifacts.');
    }
    if (!arr(taskDraft.criteriaForSuccess).length) {
      errors.push('Add at least one criterion for success.');
    }
    if (!taskDraft.rubricDraft || !arr(taskDraft.rubricDraft.criteria).length) {
      warnings.push('Rubric draft has not been generated yet.');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

module.exports = {
  WIZARD_STEPS,
  WIZARD_STEP_COUNT,
  normalizeWizardStep,
  getWizardStepMeta,
  getWizardStepList,
  nextWizardStep,
  previousWizardStep,
  parseListInput,
  parseIdListInput,
  buildWizardState,
  withWizardState,
  validateWizardStep
};
