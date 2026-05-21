const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateBenchpathCrossEntityIntegrity
} = require('../MVC/services/benchpath/data/integrityValidationService');

function makeResolver(recordsByEntity = {}) {
  return async (entityType, id) => {
    const bucket = recordsByEntity[String(entityType || '')] || {};
    return bucket[String(id || '')] || null;
  };
}

test('cross-entity integrity passes for aligned skill relations', async () => {
  const getRecord = makeResolver({
    clbFrameworks: {
      'framework:clb': { id: 'framework:clb' }
    },
    clbStages: {
      'stage:1': { id: 'stage:1', frameworkId: 'framework:clb' }
    },
    clbBenchmarks: {
      'benchmark:listening:1': {
        id: 'benchmark:listening:1',
        frameworkId: 'framework:clb',
        skillId: 'skill:listening',
        stageId: 'stage:1'
      }
    },
    clbCompetencyAreas: {
      'ca:listening:interacting_with_others': {
        id: 'ca:listening:interacting_with_others',
        frameworkId: 'framework:clb',
        skillId: 'skill:listening'
      }
    }
  });

  const errors = await validateBenchpathCrossEntityIntegrity('clbSkills', {
    id: 'skill:listening',
    frameworkId: 'framework:clb',
    stageIds: ['stage:1'],
    benchmarkIds: ['benchmark:listening:1'],
    competencyAreaIds: ['ca:listening:interacting_with_others']
  }, { getRecord });

  assert.deepEqual(errors, []);
});

test('cross-entity integrity flags framework mismatch for skill stage list', async () => {
  const getRecord = makeResolver({
    clbFrameworks: {
      'framework:clb': { id: 'framework:clb' }
    },
    clbStages: {
      'stage:1': { id: 'stage:1', frameworkId: 'framework:other' }
    }
  });

  const errors = await validateBenchpathCrossEntityIntegrity('clbSkills', {
    id: 'skill:listening',
    frameworkId: 'framework:clb',
    stageIds: ['stage:1']
  }, { getRecord });

  assert.equal(errors.some((entry) => entry.includes('does not match')), true);
});

test('cross-entity integrity validates sourceFragment mapped entity ids', async () => {
  const getRecord = makeResolver({
    clbBenchmarks: {}
  });

  const errors = await validateBenchpathCrossEntityIntegrity('sourceFragments', {
    sourceId: 'source:clb:2012',
    mappedEntityType: 'benchmark',
    mappedEntityIds: ['benchmark:listening:99']
  }, { getRecord });

  assert.equal(errors.some((entry) => entry.includes('mappedEntityIds contains unknown benchmark')), true);
});
