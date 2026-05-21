// MVC/services/ielts/repeatedRunAnalysisService.js

const CRITERIA = ['TR', 'CC', 'LR', 'GRA'];
const calibrationEvaluationService = require('./calibrationEvaluationService');

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeValue(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return v || null;
}

function getSessionId(session) {
  return String(session?.sessionId || session?.id || '');
}

function getSessionSavedAt(session) {
  const value = session?.savedAt || session?.metadata?.savedAt || null;
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function getStep4Data(session) {
  return session?.steps?.step4grade?.response?.json?.data || {};
}

function getStep1EssayObject(session) {
  return session?.steps?.step1freeze?.response?.json?.data || {};
}

function getSessionRows(session) {
  const step4 = getStep4Data(session);
  if (Array.isArray(step4?.aggregatedResults) && step4.aggregatedResults.length > 0) {
    return step4.aggregatedResults;
  }
  if (Array.isArray(step4?.results)) return step4.results;
  return [];
}

function getItemKey(row) {
  const criterion = String(row?.criterion || 'General').trim().toUpperCase();
  const band = String(row?.band ?? '');
  const baseKey = String(row?.baseKey || row?.question_key || row?.instanceKey || '').trim();
  return `${criterion}::${band}::${baseKey || 'unknown'}`;
}

function getEvidenceRefsFromRow(row, sentenceIdByIndexMap) {
  const indices = Array.isArray(row?.evidenceSentenceIndices) ? row.evidenceSentenceIndices : [];
  const refs = [];
  const seen = new Set();

  for (const idx of indices) {
    if (!Number.isInteger(idx)) continue;
    const ref = sentenceIdByIndexMap.get(idx) || `S${idx + 1}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    refs.push(ref);
  }

  return refs;
}

function buildSentenceIdIndexMap(session) {
  const essay = getStep1EssayObject(session);
  const list = Array.isArray(essay?.sentences) ? essay.sentences : [];
  const map = new Map();
  for (const s of list) {
    if (!s || !Number.isInteger(s.index)) continue;
    const displayId = String(s.displaySentenceId || `S${s.index + 1}`).trim().toUpperCase();
    map.set(s.index, displayId);
  }
  return map;
}

function computeBasicStats(values) {
  const nums = (Array.isArray(values) ? values : []).filter((v) => Number.isFinite(v));
  if (!nums.length) {
    return {
      count: 0,
      min: null,
      max: null,
      range: null,
      mean: null,
      stdDev: null
    };
  }

  const sum = nums.reduce((acc, v) => acc + v, 0);
  const mean = sum / nums.length;
  const variance = nums.reduce((acc, v) => acc + ((v - mean) ** 2), 0) / nums.length;
  const stdDev = Math.sqrt(variance);
  const min = Math.min(...nums);
  const max = Math.max(...nums);

  return {
    count: nums.length,
    min,
    max,
    range: max - min,
    mean: Number(mean.toFixed(4)),
    stdDev: Number(stdDev.toFixed(4))
  };
}

function jaccardSimilarity(a, b) {
  const setA = new Set(Array.isArray(a) ? a : []);
  const setB = new Set(Array.isArray(b) ? b : []);

  if (setA.size === 0 && setB.size === 0) return null;

  let intersection = 0;
  for (const val of setA) {
    if (setB.has(val)) intersection += 1;
  }
  const union = new Set([...setA, ...setB]).size;
  if (union === 0) return null;
  return intersection / union;
}

function buildSessionMeta(session) {
  const step4 = getStep4Data(session);
  const savedAt = getSessionSavedAt(session);
  return {
    id: getSessionId(session),
    savedAt,
    runLabel: session?.researchConfig?.runLabel || session?.metadata?.runLabel || '',
    studyRunId: session?.researchConfig?.studyRunId || session?.metadata?.studyRunId || '',
    provider: session?.researchConfig?.provider || 'unknown',
    mode: session?.researchConfig?.mode || 'hybrid_extension',
    overallBand: toNumberOrNull(step4?.overallBand),
    scores: {
      TR: toNumberOrNull(step4?.scores?.TR),
      CC: toNumberOrNull(step4?.scores?.CC),
      LR: toNumberOrNull(step4?.scores?.LR),
      GRA: toNumberOrNull(step4?.scores?.GRA)
    }
  };
}

function buildItemTimeline(sortedSessions) {
  const timeline = new Map();

  sortedSessions.forEach((session, sessionIndex) => {
    const rows = getSessionRows(session);
    const sentenceIdByIndexMap = buildSentenceIdIndexMap(session);

    for (const row of rows) {
      const key = getItemKey(row);
      if (!timeline.has(key)) {
        timeline.set(key, {
          itemKey: key,
          criterion: String(row?.criterion || 'General').trim().toUpperCase(),
          band: toNumberOrNull(row?.band),
          baseKey: String(row?.baseKey || row?.question_key || row?.instanceKey || '').trim(),
          valuesBySession: Array(sortedSessions.length).fill(null),
          evidenceRefsBySession: Array(sortedSessions.length).fill(null)
        });
      }

      const entry = timeline.get(key);
      entry.valuesBySession[sessionIndex] = normalizeValue(row?.value);
      entry.evidenceRefsBySession[sessionIndex] = getEvidenceRefsFromRow(row, sentenceIdByIndexMap);
    }
  });

  return timeline;
}

function computeBandVariation(sessionMeta) {
  const overallSeries = sessionMeta.map((s) => s.overallBand);
  const byCriterion = {};
  for (const criterion of CRITERIA) {
    byCriterion[criterion] = {
      series: sessionMeta.map((s) => s.scores?.[criterion] ?? null),
      stats: computeBasicStats(sessionMeta.map((s) => s.scores?.[criterion]))
    };
  }

  return {
    overall: {
      series: overallSeries,
      stats: computeBasicStats(overallSeries)
    },
    byCriterion
  };
}

function computeMicroItemFlipRate(itemTimeline) {
  const table = [];
  let totalComparisons = 0;
  let totalFlips = 0;

  for (const entry of itemTimeline.values()) {
    let comparisons = 0;
    let flips = 0;
    const values = entry.valuesBySession;

    for (let i = 1; i < values.length; i += 1) {
      const prev = values[i - 1];
      const curr = values[i];
      if (prev == null || curr == null) continue;
      comparisons += 1;
      if (prev !== curr) flips += 1;
    }

    totalComparisons += comparisons;
    totalFlips += flips;

    table.push({
      itemKey: entry.itemKey,
      criterion: entry.criterion,
      baseKey: entry.baseKey,
      comparisons,
      flips,
      flipRate: comparisons > 0 ? Number((flips / comparisons).toFixed(4)) : null,
      valueSeries: values
    });
  }

  table.sort((a, b) => {
    const ar = a.flipRate ?? -1;
    const br = b.flipRate ?? -1;
    if (br !== ar) return br - ar;
    return a.itemKey.localeCompare(b.itemKey);
  });

  return {
    overall: {
      itemCount: table.length,
      comparisons: totalComparisons,
      flips: totalFlips,
      flipRate: totalComparisons > 0 ? Number((totalFlips / totalComparisons).toFixed(4)) : null
    },
    table
  };
}

function computeEvidenceDrift(itemTimeline, sessionMeta) {
  const table = [];
  const pairwise = [];
  let overallCount = 0;
  let overallDriftSum = 0;

  for (const entry of itemTimeline.values()) {
    let itemPairCount = 0;
    let itemDriftSum = 0;

    for (let i = 1; i < entry.evidenceRefsBySession.length; i += 1) {
      const prev = entry.evidenceRefsBySession[i - 1];
      const curr = entry.evidenceRefsBySession[i];
      if (!Array.isArray(prev) || !Array.isArray(curr)) continue;

      const similarity = jaccardSimilarity(prev, curr);
      if (similarity == null) continue;

      const drift = 1 - similarity;
      itemPairCount += 1;
      itemDriftSum += drift;
      overallCount += 1;
      overallDriftSum += drift;

      pairwise.push({
        fromSessionId: sessionMeta[i - 1]?.id || `run_${i}`,
        toSessionId: sessionMeta[i]?.id || `run_${i + 1}`,
        itemKey: entry.itemKey,
        criterion: entry.criterion,
        jaccard: Number(similarity.toFixed(4)),
        drift: Number(drift.toFixed(4))
      });
    }

    table.push({
      itemKey: entry.itemKey,
      criterion: entry.criterion,
      baseKey: entry.baseKey,
      pairCount: itemPairCount,
      averageDrift: itemPairCount > 0 ? Number((itemDriftSum / itemPairCount).toFixed(4)) : null
    });
  }

  table.sort((a, b) => {
    const ad = a.averageDrift ?? -1;
    const bd = b.averageDrift ?? -1;
    if (bd !== ad) return bd - ad;
    return a.itemKey.localeCompare(b.itemKey);
  });

  return {
    overall: {
      pairComparisons: overallCount,
      averageDrift: overallCount > 0 ? Number((overallDriftSum / overallCount).toFixed(4)) : null
    },
    table,
    pairwise
  };
}

function computeAgreementAnalysis(itemTimeline, sessionMeta) {
  const pairwise = [];

  for (let i = 0; i < sessionMeta.length; i += 1) {
    for (let j = i + 1; j < sessionMeta.length; j += 1) {
      let comparisons = 0;
      let agreements = 0;
      const byCriterion = {};
      for (const criterion of [...CRITERIA, 'General']) {
        byCriterion[criterion] = { comparisons: 0, agreements: 0, agreementRate: null };
      }

      for (const entry of itemTimeline.values()) {
        const va = entry.valuesBySession[i];
        const vb = entry.valuesBySession[j];
        if (va == null || vb == null) continue;

        comparisons += 1;
        const same = va === vb;
        if (same) agreements += 1;

        const crit = byCriterion[entry.criterion] ? entry.criterion : 'General';
        byCriterion[crit].comparisons += 1;
        if (same) byCriterion[crit].agreements += 1;
      }

      for (const key of Object.keys(byCriterion)) {
        const row = byCriterion[key];
        row.agreementRate = row.comparisons > 0 ? Number((row.agreements / row.comparisons).toFixed(4)) : null;
      }

      pairwise.push({
        sessionA: sessionMeta[i]?.id || `run_${i + 1}`,
        sessionB: sessionMeta[j]?.id || `run_${j + 1}`,
        comparisons,
        agreements,
        agreementRate: comparisons > 0 ? Number((agreements / comparisons).toFixed(4)) : null,
        byCriterion
      });
    }
  }

  const validPairs = pairwise.filter((p) => Number.isFinite(p.agreementRate));
  const meanAgreement = validPairs.length
    ? Number((validPairs.reduce((acc, p) => acc + p.agreementRate, 0) / validPairs.length).toFixed(4))
    : null;

  return {
    summary: {
      pairCount: pairwise.length,
      meanAgreement
    },
    pairwise
  };
}

function extractPromptSourceSummary(sessions = []) {
  const parts = new Set();
  for (const session of (Array.isArray(sessions) ? sessions : [])) {
    const sources = session?.researchConfig?.promptSources || session?.uiState?.promptSources || null;
    if (!sources || typeof sources !== 'object') continue;
    const step3 = String(sources?.step3 || '').trim();
    const step4 = String(sources?.step4 || '').trim();
    const step5 = String(sources?.step5 || '').trim();
    if (step3) parts.add(`step3:${step3}`);
    if (step4) parts.add(`step4:${step4}`);
    if (step5) parts.add(`step5:${step5}`);
  }
  return Array.from(parts).sort().join(', ');
}

const repeatedRunAnalysisService = {
  buildReport: (sessions = []) => {
    const validSessions = (Array.isArray(sessions) ? sessions : []).filter((s) => s && getSessionId(s));
    const sortedSessions = validSessions.slice().sort((a, b) => {
      const ta = new Date(getSessionSavedAt(a) || 0).getTime();
      const tb = new Date(getSessionSavedAt(b) || 0).getTime();
      return ta - tb;
    });

    const sessionMeta = sortedSessions.map((session) => buildSessionMeta(session));
    const timeline = buildItemTimeline(sortedSessions);

    const bandVariation = computeBandVariation(sessionMeta);
    const microItemFlipRate = computeMicroItemFlipRate(timeline);
    const evidenceDrift = computeEvidenceDrift(timeline, sessionMeta);
    const agreementAnalysis = computeAgreementAnalysis(timeline, sessionMeta);

    const evaluationRecords = sortedSessions.map((session) =>
      calibrationEvaluationService.buildEvaluationRecordFromSession(session)
    );
    const calibration = calibrationEvaluationService.buildCalibrationReport(evaluationRecords, {
      scoringVersion: 'scoringV0326',
      promptSourceSummary: extractPromptSourceSummary(sortedSessions),
      stabilityMetrics: {
        repeatedRunMeanAgreement: agreementAnalysis?.summary?.meanAgreement ?? null,
        repeatedRunFlipRate: microItemFlipRate?.overall?.flipRate ?? null,
        repeatedRunEvidenceDrift: evidenceDrift?.overall?.averageDrift ?? null
      }
    });

    return {
      schema: 'ielts-repeated-run-export',
      version: 1,
      generatedAt: new Date().toISOString(),
      runCount: sortedSessions.length,
      sessionMeta,
      bandVariation,
      microItemFlipRate,
      evidenceDrift,
      agreementAnalysis,
      calibration
    };
  }
};

module.exports = repeatedRunAnalysisService;
