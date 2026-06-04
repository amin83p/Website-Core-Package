function s(value) {
  return String(value == null ? '' : value).trim();
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values = []) {
  return Array.from(new Set(arr(values).map((entry) => s(entry)).filter(Boolean)));
}

function benchmarkLevel(benchmark) {
  const direct = Number.parseInt(benchmark?.benchmarkNumber, 10);
  if (Number.isFinite(direct)) return direct;

  const fromId = s(benchmark?.id || benchmark?.benchmarkId).match(/:(\d{1,2})$/);
  if (!fromId) return null;
  const parsed = Number.parseInt(fromId[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function benchmarkSkillId(benchmark) {
  return s(benchmark?.skillId);
}

function normalizeSkillInput(inputSkill) {
  const raw = s(inputSkill).toLowerCase();
  if (!raw) return null;
  if (raw.startsWith('skill:')) return raw;

  const supported = {
    listening: 'skill:listening',
    speaking: 'skill:speaking',
    reading: 'skill:reading',
    writing: 'skill:writing',
    l: 'skill:listening',
    s: 'skill:speaking',
    r: 'skill:reading',
    w: 'skill:writing'
  };
  return supported[raw] || null;
}

function parseApproxLevel(value) {
  const direct = Number.parseInt(s(value), 10);
  if (Number.isFinite(direct)) return Math.max(1, Math.min(4, direct));
  return null;
}

function parseRangeMidpoint(value) {
  const raw = s(value);
  if (!raw) return null;
  const match = raw.match(/(\d{1,2})\s*[-to]+\s*(\d{1,2})/i);
  if (!match) return parseApproxLevel(raw.replace(/[^\d]/g, ''));
  const left = Number.parseInt(match[1], 10);
  const right = Number.parseInt(match[2], 10);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  const avg = Math.round((left + right) / 2);
  return Math.max(1, Math.min(4, avg));
}

function tokenize(text) {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'with', 'in', 'on', 'at', 'by',
    'is', 'are', 'be', 'as', 'from', 'that', 'this', 'it', 'their', 'our', 'your',
    'student', 'students', 'class', 'task'
  ]);
  return uniqueStrings(
    s(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token && token.length > 2 && !stopWords.has(token))
  );
}

function textOverlapScore(candidateText, anchorTokens = []) {
  const candidateTokens = tokenize(candidateText);
  if (!candidateTokens.length || !anchorTokens.length) return 0;
  const anchorSet = new Set(anchorTokens);
  let score = 0;
  candidateTokens.forEach((token) => {
    if (anchorSet.has(token)) score += 1;
  });
  return score;
}

function classifyTaskType({ learnerGoal, realWorldNeed, desiredModality, learnerInstructions, explicitTaskType }) {
  const explicit = s(explicitTaskType).toLowerCase();
  if (explicit === 'assessment' || explicit === 'enabling') return explicit;

  const text = `${s(learnerGoal)} ${s(realWorldNeed)} ${s(desiredModality)} ${s(learnerInstructions)}`.toLowerCase();
  const assessmentSignals = ['real', 'authentic', 'appointment', 'landlord', 'school', 'work', 'community', 'portfolio', 'evidence', 'demonstrate', 'complete'];
  const enablingSignals = ['practice', 'worksheet', 'grammar', 'vocabulary', 'drill', 'warmup', 'warm-up', 'preteach', 'exercise'];

  let assessmentScore = 0;
  let enablingScore = 0;

  assessmentSignals.forEach((signal) => {
    if (text.includes(signal)) assessmentScore += 1;
  });
  enablingSignals.forEach((signal) => {
    if (text.includes(signal)) enablingScore += 1;
  });

  if (enablingScore > assessmentScore) return 'enabling';
  return 'assessment';
}

function asTraceRecord(row) {
  if (!row) return null;
  return {
    id: s(row.id),
    title: s(row.title),
    sourceRefs: arr(row.sourceRefs)
  };
}

module.exports = {
  s,
  arr,
  uniqueStrings,
  benchmarkLevel,
  benchmarkSkillId,
  normalizeSkillInput,
  parseApproxLevel,
  parseRangeMidpoint,
  tokenize,
  textOverlapScore,
  classifyTaskType,
  asTraceRecord
};
