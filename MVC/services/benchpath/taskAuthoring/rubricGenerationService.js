const { s, arr } = require('./taskAuthoringCommon');

function firstSentence(text) {
  const normalized = s(text);
  if (!normalized) return '';
  const split = normalized.split(/(?<=[.!?])\s+/);
  return split[0] || normalized;
}

function buildCriterion({
  competency,
  indicators,
  profile,
  features,
  index,
  taskType
}) {
  const competencyId = s(competency?.id);
  const relatedIndicators = indicators.filter((row) => s(row.competencyId) === competencyId);
  const relatedFeatures = features.filter((row) => s(row.competencyId) === competencyId || !s(row.competencyId));

  const indicatorHint = relatedIndicators.length
    ? firstSentence(relatedIndicators[0].indicatorText || relatedIndicators[0].description)
    : '';
  const featureHint = relatedFeatures.length
    ? firstSentence(relatedFeatures[0].featureValue || relatedFeatures[0].description)
    : '';

  const criterionText = firstSentence(competency?.competencyStatement || competency?.description || competency?.title);
  const criterionDescription = [criterionText, indicatorHint, featureHint]
    .filter(Boolean)
    .join(' ');

  const performanceScale = taskType === 'assessment'
    ? {
        meeting: 'Observable evidence consistently demonstrates the targeted competency.',
        developing: 'Observable evidence partially demonstrates the targeted competency.',
        notYet: 'Observable evidence is not yet sufficient for the targeted competency.'
      }
    : {
        achieved: 'Learner can complete the enabling activity with limited support.',
        inProgress: 'Learner can complete part of the enabling activity with support.',
        emerging: 'Learner needs substantial support to complete the enabling activity.'
      };

  return {
    criterionId: `crit-${index + 1}`,
    title: s(competency?.title) || `Competency ${index + 1}`,
    description: criterionDescription || criterionText || 'Criterion pending clarification.',
    alignmentRefs: {
      competencyId,
      indicatorIds: relatedIndicators.map((row) => s(row.id)).filter(Boolean),
      profileOfAbilityId: s(profile?.id) || null,
      featureIds: relatedFeatures.map((row) => s(row.id)).filter(Boolean)
    },
    performanceScale
  };
}

function generateRubricDraft({
  competencies = [],
  indicators = [],
  profileOfAbility = null,
  featuresOfCommunication = [],
  taskType = 'assessment'
}) {
  const normalizedCompetencies = arr(competencies).filter(Boolean);
  const normalizedIndicators = arr(indicators).filter(Boolean);
  const normalizedFeatures = arr(featuresOfCommunication).filter(Boolean);
  const profile = profileOfAbility || null;

  const criteria = normalizedCompetencies.map((competency, index) => buildCriterion({
    competency,
    indicators: normalizedIndicators,
    profile,
    features: normalizedFeatures,
    index,
    taskType: s(taskType).toLowerCase() === 'enabling' ? 'enabling' : 'assessment'
  }));

  return {
    rubricType: s(taskType).toLowerCase() === 'enabling' ? 'formative-checklist' : 'analytic-checklist',
    generatedAt: new Date().toISOString(),
    criteria,
    notes: [
      'Teacher can edit criteria wording, evidence notes, and performance labels before publishing.',
      'Rubric rows remain traceable to CLB references via alignmentRefs.'
    ]
  };
}

module.exports = {
  generateRubricDraft
};
