
const benchpathDataService = require('../benchpathDataService');
const { generateRubricDraft } = require('./rubricGenerationService');
const { validateTaskDraft } = require('./taskValidationService');
const {
  s,
  arr,
  uniqueStrings,
  benchmarkLevel,
  benchmarkSkillId,
  normalizeSkillInput,
  parseApproxLevel,
  parseRangeMidpoint,
  tokenize,
  classifyTaskType,
  asTraceRecord
} = require('./taskAuthoringCommon');

function nowIso() {
  return new Date().toISOString();
}

function skillLabel(skillId) {
  const raw = s(skillId).replace(/^skill:/, '');
  return raw ? `${raw.charAt(0).toUpperCase()}${raw.slice(1)}` : 'Skill';
}

function benchmarkDisplay(row) {
  if (!row) return '';
  return `${skillLabel(row.skillId)} CLB ${benchmarkLevel(row) || '?'}`;
}

function derivePreferredLevel(input = {}) {
  return parseApproxLevel(input.approximateLevel)
    || parseRangeMidpoint(input.clbRange)
    || 2;
}

function parseLevelFromId(value) {
  const match = s(value).match(/:(\d{1,2})(?::|$)/);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowLevel(row) {
  return benchmarkLevel(row) || parseLevelFromId(row?.benchmarkId || row?.id);
}

function isClb14(row) {
  const level = rowLevel(row);
  return level != null && level >= 1 && level <= 4;
}

function isActive(row) {
  const status = s(row?.status).toLowerCase();
  return status !== 'archived' && status !== 'deleted';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function confidence(score) {
  const bounded = clamp(Number(score || 0), 0, 100);
  const value = Number((bounded / 100).toFixed(2));
  return {
    value,
    label: value >= 0.75 ? 'high' : value >= 0.45 ? 'medium' : 'low'
  };
}

function candidateText(row = {}) {
  return [
    row.title,
    row.shortTitle,
    row.description,
    row.domainNotes,
    row.competencyStatement,
    row.indicatorText,
    row.taskLabelText,
    row.featureValue,
    row.featureDimension,
    row.contextDomain,
    row.taskType,
    row.id
  ].map((entry) => s(entry)).filter(Boolean).join(' ').toLowerCase();
}

function inferArtifactType(input = {}) {
  const raw = `${s(input.artifactType)} ${s(input.desiredModality)} ${s(input.realWorldNeed)} ${s(input.learnerGoal)}`.toLowerCase();
  if (raw.includes('form')) return 'form';
  if (raw.includes('note')) return 'note';
  if (raw.includes('email')) return 'email';
  if (raw.includes('message')) return 'message';
  if (raw.includes('record') || raw.includes('audio')) return 'recording';
  return '';
}

function modalitySkillMismatch(skillId, desiredModality) {
  const text = s(desiredModality).toLowerCase();
  if (!skillId || !text) return false;
  if (skillId === 'skill:writing' && /(listen|audio|announcement)/.test(text)) return true;
  if (skillId === 'skill:listening' && /(write|note|form|email)/.test(text)) return true;
  if (skillId === 'skill:reading' && /(speak|conversation|role\s?-?play)/.test(text)) return true;
  if (skillId === 'skill:speaking' && /(read\s+a|written text|paragraph)/.test(text)) return true;
  return false;
}

function collectSignals(input = {}) {
  const learnerGoal = s(input.learnerGoal);
  const realWorldNeed = s(input.realWorldNeed);
  const classContext = s(input.classContext);
  const desiredModality = s(input.desiredModality);
  const scenarioWording = s(input.scenarioWording || input.realWorldScenario);
  const taskType = classifyTaskType({
    learnerGoal,
    realWorldNeed,
    desiredModality,
    learnerInstructions: s(input.learnerInstructions),
    explicitTaskType: input.taskType
  });
  const artifactType = inferArtifactType(input);

  const intentText = [
    learnerGoal,
    realWorldNeed,
    classContext,
    desiredModality,
    s(input.contextDomain),
    s(input.audience),
    artifactType,
    scenarioWording
  ].filter(Boolean).join(' ');

  return {
    skill: normalizeSkillInput(input.skill),
    preferredLevel: derivePreferredLevel(input),
    learnerGoal,
    realWorldNeed,
    classContext,
    desiredModality,
    contextDomain: s(input.contextDomain).toLowerCase(),
    taskType,
    artifactType,
    scenarioWording,
    intentTokens: tokenize(intentText),
    scenarioTokens: tokenize(`${realWorldNeed} ${scenarioWording}`)
  };
}

function scoreRow(row, signals, options = {}) {
  const text = candidateText(row);
  const tokens = tokenize(text);
  const intentSet = new Set(signals.intentTokens);
  const scenarioSet = new Set(signals.scenarioTokens);

  const weights = {
    skillExact: 22,
    skillMismatch: -80,
    benchmarkExact: 20,
    competencyExact: 18,
    areaExact: 12,
    levelBase: 16,
    levelPenalty: 6,
    intentToken: 3,
    scenarioToken: 4,
    taskTypeMatch: 8,
    taskTypeMismatch: -6,
    domainMatch: 10,
    ...options.weights
  };

  let score = 0;
  const matchedSignals = [];

  const rowSkill = s(row.skillId || row.scopeSkillId);
  if (signals.skill && rowSkill) {
    if (rowSkill === signals.skill) {
      score += weights.skillExact;
      matchedSignals.push('skill');
    } else {
      score += weights.skillMismatch;
    }
  }

  if (signals.preferredBenchmarkId) {
    const rowBenchmarkId = s(row.benchmarkId || row.linkedBenchmarkId || row.scopeBenchmarkId);
    if (rowBenchmarkId && rowBenchmarkId === signals.preferredBenchmarkId) {
      score += weights.benchmarkExact;
      matchedSignals.push('benchmark');
    }
  }

  if (signals.preferredCompetencyIds?.length) {
    const rowCompetencyId = s(row.competencyId || row.linkedCompetencyId || row.scopeCompetencyId);
    if (rowCompetencyId && signals.preferredCompetencyIds.includes(rowCompetencyId)) {
      score += weights.competencyExact;
      matchedSignals.push('competency');
    }
  }

  if (signals.preferredCompetencyAreaId) {
    const rowArea = s(row.competencyAreaId);
    if (rowArea && rowArea === signals.preferredCompetencyAreaId) {
      score += weights.areaExact;
      matchedSignals.push('competency-area');
    }
  }

  const level = rowLevel(row);
  if (Number.isFinite(level) && Number.isFinite(signals.preferredLevel)) {
    const diff = Math.abs(level - signals.preferredLevel);
    score += Math.max(0, weights.levelBase - (diff * weights.levelPenalty));
    if (diff <= 1) matchedSignals.push('clb-level');
  }

  const overlap = tokens.filter((token) => intentSet.has(token));
  if (overlap.length) {
    score += overlap.length * weights.intentToken;
    matchedSignals.push('intent-overlap');
  }

  const scenarioOverlap = tokens.filter((token) => scenarioSet.has(token));
  if (scenarioOverlap.length) {
    score += scenarioOverlap.length * weights.scenarioToken;
    matchedSignals.push('scenario-fit');
  }

  const rowTaskType = s(row.taskType).toLowerCase();
  if (signals.taskType && rowTaskType && rowTaskType !== 'to_be_defined') {
    if (rowTaskType === signals.taskType) {
      score += weights.taskTypeMatch;
      matchedSignals.push('task-type');
    } else {
      score += weights.taskTypeMismatch;
    }
  }

  const rowDomain = s(row.contextDomain).toLowerCase();
  if (signals.contextDomain && rowDomain && rowDomain !== 'to_be_defined' && rowDomain === signals.contextDomain) {
    score += weights.domainMatch;
    matchedSignals.push('context-domain');
  }

  return {
    row,
    score,
    matchedSignals: uniqueStrings(matchedSignals),
    overlapTokens: uniqueStrings(overlap.concat(scenarioOverlap).slice(0, 6))
  };
}

function rankRows(rows, signals, options = {}) {
  return arr(rows)
    .filter((row) => isActive(row))
    .map((row) => scoreRow(row, signals, options))
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return s(a.row?.id).localeCompare(s(b.row?.id));
    });
}

function pickRows(scoredRows = [], maxCount, minimum = 1) {
  const ranked = arr(scoredRows);
  if (!ranked.length) return [];
  const withSignal = ranked.filter((entry) => entry.score > 0).slice(0, maxCount);
  if (withSignal.length >= minimum) return withSignal;
  return ranked.slice(0, Math.max(minimum, Math.min(maxCount, ranked.length)));
}

function recommendationItem(entry, reasonPrefix = '') {
  const row = entry?.row || {};
  const overlap = arr(entry?.overlapTokens);
  const overlapText = overlap.length ? `Matched terms: ${overlap.slice(0, 5).join(', ')}.` : 'Mapped by CLB relation and scenario fit.';
  return {
    ...row,
    displayTitle: s(row.title || row.shortTitle || row.id || 'Item'),
    confidence: confidence(entry?.score),
    matchedSignals: arr(entry?.matchedSignals),
    whySuggested: [s(reasonPrefix), overlapText].filter(Boolean).join(' '),
    whyNotSelected: ''
  };
}

function alternates(scoredRows = [], selectedIds = [], maxCount = 2) {
  const selected = new Set(uniqueStrings(selectedIds));
  return arr(scoredRows)
    .filter((entry) => !selected.has(s(entry?.row?.id)))
    .slice(0, maxCount)
    .map((entry) => {
      const rec = recommendationItem(entry, 'Strong alternate candidate.');
      return {
        ...rec,
        whyNotSelected: rec.confidence?.label === 'high'
          ? 'High relevance, but lower fit than selected option.'
          : 'Useful fallback if task intent changes.'
      };
    });
}

function buildEvidencePlan({ selectedIndicators = [], selectedSampleTaskLabels = [], desiredModality }) {
  return {
    observableEvidence: arr(selectedIndicators).slice(0, 4).map((row) => s(row.indicatorText || row.description || row.title)).filter(Boolean),
    artifacts: arr(selectedSampleTaskLabels).slice(0, 2).map((row) => s(row.taskLabelText || row.description || row.title)).filter(Boolean),
    collectionMethods: uniqueStrings([
      desiredModality ? `collect_${s(desiredModality).toLowerCase().replace(/[^a-z0-9]+/g, '_')}` : '',
      'teacher_observation_notes',
      selectedSampleTaskLabels.length ? 'artifact_capture' : ''
    ])
  };
}

function buildCriteriaDraft({ selectedCompetencies = [], selectedIndicators = [] }) {
  return arr(selectedCompetencies).map((competency) => {
    const competencyId = s(competency.id);
    const indicator = arr(selectedIndicators).find((row) => s(row.competencyId) === competencyId);
    return {
      text: s(competency.competencyStatement || competency.description || competency.title),
      competencyId,
      indicatorId: indicator ? s(indicator.id) : null,
      references: uniqueStrings([competencyId, indicator ? indicator.id : ''].filter(Boolean))
    };
  });
}

function buildTaskId() {
  const timestamp = Date.now();
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `task:benchpath:${timestamp}:${rand}`;
}

function slugify(value) {
  return s(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

async function loadReferenceSnapshot(requestingUser) {
  const [benchmarks, competencyAreas, competencies, indicators, profileOfAbility, featuresOfCommunication, sampleTaskLabels] = await Promise.all([
    benchpathDataService.fetchData('clbBenchmarks', {}, requestingUser),
    benchpathDataService.fetchData('clbCompetencyAreas', {}, requestingUser),
    benchpathDataService.fetchData('clbCompetencies', {}, requestingUser),
    benchpathDataService.fetchData('clbIndicators', {}, requestingUser),
    benchpathDataService.fetchData('clbProfileOfAbility', {}, requestingUser),
    benchpathDataService.fetchData('clbFeaturesOfCommunication', {}, requestingUser),
    benchpathDataService.fetchData('clbSampleTaskLabels', {}, requestingUser)
  ]);
  return {
    benchmarks: arr(benchmarks),
    competencyAreas: arr(competencyAreas),
    competencies: arr(competencies),
    indicators: arr(indicators),
    profileOfAbility: arr(profileOfAbility),
    featuresOfCommunication: arr(featuresOfCommunication),
    sampleTaskLabels: arr(sampleTaskLabels)
  };
}

function qualitySafeguards(signals, selected = {}) {
  const flags = [];
  const warnings = [];
  const selectedCompetencies = arr(selected.competencies);
  const selectedIndicators = arr(selected.indicators);
  const selectedSampleTaskLabels = arr(selected.sampleTaskLabels);

  if (modalitySkillMismatch(signals.skill, signals.desiredModality)) {
    flags.push('modality_skill_mismatch');
    warnings.push('Desired modality appears inconsistent with selected skill.');
  }

  const scenarioWordCount = s(signals.realWorldNeed || signals.scenarioWording).split(/\s+/).filter(Boolean).length;
  if (scenarioWordCount && scenarioWordCount < 10 && selectedCompetencies.length > 1) {
    flags.push('simple_scenario_broad_scope');
    warnings.push('Scenario appears simple; one competency is usually enough for focused assessment evidence.');
  }

  const purposeSet = new Set(selectedSampleTaskLabels.map((row) => s(row.taskType).toLowerCase()).filter((value) => value && value !== 'to_be_defined'));
  if (purposeSet.size > 1) {
    flags.push('mixed_sample_task_purposes');
    warnings.push('Sample task labels suggest mixed communicative purposes. Consider selecting one primary label.');
  }

  const indicatorMismatch = selectedIndicators.some((row) => {
    const indicatorCompetencyId = s(row.competencyId);
    return indicatorCompetencyId && !selectedCompetencies.some((comp) => s(comp.id) === indicatorCompetencyId);
  });
  if (indicatorMismatch) {
    flags.push('indicator_competency_mismatch');
    warnings.push('Some indicators are not directly aligned to selected competencies.');
  }

  return { flags, warnings };
}

async function generateTaskDraft(input = {}, options = {}) {
  const requestingUser = options.requestingUser || null;
  const signals = collectSignals(input);
  if (!signals.skill) throw new Error('Wizard input requires a valid skill (listening, speaking, reading, writing).');

  const snapshot = await loadReferenceSnapshot(requestingUser);

  const benchmarkPool = snapshot.benchmarks
    .filter((row) => isActive(row))
    .filter((row) => benchmarkSkillId(row) === signals.skill)
    .filter((row) => isClb14(row));
  if (!benchmarkPool.length) throw new Error(`No CLB 1-4 benchmark available for skill ${signals.skill}.`);

  const rankedBenchmarks = rankRows(benchmarkPool, signals, {
    weights: {
      skillExact: 35,
      levelBase: 40,
      levelPenalty: 10,
      intentToken: 2,
      scenarioToken: 2,
      benchmarkExact: 0
    }
  });
  const selectedBenchmarkEntry = rankedBenchmarks[0];
  const selectedBenchmark = selectedBenchmarkEntry.row;
  const selectedBenchmarkId = s(selectedBenchmark.id);
  signals.preferredBenchmarkId = selectedBenchmarkId;

  const recommendedBenchmark = recommendationItem(selectedBenchmarkEntry, `Best CLB ${skillLabel(signals.skill)} fit for level ${signals.preferredLevel}.`);

  const benchmarkAreaIds = uniqueStrings(arr(selectedBenchmark.relatedIds).filter((id) => s(id).startsWith('ca:')));
  const competencyAreaPool = snapshot.competencyAreas
    .filter((row) => isActive(row))
    .filter((row) => s(row.skillId) === signals.skill)
    .filter((row) => !benchmarkAreaIds.length || benchmarkAreaIds.includes(s(row.id)));
  const rankedAreas = rankRows(competencyAreaPool, signals);
  const selectedPrimaryAreaEntry = rankedAreas[0] || null;
  const selectedPrimaryArea = selectedPrimaryAreaEntry?.row || null;
  signals.preferredCompetencyAreaId = s(selectedPrimaryArea?.id);
  const recommendedPrimaryCompetencyArea = selectedPrimaryAreaEntry
    ? recommendationItem(selectedPrimaryAreaEntry, 'Primary competency area selected for coherent task purpose.')
    : null;

  const competencyPool = snapshot.competencies
    .filter((row) => isActive(row))
    .filter((row) => s(row.benchmarkId) === selectedBenchmarkId)
    .filter((row) => s(row.skillId) === signals.skill)
    .filter((row) => isClb14(row));

  const rankedCompetencies = rankRows(competencyPool, signals, {
    weights: {
      benchmarkExact: 24,
      areaExact: 16,
      intentToken: 3,
      scenarioToken: 5,
      levelBase: 10,
      levelPenalty: 5
    }
  });

  const selectedCompetencyEntries = [];
  if (rankedCompetencies.length) {
    selectedCompetencyEntries.push(rankedCompetencies[0]);
    const secondary = rankedCompetencies[1];
    if (secondary) {
      const primaryScore = rankedCompetencies[0].score;
      const secondaryScore = secondary.score;
      const ratioPass = secondaryScore >= Math.max(primaryScore * 0.82, primaryScore - 7);
      const addsValue = s(secondary.row?.competencyAreaId) !== s(rankedCompetencies[0].row?.competencyAreaId);
      if (ratioPass && addsValue) selectedCompetencyEntries.push(secondary);
    }
  }

  const recommendedCompetencies = selectedCompetencyEntries.slice(0, 2).map((entry, index) => recommendationItem(
    entry,
    index === 0
      ? 'Primary competency selected for direct scenario alignment.'
      : 'Secondary competency added because it strongly supports the same task pattern.'
  ));

  const selectedCompetencyIds = recommendedCompetencies.map((row) => s(row.id));
  signals.preferredCompetencyIds = selectedCompetencyIds;

  const strictIndicatorPool = snapshot.indicators
    .filter((row) => isActive(row))
    .filter((row) => s(row.benchmarkId) === selectedBenchmarkId)
    .filter((row) => s(row.skillId) === signals.skill)
    .filter((row) => selectedCompetencyIds.includes(s(row.competencyId)))
    .filter((row) => isClb14(row));

  const broadIndicatorPool = snapshot.indicators
    .filter((row) => isActive(row))
    .filter((row) => s(row.benchmarkId) === selectedBenchmarkId)
    .filter((row) => s(row.skillId) === signals.skill)
    .filter((row) => isClb14(row));

  const indicatorPool = strictIndicatorPool.length >= 2 ? strictIndicatorPool : broadIndicatorPool;
  const rankedIndicators = rankRows(indicatorPool, signals, {
    weights: { benchmarkExact: 22, competencyExact: 20, intentToken: 3, scenarioToken: 4 }
  });
  const recommendedIndicators = pickRows(rankedIndicators, 4, Math.min(2, rankedIndicators.length || 0))
    .map((entry) => recommendationItem(entry, 'Indicator supports observable evidence for selected competency scope.'));

  const strictFeaturePool = snapshot.featuresOfCommunication
    .filter((row) => isActive(row))
    .filter((row) => s(row.benchmarkId || row.scopeBenchmarkId) === selectedBenchmarkId)
    .filter((row) => {
      const skillId = s(row.skillId || row.scopeSkillId);
      return !skillId || skillId === signals.skill;
    })
    .filter((row) => {
      const competencyId = s(row.competencyId || row.scopeCompetencyId);
      return !competencyId || selectedCompetencyIds.includes(competencyId);
    })
    .filter((row) => isClb14(row));

  const broadFeaturePool = snapshot.featuresOfCommunication
    .filter((row) => isActive(row))
    .filter((row) => s(row.benchmarkId || row.scopeBenchmarkId) === selectedBenchmarkId)
    .filter((row) => {
      const skillId = s(row.skillId || row.scopeSkillId);
      return !skillId || skillId === signals.skill;
    })
    .filter((row) => isClb14(row));

  const featurePool = strictFeaturePool.length ? strictFeaturePool : broadFeaturePool;
  const rankedFeatures = rankRows(featurePool, signals, {
    weights: { benchmarkExact: 20, competencyExact: 16, intentToken: 3, scenarioToken: 3 }
  });
  const recommendedFeatures = pickRows(rankedFeatures, 2, Math.min(1, rankedFeatures.length || 0))
    .map((entry) => recommendationItem(entry, 'Feature of communication selected to calibrate performance expectations.'));

  const sampleTaskBasePool = snapshot.sampleTaskLabels
    .filter((row) => isActive(row))
    .filter((row) => s(row.linkedBenchmarkId || row.benchmarkId) === selectedBenchmarkId)
    .filter((row) => s(row.skillId) === signals.skill)
    .filter((row) => isClb14(row));

  const sampleTaskPool = sampleTaskBasePool
    .filter((row) => {
      const linkedCompetencyId = s(row.linkedCompetencyId || row.competencyId);
      return !linkedCompetencyId || selectedCompetencyIds.includes(linkedCompetencyId);
    })
    .filter((row) => {
      const rowTaskType = s(row.taskType).toLowerCase();
      return !rowTaskType || rowTaskType === 'to_be_defined' || rowTaskType === signals.taskType;
    })
    .filter((row) => {
      const domain = s(row.contextDomain).toLowerCase();
      return !domain || domain === 'to_be_defined' || !signals.contextDomain || domain === signals.contextDomain;
    });

  const rankedSampleTasks = rankRows(sampleTaskPool.length ? sampleTaskPool : sampleTaskBasePool, signals, {
    weights: { benchmarkExact: 24, competencyExact: 18, intentToken: 4, scenarioToken: 5, domainMatch: 12, taskTypeMatch: 9 }
  });

  const sampleEntries = [];
  if (rankedSampleTasks.length) {
    sampleEntries.push(rankedSampleTasks[0]);
    const alt = rankedSampleTasks[1];
    if (alt && alt.score >= Math.max(rankedSampleTasks[0].score * 0.8, rankedSampleTasks[0].score - 6)) sampleEntries.push(alt);
  }

  const recommendedSampleTaskLabels = sampleEntries.slice(0, 2).map((entry, index) => ({
    ...recommendationItem(entry, index === 0
      ? 'Best-fit sample task pattern for this classroom task scope.'
      : 'Alternate sample task label retained as a backup option.'),
    recommendationRole: index === 0 ? 'primary' : 'alternate'
  }));

  const selectedCompetencyRows = recommendedCompetencies;
  const selectedIndicatorRows = recommendedIndicators;
  const selectedFeatureRows = recommendedFeatures;
  const selectedSampleTaskRows = recommendedSampleTaskLabels;
  const selectedCompetencyAreaIds = uniqueStrings(selectedCompetencyRows.map((row) => s(row.competencyAreaId)).filter(Boolean)).slice(0, 2);

  const profile = snapshot.profileOfAbility.find((row) => s(row.benchmarkId) === selectedBenchmarkId) || null;
  const profileRecommendation = profile
    ? {
      ...profile,
      displayTitle: s(profile.title || profile.id),
      confidence: { value: 1, label: 'high' },
      matchedSignals: ['benchmark'],
      whySuggested: 'Profile-of-ability directly linked to the recommended benchmark.',
      whyNotSelected: ''
    }
    : null;

  const safeguards = qualitySafeguards(signals, {
    competencies: selectedCompetencyRows,
    indicators: selectedIndicatorRows,
    sampleTaskLabels: selectedSampleTaskRows
  });

  const taskType = signals.taskType;
  const proposedTitle = `${benchmarkDisplay(selectedBenchmark)} - ${taskType === 'assessment' ? 'Real-World Task' : 'Skill-Building Task'}`;

  const evidencePlan = buildEvidencePlan({
    selectedIndicators: selectedIndicatorRows,
    selectedSampleTaskLabels: selectedSampleTaskRows,
    desiredModality: signals.desiredModality
  });

  const criteriaForSuccess = buildCriteriaDraft({
    selectedCompetencies: selectedCompetencyRows,
    selectedIndicators: selectedIndicatorRows
  });

  const rubricDraft = generateRubricDraft({
    competencies: selectedCompetencyRows,
    indicators: selectedIndicatorRows,
    profileOfAbility: profile,
    featuresOfCommunication: selectedFeatureRows,
    taskType
  });

  const draftTask = {
    id: buildTaskId(),
    slug: slugify(`${proposedTitle}-${Date.now()}`),
    title: proposedTitle,
    orgId: s(requestingUser?.activeOrgId) || 'SYSTEM',
    createdBy: s(requestingUser?.id) || 'system',
    learnerContext: {
      goal: s(input.learnerGoal),
      realWorldNeed: s(input.realWorldNeed),
      learnerNotes: s(input.learnerNotes),
      clbRange: s(input.clbRange),
      approximateLevel: s(input.approximateLevel)
    },
    classContext: {
      summary: s(input.classContext),
      desiredModality: s(input.desiredModality),
      contextDomain: s(input.contextDomain)
    },
    skill: signals.skill,
    suggestedBenchmarkId: selectedBenchmarkId,
    selectedBenchmarkId,
    competencyAreaIds: selectedCompetencyAreaIds,
    competencyIds: selectedCompetencyRows.map((row) => s(row.id)),
    profileOfAbilityRefs: profile ? [s(profile.id)] : [],
    indicatorIds: selectedIndicatorRows.map((row) => s(row.id)),
    featureOfCommunicationIds: selectedFeatureRows.map((row) => s(row.id)),
    sampleTaskLabelIds: selectedSampleTaskRows.map((row) => s(row.id)),
    taskType,
    realWorldScenario: s(input.realWorldScenario) || s(input.realWorldNeed) || `Learner completes a ${skillLabel(signals.skill)} task in an authentic classroom scenario.`,
    learnerInstructions: s(input.learnerInstructions) || 'Complete the task using the scenario details provided by the teacher.',
    teacherInstructions: s(input.teacherInstructions) || 'Observe learner performance, collect evidence, and record criterion outcomes.',
    taskConditions: {
      modality: s(input.desiredModality) || 'classroom',
      supportLevel: taskType === 'assessment' ? 'limited_support' : 'guided_support',
      estimatedTimeMinutes: 25,
      materialsResources: [],
      conditionsNotes: '',
      authenticityGuidance: s(input.authenticityGuidance)
    },
    evidencePlan,
    criteriaForSuccess,
    rubricDraft,
    portfolioFit: {},
    validation: {},
    wizardTrace: {
      generatedAt: nowIso(),
      wizardVersion: 'task-wizard.v2.clb1-4',
      inputSnapshot: {
        skill: signals.skill,
        approximateLevel: parseApproxLevel(input.approximateLevel),
        clbRange: s(input.clbRange),
        learnerGoal: s(input.learnerGoal),
        realWorldNeed: s(input.realWorldNeed),
        classContext: s(input.classContext),
        desiredModality: s(input.desiredModality),
        contextDomain: s(input.contextDomain),
        taskType,
        artifactType: signals.artifactType
      },
      recommendationSafeguards: safeguards,
      traceabilityRefs: {
        benchmark: asTraceRecord(selectedBenchmark),
        profileOfAbility: asTraceRecord(profile),
        competencies: selectedCompetencyRows.map((row) => asTraceRecord(row)).filter(Boolean),
        indicators: selectedIndicatorRows.map((row) => asTraceRecord(row)).filter(Boolean),
        featuresOfCommunication: selectedFeatureRows.map((row) => asTraceRecord(row)).filter(Boolean),
        sampleTaskLabels: selectedSampleTaskRows.map((row) => asTraceRecord(row)).filter(Boolean)
      }
    },
    status: 'draft',
    isActive: true,
    tags: ['benchpath', 'task-authoring', 'wizard-generated']
  };

  const validation = await validateTaskDraft(draftTask, { requestingUser });
  draftTask.validation = validation;
  draftTask.portfolioFit = validation.portfolioFit;

  const recommendations = {
    recommendedBenchmark,
    recommendedPrimaryCompetencyArea,
    recommendedCompetencies: selectedCompetencyRows,
    recommendedIndicators: selectedIndicatorRows,
    recommendedFeatures: selectedFeatureRows,
    recommendedSampleTaskLabels: selectedSampleTaskRows,
    alternateOptions: {
      benchmarks: alternates(rankedBenchmarks, [selectedBenchmarkId], 2),
      competencyAreas: alternates(rankedAreas, [s(selectedPrimaryArea?.id)], 2),
      competencies: alternates(rankedCompetencies, selectedCompetencyRows.map((row) => s(row.id)), 3),
      sampleTaskLabels: alternates(rankedSampleTasks, selectedSampleTaskRows.map((row) => s(row.id)), 2)
    },
    qualitySafeguards: safeguards,
    rationale: {
      phases: ['A:benchmark', 'B:primary-competency-area', 'C:core-competencies', 'D:supporting-mapping'],
      skill: signals.skill,
      preferredLevel: signals.preferredLevel,
      taskType,
      contextDomain: signals.contextDomain,
      desiredModality: signals.desiredModality,
      artifactType: signals.artifactType,
      intentTokens: signals.intentTokens
    },

    // Backward compatibility aliases
    benchmark: recommendedBenchmark,
    competencies: selectedCompetencyRows,
    indicators: selectedIndicatorRows,
    featuresOfCommunication: selectedFeatureRows,
    sampleTaskLabels: selectedSampleTaskRows,
    profileOfAbility: profileRecommendation
  };

  return {
    recommendations,
    draftTask
  };
}

module.exports = {
  generateTaskDraft
};
