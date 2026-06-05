#!/usr/bin/env node
/**
 * Compare two IELTS scoring export/session JSON files and report score-impact deltas.
 *
 * Usage:
 *   node scripts/ielts/scoringPatchImpactReport.js --before <path> --after <path>
 *   node scripts/ielts/scoringPatchImpactReport.js --before a.json --after b.json --out report.json --top 25
 */

const fs = require('fs');
const path = require('path');
const { evaluateRowPassResult } = require('../../packages/ielts/MVC/services/ielts/answerContractUtils');

function parseArgs(argv) {
  const args = { before: '', after: '', out: '', top: 20 };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    const next = argv[i + 1];
    if (token === '--before' && next) {
      args.before = String(next).trim();
      i += 1;
      continue;
    }
    if (token === '--after' && next) {
      args.after = String(next).trim();
      i += 1;
      continue;
    }
    if (token === '--out' && next) {
      args.out = String(next).trim();
      i += 1;
      continue;
    }
    if (token === '--top' && next) {
      const n = Number.parseInt(next, 10);
      if (Number.isFinite(n) && n > 0) args.top = n;
      i += 1;
      continue;
    }
  }
  return args;
}

function die(message) {
  // eslint-disable-next-line no-console
  console.error(`[impact] ${message}`);
  process.exit(1);
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeKeyToken(value) {
  return normalizeText(value).toLowerCase();
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readJsonFile(filePath) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    die(`File not found: ${absPath}`);
  }
  const raw = fs.readFileSync(absPath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    die(`Invalid JSON in ${absPath}: ${error.message}`);
  }
}

function extractSessions(payload) {
  if (Array.isArray(payload)) return payload.slice();
  if (!payload || typeof payload !== 'object') return [];

  const candidates = [
    payload.sessions,
    payload.data,
    payload.rows,
    payload.items,
    payload?.data?.sessions,
    payload?.data?.items
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.slice();
  }

  if (payload.steps && typeof payload.steps === 'object') {
    return [payload];
  }

  return [];
}

function extractSampleId(session) {
  return normalizeText(
    session?.sampleId ||
    session?.metadata?.sampleId ||
    session?.steps?.step1freeze?.response?.json?.meta?.sampleId
  );
}

function extractSampleName(session) {
  const direct = normalizeText(session?.sampleName);
  const metadataName = normalizeText(session?.metadata?.sampleName || session?.metadata?.sampleRefName);
  const stepName = normalizeText(session?.steps?.step1freeze?.response?.json?.meta?.sampleName);
  return direct || metadataName || stepName || '';
}

function extractModelUsed(session, stepKey) {
  return normalizeText(
    session?.steps?.[stepKey]?.response?.json?.data?.meta?.modelUsed ||
    session?.steps?.[stepKey]?.response?.json?.meta?.modelUsed
  );
}

function extractSavedAt(session) {
  return normalizeText(
    session?.savedAt ||
    session?.metadata?.savedAt ||
    session?.audit?.lastUpdateDateTime ||
    session?.audit?.createDateTime
  );
}

function extractOverallBand(session) {
  return toNumberOrNull(
    session?.overallBand ??
    session?.steps?.step4grade?.response?.json?.data?.overallBand ??
    session?.steps?.step4grade?.response?.json?.data?.overall?.band
  );
}

function extractCriteria(session) {
  const source = session?.steps?.step4grade?.response?.json?.data || {};
  const criteria = source?.criteria || {};
  return {
    TR: toNumberOrNull(criteria.TR),
    CC: toNumberOrNull(criteria.CC),
    LR: toNumberOrNull(criteria.LR),
    GRA: toNumberOrNull(criteria.GRA)
  };
}

function extractExaminerOverall(session) {
  return toNumberOrNull(
    session?.examinerBandScore ??
    session?.metadata?.examinerBandScore ??
    session?.steps?.step1freeze?.response?.json?.meta?.sampleBandScore
  );
}

function extractStep4RequestProfile(session) {
  const payload = session?.steps?.step4grade?.request?.payload || {};
  const options = payload?.options || payload?.gradingOptions || {};
  return {
    batchSize: toNumberOrNull(options?.batchSize),
    concurrency: toNumberOrNull(options?.concurrency),
    retryLimit: toNumberOrNull(options?.step4RetryLimit ?? options?.aiRetryLimit),
    retryBackoffMs: toNumberOrNull(options?.step4RetryBackoffMs ?? options?.aiRetryBackoffMs),
    retryBackoffMultiplier: toNumberOrNull(options?.step4RetryBackoffMultiplier ?? options?.aiRetryBackoffMultiplier),
    retryBackoffMaxMs: toNumberOrNull(options?.step4RetryBackoffMaxMs ?? options?.aiRetryBackoffMaxMs),
    timeoutMs: toNumberOrNull(options?.step4TimeoutMs ?? options?.timeoutMs),
    providerId: normalizeText(options?.providerId || payload?.providerId || ''),
    apiProviderId: normalizeText(options?.apiProviderId || payload?.apiProviderId || ''),
    modelId: normalizeText(payload?.modelId || options?.modelId || '')
  };
}

function buildSessionIdentity(session) {
  const sampleId = extractSampleId(session);
  const sampleName = extractSampleName(session);
  const step3Model = extractModelUsed(session, 'step3extract');
  const step4Model = extractModelUsed(session, 'step4grade');
  const sampleKey = normalizeKeyToken(sampleId || sampleName || 'unknown_sample');
  const strictKey = `${sampleKey}::${normalizeKeyToken(step3Model || 'na')}::${normalizeKeyToken(step4Model || 'na')}`;
  const looseKey = sampleKey;

  return {
    sampleId: sampleId || null,
    sampleName: sampleName || null,
    step3Model: step3Model || null,
    step4Model: step4Model || null,
    sampleKey,
    strictKey,
    looseKey,
    savedAt: extractSavedAt(session) || null,
    overallBand: extractOverallBand(session),
    examinerBand: extractExaminerOverall(session),
    criteria: extractCriteria(session),
    step4RequestProfile: extractStep4RequestProfile(session)
  };
}

function extractStep4Rows(session) {
  const step4Data = session?.steps?.step4grade?.response?.json?.data || {};
  const aggregated = Array.isArray(step4Data?.aggregatedResults) ? step4Data.aggregatedResults : [];
  if (aggregated.length) return aggregated;
  const results = Array.isArray(step4Data?.results) ? step4Data.results : [];
  return results;
}

function rowIdentity(row) {
  const baseKey = normalizeText(row?.baseKey || row?.question_key || row?.instanceKey);
  if (baseKey) return baseKey;
  return normalizeText(row?.atomic_question || row?.rubric_anchor || 'unknown_row');
}

function buildRowMap(session) {
  const map = new Map();
  const rows = extractStep4Rows(session);
  for (const row of rows) {
    const key = rowIdentity(row);
    if (!key) continue;
    const passResult = evaluateRowPassResult(row);
    map.set(key, {
      key,
      criterion: normalizeText(row?.criterion || ''),
      band: toNumberOrNull(row?.band),
      value: normalizeText(row?.value || ''),
      evaluated: passResult.evaluated === true,
      pass: passResult.evaluated ? passResult.pass === true : null,
      scoringMode: normalizeText(passResult.scoringMode || ''),
      source: normalizeText(row?.source || ''),
      row
    });
  }
  return map;
}

function sortSessions(sessions) {
  return (Array.isArray(sessions) ? sessions : []).slice().sort((a, b) => {
    const ta = Date.parse(extractSavedAt(a)) || 0;
    const tb = Date.parse(extractSavedAt(b)) || 0;
    return ta - tb;
  });
}

function indexByKey(summaries, keyName) {
  const map = new Map();
  for (const summary of summaries) {
    const key = summary?.identity?.[keyName];
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(summary);
  }
  for (const rows of map.values()) {
    rows.sort((a, b) => {
      const ta = Date.parse(a?.identity?.savedAt || '') || 0;
      const tb = Date.parse(b?.identity?.savedAt || '') || 0;
      return ta - tb;
    });
  }
  return map;
}

function pairSessions(beforeSummaries, afterSummaries) {
  const pairs = [];
  const usedBefore = new Set();
  const usedAfter = new Set();

  const strictBefore = indexByKey(beforeSummaries, 'strictKey');
  const strictAfter = indexByKey(afterSummaries, 'strictKey');
  for (const [key, bRows] of strictBefore.entries()) {
    const aRows = strictAfter.get(key);
    if (!aRows || !aRows.length) continue;
    const count = Math.min(bRows.length, aRows.length);
    for (let i = 0; i < count; i += 1) {
      const before = bRows[i];
      const after = aRows[i];
      pairs.push({ before, after, matchType: 'strict' });
      usedBefore.add(before.__id);
      usedAfter.add(after.__id);
    }
  }

  const remainingBefore = beforeSummaries.filter((row) => !usedBefore.has(row.__id));
  const remainingAfter = afterSummaries.filter((row) => !usedAfter.has(row.__id));
  const looseBefore = indexByKey(remainingBefore, 'looseKey');
  const looseAfter = indexByKey(remainingAfter, 'looseKey');
  for (const [key, bRows] of looseBefore.entries()) {
    const aRows = looseAfter.get(key);
    if (!aRows || !aRows.length) continue;
    const count = Math.min(bRows.length, aRows.length);
    for (let i = 0; i < count; i += 1) {
      const before = bRows[i];
      const after = aRows[i];
      pairs.push({ before, after, matchType: 'loose' });
      usedBefore.add(before.__id);
      usedAfter.add(after.__id);
    }
  }

  return {
    pairs,
    unmatchedBefore: beforeSummaries.filter((row) => !usedBefore.has(row.__id)),
    unmatchedAfter: afterSummaries.filter((row) => !usedAfter.has(row.__id))
  };
}

function compareCriteria(beforeCriteria, afterCriteria) {
  const out = {};
  ['TR', 'CC', 'LR', 'GRA'].forEach((criterion) => {
    const before = toNumberOrNull(beforeCriteria?.[criterion]);
    const after = toNumberOrNull(afterCriteria?.[criterion]);
    out[criterion] = {
      before,
      after,
      delta: Number.isFinite(before) && Number.isFinite(after) ? Number((after - before).toFixed(4)) : null
    };
  });
  return out;
}

function compareRows(beforeMap, afterMap) {
  const allKeys = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const valueChanged = [];
  const passChanged = [];
  const newlyUnevaluable = [];
  const newlyEvaluable = [];

  for (const key of allKeys) {
    const b = beforeMap.get(key) || null;
    const a = afterMap.get(key) || null;
    if (!b || !a) continue;
    if (normalizeKeyToken(b.value) !== normalizeKeyToken(a.value)) {
      valueChanged.push(key);
    }
    if (b.evaluated === true && a.evaluated === true) {
      if (b.pass !== a.pass) passChanged.push(key);
    } else if (b.evaluated === true && a.evaluated !== true) {
      newlyUnevaluable.push(key);
    } else if (b.evaluated !== true && a.evaluated === true) {
      newlyEvaluable.push(key);
    }
  }

  return {
    comparedKeyCount: allKeys.size,
    valueChanged,
    passChanged,
    newlyUnevaluable,
    newlyEvaluable
  };
}

function buildSessionSummary(session, id) {
  return {
    __id: id,
    session,
    identity: buildSessionIdentity(session),
    rows: buildRowMap(session)
  };
}

function aggregateTopKeys(pairReports, fieldName, topN) {
  const counter = new Map();
  pairReports.forEach((report) => {
    const keys = report?.rowImpact?.[fieldName] || [];
    keys.forEach((key) => {
      counter.set(key, (counter.get(key) || 0) + 1);
    });
  });
  return Array.from(counter.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, topN);
}

function buildReport(beforePayload, afterPayload, options = {}) {
  const beforeSessions = sortSessions(extractSessions(beforePayload));
  const afterSessions = sortSessions(extractSessions(afterPayload));

  const beforeSummaries = beforeSessions.map((session, index) => buildSessionSummary(session, `before_${index}`));
  const afterSummaries = afterSessions.map((session, index) => buildSessionSummary(session, `after_${index}`));

  const paired = pairSessions(beforeSummaries, afterSummaries);
  const pairReports = paired.pairs.map((pair) => {
    const before = pair.before;
    const after = pair.after;
    const beforeOverall = before.identity.overallBand;
    const afterOverall = after.identity.overallBand;
    const overallDelta = Number.isFinite(beforeOverall) && Number.isFinite(afterOverall)
      ? Number((afterOverall - beforeOverall).toFixed(4))
      : null;
    const criteriaDelta = compareCriteria(before.identity.criteria, after.identity.criteria);
    const rowImpact = compareRows(before.rows, after.rows);

    return {
      matchType: pair.matchType,
      sampleId: after.identity.sampleId || before.identity.sampleId,
      sampleName: after.identity.sampleName || before.identity.sampleName,
      beforeSavedAt: before.identity.savedAt || null,
      afterSavedAt: after.identity.savedAt || null,
      step3ModelBefore: before.identity.step3Model,
      step3ModelAfter: after.identity.step3Model,
      step4ModelBefore: before.identity.step4Model,
      step4ModelAfter: after.identity.step4Model,
      step4RequestProfileBefore: before.identity.step4RequestProfile || null,
      step4RequestProfileAfter: after.identity.step4RequestProfile || null,
      examinerBand: after.identity.examinerBand ?? before.identity.examinerBand ?? null,
      overallBand: {
        before: beforeOverall,
        after: afterOverall,
        delta: overallDelta
      },
      criteria: criteriaDelta,
      rowImpact
    };
  });

  const overallDeltaDistribution = {};
  pairReports.forEach((row) => {
    const delta = row?.overallBand?.delta;
    const key = Number.isFinite(delta) ? String(delta) : 'n/a';
    overallDeltaDistribution[key] = (overallDeltaDistribution[key] || 0) + 1;
  });

  const report = {
    generatedAt: new Date().toISOString(),
    schema: 'ielts-scoring-patch-impact-report-v1',
    input: {
      beforeSessionCount: beforeSessions.length,
      afterSessionCount: afterSessions.length
    },
    pairing: {
      pairedCount: paired.pairs.length,
      strictPairs: paired.pairs.filter((row) => row.matchType === 'strict').length,
      loosePairs: paired.pairs.filter((row) => row.matchType === 'loose').length,
      unmatchedBeforeCount: paired.unmatchedBefore.length,
      unmatchedAfterCount: paired.unmatchedAfter.length,
      unmatchedBefore: paired.unmatchedBefore.slice(0, 20).map((row) => row.identity),
      unmatchedAfter: paired.unmatchedAfter.slice(0, 20).map((row) => row.identity)
    },
    summary: {
      overallDeltaDistribution,
      topPassImpactKeys: aggregateTopKeys(pairReports, 'passChanged', options.top || 20),
      topValueChangedKeys: aggregateTopKeys(pairReports, 'valueChanged', options.top || 20),
      topNewlyUnevaluableKeys: aggregateTopKeys(pairReports, 'newlyUnevaluable', options.top || 20)
    },
    pairReports
  };

  return report;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.before || !args.after) {
    die('Usage: node scripts/ielts/scoringPatchImpactReport.js --before <path> --after <path> [--out <path>] [--top <n>]');
  }

  const beforePayload = readJsonFile(args.before);
  const afterPayload = readJsonFile(args.after);
  const report = buildReport(beforePayload, afterPayload, { top: args.top });

  if (args.out) {
    const outPath = path.resolve(args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    // eslint-disable-next-line no-console
    console.log(`[impact] report written: ${outPath}`);
  }

  // eslint-disable-next-line no-console
  console.log(`[impact] paired=${report.pairing.pairedCount} strict=${report.pairing.strictPairs} loose=${report.pairing.loosePairs} unmatchedBefore=${report.pairing.unmatchedBeforeCount} unmatchedAfter=${report.pairing.unmatchedAfterCount}`);
  // eslint-disable-next-line no-console
  console.log(`[impact] top pass-impact keys: ${(report.summary.topPassImpactKeys || []).slice(0, 8).map((row) => `${row.key}(${row.count})`).join(', ') || '(none)'}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildReport,
  parseArgs
};

