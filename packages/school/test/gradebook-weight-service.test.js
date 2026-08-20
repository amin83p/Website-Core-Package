const test = require('node:test');
const assert = require('node:assert/strict');

const gradebookWeightService = require('../MVC/services/school/gradebookWeightService');

test('resolveActivityWeight defaults to totalScore when weight is missing', () => {
  assert.equal(gradebookWeightService.resolveActivityWeight({ totalScore: 20 }), 20);
  assert.equal(gradebookWeightService.resolveActivityWeight({ weight: 15, totalScore: 20 }), 15);
});

test('buildNormalizedWeightMap normalizes weights to fractions summing to 1', () => {
  const map = gradebookWeightService.buildNormalizedWeightMap([
    { id: 'a', weight: 20, includeInGradeCalculation: true },
    { id: 'b', weight: 30, includeInGradeCalculation: true }
  ]);
  assert.equal(map.get('a'), 0.4);
  assert.equal(map.get('b'), 0.6);
  assert.equal(
    gradebookWeightService.formatNormalizedWeightPercent(map.get('a')),
    '40%'
  );
});

test('buildNormalizedWeightMap excludes activities not included in grade calculation', () => {
  const map = gradebookWeightService.buildNormalizedWeightMap([
    { id: 'a', weight: 20, includeInGradeCalculation: true },
    { id: 'b', weight: 30, includeInGradeCalculation: false }
  ]);
  assert.equal(map.get('a'), 1);
  assert.equal(map.has('b'), false);
});

test('weightedContributionPercent multiplies activity percent by normalized weight', () => {
  assert.equal(
    gradebookWeightService.weightedContributionPercent(80, 0.4),
    32
  );
  assert.equal(
    gradebookWeightService.weightedContributionPercent(75, 0.6),
    45
  );
});

test('computeWeightedAveragePercent uses normalized weights across activities', () => {
  const activities = [
    { id: 'a', weight: 20, totalScore: 10, includeInGradeCalculation: true },
    { id: 'b', weight: 30, totalScore: 20, includeInGradeCalculation: true }
  ];
  const avg = gradebookWeightService.computeWeightedAveragePercent(
    activities,
    (activity) => ({
      score: activity.id === 'a' ? 8 : 15,
      totalScore: activity.totalScore
    })
  );
  assert.equal(avg, 77);
});

test('computeWeightedAveragePercent matches earned-over-possible when weight equals totalScore', () => {
  const activities = [
    { id: 'a', totalScore: 10, includeInGradeCalculation: true },
    { id: 'b', totalScore: 20, includeInGradeCalculation: true }
  ];
  const avg = gradebookWeightService.computeWeightedAveragePercent(
    activities,
    (activity) => ({
      score: activity.id === 'a' ? 8 : 15,
      totalScore: activity.totalScore
    })
  );
  assert.equal(avg, Math.round((23 / 30) * 10000) / 100);
});
