const path = require('path');
const pteAiProviderDataService = require('./pteAiProviderDataService');
const pteAiProviderService = require('./ai/aiProviderService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');
const {
  RESPOND_SITUATION_SCORER_VERSION,
  getRubric
} = require('./pteScoringRubricRegistry');
const {
  buildOpenAiAudioModelCompatibilityError,
  isOpenAiAudioChatModel,
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
const TRAIT_SCORE_VALUE_KEYS = Object.freeze([
  'score',
  'band',
  'bandScore',
  'band_score',
  'rawScore',
  'raw_score',
  'raw',
  'value',
  'points',
  'pointScore',
  'point_score',
  'mark',
  'marks',
  'rating',
  'grade',
  'level',
  'numericScore',
  'numeric_score',
  'result'
]);

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

function parseScoreNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const token = s(value, 120).toLowerCase();
  if (!token) return null;
  const wordScores = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5
  };
  if (Object.prototype.hasOwnProperty.call(wordScores, token)) return wordScores[token];
  const wordMatch = token.match(/\b(zero|one|two|three|four|five)\b/);
  if (wordMatch && Object.prototype.hasOwnProperty.call(wordScores, wordMatch[1])) return wordScores[wordMatch[1]];
  const match = token.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const numeric = Number(match[0]);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeTraitScore(value, maxScore = 5, fallback = 0) {
  const max = Math.max(0, toFiniteNumber(maxScore, 5) || 5);
  const numeric = parseScoreNumber(value);
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

function isTechnicalScoringWarning(row = '') {
  const text = s(row, 700).toLowerCase();
  if (!text) return true;
  return (
    text.includes('did not return valid json')
    || text.includes('returned malformed json')
    || text.includes('transcript recovery returned malformed json')
    || text.includes('audio-only transcript recovery')
    || text.includes('recovered transcript using an audio-only follow-up request')
    || text.includes('generated respond to a situation micro-rubric responses deterministically')
    || text.includes('recovered respond to a situation micro-rubric responses')
    || text.includes('micro-rubric recovery follow-up')
    || text.includes('rubric recovery follow-up did not return usable')
    || text.includes('provider response did not include')
    || text.includes('structured respond to a situation request failed first')
    || text.includes('json-only respond to a situation request failed first')
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

function escapeRegex(value = '') {
  return s(value, 200).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function extractLabeledText(raw = '', labels = [], stopLabels = []) {
  const labelPattern = labels.map(escapeRegex).join('|');
  const stopPattern = stopLabels.map(escapeRegex).join('|');
  if (!labelPattern) return '';
  const pattern = stopPattern
    ? new RegExp(`(?:^|\\n)\\s*(?:${labelPattern})\\s*[:\\-]\\s*([\\s\\S]*?)(?=\\n\\s*(?:${stopPattern})\\s*[:\\-]|$)`, 'i')
    : new RegExp(`(?:^|\\n)\\s*(?:${labelPattern})\\s*[:\\-]\\s*([\\s\\S]*)$`, 'i');
  const match = s(raw, 200000).match(pattern);
  if (!match?.[1]) return '';
  return s(match[1].replace(/^["']|["']$/g, ''), 50000);
}

function extractLabeledScore(raw = '', labels = [], maxScore = 5) {
  const allLabels = [
    'transcript',
    'spoken transcript',
    'response transcript',
    'appropriacy',
    'pronunciation',
    'fluency',
    'oral fluency',
    'speech metrics',
    'confidence',
    'warnings',
    'notes'
  ];
  const block = extractLabeledText(raw, labels, allLabels);
  if (!block) return null;
  const max = Math.max(0, Number(maxScore || 5));
  const scoreMatch = block.match(/(?:score|band)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)(?:\s*\/\s*\d+)?/i);
  if (!scoreMatch) return null;
  const numeric = Number(scoreMatch[1]);
  if (!Number.isFinite(numeric)) return null;
  return Math.min(max, Math.max(0, Math.round(numeric)));
}

function classifyRespondSituationTraitKey(value = '') {
  const token = s(value, 300)
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!token) return '';
  if (
    token.includes('pronunciation')
    || token.includes('pronounce')
    || token.includes('intelligibility')
    || token.includes('intelligible')
    || token === 'clarity'
    || token.includes('speech clarity')
  ) return 'pronunciation';
  if (
    token.includes('oral fluency')
    || token.includes('fluency')
    || token.includes('rhythm')
    || token.includes('phrasing')
    || token.includes('pace')
  ) return 'fluency';
  if (
    token.includes('appropriacy')
    || token.includes('appropriate')
    || token.includes('appropriateness')
    || token.includes('situational')
    || token.includes('situation')
    || token.includes('relevance')
    || token.includes('relevant')
    || token.includes('task fulfillment')
    || token.includes('task fulfilment')
    || token.includes('task achievement')
    || token.includes('task completion')
    || token.includes('function fulfillment')
    || token.includes('function fulfilment')
    || token.includes('register')
    || token.includes('politeness')
    || token.includes('communicative')
    || token.includes('content')
  ) return 'appropriacy';
  return '';
}

function extractScoreValueFromTraitRow(row = {}) {
  if (!isPlainObject(row)) return row;
  return pickFirstDefined(TRAIT_SCORE_VALUE_KEYS.map((key) => row[key])) ?? row;
}

function collectTraitValuesFromContainer(container = null, targetTrait = '', depth = 0) {
  if (!targetTrait || depth > 4 || container === undefined || container === null) return [];
  const out = [];
  if (Array.isArray(container)) {
    container.forEach((row) => {
      out.push(...collectTraitValuesFromContainer(row, targetTrait, depth + 1));
    });
    return out;
  }
  if (!isPlainObject(container)) return out;

  const ownTraitLabel = firstNonEmptyText([
    container.trait,
    container.criterion,
    container.criteria,
    container.category,
    container.name,
    container.label,
    container.dimension,
    container.metric,
    container.key,
    container.type
  ], 300);
  if (classifyRespondSituationTraitKey(ownTraitLabel) === targetTrait) {
    out.push(extractScoreValueFromTraitRow(container));
  }

  Object.entries(container).forEach(([key, value]) => {
    if (key === 'warnings' || key === 'warning' || key === 'transcript' || key === 'speechMetrics' || key === 'metrics') return;
    const keyTrait = classifyRespondSituationTraitKey(key);
    if (keyTrait === targetTrait) {
      out.push(extractScoreValueFromTraitRow(value));
      return;
    }
    if (Array.isArray(value) || isPlainObject(value)) {
      out.push(...collectTraitValuesFromContainer(value, targetTrait, depth + 1));
    }
  });

  return out;
}

function extractScoreFromFuzzyLabeledLine(line = '', labels = [], maxScore = 5) {
  const text = s(line, 1000);
  if (!text) return null;
  const labelPattern = labels.map(escapeRegex).join('|');
  if (!labelPattern) return null;
  const labelRegex = new RegExp(`\\b(?:${labelPattern})\\b`, 'i');
  const labelMatch = text.match(labelRegex);
  if (!labelMatch) return null;
  const candidates = [];
  const afterLabel = text
    .slice(labelMatch.index + labelMatch[0].length)
    .replace(/\(\s*\d+\s*[-/]\s*\d+\s*\)/g, ' ')
    .replace(/\b(?:out\s+of|max(?:imum)?|from)\s+\d+\b/ig, ' ');
  if (afterLabel) candidates.push(afterLabel);
  const delimiterMatch = text.match(/[:=]\s*(.+)$/);
  if (delimiterMatch?.[1]) candidates.push(delimiterMatch[1]);

  const pipeCells = text
    .split('|')
    .map((cell) => s(cell, 500))
    .filter(Boolean);
  const labelCellIndex = pipeCells.findIndex((cell) => labelRegex.test(cell));
  if (labelCellIndex >= 0) {
    candidates.push(...pipeCells.slice(labelCellIndex + 1));
  }

  candidates.push(text.replace(labelRegex, '').replace(/\(\s*\d+\s*[-/]\s*\d+\s*\)/g, ' '));
  for (const candidate of candidates) {
    const numeric = parseScoreNumber(candidate);
    if (Number.isFinite(numeric)) {
      const max = Math.max(0, Number(maxScore || 5));
      return Math.min(max, Math.max(0, Math.round(numeric)));
    }
  }
  return null;
}

function extractFuzzyLabeledScore(raw = '', labels = [], maxScore = 5) {
  const lines = s(raw, 200000)
    .split(/\r?\n/)
    .map((line) => s(line, 2000))
    .filter(Boolean);
  for (const line of lines) {
    const score = extractScoreFromFuzzyLabeledLine(line, labels, maxScore);
    if (score !== null) return score;
  }
  return null;
}

function parsePlainTextRespondSituationAnalysis(raw = '') {
  const text = s(raw, 200000);
  if (!text) return null;
  const stopLabels = [
    'appropriacy',
    'pronunciation',
    'fluency',
    'oral fluency',
    'speech metrics',
    'confidence',
    'warnings',
    'notes'
  ];
  const transcript = extractLabeledText(text, ['transcript', 'spoken transcript', 'response transcript'], stopLabels);
  const appropriacyScore = extractLabeledScore(text, ['appropriacy'], 3)
    ?? extractFuzzyLabeledScore(text, ['appropriacy', 'appropriateness', 'situational appropriacy', 'task fulfillment', 'task fulfilment', 'relevance', 'content'], 3);
  const pronunciationScore = extractLabeledScore(text, ['pronunciation'], 5)
    ?? extractFuzzyLabeledScore(text, ['pronunciation', 'intelligibility', 'clarity'], 5);
  const fluencyScore = extractLabeledScore(text, ['fluency', 'oral fluency'], 5)
    ?? extractFuzzyLabeledScore(text, ['oral fluency', 'fluency', 'rhythm', 'pace'], 5);
  if (!transcript && (appropriacyScore === null || pronunciationScore === null || fluencyScore === null)) return null;

  const confidenceBlock = extractLabeledText(text, ['confidence'], ['warnings', 'notes']);
  const confidenceMatch = confidenceBlock.match(/\d+(?:\.\d+)?/);
  return {
    transcript,
    appropriacy: {
      score: appropriacyScore,
      notes: extractLabeledText(text, ['appropriacy'], ['pronunciation', 'fluency', 'oral fluency', 'speech metrics', 'confidence', 'warnings', 'notes'])
    },
    pronunciation: {
      score: pronunciationScore,
      notes: extractLabeledText(text, ['pronunciation'], ['appropriacy', 'fluency', 'oral fluency', 'speech metrics', 'confidence', 'warnings', 'notes'])
    },
    fluency: {
      score: fluencyScore,
      notes: extractLabeledText(text, ['fluency', 'oral fluency'], ['appropriacy', 'pronunciation', 'speech metrics', 'confidence', 'warnings', 'notes'])
    },
    confidence: confidenceMatch ? Number(confidenceMatch[0]) : 0,
    rubricScoresUsable: appropriacyScore !== null && pronunciationScore !== null && fluencyScore !== null,
    warnings: ['AI Respond to a Situation analysis returned plain text instead of JSON; recovered labelled scoring fields.']
  };
}

function normalizeTraitAnalysis(value = {}, maxScore = 5, fallbackScore = 0) {
  const row = isPlainObject(value) ? value : { score: value };
  const scoreValue = pickFirstDefined(TRAIT_SCORE_VALUE_KEYS.map((key) => row[key]));
  return {
    score: normalizeTraitScore(scoreValue, maxScore, fallbackScore),
    evidence: normalizeTextArray(row.evidence || row.examples || row.supportingEvidence || [], 8),
    notes: firstNonEmptyText([row.notes, row.rationale, row.reason, row.descriptor], 1500),
    coveredKeyPoints: normalizeTextArray(row.coveredKeyPoints || row.coveredRequirements || row.metRequirements || [], 8),
    missingKeyPoints: normalizeTextArray(row.missingKeyPoints || row.missingRequirements || row.unmetRequirements || [], 8)
  };
}

function pickFirstDefined(values = []) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    return value;
  }
  return undefined;
}

function pickFirstTraitScoreValue(values = []) {
  for (const value of values) {
    if (hasNumericTraitScore(value)) return value;
  }
  return pickFirstDefined(values);
}

function hasNumericTraitScore(value) {
  if (value === undefined || value === null) return false;
  if (isPlainObject(value)) {
    return TRAIT_SCORE_VALUE_KEYS.some((key) => {
      const numeric = parseScoreNumber(value[key]);
      return Number.isFinite(numeric);
    });
  }
  const numeric = parseScoreNumber(value);
  return Number.isFinite(numeric);
}

function collectScoreContainers(parsed = {}) {
  return [
    parsed,
    parsed.scores,
    parsed.traitScores,
    parsed.trait_scores,
    parsed.rubricScores,
    parsed.rubric_scores,
    parsed.criteriaScores,
    parsed.criteria_scores,
    parsed.criterionScores,
    parsed.criterion_scores,
    parsed.criteria,
    parsed.criterion,
    parsed.traits,
    parsed.trait,
    parsed.dimensions,
    parsed.dimensionScores,
    parsed.dimension_scores,
    parsed.bands,
    parsed.bandScores,
    parsed.band_scores,
    parsed.rubric,
    parsed.rubricAssessment,
    parsed.rubric_assessment,
    parsed.assessment,
    parsed.analysis,
    parsed.evaluation,
    parsed.evaluations,
    parsed.scoring,
    parsed.scoringResult,
    parsed.scoring_result,
    parsed.score,
    parsed.result,
    parsed.results
  ].filter((row) => isPlainObject(row) || Array.isArray(row));
}

function valuesFromScoreContainers(containers = [], keys = []) {
  const out = [];
  containers.forEach((container) => {
    keys.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(container, key)) out.push(container[key]);
    });
  });
  return out;
}

function parseAiRespondSituationAnalysis(input = {}) {
  const rawText = typeof input === 'string' ? input : '';
  const parsedValue = typeof input === 'string'
    ? extractJsonObject(input)
    : (Array.isArray(input) ? input : (isPlainObject(input) ? input : null));
  const parsed = Array.isArray(parsedValue) ? { scores: parsedValue } : parsedValue;
  if (!isPlainObject(parsed)) {
    const plainTextAnalysis = parsePlainTextRespondSituationAnalysis(rawText);
    if (plainTextAnalysis) return parseAiRespondSituationAnalysis(plainTextAnalysis);
    return {
      transcript: '',
      appropriacy: normalizeTraitAnalysis({}, 3),
      pronunciation: normalizeTraitAnalysis({}, 5),
      fluency: normalizeTraitAnalysis({}, 5),
      speechMetrics: {},
      microResponses: [],
      confidence: 0,
      rubricScoresUsable: false,
      warnings: ['AI Respond to a Situation analysis did not return valid JSON.']
    };
  }

  const metricsRaw = safeObject(parsed.speechMetrics || parsed.metrics || parsed.timingMeta, {});
  const scoreContainers = collectScoreContainers(parsed);
  const appropriacyCandidates = [
    parsed.appropriacy,
    parsed.appropriateness,
    parsed.situationAppropriacy,
    parsed.situationalAppropriacy,
    parsed.responseAppropriacy,
    parsed.communicativeAppropriacy,
    parsed.contentAppropriacy,
    parsed.relevance,
    parsed.situationalRelevance,
    parsed.taskFulfillment,
    parsed.taskFulfilment,
    parsed.content,
    parsed.contentScore,
    parsed.appropriacyScore,
    parsed.appropriacy_score,
    parsed.appropriacyBand,
    parsed.appropriacy_band,
    ...valuesFromScoreContainers(scoreContainers, [
      'appropriacy',
      'appropriateness',
      'situationAppropriacy',
      'situationalAppropriacy',
      'responseAppropriacy',
      'communicativeAppropriacy',
      'contentAppropriacy',
      'relevance',
      'situationalRelevance',
      'taskFulfillment',
      'taskFulfilment',
      'content',
      'contentScore',
      'appropriacyScore',
      'appropriacy_score',
      'appropriacyBand',
      'appropriacy_band'
    ]),
    ...collectTraitValuesFromContainer(scoreContainers, 'appropriacy')
  ];
  const pronunciationCandidates = [
    parsed.pronunciation,
    parsed.clarity,
    parsed.intelligibility,
    parsed.pronunciationScore,
    parsed.pronunciation_score,
    parsed.pronunciationBand,
    parsed.pronunciation_band,
    ...valuesFromScoreContainers(scoreContainers, [
      'pronunciation',
      'clarity',
      'intelligibility',
      'pronunciationScore',
      'pronunciation_score',
      'pronunciationBand',
      'pronunciation_band'
    ]),
    ...collectTraitValuesFromContainer(scoreContainers, 'pronunciation')
  ];
  const fluencyCandidates = [
    parsed.fluency,
    parsed.oralFluency,
    parsed.oral_fluency,
    parsed.fluencyScore,
    parsed.fluency_score,
    parsed.fluencyBand,
    parsed.fluency_band,
    ...valuesFromScoreContainers(scoreContainers, [
      'fluency',
      'oralFluency',
      'oral_fluency',
      'oralFluencyScore',
      'oral_fluency_score',
      'fluencyScore',
      'fluency_score',
      'fluencyBand',
      'fluency_band'
    ]),
    ...collectTraitValuesFromContainer(scoreContainers, 'fluency')
  ];
  const appropriacyRaw = pickFirstTraitScoreValue(appropriacyCandidates) ?? 0;
  const pronunciationRaw = pickFirstTraitScoreValue(pronunciationCandidates) ?? 0;
  const fluencyRaw = pickFirstTraitScoreValue(fluencyCandidates) ?? 0;
  const rubricScoresUsable = parsed.rubricScoresUsable === true
    ? true
    : (parsed.rubricScoresUsable === false
      ? false
      : (
        appropriacyCandidates.some(hasNumericTraitScore)
        && pronunciationCandidates.some(hasNumericTraitScore)
        && fluencyCandidates.some(hasNumericTraitScore)
      ));
  return {
    transcript: resolveTranscriptFromParsedAnalysis(parsed),
    appropriacy: normalizeTraitAnalysis(appropriacyRaw, 3),
    pronunciation: normalizeTraitAnalysis(pronunciationRaw, 5),
    fluency: normalizeTraitAnalysis(fluencyRaw, 5),
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
      wordCount: Math.max(0, Math.floor(toFiniteNumber(metricsRaw.wordCount ?? parsed.wordCount, 0))),
      rhythmNotes: s(metricsRaw.rhythmNotes || parsed.rhythmNotes || '', 1500)
    },
    intelligibilityNotes: s(parsed.intelligibilityNotes || parsed.intelligibility || '', 1500),
    situationalNotes: s(parsed.situationalNotes || parsed.appropriacyNotes || parsed.contentNotes || '', 1500),
    registerFit: s(parsed.registerFit || parsed.register || '', 500),
    politenessFit: s(parsed.politenessFit || parsed.politeness || '', 500),
    microResponses: normalizeMicroResponseRows(parsed),
    confidence: normalizeConfidence(parsed.confidence ?? metricsRaw.confidence),
    rubricScoresUsable,
    warnings: normalizeWarnings(parsed.warnings || parsed.warning || [])
  };
}

function parseAiRespondSituationTranscriptRecovery(input = {}) {
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

function calculateRespondSituationScore({ aiAnalysis = {}, scoringConfig = {}, microTraitScores = null } = {}) {
  const appropriacyMax = Math.min(3, Math.max(0, toFiniteNumber(scoringConfig.appropriacyMax, 3) || 3));
  const pronunciationMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.pronunciationMax, 5) || 5));
  const fluencyMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.fluencyMax ?? scoringConfig.oralFluencyMax, 5) || 5));
  const appropriacy = microTraitScores && Number.isFinite(Number(microTraitScores.appropriacy))
    ? normalizeTraitScore(microTraitScores.appropriacy, appropriacyMax, 0)
    : normalizeTraitScore(aiAnalysis?.appropriacy?.score, appropriacyMax, 0);
  const pronunciation = microTraitScores && Number.isFinite(Number(microTraitScores.pronunciation))
    ? normalizeTraitScore(microTraitScores.pronunciation, pronunciationMax, 0)
    : normalizeTraitScore(aiAnalysis?.pronunciation?.score, pronunciationMax, 0);
  const fluency = microTraitScores && Number.isFinite(Number(microTraitScores.fluency))
    ? normalizeTraitScore(microTraitScores.fluency, fluencyMax, 0)
    : normalizeTraitScore(aiAnalysis?.fluency?.score, fluencyMax, 0);
  const maxScore = appropriacyMax + pronunciationMax + fluencyMax;
  const scoreFinal = appropriacy + pronunciation + fluency;
  return {
    scoreRaw: scoreFinal,
    scoreFinal,
    maxScore,
    percentage: maxScore > 0 ? round2((scoreFinal / maxScore) * 100) : 0,
    traitScores: { appropriacy, pronunciation, fluency },
    evidence: {
      traitMax: {
        appropriacy: appropriacyMax,
        pronunciation: pronunciationMax,
        fluency: fluencyMax
      }
    }
  };
}

function transcriptWordCount(text = '') {
  const tokens = s(text, 50000)
    .toLowerCase()
    .match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu);
  return Array.isArray(tokens) ? tokens.length : 0;
}

function tokenizeComparableText(text = '') {
  const stopWords = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has', 'have', 'i', 'in', 'is', 'it', 'me',
    'my', 'of', 'on', 'or', 'our', 'the', 'their', 'this', 'to', 'we', 'with', 'you', 'your'
  ]);
  return (s(text, 50000).toLowerCase().match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) || [])
    .map((token) => token.replace(/^['-]+|['-]+$/g, ''))
    .filter((token) => token && token.length > 2 && !stopWords.has(token));
}

function countTokenOverlap(sourceText = '', responseText = '') {
  const responseTokens = new Set(tokenizeComparableText(responseText));
  if (!responseTokens.size) return 0;
  const sourceTokens = Array.from(new Set(tokenizeComparableText(sourceText)));
  return sourceTokens.reduce((count, token) => count + (responseTokens.has(token) ? 1 : 0), 0);
}

function textContainsAny(text = '', patterns = []) {
  const token = s(text, 50000).toLowerCase();
  return patterns.some((pattern) => {
    if (pattern instanceof RegExp) return pattern.test(token);
    return token.includes(String(pattern || '').toLowerCase());
  });
}

function transcriptLooksIncompleteOrTruncated(text = '', options = {}) {
  const allowLongRefusalFragment = options?.allowLongRefusalFragment === true;
  const normalized = s(text, 50000)
    .replace(/\s+/g, ' ')
    .trim();
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
    'hopefully',
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
  if (/(?:\band\s+i['’]?m|\band\s+i|\bbecause\s+i|\bbut\s+i['’]?m)\s*$/i.test(normalized)) {
    return true;
  }
  if (/(?:\band\s+hopefully|\bhopefully|\bi\s+hope|\bwe\s+can|\bwe\s+could|\bwe\s+will|\bin\s+the\s+near\s+future|\bnear\s+future)\s*$/i.test(normalized)) {
    return true;
  }
  if (!canScoreTrailingRefusalFragment && /(?:\bi\s+cannot|\bi\s+can\s+not|\bi\s+can't|\bi\s+am\s+unable\s+to|\bi\s+will\s+not|\bi\s+won't)\s*$/i.test(normalized)) {
    return true;
  }
  return false;
}

function transcriptTooIncompleteToScore(text = '') {
  return transcriptLooksIncompleteOrTruncated(text, { allowLongRefusalFragment: true });
}

function buildRespondSituationDeterministicMicroEvaluation({
  aiAnalysis = {},
  situationContext = {},
  scoringConfig = {},
  existingMicroResponses = [],
  reason = ''
} = {}) {
  if (isLegacyDirectScoring(scoringConfig)) return null;
  const transcript = s(aiAnalysis?.transcript || '', 50000);
  if (!transcript || transcriptTooIncompleteToScore(transcript)) return null;

  const transcriptLower = transcript.toLowerCase();
  const keyPoints = normalizeTextArray(situationContext.expectedKeyPoints || [], 12);
  const contextText = [
    situationContext.situationText,
    situationContext.targetFunction,
    situationContext.targetRegister,
    situationContext.contextNotes,
    keyPoints.join(' ')
  ].map((row) => s(row, 5000)).filter(Boolean).join(' ');
  const contextOverlap = countTokenOverlap(contextText, transcript);
  const matchedKeyPoints = keyPoints.filter((keyPoint) => countTokenOverlap(keyPoint, transcript) >= 1);
  const transcriptWords = transcriptWordCount(transcript);
  const speechMetrics = safeObject(aiAnalysis?.speechMetrics, {});
  const idealMin = toFiniteNumber(scoringConfig.idealWpmMin, 85);
  const idealMax = toFiniteNumber(scoringConfig.idealWpmMax, 155);
  const wpm = toFiniteNumber(speechMetrics.estimatedWpm ?? speechMetrics.wpm, 0);
  const longPauses = Math.max(0, Math.floor(toFiniteNumber(speechMetrics.longPauseCount, 0)));
  const hesitations = Math.max(0, Math.floor(toFiniteNumber(speechMetrics.hesitationCount, 0)));
  const repetitions = Math.max(0, Math.floor(toFiniteNumber(speechMetrics.repetitionCount, 0)));

  const targetFunction = s(situationContext.targetFunction || '', 500).toLowerCase();
  const expectsDecline = /declin|reject|cannot|can't|unable|refus|turn down|not attend|not come|not make/.test(targetFunction);
  const expectsApology = /apolog|sorry/.test(targetFunction);
  const expectsRequest = /request|ask|invite|invit|suggest/.test(targetFunction);
  const declineMet = textContainsAny(transcriptLower, [
    /cannot|can't|can not|unable|not able|won't|will not|could not|couldn't/,
    'reject',
    'decline',
    'not make',
    'not come',
    'not attend'
  ]);
  const apologyMet = textContainsAny(transcriptLower, ['sorry', 'apologize', 'apologise']);
  const requestMet = textContainsAny(transcriptLower, ['please', 'could you', 'can you', 'would you', 'may i']);
  const thanksMet = textContainsAny(transcriptLower, ['thank', 'thanks', 'appreciate']);
  const politeMet = apologyMet || thanksMet || textContainsAny(transcriptLower, ['please', 'excuse me']);

  let functionChoice = 'partial';
  if (expectsDecline) functionChoice = declineMet ? 'yes' : 'no';
  else if (expectsApology) functionChoice = apologyMet ? 'yes' : 'partial';
  else if (expectsRequest) functionChoice = requestMet ? 'yes' : 'partial';
  else if (countTokenOverlap(targetFunction, transcript) >= 2) functionChoice = 'yes';
  else if (contextOverlap >= 2) functionChoice = 'partial';
  else functionChoice = 'unclear';

  const situationChoice = contextOverlap >= 4 || (expectsDecline && declineMet) ? 'yes' : (contextOverlap >= 2 ? 'partial' : 'unclear');
  const registerToken = s(situationContext.targetRegister || '', 120).toLowerCase();
  let registerChoice = 'partial';
  if (!registerToken) registerChoice = 'partial';
  else if (registerToken.includes('informal')) registerChoice = /dear sir|madam|to whom it may concern/i.test(transcript) ? 'partial' : 'yes';
  else if (registerToken.includes('formal')) registerChoice = politeMet ? 'partial' : 'unclear';
  else registerChoice = contextOverlap >= 2 ? 'partial' : 'unclear';
  const politenessChoice = politeMet ? 'yes' : (functionChoice === 'yes' ? 'partial' : 'unclear');
  let keyPointsChoice = 'partial';
  if (keyPoints.length) {
    if (matchedKeyPoints.length >= Math.min(2, keyPoints.length)) keyPointsChoice = 'yes';
    else if (matchedKeyPoints.length >= 1 || (expectsDecline && declineMet)) keyPointsChoice = 'partial';
    else keyPointsChoice = 'no';
  } else if (contextOverlap >= 4) keyPointsChoice = 'partial';
  else keyPointsChoice = 'unclear';

  const pronunciationChoice = transcriptWords >= 5 ? 'developing' : 'limited';
  let fluencyChoice = 'developing';
  if (transcriptWords < 5) fluencyChoice = 'limited';
  else if (wpm >= idealMin && wpm <= idealMax && longPauses <= 1 && hesitations <= 2 && repetitions <= 2) fluencyChoice = 'good';
  else if ((wpm > 0 && (wpm < 50 || wpm > 215)) || longPauses >= 4 || hesitations >= 6) fluencyChoice = 'limited';

  const deterministicRows = [
    {
      id: 'appropriacy_situation',
      choice: situationChoice,
      evidence: contextOverlap
        ? `Recovered transcript overlaps with the situation context in ${contextOverlap} key term(s).`
        : 'Recovered transcript has limited direct wording overlap with the situation context.',
      confidence: 0.55
    },
    {
      id: 'appropriacy_function',
      choice: functionChoice,
      evidence: expectsDecline
        ? (declineMet ? 'Recovered transcript contains a clear refusal/decline signal.' : 'Recovered transcript does not clearly decline the invitation/request.')
        : 'Target function was inferred conservatively from transcript/context overlap.',
      confidence: 0.55
    },
    {
      id: 'appropriacy_register',
      choice: registerChoice,
      evidence: registerToken
        ? `Target register is ${registerToken}; recovered transcript was checked conservatively for tone fit.`
        : 'No explicit target register was available, so register fit was capped conservatively.',
      confidence: 0.5
    },
    {
      id: 'appropriacy_politeness',
      choice: politenessChoice,
      evidence: politeMet
        ? 'Recovered transcript includes politeness markers such as apology, thanks, or request language.'
        : 'Recovered transcript has limited explicit politeness markers.',
      confidence: 0.55
    },
    {
      id: 'appropriacy_key_points',
      choice: keyPointsChoice,
      evidence: keyPoints.length
        ? `${matchedKeyPoints.length} of ${keyPoints.length} expected key point(s) matched by text overlap.`
        : 'No configured key points were available; key-point coverage was inferred from situation overlap only.',
      confidence: 0.5
    },
    {
      id: 'pronunciation_quality',
      choice: pronunciationChoice,
      evidence: 'Detailed pronunciation micro evidence was limited, so pronunciation was capped conservatively from the recovered audio transcript.',
      confidence: 0.45
    },
    {
      id: 'fluency_quality',
      choice: fluencyChoice,
      evidence: wpm > 0
        ? `Fluency was scored conservatively from available timing evidence: ${round2(wpm)} WPM, ${longPauses} long pause(s), ${hesitations} hesitation(s), ${repetitions} repetition(s).`
        : 'Detailed fluency micro evidence was limited, so fluency was capped conservatively from the recovered transcript length.',
      confidence: 0.45
    }
  ];
  const existingById = new Map(
    (Array.isArray(existingMicroResponses) ? existingMicroResponses : [])
      .filter((row) => isPlainObject(row) && s(row.id, 120))
      .map((row) => [s(row.id, 120), row])
  );
  const microResponses = deterministicRows.map((row) => existingById.get(row.id) || row);
  const appropriacyMax = Math.min(3, Math.max(0, toFiniteNumber(scoringConfig.appropriacyMax, 3) || 3));
  const pronunciationMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.pronunciationMax, 5) || 5));
  const fluencyMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.fluencyMax ?? scoringConfig.oralFluencyMax, 5) || 5));
  const evaluation = evaluateSpeakingMicroRubric({
    questionType: 'speaking_respond_to_situation',
    aiAnalysis: { microResponses },
    traitMax: { appropriacy: appropriacyMax, pronunciation: pronunciationMax, fluency: fluencyMax }
  });
  if (!evaluation.ok) return null;
  return {
    ...evaluation,
    warnings: normalizeWarnings([
      ...(Array.isArray(evaluation.warnings) ? evaluation.warnings : []),
      reason || 'Generated Respond to a Situation micro-rubric responses deterministically from the recovered transcript because the AI provider omitted required micro answers.'
    ])
  };
}

function hasLegacyDirectRespondSituationScores(aiAnalysis = {}) {
  const scores = collectLegacyDirectModelScores(aiAnalysis, ['appropriacy', 'pronunciation', 'fluency']);
  return ['appropriacy', 'pronunciation', 'fluency'].every((trait) => Number.isFinite(Number(scores[trait])));
}

function hasUsableRespondSituationRubricScores(aiAnalysis = {}, scoringConfig = {}) {
  if (isLegacyDirectScoring(scoringConfig)) {
    return aiAnalysis?.rubricScoresUsable === true || hasLegacyDirectRespondSituationScores(aiAnalysis);
  }
  const microEvaluation = evaluateSpeakingMicroRubric({
    questionType: 'speaking_respond_to_situation',
    aiAnalysis,
    traitMax: { appropriacy: 3, pronunciation: 5, fluency: 5 }
  });
  if (microEvaluation.ok) return true;
  return false;
}

function hasCompleteRespondSituationTranscript(aiAnalysis = {}) {
  const transcript = s(aiAnalysis?.transcript || '', 50000);
  return Boolean(transcript && !transcriptTooIncompleteToScore(transcript));
}

function isRespondSituationAnalysisScorable(aiAnalysis = {}, scoringConfig = {}) {
  return hasCompleteRespondSituationTranscript(aiAnalysis)
    && hasUsableRespondSituationRubricScores(aiAnalysis, scoringConfig);
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
    'Respond to a Situation transcript appears incomplete or truncated, so the raw score was not recorded.',
    words > 0 ? `Recovered transcript contains ${words} words and may not represent the full response.` : '',
    duration > 0 ? `Recorded duration was ${duration} seconds.` : ''
  ]);
}

function buildMissingRubricScoreWarnings(aiAnalysis = {}, provider = {}) {
  const providerId = s(provider?.providerId || provider?.provider, 80);
  const model = s(provider?.modelUsed || provider?.modelId, 180);
  const providerLabel = [providerId, model].filter(Boolean).join(' / ');
  return normalizeWarnings([
    'Respond to a Situation audio analysis did not return usable micro-rubric responses.',
    providerLabel
      ? `Provider response did not include usable appropriacy, pronunciation, and fluency micro answers (${providerLabel}).`
      : 'Provider response did not include usable appropriacy, pronunciation, and fluency micro answers.',
    ...(Array.isArray(aiAnalysis?.warnings) ? aiAnalysis.warnings : [])
  ]);
}

function warnRespondSituationRubricFailure(provider = {}) {
  const providerId = s(provider?.providerId || provider?.provider, 80);
  const model = s(provider?.modelUsed || provider?.modelId, 180);
  const primaryPreview = s(provider?.responseTextPreview || '', 420);
  const rubricPreview = s(provider?.rubricRecovery?.responseTextPreview || '', 420);
  const transcriptPreview = s(provider?.transcriptRecovery?.responseTextPreview || '', 220);
  console.warn([
    '[PTE Scoring] Respond to a Situation micro-rubric responses missing.',
    providerId || model ? `provider=${providerId || 'unknown'} model=${model || 'unknown'}` : '',
    primaryPreview ? `primaryPreview=${JSON.stringify(primaryPreview)}` : '',
    transcriptPreview ? `transcriptRecoveryPreview=${JSON.stringify(transcriptPreview)}` : '',
    rubricPreview ? `rubricRecoveryPreview=${JSON.stringify(rubricPreview)}` : ''
  ].filter(Boolean).join(' '));
}

function resolveQuestionPayload(question = {}, item = {}) {
  const metadata = safeObject(item?.metadata, {});
  const snapshotPayload = safeObject(metadata.questionSnapshot?.payload, {});
  if (Object.keys(snapshotPayload).length) return snapshotPayload;
  const storedPayload = safeObject(metadata.questionPayload || metadata.payload, {});
  if (Object.keys(storedPayload).length) return storedPayload;
  return safeObject(question?.payload, {});
}

function resolveSituationContext(question = {}, item = {}) {
  const payload = resolveQuestionPayload(question, item);
  return {
    situationText: firstNonEmptyText([
      payload.situationText,
      payload.promptText,
      payload.scenarioText,
      item?.metadata?.questionSnapshot?.payload?.situationText
    ], 8000),
    role: s(payload.role || payload.candidateRole || '', 160),
    audience: s(payload.audience || payload.listener || payload.recipient || '', 160),
    targetFunction: s(payload.targetFunction || payload.languageFunction || payload.taskFunction || '', 220),
    targetRegister: s(payload.targetRegister || payload.register || '', 120),
    contextNotes: s(payload.contextNotes || payload.additionalContext || '', 2000),
    politenessLevel: s(payload.politenessLevel || payload.politeness || '', 120),
    expectedKeyPoints: normalizeTextArray(payload.expectedKeyPoints || payload.requiredPoints || [], 12)
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

function isGeminiRuntimeProvider(runtimeProvider = {}) {
  const providerId = s(runtimeProvider?.providerId, 80).toLowerCase();
  return providerId === 'google-gemini' || providerId === 'google-vertex';
}

function resolveRespondSituationTimeoutMs(runtimeProvider = {}, fallbackMs = 120000) {
  const modelToken = s(runtimeProvider?.modelId || runtimeProvider?.modelUsed, 220).toLowerCase();
  if (isGeminiRuntimeProvider(runtimeProvider) && (modelToken.includes('pro') || modelToken.includes('gemini-3'))) {
    return Math.max(Number(fallbackMs) || 120000, 240000);
  }
  return Math.max(1, Number(fallbackMs) || 120000);
}

function isGeminiTemporaryCapacityError(error = null) {
  const status = Number(error?.status || error?.statusCode || error?.code);
  const text = s(error?.message || error, 1200).toLowerCase();
  return status === 503
    || text.includes('503 service unavailable')
    || text.includes('high demand')
    || text.includes('temporarily unavailable')
    || text.includes('model is overloaded');
}

function resolveGeminiFallbackModelId(modelId = '') {
  const token = s(modelId, 220).toLowerCase();
  if (!token) return 'gemini-2.5-flash';
  if (token.includes('flash')) return '';
  if (token.includes('gemini-3')) return 'gemini-3-flash-preview';
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

async function sendWithGeminiCapacityFallback({ runtimeProvider = {}, sendFn = null, retryDelayMs = 1200 } = {}) {
  if (typeof sendFn !== 'function') throw new Error('Gemini capacity fallback requires a send function.');
  const warnings = [];
  try {
    const result = await sendFn(runtimeProvider);
    return { result, runtimeProvider, warnings };
  } catch (error) {
    if (!isGeminiRuntimeProvider(runtimeProvider) || !isGeminiTemporaryCapacityError(error)) throw error;
    const selectedModel = s(runtimeProvider.modelId || runtimeProvider.modelUsed, 220) || 'default Gemini model';
    warnings.push(`Gemini model ${selectedModel} returned a temporary capacity error; scorer retried once.`);
    const configuredDelay = Number(process.env.PTE_SCORING_GEMINI_CAPACITY_RETRY_DELAY_MS);
    const effectiveDelayMs = Number.isFinite(configuredDelay) && configuredDelay >= 0 ? configuredDelay : retryDelayMs;
    await sleepMs(effectiveDelayMs);
    try {
      const retryResult = await sendFn(runtimeProvider);
      return { result: retryResult, runtimeProvider, warnings };
    } catch (retryError) {
      if (!isGeminiTemporaryCapacityError(retryError)) throw retryError;
      const fallbackModel = resolveGeminiFallbackModelId(runtimeProvider.modelId || runtimeProvider.modelUsed);
      if (!fallbackModel) throw retryError;
      const fallbackRuntimeProvider = withRuntimeModel(runtimeProvider, fallbackModel);
      warnings.push(`Gemini model ${selectedModel} remained temporarily unavailable; scorer switched this request to ${fallbackModel}.`);
      const fallbackResult = await sendFn(fallbackRuntimeProvider);
      return { result: fallbackResult, runtimeProvider: fallbackRuntimeProvider, warnings };
    }
  }
}

function buildAudioProviderCompatibilityError(providerId = '', modelId = '', mimeType = '') {
  const providerToken = s(providerId, 80).toLowerCase();
  const modelToken = s(modelId, 220);
  const mimeToken = s(mimeType, 120).toLowerCase();
  if (!providerToken) return '';
  if (providerToken === 'google-gemini' || providerToken === 'google-vertex') return '';
  if (providerToken === 'openai' || providerToken === 'azure-openai') {
    const supportedFormat = /audio\/(mpeg|mp3|wav|x-wav)/i.test(mimeToken);
    if (!supportedFormat) {
      return `Selected provider "${providerToken}" cannot reliably score ${mimeToken || 'this audio format'} in the current PTE Respond to a Situation scorer. OpenAI-compatible scoring requires prepared MP3 or WAV audio.`;
    }
    return buildOpenAiAudioModelCompatibilityError(providerToken, modelToken, 'Respond to a Situation scoring');
  }
  if (providerToken === 'anthropic') {
    return 'Selected provider "anthropic" is not supported for Respond to a Situation audio analysis in the current PTE scorer. Use Google Gemini/Vertex, or OpenAI/Azure with an audio-capable model.';
  }
  return `Selected provider "${providerToken}" is not supported for Respond to a Situation audio analysis in the current PTE scorer.`;
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

function buildRespondSituationAnalysisResponseSchema() {
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
      appropriacy: traitSchema,
      pronunciation: traitSchema,
      fluency: traitSchema,
      intelligibilityNotes: { type: 'string' },
      situationalNotes: { type: 'string' },
      registerFit: { type: 'string' },
      politenessFit: { type: 'string' },
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
          wordCount: { type: 'number' },
          rhythmNotes: { type: 'string' }
        }
      },
      confidence: { type: 'number' },
      warnings: { type: 'array', items: { type: 'string' } }
    }
  };
}

function buildAudioAnalysisPrompt({ situationContext = {}, recordingDurationSeconds = 0, scoringConfig = {} } = {}) {
  const keyPoints = normalizeTextArray(situationContext.expectedKeyPoints || [], 12);
  const appropriacyMax = toFiniteNumber(scoringConfig.appropriacyMax, 3) || 3;
  const pronunciationMax = toFiniteNumber(scoringConfig.pronunciationMax, 5) || 5;
  const fluencyMax = toFiniteNumber(scoringConfig.fluencyMax, 5) || 5;
  return [
    'Analyze the attached PTE Respond to a Situation response audio.',
    'Use the audio as the only source for what the candidate said; ignore any typed transcript notes.',
    'Return strict JSON only.',
    'Required JSON keys: transcript, microResponses, speechMetrics, confidence, warnings.',
    'Do not provide final trait scores for appropriacy, pronunciation, or fluency; the server will aggregate the micro responses deterministically.',
    `The server will map appropriacy to 0-${appropriacyMax}, pronunciation to 0-${pronunciationMax}, and fluency to 0-${fluencyMax}.`,
    buildMicroRubricPrompt('speaking_respond_to_situation'),
    recordingDurationSeconds > 0 ? `Browser-recorded duration: ${round2(recordingDurationSeconds)} seconds.` : '',
    `Situation: ${situationContext.situationText || ''}`,
    situationContext.role ? `Candidate role: ${situationContext.role}` : '',
    situationContext.audience ? `Audience/person concerned: ${situationContext.audience}` : '',
    situationContext.targetFunction ? `Target language function: ${situationContext.targetFunction}` : '',
    situationContext.targetRegister ? `Target register: ${situationContext.targetRegister}` : '',
    situationContext.politenessLevel ? `Expected politeness level: ${situationContext.politenessLevel}` : '',
    situationContext.contextNotes ? `Context notes: ${situationContext.contextNotes}` : '',
    keyPoints.length ? `Expected key points/details: ${keyPoints.join(' | ')}` : '',
    scoringConfig.idealWpmMin || scoringConfig.idealWpmMax
      ? `WPM guidance: ${toFiniteNumber(scoringConfig.idealWpmMin, 85) || 85}-${toFiniteNumber(scoringConfig.idealWpmMax, 155) || 155} WPM is the target range.`
      : '',
    scoringConfig.longPauseSeconds
      ? `Long-pause threshold: ${round2(toFiniteNumber(scoringConfig.longPauseSeconds, 2) || 2)} seconds.`
      : ''
  ].filter(Boolean).join('\n');
}

async function sendRespondSituationAnalysisRequest({
  runtimeProvider = {},
  audio = {},
  systemPrompt = '',
  userPrompt = '',
  session = {},
  item = {},
  useStructuredSchema = true,
  requestLabel = 'pte-respond-situation-scoring-v1'
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
      maxOutputTokens: 1800
    },
    responseMimeType: useStructuredSchema ? 'application/json' : undefined,
    responseSchema: useStructuredSchema ? buildRespondSituationAnalysisResponseSchema() : undefined,
    disableCache: true,
    requestLabel,
    timeoutMs: resolveRespondSituationTimeoutMs(runtimeProvider, 120000),
    usageContext: {
      requestingUser: runtimeProvider.requestingUser || null,
      section: SECTIONS.PTE_SCORING,
      operation: OPERATIONS.AI_SCORING,
      objectId: s(item.id || session.id || 'DRAFT:respond-situation', 160),
      requestLabel,
      providerRecordId: s(runtimeProvider?.providerRecord?.id, 160),
      providerRecordName: s(runtimeProvider?.providerRecord?.name, 220),
      source: {
        module: 'pte_attempt_scoring',
        eventType: 'respond_situation_audio_analysis'
      }
    }
  });
}

async function sendRespondSituationTranscriptRecoveryRequest({
  runtimeProvider = {},
  audio = {},
  session = {},
  item = {},
  requestLabel = 'pte-respond-situation-transcript-recovery-v1',
  strictFullTranscript = false
} = {}) {
  const promptText = [
    'Transcribe the attached PTE Respond to a Situation response audio.',
    'Use only the attached audio.',
    strictFullTranscript
      ? 'The previous transcript looked incomplete or cut off. Listen to the whole recording from beginning to end and return the complete verbatim transcript.'
      : '',
    strictFullTranscript
      ? 'Do not stop at the first clause or sentence. Include every spoken word until the audio ends.'
      : '',
    'Return compact JSON only with keys: transcript, speechMetrics, confidence, warnings.',
    'transcript must contain only the words actually spoken by the candidate.',
    'If speech is not usable, return transcript as an empty string and add a warning.'
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
    timeoutMs: resolveRespondSituationTimeoutMs(runtimeProvider, 120000),
    usageContext: {
      requestingUser: runtimeProvider.requestingUser || null,
      section: SECTIONS.PTE_SCORING,
      operation: OPERATIONS.AI_SCORING,
      objectId: s(item.id || session.id || 'DRAFT:respond-situation-transcript', 160),
      requestLabel,
      providerRecordId: s(runtimeProvider?.providerRecord?.id, 160),
      providerRecordName: s(runtimeProvider?.providerRecord?.name, 220),
      source: {
        module: 'pte_attempt_scoring',
        eventType: 'respond_situation_audio_transcript_recovery'
      }
    }
  });
}

async function sendRespondSituationRubricRecoveryRequest({
  runtimeProvider = {},
  audio = {},
  transcript = '',
  situationContext = {},
  responsePayload = {},
  scoringConfig = {},
  session = {},
  item = {},
  requestLabel = 'pte-respond-situation-rubric-recovery-v1'
} = {}) {
  const recordingDurationSeconds = toFiniteNumber(
    responsePayload.audioDurationSeconds
      ?? responsePayload.durationSeconds
      ?? responsePayload?.speechMetrics?.speechDurationSeconds,
    0
  );
  const rubricPrompt = [
    'The previous PTE Respond to a Situation analysis produced a usable transcript but did not produce usable micro-rubric responses.',
    'Re-analyze the attached audio and return compact JSON only.',
    'Use the attached audio for pronunciation and oral fluency evidence. Use the transcript below as candidate wording, but trust the audio if there is any conflict.',
    'Required JSON keys: transcript, microResponses, speechMetrics, confidence, warnings.',
    'Do not provide final trait scores. The server aggregates microResponses deterministically.',
    'Do not return prose outside the JSON object.',
    'Use this exact shape: {"transcript":"...","microResponses":[{"id":"appropriacy_situation","choice":"yes","evidence":"...","confidence":0.8}],"speechMetrics":{"estimatedWpm":120},"confidence":0.8,"warnings":[]}',
    '',
    buildAudioAnalysisPrompt({
      situationContext,
      recordingDurationSeconds,
      scoringConfig
    }),
    '',
    `Candidate transcript: ${s(transcript, 50000)}`
  ].filter(Boolean).join('\n');

  return pteAiProviderService.sendPrompt({
    messages: [
      {
        role: 'system',
        content: 'You are a careful PTE Respond to a Situation rubric scoring service. Return compact JSON only.'
      },
      {
        role: 'user',
        content: [
          { text: rubricPrompt },
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
      maxOutputTokens: 1500
    },
    responseMimeType: 'application/json',
    responseSchema: buildRespondSituationAnalysisResponseSchema(),
    disableCache: true,
    requestLabel,
    timeoutMs: resolveRespondSituationTimeoutMs(runtimeProvider, 180000),
    usageContext: {
      requestingUser: runtimeProvider.requestingUser || null,
      section: SECTIONS.PTE_SCORING,
      operation: OPERATIONS.AI_SCORING,
      objectId: s(item.id || session.id || 'DRAFT:respond-situation-rubric', 160),
      requestLabel,
      providerRecordId: s(runtimeProvider?.providerRecord?.id, 160),
      providerRecordName: s(runtimeProvider?.providerRecord?.name, 220),
      source: {
        module: 'pte_attempt_scoring',
        eventType: 'respond_situation_audio_rubric_recovery'
      }
    }
  });
}

function buildAnalysisBundleFromProviderResult(result = {}, runtimeProvider = {}, extraWarnings = []) {
  const responseText = s(result?.text || '', 200000);
  const analysis = parseAiRespondSituationAnalysis(responseText);
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
  const analysis = parseAiRespondSituationTranscriptRecovery(responseText);
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

function mergeRespondSituationTranscriptRecoveryBundle(bundle = {}, recoveryBundle = {}) {
  const baseAnalysis = parseAiRespondSituationAnalysis(bundle?.analysis || bundle?.aiAnalysis || bundle);
  const recoveryAnalysis = parseAiRespondSituationTranscriptRecovery(recoveryBundle?.analysis || recoveryBundle?.aiAnalysis || recoveryBundle);
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

function mergeRespondSituationRubricRecoveryBundle(bundle = {}, recoveryBundle = {}, scoringConfig = {}, situationContext = {}) {
  const baseAnalysis = parseAiRespondSituationAnalysis(bundle?.analysis || bundle?.aiAnalysis || bundle);
  const recoveryAnalysis = parseAiRespondSituationAnalysis(recoveryBundle?.analysis || recoveryBundle?.aiAnalysis || recoveryBundle);
  const baseTranscript = s(baseAnalysis.transcript, 50000);
  const recoveryTranscript = s(recoveryAnalysis.transcript, 50000);
  const usableRecoveryTranscript = recoveryTranscript && !transcriptLooksIncompleteOrTruncated(recoveryTranscript)
    ? recoveryTranscript
    : '';

  const mergedAnalysis = {
    ...baseAnalysis,
    transcript: usableRecoveryTranscript || baseTranscript,
    speechMetrics: {
      ...safeObject(baseAnalysis.speechMetrics, {}),
      ...safeObject(recoveryAnalysis.speechMetrics, {})
    },
    warnings: normalizeWarnings([
      ...(Array.isArray(baseAnalysis.warnings) ? baseAnalysis.warnings : []),
      ...(Array.isArray(recoveryAnalysis.warnings) ? recoveryAnalysis.warnings : [])
    ])
  };

  const recoveryMicro = evaluateSpeakingMicroRubric({
    questionType: 'speaking_respond_to_situation',
    aiAnalysis: recoveryAnalysis,
    traitMax: { appropriacy: 3, pronunciation: 5, fluency: 5 }
  });
  const deterministicMicro = recoveryMicro.ok || recoveryMicro.invalidResponses?.length
    ? null
    : buildRespondSituationDeterministicMicroEvaluation({
      aiAnalysis: mergedAnalysis,
      situationContext,
      scoringConfig,
      existingMicroResponses: recoveryMicro.microResponses,
      reason: 'Generated Respond to a Situation micro-rubric responses deterministically after the AI provider omitted required micro answers during recovery.'
    });
  const acceptedMicro = recoveryMicro.ok ? recoveryMicro : deterministicMicro;

  const shouldAcceptLegacyDirect = isLegacyDirectScoring(scoringConfig) && recoveryAnalysis.rubricScoresUsable === true;
  if (acceptedMicro?.ok || shouldAcceptLegacyDirect) {
    mergedAnalysis.appropriacy = recoveryAnalysis.appropriacy;
    mergedAnalysis.pronunciation = recoveryAnalysis.pronunciation;
    mergedAnalysis.fluency = recoveryAnalysis.fluency;
    mergedAnalysis.microResponses = acceptedMicro?.ok ? acceptedMicro.microResponses : recoveryAnalysis.microResponses;
    mergedAnalysis.intelligibilityNotes = recoveryAnalysis.intelligibilityNotes || mergedAnalysis.intelligibilityNotes || '';
    mergedAnalysis.situationalNotes = recoveryAnalysis.situationalNotes || mergedAnalysis.situationalNotes || '';
    mergedAnalysis.registerFit = recoveryAnalysis.registerFit || mergedAnalysis.registerFit || '';
    mergedAnalysis.politenessFit = recoveryAnalysis.politenessFit || mergedAnalysis.politenessFit || '';
    mergedAnalysis.confidence = recoveryAnalysis.confidence || mergedAnalysis.confidence || 0;
    mergedAnalysis.rubricScoresUsable = true;
    mergedAnalysis.warnings = normalizeWarnings([
      ...mergedAnalysis.warnings,
      ...(Array.isArray(acceptedMicro?.warnings) ? acceptedMicro.warnings : []),
      recoveryMicro.ok
        ? 'Recovered Respond to a Situation micro-rubric responses using an audio follow-up request.'
        : acceptedMicro?.ok
          ? 'Recovered Respond to a Situation micro-rubric responses using deterministic transcript fallback.'
        : 'Recovered Respond to a Situation rubric trait scores using an audio follow-up request.'
    ]);
  } else {
    mergedAnalysis.rubricScoresUsable = baseAnalysis.rubricScoresUsable === true;
    mergedAnalysis.warnings = normalizeWarnings([
      ...mergedAnalysis.warnings,
      'Rubric recovery follow-up did not return usable appropriacy, pronunciation, and fluency scores.'
    ]);
  }

  if (recoveryTranscript && !usableRecoveryTranscript && baseTranscript) {
    mergedAnalysis.warnings = normalizeWarnings([
      ...mergedAnalysis.warnings,
      'Rubric recovery returned an incomplete transcript, so scorer kept the earlier usable transcript.'
    ]);
  }

  const provider = safeObject(bundle?.provider, {});
  const recoveryProvider = safeObject(recoveryBundle?.provider, {});
  return {
    ...bundle,
    analysis: mergedAnalysis,
    provider: {
      ...provider,
      tokenUsage: mergeTokenUsage(provider.tokenUsage, recoveryProvider.tokenUsage),
      rubricRecovery: {
        providerId: recoveryProvider.providerId || '',
        modelUsed: recoveryProvider.modelUsed || '',
        responseTextPreview: recoveryProvider.responseTextPreview || '',
        tokenUsage: normalizeTokenUsage(recoveryProvider.tokenUsage)
      }
    }
  };
}

async function recoverRespondSituationTranscriptIfNeeded({
  bundle = {},
  runtimeProvider = {},
  audio = {},
  session = {},
  item = {}
} = {}) {
  const analysis = parseAiRespondSituationAnalysis(bundle?.analysis || bundle?.aiAnalysis || bundle);
  const initialTranscript = s(analysis.transcript, 50000);
  const initialLooksIncomplete = initialTranscript && transcriptLooksIncompleteOrTruncated(initialTranscript);
  if (initialTranscript && !initialLooksIncomplete) return bundle;

  try {
    const recoveryResult = await sendRespondSituationTranscriptRecoveryRequest({
      runtimeProvider,
      audio,
      session,
      item,
      requestLabel: initialLooksIncomplete
        ? 'pte-respond-situation-transcript-recovery-full-v1'
        : 'pte-respond-situation-transcript-recovery-v1',
      strictFullTranscript: Boolean(initialLooksIncomplete)
    });
    const recoveryBundle = buildTranscriptRecoveryBundleFromProviderResult(recoveryResult, runtimeProvider);
    let mergedBundle = mergeRespondSituationTranscriptRecoveryBundle(bundle, recoveryBundle);
    const mergedAnalysis = parseAiRespondSituationAnalysis(mergedBundle?.analysis || mergedBundle?.aiAnalysis || mergedBundle);
    const mergedTranscript = s(mergedAnalysis.transcript, 50000);

    if (!initialLooksIncomplete && mergedTranscript && transcriptLooksIncompleteOrTruncated(mergedTranscript)) {
      const strictRecoveryResult = await sendRespondSituationTranscriptRecoveryRequest({
        runtimeProvider,
        audio,
        session,
        item,
        requestLabel: 'pte-respond-situation-transcript-recovery-full-v1',
        strictFullTranscript: true
      });
      const strictRecoveryBundle = buildTranscriptRecoveryBundleFromProviderResult(strictRecoveryResult, runtimeProvider, [
        'Transcript recovery looked incomplete, so scorer retried with a full-transcript request.'
      ]);
      mergedBundle = mergeRespondSituationTranscriptRecoveryBundle(mergedBundle, strictRecoveryBundle);
    }

    return mergedBundle;
  } catch (error) {
    const mergedAnalysis = parseAiRespondSituationAnalysis(bundle?.analysis || bundle?.aiAnalysis || bundle);
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

async function recoverRespondSituationRubricScoresIfNeeded({
  bundle = {},
  runtimeProvider = {},
  audio = {},
  session = {},
  item = {},
  situationContext = {},
  responsePayload = {},
  scoringConfig = {}
} = {}) {
  const analysis = parseAiRespondSituationAnalysis(bundle?.analysis || bundle?.aiAnalysis || bundle);
  const transcript = s(analysis.transcript, 50000);
  if (!transcript || transcriptLooksIncompleteOrTruncated(transcript) || hasUsableRespondSituationRubricScores(analysis, scoringConfig)) {
    return bundle;
  }

  try {
    const recoveryResult = await sendRespondSituationRubricRecoveryRequest({
      runtimeProvider,
      audio,
      transcript,
      situationContext,
      responsePayload,
      scoringConfig,
      session,
      item
    });
    const recoveryBundle = buildAnalysisBundleFromProviderResult(recoveryResult, runtimeProvider);
    return mergeRespondSituationRubricRecoveryBundle(bundle, recoveryBundle, scoringConfig, situationContext);
  } catch (error) {
    const mergedAnalysis = parseAiRespondSituationAnalysis(bundle?.analysis || bundle?.aiAnalysis || bundle);
    mergedAnalysis.warnings = normalizeWarnings([
      ...(Array.isArray(mergedAnalysis.warnings) ? mergedAnalysis.warnings : []),
      `Rubric recovery follow-up failed: ${s(error?.message || error, 500) || 'unknown error'}.`
    ]);
    return {
      ...bundle,
      analysis: mergedAnalysis
    };
  }
}

async function recoverRespondSituationAnalysisIfNeeded({
  bundle = {},
  runtimeProvider = {},
  audio = {},
  session = {},
  item = {},
  situationContext = {},
  responsePayload = {},
  scoringConfig = {}
} = {}) {
  const transcriptBundle = await recoverRespondSituationTranscriptIfNeeded({
    bundle,
    runtimeProvider,
    audio,
    session,
    item
  });
  return recoverRespondSituationRubricScoresIfNeeded({
    bundle: transcriptBundle,
    runtimeProvider,
    audio,
    session,
    item,
    situationContext,
    responsePayload,
    scoringConfig
  });
}

async function analyzeRespondSituationAudioWithAi({
  session = {},
  item = {},
  audioArtifact = {},
  situationContext = {},
  responsePayload = {},
  scoringConfig = {},
  requestingUser = null
} = {}) {
  const runtimeProvider = await pteAiProviderDataService.resolveRuntimeProvider(requestingUser, {}, {
    purpose: 'pte_scoring',
    questionType: 'speaking_respond_to_situation',
    scorerKey: 'speaking_respond_to_situation'
  });
  runtimeProvider.requestingUser = requestingUser;
  const sourceAudio = await readAudioArtifactForAi(audioArtifact);
  const preparedAudio = await prepareAudioForScoringProvider({
    providerId: runtimeProvider.providerId,
    audio: sourceAudio,
    scorerName: 'Respond to a Situation scoring',
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
      'You are a careful PTE Respond to a Situation audio analysis service.',
      'You do not produce an official Pearson score.',
      'You return evidence-backed JSON for a downstream raw-rubric scorer.',
      'Never score from typed transcript notes; analyze the attached audio.'
    ].join(' ');
    const userPrompt = buildAudioAnalysisPrompt({
      situationContext,
      recordingDurationSeconds,
      scoringConfig
    });
    const primaryUsesStructuredSchema = !isOpenAiCompatibleProvider(runtimeProvider.providerId);
    const retryWarning = primaryUsesStructuredSchema
      ? 'AI provider returned an unusable structured Respond to a Situation response; scorer retried with a looser JSON-only request.'
      : 'AI provider returned an unusable Respond to a Situation JSON response; scorer retried with a JSON-only request.';
    const primaryRequestDescription = primaryUsesStructuredSchema ? 'Structured' : 'JSON-only';

    let primaryResult = null;
    let activeRuntimeProvider = runtimeProvider;
    let primaryCapacityWarnings = [];
    let primaryCall = null;
    try {
      primaryCall = await sendWithGeminiCapacityFallback({
        runtimeProvider,
        sendFn: (providerForCall) => sendRespondSituationAnalysisRequest({
          runtimeProvider: providerForCall,
          audio,
          systemPrompt,
          userPrompt,
          session,
          item,
          useStructuredSchema: primaryUsesStructuredSchema,
          requestLabel: 'pte-respond-situation-scoring-v1'
        })
      });
    } catch (error) {
      try {
        const retryCall = await sendWithGeminiCapacityFallback({
          runtimeProvider,
          sendFn: (providerForCall) => sendRespondSituationAnalysisRequest({
            runtimeProvider: providerForCall,
            audio,
            systemPrompt,
            userPrompt,
            session,
            item,
            useStructuredSchema: false,
            requestLabel: isGeminiRuntimeProvider(runtimeProvider)
              ? 'pte-respond-situation-scoring-v1-gemini-json-retry'
              : 'pte-respond-situation-scoring-v1-json-retry'
          })
        });
        const retryBundle = buildAnalysisBundleFromProviderResult(retryCall.result, retryCall.runtimeProvider || runtimeProvider, [
          ...normalizeWarnings(retryCall.warnings || []),
          `${primaryRequestDescription} Respond to a Situation request failed first: ${s(error?.message || error, 500) || 'unknown error'}.`,
          retryWarning
        ]);
        if (isRespondSituationAnalysisScorable(retryBundle?.analysis || {}, scoringConfig)) {
          return attachAudioPreparationMetadata(retryBundle, preparedAudio);
        }
        return attachAudioPreparationMetadata(await recoverRespondSituationAnalysisIfNeeded({
          bundle: retryBundle,
          runtimeProvider: retryCall.runtimeProvider || runtimeProvider,
          audio,
          session,
          item,
          situationContext,
          responsePayload,
          scoringConfig
        }), preparedAudio);
      } catch (retryError) {
        const combined = new Error(
          `Respond to a Situation analysis failed after structured and fallback attempts. First: ${s(error?.message || error, 500) || 'unknown error'}. Fallback: ${s(retryError?.message || retryError, 500) || 'unknown error'}.`
        );
        combined.code = retryError?.code || error?.code || 'RESPOND_SITUATION_ANALYSIS_FAILED';
        throw combined;
      }
    }
    primaryResult = primaryCall.result;
    activeRuntimeProvider = primaryCall.runtimeProvider || runtimeProvider;
    primaryCapacityWarnings = normalizeWarnings(primaryCall.warnings || []);

    const primaryBundle = buildAnalysisBundleFromProviderResult(primaryResult, activeRuntimeProvider, primaryCapacityWarnings);
    if (isRespondSituationAnalysisScorable(primaryBundle?.analysis || {}, scoringConfig)) {
      return attachAudioPreparationMetadata(primaryBundle, preparedAudio);
    }

    const retryCall = await sendWithGeminiCapacityFallback({
      runtimeProvider: activeRuntimeProvider,
      sendFn: (providerForCall) => sendRespondSituationAnalysisRequest({
        runtimeProvider: providerForCall,
        audio,
        systemPrompt,
        userPrompt,
        session,
        item,
        useStructuredSchema: false,
        requestLabel: isGeminiRuntimeProvider(activeRuntimeProvider)
          ? 'pte-respond-situation-scoring-v1-gemini-json-retry'
          : 'pte-respond-situation-scoring-v1-json-retry'
      })
    });
    const retryBundle = buildAnalysisBundleFromProviderResult(retryCall.result, retryCall.runtimeProvider || activeRuntimeProvider, [
      ...normalizeWarnings(primaryBundle?.analysis?.warnings || []),
      ...normalizeWarnings(retryCall.warnings || []),
      retryWarning
    ]);
    retryBundle.provider = {
      ...safeObject(retryBundle.provider, {}),
      tokenUsage: mergeTokenUsage(primaryBundle?.provider?.tokenUsage, retryBundle?.provider?.tokenUsage)
    };
    if (isRespondSituationAnalysisScorable(retryBundle?.analysis || {}, scoringConfig)) {
      return attachAudioPreparationMetadata(retryBundle, preparedAudio);
    }
    return attachAudioPreparationMetadata(await recoverRespondSituationAnalysisIfNeeded({
      bundle: retryBundle,
      runtimeProvider: retryCall.runtimeProvider || activeRuntimeProvider,
      audio,
      session,
      item,
      situationContext,
      responsePayload,
      scoringConfig
    }), preparedAudio);
  } finally {
    await preparedAudio.cleanup();
  }
}

function describeBand(score = 0, trait = '') {
  const value = Number(score || 0);
  if (trait === 'appropriacy') {
    if (value >= 3) return 'Clear, polite, register-appropriate response';
    if (value >= 2) return 'Mostly appropriate response';
    if (value >= 1) return 'Basic or partly inappropriate response';
    return 'Not relevant or too limited';
  }
  if (value >= 5) return 'Highly proficient';
  if (value >= 4) return 'Advanced';
  if (value >= 3) return 'Good';
  if (value >= 2) return 'Intermediate';
  if (value >= 1) return 'Limited';
  return 'No usable evidence';
}

function buildFeedbackDraft({ scoreResult = {}, aiAnalysis = {}, situationContext = {}, scoringConfig = {}, microEvaluation = null } = {}) {
  const traitScores = safeObject(scoreResult.traitScores, {});
  const appropriacy = Number(traitScores.appropriacy || 0);
  const pronunciation = Number(traitScores.pronunciation || 0);
  const fluency = Number(traitScores.fluency || 0);
  const strengths = [];
  const improvements = [];
  const microFeedback = buildMicroFeedbackRows(microEvaluation || {});

  if (appropriacy >= 3) strengths.push('Appropriacy is strong; the response fits the situation, register, and listener.');
  else if (appropriacy >= 2) strengths.push('The response mostly handles the situation appropriately.');
  if (pronunciation >= 4) strengths.push('Pronunciation was generally clear and intelligible.');
  if (fluency >= 4) strengths.push('Fluency was mostly steady with manageable pauses.');

  const missing = normalizeTextArray(aiAnalysis?.appropriacy?.missingKeyPoints || [], 4);
  if (appropriacy < 3) {
    improvements.push(
      missing.length
        ? `Appropriacy needs more complete situational coverage: include ${missing.join(', ')}.`
        : 'Appropriacy needs improvement: make the purpose, register, politeness, and key details fit the situation more clearly.'
    );
  }
  if (pronunciation < 4) improvements.push('Pronunciation needs improvement: make key words, endings, stress, and sounds easier to understand.');
  if (fluency < 4) improvements.push('Fluency needs improvement: reduce long pauses, restarts, filler sounds, and uneven phrasing.');

  const speechMetrics = safeObject(aiAnalysis?.speechMetrics, {});
  const wpm = Number(speechMetrics.estimatedWpm || 0);
  const idealMin = Number(scoringConfig.idealWpmMin || 85);
  const idealMax = Number(scoringConfig.idealWpmMax || 155);
  if (wpm > 0 && (wpm < idealMin || wpm > idealMax)) {
    improvements.push(`Aim for a steadier natural pace; estimated rate was ${round2(wpm)} WPM.`);
  }
  strengths.push(...microFeedback.strengths.slice(0, 4));
  improvements.push(...microFeedback.improvements.slice(0, 4));

  const actionTarget = situationContext.targetFunction || 'the required language function';
  return {
    summary: `${round2(scoreResult.scoreFinal || 0)} / ${round2(scoreResult.maxScore || 0)} raw rubric points.`,
    strengths,
    improvements: improvements.length ? improvements : ['Keep the same situational fit while polishing pronunciation, pace, and rhythm.'],
    nextPracticeAction: appropriacy < 3
      ? `Re-record once using a simple structure: acknowledge the situation, ${actionTarget}, add one detail, and close politely.`
      : 'Practice another Respond to a Situation item and keep the same register while improving natural delivery.'
  };
}

function makeScoringMetadata({
  status = '',
  situationContext = {},
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
  const rubric = getRubric('speaking_respond_to_situation') || {};
  const speechMetrics = safeObject(aiAnalysis?.speechMetrics, {});
  const traitMax = safeObject(scoreResult?.evidence?.traitMax, { appropriacy: 3, pronunciation: 5, fluency: 5 });
  const warningSplit = splitWarningsForAudience([
    ...(Array.isArray(aiAnalysis?.warnings) ? aiAnalysis.warnings : []),
    ...(Array.isArray(microEvaluation?.warnings) ? microEvaluation.warnings : []),
    ...warnings
  ]);
  return {
    status,
    scorerKey: 'speaking_respond_to_situation',
    scorerVersion: RESPOND_SITUATION_SCORER_VERSION,
    scoringContractVersion: microEvaluation ? MICRO_SCORING_CONTRACT_VERSION : 1,
    scoreScale: 'raw_item_rubric_score',
    officialScoreEstimate: false,
    rubricSource: Array.isArray(rubric.rubricSources) ? rubric.rubricSources : [],
    configuredMethod: s(scoringConfig.method || '', 120) || 'hybrid_ai_audio_situational',
    provider: safeObject(provider, {}),
    microRubricVersion: microEvaluation?.microRubricVersion || '',
    microResponses: Array.isArray(microEvaluation?.microResponses) ? microEvaluation.microResponses : [],
    aggregationBreakdown: safeObject(microEvaluation?.aggregationBreakdown, {}),
    legacyDirectModelScores: collectLegacyDirectModelScores(aiAnalysis, ['appropriacy', 'pronunciation', 'fluency']),
    transcript: s(aiAnalysis?.transcript || '', 50000),
    transcriptWordCount: transcriptWordCount(aiAnalysis?.transcript || ''),
    transcriptQuality: {
      appearsIncomplete: transcriptTooIncompleteToScore(aiAnalysis?.transcript || '')
    },
    situation: situationContext,
    appropriacy: {
      ...(aiAnalysis?.appropriacy || {}),
      maxScore: traitMax.appropriacy ?? 3,
      descriptor: describeBand(scoreResult?.traitScores?.appropriacy ?? aiAnalysis?.appropriacy?.score ?? 0, 'appropriacy')
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
    registerFit: s(aiAnalysis?.registerFit || '', 500),
    politenessFit: s(aiAnalysis?.politenessFit || '', 500),
    situationalNotes: s(aiAnalysis?.situationalNotes || '', 1500),
    intelligibilityNotes: s(aiAnalysis?.intelligibilityNotes || '', 1500),
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
    confidence: normalizeConfidence(aiAnalysis?.confidence),
    rubricScoresUsable: aiAnalysis?.rubricScoresUsable === true,
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
    'Respond to a Situation audio analysis returned no usable transcript.',
    providerLabel
      ? `Provider response did not include a usable transcript field (${providerLabel}).`
      : 'Provider response did not include a usable transcript field.',
    ...(Array.isArray(aiAnalysis?.warnings) ? aiAnalysis.warnings : [])
  ]);
}

async function scoreRespondSituationAttemptItem(args = {}, options = {}) {
  const {
    session = {},
    item = {},
    question = {},
    artifacts = [],
    responsePayload = {},
    scoringConfig = {},
    requestingUser = null
  } = args;
  const situationContext = resolveSituationContext(question, item);
  const baseContext = { situationContext, responsePayload, scoringConfig };
  if (!situationContext.situationText || !situationContext.targetFunction || !situationContext.targetRegister) {
    return needsEvidenceResult([
      'Respond to a Situation scoring requires situation text, target function, and target register.',
      'Appropriacy cannot be evaluated without the situation prompt.'
    ], baseContext);
  }

  const audioArtifact = selectAudioArtifact({ item, artifacts, responsePayload });
  if (!audioArtifact) {
    return needsEvidenceResult([
      'Respond to a Situation scoring requires an uploaded audio response.',
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
        situationContext,
        responsePayload,
        scoringConfig,
        requestingUser
      });
    } else if (Object.prototype.hasOwnProperty.call(options, 'aiAnalysis')) {
      analysisBundle = {
        analysis: parseAiRespondSituationAnalysis(options.aiAnalysis),
        provider: safeObject(options.provider, { providerId: 'test', modelUsed: 'injected' })
      };
    } else {
      analysisBundle = await analyzeRespondSituationAudioWithAi({
        session,
        item,
        audioArtifact,
        situationContext,
        responsePayload,
        scoringConfig,
        requestingUser
      });
    }
  } catch (error) {
    return failedResult([
      `Respond to a Situation audio analysis failed: ${s(error?.message || error, 800) || 'unknown error'}.`
    ], {
      ...baseContext,
      audioArtifact
    });
  }

  const aiAnalysis = parseAiRespondSituationAnalysis(
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

  if (transcriptTooIncompleteToScore(aiAnalysis.transcript)) {
    return failedResult(buildIncompleteTranscriptWarnings(aiAnalysis, responsePayload), {
      ...baseContext,
      aiAnalysis,
      provider,
      audioArtifact
    });
  }

  const appropriacyMax = Math.min(3, Math.max(0, toFiniteNumber(scoringConfig.appropriacyMax, 3) || 3));
  const pronunciationMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.pronunciationMax, 5) || 5));
  const fluencyMax = Math.min(5, Math.max(0, toFiniteNumber(scoringConfig.fluencyMax ?? scoringConfig.oralFluencyMax, 5) || 5));
  let microEvaluation = isLegacyDirectScoring(scoringConfig)
    ? null
    : evaluateSpeakingMicroRubric({
      questionType: 'speaking_respond_to_situation',
      aiAnalysis,
      traitMax: { appropriacy: appropriacyMax, pronunciation: pronunciationMax, fluency: fluencyMax }
    });

  if (microEvaluation && !microEvaluation.ok && !microEvaluation.invalidResponses?.length) {
    const deterministicMicro = buildRespondSituationDeterministicMicroEvaluation({
      aiAnalysis,
      situationContext,
      scoringConfig,
      existingMicroResponses: microEvaluation.microResponses,
      reason: 'Generated Respond to a Situation micro-rubric responses deterministically after the AI provider omitted required micro answers.'
    });
    if (deterministicMicro?.ok) {
      microEvaluation = deterministicMicro;
      aiAnalysis.microResponses = deterministicMicro.microResponses;
      aiAnalysis.rubricScoresUsable = true;
      aiAnalysis.warnings = normalizeWarnings([
        ...(Array.isArray(aiAnalysis.warnings) ? aiAnalysis.warnings : []),
        ...(Array.isArray(deterministicMicro.warnings) ? deterministicMicro.warnings : [])
      ]);
    }
  }

  if (isLegacyDirectScoring(scoringConfig) && !hasUsableRespondSituationRubricScores(aiAnalysis, scoringConfig)) {
    warnRespondSituationRubricFailure(provider);
    return failedResult(buildMissingRubricScoreWarnings(aiAnalysis, provider), {
      ...baseContext,
      aiAnalysis,
      provider,
      audioArtifact
    });
  }

  if (microEvaluation && !microEvaluation.ok) {
    warnRespondSituationRubricFailure(provider);
    return failedResult(normalizeWarnings([
      ...buildMissingRubricScoreWarnings(aiAnalysis, provider),
      ...(Array.isArray(microEvaluation.warnings) ? microEvaluation.warnings : [])
    ]), {
      ...baseContext,
      aiAnalysis,
      provider,
      audioArtifact,
      microEvaluation
    });
  }

  const scoreResult = calculateRespondSituationScore({ aiAnalysis, scoringConfig, microTraitScores: microEvaluation?.traitScores });
  const feedbackDraft = buildFeedbackDraft({ scoreResult, aiAnalysis, situationContext, scoringConfig, microEvaluation });
  const metadata = makeScoringMetadata({
    status: 'scored',
    situationContext,
    aiAnalysis,
    scoreResult,
    provider,
    audioArtifact,
    responsePayload,
    scoringConfig,
    feedbackDraft,
    microEvaluation
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
  calculateRespondSituationScore,
  parseAiRespondSituationAnalysis,
  parseAiRespondSituationTranscriptRecovery,
  selectAudioArtifact,
  resolveSituationContext,
  isOpenAiAudioChatModel,
  scoreRespondSituationAttemptItem,
  analyzeRespondSituationAudioWithAi
};
