const pteAiProviderDataService = require('./pteAiProviderDataService');
const pteAiProviderService = require('./ai/aiProviderService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');
const {
  LISTENING_SUMMARIZE_SPOKEN_TEXT_SCORER_VERSION,
  WRITING_SUMMARIZE_WRITTEN_TEXT_SCORER_VERSION,
  WRITING_WRITE_EMAIL_SCORER_VERSION,
  getRubric
} = require('./pteScoringRubricRegistry');
const {
  WRITING_SCORING_CONTRACT_VERSION,
  buildWritingMicroAssessmentPrompt,
  buildWritingMicroAssessmentsSchema,
  buildWritingMicroFeedbackRows,
  evaluateWritingMicroAssessments,
  getDefaultWritingTraitMax,
  normalizeWritingMicroAssessmentRows
} = require('./pteWritingMicroAssessmentService');

const WRITING_TYPES = new Set([
  'writing_summarize_written_text',
  'writing_write_email',
  'listening_summarize_spoken_text'
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function s(value, max = 4000) {
  if (value === undefined || value === null) return '';
  const text = String(value).replace(/\0/g, '').trim();
  return text.length > max ? text.slice(0, max) : text;
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

function safeObject(value, fallback = {}) {
  return isPlainObject(value) ? value : fallback;
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
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  };
  return {
    promptTokenCount: normalizeCount(row.promptTokenCount ?? row.inputTokens ?? row.prompt_tokens),
    candidatesTokenCount: normalizeCount(row.candidatesTokenCount ?? row.outputTokens ?? row.completion_tokens),
    totalTokenCount: normalizeCount(row.totalTokenCount ?? row.totalTokens ?? row.total_tokens),
    cachedContentTokenCount: normalizeCount(row.cachedContentTokenCount ?? row.cachedTokens)
  };
}

function countWords(text = '') {
  const tokens = s(text, 200000).match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu);
  return Array.isArray(tokens) ? tokens.length : 0;
}

function countSentences(text = '') {
  const normalized = s(text, 200000);
  if (!normalized) return 0;
  const matches = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  return matches.map((row) => s(row)).filter(Boolean).length;
}

function normalizeTextArray(value = [], maxItems = 20) {
  const rows = Array.isArray(value) ? value : String(value || '').split(/\r?\n|;/);
  return rows.map((row) => s(row, 800)).filter(Boolean).slice(0, maxItems);
}

function extractJsonPayload(input = '') {
  const text = s(input, 200000);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    // Continue with markdown/object extraction.
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_) {
      // Continue with first object extraction.
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

function parseAiWritingAnalysis(input = {}) {
  const parsed = typeof input === 'string'
    ? extractJsonPayload(input)
    : (isPlainObject(input) ? input : null);
  if (!isPlainObject(parsed)) {
    return {
      microAssessments: [],
      confidence: 0,
      languageNotes: '',
      warnings: ['AI Writing analysis did not return valid JSON.']
    };
  }
  return {
    microAssessments: normalizeWritingMicroAssessmentRows(parsed),
    microResponses: normalizeWritingMicroAssessmentRows(parsed),
    confidence: normalizeConfidence(parsed.confidence),
    languageNotes: s(parsed.languageNotes || parsed.notes || '', 2000),
    warnings: normalizeWarnings(parsed.warnings || parsed.warning || [])
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

function resolveWritingContext(questionType = '', question = {}, item = {}) {
  const payload = resolveQuestionPayload(question, item);
  if (questionType === 'writing_summarize_written_text' || questionType === 'listening_summarize_spoken_text') {
    const isListeningSummary = questionType === 'listening_summarize_spoken_text';
    return {
      sourceTitle: s(payload.sourceTitle || (isListeningSummary ? 'Spoken Text Transcript' : ''), 250),
      sourceText: s(payload.sourceText || payload.transcript || '', 20000),
      expectedSummary: s(payload.expectedSummary || '', 6000),
      expectedKeyPoints: normalizeTextArray(payload.expectedKeyPoints || [], 12),
      minWords: Math.max(0, Math.floor(toFiniteNumber(payload.minWords, isListeningSummary ? 50 : 5))),
      maxWords: Math.max(0, Math.floor(toFiniteNumber(payload.maxWords, isListeningSummary ? 70 : 75))),
      recommendedTimeMinutes: Math.max(0, Math.floor(toFiniteNumber(payload.recommendedTimeMinutes, 10)))
    };
  }
  return {
    scenarioText: s(payload.scenarioText || '', 20000),
    recipientRole: s(payload.recipientRole || '', 200),
    senderRole: s(payload.senderRole || '', 200),
    purpose: s(payload.purpose || '', 500),
    requiredPoints: normalizeTextArray(payload.requiredPoints || [], 20),
    targetRegister: s(payload.targetRegister || '', 200),
    suggestedSubject: s(payload.suggestedSubject || '', 250),
    expectedTone: s(payload.expectedTone || '', 200),
    minWords: Math.max(0, Math.floor(toFiniteNumber(payload.minWords, 50))),
    maxWords: Math.max(0, Math.floor(toFiniteNumber(payload.maxWords, 120)))
  };
}

function extractResponseText(responsePayload = {}, item = {}) {
  const payload = safeObject(responsePayload, {});
  return s(
    payload.text
      || payload.responseText
      || payload.answerText
      || payload.writingText
      || safeObject(item?.metadata, {}).responseText
      || '',
    200000
  );
}

function resolveTraitMax(questionType = '', scoringConfig = {}) {
  const defaults = getDefaultWritingTraitMax(questionType);
  const configured = safeObject(scoringConfig?.traitMax || scoringConfig?.traitsMax, {});
  return Object.keys(defaults).reduce((acc, trait) => {
    const directValue = scoringConfig?.[`${trait}Max`];
    const value = configured[trait] ?? directValue ?? defaults[trait];
    acc[trait] = Math.max(0, toFiniteNumber(value, defaults[trait]));
    return acc;
  }, {});
}

function buildDeterministicMicroAssessments(questionType = '', writingContext = {}, responseText = '') {
  const wordCount = countWords(responseText);
  const minWords = Math.max(0, toFiniteNumber(writingContext.minWords, 0));
  const maxWords = Math.max(0, toFiniteNumber(writingContext.maxWords, 0));
  const withinLimit = wordCount >= minWords && (maxWords <= 0 || wordCount <= maxWords);
  const rows = [
    {
      id: 'form_word_limit',
      choice: withinLimit ? 'yes' : 'no',
      evidence: maxWords > 0
        ? `${wordCount} word(s), expected ${minWords}-${maxWords}.`
        : `${wordCount} word(s), expected at least ${minWords}.`,
      confidence: 1
    }
  ];

  if (questionType === 'writing_summarize_written_text' || questionType === 'listening_summarize_spoken_text') {
    const sentenceCount = countSentences(responseText);
    rows.push({
      id: 'form_single_sentence',
      choice: sentenceCount === 1 ? 'yes' : (sentenceCount === 2 ? 'partial' : 'no'),
      evidence: `${sentenceCount} sentence(s) detected; Summarize Written Text expects one sentence.`,
      confidence: 0.95
    });
  }

  if (questionType === 'writing_write_email') {
    const lower = responseText.toLowerCase();
    const hasGreeting = /(^|\n)\s*(dear|hello|hi|good morning|good afternoon)\b/.test(lower);
    const hasClosing = /\b(regards|sincerely|best regards|kind regards|thank you|thanks)\b/.test(lower);
    rows.push({
      id: 'email_greeting_closing',
      choice: hasGreeting && hasClosing ? 'yes' : (hasGreeting || hasClosing ? 'partial' : 'no'),
      evidence: `Greeting detected: ${hasGreeting ? 'yes' : 'no'}; closing/sign-off detected: ${hasClosing ? 'yes' : 'no'}.`,
      confidence: 0.9
    });
    rows.push({
      id: 'form_email_shape',
      choice: /^(\s*[-*]|\s*\d+[.)])/m.test(responseText) ? 'partial' : 'yes',
      evidence: 'Response was checked for email-like prose versus note/bullet structure.',
      confidence: 0.8
    });
  }

  return rows;
}

function mergeMicroAssessments(aiRows = [], deterministicRows = []) {
  const byId = new Map();
  (Array.isArray(aiRows) ? aiRows : []).forEach((row) => {
    if (row?.id) byId.set(row.id, row);
  });
  (Array.isArray(deterministicRows) ? deterministicRows : []).forEach((row) => {
    if (row?.id) byId.set(row.id, row);
  });
  return Array.from(byId.values());
}

function buildWritingAnalysisResponseSchema() {
  return {
    type: 'object',
    additionalProperties: true,
    required: ['microAssessments', 'confidence', 'warnings'],
    properties: {
      microAssessments: buildWritingMicroAssessmentsSchema(),
      confidence: { type: 'number' },
      languageNotes: { type: 'string' },
      warnings: { type: 'array', items: { type: 'string' } }
    }
  };
}

function buildWritingPrompt({ questionType = '', writingContext = {}, responseText = '' } = {}) {
  const promptParts = [
    `Question type: ${questionType}.`,
    'Assess the candidate written response using only the prompt context and candidate response below.',
    'Return strict JSON only.',
    'Required JSON keys: microAssessments, confidence, languageNotes, warnings.',
    'Do not provide final numeric trait scores; the server will aggregate fixed micro-assessment choices.',
    buildWritingMicroAssessmentPrompt(questionType),
    '',
    'Prompt context:',
    (questionType === 'writing_summarize_written_text' || questionType === 'listening_summarize_spoken_text')
      ? [
        writingContext.sourceTitle ? `Source title: ${writingContext.sourceTitle}` : '',
        `Source text: ${writingContext.sourceText}`,
        writingContext.expectedSummary ? `Expected summary/context: ${writingContext.expectedSummary}` : '',
        writingContext.expectedKeyPoints?.length ? `Expected key points: ${writingContext.expectedKeyPoints.join(' | ')}` : '',
        `Word limit: ${writingContext.minWords}-${writingContext.maxWords}`
      ].filter(Boolean).join('\n')
      : [
        `Scenario: ${writingContext.scenarioText}`,
        `Recipient role: ${writingContext.recipientRole}`,
        writingContext.senderRole ? `Sender role: ${writingContext.senderRole}` : '',
        `Purpose: ${writingContext.purpose}`,
        writingContext.requiredPoints?.length ? `Required points: ${writingContext.requiredPoints.join(' | ')}` : '',
        writingContext.targetRegister ? `Target register: ${writingContext.targetRegister}` : '',
        writingContext.expectedTone ? `Expected tone: ${writingContext.expectedTone}` : '',
        `Word limit: ${writingContext.minWords}-${writingContext.maxWords}`
      ].filter(Boolean).join('\n'),
    '',
    'Candidate response:',
    responseText
  ];
  return promptParts.filter(Boolean).join('\n');
}

async function sendWritingAnalysisRequest({
  runtimeProvider = {},
  questionType = '',
  writingContext = {},
  responseText = '',
  session = {},
  item = {},
  useStructuredSchema = true,
  requestLabel = ''
} = {}) {
  const prompt = buildWritingPrompt({ questionType, writingContext, responseText });
  const fallbackPrompt = useStructuredSchema
    ? prompt
    : [
      prompt,
      '',
      'Fallback formatting instruction:',
      'Return exactly one JSON object. Do not include markdown, commentary, or extra text.',
      'The JSON object must include microAssessments, confidence, languageNotes, and warnings.'
    ].join('\n');

  return pteAiProviderService.sendPrompt({
    messages: [
      {
        role: 'system',
        content: 'You are a careful PTE Writing micro-assessment service. Return evidence-backed JSON only.'
      },
      {
        role: 'user',
        content: fallbackPrompt
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
    responseSchema: useStructuredSchema ? buildWritingAnalysisResponseSchema() : undefined,
    disableCache: true,
    requestLabel,
    timeoutMs: 120000,
    usageContext: {
      requestingUser: runtimeProvider.requestingUser || null,
      section: SECTIONS.PTE_SCORING,
      operation: OPERATIONS.AI_SCORING,
      objectId: s(item.id || session.id || `DRAFT:${questionType}`, 160),
      requestLabel,
      providerRecordId: s(runtimeProvider?.providerRecord?.id, 160),
      providerRecordName: s(runtimeProvider?.providerRecord?.name, 220),
      source: {
        module: 'pte_attempt_scoring',
        eventType: `${questionType}_text_analysis`
      }
    }
  });
}

function buildAnalysisBundleFromProviderResult(result = {}, runtimeProvider = {}, extraWarnings = []) {
  const responseText = s(result?.text || '', 200000);
  const analysis = parseAiWritingAnalysis(responseText);
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

async function analyzeWritingWithAi({
  questionType = '',
  session = {},
  item = {},
  writingContext = {},
  responseText = '',
  requestingUser = null
} = {}, options = {}) {
  if (isPlainObject(options.aiAnalysis)) {
    return {
      analysis: parseAiWritingAnalysis(options.aiAnalysis),
      provider: safeObject(options.provider, {})
    };
  }

  const runtimeProvider = await pteAiProviderDataService.resolveRuntimeProvider(requestingUser, {}, {
    purpose: 'pte_scoring',
    questionType,
    scorerKey: questionType
  });
  runtimeProvider.requestingUser = requestingUser;
  const requestBase = questionType === 'writing_write_email'
    ? 'pte-writing-email-scoring-v1'
    : (questionType === 'listening_summarize_spoken_text'
      ? 'pte-listening-summary-scoring-v1'
      : 'pte-writing-summary-scoring-v1');

  const primaryResult = await sendWritingAnalysisRequest({
    runtimeProvider,
    questionType,
    writingContext,
    responseText,
    session,
    item,
    useStructuredSchema: true,
    requestLabel: requestBase
  });
  const primaryBundle = buildAnalysisBundleFromProviderResult(primaryResult, runtimeProvider);
  const deterministicRows = buildDeterministicMicroAssessments(questionType, writingContext, responseText);
  const primaryRows = mergeMicroAssessments(primaryBundle.analysis.microAssessments, deterministicRows);
  const primaryEvaluation = evaluateWritingMicroAssessments({
    questionType,
    aiAnalysis: { microAssessments: primaryRows },
    traitMax: resolveTraitMax(questionType, {})
  });
  if (primaryEvaluation.ok || primaryEvaluation.invalidResponses?.length) {
    primaryBundle.analysis.microAssessments = primaryRows;
    primaryBundle.analysis.microResponses = primaryRows;
    return primaryBundle;
  }

  const retryResult = await sendWritingAnalysisRequest({
    runtimeProvider,
    questionType,
    writingContext,
    responseText,
    session,
    item,
    useStructuredSchema: false,
    requestLabel: `${requestBase}-json-retry`
  });
  const retryBundle = buildAnalysisBundleFromProviderResult(retryResult, runtimeProvider, [
    'Writing scorer retried with a looser JSON-only request after required micro-assessments were missing.'
  ]);
  retryBundle.analysis.microAssessments = mergeMicroAssessments(retryBundle.analysis.microAssessments, deterministicRows);
  retryBundle.analysis.microResponses = retryBundle.analysis.microAssessments;
  retryBundle.provider = {
    ...safeObject(primaryBundle.provider, {}),
    tokenUsage: {
      promptTokenCount: null,
      candidatesTokenCount: null,
      totalTokenCount: null,
      cachedContentTokenCount: null
    },
    writingRetry: safeObject(retryBundle.provider, {})
  };
  return retryBundle;
}

function calculateWritingScore({ questionType = '', microTraitScores = {}, scoringConfig = {} } = {}) {
  const traitMax = resolveTraitMax(questionType, scoringConfig);
  const traitScores = Object.keys(traitMax).reduce((acc, trait) => {
    acc[trait] = Math.max(0, Math.min(traitMax[trait], Math.round(toFiniteNumber(microTraitScores?.[trait], 0))));
    return acc;
  }, {});
  const maxScore = Object.values(traitMax).reduce((sum, value) => sum + toFiniteNumber(value, 0), 0);
  const scoreFinal = Object.values(traitScores).reduce((sum, value) => sum + toFiniteNumber(value, 0), 0);
  return {
    scoreRaw: scoreFinal,
    scoreFinal,
    maxScore,
    percentage: maxScore > 0 ? round2((scoreFinal / maxScore) * 100) : 0,
    traitScores,
    evidence: {
      traitMax
    }
  };
}

function describeBand(value = 0, max = 1) {
  const ratio = max > 0 ? Number(value || 0) / max : 0;
  if (ratio >= 0.8) return 'Good';
  if (ratio >= 0.55) return 'Developing';
  return 'Needs work';
}

function buildFeedbackDraft({ questionType = '', scoreResult = {}, writingContext = {}, responseText = '', microEvaluation = null } = {}) {
  const traitScores = safeObject(scoreResult.traitScores, {});
  const traitMax = safeObject(scoreResult.evidence?.traitMax, {});
  const microFeedback = buildWritingMicroFeedbackRows(microEvaluation || {});
  const strengths = [];
  const improvements = [];

  Object.entries(traitMax).forEach(([trait, max]) => {
    const score = toFiniteNumber(traitScores[trait], 0);
    const label = trait === 'emailConventions' ? 'Email conventions' : trait.charAt(0).toUpperCase() + trait.slice(1);
    if (max > 0 && score / max >= 0.8) strengths.push(`${label} is strong (${score}/${max}).`);
    else improvements.push(`${label} needs attention (${score}/${max}).`);
  });

  strengths.push(...microFeedback.strengths.slice(0, 4));
  improvements.push(...microFeedback.improvements.slice(0, 5));

  const wordCount = countWords(responseText);
  const withinLimit = wordCount >= toFiniteNumber(writingContext.minWords, 0)
    && (toFiniteNumber(writingContext.maxWords, 0) <= 0 || wordCount <= toFiniteNumber(writingContext.maxWords, 0));
  if (!withinLimit) {
    improvements.unshift(`Adjust length: ${wordCount} words, expected ${writingContext.minWords}-${writingContext.maxWords}.`);
  }

  return {
    summary: `${round2(scoreResult.scoreFinal || 0)} / ${round2(scoreResult.maxScore || 0)} raw rubric points.`,
    strengths: strengths.length ? strengths : ['The response has enough written evidence for scoring.'],
    improvements: improvements.length ? improvements : ['Keep the same structure and polish language accuracy.'],
    nextPracticeAction: questionType === 'writing_write_email'
      ? 'Before writing again, list the recipient, purpose, required points, tone, and closing, then draft the email in that order.'
      : (questionType === 'listening_summarize_spoken_text'
        ? 'Replay the audio mentally, note the main idea and key details, then produce one concise summary sentence.'
        : 'Before writing again, underline the main idea and two key points, then combine them into one concise sentence.')
  };
}

function makeScoringMetadata({
  status = '',
  questionType = '',
  writingContext = {},
  responseText = '',
  aiAnalysis = null,
  scoreResult = null,
  provider = {},
  responsePayload = {},
  scoringConfig = {},
  warnings = [],
  feedbackDraft = null,
  microEvaluation = null
} = {}) {
  const rubric = getRubric(questionType) || {};
  const traitMax = safeObject(scoreResult?.evidence?.traitMax, resolveTraitMax(questionType, scoringConfig));
  return {
    status,
    scorerKey: questionType,
    scorerVersion: questionType === 'writing_write_email'
      ? WRITING_WRITE_EMAIL_SCORER_VERSION
      : (questionType === 'listening_summarize_spoken_text'
        ? LISTENING_SUMMARIZE_SPOKEN_TEXT_SCORER_VERSION
        : WRITING_SUMMARIZE_WRITTEN_TEXT_SCORER_VERSION),
    scoringContractVersion: microEvaluation ? WRITING_SCORING_CONTRACT_VERSION : 1,
    scoreScale: 'raw_item_rubric_score',
    officialScoreEstimate: false,
    rubricSource: Array.isArray(rubric.rubricSources) ? rubric.rubricSources : [],
    configuredMethod: s(scoringConfig.method || '', 120) || 'hybrid_ai_micro_assessment',
    provider: safeObject(provider, {}),
    microAssessmentVersion: microEvaluation?.microAssessmentVersion || '',
    microRubricVersion: microEvaluation?.microAssessmentVersion || '',
    microAssessments: Array.isArray(microEvaluation?.microAssessments) ? microEvaluation.microAssessments : [],
    microResponses: Array.isArray(microEvaluation?.microResponses) ? microEvaluation.microResponses : [],
    aggregationBreakdown: safeObject(microEvaluation?.aggregationBreakdown, {}),
    legacyDirectModelScores: {},
    writingContext,
    responseText: s(responseText, 50000),
    responseWordCount: countWords(responseText),
    responseSentenceCount: countSentences(responseText),
    traitMax,
    ...Object.keys(traitMax).reduce((acc, trait) => {
      acc[trait] = {
        score: scoreResult?.traitScores?.[trait] ?? 0,
        maxScore: traitMax[trait],
        descriptor: describeBand(scoreResult?.traitScores?.[trait] ?? 0, traitMax[trait])
      };
      return acc;
    }, {}),
    confidence: toFiniteNumber(aiAnalysis?.confidence, 0),
    languageNotes: s(aiAnalysis?.languageNotes || '', 2000),
    warnings: normalizeWarnings([
      ...(Array.isArray(aiAnalysis?.warnings) ? aiAnalysis.warnings : []),
      ...(Array.isArray(microEvaluation?.warnings) ? microEvaluation.warnings : []),
      ...warnings
    ]),
    feedbackDraft: feedbackDraft || null,
    scoredAt: new Date().toISOString(),
    responsePayloadMeta: {
      textLength: s(responseText, 200000).length,
      browserWordCount: toFiniteNumber(responsePayload.wordCount, 0)
    }
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

async function scoreWritingAttemptItem(args = {}, options = {}) {
  const {
    session = {},
    item = {},
    question = {},
    responsePayload = {},
    scoringConfig = {},
    requestingUser = null
  } = args;
  const questionType = s(item.questionType || question.questionType, 120).toLowerCase();
  const baseContext = {
    questionType,
    scoringConfig
  };
  if (!WRITING_TYPES.has(questionType)) {
    return failedResult(['Unsupported Writing scorer question type.'], baseContext);
  }
  const writingContext = resolveWritingContext(questionType, question, item);
  const responseText = extractResponseText(responsePayload, item);
  const contextWarnings = [];
  if (questionType === 'writing_summarize_written_text' && !writingContext.sourceText) {
    contextWarnings.push('Summarize Written Text scoring requires source text from the question payload.');
  }
  if (
    questionType === 'listening_summarize_spoken_text'
    && !writingContext.sourceText
    && !writingContext.expectedSummary
    && !writingContext.expectedKeyPoints.length
  ) {
    contextWarnings.push('Summarize Spoken Text scoring requires transcript or expected summary context in the question payload.');
  }
  if (questionType === 'writing_write_email') {
    if (!writingContext.scenarioText) contextWarnings.push('Write Email scoring requires scenario text from the question payload.');
    if (!writingContext.purpose) contextWarnings.push('Write Email scoring requires purpose from the question payload.');
    if (!writingContext.requiredPoints.length) contextWarnings.push('Write Email scoring requires required points from the question payload.');
  }
  if (!responseText) contextWarnings.push('Writing scoring requires a typed response.');
  if (contextWarnings.length) {
    return needsEvidenceResult(contextWarnings, {
      ...baseContext,
      writingContext,
      responseText,
      responsePayload
    });
  }

  let analysisBundle = null;
  try {
    analysisBundle = await analyzeWritingWithAi({
      questionType,
      session,
      item,
      writingContext,
      responseText,
      requestingUser
    }, options);
  } catch (error) {
    return failedResult([
      `Writing analysis failed: ${s(error?.message || error, 800) || 'unknown error'}.`
    ], {
      ...baseContext,
      writingContext,
      responseText,
      responsePayload
    });
  }

  const aiAnalysis = parseAiWritingAnalysis(analysisBundle?.analysis || analysisBundle?.aiAnalysis || analysisBundle);
  const deterministicRows = buildDeterministicMicroAssessments(questionType, writingContext, responseText);
  aiAnalysis.microAssessments = mergeMicroAssessments(aiAnalysis.microAssessments, deterministicRows);
  aiAnalysis.microResponses = aiAnalysis.microAssessments;
  const provider = safeObject(analysisBundle?.provider, {});
  const traitMax = resolveTraitMax(questionType, scoringConfig);
  const microEvaluation = evaluateWritingMicroAssessments({
    questionType,
    aiAnalysis,
    traitMax
  });
  if (!microEvaluation.ok) {
    return failedResult(microEvaluation.warnings, {
      ...baseContext,
      writingContext,
      responseText,
      aiAnalysis,
      provider,
      responsePayload,
      microEvaluation
    });
  }

  const scoreResult = calculateWritingScore({
    questionType,
    microTraitScores: microEvaluation.traitScores,
    scoringConfig
  });
  const feedbackDraft = buildFeedbackDraft({
    questionType,
    scoreResult,
    writingContext,
    responseText,
    microEvaluation
  });
  const metadata = makeScoringMetadata({
    status: 'scored',
    questionType,
    writingContext,
    responseText,
    aiAnalysis,
    scoreResult,
    provider,
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
  calculateWritingScore,
  parseAiWritingAnalysis,
  resolveWritingContext,
  scoreWritingAttemptItem
};
