const pteAttemptItemRepository = require('../../repositories/pteAttemptItemRepository');
const pteQuestionVersionRepository = require('../../repositories/pteQuestionVersionRepository');
const { toPublicId, idsEqual } = require('../../utils/idAdapter');

const VERSION = 'pte-smart-practice-v1';
const PRACTICE_BY_SKILL_PLAN_VERSION = 'pte-practice-by-skill-planner-v1';
const DEFAULT_WINDOW_DAYS = 90;
const DEFAULT_TARGET_QUESTION_COUNT = 10;
const MAX_TARGET_QUESTION_COUNT = 15;
const MAX_ATTEMPT_ITEMS = 200;
const PLAN_RUNTIME_MAX_ATTEMPT_ITEMS = 800;
const QUESTION_PROJECTION = Object.freeze({
  id: 1,
  orgId: 1,
  familyId: 1,
  status: 1,
  practiceEnabled: 1,
  code: 1,
  title: 1,
  testType: 1,
  skill: 1,
  questionType: 1,
  difficulty: 1,
  tags: 1,
  audit: 1
});

const SKILL_ORDER = Object.freeze(['speaking', 'writing', 'reading', 'listening']);
const FINAL_ITEM_STATUSES = new Set(['submitted', 'auto_submitted', 'scored', 'feedback_provided']);
const SELF_DIFFICULTY_WEIGHTS = Object.freeze({
  very_easy: -8,
  easy: -4,
  medium: 0,
  hard: 14,
  very_hard: 22
});
const DIFFICULTY_ORDER = Object.freeze(['easy', 'medium', 'hard', 'very_hard']);
const DIFFICULTY_LABELS = Object.freeze({
  easy: 'easy',
  medium: 'medium',
  hard: 'hard',
  very_hard: 'very hard'
});
const PRACTICE_BY_SKILL_DIFFICULTY_ORDER = Object.freeze(['very_hard', 'hard', 'medium', 'easy']);
const PRACTICE_BY_SKILL_DIFFICULTY_INDEX = PRACTICE_BY_SKILL_DIFFICULTY_ORDER.reduce((map, value, index) => {
  map[value] = index;
  return map;
}, {});
const ITEM_HISTORY_PROJECTION = Object.freeze({
  id: 1,
  orgId: 1,
  userId: 1,
  questionVersionId: 1,
  skill: 1,
  questionType: 1,
  attemptType: 1,
  status: 1,
  percentage: 1,
  maxScore: 1,
  scoreFinal: 1,
  timeSpentSeconds: 1,
  selfDifficultyRating: 1,
  finishedAt: 1,
  submittedAt: 1,
  startedAt: 1,
  selfDifficultyRatedAt: 1,
  audit: 1
});

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function cleanNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return Number(fallback || 0);
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(6)) : Number(fallback || 0);
}

function cleanInteger(value, fallback = 0, { min = null, max = null } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  let out = Number.isFinite(parsed) && !Number.isNaN(parsed) ? parsed : Number(fallback || 0);
  if (Number.isFinite(min)) out = Math.max(min, out);
  if (Number.isFinite(max)) out = Math.min(max, out);
  return out;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const token = cleanText(value, 20).toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function normalizeSkill(value) {
  const token = cleanText(value, 40).toLowerCase();
  return SKILL_ORDER.includes(token) ? token : '';
}

function normalizeQuestionType(value) {
  return cleanText(value, 140).toLowerCase();
}

function normalizeDifficulty(value) {
  const token = cleanText(value, 40).toLowerCase().replace(/\s+/g, '_');
  if (token === 'very_hard' || token === 'very-hard') return 'very_hard';
  if (token === 'hard') return 'hard';
  if (token === 'easy') return 'easy';
  return 'medium';
}

function normalizeSelfDifficulty(value) {
  const token = cleanText(value, 40).toLowerCase().replace(/\s+/g, '_');
  return Object.prototype.hasOwnProperty.call(SELF_DIFFICULTY_WEIGHTS, token) ? token : '';
}

function normalizePriorityMode(value) {
  const token = cleanText(value, 60).toLowerCase();
  return token || 'balanced_gaps';
}

function round2(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : 0;
}

function getActiveOrgId(user = {}) {
  return toPublicId(user?.activeOrgId || user?.primaryOrgId || '');
}

function getUserId(user = {}) {
  return toPublicId(user?.id || '');
}

function makeGroupKey(skill, questionType) {
  return `${normalizeSkill(skill)}::${normalizeQuestionType(questionType)}`;
}

function splitGroupKey(key = '') {
  const [skill, questionType] = String(key || '').split('::');
  return {
    skill: normalizeSkill(skill),
    questionType: normalizeQuestionType(questionType)
  };
}

function formatQuestionTypeLabel(value = '') {
  return normalizeQuestionType(value)
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatSkillLabel(value = '') {
  const token = normalizeSkill(value);
  return token ? token.charAt(0).toUpperCase() + token.slice(1) : '';
}

function parseTimestamp(row = {}) {
  const raw = cleanText(row.finishedAt || row.submittedAt || row.startedAt || row.selfDifficultyRatedAt, 80);
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

function isFinalAttemptItem(row = {}) {
  return FINAL_ITEM_STATUSES.has(cleanText(row.status, 40).toLowerCase());
}

function hasUsableScore(row = {}) {
  if (!isFinalAttemptItem(row)) return false;
  if (row.percentage !== undefined && row.percentage !== null && row.percentage !== '') return true;
  return cleanNumber(row.maxScore, 0) > 0 || cleanNumber(row.scoreFinal, 0) > 0;
}

function parseScoreToPercent(row = {}) {
  if (row.percentage !== undefined && row.percentage !== null && row.percentage !== '') {
    const percentage = Number(row.percentage);
    if (Number.isFinite(percentage)) return Math.max(0, Math.min(100, percentage));
  }
  if (row.scoreFinal !== undefined && row.scoreFinal !== null && row.scoreFinal !== ''
    && row.maxScore !== undefined && row.maxScore !== null && row.maxScore !== '') {
    const scoreFinal = Number(row.scoreFinal);
    const maxScore = Number(row.maxScore);
    if (Number.isFinite(scoreFinal) && Number.isFinite(maxScore) && maxScore > 0) {
      return Math.max(0, Math.min(100, (scoreFinal / maxScore) * 100));
    }
  }
  return null;
}

function normalizeScoreToNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeAttemptItems(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      id: cleanText(row?.id, 120),
      questionVersionId: cleanText(row?.questionVersionId, 120),
      skill: normalizeSkill(row?.skill),
      questionType: normalizeQuestionType(row?.questionType),
      status: cleanText(row?.status, 40).toLowerCase(),
      percentage: cleanNumber(row?.percentage, 0),
      maxScore: cleanNumber(row?.maxScore, 0),
      scoreFinal: cleanNumber(row?.scoreFinal, 0),
      timeSpentSeconds: cleanInteger(row?.timeSpentSeconds, 0, { min: 0 }),
      selfDifficultyRating: normalizeSelfDifficulty(row?.selfDifficultyRating),
      score: parseScoreToPercent(row),
      occurredAtMs: parseTimestamp(row)
    }))
    .filter((row) => row.skill && row.questionType)
    .sort((a, b) => b.occurredAtMs - a.occurredAtMs || b.id.localeCompare(a.id));
}

function normalizeHistoryQuestion(row = {}) {
  const id = cleanText(row?.questionVersionId, 120);
  if (!id) return null;
  const score = parseScoreToPercent(row);
  return {
    id,
    questionVersionId: id,
    skill: normalizeSkill(row?.skill),
    questionType: normalizeQuestionType(row?.questionType),
    attemptsCount: 1,
    lastScore: Number.isFinite(score) ? score : null,
    avgScore: Number.isFinite(score) ? score : null,
    bestScore: Number.isFinite(score) ? score : null,
    lastAttemptAt: cleanNumber(row?.occurredAtMs, 0),
    scoreCount: Number.isFinite(score) ? 1 : 0,
    scoreSum: Number.isFinite(score) ? score : 0
  };
}

function buildQuestionHistoryStats(attemptRows = []) {
  const map = new Map();

  (Array.isArray(attemptRows) ? attemptRows : []).forEach((row) => {
    if (!row?.questionVersionId) return;
    const key = cleanText(row.questionVersionId, 120);
    const item = map.get(key) || {
      questionVersionId: key,
      attemptsCount: 0,
      scoreCount: 0,
      scoreSum: 0,
      bestScore: null,
      avgScore: null,
      lastScore: null,
      lastAttemptAt: 0
    };
    item.attemptsCount += 1;
    if (Number.isFinite(row.score)) {
      item.scoreCount += 1;
      item.scoreSum += row.score;
      item.bestScore = item.bestScore === null ? row.score : Math.max(item.bestScore, row.score);
      if (item.lastScore === null || (row.occurredAtMs || 0) > (item.lastAttemptAt || 0)) {
        item.lastScore = row.score;
      }
    }
    if ((row.occurredAtMs || 0) > (item.lastAttemptAt || 0)) {
      item.lastAttemptAt = row.occurredAtMs || 0;
    }
    map.set(key, item);
  });

  map.forEach((item) => {
    item.avgScore = item.scoreCount > 0 ? item.scoreSum / item.scoreCount : null;
    item.scoreSum = Number(item.scoreSum || 0);
    item.lastAttemptAt = Number(item.lastAttemptAt || 0);
  });

  return map;
}

function buildContextHistoryMap(attemptItems = []) {
  const map = new Map();
  (Array.isArray(attemptItems) ? attemptItems : []).forEach((item) => {
    if (!item?.questionVersionId) return;
    if (!item.skill || !item.questionType) return;
    const key = makeGroupKey(item.skill, item.questionType);
    if (!map.has(key)) map.set(key, new Map());
    const target = map.get(key);
    const row = normalizeHistoryQuestion(item);
    if (!row) return;
    const existing = target.get(row.questionVersionId);
    if (!existing) {
      target.set(row.questionVersionId, row);
      return;
    }

    existing.attemptsCount += row.attemptsCount;
    existing.scoreCount += row.scoreCount;
    existing.scoreSum += row.scoreSum;
    existing.bestScore = existing.bestScore === null
      ? row.bestScore
      : (row.bestScore === null ? existing.bestScore : Math.max(existing.bestScore, row.bestScore));
    if (row.lastScore !== null && (row.lastAttemptAt || 0) >= (existing.lastAttemptAt || 0)) {
      existing.lastScore = row.lastScore;
      existing.lastAttemptAt = row.lastAttemptAt;
    }
    existing.avgScore = existing.scoreCount > 0 ? existing.scoreSum / existing.scoreCount : null;
  });
  return map;
}

function safeDifficultyRank(value = '') {
  const token = normalizeDifficulty(value);
  return Object.prototype.hasOwnProperty.call(PRACTICE_BY_SKILL_DIFFICULTY_INDEX, token)
    ? PRACTICE_BY_SKILL_DIFFICULTY_INDEX[token]
    : PRACTICE_BY_SKILL_DIFFICULTY_ORDER.length;
}

function scoreWeaknessFromStats(stat = {}) {
  const avgScore = normalizeScoreToNumber(stat.avgScore, null);
  const lastScore = normalizeScoreToNumber(stat.lastScore, null);
  if (Number.isFinite(avgScore)) return Math.max(0, 100 - avgScore);
  if (Number.isFinite(lastScore)) return Math.max(0, 100 - lastScore);
  return null;
}

function comparePracticeBySkillSeenOrder(a = {}, b = {}, statById = new Map()) {
  const aStat = statById.get(a?.id) || {};
  const bStat = statById.get(b?.id) || {};
  const aAttempts = cleanInteger(aStat.attemptsCount, Number.MAX_SAFE_INTEGER, { min: 0 });
  const bAttempts = cleanInteger(bStat.attemptsCount, Number.MAX_SAFE_INTEGER, { min: 0 });
  const aWeak = scoreWeaknessFromStats(aStat);
  const bWeak = scoreWeaknessFromStats(bStat);
  const difficultyRankDiff = safeDifficultyRank(a.difficulty) - safeDifficultyRank(b.difficulty);
  if (difficultyRankDiff !== 0) return difficultyRankDiff;

  const aHasWeakness = Number.isFinite(aWeak);
  const bHasWeakness = Number.isFinite(bWeak);
  if (aHasWeakness && bHasWeakness && aWeak !== bWeak) return bWeak - aWeak;
  if (aHasWeakness !== bHasWeakness) return aHasWeakness ? -1 : 1;

  if (aHasWeakness && bHasWeakness) {
    return Number(aAttempts) - Number(bAttempts)
      || cleanNumber(aStat.lastAttemptAt, Number.MAX_SAFE_INTEGER) - cleanNumber(bStat.lastAttemptAt, Number.MAX_SAFE_INTEGER);
  }

  return cleanInteger(aStat.lastAttemptAt, Number.MAX_SAFE_INTEGER) - cleanInteger(bStat.lastAttemptAt, Number.MAX_SAFE_INTEGER)
    || Number(aAttempts) - Number(bAttempts);
}

function comparePracticeBySkillRepeatOrder(a = {}, b = {}, statById = new Map(), repeatCounts = new Map()) {
  const aStat = statById.get(a?.id) || {};
  const bStat = statById.get(b?.id) || {};
  const aAttempts = cleanInteger(aStat.attemptsCount, 0, { min: 0 });
  const bAttempts = cleanInteger(bStat.attemptsCount, 0, { min: 0 });
  const aRepeats = cleanInteger(repeatCounts.get(a?.id), 0, { min: 0 });
  const bRepeats = cleanInteger(repeatCounts.get(b?.id), 0, { min: 0 });

  const aWeak = scoreWeaknessFromStats(aStat);
  const bWeak = scoreWeaknessFromStats(bStat);
  const aWeakKnown = Number.isFinite(aWeak);
  const bWeakKnown = Number.isFinite(bWeak);
  const difficultyRankDiff = safeDifficultyRank(a.difficulty) - safeDifficultyRank(b.difficulty);
  if (aRepeats !== bRepeats) return aRepeats - bRepeats;
  if (difficultyRankDiff !== 0) return difficultyRankDiff;
  if (aWeakKnown && bWeakKnown && aWeak !== bWeak) return bWeak - aWeak;
  if (aWeakKnown !== bWeakKnown) return aWeakKnown ? -1 : 1;
  return aAttempts - bAttempts
    || cleanNumber(aStat.lastAttemptAt, Number.MAX_SAFE_INTEGER) - cleanNumber(bStat.lastAttemptAt, Number.MAX_SAFE_INTEGER)
    || String(a.id || '').localeCompare(String(b.id || ''));
}

function normalizePracticeBySkillRequestedPlan(runtimePlan = {}, fallbackQuestionCount = DEFAULT_TARGET_QUESTION_COUNT) {
  const rawPlans = normalizeRequestedSkillPlans(runtimePlan.skillPlans || []);
  if (rawPlans.length) return rawPlans;

  const skill = normalizeSkill(runtimePlan.skill);
  const planQuestionTypes = Array.isArray(runtimePlan.questionTypes)
    ? runtimePlan.questionTypes.map((row) => normalizeQuestionType(row)).filter(Boolean)
    : [];
  if (!skill || !planQuestionTypes.length) return [];

  let remaining = cleanInteger(runtimePlan.questionCount, fallbackQuestionCount, { min: 1, max: MAX_TARGET_QUESTION_COUNT });
  const typePlans = [];
  planQuestionTypes.forEach((questionType, index) => {
    if (remaining <= 0) return;
    const slotsRemaining = Math.max(1, planQuestionTypes.length - index);
    const count = Math.min(remaining, Math.max(1, Math.ceil(remaining / slotsRemaining)));
    remaining -= count;
    typePlans.push({
      questionType,
      questionCount: count
    });
  });
  return [{
    skill,
    typePlans
  }];
}

function buildRequestedContextPools(questionRows = [], requestedPlans = []) {
  const requestedMap = new Map(normalizeRequestedSkillPlans(requestedPlans).map((skillPlan) => {
    const planTypeCount = new Map();
    (Array.isArray(skillPlan.typePlans) ? skillPlan.typePlans : []).forEach((typePlan) => {
      planTypeCount.set(typePlan.questionType, cleanInteger(typePlan.questionCount, 0, { min: 0 }));
    });
    return [skillPlan.skill, planTypeCount];
  }));
  const byContext = new Map();

  (Array.isArray(questionRows) ? questionRows : []).forEach((question) => {
    const skill = normalizeSkill(question?.skill);
    const questionType = normalizeQuestionType(question?.questionType);
    const typeCountMap = requestedMap.get(skill);
    if (!typeCountMap || !typeCountMap.has(questionType)) return;
    const key = makeGroupKey(skill, questionType);
    if (!byContext.has(key)) {
      byContext.set(key, {
        skill,
        questionType,
        requestedCount: typeCountMap.get(questionType),
        questions: []
      });
    }
    const bucket = byContext.get(key);
    bucket.questions.push(question);
  });

  byContext.forEach((bucket) => {
    bucket.questions = bucket.questions.filter((question) => question?.id);
  });

  return byContext;
}

function buildContextPlanDiagnostics({
  key,
  skill,
  questionType,
  requestedCount,
  poolSize,
  seenCount,
  unseenCount,
  unseenUsed,
  seenFallbackUsed,
  repeatedCount
}) {
  return {
    key,
    skill,
    questionType,
    requestedCount,
    poolSize,
    seenCount,
    unseenCount,
    unseenUsed,
    seenFallbackUsed,
    repeatedCount
  };
}

function buildPracticeBySkillSelectionFromContext({
  key = '',
  requestedCount = 0,
  pool = [],
  statById = new Map(),
  selectedQuestionIds = [],
  seenQuestionIds = new Set()
}) {
  const selection = [];
  const usedInSession = new Set(selectedQuestionIds || []);
  const requested = Math.max(0, Math.min(requestedCount, MAX_TARGET_QUESTION_COUNT));
  if (!requested || !Array.isArray(pool) || !pool.length) {
    return {
      selection: [],
      unseenUsed: 0,
      seenFallbackUsed: 0,
      repeatedUsed: 0
    };
  }

  const unseen = [];
  const seen = [];
  const poolRows = pool.slice();

  poolRows.forEach((question) => {
    if (!question?.id) return;
    const isSeen = seenQuestionIds.has(question.id);
    if (isSeen) seen.push(question);
    else unseen.push(question);
  });

  const unseenShuffled = shuffleInPlace(unseen.slice());
  const selectedFromUnseen = unseenShuffled
    .filter((question) => !usedInSession.has(question.id))
    .slice(0, requested);
  selectedFromUnseen.forEach((question) => {
    usedInSession.add(question.id);
    selection.push(question);
  });

  let unseenUsed = selectedFromUnseen.length;
  if (selection.length >= requested) {
    return {
      selection,
      unseenUsed,
      seenFallbackUsed: 0,
      repeatedUsed: 0
    };
  }

  const seenOrdered = seen
    .filter((question) => !usedInSession.has(question.id))
    .slice()
    .sort((a, b) => comparePracticeBySkillSeenOrder(a, b, statById));
  const needFromSeen = requested - selection.length;
  const seenTake = seenOrdered.slice(0, needFromSeen);
  seenTake.forEach((question) => {
    usedInSession.add(question.id);
    selection.push(question);
  });
  const seenFallbackUsed = seenTake.length;

  if (selection.length >= requested || !poolRows.length) {
    return {
      selection,
      unseenUsed,
      seenFallbackUsed,
      repeatedUsed: 0
    };
  }

  return {
    selection,
    unseenUsed,
    seenFallbackUsed,
    repeatedUsed: 0
  };
}

function buildPracticeBySkillPlan(selectedQuestions = [], metadata = {}) {
  return {
    skillPlans: Array.isArray(metadata.skillPlans) ? metadata.skillPlans : [],
    selectedQuestionCount: selectedQuestions.length,
    selectionSource: metadata.selectionSource || 'unseen-first',
    unseenUsed: cleanInteger(metadata.unseenUsed, 0, { min: 0 }),
    seenFallbackUsed: cleanInteger(metadata.seenFallbackUsed, 0, { min: 0 }),
    repeatedUsed: cleanInteger(metadata.repeatedUsed, 0, { min: 0 }),
    selectionPlanVersion: PRACTICE_BY_SKILL_PLAN_VERSION,
    requestedQuestionCount: cleanInteger(metadata.requestedQuestionCount, selectedQuestions.length, { min: 0, max: MAX_TARGET_QUESTION_COUNT }),
    contextPlans: Array.isArray(metadata.contextPlans) ? metadata.contextPlans : [],
    history: metadata.history || {},
    poolQuestionCount: cleanInteger(metadata.poolQuestionCount, selectedQuestions.length, { min: 0 })
  };
}

function shuffleInPlace(rows = []) {
  const out = Array.isArray(rows) ? rows.slice() : [];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const randomIndex = Math.floor(Math.random() * (i + 1));
    const tmp = out[i];
    out[i] = out[randomIndex];
    out[randomIndex] = tmp;
  }
  return out;
}

function normalizeQuestionRows(rows = [], orgId = '') {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => String(row?.status || '').toLowerCase() === 'published')
    .filter((row) => row?.practiceEnabled !== false)
    .filter((row) => !orgId || idsEqual(row?.orgId, orgId))
    .map((row) => ({
      id: cleanText(row?.id, 120),
      orgId: toPublicId(row?.orgId || ''),
      skill: normalizeSkill(row?.skill),
      questionType: normalizeQuestionType(row?.questionType),
      difficulty: normalizeDifficulty(row?.difficulty),
      title: cleanText(row?.title, 260),
      code: cleanText(row?.code, 120)
    }))
    .filter((row) => row.id && row.skill && row.questionType);
}

function buildRecentAttemptMap(items = []) {
  const map = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    if (!item.questionVersionId) return;
    const previous = map.get(item.questionVersionId) || 0;
    map.set(item.questionVersionId, Math.max(previous, item.occurredAtMs || 0));
  });
  return map;
}

function buildPerformanceGroups(items = []) {
  const map = new Map();
  const scoredTimes = [];

  (Array.isArray(items) ? items : []).forEach((item, index) => {
    const key = makeGroupKey(item.skill, item.questionType);
    if (!key.includes('::')) return;
    if (!map.has(key)) {
      const parts = splitGroupKey(key);
      map.set(key, {
        key,
        skill: parts.skill,
        questionType: parts.questionType,
        totalAttempts: 0,
        scoredCount: 0,
        percentageTotal: 0,
        recentPercentages: [],
        timeTotal: 0,
        timedCount: 0,
        difficultyCounts: {
          very_easy: 0,
          easy: 0,
          medium: 0,
          hard: 0,
          very_hard: 0
        },
        latestIndex: index
      });
    }

    const bucket = map.get(key);
    bucket.totalAttempts += 1;
    bucket.latestIndex = Math.min(bucket.latestIndex, index);
    if (item.selfDifficultyRating) bucket.difficultyCounts[item.selfDifficultyRating] += 1;
    if (hasUsableScore(item)) {
      bucket.scoredCount += 1;
      bucket.percentageTotal += item.percentage;
      if (bucket.recentPercentages.length < 5) bucket.recentPercentages.push(item.percentage);
      if (item.timeSpentSeconds > 0) {
        bucket.timeTotal += item.timeSpentSeconds;
        bucket.timedCount += 1;
        scoredTimes.push(item.timeSpentSeconds);
      }
    }
  });

  const globalAverageTimeSeconds = scoredTimes.length
    ? scoredTimes.reduce((sum, value) => sum + value, 0) / scoredTimes.length
    : 0;

  const groups = Array.from(map.values()).map((bucket) => {
    const averagePercentage = bucket.scoredCount
      ? bucket.percentageTotal / bucket.scoredCount
      : null;
    const recentAveragePercentage = bucket.recentPercentages.length
      ? bucket.recentPercentages.reduce((sum, value) => sum + value, 0) / bucket.recentPercentages.length
      : averagePercentage;
    const averageTimeSeconds = bucket.timedCount
      ? bucket.timeTotal / bucket.timedCount
      : 0;
    const hardRatingCount = bucket.difficultyCounts.hard + bucket.difficultyCounts.very_hard;
    const ratingCount = Object.values(bucket.difficultyCounts).reduce((sum, value) => sum + value, 0);

    return {
      ...bucket,
      averagePercentage,
      recentAveragePercentage,
      averageTimeSeconds,
      hardRatingCount,
      ratingCount,
      globalAverageTimeSeconds
    };
  });

  return {
    groups,
    globalAverageTimeSeconds
  };
}

function buildPoolGroups(questionRows = []) {
  const map = new Map();
  (Array.isArray(questionRows) ? questionRows : []).forEach((question) => {
    const key = makeGroupKey(question.skill, question.questionType);
    if (!map.has(key)) {
      const parts = splitGroupKey(key);
      map.set(key, {
        key,
        skill: parts.skill,
        questionType: parts.questionType,
        questions: [],
        difficultyCounts: {
          easy: 0,
          medium: 0,
          hard: 0,
          very_hard: 0
        }
      });
    }
    const bucket = map.get(key);
    bucket.questions.push(question);
    bucket.difficultyCounts[question.difficulty] += 1;
  });
  return map;
}

function calculateNeedScore(input = {}) {
  const scoreCount = cleanInteger(input.scoredCount, 0, { min: 0 });
  const averagePercentage = input.averagePercentage === null || input.averagePercentage === undefined
    ? null
    : cleanNumber(input.averagePercentage, 0);
  const recentAveragePercentage = input.recentAveragePercentage === null || input.recentAveragePercentage === undefined
    ? averagePercentage
    : cleanNumber(input.recentAveragePercentage, averagePercentage || 0);
  const hardRatingCount = cleanInteger(input.hardRatingCount, 0, { min: 0 });
  const ratingCount = cleanInteger(input.ratingCount, 0, { min: 0 });
  const averageTimeSeconds = cleanNumber(input.averageTimeSeconds, 0);
  const globalAverageTimeSeconds = cleanNumber(input.globalAverageTimeSeconds, 0);
  const poolDifficultyCounts = input.poolDifficultyCounts || {};

  let score = scoreCount > 0 ? Math.max(0, 100 - averagePercentage) * 0.48 : 12;
  if (scoreCount > 0 && recentAveragePercentage !== null) {
    score += Math.max(0, 72 - recentAveragePercentage) * 0.22;
  }
  if (ratingCount > 0) {
    const hardRatio = Math.min(1, hardRatingCount / Math.max(1, ratingCount));
    score += hardRatio * 28;
  }
  if (
    scoreCount > 0
    && averagePercentage !== null
    && averagePercentage < 70
    && globalAverageTimeSeconds > 0
    && averageTimeSeconds > globalAverageTimeSeconds * 1.15
  ) {
    score += 8;
  }
  if (cleanInteger(poolDifficultyCounts.hard, 0, { min: 0 }) > 0) score += 2.5;
  if (cleanInteger(poolDifficultyCounts.very_hard, 0, { min: 0 }) > 0) score += 3.5;
  return round2(Math.max(0, score));
}

function resolveTargetDifficulty(stats = {}, pool = {}) {
  const avg = stats.averagePercentage;
  const recent = stats.recentAveragePercentage;
  const hardRatio = stats.ratingCount ? stats.hardRatingCount / Math.max(1, stats.ratingCount) : 0;
  const hasHard = cleanInteger(pool?.difficultyCounts?.hard, 0, { min: 0 }) > 0;
  const hasVeryHard = cleanInteger(pool?.difficultyCounts?.very_hard, 0, { min: 0 }) > 0;

  if ((avg !== null && avg < 50) || (recent !== null && recent < 50)) {
    return hasHard ? ['medium', 'hard', 'easy'] : ['medium', 'easy'];
  }
  if ((avg !== null && avg < 70) || hardRatio >= 0.35) {
    return hasHard ? ['medium', 'hard', 'easy'] : ['medium', 'easy'];
  }
  if (hardRatio >= 0.5 || hasVeryHard) {
    return hasVeryHard ? ['hard', 'very_hard', 'medium'] : ['hard', 'medium'];
  }
  return hasHard ? ['medium', 'hard', 'easy'] : ['medium', 'easy'];
}

function buildReason(stats = {}, group = {}, needScore = 0) {
  const typeLabel = formatQuestionTypeLabel(group.questionType);
  const parts = [];
  if (stats.scoredCount > 0 && stats.averagePercentage !== null) {
    parts.push(`${round2(stats.averagePercentage)}% average`);
  }
  if (stats.recentAveragePercentage !== null && stats.scoredCount > 1) {
    parts.push(`${round2(stats.recentAveragePercentage)}% recent`);
  }
  if (stats.hardRatingCount > 0) {
    parts.push(`${stats.hardRatingCount} hard self-rating${stats.hardRatingCount === 1 ? '' : 's'}`);
  }
  if (!parts.length) parts.push('new or lightly practiced area');
  return `${typeLabel || 'This type'} is recommended from ${parts.join(', ')}. Need score ${round2(needScore)}.`;
}

function rankGroups({
  performanceGroups = [],
  poolGroups = new Map(),
  priorityMode = 'balanced_gaps'
} = {}) {
  const performanceMap = new Map((Array.isArray(performanceGroups) ? performanceGroups : []).map((row) => [row.key, row]));
  const rows = [];

  poolGroups.forEach((pool, key) => {
    const stats = performanceMap.get(key) || {
      key,
      skill: pool.skill,
      questionType: pool.questionType,
      totalAttempts: 0,
      scoredCount: 0,
      averagePercentage: null,
      recentAveragePercentage: null,
      averageTimeSeconds: 0,
      hardRatingCount: 0,
      ratingCount: 0,
      globalAverageTimeSeconds: 0
    };
    let needScore = calculateNeedScore({
      ...stats,
      poolDifficultyCounts: pool.difficultyCounts
    });
    if (priorityMode === 'weakest_scores' && stats.scoredCount > 0 && stats.averagePercentage !== null) {
      needScore += Math.max(0, 75 - stats.averagePercentage) * 0.2;
    }
    if (priorityMode === 'hard_ratings') {
      needScore += stats.hardRatingCount * 5;
    }
    const targetDifficultyOrder = resolveTargetDifficulty(stats, pool);
    rows.push({
      key,
      skill: pool.skill,
      questionType: pool.questionType,
      poolQuestionCount: pool.questions.length,
      poolDifficultyCounts: { ...pool.difficultyCounts },
      score: round2(needScore),
      scoredCount: stats.scoredCount || 0,
      totalAttempts: stats.totalAttempts || 0,
      averagePercentage: stats.averagePercentage === null ? null : round2(stats.averagePercentage),
      recentAveragePercentage: stats.recentAveragePercentage === null ? null : round2(stats.recentAveragePercentage),
      hardRatingCount: stats.hardRatingCount || 0,
      ratingCount: stats.ratingCount || 0,
      targetDifficultyOrder,
      targetDifficulty: targetDifficultyOrder[0] || 'medium',
      reason: buildReason(stats, pool, needScore),
      hasEvidence: (stats.scoredCount || 0) > 0 || (stats.ratingCount || 0) > 0
    });
  });

  return rows.sort((a, b) => (
    b.score - a.score
    || Number(b.hasEvidence) - Number(a.hasEvidence)
    || SKILL_ORDER.indexOf(a.skill) - SKILL_ORDER.indexOf(b.skill)
    || a.questionType.localeCompare(b.questionType)
  ));
}

function normalizeTargetQuestionCount(value, fallback = DEFAULT_TARGET_QUESTION_COUNT) {
  return cleanInteger(value, fallback, { min: 1, max: MAX_TARGET_QUESTION_COUNT });
}

function normalizeRequestedSkillPlans(value = []) {
  const inputRows = Array.isArray(value) ? value : [];
  const map = new Map();
  inputRows.forEach((skillPlan) => {
    const skill = normalizeSkill(skillPlan?.skill);
    if (!skill) return;
    if (!map.has(skill)) map.set(skill, new Map());
    const typeMap = map.get(skill);
    const typeRows = Array.isArray(skillPlan?.typePlans) ? skillPlan.typePlans : [];
    typeRows.forEach((typePlan) => {
      const questionType = normalizeQuestionType(typePlan?.questionType || typePlan?.type);
      if (!questionType) return;
      const count = cleanInteger(typePlan?.questionCount ?? typePlan?.count, 1, { min: 0, max: MAX_TARGET_QUESTION_COUNT });
      if (count <= 0) return;
      typeMap.set(questionType, (typeMap.get(questionType) || 0) + count);
    });
  });

  const plans = [];
  let total = 0;
  map.forEach((typeMap, skill) => {
    const typePlans = Array.from(typeMap.entries()).map(([questionType, questionCount]) => {
      const capped = Math.min(questionCount, Math.max(0, MAX_TARGET_QUESTION_COUNT - total));
      total += capped;
      return {
        questionType,
        questionCount: capped
      };
    }).filter((row) => row.questionCount > 0);
    if (typePlans.length) plans.push({ skill, typePlans });
  });
  return plans;
}

function distributeCounts(groups = [], targetQuestionCount = DEFAULT_TARGET_QUESTION_COUNT) {
  const target = normalizeTargetQuestionCount(targetQuestionCount);
  const out = new Map();
  const source = (Array.isArray(groups) ? groups : []).filter((group) => group.poolQuestionCount > 0);
  let remaining = target;

  for (const group of source) {
    if (remaining <= 0) break;
    out.set(group.key, 1);
    remaining -= 1;
  }

  while (remaining > 0) {
    let changed = false;
    for (const group of source) {
      if (remaining <= 0) break;
      const current = out.get(group.key) || 0;
      if (current >= group.poolQuestionCount) continue;
      out.set(group.key, current + 1);
      remaining -= 1;
      changed = true;
    }
    if (!changed) break;
  }

  return out;
}

function buildPlansFromRankedGroups(rankedGroups = [], targetQuestionCount = DEFAULT_TARGET_QUESTION_COUNT, options = {}) {
  const target = normalizeTargetQuestionCount(targetQuestionCount);
  const includeMaintenance = options.includeMaintenance !== false;
  const evidenceGroups = rankedGroups.filter((row) => row.hasEvidence);
  const noHistory = evidenceGroups.length === 0;
  const maintenanceGroups = includeMaintenance && !noHistory && target >= 8
    ? rankedGroups
      .filter((row) => row.scoredCount >= 2 && row.averagePercentage !== null && row.averagePercentage >= 75)
      .sort((a, b) => b.averagePercentage - a.averagePercentage || a.score - b.score)
      .slice(0, 2)
    : [];
  const maintenanceKeys = new Set(maintenanceGroups.map((row) => row.key));
  const focusTarget = Math.max(1, target - maintenanceGroups.length);
  const focusGroups = rankedGroups.filter((row) => !maintenanceKeys.has(row.key));
  const counts = distributeCounts(focusGroups, focusTarget);

  maintenanceGroups.forEach((group) => {
    if (!counts.has(group.key)) counts.set(group.key, 1);
  });

  const bySkill = new Map();
  rankedGroups.forEach((group) => {
    const count = counts.get(group.key) || 0;
    if (count <= 0) return;
    if (!bySkill.has(group.skill)) bySkill.set(group.skill, []);
    bySkill.get(group.skill).push({
      questionType: group.questionType,
      questionCount: count,
      targetDifficulty: DIFFICULTY_LABELS[group.targetDifficulty] || group.targetDifficulty,
      targetDifficultyKey: group.targetDifficulty,
      targetDifficultyOrder: group.targetDifficultyOrder,
      reason: maintenanceKeys.has(group.key)
        ? `Maintenance item: ${group.reason}`
        : group.reason,
      evidence: {
        needScore: group.score,
        averagePercentage: group.averagePercentage,
        recentAveragePercentage: group.recentAveragePercentage,
        hardRatingCount: group.hardRatingCount,
        scoredCount: group.scoredCount,
        poolQuestionCount: group.poolQuestionCount
      }
    });
  });

  return SKILL_ORDER
    .filter((skill) => bySkill.has(skill))
    .map((skill) => ({
      skill,
      typePlans: bySkill.get(skill)
    }));
}

function buildPlansFromRequested(rankedGroups = [], requestedSkillPlans = []) {
  const rankedByKey = new Map((Array.isArray(rankedGroups) ? rankedGroups : []).map((row) => [row.key, row]));
  const normalized = normalizeRequestedSkillPlans(requestedSkillPlans);
  return normalized.map((skillPlan) => ({
    skill: skillPlan.skill,
    typePlans: skillPlan.typePlans.map((typePlan) => {
      const key = makeGroupKey(skillPlan.skill, typePlan.questionType);
      const group = rankedByKey.get(key) || {
        skill: skillPlan.skill,
        questionType: typePlan.questionType,
        targetDifficulty: 'medium',
        targetDifficultyOrder: ['medium', 'hard', 'easy'],
        reason: `${formatQuestionTypeLabel(typePlan.questionType)} was selected by the reviewer.`,
        score: 0,
        averagePercentage: null,
        recentAveragePercentage: null,
        hardRatingCount: 0,
        scoredCount: 0,
        poolQuestionCount: 0
      };
      return {
        questionType: typePlan.questionType,
        questionCount: typePlan.questionCount,
        targetDifficulty: DIFFICULTY_LABELS[group.targetDifficulty] || group.targetDifficulty,
        targetDifficultyKey: group.targetDifficulty,
        targetDifficultyOrder: group.targetDifficultyOrder,
        reason: group.reason,
        evidence: {
          needScore: group.score,
          averagePercentage: group.averagePercentage,
          recentAveragePercentage: group.recentAveragePercentage,
          hardRatingCount: group.hardRatingCount,
          scoredCount: group.scoredCount,
          poolQuestionCount: group.poolQuestionCount
        }
      };
    })
  }));
}

function difficultyPreferenceIndex(difficulty, order = []) {
  const token = normalizeDifficulty(difficulty);
  const preferred = Array.isArray(order) ? order.map(normalizeDifficulty) : [];
  const index = preferred.indexOf(token);
  if (index >= 0) return index;
  const fallback = DIFFICULTY_ORDER.indexOf(token);
  return fallback >= 0 ? fallback + preferred.length : preferred.length + 99;
}

function selectQuestionsForPlans({ skillPlans = [], poolGroups = new Map(), recentAttemptMap = new Map() } = {}) {
  const selected = [];
  const used = new Set();

  (Array.isArray(skillPlans) ? skillPlans : []).forEach((skillPlan) => {
    (Array.isArray(skillPlan.typePlans) ? skillPlan.typePlans : []).forEach((typePlan) => {
      const key = makeGroupKey(skillPlan.skill, typePlan.questionType);
      const group = poolGroups.get(key);
      const count = cleanInteger(typePlan.questionCount, 0, { min: 0, max: MAX_TARGET_QUESTION_COUNT });
      if (!group || count <= 0) return;

      const ordered = group.questions
        .filter((question) => !used.has(question.id))
        .slice()
        .sort((a, b) => {
          const aRecent = recentAttemptMap.has(a.id) ? 1 : 0;
          const bRecent = recentAttemptMap.has(b.id) ? 1 : 0;
          return aRecent - bRecent
            || difficultyPreferenceIndex(a.difficulty, typePlan.targetDifficultyOrder) - difficultyPreferenceIndex(b.difficulty, typePlan.targetDifficultyOrder)
            || String(a.title || '').localeCompare(String(b.title || ''))
            || a.id.localeCompare(b.id);
        });

      ordered.slice(0, count).forEach((question) => {
        used.add(question.id);
        selected.push({
          questionVersionId: question.id,
          skill: question.skill,
          questionType: question.questionType,
          difficulty: question.difficulty,
          title: question.title,
          code: question.code,
          reason: typePlan.reason
        });
      });
    });
  });

  return selected.slice(0, MAX_TARGET_QUESTION_COUNT);
}

function reconcilePlansWithSelected(skillPlans = [], selectedQuestions = []) {
  const selectedCounts = new Map();
  (Array.isArray(selectedQuestions) ? selectedQuestions : []).forEach((question) => {
    const key = makeGroupKey(question.skill, question.questionType);
    selectedCounts.set(key, (selectedCounts.get(key) || 0) + 1);
  });

  return (Array.isArray(skillPlans) ? skillPlans : []).map((skillPlan) => ({
    skill: skillPlan.skill,
    typePlans: (Array.isArray(skillPlan.typePlans) ? skillPlan.typePlans : [])
      .map((typePlan) => {
        const key = makeGroupKey(skillPlan.skill, typePlan.questionType);
        return {
          ...typePlan,
          questionCount: selectedCounts.get(key) || 0
        };
      })
      .filter((typePlan) => typePlan.questionCount > 0)
  })).filter((skillPlan) => skillPlan.typePlans.length > 0);
}

function buildSummary({ rankedGroups = [], selectedQuestions = [], noHistory = false } = {}) {
  const weakGroups = rankedGroups
    .filter((row) => row.hasEvidence)
    .slice(0, 5);
  const weakSkills = Array.from(new Set(weakGroups.map((row) => row.skill)))
    .map((skill) => ({
      skill,
      label: formatSkillLabel(skill)
    }));
  const weakQuestionTypes = weakGroups.map((row) => ({
    skill: row.skill,
    questionType: row.questionType,
    label: formatQuestionTypeLabel(row.questionType),
    needScore: row.score,
    averagePercentage: row.averagePercentage,
    hardRatingCount: row.hardRatingCount
  }));
  const byDifficulty = selectedQuestions.reduce((map, row) => {
    const key = normalizeDifficulty(row.difficulty);
    map[key] = (map[key] || 0) + 1;
    return map;
  }, {});

  return {
    recommendedName: buildSuggestedPracticeName(),
    noHistory,
    headline: noHistory
      ? 'Balanced starter practice from available question types.'
      : 'Focused practice based on recent scores and self-rated difficulty.',
    selectedQuestionCount: selectedQuestions.length,
    weakSkills,
    weakQuestionTypes,
    difficultyMix: byDifficulty
  };
}

function buildSuggestedPracticeName(now = new Date()) {
  const weekday = now.toLocaleDateString(undefined, { weekday: 'long' });
  const hour = String(now.getHours()).padStart(2, '0');
  const period = now.getHours() < 12
    ? 'morning'
    : (now.getHours() < 17 ? 'afternoon' : (now.getHours() < 21 ? 'evening' : 'night'));
  return `Smart Practice - ${weekday} ${period} at ${hour}`;
}

async function listAttemptItems({ orgId, userId, fromIso, backendMode } = {}) {
  if (!orgId || !userId) return [];
  const query = {
    orgId__eq: orgId,
    userId__eq: userId,
    ...(fromIso ? { startDate: fromIso } : {}),
    page: 1,
    limit: MAX_ATTEMPT_ITEMS,
    sort: '-finishedAt,-submittedAt,-startedAt,-id'
  };
  const rows = await pteAttemptItemRepository.list({
    query,
    scope: { canViewAll: true },
    sort: { finishedAt: -1, submittedAt: -1, startedAt: -1, id: -1 },
    projection: ITEM_HISTORY_PROJECTION,
    backendMode
  });
  return normalizeAttemptItems(rows);
}

async function listAttemptItemsByContext({ orgId, userId, skill, questionType, backendMode } = {}) {
  if (!orgId || !userId) return [];
  const normalizedSkill = normalizeSkill(skill);
  const normalizedQuestionType = normalizeQuestionType(questionType);
  const query = {
    orgId__eq: orgId,
    userId__eq: userId,
    attemptType__eq: 'skill_practice_run',
    ...(normalizedSkill ? { skill__eq: normalizedSkill } : {}),
    ...(normalizedQuestionType ? { questionType__eq: normalizedQuestionType } : {}),
    page: 1,
    limit: PLAN_RUNTIME_MAX_ATTEMPT_ITEMS,
    sort: '-finishedAt,-submittedAt,-startedAt,-id'
  };
  const rows = await pteAttemptItemRepository.list({
    query,
    scope: { canViewAll: true },
    sort: { finishedAt: -1, submittedAt: -1, startedAt: -1, id: -1 },
    projection: ITEM_HISTORY_PROJECTION,
    backendMode
  });
  return normalizeAttemptItems(rows);
}

function buildPracticeContextMap(requestedPlans = []) {
  const plans = normalizeRequestedSkillPlans(requestedPlans);
  const bySkillType = new Map();
  plans.forEach((plan) => {
    const skill = normalizeSkill(plan.skill);
    if (!skill) return;
    const typePlans = Array.isArray(plan.typePlans) ? plan.typePlans : [];
    typePlans.forEach((typePlan) => {
      const questionType = normalizeQuestionType(typePlan.questionType);
      if (!questionType) return;
      const count = cleanInteger(typePlan.questionCount, 0, { min: 0, max: MAX_TARGET_QUESTION_COUNT });
      if (count <= 0) return;
      const key = makeGroupKey(skill, questionType);
      bySkillType.set(key, {
        skill,
        questionType,
        requestedCount: count
      });
    });
  });
  return bySkillType;
}

async function listAttemptHistoryByRuntimeContext({ orgId, userId, requestedPlans = [], backendMode } = {}) {
  if (!orgId || !userId) return {
    items: [],
    contextCounts: {},
    global: { attemptedItems: 0, scoredItems: 0 }
  };

  const contextMap = buildPracticeContextMap(requestedPlans);
  if (!contextMap.size) {
    const rows = await listAttemptItems({
      orgId,
      userId,
      backendMode
    });
    return {
      items: rows,
      contextCounts: {},
      global: {
        attemptedItems: rows.length,
        scoredItems: rows.filter(hasUsableScore).length
      }
    };
  }

  const entries = await Promise.all(Array.from(contextMap.values()).map(async (context) => {
    const rows = await listAttemptItemsByContext({
      orgId,
      userId,
      skill: context.skill,
      questionType: context.questionType,
      backendMode
    });
    return {
      key: makeGroupKey(context.skill, context.questionType),
      rows
    };
  }));

  const allRows = [];
  const contextCounts = {};
  entries.forEach((entry) => {
    const rows = Array.isArray(entry?.rows) ? entry.rows : [];
    contextCounts[entry.key] = {
      attemptedItems: rows.length,
      scoredItems: rows.filter(hasUsableScore).length
    };
    allRows.push(...rows);
  });

  return {
    items: allRows,
    contextCounts,
    global: {
      attemptedItems: allRows.length,
      scoredItems: allRows.filter(hasUsableScore).length
    }
  };
}

async function listAvailableQuestions({ orgId, backendMode } = {}) {
  if (!orgId) return [];
  const rows = await pteQuestionVersionRepository.list({
    query: {
      orgId__eq: orgId,
      status__eq: 'published'
    },
    scope: { canViewAll: true },
    sort: { skill: 1, questionType: 1, difficulty: 1, id: 1 },
    projection: QUESTION_PROJECTION,
    backendMode
  });
  return normalizeQuestionRows(rows, orgId);
}

function summarizeRequestedQuestionCount(requestedPlans = []) {
  return normalizeRequestedSkillPlans(requestedPlans).reduce((sum, skillPlan) => (
    sum + skillPlan.typePlans.reduce((typeSum, typePlan) => (
      typeSum + cleanInteger(typePlan.questionCount, 0, { min: 0, max: MAX_TARGET_QUESTION_COUNT })
    ), 0)
  ), 0);
}

function buildPracticeBySkillQuestionReason(question = {}, stat = null) {
  if (!stat) {
    return 'Unseen question selected before repeats for this skill practice context.';
  }
  const avgScore = normalizeScoreToNumber(stat.avgScore, null);
  const lastScore = normalizeScoreToNumber(stat.lastScore, null);
  const score = Number.isFinite(avgScore) ? avgScore : lastScore;
  if (Number.isFinite(score)) {
    return `Previously seen fallback selected for weakness review (${Math.round(score)}% average).`;
  }
  const attemptsCount = cleanInteger(stat.attemptsCount, 0, { min: 0 });
  return attemptsCount > 0
    ? `Previously seen fallback selected after ${attemptsCount} prior attempt(s).`
    : 'Previously seen fallback selected for review.';
}

function buildPracticeBySkillPracticeMetadata({
  requestedPlans = [],
  selectedQuestions = [],
  practiceName = '',
  requestedQuestionCount = 0,
  poolQuestionCount = 0
} = {}) {
  const selectedSkills = Array.from(new Set(
    selectedQuestions.map((row) => normalizeSkill(row.skill)).filter(Boolean)
  ));
  const questionTypes = Array.from(new Set(
    selectedQuestions.map((row) => normalizeQuestionType(row.questionType)).filter(Boolean)
  )).sort((a, b) => a.localeCompare(b));
  const skillPlans = reconcilePlansWithSelected(requestedPlans, selectedQuestions);

  return {
    mode: selectedSkills.length > 1 ? 'multi_skill' : 'single_skill',
    skill: selectedSkills.length === 1 ? selectedSkills[0] : 'multi',
    selectedSkills,
    name: cleanText(practiceName, 120),
    questionTypes,
    requestedQuestionCount,
    selectedQuestionCount: selectedQuestions.length,
    poolQuestionCount,
    skillPlans
  };
}

async function buildPracticeBySkillRuntimePlan(requestingUser, accessContext = {}, runtimePlan = {}, options = {}) {
  const orgId = getActiveOrgId(requestingUser);
  const userId = getUserId(requestingUser);
  if (!orgId) throw new Error('Active organization context is required for practice planning.');
  if (!userId) throw new Error('Authenticated user context is required for practice planning.');

  const requestedPlans = normalizePracticeBySkillRequestedPlan(runtimePlan, runtimePlan?.questionCount);
  if (!requestedPlans.length) return null;

  const requestedQuestionCount = summarizeRequestedQuestionCount(requestedPlans);
  if (requestedQuestionCount <= 0) return null;

  const [history, questionRows] = await Promise.all([
    listAttemptHistoryByRuntimeContext({
      orgId,
      userId,
      requestedPlans,
      backendMode: options.backendMode
    }),
    listAvailableQuestions({
      orgId,
      backendMode: options.backendMode
    })
  ]);

  const contextPools = buildRequestedContextPools(questionRows, requestedPlans);
  const contextHistoryMap = buildContextHistoryMap(history.items);
  const selectedQuestions = [];
  const selectedIds = new Set();
  const contextPlans = [];
  let unseenUsed = 0;
  let seenFallbackUsed = 0;
  let repeatedUsed = 0;
  let poolQuestionCount = 0;

  requestedPlans.forEach((skillPlan) => {
    (Array.isArray(skillPlan.typePlans) ? skillPlan.typePlans : []).forEach((typePlan) => {
      const skill = normalizeSkill(skillPlan.skill);
      const questionType = normalizeQuestionType(typePlan.questionType);
      if (!skill || !questionType) return;
      const key = makeGroupKey(skill, questionType);
      const bucket = contextPools.get(key) || {
        skill,
        questionType,
        requestedCount: cleanInteger(typePlan.questionCount, 0, { min: 0, max: MAX_TARGET_QUESTION_COUNT }),
        questions: []
      };
      const requestedCount = cleanInteger(typePlan.questionCount, bucket.requestedCount || 0, { min: 0, max: MAX_TARGET_QUESTION_COUNT });
      const pool = Array.isArray(bucket.questions) ? bucket.questions : [];
      const statById = contextHistoryMap.get(key) || new Map();
      const seenQuestionIds = new Set(statById.keys());
      const selectedForContext = buildPracticeBySkillSelectionFromContext({
        key,
        requestedCount,
        pool,
        statById,
        selectedQuestionIds: selectedIds,
        seenQuestionIds
      });

      selectedForContext.selection.forEach((question) => {
        if (!question?.id || selectedIds.has(question.id)) return;
        const stat = statById.get(question.id) || null;
        selectedIds.add(question.id);
        selectedQuestions.push({
          questionVersionId: question.id,
          questionOrder: selectedQuestions.length + 1,
          skill: question.skill,
          questionType: question.questionType,
          difficulty: question.difficulty,
          title: question.title,
          code: question.code,
          targetDifficulty: question.difficulty,
          reason: buildPracticeBySkillQuestionReason(question, stat)
        });
      });

      unseenUsed += selectedForContext.unseenUsed;
      seenFallbackUsed += selectedForContext.seenFallbackUsed;
      repeatedUsed += selectedForContext.repeatedUsed;
      poolQuestionCount += pool.length;
      const seenCount = pool.filter((question) => question?.id && seenQuestionIds.has(question.id)).length;
      contextPlans.push(buildContextPlanDiagnostics({
        key,
        skill,
        questionType,
        requestedCount,
        poolSize: pool.length,
        seenCount,
        unseenCount: Math.max(0, pool.length - seenCount),
        unseenUsed: selectedForContext.unseenUsed,
        seenFallbackUsed: selectedForContext.seenFallbackUsed,
        repeatedCount: selectedForContext.repeatedUsed
      }));
    });
  });

  if (!selectedQuestions.length) return null;

  const plannerMetadata = buildPracticeBySkillPlan(selectedQuestions, {
    skillPlans: reconcilePlansWithSelected(requestedPlans, selectedQuestions),
    selectionSource: seenFallbackUsed > 0 ? 'fallback-difficulty-score' : 'unseen-first',
    unseenUsed,
    seenFallbackUsed,
    repeatedUsed,
    requestedQuestionCount,
    contextPlans,
    history: {
      ...history.global,
      contextCounts: history.contextCounts || {}
    },
    poolQuestionCount
  });

  return {
    version: PRACTICE_BY_SKILL_PLAN_VERSION,
    selectedQuestions,
    metadata: {
      practice: buildPracticeBySkillPracticeMetadata({
        requestedPlans,
        selectedQuestions,
        practiceName: runtimePlan?.practiceName,
        requestedQuestionCount,
        poolQuestionCount
      }),
      practiceBySkillPlanner: plannerMetadata
    },
    diagnostics: plannerMetadata
  };
}

async function buildRecommendation(requestingUser, accessContext = {}, options = {}) {
  const orgId = getActiveOrgId(requestingUser);
  const userId = getUserId(requestingUser);
  if (!orgId) throw new Error('Active organization context is required for smart practice.');
  if (!userId) throw new Error('Authenticated user context is required for smart practice.');

  const windowDays = cleanInteger(options.windowDays, DEFAULT_WINDOW_DAYS, { min: 7, max: 365 });
  const targetQuestionCount = normalizeTargetQuestionCount(options.targetQuestionCount, DEFAULT_TARGET_QUESTION_COUNT);
  const priorityMode = normalizePriorityMode(options.priorityMode);
  const includeMaintenance = normalizeBoolean(options.includeMaintenance, true);
  const now = new Date();
  const from = new Date(now.getTime() - (windowDays * 24 * 60 * 60 * 1000));
  const [attemptItems, questionRows] = await Promise.all([
    listAttemptItems({
      orgId,
      userId,
      fromIso: from.toISOString(),
      backendMode: options.backendMode
    }),
    listAvailableQuestions({
      orgId,
      backendMode: options.backendMode
    })
  ]);

  const warnings = [];
  if (!questionRows.length) {
    warnings.push('No published practice-enabled questions are available for this organization.');
  }

  const { groups: performanceGroups } = buildPerformanceGroups(attemptItems);
  const poolGroups = buildPoolGroups(questionRows);
  const rankedGroups = rankGroups({
    performanceGroups,
    poolGroups,
    priorityMode
  });
  const requestedSkillPlans = normalizeRequestedSkillPlans(options.requestedSkillPlans || []);
  const requestedQuestionCount = requestedSkillPlans.reduce((sum, skillPlan) => (
    sum + skillPlan.typePlans.reduce((typeSum, typePlan) => typeSum + cleanInteger(typePlan.questionCount, 0, { min: 0 }), 0)
  ), 0);
  const effectiveTargetQuestionCount = requestedSkillPlans.length
    ? normalizeTargetQuestionCount(requestedQuestionCount, targetQuestionCount)
    : targetQuestionCount;
  const noHistory = performanceGroups.length === 0;
  const plannedSkillPlans = requestedSkillPlans.length
    ? buildPlansFromRequested(rankedGroups, requestedSkillPlans)
    : buildPlansFromRankedGroups(rankedGroups, effectiveTargetQuestionCount, { includeMaintenance });
  const recentAttemptMap = buildRecentAttemptMap(attemptItems);
  const selectedQuestions = selectQuestionsForPlans({
    skillPlans: plannedSkillPlans,
    poolGroups,
    recentAttemptMap
  });
  const skillPlans = reconcilePlansWithSelected(plannedSkillPlans, selectedQuestions);

  if (selectedQuestions.length < effectiveTargetQuestionCount && questionRows.length) {
    warnings.push(`Only ${selectedQuestions.length} matching question(s) were available for the requested smart plan.`);
  }

  const selectedQuestionIds = selectedQuestions.map((row) => row.questionVersionId);
  const confidence = noHistory
    ? 'starter'
    : (performanceGroups.filter((row) => row.scoredCount > 0).length >= 3 ? 'high' : 'medium');

  return {
    recommendationId: `PTE-SP-${Date.now()}`,
    version: VERSION,
    generatedAt: now.toISOString(),
    userId,
    orgId,
    window: {
      days: windowDays,
      from: from.toISOString(),
      to: now.toISOString()
    },
    targetQuestionCount: effectiveTargetQuestionCount,
    priorityMode,
    includeMaintenance,
    confidence,
    summary: buildSummary({ rankedGroups, selectedQuestions, noHistory }),
    skillPlans,
    selectedQuestions,
    evidence: {
      attemptedItemCount: attemptItems.length,
      scoredItemCount: attemptItems.filter(hasUsableScore).length,
      availableQuestionCount: questionRows.length,
      rankedGroups: rankedGroups.slice(0, 12).map((row) => ({
        skill: row.skill,
        questionType: row.questionType,
        needScore: row.score,
        averagePercentage: row.averagePercentage,
        recentAveragePercentage: row.recentAveragePercentage,
        hardRatingCount: row.hardRatingCount,
        poolQuestionCount: row.poolQuestionCount,
        reason: row.reason
      }))
    },
    warnings
  };
}

function buildStartMetadata(recommendation = {}) {
  const selectedQuestions = Array.isArray(recommendation.selectedQuestions) ? recommendation.selectedQuestions : [];
  const selectedSkills = Array.from(new Set(selectedQuestions.map((row) => normalizeSkill(row.skill)).filter(Boolean)));
  const questionTypes = Array.from(new Set(selectedQuestions.map((row) => normalizeQuestionType(row.questionType)).filter(Boolean))).sort();
  return {
    practice: {
      mode: 'smart',
      skill: selectedSkills.length === 1 ? selectedSkills[0] : 'multi',
      selectedSkills,
      name: '',
      questionTypes,
      requestedQuestionCount: cleanInteger(recommendation.targetQuestionCount, selectedQuestions.length, { min: 0, max: MAX_TARGET_QUESTION_COUNT }),
      selectedQuestionCount: selectedQuestions.length,
      poolQuestionCount: cleanInteger(recommendation?.evidence?.availableQuestionCount, 0, { min: 0 }),
      skillPlans: recommendation.skillPlans || []
    },
    practiceSmart: {
      version: VERSION,
      recommendationId: cleanText(recommendation.recommendationId, 120),
      generatedAt: cleanText(recommendation.generatedAt, 80),
      window: recommendation.window || {},
      priorityMode: cleanText(recommendation.priorityMode, 60) || 'balanced_gaps',
      confidence: cleanText(recommendation.confidence, 40),
      reasons: Array.isArray(recommendation?.evidence?.rankedGroups)
        ? recommendation.evidence.rankedGroups.slice(0, 8)
        : [],
      selectedQuestionIds: selectedQuestions.map((row) => cleanText(row.questionVersionId, 120)).filter(Boolean),
      selectedQuestions: selectedQuestions.map((row) => ({
        questionVersionId: cleanText(row.questionVersionId, 120),
        skill: normalizeSkill(row.skill),
        questionType: normalizeQuestionType(row.questionType),
        difficulty: normalizeDifficulty(row.difficulty),
        reason: cleanText(row.reason, 500)
      }))
    }
  };
}

module.exports = {
  DEFAULT_WINDOW_DAYS,
  DEFAULT_TARGET_QUESTION_COUNT,
  MAX_TARGET_QUESTION_COUNT,
  VERSION,
  PRACTICE_BY_SKILL_PLAN_VERSION,
  buildRecommendation,
  buildPracticeBySkillRuntimePlan,
  buildStartMetadata,
  __testables: {
    calculateNeedScore,
    buildPerformanceGroups,
    buildPoolGroups,
    rankGroups,
    buildPlansFromRankedGroups,
    selectQuestionsForPlans,
    normalizeRequestedSkillPlans,
    normalizePracticeBySkillRequestedPlan,
    normalizeQuestionRows,
    normalizeAttemptItems,
    buildSuggestedPracticeName,
    buildPracticeBySkillSelectionFromContext,
    buildQuestionHistoryStats,
    comparePracticeBySkillSeenOrder,
    comparePracticeBySkillRepeatOrder
  }
};
