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

function resolveCellScoreForPeriod(cell, totalScore) {
  if (cell?.absent) return null;
  let score = cell?.score;
  if (score == null && cell?.percent != null && Number.isFinite(Number(cell.percent))) {
    const total = Number(totalScore);
    if (Number.isFinite(total) && total > 0) {
      score = (Number(cell.percent) / 100) * total;
    }
  }
  if (score == null || !Number.isFinite(Number(score))) return null;
  return Number(score);
}

function resolveCellPercentForPeriod(cell, totalScore) {
  if (cell?.absent) return 0;
  const pct = Number(cell?.percent);
  if (Number.isFinite(pct)) return pct;
  const score = resolveCellScoreForPeriod(cell, totalScore);
  if (score == null) return 0;
  const resolved = activityPercent(score, totalScore);
  return resolved == null ? 0 : resolved;
}

function resolveCellActivityStatus(cell, totalScore) {
  if (cell?.notApplicable) {
    return { status: 'not_applicable', activityPercent: null, score: null };
  }
  if (cell?.absent) {
    return { status: 'absent', activityPercent: 0, score: null };
  }
  const score = resolveCellScoreForPeriod(cell, totalScore);
  if (score == null) {
    return { status: 'missing', activityPercent: 0, score: null };
  }
  return {
    status: 'scored',
    activityPercent: resolveCellPercentForPeriod(cell, totalScore),
    score
  };
}

function buildColumnActivityMeta(col) {
  return {
    label: String(col?.label || 'Activity').trim(),
    date: String(col?.date || '').trim(),
    kind: String(col?.kind || '').trim(),
    kindLabel: String(col?.kindLabel || col?.kind || 'Activity').trim()
  };
}

function buildStudentPeriodAssignmentBreakdown(cells, columns) {
  const cellList = Array.isArray(cells) ? cells : [];
  const columnList = Array.isArray(columns) ? columns : [];
  const applicablePairs = [];
  const excludedActivities = [];
  const notApplicableActivities = [];

  for (let i = 0; i < columnList.length; i += 1) {
    const col = columnList[i];
    const cell = cellList[i];
    if (!col || !cell) continue;
    const meta = buildColumnActivityMeta(col);

    if (col.includeInGradeCalculation === false) {
      excludedActivities.push({
        ...meta,
        reason: 'excluded_from_grade_calc'
      });
      continue;
    }

    if (cell.notApplicable) {
      notApplicableActivities.push({
        ...meta,
        status: 'not_applicable'
      });
      continue;
    }

    const originalWeight = resolveActivityWeight(col);
    if (!Number.isFinite(originalWeight) || originalWeight <= 0) continue;
    applicablePairs.push({ col, cell, originalWeight, meta });
  }

  if (!applicablePairs.length) {
    return {
      applicableActivities: [],
      excludedActivities,
      notApplicableActivities,
      weightSum: 0,
      renormalizedTo100: false,
      assignmentsPercent: null
    };
  }

  const weightSum = applicablePairs.reduce((sum, pair) => sum + pair.originalWeight, 0);
  if (!weightSum) {
    return {
      applicableActivities: [],
      excludedActivities,
      notApplicableActivities,
      weightSum: 0,
      renormalizedTo100: false,
      assignmentsPercent: null
    };
  }

  let assignmentsTotal = 0;
  const applicableActivities = applicablePairs.map(({ col, cell, originalWeight, meta }) => {
    const totalScore = Number(col.totalScore);
    const normalizedWeight = originalWeight / weightSum;
    const normalizedWeightPercent = Math.round(normalizedWeight * 10000) / 100;
    const resolved = resolveCellActivityStatus(cell, totalScore);
    const activityPct = resolved.activityPercent == null ? 0 : resolved.activityPercent;
    const contributionPercent = Math.round(activityPct * normalizedWeight * 100) / 100;
    assignmentsTotal += activityPct * normalizedWeight;

    return {
      ...meta,
      originalWeight,
      normalizedWeightPercent,
      status: resolved.status,
      activityPercent: activityPct,
      contributionPercent,
      score: resolved.score,
      totalScore: Number.isFinite(totalScore) && totalScore > 0 ? totalScore : null
    };
  });

  return {
    applicableActivities,
    excludedActivities,
    notApplicableActivities,
    weightSum,
    renormalizedTo100: Math.round(weightSum * 100) / 100 !== 100,
    assignmentsPercent: Math.round(assignmentsTotal * 100) / 100
  };
}

function computeStudentPeriodAssignmentPercent(cells, columns) {
  const breakdown = buildStudentPeriodAssignmentBreakdown(cells, columns);
  return breakdown.assignmentsPercent;
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
  computeStudentPeriodAssignmentPercent,
  buildStudentPeriodAssignmentBreakdown,
  formatNormalizedWeightPercent,
  activityKey,
  resolveActivityWeightKeys,
  isIncludedInCalc
};
