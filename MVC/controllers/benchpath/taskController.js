const benchpathDataService = require('../../services/benchpath/benchpathDataService');
const taskAuthoringService = require('../../services/benchpath/taskAuthoring');
const {
  aiProviderService: benchpathAiProviderService,
  benchpathPromptService
} = require('../../services/benchpath/ai');
const {
  normalizeSkillInput,
  parseApproxLevel,
  parseRangeMidpoint,
  classifyTaskType,
  benchmarkLevel
} = require('../../services/benchpath/taskAuthoring/taskAuthoringCommon');
const { isAjax, buildDataServiceQuery } = require('../../utils/generalTools');
const adminAuthorityService = require('../../services/adminAuthorityService');

const DEFAULT_SEARCH_FIELDS = [
  'id',
  'slug',
  'title',
  'skill',
  'selectedBenchmarkId',
  'taskType',
  'status',
  'createdBy'
];

const TASK_TYPE_OPTIONS = ['assessment', 'enabling'];
const CONTEXT_DOMAIN_OPTIONS = ['community', 'work', 'study', 'school', 'daily_life'];
const SUPPORT_LEVEL_OPTIONS = ['independent', 'limited_support', 'guided_support', 'high_support'];
const COLLECTION_METHOD_OPTIONS = [
  'teacher_observation_notes',
  'artifact_capture',
  'audio_capture',
  'video_capture',
  'peer_observation',
  'self_reflection'
];

function s(value) {
  return String(value == null ? '' : value).trim();
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values = []) {
  return Array.from(new Set(arr(values).map((entry) => s(entry)).filter(Boolean)));
}

function nowIso() {
  return new Date().toISOString();
}

function taskId() {
  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `task:benchpath:${stamp}:${rand}`;
}

function slugify(value) {
  return s(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function parseStep(stepRaw) {
  return taskAuthoringService.normalizeWizardStep(stepRaw);
}

function stepMeta(stepNumber) {
  return taskAuthoringService.getWizardStepMeta(stepNumber);
}

function splitTextRows(value) {
  return taskAuthoringService.parseListInput(value);
}

function splitIdRows(value) {
  return taskAuthoringService.parseIdListInput(value);
}

function parseEstimateMinutes(value, fallback = 25) {
  const parsed = Number.parseInt(s(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function stepUrlForNew(step) {
  return `/benchpath/tasks/new-wizard/${parseStep(step)}`;
}

function stepUrlForEdit(taskIdValue, step) {
  return `/benchpath/tasks/edit-wizard/${encodeURIComponent(s(taskIdValue))}/${parseStep(step)}`;
}

function wizardPathForMode(mode, taskIdValue, step) {
  const normalizedId = s(taskIdValue);
  if (mode === 'edit') return stepUrlForEdit(normalizedId, step);
  const base = stepUrlForNew(step);
  if (!normalizedId) return base;
  return `${base}?draftId=${encodeURIComponent(normalizedId)}`;
}

function addNotice(url, message, type = 'success') {
  const base = s(url) || '/benchpath/tasks';
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}notice=${encodeURIComponent(message)}&noticeType=${encodeURIComponent(type)}`;
}

function skillLabel(skillId) {
  const normalized = s(skillId).replace(/^skill:/, '');
  if (!normalized) return 'Skill';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function preferredLevelFromTask(task = {}) {
  return parseApproxLevel(task?.learnerContext?.approximateLevel)
    || parseRangeMidpoint(task?.learnerContext?.clbRange)
    || 2;
}

function extractNotice(req) {
  return {
    message: s(req.query.notice),
    type: s(req.query.noticeType) || 'success'
  };
}

function buildInitialTaskTemplate(requestingUser) {
  return {
    id: taskId(),
    slug: `task-draft-${Date.now()}`,
    title: 'BenchPath Task Draft',
    orgId: s(requestingUser?.activeOrgId) || 'SYSTEM',
    createdBy: s(requestingUser?.id) || 'system',
    learnerContext: { goal: '', realWorldNeed: '', learnerNotes: '', clbRange: '', approximateLevel: '' },
    classContext: { summary: '', desiredModality: '', contextDomain: '' },
    skill: '',
    suggestedBenchmarkId: '',
    selectedBenchmarkId: '',
    competencyAreaIds: [],
    competencyIds: [],
    profileOfAbilityRefs: [],
    indicatorIds: [],
    featureOfCommunicationIds: [],
    sampleTaskLabelIds: [],
    taskType: 'assessment',
    realWorldScenario: '',
    learnerInstructions: '',
    teacherInstructions: '',
    taskConditions: {
      modality: '',
      supportLevel: 'limited_support',
      estimatedTimeMinutes: 25,
      materialsResources: [],
      conditionsNotes: '',
      authenticityGuidance: ''
    },
    evidencePlan: { observableEvidence: [], artifacts: [], collectionMethods: [] },
    criteriaForSuccess: [],
    rubricDraft: { rubricType: 'analytic-checklist', generatedAt: null, criteria: [], notes: [] },
    portfolioFit: {},
    validation: {},
    wizardTrace: {},
    status: 'draft',
    isActive: true,
    notes: null,
    tags: ['benchpath', 'task-authoring', 'wizard-draft'],
    version: 1,
    extensions: {}
  };
}

async function loadTaskOrNull(taskIdValue, requestingUser) {
  const normalizedId = s(taskIdValue);
  if (!normalizedId) return null;
  return benchpathDataService.getDataById('benchpathTasks', normalizedId, requestingUser);
}

function getStoredTaskPackage(task = {}) {
  const pkg = task?.extensions?.taskPackage;
  if (!pkg || typeof pkg !== 'object') return null;
  return pkg;
}

async function resolveTaskPackage(task, requestingUser, options = {}) {
  const force = options.force === true;
  const stored = getStoredTaskPackage(task);
  if (!force && stored && s(stored?.version) === 'task-package.v1') {
    return { packageData: stored, persisted: false };
  }

  const generated = await taskAuthoringService.generateTaskPackage(task, { requestingUser });
  if (!force) return { packageData: generated, persisted: false };

  const mergedTask = {
    ...task,
    extensions: {
      ...(task.extensions || {}),
      taskPackage: generated
    }
  };

  await benchpathDataService.updateData('benchpathTasks', task.id, mergedTask, requestingUser);
  return { packageData: generated, persisted: true };
}

function packageViewModel(task, packageData) {
  return {
    taskId: s(task?.id),
    title: s(task?.title) || 'BenchPath Task Package',
    status: s(task?.status) || 'draft',
    packageData: packageData || null,
    readiness: packageData?.readiness || null,
    learnerTaskSheet: packageData?.outputs?.learnerTaskSheet || null,
    teacherAssessmentSheet: packageData?.outputs?.teacherAssessmentSheet || null,
    pblaEvidenceRecord: packageData?.outputs?.pblaEvidenceRecord || null
  };
}

async function listTasks(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, {
      allowedExactKeys: ['id', 'skill', 'selectedBenchmarkId', 'taskType', 'status', 'createdBy'],
      defaultSearchFields: DEFAULT_SEARCH_FIELDS,
      allowedSearchFields: DEFAULT_SEARCH_FIELDS
    });
    const paged = await benchpathDataService.fetchDataPaged('benchpathTasks', query, req.user);
    const data = Array.isArray(paged?.rows) ? paged.rows : [];
    const pagination = paged?.pagination || null;
    const notice = extractNotice(req);

    if (isAjax(req)) {
      return res.json({ status: 'success', data, pagination, searchableFields: DEFAULT_SEARCH_FIELDS });
    }

    return res.render('benchpath/task/tasks', {
      title: 'BenchPath Tasks',
      data,
      searchableFields: DEFAULT_SEARCH_FIELDS,
      newUrl: 'benchpath/tasks',
      newLabel: 'New Task Wizard',
      tableName: 'BenchPath_Tasks',
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: false,
      print: true,
      pagination,
      filters: req.query,
      user: req.user || null,
      actionStateId: req?.actionStateId || '',
      noticeMessage: notice.message,
      noticeType: notice.type
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function viewTask(req, res) {
  try {
    const task = await benchpathDataService.getDataById('benchpathTasks', req.params.id, req.user);
    if (!task) return res.status(404).render('404', { user: req.user || null });
    const { packageData } = await resolveTaskPackage(task, req.user);
    const vm = packageViewModel(task, packageData);
    const canShowRaw = adminAuthorityService.isAdmin(req.user);

    return res.render('benchpath/task/taskView', {
      title: `BenchPath Task ${task.id}`,
      task,
      packageView: vm,
      canShowRaw,
      includeModal: true,
      user: req.user || null,
      actionStateId: req?.actionStateId || ''
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function deleteTask(req, res) {
  try {
    const task = await benchpathDataService.getDataById('benchpathTasks', req.params.id, req.user);
    if (!task) throw new Error('Task not found or outside organization scope.');
    await benchpathDataService.deleteData('benchpathTasks', req.params.id, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Task deleted successfully.' });
    return res.redirect('/benchpath/tasks');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

function benchmarkLevelFromRow(row) {
  return benchmarkLevel(row);
}

function normalizeTaskTypeInput(value, fallback = '') {
  const normalized = s(value).toLowerCase();
  if (TASK_TYPE_OPTIONS.includes(normalized)) return normalized;
  const fallbackNormalized = s(fallback).toLowerCase();
  if (TASK_TYPE_OPTIONS.includes(fallbackNormalized)) return fallbackNormalized;
  return 'assessment';
}

function buildStepOneUpstreamSnapshotFromTask(task = {}) {
  return {
    skill: normalizeSkillInput(task.skill) || s(task.skill),
    approximateLevel: s(task?.learnerContext?.approximateLevel),
    clbRange: normalizeClbRangeInput(task?.learnerContext?.clbRange),
    classContext: s(task?.classContext?.summary),
    learnerGoal: s(task?.learnerContext?.goal),
    realWorldNeed: s(task?.learnerContext?.realWorldNeed || task?.realWorldScenario),
    taskType: normalizeTaskTypeInput(task?.taskType, 'assessment')
  };
}

function buildStepOneUpstreamSnapshotFromInputs(inputs = {}) {
  return {
    skill: normalizeSkillInput(inputs.skill) || s(inputs.skill),
    approximateLevel: s(inputs.approximateLevel),
    clbRange: normalizeClbRangeInput(inputs.clbRange),
    classContext: s(inputs.classContext),
    learnerGoal: s(inputs.learnerGoal),
    realWorldNeed: s(inputs.realWorldNeed),
    taskType: normalizeTaskTypeInput(inputs.taskType, 'assessment')
  };
}

function stepOneUpstreamSignature(snapshot = {}) {
  return JSON.stringify({
    skill: s(snapshot.skill),
    approximateLevel: s(snapshot.approximateLevel),
    clbRange: s(snapshot.clbRange),
    classContext: s(snapshot.classContext),
    learnerGoal: s(snapshot.learnerGoal),
    realWorldNeed: s(snapshot.realWorldNeed),
    taskType: s(snapshot.taskType)
  });
}

function hasStepThreeMapping(task = {}) {
  return Boolean(
    s(task?.selectedBenchmarkId)
    || arr(task?.competencyIds).length
    || arr(task?.indicatorIds).length
    || arr(task?.featureOfCommunicationIds).length
    || arr(task?.sampleTaskLabelIds).length
  );
}

async function chooseInitialBenchmarkId(skillId, learnerContext, requestingUser) {
  const normalizedSkill = normalizeSkillInput(skillId);
  if (!normalizedSkill) return '';

  const allBenchmarks = await benchpathDataService.fetchData('clbBenchmarks', {}, requestingUser);
  const candidates = arr(allBenchmarks)
    .filter((row) => s(row.skillId) === normalizedSkill)
    .filter((row) => {
      const level = benchmarkLevelFromRow(row);
      return level != null && level >= 1 && level <= 4;
    });
  if (!candidates.length) return '';

  const preferredLevel = parseApproxLevel(learnerContext?.approximateLevel)
    || parseRangeMidpoint(learnerContext?.clbRange)
    || 2;

  const sorted = [...candidates].sort((left, right) => {
    const leftLevel = benchmarkLevelFromRow(left) || 99;
    const rightLevel = benchmarkLevelFromRow(right) || 99;
    const leftDistance = Math.abs(leftLevel - preferredLevel);
    const rightDistance = Math.abs(rightLevel - preferredLevel);
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    if (leftLevel !== rightLevel) return leftLevel - rightLevel;
    return s(left.id).localeCompare(s(right.id));
  });

  return s(sorted[0]?.id);
}

function mergeStepOne(task, body = {}) {
  const normalizedSkill = normalizeSkillInput(body.skill) || s(task.skill);
  const learnerGoal = s(body.learnerGoal);
  const classContext = s(body.classContext);
  const realWorldNeed = s(body.realWorldNeed);
  const clbRange = s(body.clbRange);
  const approximateLevel = s(body.approximateLevel);
  const taskType = normalizeTaskTypeInput(body.taskType, task.taskType);
  const extensions = task?.extensions && typeof task.extensions === 'object' ? task.extensions : {};
  const wizardDraftData = extensions?.wizardDraftData && typeof extensions.wizardDraftData === 'object'
    ? extensions.wizardDraftData
    : {};
  const previousSnapshot = wizardDraftData?.upstreamStep1Snapshot && typeof wizardDraftData.upstreamStep1Snapshot === 'object'
    ? wizardDraftData.upstreamStep1Snapshot
    : {};
  const fallbackPreviousSignature = stepOneUpstreamSignature(buildStepOneUpstreamSnapshotFromTask(task));
  const previousSignature = s(previousSnapshot.signature) || fallbackPreviousSignature;
  const nextSnapshot = buildStepOneUpstreamSnapshotFromInputs({
    skill: normalizedSkill,
    approximateLevel,
    clbRange,
    classContext,
    learnerGoal,
    realWorldNeed,
    taskType
  });
  const nextSignature = stepOneUpstreamSignature(nextSnapshot);
  const upstreamChanged = Boolean(previousSignature) && previousSignature !== nextSignature;
  const hasDownstreamData = Boolean(
    s(task?.classContext?.desiredModality)
    || s(task?.classContext?.contextDomain)
    || s(task?.taskConditions?.authenticityGuidance)
    || hasStepThreeMapping(task)
  );
  const staleState = wizardDraftData?.stale && typeof wizardDraftData.stale === 'object'
    ? wizardDraftData.stale
    : {};
  const markDownstreamStale = upstreamChanged && hasDownstreamData;
  const nextStaleState = markDownstreamStale
    ? {
      step2: true,
      step3: true,
      reason: 'Step 2/3 suggestions may be outdated because Step 1 inputs changed.',
      updatedAt: nowIso()
    }
    : {
      step2: Boolean(staleState.step2),
      step3: Boolean(staleState.step3),
      reason: s(staleState.reason),
      updatedAt: s(staleState.updatedAt)
    };

  return {
    ...task,
    skill: normalizedSkill,
    taskType,
    learnerContext: {
      ...(task.learnerContext || {}),
      goal: learnerGoal,
      realWorldNeed,
      clbRange,
      approximateLevel
    },
    classContext: {
      ...(task.classContext || {}),
      summary: classContext
    },
    realWorldScenario: s(task.realWorldScenario) || realWorldNeed,
    extensions: {
      ...extensions,
      wizardDraftData: {
        ...wizardDraftData,
        step1: {
          skill: normalizedSkill,
          learnerGoal,
          classContext,
          realWorldNeed,
          clbRange,
          approximateLevel,
          taskType
        },
        upstreamStep1Snapshot: {
          ...nextSnapshot,
          signature: nextSignature,
          updatedAt: nowIso()
        },
        stale: nextStaleState
      }
    }
  };
}

function safeJsonParse(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;

  const candidates = [];
  const pushCandidate = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    if (!candidates.includes(normalized)) candidates.push(normalized);
  };

  pushCandidate(text);

  const fenceRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  let fenceMatch;
  while ((fenceMatch = fenceRegex.exec(text)) !== null) {
    pushCandidate(fenceMatch[1]);
  }

  const firstObject = text.indexOf('{');
  const lastObject = text.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject) {
    pushCandidate(text.slice(firstObject, lastObject + 1));
  }

  const firstArray = text.indexOf('[');
  const lastArray = text.lastIndexOf(']');
  if (firstArray >= 0 && lastArray > firstArray) {
    pushCandidate(text.slice(firstArray, lastArray + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (_) {}
  }

  return null;
}

function extractStructuredAiPayload(aiResponse = {}) {
  const direct = aiResponse?.structuredPayload;
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;

  const parts = arr(aiResponse?.raw?.candidates)
    .flatMap((candidate) => arr(candidate?.content?.parts));

  for (const part of parts) {
    const args = part?.functionCall?.args;
    if (args && typeof args === 'object' && !Array.isArray(args)) {
      return args;
    }
    if (typeof args === 'string') {
      const parsedArgs = safeJsonParse(args);
      if (parsedArgs && typeof parsedArgs === 'object' && !Array.isArray(parsedArgs)) return parsedArgs;
    }
  }

  return null;
}

function normalizeClbRangeInput(value) {
  const raw = s(value);
  if (!raw) return '';

  const rangeMatch = raw.match(/(\d{1,2})\s*[-to]+\s*(\d{1,2})/i);
  if (rangeMatch) {
    let left = Number.parseInt(rangeMatch[1], 10);
    let right = Number.parseInt(rangeMatch[2], 10);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return raw;
    left = Math.max(1, Math.min(4, left));
    right = Math.max(1, Math.min(4, right));
    if (left > right) [left, right] = [right, left];
    return `${left}-${right}`;
  }

  const single = parseApproxLevel(raw);
  return single == null ? raw : String(single);
}

function validateStepOneAutoGenerationInputs(task = {}) {
  const errors = [];
  if (!normalizeSkillInput(task.skill)) errors.push('Skill is required before Auto Generation.');
  if (parseApproxLevel(task?.learnerContext?.approximateLevel) == null) errors.push('Approx CLB is required before Auto Generation.');
  if (!s(task?.learnerContext?.clbRange)) errors.push('CLB Range is required before Auto Generation.');
  if (!s(task?.classContext?.summary)) errors.push('Class context is required before Auto Generation.');
  if (!s(task?.learnerContext?.goal)) errors.push('Learner goal is required before Auto Generation.');
  if (!s(task?.taskType)) errors.push('Task Type is required before Auto Generation.');
  return {
    isValid: errors.length === 0,
    errors
  };
}

function buildStepOneAiVariables(task = {}) {
  const skillId = normalizeSkillInput(task.skill) || s(task.skill);
  const skillLabel = s(skillId).replace(/^skill:/, '');
  return {
    skill: skillLabel || skillId || '',
    taskType: s(task?.taskType),
    approximateLevel: s(task?.learnerContext?.approximateLevel),
    clbRange: s(task?.learnerContext?.clbRange),
    learnerGoal: s(task?.learnerContext?.goal),
    classContext: s(task?.classContext?.summary),
    existingRealWorldNeed: s(task?.learnerContext?.realWorldNeed || task?.realWorldScenario),
    existingDesiredModality: s(task?.classContext?.desiredModality || task?.taskConditions?.modality),
    existingContextDomain: s(task?.classContext?.contextDomain),
    existingAuthenticityGuidance: s(task?.taskConditions?.authenticityGuidance)
  };
}

function inferCompatibilityFromTexts(texts = []) {
  const joined = arr(texts).map((entry) => s(entry).toLowerCase()).filter(Boolean).join(' ');
  if (!joined) return null;

  const negativePatterns = [
    /too advanced/,
    /not compatible/,
    /incompatible/,
    /mismatch/,
    /above clb/,
    /beyond clb/,
    /too difficult/,
    /not aligned/,
    /outside clb/,
    /not appropriate/
  ];
  if (negativePatterns.some((pattern) => pattern.test(joined))) return false;

  const positivePatterns = [
    /compatible/,
    /aligned/,
    /appropriate/,
    /fits clb/,
    /suitable/
  ];
  if (positivePatterns.some((pattern) => pattern.test(joined))) return true;
  return null;
}

function isValidClbRange(value) {
  const raw = s(value);
  if (!raw) return false;
  const range = raw.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (range) {
    const left = Number.parseInt(range[1], 10);
    const right = Number.parseInt(range[2], 10);
    return Number.isFinite(left) && Number.isFinite(right) && left >= 1 && right <= 4 && left <= right;
  }
  const single = parseApproxLevel(raw);
  return single != null;
}

function finalizeStep1FieldAssessments({
  task = {},
  fieldAssessments = {},
  compatibilityFlag = null,
  suggestedRealWorldNeed = '',
  teacherFacingNotes = [],
  compatibilityRaw = {}
} = {}) {
  const assessments = fieldAssessments && typeof fieldAssessments === 'object' ? { ...fieldAssessments } : {};
  const goalText = s(task?.learnerContext?.goal);
  const classContext = s(task?.classContext?.summary);
  const skillId = normalizeSkillInput(task.skill) || s(task.skill);
  const taskType = normalizeTaskTypeInput(task?.taskType, 'assessment');
  const approximateLevel = s(task?.learnerContext?.approximateLevel);
  const clbRange = normalizeClbRangeInput(task?.learnerContext?.clbRange);
  const realWorldNeed = s(suggestedRealWorldNeed) || s(task?.learnerContext?.realWorldNeed || task?.realWorldScenario);
  const inferredFromNotes = inferCompatibilityFromTexts([
    ...arr(teacherFacingNotes),
    ...arr(compatibilityRaw?.clbFitNotes),
    compatibilityRaw?.rationale
  ]);
  const finalCompatibility = compatibilityFlag == null ? inferredFromNotes : compatibilityFlag;
  const learnerGoalSuggested = s(compatibilityRaw?.recommendedLearnerGoal);
  const deriveLearnerGoalSuggestion = () => {
    const sourceText = `${classContext} ${realWorldNeed}`.toLowerCase();
    if (/school|linc|teacher|class/.test(sourceText) && /writing$/.test(skillId)) {
      return 'Write a short, simple note to your LINC teacher about absence or a basic class question.';
    }
    if (/school|linc|teacher|class/.test(sourceText) && /speaking$/.test(skillId)) {
      return 'Ask your LINC teacher a simple question about class schedule or homework.';
    }
    if (/school|linc|teacher|class/.test(sourceText) && /reading$/.test(skillId)) {
      return 'Read a short school message and identify the main information.';
    }
    if (/school|linc|teacher|class/.test(sourceText) && /listening$/.test(skillId)) {
      return 'Understand a short spoken class message about attendance or schedule.';
    }
    if (/writing$/.test(skillId)) return 'Write a short, simple message for an immediate routine need.';
    if (/speaking$/.test(skillId)) return 'Say short, simple sentences for an immediate routine need.';
    if (/reading$/.test(skillId)) return 'Read a short, simple message related to a routine need.';
    if (/listening$/.test(skillId)) return 'Understand a short, simple spoken message about a routine need.';
    return 'Complete a simple communication task for an immediate routine need.';
  };

  const withDefaults = (entry = {}, defaults = {}) => {
    const compatible = entry.compatible === true
      ? true
      : (entry.compatible === false ? false : (defaults.compatible == null ? null : defaults.compatible));
    return {
      compatible,
      rationale: s(entry.rationale) || s(defaults.rationale),
      suggestedValue: s(entry.suggestedValue) || s(defaults.suggestedValue),
      severity: s(entry.severity) || s(defaults.severity),
      shouldUpdate: entry.shouldUpdate === true || defaults.shouldUpdate === true
    };
  };

  const out = {
    skill: withDefaults(assessments.skill, {
      compatible: Boolean(skillId),
      rationale: skillId ? 'Skill is selected.' : 'Skill is missing.',
      suggestedValue: skillId,
      severity: skillId ? '' : 'warning',
      shouldUpdate: !skillId
    }),
    approximateLevel: withDefaults(assessments.approximateLevel, {
      compatible: parseApproxLevel(approximateLevel) != null,
      rationale: parseApproxLevel(approximateLevel) != null
        ? 'Approx CLB is within CLB 1-4 scope.'
        : 'Approx CLB should be a number between 1 and 4.',
      suggestedValue: parseApproxLevel(approximateLevel) != null ? approximateLevel : '',
      severity: parseApproxLevel(approximateLevel) != null ? '' : 'warning',
      shouldUpdate: parseApproxLevel(approximateLevel) == null
    }),
    clbRange: withDefaults(assessments.clbRange, {
      compatible: isValidClbRange(clbRange),
      rationale: isValidClbRange(clbRange)
        ? 'CLB range is within CLB 1-4 scope.'
        : 'CLB range should be within CLB 1-4 (for example 1-2).',
      suggestedValue: isValidClbRange(clbRange) ? clbRange : '',
      severity: isValidClbRange(clbRange) ? '' : 'warning',
      shouldUpdate: !isValidClbRange(clbRange)
    }),
    classContext: withDefaults(assessments.classContext, {
      compatible: classContext.length >= 8,
      rationale: classContext.length >= 8
        ? 'Class context is present.'
        : 'Class context should be more specific.',
      suggestedValue: classContext,
      severity: classContext.length >= 8 ? '' : 'warning',
      shouldUpdate: classContext.length < 8
    }),
    learnerGoal: withDefaults(assessments.learnerGoal, {
      compatible: finalCompatibility == null ? (goalText.length >= 8 ? true : null) : finalCompatibility,
      rationale: s(compatibilityRaw?.rationale)
        || (finalCompatibility === false
          ? 'Learner goal appears mismatched with selected CLB context.'
          : (goalText.length >= 8 ? 'Learner goal is present.' : 'Learner goal needs more detail.')),
      suggestedValue: learnerGoalSuggested || (finalCompatibility === false ? deriveLearnerGoalSuggestion() : ''),
      severity: finalCompatibility === false ? 'warning' : '',
      shouldUpdate: finalCompatibility === false
    }),
    realWorldNeed: withDefaults(assessments.realWorldNeed, {
      compatible: Boolean(realWorldNeed),
      rationale: realWorldNeed
        ? 'Real-world need is available for Step 1.'
        : 'Real-world need should be provided.',
      suggestedValue: realWorldNeed,
      severity: realWorldNeed ? '' : 'warning',
      shouldUpdate: !realWorldNeed
    }),
    taskType: withDefaults(assessments.taskType, {
      compatible: Boolean(taskType),
      rationale: taskType ? 'Task type is selected by teacher.' : 'Task type is required.',
      suggestedValue: taskType,
      severity: taskType ? '' : 'warning',
      shouldUpdate: false
    })
  };

  return out;
}

function normalizeStep1FieldAssessments(raw = {}, task = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const parseBooleanLike = (value) => {
    if (value === true || value === false) return value;
    const normalized = s(value).toLowerCase();
    if (!normalized) return null;
    if (['true', 'yes', 'y', '1', 'compatible', 'pass', 'ok'].includes(normalized)) return true;
    if (['false', 'no', 'n', '0', 'incompatible', 'fail', 'mismatch'].includes(normalized)) return false;
    return null;
  };
  const getRaw = (key) => (source[key] && typeof source[key] === 'object' ? source[key] : {});
  const normalizeEntry = (rawEntry, currentValue = '') => {
    const compatible = parseBooleanLike(rawEntry?.compatible);
    return {
      compatible,
      rationale: s(rawEntry?.rationale || rawEntry?.reason || rawEntry?.note),
      suggestedValue: s(rawEntry?.suggestedValue || rawEntry?.recommendedValue || rawEntry?.suggested),
      severity: s(rawEntry?.severity || rawEntry?.level).toLowerCase() || (compatible === false ? 'warning' : ''),
      shouldUpdate: rawEntry?.shouldUpdate === true
    };
  };

  return {
    skill: normalizeEntry(getRaw('skill'), s(task?.skill)),
    approximateLevel: normalizeEntry(getRaw('approximateLevel'), s(task?.learnerContext?.approximateLevel)),
    clbRange: normalizeEntry(getRaw('clbRange'), s(task?.learnerContext?.clbRange)),
    classContext: normalizeEntry(getRaw('classContext'), s(task?.classContext?.summary)),
    learnerGoal: normalizeEntry(getRaw('learnerGoal'), s(task?.learnerContext?.goal)),
    realWorldNeed: normalizeEntry(getRaw('realWorldNeed'), s(task?.learnerContext?.realWorldNeed || task?.realWorldScenario)),
    taskType: normalizeEntry(getRaw('taskType'), s(task?.taskType))
  };
}

async function runStepOneAutoGeneration(task = {}) {
  const variables = buildStepOneAiVariables(task);
  const renderedPrompt = await benchpathPromptService.renderPrompt({
    promptType: 'task_wizard_step1_context_assist',
    variables
  });

  const responseSchema = {
    type: 'object',
    properties: {
      learnerGoalCompatibility: {
        type: 'object',
        properties: {
          compatible: { type: 'boolean' },
          confidence: { type: 'string' },
          rationale: { type: 'string' },
          clbFitNotes: { type: 'array', items: { type: 'string' } },
          recommendedLearnerGoal: { type: 'string' }
        }
      },
      suggestedRealWorldNeed: { type: 'string' },
      suggestedDesiredModality: { type: 'string' },
      suggestedContextDomain: { type: 'string' },
      suggestedAuthenticityGuidance: { type: 'string' },
      intentReview: {
        type: 'object',
        properties: {
          intentClassification: { type: 'string' },
          confidence: { type: 'string' },
          why: { type: 'string' },
          authenticityChecklist: { type: 'array', items: { type: 'string' } },
          cautionFlags: { type: 'array', items: { type: 'string' } }
        }
      },
      fieldAssessments: {
        type: 'object',
        properties: {
          skill: { type: 'object' },
          approximateLevel: { type: 'object' },
          clbRange: { type: 'object' },
          classContext: { type: 'object' },
          learnerGoal: { type: 'object' },
          realWorldNeed: { type: 'object' },
          taskType: { type: 'object' }
        }
      },
      step2FieldAssessments: {
        type: 'object',
        properties: {
          desiredModality: { type: 'object' },
          contextDomain: { type: 'object' },
          authenticityGuidance: { type: 'object' }
        }
      },
      contextGaps: { type: 'array', items: { type: 'string' } },
      suggestedFollowUpQuestion: { type: 'string' },
      teacherFacingNotes: { type: 'array', items: { type: 'string' } }
    }
  };

  const aiInstruction = [
    'Return ONLY JSON.',
    'Use only provided Step 1 inputs and current taskType.',
    'Generate suggestedRealWorldNeed, suggestedDesiredModality, suggestedContextDomain, and suggestedAuthenticityGuidance.',
    'Do not override taskType.',
    'Include learnerGoalCompatibility with compatibility judgment against selected CLB.',
    'Include fieldAssessments for: skill, approximateLevel, clbRange, classContext, learnerGoal, realWorldNeed, taskType.',
    'Include step2FieldAssessments for: desiredModality, contextDomain, authenticityGuidance.',
    'Include intentReview with: intentClassification, confidence, why, authenticityChecklist, cautionFlags.',
    'Each field assessment must include: compatible, severity, rationale, suggestedValue, shouldUpdate.',
    'Keep contextDomain within: community, work, study, school, daily_life.',
    'Keep CLB scope in 1-4.',
    'Do not use markdown.'
  ].join(' ');

  const messages = benchpathPromptService.buildMessagesFromRenderedPrompt(renderedPrompt, [
    { role: 'user', content: aiInstruction }
  ]);

  const aiResponse = await benchpathAiProviderService.sendPrompt({
    messages,
    responseMimeType: 'application/json',
    responseSchema,
    requestLabel: 'benchpath.task-wizard.step1-2.auto-generation'
  });

  const structuredPayload = extractStructuredAiPayload(aiResponse);
  const rawResponseText = [
    s(aiResponse?.text),
    arr(aiResponse?.raw?.candidates)
      .flatMap((candidate) => arr(candidate?.content?.parts))
      .map((part) => s(part?.text || part?.functionCall?.args))
      .filter(Boolean)
      .join('\n')
  ].filter(Boolean).join('\n');

  let parsed = structuredPayload || safeJsonParse(rawResponseText);
  if (Array.isArray(parsed)) {
    parsed = parsed.find((entry) => entry && typeof entry === 'object') || null;
  }
  if (!parsed || typeof parsed !== 'object') {
    parsed = {};
  }

  const fallbackRealWorldNeed = s(task?.learnerContext?.realWorldNeed || task?.realWorldScenario)
    || `Complete a simple ${s(task?.taskType || 'assessment')} task connected to an immediate real-world need.`;
  const suggestedRealWorldNeed = s(parsed.suggestedRealWorldNeed || parsed.realWorldNeed) || fallbackRealWorldNeed;

  const compatibilityRaw = parsed?.learnerGoalCompatibility && typeof parsed.learnerGoalCompatibility === 'object'
    ? parsed.learnerGoalCompatibility
    : {};
  const parseBooleanLike = (value) => {
    if (value === true || value === false) return value;
    const normalized = s(value).toLowerCase();
    if (!normalized) return null;
    if (['true', 'yes', 'y', '1', 'compatible', 'pass', 'ok'].includes(normalized)) return true;
    if (['false', 'no', 'n', '0', 'incompatible', 'fail', 'mismatch'].includes(normalized)) return false;
    return null;
  };
  const fieldAssessments = normalizeStep1FieldAssessments(
    parsed?.fieldAssessments || parsed?.fieldResults || parsed?.inputAssessments,
    task
  );
  const learnerGoalField = fieldAssessments.learnerGoal || {};
  const compatibilityFlag = parseBooleanLike(compatibilityRaw.compatible) ?? learnerGoalField.compatible;
  if (compatibilityFlag !== null) {
    const learnerGoalAssessment = fieldAssessments.learnerGoal && typeof fieldAssessments.learnerGoal === 'object'
      ? fieldAssessments.learnerGoal
      : {};
    fieldAssessments.learnerGoal = {
      ...learnerGoalAssessment,
      compatible: compatibilityFlag,
      rationale: s(learnerGoalAssessment.rationale) || s(compatibilityRaw.rationale),
      suggestedValue: s(learnerGoalAssessment.suggestedValue) || s(compatibilityRaw.recommendedLearnerGoal),
      severity: s(learnerGoalAssessment.severity) || (compatibilityFlag === false ? 'warning' : '')
    };
  }
  const teacherFacingNotes = uniqueStrings(arr(parsed.teacherFacingNotes)).slice(0, 8);
  const finalizedFieldAssessments = finalizeStep1FieldAssessments({
    task,
    fieldAssessments,
    compatibilityFlag,
    suggestedRealWorldNeed,
    teacherFacingNotes,
    compatibilityRaw
  });
  const finalizedGoalField = finalizedFieldAssessments.learnerGoal || {};
  const finalCompatibilityFlag = finalizedGoalField.compatible === true
    ? true
    : (finalizedGoalField.compatible === false ? false : compatibilityFlag);

  const intentReviewRaw = parsed?.intentReview && typeof parsed.intentReview === 'object'
    ? parsed.intentReview
    : {};
  const selectedTaskType = normalizeTaskTypeInput(task?.taskType, 'assessment');
  const suggestedDesiredModality = s(parsed.suggestedDesiredModality || intentReviewRaw.suggestedDesiredModality)
    || deriveStepTwoModalitySuggestion(task, selectedTaskType);
  const suggestedContextDomain = normalizeContextDomainInput(parsed.suggestedContextDomain || intentReviewRaw.suggestedContextDomain)
    || normalizeContextDomainInput(task?.classContext?.contextDomain)
    || inferContextDomainFromText(`${s(task?.classContext?.summary)} ${suggestedRealWorldNeed}`);
  const suggestedAuthenticityGuidance = s(parsed.suggestedAuthenticityGuidance || intentReviewRaw.suggestedAuthenticityGuidance)
    || deriveStepTwoAuthenticitySuggestion({
      ...task,
      learnerContext: {
        ...(task.learnerContext || {}),
        realWorldNeed: suggestedRealWorldNeed
      }
    }, selectedTaskType);
  const step2FieldAssessments = normalizeStep2FieldAssessments(
    parsed?.step2FieldAssessments || parsed?.intentFieldAssessments || parsed?.fieldAssessmentsStep2 || parsed?.fieldAssessments,
    task
  );
  const finalizedStep2Assessments = finalizeStep2FieldAssessments({
    task: {
      ...task,
      taskType: selectedTaskType
    },
    fieldAssessments: step2FieldAssessments,
    generated: {
      desiredModality: suggestedDesiredModality,
      contextDomain: suggestedContextDomain,
      authenticityGuidance: suggestedAuthenticityGuidance
    },
    intentClassification: s(intentReviewRaw.intentClassification || parsed.intentClassification || selectedTaskType).toLowerCase()
  });
  const intentReview = {
    intentClassification: s(intentReviewRaw.intentClassification || parsed.intentClassification || selectedTaskType).toLowerCase() || selectedTaskType,
    confidence: s(intentReviewRaw.confidence || parsed.intentConfidence),
    why: s(intentReviewRaw.why || parsed.intentWhy),
    authenticityChecklist: uniqueStrings(arr(intentReviewRaw.authenticityChecklist || parsed.authenticityChecklist)).slice(0, 6),
    cautionFlags: uniqueStrings(arr(intentReviewRaw.cautionFlags || parsed.cautionFlags)).slice(0, 6)
  };

  return {
    generated: {
      realWorldNeed: suggestedRealWorldNeed,
      desiredModality: suggestedDesiredModality,
      contextDomain: suggestedContextDomain,
      authenticityGuidance: suggestedAuthenticityGuidance
    },
    compatibility: {
      compatible: finalCompatibilityFlag,
      confidence: s(compatibilityRaw.confidence) || (finalCompatibilityFlag === false ? 'medium' : ''),
      rationale: s(compatibilityRaw.rationale) || s(finalizedGoalField.rationale),
      clbFitNotes: uniqueStrings(arr(compatibilityRaw.clbFitNotes)),
      recommendedLearnerGoal: s(compatibilityRaw.recommendedLearnerGoal) || s(finalizedGoalField.suggestedValue)
    },
    intentReview,
    fieldAssessments: finalizedFieldAssessments,
    step2FieldAssessments: finalizedStep2Assessments,
    meta: {
      provider: s(aiResponse?.provider),
      modelUsed: s(aiResponse?.modelUsed),
      promptId: s(renderedPrompt?.promptDefinition?.id),
      contextGaps: uniqueStrings(arr(parsed.contextGaps)),
      suggestedFollowUpQuestion: s(parsed.suggestedFollowUpQuestion),
      teacherFacingNotes,
      usage: aiResponse?.usage || null,
      requestMeta: aiResponse?.requestMeta || null
    }
  };
}

function applyStepOneAutoGeneration(task = {}, autoGen = {}) {
  const generated = autoGen?.generated && typeof autoGen.generated === 'object'
    ? autoGen.generated
    : {};
  const intentReview = autoGen?.intentReview && typeof autoGen.intentReview === 'object'
    ? autoGen.intentReview
    : {};
  const compatibility = autoGen?.compatibility && typeof autoGen.compatibility === 'object'
    ? autoGen.compatibility
    : {};
  const step1FieldAssessments = autoGen?.fieldAssessments && typeof autoGen.fieldAssessments === 'object'
    ? autoGen.fieldAssessments
    : {};
  const step2FieldAssessments = autoGen?.step2FieldAssessments && typeof autoGen.step2FieldAssessments === 'object'
    ? autoGen.step2FieldAssessments
    : {};
  const meta = autoGen?.meta && typeof autoGen.meta === 'object'
    ? autoGen.meta
    : {};
  const extensions = task?.extensions && typeof task.extensions === 'object' ? task.extensions : {};
  const wizardDraftData = extensions?.wizardDraftData && typeof extensions.wizardDraftData === 'object'
    ? extensions.wizardDraftData
    : {};
  const realWorldNeed = s(generated.realWorldNeed);
  const desiredModality = s(generated.desiredModality);
  const contextDomain = normalizeContextDomainInput(generated.contextDomain) || normalizeContextDomainInput(task?.classContext?.contextDomain);
  const authenticityGuidance = s(generated.authenticityGuidance);
  const existingSkill = normalizeSkillInput(task.skill) || s(task.skill);
  const existingLearnerGoal = s(task?.learnerContext?.goal);
  const existingClassContext = s(task?.classContext?.summary);
  const existingClbRange = normalizeClbRangeInput(task?.learnerContext?.clbRange);
  const existingApproximateLevel = s(task?.learnerContext?.approximateLevel);
  const existingTaskType = normalizeTaskTypeInput(task?.taskType, 'assessment');
  const staleState = wizardDraftData?.stale && typeof wizardDraftData.stale === 'object'
    ? wizardDraftData.stale
    : {};
  const nextStaleState = {
    step2: false,
    step3: Boolean(staleState.step3),
    reason: Boolean(staleState.step3)
      ? 'Step 3 mapping may be outdated because Step 1 inputs changed.'
      : '',
    updatedAt: nowIso()
  };

  return {
    ...task,
    skill: existingSkill,
    taskType: existingTaskType,
    learnerContext: {
      ...(task.learnerContext || {}),
      goal: existingLearnerGoal,
      realWorldNeed,
      clbRange: existingClbRange,
      approximateLevel: existingApproximateLevel
    },
    classContext: {
      ...(task.classContext || {}),
      summary: existingClassContext,
      desiredModality,
      contextDomain
    },
    taskConditions: {
      ...(task.taskConditions || {}),
      modality: desiredModality,
      authenticityGuidance
    },
    realWorldScenario: realWorldNeed || s(task.realWorldScenario),
    wizardTrace: {
      ...(task.wizardTrace || {}),
      step1AutoGeneration: {
        generatedAt: nowIso(),
        provider: s(meta.provider),
        modelUsed: s(meta.modelUsed),
        promptId: s(meta.promptId),
        contextGaps: uniqueStrings(arr(meta.contextGaps)),
        suggestedFollowUpQuestion: s(meta.suggestedFollowUpQuestion),
        teacherFacingNotes: uniqueStrings(arr(meta.teacherFacingNotes)),
        learnerGoalCompatibility: {
          compatible: compatibility.compatible === true
            ? true
            : (compatibility.compatible === false ? false : null),
          confidence: s(compatibility.confidence),
          rationale: s(compatibility.rationale),
          clbFitNotes: uniqueStrings(arr(compatibility.clbFitNotes)),
          recommendedLearnerGoal: s(compatibility.recommendedLearnerGoal)
        },
        fieldAssessments: normalizeStep1FieldAssessments(step1FieldAssessments, task)
      },
      step2AutoGeneration: {
        generatedAt: nowIso(),
        provider: s(meta.provider),
        modelUsed: s(meta.modelUsed),
        promptId: s(meta.promptId),
        teacherFacingNotes: uniqueStrings(arr(meta.teacherFacingNotes)),
        intentReview: {
          intentClassification: s(intentReview.intentClassification),
          confidence: s(intentReview.confidence),
          why: s(intentReview.why),
          authenticityChecklist: uniqueStrings(arr(intentReview.authenticityChecklist)),
          cautionFlags: uniqueStrings(arr(intentReview.cautionFlags))
        },
        fieldAssessments: normalizeStep2FieldAssessments(step2FieldAssessments, task)
      }
    },
    extensions: {
      ...extensions,
      wizardDraftData: {
        ...wizardDraftData,
        step1: {
          skill: existingSkill,
          learnerGoal: existingLearnerGoal,
          classContext: existingClassContext,
          realWorldNeed,
          clbRange: existingClbRange,
          approximateLevel: existingApproximateLevel,
          taskType: existingTaskType
        },
        step2: {
          desiredModality,
          contextDomain,
          authenticityGuidance
        },
        stale: nextStaleState,
        upstreamStep1Snapshot: {
          ...buildStepOneUpstreamSnapshotFromInputs({
            skill: existingSkill,
            approximateLevel: existingApproximateLevel,
            clbRange: existingClbRange,
            classContext: existingClassContext,
            learnerGoal: existingLearnerGoal,
            realWorldNeed,
            taskType: existingTaskType
          }),
          signature: stepOneUpstreamSignature(buildStepOneUpstreamSnapshotFromInputs({
            skill: existingSkill,
            approximateLevel: existingApproximateLevel,
            clbRange: existingClbRange,
            classContext: existingClassContext,
            learnerGoal: existingLearnerGoal,
            realWorldNeed,
            taskType: existingTaskType
          })),
          updatedAt: nowIso()
        }
      },
      aiAssist: {
        ...(extensions.aiAssist && typeof extensions.aiAssist === 'object' ? extensions.aiAssist : {}),
        step1AutoGeneration: {
          generatedAt: nowIso(),
          usage: meta.usage || null,
          requestMeta: meta.requestMeta || null,
          fieldAssessments: normalizeStep1FieldAssessments(step1FieldAssessments, task)
        },
        step2AutoGeneration: {
          generatedAt: nowIso(),
          usage: meta.usage || null,
          requestMeta: meta.requestMeta || null,
          fieldAssessments: normalizeStep2FieldAssessments(step2FieldAssessments, task)
        }
      }
    }
  };
}

function normalizeContextDomainInput(value) {
  const normalized = s(value).toLowerCase().replace(/\s+/g, '_');
  if (!normalized) return '';
  const map = {
    community: 'community',
    work: 'work',
    study: 'study',
    school: 'school',
    daily_life: 'daily_life',
    dailylife: 'daily_life',
    daily: 'daily_life',
    life: 'daily_life'
  };
  return map[normalized] || '';
}

function inferContextDomainFromText(textValue = '') {
  const text = s(textValue).toLowerCase();
  if (!text) return '';
  if (/(school|teacher|class|assignment|homework|linc)/.test(text)) return 'school';
  if (/(job|work|manager|shift|office|coworker|employment)/.test(text)) return 'work';
  if (/(study|college|exam|test|course|training)/.test(text)) return 'study';
  if (/(landlord|rent|bus|bank|store|doctor|clinic|appointment|community)/.test(text)) return 'community';
  return 'daily_life';
}

function deriveStepTwoModalitySuggestion(task = {}, taskType = '') {
  const skillId = normalizeSkillInput(task.skill) || s(task.skill);
  const normalizedTaskType = s(taskType).toLowerCase();
  if (skillId === 'skill:writing') {
    return normalizedTaskType === 'enabling'
      ? 'Guided short written practice (note + key details)'
      : 'Short written note + simple form';
  }
  if (skillId === 'skill:speaking') {
    return normalizedTaskType === 'enabling'
      ? 'Guided role-play with model prompts'
      : 'Short role-play conversation';
  }
  if (skillId === 'skill:reading') {
    return normalizedTaskType === 'enabling'
      ? 'Guided reading of short real-world text'
      : 'Read a short real-world message and answer key questions';
  }
  if (skillId === 'skill:listening') {
    return normalizedTaskType === 'enabling'
      ? 'Guided listening with repetition support'
      : 'Listen to short instructions and complete a response task';
  }
  return normalizedTaskType === 'enabling'
    ? 'Guided classroom practice output'
    : 'Authentic classroom performance output';
}

function deriveStepTwoAuthenticitySuggestion(task = {}, taskType = '') {
  const normalizedTaskType = s(taskType).toLowerCase();
  const contextDomain = normalizeContextDomainInput(task?.classContext?.contextDomain)
    || inferContextDomainFromText(`${s(task?.classContext?.summary)} ${s(task?.learnerContext?.realWorldNeed || task?.realWorldScenario)}`);
  if (normalizedTaskType === 'enabling') {
    return `Use scaffolded ${contextDomain || 'classroom'} context with guided support; learners can use prompts before independent attempts.`;
  }
  return `Use realistic ${contextDomain || 'real-world'} context with limited support; assess independent completion of the task purpose.`;
}

function validateStepTwoAutoGenerationInputs(task = {}) {
  const errors = [];
  if (!s(task?.learnerContext?.goal)) errors.push('Learner Goal from Step 1 is required before Step 2 Auto Generation.');
  if (!s(task?.learnerContext?.realWorldNeed || task?.realWorldScenario)) errors.push('Real-World Need from Step 1 is required before Step 2 Auto Generation.');
  if (!s(task?.classContext?.summary)) errors.push('Class Context from Step 1 is required before Step 2 Auto Generation.');
  return {
    isValid: errors.length === 0,
    errors
  };
}

function buildStepTwoAiVariables(task = {}) {
  return {
    taskType: s(task?.taskType),
    desiredModality: s(task?.classContext?.desiredModality || task?.taskConditions?.modality),
    contextDomain: s(task?.classContext?.contextDomain),
    learnerGoal: s(task?.learnerContext?.goal),
    realWorldNeed: s(task?.learnerContext?.realWorldNeed || task?.realWorldScenario),
    classContext: s(task?.classContext?.summary),
    skill: s(normalizeSkillInput(task?.skill) || task?.skill)
  };
}

function normalizeStep2FieldAssessments(raw = {}, task = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const parseBooleanLike = (value) => {
    if (value === true || value === false) return value;
    const normalized = s(value).toLowerCase();
    if (!normalized) return null;
    if (['true', 'yes', 'y', '1', 'compatible', 'pass', 'ok'].includes(normalized)) return true;
    if (['false', 'no', 'n', '0', 'incompatible', 'fail', 'mismatch'].includes(normalized)) return false;
    return null;
  };

  const normalizeEntry = (entry = {}) => {
    const compatible = parseBooleanLike(entry?.compatible);
    return {
      compatible,
      rationale: s(entry?.rationale || entry?.reason || entry?.note),
      suggestedValue: s(entry?.suggestedValue || entry?.recommendedValue || entry?.suggested),
      severity: s(entry?.severity || entry?.level).toLowerCase() || (compatible === false ? 'warning' : ''),
      shouldUpdate: entry?.shouldUpdate === true
    };
  };

  return {
    desiredModality: normalizeEntry(source.desiredModality || {}),
    contextDomain: normalizeEntry(source.contextDomain || {}),
    authenticityGuidance: normalizeEntry(source.authenticityGuidance || {})
  };
}

function finalizeStep2FieldAssessments({
  task = {},
  fieldAssessments = {},
  generated = {},
  intentClassification = ''
} = {}) {
  const assessments = fieldAssessments && typeof fieldAssessments === 'object' ? { ...fieldAssessments } : {};
  const normalizedIntent = s(intentClassification).toLowerCase();
  const desiredModality = s(generated?.desiredModality) || s(task?.classContext?.desiredModality || task?.taskConditions?.modality);
  const contextDomain = normalizeContextDomainInput(generated?.contextDomain)
    || normalizeContextDomainInput(task?.classContext?.contextDomain);
  const authenticityGuidance = s(generated?.authenticityGuidance) || s(task?.taskConditions?.authenticityGuidance);

  const withDefaults = (entry = {}, defaults = {}) => {
    const compatible = entry.compatible === true
      ? true
      : (entry.compatible === false ? false : (defaults.compatible == null ? null : defaults.compatible));
    return {
      compatible,
      rationale: s(entry.rationale) || s(defaults.rationale),
      suggestedValue: s(entry.suggestedValue) || s(defaults.suggestedValue),
      severity: s(entry.severity) || s(defaults.severity),
      shouldUpdate: entry.shouldUpdate === true || defaults.shouldUpdate === true
    };
  };

  return {
    desiredModality: withDefaults(assessments.desiredModality, {
      compatible: Boolean(desiredModality),
      rationale: desiredModality ? 'Desired modality is available.' : 'Desired modality should be specific and observable.',
      suggestedValue: desiredModality,
      severity: desiredModality ? '' : 'warning',
      shouldUpdate: !desiredModality
    }),
    contextDomain: withDefaults(assessments.contextDomain, {
      compatible: Boolean(contextDomain),
      rationale: contextDomain ? 'Context domain is available.' : 'Context domain should be selected.',
      suggestedValue: contextDomain,
      severity: contextDomain ? '' : 'warning',
      shouldUpdate: !contextDomain
    }),
    authenticityGuidance: withDefaults(assessments.authenticityGuidance, {
      compatible: Boolean(authenticityGuidance),
      rationale: authenticityGuidance
        ? 'Authenticity guidance is available.'
        : 'Authenticity guidance should clarify allowed support and realism.',
      suggestedValue: authenticityGuidance,
      severity: authenticityGuidance ? '' : 'warning',
      shouldUpdate: !authenticityGuidance
    })
  };
}

async function runStepTwoAutoGeneration(task = {}) {
  const variables = buildStepTwoAiVariables(task);
  const renderedPrompt = await benchpathPromptService.renderPrompt({
    promptType: 'task_wizard_step2_intent_assist',
    variables
  });

  const responseSchema = {
    type: 'object',
    properties: {
      intentClassification: { type: 'string' },
      confidence: { type: 'string' },
      why: { type: 'string' },
      authenticityChecklist: { type: 'array', items: { type: 'string' } },
      cautionFlags: { type: 'array', items: { type: 'string' } },
      suggestedDesiredModality: { type: 'string' },
      suggestedContextDomain: { type: 'string' },
      suggestedAuthenticityGuidance: { type: 'string' },
      fieldAssessments: {
        type: 'object',
        properties: {
          desiredModality: { type: 'object' },
          contextDomain: { type: 'object' },
          authenticityGuidance: { type: 'object' }
        }
      },
      teacherFacingNotes: { type: 'array', items: { type: 'string' } }
    }
  };

  const aiInstruction = [
    'Return ONLY JSON.',
    'Use only provided Step 1 + Step 2 inputs.',
    'Teacher-selected taskType is authoritative and should not be changed.',
    'Suggest values for: suggestedDesiredModality, suggestedContextDomain, suggestedAuthenticityGuidance.',
    'Include fieldAssessments for: desiredModality, contextDomain, authenticityGuidance.',
    'Each field assessment must include: compatible, severity, rationale, suggestedValue, shouldUpdate.',
    'Keep contextDomain within: community, work, study, school, daily_life.',
    'Keep outputs classroom-ready and practical.',
    'Do not use markdown.'
  ].join(' ');

  const messages = benchpathPromptService.buildMessagesFromRenderedPrompt(renderedPrompt, [
    { role: 'user', content: aiInstruction }
  ]);

  const aiResponse = await benchpathAiProviderService.sendPrompt({
    messages,
    responseMimeType: 'application/json',
    responseSchema,
    requestLabel: 'benchpath.task-wizard.step2.auto-generation'
  });

  const structuredPayload = extractStructuredAiPayload(aiResponse);
  const rawResponseText = [
    s(aiResponse?.text),
    arr(aiResponse?.raw?.candidates)
      .flatMap((candidate) => arr(candidate?.content?.parts))
      .map((part) => s(part?.text || part?.functionCall?.args))
      .filter(Boolean)
      .join('\n')
  ].filter(Boolean).join('\n');

  let parsed = structuredPayload || safeJsonParse(rawResponseText);
  if (Array.isArray(parsed)) {
    parsed = parsed.find((entry) => entry && typeof entry === 'object') || null;
  }
  if (!parsed || typeof parsed !== 'object') {
    parsed = {
      intentClassification: s(task?.taskType) || 'assessment',
      confidence: 'low',
      why: 'AI output format could not be parsed. Fallback suggestions were generated from Step 1 and Task Type inputs.',
      authenticityChecklist: [
        'Confirm output is observable and matches selected skill.',
        'Confirm allowed support is clear for teacher and learner.',
        'Confirm scenario is realistic for the selected context.'
      ],
      cautionFlags: [
        'Review the generated values before saving.'
      ],
      suggestedDesiredModality: deriveStepTwoModalitySuggestion(task, s(task?.taskType)),
      suggestedContextDomain: normalizeContextDomainInput(task?.classContext?.contextDomain)
        || inferContextDomainFromText(`${s(task?.classContext?.summary)} ${s(task?.learnerContext?.realWorldNeed || task?.realWorldScenario)}`),
      suggestedAuthenticityGuidance: deriveStepTwoAuthenticitySuggestion(task, s(task?.taskType)),
      fieldAssessments: {},
      teacherFacingNotes: [
        'Fallback mode was used because AI response JSON was invalid.'
      ]
    };
  }

  const selectedTaskType = s(task?.taskType).toLowerCase();
  const intentClassification = s(parsed.intentClassification).toLowerCase();

  const suggestedDesiredModality = s(parsed.suggestedDesiredModality)
    || deriveStepTwoModalitySuggestion(task, selectedTaskType);
  const suggestedContextDomain = normalizeContextDomainInput(parsed.suggestedContextDomain)
    || normalizeContextDomainInput(task?.classContext?.contextDomain)
    || inferContextDomainFromText(`${s(task?.classContext?.summary)} ${s(task?.learnerContext?.realWorldNeed || task?.realWorldScenario)}`);
  const suggestedAuthenticityGuidance = s(parsed.suggestedAuthenticityGuidance)
    || deriveStepTwoAuthenticitySuggestion(task, selectedTaskType);

  if (!suggestedDesiredModality || !suggestedContextDomain || !suggestedAuthenticityGuidance) {
    throw new Error('AI assist could not generate complete Step 2 suggestions.');
  }

  const fieldAssessments = normalizeStep2FieldAssessments(
    parsed?.fieldAssessments || parsed?.fieldResults || parsed?.inputAssessments,
    task
  );

  const teacherFacingNotes = uniqueStrings(arr(parsed.teacherFacingNotes)).slice(0, 5);
  const authenticityChecklist = uniqueStrings(arr(parsed.authenticityChecklist)).slice(0, 6);
  const cautionFlags = uniqueStrings(arr(parsed.cautionFlags)).slice(0, 6);

  const finalizedFieldAssessments = finalizeStep2FieldAssessments({
    task,
    fieldAssessments,
    generated: {
      desiredModality: suggestedDesiredModality,
      contextDomain: suggestedContextDomain,
      authenticityGuidance: suggestedAuthenticityGuidance
    },
    intentClassification
  });

  return {
    generated: {
      desiredModality: suggestedDesiredModality,
      contextDomain: suggestedContextDomain,
      authenticityGuidance: suggestedAuthenticityGuidance
    },
    intentReview: {
      intentClassification: intentClassification || selectedTaskType || 'assessment',
      confidence: s(parsed.confidence),
      why: s(parsed.why),
      authenticityChecklist,
      cautionFlags
    },
    fieldAssessments: finalizedFieldAssessments,
    meta: {
      provider: s(aiResponse?.provider),
      modelUsed: s(aiResponse?.modelUsed),
      promptId: s(renderedPrompt?.promptDefinition?.id),
      teacherFacingNotes,
      usage: aiResponse?.usage || null,
      requestMeta: aiResponse?.requestMeta || null
    }
  };
}

function applyStepTwoAutoGeneration(task = {}, autoGen = {}) {
  const generated = autoGen?.generated && typeof autoGen.generated === 'object'
    ? autoGen.generated
    : {};
  const intentReview = autoGen?.intentReview && typeof autoGen.intentReview === 'object'
    ? autoGen.intentReview
    : {};
  const fieldAssessments = autoGen?.fieldAssessments && typeof autoGen.fieldAssessments === 'object'
    ? autoGen.fieldAssessments
    : {};
  const meta = autoGen?.meta && typeof autoGen.meta === 'object'
    ? autoGen.meta
    : {};

  const extensions = task?.extensions && typeof task.extensions === 'object' ? task.extensions : {};
  const wizardDraftData = extensions?.wizardDraftData && typeof extensions.wizardDraftData === 'object'
    ? extensions.wizardDraftData
    : {};
  const staleState = wizardDraftData?.stale && typeof wizardDraftData.stale === 'object'
    ? wizardDraftData.stale
    : {};

  const desiredModality = s(generated.desiredModality);
  const contextDomain = normalizeContextDomainInput(generated.contextDomain) || '';
  const authenticityGuidance = s(generated.authenticityGuidance);

  return {
    ...task,
    taskType: normalizeTaskTypeInput(task.taskType, 'assessment'),
    classContext: {
      ...(task.classContext || {}),
      desiredModality,
      contextDomain
    },
    taskConditions: {
      ...(task.taskConditions || {}),
      modality: desiredModality,
      authenticityGuidance
    },
    wizardTrace: {
      ...(task.wizardTrace || {}),
      step2AutoGeneration: {
        generatedAt: nowIso(),
        provider: s(meta.provider),
        modelUsed: s(meta.modelUsed),
        promptId: s(meta.promptId),
        teacherFacingNotes: uniqueStrings(arr(meta.teacherFacingNotes)),
        intentReview: {
          intentClassification: s(intentReview.intentClassification),
          confidence: s(intentReview.confidence),
          why: s(intentReview.why),
          authenticityChecklist: uniqueStrings(arr(intentReview.authenticityChecklist)),
          cautionFlags: uniqueStrings(arr(intentReview.cautionFlags))
        },
        fieldAssessments: normalizeStep2FieldAssessments(fieldAssessments, task)
      }
    },
    extensions: {
      ...extensions,
      wizardDraftData: {
        ...wizardDraftData,
        step2: {
          desiredModality,
          contextDomain,
          authenticityGuidance
        },
        stale: {
          step2: false,
          step3: Boolean(staleState.step3),
          reason: Boolean(staleState.step3)
            ? 'Step 3 mapping may be outdated because Step 1 inputs changed.'
            : '',
          updatedAt: nowIso()
        }
      },
      aiAssist: {
        ...(extensions.aiAssist && typeof extensions.aiAssist === 'object' ? extensions.aiAssist : {}),
        step2AutoGeneration: {
          generatedAt: nowIso(),
          usage: meta.usage || null,
          requestMeta: meta.requestMeta || null,
          fieldAssessments: normalizeStep2FieldAssessments(fieldAssessments, task)
        }
      }
    }
  };
}

function mergeStepTwo(task, body = {}) {
  const desiredModality = s(body.desiredModality);
  const contextDomain = s(body.contextDomain);
  const authenticityGuidance = s(body.authenticityGuidance);
  const extensions = task?.extensions && typeof task.extensions === 'object' ? task.extensions : {};
  const wizardDraftData = extensions?.wizardDraftData && typeof extensions.wizardDraftData === 'object'
    ? extensions.wizardDraftData
    : {};
  const stepOneDraft = wizardDraftData?.step1 && typeof wizardDraftData.step1 === 'object'
    ? wizardDraftData.step1
    : {};
  const preservedSummary = s(task?.classContext?.summary) || s(stepOneDraft.classContext);
  const staleState = wizardDraftData?.stale && typeof wizardDraftData.stale === 'object'
    ? wizardDraftData.stale
    : {};

  return {
    ...task,
    taskType: normalizeTaskTypeInput(task.taskType, 'assessment'),
    classContext: {
      ...(task.classContext || {}),
      summary: preservedSummary,
      desiredModality,
      contextDomain
    },
    taskConditions: {
      ...(task.taskConditions || {}),
      modality: desiredModality,
      authenticityGuidance
    },
    extensions: {
      ...extensions,
      wizardDraftData: {
        ...wizardDraftData,
        step2: {
          desiredModality,
          contextDomain,
          authenticityGuidance
        },
        stale: {
          step2: false,
          step3: Boolean(staleState.step3),
          reason: Boolean(staleState.step3)
            ? 'Step 3 mapping may be outdated because Step 1 inputs changed.'
            : '',
          updatedAt: nowIso()
        }
      }
    }
  };
}

function mergeStepThreeManual(task, body = {}) {
  const selectedBenchmarkId = s(body.selectedBenchmarkId) || s(task.selectedBenchmarkId);
  const suggestedBenchmarkId = s(task.suggestedBenchmarkId) || selectedBenchmarkId;
  const extensions = task?.extensions && typeof task.extensions === 'object' ? task.extensions : {};
  const wizardDraftData = extensions?.wizardDraftData && typeof extensions.wizardDraftData === 'object'
    ? extensions.wizardDraftData
    : {};
  const staleState = wizardDraftData?.stale && typeof wizardDraftData.stale === 'object'
    ? wizardDraftData.stale
    : {};

  return {
    ...task,
    suggestedBenchmarkId,
    selectedBenchmarkId,
    competencyAreaIds: splitIdRows(body.competencyAreaIds),
    competencyIds: splitIdRows(body.competencyIds),
    profileOfAbilityRefs: splitIdRows(body.profileOfAbilityRefs),
    indicatorIds: splitIdRows(body.indicatorIds),
    featureOfCommunicationIds: splitIdRows(body.featureOfCommunicationIds),
    sampleTaskLabelIds: splitIdRows(body.sampleTaskLabelIds),
    extensions: {
      ...extensions,
      wizardDraftData: {
        ...wizardDraftData,
        stale: {
          step2: Boolean(staleState.step2),
          step3: false,
          reason: Boolean(staleState.step2)
            ? 'Step 2 suggestions may be outdated because Step 1 inputs changed.'
            : '',
          updatedAt: nowIso()
        }
      }
    }
  };
}

function mergeStepFour(task, body = {}) {
  return {
    ...task,
    realWorldScenario: s(body.realWorldScenario),
    learnerInstructions: s(body.learnerInstructions),
    teacherInstructions: s(body.teacherInstructions),
    taskConditions: {
      ...(task.taskConditions || {}),
      supportLevel: s(body.supportLevel) || s(task?.taskConditions?.supportLevel) || 'limited_support',
      estimatedTimeMinutes: parseEstimateMinutes(body.estimatedTimeMinutes, Number(task?.taskConditions?.estimatedTimeMinutes || 25)),
      materialsResources: splitTextRows(body.materialsResources),
      conditionsNotes: s(body.conditionsNotes)
    }
  };
}

async function loadReferenceByIds(entityType, ids = [], requestingUser) {
  const rows = await benchpathDataService.fetchData(entityType, {}, requestingUser);
  const idSet = new Set(uniqueStrings(ids));
  return arr(rows).filter((row) => idSet.has(s(row.id)));
}

function buildCriteriaFromLines(criteriaLines = [], competencyRows = [], indicatorRows = []) {
  const cleanLines = arr(criteriaLines).map((row) => s(row)).filter(Boolean);
  if (!cleanLines.length) return [];

  return cleanLines.map((text, index) => {
    const competency = competencyRows[index] || competencyRows[0] || null;
    const competencyId = s(competency?.id);
    const indicator = indicatorRows.find((row) => s(row.competencyId) === competencyId) || indicatorRows[index] || null;
    const indicatorId = s(indicator?.id);
    return {
      text,
      competencyId: competencyId || null,
      indicatorId: indicatorId || null,
      references: uniqueStrings([competencyId, indicatorId])
    };
  });
}

async function mergeStepFive(task, body = {}, requestingUser) {
  const observableEvidence = splitTextRows(body.observableEvidence);
  const artifacts = splitTextRows(body.artifacts);
  const collectionMethods = uniqueStrings(
    arr(body.collectionMethods)
      .concat(splitTextRows(body.collectionMethodsText))
      .map((entry) => s(entry).toLowerCase().replace(/\s+/g, '_'))
      .filter(Boolean)
  );

  const competencyRows = await loadReferenceByIds('clbCompetencies', task.competencyIds, requestingUser);
  const indicatorRows = await loadReferenceByIds('clbIndicators', task.indicatorIds, requestingUser);
  const featureRows = await loadReferenceByIds('clbFeaturesOfCommunication', task.featureOfCommunicationIds, requestingUser);
  const poaRows = await loadReferenceByIds('clbProfileOfAbility', task.profileOfAbilityRefs, requestingUser);
  const criteriaForSuccess = buildCriteriaFromLines(splitTextRows(body.criteriaForSuccess), competencyRows, indicatorRows);

  const rubricDraft = taskAuthoringService.generateRubricDraft({
    competencies: competencyRows,
    indicators: indicatorRows,
    profileOfAbility: poaRows[0] || null,
    featuresOfCommunication: featureRows,
    taskType: task.taskType
  });

  const merged = {
    ...task,
    evidencePlan: {
      ...(task.evidencePlan || {}),
      observableEvidence,
      artifacts,
      collectionMethods
    },
    criteriaForSuccess,
    rubricDraft
  };

  return {
    ...merged,
    portfolioFit: taskAuthoringService.classifyPortfolioFit(merged)
  };
}

function buildWizardInputFromTask(task = {}) {
  const artifacts = arr(task?.evidencePlan?.artifacts);
  return {
    skill: s(task.skill),
    approximateLevel: s(task?.learnerContext?.approximateLevel),
    clbRange: s(task?.learnerContext?.clbRange),
    learnerGoal: s(task?.learnerContext?.goal),
    realWorldNeed: s(task?.learnerContext?.realWorldNeed || task.realWorldScenario),
    classContext: s(task?.classContext?.summary),
    desiredModality: s(task?.classContext?.desiredModality || task?.taskConditions?.modality),
    contextDomain: s(task?.classContext?.contextDomain),
    authenticityGuidance: s(task?.taskConditions?.authenticityGuidance),
    artifactType: artifacts[0] || '',
    scenarioWording: s(task?.realWorldScenario),
    learnerInstructions: s(task.learnerInstructions),
    teacherInstructions: s(task.teacherInstructions),
    taskType: s(task.taskType)
  };
}

function applyRecommendationsToTask(task, recommendationResult) {
  const recommendations = recommendationResult?.recommendations || {};
  const draft = recommendationResult?.draftTask || {};
  const recommendedBenchmark = recommendations?.recommendedBenchmark || recommendations?.benchmark;
  const recommendedCompetencies = recommendations?.recommendedCompetencies || recommendations?.competencies || [];
  const recommendedIndicators = recommendations?.recommendedIndicators || recommendations?.indicators || [];
  const recommendedFeatures = recommendations?.recommendedFeatures || recommendations?.featuresOfCommunication || [];
  const recommendedSampleTaskLabels = recommendations?.recommendedSampleTaskLabels || recommendations?.sampleTaskLabels || [];
  const recommendedProfile = recommendations?.profileOfAbility || null;
  const benchmarkId = s(recommendedBenchmark?.id || draft.selectedBenchmarkId || task.selectedBenchmarkId);
  const extensions = task?.extensions && typeof task.extensions === 'object' ? task.extensions : {};
  const wizardDraftData = extensions?.wizardDraftData && typeof extensions.wizardDraftData === 'object'
    ? extensions.wizardDraftData
    : {};
  const staleState = wizardDraftData?.stale && typeof wizardDraftData.stale === 'object'
    ? wizardDraftData.stale
    : {};

  return {
    ...task,
    suggestedBenchmarkId: benchmarkId || s(task.suggestedBenchmarkId),
    selectedBenchmarkId: benchmarkId || s(task.selectedBenchmarkId),
    competencyAreaIds: arr(task.competencyAreaIds).length
      ? uniqueStrings(task.competencyAreaIds)
      : uniqueStrings(recommendedCompetencies.map((row) => s(row.competencyAreaId))),
    competencyIds: arr(task.competencyIds).length
      ? uniqueStrings(task.competencyIds)
      : uniqueStrings(recommendedCompetencies.map((row) => s(row.id))),
    profileOfAbilityRefs: arr(task.profileOfAbilityRefs).length
      ? uniqueStrings(task.profileOfAbilityRefs)
      : uniqueStrings([s(recommendedProfile?.id)].filter(Boolean)),
    indicatorIds: arr(task.indicatorIds).length
      ? uniqueStrings(task.indicatorIds)
      : uniqueStrings(recommendedIndicators.map((row) => s(row.id))),
    featureOfCommunicationIds: arr(task.featureOfCommunicationIds).length
      ? uniqueStrings(task.featureOfCommunicationIds)
      : uniqueStrings(recommendedFeatures.map((row) => s(row.id))),
    sampleTaskLabelIds: arr(task.sampleTaskLabelIds).length
      ? uniqueStrings(task.sampleTaskLabelIds)
      : uniqueStrings(recommendedSampleTaskLabels.map((row) => s(row.id))),
    wizardTrace: {
      ...(task.wizardTrace || {}),
      step3: {
        generatedAt: nowIso(),
        recommendations
      }
    },
    extensions: {
      ...extensions,
      wizardDraftData: {
        ...wizardDraftData,
        stale: {
          step2: Boolean(staleState.step2),
          step3: false,
          reason: Boolean(staleState.step2)
            ? 'Step 2 suggestions may be outdated because Step 1 inputs changed.'
            : '',
          updatedAt: nowIso()
        }
      }
    }
  };
}

function buildWizardStateForSave(task, currentStep, nextStep, markCompleted = true) {
  const current = taskAuthoringService.buildWizardState(task);
  const completed = new Set(arr(current.completedSteps));
  if (markCompleted) completed.add(parseStep(currentStep));
  return taskAuthoringService.withWizardState(task, {
    currentStep: parseStep(nextStep),
    lastSavedStep: parseStep(currentStep),
    completedSteps: Array.from(completed)
  });
}

async function ensureInitialDraftDefaults(task, requestingUser) {
  const normalizedSkill = normalizeSkillInput(task.skill);
  if (!normalizedSkill) throw new Error('Skill is required before saving draft.');

  const benchmarkId = s(task.selectedBenchmarkId) || await chooseInitialBenchmarkId(normalizedSkill, task.learnerContext, requestingUser);
  if (!benchmarkId) throw new Error(`No CLB 1-4 benchmark found for ${normalizedSkill}.`);

  const baselineTaskType = classifyTaskType({
    learnerGoal: task?.learnerContext?.goal,
    realWorldNeed: task?.learnerContext?.realWorldNeed || task.realWorldScenario,
    desiredModality: task?.classContext?.desiredModality,
    learnerInstructions: task?.learnerInstructions,
    explicitTaskType: task?.taskType
  });

  const level = preferredLevelFromTask(task);
  const title = s(task.title) || `${skillLabel(normalizedSkill)} CLB ${level} Draft Task`;

  return {
    ...task,
    skill: normalizedSkill,
    selectedBenchmarkId: benchmarkId,
    suggestedBenchmarkId: s(task.suggestedBenchmarkId) || benchmarkId,
    taskType: baselineTaskType || 'assessment',
    title,
    slug: s(task.slug) || slugify(`${title}-${Date.now()}`),
    id: s(task.id) || taskId(),
    status: s(task.status) || 'draft'
  };
}

function mapFieldErrors(errors = []) {
  const fieldErrors = {};
  arr(errors).forEach((error) => {
    const normalized = s(error);
    if (!normalized) return;
    if (/^Skill/i.test(normalized)) fieldErrors.skill = normalized;
    if (/Approx(?:imate)?\s*CLB|Approximate level/i.test(normalized)) fieldErrors.approximateLevel = normalized;
    if (/CLB range/i.test(normalized)) fieldErrors.clbRange = normalized;
    if (/Learner goal/i.test(normalized)) fieldErrors.learnerGoal = normalized;
    if (/Class context/i.test(normalized)) fieldErrors.classContext = normalized;
    if (/Real-world need/i.test(normalized)) fieldErrors.realWorldNeed = normalized;
    if (/task type/i.test(normalized)) fieldErrors.taskType = normalized;
    if (/Desired modality/i.test(normalized)) fieldErrors.desiredModality = normalized;
    if (/Context domain/i.test(normalized)) fieldErrors.contextDomain = normalized;
    if (/Authenticity guidance/i.test(normalized)) fieldErrors.authenticityGuidance = normalized;
    if (/Selected benchmark/i.test(normalized)) fieldErrors.selectedBenchmarkId = normalized;
    if (/competency/i.test(normalized)) fieldErrors.competencyIds = normalized;
    if (/scenario/i.test(normalized)) fieldErrors.realWorldScenario = normalized;
    if (/Learner instructions/i.test(normalized)) fieldErrors.learnerInstructions = normalized;
    if (/Teacher instructions/i.test(normalized)) fieldErrors.teacherInstructions = normalized;
    if (/observable evidence|artifacts/i.test(normalized)) fieldErrors.observableEvidence = normalized;
    if (/criterion/i.test(normalized)) fieldErrors.criteriaForSuccess = normalized;
  });
  return fieldErrors;
}

function inferWizardStepFromMessage(message) {
  const text = s(message).toLowerCase();
  if (!text) return 6;

  if (/(skill|learner goal|class context|real-world need|clb range|approximate level|task type)/i.test(text)) return 1;
  if (/(desired modality|context domain|authenticity)/i.test(text)) return 2;
  if (/(benchmark|competenc|indicator|feature|sample task|profile of ability|mapping)/i.test(text)) return 3;
  if (/(scenario|learner instructions|teacher instructions|support level|conditions|materials)/i.test(text)) return 4;
  if (/(evidence|artifact|collection method|criteria|rubric)/i.test(text)) return 5;
  return 6;
}

function annotateValidationByStep(validation = {}) {
  const toAnnotated = (entries = []) => arr(entries).map((entry) => {
    const message = s(entry);
    if (!message) return '';
    if (/^step\s+\d+\s*:/i.test(message)) return message;
    const step = inferWizardStepFromMessage(message);
    return `Step ${step}: ${message}`;
  }).filter(Boolean);

  return {
    ...validation,
    errors: toAnnotated(validation.errors),
    warnings: toAnnotated(validation.warnings)
  };
}

function getWizardStaleWarnings(task = {}, step = 1) {
  const extensions = task?.extensions && typeof task.extensions === 'object' ? task.extensions : {};
  const wizardDraftData = extensions?.wizardDraftData && typeof extensions.wizardDraftData === 'object'
    ? extensions.wizardDraftData
    : {};
  const stale = wizardDraftData?.stale && typeof wizardDraftData.stale === 'object'
    ? wizardDraftData.stale
    : {};
  const warnings = [];
  if (step >= 2 && stale.step2) {
    warnings.push('Step 2 suggestions may be outdated because Step 1 inputs changed.');
  }
  if (step >= 3 && stale.step3) {
    warnings.push('Step 3 mapping may be outdated because Step 1 inputs changed. Review and resave/regenerate Step 3.');
  }
  return warnings;
}

function resolveTargetStep(intent, step) {
  if (intent === 'next') return taskAuthoringService.nextWizardStep(step);
  if (intent === 'previous') return taskAuthoringService.previousWizardStep(step);
  return step;
}

function stepSaveMessage(step, intent) {
  if (intent === 'next') return `Step ${step} saved. Continue to Step ${taskAuthoringService.nextWizardStep(step)}.`;
  if (intent === 'previous') return `Step ${step} saved. Returned to Step ${taskAuthoringService.previousWizardStep(step)}.`;
  if (step === 3) return 'Step 3 mapping saved.';
  if (step === 4) return 'Step 4 construction saved.';
  if (step === 5) return 'Step 5 evidence design saved.';
  return `Step ${step} draft saved.`;
}

async function buildStepThreeData(task, requestingUser) {
  const empty = {
    recommendations: null,
    recommendationGroups: null,
    recommendationError: '',
    benchmarkOptions: [],
    competencyAreaOptions: [],
    competencyOptions: [],
    indicatorOptions: [],
    featureOptions: [],
    sampleTaskOptions: [],
    profileOptions: []
  };

  const normalizedSkill = normalizeSkillInput(task.skill);
  if (!normalizedSkill) return empty;

  const [
    benchmarks,
    competencyAreas,
    competencies,
    indicators,
    features,
    sampleTasks,
    profiles
  ] = await Promise.all([
    benchpathDataService.fetchData('clbBenchmarks', {}, requestingUser),
    benchpathDataService.fetchData('clbCompetencyAreas', {}, requestingUser),
    benchpathDataService.fetchData('clbCompetencies', {}, requestingUser),
    benchpathDataService.fetchData('clbIndicators', {}, requestingUser),
    benchpathDataService.fetchData('clbFeaturesOfCommunication', {}, requestingUser),
    benchpathDataService.fetchData('clbSampleTaskLabels', {}, requestingUser),
    benchpathDataService.fetchData('clbProfileOfAbility', {}, requestingUser)
  ]);

  const benchmarkOptions = arr(benchmarks)
    .filter((row) => s(row.skillId) === normalizedSkill)
    .filter((row) => {
      const level = benchmarkLevelFromRow(row);
      return level != null && level >= 1 && level <= 4;
    })
    .sort((left, right) => {
      const leftLevel = benchmarkLevelFromRow(left) || 99;
      const rightLevel = benchmarkLevelFromRow(right) || 99;
      if (leftLevel !== rightLevel) return leftLevel - rightLevel;
      return s(left.id).localeCompare(s(right.id));
    });

  let recommendations = null;
  let recommendationError = '';
  try {
    recommendations = await taskAuthoringService.generateTaskDraft(buildWizardInputFromTask(task), {
      requestingUser
    });
  } catch (error) {
    recommendationError = error.message;
  }

  const groups = recommendations?.recommendations || null;
  const recommendedBenchmarkId = s(groups?.recommendedBenchmark?.id || groups?.benchmark?.id);
  const selectedBenchmarkId = s(task.selectedBenchmarkId) || recommendedBenchmarkId || s(benchmarkOptions[0]?.id);

  const recommendedCompetencyIds = uniqueStrings(
    arr(groups?.recommendedCompetencies || groups?.competencies).map((row) => s(row.id))
  );
  const activeCompetencyIds = uniqueStrings(
    arr(task.competencyIds).length ? task.competencyIds : recommendedCompetencyIds
  );

  const competencyAreaOptions = arr(competencyAreas)
    .filter((row) => s(row.skillId) === normalizedSkill);

  const competencyOptions = arr(competencies)
    .filter((row) => s(row.benchmarkId) === selectedBenchmarkId)
    .filter((row) => {
      const skillId = s(row.skillId);
      return !skillId || skillId === normalizedSkill;
    });

  const indicatorOptions = arr(indicators)
    .filter((row) => s(row.benchmarkId) === selectedBenchmarkId)
    .filter((row) => {
      const skillId = s(row.skillId);
      return !skillId || skillId === normalizedSkill;
    });

  const baseFeatureOptions = arr(features)
    .filter((row) => s(row.benchmarkId || row.scopeBenchmarkId) === selectedBenchmarkId)
    .filter((row) => {
      const skillId = s(row.skillId || row.scopeSkillId);
      return !skillId || skillId === normalizedSkill;
    });
  const featureOptions = baseFeatureOptions
    .slice()
    .sort((left, right) => {
      const leftComp = s(left.competencyId || left.scopeCompetencyId);
      const rightComp = s(right.competencyId || right.scopeCompetencyId);
      const leftMatch = leftComp && (activeCompetencyIds.includes(leftComp) || recommendedCompetencyIds.includes(leftComp)) ? 1 : 0;
      const rightMatch = rightComp && (activeCompetencyIds.includes(rightComp) || recommendedCompetencyIds.includes(rightComp)) ? 1 : 0;
      if (leftMatch !== rightMatch) return rightMatch - leftMatch;
      return s(left.id).localeCompare(s(right.id));
    })
    .filter((row) => {
      return Boolean(s(row.id));
    });

  const desiredTaskType = s(task.taskType).toLowerCase();
  const desiredDomain = s(task?.classContext?.contextDomain).toLowerCase();
  const desiredModality = s(task?.classContext?.desiredModality || task?.taskConditions?.modality).toLowerCase();
  const sampleTaskOptions = arr(sampleTasks)
    .filter((row) => s(row.linkedBenchmarkId || row.benchmarkId) === selectedBenchmarkId)
    .filter((row) => s(row.skillId) === normalizedSkill)
    .sort((left, right) => {
      const scoreRow = (row) => {
        let score = 0;
        const linkedComp = s(row.linkedCompetencyId || row.competencyId);
        const taskType = s(row.taskType).toLowerCase();
        const domain = s(row.contextDomain).toLowerCase();
        const modalityText = s(row.taskLabelText || row.description).toLowerCase();
        if (linkedComp && (activeCompetencyIds.includes(linkedComp) || recommendedCompetencyIds.includes(linkedComp))) score += 3;
        if (!taskType || taskType === 'to_be_defined' || !desiredTaskType || taskType === desiredTaskType) score += 2;
        if (!domain || domain === 'to_be_defined' || !desiredDomain || domain === desiredDomain) score += 2;
        if (desiredModality && modalityText.includes(desiredModality)) score += 1;
        return score;
      };
      const leftScore = scoreRow(left);
      const rightScore = scoreRow(right);
      if (leftScore !== rightScore) return rightScore - leftScore;
      return s(left.id).localeCompare(s(right.id));
    });

  const profileOptions = arr(profiles).filter((row) => s(row.benchmarkId) === selectedBenchmarkId);

  return {
    recommendations: groups,
    recommendationGroups: groups,
    recommendationError,
    benchmarkOptions,
    competencyAreaOptions,
    competencyOptions,
    indicatorOptions,
    featureOptions,
    sampleTaskOptions,
    profileOptions
  };
}

async function renderWizard(req, res, options = {}) {
  const mode = s(options.mode) === 'edit' ? 'edit' : 'new';
  const step = parseStep(options.step || req.params.step || 1);
  const existingTask = options.task || null;
  const task = existingTask || buildInitialTaskTemplate(req.user);
  const wizardState = taskAuthoringService.buildWizardState(task);
  const notice = options.notice || extractNotice(req);
  const stepValidation = options.stepValidation || { isValid: true, errors: [], warnings: [] };
  const rawFinalValidation = options.finalValidation || (step === 6 && s(task.id)
    ? await taskAuthoringService.validateTaskDraft(task, { requestingUser: req.user })
    : null);
  const finalValidation = step === 6 && rawFinalValidation
    ? annotateValidationByStep(rawFinalValidation)
    : rawFinalValidation;
  const staleWarnings = getWizardStaleWarnings(task, step);

  const skills = await benchpathDataService.fetchData('clbSkills', {}, req.user);
  const stepThreeData = step === 3 ? await buildStepThreeData(task, req.user) : null;
  const previousStep = taskAuthoringService.previousWizardStep(step);
  const nextStep = taskAuthoringService.nextWizardStep(step);
  const taskIdValue = s(task.id);
  const canNavigateWithId = Boolean(taskIdValue);
  const stepLinks = {};
  taskAuthoringService.getWizardStepList().forEach((stepRow) => {
    stepLinks[String(stepRow.number)] = wizardPathForMode(mode, taskIdValue, stepRow.number);
  });

  return res.render('benchpath/task/taskWizard', {
    title: 'BenchPath Task Wizard (CLB 1-4)',
    includeModal: true,
    user: req.user || null,
    actionStateId: req?.actionStateId || '',
    wizard: {
      mode,
      isEdit: mode === 'edit',
      steps: taskAuthoringService.getWizardStepList(),
      currentStep: step,
      currentMeta: stepMeta(step),
      previousStep,
      nextStep,
      prevUrl: wizardPathForMode(mode, taskIdValue, previousStep),
      nextUrl: wizardPathForMode(mode, taskIdValue, nextStep),
      listUrl: '/benchpath/tasks',
      postUrl: mode === 'edit' ? stepUrlForEdit(taskIdValue, step) : stepUrlForNew(step),
      editBaseUrl: taskIdValue ? `/benchpath/tasks/edit-wizard/${encodeURIComponent(taskIdValue)}` : '',
      stepLinks,
      canNavigateWithId,
      state: wizardState
    },
    task,
    skills: arr(skills).filter((row) => s(row.status) !== 'archived' && s(row.status) !== 'deleted'),
    stepThreeData,
    taskTypeOptions: TASK_TYPE_OPTIONS,
    contextDomainOptions: CONTEXT_DOMAIN_OPTIONS,
    supportLevelOptions: SUPPORT_LEVEL_OPTIONS,
    collectionMethodOptions: COLLECTION_METHOD_OPTIONS,
    stepValidation,
    staleWarnings,
    fieldErrors: mapFieldErrors(stepValidation.errors || []),
    finalValidation,
    noticeMessage: s(notice.message),
    noticeType: s(notice.type || 'success')
  });
}

function resolvePostIntent(body = {}) {
  const intent = s(body.intent).toLowerCase();
  if ([
    'save',
    'next',
    'previous',
    'regenerate',
    'publish',
    'auto_generate',
    'auto_generate_step1_and_2',
    'auto_generate_step2'
  ].includes(intent)) return intent;
  return 'save';
}

async function saveTaskRecord(task, existingTask, requestingUser) {
  if (existingTask) {
    return benchpathDataService.updateData('benchpathTasks', existingTask.id, task, requestingUser);
  }
  return benchpathDataService.addData('benchpathTasks', task, requestingUser);
}

async function processStepSubmission(req, res, options = {}) {
  const mode = s(options.mode) === 'edit' ? 'edit' : 'new';
  const step = parseStep(req.params.step);
  const intent = resolvePostIntent(req.body);
  const routeTaskId = mode === 'edit' ? s(req.params.id) : s(req.body.taskId || req.query.draftId);
  let existingTask = await loadTaskOrNull(routeTaskId, req.user);

  if (mode === 'new' && step > 1 && !existingTask) {
    return res.redirect(addNotice(stepUrlForNew(1), 'Start from Step 1 to create a draft.', 'warning'));
  }
  if (mode === 'edit' && !existingTask) {
    return res.status(404).render('404', { user: req.user || null });
  }

  let workingTask = existingTask ? { ...existingTask } : buildInitialTaskTemplate(req.user);

  try {
    if (step === 1) {
      workingTask = mergeStepOne(workingTask, req.body);

      if (intent === 'auto_generate' || intent === 'auto_generate_step1_and_2') {
        const precheck = validateStepOneAutoGenerationInputs(workingTask);
        if (!precheck.isValid) {
          if (isAjax(req)) {
            return res.status(400).json({
              status: 'error',
              message: 'Fill Skill, Approx CLB, CLB Range, Class Context, Learner Goal, and Task Type first, then run Auto-Generation.',
              payload: {
                errors: precheck.errors,
                warnings: []
              }
            });
          }
          return renderWizard(req, res, {
            mode,
            step,
            task: workingTask,
            stepValidation: { isValid: false, errors: precheck.errors, warnings: [] },
            notice: {
              message: 'Fill Skill, Approx CLB, CLB Range, Class Context, Learner Goal, and Task Type first, then run Auto-Generation.',
              type: 'warning'
            }
          });
        }

        const autoGenerationResult = await runStepOneAutoGeneration(workingTask);
        workingTask = applyStepOneAutoGeneration(workingTask, autoGenerationResult);
        const baseValidation = taskAuthoringService.validateWizardStep(step, workingTask);
        const autoFilteredErrors = arr(baseValidation.errors).filter((entry) => !/^Real-world need is required\.$/i.test(s(entry)));
        const fieldAssessments = autoGenerationResult?.fieldAssessments && typeof autoGenerationResult.fieldAssessments === 'object'
          ? autoGenerationResult.fieldAssessments
          : {};
        const incompatibleFieldLabels = Object.entries(fieldAssessments)
          .filter(([, value]) => value && value.compatible === false)
          .map(([key]) => {
            if (key === 'approximateLevel') return 'Approx CLB';
            if (key === 'clbRange') return 'CLB Range';
            if (key === 'classContext') return 'Class Context';
            if (key === 'learnerGoal') return 'Learner Goal';
            if (key === 'realWorldNeed') return 'Real-World Need';
            if (key === 'taskType') return 'Task Type';
            if (key === 'skill') return 'Skill';
            return key;
          });
        const aiWarnings = []
          .concat(
            incompatibleFieldLabels.length
              ? [`AI field fit check: Review these inputs: ${incompatibleFieldLabels.join(', ')}.`]
              : []
          )
          .concat(
            autoGenerationResult?.compatibility?.compatible === false
              ? ['AI CLB fit check: Learner Goal may not align with the selected CLB context.']
              : []
          )
          .concat(
            s(autoGenerationResult?.compatibility?.rationale)
              ? [`AI CLB fit rationale: ${s(autoGenerationResult.compatibility.rationale)}`]
              : []
          )
          .concat(arr(autoGenerationResult?.compatibility?.clbFitNotes).map((entry) => `AI CLB fit note: ${entry}`))
          .concat(
            s(autoGenerationResult?.compatibility?.recommendedLearnerGoal)
              ? [`AI suggested Learner Goal: ${s(autoGenerationResult.compatibility.recommendedLearnerGoal)}`]
              : []
          )
          .concat(arr(autoGenerationResult?.meta?.contextGaps).map((entry) => `AI context gap: ${entry}`))
          .concat(
            s(autoGenerationResult?.meta?.suggestedFollowUpQuestion)
              ? [`AI follow-up question: ${s(autoGenerationResult.meta.suggestedFollowUpQuestion)}`]
              : []
          );
        const stepValidation = {
          ...baseValidation,
          isValid: autoFilteredErrors.length === 0,
          errors: autoFilteredErrors,
          warnings: uniqueStrings([...(arr(baseValidation.warnings)), ...aiWarnings])
        };
        if (!stepValidation.isValid) {
          if (isAjax(req)) {
            return res.status(400).json({
              status: 'error',
              message: 'Please resolve Step 1 validation issues before saving.',
              payload: {
                errors: stepValidation.errors,
                warnings: stepValidation.warnings
              }
            });
          }
          return renderWizard(req, res, {
            mode,
            step,
            task: workingTask,
            stepValidation,
            notice: { message: 'Please resolve Step 1 validation issues before saving.', type: 'warning' }
          });
        }

        workingTask = await ensureInitialDraftDefaults(workingTask, req.user);
        workingTask = buildWizardStateForSave(workingTask, step, step, true);
        const saved = await saveTaskRecord(workingTask, existingTask, req.user);
        const autoTrace = saved?.wizardTrace?.step1AutoGeneration || workingTask?.wizardTrace?.step1AutoGeneration || {};
        const learnerContext = saved?.learnerContext || workingTask?.learnerContext || {};
        const classContext = saved?.classContext || workingTask?.classContext || {};
        if (isAjax(req)) {
          return res.json({
            status: 'success',
            message: 'Auto-Generation completed. Step 1 and Step 2 suggestions were updated.',
            payload: {
              draftId: s(saved?.id || workingTask?.id),
              fields: {
                skill: s(saved?.skill || workingTask?.skill),
                approximateLevel: s(learnerContext?.approximateLevel),
                clbRange: s(learnerContext?.clbRange),
                taskType: s(saved?.taskType || workingTask?.taskType),
                classContext: s(classContext?.summary),
                learnerGoal: s(learnerContext?.goal),
                realWorldNeed: s(learnerContext?.realWorldNeed),
                desiredModality: s(saved?.classContext?.desiredModality || saved?.taskConditions?.modality),
                contextDomain: s(saved?.classContext?.contextDomain),
                authenticityGuidance: s(saved?.taskConditions?.authenticityGuidance)
              },
              intentReview: saved?.wizardTrace?.step2AutoGeneration?.intentReview || null,
              compatibility: autoTrace?.learnerGoalCompatibility || null,
              fieldAssessments: autoTrace?.fieldAssessments || {},
              step2FieldAssessments: saved?.wizardTrace?.step2AutoGeneration?.fieldAssessments || {},
              teacherFacingNotes: arr(autoTrace?.teacherFacingNotes),
              warnings: arr(stepValidation?.warnings)
            }
          });
        }
        return res.redirect(addNotice(
          wizardPathForMode(mode, saved.id, step),
          'Auto-Generation completed. Step 1 and Step 2 suggestions were updated.',
          'success'
        ));
      }

      const stepValidation = taskAuthoringService.validateWizardStep(step, workingTask);
      if (!stepValidation.isValid) {
        return renderWizard(req, res, { mode, step, task: workingTask, stepValidation, notice: { message: 'Please resolve Step 1 validation issues before saving.', type: 'warning' } });
      }

      workingTask = await ensureInitialDraftDefaults(workingTask, req.user);
      const targetStep = resolveTargetStep(intent, step);
      workingTask = buildWizardStateForSave(workingTask, step, targetStep, true);
      const saved = await saveTaskRecord(workingTask, existingTask, req.user);
      return res.redirect(addNotice(wizardPathForMode(mode, saved.id, targetStep), stepSaveMessage(1, intent), 'success'));
    }

    if (!existingTask) {
      return res.redirect(addNotice(stepUrlForNew(1), 'Draft record is missing. Restart from Step 1.', 'warning'));
    }

    if (step === 2) {
      workingTask = mergeStepTwo(workingTask, req.body);
      if (intent === 'auto_generate_step2') {
        const precheck = validateStepTwoAutoGenerationInputs(workingTask);
        if (!precheck.isValid) {
          if (isAjax(req)) {
            return res.status(400).json({
              status: 'error',
              message: 'Fill Step 1 context fields first, then run Auto-Generation.',
              payload: {
                errors: precheck.errors,
                warnings: []
              }
            });
          }
          return renderWizard(req, res, {
            mode,
            step,
            task: workingTask,
            stepValidation: { isValid: false, errors: precheck.errors, warnings: [] },
            notice: {
              message: 'Fill Step 1 context fields first, then run Auto-Generation.',
              type: 'warning'
            }
          });
        }

        const autoGenerationResult = await runStepTwoAutoGeneration(workingTask);
        workingTask = applyStepTwoAutoGeneration(workingTask, autoGenerationResult);
        const stepValidation = taskAuthoringService.validateWizardStep(step, workingTask);
        if (!stepValidation.isValid) {
          if (isAjax(req)) {
            return res.status(400).json({
              status: 'error',
              message: 'Please resolve Step 2 validation issues before saving.',
              payload: {
                errors: stepValidation.errors,
                warnings: stepValidation.warnings
              }
            });
          }
          return renderWizard(req, res, {
            mode,
            step,
            task: workingTask,
            stepValidation,
            notice: { message: 'Please resolve Step 2 validation issues before saving.', type: 'warning' }
          });
        }

        workingTask = buildWizardStateForSave(workingTask, step, step, true);
        const saved = await saveTaskRecord(workingTask, existingTask, req.user);
        const autoTrace = saved?.wizardTrace?.step2AutoGeneration || workingTask?.wizardTrace?.step2AutoGeneration || {};
        if (isAjax(req)) {
          return res.json({
            status: 'success',
            message: 'Step 2 Auto-Generation completed. Suggested modality, context, and authenticity guidance were applied.',
            payload: {
              draftId: s(saved?.id || workingTask?.id),
              fields: {
                desiredModality: s(saved?.classContext?.desiredModality || saved?.taskConditions?.modality),
                contextDomain: s(saved?.classContext?.contextDomain),
                authenticityGuidance: s(saved?.taskConditions?.authenticityGuidance)
              },
              intentReview: autoTrace?.intentReview || null,
              fieldAssessments: autoTrace?.fieldAssessments || {},
              teacherFacingNotes: arr(autoTrace?.teacherFacingNotes),
              warnings: arr(stepValidation?.warnings)
            }
          });
        }
        return res.redirect(addNotice(
          wizardPathForMode(mode, saved.id, step),
          'Step 2 Auto-Generation completed. Suggested modality, context, and authenticity guidance were applied.',
          'success'
        ));
      }

      const bypassValidation = intent === 'previous';
      const stepValidation = bypassValidation
        ? { isValid: true, errors: [], warnings: [] }
        : taskAuthoringService.validateWizardStep(step, workingTask);
      if (!bypassValidation && !stepValidation.isValid) {
        return renderWizard(req, res, {
          mode,
          step,
          task: workingTask,
          stepValidation,
          notice: { message: 'Please resolve Step 2 validation issues before saving.', type: 'warning' }
        });
      }
      const targetStep = resolveTargetStep(intent, step);
      workingTask = buildWizardStateForSave(workingTask, step, targetStep, !bypassValidation);
      const saved = await saveTaskRecord(workingTask, existingTask, req.user);
      return res.redirect(addNotice(wizardPathForMode(mode, saved.id, targetStep), stepSaveMessage(2, intent), 'success'));
    }

    if (step === 3) {
      if (intent === 'regenerate') {
        const recommendationResult = await taskAuthoringService.generateTaskDraft(buildWizardInputFromTask(workingTask), { requestingUser: req.user });
        workingTask = applyRecommendationsToTask(workingTask, recommendationResult);
        workingTask = buildWizardStateForSave(workingTask, step, step, false);
        const saved = await saveTaskRecord(workingTask, existingTask, req.user);
        return res.redirect(addNotice(wizardPathForMode(mode, saved.id, 3), 'Step 3 recommendations regenerated.', 'success'));
      }

      workingTask = mergeStepThreeManual(workingTask, req.body);
      const bypassValidation = intent === 'previous';
      const stepValidation = bypassValidation
        ? { isValid: true, errors: [], warnings: [] }
        : taskAuthoringService.validateWizardStep(step, workingTask);
      if (!bypassValidation && !stepValidation.isValid) {
        return renderWizard(req, res, {
          mode,
          step,
          task: workingTask,
          stepValidation,
          notice: { message: 'Please resolve Step 3 validation issues before saving.', type: 'warning' }
        });
      }
      const targetStep = resolveTargetStep(intent, step);
      workingTask = buildWizardStateForSave(workingTask, step, targetStep, !bypassValidation);
      const saved = await saveTaskRecord(workingTask, existingTask, req.user);
      return res.redirect(addNotice(wizardPathForMode(mode, saved.id, targetStep), stepSaveMessage(3, intent), 'success'));
    }

    if (step === 4) {
      workingTask = mergeStepFour(workingTask, req.body);
      const bypassValidation = intent === 'previous';
      const stepValidation = bypassValidation
        ? { isValid: true, errors: [], warnings: [] }
        : taskAuthoringService.validateWizardStep(step, workingTask);
      if (!bypassValidation && !stepValidation.isValid) {
        return renderWizard(req, res, {
          mode,
          step,
          task: workingTask,
          stepValidation,
          notice: { message: 'Please resolve Step 4 validation issues before saving.', type: 'warning' }
        });
      }
      const targetStep = resolveTargetStep(intent, step);
      workingTask = buildWizardStateForSave(workingTask, step, targetStep, !bypassValidation);
      const saved = await saveTaskRecord(workingTask, existingTask, req.user);
      return res.redirect(addNotice(wizardPathForMode(mode, saved.id, targetStep), stepSaveMessage(4, intent), 'success'));
    }

    if (step === 5) {
      workingTask = await mergeStepFive(workingTask, req.body, req.user);
      const bypassValidation = intent === 'previous';
      const stepValidation = bypassValidation
        ? { isValid: true, errors: [], warnings: [] }
        : taskAuthoringService.validateWizardStep(step, workingTask);
      if (!bypassValidation && !stepValidation.isValid) {
        return renderWizard(req, res, {
          mode,
          step,
          task: workingTask,
          stepValidation,
          notice: { message: 'Please resolve Step 5 validation issues before saving.', type: 'warning' }
        });
      }
      const targetStep = resolveTargetStep(intent, step);
      workingTask = buildWizardStateForSave(workingTask, step, targetStep, !bypassValidation);
      const saved = await saveTaskRecord(workingTask, existingTask, req.user);
      return res.redirect(addNotice(wizardPathForMode(mode, saved.id, targetStep), stepSaveMessage(5, intent), 'success'));
    }

    if (step === 6) {
      if (intent === 'previous') {
        const targetStep = resolveTargetStep(intent, step);
        workingTask = buildWizardStateForSave(workingTask, step, targetStep, false);
        const saved = await saveTaskRecord(workingTask, existingTask, req.user);
        return res.redirect(addNotice(wizardPathForMode(mode, saved.id, targetStep), stepSaveMessage(6, intent), 'success'));
      }

      const finalValidation = await taskAuthoringService.validateTaskDraft(workingTask, { requestingUser: req.user });
      const annotatedFinalValidation = annotateValidationByStep(finalValidation);
      workingTask.validation = finalValidation;
      workingTask.portfolioFit = finalValidation.portfolioFit;
      const stepValidation = {
        isValid: finalValidation.isValid,
        errors: arr(annotatedFinalValidation.errors),
        warnings: arr(annotatedFinalValidation.warnings)
      };

      if (intent === 'publish') {
        if (!finalValidation.isValid) {
          return renderWizard(req, res, {
            mode,
            step,
            task: workingTask,
            stepValidation,
            finalValidation: annotatedFinalValidation,
            notice: { message: 'Publish is blocked until validation errors are resolved.', type: 'error' }
          });
        }
        workingTask.status = 'published';
        workingTask.publishedAt = nowIso();
        workingTask.publishedBy = s(req.user?.id) || 'system';
        const packageOutput = await taskAuthoringService.generateTaskPackage(workingTask, { requestingUser: req.user });
        workingTask.extensions = {
          ...(workingTask.extensions || {}),
          taskPackage: packageOutput
        };
        workingTask = taskAuthoringService.withWizardState(buildWizardStateForSave(workingTask, step, step, true), {
          currentStep: step,
          lastSavedStep: step,
          completedSteps: taskAuthoringService.getWizardStepList().map((row) => row.number),
          publishedAt: workingTask.publishedAt
        });
        await saveTaskRecord(workingTask, existingTask, req.user);
        return res.redirect(addNotice('/benchpath/tasks', `Task ${workingTask.id} published successfully.`, 'success'));
      }

      const targetStep = resolveTargetStep(intent, step);
      workingTask = buildWizardStateForSave(workingTask, step, targetStep, finalValidation.isValid);
      const saved = await saveTaskRecord(workingTask, existingTask, req.user);
      return res.redirect(addNotice(wizardPathForMode(mode, saved.id, 6), 'Review step saved. Publish when ready.', 'success'));
    }

    return res.redirect(addNotice('/benchpath/tasks', 'Unsupported wizard step.', 'error'));
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({
        status: 'error',
        message: error.message,
        payload: { errors: [error.message], warnings: [] }
      });
    }
    return renderWizard(req, res, { mode, step, task: workingTask, stepValidation: { isValid: false, errors: [error.message], warnings: [] }, notice: { message: error.message, type: 'error' } });
  }
}

async function redirectNewWizardRoot(req, res) {
  return res.redirect(stepUrlForNew(1));
}

async function showNewWizardStep(req, res) {
  const step = parseStep(req.params.step);
  const linkedDraftId = s(req.query.draftId);
  if (linkedDraftId) {
    const task = await loadTaskOrNull(linkedDraftId, req.user);
    if (!task) return res.redirect(addNotice(stepUrlForNew(1), 'Draft record was not found. Start from Step 1.', 'warning'));
    return renderWizard(req, res, { mode: 'new', step, task });
  }
  if (step > 1) return res.redirect(addNotice(stepUrlForNew(1), 'Start from Step 1 to create a wizard draft.', 'warning'));
  return renderWizard(req, res, { mode: 'new', step });
}

async function postNewWizardStep(req, res) {
  return processStepSubmission(req, res, { mode: 'new' });
}

async function redirectEditWizardRoot(req, res) {
  try {
    const task = await benchpathDataService.getDataById('benchpathTasks', req.params.id, req.user);
    if (!task) return res.status(404).render('404', { user: req.user || null });
    const state = taskAuthoringService.buildWizardState(task);
    const targetStep = parseStep(state.currentStep || state.lastSavedStep || 1);
    return res.redirect(stepUrlForEdit(task.id, targetStep));
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function showEditWizardStep(req, res) {
  try {
    const task = await benchpathDataService.getDataById('benchpathTasks', req.params.id, req.user);
    if (!task) return res.status(404).render('404', { user: req.user || null });
    return renderWizard(req, res, { mode: 'edit', step: parseStep(req.params.step), task });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function postEditWizardStep(req, res) {
  return processStepSubmission(req, res, { mode: 'edit' });
}

async function renderTaskPackagePage(req, res, packageType = 'overview') {
  try {
    const task = await benchpathDataService.getDataById('benchpathTasks', req.params.id, req.user);
    if (!task) return res.status(404).render('404', { user: req.user || null });

    const forceRefresh = s(req.query.refresh) === '1';
    const { packageData, persisted } = await resolveTaskPackage(task, req.user, { force: forceRefresh });
    const vm = packageViewModel(task, packageData);

    return res.render('benchpath/task/taskPackageView', {
      title: `BenchPath Task Package ${task.id}`,
      includeModal: true,
      user: req.user || null,
      actionStateId: req?.actionStateId || '',
      packageType,
      packageView: vm,
      persisted,
      forceRefresh
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function viewTaskPackage(req, res) {
  return renderTaskPackagePage(req, res, 'overview');
}

async function viewTaskPackageLearner(req, res) {
  return renderTaskPackagePage(req, res, 'learner');
}

async function viewTaskPackageAssessment(req, res) {
  return renderTaskPackagePage(req, res, 'assessment');
}

async function viewTaskPackagePblaRecord(req, res) {
  return renderTaskPackagePage(req, res, 'pbla-record');
}

module.exports = {
  listTasks,
  redirectNewWizardRoot,
  showNewWizardStep,
  postNewWizardStep,
  redirectEditWizardRoot,
  showEditWizardStep,
  postEditWizardStep,
  viewTask,
  viewTaskPackage,
  viewTaskPackageLearner,
  viewTaskPackageAssessment,
  viewTaskPackagePblaRecord,
  deleteTask
};
