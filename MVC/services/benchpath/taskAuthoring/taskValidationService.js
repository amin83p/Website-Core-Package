const benchpathDataService = require('../benchpathDataService');
const { classifyPortfolioFit } = require('./portfolioFitService');
const {
  s,
  arr,
  benchmarkLevel,
  benchmarkSkillId,
  classifyTaskType
} = require('./taskAuthoringCommon');

async function loadBenchmark(benchmarkId, requestingUser) {
  if (!s(benchmarkId)) return null;
  return benchpathDataService.getDataById('clbBenchmarks', benchmarkId, requestingUser);
}

async function loadByIds(entityType, ids = [], requestingUser) {
  const idSet = new Set(arr(ids).map((id) => s(id)).filter(Boolean));
  if (!idSet.size) return [];
  const rows = await benchpathDataService.fetchData(entityType, {}, requestingUser);
  return arr(rows).filter((row) => idSet.has(s(row.id)));
}

function isStrictRowTaskType(value) {
  const normalized = s(value).toLowerCase();
  return Boolean(normalized && normalized !== 'to_be_defined');
}

function modalitySkillMismatch(skillId, desiredModality) {
  const skill = s(skillId);
  const text = s(desiredModality).toLowerCase();
  if (!skill || !text) return false;
  if (skill === 'skill:writing' && /(listen|audio|announcement)/.test(text)) return true;
  if (skill === 'skill:listening' && /(write|note|form|email)/.test(text)) return true;
  if (skill === 'skill:reading' && /(speak|conversation|role\\s?-?play)/.test(text)) return true;
  if (skill === 'skill:speaking' && /(read\\s+a|written text|paragraph)/.test(text)) return true;
  return false;
}

function hasObservableEvidence(evidencePlan = {}) {
  const plan = evidencePlan && typeof evidencePlan === 'object' ? evidencePlan : {};
  const observableEvidence = arr(plan.observableEvidence);
  const artifacts = arr(plan.artifacts);
  const methods = arr(plan.collectionMethods);
  return observableEvidence.length > 0 || artifacts.length > 0 || methods.length > 0;
}

function normalizeCriteria(criteriaForSuccess = []) {
  return arr(criteriaForSuccess).map((entry) => {
    if (entry && typeof entry === 'object') return entry;
    const text = s(entry);
    if (!text) return null;
    return {
      text,
      references: []
    };
  }).filter(Boolean);
}

async function validateTaskDraft(taskDraft = {}, options = {}) {
  const requestingUser = options.requestingUser || null;
  const errors = [];
  const warnings = [];
  const checks = [];

  const selectedBenchmark = await loadBenchmark(taskDraft.selectedBenchmarkId, requestingUser);
  const suggestedBenchmark = await loadBenchmark(taskDraft.suggestedBenchmarkId, requestingUser);
  const effectiveBenchmark = selectedBenchmark || suggestedBenchmark;

  const normalizedSkill = s(taskDraft.skill);
  const expectedTaskType = classifyTaskType({
    learnerGoal: taskDraft?.learnerContext?.goal || taskDraft?.learnerContext?.realWorldNeed,
    realWorldNeed: taskDraft.realWorldScenario,
    desiredModality: taskDraft?.taskConditions?.modality || taskDraft?.classContext?.desiredModality,
    learnerInstructions: taskDraft.learnerInstructions,
    explicitTaskType: null
  });

  if (!normalizedSkill) {
    errors.push('Task skill is required.');
  }
  if (!s(taskDraft.selectedBenchmarkId)) {
    errors.push('selectedBenchmarkId is required.');
  }

  const realWorldScenario = s(taskDraft.realWorldScenario);
  if (realWorldScenario.length < 24) {
    warnings.push('Real-world scenario appears too short for an authentic assessment context.');
    checks.push({ id: 'authenticity', status: 'warning', message: 'Real-world scenario is short; expand context.' });
  } else {
    checks.push({ id: 'authenticity', status: 'pass', message: 'Real-world scenario is present.' });
  }

  if (s(taskDraft.taskType) !== expectedTaskType) {
    warnings.push(`Task type may be misclassified. Suggested classification: ${expectedTaskType}.`);
    checks.push({ id: 'taskTypeClassification', status: 'warning', message: `Current=${s(taskDraft.taskType) || '-'}, Suggested=${expectedTaskType}` });
  } else {
    checks.push({ id: 'taskTypeClassification', status: 'pass', message: `Task type aligns with heuristic: ${expectedTaskType}.` });
  }

  if (!effectiveBenchmark) {
    errors.push('Selected benchmark could not be resolved from reference layer.');
    checks.push({ id: 'clbFit', status: 'error', message: 'Benchmark is missing or inaccessible.' });
  } else {
    const level = benchmarkLevel(effectiveBenchmark);
    const benchmarkSkill = benchmarkSkillId(effectiveBenchmark);
    if (level == null || level < 1 || level > 4) {
      warnings.push('Benchmark level is outside current CLB 1-4 first-release scope.');
    }
    if (normalizedSkill && benchmarkSkill && normalizedSkill !== benchmarkSkill) {
      errors.push(`Skill mismatch: task skill (${normalizedSkill}) does not match benchmark skill (${benchmarkSkill}).`);
    }
    checks.push({ id: 'clbFit', status: errors.some((entry) => entry.includes('Skill mismatch')) ? 'error' : 'pass', message: `Benchmark=${effectiveBenchmark.id}, Level=${level || '?'}` });
  }

  const competencyIds = arr(taskDraft.competencyIds);
  if (competencyIds.length === 0) {
    errors.push('At least one competency is required.');
  } else if (competencyIds.length > 2) {
    errors.push('Too many competencies selected for one task. Keep to 1 primary competency and optional 1 secondary competency.');
  }
  checks.push({
    id: 'competencyScope',
    status: competencyIds.length === 0 ? 'error' : competencyIds.length > 2 ? 'error' : 'pass',
    message: `${competencyIds.length} competency(ies) selected.`
  });

  const [competencyRows, indicatorRows, featureRows, sampleTaskRows] = await Promise.all([
    loadByIds('clbCompetencies', competencyIds, requestingUser),
    loadByIds('clbIndicators', arr(taskDraft.indicatorIds), requestingUser),
    loadByIds('clbFeaturesOfCommunication', arr(taskDraft.featureOfCommunicationIds), requestingUser),
    loadByIds('clbSampleTaskLabels', arr(taskDraft.sampleTaskLabelIds), requestingUser)
  ]);

  if (competencyRows.length) {
    const benchmarkMismatchRows = competencyRows.filter((row) => s(row.benchmarkId) && s(row.benchmarkId) !== s(taskDraft.selectedBenchmarkId));
    if (benchmarkMismatchRows.length) {
      errors.push('Selected competencies are not aligned to the selected benchmark.');
    }
  }

  if (indicatorRows.length) {
    const selectedCompetencySet = new Set(competencyRows.map((row) => s(row.id)));
    const indicatorMismatch = indicatorRows.filter((row) => {
      const competencyId = s(row.competencyId);
      if (competencyId && selectedCompetencySet.has(competencyId)) return false;
      const benchmarkId = s(row.benchmarkId);
      return benchmarkId && benchmarkId !== s(taskDraft.selectedBenchmarkId);
    });
    if (indicatorMismatch.length) {
      errors.push('Indicator set does not align with selected competencies/benchmark.');
    }
    if (indicatorRows.length > 4) {
      warnings.push('Indicator set is broad for one classroom task. Keep 2-4 indicators.');
    }
  }

  if (featureRows.length) {
    const unrelated = featureRows.filter((row) => {
      const skillId = s(row.skillId || row.scopeSkillId);
      if (skillId && s(taskDraft.skill) && skillId !== s(taskDraft.skill)) return true;
      const benchmarkId = s(row.benchmarkId || row.scopeBenchmarkId);
      if (benchmarkId && benchmarkId !== s(taskDraft.selectedBenchmarkId)) return true;
      const competencyId = s(row.competencyId || row.scopeCompetencyId);
      return Boolean(competencyId && !competencyIds.includes(competencyId));
    });
    if (unrelated.length) {
      warnings.push('Some selected features of communication are weakly related to task purpose.');
    }
    if (featureRows.length > 2) {
      warnings.push('Use 1-2 features of communication for a focused task.');
    }
  }

  if (sampleTaskRows.length) {
    const strictMismatch = sampleTaskRows.filter((row) => {
      const benchmarkId = s(row.linkedBenchmarkId || row.benchmarkId);
      if (benchmarkId && benchmarkId !== s(taskDraft.selectedBenchmarkId)) return true;
      const linkedCompetencyId = s(row.linkedCompetencyId || row.competencyId);
      if (linkedCompetencyId && !competencyIds.includes(linkedCompetencyId)) return true;
      return false;
    });
    if (strictMismatch.length) {
      errors.push('Sample task labels are mismatched with selected benchmark/competencies.');
    }

    const strictTaskTypeRows = sampleTaskRows.filter((row) => isStrictRowTaskType(row.taskType));
    if (strictTaskTypeRows.length) {
      const mismatchTaskTypeRows = strictTaskTypeRows.filter((row) => s(row.taskType).toLowerCase() !== s(taskDraft.taskType).toLowerCase());
      if (mismatchTaskTypeRows.length) {
        warnings.push('Some sample task labels imply a different task purpose (assessment/enabling).');
      }
    }

    if (sampleTaskRows.length > 2) {
      warnings.push('Use one primary sample task label with optional one alternate.');
    }
  }

  if (modalitySkillMismatch(taskDraft.skill, taskDraft?.taskConditions?.modality || taskDraft?.classContext?.desiredModality)) {
    warnings.push('Task modality/output appears mismatched with selected skill.');
  }

  if (!hasObservableEvidence(taskDraft.evidencePlan)) {
    warnings.push('Evidence plan should include observable evidence, artifacts, or collection methods.');
    checks.push({ id: 'observableEvidence', status: 'warning', message: 'Evidence plan is not yet observable enough.' });
  } else {
    checks.push({ id: 'observableEvidence', status: 'pass', message: 'Evidence plan includes observable evidence/artifacts.' });
  }

  const criteria = normalizeCriteria(taskDraft.criteriaForSuccess);
  if (criteria.length === 0) {
    errors.push('At least one criterion for success is required.');
    checks.push({ id: 'criteriaAlignment', status: 'error', message: 'No criteria for success found.' });
  } else {
    const alignedCount = criteria.filter((row) => {
      const refs = arr(row?.references);
      return refs.length > 0 || s(row?.competencyId) || s(row?.indicatorId);
    }).length;
    if (alignedCount === 0) {
      warnings.push('Criteria exist but do not include explicit competency/indicator alignment references.');
      checks.push({ id: 'criteriaAlignment', status: 'warning', message: 'Criteria are present but alignment refs are missing.' });
    } else {
      checks.push({ id: 'criteriaAlignment', status: 'pass', message: `${alignedCount}/${criteria.length} criteria include alignment references.` });
    }
  }

  if (s(taskDraft.taskType).toLowerCase() === 'assessment' && criteria.length < 2) {
    warnings.push('Assessment tasks should include at least two observable criteria.');
  }

  const portfolioFit = classifyPortfolioFit(taskDraft);
  if (portfolioFit.classification !== 'suitable') {
    warnings.push(`Portfolio fit is ${portfolioFit.classification}. Review missing requirements before publish.`);
  }
  checks.push({
    id: 'portfolioFit',
    status: portfolioFit.classification === 'suitable' ? 'pass' : 'warning',
    message: `${portfolioFit.classification} (${portfolioFit.score}/${portfolioFit.maxScore})`
  });

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    checks,
    summary: {
      errorCount: errors.length,
      warningCount: warnings.length
    },
    portfolioFit
  };
}

module.exports = {
  validateTaskDraft
};
