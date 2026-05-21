const path = require('path');
const pteAiProviderDataService = require('./pteAiProviderDataService');
const pteAiProviderService = require('./ai/aiProviderService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');
const {
  REPEAT_SENTENCE_SCORER_VERSION,
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

function normalizeTraitScore(value, maxScore = 5, fallback = 0) {
  const max = Math.max(0, toFiniteNumber(maxScore, 5) || 5);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.min(max, Math.max(0, fallback));
  return Math.min(max, Math.max(0, Math.round(numeric)));
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

function isLegacyDirectScoring(scoringConfig = {}) {
  return s(scoringConfig?.method || '', 120).toLowerCase() === 'legacy_ai_direct';
}

function hasUsableRepeatSentenceMicroResponses(aiAnalysis = {}, scoringConfig = {}) {
  if (isLegacyDirectScoring(scoringConfig)) return true;
  const pronunciationMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.pronunciationMax, 5) || 5));
  const fluencyMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.fluencyMax ?? scoringConfig.oralFluencyMax, 5) || 5));
  const microEvaluation = evaluateSpeakingMicroRubric({
    questionType: 'speaking_repeat_sentence',
    aiAnalysis,
    traitMax: { pronunciation: pronunciationMax, fluency: fluencyMax }
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
    parsed.candidateResponse,
    parsed.spokenText,
    parsed.responseText,
    parsed.audioText,
    parsed.speechText,
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
    notes: firstNonEmptyText([row.notes, row.rationale, row.reason, row.descriptor], 1500)
  };
}

function parseAiRepeatSentenceAnalysis(input = {}) {
  const parsed = typeof input === 'string'
    ? extractJsonObject(input)
    : (isPlainObject(input) ? input : null);
  if (!isPlainObject(parsed)) {
    return {
      transcript: '',
      pronunciation: normalizeTraitAnalysis({}),
      fluency: normalizeTraitAnalysis({}),
      speechMetrics: {},
      microResponses: [],
      confidence: 0,
      warnings: ['AI Repeat Sentence analysis did not return valid JSON.']
    };
  }

  const metricsRaw = safeObject(parsed.speechMetrics || parsed.metrics || parsed.timingMeta, {});
  const scoresRaw = safeObject(parsed.scores || parsed.traitScores, {});
  return {
    transcript: resolveTranscriptFromParsedAnalysis(parsed),
    pronunciation: normalizeTraitAnalysis(parsed.pronunciation || scoresRaw.pronunciation || parsed.pronunciationScore || parsed.pronunciationBand || 0),
    fluency: normalizeTraitAnalysis(parsed.fluency || parsed.oralFluency || scoresRaw.fluency || scoresRaw.oralFluency || parsed.fluencyScore || parsed.fluencyBand || 0),
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
      repetitionCount: Math.max(0, Math.floor(toFiniteNumber(metricsRaw.repetitionCount ?? parsed.repetitionCount, 0))),
      rhythmNotes: s(metricsRaw.rhythmNotes || parsed.rhythmNotes || '', 1500)
    },
    intelligibilityNotes: s(parsed.intelligibilityNotes || parsed.intelligibility || '', 1500),
    microResponses: normalizeMicroResponseRows(parsed),
    confidence: normalizeConfidence(parsed.confidence ?? metricsRaw.confidence),
    warnings: normalizeWarnings(parsed.warnings || parsed.warning || [])
  };
}

function parseAiRepeatSentenceTranscriptRecovery(input = {}) {
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
      warnings: ['Repeat Sentence transcript recovery returned malformed JSON; transcript field was recovered.']
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
      ? ['Repeat Sentence transcript recovery returned plain text instead of JSON.']
      : ['Repeat Sentence transcript recovery did not return valid JSON or a usable transcript field.']
  };
}

function normalizeToken(value = '') {
  return s(value, 200)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'-]+/gu, '')
    .replace(/^[-']+|[-']+$/g, '');
}

function tokenizeForRepeatSentence(text = '') {
  return s(text, 50000)
    .split(/\s+/)
    .map(normalizeToken)
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
      pairs.push({ sourceIndex: i, responseIndex: j, word: a[i] });
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

function alignRepeatSentenceTokens(sourceTokens = [], responseTokens = []) {
  const source = Array.isArray(sourceTokens) ? sourceTokens : [];
  const response = Array.isArray(responseTokens) ? responseTokens : [];
  const pairs = longestCommonSubsequencePairs(source, response);
  const matchedSourceIndexes = new Set(pairs.map((pair) => pair.sourceIndex));
  const matchedResponseIndexes = new Set(pairs.map((pair) => pair.responseIndex));
  const omissionCount = Math.max(0, source.length - matchedSourceIndexes.size);
  const extraWordCount = Math.max(0, response.length - matchedResponseIndexes.size);
  const matchRatio = source.length > 0 ? round2(matchedSourceIndexes.size / source.length) : 0;
  const samples = [];

  source.forEach((word, index) => {
    if (matchedSourceIndexes.has(index) || samples.length >= MAX_ALIGNMENT_SAMPLES) return;
    samples.push({ type: 'omission_or_replacement', sourceIndex: index, sourceWord: word });
  });
  response.forEach((word, index) => {
    if (matchedResponseIndexes.has(index) || samples.length >= MAX_ALIGNMENT_SAMPLES) return;
    samples.push({ type: 'insertion_or_extra', responseIndex: index, responseWord: word });
  });

  return {
    sourceWordCount: source.length,
    responseWordCount: response.length,
    matchCount: matchedSourceIndexes.size,
    matchRatio,
    omissionCount,
    extraWordCount,
    samples,
    matchedPairs: pairs.slice(0, MAX_ALIGNMENT_SAMPLES)
  };
}

function calculateRepeatSentenceContentScore(alignment = {}) {
  const sourceWordCount = Math.max(0, Number(alignment.sourceWordCount || 0));
  const matchCount = Math.max(0, Number(alignment.matchCount || 0));
  if (!sourceWordCount || !matchCount) return 0;
  if (matchCount >= sourceWordCount) return 3;
  const ratio = matchCount / sourceWordCount;
  if (ratio >= 0.5) return 2;
  return 1;
}

function calculateRepeatSentenceScore({ expectedTranscript = '', transcript = '', aiAnalysis = {}, scoringConfig = {}, microTraitScores = null } = {}) {
  const sourceTokens = tokenizeForRepeatSentence(expectedTranscript);
  const responseTokens = tokenizeForRepeatSentence(transcript);
  const alignment = alignRepeatSentenceTokens(sourceTokens, responseTokens);
  const contentMax = Math.min(3, Math.max(0, toFiniteNumber(scoringConfig.contentMax ?? scoringConfig.contentScoreMax, 3) || 3));
  const pronunciationMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.pronunciationMax, 5) || 5));
  const fluencyMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.fluencyMax ?? scoringConfig.oralFluencyMax, 5) || 5));
  const content = Math.min(contentMax, calculateRepeatSentenceContentScore(alignment));
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
    traitScores: { content, pronunciation, fluency },
    evidence: {
      alignment,
      traitMax: {
        content: contentMax,
        pronunciation: pronunciationMax,
        fluency: fluencyMax
      }
    }
  };
}

function buildRepeatSentenceDeterministicMicroEvaluation({
  aiAnalysis = {},
  scoringConfig = {},
  reason = ''
} = {}) {
  if (isLegacyDirectScoring(scoringConfig)) return null;
  const transcript = s(aiAnalysis?.transcript || '', 50000);
  if (!transcript) return null;

  const transcriptWords = tokenizeForRepeatSentence(transcript).length;
  const speechMetrics = safeObject(aiAnalysis?.speechMetrics, {});
  const idealMin = toFiniteNumber(scoringConfig.idealWpmMin, 90);
  const idealMax = toFiniteNumber(scoringConfig.idealWpmMax, 170);
  const wpm = toFiniteNumber(speechMetrics.estimatedWpm ?? speechMetrics.wpm, 0);
  const longPauses = Math.max(0, Math.floor(toFiniteNumber(speechMetrics.longPauseCount, 0)));
  const hesitations = Math.max(0, Math.floor(toFiniteNumber(speechMetrics.hesitationCount, 0)));
  const repetitions = Math.max(0, Math.floor(toFiniteNumber(speechMetrics.repetitionCount, 0)));

  const pronunciationChoice = transcriptWords >= 5 ? 'developing' : 'limited';
  let fluencyChoice = 'developing';
  if (transcriptWords < 5) fluencyChoice = 'limited';
  else if (wpm >= idealMin && wpm <= idealMax && longPauses <= 1 && hesitations <= 2 && repetitions <= 2) fluencyChoice = 'good';
  else if ((wpm > 0 && (wpm < 55 || wpm > 220)) || longPauses >= 4 || hesitations >= 6 || repetitions >= 6) fluencyChoice = 'limited';

  const microResponses = [
    {
      id: 'pronunciation_quality',
      choice: pronunciationChoice,
      evidence: 'Detailed pronunciation micro-rubric evidence was missing, so pronunciation was capped conservatively from the recovered audio transcript.',
      confidence: 0.45
    },
    {
      id: 'fluency_quality',
      choice: fluencyChoice,
      evidence: wpm > 0
        ? `Fluency was scored conservatively from available timing evidence: ${round2(wpm)} WPM, ${longPauses} long pause(s), ${hesitations} hesitation(s), ${repetitions} repetition(s).`
        : 'Detailed fluency micro-rubric evidence was missing, so fluency was capped conservatively from the recovered transcript length.',
      confidence: 0.45
    }
  ];

  const pronunciationMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.pronunciationMax, 5) || 5));
  const fluencyMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.fluencyMax ?? scoringConfig.oralFluencyMax, 5) || 5));
  const evaluation = evaluateSpeakingMicroRubric({
    questionType: 'speaking_repeat_sentence',
    aiAnalysis: { microResponses },
    traitMax: { pronunciation: pronunciationMax, fluency: fluencyMax }
  });
  if (!evaluation.ok) return null;
  return {
    ...evaluation,
    warnings: normalizeWarnings([
      ...(Array.isArray(evaluation.warnings) ? evaluation.warnings : []),
      reason || 'Generated Repeat Sentence micro-rubric responses deterministically after the AI provider omitted required micro answers.'
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

function resolveExpectedTranscript(question = {}, item = {}) {
  const payload = resolveQuestionPayload(question, item);
  return firstNonEmptyText([
    payload.expectedTranscript,
    payload.transcript,
    payload.sourceText,
    payload.promptTranscript,
    item?.metadata?.expectedTranscript,
    item?.metadata?.questionSnapshot?.payload?.expectedTranscript
  ], 50000);
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

function artifactLooksLikeAudio(artifact = {}) {
  const type = s(artifact.artifactType || artifact.type, 80).toLowerCase();
  const mimeType = s(artifact.mimeType || artifact.contentType, 120).toLowerCase();
  if (type === 'audio') return true;
  if (mimeType.startsWith('audio/')) return true;
  const name = s(artifact.name || artifact.path || artifact.url || artifact.filename, 1000).toLowerCase();
  return /\.(webm|wav|mp3|m4a|ogg|oga|flac)$/.test(name);
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

function buildAudioProviderCompatibilityError(providerId = '', modelId = '', mimeType = '') {
  const providerToken = s(providerId, 80).toLowerCase();
  const mimeToken = s(mimeType, 120).toLowerCase();
  if (!providerToken) return '';
  if (providerToken === 'google-gemini' || providerToken === 'google-vertex') return '';
  if (providerToken === 'openai' || providerToken === 'azure-openai') {
    const supported = /audio\/(mpeg|mp3|wav|x-wav)/i.test(mimeToken);
    if (supported) {
      return buildOpenAiAudioModelCompatibilityError(providerToken, modelId, 'Repeat Sentence scoring');
    }
    return `Selected provider "${providerToken}" cannot reliably score ${mimeToken || 'this audio format'} in the current PTE Repeat Sentence scorer. OpenAI-compatible scoring requires prepared MP3 or WAV audio.`;
  }
  if (providerToken === 'anthropic') {
    return 'Selected provider "anthropic" is not supported for Repeat Sentence audio transcription in the current PTE scorer. Use Google Gemini/Vertex, or OpenAI/Azure with MP3 or WAV audio.';
  }
  return `Selected provider "${providerToken}" is not supported for Repeat Sentence audio transcription in the current PTE scorer.`;
}

function isGeminiFlashRuntimeProvider(runtimeProvider = {}) {
  const providerId = s(runtimeProvider?.providerId, 80).toLowerCase();
  if (providerId !== 'google-gemini' && providerId !== 'google-vertex') return false;
  const modelToken = s(runtimeProvider?.modelId || runtimeProvider?.modelUsed, 220).toLowerCase();
  return modelToken.includes('flash');
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

function buildRepeatSentenceAnalysisResponseSchema() {
  const traitSchema = {
    type: 'object',
    additionalProperties: true,
    properties: {
      score: { type: 'number' },
      evidence: { type: 'array', items: { type: 'string' } },
      notes: { type: 'string' }
    }
  };
  return {
    type: 'object',
    additionalProperties: true,
    required: ['transcript', 'microResponses', 'speechMetrics', 'confidence'],
    properties: {
      transcript: { type: 'string' },
      microResponses: buildMicroResponsesSchema(),
      pronunciation: traitSchema,
      fluency: traitSchema,
      intelligibilityNotes: { type: 'string' },
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
          rhythmNotes: { type: 'string' }
        }
      },
      confidence: { type: 'number' },
      warnings: { type: 'array', items: { type: 'string' } }
    }
  };
}

function buildAudioAnalysisPrompt({ expectedTranscript = '', transcriptVariants = [], recordingDurationSeconds = 0, scoringConfig = {} } = {}) {
  const idealWpmMin = toFiniteNumber(scoringConfig.idealWpmMin, 90);
  const idealWpmMax = toFiniteNumber(scoringConfig.idealWpmMax, 170);
  const longPauseSeconds = toFiniteNumber(scoringConfig.longPauseSeconds, 2);
  return [
    'Analyze the attached PTE Repeat Sentence response audio.',
    'Use the audio as the only source for what the candidate said; ignore any typed transcript notes.',
    'Return strict JSON only.',
    'Required JSON keys: transcript, microResponses, speechMetrics, confidence, warnings.',
    'transcript must contain only the words actually spoken by the candidate.',
    'Do not infer missing words from the expected transcript.',
    'Do not provide final pronunciation or fluency scores; the server will aggregate the micro responses deterministically.',
    'Pronunciation must be grounded in intelligibility, segmental accuracy, stress, and listener effort.',
    'Fluency must be grounded in rhythm, phrasing, hesitations, repetitions, speech rate, and long pauses.',
    buildMicroRubricPrompt('speaking_repeat_sentence'),
    `Treat pauses around ${longPauseSeconds} seconds or longer as long pauses.`,
    `Use ${idealWpmMin}-${idealWpmMax} WPM as rough comfortable rate guidance, not as a sole scoring rule.`,
    recordingDurationSeconds > 0 ? `Browser-recorded duration: ${round2(recordingDurationSeconds)} seconds.` : '',
    'Expected sentence for alignment context only:',
    expectedTranscript,
    transcriptVariants.length ? `Accepted transcript variants for content alignment context: ${transcriptVariants.join(' | ')}` : ''
  ].filter(Boolean).join('\n');
}

async function sendRepeatSentenceAudioAnalysisRequest({
  runtimeProvider = {},
  audio = {},
  systemPrompt = '',
  userPrompt = '',
  session = {},
  item = {},
  useStructuredSchema = true,
  requestLabel = 'pte-repeat-sentence-scoring-v1'
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
      maxOutputTokens: 1600
    },
    responseMimeType: useStructuredSchema ? 'application/json' : undefined,
    responseSchema: useStructuredSchema ? buildRepeatSentenceAnalysisResponseSchema() : undefined,
    disableCache: true,
    requestLabel,
    timeoutMs: 120000,
    usageContext: {
      requestingUser: runtimeProvider.requestingUser || null,
      section: SECTIONS.PTE_SCORING,
      operation: OPERATIONS.AI_SCORING,
      objectId: s(item.id || session.id || 'DRAFT:repeat-sentence', 160),
      requestLabel,
      providerRecordId: s(runtimeProvider?.providerRecord?.id, 160),
      providerRecordName: s(runtimeProvider?.providerRecord?.name, 220),
      source: {
        module: 'pte_attempt_scoring',
        eventType: 'repeat_sentence_audio_analysis'
      }
    }
  });
}

async function sendRepeatSentenceTranscriptRecoveryRequest({
  runtimeProvider = {},
  audio = {},
  session = {},
  item = {},
  requestLabel = 'pte-repeat-sentence-transcript-recovery-v1'
} = {}) {
  const promptText = [
    'Transcribe the attached PTE Repeat Sentence response audio.',
    'Use the audio only. Do not infer missing words from the expected sentence, question, or typed notes.',
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
      objectId: s(item.id || session.id || 'DRAFT:repeat-sentence-transcript', 160),
      requestLabel,
      providerRecordId: s(runtimeProvider?.providerRecord?.id, 160),
      providerRecordName: s(runtimeProvider?.providerRecord?.name, 220),
      source: {
        module: 'pte_attempt_scoring',
        eventType: 'repeat_sentence_audio_transcript_recovery'
      }
    }
  });
}

function buildAnalysisBundleFromProviderResult(result = {}, runtimeProvider = {}, extraWarnings = []) {
  const responseText = s(result?.text || '', 200000);
  const analysis = parseAiRepeatSentenceAnalysis(responseText);
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
  const analysis = parseAiRepeatSentenceTranscriptRecovery(responseText);
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

function mergeRepeatSentenceTranscriptRecoveryBundle(bundle = {}, recoveryBundle = {}) {
  const baseAnalysis = parseAiRepeatSentenceAnalysis(bundle?.analysis || bundle?.aiAnalysis || bundle);
  const recoveryAnalysis = parseAiRepeatSentenceTranscriptRecovery(recoveryBundle?.analysis || recoveryBundle?.aiAnalysis || recoveryBundle);
  const transcript = s(recoveryAnalysis.transcript, 50000);
  if (!transcript) {
    baseAnalysis.warnings = normalizeWarnings([
      ...(Array.isArray(baseAnalysis.warnings) ? baseAnalysis.warnings : []),
      ...(Array.isArray(recoveryAnalysis.warnings) ? recoveryAnalysis.warnings : []),
      'Audio-only Repeat Sentence transcript recovery returned no usable transcript.'
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
    'Recovered Repeat Sentence transcript using an audio-only follow-up request.'
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

async function recoverRepeatSentenceTranscriptIfMissing({
  bundle = {},
  runtimeProvider = {},
  audio = {},
  session = {},
  item = {}
} = {}) {
  const analysis = parseAiRepeatSentenceAnalysis(bundle?.analysis || bundle?.aiAnalysis || bundle);
  if (s(analysis.transcript, 50000)) return bundle;

  try {
    const recoveryResult = await sendRepeatSentenceTranscriptRecoveryRequest({
      runtimeProvider,
      audio,
      session,
      item,
      requestLabel: 'pte-repeat-sentence-transcript-recovery-v1'
    });
    const recoveryBundle = buildTranscriptRecoveryBundleFromProviderResult(recoveryResult, runtimeProvider);
    return mergeRepeatSentenceTranscriptRecoveryBundle(bundle, recoveryBundle);
  } catch (error) {
    const mergedAnalysis = parseAiRepeatSentenceAnalysis(bundle?.analysis || bundle?.aiAnalysis || bundle);
    mergedAnalysis.warnings = normalizeWarnings([
      ...(Array.isArray(mergedAnalysis.warnings) ? mergedAnalysis.warnings : []),
      `Audio-only Repeat Sentence transcript recovery failed: ${s(error?.message || error, 500) || 'unknown error'}.`
    ]);
    return {
      ...bundle,
      analysis: mergedAnalysis
    };
  }
}

async function analyzeRepeatSentenceAudioWithAi({
  session = {},
  item = {},
  audioArtifact = {},
  expectedTranscript = '',
  transcriptVariants = [],
  responsePayload = {},
  scoringConfig = {},
  requestingUser = null
} = {}) {
  const runtimeProvider = await pteAiProviderDataService.resolveRuntimeProvider(requestingUser, {}, {
    purpose: 'pte_scoring',
    questionType: 'speaking_repeat_sentence',
    scorerKey: 'speaking_repeat_sentence'
  });
  runtimeProvider.requestingUser = requestingUser;
  const sourceAudio = await readAudioArtifactForAi(audioArtifact);
  const preparedAudio = await prepareAudioForScoringProvider({
    providerId: runtimeProvider.providerId,
    audio: sourceAudio,
    scorerName: 'Repeat Sentence scoring',
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
      'You are a careful PTE Repeat Sentence audio analysis service.',
      'You do not produce an official Pearson score.',
      'You return evidence-backed JSON for a downstream raw-rubric scorer.',
      'Never score from typed transcript notes; analyze the attached audio.'
    ].join(' ');
    const userPrompt = buildAudioAnalysisPrompt({
      expectedTranscript,
      transcriptVariants,
      recordingDurationSeconds,
      scoringConfig
    });
    const primaryUsesStructuredSchema = !isOpenAiCompatibleProvider(runtimeProvider.providerId);
    const shouldRetryLooseJsonForTranscript = isGeminiFlashRuntimeProvider(runtimeProvider);
    const retryWarning = primaryUsesStructuredSchema
      ? 'AI provider returned an unusable structured Repeat Sentence response; scorer retried with a looser JSON-only request.'
      : 'AI provider returned an unusable Repeat Sentence JSON response; scorer retried with a JSON-only request.';

    let primaryResult = null;
    try {
      primaryResult = await sendRepeatSentenceAudioAnalysisRequest({
        runtimeProvider,
        audio,
        systemPrompt,
        userPrompt,
        session,
        item,
        useStructuredSchema: primaryUsesStructuredSchema,
        requestLabel: 'pte-repeat-sentence-scoring-v1'
      });
    } catch (error) {
      if (!shouldRetryLooseJsonForTranscript) throw error;
      try {
        const retryResult = await sendRepeatSentenceAudioAnalysisRequest({
          runtimeProvider,
          audio,
          systemPrompt,
          userPrompt,
          session,
          item,
          useStructuredSchema: false,
          requestLabel: 'pte-repeat-sentence-scoring-v1-flash-json-retry'
        });
        const retryBundle = buildAnalysisBundleFromProviderResult(retryResult, runtimeProvider, [
          `Gemini Flash structured Repeat Sentence request failed first: ${s(error?.message || error, 500) || 'unknown error'}.`,
          retryWarning
        ]);
        const recoveredBundle = await recoverRepeatSentenceTranscriptIfMissing({
          bundle: retryBundle,
          runtimeProvider,
          audio,
          session,
          item
        });
        return attachAudioPreparationMetadata(recoveredBundle, preparedAudio);
      } catch (retryError) {
        const combined = new Error(
          `Gemini Flash Repeat Sentence analysis failed after structured and fallback attempts. First: ${s(error?.message || error, 500) || 'unknown error'}. Fallback: ${s(retryError?.message || retryError, 500) || 'unknown error'}.`
        );
        combined.code = retryError?.code || error?.code || 'GEMINI_FLASH_REPEAT_SENTENCE_ANALYSIS_FAILED';
        throw combined;
      }
    }

    const primaryBundle = buildAnalysisBundleFromProviderResult(primaryResult, runtimeProvider);
    const primaryAnalysis = parseAiRepeatSentenceAnalysis(primaryBundle?.analysis || {});
    const primaryHasTranscript = Boolean(s(primaryAnalysis.transcript, 50000));
    const primaryHasUsableMicro = hasUsableRepeatSentenceMicroResponses(primaryAnalysis, scoringConfig);
    const shouldRetryLooseJson = shouldRetryLooseJsonForTranscript || (primaryHasTranscript && !primaryHasUsableMicro);
    if (!shouldRetryLooseJson || (primaryHasTranscript && primaryHasUsableMicro)) {
      const recoveredBundle = await recoverRepeatSentenceTranscriptIfMissing({
        bundle: primaryBundle,
        runtimeProvider,
        audio,
        session,
        item
      });
      return attachAudioPreparationMetadata(recoveredBundle, preparedAudio);
    }

    const retryResult = await sendRepeatSentenceAudioAnalysisRequest({
      runtimeProvider,
      audio,
      systemPrompt,
      userPrompt,
      session,
      item,
      useStructuredSchema: false,
      requestLabel: isGeminiFlashRuntimeProvider(runtimeProvider)
        ? 'pte-repeat-sentence-scoring-v1-flash-json-retry'
        : 'pte-repeat-sentence-scoring-v1-json-retry'
    });
    const retryBundle = buildAnalysisBundleFromProviderResult(retryResult, runtimeProvider, [
      ...normalizeWarnings(primaryBundle?.analysis?.warnings || []),
      retryWarning
    ]);
    const recoveredBundle = await recoverRepeatSentenceTranscriptIfMissing({
      bundle: retryBundle,
      runtimeProvider,
      audio,
      session,
      item
    });
    return attachAudioPreparationMetadata(recoveredBundle, preparedAudio);
  } finally {
    await preparedAudio.cleanup();
  }
}

function describeBand(score = 0, trait = '') {
  const value = Number(score || 0);
  if (trait === 'content') {
    if (value >= 3) return 'All prompt words in correct sequence';
    if (value >= 2) return 'At least half of prompt words in correct sequence';
    if (value >= 1) return 'Less than half of prompt words in correct sequence';
    return 'Almost nothing from the prompt detected';
  }
  if (value >= 5) return 'Very strong';
  if (value >= 4) return 'Good';
  if (value >= 3) return 'Developing';
  if (value >= 2) return 'Limited';
  if (value >= 1) return 'Weak';
  return 'No usable evidence';
}

function buildFeedbackDraft({ scoreResult = {}, aiAnalysis = {}, scoringConfig = {}, microEvaluation = null } = {}) {
  const traitScores = safeObject(scoreResult.traitScores, {});
  const alignment = safeObject(scoreResult.evidence?.alignment, {});
  const content = Number(traitScores.content || 0);
  const pronunciation = Number(traitScores.pronunciation || 0);
  const fluency = Number(traitScores.fluency || 0);
  const strengths = [];
  const improvements = [];
  const microFeedback = buildMicroFeedbackRows(microEvaluation || {});

  if (content >= 3) strengths.push('Content recall is strong; the sentence was repeated in the correct sequence.');
  else if (content >= 2) strengths.push('The response recalled at least half of the sentence in sequence.');
  if (pronunciation >= 4) strengths.push('Pronunciation was generally clear and intelligible.');
  if (fluency >= 4) strengths.push('Fluency was mostly steady with manageable pauses.');

  if (content < 3) {
    improvements.push(`Content needs more accurate recall: ${alignment.matchCount || 0} of ${alignment.sourceWordCount || 0} prompt words were matched in sequence.`);
  }
  if (pronunciation < 4) improvements.push('Pronunciation needs improvement: make word endings, stress, and vowel/consonant sounds easier to understand.');
  if (fluency < 4) improvements.push('Fluency needs improvement: repeat the sentence in chunks without long pauses, restarts, or filler sounds.');

  const speechMetrics = safeObject(aiAnalysis?.speechMetrics, {});
  const wpm = Number(speechMetrics.estimatedWpm || 0);
  const idealMin = Number(scoringConfig.idealWpmMin || 90);
  const idealMax = Number(scoringConfig.idealWpmMax || 170);
  if (wpm > 0 && (wpm < idealMin || wpm > idealMax)) {
    improvements.push(`Aim for a steadier natural pace; estimated rate was ${round2(wpm)} WPM.`);
  }
  strengths.push(...microFeedback.strengths.slice(0, 3));
  improvements.push(...microFeedback.improvements.slice(0, 3));

  return {
    summary: `${round2(scoreResult.scoreFinal || 0)} / ${round2(scoreResult.maxScore || 0)} raw rubric points.`,
    strengths: strengths.length ? strengths : ['The response has enough audio evidence for scoring.'],
    improvements: improvements.length ? improvements : ['Keep the same sentence recall and polish pronunciation, pace, and rhythm.'],
    nextPracticeAction: content < 3
      ? 'Practice chunking: listen for 2 or 3 meaning groups, then repeat immediately without adding new words.'
      : 'Practice another Repeat Sentence item and keep the same word order while improving natural rhythm.'
  };
}

function makeScoringMetadata({
  status = '',
  expectedTranscript = '',
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
  const rubric = getRubric('speaking_repeat_sentence') || {};
  const speechMetrics = safeObject(aiAnalysis?.speechMetrics, {});
  const traitMax = safeObject(scoreResult?.evidence?.traitMax, { content: 3, pronunciation: 5, fluency: 5 });
  return {
    status,
    scorerKey: 'speaking_repeat_sentence',
    scorerVersion: REPEAT_SENTENCE_SCORER_VERSION,
    scoringContractVersion: microEvaluation ? MICRO_SCORING_CONTRACT_VERSION : 1,
    scoreScale: 'raw_item_rubric_score',
    officialScoreEstimate: false,
    rubricSource: Array.isArray(rubric.rubricSources) ? rubric.rubricSources : [],
    configuredMethod: s(scoringConfig.method || '', 120) || 'hybrid_ai_audio_repetition',
    provider: safeObject(provider, {}),
    microRubricVersion: microEvaluation?.microRubricVersion || '',
    microResponses: Array.isArray(microEvaluation?.microResponses) ? microEvaluation.microResponses : [],
    aggregationBreakdown: safeObject(microEvaluation?.aggregationBreakdown, {}),
    legacyDirectModelScores: collectLegacyDirectModelScores(aiAnalysis, ['pronunciation', 'fluency']),
    transcript: s(aiAnalysis?.transcript || '', 50000),
    expectedTranscript: s(expectedTranscript, 50000),
    alignment: scoreResult?.evidence?.alignment || {},
    content: {
      score: scoreResult?.traitScores?.content ?? 0,
      maxScore: traitMax.content ?? 3,
      descriptor: describeBand(scoreResult?.traitScores?.content ?? 0, 'content')
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
    confidence: normalizeConfidence(aiAnalysis?.confidence),
    warnings: normalizeWarnings([
      ...(Array.isArray(aiAnalysis?.warnings) ? aiAnalysis.warnings : []),
      ...(Array.isArray(microEvaluation?.warnings) ? microEvaluation.warnings : []),
      ...warnings
    ]),
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
    'Repeat Sentence audio analysis returned no usable transcript.',
    providerLabel
      ? `Provider response did not include a usable transcript field (${providerLabel}).`
      : 'Provider response did not include a usable transcript field.',
    ...(Array.isArray(aiAnalysis?.warnings) ? aiAnalysis.warnings : [])
  ]);
}

async function scoreRepeatSentenceAttemptItem(args = {}, options = {}) {
  const {
    session = {},
    item = {},
    question = {},
    artifacts = [],
    responsePayload = {},
    scoringConfig = {},
    requestingUser = null
  } = args;
  const expectedTranscript = resolveExpectedTranscript(question, item);
  const baseContext = { expectedTranscript, responsePayload, scoringConfig };
  if (!expectedTranscript) {
    return needsEvidenceResult([
      'Repeat Sentence scoring requires the expected transcript for the prompt audio.',
      'Content cannot be evaluated from the applicant audio alone.'
    ], baseContext);
  }

  const audioArtifact = selectAudioArtifact({ item, artifacts, responsePayload });
  if (!audioArtifact) {
    return needsEvidenceResult([
      'Repeat Sentence scoring requires an uploaded audio response.',
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
        expectedTranscript,
        responsePayload,
        scoringConfig,
        requestingUser
      });
    } else if (Object.prototype.hasOwnProperty.call(options, 'aiAnalysis')) {
      analysisBundle = {
        analysis: parseAiRepeatSentenceAnalysis(options.aiAnalysis),
        provider: safeObject(options.provider, { providerId: 'test', modelUsed: 'injected' })
      };
    } else {
      const payload = resolveQuestionPayload(question, item);
      analysisBundle = await analyzeRepeatSentenceAudioWithAi({
        session,
        item,
        audioArtifact,
        expectedTranscript,
        transcriptVariants: normalizeTextArray(payload.transcriptVariants || [], 10),
        responsePayload,
        scoringConfig,
        requestingUser
      });
    }
  } catch (error) {
    return failedResult([
      `Repeat Sentence audio analysis failed: ${s(error?.message || error, 800) || 'unknown error'}.`
    ], {
      ...baseContext,
      audioArtifact
    });
  }

  const aiAnalysis = parseAiRepeatSentenceAnalysis(
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
  const pronunciationMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.pronunciationMax, 5) || 5));
  const fluencyMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.fluencyMax ?? scoringConfig.oralFluencyMax, 5) || 5));
  const microEvaluation = isLegacyDirectScoring(scoringConfig)
    ? null
    : evaluateSpeakingMicroRubric({
      questionType: 'speaking_repeat_sentence',
      aiAnalysis,
      traitMax: { pronunciation: pronunciationMax, fluency: fluencyMax }
    });
  const deterministicMicroEvaluation = microEvaluation
    && !microEvaluation.ok
    && !microEvaluation.invalidResponses?.length
    ? buildRepeatSentenceDeterministicMicroEvaluation({
      aiAnalysis,
      scoringConfig,
      reason: 'Generated Repeat Sentence micro-rubric responses deterministically after the AI provider omitted required micro answers.'
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

  const scoreResult = calculateRepeatSentenceScore({
    expectedTranscript,
    transcript: aiAnalysis.transcript,
    aiAnalysis,
    scoringConfig,
    microTraitScores: finalMicroEvaluation?.traitScores
  });
  const feedbackDraft = buildFeedbackDraft({ scoreResult, aiAnalysis, scoringConfig, microEvaluation: finalMicroEvaluation });
  const metadata = makeScoringMetadata({
    status: 'scored',
    expectedTranscript,
    aiAnalysis,
    scoreResult,
    provider,
    audioArtifact,
    responsePayload,
    scoringConfig,
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
  tokenizeForRepeatSentence,
  alignRepeatSentenceTokens,
  calculateRepeatSentenceContentScore,
  calculateRepeatSentenceScore,
  parseAiRepeatSentenceAnalysis,
  selectAudioArtifact,
  resolveExpectedTranscript,
  scoreRepeatSentenceAttemptItem,
  analyzeRepeatSentenceAudioWithAi
};
