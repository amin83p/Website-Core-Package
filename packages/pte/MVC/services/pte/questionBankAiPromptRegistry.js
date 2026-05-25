const SUPPORTED_TYPES = Object.freeze([
  'speaking_read_aloud',
  'speaking_repeat_sentence',
  'speaking_answer_short_question',
  'writing_summarize_written_text',
  'writing_write_email',
  'reading_mcq_single',
  'reading_mcq_multiple',
  'reading_writing_fill_in_blank',
  'reading_fill_in_blank',
  'reading_reorder_paragraphs',
  'listening_mcq_single',
  'listening_select_missing_word',
  'listening_mcq_multiple',
  'listening_fill_in_blank',
  'listening_highlight_incorrect_words',
  'listening_dictation',
  'listening_summarize_spoken_text',
  'speaking_respond_to_situation',
  'speaking_describe_image'
]);

const TARGET_REGISTERS = Object.freeze(['formal', 'neutral', 'informal']);
const POLITENESS_LEVELS = Object.freeze(['high', 'medium', 'low']);
const PREP_TIME_RANGE = Object.freeze({ min: 20, max: 30 });
const RESPONSE_TIME_RANGE = Object.freeze({ min: 30, max: 45 });
const REPEAT_SENTENCE_RESPONSE_RANGE = Object.freeze({ min: 8, max: 30 });
const WRITING_SUMMARY_WORD_RANGE = Object.freeze({ min: 5, max: 75, fallbackMin: 5, fallbackMax: 75 });
const WRITING_SUMMARY_TIME_RANGE = Object.freeze({ min: 1, max: 30, fallback: 10 });
const LISTENING_SUMMARY_WORD_RANGE = Object.freeze({ min: 1, max: 400, fallbackMin: 50, fallbackMax: 70 });
const LISTENING_SUMMARY_TIME_RANGE = Object.freeze({ min: 1, max: 60, fallback: 10 });
const MCQ_OPTION_RANGE = Object.freeze({ min: 2, max: 6 });
const REORDER_PARAGRAPH_RANGE = Object.freeze({ min: 2, max: 12 });
const SCORING_WPM_RANGE = Object.freeze({ min: 40, max: 260 });
const SCORING_RATIO_RANGE = Object.freeze({ min: 0, max: 1 });
const TRAIT_WEIGHT_SUM_TOLERANCE = 0.01;
const DICTATION_NORMALIZATION_RULE_DEFAULTS = Object.freeze({
  caseSensitive: false,
  ignorePunctuation: true,
  normalizeWhitespace: true,
  normalizeQuotes: true
});
const PTE_TEST_TYPES = Object.freeze(['core', 'academic']);

function s(value) {
  return String(value ?? '').trim();
}

function normalizeQuestionType(value) {
  return s(value).toLowerCase();
}

function normalizeTestType(value) {
  const token = s(value).toLowerCase();
  return PTE_TEST_TYPES.includes(token) ? token : '';
}

function safePayload(payload = {}) {
  return (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
}

function safeScoring(scoring = {}) {
  return (scoring && typeof scoring === 'object' && !Array.isArray(scoring)) ? scoring : {};
}

function toScopedField(scope, key) {
  return { scope, key };
}

function splitReorderPassageIntoParagraphItems(text = '') {
  const source = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!source) return [];

  const fromBlankLines = source
    .split(/\n\s*\n+/)
    .map((row) => s(row))
    .filter(Boolean);
  if (fromBlankLines.length >= REORDER_PARAGRAPH_RANGE.min) return fromBlankLines;

  const fromLines = source
    .split(/\n+/)
    .map((row) => s(row))
    .filter(Boolean);
  if (fromLines.length >= REORDER_PARAGRAPH_RANGE.min) return fromLines;

  const sentences = source
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\[])/)
    .map((row) => s(row))
    .filter(Boolean);
  if (sentences.length <= 1) return source ? [source] : [];

  const totalWords = sentences.reduce((acc, row) => acc + row.split(/\s+/).filter(Boolean).length, 0);
  const desiredParagraphCount = Math.max(2, Math.min(6, Math.round(totalWords / 80)));
  const groupSize = Math.max(1, Math.ceil(sentences.length / desiredParagraphCount));
  const grouped = [];
  for (let i = 0; i < sentences.length; i += groupSize) {
    const chunk = sentences.slice(i, i + groupSize).join(' ').trim();
    if (chunk) grouped.push(chunk);
  }
  return grouped.length ? grouped : (source ? [source] : []);
}

function getListeningSummaryPolicyInstructions(testType = '') {
  const normalized = normalizeTestType(testType);
  if (normalized === 'core') {
    return [
      'For PTE Core: expectedSummary should use practical everyday/workplace/community context language and remain clear, direct, and functional.',
      'For PTE Core: avoid heavy academic jargon unless the transcript itself uses it; prioritize practical intent, action, and outcome.',
      'For PTE Core: expectedKeyPoints should emphasize what happened, what matters, and what should be done/understood next.'
    ];
  }
  if (normalized === 'academic') {
    return [
      'For PTE Academic: expectedSummary should use a formal academic register suitable for lectures/seminars.',
      'For PTE Academic: capture the central claim/topic, key supporting evidence or examples, and the conclusion/implication.',
      'For PTE Academic: expectedKeyPoints should emphasize concept relationships, rationale, and evidence-based takeaways.'
    ];
  }
  return [
    'For listening summarize spoken text: use an exam-appropriate neutral-formal register aligned with the provided testType/context.'
  ];
}

function getWritingSummaryPolicyInstructions(testType = '') {
  const normalized = normalizeTestType(testType);
  if (normalized === 'core') {
    return [
      'For PTE Core writing summarize written text: keep language clear and practical with everyday clarity.',
      'For PTE Core writing summarize written text: expectedSummary should be concise and functional while preserving the central idea and key support.',
      'For PTE Core writing summarize written text: expectedKeyPoints should capture concrete actions/outcomes and the main message.'
    ];
  }
  if (normalized === 'academic') {
    return [
      'For PTE Academic writing summarize written text: use a formal academic register.',
      'For PTE Academic writing summarize written text: expectedSummary should preserve the thesis/main claim and critical supporting evidence.',
      'For PTE Academic writing summarize written text: expectedKeyPoints should capture concept relationships, rationale, and conclusions.'
    ];
  }
  return [
    'For writing summarize written text: use a neutral-formal exam style aligned with testType.'
  ];
}

const PROFILE_MAP = Object.freeze({
  speaking_read_aloud: Object.freeze({
    requiredContextError: 'Source Text is required before using AI Assist for Read Aloud.',
    payloadFields: Object.freeze([
      'referenceTranscript',
      'pronunciationNotes',
      'prepTimeSeconds',
      'responseTimeSeconds'
    ]),
    scoringFields: Object.freeze([
      'method',
      'scorerVersion',
      'maxScoreMode',
      'maxScore',
      'traits',
      'contentScoringMode',
      'pronunciationMax',
      'fluencyMax',
      'idealWpmMin',
      'idealWpmMax',
      'longPauseSeconds',
      'minAnalysisConfidence'
    ]),
    payloadSchema: Object.freeze({
      referenceTranscript: { type: 'string' },
      pronunciationNotes: { type: 'string' },
      prepTimeSeconds: { type: 'integer', minimum: PREP_TIME_RANGE.min, maximum: PREP_TIME_RANGE.max },
      responseTimeSeconds: { type: 'integer', minimum: RESPONSE_TIME_RANGE.min, maximum: RESPONSE_TIME_RANGE.max }
    }),
    scoringSchema: Object.freeze({
      method: { type: 'string' },
      scorerVersion: { type: 'string' },
      maxScoreMode: {
        type: 'string',
        enum: ['dynamic_source_word_count_plus_traits', 'fixed']
      },
      maxScore: { type: 'number', minimum: 0.000001 },
      traits: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 6
      },
      contentScoringMode: { type: 'string', enum: ['word_alignment_errors'] },
      pronunciationMax: { type: 'number', minimum: 0.000001, maximum: 5 },
      fluencyMax: { type: 'number', minimum: 0.000001, maximum: 5 },
      idealWpmMin: { type: 'integer', minimum: SCORING_WPM_RANGE.min, maximum: SCORING_WPM_RANGE.max },
      idealWpmMax: { type: 'integer', minimum: SCORING_WPM_RANGE.min, maximum: SCORING_WPM_RANGE.max },
      longPauseSeconds: { type: 'number', minimum: 0.5, maximum: 10 },
      minAnalysisConfidence: { type: 'number', minimum: SCORING_RATIO_RANGE.min, maximum: SCORING_RATIO_RANGE.max }
    }),
    buildContext(questionPlan = {}) {
      const payload = safePayload(questionPlan.payload);
      const scoringConfig = safeScoring(questionPlan.scoringConfig);
      const sourceText = s(payload.sourceText);
      if (!sourceText) {
        throw new Error('Source Text is required before using AI Assist for Read Aloud.');
      }
      return {
        title: s(questionPlan.title || ''),
        testType: s(questionPlan.testType || ''),
        skill: s(questionPlan.skill || ''),
        questionType: 'speaking_read_aloud',
        instructions: s(questionPlan.instructions || ''),
        payload: {
          sourceText,
          referenceTranscript: s(payload.referenceTranscript || '')
        },
        scoringConfig
      };
    }
  }),
  speaking_repeat_sentence: Object.freeze({
    requiredContextError: 'Expected Transcript or Prompt Audio Asset is required before using AI Assist for Repeat Sentence.',
    payloadFields: Object.freeze([
      'expectedTranscript',
      'transcriptVariants',
      'responseTimeSeconds'
    ]),
    scoringFields: Object.freeze([
      'method',
      'maxScore',
      'traits'
    ]),
    payloadSchema: Object.freeze({
      expectedTranscript: { type: 'string' },
      transcriptVariants: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        maxItems: 6
      },
      responseTimeSeconds: {
        type: 'integer',
        minimum: REPEAT_SENTENCE_RESPONSE_RANGE.min,
        maximum: REPEAT_SENTENCE_RESPONSE_RANGE.max
      }
    }),
    scoringSchema: Object.freeze({
      method: { type: 'string' },
      maxScore: { type: 'number', minimum: 0.000001 },
      traits: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 6
      }
    }),
    buildContext(questionPlan = {}) {
      const payload = safePayload(questionPlan.payload);
      const scoringConfig = safeScoring(questionPlan.scoringConfig);
      const expectedTranscript = s(payload.expectedTranscript);
      const promptAudioAssetId = s(payload.promptAudioAssetId);
      if (!expectedTranscript && !promptAudioAssetId) {
        throw new Error('Expected Transcript or Prompt Audio Asset is required before using AI Assist for Repeat Sentence.');
      }
      return {
        title: s(questionPlan.title || ''),
        testType: s(questionPlan.testType || ''),
        skill: s(questionPlan.skill || ''),
        questionType: 'speaking_repeat_sentence',
        instructions: s(questionPlan.instructions || ''),
        payload: {
          promptAudioAssetId,
          expectedTranscript,
          transcriptVariants: Array.isArray(payload.transcriptVariants) ? payload.transcriptVariants : []
        },
        scoringConfig
      };
    }
  }),
  reading_mcq_single: Object.freeze({
    requiredContextError: 'Reading Text and Question Stem are required before using AI Assist for Reading MCQ Single.',
    payloadFields: Object.freeze([
      'passageTitle',
      'options',
      'correctOptionKey',
      'explanation'
    ]),
    scoringFields: Object.freeze([
      'method',
      'maxScore'
    ]),
    payloadSchema: Object.freeze({
      passageTitle: { type: 'string' },
      options: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key', 'text'],
          properties: {
            key: { type: 'string' },
            text: { type: 'string' }
          }
        },
        minItems: MCQ_OPTION_RANGE.min,
        maxItems: MCQ_OPTION_RANGE.max
      },
      correctOptionKey: { type: 'string' },
      explanation: { type: 'string' }
    }),
    scoringSchema: Object.freeze({
      method: { type: 'string' },
      maxScore: { type: 'number', minimum: 0.000001 }
    }),
    buildContext(questionPlan = {}) {
      const payload = safePayload(questionPlan.payload);
      const scoringConfig = safeScoring(questionPlan.scoringConfig);
      const passageHtml = s(payload.passageHtml);
      const stem = s(payload.stem);
      if (!passageHtml || !stem) {
        throw new Error('Reading Text and Question Stem are required before using AI Assist for Reading MCQ Single.');
      }
      const options = Array.isArray(payload.options)
        ? payload.options.slice(0, MCQ_OPTION_RANGE.max).map((item) => {
          const row = (item && typeof item === 'object' && !Array.isArray(item)) ? item : {};
          return {
            key: s(row.key || ''),
            text: s(row.text || '')
          };
        })
        : [];
      return {
        title: s(questionPlan.title || ''),
        testType: s(questionPlan.testType || ''),
        skill: s(questionPlan.skill || ''),
        questionType: 'reading_mcq_single',
        instructions: s(questionPlan.instructions || ''),
        payload: {
          passageTitle: s(payload.passageTitle || ''),
          passageHtml,
          stem,
          options,
          correctOptionKey: s(payload.correctOptionKey || ''),
          explanation: s(payload.explanation || '')
        },
        scoringConfig
      };
    }
  }),
  reading_mcq_multiple: Object.freeze({
    requiredContextError: 'Reading Text and Question Stem are required before using AI Assist for Reading MCQ Multiple.',
    payloadFields: Object.freeze([
      'passageTitle',
      'options',
      'correctOptionKeys',
      'explanation'
    ]),
    scoringFields: Object.freeze([
      'method',
      'maxScore'
    ]),
    payloadSchema: Object.freeze({
      passageTitle: { type: 'string' },
      options: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key', 'text'],
          properties: {
            key: { type: 'string' },
            text: { type: 'string' }
          }
        },
        minItems: MCQ_OPTION_RANGE.min,
        maxItems: MCQ_OPTION_RANGE.max
      },
      correctOptionKeys: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        maxItems: MCQ_OPTION_RANGE.max
      },
      explanation: { type: 'string' }
    }),
    scoringSchema: Object.freeze({
      method: { type: 'string' },
      maxScore: { type: 'number', minimum: 0.000001 }
    }),
    buildContext(questionPlan = {}) {
      const payload = safePayload(questionPlan.payload);
      const scoringConfig = safeScoring(questionPlan.scoringConfig);
      const passageHtml = s(payload.passageHtml);
      const stem = s(payload.stem);
      if (!passageHtml || !stem) {
        throw new Error('Reading Text and Question Stem are required before using AI Assist for Reading MCQ Multiple.');
      }
      const options = Array.isArray(payload.options)
        ? payload.options.slice(0, MCQ_OPTION_RANGE.max).map((item) => {
          const row = (item && typeof item === 'object' && !Array.isArray(item)) ? item : {};
          return {
            key: s(row.key || ''),
            text: s(row.text || '')
          };
        })
        : [];
      const correctOptionKeys = Array.isArray(payload.correctOptionKeys)
        ? payload.correctOptionKeys.map((item) => s(item)).filter(Boolean)
        : [];
      return {
        title: s(questionPlan.title || ''),
        testType: s(questionPlan.testType || ''),
        skill: s(questionPlan.skill || ''),
        questionType: 'reading_mcq_multiple',
        instructions: s(questionPlan.instructions || ''),
        payload: {
          passageTitle: s(payload.passageTitle || ''),
          passageHtml,
          stem,
          options,
          correctOptionKeys,
          explanation: s(payload.explanation || '')
        },
        scoringConfig
      };
    }
  }),
  reading_fill_in_blank: Object.freeze({
    requiredContextError: 'Original Passage or Passage With Blanks is required before using AI Assist for Reading Fill in Blank.',
    payloadFields: Object.freeze([
      'sourcePassage',
      'passageWithBlanks',
      'blankAnswerMap',
      'bankOptions',
      'caseSensitive',
      'allowSynonyms',
      'explanation'
    ]),
    scoringFields: Object.freeze([
      'method',
      'maxScore',
      'perBlankScore'
    ]),
    payloadSchema: Object.freeze({
      sourcePassage: { type: 'string' },
      passageWithBlanks: { type: 'string' },
      blankAnswerMap: { type: 'object' },
      bankOptions: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 30
      },
      caseSensitive: { type: 'boolean' },
      allowSynonyms: { type: 'boolean' },
      explanation: { type: 'string' }
    }),
    scoringSchema: Object.freeze({
      method: { type: 'string' },
      maxScore: { type: 'number', minimum: 0.000001 },
      perBlankScore: { type: 'number', minimum: 0 }
    }),
    buildContext(questionPlan = {}) {
      const payload = safePayload(questionPlan.payload);
      const scoringConfig = safeScoring(questionPlan.scoringConfig);
      const sourcePassage = s(payload.sourcePassage);
      const passageWithBlanks = s(payload.passageWithBlanks);
      if (!sourcePassage && !passageWithBlanks) {
        throw new Error('Original Passage or Passage With Blanks is required before using AI Assist for Reading Fill in Blank.');
      }
      return {
        title: s(questionPlan.title || ''),
        testType: s(questionPlan.testType || ''),
        skill: s(questionPlan.skill || ''),
        questionType: 'reading_fill_in_blank',
        instructions: s(questionPlan.instructions || ''),
        payload: {
          sourcePassage,
          passageWithBlanks: passageWithBlanks || sourcePassage,
          blankAnswerMap: safePayload(payload.blankAnswerMap),
          bankOptions: Array.isArray(payload.bankOptions) ? payload.bankOptions.map((item) => s(item)).filter(Boolean) : [],
          caseSensitive: Boolean(payload.caseSensitive),
          allowSynonyms: Boolean(payload.allowSynonyms),
          explanation: s(payload.explanation || '')
        },
        scoringConfig
      };
    }
  }),
  reading_writing_fill_in_blank: Object.freeze({
    requiredContextError: 'Passage With Blanks and a non-empty Blank Answer Map are required before using AI Assist for Reading & Writing Fill in Blank.',
    payloadFields: Object.freeze([
      'passageTitle',
      'blankOptionsMap',
      'caseSensitive',
      'explanation'
    ]),
    scoringFields: Object.freeze([
      'method',
      'maxScore',
      'perBlankScore'
    ]),
    payloadSchema: Object.freeze({
      passageTitle: { type: 'string' },
      blankOptionsMap: { type: 'object' },
      caseSensitive: { type: 'boolean' },
      explanation: { type: 'string' }
    }),
    scoringSchema: Object.freeze({
      method: { type: 'string' },
      maxScore: { type: 'number', minimum: 0.000001 },
      perBlankScore: { type: 'number', minimum: 0 }
    }),
    buildContext(questionPlan = {}) {
      const payload = safePayload(questionPlan.payload);
      const scoringConfig = safeScoring(questionPlan.scoringConfig);
      const sourcePassage = s(payload.sourcePassage);
      const passageWithBlanks = s(payload.passageWithBlanks);
      const blankAnswerMap = safePayload(payload.blankAnswerMap);
      if (!passageWithBlanks || !Object.keys(blankAnswerMap).length) {
        throw new Error('Passage With Blanks and a non-empty Blank Answer Map are required before using AI Assist for Reading & Writing Fill in Blank.');
      }
      const normalizedBlankOptionsMap = {};
      const rawBlankOptionsMap = safePayload(payload.blankOptionsMap);
      Object.keys(rawBlankOptionsMap).forEach((rawKey) => {
        const key = s(rawKey);
        if (!key) return;
        const rows = Array.isArray(rawBlankOptionsMap[rawKey])
          ? rawBlankOptionsMap[rawKey]
          : String(rawBlankOptionsMap[rawKey] ?? '')
            .split(/[\n,]/);
        normalizedBlankOptionsMap[key] = rows.map((item) => s(item)).filter(Boolean).slice(0, 4);
      });
      return {
        title: s(questionPlan.title || ''),
        testType: s(questionPlan.testType || ''),
        skill: s(questionPlan.skill || ''),
        questionType: 'reading_writing_fill_in_blank',
        instructions: s(questionPlan.instructions || ''),
        payload: {
          sourcePassage,
          passageWithBlanks: passageWithBlanks || sourcePassage,
          blankAnswerMap,
          passageTitle: s(payload.passageTitle || ''),
          blankOptionsMap: normalizedBlankOptionsMap,
          caseSensitive: Boolean(payload.caseSensitive),
          explanation: s(payload.explanation || '')
        },
        scoringConfig
      };
    }
  }),
  reading_reorder_paragraphs: Object.freeze({
    requiredContextError: 'At least two paragraph items are required before using AI Assist for Reading Reorder Paragraphs.',
    payloadFields: Object.freeze([
      'passageTitle',
      'explanation'
    ]),
    scoringFields: Object.freeze([
      'method',
      'maxScore',
      'partialCreditEnabled'
    ]),
    payloadSchema: Object.freeze({
      passageTitle: { type: 'string' },
      paragraphItems: {
        type: 'array',
        items: { type: 'string' },
        minItems: REORDER_PARAGRAPH_RANGE.min,
        maxItems: REORDER_PARAGRAPH_RANGE.max
      },
      correctOrder: {
        type: 'array',
        items: { type: 'string' },
        minItems: REORDER_PARAGRAPH_RANGE.min,
        maxItems: REORDER_PARAGRAPH_RANGE.max
      },
      explanation: { type: 'string' }
    }),
    scoringSchema: Object.freeze({
      method: { type: 'string' },
      maxScore: { type: 'number', minimum: 0.000001 },
      partialCreditEnabled: { type: 'boolean' }
    }),
    buildContext(questionPlan = {}) {
      const payload = safePayload(questionPlan.payload);
      const scoringConfig = safeScoring(questionPlan.scoringConfig);
      const sourcePassage = s(payload.sourcePassage || '');
      const explicitParagraphItems = Array.isArray(payload.paragraphItems)
        ? payload.paragraphItems.map((item) => s(item)).filter(Boolean)
        : [];
      const paragraphItems = explicitParagraphItems.length >= REORDER_PARAGRAPH_RANGE.min
        ? explicitParagraphItems
        : (sourcePassage ? splitReorderPassageIntoParagraphItems(sourcePassage) : explicitParagraphItems);
      if (paragraphItems.length < REORDER_PARAGRAPH_RANGE.min) {
        throw new Error('At least two paragraph items are required before using AI Assist for Reading Reorder Paragraphs.');
      }
      const correctOrder = Array.isArray(payload.correctOrder)
        ? payload.correctOrder.map((item) => s(item)).filter(Boolean)
        : [];
      return {
        title: s(questionPlan.title || ''),
        testType: s(questionPlan.testType || ''),
        skill: s(questionPlan.skill || ''),
        questionType: 'reading_reorder_paragraphs',
        instructions: s(questionPlan.instructions || ''),
        payload: {
          sourcePassage,
          passageTitle: s(payload.passageTitle || ''),
          paragraphItems: paragraphItems.slice(0, REORDER_PARAGRAPH_RANGE.max),
          correctOrder: (correctOrder.length ? correctOrder : paragraphItems).slice(0, REORDER_PARAGRAPH_RANGE.max),
          explanation: s(payload.explanation || '')
        },
        scoringConfig
      };
    }
  }),
  listening_mcq_single: Object.freeze({
    requiredContextError: 'Question Stem, Transcript, or Prompt Audio Asset is required before using AI Assist for Listening MCQ Single.',
    payloadFields: Object.freeze([
      'transcript',
      'stem',
      'options',
      'correctOptionKey',
      'allowReplay',
      'explanation'
    ]),
    scoringFields: Object.freeze([
      'method',
      'maxScore'
    ]),
    payloadSchema: Object.freeze({
      transcript: { type: 'string' },
      stem: { type: 'string' },
      options: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key', 'text'],
          properties: {
            key: { type: 'string' },
            text: { type: 'string' }
          }
        },
        minItems: MCQ_OPTION_RANGE.min,
        maxItems: MCQ_OPTION_RANGE.max
      },
      correctOptionKey: { type: 'string' },
      allowReplay: { type: 'boolean' },
      explanation: { type: 'string' }
    }),
    scoringSchema: Object.freeze({
      method: { type: 'string' },
      maxScore: { type: 'number', minimum: 0.000001 }
    }),
    buildContext(questionPlan = {}) {
      const payload = safePayload(questionPlan.payload);
      const scoringConfig = safeScoring(questionPlan.scoringConfig);
      const stem = s(payload.stem);
      const transcript = s(payload.transcript);
      const promptAudioAssetId = s(payload.promptAudioAssetId);
      if (!stem && !transcript && !promptAudioAssetId) {
        throw new Error('Question Stem, Transcript, or Prompt Audio Asset is required before using AI Assist for Listening MCQ Single.');
      }
      const options = Array.isArray(payload.options)
        ? payload.options.slice(0, MCQ_OPTION_RANGE.max).map((item) => {
          const row = (item && typeof item === 'object' && !Array.isArray(item)) ? item : {};
          return {
            key: s(row.key || ''),
            text: s(row.text || '')
          };
        })
        : [];
      return {
        title: s(questionPlan.title || ''),
        testType: s(questionPlan.testType || ''),
        skill: s(questionPlan.skill || ''),
        questionType: 'listening_mcq_single',
        instructions: s(questionPlan.instructions || ''),
        payload: {
          promptAudioAssetId,
          transcript,
          stem,
          options,
          correctOptionKey: s(payload.correctOptionKey || ''),
          allowReplay: Boolean(payload.allowReplay),
          explanation: s(payload.explanation || '')
        },
        scoringConfig
      };
    }
  }),
  listening_select_missing_word: Object.freeze({
    requiredContextError: 'Prompt Audio Asset, Transcript With Gap, or Transcript is required before using AI Assist for Listening Select Missing Word.',
    payloadFields: Object.freeze([
      'transcriptWithGap',
      'options',
      'correctOptionKey',
      'transcript',
      'allowReplay',
      'explanation'
    ]),
    scoringFields: Object.freeze([
      'method',
      'maxScore'
    ]),
    payloadSchema: Object.freeze({
      transcriptWithGap: { type: 'string' },
      options: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key', 'text'],
          properties: {
            key: { type: 'string' },
            text: { type: 'string' }
          }
        },
        minItems: MCQ_OPTION_RANGE.min,
        maxItems: MCQ_OPTION_RANGE.max
      },
      correctOptionKey: { type: 'string' },
      transcript: { type: 'string' },
      allowReplay: { type: 'boolean' },
      explanation: { type: 'string' }
    }),
    scoringSchema: Object.freeze({
      method: { type: 'string' },
      maxScore: { type: 'number', minimum: 0.000001 }
    }),
    buildContext(questionPlan = {}) {
      const payload = safePayload(questionPlan.payload);
      const scoringConfig = safeScoring(questionPlan.scoringConfig);
      const promptAudioAssetId = s(payload.promptAudioAssetId);
      const transcriptWithGap = s(payload.transcriptWithGap);
      const transcript = s(payload.transcript);
      if (!promptAudioAssetId && !transcriptWithGap && !transcript) {
        throw new Error('Prompt Audio Asset, Transcript With Gap, or Transcript is required before using AI Assist for Listening Select Missing Word.');
      }
      const options = Array.isArray(payload.options)
        ? payload.options.slice(0, MCQ_OPTION_RANGE.max).map((item) => {
          const row = (item && typeof item === 'object' && !Array.isArray(item)) ? item : {};
          return {
            key: s(row.key || ''),
            text: s(row.text || '')
          };
        })
        : [];
      return {
        title: s(questionPlan.title || ''),
        testType: s(questionPlan.testType || ''),
        skill: s(questionPlan.skill || ''),
        questionType: 'listening_select_missing_word',
        instructions: s(questionPlan.instructions || ''),
        payload: {
          promptAudioAssetId,
          transcriptWithGap,
          options,
          correctOptionKey: s(payload.correctOptionKey || ''),
          transcript,
          allowReplay: Boolean(payload.allowReplay),
          explanation: s(payload.explanation || '')
        },
        scoringConfig
      };
    }
  }),
  listening_mcq_multiple: Object.freeze({
    requiredContextError: 'Question Stem, Transcript, or Prompt Audio Asset is required before using AI Assist for Listening MCQ Multiple.',
    payloadFields: Object.freeze([
      'transcript',
      'stem',
      'options',
      'correctOptionKeys',
      'partialCreditEnabled',
      'allowReplay',
      'explanation'
    ]),
    scoringFields: Object.freeze([
      'method',
      'maxScore',
      'partialCreditEnabled'
    ]),
    payloadSchema: Object.freeze({
      transcript: { type: 'string' },
      stem: { type: 'string' },
      options: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key', 'text'],
          properties: {
            key: { type: 'string' },
            text: { type: 'string' }
          }
        },
        minItems: MCQ_OPTION_RANGE.min,
        maxItems: MCQ_OPTION_RANGE.max
      },
      correctOptionKeys: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        maxItems: MCQ_OPTION_RANGE.max
      },
      partialCreditEnabled: { type: 'boolean' },
      allowReplay: { type: 'boolean' },
      explanation: { type: 'string' }
    }),
    scoringSchema: Object.freeze({
      method: { type: 'string' },
      maxScore: { type: 'number', minimum: 0.000001 },
      partialCreditEnabled: { type: 'boolean' }
    }),
    buildContext(questionPlan = {}) {
      const payload = safePayload(questionPlan.payload);
      const scoringConfig = safeScoring(questionPlan.scoringConfig);
      const stem = s(payload.stem);
      const transcript = s(payload.transcript);
      const promptAudioAssetId = s(payload.promptAudioAssetId);
      if (!stem && !transcript && !promptAudioAssetId) {
        throw new Error('Question Stem, Transcript, or Prompt Audio Asset is required before using AI Assist for Listening MCQ Multiple.');
      }
      const options = Array.isArray(payload.options)
        ? payload.options.slice(0, MCQ_OPTION_RANGE.max).map((item) => {
          const row = (item && typeof item === 'object' && !Array.isArray(item)) ? item : {};
          return {
            key: s(row.key || ''),
            text: s(row.text || '')
          };
        })
        : [];
      const correctOptionKeys = Array.isArray(payload.correctOptionKeys)
        ? payload.correctOptionKeys.map((item) => s(item)).filter(Boolean)
        : [];
      return {
        title: s(questionPlan.title || ''),
        testType: s(questionPlan.testType || ''),
        skill: s(questionPlan.skill || ''),
        questionType: 'listening_mcq_multiple',
        instructions: s(questionPlan.instructions || ''),
        payload: {
          promptAudioAssetId,
          transcript,
          stem,
          options,
          correctOptionKeys,
          partialCreditEnabled: Boolean(payload.partialCreditEnabled),
          allowReplay: Boolean(payload.allowReplay),
          explanation: s(payload.explanation || '')
        },
        scoringConfig
      };
    }
  }),
  listening_fill_in_blank: Object.freeze({
    requiredContextError: 'Prompt Audio Asset or Transcript context is required before using AI Assist for Listening Fill in the Blanks.',
    payloadFields: Object.freeze([
      'transcriptWithBlanks',
      'blankAnswerMap',
      'allowReplay',
      'caseSensitive',
      'explanation'
    ]),
    scoringFields: Object.freeze([
      'method',
      'maxScore',
      'perBlankScore'
    ]),
    payloadSchema: Object.freeze({
      transcriptWithBlanks: { type: 'string' },
      blankAnswerMap: { type: 'object' },
      allowReplay: { type: 'boolean' },
      caseSensitive: { type: 'boolean' },
      explanation: { type: 'string' }
    }),
    scoringSchema: Object.freeze({
      method: { type: 'string' },
      maxScore: { type: 'number', minimum: 0.000001 },
      perBlankScore: { type: 'number', minimum: 0 }
    }),
    buildContext(questionPlan = {}) {
      const payload = safePayload(questionPlan.payload);
      const scoringConfig = safeScoring(questionPlan.scoringConfig);
      const promptAudioAssetId = s(payload.promptAudioAssetId);
      const transcriptWithBlanks = s(payload.transcriptWithBlanks);
      const sourceTranscript = s(payload.sourceTranscript || payload.transcript || '');
      if (!promptAudioAssetId && !transcriptWithBlanks && !sourceTranscript) {
        throw new Error('Prompt Audio Asset or Transcript context is required before using AI Assist for Listening Fill in the Blanks.');
      }
      return {
        title: s(questionPlan.title || ''),
        testType: s(questionPlan.testType || ''),
        skill: s(questionPlan.skill || ''),
        questionType: 'listening_fill_in_blank',
        instructions: s(questionPlan.instructions || ''),
        payload: {
          promptAudioAssetId,
          sourceTranscript,
          transcriptWithBlanks,
          blankAnswerMap: safePayload(payload.blankAnswerMap),
          allowReplay: Boolean(payload.allowReplay),
          caseSensitive: Boolean(payload.caseSensitive),
          explanation: s(payload.explanation || '')
        },
        scoringConfig
      };
    }
  }),
  listening_highlight_incorrect_words: Object.freeze({
    requiredContextError: 'Prompt Audio Asset, Transcript Text, or Transcript is required before using AI Assist for Listening Highlight Incorrect Words.',
    payloadFields: Object.freeze([
      'transcript',
      'transcriptText',
      'incorrectWords',
      'allowReplay',
      'explanation'
    ]),
    scoringFields: Object.freeze([
      'method',
      'maxScore',
      'perWordScore'
    ]),
    payloadSchema: Object.freeze({
      transcript: { type: 'string' },
      transcriptText: { type: 'string' },
      incorrectWords: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 20
      },
      allowReplay: { type: 'boolean' },
      explanation: { type: 'string' }
    }),
    scoringSchema: Object.freeze({
      method: { type: 'string' },
      maxScore: { type: 'number', minimum: 0.000001 },
      perWordScore: { type: 'number', minimum: 0 }
    }),
    buildContext(questionPlan = {}) {
      const payload = safePayload(questionPlan.payload);
      const scoringConfig = safeScoring(questionPlan.scoringConfig);
      const promptAudioAssetId = s(payload.promptAudioAssetId);
      const transcript = s(payload.transcript || payload.sourceTranscript || '');
      const transcriptText = s(payload.transcriptText);
      if (!promptAudioAssetId && !transcript && !transcriptText) {
        throw new Error('Prompt Audio Asset, Transcript Text, or Transcript is required before using AI Assist for Listening Highlight Incorrect Words.');
      }
      return {
        title: s(questionPlan.title || ''),
        testType: s(questionPlan.testType || ''),
        skill: s(questionPlan.skill || ''),
        questionType: 'listening_highlight_incorrect_words',
        instructions: s(questionPlan.instructions || ''),
        payload: {
          promptAudioAssetId,
          transcript,
          transcriptText,
          incorrectWords: Array.isArray(payload.incorrectWords) ? payload.incorrectWords.map((item) => s(item)).filter(Boolean) : [],
          allowReplay: Boolean(payload.allowReplay),
          explanation: s(payload.explanation || '')
        },
        scoringConfig
      };
    }
  }),
  listening_dictation: Object.freeze({
    requiredContextError: 'Prompt Audio Asset or Expected Transcript is required before using AI Assist for Listening Dictation.',
    payloadFields: Object.freeze([
      'expectedTranscript',
      'transcriptVariants',
      'allowReplay',
      'normalizationRules'
    ]),
    scoringFields: Object.freeze([
      'method',
      'maxScore',
      'perWordScore'
    ]),
    payloadSchema: Object.freeze({
      expectedTranscript: { type: 'string' },
      transcriptVariants: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 6
      },
      allowReplay: { type: 'boolean' },
      normalizationRules: { type: 'object' }
    }),
    scoringSchema: Object.freeze({
      method: { type: 'string' },
      maxScore: { type: 'number', minimum: 0.000001 },
      perWordScore: { type: 'number', minimum: 0 }
    }),
    buildContext(questionPlan = {}) {
      const payload = safePayload(questionPlan.payload);
      const scoringConfig = safeScoring(questionPlan.scoringConfig);
      const promptAudioAssetId = s(payload.promptAudioAssetId);
      const expectedTranscript = s(payload.expectedTranscript);
      if (!promptAudioAssetId && !expectedTranscript) {
        throw new Error('Prompt Audio Asset or Expected Transcript is required before using AI Assist for Listening Dictation.');
      }
      return {
        title: s(questionPlan.title || ''),
        testType: s(questionPlan.testType || ''),
        skill: s(questionPlan.skill || ''),
        questionType: 'listening_dictation',
        instructions: s(questionPlan.instructions || ''),
        payload: {
          promptAudioAssetId,
          expectedTranscript,
          transcriptVariants: Array.isArray(payload.transcriptVariants) ? payload.transcriptVariants.map((item) => s(item)).filter(Boolean) : [],
          allowReplay: Boolean(payload.allowReplay),
          normalizationRules: safePayload(payload.normalizationRules)
        },
        scoringConfig
      };
    }
  }),
  listening_summarize_spoken_text: Object.freeze({
    requiredContextError: 'Prompt Audio Asset, Transcript, or Expected Summary is required before using AI Assist for Listening Summarize Spoken Text.',
    payloadFields: Object.freeze([
      'transcript',
      'expectedSummary',
      'expectedKeyPoints',
      'minWords',
      'maxWords',
      'recommendedTimeMinutes',
      'allowReplay'
    ]),
    scoringFields: Object.freeze([
      'method',
      'maxScore',
      'traits'
    ]),
    payloadSchema: Object.freeze({
      transcript: { type: 'string' },
      expectedSummary: { type: 'string' },
      expectedKeyPoints: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 },
      minWords: {
        type: 'integer',
        minimum: LISTENING_SUMMARY_WORD_RANGE.min,
        maximum: LISTENING_SUMMARY_WORD_RANGE.max
      },
      maxWords: {
        type: 'integer',
        minimum: LISTENING_SUMMARY_WORD_RANGE.min,
        maximum: LISTENING_SUMMARY_WORD_RANGE.max
      },
      recommendedTimeMinutes: {
        type: 'integer',
        minimum: LISTENING_SUMMARY_TIME_RANGE.min,
        maximum: LISTENING_SUMMARY_TIME_RANGE.max
      },
      allowReplay: { type: 'boolean' }
    }),
    scoringSchema: Object.freeze({
      method: { type: 'string' },
      maxScore: { type: 'number', minimum: 0.000001 },
      traits: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        maxItems: 8
      }
    }),
    buildContext(questionPlan = {}) {
      const payload = safePayload(questionPlan.payload);
      const scoringConfig = safeScoring(questionPlan.scoringConfig);
      const promptAudioAssetId = s(payload.promptAudioAssetId);
      const transcript = s(payload.transcript);
      const expectedSummary = s(payload.expectedSummary);
      if (!promptAudioAssetId && !transcript && !expectedSummary) {
        throw new Error('Prompt Audio Asset, Transcript, or Expected Summary is required before using AI Assist for Listening Summarize Spoken Text.');
      }
      const minWordsRaw = Number.parseInt(String(payload.minWords ?? '').trim(), 10);
      const maxWordsRaw = Number.parseInt(String(payload.maxWords ?? '').trim(), 10);
      const recommendedTimeMinutesRaw = Number.parseInt(String(payload.recommendedTimeMinutes ?? '').trim(), 10);
      const minWords = Number.isFinite(minWordsRaw) && !Number.isNaN(minWordsRaw)
        ? minWordsRaw
        : LISTENING_SUMMARY_WORD_RANGE.fallbackMin;
      const maxWords = Number.isFinite(maxWordsRaw) && !Number.isNaN(maxWordsRaw)
        ? maxWordsRaw
        : LISTENING_SUMMARY_WORD_RANGE.fallbackMax;
      const recommendedTimeMinutes = Number.isFinite(recommendedTimeMinutesRaw) && !Number.isNaN(recommendedTimeMinutesRaw)
        ? recommendedTimeMinutesRaw
        : LISTENING_SUMMARY_TIME_RANGE.fallback;
      return {
        title: s(questionPlan.title || ''),
        testType: s(questionPlan.testType || ''),
        skill: s(questionPlan.skill || ''),
        questionType: 'listening_summarize_spoken_text',
        instructions: s(questionPlan.instructions || ''),
        payload: {
          promptAudioAssetId,
          transcript,
          expectedSummary,
          expectedKeyPoints: Array.isArray(payload.expectedKeyPoints) ? payload.expectedKeyPoints.map((item) => s(item)).filter(Boolean) : [],
          minWords,
          maxWords,
          recommendedTimeMinutes,
          allowReplay: Boolean(payload.allowReplay)
        },
        scoringConfig
      };
    }
  }),
  speaking_respond_to_situation: Object.freeze({
    requiredContextError: 'Situation Text is required before using AI Assist.',
    payloadFields: Object.freeze([
      'role',
      'audience',
      'targetFunction',
      'targetRegister',
      'contextNotes',
      'expectedKeyPoints',
      'politenessLevel',
      'prepTimeSeconds',
      'responseTimeSeconds'
    ]),
    scoringFields: Object.freeze([
      'method',
      'scorerVersion',
      'maxScore',
      'traits',
      'traitWeights',
      'contentMax',
      'pronunciationMax',
      'fluencyMax',
      'contentCoverageMin',
      'minResponseSeconds',
      'idealWpmMin',
      'idealWpmMax',
      'longPauseSeconds',
      'offTopicPenalty',
      'minAnalysisConfidence'
    ]),
    payloadSchema: Object.freeze({
      role: { type: 'string' },
      audience: { type: 'string' },
      targetFunction: { type: 'string' },
      targetRegister: { type: 'string', enum: TARGET_REGISTERS.slice() },
      contextNotes: { type: 'string' },
      expectedKeyPoints: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 },
      politenessLevel: { type: 'string', enum: POLITENESS_LEVELS.slice() },
      prepTimeSeconds: { type: 'integer', minimum: PREP_TIME_RANGE.min, maximum: PREP_TIME_RANGE.max },
      responseTimeSeconds: { type: 'integer', minimum: RESPONSE_TIME_RANGE.min, maximum: RESPONSE_TIME_RANGE.max }
    }),
    scoringSchema: Object.freeze({
      traitWeights: {
        type: 'object',
        required: ['appropriacy', 'pronunciation', 'fluency'],
        properties: {
          appropriacy: { type: 'number', minimum: SCORING_RATIO_RANGE.min, maximum: SCORING_RATIO_RANGE.max },
          pronunciation: { type: 'number', minimum: SCORING_RATIO_RANGE.min, maximum: SCORING_RATIO_RANGE.max },
          fluency: { type: 'number', minimum: SCORING_RATIO_RANGE.min, maximum: SCORING_RATIO_RANGE.max }
        }
      },
      contentCoverageMin: { type: 'number', minimum: SCORING_RATIO_RANGE.min, maximum: SCORING_RATIO_RANGE.max },
      minResponseSeconds: { type: 'integer', minimum: 1 },
      idealWpmMin: { type: 'integer', minimum: SCORING_WPM_RANGE.min, maximum: SCORING_WPM_RANGE.max },
      idealWpmMax: { type: 'integer', minimum: SCORING_WPM_RANGE.min, maximum: SCORING_WPM_RANGE.max },
      offTopicPenalty: { type: 'number', minimum: SCORING_RATIO_RANGE.min, maximum: SCORING_RATIO_RANGE.max }
    }),
    buildContext(questionPlan = {}) {
      const payload = safePayload(questionPlan.payload);
      const scoringConfig = safeScoring(questionPlan.scoringConfig);
      const situationText = s(payload.situationText);
      if (!situationText) {
        throw new Error('Situation Text is required before using AI Assist.');
      }
      return {
        title: s(questionPlan.title || ''),
        testType: s(questionPlan.testType || ''),
        skill: s(questionPlan.skill || ''),
        questionType: 'speaking_respond_to_situation',
        instructions: s(questionPlan.instructions || ''),
        payload: {
          situationText
        },
        scoringConfig
      };
    }
  }),
  speaking_answer_short_question: Object.freeze({
    requiredContextError: 'Prompt Text or Audio Asset ID is required before using AI Assist for Answer Short Question.',
    payloadFields: Object.freeze([
      'transcript',
      'acceptedAnswers',
      'answerAliases',
      'caseSensitive',
      'allowSemanticMatch',
      'responseTimeSeconds'
    ]),
    scoringFields: Object.freeze([
      'method',
      'maxScore',
      'traits'
    ]),
    payloadSchema: Object.freeze({
      transcript: { type: 'string' },
      acceptedAnswers: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 8
      },
      answerAliases: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 12
      },
      caseSensitive: { type: 'boolean' },
      allowSemanticMatch: { type: 'boolean' },
      responseTimeSeconds: { type: 'integer', minimum: 1, maximum: 30 }
    }),
    scoringSchema: Object.freeze({
      method: { type: 'string' },
      maxScore: { type: 'number', minimum: 0.000001 },
      traits: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 4
      }
    }),
    buildContext(questionPlan = {}) {
      const payload = safePayload(questionPlan.payload);
      const scoringConfig = safeScoring(questionPlan.scoringConfig);
      const promptTextOrAudio = s(payload.promptTextOrAudio);
      if (!promptTextOrAudio) {
        throw new Error('Prompt Text or Audio Asset ID is required before using AI Assist for Answer Short Question.');
      }
      return {
        title: s(questionPlan.title || ''),
        testType: s(questionPlan.testType || ''),
        skill: s(questionPlan.skill || ''),
        questionType: 'speaking_answer_short_question',
        instructions: s(questionPlan.instructions || ''),
        payload: {
          promptTextOrAudio,
          transcript: s(payload.transcript || ''),
          acceptedAnswers: Array.isArray(payload.acceptedAnswers)
            ? payload.acceptedAnswers.map((item) => s(item)).filter(Boolean)
            : [],
          answerAliases: Array.isArray(payload.answerAliases)
            ? payload.answerAliases.map((item) => s(item)).filter(Boolean)
            : [],
          caseSensitive: Boolean(payload.caseSensitive),
          allowSemanticMatch: Boolean(payload.allowSemanticMatch),
          responseTimeSeconds: Number.parseInt(String(payload.responseTimeSeconds ?? '').trim(), 10) || 15
        },
        scoringConfig
      };
    }
  }),
  writing_summarize_written_text: Object.freeze({
    requiredContextError: 'Source Text is required before using AI Assist for Summarize Written Text.',
    payloadFields: Object.freeze([
      'sourceTitle',
      'expectedSummary',
      'expectedKeyPoints',
      'minWords',
      'maxWords',
      'recommendedTimeMinutes'
    ]),
    scoringFields: Object.freeze([
      'method',
      'maxScore',
      'traits'
    ]),
    payloadSchema: Object.freeze({
      sourceTitle: { type: 'string' },
      expectedSummary: { type: 'string' },
      expectedKeyPoints: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        maxItems: 6
      },
      minWords: { type: 'integer', minimum: WRITING_SUMMARY_WORD_RANGE.min, maximum: WRITING_SUMMARY_WORD_RANGE.max },
      maxWords: { type: 'integer', minimum: WRITING_SUMMARY_WORD_RANGE.min, maximum: WRITING_SUMMARY_WORD_RANGE.max },
      recommendedTimeMinutes: { type: 'integer', minimum: WRITING_SUMMARY_TIME_RANGE.min, maximum: WRITING_SUMMARY_TIME_RANGE.max }
    }),
    scoringSchema: Object.freeze({
      method: { type: 'string' },
      maxScore: { type: 'number', minimum: 0.000001 },
      traits: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        maxItems: 8
      }
    }),
    buildContext(questionPlan = {}) {
      const payload = safePayload(questionPlan.payload);
      const scoringConfig = safeScoring(questionPlan.scoringConfig);
      const sourceText = s(payload.sourceText);
      if (!sourceText) {
        throw new Error('Source Text is required before using AI Assist for Summarize Written Text.');
      }
      return {
        title: s(questionPlan.title || ''),
        testType: s(questionPlan.testType || ''),
        skill: s(questionPlan.skill || ''),
        questionType: 'writing_summarize_written_text',
        instructions: s(questionPlan.instructions || ''),
        payload: {
          sourceText,
          sourceTitle: s(payload.sourceTitle || ''),
          expectedSummary: s(payload.expectedSummary || ''),
          expectedKeyPoints: Array.isArray(payload.expectedKeyPoints)
            ? payload.expectedKeyPoints.map((item) => s(item)).filter(Boolean)
            : [],
          minWords: Number.parseInt(String(payload.minWords ?? '').trim(), 10) || WRITING_SUMMARY_WORD_RANGE.fallbackMin,
          maxWords: Number.parseInt(String(payload.maxWords ?? '').trim(), 10) || WRITING_SUMMARY_WORD_RANGE.fallbackMax,
          recommendedTimeMinutes: Number.parseInt(String(payload.recommendedTimeMinutes ?? '').trim(), 10) || WRITING_SUMMARY_TIME_RANGE.fallback
        },
        scoringConfig
      };
    }
  }),
  writing_write_email: Object.freeze({
    requiredContextError: 'Scenario Text is required before using AI Assist for Write Email.',
    payloadFields: Object.freeze([
      'recipientRole',
      'senderRole',
      'purpose',
      'requiredPoints',
      'targetRegister',
      'suggestedSubject',
      'expectedTone',
      'minWords',
      'maxWords'
    ]),
    scoringFields: Object.freeze([
      'method',
      'maxScore',
      'traits'
    ]),
    payloadSchema: Object.freeze({
      recipientRole: { type: 'string' },
      senderRole: { type: 'string' },
      purpose: { type: 'string' },
      requiredPoints: {
        type: 'array',
        items: { type: 'string' },
        minItems: 3,
        maxItems: 6
      },
      targetRegister: { type: 'string' },
      suggestedSubject: { type: 'string' },
      expectedTone: { type: 'string' },
      minWords: { type: 'integer', minimum: 50, maximum: 120 },
      maxWords: { type: 'integer', minimum: 50, maximum: 120 }
    }),
    scoringSchema: Object.freeze({
      method: { type: 'string' },
      maxScore: { type: 'number', minimum: 0.000001 },
      traits: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 10
      }
    }),
    buildContext(questionPlan = {}) {
      const payload = safePayload(questionPlan.payload);
      const scoringConfig = safeScoring(questionPlan.scoringConfig);
      const scenarioText = s(payload.scenarioText);
      if (!scenarioText) {
        throw new Error('Scenario Text is required before using AI Assist for Write Email.');
      }
      return {
        title: s(questionPlan.title || ''),
        testType: s(questionPlan.testType || ''),
        skill: s(questionPlan.skill || ''),
        questionType: 'writing_write_email',
        instructions: s(questionPlan.instructions || ''),
        payload: {
          scenarioText,
          recipientRole: s(payload.recipientRole || ''),
          senderRole: s(payload.senderRole || ''),
          purpose: s(payload.purpose || ''),
          requiredPoints: Array.isArray(payload.requiredPoints)
            ? payload.requiredPoints.map((item) => s(item)).filter(Boolean)
            : [],
          targetRegister: s(payload.targetRegister || ''),
          suggestedSubject: s(payload.suggestedSubject || ''),
          expectedTone: s(payload.expectedTone || ''),
          minWords: Number.parseInt(String(payload.minWords ?? '').trim(), 10) || 50,
          maxWords: Number.parseInt(String(payload.maxWords ?? '').trim(), 10) || 120
        },
        scoringConfig
      };
    }
  }),
  speaking_describe_image: Object.freeze({
    requiredContextError: 'Image Asset ID is required before using AI Assist for Describe Image.',
    payloadFields: Object.freeze([
      'imageCaption',
      'expectedKeyPoints',
      'chartType',
      'prepTimeSeconds',
      'responseTimeSeconds'
    ]),
    scoringFields: Object.freeze([
      'method',
      'scorerVersion',
      'maxScore',
      'traits',
      'traitWeights',
      'contentMax',
      'pronunciationMax',
      'fluencyMax',
      'contentCoverageMin',
      'minResponseSeconds',
      'idealWpmMin',
      'idealWpmMax',
      'longPauseSeconds',
      'offTopicPenalty',
      'minAnalysisConfidence'
    ]),
    payloadSchema: Object.freeze({
      imageCaption: { type: 'string' },
      expectedKeyPoints: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 },
      chartType: { type: 'string' },
      prepTimeSeconds: { type: 'integer', minimum: PREP_TIME_RANGE.min, maximum: PREP_TIME_RANGE.max },
      responseTimeSeconds: { type: 'integer', minimum: RESPONSE_TIME_RANGE.min, maximum: RESPONSE_TIME_RANGE.max }
    }),
    scoringSchema: Object.freeze({
      method: { type: 'string' },
      scorerVersion: { type: 'string' },
      maxScore: { type: 'number', minimum: 0.000001 },
      traits: {
        type: 'array',
        items: { type: 'string' },
        minItems: 3,
        maxItems: 3
      },
      traitWeights: {
        type: 'object',
        required: ['content', 'pronunciation', 'fluency'],
        properties: {
          content: { type: 'number', minimum: SCORING_RATIO_RANGE.min, maximum: SCORING_RATIO_RANGE.max },
          pronunciation: { type: 'number', minimum: SCORING_RATIO_RANGE.min, maximum: SCORING_RATIO_RANGE.max },
          fluency: { type: 'number', minimum: SCORING_RATIO_RANGE.min, maximum: SCORING_RATIO_RANGE.max }
        }
      },
      contentMax: { type: 'number', minimum: 0.000001, maximum: 5 },
      pronunciationMax: { type: 'number', minimum: 0.000001, maximum: 5 },
      fluencyMax: { type: 'number', minimum: 0.000001, maximum: 5 },
      contentCoverageMin: { type: 'number', minimum: SCORING_RATIO_RANGE.min, maximum: SCORING_RATIO_RANGE.max },
      minResponseSeconds: { type: 'integer', minimum: 1 },
      idealWpmMin: { type: 'integer', minimum: SCORING_WPM_RANGE.min, maximum: SCORING_WPM_RANGE.max },
      idealWpmMax: { type: 'integer', minimum: SCORING_WPM_RANGE.min, maximum: SCORING_WPM_RANGE.max },
      longPauseSeconds: { type: 'number', minimum: 0.5, maximum: 10 },
      offTopicPenalty: { type: 'number', minimum: SCORING_RATIO_RANGE.min, maximum: SCORING_RATIO_RANGE.max },
      minAnalysisConfidence: { type: 'number', minimum: SCORING_RATIO_RANGE.min, maximum: SCORING_RATIO_RANGE.max }
    }),
    buildContext(questionPlan = {}) {
      const payload = safePayload(questionPlan.payload);
      const scoringConfig = safeScoring(questionPlan.scoringConfig);
      const imageAssetId = s(payload.imageAssetId);
      if (!imageAssetId) {
        throw new Error('Image Asset ID is required before using AI Assist for Describe Image.');
      }
      return {
        title: s(questionPlan.title || ''),
        testType: s(questionPlan.testType || ''),
        skill: s(questionPlan.skill || ''),
        questionType: 'speaking_describe_image',
        instructions: s(questionPlan.instructions || ''),
        payload: {
          imageAssetId,
          imageCaption: s(payload.imageCaption || ''),
          expectedKeyPoints: Array.isArray(payload.expectedKeyPoints)
            ? payload.expectedKeyPoints.map((item) => s(item)).filter(Boolean)
            : [],
          chartType: s(payload.chartType || '')
        },
        scoringConfig
      };
    }
  })
});

function buildResponseSchema(profile = {}) {
  const payloadProperties = (profile && profile.payloadSchema && typeof profile.payloadSchema === 'object')
    ? profile.payloadSchema
    : {};
  const scoringProperties = (profile && profile.scoringSchema && typeof profile.scoringSchema === 'object')
    ? profile.scoringSchema
    : {};
  const payloadKeys = Object.keys(payloadProperties);
  const scoringKeys = Object.keys(scoringProperties);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['suggestions'],
    properties: {
      suggestions: {
        type: 'object',
        additionalProperties: false,
        required: ['payload', 'scoring'],
        properties: {
          payload: {
            type: 'object',
            additionalProperties: false,
            required: payloadKeys,
            properties: payloadProperties
          },
          scoring: {
            type: 'object',
            additionalProperties: false,
            required: scoringKeys,
            properties: scoringProperties
          }
        }
      }
    }
  };
}

function buildOutputShape(questionType, profile = {}) {
  const payloadFields = Array.isArray(profile.payloadFields) ? profile.payloadFields : [];
  const scoringFields = Array.isArray(profile.scoringFields) ? profile.scoringFields : [];
  const payload = {};
  payloadFields.forEach((key) => {
    if (
      key === 'expectedKeyPoints'
      || key === 'transcriptVariants'
      || key === 'incorrectWords'
      || key === 'acceptedAnswers'
      || key === 'requiredPoints'
      || key === 'answerAliases'
    ) payload[key] = ['string'];
    else if (key === 'bankOptions') payload[key] = ['answer-word', 'distractor-word'];
    else if (key === 'correctOptionKeys') payload[key] = ['A', 'C'];
    else if (key === 'blankAnswerMap') payload[key] = {};
    else if (key === 'blankOptionsMap') payload[key] = { '{{1}}': ['option-a', 'option-b', 'option-c', 'option-d'] };
    else if (key === 'normalizationRules') payload[key] = DICTATION_NORMALIZATION_RULE_DEFAULTS;
    else if (key === 'options') payload[key] = [{ key: 'A', text: 'string' }, { key: 'B', text: 'string' }];
    else if (key === 'allowReplay' || key === 'partialCreditEnabled' || key === 'caseSensitive' || key === 'allowSynonyms' || key === 'allowSemanticMatch') payload[key] = false;
    else if (key === 'minWords' && questionType === 'writing_write_email') payload[key] = 50;
    else if (key === 'maxWords' && questionType === 'writing_write_email') payload[key] = 120;
    else if (key === 'minWords' && questionType === 'writing_summarize_written_text') payload[key] = WRITING_SUMMARY_WORD_RANGE.fallbackMin;
    else if (key === 'maxWords' && questionType === 'writing_summarize_written_text') payload[key] = WRITING_SUMMARY_WORD_RANGE.fallbackMax;
    else if (key === 'recommendedTimeMinutes' && questionType === 'writing_summarize_written_text') payload[key] = WRITING_SUMMARY_TIME_RANGE.fallback;
    else if (key === 'minWords') payload[key] = LISTENING_SUMMARY_WORD_RANGE.fallbackMin;
    else if (key === 'maxWords') payload[key] = LISTENING_SUMMARY_WORD_RANGE.fallbackMax;
    else if (key === 'recommendedTimeMinutes') payload[key] = LISTENING_SUMMARY_TIME_RANGE.fallback;
    else if (key === 'prepTimeSeconds') payload[key] = 25;
    else if (key === 'responseTimeSeconds' && questionType === 'speaking_repeat_sentence') payload[key] = 20;
    else if (key === 'responseTimeSeconds' && questionType === 'speaking_answer_short_question') payload[key] = 15;
    else if (key === 'responseTimeSeconds') payload[key] = 40;
    else payload[key] = 'string';
  });
  const scoring = {};
  scoringFields.forEach((key) => {
    if (
      key === 'method'
      && (
        questionType === 'reading_mcq_single'
        || questionType === 'reading_mcq_multiple'
        || questionType === 'listening_mcq_single'
        || questionType === 'listening_mcq_multiple'
      )
    ) scoring[key] = 'auto_objective';
    else if (key === 'method' && questionType === 'listening_select_missing_word') scoring[key] = 'auto_objective';
    else if (key === 'method' && (questionType === 'reading_fill_in_blank' || questionType === 'reading_writing_fill_in_blank')) scoring[key] = 'auto_objective';
    else if (key === 'method' && questionType === 'listening_fill_in_blank') scoring[key] = 'auto_objective';
    else if (key === 'method' && questionType === 'listening_highlight_incorrect_words') scoring[key] = 'auto_objective';
    else if (key === 'method' && questionType === 'listening_dictation') scoring[key] = 'auto_objective';
    else if (key === 'method' && questionType === 'listening_summarize_spoken_text') scoring[key] = 'hybrid_ai';
    else if (key === 'method' && questionType === 'writing_write_email') scoring[key] = 'hybrid_ai';
    else if (key === 'method' && questionType === 'writing_summarize_written_text') scoring[key] = 'hybrid_ai';
    else if (key === 'method' && questionType === 'speaking_answer_short_question') scoring[key] = 'hybrid_ai_audio_objective';
    else if (key === 'method' && questionType === 'speaking_describe_image') scoring[key] = 'hybrid_ai_audio_visual';
    else if (key === 'method') scoring[key] = 'hybrid_ai_audio';
    else if (key === 'scorerVersion' && questionType === 'speaking_answer_short_question') scoring[key] = 'pte-answer-short-question-v1';
    else if (key === 'scorerVersion' && questionType === 'speaking_read_aloud') scoring[key] = 'pte-read-aloud-v1';
    else if (key === 'scorerVersion' && questionType === 'speaking_describe_image') scoring[key] = 'pte-describe-image-v1';
    else if (
      key === 'maxScore'
      && (
        questionType === 'reading_mcq_single'
        || questionType === 'reading_mcq_multiple'
        || questionType === 'listening_mcq_single'
        || questionType === 'listening_mcq_multiple'
      )
    ) scoring[key] = 1;
    else if (key === 'maxScore' && questionType === 'listening_select_missing_word') scoring[key] = 1;
    else if (key === 'maxScore' && (questionType === 'reading_fill_in_blank' || questionType === 'reading_writing_fill_in_blank')) scoring[key] = 1;
    else if (key === 'maxScore' && questionType === 'listening_fill_in_blank') scoring[key] = 1;
    else if (key === 'maxScore' && questionType === 'listening_highlight_incorrect_words') scoring[key] = 1;
    else if (key === 'maxScore' && questionType === 'listening_dictation') scoring[key] = 1;
    else if (key === 'maxScore' && questionType === 'listening_summarize_spoken_text') scoring[key] = 5;
    else if (key === 'maxScore' && questionType === 'writing_write_email') scoring[key] = 15;
    else if (key === 'maxScore' && questionType === 'writing_summarize_written_text') scoring[key] = 7;
    else if (key === 'maxScore' && questionType === 'speaking_answer_short_question') scoring[key] = 1;
    else if (key === 'maxScore' && questionType === 'speaking_describe_image') scoring[key] = 15;
    else if (key === 'maxScore') scoring[key] = 5;
    else if (key === 'perBlankScore') scoring[key] = 1;
    else if (key === 'perWordScore') scoring[key] = 1;
    else if (key === 'partialCreditEnabled') scoring[key] = false;
    else if (key === 'traits' && questionType === 'listening_summarize_spoken_text') scoring[key] = ['content', 'form', 'grammar', 'vocabulary'];
    else if (key === 'traits' && questionType === 'writing_write_email') scoring[key] = ['content', 'emailConventions', 'form', 'organization', 'vocabulary', 'grammar', 'spelling'];
    else if (key === 'traits' && questionType === 'writing_summarize_written_text') scoring[key] = ['content', 'form', 'grammar', 'vocabulary'];
    else if (key === 'traits' && questionType === 'speaking_answer_short_question') scoring[key] = ['vocabulary'];
    else if (key === 'traits') scoring[key] = ['content', 'pronunciation', 'fluency'];
    else if (key === 'traitWeights' && questionType === 'speaking_describe_image') scoring[key] = { content: 0.5, pronunciation: 0.25, fluency: 0.25 };
    else if (key === 'traitWeights') scoring[key] = { traitA: 0.5, traitB: 0.25, traitC: 0.25 };
    else if (key === 'contentMax') scoring[key] = 5;
    else if (key === 'pronunciationMax') scoring[key] = 5;
    else if (key === 'fluencyMax') scoring[key] = 5;
    else if (key === 'contentCoverageMin') scoring[key] = 0.6;
    else if (key === 'minResponseSeconds') scoring[key] = 20;
    else if (key === 'idealWpmMin') scoring[key] = 90;
    else if (key === 'idealWpmMax') scoring[key] = 160;
    else if (key === 'longPauseSeconds') scoring[key] = 2;
    else if (key === 'offTopicPenalty') scoring[key] = 0.2;
    else if (key === 'minAnalysisConfidence') scoring[key] = 0.35;
    else if (key === 'minSemanticConfidence') scoring[key] = 0.7;
    else scoring[key] = 'value';
  });
  return {
    suggestions: {
      payload,
      scoring
    }
  };
}

function buildPromptConfig(questionType, questionPlan = {}, profile = {}) {
  const context = profile.buildContext(questionPlan);
  const isRepeatSentence = questionType === 'speaking_repeat_sentence';
  const isAnswerShortQuestion = questionType === 'speaking_answer_short_question';
  const normalizedTestType = normalizeTestType(questionPlan?.testType);
  const payloadFields = Array.isArray(profile.payloadFields) ? profile.payloadFields : [];
  const scoringFields = Array.isArray(profile.scoringFields) ? profile.scoringFields : [];

  const systemInstructions = [
    'You are an expert PTE item authoring assistant.',
    `Generate scorer-ready suggestions for ${questionType}.`,
    'Return strict JSON only with top-level key "suggestions".',
    'Populate every field under suggestions.payload and suggestions.scoring; do not omit keys.',
    'Do not include markdown, explanations, or extra keys.'
  ];

  if (payloadFields.includes('prepTimeSeconds') || payloadFields.includes('responseTimeSeconds')) {
    if (isRepeatSentence) {
      systemInstructions.push(
        `For responseTimeSeconds, use a practical integer in ${REPEAT_SENTENCE_RESPONSE_RANGE.min}-${REPEAT_SENTENCE_RESPONSE_RANGE.max}.`
      );
    } else if (isAnswerShortQuestion) {
      systemInstructions.push(
        'For speaking answer short question: use a compact responseTimeSeconds between 1 and 30 seconds.'
      );
    } else {
      systemInstructions.push(
        `For prep/response time fields, use practical integers in ${PREP_TIME_RANGE.min}-${PREP_TIME_RANGE.max} (prep) and ${RESPONSE_TIME_RANGE.min}-${RESPONSE_TIME_RANGE.max} (response).`
      );
    }
  }
  if (scoringFields.includes('contentCoverageMin') || scoringFields.includes('offTopicPenalty')) {
    systemInstructions.push(
      `For ratio fields, use values between ${SCORING_RATIO_RANGE.min} and ${SCORING_RATIO_RANGE.max}.`
    );
  }
  if (scoringFields.includes('idealWpmMin') || scoringFields.includes('idealWpmMax')) {
    systemInstructions.push(
      `For WPM fields, keep values between ${SCORING_WPM_RANGE.min} and ${SCORING_WPM_RANGE.max} and ensure idealWpmMax >= idealWpmMin.`
    );
  }
  if (scoringFields.includes('traitWeights')) {
    systemInstructions.push(
      `traitWeights must use required trait keys only and sum to 1 with tolerance ${TRAIT_WEIGHT_SUM_TOLERANCE}.`
    );
  }
  if (payloadFields.includes('options') && payloadFields.includes('correctOptionKey')) {
    systemInstructions.push(
      `For options, return ${MCQ_OPTION_RANGE.min}-${MCQ_OPTION_RANGE.max} choices in [{key,text}] format with unique keys; correctOptionKey must match one option key exactly.`
    );
  }
  if (payloadFields.includes('options') && payloadFields.includes('correctOptionKeys')) {
    systemInstructions.push(
      `For options, return ${MCQ_OPTION_RANGE.min}-${MCQ_OPTION_RANGE.max} choices in [{key,text}] format with unique keys; correctOptionKeys must contain at least two matching option keys.`
    );
  }
  if (payloadFields.includes('transcriptWithGap') && payloadFields.includes('correctOptionKey')) {
    systemInstructions.push(
      'For listening select missing word: transcriptWithGap must include a clear single gap marker such as [BLANK], {{gap}}, or ____.'
    );
    systemInstructions.push(
      'For listening select missing word: generate options where exactly one option correctly completes the missing ending word or phrase.'
    );
  }
  if (payloadFields.includes('transcriptText') && payloadFields.includes('incorrectWords')) {
    systemInstructions.push(
      'For listening highlight incorrect words: keep transcript as the audio-accurate source transcript.'
    );
    systemInstructions.push(
      'For listening highlight incorrect words: transcriptText should closely follow transcript but include a few intentionally changed words.'
    );
    systemInstructions.push(
      'For listening highlight incorrect words: incorrectWords must list exactly the changed words that appear in transcriptText compared with transcript, using unique tokens.'
    );
  }
  if (payloadFields.includes('allowReplay')) {
    systemInstructions.push('allowReplay must be a boolean true/false value.');
  }
  if (payloadFields.includes('acceptedAnswers')) {
    systemInstructions.push(
      'For speaking answer short question: acceptedAnswers must be concise factual answers that directly satisfy the prompt.'
    );
    systemInstructions.push(
      'For speaking answer short question: avoid near-duplicate answer variants in acceptedAnswers.'
    );
    systemInstructions.push(
      'For speaking answer short question: if promptTextOrAudio looks like a media asset id/path/url, do not infer meaning from that token; rely on transcript/context only.'
    );
    if (payloadFields.includes('transcript')) {
      systemInstructions.push(
        'For speaking answer short question: when transcript is provided, treat transcript as authoritative prompt content and keep outputs aligned to it.'
      );
    }
  }
  if (questionType === 'writing_write_email') {
    systemInstructions.push(
      'For writing write email: requiredPoints should cover key action items from the scenario and should usually contain 3 concise bullet-style points.'
    );
    systemInstructions.push(
      'For writing write email: prefer targetRegister formal or neutral unless scenario explicitly requires informal tone.'
    );
    systemInstructions.push(
      'For writing write email: keep minWords and maxWords within 50-120 and ensure maxWords is greater than or equal to minWords.'
    );
    systemInstructions.push(
      'For writing write email: suggestedSubject should be concise and practical for a real email thread.'
    );
  }
  if (questionType === 'writing_summarize_written_text') {
    systemInstructions.push(
      'For writing summarize written text: expectedSummary should be a concise single-sentence model summary grounded in sourceText.'
    );
    systemInstructions.push(
      'For writing summarize written text: expectedKeyPoints should list the major ideas that must appear in a strong summary.'
    );
    systemInstructions.push(
      'For writing summarize written text: keep suggested word limits in the official 5-75 range and set practical recommended time.'
    );
    getWritingSummaryPolicyInstructions(normalizedTestType).forEach((line) => systemInstructions.push(line));
  }
  if (questionType === 'speaking_describe_image') {
    systemInstructions.push(
      'For Describe Image: visual payload fields must be grounded only in the attached image file; if no image is available, use existing imageCaption/expectedKeyPoints/chartType only as limited draft context and do not add new concrete facts.'
    );
    systemInstructions.push(
      'For Describe Image: do not infer chart topics, labels, categories, dates, countries, numbers, percentages, or trends from the title, imageAssetId, filename, or generic chart patterns.'
    );
    systemInstructions.push(
      'For Describe Image: when the attached image has a visible title, axes, labels, or legend, imageCaption and expectedKeyPoints must reflect those visible words and values.'
    );
    systemInstructions.push(
      'For Describe Image: if visual evidence is unclear, keep imageCaption and expectedKeyPoints conservative and explicitly avoid invented facts.'
    );
  }
  if (payloadFields.includes('answerAliases')) {
    systemInstructions.push(
      'For speaking answer short question: answerAliases should include practical paraphrases/spelling variants only when clearly equivalent.'
    );
  }
  if (payloadFields.includes('allowSemanticMatch')) {
    systemInstructions.push('allowSemanticMatch must be a boolean true/false value.');
  }
  if (payloadFields.includes('caseSensitive')) {
    systemInstructions.push('caseSensitive must be a boolean true/false value.');
  }
  if (questionType === 'reading_writing_fill_in_blank') {
    systemInstructions.push(
      'For reading & writing fill-in-blank: treat sourcePassage, passageWithBlanks, and blankAnswerMap as fixed author-provided inputs; do not rewrite or alter them.'
    );
    systemInstructions.push(
      'For each blank key in blankAnswerMap, produce exactly 4 unique options in blankOptionsMap: include the exact correct answer plus 3 plausible context-relevant distractors.'
    );
    systemInstructions.push(
      'For each blank, infer the grammatical role from local sentence context and keep distractors in the same role: verb blanks -> verb forms, adjective blanks -> adjectives, noun blanks -> nouns, adverb blanks -> adverbs.'
    );
    systemInstructions.push(
      'Verb distractors should be alternative tense/aspect/person forms that still fit grammar; adjective distractors should remain adjectival (including comparative/superlative only when natural); noun distractors should match singular/plural usage; multi-word answers should keep similar phrase length and slot.'
    );
    systemInstructions.push(
      'Do not use unrelated named entities, titles, or proper-noun fragments as distractors unless the correct answer itself is a named entity.'
    );
    systemInstructions.push(
      'Every distractor must be topic-relevant to the passage and sentence context, plausible but not the best final answer, and must avoid random or off-topic words.'
    );
    systemInstructions.push(
      'If passageTitle is empty, suggest a concise meaningful title; always provide explanation aligned to the given passage and blanks.'
    );
  }
  if (payloadFields.includes('allowSynonyms')) {
    systemInstructions.push('allowSynonyms must be a boolean true/false value.');
  }
  if (payloadFields.includes('minWords') || payloadFields.includes('maxWords')) {
    if (questionType === 'writing_write_email') {
      systemInstructions.push('For writing write email, keep minWords and maxWords in 50-120 and ensure maxWords >= minWords.');
    } else if (questionType === 'writing_summarize_written_text') {
      systemInstructions.push(
        `For writing summarize written text, keep minWords and maxWords between ${WRITING_SUMMARY_WORD_RANGE.min}-${WRITING_SUMMARY_WORD_RANGE.max}, and ensure maxWords >= minWords.`
      );
    } else {
      systemInstructions.push(
        `For summary word limits, keep minWords and maxWords between ${LISTENING_SUMMARY_WORD_RANGE.min}-${LISTENING_SUMMARY_WORD_RANGE.max}, and ensure maxWords >= minWords.`
      );
    }
  }
  if (payloadFields.includes('recommendedTimeMinutes')) {
    if (questionType === 'writing_summarize_written_text') {
      systemInstructions.push(
        `For recommendedTimeMinutes, use an integer between ${WRITING_SUMMARY_TIME_RANGE.min}-${WRITING_SUMMARY_TIME_RANGE.max}.`
      );
    } else {
      systemInstructions.push(
        `For recommendedTimeMinutes, use an integer between ${LISTENING_SUMMARY_TIME_RANGE.min}-${LISTENING_SUMMARY_TIME_RANGE.max}.`
      );
    }
  }
  if (payloadFields.includes('expectedSummary') && payloadFields.includes('expectedKeyPoints')) {
    if (questionType === 'listening_summarize_spoken_text') {
      systemInstructions.push(
        'For listening summarize spoken text: expectedSummary should be concise and coherent, and expectedKeyPoints should list the major ideas in order of importance.'
      );
      systemInstructions.push(
        'For listening summarize spoken text: expectedSummary and expectedKeyPoints must be grounded in transcript/audio context only; do not invent facts.'
      );
      getListeningSummaryPolicyInstructions(normalizedTestType).forEach((line) => systemInstructions.push(line));
    } else if (questionType === 'writing_summarize_written_text') {
      systemInstructions.push(
        'For writing summarize written text: expectedSummary and expectedKeyPoints must be grounded in sourceText only; do not invent facts.'
      );
    }
  }
  if (payloadFields.includes('caseSensitive')) {
    systemInstructions.push('caseSensitive must be a boolean true/false value.');
  }
  if (payloadFields.includes('partialCreditEnabled') || scoringFields.includes('partialCreditEnabled')) {
    systemInstructions.push('partialCreditEnabled must be a boolean true/false value.');
  }
  if (payloadFields.includes('normalizationRules')) {
    systemInstructions.push('normalizationRules must be an object with boolean keys: caseSensitive, ignorePunctuation, normalizeWhitespace, normalizeQuotes.');
  }
  if (payloadFields.includes('transcriptWithBlanks') && payloadFields.includes('blankAnswerMap')) {
    systemInstructions.push(
      'For listening fill-in-blank: generate a clean full transcript in transcriptWithBlanks first; do not insert placeholders.'
    );
    systemInstructions.push(
      'Set blankAnswerMap to an empty object {} so question designers can manually highlight transcript parts and create blanks later.'
    );
  }
  if (payloadFields.includes('passageWithBlanks') && payloadFields.includes('blankAnswerMap')) {
    if (questionType === 'reading_writing_fill_in_blank') {
      systemInstructions.push(
        'For reading & writing fill-in-blank: preserve sourcePassage as untouched reference text and use passageWithBlanks as the editable version.'
      );
      systemInstructions.push(
        'If passageWithBlanks has no placeholders and sourcePassage exists, you may create concise placeholders (e.g., {{1}}, {{2}}, ...) from sourcePassage and provide matching blankAnswerMap entries.'
      );
      systemInstructions.push(
        'blankAnswerMap keys must match placeholder tokens in passageWithBlanks exactly and be sequential in reading order.'
      );
    } else {
      systemInstructions.push(
        'For reading fill-in-blank: preserve sourcePassage as untouched reference text and use passageWithBlanks as the editable version.'
      );
      systemInstructions.push(
        'Do not invent placeholders; if passageWithBlanks has no placeholders, keep blankAnswerMap as {} so designers can mark blanks manually.'
      );
      systemInstructions.push(
        'If bankOptions exists, expand it with plausible distractor words/phrases grounded in passage context while retaining true blank answers in blankAnswerMap only.'
      );
    }
  }
  if (payloadFields.includes('blankOptionsMap')) {
    systemInstructions.push(
      'For reading & writing fill-in-blank: blankOptionsMap must include one entry per blankAnswerMap key.'
    );
    systemInstructions.push(
      'Each blankOptionsMap entry must contain exactly 4 unique options and include the exact correct answer from blankAnswerMap.'
    );
    systemInstructions.push(
      'Distractors in blankOptionsMap must stay in the same grammatical category as the correct answer and remain context-grounded for that specific sentence.'
    );
    systemInstructions.push(
      'If no blanks are defined, keep blankOptionsMap as {}.'
    );
  }
  if (payloadFields.includes('paragraphItems') && payloadFields.includes('correctOrder')) {
    systemInstructions.push(
      'For reading reorder paragraphs: paragraphItems must be an array of paragraph strings in their authored order.'
    );
    systemInstructions.push(
      'Set correctOrder to include each paragraph from paragraphItems exactly once, in the correct logical sequence.'
    );
    systemInstructions.push(
      'If passageTitle is present, keep it concise and representative of the paragraph set.'
    );
  }
  if (questionType === 'reading_reorder_paragraphs') {
    systemInstructions.push(
      'For reading reorder paragraphs, treat paragraphItems and correctOrder as fixed author inputs and do not rewrite them.'
    );
    systemInstructions.push(
      'Generate only passageTitle and explanation (plus scoring fields) based on the provided paragraph set.'
    );
  }

  const systemPrompt = systemInstructions.join(' ');

  const userPrompt = [
    'Generate suggestions from this question context:',
    JSON.stringify(context, null, 2),
    (questionType === 'listening_summarize_spoken_text' || questionType === 'writing_summarize_written_text')
      ? `Policy profile: ${normalizedTestType || 'unspecified'}`
      : '',
    '',
    `Required payload keys: ${payloadFields.join(', ') || '(none)'}`,
    `Required scoring keys: ${scoringFields.join(', ') || '(none)'}`,
    '',
    'Output shape must be:',
    JSON.stringify(buildOutputShape(questionType, profile), null, 2)
  ].join('\n');

  return {
    supported: true,
    questionType,
    targetFields: payloadFields
      .map((key) => toScopedField('payload', key))
      .concat(scoringFields.map((key) => toScopedField('scoring', key))),
    systemPrompt,
    userPrompt,
    responseSchema: buildResponseSchema(profile),
    requiredContextError: profile.requiredContextError || '',
    completionContext: context
  };
}

function getPromptConfig(questionPlan = {}) {
  const questionType = normalizeQuestionType(questionPlan.questionType);
  const profile = PROFILE_MAP[questionType];
  if (!profile) {
    return {
      supported: false,
      questionType,
      targetFields: [],
      warning: 'AI Assist is available for Read Aloud, Repeat Sentence, Answer Short Question, Writing Summarize Written Text, Write Email, Reading MCQ Single, Reading MCQ Multiple, Reading Writing Fill in the Blanks, Reading Fill in the Blanks, Reading Reorder Paragraphs, Listening MCQ Single, Listening Select Missing Word, Listening MCQ Multiple, Listening Fill in the Blanks, Listening Highlight Incorrect Words, Listening Dictation, Listening Summarize Spoken Text, Respond to Situation, and Describe Image in this phase.'
    };
  }
  return buildPromptConfig(questionType, questionPlan, profile);
}

module.exports = {
  SUPPORTED_TYPES,
  getPromptConfig
};
