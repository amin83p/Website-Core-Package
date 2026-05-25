const {
  READING_MCQ_SINGLE_SCORER_VERSION,
  READING_MCQ_MULTIPLE_SCORER_VERSION,
  READING_TRUE_FALSE_SCORER_VERSION,
  READING_FILL_IN_BLANK_SCORER_VERSION,
  READING_WRITING_FILL_IN_BLANK_SCORER_VERSION,
  READING_REORDER_PARAGRAPHS_SCORER_VERSION,
  READING_MATCHING_SCORER_VERSION,
  getRubric
} = require('./pteScoringRubricRegistry');

const READING_TYPES = new Set([
  'reading_mcq_single',
  'reading_mcq_multiple',
  'reading_true_false',
  'reading_fill_in_blank',
  'reading_writing_fill_in_blank',
  'reading_reorder_paragraphs',
  'reading_matching'
]);

const READING_SCORING_CONTRACT_VERSION = 2;
const READING_MICRO_RUBRIC_VERSION = 'pte-reading-objective-micro-v1';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function s(value, max = 4000) {
  if (value === undefined || value === null) return '';
  const text = String(value).replace(/\0/g, '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function safeObject(value, fallback = {}) {
  return isPlainObject(value) ? value : fallback;
}

function round2(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Number(numeric.toFixed(2));
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const token = s(value, 20).toLowerCase();
  if (!token) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function normalizeWarnings(rows = []) {
  const source = Array.isArray(rows) ? rows : [rows];
  const out = [];
  const seen = new Set();
  source.forEach((row) => {
    const text = s(row, 500);
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(text);
  });
  return out;
}

function normalizeToken(value = '') {
  return s(value, 300).toLowerCase();
}

function normalizeTokenList(values = []) {
  const source = Array.isArray(values)
    ? values
    : String(values || '').split(/[\r\n,;]+/g);
  const out = [];
  const seen = new Set();
  source.forEach((value) => {
    const token = normalizeToken(value);
    if (!token || seen.has(token)) return;
    seen.add(token);
    out.push(token);
  });
  return out;
}

function formatScoreNumber(value) {
  const numeric = toFiniteNumber(value, 0);
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
}

function normalizeAnswerText(value = '', caseSensitive = false) {
  let text = s(value, 1000)
    .replace(/\s+/g, ' ')
    .replace(/^[`"'(\[]+|[`"')\].,;:!?]+$/g, '')
    .trim();
  if (!caseSensitive) text = text.toLowerCase();
  return text;
}

function extractJsonPayload(input = '') {
  const text = s(input, 200000);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    // Continue with fenced and object extraction.
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_) {
      // Continue with first-object extraction.
    }
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(text.slice(first, last + 1));
    } catch (_) {
      return null;
    }
  }
  return null;
}

function resolveQuestionPayload(question = {}, item = {}) {
  const metadata = safeObject(item?.metadata, {});
  const snapshotPayload = safeObject(metadata.questionSnapshot?.payload, {});
  if (Object.keys(snapshotPayload).length) return snapshotPayload;
  const storedPayload = safeObject(metadata.questionPayload || metadata.payload, {});
  if (Object.keys(storedPayload).length) return storedPayload;
  return safeObject(question?.payload, {});
}

function resolveResponsePayload(responsePayload = {}, item = {}) {
  const direct = safeObject(responsePayload, {});
  if (Object.keys(direct).length) return direct;
  const metadata = safeObject(item?.metadata, {});
  return safeObject(metadata.responsePayload, {});
}

function resolveConfiguredMaxScore(scoringConfig = {}, fallback = 1) {
  const configured = toFiniteNumber(scoringConfig?.maxScore, 0);
  if (configured > 0) return configured;
  return Math.max(0.000001, toFiniteNumber(fallback, 1) || 1);
}

function resolveScorerVersion(questionType = '') {
  if (questionType === 'reading_mcq_single') return READING_MCQ_SINGLE_SCORER_VERSION;
  if (questionType === 'reading_mcq_multiple') return READING_MCQ_MULTIPLE_SCORER_VERSION;
  if (questionType === 'reading_true_false') return READING_TRUE_FALSE_SCORER_VERSION;
  if (questionType === 'reading_fill_in_blank') return READING_FILL_IN_BLANK_SCORER_VERSION;
  if (questionType === 'reading_writing_fill_in_blank') return READING_WRITING_FILL_IN_BLANK_SCORER_VERSION;
  if (questionType === 'reading_reorder_paragraphs') return READING_REORDER_PARAGRAPHS_SCORER_VERSION;
  if (questionType === 'reading_matching') return READING_MATCHING_SCORER_VERSION;
  return '';
}

function traitDescriptor(value = 0, max = 1) {
  const ratio = max > 0 ? (toFiniteNumber(value, 0) / max) : 0;
  if (ratio >= 0.8) return 'Good';
  if (ratio >= 0.55) return 'Developing';
  return 'Needs work';
}

function resolveSelectedSingle(response = {}) {
  return normalizeToken(
    response.selectedSingle
      || response.selectedOptionKey
      || response.optionKey
      || response.selectedValue
      || ''
  );
}

function resolveSelectedMultiple(response = {}) {
  if (Array.isArray(response.selectedMultiple)) {
    return normalizeTokenList(response.selectedMultiple);
  }
  if (Array.isArray(response.selectedOptionKeys)) {
    return normalizeTokenList(response.selectedOptionKeys);
  }
  return normalizeTokenList(response.selectedMultiple || response.selectedOptionKeys || '');
}

function normalizeTrueFalseToken(value = '') {
  const token = normalizeToken(value)
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (token === 'true' || token === 't') return 'true';
  if (token === 'false' || token === 'f') return 'false';
  if (token === 'not_given' || token === 'notgiven' || token === 'ng') return 'not_given';
  return '';
}

function resolveSelectedTrueFalse(response = {}) {
  return normalizeTrueFalseToken(
    response.selectedTrueFalse
      || response.selectedValue
      || response.selectedSingle
      || ''
  );
}

function parseBlankResponseMapFromText(rawMapText = '') {
  const parsed = extractJsonPayload(rawMapText);
  if (!isPlainObject(parsed)) return {};
  return Object.entries(parsed).reduce((acc, [key, value]) => {
    const cleanKey = s(key, 120);
    if (!cleanKey) return acc;
    acc[cleanKey] = s(value, 300);
    return acc;
  }, {});
}

function resolveBlankResponseMap(response = {}) {
  const out = {};
  const mergeMap = (value) => {
    if (!isPlainObject(value)) return;
    Object.entries(value).forEach(([key, rawValue]) => {
      const cleanKey = s(key, 120);
      if (!cleanKey) return;
      out[cleanKey] = s(rawValue, 300);
    });
  };
  mergeMap(response.blankResponseMap);
  mergeMap(response.map);
  mergeMap(parseBlankResponseMapFromText(response.mapText || response.text || ''));
  return out;
}

function parseSubmittedOrderFromText(rawMapText = '', paragraphItems = []) {
  const source = s(rawMapText, 200000);
  if (!source) return [];
  const allowed = (Array.isArray(paragraphItems) ? paragraphItems : [])
    .map((row) => s(row, 5000))
    .filter(Boolean);
  const allowedSet = new Set(allowed);
  const normalizeRows = (rows = []) => {
    const used = new Set();
    const out = [];
    (Array.isArray(rows) ? rows : [])
      .map((row) => s(row, 5000))
      .filter(Boolean)
      .forEach((row) => {
        if (!allowedSet.has(row) || used.has(row)) return;
        used.add(row);
        out.push(row);
      });
    return out;
  };

  const parsed = extractJsonPayload(source);
  if (Array.isArray(parsed)) return normalizeRows(parsed);
  if (isPlainObject(parsed) && Array.isArray(parsed.submittedOrder)) {
    return normalizeRows(parsed.submittedOrder);
  }
  return normalizeRows(source.split(/\r?\n+/g));
}

function resolveExpectedVariants(expectedValue = '', allowSynonyms = false, caseSensitive = false) {
  const source = s(expectedValue, 500);
  if (!source) return [];
  const rows = allowSynonyms
    ? source.split(/\s*(?:\||;|\/)\s*/g)
    : [source];
  const out = [];
  const seen = new Set();
  rows.forEach((row) => {
    const normalized = normalizeAnswerText(row, caseSensitive);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  });
  return out;
}

function buildMicroResponse(id, choice, evidence, confidence = 1) {
  return {
    id: s(id, 120),
    choice: s(choice, 30) || 'unclear',
    evidence: s(evidence, 1200),
    confidence: round2(Math.min(1, Math.max(0, toFiniteNumber(confidence, 0))))
  };
}

function buildMatchingItemLookup(items = [], side = 'item') {
  const rows = Array.isArray(items) ? items : [];
  const itemMap = new Map();
  const aliasMap = new Map();

  const registerAlias = (alias = '', key = '') => {
    const token = normalizeToken(alias);
    const target = normalizeToken(key);
    if (!token || !target) return;
    if (!aliasMap.has(token)) aliasMap.set(token, target);
  };

  rows.forEach((row, index) => {
    const source = isPlainObject(row) ? row : {};
    const textValue = isPlainObject(row)
      ? (source.text ?? source.label ?? source.value ?? source.title ?? source.content ?? '')
      : row;
    const keyValue = source.key ?? source.id ?? source.code ?? source.valueKey ?? '';
    const rawKey = s(keyValue || textValue || `${side}_${index + 1}`, 300);
    const key = normalizeToken(rawKey);
    if (!key) return;
    const text = s(textValue, 700);
    if (!itemMap.has(key)) {
      itemMap.set(key, {
        key,
        rawKey,
        text
      });
    }
    registerAlias(rawKey, key);
    registerAlias(text, key);
    registerAlias(source.id, key);
    registerAlias(source.key, key);
    registerAlias(source.value, key);
  });

  return {
    itemMap,
    keySet: new Set(itemMap.keys()),
    aliasMap
  };
}

function resolveMatchingItemKey(rawValue, lookup = {}) {
  const token = normalizeToken(rawValue);
  if (!token) return '';
  const aliasMap = lookup.aliasMap instanceof Map ? lookup.aliasMap : new Map();
  const keySet = lookup.keySet instanceof Set ? lookup.keySet : new Set();
  if (aliasMap.has(token)) return aliasMap.get(token);
  if (keySet.has(token)) return token;
  return '';
}

function normalizePairEntry(rawPair, leftLookup = {}, rightLookup = {}) {
  let leftRaw = '';
  let rightRaw = '';

  if (Array.isArray(rawPair)) {
    leftRaw = rawPair[0];
    rightRaw = rawPair[1];
  } else if (isPlainObject(rawPair)) {
    leftRaw = rawPair.leftKey
      ?? rawPair.leftId
      ?? rawPair.left
      ?? rawPair.from
      ?? rawPair.source
      ?? rawPair.lhs
      ?? rawPair.leftItem
      ?? '';
    rightRaw = rawPair.rightKey
      ?? rawPair.rightId
      ?? rawPair.right
      ?? rawPair.to
      ?? rawPair.target
      ?? rawPair.rhs
      ?? rawPair.rightItem
      ?? '';

    if ((!leftRaw || !rightRaw) && Object.keys(rawPair).length === 1) {
      const [[key, value]] = Object.entries(rawPair);
      leftRaw = leftRaw || key;
      rightRaw = rightRaw || value;
    }
  } else if (typeof rawPair === 'string' || typeof rawPair === 'number' || typeof rawPair === 'boolean') {
    const token = s(rawPair, 2000);
    const separators = ['=>', '->', '|', ':', '=', ','];
    let matched = null;
    separators.some((separator) => {
      const index = token.indexOf(separator);
      if (index <= 0) return false;
      matched = {
        left: token.slice(0, index),
        right: token.slice(index + separator.length)
      };
      return true;
    });
    if (matched) {
      leftRaw = matched.left;
      rightRaw = matched.right;
    }
  }

  const leftKey = resolveMatchingItemKey(leftRaw, leftLookup);
  const rightKey = resolveMatchingItemKey(rightRaw, rightLookup);
  if (!leftKey || !rightKey) return null;
  return {
    leftKey,
    rightKey,
    pairToken: `${leftKey}|${rightKey}`
  };
}

function normalizePairsFromInput(input, leftLookup = {}, rightLookup = {}) {
  const out = [];
  const seen = new Set();
  const pushPair = (rawPair) => {
    const pair = normalizePairEntry(rawPair, leftLookup, rightLookup);
    if (!pair || seen.has(pair.pairToken)) return;
    seen.add(pair.pairToken);
    out.push(pair);
  };

  if (Array.isArray(input)) {
    input.forEach(pushPair);
    return out;
  }

  if (isPlainObject(input)) {
    if (Array.isArray(input.submittedPairs)) {
      input.submittedPairs.forEach(pushPair);
      return out;
    }
    Object.entries(input).forEach(([leftRaw, rightRaw]) => {
      pushPair({ left: leftRaw, right: rightRaw });
    });
    return out;
  }

  const text = s(input, 200000);
  if (!text) return out;
  const parsed = extractJsonPayload(text);
  if (parsed !== null) {
    return normalizePairsFromInput(parsed, leftLookup, rightLookup);
  }

  text
    .split(/\r?\n+/g)
    .map((row) => s(row, 2000))
    .filter(Boolean)
    .forEach(pushPair);
  return out;
}

function resolveSubmittedPairs(response = {}, leftLookup = {}, rightLookup = {}) {
  const fromStructured = normalizePairsFromInput(
    response.submittedPairs || response.pairs || [],
    leftLookup,
    rightLookup
  );
  if (fromStructured.length) return fromStructured;
  return normalizePairsFromInput(response.mapText || response.text || '', leftLookup, rightLookup);
}

function buildScorePayload(scoreFinal = 0, maxScore = 1) {
  const safeMax = Math.max(0.000001, toFiniteNumber(maxScore, 1) || 1);
  const safeScore = round2(toFiniteNumber(scoreFinal, 0));
  return {
    scoreRaw: safeScore,
    scoreFinal: safeScore,
    maxScore: round2(safeMax),
    percentage: round2((safeScore / safeMax) * 100),
    traitScores: {
      accuracy: safeScore
    }
  };
}

function evaluateMcqSingle({ payload = {}, response = {}, scoringConfig = {} } = {}) {
  const correctOptionKey = normalizeToken(payload.correctOptionKey || payload.correctOptionKeys?.[0] || '');
  if (!correctOptionKey) {
    return { ok: false, warnings: ['Reading MCQ Single scoring requires correctOptionKey in question payload.'] };
  }
  const selectedOptionKey = resolveSelectedSingle(response);
  const answered = Boolean(selectedOptionKey);
  const isCorrect = answered && selectedOptionKey === correctOptionKey;
  const maxScore = resolveConfiguredMaxScore(scoringConfig, 1);
  const negativeMarking = normalizeBoolean(scoringConfig.negativeMarking ?? payload.negativeMarking, false);
  const scoreFinal = isCorrect ? maxScore : ((negativeMarking && answered) ? -maxScore : 0);
  const warnings = answered ? [] : ['No option was selected for this MCQ Single response.'];
  return {
    ok: true,
    ...buildScorePayload(scoreFinal, maxScore),
    warnings,
    microResponses: [
      buildMicroResponse('response_submitted', answered ? 'yes' : 'no', answered ? 'An option key was submitted.' : 'No option key was submitted.', answered ? 1 : 0.9),
      buildMicroResponse('answer_accuracy', isCorrect ? 'yes' : 'no', isCorrect
        ? `Selected option "${selectedOptionKey}" matches the keyed answer.`
        : `Selected option "${selectedOptionKey || '-'}" does not match "${correctOptionKey}".`)
    ],
    aggregationBreakdown: {
      evaluator: 'mcq_single',
      correctOptionKey,
      selectedOptionKey,
      answered,
      isCorrect,
      negativeMarking
    }
  };
}

function evaluateMcqMultiple({ payload = {}, response = {}, scoringConfig = {} } = {}) {
  const correctOptionKeys = normalizeTokenList(payload.correctOptionKeys || payload.correctOptionKey || []);
  if (!correctOptionKeys.length) {
    return { ok: false, warnings: ['Reading MCQ Multiple scoring requires correctOptionKeys in question payload.'] };
  }
  const selectedOptionKeys = resolveSelectedMultiple(response);
  const answered = selectedOptionKeys.length > 0;
  const correctSet = new Set(correctOptionKeys);
  const selectedSet = new Set(selectedOptionKeys);
  const matchedCorrect = correctOptionKeys.filter((key) => selectedSet.has(key));
  const extraIncorrect = selectedOptionKeys.filter((key) => !correctSet.has(key));
  const missedCorrect = correctOptionKeys.filter((key) => !selectedSet.has(key));
  const exactMatch = matchedCorrect.length === correctOptionKeys.length && extraIncorrect.length === 0;
  const coverageRatio = correctOptionKeys.length ? (matchedCorrect.length / correctOptionKeys.length) : 0;

  const maxScore = resolveConfiguredMaxScore(scoringConfig, 1);
  const partialCreditEnabled = normalizeBoolean(scoringConfig.partialCreditEnabled, false);
  const negativeMarking = normalizeBoolean(scoringConfig.negativeMarking ?? payload.negativeMarking, false);

  let scoreFinal = 0;
  if (partialCreditEnabled) {
    let unit = coverageRatio;
    if (extraIncorrect.length) {
      unit -= (extraIncorrect.length / Math.max(1, correctOptionKeys.length));
    }
    unit = Math.max(0, unit);
    scoreFinal = unit * maxScore;
    if (negativeMarking && answered && matchedCorrect.length === 0 && extraIncorrect.length > 0) {
      scoreFinal = -maxScore;
    }
  } else if (exactMatch) {
    scoreFinal = maxScore;
  } else if (negativeMarking && answered) {
    scoreFinal = -maxScore;
  }

  const warnings = answered ? [] : ['No options were selected for this MCQ Multiple response.'];
  const exactChoice = exactMatch ? 'yes' : (coverageRatio > 0 ? 'partial' : 'no');
  return {
    ok: true,
    ...buildScorePayload(scoreFinal, maxScore),
    warnings,
    microResponses: [
      buildMicroResponse('response_submitted', answered ? 'yes' : 'no', answered ? `Submitted ${selectedOptionKeys.length} option(s).` : 'No option keys were submitted.'),
      buildMicroResponse(
        'selected_required_options',
        coverageRatio >= 1 ? 'yes' : (coverageRatio > 0 ? 'partial' : 'no'),
        `Matched ${matchedCorrect.length} of ${correctOptionKeys.length} required option(s).`
      ),
      buildMicroResponse(
        'avoided_incorrect_options',
        extraIncorrect.length === 0 ? 'yes' : 'no',
        extraIncorrect.length === 0
          ? 'No incorrect options were selected.'
          : `Selected ${extraIncorrect.length} incorrect option(s): ${extraIncorrect.join(', ')}.`
      ),
      buildMicroResponse('exact_set_match', exactChoice, exactMatch
        ? 'Submitted option set exactly matches all correct options.'
        : 'Submitted option set does not fully match the keyed option set.')
    ],
    aggregationBreakdown: {
      evaluator: 'mcq_multiple',
      correctOptionKeys,
      selectedOptionKeys,
      matchedCorrect,
      missedCorrect,
      extraIncorrect,
      exactMatch,
      coverageRatio: round2(coverageRatio),
      partialCreditEnabled,
      negativeMarking
    }
  };
}

function evaluateTrueFalse({ payload = {}, response = {}, scoringConfig = {} } = {}) {
  const correctValue = normalizeTrueFalseToken(payload.correctValue || '');
  if (!correctValue) {
    return { ok: false, warnings: ['Reading True/False scoring requires correctValue in question payload.'] };
  }
  const selectedValue = resolveSelectedTrueFalse(response);
  const answered = Boolean(selectedValue);
  const isCorrect = answered && selectedValue === correctValue;
  const maxScore = resolveConfiguredMaxScore(scoringConfig, 1);
  const negativeMarking = normalizeBoolean(scoringConfig.negativeMarking, false);
  const scoreFinal = isCorrect ? maxScore : ((negativeMarking && answered) ? -maxScore : 0);
  const warnings = answered ? [] : ['No True/False/Not Given option was selected for this response.'];
  return {
    ok: true,
    ...buildScorePayload(scoreFinal, maxScore),
    warnings,
    microResponses: [
      buildMicroResponse('response_submitted', answered ? 'yes' : 'no', answered ? 'A judgement option was submitted.' : 'No judgement option was submitted.'),
      buildMicroResponse('statement_judgement_accuracy', isCorrect ? 'yes' : 'no', isCorrect
        ? `Selected judgement "${selectedValue}" matches the keyed value.`
        : `Selected judgement "${selectedValue || '-'}" does not match "${correctValue}".`)
    ],
    aggregationBreakdown: {
      evaluator: 'true_false',
      correctValue,
      selectedValue,
      answered,
      isCorrect
    }
  };
}

function evaluateFillInBlank({ payload = {}, response = {}, scoringConfig = {} } = {}) {
  const answerMap = isPlainObject(payload.blankAnswerMap) ? payload.blankAnswerMap : {};
  const blankKeys = Object.keys(answerMap)
    .map((row) => s(row, 120))
    .filter(Boolean);
  if (!blankKeys.length) {
    return { ok: false, warnings: ['Reading Fill in Blank scoring requires blankAnswerMap in question payload.'] };
  }

  const responseMap = resolveBlankResponseMap(response);
  const caseSensitive = normalizeBoolean(payload.caseSensitive, false);
  const allowSynonyms = normalizeBoolean(payload.allowSynonyms, false);
  const perBlankScore = Math.max(0, toFiniteNumber(scoringConfig.perBlankScore, 1) || 1);
  const rawMaxScore = blankKeys.length * perBlankScore;
  const maxScore = resolveConfiguredMaxScore(scoringConfig, rawMaxScore || 1);

  let answeredCount = 0;
  let correctCount = 0;
  const mismatches = [];
  const microRows = [];

  blankKeys.forEach((blankKey, index) => {
    const expectedRaw = s(answerMap[blankKey], 300);
    const expectedVariants = resolveExpectedVariants(expectedRaw, allowSynonyms, caseSensitive);
    const actualRaw = s(responseMap[blankKey], 300);
    const actualNormalized = normalizeAnswerText(actualRaw, caseSensitive);
    const answered = Boolean(actualNormalized);
    const isCorrect = answered && expectedVariants.includes(actualNormalized);
    if (answered) answeredCount += 1;
    if (isCorrect) correctCount += 1;
    if (!isCorrect) {
      mismatches.push({
        blankKey,
        expected: expectedRaw,
        actual: actualRaw
      });
    }
    microRows.push(
      buildMicroResponse(
        `blank_${index + 1}_accuracy`,
        isCorrect ? 'yes' : (answered ? 'no' : 'unclear'),
        isCorrect
          ? `Blank ${blankKey} matched the keyed answer.`
          : `Blank ${blankKey} expected "${expectedRaw}" but received "${actualRaw || '-'}".`,
        answered ? 1 : 0.9
      )
    );
  });

  const rawScore = correctCount * perBlankScore;
  const scaledScore = rawMaxScore > 0 ? ((rawScore / rawMaxScore) * maxScore) : 0;
  const warnings = answeredCount > 0 ? [] : ['No blank responses were submitted for this Fill in Blank item.'];
  const coverageRatio = blankKeys.length ? (correctCount / blankKeys.length) : 0;

  return {
    ok: true,
    ...buildScorePayload(scaledScore, maxScore),
    warnings,
    microResponses: [
      buildMicroResponse(
        'blank_completion',
        answeredCount === blankKeys.length ? 'yes' : (answeredCount > 0 ? 'partial' : 'no'),
        `Answered ${answeredCount} of ${blankKeys.length} blank(s).`
      ),
      buildMicroResponse(
        'blank_accuracy',
        coverageRatio >= 1 ? 'yes' : (coverageRatio > 0 ? 'partial' : 'no'),
        `Correctly filled ${correctCount} of ${blankKeys.length} blank(s).`
      ),
      ...microRows
    ],
    aggregationBreakdown: {
      evaluator: 'fill_in_blank',
      caseSensitive,
      allowSynonyms,
      perBlankScore,
      blankCount: blankKeys.length,
      answeredCount,
      correctCount,
      rawScore: round2(rawScore),
      rawMaxScore: round2(rawMaxScore),
      scaledScore: round2(scaledScore),
      mismatches: mismatches.slice(0, 12)
    }
  };
}

function evaluateReorderParagraphs({ payload = {}, response = {}, scoringConfig = {} } = {}) {
  const correctOrder = (Array.isArray(payload.correctOrder) ? payload.correctOrder : [])
    .map((row) => s(row, 5000))
    .filter(Boolean);
  if (correctOrder.length < 2) {
    return { ok: false, warnings: ['Reading Reorder Paragraphs scoring requires at least two entries in correctOrder.'] };
  }

  const submittedFromStructured = Array.isArray(response.submittedOrder)
    ? response.submittedOrder
    : (Array.isArray(response.reorderOrder) ? response.reorderOrder : []);
  const submittedOrder = submittedFromStructured.length
    ? submittedFromStructured.map((row) => s(row, 5000)).filter(Boolean)
    : parseSubmittedOrderFromText(response.mapText || response.text || '', correctOrder);

  const filteredSubmitted = [];
  const seen = new Set();
  const allowed = new Set(correctOrder);
  submittedOrder.forEach((row) => {
    if (!allowed.has(row) || seen.has(row)) return;
    seen.add(row);
    filteredSubmitted.push(row);
  });

  const matchedPositions = correctOrder.reduce((count, row, index) => (
    filteredSubmitted[index] === row ? count + 1 : count
  ), 0);
  const exactMatch = filteredSubmitted.length === correctOrder.length && matchedPositions === correctOrder.length;
  const answered = filteredSubmitted.length > 0;
  const partialCreditEnabled = normalizeBoolean(scoringConfig.partialCreditEnabled ?? payload.partialCreditEnabled, false);
  const maxScore = resolveConfiguredMaxScore(scoringConfig, 1);
  const scoreFinal = exactMatch
    ? maxScore
    : (partialCreditEnabled ? ((matchedPositions / correctOrder.length) * maxScore) : 0);
  const warnings = answered ? [] : ['No paragraph order was submitted for this Reorder Paragraphs item.'];
  const matchedRatio = correctOrder.length ? (matchedPositions / correctOrder.length) : 0;

  return {
    ok: true,
    ...buildScorePayload(scoreFinal, maxScore),
    warnings,
    microResponses: [
      buildMicroResponse('response_submitted', answered ? 'yes' : 'no', answered
        ? `Submitted ${filteredSubmitted.length} paragraph position(s).`
        : 'No paragraph order was submitted.'),
      buildMicroResponse('position_accuracy', matchedRatio >= 1 ? 'yes' : (matchedRatio > 0 ? 'partial' : 'no'), `Matched ${matchedPositions} of ${correctOrder.length} position(s).`),
      buildMicroResponse('exact_sequence_match', exactMatch ? 'yes' : 'no', exactMatch
        ? 'Submitted paragraph order exactly matches the keyed order.'
        : 'Submitted paragraph order differs from the keyed sequence.')
    ],
    aggregationBreakdown: {
      evaluator: 'reorder_paragraphs',
      correctCount: correctOrder.length,
      submittedCount: filteredSubmitted.length,
      matchedPositions,
      matchedRatio: round2(matchedRatio),
      exactMatch,
      partialCreditEnabled,
      correctOrder: correctOrder.slice(0, 24),
      submittedOrder: filteredSubmitted.slice(0, 24)
    }
  };
}

function evaluateMatching({ payload = {}, response = {}, scoringConfig = {} } = {}) {
  const leftLookup = buildMatchingItemLookup(payload.leftItems, 'left');
  const rightLookup = buildMatchingItemLookup(payload.rightItems, 'right');
  const reusableRightItems = normalizeBoolean(payload.reusableRightItems, false);
  const correctPairs = normalizePairsFromInput(payload.correctPairs, leftLookup, rightLookup);
  if (!correctPairs.length) {
    return { ok: false, warnings: ['Reading Matching scoring requires valid correctPairs in question payload.'] };
  }

  const submittedPairs = resolveSubmittedPairs(response, leftLookup, rightLookup);
  const answered = submittedPairs.length > 0;
  const correctSet = new Set(correctPairs.map((row) => row.pairToken));
  const matchedPairs = submittedPairs.filter((row) => correctSet.has(row.pairToken));
  const incorrectPairs = submittedPairs.filter((row) => !correctSet.has(row.pairToken));
  const missedPairs = correctPairs.filter((row) => !submittedPairs.some((item) => item.pairToken === row.pairToken));

  const duplicateRightSelections = [];
  if (!reusableRightItems) {
    const rightUsage = new Map();
    submittedPairs.forEach((row) => {
      rightUsage.set(row.rightKey, (rightUsage.get(row.rightKey) || 0) + 1);
    });
    rightUsage.forEach((count, rightKey) => {
      if (count > 1) duplicateRightSelections.push({ rightKey, count });
    });
  }

  const perPairScore = Math.max(0, toFiniteNumber(scoringConfig.perPairScore, 1) || 1);
  const rawMaxScore = correctPairs.length * perPairScore;
  const maxScore = resolveConfiguredMaxScore(scoringConfig, rawMaxScore || 1);
  const rawScore = matchedPairs.length * perPairScore;
  const scoreFinal = rawMaxScore > 0 ? ((rawScore / rawMaxScore) * maxScore) : 0;
  const coverageRatio = correctPairs.length ? (matchedPairs.length / correctPairs.length) : 0;
  const warnings = answered ? [] : ['No pairs were submitted for this Matching response.'];

  return {
    ok: true,
    ...buildScorePayload(scoreFinal, maxScore),
    warnings,
    microResponses: [
      buildMicroResponse(
        'response_submitted',
        answered ? 'yes' : 'no',
        answered ? `Submitted ${submittedPairs.length} pair(s).` : 'No pair was submitted.'
      ),
      buildMicroResponse(
        'pair_accuracy',
        coverageRatio >= 1 ? 'yes' : (coverageRatio > 0 ? 'partial' : 'no'),
        `Matched ${matchedPairs.length} of ${correctPairs.length} required pair(s).`
      ),
      buildMicroResponse(
        'right_reuse_rule',
        reusableRightItems || !duplicateRightSelections.length ? 'yes' : 'no',
        reusableRightItems
          ? 'Right-item reuse is allowed for this item.'
          : (duplicateRightSelections.length
            ? `Right items reused across multiple left items: ${duplicateRightSelections.map((row) => `${row.rightKey}x${row.count}`).join(', ')}.`
            : 'No disallowed right-item reuse detected.')
      )
    ],
    aggregationBreakdown: {
      evaluator: 'matching',
      reusableRightItems,
      perPairScore,
      pairCount: correctPairs.length,
      submittedCount: submittedPairs.length,
      matchedCount: matchedPairs.length,
      missedCount: missedPairs.length,
      incorrectCount: incorrectPairs.length,
      coverageRatio: round2(coverageRatio),
      rawScore: round2(rawScore),
      rawMaxScore: round2(rawMaxScore),
      scaledScore: round2(scoreFinal),
      correctPairs: correctPairs.slice(0, 30),
      submittedPairs: submittedPairs.slice(0, 30),
      duplicateRightSelections: duplicateRightSelections.slice(0, 20)
    }
  };
}

function buildFeedbackDraft(questionType = '', evaluation = {}) {
  const scoreFinal = toFiniteNumber(evaluation.scoreFinal, 0);
  const maxScore = toFiniteNumber(evaluation.maxScore, 1);
  const summary = `${formatScoreNumber(scoreFinal)} / ${formatScoreNumber(maxScore)} objective reading points.`;
  const strengths = [];
  const improvements = [];
  const breakdown = safeObject(evaluation.aggregationBreakdown, {});

  if (questionType === 'reading_mcq_single') {
    if (breakdown.isCorrect) strengths.push('Selected option matches the keyed answer.');
    else if (!breakdown.answered) improvements.push('Select one option before saving/scoring your response.');
    else improvements.push('Review the passage evidence and choose the option that best matches the stem.');
  } else if (questionType === 'reading_mcq_multiple') {
    if (breakdown.exactMatch) strengths.push('Selected option set exactly matches all required answers.');
    else {
      if (Array.isArray(breakdown.matchedCorrect) && breakdown.matchedCorrect.length) {
        strengths.push(`Matched ${breakdown.matchedCorrect.length} correct option(s).`);
      }
      if (Array.isArray(breakdown.missedCorrect) && breakdown.missedCorrect.length) {
        improvements.push(`Missed ${breakdown.missedCorrect.length} required option(s).`);
      }
      if (Array.isArray(breakdown.extraIncorrect) && breakdown.extraIncorrect.length) {
        improvements.push(`Remove incorrect option(s): ${breakdown.extraIncorrect.join(', ')}.`);
      }
      if (!breakdown.answered) improvements.push('Select one or more options before saving/scoring your response.');
    }
  } else if (questionType === 'reading_true_false') {
    if (breakdown.isCorrect) strengths.push('Selected judgement matches the keyed value.');
    else if (!breakdown.answered) improvements.push('Select True, False, or Not Given before scoring.');
    else improvements.push('Re-check whether the statement is supported, contradicted, or not stated in the passage.');
  } else if (questionType === 'reading_fill_in_blank' || questionType === 'reading_writing_fill_in_blank') {
    const blankCount = toFiniteNumber(breakdown.blankCount, 0);
    const correctCount = toFiniteNumber(breakdown.correctCount, 0);
    const answeredCount = toFiniteNumber(breakdown.answeredCount, 0);
    if (correctCount === blankCount && blankCount > 0) {
      strengths.push('All blanks were completed correctly.');
    } else {
      if (answeredCount < blankCount) {
        improvements.push(`Complete every blank before scoring (${answeredCount}/${blankCount} answered).`);
      }
      if (correctCount < blankCount) {
        improvements.push(`Improve blank accuracy (${correctCount}/${blankCount} correct).`);
      }
      const mismatches = Array.isArray(breakdown.mismatches) ? breakdown.mismatches : [];
      if (mismatches.length) {
        const examples = mismatches
          .slice(0, 3)
          .map((row) => `${row.blankKey}: expected "${row.expected}"`)
          .join('; ');
        improvements.push(`Review missed blanks: ${examples}.`);
      }
    }
  } else if (questionType === 'reading_reorder_paragraphs') {
    if (breakdown.exactMatch) strengths.push('Paragraph sequence matches the keyed order.');
    else {
      improvements.push(`Matched ${toFiniteNumber(breakdown.matchedPositions, 0)} of ${toFiniteNumber(breakdown.correctCount, 0)} positions.`);
      if (!toFiniteNumber(breakdown.submittedCount, 0)) improvements.push('Submit a full paragraph order before scoring.');
    }
  } else if (questionType === 'reading_matching') {
    const matchedCount = toFiniteNumber(breakdown.matchedCount, 0);
    const pairCount = toFiniteNumber(breakdown.pairCount, 0);
    if (pairCount > 0 && matchedCount >= pairCount) {
      strengths.push('All required matching pairs were correct.');
    } else {
      improvements.push(`Matched ${matchedCount} of ${pairCount} required pair(s).`);
      if (toFiniteNumber(breakdown.incorrectCount, 0) > 0) {
        improvements.push(`Remove or fix ${toFiniteNumber(breakdown.incorrectCount, 0)} incorrect submitted pair(s).`);
      }
      if (Array.isArray(breakdown.duplicateRightSelections) && breakdown.duplicateRightSelections.length && breakdown.reusableRightItems === false) {
        improvements.push('Avoid reusing one right item for multiple left items unless the task explicitly allows it.');
      }
    }
  }

  if (!strengths.length) strengths.push('The response was scored deterministically against the keyed reading answers.');
  if (!improvements.length && scoreFinal < maxScore) improvements.push('Review this item once more and target the missed evidence points.');
  if (!improvements.length && scoreFinal >= maxScore) improvements.push('Keep this accuracy on the next reading item.');

  return {
    summary,
    strengths,
    improvements,
    nextPracticeAction: scoreFinal >= maxScore
      ? 'Move to another reading item and maintain the same accuracy.'
      : 'Review the keyed evidence and attempt the same item again before moving on.'
  };
}

function makeScoringMetadata({
  questionType = '',
  scoringConfig = {},
  responsePayload = {},
  evaluation = {},
  warnings = [],
  status = 'scored'
} = {}) {
  const rubric = getRubric(questionType) || {};
  const traitMax = {
    accuracy: toFiniteNumber(evaluation.maxScore, 1)
  };
  const scoreFinal = toFiniteNumber(evaluation.scoreFinal, 0);
  const metadataWarnings = normalizeWarnings([
    ...(Array.isArray(evaluation.warnings) ? evaluation.warnings : []),
    ...warnings
  ]);
  return {
    status,
    scorerKey: questionType,
    scorerVersion: resolveScorerVersion(questionType),
    scoringContractVersion: READING_SCORING_CONTRACT_VERSION,
    scoreScale: 'raw_item_rubric_score',
    officialScoreEstimate: false,
    rubricSource: Array.isArray(rubric.rubricSources) ? rubric.rubricSources : [],
    configuredMethod: s(scoringConfig.method || '', 120) || 'auto_objective',
    microRubricVersion: READING_MICRO_RUBRIC_VERSION,
    microAssessmentVersion: READING_MICRO_RUBRIC_VERSION,
    microResponses: Array.isArray(evaluation.microResponses) ? evaluation.microResponses : [],
    microAssessments: Array.isArray(evaluation.microResponses) ? evaluation.microResponses : [],
    aggregationBreakdown: safeObject(evaluation.aggregationBreakdown, {}),
    legacyDirectModelScores: {},
    traitMax,
    accuracy: {
      score: scoreFinal,
      maxScore: traitMax.accuracy,
      descriptor: traitDescriptor(scoreFinal, traitMax.accuracy)
    },
    feedbackDraft: evaluation.feedbackDraft || null,
    warnings: metadataWarnings,
    responsePayloadMeta: {
      selectedSingle: s(responsePayload.selectedSingle, 120),
      selectedMultipleCount: Array.isArray(responsePayload.selectedMultiple) ? responsePayload.selectedMultiple.length : 0,
      selectedTrueFalse: s(responsePayload.selectedTrueFalse, 40),
      mapTextLength: s(responsePayload.mapText, 200000).length,
      textLength: s(responsePayload.text, 200000).length
    },
    scoredAt: new Date().toISOString()
  };
}

function failedResult({
  questionType = '',
  scoringConfig = {},
  responsePayload = {},
  warnings = []
} = {}) {
  const metadata = makeScoringMetadata({
    questionType,
    scoringConfig,
    responsePayload,
    evaluation: {
      scoreFinal: 0,
      maxScore: resolveConfiguredMaxScore(scoringConfig, 1),
      warnings: normalizeWarnings(warnings),
      microResponses: [],
      aggregationBreakdown: {},
      feedbackDraft: null
    },
    status: 'failed',
    warnings
  });
  return {
    status: 'failed',
    scorePayload: null,
    metadata,
    warnings: metadata.warnings
  };
}

async function scoreReadingAttemptItem(args = {}) {
  const {
    item = {},
    question = {},
    responsePayload = {},
    scoringConfig = {}
  } = args;

  const questionType = s(item.questionType || question.questionType, 120).toLowerCase();
  if (!READING_TYPES.has(questionType)) {
    return failedResult({
      questionType,
      scoringConfig,
      responsePayload,
      warnings: ['Unsupported Reading scorer question type.']
    });
  }

  const payload = resolveQuestionPayload(question, item);
  const response = resolveResponsePayload(responsePayload, item);

  let evaluation = null;
  if (questionType === 'reading_mcq_single') {
    evaluation = evaluateMcqSingle({ payload, response, scoringConfig });
  } else if (questionType === 'reading_mcq_multiple') {
    evaluation = evaluateMcqMultiple({ payload, response, scoringConfig });
  } else if (questionType === 'reading_true_false') {
    evaluation = evaluateTrueFalse({ payload, response, scoringConfig });
  } else if (questionType === 'reading_fill_in_blank' || questionType === 'reading_writing_fill_in_blank') {
    evaluation = evaluateFillInBlank({ payload, response, scoringConfig });
  } else if (questionType === 'reading_reorder_paragraphs') {
    evaluation = evaluateReorderParagraphs({ payload, response, scoringConfig });
  } else if (questionType === 'reading_matching') {
    evaluation = evaluateMatching({ payload, response, scoringConfig });
  } else {
    evaluation = { ok: false, warnings: ['No reading evaluator exists for this question type.'] };
  }

  if (!evaluation?.ok) {
    return failedResult({
      questionType,
      scoringConfig,
      responsePayload: response,
      warnings: normalizeWarnings(evaluation?.warnings || ['Reading scoring evaluation failed.'])
    });
  }

  evaluation.feedbackDraft = buildFeedbackDraft(questionType, evaluation);
  const metadata = makeScoringMetadata({
    questionType,
    scoringConfig,
    responsePayload: response,
    evaluation,
    status: 'scored',
    warnings: evaluation.warnings
  });

  return {
    status: 'scored',
    scorePayload: {
      scoreRaw: evaluation.scoreRaw,
      scoreFinal: evaluation.scoreFinal,
      maxScore: evaluation.maxScore,
      percentage: evaluation.percentage,
      traitScores: evaluation.traitScores,
      scoringMetadata: metadata
    },
    metadata,
    feedbackDraft: evaluation.feedbackDraft,
    warnings: metadata.warnings
  };
}

module.exports = {
  READING_MICRO_RUBRIC_VERSION,
  READING_SCORING_CONTRACT_VERSION,
  scoreReadingAttemptItem
};
