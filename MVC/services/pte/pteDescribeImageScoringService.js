const fs = require('fs/promises');
const path = require('path');
const coreFilesService = require('../coreFilesService');
const { getGatewayBaseUrl } = require('../../utils/uploadModeUtils');
const pteAiProviderDataService = require('./pteAiProviderDataService');
const pteAiProviderService = require('./ai/aiProviderService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');
const {
  DESCRIBE_IMAGE_SCORER_VERSION,
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

const AUDIO_MAX_BYTES = 35 * 1024 * 1024;
const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const REMOTE_UPLOAD_FETCH_TIMEOUT_MS = 25000;
const DEFAULT_OPENAI_DESCRIBE_IMAGE_VISION_MODEL_ID = 'gpt-5.4-mini';

const IMAGE_MIME_BY_EXT = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp'
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

function normalizeTraitScore(value, maxScore = 5, fallback = 0) {
  const max = Math.max(0, toFiniteNumber(maxScore, 5) || 5);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.min(max, Math.max(0, fallback));
  return Math.min(max, Math.max(0, Math.round(numeric)));
}

function normalizeComparableToken(value = '') {
  return s(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenizeComparableText(value = '') {
  const stopWords = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'by',
    'for',
    'from',
    'in',
    'is',
    'it',
    'of',
    'on',
    'or',
    'that',
    'the',
    'this',
    'to',
    'with',
    'show',
    'shows',
    'showing',
    'image',
    'chart',
    'graph',
    'picture'
  ]);
  return normalizeComparableToken(value)
    .split(/\s+/)
    .filter((token) => token && token.length > 2 && !stopWords.has(token));
}

function countTokenOverlap(source = '', target = '') {
  const sourceTokens = new Set(tokenizeComparableText(source));
  if (!sourceTokens.size) return 0;
  return tokenizeComparableText(target).reduce((count, token) => (
    sourceTokens.has(token) ? count + 1 : count
  ), 0);
}

function describeDeterministicChoice(choice = '', yesText = '', partialText = '', noText = '') {
  if (choice === 'yes') return yesText;
  if (choice === 'partial') return partialText;
  return noText;
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
    || text.includes('audio-only transcript recovery')
    || text.includes('recovered describe image transcript')
    || text.includes('generated describe image micro-rubric responses deterministically')
    || text.includes('recovered describe image micro-rubric responses')
    || text.includes('micro-rubric recovery follow-up')
    || text.includes('provider response did not include')
    || text.includes('scorer retried')
    || text.includes('scorer switched this request')
    || text.includes('extracted text visual context')
    || text.includes('used the supplied caption/key points')
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

function hasUsableDescribeImageMicroResponses(aiAnalysis = {}, scoringConfig = {}) {
  if (isLegacyDirectScoring(scoringConfig)) return true;
  const contentMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.contentMax ?? scoringConfig.contentScoreMax, 5) || 5));
  const pronunciationMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.pronunciationMax, 5) || 5));
  const fluencyMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.fluencyMax ?? scoringConfig.oralFluencyMax, 5) || 5));
  const microEvaluation = evaluateSpeakingMicroRubric({
    questionType: 'speaking_describe_image',
    aiAnalysis,
    traitMax: { content: contentMax, pronunciation: pronunciationMax, fluency: fluencyMax }
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
  const out = [];
  const seen = new Set();
  source.forEach((row) => {
    const text = s(row, 700);
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(text);
  });
  return out.slice(0, maxRows);
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

function transcriptWordCount(text = '') {
  const tokens = s(text, 50000)
    .toLowerCase()
    .match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu);
  return Array.isArray(tokens) ? tokens.length : 0;
}

function transcriptLooksIncompleteOrTruncated(text = '', options = {}) {
  const allowLongRefusalFragment = options?.allowLongRefusalFragment === true;
  const normalized = s(text, 50000).replace(/\s+/g, ' ').trim();
  if (!normalized) return true;
  const words = normalized
    .toLowerCase()
    .match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) || [];
  if (!words.length) return true;

  const last = words[words.length - 1] || '';
  const previous = words[words.length - 2] || '';
  const trailingOpeners = new Set([
    'and',
    'but',
    'because',
    'so',
    'if',
    'when',
    'while',
    'although',
    'that',
    'to',
    'for',
    'with',
    'of',
    'in',
    'on',
    'at',
    'by',
    'from',
    'about',
    'as',
    'than',
    'then',
    'the',
    'a',
    'an',
    'my',
    'your',
    'our',
    'their',
    'i',
    "i'm",
    'im'
  ]);
  if (trailingOpeners.has(last)) return true;

  const canScoreTrailingRefusalFragment = allowLongRefusalFragment && words.length >= 30;
  const trailingRefusalTokens = new Set(['can', 'cannot', "can't", 'cant', 'could', "couldn't", 'couldnt', 'will', "won't", 'wont', 'unable', 'able', 'not']);
  if (!canScoreTrailingRefusalFragment && trailingRefusalTokens.has(last)) return true;
  if (!canScoreTrailingRefusalFragment && (previous === 'cannot' || previous === "can't" || previous === 'cant' || previous === 'unable' || previous === 'not') && last === 'to') {
    return true;
  }
  if (!canScoreTrailingRefusalFragment && previous === 'can' && last === 'not') return true;
  if ((previous === 'and' || previous === 'but' || previous === 'because') && (last === "i'm" || last === 'im' || last === 'i')) {
    return true;
  }
  if (/(?:\band\s+i'?m|\band\s+i|\bbecause\s+i|\bbut\s+i'?m)\s*$/i.test(normalized)) {
    return true;
  }
  return false;
}

function transcriptTooIncompleteToScore(text = '') {
  return transcriptLooksIncompleteOrTruncated(text, { allowLongRefusalFragment: true });
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
  if (Array.isArray(segments)) return normalizeTranscriptCandidate(segments, max);
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
    parsed.spokenResponse,
    parsed.spoken_response,
    parsed.candidateResponse,
    parsed.candidate_response,
    parsed.spokenText,
    parsed.spoken_text,
    parsed.responseText,
    parsed.response_text,
    parsed.audioText,
    parsed.audio_text,
    parsed.speechText,
    parsed.speech_text,
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

function normalizeTraitAnalysis(value = {}, fallbackScore = 0) {
  const row = isPlainObject(value) ? value : { score: value };
  return {
    score: normalizeTraitScore(row.score ?? row.band ?? row.rawScore ?? row.value, 5, fallbackScore),
    evidence: normalizeTextArray(row.evidence || row.examples || row.supportingEvidence || [], 8),
    notes: firstNonEmptyText([row.notes, row.rationale, row.reason, row.descriptor], 1500),
    coveredKeyPoints: normalizeTextArray(row.coveredKeyPoints || row.coveredPoints || row.presentKeyPoints || [], 8),
    missingKeyPoints: normalizeTextArray(row.missingKeyPoints || row.missingPoints || row.omittedKeyPoints || [], 8)
  };
}

function parseAiDescribeImageAnalysis(input = {}) {
  const parsed = typeof input === 'string'
    ? extractJsonObject(input)
    : (isPlainObject(input) ? input : null);
  if (!isPlainObject(parsed)) {
    return {
      validJson: false,
      transcript: '',
      content: normalizeTraitAnalysis({}),
      pronunciation: normalizeTraitAnalysis({}),
      fluency: normalizeTraitAnalysis({}),
      speechMetrics: {},
      microResponses: [],
      confidence: 0,
      warnings: ['AI Describe Image analysis did not return valid JSON.']
    };
  }

  const metricsRaw = safeObject(parsed.speechMetrics || parsed.metrics || parsed.timingMeta, {});
  const scoresRaw = safeObject(parsed.scores || parsed.traitScores, {});
  return {
    validJson: parsed.validJson === false ? false : true,
    transcript: resolveTranscriptFromParsedAnalysis(parsed),
    content: normalizeTraitAnalysis(parsed.content || scoresRaw.content || parsed.contentScore || 0),
    pronunciation: normalizeTraitAnalysis(parsed.pronunciation || scoresRaw.pronunciation || parsed.pronunciationScore || 0),
    fluency: normalizeTraitAnalysis(parsed.fluency || parsed.oralFluency || scoresRaw.fluency || scoresRaw.oralFluency || parsed.fluencyScore || 0),
    speechMetrics: {
      speechDurationSeconds: round2(toFiniteNumber(
        metricsRaw.speechDurationSeconds
          ?? metricsRaw.durationSeconds
          ?? parsed.speechDurationSeconds
          ?? parsed.durationSeconds,
        0
      )),
      estimatedWpm: round2(toFiniteNumber(metricsRaw.estimatedWpm ?? metricsRaw.wpm ?? parsed.estimatedWpm, 0)),
      longPauseCount: Math.max(0, Math.floor(toFiniteNumber(metricsRaw.longPauseCount ?? parsed.longPauseCount, 0))),
      longestPauseSeconds: round2(toFiniteNumber(metricsRaw.longestPauseSeconds ?? parsed.longestPauseSeconds, 0)),
      hesitationCount: Math.max(0, Math.floor(toFiniteNumber(metricsRaw.hesitationCount ?? parsed.hesitationCount, 0))),
      repetitionCount: Math.max(0, Math.floor(toFiniteNumber(metricsRaw.repetitionCount ?? parsed.repetitionCount, 0)))
    },
    intelligibilityNotes: s(parsed.intelligibilityNotes || parsed.intelligibility || '', 1500),
    visualDescriptionNotes: s(parsed.visualDescriptionNotes || parsed.imageNotes || parsed.contentNotes || '', 1500),
    microResponses: normalizeMicroResponseRows(parsed),
    confidence: normalizeConfidence(parsed.confidence ?? metricsRaw.confidence),
    warnings: normalizeWarnings(parsed.warnings || parsed.warning || [])
  };
}

function parseAiDescribeImageTranscriptRecovery(input = {}) {
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
      warnings: ['Audio-only transcript recovery returned malformed JSON; transcript field was recovered.']
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
      ? ['Audio-only transcript recovery returned plain text instead of JSON.']
      : ['Audio-only transcript recovery did not return valid JSON or a usable transcript field.']
  };
}

function calculateDescribeImageScore({ aiAnalysis = {}, scoringConfig = {}, microTraitScores = null } = {}) {
  const contentMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.contentMax ?? scoringConfig.contentScoreMax, 5) || 5));
  const pronunciationMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.pronunciationMax, 5) || 5));
  const fluencyMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.fluencyMax ?? scoringConfig.oralFluencyMax, 5) || 5));
  const content = microTraitScores && Number.isFinite(Number(microTraitScores.content))
    ? normalizeTraitScore(microTraitScores.content, contentMax, 0)
    : normalizeTraitScore(aiAnalysis?.content?.score, contentMax, 0);
  const pronunciation = microTraitScores && Number.isFinite(Number(microTraitScores.pronunciation))
    ? normalizeTraitScore(microTraitScores.pronunciation, pronunciationMax, 0)
    : normalizeTraitScore(aiAnalysis?.pronunciation?.score, pronunciationMax, 0);
  const fluency = microTraitScores && Number.isFinite(Number(microTraitScores.fluency))
    ? normalizeTraitScore(microTraitScores.fluency, fluencyMax, 0)
    : normalizeTraitScore(aiAnalysis?.fluency?.score, fluencyMax, 0);
  const maxScore = contentMax + pronunciationMax + fluencyMax;
  const scoreFinal = content + pronunciation + fluency;
  return {
    scoreRaw: scoreFinal,
    scoreFinal,
    maxScore,
    percentage: maxScore > 0 ? round2((scoreFinal / maxScore) * 100) : 0,
    traitScores: {
      content,
      pronunciation,
      fluency
    },
    evidence: {
      traitMax: {
        content: contentMax,
        pronunciation: pronunciationMax,
        fluency: fluencyMax
      }
    }
  };
}

function buildDescribeImageDeterministicMicroEvaluation({
  aiAnalysis = {},
  describeImageContext = {},
  scoringConfig = {},
  reason = ''
} = {}) {
  if (isLegacyDirectScoring(scoringConfig)) return null;
  const transcript = s(aiAnalysis?.transcript || '', 50000);
  const keyPoints = normalizeKeyPoints(describeImageContext.expectedKeyPoints || []);
  const visualText = [
    describeImageContext.imageCaption,
    describeImageContext.sourceText,
    keyPoints.join(' ')
  ].map((row) => s(row, 5000)).filter(Boolean).join(' ');
  if (!transcript || !visualText) return null;

  const visualOverlap = countTokenOverlap(visualText, transcript);
  const matchedKeyPoints = keyPoints.filter((keyPoint) => countTokenOverlap(keyPoint, transcript) >= 2);
  const transcriptWords = tokenizeComparableText(transcript).length;
  const speechMetrics = safeObject(aiAnalysis?.speechMetrics, {});
  const wpm = toFiniteNumber(speechMetrics.estimatedWpm ?? speechMetrics.wpm, 0);
  const longPauses = Math.max(0, Math.floor(toFiniteNumber(speechMetrics.longPauseCount, 0)));
  const hesitations = Math.max(0, Math.floor(toFiniteNumber(speechMetrics.hesitationCount, 0)));
  const repetitions = Math.max(0, Math.floor(toFiniteNumber(speechMetrics.repetitionCount, 0)));

  const mainChoice = visualOverlap >= 4 ? 'yes' : (visualOverlap >= 2 ? 'partial' : 'no');
  let detailChoice = 'partial';
  if (keyPoints.length) {
    if (matchedKeyPoints.length >= Math.min(2, keyPoints.length)) detailChoice = 'yes';
    else if (matchedKeyPoints.length >= 1 || visualOverlap >= 3) detailChoice = 'partial';
    else detailChoice = 'no';
  } else if (visualOverlap >= 5) detailChoice = 'yes';
  else if (visualOverlap >= 2) detailChoice = 'partial';
  else detailChoice = 'no';
  const accuracyChoice = visualOverlap >= 3 ? 'partial' : (visualOverlap >= 1 ? 'partial' : 'no');
  const pronunciationChoice = transcriptWords >= 5 ? 'developing' : 'limited';
  let fluencyChoice = 'developing';
  if (transcriptWords < 5) fluencyChoice = 'limited';
  else if (wpm >= 90 && wpm <= 170 && longPauses <= 1 && hesitations <= 2 && repetitions <= 2) fluencyChoice = 'good';
  else if ((wpm > 0 && (wpm < 55 || wpm > 210)) || longPauses >= 4 || hesitations >= 6) fluencyChoice = 'limited';

  const microResponses = [
    {
      id: 'content_main_idea',
      choice: mainChoice,
      evidence: describeDeterministicChoice(
        mainChoice,
        `Transcript overlaps with the supplied visual context (${visualOverlap} key terms matched).`,
        `Transcript partially overlaps with the supplied visual context (${visualOverlap} key terms matched).`,
        'Transcript has little overlap with the supplied visual context.'
      ),
      confidence: 0.55
    },
    {
      id: 'content_key_details',
      choice: detailChoice,
      evidence: keyPoints.length
        ? `${matchedKeyPoints.length} of ${keyPoints.length} expected key point(s) matched by text overlap.`
        : `No configured key points were available; detail coverage was inferred from ${visualOverlap} visual-context overlap terms.`,
      confidence: 0.55
    },
    {
      id: 'content_visual_accuracy',
      choice: accuracyChoice,
      evidence: 'Prompt image was not available to the scorer, so visual accuracy was conservatively inferred from caption/key-point overlap only.',
      confidence: 0.5
    },
    {
      id: 'pronunciation_quality',
      choice: pronunciationChoice,
      evidence: 'Provider omitted pronunciation micro evidence; deterministic fallback used transcript availability only, so this is capped conservatively.',
      confidence: 0.45
    },
    {
      id: 'fluency_quality',
      choice: fluencyChoice,
      evidence: wpm > 0
        ? `Provider omitted fluency micro evidence; deterministic fallback used speech metrics: ${round2(wpm)} WPM, ${longPauses} long pause(s), ${hesitations} hesitation(s), ${repetitions} repetition(s).`
        : 'Provider omitted fluency micro evidence; deterministic fallback used transcript length only, so this is capped conservatively.',
      confidence: 0.45
    }
  ];

  const contentMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.contentMax ?? scoringConfig.contentScoreMax, 5) || 5));
  const pronunciationMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.pronunciationMax, 5) || 5));
  const fluencyMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.fluencyMax ?? scoringConfig.oralFluencyMax, 5) || 5));
  const evaluation = evaluateSpeakingMicroRubric({
    questionType: 'speaking_describe_image',
    aiAnalysis: { microResponses },
    traitMax: { content: contentMax, pronunciation: pronunciationMax, fluency: fluencyMax }
  });
  if (!evaluation.ok) return null;
  return {
    ...evaluation,
    warnings: normalizeWarnings([
      ...(Array.isArray(evaluation.warnings) ? evaluation.warnings : []),
      reason || 'Generated Describe Image micro-rubric responses deterministically from transcript and text visual context because the AI provider omitted required micro answers.'
    ])
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

function normalizeKeyPoints(value = []) {
  return normalizeTextArray(value, 12);
}

function hasDescribeImageTextVisualEvidence(context = {}) {
  return Boolean(
    s(context.imageCaption)
    || s(context.sourceText)
    || normalizeKeyPoints(context.expectedKeyPoints).length
  );
}

function resolveDescribeImageContext(question = {}, item = {}) {
  const payload = resolveQuestionPayload(question, item);
  const expectedKeyPoints = normalizeKeyPoints(
    payload.expectedKeyPoints
      || payload.keyPoints
      || payload.requiredPoints
      || payload.expectedPoints
      || []
  );
  return {
    payload,
    imageAssetId: s(payload.imageAssetId || payload.promptImageAssetId || payload.imageId || '', 500),
    imageCaption: s(payload.imageCaption || payload.caption || payload.promptCaption || '', 1200),
    chartType: s(payload.chartType || payload.visualType || payload.imageType || '', 120),
    expectedKeyPoints,
    sourceText: s(payload.sourceText || payload.promptText || payload.description || '', 5000)
  };
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
  if (ext === '.flac') return 'audio/flac';
  return fromArtifact || 'audio/webm';
}

function inferImageMimeType(artifact = {}, absolutePath = '') {
  const fromArtifact = s(artifact.mimeType || artifact.contentType, 120).toLowerCase();
  if (fromArtifact.startsWith('image/')) return fromArtifact;
  const sourceName = s(artifact.filename)
    || s(artifact.originalName)
    || s(artifact.name)
    || s(artifact.path)
    || s(artifact.url)
    || s(absolutePath);
  const ext = sourceName.includes('.') ? sourceName.split('.').pop().toLowerCase() : '';
  return IMAGE_MIME_BY_EXT[ext] || fromArtifact || 'image/png';
}

function artifactLooksLikeAudio(artifact = {}) {
  const type = s(artifact.artifactType || artifact.type, 80).toLowerCase();
  const mimeType = s(artifact.mimeType || artifact.contentType, 120).toLowerCase();
  if (type === 'audio') return true;
  if (mimeType.startsWith('audio/')) return true;
  const name = s(artifact.name || artifact.path || artifact.url || artifact.filename, 1000).toLowerCase();
  return /\.(webm|wav|mp3|m4a|ogg|oga|flac)$/.test(name);
}

function artifactLooksLikeImage(artifact = {}) {
  const type = s(artifact.artifactType || artifact.type || artifact.kind, 80).toLowerCase();
  const mimeType = s(artifact.mimeType || artifact.contentType, 120).toLowerCase();
  if (type === 'image') return true;
  if (mimeType.startsWith('image/')) return true;
  const name = s(artifact.name || artifact.path || artifact.url || artifact.filename, 1000).toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp)$/.test(name);
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

function normalizeMediaToken(value = '') {
  let token = s(value, 2000).replace(/\\/g, '/');
  if (!token) return '';
  token = token.replace(/^https?:\/\/[^/]+/i, '');
  token = token.replace(/^\/+/, '');
  return token.toLowerCase();
}

function buildMediaMatchTokenSet(mediaRow = {}) {
  const tokens = new Set();
  [
    mediaRow?.id,
    mediaRow?._id,
    mediaRow?.assetId,
    mediaRow?.clientAssetId,
    mediaRow?.mediaId,
    mediaRow?.name,
    mediaRow?.originalName,
    mediaRow?.filename,
    mediaRow?.path,
    mediaRow?.filePath,
    mediaRow?.localPath,
    mediaRow?.url
  ].forEach((value) => {
    const normalized = normalizeMediaToken(value);
    if (!normalized) return;
    tokens.add(normalized);
    const baseName = normalized.split('/').pop();
    if (baseName) tokens.add(baseName);
  });
  return tokens;
}

function collectQuestionMediaRows(question = {}, item = {}, payload = {}) {
  const metadata = safeObject(item?.metadata, {});
  const snapshot = safeObject(metadata.questionSnapshot, {});
  const rows = [
    question.mediaAssets,
    question.media,
    question.attachments,
    question.files,
    question.assets,
    payload.mediaAssets,
    payload.media,
    payload.attachments,
    snapshot.mediaAssets,
    snapshot.media,
    snapshot.attachments
  ];
  return rows.flatMap((value) => {
    if (Array.isArray(value)) return value.filter(isPlainObject);
    if (isPlainObject(value)) return Object.values(value).filter(isPlainObject);
    return [];
  });
}

function buildDirectImageArtifactFromRef(assetRef = '') {
  const ref = s(assetRef, 2000);
  if (!ref) return null;
  if (/^https?:\/\//i.test(ref)) return { id: ref, url: ref, artifactType: 'image' };
  if (/^\/?uploads\//i.test(ref) || path.isAbsolute(ref) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(ref)) {
    return { id: ref, path: ref, url: ref, artifactType: 'image' };
  }
  return null;
}

function selectPromptImageArtifact({ question = {}, item = {}, describeImageContext = {} } = {}) {
  const payload = safeObject(describeImageContext.payload, {});
  const imageAssetId = s(describeImageContext.imageAssetId || payload.imageAssetId, 2000);
  const rows = collectQuestionMediaRows(question, item, payload).filter(artifactLooksLikeImage);
  const refToken = normalizeMediaToken(imageAssetId);
  const refBaseName = refToken.split('/').pop();
  if (refToken) {
    const match = rows.find((row) => {
      const tokens = buildMediaMatchTokenSet(row);
      return tokens.has(refToken) || (refBaseName && tokens.has(refBaseName));
    });
    if (match) return match;
  }
  const direct = buildDirectImageArtifactFromRef(imageAssetId);
  if (direct) return direct;
  return null;
}

function isHttpUrl(value = '') {
  return /^https?:\/\//i.test(s(value, 2000));
}

function isAppUploadUrl(value = '') {
  const token = s(value, 2000);
  if (!isHttpUrl(token)) return false;
  try {
    const parsed = new URL(token);
    return /^\/uploads\//i.test(parsed.pathname || '');
  } catch (_) {
    return /\/uploads\//i.test(token);
  }
}

function normalizeUploadUrlToken(value = '') {
  const token = s(value, 2000).replace(/\\/g, '/');
  if (!token) return '';
  const withoutHost = token.replace(/^https?:\/\/[^/]+/i, '');
  const withoutQuery = withoutHost.split(/[?#]/)[0];
  if (/^\/uploads\//i.test(withoutQuery)) return withoutQuery;
  if (/^uploads\//i.test(withoutQuery)) return `/${withoutQuery.replace(/^\/+/, '')}`;

  const uploadSegmentIndex = withoutQuery.toLowerCase().indexOf('/uploads/');
  if (uploadSegmentIndex >= 0) return withoutQuery.slice(uploadSegmentIndex);

  const fromDisk = coreFilesService.fromDiskPathToUploadsUrl(token);
  if (fromDisk) return fromDisk;
  return '';
}

function pushUniqueUrlCandidate(out = [], candidate = '') {
  const token = s(candidate, 2000);
  if (!token) return;
  const compare = token.toLowerCase();
  if (!out.some((row) => s(row, 2000).toLowerCase() === compare)) out.push(token);
}

function buildGatewayUploadUrl(uploadPath = '') {
  const pathToken = normalizeUploadUrlToken(uploadPath);
  if (!pathToken) return '';
  const baseUrl = getGatewayBaseUrl();
  if (!baseUrl) return '';
  return `${baseUrl}${pathToken}`;
}

function buildGatewayUploadUrlFromRelativePath(value = '') {
  const token = s(value, 2000).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!token) return '';
  const baseUrl = getGatewayBaseUrl();
  if (!baseUrl) return '';
  const uploadPath = /^uploads\//i.test(token) ? `/${token}` : `/uploads/${token}`;
  return `${baseUrl}${uploadPath}`;
}

function getArtifactUploadUrlCandidates(artifact = {}) {
  const metadata = isPlainObject(artifact?.metadata) ? artifact.metadata : {};
  const values = [
    artifact.url,
    artifact.path,
    artifact.filePath,
    artifact.localPath,
    artifact.storagePath,
    artifact.uploadUrl,
    metadata.url,
    metadata.path,
    metadata.localPath,
    metadata.storagePath,
    metadata.uploadUrl
  ].map((value) => s(value, 2000));

  const candidates = [];
  values.forEach((value) => {
    if (!value) return;
    if (isAppUploadUrl(value)) {
      pushUniqueUrlCandidate(candidates, value);
      return;
    }
    const gatewayUrl = buildGatewayUploadUrl(value);
    if (gatewayUrl) pushUniqueUrlCandidate(candidates, gatewayUrl);
  });

  const gatewayRelativePath = s(metadata.gatewayRelativePath || artifact.gatewayRelativePath, 2000)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (gatewayRelativePath) {
    pushUniqueUrlCandidate(candidates, buildGatewayUploadUrlFromRelativePath(gatewayRelativePath));
  }

  return candidates;
}

async function readRemoteUploadArtifactForAi({
  artifact = {},
  maxBytes = 0,
  expectedMimePrefix = '',
  inferMimeType = null,
  tooLargeLabel = 'Uploaded artifact'
} = {}) {
  const candidates = getArtifactUploadUrlCandidates(artifact);
  if (!candidates.length) return null;

  let lastError = null;
  for (const remoteUrl of candidates) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REMOTE_UPLOAD_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(remoteUrl, {
        method: 'GET',
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`Uploaded artifact URL could not be read (${response.status}).`);
      }

      const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
      if (maxBytes && Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new Error(`${tooLargeLabel} is too large for v1 scoring (max ${Math.floor(maxBytes / (1024 * 1024))}MB).`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) {
        throw new Error(`${tooLargeLabel} file is empty.`);
      }
      if (maxBytes && buffer.length > maxBytes) {
        throw new Error(`${tooLargeLabel} is too large for v1 scoring (max ${Math.floor(maxBytes / (1024 * 1024))}MB).`);
      }

      const headerMime = s(response.headers.get('content-type') || '', 120).toLowerCase();
      const inferredMime = typeof inferMimeType === 'function' ? inferMimeType(artifact, remoteUrl) : '';
      const mimeType = headerMime.startsWith(expectedMimePrefix) ? headerMime : inferredMime;
      return {
        absolutePath: '',
        sourceUrl: remoteUrl,
        mimeType,
        dataBase64: buffer.toString('base64'),
        sizeBytes: buffer.length
      };
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError) throw lastError;
  return null;
}

function resolveUploadPathFromUrl(url = '') {
  const token = s(url, 2000).replace(/^https?:\/\/[^/]+/i, '');
  if (!/^\/?uploads\//i.test(token)) return '';
  return coreFilesService.fromUploadsUrlToDiskPath(token);
}

function resolveArtifactPath(artifact = {}) {
  const rawPath = s(artifact.path || artifact.filePath || artifact.localPath || '', 2000);
  if (rawPath && !/^https?:\/\//i.test(rawPath)) {
    if (/^\/?uploads\//i.test(rawPath)) {
      return resolveUploadPathFromUrl(rawPath);
    }
    return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
  }

  const url = s(artifact.url || '', 2000);
  if (url) return resolveUploadPathFromUrl(url);
  return '';
}

function buildAudioProviderCompatibilityError(providerId = '', modelId = '', mimeType = '') {
  const providerToken = s(providerId, 80).toLowerCase();
  const mimeToken = s(mimeType, 120).toLowerCase();
  if (!providerToken) return '';

  if (providerToken === 'google-gemini' || providerToken === 'google-vertex') return '';

  if (providerToken === 'openai' || providerToken === 'azure-openai') {
    const supported = /audio\/(mpeg|mp3|wav|x-wav)/i.test(mimeToken);
    if (supported) {
      return buildOpenAiAudioModelCompatibilityError(providerToken, modelId, 'Describe Image scoring');
    }
    return `Selected provider "${providerToken}" cannot reliably score ${mimeToken || 'this audio format'} in the current PTE Describe Image scorer. OpenAI-compatible scoring requires prepared MP3 or WAV audio.`;
  }

  if (providerToken === 'anthropic') {
    return 'Selected provider "anthropic" is not supported for Describe Image audio transcription in the current PTE scorer. Use Google Gemini/Vertex, or OpenAI/Azure with MP3 or WAV audio.';
  }

  return `Selected provider "${providerToken}" is not supported for Describe Image audio transcription in the current PTE scorer.`;
}

function isGeminiFlashRuntimeProvider(runtimeProvider = {}) {
  const providerId = s(runtimeProvider?.providerId, 80).toLowerCase();
  if (providerId !== 'google-gemini' && providerId !== 'google-vertex') return false;
  const modelToken = s(runtimeProvider?.modelId || runtimeProvider?.modelUsed, 220).toLowerCase();
  return modelToken.includes('flash');
}

function isGeminiRuntimeProvider(runtimeProvider = {}) {
  const providerId = s(runtimeProvider?.providerId, 80).toLowerCase();
  return providerId === 'google-gemini' || providerId === 'google-vertex';
}

function isGeminiTemporaryCapacityError(error = null) {
  const text = s(error?.message || error, 1200).toLowerCase();
  const code = s(error?.code || error?.status || error?.statusCode, 80).toLowerCase();
  return (
    code === '503'
    || code === 'unavailable'
    || text.includes('503 service unavailable')
    || text.includes('currently experiencing high demand')
    || text.includes('try again later')
    || (text.includes('service unavailable') && text.includes('google'))
  );
}

function resolveGeminiFallbackModelId(modelId = '') {
  const token = s(modelId, 220);
  const lower = token.toLowerCase();
  if (!token || lower.includes('flash')) return '';
  if (lower.includes('pro')) return token.replace(/pro/ig, 'flash');
  return 'gemini-2.5-flash';
}

function withRuntimeModel(runtimeProvider = {}, modelId = '') {
  return {
    ...runtimeProvider,
    modelId: s(modelId, 220) || runtimeProvider.modelId || null
  };
}

function sleepMs(ms = 0) {
  const wait = Math.max(0, Number(ms) || 0);
  if (!wait) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, wait));
}

async function sendWithGeminiCapacityFallback({
  runtimeProvider = {},
  sendFn = null,
  retryDelayMs = 1200
} = {}) {
  if (typeof sendFn !== 'function') {
    throw new Error('Gemini capacity fallback requires a send function.');
  }

  const warnings = [];
  try {
    const result = await sendFn(runtimeProvider);
    return { result, runtimeProvider, warnings };
  } catch (error) {
    if (!isGeminiRuntimeProvider(runtimeProvider) || !isGeminiTemporaryCapacityError(error)) {
      throw error;
    }

    const selectedModel = s(runtimeProvider.modelId || runtimeProvider.modelUsed, 220) || 'default Gemini model';
    warnings.push(`Gemini model ${selectedModel} returned a temporary capacity error; scorer retried once.`);
    const configuredDelay = Number(process.env.PTE_SCORING_GEMINI_CAPACITY_RETRY_DELAY_MS);
    const effectiveDelayMs = Number.isFinite(configuredDelay) && configuredDelay >= 0
      ? configuredDelay
      : retryDelayMs;
    await sleepMs(effectiveDelayMs);

    try {
      const retryResult = await sendFn(runtimeProvider);
      return {
        result: retryResult,
        runtimeProvider,
        warnings
      };
    } catch (retryError) {
      if (!isGeminiTemporaryCapacityError(retryError)) throw retryError;

      const fallbackModel = resolveGeminiFallbackModelId(runtimeProvider.modelId || runtimeProvider.modelUsed);
      if (!fallbackModel) throw retryError;

      const fallbackRuntimeProvider = withRuntimeModel(runtimeProvider, fallbackModel);
      warnings.push(`Gemini model ${selectedModel} remained temporarily unavailable; scorer switched this request to ${fallbackModel}.`);
      const fallbackResult = await sendFn(fallbackRuntimeProvider);
      return {
        result: fallbackResult,
        runtimeProvider: fallbackRuntimeProvider,
        warnings
      };
    }
  }
}

async function readAudioArtifactForAi(artifact = {}) {
  const absolutePath = resolveArtifactPath(artifact);
  if (!absolutePath) {
    const remoteAudio = await readRemoteUploadArtifactForAi({
      artifact,
      maxBytes: AUDIO_MAX_BYTES,
      expectedMimePrefix: 'audio/',
      inferMimeType: inferAudioMimeType,
      tooLargeLabel: 'Uploaded audio artifact'
    });
    if (remoteAudio) return remoteAudio;
    throw new Error('Uploaded audio artifact does not have a readable local path.');
  }

  let stat = null;
  try {
    stat = await fs.stat(absolutePath);
  } catch (_) {
    stat = null;
  }
  if (!stat || !stat.isFile()) {
    const remoteAudio = await readRemoteUploadArtifactForAi({
      artifact,
      maxBytes: AUDIO_MAX_BYTES,
      expectedMimePrefix: 'audio/',
      inferMimeType: inferAudioMimeType,
      tooLargeLabel: 'Uploaded audio artifact'
    });
    if (remoteAudio) return remoteAudio;
    throw new Error('Uploaded audio artifact file is missing on disk.');
  }
  if (Number(stat.size || 0) <= 0) {
    throw new Error('Uploaded audio artifact file is empty.');
  }
  if (Number(stat.size || 0) > AUDIO_MAX_BYTES) {
    throw new Error(`Uploaded audio artifact is too large for v1 scoring (max ${Math.floor(AUDIO_MAX_BYTES / (1024 * 1024))}MB).`);
  }

  const buffer = await fs.readFile(absolutePath);
  return {
    absolutePath,
    mimeType: inferAudioMimeType(artifact, absolutePath),
    dataBase64: buffer.toString('base64'),
    sizeBytes: Number(stat.size || buffer.length || 0)
  };
}

async function readImageArtifactForAi(artifact = {}) {
  const absolutePath = resolveArtifactPath(artifact);
  if (!absolutePath) {
    const remoteImage = await readRemoteUploadArtifactForAi({
      artifact,
      maxBytes: IMAGE_MAX_BYTES,
      expectedMimePrefix: 'image/',
      inferMimeType: inferImageMimeType,
      tooLargeLabel: 'Prompt image asset'
    });
    if (remoteImage) return remoteImage;
    throw new Error('Prompt image asset does not have a readable local path.');
  }

  let stat = null;
  try {
    stat = await fs.stat(absolutePath);
  } catch (_) {
    stat = null;
  }
  if (!stat || !stat.isFile()) {
    const remoteImage = await readRemoteUploadArtifactForAi({
      artifact,
      maxBytes: IMAGE_MAX_BYTES,
      expectedMimePrefix: 'image/',
      inferMimeType: inferImageMimeType,
      tooLargeLabel: 'Prompt image asset'
    });
    if (remoteImage) return remoteImage;
    throw new Error('Prompt image asset file is missing on disk.');
  }
  if (Number(stat.size || 0) <= 0) {
    throw new Error('Prompt image asset file is empty.');
  }
  if (Number(stat.size || 0) > IMAGE_MAX_BYTES) {
    throw new Error(`Prompt image asset is too large for v1 scoring (max ${Math.floor(IMAGE_MAX_BYTES / (1024 * 1024))}MB).`);
  }

  const buffer = await fs.readFile(absolutePath);
  const mimeType = inferImageMimeType(artifact, absolutePath);
  if (!mimeType.startsWith('image/')) {
    throw new Error(`Prompt image asset does not appear to be an image file (detected ${mimeType}).`);
  }
  return {
    absolutePath,
    mimeType,
    dataBase64: buffer.toString('base64'),
    sizeBytes: Number(stat.size || buffer.length || 0)
  };
}

function buildDescribeImageAnalysisResponseSchema() {
  const traitSchema = {
    type: 'object',
    additionalProperties: true,
    properties: {
      score: { type: 'number' },
      evidence: { type: 'array', items: { type: 'string' } },
      notes: { type: 'string' },
      coveredKeyPoints: { type: 'array', items: { type: 'string' } },
      missingKeyPoints: { type: 'array', items: { type: 'string' } }
    }
  };
  return {
    type: 'object',
    additionalProperties: true,
    required: ['transcript', 'microResponses', 'speechMetrics', 'confidence'],
    properties: {
      transcript: { type: 'string' },
      microResponses: buildMicroResponsesSchema(),
      content: traitSchema,
      pronunciation: traitSchema,
      fluency: traitSchema,
      intelligibilityNotes: { type: 'string' },
      visualDescriptionNotes: { type: 'string' },
      speechMetrics: {
        type: 'object',
        additionalProperties: true,
        properties: {
          speechDurationSeconds: { type: 'number' },
          estimatedWpm: { type: 'number' },
          longPauseCount: { type: 'number' },
          longestPauseSeconds: { type: 'number' },
          hesitationCount: { type: 'number' },
          repetitionCount: { type: 'number' }
        }
      },
      confidence: { type: 'number' },
      warnings: { type: 'array', items: { type: 'string' } }
    }
  };
}

function buildDescribeImageVisualContextSchema() {
  return {
    type: 'object',
    additionalProperties: true,
    required: ['imageCaption', 'expectedKeyPoints', 'chartType'],
    properties: {
      imageCaption: { type: 'string' },
      expectedKeyPoints: {
        type: 'array',
        items: { type: 'string' }
      },
      chartType: { type: 'string' },
      warnings: {
        type: 'array',
        items: { type: 'string' }
      }
    }
  };
}

function resolveOpenAiDescribeImageVisionModelId() {
  return s(process.env.PTE_OPENAI_DESCRIBE_IMAGE_VISION_MODEL_ID, 220)
    || DEFAULT_OPENAI_DESCRIBE_IMAGE_VISION_MODEL_ID;
}

function parseDescribeImageVisualContext(input = '') {
  const parsed = typeof input === 'string'
    ? extractJsonObject(input)
    : (isPlainObject(input) ? input : null);
  const row = safeObject(parsed, {});
  return {
    imageCaption: s(
      row.imageCaption
        || row.caption
        || row.visualCaption
        || row.description
        || row.visualDescription,
      1200
    ),
    sourceText: s(row.sourceText || row.visualContext || '', 3000),
    expectedKeyPoints: normalizeKeyPoints(
      row.expectedKeyPoints
        || row.keyPoints
        || row.mainPoints
        || row.visualKeyPoints
        || []
    ),
    chartType: s(row.chartType || row.visualType || row.imageType || '', 120),
    warnings: normalizeWarnings(row.warnings || row.warning || [])
  };
}

function mergeDescribeImageVisualContext(baseContext = {}, extractedContext = {}) {
  const baseKeyPoints = normalizeKeyPoints(baseContext.expectedKeyPoints || []);
  const extractedKeyPoints = normalizeKeyPoints(extractedContext.expectedKeyPoints || []);
  return {
    ...baseContext,
    imageCaption: s(baseContext.imageCaption, 1200) || s(extractedContext.imageCaption, 1200),
    sourceText: s(baseContext.sourceText, 3000) || s(extractedContext.sourceText, 3000),
    expectedKeyPoints: baseKeyPoints.length ? baseKeyPoints : extractedKeyPoints,
    chartType: s(baseContext.chartType, 120) || s(extractedContext.chartType, 120)
  };
}

function buildOpenAiVisualContextProviderMeta(result = {}, runtimeProvider = {}) {
  const responseText = s(result?.text || '', 200000);
  return {
    providerId: result?.provider || runtimeProvider.providerId || '',
    modelUsed: result?.modelUsed || resolveOpenAiDescribeImageVisionModelId(),
    responseTextPreview: s(responseText, 1000),
    responseCharCount: responseText.length,
    tokenUsage: normalizeTokenUsage(result?.usage)
  };
}

function attachVisualContextProviderMetadata(bundle = {}, visualContextProvider = null) {
  if (!visualContextProvider) return bundle;
  const provider = safeObject(bundle?.provider, {});
  return {
    ...bundle,
    provider: {
      ...provider,
      tokenUsage: mergeTokenUsage(visualContextProvider.tokenUsage, provider.tokenUsage),
      visualContext: visualContextProvider
    }
  };
}

function attachDescribeImageContextToAnalysisBundle(bundle = {}, describeImageContext = {}) {
  if (!isPlainObject(bundle)) return bundle;
  return {
    ...bundle,
    describeImageContext: safeObject(describeImageContext, {})
  };
}

async function enrichDescribeImageContextWithOpenAiVision({
  runtimeProvider = {},
  image = null,
  describeImageContext = {},
  session = {},
  item = {}
} = {}) {
  if (s(runtimeProvider.providerId, 80).toLowerCase() !== 'openai') {
    return { describeImageContext, warnings: [], provider: null };
  }
  if (!image?.dataBase64 || !image?.mimeType || hasDescribeImageTextVisualEvidence(describeImageContext)) {
    return { describeImageContext, warnings: [], provider: null };
  }

  const promptText = [
    'Extract factual visual context for PTE Describe Image scoring.',
    'Return compact JSON only.',
    'Required JSON keys: imageCaption, expectedKeyPoints, chartType, warnings.',
    'Do not mention uncertainty unless the image is unclear.',
    'The key points should be short scoring anchors for judging whether a spoken response matches the image.'
  ].join(' ');

  const result = await pteAiProviderService.sendPrompt({
    messages: [
      {
        role: 'system',
        content: 'You are a careful PTE Describe Image visual-context extraction service. Return compact JSON only.'
      },
      {
        role: 'user',
        content: [
          { text: promptText },
          {
            inlineData: {
              mimeType: image.mimeType,
              data: image.dataBase64
            }
          }
        ]
      }
    ],
    providerId: 'openai',
    modelId: resolveOpenAiDescribeImageVisionModelId(),
    credentials: runtimeProvider.credentials || {},
    generationConfig: {
      temperature: 0,
      topP: 1,
      maxOutputTokens: 1000
    },
    responseMimeType: 'application/json',
    responseSchema: buildDescribeImageVisualContextSchema(),
    disableCache: true,
    requestLabel: 'pte-describe-image-openai-vision-context',
    timeoutMs: 90000,
    usageContext: {
      requestingUser: runtimeProvider.requestingUser || null,
      section: SECTIONS.PTE_SCORING,
      operation: OPERATIONS.AI_SCORING,
      objectId: s(item.id || session.id || 'DRAFT:describe-image-vision', 160),
      requestLabel: 'pte-describe-image-openai-vision-context',
      providerRecordId: s(runtimeProvider?.providerRecord?.id, 160),
      providerRecordName: s(runtimeProvider?.providerRecord?.name, 220),
      source: {
        module: 'pte_attempt_scoring',
        eventType: 'describe_image_openai_visual_context'
      }
    }
  });

  const extracted = parseDescribeImageVisualContext(result?.text || '');
  const enriched = mergeDescribeImageVisualContext(describeImageContext, extracted);
  if (!hasDescribeImageTextVisualEvidence(enriched)) {
    throw new Error('OpenAI Describe Image scoring could not extract caption/key-point context from the prompt image.');
  }

  return {
    describeImageContext: enriched,
    warnings: normalizeWarnings([
      ...extracted.warnings,
      'OpenAI Describe Image scoring extracted text visual context from the prompt image before audio scoring.'
    ]),
    provider: buildOpenAiVisualContextProviderMeta(result, runtimeProvider)
  };
}

function buildAudioAnalysisPrompt({
  describeImageContext = {},
  recordingDurationSeconds = 0,
  hasPromptImage = false,
  scoringConfig = {}
} = {}) {
  const keyPoints = normalizeKeyPoints(describeImageContext.expectedKeyPoints || []);
  const contentMax = toFiniteNumber(scoringConfig.contentMax, 5) || 5;
  const pronunciationMax = toFiniteNumber(scoringConfig.pronunciationMax, 5) || 5;
  const fluencyMax = toFiniteNumber(scoringConfig.fluencyMax, 5) || 5;
  return [
    'Analyze the attached PTE Describe Image response audio.',
    hasPromptImage
      ? 'Use the attached prompt image as the visual source for content scoring.'
      : 'No prompt image file is attached; use the supplied image caption/key points as the visual source for content scoring.',
    'Use the audio as the only source for what the candidate said; ignore any typed transcript notes.',
    'Return strict JSON only.',
    'Required JSON keys: transcript, microResponses, speechMetrics, confidence, warnings.',
    'Return the complete verbatim transcript from beginning to end.',
    'Do not summarize or paraphrase the spoken response.',
    'Do not stop at the first clause or sentence; include every spoken word until the audio ends.',
    'Do not provide final trait scores for content, pronunciation, or fluency; the server will aggregate the micro responses deterministically.',
    `The server will map content to 0-${contentMax}, pronunciation to 0-${pronunciationMax}, and fluency to 0-${fluencyMax}.`,
    buildMicroRubricPrompt('speaking_describe_image'),
    recordingDurationSeconds > 0 ? `Browser-recorded duration: ${round2(recordingDurationSeconds)} seconds.` : '',
    describeImageContext.chartType ? `Visual type: ${describeImageContext.chartType}` : '',
    describeImageContext.imageCaption ? `Image caption: ${describeImageContext.imageCaption}` : '',
    describeImageContext.sourceText ? `Prompt notes: ${describeImageContext.sourceText}` : '',
    keyPoints.length ? `Expected visual key points: ${keyPoints.join(' | ')}` : '',
    scoringConfig.idealWpmMin || scoringConfig.idealWpmMax
      ? `WPM guidance: ${toFiniteNumber(scoringConfig.idealWpmMin, 90) || 90}-${toFiniteNumber(scoringConfig.idealWpmMax, 160) || 160} WPM is the target range.`
      : '',
    scoringConfig.longPauseSeconds
      ? `Long-pause threshold: ${round2(toFiniteNumber(scoringConfig.longPauseSeconds, 2) || 2)} seconds.`
      : ''
  ].filter(Boolean).join('\n');
}

async function sendDescribeImageAnalysisRequest({
  runtimeProvider = {},
  audio = {},
  image = null,
  systemPrompt = '',
  userPrompt = '',
  session = {},
  item = {},
  useStructuredSchema = true,
  requestLabel = 'pte-describe-image-scoring-v1'
} = {}) {
  const promptText = useStructuredSchema
    ? userPrompt
    : [
      userPrompt,
      '',
      'Fallback formatting instruction:',
      'Return exactly one JSON object. Do not include markdown, commentary, or extra text.',
      'The JSON object must include transcript, microResponses, speechMetrics, confidence, and warnings.'
    ].join('\n');
  const userParts = [{ text: promptText }];
  if (image?.dataBase64 && image?.mimeType) {
    userParts.push({
      inlineData: {
        mimeType: image.mimeType,
        data: image.dataBase64
      }
    });
  }
  userParts.push({
    inlineData: {
      mimeType: audio.mimeType,
      data: audio.dataBase64
    }
  });

  return pteAiProviderService.sendPrompt({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userParts }
    ],
    providerId: runtimeProvider.providerId,
    modelId: runtimeProvider.modelId || null,
    credentials: runtimeProvider.credentials || {},
    generationConfig: {
      temperature: 0,
      topP: 1,
      maxOutputTokens: 1400
    },
    responseMimeType: useStructuredSchema ? 'application/json' : undefined,
    responseSchema: useStructuredSchema ? buildDescribeImageAnalysisResponseSchema() : undefined,
    disableCache: true,
    requestLabel,
    timeoutMs: 160000,
    usageContext: {
      requestingUser: runtimeProvider.requestingUser || null,
      section: SECTIONS.PTE_SCORING,
      operation: OPERATIONS.AI_SCORING,
      objectId: s(item.id || session.id || 'DRAFT:describe-image', 160),
      requestLabel,
      providerRecordId: s(runtimeProvider?.providerRecord?.id, 160),
      providerRecordName: s(runtimeProvider?.providerRecord?.name, 220),
      source: {
        module: 'pte_attempt_scoring',
        eventType: 'describe_image_audio_visual_analysis'
      }
    }
  });
}

async function sendDescribeImageTranscriptRecoveryRequest({
  runtimeProvider = {},
  audio = {},
  session = {},
  item = {},
  strictFullTranscript = false,
  requestLabel = 'pte-describe-image-transcript-recovery-v1'
} = {}) {
  const promptText = [
    'Transcribe the attached PTE Describe Image response audio.',
    'Use the audio only. Do not infer words from the image, question, or typed notes.',
    strictFullTranscript
      ? 'The previous transcript looked incomplete or cut off. Listen to the whole recording from beginning to end and return the complete verbatim transcript.'
      : '',
    strictFullTranscript
      ? 'Do not stop at the first clause or sentence. Include every spoken word until the audio ends.'
      : '',
    'Return exactly one JSON object with keys: transcript, confidence, speechMetrics, warnings.',
    'transcript must contain only the words actually spoken by the candidate.',
    'If there is no usable speech, set transcript to an empty string and explain why in warnings.'
  ].filter(Boolean).join('\n');

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
      objectId: s(item.id || session.id || 'DRAFT:describe-image-transcript', 160),
      requestLabel,
      providerRecordId: s(runtimeProvider?.providerRecord?.id, 160),
      providerRecordName: s(runtimeProvider?.providerRecord?.name, 220),
      source: {
        module: 'pte_attempt_scoring',
        eventType: 'describe_image_audio_transcript_recovery'
      }
    }
  });
}

async function sendDescribeImageMicroRubricRecoveryRequest({
  runtimeProvider = {},
  audio = {},
  image = null,
  transcript = '',
  describeImageContext = {},
  responsePayload = {},
  scoringConfig = {},
  session = {},
  item = {},
  requestLabel = 'pte-describe-image-micro-rubric-recovery-v1'
} = {}) {
  const recordingDurationSeconds = toFiniteNumber(
    responsePayload.audioDurationSeconds
      ?? responsePayload.durationSeconds,
    0
  );
  const promptText = [
    'The previous PTE Describe Image analysis produced a usable transcript but did not produce usable micro-rubric responses.',
    'Return compact JSON only.',
    'Use the attached audio for pronunciation and oral fluency evidence.',
    image?.dataBase64
      ? 'Use the attached prompt image as the visual source for content micro answers.'
      : 'No prompt image file is attached; use the supplied image caption/key points as the visual source for content micro answers.',
    'Do not provide final trait scores. The server aggregates microResponses deterministically.',
    'Required JSON keys: transcript, microResponses, speechMetrics, confidence, warnings.',
    'Use this exact shape: {"transcript":"...","microResponses":[{"id":"content_main_idea","choice":"yes","evidence":"...","confidence":0.8}],"speechMetrics":{"estimatedWpm":120},"confidence":0.8,"warnings":[]}',
    '',
    buildAudioAnalysisPrompt({
      describeImageContext,
      recordingDurationSeconds,
      hasPromptImage: Boolean(image?.dataBase64),
      scoringConfig
    }),
    '',
    `Candidate transcript from the previous pass: ${s(transcript, 50000)}`
  ].filter(Boolean).join('\n');
  const userContent = [{ text: promptText }];
  if (image?.dataBase64 && image?.mimeType) {
    userContent.push({
      inlineData: {
        mimeType: image.mimeType,
        data: image.dataBase64
      }
    });
  }
  userContent.push({
    inlineData: {
      mimeType: audio.mimeType,
      data: audio.dataBase64
    }
  });

  return pteAiProviderService.sendPrompt({
    messages: [
      {
        role: 'system',
        content: 'You are a careful PTE Describe Image micro-rubric recovery service. Return compact JSON only.'
      },
      {
        role: 'user',
        content: userContent
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
      objectId: s(item.id || session.id || 'DRAFT:describe-image-micro-rubric', 160),
      requestLabel,
      providerRecordId: s(runtimeProvider?.providerRecord?.id, 160),
      providerRecordName: s(runtimeProvider?.providerRecord?.name, 220),
      source: {
        module: 'pte_attempt_scoring',
        eventType: 'describe_image_audio_micro_rubric_recovery'
      }
    }
  });
}

function buildAnalysisBundleFromProviderResult(result = {}, runtimeProvider = {}, extraWarnings = []) {
  const responseText = s(result?.text || '', 200000);
  const analysis = parseAiDescribeImageAnalysis(responseText);
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

function buildTranscriptRecoveryBundleFromProviderResult(result = {}, runtimeProvider = {}, extraWarnings = []) {
  const responseText = s(result?.text || '', 200000);
  const analysis = parseAiDescribeImageTranscriptRecovery(responseText);
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

function mergeDescribeImageTranscriptRecoveryBundle(bundle = {}, recoveryBundle = {}) {
  const baseAnalysis = parseAiDescribeImageAnalysis(bundle?.analysis || bundle?.aiAnalysis || bundle);
  const recoveryAnalysis = parseAiDescribeImageTranscriptRecovery(recoveryBundle?.analysis || recoveryBundle?.aiAnalysis || recoveryBundle);
  const transcript = s(recoveryAnalysis.transcript, 50000);
  if (!transcript) {
    baseAnalysis.warnings = normalizeWarnings([
      ...(Array.isArray(baseAnalysis.warnings) ? baseAnalysis.warnings : []),
      ...(Array.isArray(recoveryAnalysis.warnings) ? recoveryAnalysis.warnings : []),
      'Audio-only transcript recovery returned no usable transcript.'
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
  baseAnalysis.warnings = normalizeWarnings([
    ...(Array.isArray(baseAnalysis.warnings) ? baseAnalysis.warnings : []),
    ...(Array.isArray(recoveryAnalysis.warnings) ? recoveryAnalysis.warnings : []),
    'Recovered transcript using an audio-only follow-up request.'
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

async function recoverDescribeImageTranscriptIfMissing({
  bundle = {},
  runtimeProvider = {},
  audio = {},
  session = {},
  item = {}
} = {}) {
  const analysis = parseAiDescribeImageAnalysis(bundle?.analysis || bundle?.aiAnalysis || bundle);
  const transcript = s(analysis.transcript, 50000);
  const initialLooksIncomplete = transcriptTooIncompleteToScore(transcript);
  if (transcript && !initialLooksIncomplete) return bundle;

  try {
    const recoveryResult = await sendDescribeImageTranscriptRecoveryRequest({
      runtimeProvider,
      audio,
      session,
      item,
      strictFullTranscript: Boolean(initialLooksIncomplete),
      requestLabel: 'pte-describe-image-transcript-recovery-v1'
    });
    const recoveryBundle = buildTranscriptRecoveryBundleFromProviderResult(recoveryResult, runtimeProvider);
    return mergeDescribeImageTranscriptRecoveryBundle(bundle, recoveryBundle);
  } catch (error) {
    const mergedAnalysis = parseAiDescribeImageAnalysis(bundle?.analysis || bundle?.aiAnalysis || bundle);
    mergedAnalysis.warnings = normalizeWarnings([
      ...(Array.isArray(mergedAnalysis.warnings) ? mergedAnalysis.warnings : []),
      `Audio-only transcript recovery failed: ${s(error?.message || error, 500) || 'unknown error'}.`
    ]);
    return {
      ...bundle,
      analysis: mergedAnalysis
    };
  }
}

function mergeDescribeImageMicroRubricRecoveryBundle(bundle = {}, recoveryBundle = {}, scoringConfig = {}, describeImageContext = {}) {
  const baseAnalysis = parseAiDescribeImageAnalysis(bundle?.analysis || bundle?.aiAnalysis || bundle);
  const recoveryAnalysis = parseAiDescribeImageAnalysis(recoveryBundle?.analysis || recoveryBundle?.aiAnalysis || recoveryBundle);
  const transcript = s(recoveryAnalysis.transcript || baseAnalysis.transcript, 50000);
  const contentMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.contentMax ?? scoringConfig.contentScoreMax, 5) || 5));
  const pronunciationMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.pronunciationMax, 5) || 5));
  const fluencyMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.fluencyMax ?? scoringConfig.oralFluencyMax, 5) || 5));
  const recoveryWithTranscript = {
    ...recoveryAnalysis,
    transcript
  };
  const recoveryMicro = evaluateSpeakingMicroRubric({
    questionType: 'speaking_describe_image',
    aiAnalysis: recoveryWithTranscript,
    traitMax: { content: contentMax, pronunciation: pronunciationMax, fluency: fluencyMax }
  });
  const deterministicMicro = recoveryMicro.ok
    ? null
    : buildDescribeImageDeterministicMicroEvaluation({
      aiAnalysis: {
        ...baseAnalysis,
        ...recoveryAnalysis,
        transcript,
        speechMetrics: {
          ...safeObject(baseAnalysis.speechMetrics, {}),
          ...safeObject(recoveryAnalysis.speechMetrics, {})
        }
      },
      describeImageContext,
      scoringConfig,
      reason: 'Generated Describe Image micro-rubric responses deterministically after the AI provider omitted required micro answers during recovery.'
    });
  const acceptedMicro = recoveryMicro.ok ? recoveryMicro : deterministicMicro;
  const provider = safeObject(bundle?.provider, {});
  const recoveryProvider = safeObject(recoveryBundle?.provider, {});

  if (!acceptedMicro?.ok) {
    baseAnalysis.warnings = normalizeWarnings([
      ...(Array.isArray(baseAnalysis.warnings) ? baseAnalysis.warnings : []),
      ...(Array.isArray(recoveryAnalysis.warnings) ? recoveryAnalysis.warnings : []),
      ...(Array.isArray(recoveryMicro.warnings) ? recoveryMicro.warnings : []),
      'Describe Image micro-rubric recovery follow-up did not return usable micro-rubric responses.'
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
  baseAnalysis.content = recoveryAnalysis.content || baseAnalysis.content;
  baseAnalysis.pronunciation = recoveryAnalysis.pronunciation || baseAnalysis.pronunciation;
  baseAnalysis.fluency = recoveryAnalysis.fluency || baseAnalysis.fluency;
  baseAnalysis.microResponses = acceptedMicro.microResponses;
  baseAnalysis.speechMetrics = {
    ...safeObject(baseAnalysis.speechMetrics, {}),
    ...safeObject(recoveryAnalysis.speechMetrics, {})
  };
  baseAnalysis.intelligibilityNotes = recoveryAnalysis.intelligibilityNotes || baseAnalysis.intelligibilityNotes || '';
  baseAnalysis.visualDescriptionNotes = recoveryAnalysis.visualDescriptionNotes || baseAnalysis.visualDescriptionNotes || '';
  baseAnalysis.confidence = recoveryAnalysis.confidence || baseAnalysis.confidence || 0;
  baseAnalysis.warnings = normalizeWarnings([
    ...(Array.isArray(baseAnalysis.warnings) ? baseAnalysis.warnings : []),
    ...(Array.isArray(recoveryAnalysis.warnings) ? recoveryAnalysis.warnings : []),
    ...(Array.isArray(acceptedMicro.warnings) ? acceptedMicro.warnings : []),
    recoveryMicro.ok
      ? 'Recovered Describe Image micro-rubric responses using an audio follow-up request.'
      : 'Recovered Describe Image micro-rubric responses using deterministic text-context fallback.'
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

async function recoverDescribeImageMicroRubricIfNeeded({
  bundle = {},
  runtimeProvider = {},
  audio = {},
  image = null,
  session = {},
  item = {},
  describeImageContext = {},
  responsePayload = {},
  scoringConfig = {}
} = {}) {
  const analysis = parseAiDescribeImageAnalysis(bundle?.analysis || bundle?.aiAnalysis || bundle);
  const transcript = s(analysis.transcript, 50000);
  if (!transcript || hasUsableDescribeImageMicroResponses(analysis, scoringConfig)) return bundle;

  try {
    const recoveryResult = await sendDescribeImageMicroRubricRecoveryRequest({
      runtimeProvider,
      audio,
      image,
      transcript,
      describeImageContext,
      responsePayload,
      scoringConfig,
      session,
      item
    });
    const recoveryBundle = buildAnalysisBundleFromProviderResult(recoveryResult, runtimeProvider);
    return mergeDescribeImageMicroRubricRecoveryBundle(bundle, recoveryBundle, scoringConfig, describeImageContext);
  } catch (error) {
    const mergedAnalysis = parseAiDescribeImageAnalysis(bundle?.analysis || bundle?.aiAnalysis || bundle);
    mergedAnalysis.warnings = normalizeWarnings([
      ...(Array.isArray(mergedAnalysis.warnings) ? mergedAnalysis.warnings : []),
      `Describe Image micro-rubric recovery follow-up failed: ${s(error?.message || error, 500) || 'unknown error'}.`
    ]);
    return {
      ...bundle,
      analysis: mergedAnalysis
    };
  }
}

async function recoverDescribeImageAnalysisIfNeeded({
  bundle = {},
  runtimeProvider = {},
  audio = {},
  image = null,
  session = {},
  item = {},
  describeImageContext = {},
  responsePayload = {},
  scoringConfig = {}
} = {}) {
  const transcriptBundle = await recoverDescribeImageTranscriptIfMissing({
    bundle,
    runtimeProvider,
    audio,
    session,
    item
  });
  return recoverDescribeImageMicroRubricIfNeeded({
    bundle: transcriptBundle,
    runtimeProvider,
    audio,
    image,
    session,
    item,
    describeImageContext,
    responsePayload,
    scoringConfig
  });
}

async function analyzeDescribeImageAudioWithAi({
  session = {},
  item = {},
  audioArtifact = {},
  imageArtifact = null,
  describeImageContext = {},
  responsePayload = {},
  scoringConfig = {},
  requestingUser = null
} = {}) {
  const runtimeProvider = await pteAiProviderDataService.resolveRuntimeProvider(requestingUser, {}, {
    purpose: 'pte_scoring',
    questionType: 'speaking_describe_image',
    scorerKey: 'speaking_describe_image'
  });
  runtimeProvider.requestingUser = requestingUser;
  const sourceAudio = await readAudioArtifactForAi(audioArtifact);
  const preparedAudio = await prepareAudioForScoringProvider({
    providerId: runtimeProvider.providerId,
    audio: sourceAudio,
    scorerName: 'Describe Image scoring',
    maxOutputBytes: AUDIO_MAX_BYTES
  });
  const audio = preparedAudio.audio;
  const compatibilityError = buildAudioProviderCompatibilityError(runtimeProvider.providerId, runtimeProvider.modelId, audio.mimeType);
  if (compatibilityError) {
    await preparedAudio.cleanup();
    throw new Error(compatibilityError);
  }

  try {
  const contextWarnings = [];
  let image = null;
  let effectiveDescribeImageContext = describeImageContext;
  let visualContextProvider = null;
  if (imageArtifact) {
    try {
      image = await readImageArtifactForAi(imageArtifact);
    } catch (error) {
      const hasTextVisualEvidence = hasDescribeImageTextVisualEvidence(effectiveDescribeImageContext);
      if (!hasTextVisualEvidence) throw error;
      contextWarnings.push(`Prompt image could not be attached to the AI request: ${s(error?.message || error, 500) || 'unknown error'}.`);
    }
  }
  if (s(runtimeProvider.providerId, 80).toLowerCase() === 'openai' && image?.dataBase64) {
    if (!hasDescribeImageTextVisualEvidence(effectiveDescribeImageContext)) {
      const visualContext = await enrichDescribeImageContextWithOpenAiVision({
        runtimeProvider,
        image,
        describeImageContext: effectiveDescribeImageContext,
        session,
        item
      });
      effectiveDescribeImageContext = visualContext.describeImageContext;
      visualContextProvider = visualContext.provider;
      contextWarnings.push(...normalizeWarnings(visualContext.warnings || []));
    } else {
      contextWarnings.push('OpenAI Describe Image audio scoring used the supplied caption/key points instead of attaching the prompt image to the audio request.');
    }
    image = null;
  }

  const recordingDurationSeconds = toFiniteNumber(
    responsePayload.audioDurationSeconds
      ?? responsePayload.durationSeconds
      ?? audioArtifact.durationSeconds,
    0
  );
  const systemPrompt = [
    'You are a careful PTE Describe Image audio and visual analysis service.',
    'You do not produce an official Pearson score.',
    'You return evidence-backed JSON for a downstream raw-rubric scorer.',
    'Never score from typed transcript notes; analyze the attached audio.'
  ].join(' ');
  const userPrompt = buildAudioAnalysisPrompt({
    describeImageContext: effectiveDescribeImageContext,
    recordingDurationSeconds,
    hasPromptImage: Boolean(image),
    scoringConfig
  });
  const primaryUsesStructuredSchema = !isOpenAiCompatibleProvider(runtimeProvider.providerId);
  const retryWarning = primaryUsesStructuredSchema
    ? 'AI provider returned an unusable structured Describe Image response; scorer retried with a looser JSON-only request.'
    : 'AI provider returned an unusable Describe Image JSON response; scorer retried with a JSON-only request.';

  let primaryResult = null;
  let activeRuntimeProvider = runtimeProvider;
  let primaryCapacityWarnings = [];
  try {
    const primaryCall = await sendWithGeminiCapacityFallback({
      runtimeProvider,
      sendFn: (providerForCall) => sendDescribeImageAnalysisRequest({
        runtimeProvider: providerForCall,
        audio,
        image,
        systemPrompt,
        userPrompt,
        session,
        item,
        useStructuredSchema: primaryUsesStructuredSchema,
        requestLabel: 'pte-describe-image-scoring-v1'
      })
    });
    primaryResult = primaryCall.result;
    activeRuntimeProvider = primaryCall.runtimeProvider || runtimeProvider;
    primaryCapacityWarnings = normalizeWarnings(primaryCall.warnings || []);
  } catch (error) {
    if (!isGeminiFlashRuntimeProvider(runtimeProvider)) throw error;
    try {
      const retryCall = await sendWithGeminiCapacityFallback({
        runtimeProvider,
        sendFn: (providerForCall) => sendDescribeImageAnalysisRequest({
          runtimeProvider: providerForCall,
          audio,
          image,
          systemPrompt,
          userPrompt,
          session,
          item,
          useStructuredSchema: false,
        requestLabel: 'pte-describe-image-scoring-v1-gemini-json-retry'
        })
      });
      const retryBundle = buildAnalysisBundleFromProviderResult(retryCall.result, retryCall.runtimeProvider || runtimeProvider, [
        ...contextWarnings,
        ...normalizeWarnings(retryCall.warnings || []),
        `Gemini Flash structured Describe Image request failed first: ${s(error?.message || error, 500) || 'unknown error'}.`,
        retryWarning
      ]);
      const recoveredBundle = await recoverDescribeImageAnalysisIfNeeded({
        bundle: retryBundle,
        runtimeProvider: retryCall.runtimeProvider || runtimeProvider,
        audio,
        image,
        session,
        item,
        describeImageContext: effectiveDescribeImageContext,
        responsePayload,
        scoringConfig
      });
      return attachDescribeImageContextToAnalysisBundle(recoveredBundle, effectiveDescribeImageContext);
    } catch (retryError) {
      const combined = new Error(
        `Gemini Flash Describe Image analysis failed after structured and fallback attempts. First: ${s(error?.message || error, 500) || 'unknown error'}. Fallback: ${s(retryError?.message || retryError, 500) || 'unknown error'}.`
      );
      combined.code = retryError?.code || error?.code || 'GEMINI_FLASH_DESCRIBE_IMAGE_ANALYSIS_FAILED';
      throw combined;
    }
  }

  const primaryBundle = attachVisualContextProviderMetadata(buildAnalysisBundleFromProviderResult(primaryResult, activeRuntimeProvider, [
    ...contextWarnings,
    ...primaryCapacityWarnings
  ]), visualContextProvider);
  const primaryAnalysis = parseAiDescribeImageAnalysis(primaryBundle?.analysis || {});
  const primaryHasTranscript = Boolean(s(primaryAnalysis.transcript, 50000));
  const primaryTranscriptLooksIncomplete = transcriptTooIncompleteToScore(primaryAnalysis.transcript);
  const primaryHasUsableMicro = hasUsableDescribeImageMicroResponses(primaryAnalysis, scoringConfig);
  if (primaryHasTranscript && !primaryTranscriptLooksIncomplete && primaryHasUsableMicro) {
    return attachDescribeImageContextToAnalysisBundle(primaryBundle, effectiveDescribeImageContext);
  }

  const shouldRetryLooseJson = isGeminiRuntimeProvider(activeRuntimeProvider)
    || primaryTranscriptLooksIncomplete
    || (primaryHasTranscript && !primaryHasUsableMicro);
  if (!shouldRetryLooseJson) {
    return attachDescribeImageContextToAnalysisBundle(primaryBundle, effectiveDescribeImageContext);
  }

  const retryCall = await sendWithGeminiCapacityFallback({
    runtimeProvider: activeRuntimeProvider,
    sendFn: (providerForCall) => sendDescribeImageAnalysisRequest({
      runtimeProvider: providerForCall,
      audio,
      image,
      systemPrompt,
      userPrompt,
      session,
      item,
      useStructuredSchema: false,
      requestLabel: isGeminiRuntimeProvider(activeRuntimeProvider)
        ? 'pte-describe-image-scoring-v1-gemini-json-retry'
        : 'pte-describe-image-scoring-v1-json-retry'
    })
  });
  const retryBundle = buildAnalysisBundleFromProviderResult(retryCall.result, retryCall.runtimeProvider || activeRuntimeProvider, [
    ...normalizeWarnings(primaryBundle?.analysis?.warnings || []),
    ...contextWarnings,
    ...normalizeWarnings(retryCall.warnings || []),
    retryWarning
  ]);
  retryBundle.provider = {
    ...safeObject(retryBundle.provider, {}),
    tokenUsage: mergeTokenUsage(primaryBundle?.provider?.tokenUsage, retryBundle?.provider?.tokenUsage),
    ...(visualContextProvider ? { visualContext: visualContextProvider } : {})
  };
  const retryAnalysis = parseAiDescribeImageAnalysis(retryBundle?.analysis || {});
  if (
    s(retryAnalysis.transcript, 50000)
    && !transcriptTooIncompleteToScore(retryAnalysis.transcript)
    && hasUsableDescribeImageMicroResponses(retryAnalysis, scoringConfig)
  ) {
    return attachDescribeImageContextToAnalysisBundle(retryBundle, effectiveDescribeImageContext);
  }
  const recoveredBundle = await recoverDescribeImageAnalysisIfNeeded({
    bundle: retryBundle,
    runtimeProvider: retryCall.runtimeProvider || activeRuntimeProvider,
    audio,
    image,
    session,
    item,
    describeImageContext: effectiveDescribeImageContext,
    responsePayload,
    scoringConfig
  });
  return attachDescribeImageContextToAnalysisBundle(recoveredBundle, effectiveDescribeImageContext);
  } finally {
    await preparedAudio.cleanup();
  }
}

function describeBand(score = 0, trait = '') {
  const value = Number(score || 0);
  if (trait === 'content') {
    if (value >= 5) return 'Complete and accurate visual description';
    if (value >= 4) return 'Strong visual description with minor gaps';
    if (value >= 3) return 'Adequate main idea and some support';
    if (value >= 2) return 'Limited or partly inaccurate visual content';
    if (value >= 1) return 'Minimal relevant visual content';
    return 'No relevant visual content detected';
  }
  if (value >= 5) return 'Very strong';
  if (value >= 4) return 'Good';
  if (value >= 3) return 'Developing';
  if (value >= 2) return 'Limited';
  if (value >= 1) return 'Weak';
  return 'No usable evidence';
}

function buildFeedbackDraft({ scoreResult = {}, aiAnalysis = {}, describeImageContext = {}, scoringConfig = {}, microEvaluation = null } = {}) {
  const traitScores = safeObject(scoreResult.traitScores, {});
  const strengths = [];
  const improvements = [];
  const microFeedback = buildMicroFeedbackRows(microEvaluation || {});
  const content = Number(traitScores.content || 0);
  const pronunciation = Number(traitScores.pronunciation || 0);
  const fluency = Number(traitScores.fluency || 0);

  if (content >= 4) {
    strengths.push('Content coverage is strong; the description captured the main visual information.');
  } else if (content >= 3) {
    strengths.push('The response identified the main visual idea.');
  }
  if (pronunciation >= 4) strengths.push('Pronunciation was generally clear and intelligible.');
  if (fluency >= 4) strengths.push('Fluency was mostly steady with manageable pauses.');

  const missing = normalizeTextArray(aiAnalysis?.content?.missingKeyPoints || [], 4);
  if (content < 4) {
    improvements.push(
      missing.length
        ? `Content needs more coverage: include missing visual points such as ${missing.join(', ')}.`
        : 'Content needs more coverage: state the main trend or relationship, then add two or three specific details from the image.'
    );
  }
  if (pronunciation < 4) {
    improvements.push('Pronunciation needs improvement: make key nouns, numbers, and comparisons easier to understand.');
  }
  if (fluency < 4) {
    improvements.push('Fluency needs improvement: reduce long pauses, hesitations, repetitions, and restarts while describing the image.');
  }

  const speechMetrics = safeObject(aiAnalysis?.speechMetrics, {});
  const wpm = Number(speechMetrics.estimatedWpm || 0);
  const idealMin = Number(scoringConfig.idealWpmMin || 90);
  const idealMax = Number(scoringConfig.idealWpmMax || 160);
  if (wpm > 0 && (wpm < idealMin || wpm > idealMax)) {
    improvements.push(`Aim for a steadier pace; estimated rate was ${round2(wpm)} WPM.`);
  }
  strengths.push(...microFeedback.strengths.slice(0, 4));
  improvements.push(...microFeedback.improvements.slice(0, 4));

  const keyPoints = normalizeKeyPoints(describeImageContext.expectedKeyPoints || []);
  const nextPracticeAction = content < 4
    ? 'Before recording again, write a 4-part speaking plan: opening overview, two key details, and one concluding comparison.'
    : 'Practice another Describe Image item and keep the same structure while improving pronunciation and rhythm.';

  return {
    summary: `${round2(scoreResult.scoreFinal || 0)} / ${round2(scoreResult.maxScore || 0)} raw rubric points.`,
    strengths: strengths.length ? strengths : ['The response has enough audio evidence for scoring.'],
    improvements: improvements.length ? improvements : ['Keep the same visual structure and polish pronunciation, pace, and sentence rhythm.'],
    nextPracticeAction: keyPoints.length && content < 4
      ? `${nextPracticeAction} Make sure you cover: ${keyPoints.slice(0, 3).join('; ')}.`
      : nextPracticeAction
  };
}

function makeScoringMetadata({
  status = '',
  describeImageContext = {},
  aiAnalysis = null,
  scoreResult = null,
  provider = {},
  audioArtifact = null,
  imageArtifact = null,
  responsePayload = {},
  scoringConfig = {},
  warnings = [],
  feedbackDraft = null,
  microEvaluation = null
} = {}) {
  const rubric = getRubric('speaking_describe_image') || {};
  const speechMetrics = safeObject(aiAnalysis?.speechMetrics, {});
  const traitMax = safeObject(scoreResult?.evidence?.traitMax, { content: 5, pronunciation: 5, fluency: 5 });
  const warningSplit = splitWarningsForAudience([
    ...(Array.isArray(aiAnalysis?.warnings) ? aiAnalysis.warnings : []),
    ...(Array.isArray(microEvaluation?.warnings) ? microEvaluation.warnings : []),
    ...warnings
  ]);
  return {
    status,
    scorerKey: 'speaking_describe_image',
    scorerVersion: DESCRIBE_IMAGE_SCORER_VERSION,
    scoringContractVersion: microEvaluation ? MICRO_SCORING_CONTRACT_VERSION : 1,
    scoreScale: 'raw_item_rubric_score',
    officialScoreEstimate: false,
    rubricSource: Array.isArray(rubric.rubricSources) ? rubric.rubricSources : [],
    configuredMethod: s(scoringConfig.method || '', 120) || 'hybrid_ai_audio_visual',
    provider: safeObject(provider, {}),
    microRubricVersion: microEvaluation?.microRubricVersion || '',
    microResponses: Array.isArray(microEvaluation?.microResponses) ? microEvaluation.microResponses : [],
    aggregationBreakdown: safeObject(microEvaluation?.aggregationBreakdown, {}),
    legacyDirectModelScores: collectLegacyDirectModelScores(aiAnalysis, ['content', 'pronunciation', 'fluency']),
    image: {
      imageAssetId: s(describeImageContext.imageAssetId || '', 500),
      imageCaption: s(describeImageContext.imageCaption || '', 1200),
      chartType: s(describeImageContext.chartType || '', 120),
      expectedKeyPoints: normalizeKeyPoints(describeImageContext.expectedKeyPoints || []),
      promptImageAttached: Boolean(imageArtifact),
      promptImageArtifactId: s(imageArtifact?.id || imageArtifact?._id || imageArtifact?.assetId || '', 160)
    },
    transcript: s(aiAnalysis?.transcript || '', 50000),
    content: {
      ...(aiAnalysis?.content || {}),
      maxScore: traitMax.content ?? 5,
      descriptor: describeBand(scoreResult?.traitScores?.content ?? aiAnalysis?.content?.score ?? 0, 'content')
    },
    pronunciation: {
      ...(aiAnalysis?.pronunciation || {}),
      maxScore: traitMax.pronunciation ?? 5,
      descriptor: describeBand(scoreResult?.traitScores?.pronunciation ?? aiAnalysis?.pronunciation?.score ?? 0, 'pronunciation')
    },
    fluency: {
      ...(aiAnalysis?.fluency || {}),
      maxScore: traitMax.fluency ?? 5,
      descriptor: describeBand(scoreResult?.traitScores?.fluency ?? aiAnalysis?.fluency?.score ?? 0, 'fluency')
    },
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
    intelligibilityNotes: s(aiAnalysis?.intelligibilityNotes || '', 1500),
    visualDescriptionNotes: s(aiAnalysis?.visualDescriptionNotes || '', 1500),
    confidence: normalizeConfidence(aiAnalysis?.confidence),
    warnings: warningSplit.publicWarnings,
    technicalWarnings: warningSplit.technicalWarnings,
    feedbackDraft: feedbackDraft || null,
    scoredAt: new Date().toISOString()
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
    'Describe Image audio analysis returned no usable transcript.',
    providerLabel
      ? `Provider response did not include a usable transcript field (${providerLabel}).`
      : 'Provider response did not include a usable transcript field.',
    ...(Array.isArray(aiAnalysis?.warnings) ? aiAnalysis.warnings : [])
  ]);
}

function buildIncompleteTranscriptWarnings(aiAnalysis = {}, responsePayload = {}) {
  const words = transcriptWordCount(aiAnalysis?.transcript || '');
  const duration = round2(toFiniteNumber(
    responsePayload.audioDurationSeconds
      ?? responsePayload.durationSeconds
      ?? aiAnalysis?.speechMetrics?.speechDurationSeconds,
    0
  ));
  return normalizeWarnings([
    'Describe Image transcript appears incomplete or truncated, so the raw score was not recorded.',
    words > 0 ? `Recovered transcript contains ${words} words and may not represent the full response.` : '',
    duration > 0 ? `Recorded duration was ${duration} seconds.` : '',
    ...(Array.isArray(aiAnalysis?.warnings) ? aiAnalysis.warnings : [])
  ]);
}

function buildInvalidAnalysisWarnings(aiAnalysis = {}, provider = {}) {
  const providerId = s(provider?.providerId || provider?.provider, 80);
  const model = s(provider?.modelUsed || provider?.modelId, 180);
  const providerLabel = [providerId, model].filter(Boolean).join(' / ');
  return normalizeWarnings([
    'Describe Image audio analysis did not return usable micro-rubric responses.',
    providerLabel
      ? `Provider response did not include valid Describe Image scoring JSON (${providerLabel}).`
      : 'Provider response did not include valid Describe Image scoring JSON.',
    ...(Array.isArray(aiAnalysis?.warnings) ? aiAnalysis.warnings : [])
  ]);
}

async function scoreDescribeImageAttemptItem(args = {}, options = {}) {
  const {
    session = {},
    item = {},
    question = {},
    artifacts = [],
    responsePayload = {},
    scoringConfig = {},
    requestingUser = null
  } = args;
  const describeImageContext = resolveDescribeImageContext(question, item);
  const baseContext = { describeImageContext, responsePayload, scoringConfig };
  const hasTextVisualEvidence = hasDescribeImageTextVisualEvidence(describeImageContext);
  const imageArtifact = selectPromptImageArtifact({ question, item, describeImageContext });
  if (!imageArtifact && !hasTextVisualEvidence) {
    return needsEvidenceResult([
      'Describe Image scoring requires prompt image evidence, an image caption, or expected key points.',
      'Content cannot be evaluated from the applicant audio alone.'
    ], baseContext);
  }

  const audioArtifact = selectAudioArtifact({ item, artifacts, responsePayload });
  if (!audioArtifact) {
    return needsEvidenceResult([
      'Describe Image scoring requires an uploaded audio response.',
      'Typed transcript notes alone are not scored.'
    ], {
      ...baseContext,
      imageArtifact
    });
  }

  let analysisBundle = null;
  try {
    if (typeof options.audioAnalyzer === 'function') {
      analysisBundle = await options.audioAnalyzer({
        session,
        item,
        question,
        audioArtifact,
        imageArtifact,
        describeImageContext,
        responsePayload,
        scoringConfig,
        requestingUser
      });
    } else if (Object.prototype.hasOwnProperty.call(options, 'aiAnalysis')) {
      analysisBundle = {
        analysis: parseAiDescribeImageAnalysis(options.aiAnalysis),
        provider: safeObject(options.provider, { providerId: 'test', modelUsed: 'injected' })
      };
    } else {
      analysisBundle = await analyzeDescribeImageAudioWithAi({
        session,
        item,
        audioArtifact,
        imageArtifact,
        describeImageContext,
        responsePayload,
        scoringConfig,
        requestingUser
      });
    }
  } catch (error) {
    return failedResult([
      `Describe Image audio analysis failed: ${s(error?.message || error, 800) || 'unknown error'}.`
    ], {
      ...baseContext,
      audioArtifact,
      imageArtifact
    });
  }

  const aiAnalysis = parseAiDescribeImageAnalysis(
    analysisBundle?.analysis || analysisBundle?.aiAnalysis || analysisBundle
  );
  const scoringDescribeImageContext = safeObject(analysisBundle?.describeImageContext, describeImageContext);
  const scoringBaseContext = { describeImageContext: scoringDescribeImageContext, responsePayload, scoringConfig };
  const provider = safeObject(analysisBundle?.provider, {});
  if (!s(aiAnalysis.transcript, 50000)) {
    return failedResult(buildMissingTranscriptWarnings(aiAnalysis, provider), {
      ...scoringBaseContext,
      aiAnalysis,
      provider,
      audioArtifact,
      imageArtifact
    });
  }
  if (transcriptTooIncompleteToScore(aiAnalysis.transcript)) {
    return failedResult(buildIncompleteTranscriptWarnings(aiAnalysis, responsePayload), {
      ...scoringBaseContext,
      aiAnalysis,
      provider,
      audioArtifact,
      imageArtifact
    });
  }
  const contentMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.contentMax ?? scoringConfig.contentScoreMax, 5) || 5));
  const pronunciationMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.pronunciationMax, 5) || 5));
  const fluencyMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.fluencyMax ?? scoringConfig.oralFluencyMax, 5) || 5));
  const microEvaluation = isLegacyDirectScoring(scoringConfig)
    ? null
    : evaluateSpeakingMicroRubric({
      questionType: 'speaking_describe_image',
      aiAnalysis,
      traitMax: { content: contentMax, pronunciation: pronunciationMax, fluency: fluencyMax }
    });
  const deterministicMicroEvaluation = microEvaluation && !microEvaluation.ok
    ? buildDescribeImageDeterministicMicroEvaluation({
      aiAnalysis,
      describeImageContext: scoringDescribeImageContext,
      scoringConfig
    })
    : null;
  const finalMicroEvaluation = deterministicMicroEvaluation?.ok ? deterministicMicroEvaluation : microEvaluation;
  if (aiAnalysis.validJson === false && !finalMicroEvaluation?.ok) {
    return failedResult(buildInvalidAnalysisWarnings(aiAnalysis, provider), {
      ...scoringBaseContext,
      aiAnalysis,
      provider,
      audioArtifact,
      imageArtifact
    });
  }
  if (finalMicroEvaluation && !finalMicroEvaluation.ok) {
    return failedResult(finalMicroEvaluation.warnings, {
      ...scoringBaseContext,
      aiAnalysis,
      provider,
      audioArtifact,
      imageArtifact,
      microEvaluation: finalMicroEvaluation
    });
  }

  const scoreResult = calculateDescribeImageScore({ aiAnalysis, scoringConfig, microTraitScores: finalMicroEvaluation?.traitScores });
  const feedbackDraft = buildFeedbackDraft({
    scoreResult,
    aiAnalysis,
    describeImageContext: scoringDescribeImageContext,
    scoringConfig,
    microEvaluation: finalMicroEvaluation
  });
  const metadata = makeScoringMetadata({
    status: 'scored',
    describeImageContext: scoringDescribeImageContext,
    aiAnalysis,
    scoreResult,
    provider,
    audioArtifact,
    imageArtifact,
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
  calculateDescribeImageScore,
  parseAiDescribeImageAnalysis,
  parseAiDescribeImageTranscriptRecovery,
  selectAudioArtifact,
  selectPromptImageArtifact,
  resolveDescribeImageContext,
  scoreDescribeImageAttemptItem,
  analyzeDescribeImageAudioWithAi
};
