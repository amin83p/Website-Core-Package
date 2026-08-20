function resolveActivityWeight(activity) {
  const explicit = Number(activity?.weight);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const totalScore = Number(activity?.totalScore);
  if (Number.isFinite(totalScore) && totalScore > 0) return totalScore;
  return 0;
}

function activityKey(activity, index = 0) {
  const id = String(activity?.id || activity?.colKey || '').trim();
  if (id) return id;
  return `activity_${index}`;
}

function resolveActivityWeightKeys(activities) {
  const list = Array.isArray(activities) ? activities : [];
  const baseKeys = list.map((activity, index) => activityKey(activity, index));
  const baseCounts = new Map();
  baseKeys.forEach((key) => baseCounts.set(key, (baseCounts.get(key) || 0) + 1));
  const dupIndices = new Map();
  return list.map((activity, index) => {
    const base = activityKey(activity, index);
    if (baseCounts.get(base) === 1) return base;
    const occurrence = dupIndices.get(base) || 0;
    dupIndices.set(base, occurrence + 1);
    return occurrence === 0 ? base : `${base}__${index}`;
  });
}

function isIncludedInCalc(activity) {
  if (activity?.includeInGradeCalculation === false) return false;
  if (activity?.includeInCalc === false) return false;
  return true;
}

function buildNormalizedWeightMap(activities, options = {}) {
  const list = Array.isArray(activities) ? activities : [];
  const requireInclude = options.includeInCalc !== false;
  const weightKeys = resolveActivityWeightKeys(list);
  let sum = 0;
  const entries = [];

  list.forEach((activity, index) => {
    if (requireInclude && !isIncludedInCalc(activity)) return;
    const weight = resolveActivityWeight(activity);
    if (!Number.isFinite(weight) || weight <= 0) return;
    entries.push({ key: weightKeys[index], weight });
    sum += weight;
  });

  const map = new Map();
  if (!sum) return map;
  entries.forEach(({ key, weight }) => {
    map.set(key, weight / sum);
  });
  return map;
}

function activityPercent(score, totalScore) {
  const total = Number(totalScore);
  const raw = Number(score);
  if (!Number.isFinite(total) || total <= 0) return null;
  if (score == null || !Number.isFinite(raw)) return null;
  return Math.round((raw / total) * 1000) / 10;
}

function weightedContributionPercent(activityPercentValue, normalizedWeight) {
  const pct = Number(activityPercentValue);
  const weight = Number(normalizedWeight);
  if (!Number.isFinite(pct) || !Number.isFinite(weight) || weight <= 0) return null;
  return Math.round(pct * weight * 10) / 10;
}

function gradePercentContribution(activityPercentValue, weightPercentOfGrade) {
  const pct = Number(activityPercentValue);
  const weight = Number(weightPercentOfGrade);
  if (!Number.isFinite(pct) || !Number.isFinite(weight) || weight <= 0) return null;
  return Math.round(pct * weight / 10) / 10;
}

function computeWeightedAveragePercent(activities, scoreResolver, options = {}) {
  const list = Array.isArray(activities) ? activities : [];
  const weightMap = buildNormalizedWeightMap(list, options);
  if (!weightMap.size) return null;
  const weightKeys = resolveActivityWeightKeys(list);

  let total = 0;
  let used = 0;

  list.forEach((activity, index) => {
    if (options.includeInCalc !== false && !isIncludedInCalc(activity)) return;
    const normalizedWeight = weightMap.get(weightKeys[index]);
    if (!normalizedWeight) return;

    const resolved = typeof scoreResolver === 'function' ? scoreResolver(activity, index) : null;
    if (!resolved || resolved.skip) return;

    const totalScore = Number(resolved.totalScore ?? activity?.totalScore);
    const pct = activityPercent(resolved.score, totalScore);
    if (pct == null) return;

    total += pct * normalizedWeight;
    used += normalizedWeight;
  });

  if (!used) return null;
  return Math.round(total * 100) / 100;
}

function formatNormalizedWeightPercent(normalizedWeight) {
  const value = Number(normalizedWeight);
  if (!Number.isFinite(value) || value <= 0) return '—';
  return `${Math.round(value * 1000) / 10}%`;
}

module.exports = {
  resolveActivityWeight,
  buildNormalizedWeightMap,
  activityPercent,
  weightedContributionPercent,
  gradePercentContribution,
  computeWeightedAveragePercent,
  formatNormalizedWeightPercent,
  activityKey,
  resolveActivityWeightKeys,
  isIncludedInCalc
};
