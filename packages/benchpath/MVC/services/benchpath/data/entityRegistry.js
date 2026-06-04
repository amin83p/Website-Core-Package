const benchpathRepositories = require('../../../repositories/benchpath');

const BENCHPATH_ENTITY_REGISTRY = Object.freeze({
  sources: { repository: benchpathRepositories.sources },
  sourceFragments: { repository: benchpathRepositories.sourceFragments },
  clbFrameworks: { repository: benchpathRepositories.clbFrameworks },
  clbStages: { repository: benchpathRepositories.clbStages },
  clbSkills: { repository: benchpathRepositories.clbSkills },
  clbCompetencyAreas: { repository: benchpathRepositories.clbCompetencyAreas },
  clbBenchmarks: { repository: benchpathRepositories.clbBenchmarks },
  clbCompetencies: { repository: benchpathRepositories.clbCompetencies },
  clbIndicators: { repository: benchpathRepositories.clbIndicators },
  clbProfileOfAbility: { repository: benchpathRepositories.clbProfileOfAbility },
  clbFeaturesOfCommunication: { repository: benchpathRepositories.clbFeaturesOfCommunication },
  clbSampleTaskLabels: { repository: benchpathRepositories.clbSampleTaskLabels },
  benchpathTasks: { repository: benchpathRepositories.benchpathTasks }
});

const REFERENCE_ENTITY_TYPE_BY_KEY = Object.freeze({
  competencyAreas: 'clbCompetencyAreas',
  benchmarks: 'clbBenchmarks',
  competencies: 'clbCompetencies',
  indicators: 'clbIndicators',
  profileOfAbility: 'clbProfileOfAbility',
  featuresOfCommunication: 'clbFeaturesOfCommunication',
  sampleTaskLabels: 'clbSampleTaskLabels'
});

function resolveEntityConfig(entityType) {
  return BENCHPATH_ENTITY_REGISTRY[String(entityType || '')] || null;
}

function resolveReferenceEntityType(entityKey) {
  return REFERENCE_ENTITY_TYPE_BY_KEY[String(entityKey || '')] || null;
}

module.exports = {
  BENCHPATH_ENTITY_REGISTRY,
  REFERENCE_ENTITY_TYPE_BY_KEY,
  resolveEntityConfig,
  resolveReferenceEntityType
};
