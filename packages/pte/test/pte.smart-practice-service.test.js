const test = require('node:test');
const assert = require('node:assert/strict');

const smartPracticeService = require('../MVC/services/pte/pteSmartPracticeService');

const {
  calculateNeedScore,
  buildPoolGroups,
  rankGroups,
  buildPlansFromRankedGroups,
  selectQuestionsForPlans,
  buildPracticeBySkillSelectionFromContext,
  buildQuestionHistoryStats,
  normalizeAttemptItems,
  normalizePracticeBySkillRequestedPlan
} = smartPracticeService.__testables;

test('smart practice need score is deterministic and prioritizes weak hard-rated areas', () => {
  const strong = calculateNeedScore({
    scoredCount: 4,
    averagePercentage: 88,
    recentAveragePercentage: 90,
    hardRatingCount: 0,
    ratingCount: 2,
    averageTimeSeconds: 35,
    globalAverageTimeSeconds: 40,
    poolDifficultyCounts: { medium: 3, hard: 1, very_hard: 0 }
  });
  const weak = calculateNeedScore({
    scoredCount: 4,
    averagePercentage: 46,
    recentAveragePercentage: 42,
    hardRatingCount: 3,
    ratingCount: 3,
    averageTimeSeconds: 75,
    globalAverageTimeSeconds: 40,
    poolDifficultyCounts: { medium: 3, hard: 1, very_hard: 1 }
  });
  const weakAgain = calculateNeedScore({
    scoredCount: 4,
    averagePercentage: 46,
    recentAveragePercentage: 42,
    hardRatingCount: 3,
    ratingCount: 3,
    averageTimeSeconds: 75,
    globalAverageTimeSeconds: 40,
    poolDifficultyCounts: { medium: 3, hard: 1, very_hard: 1 }
  });

  assert.equal(weak, weakAgain);
  assert.equal(weak > strong, true);
});

test('smart practice avoids recently attempted questions when alternatives exist', () => {
  const poolGroups = buildPoolGroups([
    {
      id: 'Q1',
      orgId: 'ORG-1',
      status: 'published',
      practiceEnabled: true,
      skill: 'speaking',
      questionType: 'speaking_read_aloud',
      difficulty: 'medium',
      title: 'Recent question'
    },
    {
      id: 'Q2',
      orgId: 'ORG-1',
      status: 'published',
      practiceEnabled: true,
      skill: 'speaking',
      questionType: 'speaking_read_aloud',
      difficulty: 'medium',
      title: 'Fresh question'
    }
  ]);

  const selected = selectQuestionsForPlans({
    skillPlans: [{
      skill: 'speaking',
      typePlans: [{
        questionType: 'speaking_read_aloud',
        questionCount: 1,
        targetDifficultyOrder: ['medium']
      }]
    }],
    poolGroups,
    recentAttemptMap: new Map([['Q1', Date.now()]])
  });

  assert.equal(selected.length, 1);
  assert.equal(selected[0].questionVersionId, 'Q2');
});

test('smart practice no-history fallback builds a balanced starter plan', () => {
  const poolGroups = buildPoolGroups([
    { id: 'Q1', orgId: 'ORG-1', status: 'published', practiceEnabled: true, skill: 'speaking', questionType: 'speaking_read_aloud', difficulty: 'medium' },
    { id: 'Q2', orgId: 'ORG-1', status: 'published', practiceEnabled: true, skill: 'writing', questionType: 'writing_write_email', difficulty: 'medium' },
    { id: 'Q3', orgId: 'ORG-1', status: 'published', practiceEnabled: true, skill: 'reading', questionType: 'reading_mcq_single', difficulty: 'hard' },
    { id: 'Q4', orgId: 'ORG-1', status: 'published', practiceEnabled: true, skill: 'listening', questionType: 'listening_dictation', difficulty: 'hard' }
  ]);
  const ranked = rankGroups({
    performanceGroups: [],
    poolGroups,
    priorityMode: 'balanced_gaps'
  });
  const plans = buildPlansFromRankedGroups(ranked, 4, { includeMaintenance: true });
  const count = plans.reduce((sum, skillPlan) => (
    sum + skillPlan.typePlans.reduce((typeSum, typePlan) => typeSum + typePlan.questionCount, 0)
  ), 0);
  const skills = plans.map((row) => row.skill).sort();

  assert.equal(count, 4);
  assert.deepEqual(skills, ['listening', 'reading', 'speaking', 'writing'].sort());
});

test('practice-by-skill planner uses unseen questions before seen fallback', () => {
  const statById = new Map([
    ['Q1', { attemptsCount: 1, avgScore: 80, lastScore: 80, lastAttemptAt: 2000 }],
    ['Q2', { attemptsCount: 1, avgScore: 35, lastScore: 35, lastAttemptAt: 1000 }]
  ]);
  const result = buildPracticeBySkillSelectionFromContext({
    requestedCount: 2,
    pool: [
      { id: 'Q1', skill: 'speaking', questionType: 'speaking_read_aloud', difficulty: 'hard' },
      { id: 'Q2', skill: 'speaking', questionType: 'speaking_read_aloud', difficulty: 'hard' },
      { id: 'Q3', skill: 'speaking', questionType: 'speaking_read_aloud', difficulty: 'medium' }
    ],
    statById,
    seenQuestionIds: new Set(['Q1', 'Q2'])
  });

  assert.deepEqual(result.selection.map((row) => row.id), ['Q3', 'Q2']);
  assert.equal(result.unseenUsed, 1);
  assert.equal(result.seenFallbackUsed, 1);
});

test('practice-by-skill seen fallback prefers weaker scores inside difficulty buckets', () => {
  const statById = new Map([
    ['Q1', { attemptsCount: 2, avgScore: 88, lastScore: 90, lastAttemptAt: 3000 }],
    ['Q2', { attemptsCount: 2, avgScore: 42, lastScore: 40, lastAttemptAt: 2000 }],
    ['Q3', { attemptsCount: 1, avgScore: 20, lastScore: 20, lastAttemptAt: 1000 }]
  ]);
  const result = buildPracticeBySkillSelectionFromContext({
    requestedCount: 2,
    pool: [
      { id: 'Q1', skill: 'writing', questionType: 'writing_summarize_written_text', difficulty: 'hard' },
      { id: 'Q2', skill: 'writing', questionType: 'writing_summarize_written_text', difficulty: 'hard' },
      { id: 'Q3', skill: 'writing', questionType: 'writing_summarize_written_text', difficulty: 'medium' }
    ],
    statById,
    seenQuestionIds: new Set(['Q1', 'Q2', 'Q3'])
  });

  assert.deepEqual(result.selection.map((row) => row.id), ['Q2', 'Q1']);
  assert.equal(result.unseenUsed, 0);
  assert.equal(result.seenFallbackUsed, 2);
});

test('practice-by-skill history stats track latest, average, and best score', () => {
  const stats = buildQuestionHistoryStats([
    { questionVersionId: 'Q1', score: 80, occurredAtMs: 1000 },
    { questionVersionId: 'Q1', score: 40, occurredAtMs: 3000 },
    { questionVersionId: 'Q2', score: null, occurredAtMs: 2000 }
  ]);

  assert.equal(stats.get('Q1').attemptsCount, 2);
  assert.equal(stats.get('Q1').avgScore, 60);
  assert.equal(stats.get('Q1').bestScore, 80);
  assert.equal(stats.get('Q1').lastScore, 40);
  assert.equal(stats.get('Q2').attemptsCount, 1);
  assert.equal(stats.get('Q2').avgScore, null);
});

test('practice-by-skill history leaves missing scores unknown', () => {
  const rows = normalizeAttemptItems([
    {
      id: 'A1',
      questionVersionId: 'Q1',
      status: 'submitted',
      skill: 'speaking',
      questionType: 'speaking_read_aloud',
      percentage: '',
      scoreFinal: '',
      maxScore: '',
      finishedAt: '2026-05-01T10:00:00.000Z'
    },
    {
      id: 'A2',
      questionVersionId: 'Q2',
      status: 'submitted',
      skill: 'speaking',
      questionType: 'speaking_read_aloud',
      scoreFinal: 3,
      maxScore: 5,
      finishedAt: '2026-05-01T10:05:00.000Z'
    }
  ]);

  const scoreById = new Map(rows.map((row) => [row.questionVersionId, row.score]));
  assert.equal(scoreById.get('Q1'), null);
  assert.equal(scoreById.get('Q2'), 60);
});

test('practice-by-skill inline plan treats questionCount as total count', () => {
  const plan = normalizePracticeBySkillRequestedPlan({
    skill: 'speaking',
    questionTypes: ['speaking_read_aloud', 'speaking_repeat_sentence', 'speaking_describe_image'],
    questionCount: 5
  });

  assert.equal(plan.length, 1);
  assert.equal(
    plan[0].typePlans.reduce((sum, row) => sum + row.questionCount, 0),
    5
  );
  assert.deepEqual(plan[0].typePlans.map((row) => row.questionCount), [2, 2, 1]);
});
