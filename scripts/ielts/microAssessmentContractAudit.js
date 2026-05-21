#!/usr/bin/env node
/**
 * IELTS Micro-Assessment explicit answer-contract audit/migration utility.
 *
 * Usage:
 *   node scripts/ielts/microAssessmentContractAudit.js
 *   node scripts/ielts/microAssessmentContractAudit.js --apply
 *   node scripts/ielts/microAssessmentContractAudit.js --report data/ielts/microAssessments.contract-audit.report.json
 */

const fs = require('fs');
const path = require('path');
const { getActiveDataBackendMode } = require('../../MVC/infrastructure/runtime/dataBackendRuntime');
const { connectMongo, disconnectMongo, getMongoCollection } = require('../../MVC/infrastructure/mongo/mongoConnection');

const STATUS = {
  COMPLETE_EXPLICIT_CONTRACT: 'COMPLETE_EXPLICIT_CONTRACT',
  MISSING_SCORED_ANSWERS: 'MISSING_SCORED_ANSWERS',
  MISSING_NOT_SCORED_ANSWERS: 'MISSING_NOT_SCORED_ANSWERS',
  MISSING_BOTH: 'MISSING_BOTH',
  INVALID_OVERLAP: 'INVALID_OVERLAP',
  INVALID_FOR_ANSWER_TYPE: 'INVALID_FOR_ANSWER_TYPE',
  AMBIGUOUS_REQUIRES_REVIEW: 'AMBIGUOUS_REQUIRES_REVIEW'
};

const NEGATIVE_KEYWORDS = [
  'limited', 'unclear', 'inadequate', 'irrelevant', 'repetitive', 'lack', 'error',
  'fault', 'faulty', 'mechanical', 'not always clear', 'not sufficiently', 'uneven',
  'inaccurate', 'misuse', 'under-use', 'over-use', 'rarely', 'difficulty', 'difficult', 'problem', 'issue', 'fails to',
  'absent', 'missing', 'no conclusion', 'inappropriate', 'does not', 'cannot', 'unable',
  'barely', 'very little', 'no position', 'no clear position', 'no real development',
  'largely undeveloped', 'largely irrelevant', 'not organised logically', 'not well supported', 'not always logical',
  'overgeneralise', 'overgeneralize', 'tendency to overgeneralise', 'tendency to overgeneralize',
  'memorised phrases', 'isolated words', 'completely unrelated',
  'predominate', 'predominates', 'distort meaning', 'severely distort',
  'partial', 'partially', 'tangential', 'superficial', 'underdeveloped', 'under-developed', 'only briefly'
];

const NEGATIVE_FAULT_PATTERNS = [
  /\bis\s+no\b/i,
  /\bno\s+clear\b/i,
  /\bdoes\s+the\s+response\s+barely\b/i,
  /\bvery\s+little\b/i,
  /\bvery\s+limited\b/i,
  /\bfails?\s+to\b/i,
  /\bcan(?:\s+the\s+writer)?\s+not\b/i,
  /\bnot\s+use\b/i,
  /\bexcept\s+in\s+memor(?:i|y)sed\s+phrases\b/i,
  /\bonly\s+a\s+few\s+isolated\s+words\b/i,
  /\bcompletely\s+unrelated\b/i,
  /\bseverely\s+distort\b/i,
  /\blargely\s+undeveloped\b/i,
  /\blargely\s+irrelevant\b/i
];

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DATA_PATH = path.join(PROJECT_ROOT, 'data', 'ielts', 'microAssessments.json');
const DEFAULT_REPORT_PATH = path.join(PROJECT_ROOT, 'data', 'ielts', 'microAssessments.contract-audit.report.json');
const DEFAULT_SOURCE = 'auto';

function normalizeToken(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function parseTokenList(raw) {
  let values = [];
  if (Array.isArray(raw)) {
    values = raw;
  } else if (typeof raw === 'string') {
    values = raw
      .split(/[,;\n|]+/g)
      .map((v) => v.trim())
      .filter(Boolean);
  } else if (raw !== undefined && raw !== null) {
    values = [raw];
  }

  const seen = new Set();
  const out = [];
  for (const value of values) {
    const n = normalizeToken(value);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function parseAnswerTypeMeta(answerType) {
  const raw = String(answerType || '').trim();
  const lowered = raw.toLowerCase();
  if (!raw) {
    return {
      kind: 'unknown',
      optionsNormalized: [],
      optionDisplayByNormalized: {},
      parseable: false
    };
  }

  if (lowered.startsWith('boolean')) {
    return {
      kind: 'boolean',
      optionsNormalized: ['yes', 'no'],
      optionDisplayByNormalized: { yes: 'Yes', no: 'No' },
      parseable: true
    };
  }

  const match = raw.match(/\(([^)]+)\)/);
  if (!match) {
    return {
      kind: lowered.startsWith('categorical') ? 'categorical' : (lowered.startsWith('ordinal') ? 'ordinal' : 'unknown'),
      optionsNormalized: [],
      optionDisplayByNormalized: {},
      parseable: false
    };
  }

  const optionsRaw = match[1]
    .split(/[\/|,]+/g)
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  const optionsNormalized = [];
  const optionDisplayByNormalized = {};
  for (const option of optionsRaw) {
    const n = normalizeToken(option);
    if (!n) continue;
    if (!optionDisplayByNormalized[n]) optionDisplayByNormalized[n] = option;
    if (!optionsNormalized.includes(n)) optionsNormalized.push(n);
  }
  return {
    kind: lowered.startsWith('categorical') ? 'categorical' : (lowered.startsWith('ordinal') ? 'ordinal' : 'typed'),
    optionsNormalized,
    optionDisplayByNormalized,
    parseable: optionsNormalized.length > 0
  };
}

function normalizePolarity(raw) {
  const token = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '_');
  if (!token) return null;
  if (['FAULT_CHECK', 'FAULT', 'NEGATIVE'].includes(token)) return 'FAULT_CHECK';
  if (['FEATURE_CHECK', 'FEATURE', 'POSITIVE'].includes(token)) return 'FEATURE_CHECK';
  return null;
}

function isFaultStylePrompt(questionText, rubricAnchor) {
  const text = `${String(questionText || '')} ${String(rubricAnchor || '')}`.toLowerCase();
  if (NEGATIVE_KEYWORDS.some((token) => text.includes(token))) return true;
  return NEGATIVE_FAULT_PATTERNS.some((pattern) => pattern.test(text));
}

function inferBooleanDirection(row) {
  const explicit = normalizePolarity(
    row?.polarity ??
    row?.questionPolarity ??
    row?.polarityType ??
    row?.signalPolarity ??
    row?.polarity_hint
  );
  if (explicit === 'FAULT_CHECK') return 'fault';
  if (explicit === 'FEATURE_CHECK') return 'feature';
  if (isFaultStylePrompt(row?.atomic_question, row?.rubric_anchor)) return 'fault';
  return null;
}

function formatDisplayToken(token, meta, displayHints = {}) {
  const normalized = normalizeToken(token);
  if (!normalized) return '';
  if (displayHints[normalized]) return displayHints[normalized];
  if (meta?.optionDisplayByNormalized && meta.optionDisplayByNormalized[normalized]) {
    return meta.optionDisplayByNormalized[normalized];
  }
  if (normalized === 'yes') return 'Yes';
  if (normalized === 'no') return 'No';
  return String(token);
}

function buildDisplayHints(row) {
  const hints = {};
  for (const value of (Array.isArray(row?.scoredAnswers) ? row.scoredAnswers : [])) {
    const n = normalizeToken(value);
    if (n && !hints[n]) hints[n] = String(value);
  }
  for (const value of (Array.isArray(row?.notScoredAnswers) ? row.notScoredAnswers : [])) {
    const n = normalizeToken(value);
    if (n && !hints[n]) hints[n] = String(value);
  }
  return hints;
}

function classifyRowContract(row, meta) {
  const scored = parseTokenList(row?.scoredAnswers);
  const notScored = parseTokenList(row?.notScoredAnswers);
  const scoredSet = new Set(scored);
  const overlap = notScored.filter((token) => scoredSet.has(token));

  if (overlap.length > 0) {
    return {
      status: STATUS.INVALID_OVERLAP,
      scored,
      notScored,
      issues: [{ type: STATUS.INVALID_OVERLAP, detail: overlap }]
    };
  }

  if (!scored.length && !notScored.length) {
    return {
      status: STATUS.MISSING_BOTH,
      scored,
      notScored,
      issues: [{ type: STATUS.MISSING_BOTH }]
    };
  }
  if (!scored.length) {
    return {
      status: STATUS.MISSING_SCORED_ANSWERS,
      scored,
      notScored,
      issues: [{ type: STATUS.MISSING_SCORED_ANSWERS }]
    };
  }
  if (!notScored.length) {
    return {
      status: STATUS.MISSING_NOT_SCORED_ANSWERS,
      scored,
      notScored,
      issues: [{ type: STATUS.MISSING_NOT_SCORED_ANSWERS }]
    };
  }

  if (!meta.parseable || !meta.optionsNormalized.length) {
    return {
      status: STATUS.AMBIGUOUS_REQUIRES_REVIEW,
      scored,
      notScored,
      issues: [{ type: STATUS.AMBIGUOUS_REQUIRES_REVIEW, detail: 'Unparseable answer_type options' }]
    };
  }

  const allowed = new Set(meta.optionsNormalized);
  const invalidTokens = [...scored, ...notScored].filter((token) => !allowed.has(token));
  if (invalidTokens.length > 0) {
    return {
      status: STATUS.INVALID_FOR_ANSWER_TYPE,
      scored,
      notScored,
      issues: [{ type: STATUS.INVALID_FOR_ANSWER_TYPE, detail: Array.from(new Set(invalidTokens)) }]
    };
  }

  return {
    status: STATUS.COMPLETE_EXPLICIT_CONTRACT,
    scored,
    notScored,
    issues: []
  };
}

function maybePatchRowContract(row, meta, classification) {
  const currentStatus = classification.status;
  if (
    currentStatus === STATUS.COMPLETE_EXPLICIT_CONTRACT ||
    currentStatus === STATUS.AMBIGUOUS_REQUIRES_REVIEW ||
    currentStatus === STATUS.INVALID_OVERLAP ||
    currentStatus === STATUS.INVALID_FOR_ANSWER_TYPE
  ) {
    return null;
  }

  const scored = classification.scored.slice();
  const notScored = classification.notScored.slice();
  const options = meta.optionsNormalized.slice();
  const optionSet = new Set(options);

  const complementWithinOptions = (list) => options.filter((token) => !new Set(list).has(token));

  if (currentStatus === STATUS.MISSING_SCORED_ANSWERS) {
    if (options.length > 0 && notScored.every((token) => optionSet.has(token))) {
      const derived = complementWithinOptions(notScored);
      if (derived.length > 0) {
        return {
          scored: derived,
          notScored
        };
      }
    }
    return null;
  }

  if (currentStatus === STATUS.MISSING_NOT_SCORED_ANSWERS) {
    if (options.length > 0 && scored.every((token) => optionSet.has(token))) {
      const derived = complementWithinOptions(scored);
      if (derived.length > 0) {
        return {
          scored,
          notScored: derived
        };
      }
    }
    return null;
  }

  if (currentStatus === STATUS.MISSING_BOTH) {
    if (meta.kind === 'boolean') {
      const direction = inferBooleanDirection(row);
      if (direction === 'fault') {
        return {
          scored: ['no'],
          notScored: ['yes']
        };
      }
      if (direction === 'feature') {
        return {
          scored: ['yes'],
          notScored: ['no']
        };
      }
      return null;
    }
    return null;
  }
  return null;
}

function toDisplayList(tokens, row, meta) {
  const hints = buildDisplayHints(row);
  return (tokens || [])
    .map((token) => formatDisplayToken(token, meta, hints))
    .filter(Boolean);
}

function summarizeByCriterion(activeRows, field) {
  const out = { TR: {}, CC: {}, LR: {}, GRA: {}, General: {} };
  for (const row of activeRows) {
    const criterion = ['TR', 'CC', 'LR', 'GRA'].includes(String(row?.criterion || '').toUpperCase())
      ? String(row.criterion).toUpperCase()
      : 'General';
    const status = row[field];
    if (!out[criterion][status]) out[criterion][status] = 0;
    out[criterion][status] += 1;
  }
  return out;
}

function buildStatusCounts(rows, field) {
  const out = {
    [STATUS.COMPLETE_EXPLICIT_CONTRACT]: 0,
    [STATUS.MISSING_SCORED_ANSWERS]: 0,
    [STATUS.MISSING_NOT_SCORED_ANSWERS]: 0,
    [STATUS.MISSING_BOTH]: 0,
    [STATUS.INVALID_OVERLAP]: 0,
    [STATUS.INVALID_FOR_ANSWER_TYPE]: 0,
    [STATUS.AMBIGUOUS_REQUIRES_REVIEW]: 0
  };
  for (const row of rows) {
    const value = row[field];
    if (!out[value]) out[value] = 0;
    out[value] += 1;
  }
  return out;
}

function auditMicroAssessmentContracts(rows, options = {}) {
  const applyPatches = options.applyPatches === true;
  const cloned = JSON.parse(JSON.stringify(Array.isArray(rows) ? rows : []));
  const patchedRows = [];
  const activeRows = [];

  for (const row of cloned) {
    const isActive = row?.is_active !== false;
    if (!isActive) continue;

    const meta = parseAnswerTypeMeta(row?.answer_type);
    const before = classifyRowContract(row, meta);
    let afterStatus = before.status;
    let afterIssues = before.issues.slice();
    let afterScored = before.scored.slice();
    let afterNotScored = before.notScored.slice();

    if (applyPatches) {
      const patch = maybePatchRowContract(row, meta, before);
      if (patch) {
        row.scoredAnswers = toDisplayList(patch.scored, row, meta);
        row.notScoredAnswers = toDisplayList(patch.notScored, row, meta);
        patchedRows.push({
          id: row.id || null,
          baseKey: row.baseKey || row.question_key || '',
          criterion: row.criterion || 'General',
          answer_type: row.answer_type || '',
          previousStatus: before.status,
          patchedScoredAnswers: row.scoredAnswers,
          patchedNotScoredAnswers: row.notScoredAnswers
        });
      }
    }

    const after = classifyRowContract(row, meta);
    afterStatus = after.status;
    afterIssues = after.issues.slice();
    afterScored = after.scored.slice();
    afterNotScored = after.notScored.slice();

    activeRows.push({
      id: row.id || null,
      baseKey: row.baseKey || row.question_key || '',
      question_key: row.question_key || row.baseKey || '',
      criterion: row.criterion || 'General',
      band: row.band,
      scope: row.scope || 'essay',
      answer_type: row.answer_type || '',
      statusBefore: before.status,
      statusAfter: afterStatus,
      scoredAnswersNormalized: afterScored,
      notScoredAnswersNormalized: afterNotScored,
      issues: afterIssues
    });
  }

  const statusCountsBefore = buildStatusCounts(activeRows, 'statusBefore');
  const statusCountsAfter = buildStatusCounts(activeRows, 'statusAfter');
  const invalidRows = activeRows.filter((row) => (
    row.statusAfter === STATUS.INVALID_OVERLAP || row.statusAfter === STATUS.INVALID_FOR_ANSWER_TYPE
  ));
  const ambiguousRows = activeRows.filter((row) => row.statusAfter === STATUS.AMBIGUOUS_REQUIRES_REVIEW);
  const fallbackRows = activeRows.filter((row) => row.statusAfter !== STATUS.COMPLETE_EXPLICIT_CONTRACT);

  const report = {
    generatedAt: new Date().toISOString(),
    mode: applyPatches ? 'apply' : 'dry_run',
    totalRows: cloned.length,
    totalActiveRows: activeRows.length,
    statusCountsBefore,
    statusCountsAfter,
    completeRows: statusCountsAfter[STATUS.COMPLETE_EXPLICIT_CONTRACT] || 0,
    rowsNeedingPatch: (
      (statusCountsAfter[STATUS.MISSING_SCORED_ANSWERS] || 0) +
      (statusCountsAfter[STATUS.MISSING_NOT_SCORED_ANSWERS] || 0) +
      (statusCountsAfter[STATUS.MISSING_BOTH] || 0)
    ),
    invalidRows: invalidRows.length,
    ambiguousRows: ambiguousRows.length,
    byCriterion: summarizeByCriterion(activeRows, 'statusAfter'),
    rowsPatchedCount: patchedRows.length,
    rowsPatched: patchedRows,
    rowsStillRelyingOnFallbackPolarity: fallbackRows.map((row) => ({
      baseKey: row.baseKey,
      criterion: row.criterion,
      band: row.band,
      scope: row.scope,
      answer_type: row.answer_type,
      status: row.statusAfter,
      issues: row.issues
    })),
    rowsRequiringManualReview: ambiguousRows.map((row) => ({
      baseKey: row.baseKey,
      criterion: row.criterion,
      band: row.band,
      scope: row.scope,
      answer_type: row.answer_type,
      issues: row.issues
    })),
    malformedAnswerTypeRows: invalidRows
      .filter((row) => row.statusAfter === STATUS.INVALID_FOR_ANSWER_TYPE)
      .map((row) => ({
        baseKey: row.baseKey,
        criterion: row.criterion,
        answer_type: row.answer_type,
        issues: row.issues
      })),
    sampleIssues: [...invalidRows, ...ambiguousRows, ...fallbackRows]
      .slice(0, 30)
      .map((row) => ({
        baseKey: row.baseKey,
        criterion: row.criterion,
        status: row.statusAfter,
        issues: row.issues
      })),
    activeRows
  };

  return { patchedRowsData: cloned, report };
}

function parseArgValue(argv, name, fallback = null) {
  const idx = argv.indexOf(name);
  if (idx < 0) return fallback;
  const value = argv[idx + 1];
  if (value === undefined || value.startsWith('--')) return fallback;
  return value;
}

function normalizeAuditSource(value) {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'mongo') return 'mongo';
  if (token === 'file') return 'file';
  return 'auto';
}

function normalizeMongoRow(row) {
  if (!row || typeof row !== 'object') return row;
  const copy = { ...row };
  if (!copy.id && copy._id) {
    copy.id = String(copy._id);
  }
  delete copy._id;
  return copy;
}

async function loadRowsForAudit({ source = DEFAULT_SOURCE, dataPath = DEFAULT_DATA_PATH } = {}) {
  const resolvedSource = normalizeAuditSource(source);
  const resolvedDataPath = path.resolve(dataPath);
  const backendMode = String(getActiveDataBackendMode() || '').trim().toLowerCase();

  const shouldTryMongo = (
    resolvedSource === 'mongo' ||
    (resolvedSource === 'auto' && backendMode === 'mongo')
  );

  if (shouldTryMongo) {
    try {
      await connectMongo();
      const rows = await getMongoCollection('ieltsMicroAssessments')
        .find({})
        .toArray();
      return {
        rows: rows.map(normalizeMongoRow).filter(Boolean),
        source: 'mongo',
        dataPath: null
      };
    } catch (error) {
      if (resolvedSource === 'mongo') {
        throw new Error(`Unable to load micro-assessments from Mongo: ${error.message}`);
      }
    } finally {
      try {
        await disconnectMongo();
      } catch (_) {}
    }
  }

  const rows = JSON.parse(fs.readFileSync(resolvedDataPath, 'utf8'));
  return {
    rows,
    source: 'file',
    dataPath: resolvedDataPath
  };
}

async function runCli() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const source = normalizeAuditSource(parseArgValue(argv, '--source', DEFAULT_SOURCE));
  const dataPath = path.resolve(parseArgValue(argv, '--data', DEFAULT_DATA_PATH));
  const reportPath = path.resolve(parseArgValue(argv, '--report', DEFAULT_REPORT_PATH));

  const loaded = await loadRowsForAudit({ source, dataPath });
  const rows = loaded.rows;
  if (apply && loaded.source === 'mongo') {
    throw new Error('Apply mode is currently supported for file source only. Re-run with --source file.');
  }
  const { patchedRowsData, report } = auditMicroAssessmentContracts(rows, { applyPatches: apply });
  report.dataSource = loaded.source;

  if (apply && report.rowsPatchedCount > 0 && loaded.source === 'file' && loaded.dataPath) {
    fs.writeFileSync(loaded.dataPath, `${JSON.stringify(patchedRowsData, null, 2)}\n`, 'utf8');
  }
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`[contract-audit] mode=${report.mode}`);
  console.log(`[contract-audit] source=${loaded.source}`);
  console.log(`[contract-audit] data=${loaded.dataPath || '(mongo:ieltsMicroAssessments)'}`);
  console.log(`[contract-audit] report=${reportPath}`);
  console.log(`[contract-audit] active=${report.totalActiveRows}`);
  console.log(`[contract-audit] complete=${report.completeRows}`);
  console.log(`[contract-audit] patched=${report.rowsPatchedCount}`);
  console.log(`[contract-audit] fallback_rows=${report.rowsStillRelyingOnFallbackPolarity.length}`);
  console.log(`[contract-audit] invalid=${report.invalidRows}`);
  console.log(`[contract-audit] ambiguous=${report.ambiguousRows}`);
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(`[contract-audit] error=${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  STATUS,
  normalizeToken,
  parseTokenList,
  parseAnswerTypeMeta,
  classifyRowContract,
  auditMicroAssessmentContracts,
  loadRowsForAudit,
  inferBooleanDirection,
  isFaultStylePrompt
};
