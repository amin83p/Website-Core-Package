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

test('gradePercentContribution multiplies activity percent by weight percent of grade', () => {
  assert.equal(gradebookWeightService.gradePercentContribution(100, 10), 10);
  assert.equal(gradebookWeightService.gradePercentContribution(90, 10), 9);
  assert.equal(gradebookWeightService.gradePercentContribution(80, 25), 20);
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

test('buildNormalizedWeightMap handles duplicate activity ids via index keys', () => {
  const map = gradebookWeightService.buildNormalizedWeightMap([
    { id: 'dup', weight: 10, totalScore: 10, includeInGradeCalculation: true },
    { id: 'dup', weight: 30, totalScore: 30, includeInGradeCalculation: true }
  ]);
  assert.equal(map.size, 2);
  assert.equal(map.get('dup'), 0.25);
  assert.equal(map.get('dup__1'), 0.75);
});

test('buildNormalizedWeightMap uses colKey and index fallback when id is missing', () => {
  const map = gradebookWeightService.buildNormalizedWeightMap([
    { colKey: 'col_a', weight: 10, includeInGradeCalculation: true },
    { weight: 30, includeInGradeCalculation: true }
  ]);
  assert.equal(map.get('col_a'), 0.25);
  assert.equal(map.get('activity_1'), 0.75);
});

test('computeWeightedAveragePercent uses distinct keys for duplicate ids', () => {
  const activities = [
    { id: 'dup', weight: 10, totalScore: 10, includeInGradeCalculation: true },
    { id: 'dup', weight: 30, totalScore: 30, includeInGradeCalculation: true }
  ];
  const avg = gradebookWeightService.computeWeightedAveragePercent(
    activities,
    (activity, index) => ({
      score: index === 0 ? 8 : 15,
      totalScore: activity.totalScore
    })
  );
  assert.equal(avg, 57.5);
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

test('computeStudentPeriodAssignmentPercent renormalizes weights that do not sum to 100', () => {
  const columns = [
    { includeInGradeCalculation: true, weight: 10, totalScore: 10 },
    { includeInGradeCalculation: true, weight: 10, totalScore: 10 }
  ];
  const cells = [
    { percent: 100, score: 10, effective: true },
    { percent: 0, score: 0, absent: true, effective: true }
  ];
  const avg = gradebookWeightService.computeStudentPeriodAssignmentPercent(cells, columns);
  assert.equal(avg, 50);
});

test('computeStudentPeriodAssignmentPercent treats absent and missing scores as 0%', () => {
  const columns = [
    { includeInGradeCalculation: true, weight: 20, totalScore: 10, kind: 'gradebook' },
    { includeInGradeCalculation: true, weight: 30, totalScore: 20, kind: 'gradebook' }
  ];
  const scoredAbsent = [
    { percent: 80, score: 8, effective: true },
    { absent: true, effective: true }
  ];
  assert.equal(
    gradebookWeightService.computeStudentPeriodAssignmentPercent(scoredAbsent, columns),
    32
  );

  const scoredMissing = [
    { percent: 80, score: 8, effective: true },
    { effective: true }
  ];
  assert.equal(
    gradebookWeightService.computeStudentPeriodAssignmentPercent(scoredMissing, columns),
    32
  );
});

test('computeStudentPeriodAssignmentPercent excludes N/A cells from weight sum per student', () => {
  const columns = [
    { includeInGradeCalculation: true, weight: 20, totalScore: 10, kind: 'gradebook' },
    { includeInGradeCalculation: true, weight: 30, totalScore: 20, kind: 'gradebook' },
    { includeInGradeCalculation: true, weight: 50, totalScore: 30, kind: 'gradebook' }
  ];
  const withNa = [
    { percent: 80, score: 8, effective: true },
    { absent: true, effective: true },
    { notApplicable: true, effective: false }
  ];
  assert.equal(
    gradebookWeightService.computeStudentPeriodAssignmentPercent(withNa, columns),
    32
  );

  const allApplicable = [
    { percent: 80, score: 8, effective: true },
    { percent: 60, score: 12, effective: true },
    { percent: 100, score: 30, effective: true }
  ];
  assert.equal(
    gradebookWeightService.computeStudentPeriodAssignmentPercent(allApplicable, columns),
    84
  );
});

test('computeStudentPeriodAssignmentPercent matches explicit gradebook weights when all scored', () => {
  const columns = [
    { kind: 'gradebook', includeInGradeCalculation: true, totalScore: 10, weight: 20 },
    { kind: 'gradebook', includeInGradeCalculation: true, totalScore: 20, weight: 30 }
  ];
  const cells = [
    { score: 8, percent: 80, effective: true },
    { score: 15, percent: 75, effective: true }
  ];
  const avg = gradebookWeightService.computeStudentPeriodAssignmentPercent(cells, columns);
  assert.equal(avg, 77);
});

test('buildStudentPeriodAssignmentBreakdown lists applicable, excluded, and N/A activities', () => {
  const columns = [
    { label: 'A', date: '2026-01-01', kind: 'gradebook', kindLabel: 'Gradebook', includeInGradeCalculation: true, weight: 20, totalScore: 10 },
    { label: 'B', date: '2026-01-02', kind: 'gradebook', kindLabel: 'Gradebook', includeInGradeCalculation: true, weight: 30, totalScore: 20 },
    { label: 'C', date: '2026-01-03', kind: 'gradebook', kindLabel: 'Gradebook', includeInGradeCalculation: false, weight: 50, totalScore: 30 },
    { label: 'D', date: '2026-01-04', kind: 'gradebook', kindLabel: 'Gradebook', includeInGradeCalculation: true, weight: 50, totalScore: 30 }
  ];
  const cells = [
    { percent: 80, score: 8, effective: true },
    { absent: true, effective: true },
    { percent: 100, score: 30, effective: true },
    { notApplicable: true, effective: false }
  ];
  const breakdown = gradebookWeightService.buildStudentPeriodAssignmentBreakdown(cells, columns);
  assert.equal(breakdown.applicableActivities.length, 2);
  assert.equal(breakdown.excludedActivities.length, 1);
  assert.equal(breakdown.notApplicableActivities.length, 1);
  assert.equal(breakdown.weightSum, 50);
  assert.equal(breakdown.assignmentsPercent, 32);
  assert.equal(breakdown.applicableActivities[0].normalizedWeightPercent, 40);
  assert.equal(breakdown.applicableActivities[1].status, 'absent');
  assert.equal(breakdown.applicableActivities[1].contributionPercent, 0);
});
