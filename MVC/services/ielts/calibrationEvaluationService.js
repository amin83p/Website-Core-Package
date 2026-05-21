const CRITERIA = ['TR', 'CC', 'LR', 'GRA'];

const FEATURE_PASS_VALUES = new Set([
  'yes', 'true', 'clear', 'adequate', 'wide', 'logical', 'well_managed',
  'sufficient', 'skilful', 'relevant', 'high', 'ok'
]);
const FAULT_PASS_VALUES = new Set([
  'no', 'false', 'none', 'rare', 'rarely', 'never', 'few', 'minimal', 'minor', 'ok'
]);

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeCriterion(value) {
  const token = String(value || '').trim().toUpperCase();
  return CRITERIA.includes(token) ? token : 'General';
}

function bucketBand(value) {
  const n = toNumberOrNull(value);
  if (!Number.isFinite(n)) return null;
  if (n < 3.5) return '1-3';
  if (n < 4.5) return '4';
  if (n < 5.5) return '5';
  if (n < 6.5) return '6';
  return '7+';
}

function normalizeScoreValue(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '_');
}

function isPassingRow(row) {
  const val = normalizeScoreValue(row?.value);
  if (!val || val === 'error' || val === 'n/a') return false;
  const polarity = String(row?.polarity || 'FEATURE_CHECK').trim().toUpperCase();
  if (polarity === 'FAULT_CHECK') {
    return FAULT_PASS_VALUES.has(val) || val.includes('rare') || val.includes('few') || val.includes('minor');
  }
  return FEATURE_PASS_VALUES.has(val) || val === 'yes';
}

function isAiSource(source) {
  return String(source || '').toLowerCase().startsWith('ai');
}

function normalizeBandGate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  if (i < 1 || i > 9) return null;
  return i;
}

function buildCriterionCounter() {
  return { TR: 0, CC: 0, LR: 0, GRA: 0, General: 0 };
}

function incrementCriterionCounter(counter, criterion, amount = 1) {
  const key = normalizeCriterion(criterion);
  if (!Object.prototype.hasOwnProperty.call(counter, key)) counter[key] = 0;
  counter[key] += amount;
}

function computeAgreementMetrics(pairs = []) {
  const validPairs = (Array.isArray(pairs) ? pairs : [])
    .map((row) => ({
      predicted: toNumberOrNull(row?.predictedOverall),
      reference: toNumberOrNull(row?.referenceOverall)
    }))
    .filter((row) => Number.isFinite(row.predicted) && Number.isFinite(row.reference));

  const count = validPairs.length;
  if (!count) {
    return {
      sampleCount: 0,
      exactAgreementRate: null,
      withinHalfBandRate: null,
      withinOneBandRate: null,
      meanAbsoluteError: null
    };
  }

  let exact = 0;
  let withinHalf = 0;
  let withinOne = 0;
  let absErrorSum = 0;

  for (const row of validPairs) {
    const absDiff = Math.abs(row.predicted - row.reference);
    absErrorSum += absDiff;
    if (absDiff === 0) exact += 1;
    if (absDiff <= 0.5) withinHalf += 1;
    if (absDiff <= 1.0) withinOne += 1;
  }

  return {
    sampleCount: count,
    exactAgreementRate: Number((exact / count).toFixed(4)),
    withinHalfBandRate: Number((withinHalf / count).toFixed(4)),
    withinOneBandRate: Number((withinOne / count).toFixed(4)),
    meanAbsoluteError: Number((absErrorSum / count).toFixed(4))
  };
}

function computeCriterionDeltaMetrics(records = []) {
  const out = {};
  for (const criterion of CRITERIA) {
    const rows = [];
    for (const record of (Array.isArray(records) ? records : [])) {
      const predicted = toNumberOrNull(record?.predictedCriteria?.[criterion]);
      const reference = toNumberOrNull(record?.referenceCriteria?.[criterion]);
      if (!Number.isFinite(predicted) || !Number.isFinite(reference)) continue;
      rows.push({ predicted, reference });
    }

    if (!rows.length) {
      out[criterion] = null;
      continue;
    }

    let exact = 0;
    let withinHalf = 0;
    let withinOne = 0;
    let absErrorSum = 0;
    let deltaSum = 0;

    for (const row of rows) {
      const delta = row.predicted - row.reference;
      const absDiff = Math.abs(delta);
      deltaSum += delta;
      absErrorSum += absDiff;
      if (absDiff === 0) exact += 1;
      if (absDiff <= 0.5) withinHalf += 1;
      if (absDiff <= 1.0) withinOne += 1;
    }

    out[criterion] = {
      sampleCount: rows.length,
      meanDelta: Number((deltaSum / rows.length).toFixed(4)),
      meanAbsoluteError: Number((absErrorSum / rows.length).toFixed(4)),
      exactAgreementRate: Number((exact / rows.length).toFixed(4)),
      withinHalfBandRate: Number((withinHalf / rows.length).toFixed(4)),
      withinOneBandRate: Number((withinOne / rows.length).toFixed(4))
    };
  }
  return out;
}

function buildBucketConfusion(records = []) {
  const labels = ['1-3', '4', '5', '6', '7+'];
  const matrix = {};
  for (const refBucket of labels) {
    matrix[refBucket] = {};
    for (const predBucket of labels) {
      matrix[refBucket][predBucket] = 0;
    }
  }

  let comparedCount = 0;
  for (const row of (Array.isArray(records) ? records : [])) {
    const referenceBucket = bucketBand(row?.referenceOverall);
    const predictedBucket = bucketBand(row?.predictedOverall);
    if (!referenceBucket || !predictedBucket) continue;
    matrix[referenceBucket][predictedBucket] += 1;
    comparedCount += 1;
  }

  const flattened = [];
  for (const refBucket of labels) {
    for (const predBucket of labels) {
      const count = matrix[refBucket][predBucket];
      flattened.push({
        referenceBucket: refBucket,
        predictedBucket: predBucket,
        count,
        share: comparedCount > 0 ? Number((count / comparedCount).toFixed(4)) : null
      });
    }
  }

  return {
    labels,
    comparedCount,
    matrix,
    flattened
  };
}

function deriveTelemetryFromStep4(step4 = {}) {
  const existing = step4?.meta?.telemetry;
  if (existing && typeof existing === 'object') {
    return existing;
  }

  const results = Array.isArray(step4?.results) ? step4.results : [];
  const aggregatedResults = Array.isArray(step4?.aggregatedResults) ? step4.aggregatedResults : [];
  const paragraphRows = results.filter((row) => String(row?.scope || '').toLowerCase() === 'paragraph');
  const lowBandRows = results.filter((row) => {
    const band = normalizeBandGate(row?.band);
    return Number.isInteger(band) && band <= 3;
  });
  const aiRows = results.filter((row) => isAiSource(row?.source));
  const aiErrorRows = aiRows.filter((row) => String(row?.source || '').toLowerCase() === 'ai_error');
  const lowBandRowsByCriterion = buildCriterionCounter();
  lowBandRows.forEach((row) => incrementCriterionCounter(lowBandRowsByCriterion, row?.criterion, 1));

  return {
    sourceCounts: {
      deterministic: results.filter((row) => String(row?.source || '').toLowerCase() === 'deterministic').length,
      ai: results.filter((row) => isAiSource(row?.source)).length,
      aggregate: aggregatedResults.filter((row) => String(row?.source || '').toLowerCase() === 'aggregate').length
    },
    paragraph: {
      totalRows: paragraphRows.length,
      deterministicRows: paragraphRows.filter((row) => String(row?.source || '').toLowerCase() === 'deterministic').length,
      aiRows: paragraphRows.filter((row) => isAiSource(row?.source)).length
    },
    lowBand: {
      totalRows: lowBandRows.length,
      rowsByCriterion: lowBandRowsByCriterion,
      aiFallbackNoRule: null,
      aiFallbackRuleReturnedNull: null,
      aiFallbackRuleError: null,
      errorRows: lowBandRows.filter((row) => normalizeScoreValue(row?.value) === 'error').length
    },
    aiReliability: {
      totalAiRows: aiRows.length,
      aiErrorRows: aiErrorRows.length,
      recoverableFailureRows: null,
      nonRecoverableFailureRows: null,
      retryAttempts: aiRows.reduce((sum, row) => sum + Number(row?.retryCount || 0), 0),
      fallbackUsedRows: aiRows.filter((row) => row?.fallbackUsed === true).length,
      rescuedByRetryRows: aiRows.filter((row) => row?.rescuedByRetry === true).length,
      rescuedByFallbackRows: aiRows.filter((row) => row?.rescuedByFallback === true).length,
      stillUnevaluableRows: aiErrorRows.length,
      runtimeFailureClassCounts: {}
    },
    totalAssessmentInstances: results.length,
    inferredFromRows: true
  };
}

function extractReferenceOverall(session = {}) {
  return toNumberOrNull(
    session?.metadata?.examinerBandScore ??
    session?.examinerBandScore ??
    session?.steps?.step1freeze?.response?.json?.meta?.sampleBandScore
  );
}

function extractReferenceCriteria(session = {}) {
  const source =
    session?.metadata?.examinerCriteriaScores ||
    session?.metadata?.examinerCriterionScores ||
    session?.metadata?.referenceCriteriaScores ||
    session?.steps?.step1freeze?.response?.json?.meta?.sampleCriteriaScores ||
    null;
  if (!source || typeof source !== 'object') return null;

  const out = {};
  let hasAny = false;
  for (const criterion of CRITERIA) {
    const val = toNumberOrNull(source?.[criterion]);
    if (Number.isFinite(val)) {
      out[criterion] = val;
      hasAny = true;
    }
  }
  return hasAny ? out : null;
}

function collectWeaknessPatternKeys(step4 = {}, step5 = {}) {
  const keys = [];

  const lowBandTriggered = Array.isArray(step4?.meta?.lowBandCoverage?.triggeredItems)
    ? step4.meta.lowBandCoverage.triggeredItems
    : [];
  for (const item of lowBandTriggered) {
    const criterion = normalizeCriterion(item?.criterion);
    const baseKey = String(item?.baseKey || item?.instanceKey || '').trim();
    if (!baseKey) continue;
    keys.push(`${criterion}:${baseKey}`);
  }

  const sourceRows = Array.isArray(step4?.aggregatedResults) && step4.aggregatedResults.length
    ? step4.aggregatedResults
    : (Array.isArray(step4?.results) ? step4.results : []);
  sourceRows
    .filter((row) => !isPassingRow(row))
    .forEach((row) => {
      const criterion = normalizeCriterion(row?.criterion);
      const baseKey = String(row?.baseKey || row?.question_key || row?.instanceKey || '').trim();
      if (!baseKey) return;
      keys.push(`${criterion}:${baseKey}`);
    });

  const improvements = Array.isArray(step5?.improvements) ? step5.improvements : [];
  improvements.forEach((item) => {
    const criterion = normalizeCriterion(item?.criterion);
    const issue = String(item?.issue || '').trim();
    if (!issue) return;
    keys.push(`${criterion}:issue:${issue.toLowerCase()}`);
  });

  return keys;
}

function buildEvaluationRecordFromSession(session = {}) {
  const step4 = session?.steps?.step4grade?.response?.json?.data || {};
  const step5 = session?.steps?.step5feedback?.response?.json?.data || {};
  const predictedOverall = toNumberOrNull(step4?.overallBand);
  const predictedCriteria = {
    TR: toNumberOrNull(step4?.scores?.TR),
    CC: toNumberOrNull(step4?.scores?.CC),
    LR: toNumberOrNull(step4?.scores?.LR),
    GRA: toNumberOrNull(step4?.scores?.GRA)
  };

  return {
    id: String(session?.sessionId || session?.id || ''),
    sampleId: String(session?.metadata?.sampleId || session?.sampleId || ''),
    sampleName: String(session?.metadata?.sampleName || session?.sampleName || 'Untitled Essay'),
    savedAt: session?.savedAt || session?.metadata?.savedAt || null,
    predictedOverall,
    predictedCriteria,
    referenceOverall: extractReferenceOverall(session),
    referenceCriteria: extractReferenceCriteria(session),
    telemetry: deriveTelemetryFromStep4(step4),
    gateTrace: step4?.meta?.gateTrace || step4?.meta?.scoreTrace || null,
    lowBandCoverage: step4?.meta?.lowBandCoverage || null,
    weaknessPatternKeys: collectWeaknessPatternKeys(step4, step5)
  };
}

function aggregateTelemetry(records = []) {
  const out = {
    sourceCounts: { deterministic: 0, ai: 0, aggregate: 0 },
    paragraph: { totalRows: 0, deterministicRows: 0, aiRows: 0 },
    lowBand: {
      totalRows: 0,
      rowsByCriterion: buildCriterionCounter(),
      aiFallbackNoRule: 0,
      aiFallbackRuleReturnedNull: 0,
      aiFallbackRuleError: 0,
      errorRows: 0
    },
    aiReliability: {
      totalAiRows: 0,
      aiErrorRows: 0,
      recoverableFailureRows: 0,
      nonRecoverableFailureRows: 0,
      retryAttempts: 0,
      fallbackUsedRows: 0,
      rescuedByRetryRows: 0,
      rescuedByFallbackRows: 0,
      stillUnevaluableRows: 0,
      runtimeFailureClassCounts: {}
    },
    runCount: 0
  };

  for (const record of (Array.isArray(records) ? records : [])) {
    const t = record?.telemetry;
    if (!t || typeof t !== 'object') continue;
    out.runCount += 1;
    out.sourceCounts.deterministic += Number(t?.sourceCounts?.deterministic || 0);
    out.sourceCounts.ai += Number(t?.sourceCounts?.ai || 0);
    out.sourceCounts.aggregate += Number(t?.sourceCounts?.aggregate || 0);
    out.paragraph.totalRows += Number(t?.paragraph?.totalRows || 0);
    out.paragraph.deterministicRows += Number(t?.paragraph?.deterministicRows || 0);
    out.paragraph.aiRows += Number(t?.paragraph?.aiRows || 0);
    out.lowBand.totalRows += Number(t?.lowBand?.totalRows || 0);
    out.lowBand.aiFallbackNoRule += Number(t?.lowBand?.aiFallbackNoRule || 0);
    out.lowBand.aiFallbackRuleReturnedNull += Number(t?.lowBand?.aiFallbackRuleReturnedNull || 0);
    out.lowBand.aiFallbackRuleError += Number(t?.lowBand?.aiFallbackRuleError || 0);
    out.lowBand.errorRows += Number(t?.lowBand?.errorRows || 0);
    out.aiReliability.totalAiRows += Number(t?.aiReliability?.totalAiRows || 0);
    out.aiReliability.aiErrorRows += Number(t?.aiReliability?.aiErrorRows || 0);
    out.aiReliability.recoverableFailureRows += Number(t?.aiReliability?.recoverableFailureRows || 0);
    out.aiReliability.nonRecoverableFailureRows += Number(t?.aiReliability?.nonRecoverableFailureRows || 0);
    out.aiReliability.retryAttempts += Number(t?.aiReliability?.retryAttempts || 0);
    out.aiReliability.fallbackUsedRows += Number(t?.aiReliability?.fallbackUsedRows || 0);
    out.aiReliability.rescuedByRetryRows += Number(t?.aiReliability?.rescuedByRetryRows || 0);
    out.aiReliability.rescuedByFallbackRows += Number(t?.aiReliability?.rescuedByFallbackRows || 0);
    out.aiReliability.stillUnevaluableRows += Number(t?.aiReliability?.stillUnevaluableRows || 0);

    const failureClassCounts = t?.aiReliability?.runtimeFailureClassCounts || {};
    Object.keys(failureClassCounts).forEach((failureClass) => {
      const key = normalizeScoreValue(failureClass || '') || 'unknown';
      if (!Object.prototype.hasOwnProperty.call(out.aiReliability.runtimeFailureClassCounts, key)) {
        out.aiReliability.runtimeFailureClassCounts[key] = 0;
      }
      out.aiReliability.runtimeFailureClassCounts[key] += Number(failureClassCounts[failureClass] || 0);
    });

    const byCriterion = t?.lowBand?.rowsByCriterion || {};
    Object.keys(byCriterion).forEach((criterion) => {
      incrementCriterionCounter(out.lowBand.rowsByCriterion, criterion, Number(byCriterion[criterion] || 0));
    });
  }

  return out;
}

function buildTopRecurringFailurePatterns(records = [], limit = 10) {
  const counter = new Map();
  let total = 0;
  for (const record of (Array.isArray(records) ? records : [])) {
    const patterns = Array.isArray(record?.weaknessPatternKeys) ? record.weaknessPatternKeys : [];
    for (const pattern of patterns) {
      const key = String(pattern || '').trim();
      if (!key) continue;
      counter.set(key, (counter.get(key) || 0) + 1);
      total += 1;
    }
  }

  return Array.from(counter.entries())
    .map(([pattern, count]) => ({
      pattern,
      count,
      share: total > 0 ? Number((count / total).toFixed(4)) : null
    }))
    .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern))
    .slice(0, Math.max(1, Number(limit) || 10));
}

function buildCalibrationReport(records = [], options = {}) {
  const list = (Array.isArray(records) ? records : []).filter((row) => row && typeof row === 'object');
  const paired = list.filter((row) => Number.isFinite(toNumberOrNull(row?.predictedOverall)) && Number.isFinite(toNumberOrNull(row?.referenceOverall)));
  const lowBandPaired = paired.filter((row) => {
    const p = toNumberOrNull(row?.predictedOverall);
    const r = toNumberOrNull(row?.referenceOverall);
    return (Number.isFinite(p) && p < 4.5) || (Number.isFinite(r) && r < 4.5);
  });

  const overallMetrics = computeAgreementMetrics(paired);
  const lowBandMetrics = computeAgreementMetrics(lowBandPaired);
  const criterionDeltaMetrics = computeCriterionDeltaMetrics(paired);
  const confusionSummary = buildBucketConfusion(paired);
  const telemetrySummary = aggregateTelemetry(list);
  const topRecurringFailurePatterns = buildTopRecurringFailurePatterns(list, 12);

  const perEssay = list.map((row) => {
    const predicted = toNumberOrNull(row?.predictedOverall);
    const reference = toNumberOrNull(row?.referenceOverall);
    const absError = (Number.isFinite(predicted) && Number.isFinite(reference))
      ? Number(Math.abs(predicted - reference).toFixed(4))
      : null;
    return {
      id: row?.id || '',
      sampleId: row?.sampleId || '',
      sampleName: row?.sampleName || '',
      savedAt: row?.savedAt || null,
      predictedOverall: predicted,
      referenceOverall: reference,
      absoluteError: absError,
      predictedBucket: bucketBand(predicted),
      referenceBucket: bucketBand(reference),
      telemetry: row?.telemetry || null
    };
  });

  const stabilityMetrics = options?.stabilityMetrics && typeof options.stabilityMetrics === 'object'
    ? options.stabilityMetrics
    : null;
  const scoringVersion = String(options?.scoringVersion || 'scoringV0326').trim() || 'scoringV0326';
  const promptSourceSummary = String(options?.promptSourceSummary || '').trim();

  const tweakLogSummary = {
    generatedAt: new Date().toISOString(),
    scoringVersion,
    promptSourceSummary: promptSourceSummary || null,
    essaysEvaluated: list.length,
    essaysWithReference: paired.length,
    agreement: {
      exact: overallMetrics.exactAgreementRate,
      withinHalfBand: overallMetrics.withinHalfBandRate,
      withinOneBand: overallMetrics.withinOneBandRate,
      meanAbsoluteError: overallMetrics.meanAbsoluteError
    },
    stabilityMetrics,
    lowBandSourceMix: {
      deterministic: telemetrySummary.sourceCounts.deterministic,
      ai: telemetrySummary.sourceCounts.ai,
      aggregate: telemetrySummary.sourceCounts.aggregate
    },
    topRecurringFailurePatterns
  };

  return {
    schema: 'ielts-calibration-report',
    version: 1,
    generatedAt: new Date().toISOString(),
    sampleCount: list.length,
    comparedSampleCount: paired.length,
    metrics: {
      overall: overallMetrics,
      lowBandSubset: lowBandMetrics,
      criterionDelta: criterionDeltaMetrics,
      confusionByBandBucket: confusionSummary
    },
    telemetry: telemetrySummary,
    perEssay,
    tweakLogSummary
  };
}

module.exports = {
  bucketBand,
  computeAgreementMetrics,
  computeCriterionDeltaMetrics,
  buildBucketConfusion,
  deriveTelemetryFromStep4,
  buildEvaluationRecordFromSession,
  buildCalibrationReport
};
