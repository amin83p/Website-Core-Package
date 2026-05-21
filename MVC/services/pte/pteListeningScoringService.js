const {
  LISTENING_MCQ_SINGLE_SCORER_VERSION,
  LISTENING_MCQ_MULTIPLE_SCORER_VERSION,
  LISTENING_SELECT_MISSING_WORD_SCORER_VERSION,
  LISTENING_FILL_IN_BLANK_SCORER_VERSION,
  LISTENING_HIGHLIGHT_INCORRECT_WORDS_SCORER_VERSION,
  LISTENING_DICTATION_SCORER_VERSION,
  getRubric
} = require('./pteScoringRubricRegistry');

const LISTENING_TYPES = new Set([
  'listening_mcq_single',
  'listening_mcq_multiple',
  'listening_select_missing_word',
  'listening_dictation',
  'listening_fill_in_blank',
  'listening_highlight_incorrect_words'
]);

const LISTENING_SCORING_CONTRACT_VERSION = 2;
const LISTENING_MICRO_RUBRIC_VERSION = 'pte-listening-objective-micro-v1';

const DEFAULT_DICTATION_NORMALIZATION_RULES = Object.freeze({
  caseSensitive: false,
  ignorePunctuation: true,
  normalizeWhitespace: true,
  normalizeQuotes: true
});

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

function normalizeBooleanLike(value, fallback = false) {
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

function resolvePerWordScore(scoringConfig = {}) {
  return Math.max(0, toFiniteNumber(scoringConfig?.perWordScore, 1));
}

function resolvePerBlankScore(scoringConfig = {}) {
  return Math.max(0, toFiniteNumber(scoringConfig?.perBlankScore, 1));
}

function resolveSelectedSingle(response = {}) {
  return normalizeToken(
    response.selectedOptionKey
      || response.selectedSingle
      || response.optionKey
      || response.selectedValue
      || ''
  );
}

function resolveSelectedMultiple(response = {}) {
  if (Array.isArray(response.selectedOptionKeys)) {
    return normalizeTokenList(response.selectedOptionKeys);
  }
  if (Array.isArray(response.selectedMultiple)) {
    return normalizeTokenList(response.selectedMultiple);
  }
  return normalizeTokenList(response.selectedOptionKeys || response.selectedMultiple || '');
}

function resolveScorerVersion(questionType = '') {
  if (questionType === 'listening_mcq_single') return LISTENING_MCQ_SINGLE_SCORER_VERSION;
  if (questionType === 'listening_mcq_multiple') return LISTENING_MCQ_MULTIPLE_SCORER_VERSION;
  if (questionType === 'listening_select_missing_word') return LISTENING_SELECT_MISSING_WORD_SCORER_VERSION;
  if (questionType === 'listening_fill_in_blank') return LISTENING_FILL_IN_BLANK_SCORER_VERSION;
  if (questionType === 'listening_highlight_incorrect_words') return LISTENING_HIGHLIGHT_INCORRECT_WORDS_SCORER_VERSION;
  if (questionType === 'listening_dictation') return LISTENING_DICTATION_SCORER_VERSION;
  return '';
}

function resolvePrimaryTraitKey(questionType = '') {
  return questionType === 'listening_dictation' ? 'content' : 'accuracy';
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

function tokenizeComparableWords(text = '') {
  const source = String(text || '');
  const regex = /[A-Za-z0-9]+(?:[-'’`][A-Za-z0-9]+)*/g;
  const out = [];
  let match = null;
  let index = 0;
  while ((match = regex.exec(source)) !== null) {
    const raw = s(match[0], 200);
    if (!raw) continue;
    out.push({
      raw,
      norm: raw.toLowerCase(),
      index
    });
    index += 1;
  }
  return out;
}

function deriveIncorrectWordOccurrences(sourceTranscript = '', displayTranscript = '') {
  const sourceWords = tokenizeComparableWords(sourceTranscript);
  const displayWords = tokenizeComparableWords(displayTranscript);
  const out = [];

  if (!displayWords.length) return out;

  let i = 0;
  let j = 0;
  while (i < sourceWords.length || j < displayWords.length) {
    const sourceWord = sourceWords[i] || null;
    const displayWord = displayWords[j] || null;

    if (!sourceWord && !displayWord) break;
    if (!displayWord) {
      i += 1;
      continue;
    }
    if (!sourceWord) {
      out.push({
        index: displayWord.index,
        word: displayWord.raw,
        norm: displayWord.norm,
        reason: 'display_only_tail'
      });
      j += 1;
      continue;
    }

    if (sourceWord.norm === displayWord.norm) {
      i += 1;
      j += 1;
      continue;
    }

    const nextSource = sourceWords[i + 1] || null;
    if (nextSource && nextSource.norm === displayWord.norm) {
      i += 1;
      continue;
    }

    const nextDisplay = displayWords[j + 1] || null;
    if (nextDisplay && sourceWord.norm === nextDisplay.norm) {
      out.push({
        index: displayWord.index,
        word: displayWord.raw,
        norm: displayWord.norm,
        reason: 'display_insertion'
      });
      j += 1;
      continue;
    }

    out.push({
      index: displayWord.index,
      word: displayWord.raw,
      norm: displayWord.norm,
      reason: 'substitution'
    });
    i += 1;
    j += 1;
  }

  return out;
}

function splitHighlightPhraseLines(value = '') {
  return String(value || '')
    .split(/\r?\n+/g)
    .map((line) => s(line, 5000))
    .filter(Boolean);
}

function tokenizeHighlightPhrase(phrase = '') {
  return tokenizeComparableWords(phrase)
    .map((row) => row.norm)
    .filter(Boolean);
}

function tryMatchHighlightPhrase(wordTokens = [], phraseTokens = [], fromIndex = 0, selectedSet = new Set()) {
  if (!Array.isArray(wordTokens) || !Array.isArray(phraseTokens) || !phraseTokens.length) return -1;
  const start = Math.max(0, Number.parseInt(String(fromIndex || ''), 10) || 0);
  for (let i = start; i <= (wordTokens.length - phraseTokens.length); i += 1) {
    let ok = true;
    for (let j = 0; j < phraseTokens.length; j += 1) {
      if (wordTokens[i + j] !== phraseTokens[j]) {
        ok = false;
        break;
      }
      if (selectedSet && selectedSet.has(i + j)) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function resolveHighlightIncorrectSelection(response = {}, displayTranscript = '') {
  const mapData = extractJsonPayload(response.mapText || response.text || '');
  const mapObj = isPlainObject(mapData) ? mapData : {};
  const displayWords = tokenizeComparableWords(displayTranscript);
  const maxIndex = displayWords.length - 1;
  const selectedSet = new Set();

  const mapIndices = Array.isArray(mapObj.selectedWordIndices) ? mapObj.selectedWordIndices : [];
  mapIndices.forEach((value) => {
    const numeric = Number.parseInt(String(value || ''), 10);
    if (Number.isFinite(numeric) && !Number.isNaN(numeric) && numeric >= 0 && numeric <= maxIndex) {
      selectedSet.add(numeric);
    }
  });

  const selectedWordsList = [];
  if (selectedSet.size) {
    Array.from(selectedSet.values()).sort((a, b) => a - b).forEach((idx) => {
      const row = displayWords[idx];
      if (!row || !row.raw) return;
      selectedWordsList.push(row.raw);
    });
    return {
      selectedIndices: Array.from(selectedSet.values()).sort((a, b) => a - b),
      selectedWords: selectedWordsList,
      fromMapIndices: true
    };
  }

  const wordTokens = displayWords.map((row) => row.norm);
  const mapPhrases = Array.isArray(mapObj.selectedPhrases) ? mapObj.selectedPhrases : [];
  const textPhrases = splitHighlightPhraseLines(response.text || '');
  const targetPhrases = (mapPhrases.length ? mapPhrases : textPhrases)
    .map((line) => tokenizeHighlightPhrase(line))
    .filter((tokens) => tokens.length > 0);

  if (targetPhrases.length) {
    let cursor = 0;
    targetPhrases.forEach((phraseTokens) => {
      let startIndex = tryMatchHighlightPhrase(wordTokens, phraseTokens, cursor, selectedSet);
      if (startIndex < 0) startIndex = tryMatchHighlightPhrase(wordTokens, phraseTokens, 0, selectedSet);
      if (startIndex < 0) return;
      for (let j = 0; j < phraseTokens.length; j += 1) {
        selectedSet.add(startIndex + j);
      }
      cursor = startIndex + phraseTokens.length;
    });
  }

  const mapWords = Array.isArray(mapObj.selectedWords) ? mapObj.selectedWords : [];
  const directWords = Array.isArray(response.selectedWords) ? response.selectedWords : [];
  const targetWords = [...mapWords, ...directWords]
    .map((value) => tokenizeHighlightPhrase(value)[0] || '')
    .filter(Boolean);

  if (targetWords.length) {
    let cursor = 0;
    targetWords.forEach((targetToken) => {
      let matchedIndex = -1;
      for (let i = cursor; i < wordTokens.length; i += 1) {
        if (wordTokens[i] === targetToken && !selectedSet.has(i)) {
          matchedIndex = i;
          break;
        }
      }
      if (matchedIndex < 0) {
        for (let i = 0; i < wordTokens.length; i += 1) {
          if (wordTokens[i] === targetToken && !selectedSet.has(i)) {
            matchedIndex = i;
            break;
          }
        }
      }
      if (matchedIndex < 0) return;
      selectedSet.add(matchedIndex);
      cursor = matchedIndex + 1;
    });
  }

  Array.from(selectedSet.values()).sort((a, b) => a - b).forEach((idx) => {
    const row = displayWords[idx];
    if (!row || !row.raw) return;
    selectedWordsList.push(row.raw);
  });

  return {
    selectedIndices: Array.from(selectedSet.values()).sort((a, b) => a - b),
    selectedWords: selectedWordsList,
    fromMapIndices: false
  };
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

function parseBlankOrderHint(blankKey = '') {
  const token = s(blankKey, 120);
  if (!token) return { numeric: Number.POSITIVE_INFINITY, key: '' };
  const numericMatch = token.match(/(\d+)/);
  const numeric = numericMatch ? Number.parseInt(numericMatch[1], 10) : Number.POSITIVE_INFINITY;
  return {
    numeric: Number.isFinite(numeric) ? numeric : Number.POSITIVE_INFINITY,
    key: token.toLowerCase()
  };
}

function sortBlankKeys(keys = []) {
  return (Array.isArray(keys) ? keys : [])
    .slice()
    .sort((a, b) => {
      const hintA = parseBlankOrderHint(a);
      const hintB = parseBlankOrderHint(b);
      if (hintA.numeric !== hintB.numeric) return hintA.numeric - hintB.numeric;
      return hintA.key.localeCompare(hintB.key);
    });
}

function normalizeRulesFromConfig(payloadRules = {}, scoringRules = {}) {
  const payload = safeObject(payloadRules, {});
  const scoring = safeObject(scoringRules, {});
  return {
    caseSensitive: normalizeBooleanLike(
      scoring.caseSensitive ?? payload.caseSensitive,
      DEFAULT_DICTATION_NORMALIZATION_RULES.caseSensitive
    ),
    ignorePunctuation: normalizeBooleanLike(
      scoring.ignorePunctuation ?? payload.ignorePunctuation,
      DEFAULT_DICTATION_NORMALIZATION_RULES.ignorePunctuation
    ),
    normalizeWhitespace: normalizeBooleanLike(
      scoring.normalizeWhitespace ?? payload.normalizeWhitespace,
      DEFAULT_DICTATION_NORMALIZATION_RULES.normalizeWhitespace
    ),
    normalizeQuotes: normalizeBooleanLike(
      scoring.normalizeQuotes ?? payload.normalizeQuotes,
      DEFAULT_DICTATION_NORMALIZATION_RULES.normalizeQuotes
    )
  };
}

function normalizeTranscriptText(text = '', rules = DEFAULT_DICTATION_NORMALIZATION_RULES) {
  let out = s(text, 50000);
  if (!out) return '';
  if (rules.normalizeQuotes) {
    out = out
      .replace(/[\u2018\u2019]/g, '\'')
      .replace(/[\u201C\u201D]/g, '"');
  }
  if (!rules.caseSensitive) out = out.toLowerCase();
  if (rules.ignorePunctuation) out = out.replace(/[^\p{L}\p{N}'\s-]+/gu, ' ');
  if (rules.normalizeWhitespace) out = out.replace(/\s+/g, ' ');
  return out.trim();
}

function tokenizeTranscript(text = '', rules = DEFAULT_DICTATION_NORMALIZATION_RULES) {
  const normalized = normalizeTranscriptText(text, rules);
  if (!normalized) return [];
  return normalized
    .split(' ')
    .map((row) => row.trim())
    .filter(Boolean);
}

function parseVariantList(value) {
  if (Array.isArray(value)) {
    return value.map((row) => s(row, 50000)).filter(Boolean);
  }
  const raw = s(value, 200000);
  if (!raw) return [];
  if (raw.startsWith('[') && raw.endsWith(']')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((row) => s(row, 50000)).filter(Boolean);
    } catch (_) {
      // Fall back to line parsing.
    }
  }
  return raw
    .split(/\r?\n+/g)
    .map((row) => s(row, 50000).replace(/^\s*\d+[\).\-\]]\s*/, ''))
    .filter(Boolean);
}

function longestCommonSubsequencePairs(sourceTokens = [], responseTokens = []) {
  const a = Array.isArray(sourceTokens) ? sourceTokens : [];
  const b = Array.isArray(responseTokens) ? responseTokens : [];
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push({ sourceIndex: i, responseIndex: j, token: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }

  return pairs;
}

function resolveResponseText(response = {}) {
  return s(
    response.responseText
      || response.transcript
      || response.text
      || response.answer
      || response.typedResponse
      || '',
    50000
  );
}

function buildReferenceTranscripts(payload = {}) {
  const expected = s(payload.expectedTranscript, 50000);
  const variants = parseVariantList(payload.transcriptVariants)
    .filter((row) => row.toLowerCase() !== expected.toLowerCase());
  const refs = [];
  if (expected) refs.push({ source: 'expected', index: 0, transcript: expected });
  variants.forEach((row, index) => {
    refs.push({ source: 'variant', index: index + 1, transcript: row });
  });
  return refs;
}

function pickBestReference(referenceRows = [], responseTokens = [], rules = DEFAULT_DICTATION_NORMALIZATION_RULES) {
  let best = null;
  referenceRows.forEach((row) => {
    const tokens = tokenizeTranscript(row.transcript, rules);
    if (!tokens.length) return;
    const lcsPairs = longestCommonSubsequencePairs(tokens, responseTokens);
    const matchedCount = lcsPairs.length;
    const coverage = tokens.length > 0 ? matchedCount / tokens.length : 0;
    if (
      !best
      || coverage > best.coverage
      || (coverage === best.coverage && tokens.length > best.expectedTokens.length)
    ) {
      best = {
        ...row,
        expectedTokens: tokens,
        lcsPairs,
        matchedCount,
        coverage
      };
    }
  });
  return best;
}

function traitDescriptor(value = 0, max = 1) {
  const ratio = max > 0 ? (toFiniteNumber(value, 0) / max) : 0;
  if (ratio >= 0.85) return 'Good';
  if (ratio >= 0.6) return 'Developing';
  return 'Needs work';
}

function buildDictationFeedbackDraft(evaluation = {}) {
  const scoreFinal = toFiniteNumber(evaluation.scoreFinal, 0);
  const maxScore = toFiniteNumber(evaluation.maxScore, 1) || 1;
  const coverage = toFiniteNumber(evaluation.coverageRatio, 0);
  const matched = toFiniteNumber(evaluation.matchedCount, 0);
  const expected = toFiniteNumber(evaluation.expectedTokenCount, 0);
  const missingCount = Array.isArray(evaluation.missingTokens) ? evaluation.missingTokens.length : 0;
  const extraCount = Array.isArray(evaluation.extraTokens) ? evaluation.extraTokens.length : 0;
  const strengths = [];
  const improvements = [];

  const summary = `Dictation accuracy ${matched}/${expected} key tokens (coverage ${Math.round(coverage * 100)}%). Score ${scoreFinal}/${maxScore}.`;

  if (coverage >= 0.85) strengths.push('You captured most of the dictated words in the correct order.');
  if (!extraCount) strengths.push('Your response stayed close to the spoken sentence with few added words.');
  if (!strengths.length) strengths.push('Your response was scored objectively against the expected transcript.');

  if (missingCount > 0) {
    const missingPreview = evaluation.missingTokens.slice(0, 6).join(', ');
    improvements.push(`Review missed words: ${missingPreview}${missingCount > 6 ? ', ...' : ''}.`);
  }
  if (extraCount > 0) {
    const extraPreview = evaluation.extraTokens.slice(0, 6).join(', ');
    improvements.push(`Remove extra words not present in the prompt: ${extraPreview}${extraCount > 6 ? ', ...' : ''}.`);
  }
  if (!improvements.length && coverage < 1) improvements.push('Replay the audio mentally and focus on exact word order.');
  if (!improvements.length && coverage >= 1) improvements.push('Great work. Keep the same accuracy for the next dictation item.');

  return {
    summary,
    strengths,
    improvements,
    nextPracticeAction: coverage >= 0.95
      ? 'Move to the next dictation item and keep your transcription precision.'
      : 'Retry this dictation and focus on the missed words before moving on.'
  };
}

function buildFillInBlankFeedbackDraft(evaluation = {}) {
  const scoreFinal = toFiniteNumber(evaluation.scoreFinal, 0);
  const maxScore = toFiniteNumber(evaluation.maxScore, 1) || 1;
  const correctCount = toFiniteNumber(evaluation.correctCount, 0);
  const blankCount = toFiniteNumber(evaluation.blankCount, 0);
  const answeredCount = toFiniteNumber(evaluation.answeredCount, 0);
  const coverage = blankCount > 0 ? (correctCount / blankCount) : 0;
  const mismatches = Array.isArray(evaluation.mismatches) ? evaluation.mismatches : [];
  const strengths = [];
  const improvements = [];

  const summary = `Blank accuracy ${correctCount}/${blankCount}. Score ${scoreFinal}/${maxScore}.`;

  if (coverage >= 0.85) strengths.push('Most blanks were completed with the keyed answers.');
  if (answeredCount >= blankCount && blankCount > 0) strengths.push('All blank slots were attempted.');
  if (!strengths.length) strengths.push('Your response was scored objectively against the keyed blank map.');

  if (answeredCount < blankCount) improvements.push(`Complete all blank slots (${answeredCount}/${blankCount} answered).`);
  if (mismatches.length) {
    const mismatchPreview = mismatches
      .slice(0, 4)
      .map((row) => `${s(row.blankKey, 40)} => ${s(row.expected, 60)}`)
      .filter(Boolean)
      .join('; ');
    if (mismatchPreview) improvements.push(`Review mismatched blanks: ${mismatchPreview}${mismatches.length > 4 ? '; ...' : '.'}`);
  }
  if (!improvements.length && coverage < 1) improvements.push('Use transcript context around each gap to refine your word choices.');
  if (!improvements.length && coverage >= 1) improvements.push('Great work. Keep the same blank-level accuracy on the next item.');

  return {
    summary,
    strengths,
    improvements,
    nextPracticeAction: coverage >= 0.95
      ? 'Move to the next listening fill-in-the-blanks item and maintain this accuracy.'
      : 'Retry this item and focus on missed or incomplete blanks before moving on.'
  };
}

function buildHighlightIncorrectWordsFeedbackDraft(evaluation = {}) {
  const scoreFinal = toFiniteNumber(evaluation.scoreFinal, 0);
  const maxScore = toFiniteNumber(evaluation.maxScore, 1) || 1;
  const expectedCount = toFiniteNumber(evaluation.expectedCount, 0);
  const selectedCount = toFiniteNumber(evaluation.selectedCount, 0);
  const correctCount = toFiniteNumber(evaluation.correctCount, 0);
  const falsePositiveCount = toFiniteNumber(evaluation.falsePositiveCount, 0);
  const missedCount = toFiniteNumber(evaluation.missedCount, 0);
  const coverage = expectedCount > 0 ? (correctCount / expectedCount) : 0;
  const strengths = [];
  const improvements = [];

  const summary = `Incorrect-word accuracy ${correctCount}/${expectedCount}. Score ${scoreFinal}/${maxScore}.`;

  if (coverage >= 0.85) strengths.push('You identified most of the incorrect words accurately.');
  if (!falsePositiveCount && selectedCount > 0) strengths.push('Selections were precise with minimal false highlights.');
  if (!strengths.length) strengths.push('Your highlights were scored objectively against keyed incorrect words.');

  if (missedCount > 0) improvements.push(`You missed ${missedCount} incorrect word(s); track audio-text differences more closely.`);
  if (falsePositiveCount > 0) improvements.push(`Remove false highlights (${falsePositiveCount}) and select only confident mismatches.`);
  if (!selectedCount) improvements.push('Highlight at least one incorrect word while the audio plays.');
  if (!improvements.length && coverage >= 1) improvements.push('Great work. Keep this precision on the next HIW item.');

  return {
    summary,
    strengths,
    improvements,
    nextPracticeAction: coverage >= 0.95 && falsePositiveCount === 0
      ? 'Move to the next HIW item and keep the same highlight precision.'
      : 'Retry this HIW item and focus on missed words while avoiding false highlights.'
  };
}

function buildMcqSingleFeedbackDraft(evaluation = {}) {
  const scoreFinal = toFiniteNumber(evaluation.scoreFinal, 0);
  const maxScore = toFiniteNumber(evaluation.maxScore, 1) || 1;
  const answered = normalizeBooleanLike(evaluation.answered, false);
  const isCorrect = normalizeBooleanLike(evaluation.isCorrect, false);
  const selected = s(evaluation.selectedOptionKey, 50).toUpperCase();
  const correct = s(evaluation.correctOptionKey, 50).toUpperCase();
  const strengths = [];
  const improvements = [];

  if (isCorrect) strengths.push('Selected option matches the keyed correct answer.');
  else if (answered) improvements.push(`Selected "${selected || '-'}" but keyed answer is "${correct || '-'}".`);
  else improvements.push('Select one option before saving and scoring this item.');

  return {
    summary: `MCQ accuracy score ${scoreFinal}/${maxScore}.`,
    strengths,
    improvements,
    nextPracticeAction: isCorrect
      ? 'Move to the next listening MCQ item and keep your accuracy.'
      : 'Review the audio meaning and transcript cues, then retry this item.'
  };
}

function buildSelectMissingWordFeedbackDraft(evaluation = {}) {
  const scoreFinal = toFiniteNumber(evaluation.scoreFinal, 0);
  const maxScore = toFiniteNumber(evaluation.maxScore, 1) || 1;
  const answered = normalizeBooleanLike(evaluation.answered, false);
  const isCorrect = normalizeBooleanLike(evaluation.isCorrect, false);
  const selected = s(evaluation.selectedOptionKey, 50).toUpperCase();
  const correct = s(evaluation.correctOptionKey, 50).toUpperCase();
  const strengths = [];
  const improvements = [];

  if (isCorrect) strengths.push('Selected option correctly fills the missing transcript ending.');
  else if (answered) improvements.push(`Selected "${selected || '-'}" but keyed answer is "${correct || '-'}".`);
  else improvements.push('Select one option that best completes the missing ending.');

  return {
    summary: `Select Missing Word accuracy score ${scoreFinal}/${maxScore}.`,
    strengths,
    improvements,
    nextPracticeAction: isCorrect
      ? 'Move to the next listening Select Missing Word item and maintain this accuracy.'
      : 'Replay the audio context and pick the option that best completes the gap.'
  };
}

function buildMcqMultipleFeedbackDraft(evaluation = {}) {
  const scoreFinal = toFiniteNumber(evaluation.scoreFinal, 0);
  const maxScore = toFiniteNumber(evaluation.maxScore, 1) || 1;
  const answered = normalizeBooleanLike(evaluation.answered, false);
  const correctKeys = Array.isArray(evaluation.correctOptionKeys) ? evaluation.correctOptionKeys : [];
  const matched = Array.isArray(evaluation.matchedCorrect) ? evaluation.matchedCorrect : [];
  const extra = Array.isArray(evaluation.extraIncorrect) ? evaluation.extraIncorrect : [];
  const strengths = [];
  const improvements = [];

  if (matched.length) strengths.push(`Matched ${matched.length}/${correctKeys.length} required option(s).`);
  if (!extra.length && answered) strengths.push('No incorrect options were selected.');
  if (!answered) improvements.push('Select one or more options before saving and scoring this item.');
  if (extra.length) improvements.push(`Remove incorrect options: ${extra.join(', ')}.`);
  if (matched.length < correctKeys.length) improvements.push('Find all required correct options before submitting.');

  return {
    summary: `MCQ accuracy score ${scoreFinal}/${maxScore}.`,
    strengths,
    improvements,
    nextPracticeAction: matched.length === correctKeys.length && !extra.length
      ? 'Move to the next listening multi-select item and maintain the same precision.'
      : 'Replay the audio and verify each selected option against the prompt meaning.'
  };
}

function buildFeedbackDraft(questionType = '', evaluation = {}) {
  if (questionType === 'listening_mcq_single') return buildMcqSingleFeedbackDraft(evaluation);
  if (questionType === 'listening_select_missing_word') return buildSelectMissingWordFeedbackDraft(evaluation);
  if (questionType === 'listening_mcq_multiple') return buildMcqMultipleFeedbackDraft(evaluation);
  if (questionType === 'listening_highlight_incorrect_words') return buildHighlightIncorrectWordsFeedbackDraft(evaluation);
  if (questionType === 'listening_fill_in_blank') return buildFillInBlankFeedbackDraft(evaluation);
  return buildDictationFeedbackDraft(evaluation);
}

function evaluateDictation({
  payload = {},
  response = {},
  scoringConfig = {}
} = {}) {
  const warnings = [];
  const references = buildReferenceTranscripts(payload);
  if (!references.length) {
    return { ok: false, warnings: ['Expected transcript is required for dictation scoring.'] };
  }

  const rules = normalizeRulesFromConfig(payload.normalizationRules, scoringConfig.normalizationRules);
  const responseText = resolveResponseText(response);
  const normalizedResponseText = normalizeTranscriptText(responseText, rules);
  const responseTokens = tokenizeTranscript(responseText, rules);
  const bestReference = pickBestReference(references, responseTokens, rules);
  if (!bestReference) {
    return { ok: false, warnings: ['Expected transcript could not be normalized for dictation scoring.'] };
  }

  const expectedTokens = bestReference.expectedTokens;
  const matchedPairs = bestReference.lcsPairs;
  const matchedCount = matchedPairs.length;
  const expectedTokenCount = expectedTokens.length;
  const responseTokenCount = responseTokens.length;
  const coverageRatio = expectedTokenCount > 0 ? matchedCount / expectedTokenCount : 0;

  const perWordScore = resolvePerWordScore(scoringConfig);
  const maxScore = resolveConfiguredMaxScore(scoringConfig, 1);
  const rawUnit = perWordScore > 0 ? perWordScore : 1;
  const scoreRaw = round2(matchedCount * rawUnit);
  const maxRaw = round2(Math.max(0.000001, expectedTokenCount * rawUnit));
  const normalizedRatio = maxRaw > 0 ? (scoreRaw / maxRaw) : coverageRatio;
  const scoreFinal = round2(Math.max(0, Math.min(maxScore, normalizedRatio * maxScore)));
  const percentage = maxScore > 0 ? round2((scoreFinal / maxScore) * 100) : 0;

  const matchedExpectedIndexes = new Set(matchedPairs.map((row) => row.sourceIndex));
  const matchedResponseIndexes = new Set(matchedPairs.map((row) => row.responseIndex));
  const missingTokens = expectedTokens
    .map((token, index) => ({ token, index }))
    .filter((row) => !matchedExpectedIndexes.has(row.index))
    .map((row) => row.token);
  const extraTokens = responseTokens
    .map((token, index) => ({ token, index }))
    .filter((row) => !matchedResponseIndexes.has(row.index))
    .map((row) => row.token);

  if (!responseTokens.length) warnings.push('No dictation response text was provided.');

  return {
    ok: true,
    scoreRaw,
    scoreFinal,
    maxScore,
    percentage,
    traitScores: {
      content: scoreFinal
    },
    matchedCount,
    expectedTokenCount,
    responseTokenCount,
    coverageRatio: round2(coverageRatio),
    normalizedExpectedText: normalizeTranscriptText(bestReference.transcript, rules),
    normalizedResponseText,
    referenceSource: bestReference.source,
    referenceIndex: bestReference.index,
    referenceTranscript: bestReference.transcript,
    missingTokens: missingTokens.slice(0, 30),
    extraTokens: extraTokens.slice(0, 30),
    rawUnit,
    normalizationRules: rules,
    warnings: normalizeWarnings(warnings)
  };
}

function buildObjectiveScorePayload(scoreFinal = 0, maxScore = 1) {
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

function evaluateMcqSingle({
  payload = {},
  response = {},
  scoringConfig = {}
} = {}) {
  const correctOptionKey = normalizeToken(payload.correctOptionKey || payload.correctOptionKeys?.[0] || '');
  if (!correctOptionKey) {
    return { ok: false, warnings: ['Listening MCQ Single scoring requires correctOptionKey in question payload.'] };
  }
  const selectedOptionKey = resolveSelectedSingle(response);
  const answered = Boolean(selectedOptionKey);
  const isCorrect = answered && selectedOptionKey === correctOptionKey;
  const maxScore = resolveConfiguredMaxScore(scoringConfig, 1);
  const negativeMarking = normalizeBooleanLike(scoringConfig.negativeMarking ?? payload.negativeMarking, false);
  const scoreFinal = isCorrect ? maxScore : ((negativeMarking && answered) ? -maxScore : 0);
  const warnings = answered ? [] : ['No option was selected for this Listening MCQ Single response.'];
  return {
    ok: true,
    ...buildObjectiveScorePayload(scoreFinal, maxScore),
    answered,
    isCorrect,
    correctOptionKey,
    selectedOptionKey,
    negativeMarking,
    warnings: normalizeWarnings(warnings)
  };
}

function evaluateSelectMissingWord({
  payload = {},
  response = {},
  scoringConfig = {}
} = {}) {
  const correctOptionKey = normalizeToken(payload.correctOptionKey || '');
  if (!correctOptionKey) {
    return { ok: false, warnings: ['Listening Select Missing Word scoring requires correctOptionKey in question payload.'] };
  }
  const selectedOptionKey = resolveSelectedSingle(response);
  const answered = Boolean(selectedOptionKey);
  const isCorrect = answered && selectedOptionKey === correctOptionKey;
  const maxScore = resolveConfiguredMaxScore(scoringConfig, 1);
  const negativeMarking = normalizeBooleanLike(scoringConfig.negativeMarking ?? payload.negativeMarking, false);
  const scoreFinal = isCorrect ? maxScore : ((negativeMarking && answered) ? -maxScore : 0);
  const warnings = answered ? [] : ['No option was selected for this Listening Select Missing Word response.'];
  return {
    ok: true,
    ...buildObjectiveScorePayload(scoreFinal, maxScore),
    answered,
    isCorrect,
    correctOptionKey,
    selectedOptionKey,
    negativeMarking,
    warnings: normalizeWarnings(warnings)
  };
}

function evaluateMcqMultiple({
  payload = {},
  response = {},
  scoringConfig = {}
} = {}) {
  const correctOptionKeys = normalizeTokenList(payload.correctOptionKeys || payload.correctOptionKey || []);
  if (!correctOptionKeys.length) {
    return { ok: false, warnings: ['Listening MCQ Multiple scoring requires correctOptionKeys in question payload.'] };
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
  const partialCreditEnabled = normalizeBooleanLike(scoringConfig.partialCreditEnabled ?? payload.partialCreditEnabled, false);
  const negativeMarking = normalizeBooleanLike(scoringConfig.negativeMarking ?? payload.negativeMarking, false);

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

  const warnings = answered ? [] : ['No options were selected for this Listening MCQ Multiple response.'];
  return {
    ok: true,
    ...buildObjectiveScorePayload(scoreFinal, maxScore),
    answered,
    exactMatch,
    coverageRatio: round2(coverageRatio),
    correctOptionKeys,
    selectedOptionKeys,
    matchedCorrect,
    missedCorrect,
    extraIncorrect,
    partialCreditEnabled,
    negativeMarking,
    warnings: normalizeWarnings(warnings)
  };
}

function evaluateFillInBlank({
  payload = {},
  response = {},
  scoringConfig = {}
} = {}) {
  const answerMap = isPlainObject(payload.blankAnswerMap) ? payload.blankAnswerMap : {};
  const blankKeys = sortBlankKeys(
    Object.keys(answerMap)
      .map((row) => s(row, 120))
      .filter(Boolean)
  );
  if (!blankKeys.length) {
    return { ok: false, warnings: ['Listening Fill in the Blanks scoring requires blankAnswerMap in question payload.'] };
  }

  const responseMap = resolveBlankResponseMap(response);
  const caseSensitive = normalizeBooleanLike(payload.caseSensitive, false);
  const allowSynonyms = normalizeBooleanLike(payload.allowSynonyms, false);
  const perBlankScore = resolvePerBlankScore(scoringConfig);
  const rawUnit = perBlankScore > 0 ? perBlankScore : 1;
  const rawMaxScore = blankKeys.length * rawUnit;
  const maxScore = resolveConfiguredMaxScore(scoringConfig, rawMaxScore || 1);

  let answeredCount = 0;
  let correctCount = 0;
  const mismatches = [];

  blankKeys.forEach((blankKey) => {
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
  });

  const rawScore = correctCount * rawUnit;
  const normalizedRatio = rawMaxScore > 0 ? (rawScore / rawMaxScore) : 0;
  const scoreFinal = round2(Math.max(0, Math.min(maxScore, normalizedRatio * maxScore)));
  const percentage = maxScore > 0 ? round2((scoreFinal / maxScore) * 100) : 0;
  const coverageRatio = blankKeys.length ? (correctCount / blankKeys.length) : 0;

  const warnings = [];
  if (!answeredCount) warnings.push('No blank responses were submitted for this Listening Fill in the Blanks item.');

  return {
    ok: true,
    scoreRaw: round2(rawScore),
    scoreFinal,
    maxScore,
    percentage,
    traitScores: {
      accuracy: scoreFinal
    },
    blankCount: blankKeys.length,
    answeredCount,
    correctCount,
    coverageRatio: round2(coverageRatio),
    rawUnit,
    mismatches: mismatches.slice(0, 30),
    caseSensitive,
    allowSynonyms,
    warnings: normalizeWarnings(warnings)
  };
}

function evaluateHighlightIncorrectWords({
  payload = {},
  response = {},
  scoringConfig = {}
} = {}) {
  const sourceTranscript = s(payload.transcript, 50000);
  const displayTranscript = s(payload.transcriptText || payload.transcript, 50000);
  const incorrectWords = Array.isArray(payload.incorrectWords)
    ? payload.incorrectWords.map((row) => s(row, 300)).filter(Boolean)
    : [];
  if (!displayTranscript) {
    return { ok: false, warnings: ['Listening Highlight Incorrect Words scoring requires transcriptText in question payload.'] };
  }
  if (!incorrectWords.length) {
    return { ok: false, warnings: ['Listening Highlight Incorrect Words scoring requires incorrectWords in question payload.'] };
  }

  const incorrectWordSet = new Set(incorrectWords.map((row) => row.toLowerCase()));
  const derivedRows = deriveIncorrectWordOccurrences(sourceTranscript, displayTranscript);
  let expectedRows = derivedRows.filter((row) => row && incorrectWordSet.has(String(row.norm || '').toLowerCase()));
  const warnings = [];

  if (!expectedRows.length) {
    const displayWords = tokenizeComparableWords(displayTranscript);
    expectedRows = displayWords.filter((row) => row && incorrectWordSet.has(String(row.norm || '').toLowerCase()));
    warnings.push('Expected incorrect-word indices were inferred from incorrectWords because transcript diff alignment was empty.');
  }

  const expectedIndices = new Set(
    expectedRows
      .map((row) => Number.parseInt(String(row?.index ?? ''), 10))
      .filter((value) => Number.isFinite(value) && !Number.isNaN(value) && value >= 0)
  );
  if (!expectedIndices.size) {
    return { ok: false, warnings: ['No expected incorrect-word positions could be derived from transcript payloads.'] };
  }

  const selection = resolveHighlightIncorrectSelection(response, displayTranscript);
  const selectedIndices = Array.isArray(selection.selectedIndices) ? selection.selectedIndices : [];
  const selectedSet = new Set(selectedIndices);
  const selectedWords = Array.isArray(selection.selectedWords)
    ? selection.selectedWords.map((row) => s(row, 200)).filter(Boolean)
    : [];

  const correctIndices = [];
  const falsePositiveIndices = [];
  selectedIndices.forEach((idx) => {
    if (expectedIndices.has(idx)) correctIndices.push(idx);
    else falsePositiveIndices.push(idx);
  });
  const missedIndices = Array.from(expectedIndices.values()).filter((idx) => !selectedSet.has(idx));

  const correctCount = correctIndices.length;
  const selectedCount = selectedIndices.length;
  const expectedCount = expectedIndices.size;
  const falsePositiveCount = falsePositiveIndices.length;
  const missedCount = missedIndices.length;
  const coverageRatio = expectedCount > 0 ? (correctCount / expectedCount) : 0;

  const perWordScore = resolvePerWordScore(scoringConfig);
  const rawUnit = perWordScore > 0 ? perWordScore : 1;
  const rawScore = correctCount * rawUnit;
  const rawMaxScore = expectedCount * rawUnit;
  const maxScore = resolveConfiguredMaxScore(scoringConfig, rawMaxScore || 1);
  const normalizedRatio = rawMaxScore > 0 ? (rawScore / rawMaxScore) : 0;
  const scoreFinal = round2(Math.max(0, Math.min(maxScore, normalizedRatio * maxScore)));
  const percentage = maxScore > 0 ? round2((scoreFinal / maxScore) * 100) : 0;

  if (!selectedCount) warnings.push('No words were highlighted for this Highlight Incorrect Words response.');

  return {
    ok: true,
    scoreRaw: round2(rawScore),
    scoreFinal,
    maxScore,
    percentage,
    traitScores: {
      accuracy: scoreFinal
    },
    expectedCount,
    selectedCount,
    correctCount,
    falsePositiveCount,
    missedCount,
    coverageRatio: round2(coverageRatio),
    rawUnit,
    expectedWords: expectedRows.map((row) => s(row.word, 200)).filter(Boolean).slice(0, 80),
    selectedWords: selectedWords.slice(0, 80),
    displayTranscript,
    expectedIndices: Array.from(expectedIndices.values()).sort((a, b) => a - b).slice(0, 120),
    selectedIndices: selectedIndices.slice(0, 120),
    correctIndices: correctIndices.slice(0, 120),
    falsePositiveIndices: falsePositiveIndices.slice(0, 120),
    missedIndices: missedIndices.slice(0, 120),
    warnings: normalizeWarnings(warnings)
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
  const scoreFinal = toFiniteNumber(evaluation.scoreFinal, 0);
  const maxScore = toFiniteNumber(evaluation.maxScore, 1);
  const scorerVersion = resolveScorerVersion(questionType);
  const primaryTraitKey = resolvePrimaryTraitKey(questionType);
  const metadataWarnings = normalizeWarnings([
    ...(Array.isArray(evaluation.warnings) ? evaluation.warnings : []),
    ...warnings
  ]);
  const traitMax = {
    [primaryTraitKey]: maxScore
  };

  const responseText = s(responsePayload.responseText || responsePayload.text || '', 50000);
  const responseMap = questionType === 'listening_fill_in_blank'
    ? resolveBlankResponseMap(responsePayload)
    : {};
  const selectedSingle = resolveSelectedSingle(responsePayload);
  const selectedMultiple = resolveSelectedMultiple(responsePayload);
  const hiwSelection = questionType === 'listening_highlight_incorrect_words'
    ? resolveHighlightIncorrectSelection(responsePayload, s(evaluation.displayTranscript || '', 50000))
    : { selectedIndices: [], selectedWords: [] };

  let aggregationBreakdown = {};
  if (questionType === 'listening_mcq_single') {
    aggregationBreakdown = {
      evaluator: 'mcq_single',
      correctOptionKey: s(evaluation.correctOptionKey, 120).toLowerCase(),
      selectedOptionKey: s(evaluation.selectedOptionKey, 120).toLowerCase(),
      answered: normalizeBooleanLike(evaluation.answered, false),
      isCorrect: normalizeBooleanLike(evaluation.isCorrect, false),
      negativeMarking: normalizeBooleanLike(evaluation.negativeMarking, false)
    };
  } else if (questionType === 'listening_select_missing_word') {
    aggregationBreakdown = {
      evaluator: 'select_missing_word',
      correctOptionKey: s(evaluation.correctOptionKey, 120).toLowerCase(),
      selectedOptionKey: s(evaluation.selectedOptionKey, 120).toLowerCase(),
      answered: normalizeBooleanLike(evaluation.answered, false),
      isCorrect: normalizeBooleanLike(evaluation.isCorrect, false),
      negativeMarking: normalizeBooleanLike(evaluation.negativeMarking, false)
    };
  } else if (questionType === 'listening_mcq_multiple') {
    aggregationBreakdown = {
      evaluator: 'mcq_multiple',
      correctOptionKeys: Array.isArray(evaluation.correctOptionKeys) ? evaluation.correctOptionKeys : [],
      selectedOptionKeys: Array.isArray(evaluation.selectedOptionKeys) ? evaluation.selectedOptionKeys : [],
      matchedCorrect: Array.isArray(evaluation.matchedCorrect) ? evaluation.matchedCorrect : [],
      missedCorrect: Array.isArray(evaluation.missedCorrect) ? evaluation.missedCorrect : [],
      extraIncorrect: Array.isArray(evaluation.extraIncorrect) ? evaluation.extraIncorrect : [],
      exactMatch: normalizeBooleanLike(evaluation.exactMatch, false),
      coverageRatio: toFiniteNumber(evaluation.coverageRatio, 0),
      partialCreditEnabled: normalizeBooleanLike(evaluation.partialCreditEnabled, false),
      negativeMarking: normalizeBooleanLike(evaluation.negativeMarking, false)
    };
  } else if (questionType === 'listening_fill_in_blank') {
    aggregationBreakdown = {
      blankCount: toFiniteNumber(evaluation.blankCount, 0),
      answeredCount: toFiniteNumber(evaluation.answeredCount, 0),
      correctCount: toFiniteNumber(evaluation.correctCount, 0),
      coverageRatio: toFiniteNumber(evaluation.coverageRatio, 0),
      perBlankScore: toFiniteNumber(evaluation.rawUnit, 1),
      caseSensitive: normalizeBooleanLike(evaluation.caseSensitive, false),
      allowSynonyms: normalizeBooleanLike(evaluation.allowSynonyms, false),
      rawScore: toFiniteNumber(evaluation.scoreRaw, 0),
      rawMaxScore: round2(toFiniteNumber(evaluation.blankCount, 0) * toFiniteNumber(evaluation.rawUnit, 1)),
      scaledScore: toFiniteNumber(evaluation.scoreFinal, 0),
      mismatches: Array.isArray(evaluation.mismatches) ? evaluation.mismatches : []
    };
  } else if (questionType === 'listening_highlight_incorrect_words') {
    aggregationBreakdown = {
      expectedCount: toFiniteNumber(evaluation.expectedCount, 0),
      selectedCount: toFiniteNumber(evaluation.selectedCount, 0),
      correctCount: toFiniteNumber(evaluation.correctCount, 0),
      falsePositiveCount: toFiniteNumber(evaluation.falsePositiveCount, 0),
      missedCount: toFiniteNumber(evaluation.missedCount, 0),
      coverageRatio: toFiniteNumber(evaluation.coverageRatio, 0),
      perWordScore: toFiniteNumber(evaluation.rawUnit, 1),
      rawScore: toFiniteNumber(evaluation.scoreRaw, 0),
      rawMaxScore: round2(toFiniteNumber(evaluation.expectedCount, 0) * toFiniteNumber(evaluation.rawUnit, 1)),
      scaledScore: toFiniteNumber(evaluation.scoreFinal, 0),
      expectedWords: Array.isArray(evaluation.expectedWords) ? evaluation.expectedWords : [],
      selectedWords: Array.isArray(evaluation.selectedWords) ? evaluation.selectedWords : [],
      expectedIndices: Array.isArray(evaluation.expectedIndices) ? evaluation.expectedIndices : [],
      selectedIndices: Array.isArray(evaluation.selectedIndices) ? evaluation.selectedIndices : [],
      correctIndices: Array.isArray(evaluation.correctIndices) ? evaluation.correctIndices : [],
      falsePositiveIndices: Array.isArray(evaluation.falsePositiveIndices) ? evaluation.falsePositiveIndices : [],
      missedIndices: Array.isArray(evaluation.missedIndices) ? evaluation.missedIndices : []
    };
  } else {
    aggregationBreakdown = {
      matchedTokenCount: toFiniteNumber(evaluation.matchedCount, 0),
      expectedTokenCount: toFiniteNumber(evaluation.expectedTokenCount, 0),
      responseTokenCount: toFiniteNumber(evaluation.responseTokenCount, 0),
      coverageRatio: toFiniteNumber(evaluation.coverageRatio, 0),
      perWordScore: toFiniteNumber(evaluation.rawUnit, 1),
      referenceSource: s(evaluation.referenceSource, 20),
      referenceIndex: toFiniteNumber(evaluation.referenceIndex, 0),
      missingTokens: Array.isArray(evaluation.missingTokens) ? evaluation.missingTokens : [],
      extraTokens: Array.isArray(evaluation.extraTokens) ? evaluation.extraTokens : []
    };
  }

  return {
    status,
    scorerKey: questionType,
    scorerVersion,
    scoringContractVersion: LISTENING_SCORING_CONTRACT_VERSION,
    scoreScale: 'raw_item_rubric_score',
    officialScoreEstimate: false,
    rubricSource: Array.isArray(rubric.rubricSources) ? rubric.rubricSources : [],
    configuredMethod: s(scoringConfig.method || '', 120) || 'auto_objective',
    microRubricVersion: LISTENING_MICRO_RUBRIC_VERSION,
    microAssessmentVersion: LISTENING_MICRO_RUBRIC_VERSION,
    microResponses: [],
    microAssessments: [],
    legacyDirectModelScores: {},
    traitMax,
    [primaryTraitKey]: {
      score: scoreFinal,
      maxScore,
      descriptor: traitDescriptor(scoreFinal, maxScore)
    },
    aggregationBreakdown,
    normalizationRules: safeObject(evaluation.normalizationRules, {}),
    referenceTranscript: s(evaluation.referenceTranscript, 50000),
    normalizedExpectedText: s(evaluation.normalizedExpectedText, 50000),
    normalizedResponseText: s(evaluation.normalizedResponseText, 50000),
    responsePayloadMeta: {
      responseTextLength: responseText.length,
      mapTextLength: s(responsePayload.mapText, 200000).length,
      blankResponseCount: Object.keys(responseMap).length,
      highlightSelectedCount: Array.isArray(hiwSelection.selectedIndices) ? hiwSelection.selectedIndices.length : 0,
      selectedOptionKey: selectedSingle,
      selectedOptionCount: selectedMultiple.length
    },
    feedbackDraft: evaluation.feedbackDraft || null,
    warnings: metadataWarnings,
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
      aggregationBreakdown: {}
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

async function scoreListeningAttemptItem(args = {}) {
  const {
    item = {},
    question = {},
    responsePayload = {},
    scoringConfig = {}
  } = args;

  const questionType = s(item.questionType || question.questionType, 120).toLowerCase();
  if (!LISTENING_TYPES.has(questionType)) {
    return failedResult({
      questionType,
      scoringConfig,
      responsePayload,
      warnings: ['Unsupported Listening scorer question type.']
    });
  }

  const payload = resolveQuestionPayload(question, item);
  const response = resolveResponsePayload(responsePayload, item);

  let evaluation = null;
  if (questionType === 'listening_mcq_single') {
    evaluation = evaluateMcqSingle({ payload, response, scoringConfig });
  } else if (questionType === 'listening_select_missing_word') {
    evaluation = evaluateSelectMissingWord({ payload, response, scoringConfig });
  } else if (questionType === 'listening_mcq_multiple') {
    evaluation = evaluateMcqMultiple({ payload, response, scoringConfig });
  } else if (questionType === 'listening_dictation') {
    evaluation = evaluateDictation({ payload, response, scoringConfig });
  } else if (questionType === 'listening_fill_in_blank') {
    evaluation = evaluateFillInBlank({ payload, response, scoringConfig });
  } else if (questionType === 'listening_highlight_incorrect_words') {
    evaluation = evaluateHighlightIncorrectWords({ payload, response, scoringConfig });
  } else {
    evaluation = { ok: false, warnings: ['No listening evaluator exists for this question type.'] };
  }

  if (!evaluation?.ok) {
    return failedResult({
      questionType,
      scoringConfig,
      responsePayload: response,
      warnings: normalizeWarnings(evaluation?.warnings || ['Listening scoring evaluation failed.'])
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
  LISTENING_SCORING_CONTRACT_VERSION,
  LISTENING_MICRO_RUBRIC_VERSION,
  scoreListeningAttemptItem
};
