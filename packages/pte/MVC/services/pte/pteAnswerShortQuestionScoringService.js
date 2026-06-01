const fs = require('fs/promises');
const path = require('path');
const { coreFilesService, getGatewayBaseUrl } = require('./pteCoreContracts');
const pteAiProviderDataService = require('./pteAiProviderDataService');
const pteAiProviderService = require('./ai/aiProviderService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');
const {
  ANSWER_SHORT_QUESTION_SCORER_VERSION,
  getRubric
} = require('./pteScoringRubricRegistry');
const {
  buildOpenAiAudioModelCompatibilityError,
  isOpenAiCompatibleProvider,
  prepareAudioForScoringProvider
} = require('./pteScoringAudioPreparationService');
const {
  MICRO_SCORING_CONTRACT_VERSION,
  buildAnswerShortQuestionMicroEvaluation
} = require('./pteSpeakingMicroRubricService');

const AUDIO_MAX_BYTES = 35 * 1024 * 1024;
const REMOTE_AUDIO_FETCH_TIMEOUT_MS = 25000;

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

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const token = s(value, 20).toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function normalizeAnswerText(value = '', { caseSensitive = false } = {}) {
  let text = s(value, 2000)
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\bit's\b/gi, 'it is')
    .replace(/&/g, ' and ');
  try {
    text = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  } catch (_) {
    // Older runtimes still get the ASCII-oriented cleanup below.
  }
  if (!caseSensitive) text = text.toLowerCase();
  text = text
    .replace(/[^a-z0-9'\s-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const fillerPatterns = [
    /^(?:i\s+(?:think|believe)\s+)?(?:the\s+)?answer\s+(?:is|was|would\s+be)\s+/i,
    /^(?:i\s+(?:think|believe)\s+)?(?:it|that|this)\s+(?:is|was|would\s+be)\s+/i,
    /^(?:i\s+(?:think|believe)\s+)?(?:i\s+would\s+say)\s+/i
  ];
  let changed = true;
  while (changed && text) {
    changed = false;
    for (const pattern of fillerPatterns) {
      const next = text.replace(pattern, '').trim();
      if (next !== text) {
        text = next;
        changed = true;
      }
    }
  }

  return text.replace(/\s+/g, ' ').trim();
}

function buildAnswerVariants(value = '', config = {}) {
  const base = normalizeAnswerText(value, config);
  const variants = new Set();
  if (base) variants.add(base);
  const withoutArticle = base.replace(/^(?:a|an|the)\s+/i, '').trim();
  if (withoutArticle) variants.add(withoutArticle);
  const withoutPossessive = base.replace(/'s\b/g, 's').trim();
  if (withoutPossessive) variants.add(withoutPossessive);
  return Array.from(variants).filter(Boolean);
}

function normalizeAnswerList(values = []) {
  const source = Array.isArray(values) ? values : (s(values) ? [values] : []);
  const out = [];
  const seen = new Set();
  source.forEach((value) => {
    const text = s(value, 500);
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(text);
  });
  return out;
}

function buildAnswerEntries(acceptedAnswers = [], answerAliases = [], config = {}) {
  const rows = [
    ...normalizeAnswerList(acceptedAnswers).map((text) => ({ text, source: 'accepted' })),
    ...normalizeAnswerList(answerAliases).map((text) => ({ text, source: 'alias' }))
  ];
  return rows
    .map((row) => ({
      ...row,
      variants: buildAnswerVariants(row.text, config)
    }))
    .filter((row) => row.variants.length);
}

function normalizeSemanticMatch(value = {}) {
  const row = isPlainObject(value) ? value : {};
  const confidence = normalizeConfidence(row.confidence ?? row.matchConfidence ?? row.score);
  return {
    isMatch: normalizeBoolean(row.isMatch ?? row.match ?? row.correct ?? row.isCorrect, false),
    matchedAnswer: s(row.matchedAnswer || row.acceptedAnswer || row.answer || '', 500),
    confidence,
    rationale: s(row.rationale || row.reason || row.notes || '', 1000)
  };
}

function matchAnswerShortQuestion({
  transcript = '',
  normalizedAnswer = '',
  acceptedAnswers = [],
  answerAliases = [],
  caseSensitive = false,
  allowSemanticMatch = false,
  minSemanticConfidence = 0.7,
  semanticMatch = {}
} = {}) {
  const config = { caseSensitive };
  const answerEntries = buildAnswerEntries(acceptedAnswers, answerAliases, config);
  const candidateTexts = normalizeAnswerList([normalizedAnswer, transcript]);
  const candidateVariants = new Map();
  candidateTexts.forEach((candidate) => {
    candidateVariants.set(candidate, buildAnswerVariants(candidate, config));
  });

  for (const [candidate, variants] of candidateVariants.entries()) {
    for (const variant of variants) {
      const matchedEntry = answerEntries.find((entry) => entry.variants.includes(variant));
      if (matchedEntry) {
        return {
          isCorrect: true,
          matchType: matchedEntry.source === 'alias' ? 'alias' : 'exact',
          matchedAnswer: matchedEntry.text,
          candidate,
          normalizedCandidate: variant,
          confidence: 1,
          rationale: matchedEntry.source === 'alias'
            ? 'Spoken answer matched an accepted alias after normalization.'
            : 'Spoken answer matched an accepted answer after normalization.'
        };
      }
    }
  }

  const semantic = normalizeSemanticMatch(semanticMatch);
  const threshold = Math.min(1, Math.max(0, Number(minSemanticConfidence) || 0.7));
  if (allowSemanticMatch && semantic.isMatch && semantic.confidence >= threshold) {
    return {
      isCorrect: true,
      matchType: 'semantic',
      matchedAnswer: semantic.matchedAnswer,
      candidate: candidateTexts[0] || transcript,
      normalizedCandidate: normalizeAnswerText(candidateTexts[0] || transcript, config),
      confidence: semantic.confidence,
      rationale: semantic.rationale || 'AI semantic matcher judged the spoken answer equivalent to an accepted answer.'
    };
  }

  return {
    isCorrect: false,
    matchType: 'none',
    matchedAnswer: '',
    candidate: candidateTexts[0] || transcript,
    normalizedCandidate: normalizeAnswerText(candidateTexts[0] || transcript, config),
    confidence: semantic.confidence || 0,
    rationale: semantic.rationale || 'Spoken answer did not match the accepted answers or aliases.'
  };
}

function parseAiAnswerShortQuestionAnalysis(input = {}) {
  const parsed = typeof input === 'string'
    ? extractJsonObject(input)
    : (isPlainObject(input) ? input : null);
  if (!isPlainObject(parsed)) {
    return {
      transcript: '',
      normalizedAnswer: '',
      semanticMatch: normalizeSemanticMatch({}),
      speechMetrics: {},
      confidence: 0,
      warnings: ['AI audio analysis did not return valid JSON.']
    };
  }

  const metricsRaw = safeObject(parsed.speechMetrics || parsed.metrics || parsed.timingMeta, {});
  const transcript = resolveTranscriptFromParsedAnalysis(parsed);
  const normalizedAnswer = firstNonEmptyText([
    parsed.normalizedAnswer,
    parsed.normalisedAnswer,
    parsed.shortAnswer,
    parsed.answer,
    parsed.spokenAnswer,
    parsed.responseAnswer
  ], 2000);

  return {
    transcript,
    normalizedAnswer: normalizedAnswer || transcript,
    semanticMatch: normalizeSemanticMatch(parsed.semanticMatch || parsed.answerMatch || parsed.match || {}),
    speechMetrics: {
      speechDurationSeconds: round2(toFiniteNumber(
        metricsRaw.speechDurationSeconds
          ?? metricsRaw.durationSeconds
          ?? parsed.speechDurationSeconds
          ?? parsed.durationSeconds,
        0
      ))
    },
    confidence: normalizeConfidence(parsed.confidence ?? metricsRaw.confidence),
    warnings: normalizeWarnings(parsed.warnings || parsed.warning || [])
  };
}

function calculateAnswerShortQuestionScore({
  transcript = '',
  normalizedAnswer = '',
  acceptedAnswers = [],
  answerAliases = [],
  caseSensitive = false,
  allowSemanticMatch = false,
  semanticMatch = {},
  scoringConfig = {}
} = {}) {
  const maxScore = Math.max(0, toFiniteNumber(scoringConfig.maxScore, 1) || 1);
  const minSemanticConfidence = toFiniteNumber(scoringConfig.minSemanticConfidence, 0.7);
  const match = matchAnswerShortQuestion({
    transcript,
    normalizedAnswer,
    acceptedAnswers,
    answerAliases,
    caseSensitive,
    allowSemanticMatch,
    minSemanticConfidence,
    semanticMatch
  });
  const scoreFinal = match.isCorrect ? maxScore : 0;
  const percentage = maxScore > 0 ? round2((scoreFinal / maxScore) * 100) : 0;

  return {
    scoreRaw: scoreFinal,
    scoreFinal,
    maxScore,
    percentage,
    traitScores: {
      vocabulary: scoreFinal,
      correctness: scoreFinal
    },
    evidence: {
      match,
      acceptedAnswerCount: normalizeAnswerList(acceptedAnswers).length,
      aliasCount: normalizeAnswerList(answerAliases).length
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

function resolveAcceptedAnswerContext(question = {}, item = {}) {
  const payload = resolveQuestionPayload(question, item);
  const acceptedAnswers = normalizeAnswerList(
    payload.acceptedAnswers
      || payload.correctAnswers
      || payload.expectedAnswers
      || payload.answers
      || []
  );
  const answerAliases = normalizeAnswerList(
    payload.answerAliases
      || payload.acceptedAnswerAliases
      || payload.aliases
      || []
  );
  const promptText = s(
    payload.transcript
      || payload.promptText
      || payload.stem
      || payload.promptTextOrAudio
      || question.promptText
      || '',
    5000
  );
  return {
    payload,
    promptText,
    acceptedAnswers,
    answerAliases,
    caseSensitive: normalizeBoolean(payload.caseSensitive, false),
    allowSemanticMatch: normalizeBoolean(payload.allowSemanticMatch, false)
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
  return fromArtifact || 'audio/webm';
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

function resolveArtifactPath(artifact = {}) {
  const rawPath = s(artifact.path || artifact.filePath || artifact.localPath || '', 2000);
  if (rawPath && isAppUploadUrl(rawPath)) {
    return coreFilesService.fromUploadsUrlToDiskPath(rawPath);
  }
  if (rawPath && !isHttpUrl(rawPath)) {
    if (rawPath.startsWith('/uploads/')) {
      return coreFilesService.fromUploadsUrlToDiskPath(rawPath);
    }
    return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
  }

  const url = s(artifact.url || '', 2000);
  if (url.startsWith('/uploads/') || isAppUploadUrl(url)) {
    return coreFilesService.fromUploadsUrlToDiskPath(url);
  }
  return '';
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

  const gatewayRelativePath = s(metadata.gatewayRelativePath || artifact.gatewayRelativePath, 2000).replace(/\\/g, '/').replace(/^\/+/, '');
  if (gatewayRelativePath) {
    pushUniqueUrlCandidate(candidates, buildGatewayUploadUrlFromRelativePath(gatewayRelativePath));
  }

  return candidates;
}

async function readRemoteAudioArtifactForAi(artifact = {}) {
  const candidates = getArtifactUploadUrlCandidates(artifact);
  if (!candidates.length) return null;

  let lastError = null;
  for (const remoteUrl of candidates) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REMOTE_AUDIO_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(remoteUrl, {
        method: 'GET',
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`Uploaded audio artifact URL could not be read (${response.status}).`);
      }

      const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
      if (Number.isFinite(contentLength) && contentLength > AUDIO_MAX_BYTES) {
        throw new Error(`Uploaded audio artifact is too large for v1 scoring (max ${Math.floor(AUDIO_MAX_BYTES / (1024 * 1024))}MB).`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) {
        throw new Error('Uploaded audio artifact file is empty.');
      }
      if (buffer.length > AUDIO_MAX_BYTES) {
        throw new Error(`Uploaded audio artifact is too large for v1 scoring (max ${Math.floor(AUDIO_MAX_BYTES / (1024 * 1024))}MB).`);
      }

      const headerMime = s(response.headers.get('content-type') || '', 120).toLowerCase();
      return {
        absolutePath: '',
        sourceUrl: remoteUrl,
        mimeType: headerMime.startsWith('audio/') ? headerMime : inferAudioMimeType(artifact, remoteUrl),
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

function buildAudioProviderCompatibilityError(providerId = '', modelId = '', mimeType = '') {
  const providerToken = s(providerId, 80).toLowerCase();
  const mimeToken = s(mimeType, 120).toLowerCase();
  if (!providerToken) return '';

  if (providerToken === 'google-gemini' || providerToken === 'google-vertex') return '';

  if (providerToken === 'openai' || providerToken === 'azure-openai') {
    const supported = /audio\/(mpeg|mp3|wav|x-wav)/i.test(mimeToken);
    if (supported) {
      return buildOpenAiAudioModelCompatibilityError(providerToken, modelId, 'Answer Short Question scoring');
    }
    return `Selected provider "${providerToken}" cannot reliably score ${mimeToken || 'this audio format'} in the current PTE Answer Short Question scorer. OpenAI-compatible scoring requires prepared MP3 or WAV audio.`;
  }

  if (providerToken === 'anthropic') {
    return 'Selected provider "anthropic" is not supported for Answer Short Question audio transcription in the current PTE scorer. Use Google Gemini/Vertex, or OpenAI/Azure with MP3 or WAV audio.';
  }

  return `Selected provider "${providerToken}" is not supported for Answer Short Question audio transcription in the current PTE scorer.`;
}

function isGeminiFlashRuntimeProvider(runtimeProvider = {}) {
  const providerId = s(runtimeProvider?.providerId, 80).toLowerCase();
  if (providerId !== 'google-gemini' && providerId !== 'google-vertex') return false;
  const modelToken = s(runtimeProvider?.modelId || runtimeProvider?.modelUsed, 220).toLowerCase();
  return modelToken.includes('flash');
}

async function readAudioArtifactForAi(artifact = {}) {
  const absolutePath = resolveArtifactPath(artifact);
  if (!absolutePath) {
    const remoteAudio = await readRemoteAudioArtifactForAi(artifact);
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
    const remoteAudio = await readRemoteAudioArtifactForAi(artifact);
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

function buildAnswerShortQuestionAnalysisResponseSchema() {
  return {
    type: 'object',
    additionalProperties: true,
    required: ['transcript', 'normalizedAnswer', 'confidence'],
    properties: {
      transcript: { type: 'string' },
      normalizedAnswer: { type: 'string' },
      confidence: { type: 'number' },
      semanticMatch: {
        type: 'object',
        additionalProperties: true,
        properties: {
          isMatch: { type: 'boolean' },
          matchedAnswer: { type: 'string' },
          confidence: { type: 'number' },
          rationale: { type: 'string' }
        }
      },
      speechMetrics: {
        type: 'object',
        additionalProperties: true,
        properties: {
          speechDurationSeconds: { type: 'number' }
        }
      },
      warnings: { type: 'array', items: { type: 'string' } }
    }
  };
}

function buildAudioAnalysisPrompt({
  promptText = '',
  acceptedAnswers = [],
  answerAliases = [],
  allowSemanticMatch = false,
  recordingDurationSeconds = 0
} = {}) {
  return [
    'Analyze the attached PTE Answer Short Question response audio.',
    'Use the audio as the only source for what the candidate said; ignore any typed transcript notes.',
    'Return strict JSON only.',
    'Required JSON keys: transcript, normalizedAnswer, confidence, semanticMatch, speechMetrics, warnings.',
    'transcript must be the words actually spoken by the candidate.',
    'normalizedAnswer should be the shortest factual answer phrase heard in the audio, with filler removed.',
    allowSemanticMatch
      ? 'semanticMatch may be true only when the spoken answer clearly has the same meaning as an accepted answer or alias.'
      : 'semanticMatch must be false unless exact accepted-answer wording is clearly spoken.',
    'Do not infer the correct answer from the prompt or accepted answers.',
    recordingDurationSeconds > 0 ? `Browser-recorded duration: ${round2(recordingDurationSeconds)} seconds.` : '',
    promptText ? `Question prompt context: ${promptText}` : '',
    acceptedAnswers.length ? `Accepted answers: ${acceptedAnswers.join(' | ')}` : '',
    answerAliases.length ? `Answer aliases: ${answerAliases.join(' | ')}` : ''
  ].filter(Boolean).join('\n');
}

async function sendAnswerShortQuestionAudioAnalysisRequest({
  runtimeProvider = {},
  audio = {},
  systemPrompt = '',
  userPrompt = '',
  session = {},
  item = {},
  useStructuredSchema = true,
  requestLabel = 'pte-answer-short-question-scoring-v1'
} = {}) {
  const promptText = useStructuredSchema
    ? userPrompt
    : [
      userPrompt,
      '',
      'Fallback formatting instruction:',
      'Return exactly one JSON object. Do not include markdown, commentary, or extra text.',
      'The JSON object must include transcript, normalizedAnswer, confidence, semanticMatch, speechMetrics, and warnings.'
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
      maxOutputTokens: 1024
    },
    responseMimeType: useStructuredSchema ? 'application/json' : undefined,
    responseSchema: useStructuredSchema ? buildAnswerShortQuestionAnalysisResponseSchema() : undefined,
    disableCache: true,
    requestLabel,
    timeoutMs: 120000,
    usageContext: {
      requestingUser: runtimeProvider.requestingUser || null,
      section: SECTIONS.PTE_SCORING,
      operation: OPERATIONS.AI_SCORING,
      objectId: s(item.id || session.id || 'DRAFT:answer-short-question', 160),
      requestLabel,
      providerRecordId: s(runtimeProvider?.providerRecord?.id, 160),
      providerRecordName: s(runtimeProvider?.providerRecord?.name, 220),
      source: {
        module: 'pte_attempt_scoring',
        eventType: 'answer_short_question_audio_analysis'
      }
    }
  });
}

function buildAnalysisBundleFromProviderResult(result = {}, runtimeProvider = {}, extraWarnings = []) {
  const responseText = s(result?.text || '', 200000);
  const analysis = parseAiAnswerShortQuestionAnalysis(responseText);
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

async function analyzeAnswerShortQuestionAudioWithAi({
  session = {},
  item = {},
  audioArtifact = {},
  promptText = '',
  acceptedAnswers = [],
  answerAliases = [],
  responsePayload = {},
  scoringConfig = {},
  allowSemanticMatch = false,
  requestingUser = null
} = {}) {
  const runtimeProvider = await pteAiProviderDataService.resolveRuntimeProvider(requestingUser, {}, {
    purpose: 'pte_scoring',
    questionType: 'speaking_answer_short_question',
    scorerKey: 'speaking_answer_short_question'
  });
  runtimeProvider.requestingUser = requestingUser;
  const sourceAudio = await readAudioArtifactForAi(audioArtifact);
  const preparedAudio = await prepareAudioForScoringProvider({
    providerId: runtimeProvider.providerId,
    audio: sourceAudio,
    scorerName: 'Answer Short Question scoring',
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
      'You are a careful PTE Answer Short Question audio analysis service.',
      'You do not produce an official Pearson score.',
      'You return evidence-backed JSON for a downstream raw-rubric scorer.',
      'Never score from typed transcript notes; analyze the attached audio.'
    ].join(' ');
    const userPrompt = buildAudioAnalysisPrompt({
      promptText,
      acceptedAnswers,
      answerAliases,
      allowSemanticMatch,
      recordingDurationSeconds,
      scoringConfig
    });
    const primaryUsesStructuredSchema = !isOpenAiCompatibleProvider(runtimeProvider.providerId);
    const shouldRetryLooseJson = isGeminiFlashRuntimeProvider(runtimeProvider)
      || isOpenAiCompatibleProvider(runtimeProvider.providerId);
    const retryWarning = primaryUsesStructuredSchema
      ? 'Gemini Flash returned an unusable structured audio response; scorer retried with a looser JSON-only request.'
      : 'OpenAI-compatible provider returned an unusable Answer Short Question JSON response; scorer retried with a JSON-only request.';
    const primaryRequestDescription = primaryUsesStructuredSchema ? 'Gemini Flash structured audio' : 'OpenAI-compatible JSON audio';

    let primaryResult = null;
    try {
      primaryResult = await sendAnswerShortQuestionAudioAnalysisRequest({
        runtimeProvider,
        audio,
        systemPrompt,
        userPrompt,
        session,
        item,
        useStructuredSchema: primaryUsesStructuredSchema,
        requestLabel: 'pte-answer-short-question-scoring-v1'
      });
    } catch (error) {
      if (!shouldRetryLooseJson) throw error;
      try {
        const retryResult = await sendAnswerShortQuestionAudioAnalysisRequest({
          runtimeProvider,
          audio,
          systemPrompt,
          userPrompt,
          session,
          item,
          useStructuredSchema: false,
          requestLabel: isGeminiFlashRuntimeProvider(runtimeProvider)
            ? 'pte-answer-short-question-scoring-v1-flash-json-retry'
            : 'pte-answer-short-question-scoring-v1-json-retry'
        });
        return attachAudioPreparationMetadata(buildAnalysisBundleFromProviderResult(retryResult, runtimeProvider, [
          `${primaryRequestDescription} request failed first: ${s(error?.message || error, 500) || 'unknown error'}.`,
          retryWarning
        ]), preparedAudio);
      } catch (retryError) {
        const providerLabel = primaryUsesStructuredSchema ? 'Gemini Flash audio analysis' : 'OpenAI-compatible audio analysis';
        const combined = new Error(
          `${providerLabel} failed after primary and fallback attempts. First: ${s(error?.message || error, 500) || 'unknown error'}. Fallback: ${s(retryError?.message || retryError, 500) || 'unknown error'}.`
        );
        combined.code = retryError?.code || error?.code || 'GEMINI_FLASH_AUDIO_ANALYSIS_FAILED';
        throw combined;
      }
    }

    const primaryBundle = buildAnalysisBundleFromProviderResult(primaryResult, runtimeProvider);
    if (!shouldRetryLooseJson || s(primaryBundle?.analysis?.transcript, 50000)) {
      return attachAudioPreparationMetadata(primaryBundle, preparedAudio);
    }

    const retryResult = await sendAnswerShortQuestionAudioAnalysisRequest({
      runtimeProvider,
      audio,
      systemPrompt,
      userPrompt,
      session,
      item,
      useStructuredSchema: false,
      requestLabel: isGeminiFlashRuntimeProvider(runtimeProvider)
        ? 'pte-answer-short-question-scoring-v1-flash-json-retry'
        : 'pte-answer-short-question-scoring-v1-json-retry'
    });
    return attachAudioPreparationMetadata(buildAnalysisBundleFromProviderResult(retryResult, runtimeProvider, [
      ...normalizeWarnings(primaryBundle?.analysis?.warnings || []),
      retryWarning
    ]), preparedAudio);
  } finally {
    await preparedAudio.cleanup();
  }
}

function buildFeedbackDraft({ scoreResult = {}, aiAnalysis = {} } = {}) {
  const match = scoreResult?.evidence?.match || {};
  if (match.isCorrect) {
    return {
      summary: `${round2(scoreResult.scoreFinal || 0)} / ${round2(scoreResult.maxScore || 0)} raw rubric points.`,
      strengths: ['Your spoken answer matched an accepted factual answer.'],
      improvements: [],
      nextPracticeAction: 'Practice another short question and keep the response brief and direct.'
    };
  }

  const heard = s(aiAnalysis?.normalizedAnswer || aiAnalysis?.transcript || '', 500);
  return {
    summary: `${round2(scoreResult.scoreFinal || 0)} / ${round2(scoreResult.maxScore || 0)} raw rubric points.`,
    strengths: heard ? ['The audio had enough speech evidence for evaluation.'] : [],
    improvements: [
      heard
        ? `The spoken answer "${heard}" did not match the accepted answer set.`
        : 'The scorer could not identify a usable spoken answer.',
      'Answer with only the key word or short factual phrase; avoid extra explanation.'
    ],
    nextPracticeAction: 'Replay the prompt, identify the exact factual target, then answer in one or two words.'
  };
}

function makeScoringMetadata({
  status = '',
  answerContext = {},
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
  const rubric = getRubric('speaking_answer_short_question') || {};
  const speechMetrics = safeObject(aiAnalysis?.speechMetrics, {});
  const match = scoreResult?.evidence?.match || {};
  return {
    status,
    scorerKey: 'speaking_answer_short_question',
    scorerVersion: ANSWER_SHORT_QUESTION_SCORER_VERSION,
    scoringContractVersion: microEvaluation ? MICRO_SCORING_CONTRACT_VERSION : 1,
    scoreScale: 'raw_item_rubric_score',
    officialScoreEstimate: false,
    rubricSource: Array.isArray(rubric.rubricSources) ? rubric.rubricSources : [],
    configuredMethod: s(scoringConfig.method || '', 120) || 'hybrid_ai_audio_objective',
    provider: safeObject(provider, {}),
    microRubricVersion: microEvaluation?.microRubricVersion || '',
    microResponses: Array.isArray(microEvaluation?.microResponses) ? microEvaluation.microResponses : [],
    aggregationBreakdown: safeObject(microEvaluation?.aggregationBreakdown, {}),
    legacyDirectModelScores: {},
    promptText: s(answerContext.promptText || '', 5000),
    transcript: s(aiAnalysis?.transcript || '', 50000),
    normalizedAnswer: s(aiAnalysis?.normalizedAnswer || '', 2000),
    acceptedAnswerCount: Array.isArray(answerContext.acceptedAnswers) ? answerContext.acceptedAnswers.length : 0,
    aliasCount: Array.isArray(answerContext.answerAliases) ? answerContext.answerAliases.length : 0,
    caseSensitive: Boolean(answerContext.caseSensitive),
    allowSemanticMatch: Boolean(answerContext.allowSemanticMatch),
    match: safeObject(match, {}),
    vocabulary: {
      score: scoreResult?.traitScores?.vocabulary ?? 0,
      maxScore: scoreResult?.maxScore ?? 1,
      descriptor: match.isCorrect ? 'Appropriate word choice in response' : 'Inappropriate word choice in response'
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
    confidence: normalizeConfidence(aiAnalysis?.confidence),
    warnings: normalizeWarnings([
      ...(Array.isArray(aiAnalysis?.warnings) ? aiAnalysis.warnings : []),
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
    'Answer Short Question audio analysis returned no usable transcript.',
    providerLabel
      ? `Provider response did not include a usable transcript field (${providerLabel}).`
      : 'Provider response did not include a usable transcript field.',
    ...(Array.isArray(aiAnalysis?.warnings) ? aiAnalysis.warnings : [])
  ]);
}

async function scoreAnswerShortQuestionAttemptItem(args = {}, options = {}) {
  const {
    session = {},
    item = {},
    question = {},
    artifacts = [],
    responsePayload = {},
    scoringConfig = {},
    requestingUser = null
  } = args;
  const answerContext = resolveAcceptedAnswerContext(question, item);
  const baseContext = { answerContext, responsePayload, scoringConfig };
  if (!answerContext.acceptedAnswers.length && !answerContext.answerAliases.length) {
    return needsEvidenceResult(['Answer Short Question scoring requires accepted answers in the question payload.'], baseContext);
  }

  const audioArtifact = selectAudioArtifact({ item, artifacts, responsePayload });
  if (!audioArtifact) {
    return needsEvidenceResult([
      'Answer Short Question scoring requires an uploaded audio response.',
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
        answerContext,
        responsePayload,
        scoringConfig,
        requestingUser
      });
    } else if (Object.prototype.hasOwnProperty.call(options, 'aiAnalysis')) {
      analysisBundle = {
        analysis: parseAiAnswerShortQuestionAnalysis(options.aiAnalysis),
        provider: safeObject(options.provider, { providerId: 'test', modelUsed: 'injected' })
      };
    } else {
      analysisBundle = await analyzeAnswerShortQuestionAudioWithAi({
        session,
        item,
        audioArtifact,
        promptText: answerContext.promptText,
        acceptedAnswers: answerContext.acceptedAnswers,
        answerAliases: answerContext.answerAliases,
        allowSemanticMatch: answerContext.allowSemanticMatch,
        responsePayload,
        scoringConfig,
        requestingUser
      });
    }
  } catch (error) {
    return failedResult([
      `Answer Short Question audio analysis failed: ${s(error?.message || error, 800) || 'unknown error'}.`
    ], {
      ...baseContext,
      audioArtifact
    });
  }

  const aiAnalysis = parseAiAnswerShortQuestionAnalysis(
    analysisBundle?.analysis || analysisBundle?.aiAnalysis || analysisBundle
  );
  const provider = safeObject(analysisBundle?.provider, {});
  if (!s(aiAnalysis.transcript, 50000) && !s(aiAnalysis.normalizedAnswer, 2000)) {
    return failedResult(buildMissingTranscriptWarnings(aiAnalysis, provider), {
      ...baseContext,
      aiAnalysis,
      provider,
      audioArtifact
    });
  }

  const scoreResult = calculateAnswerShortQuestionScore({
    transcript: aiAnalysis.transcript,
    normalizedAnswer: aiAnalysis.normalizedAnswer,
    acceptedAnswers: answerContext.acceptedAnswers,
    answerAliases: answerContext.answerAliases,
    caseSensitive: answerContext.caseSensitive,
    allowSemanticMatch: answerContext.allowSemanticMatch,
    semanticMatch: aiAnalysis.semanticMatch,
    scoringConfig
  });
  const feedbackDraft = buildFeedbackDraft({ scoreResult, aiAnalysis, scoringConfig });
  const microEvaluation = buildAnswerShortQuestionMicroEvaluation({
    transcript: aiAnalysis.transcript || aiAnalysis.normalizedAnswer,
    match: scoreResult?.evidence?.match || {},
    confidence: aiAnalysis.confidence
  });
  const metadata = makeScoringMetadata({
    status: 'scored',
    answerContext,
    aiAnalysis,
    scoreResult,
    provider,
    audioArtifact,
    responsePayload,
    scoringConfig,
    warnings: [],
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
  normalizeAnswerText,
  matchAnswerShortQuestion,
  calculateAnswerShortQuestionScore,
  parseAiAnswerShortQuestionAnalysis,
  selectAudioArtifact,
  scoreAnswerShortQuestionAttemptItem,
  analyzeAnswerShortQuestionAudioWithAi
};
