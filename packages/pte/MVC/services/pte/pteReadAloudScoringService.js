const path = require('path');
const pteAiProviderDataService = require('./pteAiProviderDataService');
const pteAiProviderService = require('./ai/aiProviderService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');
const {
  READ_ALOUD_SCORER_VERSION,
  getRubric
} = require('./pteScoringRubricRegistry');
const {
  buildOpenAiAudioModelCompatibilityError,
  isOpenAiCompatibleProvider,
  prepareAudioForScoringProvider
} = require('./pteScoringAudioPreparationService');
const {
  MICRO_SCORING_CONTRACT_VERSION,
  buildMicroFeedbackRows,
  buildMicroResponsesSchema,
  buildMicroRubricPrompt,
  collectLegacyDirectModelScores,
  evaluateSpeakingMicroRubric,
  normalizeMicroResponseRows
} = require('./pteSpeakingMicroRubricService');
const { readUploadArtifactForAi } = require('./pteScoringArtifactReader');

const AUDIO_MAX_BYTES = 35 * 1024 * 1024;
const MAX_ALIGNMENT_SAMPLES = 25;

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

function normalizeBandScore(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(5, Math.max(0, Math.round(numeric)));
}

function normalizeConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const normalized = numeric > 1 ? numeric / 100 : numeric;
  return round2(Math.min(1, Math.max(0, normalized)));
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

function isTechnicalScoringWarning(row = '') {
  const text = s(row, 700).toLowerCase();
  if (!text) return true;
  return (
    text.includes('did not return valid json')
    || text.includes('returned malformed json')
    || text.includes('transcript recovery returned malformed json')
    || text.includes('audio-only transcript recovery')
    || text.includes('recovered read aloud transcript')
    || text.includes('generated read aloud micro-rubric responses deterministically')
    || text.includes('recovered read aloud micro-rubric responses')
    || text.includes('micro-rubric recovery follow-up')
    || text.includes('provider response did not include')
    || text.includes('scorer retried')
    || text.includes('scorer switched this request')
  );
}

function splitWarningsForAudience(rows = []) {
  const warnings = normalizeWarnings(rows);
  return {
    publicWarnings: warnings.filter((row) => !isTechnicalScoringWarning(row)),
    technicalWarnings: warnings.filter((row) => isTechnicalScoringWarning(row))
  };
}

function isLegacyDirectScoring(scoringConfig = {}) {
  return s(scoringConfig?.method || '', 120).toLowerCase() === 'legacy_ai_direct';
}

function hasUsableReadAloudMicroResponses(aiAnalysis = {}, scoringConfig = {}) {
  if (isLegacyDirectScoring(scoringConfig)) return true;
  const microEvaluation = evaluateSpeakingMicroRubric({
    questionType: 'speaking_read_aloud',
    aiAnalysis,
    traitMax: { pronunciation: 5, fluency: 5 }
  });
  return microEvaluation.ok;
}

function normalizeTokenUsage(usage = null) {
  const row = isPlainObject(usage) ? usage : {};
  const normalizeCount = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : null;
  };
  return {
    promptTokenCount: normalizeCount(row.promptTokenCount),
    candidatesTokenCount: normalizeCount(row.candidatesTokenCount),
    totalTokenCount: normalizeCount(row.totalTokenCount),
    cachedContentTokenCount: normalizeCount(row.cachedContentTokenCount)
  };
}

function mergeTokenUsage(...usageRows) {
  const totals = {
    promptTokenCount: null,
    candidatesTokenCount: null,
    totalTokenCount: null,
    cachedContentTokenCount: null
  };
  usageRows.forEach((usage) => {
    const normalized = normalizeTokenUsage(usage);
    Object.keys(totals).forEach((key) => {
      const value = normalized[key];
      if (!Number.isFinite(Number(value))) return;
      totals[key] = (totals[key] || 0) + Number(value);
    });
  });
  return totals;
}

function normalizeTextArray(value, maxRows = 10) {
  const source = Array.isArray(value) ? value : (s(value) ? [value] : []);
  return source
    .map((row) => s(row, 500))
    .filter(Boolean)
    .slice(0, maxRows);
}

function firstNonEmptyText(values = [], max = 50000) {
  for (const value of values) {
    const text = s(value, max);
    if (text) return text;
  }
  return '';
}

function looksLikeTranscriptRefusal(text = '') {
  const token = s(text, 1000).toLowerCase();
  if (!token) return true;
  return (
    /\b(i|we)\s+(cannot|can't|can not|am unable|are unable|could not|couldn't)\s+(transcribe|hear|analyze|access|process)/i.test(token)
    || /\b(no|missing|unusable)\s+(audio|speech|recording|transcript)\b/i.test(token)
    || /\b(audio|speech|recording)\s+(is|was)\s+(inaudible|silent|empty|missing|unusable)\b/i.test(token)
    || /\btranscript\s+(not available|unavailable|not provided|missing)\b/i.test(token)
  );
}

function normalizeTranscriptCandidate(value, max = 50000) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = s(value, max);
    return looksLikeTranscriptRefusal(text) ? '' : text;
  }

  if (Array.isArray(value)) {
    const joined = value
      .map((row) => normalizeTranscriptCandidate(row, max))
      .filter(Boolean)
      .join(' ')
      .trim();
    return looksLikeTranscriptRefusal(joined) ? '' : s(joined, max);
  }

  if (!isPlainObject(value)) return '';

  const direct = firstNonEmptyText([
    value.transcript,
    value.text,
    value.content,
    value.utterance,
    value.displayText,
    value.normalizedText,
    value.value
  ], max);
  if (direct && !looksLikeTranscriptRefusal(direct)) return direct;

  const segments = value.segments || value.transcriptSegments || value.results || value.alternatives || value.words;
  if (Array.isArray(segments)) {
    return normalizeTranscriptCandidate(segments, max);
  }

  return '';
}

function resolveTranscriptFromParsedAnalysis(parsed = {}) {
  if (!isPlainObject(parsed)) return '';
  const candidates = [
    parsed.transcript,
    parsed.spokenTranscript,
    parsed.asrTranscript,
    parsed.audioTranscript,
    parsed.responseTranscript,
    parsed.candidateTranscript,
    parsed.transcribedText,
    parsed.transcriptionText,
    parsed.recognizedText,
    parsed.recognisedText,
    parsed.recognizedSpeech,
    parsed.recognisedSpeech,
    parsed.transcription,
    parsed.asr,
    parsed.audio,
    parsed.speech,
    parsed.recognition,
    parsed.result,
    parsed.response,
    parsed.output,
    parsed.segments,
    parsed.results,
    parsed.alternatives,
    parsed.text
  ];

  for (const candidate of candidates) {
    const transcript = normalizeTranscriptCandidate(candidate);
    if (transcript) return transcript;
  }
  return '';
}

const TRANSCRIPT_FIELD_NAMES = Object.freeze([
  'transcript',
  'spokenTranscript',
  'asrTranscript',
  'audioTranscript',
  'responseTranscript',
  'candidateTranscript',
  'spokenResponse',
  'spoken_response',
  'candidateResponse',
  'candidate_response',
  'spokenText',
  'spoken_text',
  'responseText',
  'response_text',
  'audioText',
  'audio_text',
  'speechText',
  'speech_text',
  'transcribedText',
  'transcriptionText',
  'recognizedText',
  'recognisedText',
  'recognizedSpeech',
  'recognisedSpeech',
  'transcription',
  'text'
]);

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenizeForReadAloud(text = '') {
  const normalized = s(text, 50000)
    .toLowerCase()
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u2010-\u2015]/g, '-');
  return normalized.match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) || [];
}

function operationTieRank(operation = '') {
  if (operation === 'match') return 0;
  if (operation === 'replace') return 1;
  if (operation === 'delete') return 2;
  if (operation === 'insert') return 3;
  return 9;
}

function chooseAlignmentCandidate(current, candidate) {
  if (!current) return candidate;
  if (candidate.cost < current.cost) return candidate;
  if (candidate.cost > current.cost) return current;
  return operationTieRank(candidate.operation) < operationTieRank(current.operation)
    ? candidate
    : current;
}

function alignReadAloudTokens(sourceTokensInput = [], responseTokensInput = []) {
  const sourceTokens = Array.isArray(sourceTokensInput) ? sourceTokensInput : [];
  const responseTokens = Array.isArray(responseTokensInput) ? responseTokensInput : [];
  const sourceCount = sourceTokens.length;
  const responseCount = responseTokens.length;
  const dp = Array.from({ length: sourceCount + 1 }, () => Array(responseCount + 1).fill(null));

  dp[0][0] = { cost: 0, prevI: -1, prevJ: -1, operation: 'start' };
  for (let i = 1; i <= sourceCount; i += 1) {
    dp[i][0] = { cost: i, prevI: i - 1, prevJ: 0, operation: 'delete' };
  }
  for (let j = 1; j <= responseCount; j += 1) {
    dp[0][j] = { cost: j, prevI: 0, prevJ: j - 1, operation: 'insert' };
  }

  for (let i = 1; i <= sourceCount; i += 1) {
    for (let j = 1; j <= responseCount; j += 1) {
      const isMatch = sourceTokens[i - 1] === responseTokens[j - 1];
      const diagonal = {
        cost: dp[i - 1][j - 1].cost + (isMatch ? 0 : 1),
        prevI: i - 1,
        prevJ: j - 1,
        operation: isMatch ? 'match' : 'replace'
      };
      const deletion = {
        cost: dp[i - 1][j].cost + 1,
        prevI: i - 1,
        prevJ: j,
        operation: 'delete'
      };
      const insertion = {
        cost: dp[i][j - 1].cost + 1,
        prevI: i,
        prevJ: j - 1,
        operation: 'insert'
      };
      dp[i][j] = chooseAlignmentCandidate(
        chooseAlignmentCandidate(diagonal, deletion),
        insertion
      );
    }
  }

  const operations = [];
  let i = sourceCount;
  let j = responseCount;
  while (i > 0 || j > 0) {
    const cell = dp[i][j];
    if (!cell || cell.operation === 'start') break;
    const op = {
      type: cell.operation,
      sourceIndex: cell.operation === 'insert' ? null : i - 1,
      responseIndex: cell.operation === 'delete' ? null : j - 1,
      sourceToken: cell.operation === 'insert' ? '' : sourceTokens[i - 1],
      responseToken: cell.operation === 'delete' ? '' : responseTokens[j - 1]
    };
    operations.push(op);
    i = cell.prevI;
    j = cell.prevJ;
  }
  operations.reverse();

  const counts = operations.reduce((acc, op) => {
    if (op.type === 'match') acc.matchCount += 1;
    if (op.type === 'replace') acc.replacementCount += 1;
    if (op.type === 'delete') acc.omissionCount += 1;
    if (op.type === 'insert') acc.insertionCount += 1;
    return acc;
  }, {
    matchCount: 0,
    replacementCount: 0,
    omissionCount: 0,
    insertionCount: 0
  });

  const errorCount = counts.replacementCount + counts.omissionCount + counts.insertionCount;
  const samples = operations
    .filter((op) => op.type !== 'match')
    .slice(0, MAX_ALIGNMENT_SAMPLES)
    .map((op) => ({
      type: op.type === 'delete' ? 'omission' : op.type,
      sourceWord: op.sourceToken,
      transcriptWord: op.responseToken,
      sourceIndex: op.sourceIndex,
      transcriptIndex: op.responseIndex
    }));

  return {
    sourceWordCount: sourceCount,
    responseWordCount: responseCount,
    errorCount,
    ...counts,
    operations,
    samples
  };
}

function extractJsonObject(text = '') {
  const raw = s(text, 200000);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    // Continue with fenced/embedded JSON extraction.
  }

  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch (_) {
      // Continue with balanced-brace extraction.
    }
  }

  const start = raw.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, index + 1));
        } catch (_) {
          return null;
        }
      }
    }
  }
  return null;
}

function stripMarkdownCodeFence(text = '') {
  const raw = s(text, 200000);
  if (!raw) return '';
  return raw
    .replace(/^\s*```(?:json|javascript|js)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function decodeLooseJsonString(value = '') {
  const raw = String(value ?? '')
    .replace(/\0/g, '')
    .trim();
  if (!raw) return '';

  try {
    return JSON.parse(`"${raw.replace(/[\r\n]/g, '\\n')}"`);
  } catch (_) {
    return raw
      .replace(/\\r\\n|\\n|\\r/g, ' ')
      .replace(/\\t/g, ' ')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .trim();
  }
}

function extractLooseTranscriptField(text = '') {
  const raw = s(text, 200000);
  if (!raw) return '';
  const cleaned = stripMarkdownCodeFence(raw)
    .replace(/```(?:json|javascript|js)?/ig, '')
    .replace(/```/g, '')
    .trim();
  if (!cleaned) return '';

  const fieldPattern = TRANSCRIPT_FIELD_NAMES.map(escapeRegex).join('|');
  const strictPattern = new RegExp(`"(?:${fieldPattern})"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'i');
  const strictMatch = cleaned.match(strictPattern);
  if (strictMatch?.[1]) {
    return normalizeTranscriptCandidate(decodeLooseJsonString(strictMatch[1]), 50000);
  }

  const loosePattern = new RegExp(`"(?:${fieldPattern})"\\s*:\\s*"([\\s\\S]*?)(?:"\\s*(?:[,}\\]])|\\n\\s*"[A-Za-z_][A-Za-z0-9_]*"\\s*:|\\n\\s*[}\\]]|$)`, 'i');
  const looseMatch = cleaned.match(loosePattern);
  if (!looseMatch?.[1]) return '';

  const candidate = decodeLooseJsonString(looseMatch[1])
    .replace(/\s*[}\]]\s*$/, '')
    .trim();
  return normalizeTranscriptCandidate(candidate, 50000);
}

function looksLikeJsonishTranscriptPayload(text = '') {
  const raw = s(text, 4000);
  if (!raw) return false;
  const cleaned = stripMarkdownCodeFence(raw);
  const fieldPattern = TRANSCRIPT_FIELD_NAMES.map(escapeRegex).join('|');
  const fieldRegex = new RegExp(`"(?:${fieldPattern})"\\s*:`, 'i');
  return (
    /```(?:json|javascript|js)?/i.test(raw)
    || /^\s*[{[]/.test(cleaned)
    || fieldRegex.test(raw)
  );
}

function parseAiReadAloudAnalysis(input = {}) {
  const parsed = typeof input === 'string'
    ? extractJsonObject(input)
    : (isPlainObject(input) ? input : null);
  if (!isPlainObject(parsed)) {
    return {
      transcript: '',
      pronunciation: { score: 0, maxScore: 5, evidence: [], notes: '' },
      fluency: { score: 0, maxScore: 5, evidence: [], notes: '' },
      speechMetrics: {},
      intelligibilityNotes: '',
      microResponses: [],
      confidence: 0,
      warnings: ['AI audio analysis did not return valid JSON.']
    };
  }

  const pronunciationRaw = safeObject(parsed.pronunciation, {});
  const fluencyRaw = safeObject(parsed.fluency, {});
  const metricsRaw = safeObject(parsed.speechMetrics || parsed.metrics || parsed.timingMeta, {});
  const pauseRaw = safeObject(parsed.pauseEvidence || parsed.pauses, {});

  const speechDurationSeconds = toFiniteNumber(
    metricsRaw.speechDurationSeconds
      ?? metricsRaw.durationSeconds
      ?? parsed.speechDurationSeconds
      ?? parsed.durationSeconds,
    0
  );
  const estimatedWpm = toFiniteNumber(
    metricsRaw.estimatedWpm
      ?? metricsRaw.wpm
      ?? parsed.estimatedWpm
      ?? parsed.wpm,
    0
  );

  return {
    transcript: resolveTranscriptFromParsedAnalysis(parsed),
    pronunciation: {
      score: normalizeBandScore(
        pronunciationRaw.score
          ?? pronunciationRaw.band
          ?? parsed.pronunciationScore
          ?? parsed.pronunciationBand,
        0
      ),
      maxScore: 5,
      evidence: normalizeTextArray(pronunciationRaw.evidence || parsed.pronunciationEvidence, 12),
      notes: s(pronunciationRaw.notes || parsed.pronunciationNotes || '', 1500)
    },
    fluency: {
      score: normalizeBandScore(
        fluencyRaw.score
          ?? fluencyRaw.band
          ?? parsed.fluencyScore
          ?? parsed.fluencyBand,
        0
      ),
      maxScore: 5,
      evidence: normalizeTextArray(fluencyRaw.evidence || parsed.fluencyEvidence, 12),
      notes: s(fluencyRaw.notes || parsed.fluencyNotes || '', 1500)
    },
    speechMetrics: {
      speechDurationSeconds: round2(speechDurationSeconds),
      estimatedWpm: round2(estimatedWpm),
      longPauseCount: Math.max(0, Math.round(toFiniteNumber(
        metricsRaw.longPauseCount ?? pauseRaw.longPauseCount ?? parsed.longPauseCount,
        0
      ))),
      longestPauseSeconds: round2(toFiniteNumber(
        metricsRaw.longestPauseSeconds ?? pauseRaw.longestPauseSeconds ?? parsed.longestPauseSeconds,
        0
      )),
      hesitationCount: Math.max(0, Math.round(toFiniteNumber(
        metricsRaw.hesitationCount ?? parsed.hesitationCount,
        0
      ))),
      repetitionCount: Math.max(0, Math.round(toFiniteNumber(
        metricsRaw.repetitionCount ?? parsed.repetitionCount,
        0
      ))),
      rhythmNotes: s(metricsRaw.rhythmNotes || parsed.rhythmNotes || '', 1500),
      pauseEvidence: normalizeTextArray(metricsRaw.pauseEvidence || pauseRaw.evidence || parsed.pauseEvidence, 12),
      hesitationEvidence: normalizeTextArray(metricsRaw.hesitationEvidence || parsed.hesitationEvidence, 12)
    },
    intelligibilityNotes: s(parsed.intelligibilityNotes || parsed.intelligibility || '', 1500),
    microResponses: normalizeMicroResponseRows(parsed),
    confidence: normalizeConfidence(parsed.confidence ?? metricsRaw.confidence),
    warnings: normalizeWarnings(parsed.warnings || parsed.warning || [])
  };
}

function parseAiReadAloudTranscriptRecovery(input = {}) {
  const raw = typeof input === 'string' ? s(input, 200000) : '';
  const parsed = typeof input === 'string'
    ? extractJsonObject(input)
    : (isPlainObject(input) ? input : null);
  if (isPlainObject(parsed)) {
    const metricsRaw = safeObject(parsed.speechMetrics || parsed.metrics || parsed.timingMeta, {});
    return {
      transcript: resolveTranscriptFromParsedAnalysis(parsed),
      speechMetrics: {
        speechDurationSeconds: round2(toFiniteNumber(
          metricsRaw.speechDurationSeconds
            ?? metricsRaw.durationSeconds
            ?? parsed.speechDurationSeconds
            ?? parsed.durationSeconds,
          0
        )),
        estimatedWpm: round2(toFiniteNumber(metricsRaw.estimatedWpm ?? metricsRaw.wpm ?? parsed.estimatedWpm, 0))
      },
      confidence: normalizeConfidence(parsed.confidence ?? metricsRaw.confidence),
      warnings: normalizeWarnings(parsed.warnings || parsed.warning || [])
    };
  }

  const looseTranscript = extractLooseTranscriptField(raw);
  if (looseTranscript) {
    return {
      transcript: looseTranscript,
      speechMetrics: {},
      confidence: 0.5,
      warnings: ['Read Aloud transcript recovery returned malformed JSON; transcript field was recovered.']
    };
  }

  const isJsonish = looksLikeJsonishTranscriptPayload(raw);
  const transcript = isJsonish
    ? ''
    : normalizeTranscriptCandidate(stripMarkdownCodeFence(raw), 50000);
  return {
    transcript,
    speechMetrics: {},
    confidence: transcript ? 0.5 : 0,
    warnings: transcript
      ? ['Read Aloud transcript recovery returned plain text instead of JSON.']
      : ['Read Aloud transcript recovery did not return valid JSON or a usable transcript field.']
  };
}

function buildReadAloudDeterministicMicroEvaluation({
  aiAnalysis = {},
  scoringConfig = {},
  reason = ''
} = {}) {
  if (isLegacyDirectScoring(scoringConfig)) return null;
  const transcript = s(aiAnalysis?.transcript || '', 50000);
  if (!transcript) return null;

  const transcriptWords = tokenizeForReadAloud(transcript).length;
  const speechMetrics = safeObject(aiAnalysis?.speechMetrics, {});
  const idealMin = toFiniteNumber(scoringConfig.idealWpmMin, 90);
  const idealMax = toFiniteNumber(scoringConfig.idealWpmMax, 160);
  const wpm = toFiniteNumber(speechMetrics.estimatedWpm ?? speechMetrics.wpm, 0);
  const longPauses = Math.max(0, Math.floor(toFiniteNumber(speechMetrics.longPauseCount, 0)));
  const hesitations = Math.max(0, Math.floor(toFiniteNumber(speechMetrics.hesitationCount, 0)));
  const repetitions = Math.max(0, Math.floor(toFiniteNumber(speechMetrics.repetitionCount, 0)));

  const pronunciationChoice = transcriptWords >= 5 ? 'developing' : 'limited';
  let fluencyChoice = 'developing';
  if (transcriptWords < 5) fluencyChoice = 'limited';
  else if (wpm >= idealMin && wpm <= idealMax && longPauses <= 1 && hesitations <= 2 && repetitions <= 2) fluencyChoice = 'good';
  else if ((wpm > 0 && (wpm < 55 || wpm > 210)) || longPauses >= 4 || hesitations >= 6) fluencyChoice = 'limited';

  const microResponses = [
    {
      id: 'pronunciation_quality',
      choice: pronunciationChoice,
      evidence: 'Detailed pronunciation evidence was limited, so pronunciation was capped conservatively from the recovered audio transcript. Focus on clearer word endings, stress, and sounds.',
      confidence: 0.45
    },
    {
      id: 'fluency_quality',
      choice: fluencyChoice,
      evidence: wpm > 0
        ? `Fluency was scored conservatively from available timing evidence: ${round2(wpm)} WPM, ${longPauses} long pause(s), ${hesitations} hesitation(s), ${repetitions} repetition(s).`
        : 'Detailed fluency evidence was limited, so fluency was capped conservatively from the recovered transcript length.',
      confidence: 0.45
    }
  ];

  const evaluation = evaluateSpeakingMicroRubric({
    questionType: 'speaking_read_aloud',
    aiAnalysis: { microResponses },
    traitMax: { pronunciation: 5, fluency: 5 }
  });
  if (!evaluation.ok) return null;
  return {
    ...evaluation,
    warnings: normalizeWarnings([
      ...(Array.isArray(evaluation.warnings) ? evaluation.warnings : []),
      reason || 'Generated Read Aloud micro-rubric responses deterministically from the recovered transcript because the AI provider omitted required micro answers.'
    ])
  };
}

function calculateReadAloudScore({
  sourceText = '',
  transcript = '',
  aiAnalysis = {},
  microTraitScores = null
} = {}) {
  const sourceTokens = tokenizeForReadAloud(sourceText);
  const responseTokens = tokenizeForReadAloud(transcript);
  const alignment = alignReadAloudTokens(sourceTokens, responseTokens);
  const contentMax = sourceTokens.length;
  const contentScore = Math.max(0, contentMax - alignment.errorCount);
  const pronunciationScore = microTraitScores && Number.isFinite(Number(microTraitScores.pronunciation))
    ? normalizeBandScore(microTraitScores.pronunciation, 0)
    : normalizeBandScore(aiAnalysis?.pronunciation?.score, 0);
  const fluencyScore = microTraitScores && Number.isFinite(Number(microTraitScores.fluency))
    ? normalizeBandScore(microTraitScores.fluency, 0)
    : normalizeBandScore(aiAnalysis?.fluency?.score, 0);
  const scoreFinal = contentScore + pronunciationScore + fluencyScore;
  const maxScore = contentMax + 10;
  const percentage = maxScore > 0 ? round2((scoreFinal / maxScore) * 100) : 0;

  return {
    scoreRaw: scoreFinal,
    scoreFinal,
    maxScore,
    percentage,
    traitScores: {
      content: contentScore,
      pronunciation: pronunciationScore,
      fluency: fluencyScore
    },
    evidence: {
      alignment: {
        ...alignment,
        operations: undefined,
        contentScore,
        contentMax
      },
      sourceTokens,
      responseTokens
    }
  };
}

function resolveQuestionPayload(question = {}, item = {}) {
  const metadata = safeObject(item?.metadata, {});
  const snapshotPayload = safeObject(metadata.questionSnapshot?.payload, {});
  if (Object.keys(snapshotPayload).length) return snapshotPayload;
  const storedPayload = safeObject(metadata.questionPayload || metadata.payload, {});
  if (Object.keys(storedPayload).length) return storedPayload;
  return safeObject(question?.payload, {});
}

function resolveSourceText(question = {}, item = {}) {
  const payload = resolveQuestionPayload(question, item);
  return s(
    payload.sourceText
      || payload.referenceTranscript
      || question.sourceText
      || item?.metadata?.sourceText
      || '',
    50000
  );
}

function inferAudioMimeType(artifact = {}, absolutePath = '') {
  const fromArtifact = s(artifact.mimeType || artifact.contentType, 120).toLowerCase();
  if (fromArtifact.startsWith('audio/')) return fromArtifact;
  const ext = path.extname(absolutePath || artifact.path || artifact.url || '').toLowerCase();
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.ogg' || ext === '.oga') return 'audio/ogg';
  if (ext === '.webm') return 'audio/webm';
  return fromArtifact || 'audio/webm';
}

function buildAudioProviderCompatibilityError(providerId = '', modelId = '', mimeType = '') {
  const providerToken = s(providerId, 80).toLowerCase();
  const mimeToken = s(mimeType, 120).toLowerCase();
  if (!providerToken) return '';

  if (providerToken === 'google-gemini' || providerToken === 'google-vertex') {
    return '';
  }

  if (providerToken === 'openai' || providerToken === 'azure-openai') {
    const supported = /audio\/(mpeg|mp3|wav|x-wav)/i.test(mimeToken);
    if (supported) {
      return buildOpenAiAudioModelCompatibilityError(providerToken, modelId, 'Read Aloud scoring');
    }
    return `Selected provider "${providerToken}" cannot reliably score ${mimeToken || 'this audio format'} in the current PTE audio scorer. OpenAI-compatible scoring requires prepared MP3 or WAV audio.`;
  }

  if (providerToken === 'anthropic') {
    return 'Selected provider "anthropic" is not supported for Read Aloud audio transcription in the current PTE scorer. Use Google Gemini/Vertex, or OpenAI/Azure with MP3 or WAV audio.';
  }

  return `Selected provider "${providerToken}" is not supported for Read Aloud audio transcription in the current PTE scorer.`;
}

function isGeminiFlashRuntimeProvider(runtimeProvider = {}) {
  const providerId = s(runtimeProvider?.providerId, 80).toLowerCase();
  if (providerId !== 'google-gemini' && providerId !== 'google-vertex') return false;
  const modelToken = s(runtimeProvider?.modelId || runtimeProvider?.modelUsed, 220).toLowerCase();
  return modelToken.includes('flash');
}

function artifactLooksLikeAudio(artifact = {}) {
  const type = s(artifact.artifactType || artifact.type, 80).toLowerCase();
  const mimeType = s(artifact.mimeType || artifact.contentType, 120).toLowerCase();
  if (type === 'audio') return true;
  if (mimeType.startsWith('audio/')) return true;
  const name = s(artifact.name || artifact.path || artifact.url, 1000).toLowerCase();
  return /\.(webm|wav|mp3|m4a|ogg|oga)$/.test(name);
}

function selectAudioArtifact({ item = {}, artifacts = [], responsePayload = {} } = {}) {
  const rows = (Array.isArray(artifacts) ? artifacts : []).filter((row) => isPlainObject(row));
  if (!rows.length) return null;
  const preferredIds = [
    responsePayload.artifactId,
    responsePayload.audioArtifactId,
    responsePayload.audioAssetId,
    ...(Array.isArray(item.artifactIds) ? item.artifactIds : [])
  ].map((id) => s(id, 160)).filter(Boolean);
  const audioRows = rows.filter(artifactLooksLikeAudio);
  if (preferredIds.length) {
    const match = audioRows.find((row) => preferredIds.includes(s(row.id || row._id || row.clientArtifactId, 160)));
    if (match) return match;
  }
  return audioRows[0] || null;
}

function buildReadAloudAnalysisResponseSchema() {
  return {
    type: 'object',
    additionalProperties: true,
    required: ['transcript', 'microResponses', 'speechMetrics', 'confidence'],
    properties: {
      transcript: { type: 'string' },
      intelligibilityNotes: { type: 'string' },
      confidence: { type: 'number' },
      microResponses: buildMicroResponsesSchema(),
      pronunciation: {
        type: 'object',
        additionalProperties: true,
        required: ['score'],
        properties: {
          score: { type: 'number' },
          evidence: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' }
        }
      },
      fluency: {
        type: 'object',
        additionalProperties: true,
        required: ['score'],
        properties: {
          score: { type: 'number' },
          evidence: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' }
        }
      },
      speechMetrics: {
        type: 'object',
        additionalProperties: true,
        properties: {
          speechDurationSeconds: { type: 'number' },
          estimatedWpm: { type: 'number' },
          longPauseCount: { type: 'number' },
          longestPauseSeconds: { type: 'number' },
          hesitationCount: { type: 'number' },
          repetitionCount: { type: 'number' },
          rhythmNotes: { type: 'string' },
          pauseEvidence: { type: 'array', items: { type: 'string' } },
          hesitationEvidence: { type: 'array', items: { type: 'string' } }
        }
      },
      warnings: { type: 'array', items: { type: 'string' } }
    }
  };
}

function buildAudioAnalysisPrompt({ sourceText = '', recordingDurationSeconds = 0, scoringConfig = {} } = {}) {
  const idealWpmMin = toFiniteNumber(scoringConfig.idealWpmMin, 90);
  const idealWpmMax = toFiniteNumber(scoringConfig.idealWpmMax, 160);
  const longPauseSeconds = toFiniteNumber(scoringConfig.longPauseSeconds, 2);
  return [
    'Analyze the attached PTE Read Aloud response audio.',
    'Use the audio as the only source for the candidate response; ignore any typed transcript notes.',
    'Return strict JSON only.',
    'Required JSON keys: transcript, intelligibilityNotes, microResponses, speechMetrics, confidence, warnings.',
    'Do not provide final pronunciation or fluency scores; the server will aggregate the micro responses deterministically.',
    'Pronunciation must be grounded in intelligibility, segmental accuracy, stress, and listener effort.',
    'Fluency must be grounded in rhythm, phrasing, hesitations, repetitions, speech rate, and long pauses.',
    buildMicroRubricPrompt('speaking_read_aloud'),
    `Treat pauses around ${longPauseSeconds} seconds or longer as long pauses.`,
    `Use ${idealWpmMin}-${idealWpmMax} WPM as the rough comfortable rate guidance, not as a sole scoring rule.`,
    recordingDurationSeconds > 0 ? `Browser-recorded duration: ${round2(recordingDurationSeconds)} seconds.` : '',
    'Source text for context only:',
    sourceText
  ].filter(Boolean).join('\n');
}

async function sendReadAloudAudioAnalysisRequest({
  runtimeProvider = {},
  audio = {},
  systemPrompt = '',
  userPrompt = '',
  session = {},
  item = {},
  useStructuredSchema = true,
  requestLabel = 'pte-read-aloud-scoring-v1'
} = {}) {
  const promptText = useStructuredSchema
    ? userPrompt
    : [
      userPrompt,
      '',
      'Fallback formatting instruction:',
      'Return exactly one JSON object. Do not include markdown, commentary, or extra text.',
      'The JSON object must include transcript, intelligibilityNotes, microResponses, speechMetrics, confidence, and warnings.'
    ].join('\n');

  return pteAiProviderService.sendPrompt({
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { text: promptText },
          {
            inlineData: {
              mimeType: audio.mimeType,
              data: audio.dataBase64
            }
          }
        ]
      }
    ],
    providerId: runtimeProvider.providerId,
    modelId: runtimeProvider.modelId || null,
    credentials: runtimeProvider.credentials || {},
    generationConfig: {
      temperature: 0,
      topP: 1,
      maxOutputTokens: 2048
    },
    responseMimeType: useStructuredSchema ? 'application/json' : undefined,
    responseSchema: useStructuredSchema ? buildReadAloudAnalysisResponseSchema() : undefined,
    disableCache: true,
    requestLabel,
    timeoutMs: 120000,
    usageContext: {
      requestingUser: runtimeProvider.requestingUser || null,
      section: SECTIONS.PTE_SCORING,
      operation: OPERATIONS.AI_SCORING,
      objectId: s(item.id || session.id || 'DRAFT:read-aloud', 160),
      requestLabel,
      providerRecordId: s(runtimeProvider?.providerRecord?.id, 160),
      providerRecordName: s(runtimeProvider?.providerRecord?.name, 220),
      source: {
        module: 'pte_attempt_scoring',
        eventType: 'read_aloud_audio_analysis'
      }
    }
  });
}

async function sendReadAloudTranscriptRecoveryRequest({
  runtimeProvider = {},
  audio = {},
  session = {},
  item = {},
  requestLabel = 'pte-read-aloud-transcript-recovery-v1'
} = {}) {
  const promptText = [
    'Transcribe the attached PTE Read Aloud response audio.',
    'Use the audio only. Do not infer missing words from the source text, question, or typed notes.',
    'Return exactly one JSON object with keys: transcript, confidence, speechMetrics, warnings.',
    'transcript must contain only the words actually spoken by the candidate.',
    'If there is no usable speech, set transcript to an empty string and explain why in warnings.'
  ].join('\n');

  return pteAiProviderService.sendPrompt({
    messages: [
      {
        role: 'system',
        content: 'You are a careful audio transcription service. Return compact JSON only.'
      },
      {
        role: 'user',
        content: [
          { text: promptText },
          {
            inlineData: {
              mimeType: audio.mimeType,
              data: audio.dataBase64
            }
          }
        ]
      }
    ],
    providerId: runtimeProvider.providerId,
    modelId: runtimeProvider.modelId || null,
    credentials: runtimeProvider.credentials || {},
    generationConfig: {
      temperature: 0,
      topP: 1,
      maxOutputTokens: 700
    },
    disableCache: true,
    requestLabel,
    timeoutMs: 120000,
    usageContext: {
      requestingUser: runtimeProvider.requestingUser || null,
      section: SECTIONS.PTE_SCORING,
      operation: OPERATIONS.AI_SCORING,
      objectId: s(item.id || session.id || 'DRAFT:read-aloud-transcript', 160),
      requestLabel,
      providerRecordId: s(runtimeProvider?.providerRecord?.id, 160),
      providerRecordName: s(runtimeProvider?.providerRecord?.name, 220),
      source: {
        module: 'pte_attempt_scoring',
        eventType: 'read_aloud_audio_transcript_recovery'
      }
    }
  });
}

async function sendReadAloudMicroRubricRecoveryRequest({
  runtimeProvider = {},
  audio = {},
  transcript = '',
  sourceText = '',
  responsePayload = {},
  scoringConfig = {},
  session = {},
  item = {},
  requestLabel = 'pte-read-aloud-micro-rubric-recovery-v1'
} = {}) {
  const recordingDurationSeconds = toFiniteNumber(
    responsePayload.audioDurationSeconds
      ?? responsePayload.durationSeconds,
    0
  );
  const promptText = [
    'The previous PTE Read Aloud analysis produced a usable transcript but did not produce usable micro-rubric responses.',
    'Return compact JSON only.',
    'Use the attached audio for pronunciation and oral fluency evidence.',
    'Use the transcript below only as candidate wording context; trust the audio if there is any conflict.',
    'Do not provide final trait scores. The server aggregates microResponses deterministically.',
    'Required JSON keys: transcript, microResponses, speechMetrics, confidence, warnings.',
    'Use this exact shape: {"transcript":"...","microResponses":[{"id":"pronunciation_quality","choice":"good","evidence":"...","confidence":0.8},{"id":"fluency_quality","choice":"developing","evidence":"...","confidence":0.8}],"speechMetrics":{"estimatedWpm":120},"confidence":0.8,"warnings":[]}',
    '',
    buildAudioAnalysisPrompt({
      sourceText,
      recordingDurationSeconds,
      scoringConfig
    }),
    '',
    `Candidate transcript from the previous pass: ${s(transcript, 50000)}`
  ].filter(Boolean).join('\n');

  return pteAiProviderService.sendPrompt({
    messages: [
      {
        role: 'system',
        content: 'You are a careful PTE Read Aloud micro-rubric recovery service. Return compact JSON only.'
      },
      {
        role: 'user',
        content: [
          { text: promptText },
          {
            inlineData: {
              mimeType: audio.mimeType,
              data: audio.dataBase64
            }
          }
        ]
      }
    ],
    providerId: runtimeProvider.providerId,
    modelId: runtimeProvider.modelId || null,
    credentials: runtimeProvider.credentials || {},
    generationConfig: {
      temperature: 0,
      topP: 1,
      maxOutputTokens: 900
    },
    disableCache: true,
    requestLabel,
    timeoutMs: 140000,
    usageContext: {
      requestingUser: runtimeProvider.requestingUser || null,
      section: SECTIONS.PTE_SCORING,
      operation: OPERATIONS.AI_SCORING,
      objectId: s(item.id || session.id || 'DRAFT:read-aloud-micro-rubric', 160),
      requestLabel,
      providerRecordId: s(runtimeProvider?.providerRecord?.id, 160),
      providerRecordName: s(runtimeProvider?.providerRecord?.name, 220),
      source: {
        module: 'pte_attempt_scoring',
        eventType: 'read_aloud_audio_micro_rubric_recovery'
      }
    }
  });
}

function buildAnalysisBundleFromProviderResult(result = {}, runtimeProvider = {}, extraWarnings = []) {
  const responseText = s(result?.text || '', 200000);
  const analysis = parseAiReadAloudAnalysis(responseText);
  analysis.warnings = normalizeWarnings([
    ...(Array.isArray(analysis.warnings) ? analysis.warnings : []),
    ...(Array.isArray(runtimeProvider.providerSelectionWarnings) ? runtimeProvider.providerSelectionWarnings : []),
    ...extraWarnings
  ]);
  return {
    analysis,
    provider: {
      providerId: result?.provider || runtimeProvider.providerId,
      modelId: runtimeProvider.modelId || '',
      modelUsed: result?.modelUsed || runtimeProvider.modelId || '',
      providerRecordId: runtimeProvider?.providerRecord?.id || '',
      providerRecordName: runtimeProvider?.providerRecord?.name || '',
      providerSelectionSource: runtimeProvider.providerSelectionSource || 'default_provider',
      scoringSettingId: runtimeProvider.scoringSettingId || '',
      providerSelectionWarnings: normalizeWarnings(runtimeProvider.providerSelectionWarnings || []),
      responseTextPreview: s(responseText, 1000),
      responseCharCount: responseText.length,
      tokenUsage: normalizeTokenUsage(result?.usage)
    }
  };
}

function buildTranscriptRecoveryBundleFromProviderResult(result = {}, runtimeProvider = {}, extraWarnings = []) {
  const responseText = s(result?.text || '', 200000);
  const analysis = parseAiReadAloudTranscriptRecovery(responseText);
  analysis.warnings = normalizeWarnings([
    ...(Array.isArray(analysis.warnings) ? analysis.warnings : []),
    ...(Array.isArray(runtimeProvider.providerSelectionWarnings) ? runtimeProvider.providerSelectionWarnings : []),
    ...extraWarnings
  ]);
  return {
    analysis,
    provider: {
      providerId: result?.provider || runtimeProvider.providerId,
      modelId: runtimeProvider.modelId || '',
      modelUsed: result?.modelUsed || runtimeProvider.modelId || '',
      providerRecordId: runtimeProvider?.providerRecord?.id || '',
      providerRecordName: runtimeProvider?.providerRecord?.name || '',
      providerSelectionSource: runtimeProvider.providerSelectionSource || 'default_provider',
      scoringSettingId: runtimeProvider.scoringSettingId || '',
      providerSelectionWarnings: normalizeWarnings(runtimeProvider.providerSelectionWarnings || []),
      responseTextPreview: s(responseText, 1000),
      responseCharCount: responseText.length,
      tokenUsage: normalizeTokenUsage(result?.usage)
    }
  };
}

function attachAudioPreparationMetadata(bundle = {}, audioPreparation = {}) {
  const metadata = safeObject(audioPreparation?.metadata || audioPreparation, {});
  if (!metadata.providerId) return bundle;
  return {
    ...bundle,
    provider: {
      ...safeObject(bundle.provider, {}),
      audioPreparation: metadata
    }
  };
}

function mergeReadAloudTranscriptRecoveryBundle(bundle = {}, recoveryBundle = {}) {
  const baseAnalysis = parseAiReadAloudAnalysis(bundle?.analysis || bundle?.aiAnalysis || bundle);
  const recoveryAnalysis = parseAiReadAloudTranscriptRecovery(recoveryBundle?.analysis || recoveryBundle?.aiAnalysis || recoveryBundle);
  const transcript = s(recoveryAnalysis.transcript, 50000);
  if (!transcript) {
    baseAnalysis.warnings = normalizeWarnings([
      ...(Array.isArray(baseAnalysis.warnings) ? baseAnalysis.warnings : []),
      ...(Array.isArray(recoveryAnalysis.warnings) ? recoveryAnalysis.warnings : []),
      'Audio-only Read Aloud transcript recovery returned no usable transcript.'
    ]);
    return {
      ...bundle,
      analysis: baseAnalysis
    };
  }

  baseAnalysis.transcript = transcript;
  baseAnalysis.speechMetrics = {
    ...safeObject(recoveryAnalysis.speechMetrics, {}),
    ...safeObject(baseAnalysis.speechMetrics, {})
  };
  baseAnalysis.confidence = baseAnalysis.confidence || recoveryAnalysis.confidence || 0;
  baseAnalysis.warnings = normalizeWarnings([
    ...(Array.isArray(baseAnalysis.warnings) ? baseAnalysis.warnings : []),
    ...(Array.isArray(recoveryAnalysis.warnings) ? recoveryAnalysis.warnings : []),
    'Recovered Read Aloud transcript using an audio-only follow-up request.'
  ]);

  const provider = safeObject(bundle?.provider, {});
  const recoveryProvider = safeObject(recoveryBundle?.provider, {});
  return {
    ...bundle,
    analysis: baseAnalysis,
    provider: {
      ...provider,
      tokenUsage: mergeTokenUsage(provider.tokenUsage, recoveryProvider.tokenUsage),
      transcriptRecovery: {
        providerId: recoveryProvider.providerId || '',
        modelUsed: recoveryProvider.modelUsed || '',
        responseTextPreview: recoveryProvider.responseTextPreview || '',
        tokenUsage: normalizeTokenUsage(recoveryProvider.tokenUsage)
      }
    }
  };
}

async function recoverReadAloudTranscriptIfMissing({
  bundle = {},
  runtimeProvider = {},
  audio = {},
  session = {},
  item = {}
} = {}) {
  const analysis = parseAiReadAloudAnalysis(bundle?.analysis || bundle?.aiAnalysis || bundle);
  if (s(analysis.transcript, 50000)) return bundle;

  try {
    const recoveryResult = await sendReadAloudTranscriptRecoveryRequest({
      runtimeProvider,
      audio,
      session,
      item,
      requestLabel: 'pte-read-aloud-transcript-recovery-v1'
    });
    const recoveryBundle = buildTranscriptRecoveryBundleFromProviderResult(recoveryResult, runtimeProvider);
    return mergeReadAloudTranscriptRecoveryBundle(bundle, recoveryBundle);
  } catch (error) {
    const mergedAnalysis = parseAiReadAloudAnalysis(bundle?.analysis || bundle?.aiAnalysis || bundle);
    mergedAnalysis.warnings = normalizeWarnings([
      ...(Array.isArray(mergedAnalysis.warnings) ? mergedAnalysis.warnings : []),
      `Audio-only Read Aloud transcript recovery failed: ${s(error?.message || error, 500) || 'unknown error'}.`
    ]);
    return {
      ...bundle,
      analysis: mergedAnalysis
    };
  }
}

function mergeReadAloudMicroRubricRecoveryBundle(bundle = {}, recoveryBundle = {}, scoringConfig = {}) {
  const baseAnalysis = parseAiReadAloudAnalysis(bundle?.analysis || bundle?.aiAnalysis || bundle);
  const recoveryAnalysis = parseAiReadAloudAnalysis(recoveryBundle?.analysis || recoveryBundle?.aiAnalysis || recoveryBundle);
  const transcript = s(recoveryAnalysis.transcript || baseAnalysis.transcript, 50000);
  const recoveryWithTranscript = {
    ...recoveryAnalysis,
    transcript
  };
  const recoveryMicro = evaluateSpeakingMicroRubric({
    questionType: 'speaking_read_aloud',
    aiAnalysis: recoveryWithTranscript,
    traitMax: { pronunciation: 5, fluency: 5 }
  });
  const deterministicMicro = recoveryMicro.ok || recoveryMicro.invalidResponses?.length
    ? null
    : buildReadAloudDeterministicMicroEvaluation({
      aiAnalysis: {
        ...baseAnalysis,
        ...recoveryAnalysis,
        transcript,
        speechMetrics: {
          ...safeObject(baseAnalysis.speechMetrics, {}),
          ...safeObject(recoveryAnalysis.speechMetrics, {})
        }
      },
      scoringConfig,
      reason: 'Generated Read Aloud micro-rubric responses deterministically after the AI provider omitted required micro answers during recovery.'
    });
  const acceptedMicro = recoveryMicro.ok ? recoveryMicro : deterministicMicro;
  const provider = safeObject(bundle?.provider, {});
  const recoveryProvider = safeObject(recoveryBundle?.provider, {});

  if (!acceptedMicro?.ok) {
    baseAnalysis.warnings = normalizeWarnings([
      ...(Array.isArray(baseAnalysis.warnings) ? baseAnalysis.warnings : []),
      ...(Array.isArray(recoveryAnalysis.warnings) ? recoveryAnalysis.warnings : []),
      ...(Array.isArray(recoveryMicro.warnings) ? recoveryMicro.warnings : []),
      'Read Aloud micro-rubric recovery follow-up did not return usable micro-rubric responses.'
    ]);
    return {
      ...bundle,
      analysis: baseAnalysis,
      provider: {
        ...provider,
        tokenUsage: mergeTokenUsage(provider.tokenUsage, recoveryProvider.tokenUsage),
        microRubricRecovery: {
          providerId: recoveryProvider.providerId || '',
          modelUsed: recoveryProvider.modelUsed || '',
          responseTextPreview: recoveryProvider.responseTextPreview || '',
          tokenUsage: normalizeTokenUsage(recoveryProvider.tokenUsage)
        }
      }
    };
  }

  baseAnalysis.transcript = transcript;
  baseAnalysis.pronunciation = recoveryAnalysis.pronunciation || baseAnalysis.pronunciation;
  baseAnalysis.fluency = recoveryAnalysis.fluency || baseAnalysis.fluency;
  baseAnalysis.microResponses = acceptedMicro.microResponses;
  baseAnalysis.speechMetrics = {
    ...safeObject(baseAnalysis.speechMetrics, {}),
    ...safeObject(recoveryAnalysis.speechMetrics, {})
  };
  baseAnalysis.intelligibilityNotes = recoveryAnalysis.intelligibilityNotes || baseAnalysis.intelligibilityNotes || '';
  baseAnalysis.confidence = recoveryAnalysis.confidence || baseAnalysis.confidence || 0;
  baseAnalysis.warnings = normalizeWarnings([
    ...(Array.isArray(baseAnalysis.warnings) ? baseAnalysis.warnings : []),
    ...(Array.isArray(recoveryAnalysis.warnings) ? recoveryAnalysis.warnings : []),
    ...(Array.isArray(acceptedMicro.warnings) ? acceptedMicro.warnings : []),
    recoveryMicro.ok
      ? 'Recovered Read Aloud micro-rubric responses using an audio follow-up request.'
      : 'Recovered Read Aloud micro-rubric responses using deterministic transcript fallback.'
  ]);

  return {
    ...bundle,
    analysis: baseAnalysis,
    provider: {
      ...provider,
      tokenUsage: mergeTokenUsage(provider.tokenUsage, recoveryProvider.tokenUsage),
      microRubricRecovery: {
        providerId: recoveryProvider.providerId || '',
        modelUsed: recoveryProvider.modelUsed || '',
        responseTextPreview: recoveryProvider.responseTextPreview || '',
        tokenUsage: normalizeTokenUsage(recoveryProvider.tokenUsage)
      }
    }
  };
}

async function recoverReadAloudMicroRubricIfNeeded({
  bundle = {},
  runtimeProvider = {},
  audio = {},
  sourceText = '',
  responsePayload = {},
  scoringConfig = {},
  session = {},
  item = {}
} = {}) {
  const analysis = parseAiReadAloudAnalysis(bundle?.analysis || bundle?.aiAnalysis || bundle);
  const transcript = s(analysis.transcript, 50000);
  if (!transcript || hasUsableReadAloudMicroResponses(analysis, scoringConfig)) return bundle;

  try {
    const recoveryResult = await sendReadAloudMicroRubricRecoveryRequest({
      runtimeProvider,
      audio,
      transcript,
      sourceText,
      responsePayload,
      scoringConfig,
      session,
      item
    });
    const recoveryBundle = buildAnalysisBundleFromProviderResult(recoveryResult, runtimeProvider);
    return mergeReadAloudMicroRubricRecoveryBundle(bundle, recoveryBundle, scoringConfig);
  } catch (error) {
    const mergedAnalysis = parseAiReadAloudAnalysis(bundle?.analysis || bundle?.aiAnalysis || bundle);
    mergedAnalysis.warnings = normalizeWarnings([
      ...(Array.isArray(mergedAnalysis.warnings) ? mergedAnalysis.warnings : []),
      `Read Aloud micro-rubric recovery follow-up failed: ${s(error?.message || error, 500) || 'unknown error'}.`
    ]);
    return {
      ...bundle,
      analysis: mergedAnalysis
    };
  }
}

async function recoverReadAloudAnalysisIfNeeded({
  bundle = {},
  runtimeProvider = {},
  audio = {},
  sourceText = '',
  responsePayload = {},
  scoringConfig = {},
  session = {},
  item = {}
} = {}) {
  const transcriptBundle = await recoverReadAloudTranscriptIfMissing({
    bundle,
    runtimeProvider,
    audio,
    session,
    item
  });
  return recoverReadAloudMicroRubricIfNeeded({
    bundle: transcriptBundle,
    runtimeProvider,
    audio,
    sourceText,
    responsePayload,
    scoringConfig,
    session,
    item
  });
}

async function readAudioArtifactForAi(artifact = {}) {
  return readUploadArtifactForAi({
    artifact,
    maxBytes: AUDIO_MAX_BYTES,
    expectedMimePrefix: 'audio/',
    inferMimeType: inferAudioMimeType,
    tooLargeLabel: 'Uploaded audio artifact'
  });
}

async function analyzeReadAloudAudioWithAi({
  session = {},
  item = {},
  audioArtifact = {},
  sourceText = '',
  responsePayload = {},
  scoringConfig = {},
  requestingUser = null
} = {}) {
  const runtimeProvider = await pteAiProviderDataService.resolveRuntimeProvider(requestingUser, {}, {
    purpose: 'pte_scoring',
    questionType: 'speaking_read_aloud',
    scorerKey: 'speaking_read_aloud'
  });
  runtimeProvider.requestingUser = requestingUser;
  const sourceAudio = await readAudioArtifactForAi(audioArtifact);
  const preparedAudio = await prepareAudioForScoringProvider({
    providerId: runtimeProvider.providerId,
    audio: sourceAudio,
    scorerName: 'Read Aloud scoring',
    maxOutputBytes: AUDIO_MAX_BYTES
  });
  const audio = preparedAudio.audio;
  const compatibilityError = buildAudioProviderCompatibilityError(runtimeProvider.providerId, runtimeProvider.modelId, audio.mimeType);
  if (compatibilityError) {
    await preparedAudio.cleanup();
    throw new Error(compatibilityError);
  }
  try {
    const recordingDurationSeconds = toFiniteNumber(
      responsePayload.audioDurationSeconds
        ?? responsePayload.durationSeconds
        ?? audioArtifact.durationSeconds,
      0
    );

    const systemPrompt = [
      'You are a careful PTE Read Aloud audio analysis service.',
      'You do not produce an official Pearson score.',
      'You return evidence-backed JSON for a downstream raw-rubric scorer.',
      'Never score from typed transcript notes; analyze the attached audio.'
    ].join(' ');
    const userPrompt = buildAudioAnalysisPrompt({
      sourceText,
      recordingDurationSeconds,
      scoringConfig
    });
    const primaryUsesStructuredSchema = !isOpenAiCompatibleProvider(runtimeProvider.providerId);
    const shouldRetryLooseJsonForTranscript = isGeminiFlashRuntimeProvider(runtimeProvider);
    const retryWarning = primaryUsesStructuredSchema
      ? 'AI provider returned an unusable structured Read Aloud response; scorer retried with a looser JSON-only request.'
      : 'AI provider returned an unusable Read Aloud JSON response; scorer retried with a JSON-only request.';

    let primaryResult = null;
    try {
      primaryResult = await sendReadAloudAudioAnalysisRequest({
        runtimeProvider,
        audio,
        systemPrompt,
        userPrompt,
        session,
        item,
        useStructuredSchema: primaryUsesStructuredSchema,
        requestLabel: 'pte-read-aloud-scoring-v1'
      });
    } catch (error) {
      if (!shouldRetryLooseJsonForTranscript) throw error;
      try {
        const retryResult = await sendReadAloudAudioAnalysisRequest({
          runtimeProvider,
          audio,
          systemPrompt,
          userPrompt,
          session,
          item,
          useStructuredSchema: false,
          requestLabel: 'pte-read-aloud-scoring-v1-flash-json-retry'
        });
        const retryBundle = buildAnalysisBundleFromProviderResult(retryResult, runtimeProvider, [
          `Gemini Flash structured audio request failed first: ${s(error?.message || error, 500) || 'unknown error'}.`,
          retryWarning
        ]);
        const recoveredBundle = await recoverReadAloudAnalysisIfNeeded({
          bundle: retryBundle,
          runtimeProvider,
          audio,
          sourceText,
          responsePayload,
          scoringConfig,
          session,
          item
        });
        return attachAudioPreparationMetadata(recoveredBundle, preparedAudio);
      } catch (retryError) {
        const combined = new Error(
          `Gemini Flash audio analysis failed after structured and fallback attempts. First: ${s(error?.message || error, 500) || 'unknown error'}. Fallback: ${s(retryError?.message || retryError, 500) || 'unknown error'}.`
        );
        combined.code = retryError?.code || error?.code || 'GEMINI_FLASH_AUDIO_ANALYSIS_FAILED';
        throw combined;
      }
    }

    const primaryBundle = buildAnalysisBundleFromProviderResult(primaryResult, runtimeProvider);
    const primaryAnalysis = parseAiReadAloudAnalysis(primaryBundle?.analysis || {});
    const primaryHasTranscript = Boolean(s(primaryAnalysis.transcript, 50000));
    const primaryHasUsableMicro = hasUsableReadAloudMicroResponses(primaryAnalysis, scoringConfig);
    const shouldRetryLooseJson = shouldRetryLooseJsonForTranscript || (primaryHasTranscript && !primaryHasUsableMicro);
    if (!shouldRetryLooseJson || (primaryHasTranscript && primaryHasUsableMicro)) {
      const recoveredBundle = await recoverReadAloudAnalysisIfNeeded({
        bundle: primaryBundle,
        runtimeProvider,
        audio,
        sourceText,
        responsePayload,
        scoringConfig,
        session,
        item
      });
      return attachAudioPreparationMetadata(recoveredBundle, preparedAudio);
    }

    const retryResult = await sendReadAloudAudioAnalysisRequest({
      runtimeProvider,
      audio,
      systemPrompt,
      userPrompt,
      session,
      item,
      useStructuredSchema: false,
      requestLabel: isGeminiFlashRuntimeProvider(runtimeProvider)
        ? 'pte-read-aloud-scoring-v1-flash-json-retry'
        : 'pte-read-aloud-scoring-v1-json-retry'
    });
    const retryBundle = buildAnalysisBundleFromProviderResult(retryResult, runtimeProvider, [
      ...normalizeWarnings(primaryBundle?.analysis?.warnings || []),
      retryWarning
    ]);
    const recoveredBundle = await recoverReadAloudAnalysisIfNeeded({
      bundle: retryBundle,
      runtimeProvider,
      audio,
      sourceText,
      responsePayload,
      scoringConfig,
      session,
      item
    });
    return attachAudioPreparationMetadata(recoveredBundle, preparedAudio);
  } finally {
    await preparedAudio.cleanup();
  }
}

function makeScoringMetadata({
  status = '',
  sourceText = '',
  aiAnalysis = null,
  scoreResult = null,
  provider = {},
  audioArtifact = null,
  responsePayload = {},
  scoringConfig = {},
  warnings = [],
  feedbackDraft = null,
  microEvaluation = null
} = {}) {
  const rubric = getRubric('speaking_read_aloud') || {};
  const alignment = scoreResult?.evidence?.alignment || null;
  const speechMetrics = safeObject(aiAnalysis?.speechMetrics, {});
  const warningSplit = splitWarningsForAudience([
    ...(Array.isArray(aiAnalysis?.warnings) ? aiAnalysis.warnings : []),
    ...(Array.isArray(microEvaluation?.warnings) ? microEvaluation.warnings : []),
    ...warnings
  ]);
  return {
    status,
    scorerKey: 'speaking_read_aloud',
    scorerVersion: READ_ALOUD_SCORER_VERSION,
    scoringContractVersion: microEvaluation ? MICRO_SCORING_CONTRACT_VERSION : 1,
    scoreScale: 'raw_item_rubric_score',
    officialScoreEstimate: false,
    rubricSource: Array.isArray(rubric.rubricSources) ? rubric.rubricSources : [],
    configuredMethod: s(scoringConfig.method || '', 120) || 'hybrid_ai_audio',
    provider: safeObject(provider, {}),
    microRubricVersion: microEvaluation?.microRubricVersion || '',
    microResponses: Array.isArray(microEvaluation?.microResponses) ? microEvaluation.microResponses : [],
    aggregationBreakdown: safeObject(microEvaluation?.aggregationBreakdown, {}),
    legacyDirectModelScores: collectLegacyDirectModelScores(aiAnalysis, ['pronunciation', 'fluency']),
    transcript: s(aiAnalysis?.transcript || '', 50000),
    sourceWordCount: tokenizeForReadAloud(sourceText).length,
    alignment: alignment || {},
    speechMetrics: {
      ...speechMetrics,
      browserAudioDurationSeconds: round2(toFiniteNumber(
        responsePayload.audioDurationSeconds
          ?? responsePayload.durationSeconds
          ?? audioArtifact?.durationSeconds,
        0
      )),
      browserSpeechMetrics: safeObject(
        responsePayload.speechMetrics
          || responsePayload.timingMeta
          || responsePayload.asrMeta,
        {}
      )
    },
    pronunciation: aiAnalysis?.pronunciation || {},
    fluency: aiAnalysis?.fluency || {},
    intelligibilityNotes: s(aiAnalysis?.intelligibilityNotes || '', 1500),
    confidence: normalizeConfidence(aiAnalysis?.confidence),
    warnings: warningSplit.publicWarnings,
    technicalWarnings: warningSplit.technicalWarnings,
    feedbackDraft: feedbackDraft || null,
    scoredAt: new Date().toISOString()
  };
}

function buildFeedbackDraft({ scoreResult = {}, aiAnalysis = {}, scoringConfig = {}, microEvaluation = null } = {}) {
  const alignment = scoreResult?.evidence?.alignment || {};
  const traitScores = scoreResult.traitScores || {};
  const speechMetrics = safeObject(aiAnalysis?.speechMetrics, {});
  const strengths = [];
  const improvements = [];
  const microFeedback = buildMicroFeedbackRows(microEvaluation || {});

  if (alignment.errorCount === 0 && alignment.sourceWordCount > 0) {
    strengths.push('You covered the source text accurately.');
  } else if (alignment.matchCount > Math.max(0, alignment.errorCount)) {
    strengths.push('A good portion of the source text was recognizable in the audio.');
  }
  if (Number(traitScores.pronunciation || 0) >= 4) {
    strengths.push('Pronunciation was generally intelligible.');
  }
  if (Number(traitScores.fluency || 0) >= 4) {
    strengths.push('Fluency was mostly steady.');
  }

  if (alignment.errorCount > 0) {
    improvements.push(`Reduce reading errors: ${alignment.omissionCount || 0} omission(s), ${alignment.replacementCount || 0} replacement(s), and ${alignment.insertionCount || 0} insertion(s) were detected.`);
  }
  if (Number(traitScores.pronunciation || 0) < 4) {
    improvements.push('Make each word easier to understand by slowing slightly on unclear sounds and sentence stress.');
  }
  if (Number(traitScores.fluency || 0) < 4) {
    improvements.push('Practice smoother phrasing with fewer stops, hesitations, or repetitions.');
  }

  const wpm = Number(speechMetrics.estimatedWpm || 0);
  const idealMin = Number(scoringConfig.idealWpmMin || 90);
  const idealMax = Number(scoringConfig.idealWpmMax || 160);
  if (wpm > 0 && (wpm < idealMin || wpm > idealMax)) {
    improvements.push(`Aim for a steadier pace; estimated rate was ${round2(wpm)} WPM.`);
  }
  strengths.push(...microFeedback.strengths.slice(0, 3));
  improvements.push(...microFeedback.improvements.slice(0, 3));

  const nextAction = alignment.errorCount > 0
    ? 'Re-read the same sentence once while tracking every content word, then record again.'
    : 'Record another Read Aloud item and keep the same accuracy while improving natural rhythm.';

  return {
    summary: `${round2(scoreResult.scoreFinal || 0)} / ${round2(scoreResult.maxScore || 0)} raw rubric points.`,
    strengths: strengths.length ? strengths : ['The response has enough audio evidence for scoring.'],
    improvements: improvements.length ? improvements : ['Keep the same accuracy and focus on natural sentence rhythm.'],
    nextPracticeAction: nextAction
  };
}

function needsEvidenceResult(warnings = [], context = {}) {
  return {
    status: 'needs_evidence',
    scorePayload: null,
    metadata: makeScoringMetadata({
      status: 'needs_evidence',
      warnings,
      ...context
    }),
    warnings: normalizeWarnings(warnings)
  };
}

function failedResult(warnings = [], context = {}) {
  return {
    status: 'failed',
    scorePayload: null,
    metadata: makeScoringMetadata({
      status: 'failed',
      warnings,
      ...context
    }),
    warnings: normalizeWarnings(warnings)
  };
}

function buildMissingTranscriptWarnings(aiAnalysis = {}, provider = {}) {
  const providerId = s(provider?.providerId || provider?.provider, 80);
  const model = s(provider?.modelUsed || provider?.modelId, 180);
  const providerLabel = [providerId, model].filter(Boolean).join(' / ');
  return normalizeWarnings([
    'Read Aloud audio analysis returned no usable transcript.',
    providerLabel
      ? `Provider response did not include a usable transcript field (${providerLabel}).`
      : 'Provider response did not include a usable transcript field.',
    ...(Array.isArray(aiAnalysis?.warnings) ? aiAnalysis.warnings : [])
  ]);
}

async function scoreReadAloudAttemptItem(args = {}, options = {}) {
  const {
    session = {},
    item = {},
    question = {},
    artifacts = [],
    responsePayload = {},
    scoringConfig = {},
    requestingUser = null
  } = args;
  const sourceText = resolveSourceText(question, item);
  const baseContext = { sourceText, responsePayload, scoringConfig };
  if (!sourceText) {
    return needsEvidenceResult(['Read Aloud scoring requires source text from the question payload.'], baseContext);
  }

  const audioArtifact = selectAudioArtifact({ item, artifacts, responsePayload });
  if (!audioArtifact) {
    return needsEvidenceResult([
      'Read Aloud scoring requires an uploaded audio response.',
      'Typed transcript notes alone are not scored.'
    ], baseContext);
  }

  let analysisBundle = null;
  try {
    if (typeof options.audioAnalyzer === 'function') {
      analysisBundle = await options.audioAnalyzer({
        session,
        item,
        question,
        audioArtifact,
        sourceText,
        responsePayload,
        scoringConfig,
        requestingUser
      });
    } else if (Object.prototype.hasOwnProperty.call(options, 'aiAnalysis')) {
      analysisBundle = {
        analysis: parseAiReadAloudAnalysis(options.aiAnalysis),
        provider: safeObject(options.provider, { providerId: 'test', modelUsed: 'injected' })
      };
    } else {
      analysisBundle = await analyzeReadAloudAudioWithAi({
        session,
        item,
        audioArtifact,
        sourceText,
        responsePayload,
        scoringConfig,
        requestingUser
      });
    }
  } catch (error) {
    return failedResult([
      `Read Aloud audio analysis failed: ${s(error?.message || error, 800) || 'unknown error'}.`
    ], {
      ...baseContext,
      audioArtifact
    });
  }

  const aiAnalysis = parseAiReadAloudAnalysis(
    analysisBundle?.analysis || analysisBundle?.aiAnalysis || analysisBundle
  );
  const provider = safeObject(analysisBundle?.provider, {});
  if (!s(aiAnalysis.transcript, 50000)) {
    return failedResult(buildMissingTranscriptWarnings(aiAnalysis, provider), {
      ...baseContext,
      aiAnalysis,
      provider,
      audioArtifact
    });
  }
  const microEvaluation = isLegacyDirectScoring(scoringConfig)
    ? null
    : evaluateSpeakingMicroRubric({
      questionType: 'speaking_read_aloud',
      aiAnalysis,
      traitMax: { pronunciation: 5, fluency: 5 }
    });
  const deterministicMicroEvaluation = microEvaluation
    && !microEvaluation.ok
    && !microEvaluation.invalidResponses?.length
    ? buildReadAloudDeterministicMicroEvaluation({
      aiAnalysis,
      scoringConfig,
      reason: 'Generated Read Aloud micro-rubric responses deterministically after the AI provider omitted required micro answers.'
    })
    : null;
  const finalMicroEvaluation = deterministicMicroEvaluation?.ok ? deterministicMicroEvaluation : microEvaluation;
  if (deterministicMicroEvaluation?.ok) {
    aiAnalysis.microResponses = deterministicMicroEvaluation.microResponses;
    aiAnalysis.warnings = normalizeWarnings([
      ...(Array.isArray(aiAnalysis.warnings) ? aiAnalysis.warnings : []),
      ...(Array.isArray(deterministicMicroEvaluation.warnings) ? deterministicMicroEvaluation.warnings : [])
    ]);
  }
  if (finalMicroEvaluation && !finalMicroEvaluation.ok) {
    return failedResult(finalMicroEvaluation.warnings, {
      ...baseContext,
      aiAnalysis,
      provider,
      audioArtifact,
      microEvaluation: finalMicroEvaluation
    });
  }

  const scoreResult = calculateReadAloudScore({
    sourceText,
    transcript: aiAnalysis.transcript,
    aiAnalysis,
    microTraitScores: finalMicroEvaluation?.traitScores,
    scoringConfig
  });
  const feedbackDraft = buildFeedbackDraft({ scoreResult, aiAnalysis, scoringConfig, microEvaluation: finalMicroEvaluation });
  const metadata = makeScoringMetadata({
    status: 'scored',
    sourceText,
    aiAnalysis,
    scoreResult,
    provider,
    audioArtifact,
    responsePayload,
    scoringConfig,
    warnings: [],
    feedbackDraft,
    microEvaluation: finalMicroEvaluation
  });

  return {
    status: 'scored',
    scorePayload: {
      scoreRaw: scoreResult.scoreRaw,
      scoreFinal: scoreResult.scoreFinal,
      maxScore: scoreResult.maxScore,
      percentage: scoreResult.percentage,
      traitScores: scoreResult.traitScores,
      scoringMetadata: metadata
    },
    metadata,
    feedbackDraft,
    warnings: metadata.warnings
  };
}

module.exports = {
  tokenizeForReadAloud,
  alignReadAloudTokens,
  calculateReadAloudScore,
  parseAiReadAloudAnalysis,
  selectAudioArtifact,
  scoreReadAloudAttemptItem,
  analyzeReadAloudAudioWithAi
};
