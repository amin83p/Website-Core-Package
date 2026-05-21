const { s, arr } = require('./taskAuthoringCommon');

function hasMeaningfulText(value, minLength = 24) {
  return s(value).length >= minLength;
}

function classifyPortfolioFit(taskDraft = {}) {
  const reasons = [];
  const missingRequirements = [];
  let score = 0;
  const maxScore = 10;

  const taskType = s(taskDraft.taskType).toLowerCase();
  if (taskType === 'assessment') {
    score += 2;
    reasons.push('Task is classified as assessment.');
  } else {
    missingRequirements.push('Task is currently classified as enabling, which may limit PBLA artifact suitability.');
  }

  if (hasMeaningfulText(taskDraft.realWorldScenario, 28)) {
    score += 2;
    reasons.push('Real-world scenario is documented.');
  } else {
    missingRequirements.push('Real-world scenario needs clearer authentic context.');
  }

  const evidencePlan = taskDraft.evidencePlan && typeof taskDraft.evidencePlan === 'object'
    ? taskDraft.evidencePlan
    : {};
  const observableEvidence = arr(evidencePlan.observableEvidence);
  const artifacts = arr(evidencePlan.artifacts);
  if (observableEvidence.length > 0 || artifacts.length > 0) {
    score += 2;
    reasons.push('Evidence collection is observable and/or artifact-based.');
  } else {
    missingRequirements.push('Evidence plan needs observable evidence or artifact collection.');
  }

  const criteria = arr(taskDraft.criteriaForSuccess);
  if (criteria.length >= 2) {
    score += 2;
    reasons.push('Criteria for success are present and usable.');
  } else {
    missingRequirements.push('Criteria for success should include at least two observable criteria.');
  }

  if (s(taskDraft.selectedBenchmarkId) && s(taskDraft.skill)) {
    score += 1;
    reasons.push('Task has explicit CLB benchmark and skill mapping.');
  } else {
    missingRequirements.push('Task requires explicit skill and benchmark mapping.');
  }

  const hasTraceability = Boolean(taskDraft?.wizardTrace?.traceabilityRefs)
    || arr(taskDraft.competencyIds).length > 0
    || arr(taskDraft.indicatorIds).length > 0;
  if (hasTraceability) {
    score += 1;
    reasons.push('Reference traceability metadata is available.');
  } else {
    missingRequirements.push('Add reference traceability for competencies/indicators/source fragments.');
  }

  const rating = score >= 8 ? 'strong' : score >= 5 ? 'moderate' : 'low';
  const classification = score >= 8
    ? 'suitable'
    : score >= 5
      ? 'review_required'
      : 'not_suitable';

  return {
    classification,
    rating,
    score,
    maxScore,
    reasons,
    missingRequirements
  };
}

module.exports = {
  classifyPortfolioFit
};
