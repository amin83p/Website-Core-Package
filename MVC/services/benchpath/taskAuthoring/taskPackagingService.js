const benchpathDataService = require('../benchpathDataService');
const { s, arr, uniqueStrings, benchmarkLevel } = require('./taskAuthoringCommon');

function nowIso() {
  return new Date().toISOString();
}

function toLabel(value) {
  const normalized = s(value);
  if (!normalized) return '';
  if (normalized.startsWith('skill:')) {
    const raw = normalized.replace(/^skill:/, '');
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }
  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function mapRowsById(rows = []) {
  const map = new Map();
  arr(rows).forEach((row) => {
    const id = s(row?.id);
    if (!id || map.has(id)) return;
    map.set(id, row);
  });
  return map;
}

async function fetchRowsByIds(entityType, ids = [], requestingUser) {
  const idSet = new Set(uniqueStrings(ids));
  if (!idSet.size) return [];
  const rows = await benchpathDataService.fetchData(entityType, {}, requestingUser);
  return arr(rows).filter((row) => idSet.has(s(row.id)));
}

function buildLabelRows(ids = [], map, valueSelector) {
  return uniqueStrings(ids).map((id) => {
    const row = map.get(id);
    return {
      id,
      title: s(valueSelector(row, id)),
      summary: s(row?.description || row?.indicatorText || row?.taskLabelText || row?.competencyStatement || '')
    };
  });
}

function summarizeCollectionMethods(methods = []) {
  if (!arr(methods).length) return 'Teacher observation notes';
  return arr(methods)
    .map((value) => toLabel(value))
    .join(', ');
}

function buildTaskReadiness(task = {}) {
  const missingItems = [];
  const checks = [];

  const selectedBenchmarkId = s(task.selectedBenchmarkId);
  const competencyIds = arr(task.competencyIds);
  const criteriaRows = arr(task.criteriaForSuccess);
  const artifacts = arr(task?.evidencePlan?.artifacts);
  const collectionMethods = arr(task?.evidencePlan?.collectionMethods);
  const learnerInstructions = s(task.learnerInstructions);
  const teacherInstructions = s(task.teacherInstructions);
  const observableEvidence = arr(task?.evidencePlan?.observableEvidence);

  if (!selectedBenchmarkId) missingItems.push('Select one benchmark.');
  if (!competencyIds.length) missingItems.push('Select at least one competency.');
  if (criteriaRows.length < 2) missingItems.push('Add at least two criteria for success for publishable assessment tasks.');
  if (!artifacts.length && !s(task?.classContext?.desiredModality)) {
    missingItems.push('Add at least one concrete artifact or output modality.');
  }
  if (!learnerInstructions) missingItems.push('Add learner instructions.');
  if (!teacherInstructions) missingItems.push('Add teacher instructions.');
  if (!collectionMethods.length) missingItems.push('Add at least one evidence collection method.');
  if (!observableEvidence.length) missingItems.push('Add observable evidence statements.');

  checks.push({
    id: 'benchmark',
    status: selectedBenchmarkId ? 'pass' : 'missing',
    message: selectedBenchmarkId ? `Benchmark selected: ${selectedBenchmarkId}` : 'Benchmark is missing.'
  });
  checks.push({
    id: 'competencies',
    status: competencyIds.length ? 'pass' : 'missing',
    message: competencyIds.length ? `${competencyIds.length} competency(ies) selected.` : 'No competencies selected.'
  });
  checks.push({
    id: 'criteria',
    status: criteriaRows.length >= 2 ? 'pass' : 'missing',
    message: criteriaRows.length >= 2
      ? `${criteriaRows.length} criteria available.`
      : 'At least two criteria are required.'
  });
  checks.push({
    id: 'evidenceCollection',
    status: collectionMethods.length ? 'pass' : 'missing',
    message: collectionMethods.length
      ? `Collection methods: ${summarizeCollectionMethods(collectionMethods)}`
      : 'No collection methods selected.'
  });

  return {
    isReady: missingItems.length === 0,
    missingItems,
    checks
  };
}

function buildSimpleSuccessReminder(task = {}) {
  const criteria = arr(task.criteriaForSuccess)
    .map((row) => s(row?.text || row))
    .filter(Boolean)
    .slice(0, 2);
  if (criteria.length === 0) return 'Show clear evidence that you completed the task purpose.';
  return `Success focus: ${criteria.join(' / ')}`;
}

async function generateTaskPackage(task = {}, options = {}) {
  const requestingUser = options.requestingUser || null;
  const benchmarkId = s(task.selectedBenchmarkId || task.suggestedBenchmarkId);
  const competencyAreaIds = uniqueStrings(task.competencyAreaIds);
  const competencyIds = uniqueStrings(task.competencyIds);
  const indicatorIds = uniqueStrings(task.indicatorIds);
  const featureIds = uniqueStrings(task.featureOfCommunicationIds);
  const sampleTaskLabelIds = uniqueStrings(task.sampleTaskLabelIds);

  const [
    benchmarkRows,
    competencyAreaRows,
    competencyRows,
    indicatorRows,
    featureRows,
    sampleTaskRows
  ] = await Promise.all([
    fetchRowsByIds('clbBenchmarks', [benchmarkId], requestingUser),
    fetchRowsByIds('clbCompetencyAreas', competencyAreaIds, requestingUser),
    fetchRowsByIds('clbCompetencies', competencyIds, requestingUser),
    fetchRowsByIds('clbIndicators', indicatorIds, requestingUser),
    fetchRowsByIds('clbFeaturesOfCommunication', featureIds, requestingUser),
    fetchRowsByIds('clbSampleTaskLabels', sampleTaskLabelIds, requestingUser)
  ]);

  const benchmark = benchmarkRows[0] || null;
  const benchmarkLabel = benchmark
    ? `${toLabel(benchmark.skillId)} CLB ${benchmarkLevel(benchmark) || '?'}`
    : (benchmarkId || 'Not selected');

  const competencyAreaMap = mapRowsById(competencyAreaRows);
  const competencyMap = mapRowsById(competencyRows);
  const indicatorMap = mapRowsById(indicatorRows);
  const featureMap = mapRowsById(featureRows);
  const sampleTaskMap = mapRowsById(sampleTaskRows);

  const competencyAreaLabels = buildLabelRows(competencyAreaIds, competencyAreaMap, (row, id) => row?.title || id);
  const competencyLabels = buildLabelRows(competencyIds, competencyMap, (row, id) => row?.title || row?.competencyStatement || id);
  const indicatorLabels = buildLabelRows(indicatorIds, indicatorMap, (row, id) => row?.title || row?.indicatorText || id);
  const featureLabels = buildLabelRows(featureIds, featureMap, (row, id) => row?.title || row?.featureValue || id);
  const sampleTaskLabels = buildLabelRows(sampleTaskLabelIds, sampleTaskMap, (row, id) => row?.title || row?.taskLabelText || id);

  const materialsResources = arr(task?.taskConditions?.materialsResources);
  const artifacts = arr(task?.evidencePlan?.artifacts);
  const observableEvidence = arr(task?.evidencePlan?.observableEvidence);
  const criteriaForSuccess = arr(task?.criteriaForSuccess).map((row) => s(row?.text || row)).filter(Boolean);
  const rubricCriteria = arr(task?.rubricDraft?.criteria).map((row) => ({
    title: s(row?.title || row?.criterionId || 'Criterion'),
    description: s(row?.description),
    meeting: s(row?.performanceScale?.meeting),
    developing: s(row?.performanceScale?.developing),
    notYet: s(row?.performanceScale?.notYet)
  }));

  const readiness = buildTaskReadiness(task);
  const estimatedTime = Number.isFinite(Number(task?.taskConditions?.estimatedTimeMinutes))
    ? Number(task.taskConditions.estimatedTimeMinutes)
    : null;
  const outputArtifact = artifacts[0] || s(task?.classContext?.desiredModality) || 'Learner performance artifact';
  const supportLevel = s(task?.taskConditions?.supportLevel);

  const learnerTaskSheet = {
    title: s(task.title) || 'BenchPath Task',
    learnerScenario: s(task.realWorldScenario),
    learnerInstructions: s(task.learnerInstructions),
    allowedSupports: supportLevel ? `Support level: ${toLabel(supportLevel)}.` : 'Use teacher-approved supports only.',
    timeEstimateMinutes: estimatedTime,
    materialsResources,
    expectedOutputArtifact: outputArtifact,
    successReminder: buildSimpleSuccessReminder(task)
  };

  const teacherAssessmentSheet = {
    title: s(task.title) || 'BenchPath Task Assessment Sheet',
    skill: toLabel(task.skill),
    benchmark: benchmarkLabel,
    competencyAreas: competencyAreaLabels,
    competencies: competencyLabels,
    indicators: indicatorLabels,
    featuresOfCommunication: featureLabels,
    observableEvidenceChecklist: observableEvidence,
    criteriaForSuccess,
    rubricChecklist: rubricCriteria,
    commentBoxPlaceholder: 'Teacher comments, feedback highlights, and next-step notes.',
    overallDecisionOptions: ['at benchmark', 'developing', 'not yet demonstrated']
  };

  const pblaEvidenceRecord = {
    title: s(task.title) || 'PBLA Evidence Record',
    datePlaceholder: 'YYYY-MM-DD',
    classUnitTheme: s(task?.classContext?.summary),
    skill: toLabel(task.skill),
    benchmark: benchmarkLabel,
    artifactType: outputArtifact,
    evidenceCollected: {
      observableEvidence,
      artifacts,
      collectionMethods: arr(task?.evidencePlan?.collectionMethods).map((method) => toLabel(method))
    },
    portfolioFitSummary: {
      classification: s(task?.portfolioFit?.classification) || 'not_classified',
      score: Number(task?.portfolioFit?.score || 0),
      maxScore: Number(task?.portfolioFit?.maxScore || 0),
      missingRequirements: arr(task?.portfolioFit?.missingRequirements)
    },
    validationSummary: {
      isValid: Boolean(task?.validation?.isValid),
      errorCount: Number(task?.validation?.summary?.errorCount || arr(task?.validation?.errors).length || 0),
      warningCount: Number(task?.validation?.summary?.warningCount || arr(task?.validation?.warnings).length || 0)
    },
    feedbackSummaryPlaceholder: 'Learner strengths, growth points, and follow-up plan.',
    traceabilityRefs: {
      benchmarkId,
      competencyAreaIds,
      competencyIds,
      indicatorIds,
      featureOfCommunicationIds: featureIds,
      sampleTaskLabelIds
    }
  };

  return {
    version: 'task-package.v1',
    generatedAt: nowIso(),
    sourceTaskUpdatedAt: s(task.updatedAt) || null,
    readiness,
    outputs: {
      learnerTaskSheet,
      teacherAssessmentSheet,
      pblaEvidenceRecord
    }
  };
}

module.exports = {
  generateTaskPackage,
  buildTaskReadiness
};

