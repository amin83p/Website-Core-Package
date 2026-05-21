const { toPublicId, idsEqual } = require('../../../utils/idAdapter');
const { resolveEntityConfig } = require('./entityRegistry');

const DIRECT_REFERENCE_FIELDS = Object.freeze({
  sourceId: 'sources',
  frameworkId: 'clbFrameworks',
  skillId: 'clbSkills',
  stageId: 'clbStages',
  benchmarkId: 'clbBenchmarks',
  competencyAreaId: 'clbCompetencyAreas',
  competencyId: 'clbCompetencies'
});

const MAPPED_ENTITY_TYPE_TO_ENTITY = Object.freeze({
  framework: 'clbFrameworks',
  skill: 'clbSkills',
  competencyArea: 'clbCompetencyAreas',
  benchmark: 'clbBenchmarks',
  competency: 'clbCompetencies',
  indicator: 'clbIndicators',
  profileOfAbility: 'clbProfileOfAbility',
  featureOfCommunication: 'clbFeaturesOfCommunication',
  sampleTaskLabel: 'clbSampleTaskLabels',
  source: 'sources'
});

const SEMANTIC_REFERENCE_FIELDS = Object.freeze({
  clbBenchmarks: {
    single: {
      profileOfAbilityId: 'clbProfileOfAbility'
    },
    multi: {
      competencyIds: 'clbCompetencies',
      featureIds: 'clbFeaturesOfCommunication',
      sampleTaskLabelIds: 'clbSampleTaskLabels'
    }
  },
  clbCompetencies: {
    multi: {
      indicatorIds: 'clbIndicators',
      featureIds: 'clbFeaturesOfCommunication',
      sampleTaskLabelIds: 'clbSampleTaskLabels'
    }
  },
  clbProfileOfAbility: {
    multi: {
      featureIds: 'clbFeaturesOfCommunication'
    }
  },
  clbFeaturesOfCommunication: {
    single: {
      scopeSkillId: 'clbSkills',
      scopeBenchmarkId: 'clbBenchmarks',
      scopeCompetencyId: 'clbCompetencies'
    }
  },
  clbSampleTaskLabels: {
    single: {
      linkedBenchmarkId: 'clbBenchmarks',
      linkedCompetencyId: 'clbCompetencies'
    }
  },
  benchpathTasks: {
    single: {
      skill: 'clbSkills',
      suggestedBenchmarkId: 'clbBenchmarks',
      selectedBenchmarkId: 'clbBenchmarks'
    },
    multi: {
      competencyAreaIds: 'clbCompetencyAreas',
      competencyIds: 'clbCompetencies',
      profileOfAbilityRefs: 'clbProfileOfAbility',
      indicatorIds: 'clbIndicators',
      featureOfCommunicationIds: 'clbFeaturesOfCommunication',
      sampleTaskLabelIds: 'clbSampleTaskLabels'
    }
  }
});

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

function normalizeId(value) {
  return toPublicId(value) || asString(value) || null;
}

function toMapKey(entityType, id) {
  return `${String(entityType || '')}:${String(id || '')}`;
}

async function defaultRecordLoader(entityType, id) {
  const repository = resolveEntityConfig(entityType)?.repository;
  if (!repository || typeof repository.getById !== 'function') return null;
  return repository.getById(id);
}

function buildRecordResolver(options = {}) {
  const customLoader = typeof options.getRecord === 'function'
    ? options.getRecord
    : defaultRecordLoader;

  const cache = new Map();

  return async function resolveRecord(entityType, id) {
    const normalizedId = normalizeId(id);
    if (!normalizedId) return null;

    const cacheKey = toMapKey(entityType, normalizedId);
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const resolved = await customLoader(entityType, normalizedId);
    cache.set(cacheKey, resolved || null);
    return resolved || null;
  };
}

function ensureMatch(errors, leftField, leftValue, rightLabel, rightValue) {
  if (!leftValue || !rightValue) return;
  if (!idsEqual(leftValue, rightValue)) {
    errors.push(`${leftField} (${leftValue}) does not match ${rightLabel} (${rightValue}).`);
  }
}

async function validateDirectReferences(payload, resolveRecord, errors) {
  for (const [field, entityType] of Object.entries(DIRECT_REFERENCE_FIELDS)) {
    const id = normalizeId(payload?.[field]);
    if (!id) continue;

    const record = await resolveRecord(entityType, id);
    if (!record) {
      errors.push(`${field} does not exist: ${id}`);
    }
  }
}

async function validateHierarchyCompatibility(payload, resolveRecord, errors) {
  const frameworkId = normalizeId(payload.frameworkId);
  const skillId = normalizeId(payload.skillId);
  const stageId = normalizeId(payload.stageId);
  const benchmarkId = normalizeId(payload.benchmarkId);
  const competencyAreaId = normalizeId(payload.competencyAreaId);
  const competencyId = normalizeId(payload.competencyId);

  const skill = skillId ? await resolveRecord('clbSkills', skillId) : null;
  const stage = stageId ? await resolveRecord('clbStages', stageId) : null;
  const benchmark = benchmarkId ? await resolveRecord('clbBenchmarks', benchmarkId) : null;
  const competencyArea = competencyAreaId ? await resolveRecord('clbCompetencyAreas', competencyAreaId) : null;
  const competency = competencyId ? await resolveRecord('clbCompetencies', competencyId) : null;

  if (frameworkId && skill) ensureMatch(errors, 'frameworkId', frameworkId, 'skill.frameworkId', normalizeId(skill.frameworkId));
  if (frameworkId && stage) ensureMatch(errors, 'frameworkId', frameworkId, 'stage.frameworkId', normalizeId(stage.frameworkId));
  if (frameworkId && benchmark) ensureMatch(errors, 'frameworkId', frameworkId, 'benchmark.frameworkId', normalizeId(benchmark.frameworkId));
  if (frameworkId && competencyArea) ensureMatch(errors, 'frameworkId', frameworkId, 'competencyArea.frameworkId', normalizeId(competencyArea.frameworkId));
  if (frameworkId && competency) ensureMatch(errors, 'frameworkId', frameworkId, 'competency.frameworkId', normalizeId(competency.frameworkId));

  if (skillId && benchmark) ensureMatch(errors, 'skillId', skillId, 'benchmark.skillId', normalizeId(benchmark.skillId));
  if (skillId && competencyArea) ensureMatch(errors, 'skillId', skillId, 'competencyArea.skillId', normalizeId(competencyArea.skillId));
  if (skillId && competency) ensureMatch(errors, 'skillId', skillId, 'competency.skillId', normalizeId(competency.skillId));

  if (stageId && benchmark) ensureMatch(errors, 'stageId', stageId, 'benchmark.stageId', normalizeId(benchmark.stageId));

  if (benchmarkId && competency) ensureMatch(errors, 'benchmarkId', benchmarkId, 'competency.benchmarkId', normalizeId(competency.benchmarkId));
  if (competencyAreaId && competency) ensureMatch(errors, 'competencyAreaId', competencyAreaId, 'competency.competencyAreaId', normalizeId(competency.competencyAreaId));
}

async function validateFrameworkRelations(payload, resolveRecord, errors) {
  const frameworkId = normalizeId(payload.id) || normalizeId(payload.frameworkId);

  for (const stageId of asArray(payload.stageIds).map(normalizeId).filter(Boolean)) {
    const stage = await resolveRecord('clbStages', stageId);
    if (!stage) {
      errors.push(`stageIds contains unknown stage: ${stageId}`);
      continue;
    }

    ensureMatch(errors, 'framework.id', frameworkId, `stage(${stageId}).frameworkId`, normalizeId(stage.frameworkId));
  }

  for (const skillId of asArray(payload.skillIds).map(normalizeId).filter(Boolean)) {
    const skill = await resolveRecord('clbSkills', skillId);
    if (!skill) {
      errors.push(`skillIds contains unknown skill: ${skillId}`);
      continue;
    }

    ensureMatch(errors, 'framework.id', frameworkId, `skill(${skillId}).frameworkId`, normalizeId(skill.frameworkId));
  }
}

async function validateSkillRelations(payload, resolveRecord, errors) {
  const frameworkId = normalizeId(payload.frameworkId);
  const skillId = normalizeId(payload.id) || normalizeId(payload.skillId);

  for (const stageId of asArray(payload.stageIds).map(normalizeId).filter(Boolean)) {
    const stage = await resolveRecord('clbStages', stageId);
    if (!stage) {
      errors.push(`stageIds contains unknown stage: ${stageId}`);
      continue;
    }

    ensureMatch(errors, 'frameworkId', frameworkId, `stage(${stageId}).frameworkId`, normalizeId(stage.frameworkId));
  }

  for (const benchmarkId of asArray(payload.benchmarkIds).map(normalizeId).filter(Boolean)) {
    const benchmark = await resolveRecord('clbBenchmarks', benchmarkId);
    if (!benchmark) {
      errors.push(`benchmarkIds contains unknown benchmark: ${benchmarkId}`);
      continue;
    }

    ensureMatch(errors, 'skill.id', skillId, `benchmark(${benchmarkId}).skillId`, normalizeId(benchmark.skillId));
    ensureMatch(errors, 'frameworkId', frameworkId, `benchmark(${benchmarkId}).frameworkId`, normalizeId(benchmark.frameworkId));
  }

  for (const competencyAreaId of asArray(payload.competencyAreaIds).map(normalizeId).filter(Boolean)) {
    const competencyArea = await resolveRecord('clbCompetencyAreas', competencyAreaId);
    if (!competencyArea) {
      errors.push(`competencyAreaIds contains unknown competency area: ${competencyAreaId}`);
      continue;
    }

    ensureMatch(errors, 'skill.id', skillId, `competencyArea(${competencyAreaId}).skillId`, normalizeId(competencyArea.skillId));
    ensureMatch(errors, 'frameworkId', frameworkId, `competencyArea(${competencyAreaId}).frameworkId`, normalizeId(competencyArea.frameworkId));
  }
}

async function validateSourceFragmentMappings(payload, resolveRecord, errors) {
  const mappedEntityType = asString(payload.mappedEntityType);
  if (!mappedEntityType) return;

  const targetEntity = MAPPED_ENTITY_TYPE_TO_ENTITY[mappedEntityType] || null;
  if (!targetEntity) {
    // mappedEntityType can be "other" or an extension value; skip strict relation validation in those cases.
    return;
  }

  for (const mappedId of asArray(payload.mappedEntityIds).map(normalizeId).filter(Boolean)) {
    const linked = await resolveRecord(targetEntity, mappedId);
    if (!linked) {
      errors.push(`mappedEntityIds contains unknown ${mappedEntityType}: ${mappedId}`);
    }
  }
}

async function validateSemanticReferences(entityType, payload, resolveRecord, errors) {
  const spec = SEMANTIC_REFERENCE_FIELDS[String(entityType || '')];
  if (!spec) return;

  const singleRefs = spec.single || {};
  for (const [field, targetEntity] of Object.entries(singleRefs)) {
    const id = normalizeId(payload?.[field]);
    if (!id) continue;
    const row = await resolveRecord(targetEntity, id);
    if (!row) {
      errors.push(`${field} does not exist: ${id}`);
    }
  }

  const multiRefs = spec.multi || {};
  for (const [field, targetEntity] of Object.entries(multiRefs)) {
    const values = asArray(payload?.[field]).map(normalizeId).filter(Boolean);
    for (const id of values) {
      const row = await resolveRecord(targetEntity, id);
      if (!row) {
        errors.push(`${field} contains unknown reference: ${id}`);
      }
    }
  }
}

async function validateBenchpathTaskAlignment(payload, resolveRecord, errors) {
  const skillId = normalizeId(payload.skill);
  const selectedBenchmarkId = normalizeId(payload.selectedBenchmarkId);
  const suggestedBenchmarkId = normalizeId(payload.suggestedBenchmarkId);

  const selectedBenchmark = selectedBenchmarkId
    ? await resolveRecord('clbBenchmarks', selectedBenchmarkId)
    : null;
  const suggestedBenchmark = suggestedBenchmarkId
    ? await resolveRecord('clbBenchmarks', suggestedBenchmarkId)
    : null;

  if (skillId && selectedBenchmark) {
    ensureMatch(errors, 'skill', skillId, 'selectedBenchmark.skillId', normalizeId(selectedBenchmark.skillId));
  }
  if (skillId && suggestedBenchmark) {
    ensureMatch(errors, 'skill', skillId, 'suggestedBenchmark.skillId', normalizeId(suggestedBenchmark.skillId));
  }
}

async function validateBenchpathCrossEntityIntegrity(entityType, payload, options = {}) {
  const normalizedEntityType = String(entityType || '').trim();
  const data = payload && typeof payload === 'object' ? payload : {};
  const errors = [];

  const resolveRecord = buildRecordResolver(options);

  await validateDirectReferences(data, resolveRecord, errors);
  await validateHierarchyCompatibility(data, resolveRecord, errors);

  if (normalizedEntityType === 'clbFrameworks') {
    await validateFrameworkRelations(data, resolveRecord, errors);
  }

  if (normalizedEntityType === 'clbSkills') {
    await validateSkillRelations(data, resolveRecord, errors);
  }

  if (normalizedEntityType === 'sourceFragments') {
    await validateSourceFragmentMappings(data, resolveRecord, errors);
  }

  await validateSemanticReferences(normalizedEntityType, data, resolveRecord, errors);
  if (normalizedEntityType === 'benchpathTasks') {
    await validateBenchpathTaskAlignment(data, resolveRecord, errors);
  }

  return errors;
}

module.exports = {
  validateBenchpathCrossEntityIntegrity
};
