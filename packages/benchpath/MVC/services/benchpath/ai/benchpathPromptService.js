const path = require('path');

const BUILT_IN_PROMPT_CATALOG = Object.freeze([
  Object.freeze({
    id: 'bp.prompt.task.step1.context_assist.v1',
    promptType: 'task_wizard_step1_context_assist',
    promptKey: 'task_wizard_step1_context_assist',
    version: 'v1',
    isDefault: true,
    isActive: true,
    providerScope: null,
    modelScope: null,
    title: 'Task Wizard Step 1 Context Assist',
    description: 'Suggests real-world need and checks learner-goal CLB fit for Step 1.',
    systemPromptTemplate: [
      'You are BenchPath Copilot helping teachers design CLB/PBLA-aligned tasks for CLB 1-4.',
      'Be practical and classroom-oriented.',
      'Do not invent official CLB wording.',
      'If confidence is low, ask for one missing detail instead of guessing.'
    ].join('\n'),
    userPromptTemplate: [
      'Teacher draft context:',
      '- Skill: {{skill}}',
      '- Approximate level: {{approximateLevel}}',
      '- CLB range: {{clbRange}}',
      '- Learner goal: {{learnerGoal}}',
      '- Class context: {{classContext}}',
      '- Existing real-world need (optional): {{existingRealWorldNeed}}',
      '',
      'Return JSON with keys:',
      '1) suggestedRealWorldNeed',
      '2) learnerGoalCompatibility { compatible, confidence, rationale, clbFitNotes[], recommendedLearnerGoal }',
      '3) fieldAssessments {',
      '   skill: { compatible, severity, rationale, suggestedValue, shouldUpdate },',
      '   approximateLevel: { compatible, severity, rationale, suggestedValue, shouldUpdate },',
      '   clbRange: { compatible, severity, rationale, suggestedValue, shouldUpdate },',
      '   classContext: { compatible, severity, rationale, suggestedValue, shouldUpdate },',
      '   learnerGoal: { compatible, severity, rationale, suggestedValue, shouldUpdate },',
      '   realWorldNeed: { compatible, severity, rationale, suggestedValue, shouldUpdate }',
      '}',
      '4) contextGaps (array)',
      '5) suggestedFollowUpQuestion (string or empty)',
      '6) teacherFacingNotes (array, concise)',
      '',
      'Rules:',
      '- Do not rewrite the input fields except suggestedRealWorldNeed.',
      '- Keep suggestions practical for CLB 1-4 classroom use.',
      '- Keep teacherFacingNotes strictly Step 1-focused (goal/context/real-world need fit).',
      '- Do not include future-step advice (rubric, evidence, assessment design, materials sequencing, peer feedback, editing workflow).',
      '- Limit teacherFacingNotes to max 3 short items.',
      '- Set compatible=false for any user input that is inappropriate for selected CLB context.',
      '- Do not return null/empty for compatible on learnerGoal, approximateLevel, clbRange, realWorldNeed.',
      '- Always provide rationale for learnerGoal, approximateLevel, and clbRange.',
      '- For any field with compatible=false, suggestedValue must be non-empty.'
    ].join('\n'),
    outputMode: 'json',
    schemaName: 'benchpath.taskWizard.step1.assist.v1',
    tags: ['benchpath', 'task-wizard', 'step1', 'clb-1-4', 'pbla'],
    notes: 'Suggestion support only. Teacher remains final decision-maker.'
  }),
  Object.freeze({
    id: 'bp.prompt.task.step2.intent_assist.v1',
    promptType: 'task_wizard_step2_intent_assist',
    promptKey: 'task_wizard_step2_intent_assist',
    version: 'v1',
    isDefault: true,
    isActive: true,
    providerScope: null,
    modelScope: null,
    title: 'Task Wizard Step 2 Intent Assist',
    description: 'Classifies assessment vs enabling intent and gives authenticity guidance.',
    systemPromptTemplate: [
      'You are BenchPath Copilot for CLB/PBLA task authoring.',
      'Classify intent conservatively and explain reasoning in teacher-friendly terms.',
      'Do not present your classification as an official CLB ruling.'
    ].join('\n'),
    userPromptTemplate: [
      'Task intent inputs:',
      '- Task type selected by teacher: {{taskType}}',
      '- Desired modality/output: {{desiredModality}}',
      '- Context domain: {{contextDomain}}',
      '- Skill: {{skill}}',
      '- Class context summary: {{classContext}}',
      '- Learner goal: {{learnerGoal}}',
      '- Real-world need: {{realWorldNeed}}',
      '',
      'Return JSON with keys:',
      '1) intentClassification (assessment|enabling|mixed)',
      '2) confidence (low|medium|high)',
      '3) why (short paragraph)',
      '4) authenticityChecklist (array of practical checks)',
      '5) cautionFlags (array)',
      '6) suggestedDesiredModality (string)',
      '7) suggestedContextDomain (community|work|study|school|daily_life)',
      '8) suggestedAuthenticityGuidance (string)',
      '9) fieldAssessments {',
      '   taskType: { compatible, severity, rationale, suggestedValue, shouldUpdate },',
      '   desiredModality: { compatible, severity, rationale, suggestedValue, shouldUpdate },',
      '   contextDomain: { compatible, severity, rationale, suggestedValue, shouldUpdate },',
      '   authenticityGuidance: { compatible, severity, rationale, suggestedValue, shouldUpdate }',
      '}',
      '10) teacherFacingNotes (array, concise)',
      '',
      'Rules:',
      '- Keep recommendations narrow and classroom-ready.',
      '- Teacher-selected task type is authoritative (do not override it).',
      '- Use learner goal + real-world need as the primary fit signals.',
      '- Keep authenticity guidance practical with clear support boundaries.'
    ].join('\n'),
    outputMode: 'json',
    schemaName: 'benchpath.taskWizard.step2.assist.v1',
    tags: ['benchpath', 'task-wizard', 'step2', 'intent'],
    notes: 'Use as guidance; task validation service remains authoritative gate.'
  }),
  Object.freeze({
    id: 'bp.prompt.task.step3.mapping_assist.v1',
    promptType: 'task_wizard_step3_mapping_assist',
    promptKey: 'task_wizard_step3_mapping_assist',
    version: 'v1',
    isDefault: true,
    isActive: true,
    providerScope: null,
    modelScope: null,
    title: 'Task Wizard Step 3 Mapping Assist',
    description: 'Explains likely benchmark and competency mapping choices as suggestions.',
    systemPromptTemplate: [
      'You are BenchPath Copilot supporting CLB 1-4 mapping suggestions.',
      'The deterministic BenchPath mapper remains primary.',
      'You provide transparent, editable suggestions only.',
      'Never fabricate official CLB wording and never claim authority.',
      'Use provided benchmark/competency/indicator context as your source.'
    ].join('\n'),
    userPromptTemplate: [
      'Teacher context:',
      '- Skill: {{skill}}',
      '- Approximate level: {{approximateLevel}}',
      '- CLB range: {{clbRange}}',
      '- Learner goal: {{learnerGoal}}',
      '- Real-world need: {{realWorldNeed}}',
      '- Task type: {{taskType}}',
      '',
      'Current deterministic recommendations:',
      '- Benchmark: {{selectedBenchmarkLabel}}',
      '- Competency areas: {{selectedCompetencyAreaLabels}}',
      '- Competencies: {{selectedCompetencyLabels}}',
      '- Indicators: {{selectedIndicatorLabels}}',
      '- Features: {{selectedFeatureLabels}}',
      '- Sample task labels: {{selectedSampleTaskLabelLabels}}',
      '',
      'Return JSON with keys:',
      '1) mappingSummary',
      '2) benchmarkSuggestion { label, whySuggested }',
      '3) competencyAreaSuggestions (array of { label, whySuggested })',
      '4) competencySuggestions (array of { label, whySuggested })',
      '5) indicatorSuggestions (array of { label, whySuggested })',
      '6) cautionNotes (array)',
      '7) teacherReviewChecklist (array)'
    ].join('\n'),
    outputMode: 'json',
    schemaName: 'benchpath.taskWizard.step3.assist.v1',
    tags: ['benchpath', 'task-wizard', 'step3', 'mapping', 'clb'],
    notes: 'Must remain suggestion-oriented and aligned with deterministic mapping output.'
  }),
  Object.freeze({
    id: 'bp.prompt.task.step4.blueprint_assist.v1',
    promptType: 'task_wizard_step4_blueprint_assist',
    promptKey: 'task_wizard_step4_blueprint_assist',
    version: 'v1',
    isDefault: true,
    isActive: true,
    providerScope: null,
    modelScope: null,
    title: 'Task Wizard Step 4 Blueprint Assist',
    description: 'Builds concise learner/teacher instructions and implementation blueprint.',
    systemPromptTemplate: [
      'You are BenchPath Copilot helping teachers build practical classroom task blueprints.',
      'Keep language clear, concise, and teacher-usable.',
      'Do not invent official CLB descriptors.'
    ].join('\n'),
    userPromptTemplate: [
      'Task construction inputs:',
      '- Scenario: {{scenario}}',
      '- Teacher instructions draft: {{teacherInstructions}}',
      '- Learner instructions draft: {{learnerInstructions}}',
      '- Task conditions: {{taskConditions}}',
      '- Selected benchmark: {{selectedBenchmarkLabel}}',
      '- Selected competencies: {{selectedCompetencyLabels}}',
      '',
      'Return JSON with keys:',
      '1) refinedLearnerInstructions',
      '2) refinedTeacherInstructions',
      '3) materialsChecklist (array)',
      '4) timingPlan (array)',
      '5) supportBoundaries (array)',
      '6) implementationRisks (array)'
    ].join('\n'),
    outputMode: 'json',
    schemaName: 'benchpath.taskWizard.step4.assist.v1',
    tags: ['benchpath', 'task-wizard', 'step4', 'blueprint'],
    notes: 'Keep recommendations editable; do not auto-finalize teacher-authored text.'
  }),
  Object.freeze({
    id: 'bp.prompt.task.step5.assessment_assist.v1',
    promptType: 'task_wizard_step5_assessment_assist',
    promptKey: 'task_wizard_step5_assessment_assist',
    version: 'v1',
    isDefault: true,
    isActive: true,
    providerScope: null,
    modelScope: null,
    title: 'Task Wizard Step 5 Assessment Assist',
    description: 'Suggests evidence plan and criteria draft tied to selected references.',
    systemPromptTemplate: [
      'You are BenchPath Copilot assisting PBLA evidence planning.',
      'Focus on observable evidence and practical criteria.',
      'Do not fabricate official CLB wording; reference provided context only.'
    ].join('\n'),
    userPromptTemplate: [
      'Assessment design inputs:',
      '- Selected benchmark: {{selectedBenchmarkLabel}}',
      '- Selected competencies: {{selectedCompetencyLabels}}',
      '- Selected indicators: {{selectedIndicatorLabels}}',
      '- Selected features of communication: {{selectedFeatureLabels}}',
      '- Draft task scenario: {{scenario}}',
      '',
      'Return JSON with keys:',
      '1) observableEvidencePlan (array)',
      '2) artifactSuggestions (array)',
      '3) criteriaDraft (array of concise criteria)',
      '4) rubricChecklistDraft (array)',
      '5) pblaPortfolioFitSummary',
      '6) teacherReviewWarnings (array)'
    ].join('\n'),
    outputMode: 'json',
    schemaName: 'benchpath.taskWizard.step5.assist.v1',
    tags: ['benchpath', 'task-wizard', 'step5', 'assessment', 'pbla'],
    notes: 'Recommendations only; taskValidationService enforces final publish gates.'
  }),
  Object.freeze({
    id: 'bp.prompt.general.copilot.v1',
    promptType: 'general_benchpath_copilot',
    promptKey: 'general_benchpath_copilot',
    version: 'v1',
    isDefault: true,
    isActive: true,
    providerScope: null,
    modelScope: null,
    title: 'General BenchPath Copilot',
    description: 'General purpose BenchPath classroom planning assistant.',
    systemPromptTemplate: [
      'You are BenchPath Copilot for CLB/PBLA classroom workflow support.',
      'Be concise, practical, and teacher-oriented.',
      'Use provided BenchPath reference context when present.',
      'Do not claim official authority and do not invent CLB text.'
    ].join('\n'),
    userPromptTemplate: [
      'Teacher request:',
      '{{prompt}}',
      '',
      'Context (if provided):',
      '- Skill: {{skill}}',
      '- Benchmark: {{selectedBenchmarkLabel}}',
      '- Competencies: {{selectedCompetencyLabels}}'
    ].join('\n'),
    outputMode: 'text',
    schemaName: null,
    tags: ['benchpath', 'copilot', 'general'],
    notes: 'Fallback assistant prompt used outside step-specific wizard assistance.'
  })
]);

let _persistenceAdapter = null;
let _persistenceResolved = false;
let _persistenceWarningLogged = false;

function s(value) {
  return String(value ?? '').trim();
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return Boolean(fallback);
  if (typeof value === 'boolean') return value;
  const normalized = s(value).toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return Boolean(value);
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => s(entry)).filter(Boolean);
  }
  const normalized = s(value);
  if (!normalized) return [];
  return normalized
    .split(/[\n,]+/g)
    .map((entry) => s(entry))
    .filter(Boolean);
}

function normalizeScope(value) {
  const list = toArray(value);
  if (!list.length) return null;
  return list;
}

function normalizePromptDefinition(input = {}) {
  return {
    id: s(input.id),
    promptType: s(input.promptType),
    promptKey: s(input.promptKey || input.promptType),
    version: s(input.version || 'v1'),
    isDefault: toBoolean(input.isDefault, false),
    isActive: toBoolean(input.isActive, true),
    providerScope: normalizeScope(input.providerScope),
    modelScope: normalizeScope(input.modelScope),
    title: s(input.title),
    description: s(input.description),
    systemPromptTemplate: String(input.systemPromptTemplate ?? ''),
    userPromptTemplate: String(input.userPromptTemplate ?? ''),
    outputMode: s(input.outputMode || 'text').toLowerCase(),
    schemaName: s(input.schemaName) || null,
    tags: toArray(input.tags),
    notes: s(input.notes) || null
  };
}

function maybeLoadPersistenceAdapter() {
  if (_persistenceResolved) return _persistenceAdapter;
  _persistenceResolved = true;

  const candidateModules = [
    path.join(__dirname, '../../../models/benchpath/promptDefinitionModel'),
    path.join(__dirname, '../../../models/benchpath/promptModel')
  ];

  for (const modulePath of candidateModules) {
    try {
      const mod = require(modulePath);
      const list = mod.listPromptDefinitions || mod.getAllPrompts || mod.getAllDefinitions || null;
      const getById = mod.getPromptDefinitionById || mod.getPromptById || mod.getById || null;
      const upsert = mod.upsertPromptDefinition || mod.savePrompt || mod.upsert || null;
      const deactivate = mod.deactivatePromptDefinition || mod.deactivatePrompt || mod.softDeletePrompt || null;

      if (typeof list === 'function' && typeof getById === 'function') {
        _persistenceAdapter = {
          list: async (filters = {}) => await list(filters),
          getById: async (id) => await getById(id),
          upsert: typeof upsert === 'function' ? async (promptDef, actor) => await upsert(promptDef, actor) : null,
          deactivate: typeof deactivate === 'function' ? async (id, actor) => await deactivate(id, actor) : null
        };
        return _persistenceAdapter;
      }
    } catch (error) {
      // ignore and keep probing
    }
  }

  _persistenceAdapter = null;
  return _persistenceAdapter;
}

function getBuiltInPromptCatalog() {
  return deepClone(BUILT_IN_PROMPT_CATALOG).map((row) => normalizePromptDefinition(row));
}

async function loadPersistedPromptDefinitions(filters = {}) {
  const adapter = maybeLoadPersistenceAdapter();
  if (!adapter) return [];

  try {
    const rows = await adapter.list(filters);
    return arr(rows).map((row) => normalizePromptDefinition(row)).filter((row) => row.id && row.promptType);
  } catch (error) {
    if (!_persistenceWarningLogged) {
      _persistenceWarningLogged = true;
      console.warn(`[BenchPath Prompt Service] Prompt persistence list failed. Falling back to built-in catalog. ${error.message}`);
    }
    return [];
  }
}

function matchesScope(scopeValue, targetValue) {
  const normalizedTarget = s(targetValue).toLowerCase();
  if (!scopeValue || (Array.isArray(scopeValue) && !scopeValue.length)) return true;
  if (!normalizedTarget) return false;
  const candidates = Array.isArray(scopeValue)
    ? scopeValue
    : [scopeValue];
  return candidates.some((entry) => s(entry).toLowerCase() === normalizedTarget);
}

function applyPromptFilters(promptDefs = [], filters = {}) {
  const wantedPromptType = s(filters.promptType);
  const wantIsActive = filters.isActive;
  const providerId = s(filters.providerId || filters.providerScope);
  const modelId = s(filters.modelId || filters.modelScope);

  return promptDefs.filter((row) => {
    if (wantedPromptType && s(row.promptType) !== wantedPromptType) return false;
    if (wantIsActive !== undefined && Boolean(row.isActive) !== Boolean(wantIsActive)) return false;
    if (providerId && !matchesScope(row.providerScope, providerId)) return false;
    if (modelId && !matchesScope(row.modelScope, modelId)) return false;
    return true;
  });
}

function mergePromptDefinitions({ builtIns = [], persisted = [] }) {
  const byId = new Map();

  for (const row of builtIns) {
    byId.set(row.id, row);
  }
  for (const row of persisted) {
    if (!row.id) continue;
    byId.set(row.id, row);
  }

  return Array.from(byId.values()).sort((a, b) => {
    const typeCompare = s(a.promptType).localeCompare(s(b.promptType));
    if (typeCompare !== 0) return typeCompare;
    const verCompare = s(a.version).localeCompare(s(b.version));
    if (verCompare !== 0) return verCompare;
    return s(a.id).localeCompare(s(b.id));
  });
}

async function listPromptDefinitions(filters = {}) {
  const builtIns = getBuiltInPromptCatalog();
  const persisted = await loadPersistedPromptDefinitions(filters);
  const merged = mergePromptDefinitions({ builtIns, persisted });
  return applyPromptFilters(merged, filters);
}

async function getPromptDefinitionById(id) {
  const wanted = s(id);
  if (!wanted) return null;
  const all = await listPromptDefinitions({});
  return all.find((row) => row.id === wanted) || null;
}

async function getDefaultPromptForType(promptType) {
  const type = s(promptType);
  if (!type) return null;

  const activeByType = await listPromptDefinitions({
    promptType: type,
    isActive: true
  });

  return activeByType.find((row) => row.isDefault) || activeByType[0] || null;
}

async function resolvePromptDefinition({
  promptType,
  promptId,
  version,
  providerId,
  modelId
} = {}) {
  const explicitPromptId = s(promptId);
  const type = s(promptType);
  const wantedVersion = s(version);

  if (explicitPromptId) {
    const foundById = await getPromptDefinitionById(explicitPromptId);
    if (!foundById) {
      throw new Error(`Prompt definition "${explicitPromptId}" was not found.`);
    }
    if (!foundById.isActive) {
      throw new Error(`Prompt definition "${explicitPromptId}" is inactive.`);
    }
    if (providerId && !matchesScope(foundById.providerScope, providerId)) {
      throw new Error(`Prompt definition "${explicitPromptId}" is not active for provider "${providerId}".`);
    }
    if (modelId && !matchesScope(foundById.modelScope, modelId)) {
      throw new Error(`Prompt definition "${explicitPromptId}" is not active for model "${modelId}".`);
    }
    return foundById;
  }

  if (type && wantedVersion) {
    const typed = await listPromptDefinitions({
      promptType: type,
      isActive: true,
      providerId,
      modelId
    });
    const exactVersion = typed.find((row) => s(row.version) === wantedVersion);
    if (exactVersion) return exactVersion;
  }

  if (type) {
    const defaultForType = await listPromptDefinitions({
      promptType: type,
      isActive: true,
      providerId,
      modelId
    });

    const activeDefault = defaultForType.find((row) => row.isDefault);
    if (activeDefault) return activeDefault;
    if (defaultForType.length) return defaultForType[0];

    const builtInDefault = getBuiltInPromptCatalog()
      .filter((row) => row.promptType === type && row.isActive)
      .find((row) => row.isDefault)
      || null;
    if (builtInDefault) return builtInDefault;
  }

  throw new Error(`No valid prompt definition could be resolved for type="${type || 'unknown'}".`);
}

function formatTemplateValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((entry) => formatTemplateValue(entry)).filter(Boolean).join(', ');
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
}

function renderTemplate(template, variables = {}) {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = Object.prototype.hasOwnProperty.call(variables, key)
      ? variables[key]
      : '';
    return formatTemplateValue(value);
  });
}

async function renderPrompt({
  promptType,
  promptId,
  version,
  providerId,
  modelId,
  variables
} = {}) {
  const promptDefinition = await resolvePromptDefinition({
    promptType,
    promptId,
    version,
    providerId,
    modelId
  });

  const context = variables && typeof variables === 'object' ? variables : {};
  const systemPrompt = renderTemplate(promptDefinition.systemPromptTemplate, context).trim();
  const userPrompt = renderTemplate(promptDefinition.userPromptTemplate, context).trim();

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt || 'Please assist with this BenchPath request.' });

  return {
    promptDefinition,
    systemPrompt,
    userPrompt,
    messages
  };
}

function buildMessagesFromRenderedPrompt(renderedPrompt, extraMessages = []) {
  const base = Array.isArray(renderedPrompt?.messages)
    ? renderedPrompt.messages
    : [];
  const extras = arr(extraMessages).map((message) => ({
    role: s(message?.role).toLowerCase() || 'user',
    content: String(message?.content ?? '').trim()
  })).filter((message) => message.content);

  return [...base, ...extras];
}

function validatePromptDefinition(promptDef) {
  const normalized = normalizePromptDefinition(promptDef || {});
  const errors = [];

  if (!normalized.id) errors.push('id is required.');
  if (!normalized.promptType) errors.push('promptType is required.');
  if (!normalized.promptKey) errors.push('promptKey is required.');
  if (!normalized.version) errors.push('version is required.');
  if (!normalized.title) errors.push('title is required.');
  if (!normalized.systemPromptTemplate && !normalized.userPromptTemplate) {
    errors.push('At least one of systemPromptTemplate or userPromptTemplate is required.');
  }

  const allowedOutputModes = new Set(['text', 'json', 'markdown']);
  if (!allowedOutputModes.has(normalized.outputMode)) {
    errors.push(`outputMode "${normalized.outputMode}" is invalid. Allowed: text, json, markdown.`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    normalized
  };
}

async function upsertPromptDefinition(promptDef, requestingUser) {
  const validation = validatePromptDefinition(promptDef);
  if (!validation.isValid) {
    throw new Error(`Prompt definition validation failed: ${validation.errors.join(' ')}`);
  }

  const adapter = maybeLoadPersistenceAdapter();
  if (!adapter || typeof adapter.upsert !== 'function') {
    // TODO: Add a BenchPath prompt-definition persistence model/repository (JSON now, DB later).
    throw new Error('BenchPath prompt persistence is not configured yet. Add a benchpath prompt model/repository to enable upsert.');
  }

  const saved = await adapter.upsert(validation.normalized, requestingUser || null);
  return normalizePromptDefinition(saved || validation.normalized);
}

async function deactivatePromptDefinition(id, requestingUser) {
  const wantedId = s(id);
  if (!wantedId) throw new Error('Prompt definition id is required.');

  const adapter = maybeLoadPersistenceAdapter();
  if (!adapter || typeof adapter.deactivate !== 'function') {
    // TODO: Add a BenchPath prompt-definition persistence model/repository (JSON now, DB later).
    throw new Error('BenchPath prompt persistence is not configured yet. Add a benchpath prompt model/repository to enable deactivate.');
  }

  return await adapter.deactivate(wantedId, requestingUser || null);
}

module.exports = {
  getBuiltInPromptCatalog,
  listPromptDefinitions,
  getPromptDefinitionById,
  resolvePromptDefinition,
  renderPrompt,
  buildMessagesFromRenderedPrompt,
  getDefaultPromptForType,
  validatePromptDefinition,
  upsertPromptDefinition,
  deactivatePromptDefinition
};
