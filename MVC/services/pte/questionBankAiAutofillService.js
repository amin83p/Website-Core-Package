const fs = require('fs').promises;
const path = require('path');
const questionTypeRegistry = require('./questionTypeRegistry');
const pteAiProviderDataService = require('./pteAiProviderDataService');
const pteAiProviderService = require('./ai/aiProviderService');
const promptRegistry = require('./questionBankAiPromptRegistry');
const settingService = require('../settingService');
const uploadPathUtils = require('../../utils/uploadPathUtils');
const {
  isRailwayProxyMode,
  getGatewayBaseUrl,
  getGatewayTimeoutMs
} = require('../../utils/uploadModeUtils');

const SUPPORTED_AI_PROVIDERS = new Set(['google-gemini', 'google-vertex', 'openai', 'anthropic', 'azure-openai']);
const TARGET_REGISTERS = Object.freeze(['formal', 'neutral', 'informal']);
const POLITENESS_LEVELS = Object.freeze(['high', 'medium', 'low']);
const PREP_TIME_RANGE = Object.freeze({ min: 20, max: 30, fallback: 25 });
const RESPONSE_TIME_RANGE = Object.freeze({ min: 30, max: 45, fallback: 40 });
const REPEAT_SENTENCE_RESPONSE_TIME_RANGE = Object.freeze({ min: 8, max: 30, fallback: 20 });
const ANSWER_SHORT_QUESTION_RESPONSE_TIME_RANGE = Object.freeze({ min: 1, max: 30, fallback: 15 });
const WRITING_SUMMARY_WORD_RANGE = Object.freeze({ min: 5, max: 75, fallbackMin: 5, fallbackMax: 75 });
const WRITING_SUMMARY_TIME_RANGE = Object.freeze({ min: 1, max: 30, fallback: 10 });
const LISTENING_SUMMARY_WORD_RANGE = Object.freeze({ min: 1, max: 400, fallbackMin: 50, fallbackMax: 70 });
const LISTENING_SUMMARY_TIME_RANGE = Object.freeze({ min: 1, max: 60, fallback: 10 });
const KEYPOINT_RULES = Object.freeze({ minItems: 2, maxItems: 6, maxItemChars: 160 });
const EMAIL_REQUIRED_POINT_RULES = Object.freeze({ minItems: 3, maxItems: 6, maxItemChars: 200 });
const INCORRECT_WORD_RULES = Object.freeze({ minItems: 1, maxItems: 20, maxItemChars: 200 });
const ANSWER_SHORT_RULES = Object.freeze({
  minAccepted: 1,
  maxAccepted: 8,
  maxAliases: 12,
  maxItemChars: 200
});
const WRITING_EMAIL_TRAITS = Object.freeze([
  'content',
  'emailconventions',
  'form',
  'organization',
  'vocabulary',
  'grammar',
  'spelling'
]);
const WRITING_SUMMARY_TRAITS = Object.freeze([
  'content',
  'form',
  'grammar',
  'vocabulary'
]);
const TRANSCRIPT_VARIANT_RULES = Object.freeze({ minItems: 1, maxItems: 6, maxItemChars: 500 });
const TRANSCRIPT_VARIANT_ALIGNMENT_THRESHOLD = 0.6;
const TRANSCRIPT_VARIANT_DESIRED_MIN_ITEMS = 2;
const MCQ_OPTION_RULES = Object.freeze({ minItems: 2, maxItems: 6, maxKeyChars: 80, maxTextChars: 5000 });
const DICTATION_NORMALIZATION_RULE_DEFAULTS = Object.freeze({
  caseSensitive: false,
  ignorePunctuation: true,
  normalizeWhitespace: true,
  normalizeQuotes: true
});
const FILL_BLANK_RULES = Object.freeze({
  minBlanks: 3,
  maxBlanks: 8,
  maxTranscriptChars: 50000,
  maxAnswerChars: 180
});
const REORDER_PARAGRAPH_RULES = Object.freeze({
  minItems: 2,
  maxItems: 12,
  maxItemChars: 5000,
  maxTitleChars: 180
});
const READING_FILL_BANK_OPTION_RULES = Object.freeze({
  maxItems: 40,
  maxItemChars: 180
});
const READING_WRITING_BLANK_OPTION_RULES = Object.freeze({
  perBlankOptions: 4,
  maxItemChars: 180
});
const READING_WRITING_OPTION_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'by', 'for', 'from', 'has', 'have', 'had',
  'he', 'her', 'hers', 'him', 'his', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'me', 'my',
  'of', 'on', 'or', 'our', 'ours', 'she', 'that', 'the', 'their', 'them', 'they', 'this', 'those', 'to',
  'too', 'under', 'up', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who', 'whom', 'why', 'with',
  'you', 'your', 'yours'
]);
const READING_WRITING_ADVERB_SUFFIX_PATTERN = /ly$/i;
const READING_WRITING_ADJECTIVE_SUFFIX_PATTERN = /(ous|ful|less|ive|al|able|ible|ic|ish|ary|ory|ant|ent|y)$/i;
const READING_WRITING_VERB_SUFFIX_PATTERN = /(ing|ed|en|ify|ise|ize)$/i;
const READING_WRITING_NOUN_SUFFIX_PATTERN = /(tion|sion|ment|ness|ity|ship|hood|ance|ence|ism|age)$/i;
const READING_WRITING_VERB_STEM_HINTS = new Set([
  'be', 'have', 'do', 'go', 'make', 'take', 'use', 'review', 'improve', 'increase', 'decrease',
  'reduce', 'support', 'provide', 'develop', 'analyze', 'analyse', 'maintain', 'assess', 'perform'
]);
const READING_WRITING_AUXILIARY_VERBS = new Set([
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'has', 'have', 'had', 'do', 'does', 'did'
]);
const READING_WRITING_MODAL_OR_INFINITIVE_MARKERS = new Set([
  'to', 'can', 'could', 'may', 'might', 'must', 'should', 'would', 'will', 'shall'
]);
const READING_WRITING_DETERMINERS = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those',
  'my', 'your', 'his', 'her', 'its', 'our', 'their'
]);
const READING_WRITING_COMMON_ADVERBS = new Set([
  'once', 'often', 'usually', 'rarely', 'sometimes', 'always', 'never', 'soon', 'later', 'already',
  'still', 'yet', 'however', 'therefore', 'thus', 'then', 'thoroughly', 'carefully', 'gradually',
  'rapidly', 'clearly', 'consistently', 'effectively', 'especially', 'particularly', 'also', 'only',
  'today', 'first'
]);
const READING_WRITING_NUMERIC_WORDS = new Set([
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'hundred', 'thousand', 'million', 'billion', 'first', 'second', 'third', 'fourth',
  'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'
]);
const READING_WRITING_IRREGULAR_PARTICIPLES = new Set([
  'met', 'seen', 'known', 'made', 'taken', 'given', 'found', 'shown', 'held',
  'left', 'lost', 'built', 'caught', 'taught', 'bought', 'brought', 'thought', 'done', 'gone'
]);
const SCORE_RATIO_RANGE = Object.freeze({ min: 0, max: 1 });
const SCORE_WPM_RANGE = Object.freeze({ min: 40, max: 260 });
const LISTENING_AUDIO_TRANSCRIPT_MAX_BYTES = 8 * 1024 * 1024;
const LISTENING_AUDIO_TRANSCRIPT_SUPPORTED_PROVIDERS = new Set(['google-gemini', 'google-vertex', 'openai', 'anthropic', 'azure-openai']);
const LISTENING_AUDIO_TRANSCRIPT_GENERATION_CONFIG = Object.freeze({
  temperature: 0,
  topP: 1,
  maxOutputTokens: 16384,
  reasoningEffort: 'minimal'
});
const AI_ASSIST_MEDIA_MAX_BYTES = 8 * 1024 * 1024;
const AUDIO_MIME_BY_EXT = Object.freeze({
  mp3: 'audio/mpeg',
  mpeg: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  webm: 'audio/webm',
  flac: 'audio/flac'
});
const IMAGE_MIME_BY_EXT = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml'
});
const AUDIO_REF_EXT_PATTERN = /\.(mp3|mpeg|wav|m4a|aac|ogg|webm|flac)(\?.*)?$/i;
const AI_ASSIST_MEDIA_INPUTS_BY_TYPE = Object.freeze({
  listening_mcq_single: Object.freeze([
    Object.freeze({ payloadKey: 'promptAudioAssetId', kind: 'audio', label: 'Prompt Audio' })
  ]),
  listening_select_missing_word: Object.freeze([
    Object.freeze({ payloadKey: 'promptAudioAssetId', kind: 'audio', label: 'Prompt Audio' })
  ]),
  listening_mcq_multiple: Object.freeze([
    Object.freeze({ payloadKey: 'promptAudioAssetId', kind: 'audio', label: 'Prompt Audio' })
  ]),
  listening_fill_in_blank: Object.freeze([
    Object.freeze({ payloadKey: 'promptAudioAssetId', kind: 'audio', label: 'Prompt Audio' })
  ]),
  listening_highlight_incorrect_words: Object.freeze([
    Object.freeze({ payloadKey: 'promptAudioAssetId', kind: 'audio', label: 'Prompt Audio' })
  ]),
  listening_dictation: Object.freeze([
    Object.freeze({ payloadKey: 'promptAudioAssetId', kind: 'audio', label: 'Prompt Audio' })
  ]),
  listening_summarize_spoken_text: Object.freeze([
    Object.freeze({ payloadKey: 'promptAudioAssetId', kind: 'audio', label: 'Prompt Audio' })
  ]),
  speaking_repeat_sentence: Object.freeze([
    Object.freeze({ payloadKey: 'promptAudioAssetId', kind: 'audio', label: 'Prompt Audio' })
  ]),
  speaking_describe_image: Object.freeze([
    Object.freeze({ payloadKey: 'imageAssetId', kind: 'image', label: 'Image Asset' })
  ])
});
const DESCRIBE_IMAGE_VISUAL_PAYLOAD_KEYS = Object.freeze(['imageCaption', 'expectedKeyPoints', 'chartType']);
const DESCRIBE_IMAGE_VISUAL_PAYLOAD_KEY_SET = new Set(DESCRIBE_IMAGE_VISUAL_PAYLOAD_KEYS);
const DESCRIBE_IMAGE_AI_ASSIST_NO_EVIDENCE_WARNING = 'Describe Image AI Assist did not update visual content because no readable prompt image, caption, or key points were available. Attach the image or enter reliable visual context before using AI Assist.';
const DESCRIBE_IMAGE_GENERIC_VISUAL_TEXTS = new Set([
  'describe the key visual patterns and important details',
  'identify the main trend',
  'mention at least one supporting detail'
]);

const TRAIT_KEYS_BY_TYPE = Object.freeze({
  speaking_describe_image: Object.freeze(['content', 'pronunciation', 'fluency']),
  speaking_respond_to_situation: Object.freeze(['appropriacy', 'pronunciation', 'fluency'])
});

const TARGET_DEFAULTS = Object.freeze({
  speaking_read_aloud: Object.freeze({
    payload: Object.freeze({
      referenceTranscript: 'Read the passage clearly with natural pacing and complete wording.',
      pronunciationNotes: 'Focus on stress, intonation, and clear articulation of complex words.',
      prepTimeSeconds: PREP_TIME_RANGE.fallback,
      responseTimeSeconds: RESPONSE_TIME_RANGE.fallback
    }),
    scoring: Object.freeze({
      method: 'hybrid_ai_audio',
      scorerVersion: 'pte-read-aloud-v1',
      maxScoreMode: 'dynamic_source_word_count_plus_traits',
      maxScore: 5,
      traits: Object.freeze(['content', 'pronunciation', 'fluency']),
      contentScoringMode: 'word_alignment_errors',
      pronunciationMax: 5,
      fluencyMax: 5,
      idealWpmMin: 90,
      idealWpmMax: 160,
      longPauseSeconds: 2,
      minAnalysisConfidence: 0.35
    })
  }),
  speaking_repeat_sentence: Object.freeze({
    payload: Object.freeze({
      expectedTranscript: 'Repeat the sentence exactly as heard with complete wording and natural pacing.',
      transcriptVariants: Object.freeze([
        'Repeat the sentence exactly as heard with complete wording and natural pacing.',
        'Repeat the sentence exactly as heard using clear pronunciation and natural pacing.'
      ]),
      responseTimeSeconds: REPEAT_SENTENCE_RESPONSE_TIME_RANGE.fallback
    }),
    scoring: Object.freeze({
      method: 'hybrid_ai_audio',
      maxScore: 5,
      traits: Object.freeze(['content', 'pronunciation', 'fluency'])
    })
  }),
  speaking_answer_short_question: Object.freeze({
    payload: Object.freeze({
      transcript: 'Question prompt transcript for practice reference.',
      acceptedAnswers: Object.freeze(['Canberra']),
      answerAliases: Object.freeze(['the capital of Australia is Canberra']),
      caseSensitive: false,
      allowSemanticMatch: true,
      responseTimeSeconds: ANSWER_SHORT_QUESTION_RESPONSE_TIME_RANGE.fallback
    }),
    scoring: Object.freeze({
      method: 'hybrid_ai_audio_objective',
      scorerVersion: 'pte-answer-short-question-v1',
      maxScore: 1,
      traits: Object.freeze(['vocabulary']),
      minAnalysisConfidence: 0.35,
      minSemanticConfidence: 0.7
    })
  }),
  writing_summarize_written_text: Object.freeze({
    payload: Object.freeze({
      sourceTitle: 'Source passage title',
      expectedSummary: 'Concise one-sentence summary grounded in the source text.',
      expectedKeyPoints: Object.freeze([
        'State the central idea from the passage',
        'Include the most important supporting point'
      ]),
      minWords: WRITING_SUMMARY_WORD_RANGE.fallbackMin,
      maxWords: WRITING_SUMMARY_WORD_RANGE.fallbackMax,
      recommendedTimeMinutes: WRITING_SUMMARY_TIME_RANGE.fallback
    }),
    scoring: Object.freeze({
      method: 'hybrid_ai',
      maxScore: 7,
      traits: Object.freeze(['content', 'form', 'grammar', 'vocabulary'])
    })
  }),
  writing_write_email: Object.freeze({
    payload: Object.freeze({
      recipientRole: 'course coordinator',
      senderRole: 'student',
      purpose: 'Request clarification and confirm next steps.',
      requiredPoints: Object.freeze([
        'State the reason for writing clearly.',
        'Ask for the specific information or action needed.',
        'Close politely with a confirmation request.'
      ]),
      targetRegister: 'formal',
      suggestedSubject: 'Request for Clarification',
      expectedTone: 'polite and professional',
      minWords: 50,
      maxWords: 120
    }),
    scoring: Object.freeze({
      method: 'hybrid_ai',
      maxScore: 15,
      traits: Object.freeze(['content', 'emailConventions', 'form', 'organization', 'vocabulary', 'grammar', 'spelling'])
    })
  }),
  speaking_respond_to_situation: Object.freeze({
    payload: Object.freeze({
      role: 'candidate',
      audience: 'listener',
      targetFunction: 'inform',
      targetRegister: 'neutral',
      contextNotes: 'Keep response concise and directly tied to the situation.',
      expectedKeyPoints: Object.freeze(['Acknowledge the situation', 'State a clear response with reason']),
      politenessLevel: 'medium',
      prepTimeSeconds: PREP_TIME_RANGE.fallback,
      responseTimeSeconds: RESPONSE_TIME_RANGE.fallback
    }),
    scoring: Object.freeze({
      traitWeights: Object.freeze({ appropriacy: 0.5, pronunciation: 0.25, fluency: 0.25 }),
      contentCoverageMin: 0.6,
      minResponseSeconds: 20,
      idealWpmMin: 85,
      idealWpmMax: 155,
      offTopicPenalty: 0.25
    })
  }),
  speaking_describe_image: Object.freeze({
    payload: Object.freeze({
      imageCaption: 'Describe the key visual patterns and important details.',
      expectedKeyPoints: Object.freeze(['Identify the main trend', 'Mention at least one supporting detail']),
      chartType: 'mixed_chart',
      prepTimeSeconds: PREP_TIME_RANGE.fallback,
      responseTimeSeconds: RESPONSE_TIME_RANGE.fallback
    }),
    scoring: Object.freeze({
      method: 'hybrid_ai_audio_visual',
      scorerVersion: 'pte-describe-image-v1',
      maxScore: 15,
      traits: Object.freeze(['content', 'pronunciation', 'fluency']),
      traitWeights: Object.freeze({ content: 0.5, pronunciation: 0.25, fluency: 0.25 }),
      contentMax: 5,
      pronunciationMax: 5,
      fluencyMax: 5,
      contentCoverageMin: 0.6,
      minResponseSeconds: 20,
      idealWpmMin: 90,
      idealWpmMax: 160,
      longPauseSeconds: 2,
      offTopicPenalty: 0.2,
      minAnalysisConfidence: 0.35
    })
  }),
  reading_mcq_single: Object.freeze({
    payload: Object.freeze({
      passageTitle: 'Reading passage title',
      passageHtml: 'Reading passage text used for comprehension and inference.',
      stem: 'According to the passage, which statement is correct?',
      options: Object.freeze([
        Object.freeze({ key: 'A', text: 'Option A' }),
        Object.freeze({ key: 'B', text: 'Option B' }),
        Object.freeze({ key: 'C', text: 'Option C' }),
        Object.freeze({ key: 'D', text: 'Option D' })
      ]),
      correctOptionKey: 'A',
      explanation: 'The correct option is directly supported by the passage.'
    }),
    scoring: Object.freeze({
      method: 'auto_objective',
      maxScore: 1
    })
  }),
  reading_mcq_multiple: Object.freeze({
    payload: Object.freeze({
      passageTitle: 'Reading passage title',
      passageHtml: 'Reading passage text used for comprehension and inference.',
      stem: 'According to the passage, which TWO statements are supported?',
      options: Object.freeze([
        Object.freeze({ key: 'A', text: 'Option A' }),
        Object.freeze({ key: 'B', text: 'Option B' }),
        Object.freeze({ key: 'C', text: 'Option C' }),
        Object.freeze({ key: 'D', text: 'Option D' })
      ]),
      correctOptionKeys: Object.freeze(['A', 'C']),
      explanation: 'Select all options that are directly supported by the passage.'
    }),
    scoring: Object.freeze({
      method: 'auto_objective',
      maxScore: 1
    })
  }),
  reading_fill_in_blank: Object.freeze({
    payload: Object.freeze({
      sourcePassage: 'Students should review notes after each lecture to improve retention and long-term recall.',
      passageWithBlanks: 'Students should review {{1}} after each lecture to improve {{2}} and long-term recall.',
      blankAnswerMap: Object.freeze({
        '{{1}}': 'notes',
        '{{2}}': 'retention'
      }),
      bankOptions: Object.freeze(['notes', 'retention', 'attendance', 'memorization', 'schedule']),
      caseSensitive: false,
      allowSynonyms: false,
      explanation: 'Blank answers should match contextual vocabulary from the passage.'
    }),
    scoring: Object.freeze({
      method: 'auto_objective',
      maxScore: 1,
      perBlankScore: 1
    })
  }),
  reading_writing_fill_in_blank: Object.freeze({
    payload: Object.freeze({
      passageTitle: 'Reading passage title',
      sourcePassage: 'Students should review notes after each lecture to improve retention and long-term recall.',
      passageWithBlanks: 'Students should review {{1}} after each lecture to improve {{2}} and long-term recall.',
      blankAnswerMap: Object.freeze({
        '{{1}}': 'notes',
        '{{2}}': 'retention'
      }),
      blankOptionsMap: Object.freeze({
        '{{1}}': Object.freeze(['notes', 'summaries', 'diagrams', 'schedules']),
        '{{2}}': Object.freeze(['retention', 'attendance', 'punctuation', 'navigation'])
      }),
      caseSensitive: false,
      explanation: 'Each blank has four options with one correct context-matching answer.'
    }),
    scoring: Object.freeze({
      method: 'auto_objective',
      maxScore: 1,
      perBlankScore: 1
    })
  }),
  reading_reorder_paragraphs: Object.freeze({
    payload: Object.freeze({
      passageTitle: 'Reading passage title',
      paragraphItems: Object.freeze([
        'Paragraph one text.',
        'Paragraph two text.'
      ]),
      correctOrder: Object.freeze([
        'Paragraph one text.',
        'Paragraph two text.'
      ]),
      explanation: 'Correct order reflects the logical flow of ideas and references between paragraphs.'
    }),
    scoring: Object.freeze({
      method: 'auto_objective',
      maxScore: 1,
      partialCreditEnabled: false
    })
  }),
  listening_mcq_single: Object.freeze({
    payload: Object.freeze({
      transcript: 'Short transcript aligned with the prompt audio.',
      stem: 'What is the main idea expressed in the audio?',
      options: Object.freeze([
        Object.freeze({ key: 'A', text: 'Main idea option A' }),
        Object.freeze({ key: 'B', text: 'Main idea option B' }),
        Object.freeze({ key: 'C', text: 'Main idea option C' }),
        Object.freeze({ key: 'D', text: 'Main idea option D' })
      ]),
      correctOptionKey: 'A',
      allowReplay: false,
      explanation: 'The correct option best matches the speaker’s main message.'
    }),
    scoring: Object.freeze({
      method: 'auto_objective',
      maxScore: 1
    })
  }),
  listening_mcq_multiple: Object.freeze({
    payload: Object.freeze({
      transcript: 'Short transcript aligned with the prompt audio.',
      stem: 'Which TWO statements are supported by the speaker?',
      options: Object.freeze([
        Object.freeze({ key: 'A', text: 'Supported idea option A' }),
        Object.freeze({ key: 'B', text: 'Supported idea option B' }),
        Object.freeze({ key: 'C', text: 'Supported idea option C' }),
        Object.freeze({ key: 'D', text: 'Supported idea option D' })
      ]),
      correctOptionKeys: Object.freeze(['A', 'C']),
      partialCreditEnabled: false,
      allowReplay: false,
      explanation: 'Select all options that directly match the speaker\'s points.'
    }),
    scoring: Object.freeze({
      method: 'auto_objective',
      maxScore: 1,
      partialCreditEnabled: false
    })
  }),
  listening_select_missing_word: Object.freeze({
    payload: Object.freeze({
      transcriptWithGap: 'The committee decided to postpone the final decision until [BLANK].',
      options: Object.freeze([
        Object.freeze({ key: 'A', text: 'next Monday' }),
        Object.freeze({ key: 'B', text: 'last week' }),
        Object.freeze({ key: 'C', text: 'three years ago' }),
        Object.freeze({ key: 'D', text: 'yesterday morning' })
      ]),
      correctOptionKey: 'A',
      transcript: 'The committee decided to postpone the final decision until next Monday.',
      allowReplay: false,
      explanation: 'Choose the option that best completes the missing ending phrase from the audio.'
    }),
    scoring: Object.freeze({
      method: 'auto_objective',
      maxScore: 1
    })
  }),
  listening_fill_in_blank: Object.freeze({
    payload: Object.freeze({
      transcriptWithBlanks: 'Students should review notes after each lecture to improve retention and long-term recall.',
      blankAnswerMap: Object.freeze({}),
      allowReplay: false,
      caseSensitive: false,
      explanation: 'Missing words should test accurate listening and contextual vocabulary.'
    }),
    scoring: Object.freeze({
      method: 'auto_objective',
      maxScore: 1,
      perBlankScore: 1
    })
  }),
  listening_highlight_incorrect_words: Object.freeze({
    payload: Object.freeze({
      transcript: 'The campus library opens at seven in the morning and closes at nine in the evening on weekdays.',
      transcriptText: 'The campus library opens at six in the morning and closes at ten in the evening on weekdays.',
      incorrectWords: Object.freeze(['six', 'ten']),
      allowReplay: false,
      explanation: 'Highlight words in the transcript that do not match the audio.'
    }),
    scoring: Object.freeze({
      method: 'auto_objective',
      maxScore: 1,
      perWordScore: 1
    })
  }),
  listening_dictation: Object.freeze({
    payload: Object.freeze({
      expectedTranscript: 'Students should review notes after each lecture to improve retention and long-term recall.',
      transcriptVariants: Object.freeze([
        'Students should review notes after each lecture to improve retention and long-term recall.',
        'Students should review their notes after each lecture to improve retention and long-term recall.'
      ]),
      allowReplay: false,
      normalizationRules: DICTATION_NORMALIZATION_RULE_DEFAULTS
    }),
    scoring: Object.freeze({
      method: 'auto_objective',
      maxScore: 1,
      perWordScore: 1
    })
  }),
  listening_summarize_spoken_text: Object.freeze({
    payload: Object.freeze({
      transcript: 'Transcript aligned with the prompt audio.',
      expectedSummary: 'Concise summary covering the key idea and supporting points from the audio.',
      expectedKeyPoints: Object.freeze([
        'State the main topic from the talk',
        'Include two supporting details from the audio'
      ]),
      minWords: LISTENING_SUMMARY_WORD_RANGE.fallbackMin,
      maxWords: LISTENING_SUMMARY_WORD_RANGE.fallbackMax,
      recommendedTimeMinutes: LISTENING_SUMMARY_TIME_RANGE.fallback,
      allowReplay: false
    }),
    scoring: Object.freeze({
      method: 'hybrid_ai',
      maxScore: 5,
      traits: Object.freeze(['content', 'form', 'grammar', 'vocabulary'])
    })
  })
});

function s(value) {
  return String(value ?? '').trim();
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeObject(value, fallback = {}) {
  return isPlainObject(value) ? value : fallback;
}

function deepClone(value, fallback = null) {
  try {
    if (value === undefined) return fallback;
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallback;
  }
}

function normalizeQuestionPlan(questionPlan = {}) {
  const source = safeObject(questionPlan, {});
  return {
    title: s(source.title),
    testType: s(source.testType).toLowerCase(),
    skill: s(source.skill).toLowerCase(),
    questionType: s(source.questionType).toLowerCase(),
    instructions: s(source.instructions),
    payload: safeObject(source.payload, {}),
    scoringConfig: safeObject(source.scoringConfig, {}),
    mediaAssets: Array.isArray(source.mediaAssets)
      ? source.mediaAssets.filter((row) => isPlainObject(row)).map((row) => ({ ...row }))
      : []
  };
}

function isMeaningfulValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return s(value).length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return true;
}

function normalizeEvidenceText(value = '') {
  return s(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericDescribeImageVisualText(value = '') {
  const normalized = normalizeEvidenceText(value);
  if (!normalized) return true;
  return DESCRIBE_IMAGE_GENERIC_VISUAL_TEXTS.has(normalized);
}

function normalizeDescribeImageKeyPoints(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((item) => s(item))
    .filter(Boolean);
}

function isReliableDescribeImageVisualText(value = '') {
  const text = s(value);
  if (!text || isGenericDescribeImageVisualText(text)) return false;
  const words = normalizeEvidenceText(text).split(' ').filter(Boolean);
  return text.length >= 24 || words.length >= 5;
}

function hasReliableDescribeImageTextContext(payload = {}) {
  const source = safeObject(payload, {});
  const caption = s(source.imageCaption);
  if (isReliableDescribeImageVisualText(caption)) return true;

  const keyPoints = normalizeDescribeImageKeyPoints(source.expectedKeyPoints)
    .filter((item) => isReliableDescribeImageVisualText(item));
  return keyPoints.length >= 2;
}

function hasDescribeImageVisualDraft(payload = {}) {
  const source = safeObject(payload, {});
  return (
    s(source.imageCaption)
    || normalizeDescribeImageKeyPoints(source.expectedKeyPoints).length
    || s(source.chartType)
  );
}

function withoutDescribeImageVisualDraft(normalizedPlan = {}) {
  const payload = { ...safeObject(normalizedPlan?.payload, {}) };
  DESCRIBE_IMAGE_VISUAL_PAYLOAD_KEYS.forEach((key) => {
    delete payload[key];
  });
  return {
    ...safeObject(normalizedPlan, {}),
    payload
  };
}

function getDescribeImageVisualEvidenceStatus(normalizedPlan = {}, mediaBundle = {}) {
  const payload = safeObject(normalizedPlan?.payload, {});
  const hasAttachedImage = (Array.isArray(mediaBundle?.parts) ? mediaBundle.parts : []).some((part) => {
    const mimeType = s(part?.inlineData?.mimeType).toLowerCase();
    return mimeType.startsWith('image/');
  });
  const hasTextContext = hasReliableDescribeImageTextContext(payload);
  return {
    hasAttachedImage,
    hasTextContext,
    hasEvidence: hasAttachedImage || hasTextContext
  };
}

function isDescribeImageVisualPayloadTarget(target = {}, questionType = '') {
  return (
    s(questionType).toLowerCase() === 'speaking_describe_image'
    && s(target?.scope).toLowerCase() === 'payload'
    && DESCRIBE_IMAGE_VISUAL_PAYLOAD_KEY_SET.has(s(target?.key))
  );
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return fallback;
  if (Number.isFinite(min) && parsed < min) return min;
  if (Number.isFinite(max) && parsed > max) return max;
  return parsed;
}

function clampNumber(value, min, max, fallback, precision = 6) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return fallback;
  const bounded = Math.min(max, Math.max(min, parsed));
  return Number(bounded.toFixed(precision));
}

function normalizeControlledEnum(rawValue, allowed = [], fallback = '') {
  const token = s(rawValue).toLowerCase();
  const values = Array.isArray(allowed)
    ? allowed.map((row) => s(row).toLowerCase()).filter(Boolean)
    : [];
  if (!token) return fallback || values[0] || '';
  if (values.includes(token)) return token;

  if (values.includes('formal') && /(formal|professional|official)/.test(token)) return 'formal';
  if (values.includes('neutral') && /(neutral|balanced|standard)/.test(token)) return 'neutral';
  if (values.includes('informal') && /(informal|casual|friendly|colloquial|conversational|everyday|social)/.test(token)) return 'informal';
  if (values.includes('high') && /(high|very polite|respectful|deferential)/.test(token)) return 'high';
  if (values.includes('medium') && /(medium|moderate|neutral|balanced)/.test(token)) return 'medium';
  if (values.includes('low') && /(low|direct|casual|blunt)/.test(token)) return 'low';
  return fallback || values[0] || '';
}

function normalizeExpectedKeyPoints(value, warnings = []) {
  const rows = Array.isArray(value)
    ? value
    : String(value ?? '')
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
  const out = [];
  const seen = new Set();
  rows.forEach((item) => {
    const normalized = s(item).slice(0, KEYPOINT_RULES.maxItemChars);
    if (!normalized) return;
    const dedupe = normalized.toLowerCase();
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push(normalized);
  });
  if (out.length > KEYPOINT_RULES.maxItems) {
    warnings.push(`Expected key points were limited to ${KEYPOINT_RULES.maxItems} items.`);
  }
  const sliced = out.slice(0, KEYPOINT_RULES.maxItems);
  if (sliced.length && sliced.length < KEYPOINT_RULES.minItems) {
    warnings.push(`Expected key points should include at least ${KEYPOINT_RULES.minItems} items.`);
  }
  return sliced;
}

function normalizeRequiredPoints(value, warnings = []) {
  const rows = Array.isArray(value)
    ? value
    : String(value ?? '')
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
  const out = [];
  const seen = new Set();
  rows.forEach((item) => {
    const normalized = s(item).slice(0, EMAIL_REQUIRED_POINT_RULES.maxItemChars);
    if (!normalized) return;
    const dedupe = normalized.toLowerCase();
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push(normalized);
  });
  if (out.length > EMAIL_REQUIRED_POINT_RULES.maxItems) {
    warnings.push(`requiredPoints were limited to ${EMAIL_REQUIRED_POINT_RULES.maxItems} items.`);
  }
  const sliced = out.slice(0, EMAIL_REQUIRED_POINT_RULES.maxItems);
  if (sliced.length && sliced.length < EMAIL_REQUIRED_POINT_RULES.minItems) {
    warnings.push(`requiredPoints should include at least ${EMAIL_REQUIRED_POINT_RULES.minItems} items.`);
  }
  return sliced;
}

function normalizeIncorrectWords(value, warnings = []) {
  const rows = Array.isArray(value)
    ? value
    : String(value ?? '')
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  const out = [];
  const seen = new Set();
  rows.forEach((item) => {
    const normalized = s(item).slice(0, INCORRECT_WORD_RULES.maxItemChars);
    if (!normalized) return;
    const dedupe = normalized.toLowerCase();
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push(normalized);
  });
  if (out.length > INCORRECT_WORD_RULES.maxItems) {
    warnings.push(`Incorrect words were limited to ${INCORRECT_WORD_RULES.maxItems} items.`);
  }
  const sliced = out.slice(0, INCORRECT_WORD_RULES.maxItems);
  if (sliced.length && sliced.length < INCORRECT_WORD_RULES.minItems) {
    warnings.push(`Incorrect words should include at least ${INCORRECT_WORD_RULES.minItems} item.`);
  }
  return sliced;
}

function normalizeAnswerShortList(value, { maxItems = ANSWER_SHORT_RULES.maxAccepted, label = 'Answer items', minItems = 0 } = {}, warnings = []) {
  const rows = Array.isArray(value)
    ? value
    : String(value ?? '')
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  const out = [];
  const seen = new Set();
  rows.forEach((item) => {
    const normalized = s(item).slice(0, ANSWER_SHORT_RULES.maxItemChars);
    if (!normalized) return;
    const dedupe = normalized.toLowerCase();
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push(normalized);
  });
  if (out.length > maxItems) {
    warnings.push(`${label} were limited to ${maxItems} items.`);
  }
  const sliced = out.slice(0, maxItems);
  if (minItems > 0 && sliced.length && sliced.length < minItems) {
    warnings.push(`${label} should include at least ${minItems} item${minItems > 1 ? 's' : ''}.`);
  }
  return sliced;
}

function normalizeAcceptedAnswers(value, warnings = []) {
  return normalizeAnswerShortList(
    value,
    {
      maxItems: ANSWER_SHORT_RULES.maxAccepted,
      minItems: ANSWER_SHORT_RULES.minAccepted,
      label: 'Accepted answers'
    },
    warnings
  );
}

function normalizeAnswerAliases(value, warnings = []) {
  return normalizeAnswerShortList(
    value,
    {
      maxItems: ANSWER_SHORT_RULES.maxAliases,
      minItems: 0,
      label: 'Answer aliases'
    },
    warnings
  );
}

function tokenizeDisplayWordsForDiff(text = '') {
  const source = String(text || '');
  const regex = /[A-Za-z0-9]+(?:[-'’][A-Za-z0-9]+)*/g;
  const out = [];
  let match = null;
  while ((match = regex.exec(source)) !== null) {
    const raw = s(match[0]);
    if (!raw) continue;
    out.push({
      raw,
      norm: raw.toLowerCase()
    });
  }
  return out;
}

function extractChangedDisplayWords(sourceTranscript = '', displayTranscript = '') {
  const sourceWords = tokenizeDisplayWordsForDiff(sourceTranscript);
  const displayWords = tokenizeDisplayWordsForDiff(displayTranscript);
  const out = [];
  const seen = new Set();

  if (!sourceWords.length || !displayWords.length) return out;

  let i = 0;
  let j = 0;
  while (i < sourceWords.length || j < displayWords.length) {
    const sourceWord = sourceWords[i] || null;
    const displayWord = displayWords[j] || null;
    if (!sourceWord && !displayWord) break;

    if (sourceWord && displayWord && sourceWord.norm === displayWord.norm) {
      i += 1;
      j += 1;
      continue;
    }

    const nextSource = sourceWords[i + 1] || null;
    if (sourceWord && displayWord && nextSource && nextSource.norm === displayWord.norm) {
      i += 1;
      continue;
    }

    const nextDisplay = displayWords[j + 1] || null;
    if (sourceWord && displayWord && nextDisplay && sourceWord.norm === nextDisplay.norm) {
      if (!seen.has(displayWord.norm)) {
        out.push(displayWord.raw);
        seen.add(displayWord.norm);
      }
      j += 1;
      continue;
    }

    if (displayWord && !seen.has(displayWord.norm)) {
      out.push(displayWord.raw);
      seen.add(displayWord.norm);
    }
    if (sourceWord) i += 1;
    if (displayWord) j += 1;
  }

  return out;
}

function tryParseJson(rawValue = '') {
  try {
    return JSON.parse(String(rawValue || ''));
  } catch (_) {
    return null;
  }
}

function normalizeTranscriptVariantLine(value = '') {
  let token = s(value);
  if (!token) return '';
  token = token
    .replace(/^\s*(?:[-*]|\u2022)\s+/, '')
    .replace(/^\s*\(?\d+\)?[\)\].:-]\s+/, '')
    .replace(/^\s*[a-z][\)\].:-]\s+/i, '')
    .replace(/^["'`]+/, '')
    .replace(/["'`]+$/, '');
  return s(token);
}

function resolveTranscriptVariantText(value) {
  if (typeof value === 'string') return value;
  if (isPlainObject(value)) {
    const preferred = [
      value.transcript,
      value.variant,
      value.text,
      value.value,
      value.answer,
      value.expectedTranscript
    ]
      .map((item) => s(item))
      .find(Boolean);
    if (preferred) return preferred;
    const fallback = Object.values(value).map((item) => s(item)).find(Boolean);
    return fallback || '';
  }
  if (Array.isArray(value)) {
    const first = value.map((item) => s(item)).find(Boolean);
    return first || '';
  }
  return s(value);
}

function splitTranscriptVariants(value) {
  if (Array.isArray(value)) return value;
  if (isPlainObject(value)) return Object.values(value);

  const token = s(value);
  if (!token) return [];

  const parsed = tryParseJson(token);
  if (Array.isArray(parsed)) return parsed;
  if (isPlainObject(parsed)) return Object.values(parsed);
  if (typeof parsed === 'string') {
    const nested = tryParseJson(parsed);
    if (Array.isArray(nested)) return nested;
    if (isPlainObject(nested)) return Object.values(nested);
    if (s(parsed)) return [parsed];
  }

  const normalized = token.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n').map((item) => item.trim()).filter(Boolean);
  if (lines.length > 1) return lines;

  const inlineNumbered = normalized
    .split(/\s+(?=\(?\d+\)?[\)\].:-]\s+)/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (inlineNumbered.length > 1) return inlineNumbered;

  const doublePipe = normalized
    .split('||')
    .map((item) => item.trim())
    .filter(Boolean);
  if (doublePipe.length > 1) return doublePipe;

  return [normalized];
}

function normalizeTranscriptVariants(value, warnings = []) {
  const rows = splitTranscriptVariants(value);
  const out = [];
  const seen = new Set();
  rows.forEach((item) => {
    const normalized = normalizeTranscriptVariantLine(resolveTranscriptVariantText(item))
      .slice(0, TRANSCRIPT_VARIANT_RULES.maxItemChars);
    if (!normalized) return;
    const dedupe = normalized.toLowerCase();
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push(normalized);
  });
  if (out.length > TRANSCRIPT_VARIANT_RULES.maxItems) {
    warnings.push(`Transcript variants were limited to ${TRANSCRIPT_VARIANT_RULES.maxItems} items.`);
  }
  const sliced = out.slice(0, TRANSCRIPT_VARIANT_RULES.maxItems);
  if (sliced.length && sliced.length < TRANSCRIPT_VARIANT_RULES.minItems) {
    warnings.push(`Transcript variants should include at least ${TRANSCRIPT_VARIANT_RULES.minItems} item.`);
  }
  return sliced;
}

function normalizeTranscriptForComparison(value = '') {
  return s(value)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeTranscript(value = '') {
  return normalizeTranscriptForComparison(value)
    .split(' ')
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function computeTranscriptCoverageScore(expectedTranscript = '', candidateTranscript = '') {
  const expectedTokens = tokenizeTranscript(expectedTranscript);
  if (!expectedTokens.length) {
    return normalizeTranscriptForComparison(expectedTranscript) === normalizeTranscriptForComparison(candidateTranscript) ? 1 : 0;
  }
  const candidateSet = new Set(tokenizeTranscript(candidateTranscript));
  let shared = 0;
  expectedTokens.forEach((token) => {
    if (candidateSet.has(token)) shared += 1;
  });
  return shared / expectedTokens.length;
}

function buildTranscriptVariantFallbacks(expectedTranscript = '') {
  const base = s(expectedTranscript).slice(0, TRANSCRIPT_VARIANT_RULES.maxItemChars);
  if (!base) return [];
  const out = [];
  const replacementCandidates = [
    [/\bvital\b/i, 'essential'],
    [/\bessential\b/i, 'vital'],
    [/\bimportant\b/i, 'essential'],
    [/\bfor success\b/i, 'to succeed'],
    [/\bin this particular\b/i, 'in this'],
    [/\bthis particular\b/i, 'this'],
    [/\bthis course\b/i, 'the course'],
    [/\bthis class\b/i, 'the class'],
    [/\bcannot\b/i, 'can\'t'],
    [/\bcan not\b/i, 'cannot'],
    [/\bdo not\b/i, 'don\'t'],
    [/\bdoes not\b/i, 'doesn\'t']
  ];
  const pushUnique = (value) => {
    const normalized = s(value).slice(0, TRANSCRIPT_VARIANT_RULES.maxItemChars);
    if (!normalized) return;
    const dedupe = normalized.toLowerCase();
    if (!dedupe) return;
    if (out.some((row) => s(row).toLowerCase() === dedupe)) return;
    out.push(normalized);
  };
  pushUnique(base);
  if (/[.!?]$/.test(base)) {
    pushUnique(base.replace(/[.!?]+$/, '').trim());
  } else {
    pushUnique(`${base}.`);
  }
  replacementCandidates.forEach(([pattern, replacement]) => {
    if (pattern.test(base)) {
      pushUnique(base.replace(pattern, replacement));
    }
  });
  const compact = base
    .replace(/\b(particular|really|very|actually|basically|overall)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (compact && compact !== base) {
    pushUnique(compact);
  }
  return out.slice(0, TRANSCRIPT_VARIANT_RULES.maxItems);
}

function alignTranscriptVariantsToExpected(expectedTranscript = '', variants = [], warnings = []) {
  const expected = s(expectedTranscript).slice(0, TRANSCRIPT_VARIANT_RULES.maxItemChars);
  if (!expected) return normalizeTranscriptVariants(variants, warnings);

  const normalizedVariants = normalizeTranscriptVariants(variants, warnings);
  const normalizedExpected = normalizeTranscriptForComparison(expected);

  const aligned = normalizedVariants.filter((variant) => {
    const normalizedVariant = normalizeTranscriptForComparison(variant);
    if (!normalizedVariant) return false;
    if (normalizedVariant === normalizedExpected) return true;
    return computeTranscriptCoverageScore(expected, variant) >= TRANSCRIPT_VARIANT_ALIGNMENT_THRESHOLD;
  });

  const out = [];
  const pushUnique = (value) => {
    const normalized = s(value).slice(0, TRANSCRIPT_VARIANT_RULES.maxItemChars);
    if (!normalized) return;
    const dedupe = normalized.toLowerCase();
    if (!dedupe) return;
    if (out.some((row) => s(row).toLowerCase() === dedupe)) return;
    out.push(normalized);
  };

  pushUnique(expected);
  aligned.forEach((variant) => pushUnique(variant));

  if (!aligned.length && normalizedVariants.length) {
    warnings.push('Transcript variants did not align with expected transcript; replaced with expected-transcript-based variants.');
  }

  if (!out.length) {
    return buildTranscriptVariantFallbacks(expected);
  }

  if (out.length < TRANSCRIPT_VARIANT_DESIRED_MIN_ITEMS) {
    const fallbackRows = buildTranscriptVariantFallbacks(expected);
    fallbackRows.forEach((row) => pushUnique(row));
    if (normalizedVariants.length) {
      warnings.push(
        `Transcript variants were supplemented from expected transcript to provide at least ${TRANSCRIPT_VARIANT_DESIRED_MIN_ITEMS} aligned variants.`
      );
    }
  }

  return out.slice(0, TRANSCRIPT_VARIANT_RULES.maxItems);
}

function normalizeBooleanLike(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const token = s(value).toLowerCase();
  if (!token) return fallback;
  if (['true', '1', 'yes', 'y', 'on'].includes(token)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function normalizeBlankToken(rawKey = '', fallbackIndex = 1) {
  const token = s(rawKey);
  const fallback = Math.max(1, Number.parseInt(String(fallbackIndex), 10) || 1);
  const match = token.match(/\{\{\s*(\d+)\s*\}\}/) || token.match(/(\d+)/);
  const numeric = match
    ? Math.max(1, Number.parseInt(String(match[1]), 10) || fallback)
    : fallback;
  return `{{${numeric}}}`;
}

function normalizeBlankAnswerValue(rawValue = '') {
  if (Array.isArray(rawValue)) {
    const first = rawValue.map((item) => s(item)).find(Boolean) || '';
    return first.slice(0, FILL_BLANK_RULES.maxAnswerChars);
  }
  if (isPlainObject(rawValue)) {
    const nested = s(rawValue.answer || rawValue.value || rawValue.text || '');
    return nested.slice(0, FILL_BLANK_RULES.maxAnswerChars);
  }
  return s(rawValue).slice(0, FILL_BLANK_RULES.maxAnswerChars);
}

function normalizeBlankAnswerMap(value, warnings = []) {
  let source = value;
  if (!isPlainObject(source) && typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch (_) {
      source = {};
    }
  }
  source = safeObject(source, {});
  const out = {};
  const taken = new Set();
  Object.keys(source).forEach((rawKey, index) => {
    const key = normalizeBlankToken(rawKey, index + 1);
    const dedupe = key.toLowerCase();
    if (taken.has(dedupe)) return;
    const answer = normalizeBlankAnswerValue(source[rawKey]);
    if (!answer) return;
    taken.add(dedupe);
    out[key] = answer;
  });
  const ordered = {};
  Object.keys(out)
    .sort((left, right) => {
      const leftNum = Number.parseInt((left.match(/\d+/) || [0])[0], 10) || 0;
      const rightNum = Number.parseInt((right.match(/\d+/) || [0])[0], 10) || 0;
      return leftNum - rightNum;
    })
    .forEach((key) => { ordered[key] = out[key]; });
  const keys = Object.keys(ordered);
  if (keys.length > FILL_BLANK_RULES.maxBlanks) {
    warnings.push(`blankAnswerMap was limited to ${FILL_BLANK_RULES.maxBlanks} blanks.`);
    const limited = {};
    keys.slice(0, FILL_BLANK_RULES.maxBlanks).forEach((key) => {
      limited[key] = ordered[key];
    });
    return limited;
  }
  return ordered;
}

function extractPlaceholderTokensInOrder(text = '') {
  const source = String(text || '');
  const regex = /\{\{\s*(\d+)\s*\}\}/g;
  const ordered = [];
  const seen = new Set();
  let match = null;
  while ((match = regex.exec(source)) !== null) {
    const token = `{{${Math.max(1, Number.parseInt(String(match[1]), 10) || 1)}}}`;
    const dedupe = token.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    ordered.push(token);
  }
  return ordered;
}

function normalizeWrappedBlankMarkup(text = '', warnings = []) {
  const source = String(text || '');
  const wrappedRegex = /\{\{\s*(\d+)\s*\}\}\s*([^{}]+?)\s*\{\{\s*\1\s*\}\}/g;
  let replaced = source;
  const derivedMap = {};
  let found = false;
  replaced = replaced.replace(wrappedRegex, (_full, indexToken, captured) => {
    const token = normalizeBlankToken(indexToken, Number.parseInt(String(indexToken), 10) || 1);
    const answer = normalizeBlankAnswerValue(captured);
    if (answer && !Object.prototype.hasOwnProperty.call(derivedMap, token)) {
      derivedMap[token] = answer;
    }
    found = true;
    return token;
  });
  if (found) {
    warnings.push('Converted wrapped blank markers to placeholder tokens (e.g., {{1}}answer{{1}} -> {{1}}).');
  }
  return { text: replaced, derivedMap };
}

function distributeDeterministicIndices(total = 0, count = 0, seed = '') {
  const size = Math.max(0, Number.parseInt(String(total), 10) || 0);
  const needed = Math.max(0, Number.parseInt(String(count), 10) || 0);
  if (!size || !needed) return [];
  const start = hashStringToUint32(`${s(seed)}::blank_start`) % size;
  const step = pickDeterministicTraversalStep(size, `${s(seed)}::blank_step`);
  const out = [];
  const seen = new Set();
  for (let i = 0; i < size && out.length < needed; i += 1) {
    const idx = (start + (i * step)) % size;
    if (seen.has(idx)) continue;
    seen.add(idx);
    out.push(idx);
  }
  return out;
}

function buildListeningFillBlankFromTranscript(rawTranscript = '', seed = '', warnings = []) {
  const transcript = s(rawTranscript).slice(0, FILL_BLANK_RULES.maxTranscriptChars);
  if (!transcript) {
    return { transcriptWithBlanks: '', blankAnswerMap: {} };
  }

  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'over', 'under', 'have',
    'has', 'had', 'are', 'was', 'were', 'will', 'would', 'could', 'should', 'about', 'after',
    'before', 'because', 'while', 'where', 'which', 'their', 'there', 'than', 'then', 'them',
    'they', 'your', 'ours', 'ourselves', 'also', 'very', 'much', 'many', 'some', 'more', 'most',
    'such', 'only', 'just', 'each', 'every', 'other', 'another', 'might', 'may', 'can', 'our',
    'you', 'she', 'him', 'her', 'his', 'its', 'too'
  ]);

  const wordRegex = /\b([A-Za-z][A-Za-z'-]{2,})\b/g;
  const candidates = [];
  let match = null;
  while ((match = wordRegex.exec(transcript)) !== null) {
    const word = s(match[1]);
    const lowered = word.toLowerCase();
    if (!word || word.length < 4) continue;
    if (stopWords.has(lowered)) continue;
    candidates.push({
      start: match.index,
      end: match.index + match[0].length,
      text: word
    });
  }

  if (!candidates.length) {
    warnings.push('Could not identify suitable blank candidates from transcript; using available transcript as-is.');
    return { transcriptWithBlanks: transcript, blankAnswerMap: {} };
  }

  const desired = Math.min(
    candidates.length,
    Math.max(
      Math.min(FILL_BLANK_RULES.maxBlanks, Math.round(transcript.split(/\s+/).filter(Boolean).length / 16)),
      FILL_BLANK_RULES.minBlanks
    )
  );
  const pickedIndices = distributeDeterministicIndices(candidates.length, desired, seed)
    .sort((left, right) => candidates[left].start - candidates[right].start);

  let outTranscript = transcript;
  let offset = 0;
  const blankAnswerMap = {};
  pickedIndices.forEach((candidateIndex, order) => {
    const candidate = candidates[candidateIndex];
    if (!candidate) return;
    const token = `{{${order + 1}}}`;
    const start = candidate.start + offset;
    const end = candidate.end + offset;
    blankAnswerMap[token] = candidate.text.slice(0, FILL_BLANK_RULES.maxAnswerChars);
    outTranscript = outTranscript.slice(0, start) + token + outTranscript.slice(end);
    offset += token.length - (candidate.end - candidate.start);
  });
  return { transcriptWithBlanks: outTranscript, blankAnswerMap };
}

function normalizeListeningFillBlankPayload(payloadDraft = {}, warnings = []) {
  const draft = safeObject(payloadDraft, {});
  const wrapped = normalizeWrappedBlankMarkup(draft.transcriptWithBlanks || '', warnings);
  const transcriptRaw = s(wrapped.text || draft.transcriptWithBlanks || '').slice(0, FILL_BLANK_RULES.maxTranscriptChars);

  const rawMap = normalizeBlankAnswerMap(draft.blankAnswerMap, warnings);
  const derivedMap = normalizeBlankAnswerMap(wrapped.derivedMap, warnings);
  const map = { ...derivedMap, ...rawMap };
  const placeholders = extractPlaceholderTokensInOrder(transcriptRaw);

  if (!transcriptRaw) {
    return {
      transcriptWithBlanks: '',
      blankAnswerMap: {}
    };
  }

  if (!placeholders.length) {
    if (Object.keys(map).length) {
      warnings.push('blankAnswerMap was cleared because transcriptWithBlanks does not contain placeholders.');
    }
    return {
      transcriptWithBlanks: transcriptRaw,
      blankAnswerMap: {}
    };
  }

  let normalizedTranscript = transcriptRaw;
  const sequentialMap = {};
  let missingMappings = 0;
  placeholders.forEach((token, index) => {
    const nextToken = `{{${index + 1}}}`;
    const answer = s(map[token]).slice(0, FILL_BLANK_RULES.maxAnswerChars);
    if (answer) {
      sequentialMap[nextToken] = answer;
    } else {
      missingMappings += 1;
    }
    if (token !== nextToken) {
      const tokenPattern = new RegExp(escapeRegExp(token), 'g');
      normalizedTranscript = normalizedTranscript.replace(tokenPattern, nextToken);
    }
  });
  if (missingMappings > 0) {
    warnings.push(`blankAnswerMap is missing ${missingMappings} placeholder mapping(s).`);
  }
  return {
    transcriptWithBlanks: normalizedTranscript,
    blankAnswerMap: sequentialMap
  };
}

function normalizeReadingFillBankOptions(value, warnings = []) {
  const rows = Array.isArray(value)
    ? value
    : String(value ?? '')
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  const out = [];
  const seen = new Set();
  rows.forEach((item) => {
    const normalized = s(item).slice(0, READING_FILL_BANK_OPTION_RULES.maxItemChars);
    if (!normalized) return;
    const dedupe = normalized.toLowerCase();
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push(normalized);
  });
  if (out.length > READING_FILL_BANK_OPTION_RULES.maxItems) {
    warnings.push(`bankOptions were limited to ${READING_FILL_BANK_OPTION_RULES.maxItems} items.`);
  }
  return out.slice(0, READING_FILL_BANK_OPTION_RULES.maxItems);
}

function sortBlankTokenKeys(keys = []) {
  return (Array.isArray(keys) ? keys.slice() : [])
    .map((item) => s(item))
    .filter(Boolean)
    .sort((left, right) => {
      const leftMatch = left.match(/\{\{\s*(\d+)\s*\}\}/);
      const rightMatch = right.match(/\{\{\s*(\d+)\s*\}\}/);
      const leftNum = leftMatch ? Number.parseInt(leftMatch[1], 10) : Number.MAX_SAFE_INTEGER;
      const rightNum = rightMatch ? Number.parseInt(rightMatch[1], 10) : Number.MAX_SAFE_INTEGER;
      if (leftNum !== rightNum) return leftNum - rightNum;
      return left.localeCompare(right);
    });
}

function normalizeReadingWritingBlankOptionsMap(value, blankAnswerMap = {}, warnings = []) {
  let source = value;
  if (!isPlainObject(source) && typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch (_) {
      source = {};
    }
  }
  source = safeObject(source, {});
  const normalizedAnswerMap = safeObject(blankAnswerMap, {});
  const orderedBlankKeys = sortBlankTokenKeys(Object.keys(normalizedAnswerMap));

  if (!orderedBlankKeys.length) {
    const looseOut = {};
    Object.keys(source).forEach((rawKey, index) => {
      const blankKey = normalizeBlankToken(rawKey, index + 1);
      const rows = Array.isArray(source[rawKey])
        ? source[rawKey]
        : String(source[rawKey] ?? '')
          .split(/[\n,]/)
          .map((item) => item.trim())
          .filter(Boolean);
      const normalizedRows = [];
      const seen = new Set();
      rows.forEach((item) => {
        const token = s(item).slice(0, READING_WRITING_BLANK_OPTION_RULES.maxItemChars);
        if (!token) return;
        const dedupeKey = token.toLowerCase();
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        normalizedRows.push(token);
      });
      if (normalizedRows.length > READING_WRITING_BLANK_OPTION_RULES.perBlankOptions) {
        warnings.push(`${blankKey} options were limited to ${READING_WRITING_BLANK_OPTION_RULES.perBlankOptions} items.`);
      }
      looseOut[blankKey] = normalizedRows.slice(0, READING_WRITING_BLANK_OPTION_RULES.perBlankOptions);
    });
    return looseOut;
  }

  const out = {};

  orderedBlankKeys.forEach((blankKey) => {
    const correctAnswer = s(normalizedAnswerMap[blankKey]).slice(0, READING_WRITING_BLANK_OPTION_RULES.maxItemChars);
    const rows = Array.isArray(source[blankKey])
      ? source[blankKey]
      : String(source[blankKey] ?? '')
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean);
    const normalizedRows = [];
    const seen = new Set();

    if (correctAnswer) {
      const dedupeKey = correctAnswer.toLowerCase();
      seen.add(dedupeKey);
      normalizedRows.push(correctAnswer);
    }

    rows.forEach((item) => {
      const token = s(item).slice(0, READING_WRITING_BLANK_OPTION_RULES.maxItemChars);
      if (!token) return;
      const dedupeKey = token.toLowerCase();
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      normalizedRows.push(token);
    });

    if (normalizedRows.length > READING_WRITING_BLANK_OPTION_RULES.perBlankOptions) {
      warnings.push(`${blankKey} options were limited to ${READING_WRITING_BLANK_OPTION_RULES.perBlankOptions} items.`);
    }
    out[blankKey] = normalizedRows.slice(0, READING_WRITING_BLANK_OPTION_RULES.perBlankOptions);
  });

  const extraKeys = Object.keys(source).map((item) => s(item)).filter(Boolean).filter((key) => !Object.prototype.hasOwnProperty.call(out, key));
  if (extraKeys.length) {
    warnings.push(`blankOptionsMap keys were aligned to blankAnswerMap. Ignored keys: ${extraKeys.join(', ')}.`);
  }

  return out;
}

function tokenizeReadingWritingContext(text = '') {
  const source = String(text || '');
  const regex = /[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g;
  const out = [];
  let match = null;
  while ((match = regex.exec(source)) !== null) {
    const token = s(match[0]).slice(0, READING_WRITING_BLANK_OPTION_RULES.maxItemChars);
    if (!token) continue;
    out.push(token);
  }
  return out;
}

function normalizeTokenForCompare(value = '') {
  return s(value).toLowerCase();
}

function extractReadingWritingBlankContext(passageWithBlanks = '', blankKey = '') {
  const passage = s(passageWithBlanks);
  const key = s(blankKey);
  if (!passage || !key) {
    return {
      beforeWord: '',
      beforeWord2: '',
      afterWord: '',
      afterWord2: ''
    };
  }
  const index = passage.indexOf(key);
  if (index < 0) {
    return {
      beforeWord: '',
      beforeWord2: '',
      afterWord: '',
      afterWord2: ''
    };
  }
  const beforeText = passage.slice(0, index);
  const afterText = passage.slice(index + key.length);
  const beforeWords = (beforeText.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/g) || []).map((item) => normalizeTokenForCompare(item));
  const afterWords = (afterText.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/g) || []).map((item) => normalizeTokenForCompare(item));
  return {
    beforeWord: beforeWords.length ? beforeWords[beforeWords.length - 1] : '',
    beforeWord2: beforeWords.length > 1 ? beforeWords[beforeWords.length - 2] : '',
    afterWord: afterWords.length ? afterWords[0] : '',
    afterWord2: afterWords.length > 1 ? afterWords[1] : ''
  };
}

function extractReadingWritingSentenceAroundBlank(passageWithBlanks = '', blankKey = '') {
  const passage = s(passageWithBlanks);
  const key = s(blankKey);
  if (!passage || !key) return '';
  const index = passage.indexOf(key);
  if (index < 0) return '';

  let start = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = passage[i];
    if (ch === '.' || ch === '!' || ch === '?' || ch === ';') {
      start = i + 1;
      break;
    }
  }

  let end = passage.length;
  for (let i = index + key.length; i < passage.length; i += 1) {
    const ch = passage[i];
    if (ch === '.' || ch === '!' || ch === '?' || ch === ';') {
      end = i;
      break;
    }
  }

  return s(passage.slice(start, end));
}

function readingWritingVerbFamily(token = '') {
  const value = normalizeTokenForCompare(token);
  if (['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being'].includes(value)) return 'be';
  if (['has', 'have', 'had'].includes(value)) return 'have';
  if (['do', 'does', 'did'].includes(value)) return 'do';
  return value;
}

function looksLikeReadingWritingVerbToken(token = '') {
  const value = normalizeTokenForCompare(token);
  if (!value) return false;
  if (READING_WRITING_NUMERIC_WORDS.has(value)) return false;
  if (READING_WRITING_VERB_STEM_HINTS.has(value)) return true;
  if (READING_WRITING_VERB_SUFFIX_PATTERN.test(value)) return true;
  if (READING_WRITING_IRREGULAR_PARTICIPLES.has(value)) return true;
  return false;
}

function detectReadingWritingVerbForm(token = '') {
  const value = normalizeTokenForCompare(token);
  if (!value) return 'unknown';
  if (READING_WRITING_IRREGULAR_PARTICIPLES.has(value)) return 'past_like';
  if (value.endsWith('ing')) return 'gerund';
  if (value.endsWith('ed')) return 'past_like';
  if (value.endsWith('en')) return 'past_like';
  if (value.endsWith('ies') || value.endsWith('es') || value.endsWith('s')) return 'present3';
  return 'base';
}

function isReadingWritingLikelyBaseVerb(token = '') {
  const value = normalizeTokenForCompare(token);
  if (!value) return false;
  if (!/[a-z]/.test(value)) return false;
  if (READING_WRITING_NUMERIC_WORDS.has(value)) return false;
  if (READING_WRITING_COMMON_ADVERBS.has(value)) return false;
  if (READING_WRITING_AUXILIARY_VERBS.has(value)) return false;
  if (detectReadingWritingVerbForm(value) !== 'base') return false;
  if (READING_WRITING_NOUN_SUFFIX_PATTERN.test(value)) return false;
  if (READING_WRITING_ADJECTIVE_SUFFIX_PATTERN.test(value)) return false;
  if (READING_WRITING_ADVERB_SUFFIX_PATTERN.test(value)) return false;
  return value.length >= 3;
}

function detectReadingWritingLexicalClass(answer = '', blankContext = {}) {
  const normalized = normalizeTokenForCompare(answer);
  if (!normalized) return 'any';
  const beforeWord = normalizeTokenForCompare(blankContext?.beforeWord || '');
  const beforeWord2 = normalizeTokenForCompare(blankContext?.beforeWord2 || '');
  const afterWord = normalizeTokenForCompare(blankContext?.afterWord || '');
  const afterWord2 = normalizeTokenForCompare(blankContext?.afterWord2 || '');
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    if (READING_WRITING_AUXILIARY_VERBS.has(first)) return 'verb_phrase';
    if (READING_WRITING_DETERMINERS.has(first)) return 'noun_phrase';
    if (READING_WRITING_ADVERB_SUFFIX_PATTERN.test(last)) return 'adverb_phrase';
    return 'phrase';
  }
  const token = parts[0];
  if (!token) return 'any';
  if (READING_WRITING_COMMON_ADVERBS.has(token)) return 'adverb';
  if (READING_WRITING_ADVERB_SUFFIX_PATTERN.test(token)) return 'adverb';
  if (looksLikeReadingWritingVerbToken(token)) return 'verb';
  if (READING_WRITING_ADJECTIVE_SUFFIX_PATTERN.test(token)) return 'adjective';
  if (READING_WRITING_MODAL_OR_INFINITIVE_MARKERS.has(beforeWord) || READING_WRITING_MODAL_OR_INFINITIVE_MARKERS.has(beforeWord2)) return 'verb';
  if (READING_WRITING_AUXILIARY_VERBS.has(beforeWord)) return 'verb';
  if (READING_WRITING_DETERMINERS.has(beforeWord)) return 'noun';
  if (READING_WRITING_DETERMINERS.has(beforeWord2) && !looksLikeReadingWritingVerbToken(token)) return 'noun';
  if (READING_WRITING_ADJECTIVE_SUFFIX_PATTERN.test(afterWord) || READING_WRITING_ADJECTIVE_SUFFIX_PATTERN.test(afterWord2)) return 'verb';
  if (READING_WRITING_NOUN_SUFFIX_PATTERN.test(token) || token.endsWith('s')) return 'noun';
  return 'any';
}

function isReadingWritingCandidateClassCompatible(candidate = '', lexicalClass = 'any', answerWordCount = 1, answer = '', blankContext = {}) {
  const rawCandidate = s(candidate);
  const rawAnswer = s(answer);
  const normalized = normalizeTokenForCompare(candidate);
  if (!normalized) return false;
  if (!/[A-Za-z]/.test(normalized)) return false;
  if (rawAnswer && rawAnswer.toLowerCase() === rawAnswer && /[A-Z]/.test(rawCandidate)) return false;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  if (lexicalClass === 'phrase') {
    if (words.length !== answerWordCount) return false;
    if (rawCandidate.includes("'")) return false;
    return true;
  }
  if (lexicalClass === 'verb_phrase') {
    if (words.length !== answerWordCount || words.length < 2) return false;
    const answerWords = normalizeTokenForCompare(answer).split(/\s+/).filter(Boolean);
    const answerFirst = answerWords[0] || '';
    const candidateFirst = words[0];
    const candidateLast = words[words.length - 1];
    if (!READING_WRITING_AUXILIARY_VERBS.has(candidateFirst)) return false;
    if (answerFirst && READING_WRITING_AUXILIARY_VERBS.has(answerFirst)) {
      if (readingWritingVerbFamily(candidateFirst) !== readingWritingVerbFamily(answerFirst)) return false;
    }
    if (!(looksLikeReadingWritingVerbToken(candidateLast) || READING_WRITING_ADJECTIVE_SUFFIX_PATTERN.test(candidateLast))) return false;
    if (rawCandidate.includes("'")) return false;
    return true;
  }
  if (lexicalClass === 'noun_phrase') {
    if (words.length !== answerWordCount || words.length < 2) return false;
    if (words.some((token) => READING_WRITING_OPTION_STOPWORDS.has(token) && !READING_WRITING_DETERMINERS.has(token))) return false;
    return true;
  }
  if (lexicalClass === 'adverb_phrase') {
    if (words.length !== answerWordCount) return false;
    const last = words[words.length - 1] || '';
    return READING_WRITING_ADVERB_SUFFIX_PATTERN.test(last);
  }
  if (words.length > 1) return false;
  const token = words[0];
  if (!token || READING_WRITING_OPTION_STOPWORDS.has(token)) return false;
  if (lexicalClass === 'verb') {
    const beforeWord = normalizeTokenForCompare(blankContext?.beforeWord || '');
    const beforeWord2 = normalizeTokenForCompare(blankContext?.beforeWord2 || '');
    const mustBeBaseVerb = READING_WRITING_MODAL_OR_INFINITIVE_MARKERS.has(beforeWord) || READING_WRITING_MODAL_OR_INFINITIVE_MARKERS.has(beforeWord2);
    if (mustBeBaseVerb) return isReadingWritingLikelyBaseVerb(token);
    if (!looksLikeReadingWritingVerbToken(token) && !isReadingWritingLikelyBaseVerb(token)) return false;
    const answerForm = detectReadingWritingVerbForm(answer);
    if (answerForm === 'past_like') {
      const candidateForm = detectReadingWritingVerbForm(token);
      return candidateForm === 'past_like' || candidateForm === 'base';
    }
    if (answerForm === 'gerund') {
      return token.endsWith('ing');
    }
    return true;
  }
  if (lexicalClass === 'adjective') {
    return READING_WRITING_ADJECTIVE_SUFFIX_PATTERN.test(token) || token.endsWith('er') || token.endsWith('est');
  }
  if (lexicalClass === 'adverb') {
    return READING_WRITING_ADVERB_SUFFIX_PATTERN.test(token) || READING_WRITING_COMMON_ADVERBS.has(token);
  }
  if (lexicalClass === 'noun') {
    if (READING_WRITING_ADVERB_SUFFIX_PATTERN.test(token)) return false;
    if (looksLikeReadingWritingVerbToken(token)) return false;
    return true;
  }
  return true;
}

function buildReadingWritingAnswerFormVariants(answer = '', lexicalClass = 'any') {
  const normalized = normalizeTokenForCompare(answer);
  if (!normalized) return [];
  const words = normalized.split(/\s+/).filter(Boolean);
  const out = [];
  const seen = new Set();
  const push = (value) => {
    const token = s(value).slice(0, READING_WRITING_BLANK_OPTION_RULES.maxItemChars);
    if (!token) return;
    const key = normalizeTokenForCompare(token);
    if (!key || key === normalized || seen.has(key)) return;
    seen.add(key);
    out.push(token);
  };

  if (lexicalClass === 'verb_phrase' && words.length >= 2) {
    const first = words[0];
    const last = words[words.length - 1];
    const family = readingWritingVerbFamily(first);
    const auxAlternates = family === 'be'
      ? ['is', 'are', 'was', 'were', 'be', 'been']
      : (family === 'have' ? ['has', 'have', 'had'] : ['do', 'does', 'did']);
    auxAlternates.forEach((aux) => push(`${aux} ${last}`));
    ['received', 'greeted', 'accepted', 'questioned', 'challenged', 'viewed', 'considered'].forEach((participle) => {
      push(`${first} ${participle}`);
    });
    return out;
  }

  if (lexicalClass === 'noun_phrase' && words.length >= 2) {
    const first = words[0];
    const last = words[words.length - 1];
    ['concept', 'idea', 'approach', 'framework', 'hypothesis', 'model'].forEach((noun) => {
      push(`${first} ${noun}`);
    });
    push(`${first} ${last}s`);
    return out;
  }

  if (lexicalClass === 'adverb_phrase' && words.length >= 2) {
    const prefix = words.slice(0, -1).join(' ');
    const adverbs = ['carefully', 'gradually', 'rapidly', 'consistently', 'effectively', 'clearly'];
    adverbs.forEach((adverb) => push(`${prefix} ${adverb}`));
    return out;
  }

  if (lexicalClass === 'phrase' || words.length > 1) {
    const last = words[words.length - 1];
    const prefix = words.slice(0, -1).join(' ');
    if (prefix) {
      ['major', 'minor', 'different', 'related', 'core', 'key'].forEach((adj) => push(`${prefix} ${adj}`));
      ['issue', 'result', 'factor', 'process', 'approach', 'change'].forEach((noun) => push(`${prefix} ${noun}`));
    } else {
      push(`more ${normalized}`);
      push(`less ${normalized}`);
      push(`most ${normalized}`);
    }
    if (last) push(`${prefix} ${last}s`.trim());
    return out;
  }

  const token = words[0];
  if (!token) return out;

  const addVerbForms = (stem) => {
    const safeStem = s(stem).toLowerCase();
    if (!safeStem) return;
    const endsWithY = /[^aeiou]y$/i.test(safeStem);
    const endsWithE = safeStem.endsWith('e');
    const endsWithSibilant = /(s|sh|ch|x|z|o)$/i.test(safeStem);
    push(safeStem);
    if (endsWithY) {
      push(`${safeStem.slice(0, -1)}ies`);
      push(`${safeStem.slice(0, -1)}ied`);
      push(`${safeStem}ing`);
    } else if (endsWithE) {
      push(`${safeStem}s`);
      push(`${safeStem}d`);
      push(`${safeStem.slice(0, -1)}ing`);
    } else {
      push(`${safeStem}${endsWithSibilant ? 'es' : 's'}`);
      push(`${safeStem}ed`);
      push(`${safeStem}ing`);
    }
  };

  if (lexicalClass === 'verb') {
    if (token.endsWith('ing') && token.length > 4) addVerbForms(token.slice(0, -3));
    else if (token.endsWith('ied') && token.length > 4) addVerbForms(`${token.slice(0, -3)}y`);
    else if (token.endsWith('ed') && token.length > 3) addVerbForms(token.slice(0, -2));
    else if (token.endsWith('ies') && token.length > 4) addVerbForms(`${token.slice(0, -3)}y`);
    else if (token.endsWith('s') && token.length > 3) addVerbForms(token.slice(0, -1));
    addVerbForms(token);
    return out;
  }

  if (lexicalClass === 'adjective') {
    if (/[^aeiou]y$/i.test(token)) {
      push(`${token.slice(0, -1)}ier`);
      push(`${token.slice(0, -1)}iest`);
    } else {
      push(`${token}er`);
      push(`${token}est`);
    }
    push(`more ${token}`);
    push(`most ${token}`);
    return out;
  }

  if (lexicalClass === 'noun') {
    if (token.endsWith('ies') && token.length > 4) {
      push(`${token.slice(0, -3)}y`);
    } else if (token.endsWith('s') && token.length > 3) {
      push(token.slice(0, -1));
    } else if (/[^aeiou]y$/i.test(token)) {
      push(`${token.slice(0, -1)}ies`);
    } else if (/(s|sh|ch|x|z)$/i.test(token)) {
      push(`${token}es`);
    } else {
      push(`${token}s`);
    }
    push(`the ${token}`);
    push(`more ${token}`);
    return out;
  }

  if (lexicalClass === 'adverb') {
    push(`more ${token}`);
    push(`most ${token}`);
    if (token.endsWith('ly') && token.length > 4) {
      push(`${token.slice(0, -2)}ically`);
    } else {
      push(`${token}ly`);
    }
    return out;
  }

  addVerbForms(token);
  push(`${token}er`);
  push(`${token}est`);
  push(`${token}s`);
  return out;
}

function buildReadingWritingDistractorCandidates({
  sourcePassage = '',
  passageWithBlanks = '',
  answer = '',
  blankAnswerMap = {},
  lexicalClass = '',
  blankKey = '',
  blankContext = {}
} = {}) {
  const answerToken = s(answer);
  const resolvedLexicalClass = s(lexicalClass) || detectReadingWritingLexicalClass(answerToken);
  const answerWordCount = Math.max(1, answerToken.split(/\s+/).filter(Boolean).length);
  const rawPassageWithBlanks = s(passageWithBlanks);
  const fallbackPassage = rawPassageWithBlanks.replace(/\{\{\s*\d+\s*\}\}/g, ' ');
  const localSentenceRaw = extractReadingWritingSentenceAroundBlank(rawPassageWithBlanks, blankKey);
  const localSentence = localSentenceRaw.replace(/\{\{\s*\d+\s*\}\}/g, ' ');
  const localTokens = tokenizeReadingWritingContext(localSentence);
  const globalContextText = `${s(sourcePassage)}\n${fallbackPassage}`;
  const globalTokens = tokenizeReadingWritingContext(globalContextText);
  const tokens = localTokens.length ? localTokens : globalTokens;
  if (!tokens.length && !globalTokens.length) return [];

  const allAnswers = new Set(
    Object.values(safeObject(blankAnswerMap, {}))
      .map((item) => normalizeTokenForCompare(item))
      .filter(Boolean)
  );

  const candidates = [];
  const seen = new Set();
  const pushCandidate = (rawValue) => {
    const token = s(rawValue).slice(0, READING_WRITING_BLANK_OPTION_RULES.maxItemChars);
    if (!token) return;
    const normalized = normalizeTokenForCompare(token);
    if (!normalized) return;
    if (!isReadingWritingCandidateClassCompatible(token, resolvedLexicalClass, answerWordCount, answerToken, blankContext)) return;
    if (normalized === normalizeTokenForCompare(answerToken)) return;
    if (allAnswers.has(normalized)) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(token);
  };

  if (answerWordCount > 1) {
    const phraseSources = [tokens];
    if (tokens !== globalTokens && globalTokens.length) phraseSources.push(globalTokens);
    phraseSources.forEach((sourceTokens) => {
      for (let i = 0; i <= (sourceTokens.length - answerWordCount); i += 1) {
        const phrase = sourceTokens.slice(i, i + answerWordCount).join(' ');
        pushCandidate(phrase);
      }
    });
    if (candidates.length) return candidates;
  }

  const tokenSources = [tokens];
  if (tokens !== globalTokens && globalTokens.length) tokenSources.push(globalTokens);
  tokenSources.forEach((sourceTokens) => {
    sourceTokens.forEach((token) => {
      const normalized = normalizeTokenForCompare(token);
      if (!normalized) return;
      if (READING_WRITING_OPTION_STOPWORDS.has(normalized)) return;
      pushCandidate(token);
    });
  });

  return candidates;
}

function buildReadingWritingContextAlignedPhraseFallbacks({
  passageWithBlanks = '',
  blankKey = '',
  answer = '',
  lexicalClass = 'phrase',
  blankContext = {}
} = {}) {
  const sentenceRaw = extractReadingWritingSentenceAroundBlank(passageWithBlanks, blankKey);
  const sentence = sentenceRaw.replace(/\{\{\s*\d+\s*\}\}/g, ' ');
  const tokens = tokenizeReadingWritingContext(sentence);
  const answerWords = normalizeTokenForCompare(answer).split(/\s+/).filter(Boolean);
  const count = Math.max(1, answerWords.length);
  if (!tokens.length || count <= 1) return [];

  const out = [];
  const seen = new Set();
  for (let i = 0; i <= (tokens.length - count); i += 1) {
    const phrase = tokens.slice(i, i + count).join(' ');
    const normalized = normalizeTokenForCompare(phrase);
    if (!normalized || seen.has(normalized)) continue;
    if (!isReadingWritingCandidateClassCompatible(phrase, lexicalClass, count, answer, blankContext)) continue;
    if (normalized === normalizeTokenForCompare(answer)) continue;
    seen.add(normalized);
    out.push(phrase);
  }

  return out;
}

function buildReadingWritingGenericClassFallbacks(answer = '', lexicalClass = 'any') {
  const normalized = normalizeTokenForCompare(answer);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  if (lexicalClass === 'verb_phrase' && words.length >= 2) {
    const aux = words[0];
    return ['accepted', 'questioned', 'challenged', 'recognized', 'received', 'confirmed']
      .map((item) => `${aux} ${item}`);
  }

  if (lexicalClass === 'noun_phrase' && words.length >= 2) {
    const first = words[0];
    return ['concept', 'principle', 'approach', 'framework', 'result', 'pattern']
      .map((item) => `${first} ${item}`);
  }

  if (lexicalClass === 'adverb_phrase' && words.length >= 2) {
    const prefix = words.slice(0, -1).join(' ');
    return ['carefully', 'gradually', 'rapidly', 'effectively', 'consistently', 'clearly']
      .map((item) => `${prefix} ${item}`);
  }

  if (lexicalClass === 'verb') return ['use', 'show', 'build', 'confirm', 'improve', 'support'];
  if (lexicalClass === 'adjective') return ['major', 'minor', 'critical', 'reliable', 'relevant', 'effective'];
  if (lexicalClass === 'adverb') return ['carefully', 'rapidly', 'gradually', 'clearly', 'consistently', 'effectively'];
  if (lexicalClass === 'noun') return ['result', 'factor', 'issue', 'process', 'approach', 'framework'];
  if (lexicalClass === 'phrase') {
    if (words.length === 2) return ['highly relevant', 'more stable', 'less stable', 'quite clear', 'very useful', 'fully aligned'];
    if (words.length === 3) return ['more context aware', 'highly topic relevant', 'clearly evidence based', 'carefully logic driven'];
    return [
      words.map((_, idx) => (idx === words.length - 1 ? 'relevant' : 'context')).join(' '),
      words.map((_, idx) => (idx === words.length - 1 ? 'stable' : 'evidence')).join(' ')
    ];
  }
  return ['relevant', 'related', 'different', 'major', 'clear', 'practical'];
}

function ensureReadingWritingBlankOptionsCompleteness({
  sourcePassage = '',
  passageWithBlanks = '',
  blankAnswerMap = {},
  blankOptionsMap = {},
  warnings = []
} = {}) {
  const answerMap = safeObject(blankAnswerMap, {});
  const optionsMap = safeObject(blankOptionsMap, {});
  const out = {};
  const orderedBlankKeys = sortBlankTokenKeys(Object.keys(answerMap));

  orderedBlankKeys.forEach((blankKey) => {
    const correctAnswer = s(answerMap[blankKey]).slice(0, READING_WRITING_BLANK_OPTION_RULES.maxItemChars);
    const blankContext = extractReadingWritingBlankContext(passageWithBlanks, blankKey);
    const lexicalClass = detectReadingWritingLexicalClass(correctAnswer, blankContext);
    const rows = normalizeReadingWritingBlankOptionsMap({ [blankKey]: optionsMap[blankKey] }, { [blankKey]: correctAnswer }, warnings)[blankKey] || [];
    const candidatePool = buildReadingWritingDistractorCandidates({
      sourcePassage,
      passageWithBlanks,
      answer: correctAnswer,
      blankAnswerMap: answerMap,
      lexicalClass,
      blankKey,
      blankContext
    });
    const merged = [];
    const seen = new Set();
    const push = (value) => {
      const token = s(value).slice(0, READING_WRITING_BLANK_OPTION_RULES.maxItemChars);
      if (!token) return;
      const normalized = normalizeTokenForCompare(token);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      merged.push(token);
    };

    push(correctAnswer);
    rows.forEach((row) => {
      if (!isReadingWritingCandidateClassCompatible(row, lexicalClass, Math.max(1, correctAnswer.split(/\s+/).filter(Boolean).length), correctAnswer, blankContext)) {
        warnings.push(`${blankKey} removed one non-compatible distractor from AI suggestion.`);
        return;
      }
      push(row);
    });
    candidatePool.forEach((candidate) => {
      if (merged.length >= READING_WRITING_BLANK_OPTION_RULES.perBlankOptions) return;
      push(candidate);
    });

    if (merged.length < READING_WRITING_BLANK_OPTION_RULES.perBlankOptions) {
      const variants = buildReadingWritingAnswerFormVariants(correctAnswer, lexicalClass);
      variants.forEach((candidate) => {
        if (merged.length >= READING_WRITING_BLANK_OPTION_RULES.perBlankOptions) return;
        push(candidate);
      });
      if (merged.length < READING_WRITING_BLANK_OPTION_RULES.perBlankOptions) {
        warnings.push(`${blankKey} had limited context-specific distractors; fallback options were generated from the answer form.`);
      }
    }

    if (merged.length < READING_WRITING_BLANK_OPTION_RULES.perBlankOptions) {
      if (
        lexicalClass === 'verb_phrase'
        || lexicalClass === 'noun_phrase'
        || lexicalClass === 'adverb_phrase'
        || lexicalClass === 'phrase'
      ) {
        const contextualPhraseFallbacks = buildReadingWritingContextAlignedPhraseFallbacks({
          passageWithBlanks,
          blankKey,
          answer: correctAnswer,
          lexicalClass,
          blankContext
        });
        contextualPhraseFallbacks.forEach((candidate) => {
          if (merged.length >= READING_WRITING_BLANK_OPTION_RULES.perBlankOptions) return;
          push(candidate);
        });
      }
    }

    if (merged.length < READING_WRITING_BLANK_OPTION_RULES.perBlankOptions) {
      const genericFallbacks = buildReadingWritingGenericClassFallbacks(correctAnswer, lexicalClass);
      genericFallbacks.forEach((candidate) => {
        if (merged.length >= READING_WRITING_BLANK_OPTION_RULES.perBlankOptions) return;
        if (!isReadingWritingCandidateClassCompatible(candidate, lexicalClass, Math.max(1, correctAnswer.split(/\s+/).filter(Boolean).length), correctAnswer, blankContext)) return;
        push(candidate);
      });
    }

    if (merged.length < READING_WRITING_BLANK_OPTION_RULES.perBlankOptions) {
      const safetyPool = buildReadingWritingGenericClassFallbacks(correctAnswer, lexicalClass);
      let safetyCounter = 0;
      while (merged.length < READING_WRITING_BLANK_OPTION_RULES.perBlankOptions && safetyCounter < 100) {
        const candidate = s(safetyPool[safetyCounter % Math.max(1, safetyPool.length)]);
        safetyCounter += 1;
        if (!candidate) break;
        if (!isReadingWritingCandidateClassCompatible(candidate, lexicalClass, Math.max(1, correctAnswer.split(/\s+/).filter(Boolean).length), correctAnswer, blankContext)) continue;
        push(candidate);
      }
    }

    if (merged.length < READING_WRITING_BLANK_OPTION_RULES.perBlankOptions) {
      warnings.push(`${blankKey} could not build enough strong distractors; some options reuse answer pattern to satisfy required count.`);
      let safetyCounter = 1;
      while (merged.length < READING_WRITING_BLANK_OPTION_RULES.perBlankOptions) {
        push(`${correctAnswer}-${safetyCounter}`);
        safetyCounter += 1;
      }
    }

    out[blankKey] = merged.slice(0, READING_WRITING_BLANK_OPTION_RULES.perBlankOptions);
  });

  return out;
}

function normalizeReorderParagraphItems(value, warnings = []) {
  const rows = Array.isArray(value)
    ? value
    : String(value ?? '')
      .split(/\n{2,}/)
      .map((item) => item.trim())
      .filter(Boolean);
  const out = [];
  const seen = new Set();
  rows.forEach((item) => {
    const paragraph = s(item).slice(0, REORDER_PARAGRAPH_RULES.maxItemChars);
    if (!paragraph) return;
    const dedupe = paragraph.toLowerCase();
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push(paragraph);
  });
  if (out.length > REORDER_PARAGRAPH_RULES.maxItems) {
    warnings.push(`paragraphItems were limited to ${REORDER_PARAGRAPH_RULES.maxItems} items.`);
  }
  return out.slice(0, REORDER_PARAGRAPH_RULES.maxItems);
}

function normalizeReorderCorrectOrder(value, paragraphItems = [], warnings = []) {
  const rows = Array.isArray(value)
    ? value
    : String(value ?? '')
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  const allowed = new Set((Array.isArray(paragraphItems) ? paragraphItems : []).map((row) => s(row)).filter(Boolean));
  const out = [];
  const seen = new Set();
  rows.forEach((item) => {
    const paragraph = s(item).slice(0, REORDER_PARAGRAPH_RULES.maxItemChars);
    if (!paragraph || !allowed.has(paragraph)) return;
    const dedupe = paragraph.toLowerCase();
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push(paragraph);
  });
  if (!out.length && allowed.size) {
    return Array.from(allowed.values());
  }
  if (out.length !== allowed.size && allowed.size) {
    warnings.push('correctOrder was aligned to paragraphItems because it was incomplete.');
    return Array.from(allowed.values());
  }
  return out.slice(0, REORDER_PARAGRAPH_RULES.maxItems);
}

function normalizeReadingFillBlankPayload(payloadDraft = {}, warnings = []) {
  const draft = safeObject(payloadDraft, {});
  const sourcePassage = s(draft.sourcePassage || draft.passageWithBlanks || '').slice(0, FILL_BLANK_RULES.maxTranscriptChars);
  const normalizedFillBlank = normalizeListeningFillBlankPayload({
    transcriptWithBlanks: s(draft.passageWithBlanks || sourcePassage),
    blankAnswerMap: draft.blankAnswerMap
  }, warnings);
  const bankOptions = normalizeReadingFillBankOptions(draft.bankOptions, warnings);
  const dedupe = new Set(bankOptions.map((item) => s(item).toLowerCase()).filter(Boolean));
  const mergedOptions = bankOptions.slice();
  Object.values(normalizedFillBlank.blankAnswerMap || {}).forEach((answer) => {
    const token = s(answer).slice(0, READING_FILL_BANK_OPTION_RULES.maxItemChars);
    if (!token) return;
    const key = token.toLowerCase();
    if (dedupe.has(key)) return;
    dedupe.add(key);
    mergedOptions.push(token);
  });
  return {
    sourcePassage: sourcePassage || normalizedFillBlank.transcriptWithBlanks,
    passageWithBlanks: normalizedFillBlank.transcriptWithBlanks,
    blankAnswerMap: normalizedFillBlank.blankAnswerMap,
    bankOptions: mergedOptions.slice(0, READING_FILL_BANK_OPTION_RULES.maxItems)
  };
}

function normalizeReadingWritingFillBlankPayload(payloadDraft = {}, warnings = []) {
  const draft = safeObject(payloadDraft, {});
  const normalizedFillBlank = normalizeReadingFillBlankPayload({
    sourcePassage: draft.sourcePassage,
    passageWithBlanks: draft.passageWithBlanks,
    blankAnswerMap: draft.blankAnswerMap,
    bankOptions: []
  }, warnings);
  const normalizedBlankOptionsMap = normalizeReadingWritingBlankOptionsMap(
    draft.blankOptionsMap,
    normalizedFillBlank.blankAnswerMap,
    warnings
  );
  const blankOptionsMap = ensureReadingWritingBlankOptionsCompleteness({
    sourcePassage: normalizedFillBlank.sourcePassage,
    passageWithBlanks: normalizedFillBlank.passageWithBlanks,
    blankAnswerMap: normalizedFillBlank.blankAnswerMap,
    blankOptionsMap: normalizedBlankOptionsMap,
    warnings
  });

  return {
    sourcePassage: normalizedFillBlank.sourcePassage,
    passageWithBlanks: normalizedFillBlank.passageWithBlanks,
    blankAnswerMap: normalizedFillBlank.blankAnswerMap,
    blankOptionsMap
  };
}

function normalizeMcqOptions(value, warnings = []) {
  let source = value;
  if (!Array.isArray(source) && typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch (_) {
      source = [];
    }
  }
  source = Array.isArray(source) ? source : [];
  const out = [];
  const seen = new Set();
  source.forEach((item) => {
    const row = isPlainObject(item) ? item : {};
    const key = s(row.key || '').slice(0, MCQ_OPTION_RULES.maxKeyChars);
    const text = s(row.text || '').slice(0, MCQ_OPTION_RULES.maxTextChars);
    if (!key || !text) return;
    const dedupe = key.toLowerCase();
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push({ key, text });
  });
  if (out.length > MCQ_OPTION_RULES.maxItems) {
    warnings.push(`Options were limited to ${MCQ_OPTION_RULES.maxItems} items.`);
  }
  const sliced = out.slice(0, MCQ_OPTION_RULES.maxItems);
  if (sliced.length > 0 && sliced.length < MCQ_OPTION_RULES.minItems) {
    warnings.push(`Options should include at least ${MCQ_OPTION_RULES.minItems} items.`);
  }
  return sliced;
}

function normalizeCorrectOptionKey(value) {
  return s(value).slice(0, MCQ_OPTION_RULES.maxKeyChars);
}

function normalizeCorrectOptionKeys(value) {
  const rows = Array.isArray(value)
    ? value
    : String(value ?? '')
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  const out = [];
  const seen = new Set();
  rows.forEach((item) => {
    const key = normalizeCorrectOptionKey(item);
    if (!key) return;
    const dedupe = key.toLowerCase();
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push(key);
  });
  if (out.length > MCQ_OPTION_RULES.maxItems) return out.slice(0, MCQ_OPTION_RULES.maxItems);
  return out;
}

function hashStringToUint32(value = '') {
  const text = String(value || '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickDeterministicOptionKey(optionKeys = [], seed = '') {
  const keys = (Array.isArray(optionKeys) ? optionKeys : []).filter((row) => s(row));
  if (!keys.length) return '';
  const seedToken = s(seed) || keys.join('|');
  const index = hashStringToUint32(seedToken) % keys.length;
  return keys[index] || keys[0];
}

function greatestCommonDivisor(a = 1, b = 1) {
  let x = Math.abs(Number.parseInt(String(a), 10) || 1);
  let y = Math.abs(Number.parseInt(String(b), 10) || 1);
  while (y !== 0) {
    const tmp = y;
    y = x % y;
    x = tmp;
  }
  return x || 1;
}

function pickDeterministicTraversalStep(length = 0, seed = '') {
  const size = Math.max(0, Number.parseInt(String(length), 10) || 0);
  if (size <= 2) return 1;
  const candidates = [];
  for (let step = 2; step < size; step += 1) {
    if (greatestCommonDivisor(step, size) === 1) candidates.push(step);
  }
  if (!candidates.length) return 1;
  const seedToken = s(seed) || String(size);
  const index = hashStringToUint32(`${seedToken}::step`) % candidates.length;
  return candidates[index] || 1;
}

function pickDeterministicOptionKeys(optionKeys = [], minCount = 2, seed = '') {
  const keys = (Array.isArray(optionKeys) ? optionKeys : []).filter((row) => s(row));
  if (!keys.length) return [];
  const count = Math.max(1, Math.min(keys.length, Number.parseInt(String(minCount), 10) || 1));
  const seedToken = s(seed) || keys.join('|');
  const start = hashStringToUint32(`${seedToken}::start`) % keys.length;
  const step = pickDeterministicTraversalStep(keys.length, seedToken);
  const out = [];
  for (let i = 0; i < keys.length && out.length < count; i += 1) {
    const key = keys[(start + (i * step)) % keys.length];
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

function buildMcqFallbackSeed(payload = {}, optionKeys = []) {
  const source = safeObject(payload, {});
  const optionRows = Array.isArray(source.options) ? source.options : [];
  const optionSignature = optionRows
    .map((row) => `${s(row?.key)}:${s(row?.text)}`)
    .filter(Boolean)
    .join('|');
  return [
    s(source.stem),
    s(source.transcript),
    s(source.explanation),
    optionSignature,
    (Array.isArray(optionKeys) ? optionKeys : []).join('|')
  ].join('||');
}

function getResponseTimeRange(questionType = '') {
  const token = s(questionType).toLowerCase();
  if (token === 'speaking_repeat_sentence') {
    return REPEAT_SENTENCE_RESPONSE_TIME_RANGE;
  }
  if (token === 'speaking_answer_short_question') {
    return ANSWER_SHORT_QUESTION_RESPONSE_TIME_RANGE;
  }
  return RESPONSE_TIME_RANGE;
}

function normalizeTraitList(value, warnings = []) {
  const rows = Array.isArray(value)
    ? value
    : String(value ?? '')
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  const out = [];
  const seen = new Set();
  rows.forEach((item) => {
    const normalized = s(item).slice(0, 80).toLowerCase();
    if (!normalized) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  });
  if (!out.length) {
    warnings.push('traits were invalid; default trait list was applied.');
    return ['content', 'pronunciation', 'fluency'];
  }
  if (out.length > 10) {
    warnings.push('traits list was limited to 10 items.');
  }
  return out.slice(0, 10);
}

function normalizeTraitWeights(value, questionType, warnings = []) {
  const traitKeys = Array.isArray(TRAIT_KEYS_BY_TYPE[questionType]) ? TRAIT_KEYS_BY_TYPE[questionType] : [];
  const fallbackWeights = deepClone(safeObject(TARGET_DEFAULTS?.[questionType]?.scoring?.traitWeights, {}), {});
  if (!traitKeys.length) return fallbackWeights;

  let source = value;
  if (!isPlainObject(source) && typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch (_) {
      source = {};
    }
  }
  source = safeObject(source, {});

  const out = {};
  let total = 0;
  traitKeys.forEach((key) => {
    const parsed = Number(source[key]);
    const numeric = Number.isFinite(parsed)
      ? Math.max(SCORE_RATIO_RANGE.min, Math.min(SCORE_RATIO_RANGE.max, parsed))
      : Number(fallbackWeights[key] || 0);
    out[key] = numeric;
    total += numeric;
  });

  if (total <= 0) {
    warnings.push('traitWeights were invalid; default weights were applied.');
    return fallbackWeights;
  }

  const normalized = {};
  traitKeys.forEach((key) => {
    normalized[key] = Number((out[key] / total).toFixed(6));
  });

  // Keep sum stable to 1 after rounding by adjusting the first key.
  const sum = traitKeys.reduce((acc, key) => acc + Number(normalized[key] || 0), 0);
  if (Math.abs(sum - 1) > 0.000001) {
    const first = traitKeys[0];
    normalized[first] = Number((Number(normalized[first] || 0) + (1 - sum)).toFixed(6));
  }
  return normalized;
}

function sanitizeScopedSuggestions(rawSuggestionsByScope = {}, questionType = '', warnings = [], options = {}) {
  const source = safeObject(rawSuggestionsByScope, {});
  const payload = safeObject(source.payload, {});
  const scoring = safeObject(source.scoring, {});
  const mediaRows = Array.isArray(options?.mediaRows) ? options.mediaRows : [];
  const out = { payload: {}, scoring: {} };
  const isDescribeImage = s(questionType).toLowerCase() === 'speaking_describe_image';
  const allowDescribeImageVisualPayload = !isDescribeImage || Boolean(options?.describeImageVisualEvidence);

  Object.keys(payload).forEach((rawKey) => {
    const key = s(rawKey);
    if (!key) return;
    if (
      isDescribeImage
      && DESCRIBE_IMAGE_VISUAL_PAYLOAD_KEY_SET.has(key)
      && !allowDescribeImageVisualPayload
    ) {
      warnings.push(`Dropped Describe Image visual suggestion payload.${key} because AI Assist did not have reliable visual evidence.`);
      return;
    }
    const value = payload[rawKey];
    if (key === 'prepTimeSeconds') {
      out.payload[key] = clampInt(value, PREP_TIME_RANGE.min, PREP_TIME_RANGE.max, PREP_TIME_RANGE.fallback);
      return;
    }
    if (key === 'responseTimeSeconds') {
      const range = getResponseTimeRange(questionType);
      out.payload[key] = clampInt(value, range.min, range.max, range.fallback);
      return;
    }
    if (key === 'minWords') {
      if (questionType === 'writing_write_email') {
        out.payload[key] = clampInt(value, 50, 120, 50);
      } else if (questionType === 'writing_summarize_written_text') {
        out.payload[key] = clampInt(
          value,
          WRITING_SUMMARY_WORD_RANGE.min,
          WRITING_SUMMARY_WORD_RANGE.max,
          WRITING_SUMMARY_WORD_RANGE.fallbackMin
        );
      } else {
        out.payload[key] = clampInt(
          value,
          LISTENING_SUMMARY_WORD_RANGE.min,
          LISTENING_SUMMARY_WORD_RANGE.max,
          LISTENING_SUMMARY_WORD_RANGE.fallbackMin
        );
      }
      return;
    }
    if (key === 'maxWords') {
      if (questionType === 'writing_write_email') {
        out.payload[key] = clampInt(value, 50, 120, 120);
      } else if (questionType === 'writing_summarize_written_text') {
        out.payload[key] = clampInt(
          value,
          WRITING_SUMMARY_WORD_RANGE.min,
          WRITING_SUMMARY_WORD_RANGE.max,
          WRITING_SUMMARY_WORD_RANGE.fallbackMax
        );
      } else {
        out.payload[key] = clampInt(
          value,
          LISTENING_SUMMARY_WORD_RANGE.min,
          LISTENING_SUMMARY_WORD_RANGE.max,
          LISTENING_SUMMARY_WORD_RANGE.fallbackMax
        );
      }
      return;
    }
    if (key === 'recommendedTimeMinutes') {
      if (questionType === 'writing_summarize_written_text') {
        out.payload[key] = clampInt(
          value,
          WRITING_SUMMARY_TIME_RANGE.min,
          WRITING_SUMMARY_TIME_RANGE.max,
          WRITING_SUMMARY_TIME_RANGE.fallback
        );
      } else {
        out.payload[key] = clampInt(
          value,
          LISTENING_SUMMARY_TIME_RANGE.min,
          LISTENING_SUMMARY_TIME_RANGE.max,
          LISTENING_SUMMARY_TIME_RANGE.fallback
        );
      }
      return;
    }
    if (key === 'targetRegister') {
      out.payload[key] = normalizeControlledEnum(value, TARGET_REGISTERS, 'neutral');
      return;
    }
    if (key === 'politenessLevel') {
      out.payload[key] = normalizeControlledEnum(value, POLITENESS_LEVELS, 'medium');
      return;
    }
    if (key === 'expectedKeyPoints') {
      const rows = normalizeExpectedKeyPoints(value, warnings);
      if (rows.length) out.payload[key] = rows;
      return;
    }
    if (key === 'requiredPoints') {
      const rows = normalizeRequiredPoints(value, warnings);
      if (rows.length) out.payload[key] = rows;
      return;
    }
    if (key === 'acceptedAnswers') {
      const rows = normalizeAcceptedAnswers(value, warnings);
      if (rows.length) out.payload[key] = rows;
      return;
    }
    if (key === 'answerAliases') {
      const rows = normalizeAnswerAliases(value, warnings);
      if (rows.length) out.payload[key] = rows;
      return;
    }
    if (key === 'incorrectWords') {
      const rows = normalizeIncorrectWords(value, warnings);
      if (rows.length) out.payload[key] = rows;
      return;
    }
    if (key === 'transcriptVariants') {
      const rows = normalizeTranscriptVariants(value, warnings);
      if (rows.length) out.payload[key] = rows;
      return;
    }
    if (key === 'options') {
      const rows = normalizeMcqOptions(value, warnings);
      if (rows.length) out.payload[key] = rows;
      return;
    }
    if (key === 'correctOptionKey') {
      const normalized = normalizeCorrectOptionKey(value);
      if (normalized) out.payload[key] = normalized;
      return;
    }
    if (key === 'correctOptionKeys') {
      const normalized = normalizeCorrectOptionKeys(value);
      if (normalized.length) out.payload[key] = normalized;
      return;
    }
    if (key === 'partialCreditEnabled') {
      out.payload[key] = normalizeBooleanLike(value, false);
      return;
    }
    if (key === 'normalizationRules') {
      let normalized = value;
      if (!isPlainObject(normalized) && typeof normalized === 'string') {
        try {
          normalized = JSON.parse(normalized);
        } catch (_) {
          normalized = {};
        }
      }
      let normalizedObject = safeObject(normalized, {});
      if (questionType === 'listening_dictation' && !Object.keys(normalizedObject).length) {
        normalizedObject = deepClone(DICTATION_NORMALIZATION_RULE_DEFAULTS, {});
        warnings.push('normalizationRules were empty; dictation defaults were applied.');
      }
      out.payload[key] = normalizedObject;
      return;
    }
    if (key === 'caseSensitive') {
      out.payload[key] = normalizeBooleanLike(value, false);
      return;
    }
    if (key === 'allowSynonyms') {
      out.payload[key] = normalizeBooleanLike(value, false);
      return;
    }
    if (key === 'sourcePassage') {
      const passage = s(value).slice(0, FILL_BLANK_RULES.maxTranscriptChars);
      if (passage) out.payload[key] = passage;
      return;
    }
    if (key === 'referenceTranscript') {
      const transcript = s(value).slice(0, 8000);
      if (transcript) out.payload[key] = transcript;
      return;
    }
    if (key === 'pronunciationNotes') {
      const notes = s(value).slice(0, 2000);
      if (notes) out.payload[key] = notes;
      return;
    }
    if (key === 'passageWithBlanks') {
      const passage = s(value).slice(0, FILL_BLANK_RULES.maxTranscriptChars);
      if (passage) out.payload[key] = passage;
      return;
    }
    if (key === 'transcriptWithBlanks') {
      const transcript = s(value).slice(0, FILL_BLANK_RULES.maxTranscriptChars);
      if (transcript) out.payload[key] = transcript;
      return;
    }
    if (key === 'transcriptWithGap') {
      const transcript = s(value).slice(0, FILL_BLANK_RULES.maxTranscriptChars);
      if (transcript) out.payload[key] = transcript;
      return;
    }
    if (key === 'transcriptText') {
      const transcript = s(value).slice(0, FILL_BLANK_RULES.maxTranscriptChars);
      if (transcript) out.payload[key] = transcript;
      return;
    }
    if (key === 'transcript') {
      const transcript = s(value).slice(0, FILL_BLANK_RULES.maxTranscriptChars);
      if (transcript) out.payload[key] = transcript;
      return;
    }
    if (key === 'expectedSummary') {
      const summary = s(value).slice(0, 6000);
      if (summary) out.payload[key] = summary;
      return;
    }
    if (key === 'promptTextOrAudio') {
      const prompt = s(value).slice(0, 300);
      if (prompt) out.payload[key] = prompt;
      return;
    }
    if (key === 'blankAnswerMap') {
      out.payload[key] = normalizeBlankAnswerMap(value, warnings);
      return;
    }
    if (key === 'bankOptions') {
      out.payload[key] = normalizeReadingFillBankOptions(value, warnings);
      return;
    }
    if (key === 'blankOptionsMap') {
      const referenceAnswerMap = isPlainObject(out.payload.blankAnswerMap)
        ? out.payload.blankAnswerMap
        : safeObject(payload.blankAnswerMap, {});
      out.payload[key] = normalizeReadingWritingBlankOptionsMap(value, referenceAnswerMap, warnings);
      return;
    }
    if (key === 'paragraphItems') {
      const rows = normalizeReorderParagraphItems(value, warnings);
      if (rows.length) out.payload[key] = rows;
      return;
    }
    if (key === 'correctOrder') {
      const rows = normalizeReorderCorrectOrder(value, out.payload.paragraphItems || [], warnings);
      if (rows.length) out.payload[key] = rows;
      return;
    }
    if (key === 'passageTitle') {
      const title = s(value).slice(0, REORDER_PARAGRAPH_RULES.maxTitleChars);
      if (title) out.payload[key] = title;
      return;
    }
    if (key === 'allowReplay') {
      out.payload[key] = normalizeBooleanLike(value, false);
      return;
    }
    if (key === 'allowSemanticMatch') {
      out.payload[key] = normalizeBooleanLike(value, false);
      return;
    }
    const text = s(value).slice(0, 400);
    if (text) out.payload[key] = text;
  });

  if (questionType === 'listening_highlight_incorrect_words') {
    const sourceTranscript = s(out.payload.transcript || payload.transcript || payload.sourceTranscript || '');
    const transcriptText = s(out.payload.transcriptText || payload.transcriptText || '');
    const existingIncorrectWords = Array.isArray(out.payload.incorrectWords)
      ? out.payload.incorrectWords
      : [];
    if (sourceTranscript && transcriptText && !existingIncorrectWords.length) {
      const derivedWords = normalizeIncorrectWords(
        extractChangedDisplayWords(sourceTranscript, transcriptText),
        warnings
      );
      if (derivedWords.length) {
        out.payload.incorrectWords = derivedWords;
        warnings.push('incorrectWords were derived from transcript vs transcriptText comparison.');
      }
    }
  }

  if (questionType === 'speaking_answer_short_question') {
    const promptToken = s(out.payload.promptTextOrAudio || payload.promptTextOrAudio || '');
    const transcriptToken = s(out.payload.transcript || payload.transcript || '');
    const looksLikeMediaRef = (
      isLikelyAudioReferenceToken(promptToken)
      || Boolean(promptToken && findMediaAssetByRef(mediaRows, promptToken))
    );
    if (!transcriptToken && promptToken && !looksLikeMediaRef) {
      out.payload.transcript = promptToken.slice(0, 5000);
      warnings.push('transcript was filled from promptTextOrAudio for practice reference.');
    }
  }

  Object.keys(scoring).forEach((rawKey) => {
    const key = s(rawKey);
    if (!key) return;
    const value = scoring[rawKey];
    if (key === 'method') {
      if (questionType === 'speaking_describe_image') {
        out.scoring[key] = 'hybrid_ai_audio_visual';
        return;
      }
      const isWritingType = questionType.startsWith('writing_');
      const fallbackMethod = (
        questionType === 'reading_mcq_single'
        || questionType === 'reading_mcq_multiple'
        || questionType === 'reading_true_false'
        || questionType === 'reading_fill_in_blank'
        || questionType === 'reading_writing_fill_in_blank'
        || questionType === 'reading_reorder_paragraphs'
        || questionType === 'reading_matching'
        || questionType === 'listening_mcq_single'
        || questionType === 'listening_select_missing_word'
        || questionType === 'listening_mcq_multiple'
        || questionType === 'listening_fill_in_blank'
        || questionType === 'listening_highlight_incorrect_words'
        || questionType === 'listening_dictation'
      )
        ? 'auto_objective'
        : (questionType === 'speaking_answer_short_question'
          ? 'hybrid_ai_audio_objective'
          : (questionType === 'speaking_describe_image'
            ? 'hybrid_ai_audio_visual'
            : ((questionType === 'listening_summarize_spoken_text' || isWritingType) ? 'hybrid_ai' : 'hybrid_ai_audio')));
      out.scoring[key] = s(value).slice(0, 80) || fallbackMethod;
      return;
    }
    if (key === 'scorerVersion') {
      out.scoring[key] = questionType === 'speaking_read_aloud'
        ? 'pte-read-aloud-v1'
        : (questionType === 'speaking_answer_short_question'
          ? 'pte-answer-short-question-v1'
          : (questionType === 'speaking_describe_image'
            ? 'pte-describe-image-v1'
            : (s(value).slice(0, 120) || '')));
      return;
    }
    if (key === 'maxScoreMode') {
      const token = s(value).toLowerCase();
      out.scoring[key] = ['dynamic_source_word_count_plus_traits', 'fixed'].includes(token)
        ? token
        : (questionType === 'speaking_read_aloud' ? 'dynamic_source_word_count_plus_traits' : 'fixed');
      return;
    }
    if (key === 'contentScoringMode') {
      out.scoring[key] = questionType === 'speaking_read_aloud'
        ? 'word_alignment_errors'
        : (s(value).slice(0, 120) || '');
      return;
    }
    if (key === 'maxScore') {
      if (questionType === 'speaking_describe_image') {
        out.scoring[key] = 15;
        return;
      }
      const fallbackMaxScore = (
        questionType === 'reading_mcq_single'
        || questionType === 'reading_mcq_multiple'
        || questionType === 'reading_true_false'
        || questionType === 'reading_fill_in_blank'
        || questionType === 'reading_writing_fill_in_blank'
        || questionType === 'reading_reorder_paragraphs'
        || questionType === 'reading_matching'
        || questionType === 'listening_mcq_single'
        || questionType === 'listening_select_missing_word'
        || questionType === 'listening_mcq_multiple'
        || questionType === 'listening_fill_in_blank'
        || questionType === 'listening_highlight_incorrect_words'
        || questionType === 'listening_dictation'
        || questionType === 'speaking_answer_short_question'
      )
        ? 1
        : (
          questionType === 'writing_write_email'
            ? 15
            : (questionType === 'writing_summarize_written_text'
              ? 7
              : (questionType === 'writing_essay'
                ? 10
                : (questionType === 'writing_short_answer' ? 5 : 5)))
        );
      out.scoring[key] = clampNumber(value, 0.000001, 100, fallbackMaxScore, 6);
      return;
    }
    if (key === 'perBlankScore') {
      out.scoring[key] = clampNumber(value, 0, 100, 1, 6);
      return;
    }
    if (key === 'perWordScore') {
      out.scoring[key] = clampNumber(value, 0, 100, 1, 6);
      return;
    }
    if (key === 'partialCreditEnabled') {
      out.scoring[key] = normalizeBooleanLike(value, false);
      return;
    }
    if (key === 'traits') {
      const normalizedTraits = normalizeTraitList(value, warnings);
      if (questionType === 'speaking_answer_short_question') {
        const hasVocabulary = normalizedTraits.some((item) => s(item).toLowerCase() === 'vocabulary');
        const hasCorrectness = normalizedTraits.some((item) => s(item).toLowerCase() === 'correctness');
        out.scoring[key] = hasVocabulary || hasCorrectness ? normalizedTraits : ['vocabulary'];
        if (!hasVocabulary && !hasCorrectness) warnings.push('traits were aligned to vocabulary for Answer Short Question.');
      } else if (questionType === 'speaking_describe_image') {
        const currentSet = new Set(normalizedTraits.map((item) => s(item).toLowerCase()));
        const requiredTraits = ['content', 'pronunciation', 'fluency'];
        const hasRequired = requiredTraits.every((trait) => currentSet.has(trait));
        out.scoring[key] = hasRequired ? requiredTraits : requiredTraits;
        if (!hasRequired) warnings.push('traits were aligned to content/pronunciation/fluency for Describe Image.');
      } else if (questionType === 'writing_write_email') {
        const currentSet = new Set(normalizedTraits.map((item) => s(item).toLowerCase()));
        const missingOfficial = WRITING_EMAIL_TRAITS.filter((trait) => !currentSet.has(trait));
        if (!normalizedTraits.length || missingOfficial.length >= 4) {
          out.scoring[key] = WRITING_EMAIL_TRAITS.slice();
          warnings.push('traits were aligned to the official Write Email scoring trait set.');
        } else {
          out.scoring[key] = normalizedTraits;
          if (missingOfficial.length) {
            warnings.push(`Write Email traits are missing some official trait(s): ${missingOfficial.join(', ')}.`);
          }
        }
      } else if (questionType === 'writing_summarize_written_text') {
        const currentSet = new Set(normalizedTraits.map((item) => s(item).toLowerCase()));
        const missingOfficial = WRITING_SUMMARY_TRAITS.filter((trait) => !currentSet.has(trait));
        if (!normalizedTraits.length || missingOfficial.length >= 3) {
          out.scoring[key] = WRITING_SUMMARY_TRAITS.slice();
          warnings.push('traits were aligned to the Summarize Written Text scoring trait set.');
        } else {
          out.scoring[key] = normalizedTraits;
          if (missingOfficial.length) {
            warnings.push(`Summarize Written Text traits are missing some recommended trait(s): ${missingOfficial.join(', ')}.`);
          }
        }
      } else {
        out.scoring[key] = normalizedTraits;
      }
      return;
    }
    if (key === 'traitWeights') {
      out.scoring[key] = normalizeTraitWeights(value, questionType, warnings);
      return;
    }
    if (key === 'contentCoverageMin' || key === 'offTopicPenalty') {
      out.scoring[key] = clampNumber(value, SCORE_RATIO_RANGE.min, SCORE_RATIO_RANGE.max, 0.5);
      return;
    }
    if (key === 'minResponseSeconds') {
      out.scoring[key] = clampInt(value, 1, 300, 20);
      return;
    }
    if (key === 'idealWpmMin') {
      out.scoring[key] = clampInt(value, SCORE_WPM_RANGE.min, SCORE_WPM_RANGE.max, 90);
      return;
    }
    if (key === 'idealWpmMax') {
      out.scoring[key] = clampInt(value, SCORE_WPM_RANGE.min, SCORE_WPM_RANGE.max, 160);
      return;
    }
    if (key === 'contentMax' || key === 'pronunciationMax' || key === 'fluencyMax') {
      out.scoring[key] = clampNumber(value, 0.000001, 5, 5, 6);
      return;
    }
    if (key === 'longPauseSeconds') {
      out.scoring[key] = clampNumber(value, 0.5, 10, 2, 6);
      return;
    }
    if (key === 'minAnalysisConfidence') {
      out.scoring[key] = clampNumber(value, 0, 1, 0.35, 6);
      return;
    }
  });

  if (
    Number.isFinite(out.scoring.idealWpmMin)
    && Number.isFinite(out.scoring.idealWpmMax)
    && out.scoring.idealWpmMax < out.scoring.idealWpmMin
  ) {
    out.scoring.idealWpmMax = out.scoring.idealWpmMin;
    warnings.push('Adjusted idealWpmMax to match idealWpmMin because it was lower.');
  }
  if (
    Number.isFinite(Number(out.payload.minWords))
    && Number.isFinite(Number(out.payload.maxWords))
    && Number(out.payload.maxWords) < Number(out.payload.minWords)
  ) {
    out.payload.maxWords = Number(out.payload.minWords);
    warnings.push('Adjusted maxWords to match minWords because it was lower.');
  }
  if (Array.isArray(out.payload.options) && out.payload.options.length) {
    const optionKeys = out.payload.options.map((row) => s(row?.key || '')).filter(Boolean);
    if (optionKeys.length >= MCQ_OPTION_RULES.minItems) {
      const fallbackSeed = buildMcqFallbackSeed(out.payload, optionKeys);
      if (questionType === 'listening_mcq_multiple' || questionType === 'reading_mcq_multiple') {
        let correctKeys = normalizeCorrectOptionKeys(out.payload.correctOptionKeys || []);
        correctKeys = correctKeys.filter((key) => optionKeys.includes(key));
        if (!correctKeys.length) {
          correctKeys = pickDeterministicOptionKeys(optionKeys, 2, fallbackSeed);
          warnings.push('correctOptionKeys were missing or invalid; defaulted to randomized option keys.');
        } else if (correctKeys.length === 1 && optionKeys.length > 1) {
          const needed = pickDeterministicOptionKeys(
            optionKeys.filter((key) => !correctKeys.includes(key)),
            1,
            `${fallbackSeed}::augment`
          );
          correctKeys = correctKeys.concat(needed);
          warnings.push('correctOptionKeys had fewer than two valid keys; added one randomized key.');
        }
        if (correctKeys.length >= 2 && optionKeys.length > correctKeys.length) {
          const leadingSequential = correctKeys.every((key, index) => key === optionKeys[index]);
          if (leadingSequential) {
            const redistributed = pickDeterministicOptionKeys(
              optionKeys,
              correctKeys.length,
              `${fallbackSeed}::redistribute-leading-sequential`
            );
            if (redistributed.length >= 2) {
              correctKeys = redistributed;
              warnings.push('correctOptionKeys were sequential from the first option; redistributed across options.');
            }
          }
        }
        out.payload.correctOptionKeys = correctKeys.slice(0, MCQ_OPTION_RULES.maxItems);
      } else {
        const fallbackKey = pickDeterministicOptionKey(optionKeys, fallbackSeed);
        const correctKey = s(out.payload.correctOptionKey || '');
        if (!correctKey) {
          out.payload.correctOptionKey = fallbackKey;
          warnings.push('correctOptionKey was missing; defaulted to a randomized option key.');
        } else if (!optionKeys.includes(correctKey)) {
          out.payload.correctOptionKey = fallbackKey;
          warnings.push('correctOptionKey did not match options; defaulted to a randomized option key.');
        }
      }
    }
  }
  if (
    Number.isFinite(out.payload.minWords)
    && Number.isFinite(out.payload.maxWords)
    && out.payload.maxWords < out.payload.minWords
  ) {
    out.payload.maxWords = out.payload.minWords;
    warnings.push('Adjusted maxWords to match minWords because it was lower.');
  }
  if (
    (questionType === 'listening_fill_in_blank' || questionType === 'reading_fill_in_blank' || questionType === 'reading_writing_fill_in_blank')
    && (
      Object.prototype.hasOwnProperty.call(out.payload, 'transcriptWithBlanks')
      || Object.prototype.hasOwnProperty.call(out.payload, 'passageWithBlanks')
      || Object.prototype.hasOwnProperty.call(out.payload, 'blankAnswerMap')
    )
  ) {
    if (questionType === 'reading_fill_in_blank') {
      const normalizedFillBlank = normalizeReadingFillBlankPayload({
        sourcePassage: out.payload.sourcePassage,
        passageWithBlanks: out.payload.passageWithBlanks,
        blankAnswerMap: out.payload.blankAnswerMap,
        bankOptions: out.payload.bankOptions
      }, warnings);
      out.payload.sourcePassage = normalizedFillBlank.sourcePassage;
      out.payload.passageWithBlanks = normalizedFillBlank.passageWithBlanks;
      out.payload.blankAnswerMap = normalizedFillBlank.blankAnswerMap;
      out.payload.bankOptions = normalizedFillBlank.bankOptions;
    } else if (questionType === 'reading_writing_fill_in_blank') {
      const normalizedFillBlank = normalizeReadingWritingFillBlankPayload({
        sourcePassage: out.payload.sourcePassage,
        passageWithBlanks: out.payload.passageWithBlanks,
        blankAnswerMap: out.payload.blankAnswerMap,
        blankOptionsMap: out.payload.blankOptionsMap
      }, warnings);
      out.payload.sourcePassage = normalizedFillBlank.sourcePassage;
      out.payload.passageWithBlanks = normalizedFillBlank.passageWithBlanks;
      out.payload.blankAnswerMap = normalizedFillBlank.blankAnswerMap;
      out.payload.blankOptionsMap = normalizedFillBlank.blankOptionsMap;
    } else {
      const normalizedFillBlank = normalizeListeningFillBlankPayload({
        transcriptWithBlanks: out.payload.transcriptWithBlanks,
        blankAnswerMap: out.payload.blankAnswerMap
      }, warnings);
      out.payload.transcriptWithBlanks = normalizedFillBlank.transcriptWithBlanks;
      out.payload.blankAnswerMap = normalizedFillBlank.blankAnswerMap;
    }
  }
  if (
    questionType === 'reading_reorder_paragraphs'
    && (
      Object.prototype.hasOwnProperty.call(out.payload, 'paragraphItems')
      || Object.prototype.hasOwnProperty.call(out.payload, 'correctOrder')
    )
  ) {
    const paragraphItems = normalizeReorderParagraphItems(
      out.payload.paragraphItems || payload.paragraphItems || [],
      warnings
    );
    const correctOrder = normalizeReorderCorrectOrder(
      out.payload.correctOrder || payload.correctOrder || [],
      paragraphItems,
      warnings
    );
    out.payload.paragraphItems = paragraphItems;
    out.payload.correctOrder = correctOrder.length ? correctOrder : paragraphItems.slice();
  }
  if (
    (questionType === 'listening_dictation' || questionType === 'speaking_repeat_sentence')
    && Object.prototype.hasOwnProperty.call(out.payload, 'expectedTranscript')
  ) {
    const alignedVariants = alignTranscriptVariantsToExpected(
      out.payload.expectedTranscript,
      out.payload.transcriptVariants,
      warnings
    );
    if (alignedVariants.length) {
      out.payload.transcriptVariants = alignedVariants;
    }
  }
  return out;
}

function mergeScopedSuggestions(base = {}, extra = {}) {
  const sourceBase = safeObject(base, {});
  const sourceExtra = safeObject(extra, {});
  return {
    payload: {
      ...safeObject(sourceBase.payload, {}),
      ...safeObject(sourceExtra.payload, {})
    },
    scoring: {
      ...safeObject(sourceBase.scoring, {}),
      ...safeObject(sourceExtra.scoring, {})
    }
  };
}

function parseJsonFromAiText(text = '') {
  const token = s(text);
  if (!token) throw new Error('AI returned empty content.');

  function normalizeJsonCandidate(raw) {
    return String(raw || '')
      .replace(/^\uFEFF/, '')
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/,\s*([}\]])/g, '$1')
      .trim();
  }

  function tryParseCandidate(raw) {
    const direct = s(raw);
    if (!direct) return null;
    let parsed = null;
    try {
      parsed = JSON.parse(direct);
    } catch (_) {
      // Try normalized fallback.
    }
    if (parsed === null) {
      try {
        parsed = JSON.parse(normalizeJsonCandidate(direct));
      } catch (_) {
        return null;
      }
    }
    if (typeof parsed === 'string') {
      const nested = s(parsed);
      if (nested.startsWith('{') || nested.startsWith('[')) {
        try {
          return JSON.parse(nested);
        } catch (_) {
          // Keep parsed string fallback below.
        }
      }
    }
    return parsed;
  }

  function collectBalancedJsonCandidates(source) {
    const out = [];
    const textValue = String(source || '');
    const maxCandidates = 8;
    for (let i = 0; i < textValue.length && out.length < maxCandidates; i += 1) {
      const open = textValue[i];
      if (open !== '{' && open !== '[') continue;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let j = i; j < textValue.length; j += 1) {
        const ch = textValue[j];
        if (inString) {
          if (escaped) {
            escaped = false;
            continue;
          }
          if (ch === '\\') {
            escaped = true;
            continue;
          }
          if (ch === '"') {
            inString = false;
          }
          continue;
        }
        if (ch === '"') {
          inString = true;
          continue;
        }
        if (ch === '{' || ch === '[') {
          depth += 1;
          continue;
        }
        if (ch === '}' || ch === ']') {
          depth -= 1;
          if (depth === 0) {
            const candidate = textValue.slice(i, j + 1).trim();
            if (candidate) out.push(candidate);
            i = j;
            break;
          }
          if (depth < 0) break;
        }
      }
    }
    return out;
  }

  const candidates = [];
  candidates.push(token);

  const fencedBlocks = token.match(/```(?:json)?\s*([\s\S]*?)```/gi) || [];
  fencedBlocks.forEach((block) => {
    const inner = String(block || '').replace(/```(?:json)?/i, '').replace(/```$/, '').trim();
    if (inner) candidates.push(inner);
  });

  collectBalancedJsonCandidates(token).forEach((candidate) => candidates.push(candidate));

  const seen = new Set();
  for (const candidate of candidates) {
    const key = s(candidate);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const parsed = tryParseCandidate(key);
    if (parsed !== null) return parsed;
  }

  const preview = token
    .replace(/\s+/g, ' ')
    .slice(0, 240);
  console.warn(`[PTE AI] JSON_PARSE_FAIL preview="${preview}"`);
  throw new Error('AI response is not valid JSON. Please retry.');
}

function escapeRegExp(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findFieldValueStart(source = '', key = '') {
  const fieldKey = s(key);
  if (!fieldKey) return -1;
  const pattern = new RegExp(`"${escapeRegExp(fieldKey)}"\\s*:\\s*`, 'i');
  const match = pattern.exec(String(source || ''));
  if (!match) return -1;
  return match.index + match[0].length;
}

function readLooseJsonString(source = '', startIndex = 0) {
  const text = String(source || '');
  let i = Number.isFinite(startIndex) ? startIndex : 0;
  if (text[i] !== '"') return { value: '', nextIndex: i, terminated: false };
  i += 1;
  let out = '';
  let escaped = false;
  while (i < text.length) {
    const ch = text[i];
    if (escaped) {
      if (ch === 'n') out += '\n';
      else if (ch === 't') out += '\t';
      else out += ch;
      escaped = false;
      i += 1;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      return { value: s(out), nextIndex: i + 1, terminated: true };
    }
    out += ch;
    i += 1;
  }
  return { value: s(out), nextIndex: i, terminated: false };
}

function extractLooseStringField(source = '', key = '') {
  const start = findFieldValueStart(source, key);
  if (start < 0) return '';
  const tail = String(source).slice(start).trimStart();
  if (!tail.startsWith('"')) return '';
  const parsed = readLooseJsonString(tail, 0);
  return s(parsed.value);
}

function extractLooseNumberField(source = '', key = '') {
  const start = findFieldValueStart(source, key);
  if (start < 0) return null;
  const tail = String(source).slice(start).trimStart();
  const match = /^"?(-?\d+(?:\.\d+)?)/.exec(tail);
  if (!match) return null;
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function extractLooseStringArrayField(source = '', key = '') {
  const start = findFieldValueStart(source, key);
  if (start < 0) return [];
  const tail = String(source).slice(start).trimStart();
  if (!tail.startsWith('[')) return [];

  const rows = [];
  let i = 1;
  while (i < tail.length) {
    const ch = tail[i];
    if (ch === ']') break;
    if (ch === '"' || /\s|,/.test(ch)) {
      if (ch === '"') {
        const parsed = readLooseJsonString(tail, i);
        if (parsed.value) rows.push(parsed.value);
        i = parsed.nextIndex;
        if (!parsed.terminated) break;
        continue;
      }
      i += 1;
      continue;
    }
    let j = i;
    while (j < tail.length && !/[,\]]/.test(tail[j])) j += 1;
    const loose = s(tail.slice(i, j));
    if (loose) rows.push(loose);
    i = j;
  }
  return rows.filter(Boolean);
}

function extractLooseObjectField(source = '', key = '') {
  const start = findFieldValueStart(source, key);
  if (start < 0) return {};
  const tail = String(source).slice(start).trimStart();
  if (!tail.startsWith('{')) return {};
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < tail.length; i += 1) {
    const ch = tail[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const token = tail.slice(0, i + 1);
        try {
          const parsed = JSON.parse(token);
          return isPlainObject(parsed) ? parsed : {};
        } catch (_) {
          return {};
        }
      }
    }
  }
  return {};
}

function extractLooseArrayField(source = '', key = '') {
  const start = findFieldValueStart(source, key);
  if (start < 0) return [];
  const tail = String(source).slice(start).trimStart();
  if (!tail.startsWith('[')) return [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < tail.length; i += 1) {
    const ch = tail[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '[') {
      depth += 1;
      continue;
    }
    if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        const token = tail.slice(0, i + 1);
        try {
          const parsed = JSON.parse(token);
          return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
          return [];
        }
      }
    }
  }
  return [];
}

function extractLooseBooleanField(source = '', key = '') {
  const start = findFieldValueStart(source, key);
  if (start < 0) return null;
  const tail = String(source).slice(start).trimStart();
  const match = /^("?)(true|false|1|0|yes|no|on|off)\1/i.exec(tail);
  if (!match) return null;
  return normalizeBooleanLike(match[2], false);
}

function getTargetFieldLookup(targetFields = []) {
  const map = new Map();
  (Array.isArray(targetFields) ? targetFields : []).forEach((field) => {
    const scope = s(field?.scope).toLowerCase();
    const key = s(field?.key);
    if (!scope || !key) return;
    map.set(key, scope);
  });
  return map;
}

function extractSuggestionMapFromRawText(text = '', targetFields = []) {
  const source = s(text);
  if (!source) return { payload: {}, scoring: {} };
  const out = { payload: {}, scoring: {} };
  const lookup = getTargetFieldLookup(targetFields);

  lookup.forEach((scope, key) => {
    if (key === 'expectedKeyPoints') {
      const arr = extractLooseStringArrayField(source, key);
      if (arr.length) out[scope][key] = arr;
      return;
    }
    if (key === 'incorrectWords') {
      const arr = extractLooseStringArrayField(source, key);
      if (arr.length) out[scope][key] = arr;
      return;
    }
    if (key === 'transcriptVariants') {
      const arr = extractLooseStringArrayField(source, key);
      if (arr.length) out[scope][key] = arr;
      return;
    }
    if (key === 'acceptedAnswers' || key === 'answerAliases') {
      const arr = extractLooseStringArrayField(source, key);
      if (arr.length) out[scope][key] = arr;
      return;
    }
    if (key === 'bankOptions') {
      const arr = extractLooseStringArrayField(source, key);
      if (arr.length) out[scope][key] = arr;
      return;
    }
    if (key === 'traits') {
      const arr = extractLooseStringArrayField(source, key);
      if (arr.length) out[scope][key] = arr;
      return;
    }
    if (key === 'options') {
      const arr = extractLooseArrayField(source, key);
      if (arr.length) out[scope][key] = arr;
      return;
    }
    if (key === 'correctOptionKeys') {
      const arr = extractLooseStringArrayField(source, key);
      if (arr.length) out[scope][key] = arr;
      return;
    }
    if (key === 'allowReplay' || key === 'partialCreditEnabled' || key === 'caseSensitive' || key === 'allowSynonyms' || key === 'allowSemanticMatch') {
      const boolValue = extractLooseBooleanField(source, key);
      if (typeof boolValue === 'boolean') out[scope][key] = boolValue;
      return;
    }
    if (key === 'normalizationRules') {
      const map = extractLooseObjectField(source, key);
      if (Object.keys(map).length) out[scope][key] = map;
      return;
    }
    if (key === 'blankAnswerMap') {
      const map = extractLooseObjectField(source, key);
      if (Object.keys(map).length) out[scope][key] = map;
      return;
    }
    if (key === 'blankOptionsMap') {
      const map = extractLooseObjectField(source, key);
      if (Object.keys(map).length) out[scope][key] = map;
      return;
    }
    if (
      key === 'prepTimeSeconds'
      || key === 'responseTimeSeconds'
      || key === 'minWords'
      || key === 'maxWords'
      || key === 'recommendedTimeMinutes'
      || key === 'maxScore'
      || key === 'perBlankScore'
      || key === 'perWordScore'
      || key === 'contentCoverageMin'
      || key === 'minResponseSeconds'
      || key === 'idealWpmMin'
      || key === 'idealWpmMax'
      || key === 'pronunciationMax'
      || key === 'fluencyMax'
      || key === 'longPauseSeconds'
      || key === 'minAnalysisConfidence'
      || key === 'offTopicPenalty'
    ) {
      const numeric = extractLooseNumberField(source, key);
      if (Number.isFinite(numeric)) out[scope][key] = numeric;
      return;
    }
    if (key === 'traitWeights') {
      const map = extractLooseObjectField(source, key);
      if (Object.keys(map).length) out[scope][key] = map;
      return;
    }
    const value = extractLooseStringField(source, key);
    if (value) out[scope][key] = value;
  });

  return out;
}

function normalizeScopedSuggestions(rawSuggestions = {}, targetFields = [], warnings = []) {
  const out = { payload: {}, scoring: {} };
  const source = safeObject(rawSuggestions, {});
  const lookup = getTargetFieldLookup(targetFields);
  const unknownKeys = [];

  const assign = (scope, key, value) => {
    if (scope !== 'payload' && scope !== 'scoring') return;
    if (!lookup.has(key)) {
      unknownKeys.push(`${scope}.${key}`);
      return;
    }
    out[scope][key] = value;
  };

  const assignByLookup = (key, value) => {
    const scope = lookup.get(key);
    if (!scope) {
      unknownKeys.push(key);
      return;
    }
    out[scope][key] = value;
  };

  if (Array.isArray(source)) {
    source.forEach((row) => {
      const scope = s(row?.scope).toLowerCase();
      const key = s(row?.fieldKey || row?.key);
      if (!scope || !key) return;
      assign(scope, key, row?.value);
    });
  } else if (isPlainObject(source.payload) || isPlainObject(source.scoring)) {
    Object.keys(safeObject(source.payload, {})).forEach((key) => assign('payload', s(key), source.payload[key]));
    Object.keys(safeObject(source.scoring, {})).forEach((key) => assign('scoring', s(key), source.scoring[key]));
  } else {
    Object.keys(source).forEach((key) => {
      assignByLookup(s(key), source[key]);
    });
  }

  if (unknownKeys.length) {
    warnings.push(`Dropped unsupported AI fields: ${unknownKeys.join(', ')}.`);
  }
  return out;
}

function parseAiSuggestionPayload(aiText = '', targetFields = [], questionType = '', options = {}) {
  const parseWarnings = [];
  let parsed = null;
  try {
    parsed = parseJsonFromAiText(aiText);
  } catch (error) {
    const recovered = extractSuggestionMapFromRawText(aiText, targetFields);
    if (Object.keys(safeObject(recovered.payload, {})).length || Object.keys(safeObject(recovered.scoring, {})).length) {
      parsed = { suggestions: recovered };
      parseWarnings.push('AI returned non-strict JSON. Recovered partial suggestions.');
      console.warn('[PTE AI] JSON_PARSE_RECOVERED scoped_fields=true');
    } else {
      parsed = { suggestions: { payload: {}, scoring: {} } };
      parseWarnings.push(s(error?.message) || 'AI response is not valid JSON.');
    }
  }

  const root = safeObject(parsed, {});
  const rawSuggestions = safeObject(root.suggestions, root);
  const scopedWarnings = [];
  const scoped = normalizeScopedSuggestions(rawSuggestions, targetFields, scopedWarnings);
  const sanitizeWarnings = [];
  const sanitized = sanitizeScopedSuggestions(scoped, questionType, sanitizeWarnings, options);
  return {
    suggestions: sanitized,
    warnings: parseWarnings.concat(scopedWarnings, sanitizeWarnings)
  };
}

function normalizeMediaToken(value = '') {
  const token = s(value);
  if (!token) return '';
  let decoded = token;
  try {
    decoded = decodeURIComponent(token);
  } catch (_) {
    decoded = token;
  }
  return decoded.toLowerCase().replace(/\\/g, '/');
}

function isLikelyAudioReferenceToken(value = '') {
  const token = s(value);
  if (!token) return false;
  if (/^https?:\/\//i.test(token)) return true;
  if (/^\/?uploads\//i.test(token)) return true;
  if (/^\/?pte\/questions-bank\//i.test(token)) return true;
  if (AUDIO_REF_EXT_PATTERN.test(token)) return true;
  if (/^qmedia[-_]/i.test(token)) return true;
  // Common media-id style tokens (no spaces, separator + numeric part).
  if (!/\s/.test(token) && /[-_]/.test(token) && /\d/.test(token) && token.length <= 220) return true;
  return false;
}

function buildMediaMatchTokenSet(mediaRow = {}) {
  const tokens = new Set();
  [mediaRow?.id, mediaRow?.name, mediaRow?.originalName, mediaRow?.filename, mediaRow?.path, mediaRow?.url]
    .forEach((value) => {
      const normalized = normalizeMediaToken(value);
      if (!normalized) return;
      tokens.add(normalized);
      const baseName = normalized.split('/').pop();
      if (baseName) tokens.add(baseName);
    });
  return tokens;
}

function findMediaAssetByRef(mediaRows = [], assetRef = '') {
  const refToken = normalizeMediaToken(assetRef);
  if (!refToken) return null;
  const refBaseName = refToken.split('/').pop();
  return (Array.isArray(mediaRows) ? mediaRows : []).find((rawRow) => {
    const row = safeObject(rawRow, {});
    const rowTokens = buildMediaMatchTokenSet(row);
    if (rowTokens.has(refToken)) return true;
    if (refBaseName && rowTokens.has(refBaseName)) return true;
    return false;
  }) || null;
}

function pushUniquePathCandidate(out = [], candidate = '') {
  const token = s(candidate);
  if (!token) return;
  const normalized = path.normalize(token);
  const compare = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  const exists = out.some((row) => {
    const rowCompare = process.platform === 'win32' ? row.toLowerCase() : row;
    return rowCompare === compare;
  });
  if (!exists) out.push(normalized);
}

function getUploadRootCandidates() {
  let configuredRoot = '';
  try {
    configuredRoot = s(settingService.getValue('app', 'uploadsPath'));
  } catch (_) {
    configuredRoot = '';
  }
  const candidates = [];
  if (configuredRoot) {
    pushUniquePathCandidate(candidates, uploadPathUtils.getUploadRootAbsolute());
  }
  pushUniquePathCandidate(candidates, uploadPathUtils.DEFAULT_UPLOAD_ROOT);
  pushUniquePathCandidate(candidates, path.resolve(process.cwd(), '../uploads'));
  return candidates;
}

function decodePathToken(value = '') {
  const token = s(value);
  if (!token) return '';
  try {
    return decodeURIComponent(token);
  } catch (_) {
    return token;
  }
}

function resolveAppRelativeUploadPathCandidates(value = '') {
  const rawToken = s(value);
  if (!rawToken) return [];
  const withoutHost = rawToken.replace(/^https?:\/\/[^/]+/i, '');
  const withoutQuery = withoutHost.split(/[?#]/)[0];
  const normalized = decodePathToken(withoutQuery).replace(/\\/g, '/');
  const match = normalized.match(/^\/?uploads\/(.+)$/i);
  if (!match || !match[1]) return [];
  const relativePath = String(match[1]).replace(/^\/+/, '');
  return getUploadRootCandidates().map((root) => path.resolve(root, relativePath));
}

function resolveMediaPathCandidates(mediaRow = {}) {
  const candidates = [];
  [
    mediaRow?.path,
    mediaRow?.url,
    mediaRow?.previewUrl,
    mediaRow?.downloadUrl
  ].forEach((rawValue) => {
    const token = s(rawValue);
    if (!token) return;

    resolveAppRelativeUploadPathCandidates(token).forEach((candidate) => {
      pushUniquePathCandidate(candidates, candidate);
    });

    if (/^https?:\/\//i.test(token)) return;
    if (/^\/?uploads\//i.test(token.replace(/\\/g, '/'))) return;
    if (path.isAbsolute(token)) {
      pushUniquePathCandidate(candidates, token);
      return;
    }
    pushUniquePathCandidate(candidates, path.resolve(process.cwd(), token));
  });
  return candidates;
}

function resolveAbsoluteMediaPath(mediaRow = {}) {
  return resolveMediaPathCandidates(mediaRow)[0] || '';
}

async function resolveDetachedMediaPathByRef(assetRef = '') {
  const token = s(assetRef);
  if (!token) return '';

  const normalizedToken = decodePathToken(token).replace(/\\/g, '/').replace(/^\/+/, '');
  const baseName = path.basename(normalizedToken || token);
  const candidates = [];

  if (path.isAbsolute(token)) {
    pushUniquePathCandidate(candidates, token);
  }
  if (normalizedToken) {
    pushUniquePathCandidate(candidates, path.resolve(process.cwd(), normalizedToken));
  }
  resolveAppRelativeUploadPathCandidates(token).forEach((candidate) => {
    pushUniquePathCandidate(candidates, candidate);
  });

  if (baseName) {
    getUploadRootCandidates().forEach((root) => {
      pushUniquePathCandidate(candidates, path.resolve(root, baseName));
      pushUniquePathCandidate(candidates, path.resolve(root, 'pte-question-bank', baseName));
      pushUniquePathCandidate(candidates, path.resolve(root, 'PTE', 'Question_Bank', baseName));
    });

    for (const root of getUploadRootCandidates()) {
      let orgFolders = [];
      try {
        orgFolders = await fs.readdir(root, { withFileTypes: true });
      } catch (_) {
        orgFolders = [];
      }
      const dirRows = orgFolders.filter((row) => row && row.isDirectory && row.isDirectory());
      for (const dirRow of dirRows) {
        const folder = s(dirRow?.name);
        if (!folder) continue;
        pushUniquePathCandidate(candidates, path.resolve(root, folder, baseName));
        pushUniquePathCandidate(candidates, path.resolve(root, folder, 'pte-question-bank', baseName));
        pushUniquePathCandidate(candidates, path.resolve(root, folder, 'PTE', 'Question_Bank', baseName));
      }
    }
  }

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat && stat.isFile()) return candidate;
    } catch (_) {
      // Ignore missing candidates.
    }
  }

  return '';
}

function inferAudioMimeType(mediaRow = {}, absolutePath = '') {
  const mimeType = s(mediaRow?.mimeType).toLowerCase();
  if (mimeType.startsWith('audio/')) return mimeType;

  const sourceName = s(mediaRow?.filename)
    || s(mediaRow?.originalName)
    || s(mediaRow?.name)
    || s(mediaRow?.path)
    || s(mediaRow?.url)
    || s(absolutePath);
  const extension = sourceName.includes('.')
    ? sourceName.split('.').pop().toLowerCase()
    : '';
  return AUDIO_MIME_BY_EXT[extension] || 'audio/mpeg';
}

function inferImageMimeType(mediaRow = {}, absolutePath = '') {
  const mimeType = s(mediaRow?.mimeType).toLowerCase();
  if (mimeType.startsWith('image/')) return mimeType;

  const sourceName = s(mediaRow?.filename)
    || s(mediaRow?.originalName)
    || s(mediaRow?.name)
    || s(mediaRow?.path)
    || s(mediaRow?.url)
    || s(absolutePath);
  const extension = sourceName.includes('.')
    ? sourceName.split('.').pop().toLowerCase()
    : '';
  return IMAGE_MIME_BY_EXT[extension] || 'image/png';
}

function inferMediaMimeType(kind = '', mediaRow = {}, absolutePath = '') {
  const token = s(kind).toLowerCase();
  if (token === 'audio') return inferAudioMimeType(mediaRow, absolutePath);
  if (token === 'image') return inferImageMimeType(mediaRow, absolutePath);
  return s(mediaRow?.mimeType).toLowerCase() || 'application/octet-stream';
}

function normalizeUploadUrlToken(value = '') {
  const token = s(value).replace(/\\/g, '/');
  if (!token) return '';
  const withoutHost = token.replace(/^https?:\/\/[^/]+/i, '');
  const withoutQuery = withoutHost.split(/[?#]/)[0];
  if (/^\/uploads\//i.test(withoutQuery)) return withoutQuery;
  if (/^uploads\//i.test(withoutQuery)) return `/${withoutQuery}`;
  return '';
}

function pushUniqueUrlCandidate(out = [], candidate = '') {
  const token = s(candidate);
  if (!token) return;
  const compare = token.toLowerCase();
  if (!out.some((row) => s(row).toLowerCase() === compare)) out.push(token);
}

function buildRemoteMediaUrlCandidates(mediaRow = {}) {
  const candidates = [];
  const baseUrl = getGatewayBaseUrl();
  [
    mediaRow?.url,
    mediaRow?.path,
    mediaRow?.previewUrl,
    mediaRow?.downloadUrl
  ].forEach((rawValue) => {
    const token = s(rawValue);
    if (!token) return;
    if (/^https?:\/\/[^/]+\/uploads\//i.test(token)) {
      pushUniqueUrlCandidate(candidates, token);
      return;
    }
    const uploadPath = normalizeUploadUrlToken(token);
    if (uploadPath && baseUrl) {
      pushUniqueUrlCandidate(candidates, `${baseUrl}${uploadPath}`);
    }
  });
  return candidates;
}

async function fetchRemoteMediaBuffer(mediaRow = {}, kind = '', maxBytes = AI_ASSIST_MEDIA_MAX_BYTES) {
  if (!isRailwayProxyMode()) {
    return { buffer: null, mimeType: '', url: '', error: '', tried: 0 };
  }

  const urls = buildRemoteMediaUrlCandidates(mediaRow);
  if (!urls.length) {
    return { buffer: null, mimeType: '', url: '', error: '', tried: 0 };
  }

  const timeoutMs = getGatewayTimeoutMs();
  let lastError = '';
  for (const url of urls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal
      });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      const contentLength = Number.parseInt(String(response.headers.get('content-length') || ''), 10);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        lastError = `remote file is larger than ${Math.floor(maxBytes / (1024 * 1024))}MB`;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      if (!buffer.length) {
        lastError = 'remote file is empty';
        continue;
      }
      if (buffer.length > maxBytes) {
        lastError = `remote file is larger than ${Math.floor(maxBytes / (1024 * 1024))}MB`;
        continue;
      }
      const headerMime = s(response.headers.get('content-type')).split(';')[0].toLowerCase();
      const mimeType = headerMime || inferMediaMimeType(kind, mediaRow, url);
      return { buffer, mimeType, url, error: '', tried: urls.length };
    } catch (error) {
      lastError = s(error?.message) || 'remote fetch failed';
    } finally {
      clearTimeout(timeout);
    }
  }

  return { buffer: null, mimeType: '', url: '', error: lastError, tried: urls.length };
}

function getAiAssistMediaInputs(questionType = '') {
  const typeKey = s(questionType).toLowerCase();
  const rows = AI_ASSIST_MEDIA_INPUTS_BY_TYPE[typeKey];
  return Array.isArray(rows) ? rows : [];
}

async function buildAiAssistMediaPromptParts({
  normalizedPlan = {}
} = {}) {
  const warnings = [];
  const parts = [];
  const attachmentLines = [];
  const questionType = s(normalizedPlan?.questionType).toLowerCase();
  const inputDefs = getAiAssistMediaInputs(questionType);
  if (!inputDefs.length) return { parts, warnings, attachmentLines };

  const payload = safeObject(normalizedPlan?.payload, {});
  const mediaRows = Array.isArray(normalizedPlan?.mediaAssets) ? normalizedPlan.mediaAssets : [];

  for (const def of inputDefs) {
    const payloadKey = s(def?.payloadKey);
    const kind = s(def?.kind).toLowerCase();
    const label = s(def?.label) || payloadKey;
    if (!payloadKey || !kind) continue;

    const assetRef = s(payload?.[payloadKey]);
    if (!assetRef) continue;

    const mediaRow = findMediaAssetByRef(mediaRows, assetRef);
    if (!mediaRow) {
      warnings.push(`${label} ("${assetRef}") was not found in attached media files.`);
      continue;
    }

    const pathCandidates = resolveMediaPathCandidates(mediaRow);
    let absolutePath = '';
    let stat = null;
    for (const candidatePath of pathCandidates) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const candidateStat = await fs.stat(candidatePath);
        if (candidateStat && candidateStat.isFile()) {
          absolutePath = candidatePath;
          stat = candidateStat;
          break;
        }
      } catch (_) {
        // Try the next candidate; media rows can retain stale paths after moves.
      }
    }
    let fileBuffer = null;
    let mimeType = '';
    let loadedFromRemote = false;

    if (!pathCandidates.length) {
      const remoteMedia = await fetchRemoteMediaBuffer(mediaRow, kind, AI_ASSIST_MEDIA_MAX_BYTES);
      if (remoteMedia.buffer) {
        fileBuffer = remoteMedia.buffer;
        mimeType = remoteMedia.mimeType || inferMediaMimeType(kind, mediaRow, remoteMedia.url);
        absolutePath = remoteMedia.url || '';
        loadedFromRemote = true;
      }
    }

    if (!pathCandidates.length && !fileBuffer) {
      warnings.push(`${label} path could not be resolved for AI Assist.`);
      continue;
    }
    if (!fileBuffer && (!absolutePath || !stat || !stat.isFile())) {
      const remoteMedia = await fetchRemoteMediaBuffer(mediaRow, kind, AI_ASSIST_MEDIA_MAX_BYTES);
      if (remoteMedia.buffer) {
        fileBuffer = remoteMedia.buffer;
        mimeType = remoteMedia.mimeType || inferMediaMimeType(kind, mediaRow, remoteMedia.url);
        absolutePath = remoteMedia.url || absolutePath;
        loadedFromRemote = true;
      } else {
        const remoteNote = remoteMedia.tried
          ? ` Remote Railway fetch also failed${remoteMedia.error ? `: ${remoteMedia.error}` : ''}.`
          : '';
        warnings.push(`${label} file is missing on disk for AI Assist. Checked ${pathCandidates.length || 1} saved path candidate(s).${remoteNote}`);
        continue;
      }
    }
    if (!fileBuffer && Number(stat.size || 0) > AI_ASSIST_MEDIA_MAX_BYTES) {
      warnings.push(
        `${label} file is larger than ${Math.floor(AI_ASSIST_MEDIA_MAX_BYTES / (1024 * 1024))}MB and was skipped for AI Assist.`
      );
      continue;
    }

    if (!fileBuffer) {
      try {
        fileBuffer = await fs.readFile(absolutePath);
      } catch (error) {
        warnings.push(`${label} could not be read for AI Assist: ${s(error?.message) || 'unknown error'}.`);
        continue;
      }
    }
    if (!fileBuffer || !fileBuffer.length) {
      warnings.push(`${label} file is empty and was skipped for AI Assist.`);
      continue;
    }

    mimeType = mimeType || inferMediaMimeType(kind, mediaRow, absolutePath);
    if (kind === 'audio' && !mimeType.startsWith('audio/')) {
      warnings.push(`${label} does not appear to be an audio file (detected ${mimeType}).`);
      continue;
    }
    if (kind === 'image' && !mimeType.startsWith('image/')) {
      warnings.push(`${label} does not appear to be an image file (detected ${mimeType}).`);
      continue;
    }

    parts.push({
      inlineData: {
        mimeType,
        data: fileBuffer.toString('base64')
      }
    });
    attachmentLines.push(`${payloadKey}: ${mimeType}${loadedFromRemote ? ' (Railway uploads)' : ''}`);
  }

  return { parts, warnings, attachmentLines };
}

function buildUserPromptParts(promptText = '', mediaBundle = null) {
  const parts = [{ text: s(promptText) }];
  const bundle = mediaBundle && typeof mediaBundle === 'object' ? mediaBundle : {};
  const attachmentLines = Array.isArray(bundle.attachmentLines)
    ? bundle.attachmentLines.filter((row) => s(row))
    : [];
  if (attachmentLines.length) {
    parts.push({
      text: [
        'Use attached media files as source context where relevant.',
        'Attached files:',
        ...attachmentLines.map((row) => `- ${row}`)
      ].join('\n')
    });
  }
  const mediaParts = Array.isArray(bundle.parts) ? bundle.parts : [];
  mediaParts.forEach((part) => {
    if (part && typeof part === 'object') parts.push(part);
  });
  return parts;
}

function isLikelyMediaPayloadError(error) {
  const token = s(error?.message).toLowerCase();
  if (!token) return false;
  return [
    'image_url',
    'input_audio',
    'inline',
    'media',
    'content type',
    'invalid value',
    'unsupported'
  ].some((probe) => token.includes(probe));
}

function buildListeningTranscriptResponseSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['transcript'],
    properties: {
      transcript: { type: 'string' }
    }
  };
}

function isLikelyTokenCappedTranscriptResult(aiResult = {}) {
  const providerId = s(aiResult?.provider).toLowerCase();
  const raw = aiResult?.raw || {};

  if (providerId === 'openai' || providerId === 'azure-openai') {
    const finishReason = s(raw?.choices?.[0]?.finish_reason).toLowerCase();
    return finishReason === 'length' || finishReason === 'max_tokens';
  }

  if (providerId === 'anthropic') {
    const stopReason = s(raw?.stop_reason || raw?.stopReason).toLowerCase();
    return stopReason.includes('max_tokens');
  }

  if (providerId === 'google-gemini' || providerId === 'google-vertex') {
    const finishReason = s(raw?.candidates?.[0]?.finishReason).toLowerCase();
    return finishReason.includes('max_tokens');
  }

  return false;
}

async function tryTranscribeListeningMcqAudio({
  normalizedPlan = {},
  runtimeProvider = null,
  usageContext = null
} = {}) {
  const warnings = [];
  const mkCoverage = (status, wholeFile, message) => ({
    status: s(status).toLowerCase() || 'not_attempted',
    wholeFile: typeof wholeFile === 'boolean' ? wholeFile : null,
    message: s(message)
  });
  const questionType = s(normalizedPlan?.questionType).toLowerCase();
  if (
    questionType !== 'listening_mcq_single'
    && questionType !== 'listening_select_missing_word'
    && questionType !== 'listening_mcq_multiple'
    && questionType !== 'listening_fill_in_blank'
    && questionType !== 'listening_highlight_incorrect_words'
    && questionType !== 'listening_dictation'
    && questionType !== 'listening_summarize_spoken_text'
    && questionType !== 'speaking_repeat_sentence'
    && questionType !== 'speaking_answer_short_question'
  ) {
    return { transcript: '', warnings, coverage: mkCoverage('not_applicable', null, 'Audio transcription coverage is only available for supported listening prompts, Repeat Sentence, and ASQ audio prompts.') };
  }

  const providerId = s(runtimeProvider?.providerId).toLowerCase();
  if (!LISTENING_AUDIO_TRANSCRIPT_SUPPORTED_PROVIDERS.has(providerId)) {
    warnings.push(
      'Selected AI provider does not support audio transcription for this prompt. Provide transcript manually or switch to a provider with multimodal input support.'
    );
    return {
      transcript: '',
      warnings,
      coverage: mkCoverage('not_attempted', null, 'No transcription was generated because the selected provider does not support audio transcription for this flow.')
    };
  }

  const payload = safeObject(normalizedPlan?.payload, {});
  const promptAudioAssetId = questionType === 'speaking_answer_short_question'
    ? s(payload.promptTextOrAudio || payload.promptAudioAssetId)
    : s(payload.promptAudioAssetId);
  const mediaRows = Array.isArray(normalizedPlan?.mediaAssets) ? normalizedPlan.mediaAssets : [];
  const hasAttachedPromptMedia = Boolean(promptAudioAssetId && findMediaAssetByRef(mediaRows, promptAudioAssetId));
  if (
    questionType === 'speaking_answer_short_question'
    && promptAudioAssetId
    && !isLikelyAudioReferenceToken(promptAudioAssetId)
    && !hasAttachedPromptMedia
  ) {
    return {
      transcript: '',
      warnings,
      coverage: mkCoverage('not_applicable', null, 'ASQ prompt appears to be plain text; audio transcription was not needed.')
    };
  }
  if (!promptAudioAssetId) {
    warnings.push('Prompt audio asset is not attached, so transcript could not be generated from audio.');
    return {
      transcript: '',
      warnings,
      coverage: mkCoverage('not_attempted', null, 'Prompt audio is not attached, so whole-file transcription status is unavailable.')
    };
  }

  let mediaRow = findMediaAssetByRef(mediaRows, promptAudioAssetId);
  if (!mediaRow) {
    const detachedPath = await resolveDetachedMediaPathByRef(promptAudioAssetId);
    if (detachedPath) {
      const detachedName = path.basename(detachedPath);
      mediaRow = {
        id: promptAudioAssetId,
        name: detachedName,
        filename: detachedName,
        originalName: detachedName,
        path: detachedPath,
        mimeType: inferAudioMimeType({ filename: detachedName, path: detachedPath }, detachedPath)
      };
      warnings.push('Prompt audio was resolved from saved uploads by file reference token.');
    }
  }
  if (!mediaRow) {
    const directUploadUrl = normalizeUploadUrlToken(promptAudioAssetId);
    if (directUploadUrl) {
      const directName = path.basename(directUploadUrl);
      mediaRow = {
        id: promptAudioAssetId,
        name: directName,
        filename: directName,
        originalName: directName,
        path: directUploadUrl,
        url: directUploadUrl,
        mimeType: inferAudioMimeType({ filename: directName, path: directUploadUrl, url: directUploadUrl }, directUploadUrl)
      };
      warnings.push('Prompt audio was resolved from a direct upload URL reference.');
    }
  }
  if (!mediaRow) {
    warnings.push(`Prompt audio asset "${promptAudioAssetId}" was not found in attached media files or saved uploads.`);
    return {
      transcript: '',
      warnings,
      coverage: mkCoverage('failed', false, `Prompt audio asset "${promptAudioAssetId}" could not be found, so full transcription could not be verified.`)
    };
  }

  let absolutePath = resolveAbsoluteMediaPath(mediaRow);
  let fileBuffer = null;
  let mimeType = '';
  let loadedFromRemote = false;
  if (!absolutePath) {
    const remoteMedia = await fetchRemoteMediaBuffer(mediaRow, 'audio', LISTENING_AUDIO_TRANSCRIPT_MAX_BYTES);
    if (remoteMedia.buffer) {
      fileBuffer = remoteMedia.buffer;
      mimeType = remoteMedia.mimeType || inferAudioMimeType(mediaRow, remoteMedia.url);
      absolutePath = remoteMedia.url || '';
      loadedFromRemote = true;
      warnings.push('Prompt audio was loaded from Railway uploads for transcription.');
    }
  }
  if (!absolutePath && !fileBuffer) {
    warnings.push('Prompt audio path could not be resolved for transcription.');
    return {
      transcript: '',
      warnings,
      coverage: mkCoverage('failed', false, 'Prompt audio path could not be resolved, so full transcription could not be verified.')
    };
  }

  let stat = null;
  try {
    stat = fileBuffer ? { size: fileBuffer.length, isFile: () => true } : await fs.stat(absolutePath);
  } catch (_) {
    stat = null;
  }
  if (!stat || !stat.isFile()) {
    const remoteMedia = await fetchRemoteMediaBuffer(mediaRow, 'audio', LISTENING_AUDIO_TRANSCRIPT_MAX_BYTES);
    if (remoteMedia.buffer) {
      fileBuffer = remoteMedia.buffer;
      mimeType = remoteMedia.mimeType || inferAudioMimeType(mediaRow, remoteMedia.url);
      absolutePath = remoteMedia.url || absolutePath;
      loadedFromRemote = true;
      stat = { size: fileBuffer.length, isFile: () => true };
      warnings.push('Prompt audio was loaded from Railway uploads for transcription.');
    } else {
      const remoteNote = remoteMedia.tried
        ? ` Remote Railway fetch also failed${remoteMedia.error ? `: ${remoteMedia.error}` : ''}.`
        : '';
      warnings.push(`Prompt audio file is missing on disk, so transcript could not be generated.${remoteNote}`);
      return {
        transcript: '',
        warnings,
        coverage: mkCoverage('failed', false, 'Prompt audio file is missing on disk, so full transcription could not be verified.')
      };
    }
  }
  if (Number(stat.size || 0) > LISTENING_AUDIO_TRANSCRIPT_MAX_BYTES) {
    warnings.push(
      `Prompt audio file is too large for AI transcription (max ${Math.floor(LISTENING_AUDIO_TRANSCRIPT_MAX_BYTES / (1024 * 1024))}MB).`
    );
    return {
      transcript: '',
      warnings,
      coverage: mkCoverage('failed', false, 'Prompt audio is above the supported transcription file size limit, so full transcription is not available.')
    };
  }

  mimeType = mimeType || inferAudioMimeType(mediaRow, absolutePath);
  if (!fileBuffer) {
    try {
      fileBuffer = await fs.readFile(absolutePath);
    } catch (error) {
      warnings.push(`Prompt audio could not be read for transcription: ${s(error?.message) || 'unknown error'}.`);
      return {
        transcript: '',
        warnings,
        coverage: mkCoverage('failed', false, 'Prompt audio file could not be read, so full transcription could not be verified.')
      };
    }
  }
  if (!fileBuffer || !fileBuffer.length) {
    warnings.push('Prompt audio file is empty, so transcript could not be generated.');
    return {
      transcript: '',
      warnings,
      coverage: mkCoverage('failed', false, 'Prompt audio file is empty, so full transcription could not be verified.')
    };
  }

  const systemPrompt = [
    'You are an expert transcription engine for PTE listening items.',
    'Transcribe the attached audio verbatim with accurate punctuation.',
    'Do not summarize, shorten, or omit any spoken content.',
    'Return the full transcript from beginning to end.',
    'Return strict JSON only with key "transcript".',
    'Do not add commentary or extra keys.'
  ].join(' ');

  const userParts = [
    {
      text: [
        'Transcribe this listening prompt audio.',
        'Return JSON only: {"transcript":"..."}'
      ].join('\n')
    },
    {
      inlineData: {
        mimeType,
        data: fileBuffer.toString('base64')
      }
    }
  ];

  try {
    const result = await pteAiProviderService.sendPrompt({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userParts }
      ],
      providerId: runtimeProvider?.providerId,
      modelId: runtimeProvider?.modelId || null,
      credentials: runtimeProvider?.credentials || {},
      generationConfig: LISTENING_AUDIO_TRANSCRIPT_GENERATION_CONFIG,
      responseMimeType: 'application/json',
      responseSchema: buildListeningTranscriptResponseSchema(),
      disableCache: true,
      requestLabel: 'pte-question-bank-ai-assist-audio-transcript',
      timeoutMs: 120000,
      usageContext
    });

    const parsed = safeObject(parseJsonFromAiText(result?.text || ''), {});
    const transcript = s(parsed?.transcript);
    if (!transcript) {
      warnings.push('Audio transcription returned empty transcript.');
      return {
        transcript: '',
        warnings,
        coverage: mkCoverage('failed', false, 'AI returned an empty transcript.')
      };
    }
    const likelyTokenCapped = isLikelyTokenCappedTranscriptResult(result);
    if (likelyTokenCapped) {
      warnings.push(
        'Transcript output may have been clipped by model token limits. Consider using a stronger model or splitting very long audio into shorter files.'
      );
    }
    return {
      transcript,
      warnings,
      coverage: likelyTokenCapped
        ? mkCoverage('possibly_partial', false, 'Model output reached token limits, so transcript may be partial.')
        : mkCoverage('full', true, 'AI transcription completed and returned full output without token-cap truncation signals.')
    };
  } catch (error) {
    warnings.push(`Audio transcription failed: ${s(error?.message) || 'unknown error'}.`);
    return {
      transcript: '',
      warnings,
      coverage: mkCoverage('failed', false, `Audio transcription failed: ${s(error?.message) || 'unknown error'}.`)
    };
  }
}

function getMissingTargets(targetFields = [], scopedSuggestions = {}) {
  const source = safeObject(scopedSuggestions, {});
  const payload = safeObject(source.payload, {});
  const scoring = safeObject(source.scoring, {});
  return (Array.isArray(targetFields) ? targetFields : [])
    .map((row) => ({ scope: s(row?.scope).toLowerCase(), key: s(row?.key) }))
    .filter((row) => row.scope && row.key)
    .filter((row) => {
      const container = row.scope === 'scoring' ? scoring : payload;
      return !Object.prototype.hasOwnProperty.call(container, row.key);
    });
}

function groupTargetsByScope(targets = []) {
  return (Array.isArray(targets) ? targets : []).reduce((acc, row) => {
    const scope = s(row?.scope).toLowerCase();
    const key = s(row?.key);
    if (!scope || !key) return acc;
    if (!acc[scope]) acc[scope] = [];
    acc[scope].push(key);
    return acc;
  }, {});
}

function getSchemaMapByScope(promptConfig = {}) {
  const responseSchema = safeObject(promptConfig.responseSchema, {});
  const suggestionsSchema = safeObject(responseSchema?.properties?.suggestions, {});
  const payloadMap = safeObject(suggestionsSchema?.properties?.payload?.properties, {});
  const scoringMap = safeObject(suggestionsSchema?.properties?.scoring?.properties, {});
  return { payload: payloadMap, scoring: scoringMap };
}

function buildSuggestionSchemaForTargets(missingTargets = [], promptConfig = {}) {
  const grouped = groupTargetsByScope(missingTargets);
  const schemaMap = getSchemaMapByScope(promptConfig);
  const scopedProperties = {};
  const scopedRequired = [];

  ['payload', 'scoring'].forEach((scope) => {
    const keys = Array.isArray(grouped[scope]) ? grouped[scope] : [];
    if (!keys.length) return;
    const sourceMap = safeObject(schemaMap[scope], {});
    const properties = {};
    keys.forEach((key) => {
      if (isPlainObject(sourceMap[key])) {
        properties[key] = deepClone(sourceMap[key], sourceMap[key]);
      }
    });
    const required = Object.keys(properties);
    scopedProperties[scope] = {
      type: 'object',
      additionalProperties: false,
      required,
      properties
    };
    scopedRequired.push(scope);
  });

  return {
    type: 'object',
    additionalProperties: false,
    required: ['suggestions'],
    properties: {
      suggestions: {
        type: 'object',
        additionalProperties: false,
        required: scopedRequired,
        properties: scopedProperties
      }
    }
  };
}

function buildMissingFieldCompletionPrompt({
  promptConfig = {},
  existingSuggestions = {},
  missingTargets = []
} = {}) {
  const grouped = groupTargetsByScope(missingTargets);
  const context = safeObject(promptConfig.completionContext, {});
  return [
    'Complete missing AI suggestion fields for PTE question authoring.',
    'Return strict JSON only, with top-level key "suggestions".',
    `Return ONLY missing payload keys: ${(grouped.payload || []).join(', ') || '(none)'}.`,
    `Return ONLY missing scoring keys: ${(grouped.scoring || []).join(', ') || '(none)'}.`,
    'Do not include markdown, commentary, or extra keys.',
    '',
    'Question context:',
    JSON.stringify(context, null, 2),
    '',
    'Already generated suggestions:',
    JSON.stringify(existingSuggestions, null, 2)
  ].join('\n');
}

function buildFieldMetaMap(typeDef = {}) {
  const map = new Map();
  const requiredFields = Array.isArray(typeDef.requiredFields) ? typeDef.requiredFields : [];
  const optionalFields = Array.isArray(typeDef.optionalFields) ? typeDef.optionalFields : [];
  const scoringFields = Array.isArray(typeDef.scoringFields) ? typeDef.scoringFields : [];

  requiredFields.concat(optionalFields).forEach((field) => {
    const key = s(field?.key);
    if (!key) return;
    map.set(`payload:${key}`, {
      scope: 'payload',
      label: s(field?.label || key),
      inputType: s(field?.input || 'text').toLowerCase() || 'text'
    });
  });
  scoringFields.forEach((field) => {
    const key = s(field?.key);
    if (!key) return;
    map.set(`scoring:${key}`, {
      scope: 'scoring',
      label: s(field?.label || key),
      inputType: s(field?.input || 'text').toLowerCase() || 'text'
    });
  });
  return map;
}

function getExistingValueByScope(existingPayload = {}, existingScoring = {}, scope = '', key = '') {
  if (scope === 'scoring') return deepClone(existingScoring[key], null);
  return deepClone(existingPayload[key], null);
}

function getNormalizedValueByScope(normalizedPayload = {}, normalizedScoring = {}, scope = '', key = '') {
  if (scope === 'scoring') return deepClone(normalizedScoring[key], null);
  return deepClone(normalizedPayload[key], null);
}

function coerceSuggestionsFromNormalized({
  rawSuggestions = {},
  normalizedPayload = {},
  normalizedScoring = {},
  existingPayload = {},
  existingScoring = {},
  targetFields = [],
  fieldMetaMap = new Map()
} = {}) {
  const warnings = [];
  const suggestions = [];
  const source = safeObject(rawSuggestions, {});
  const sourcePayload = safeObject(source.payload, {});
  const sourceScoring = safeObject(source.scoring, {});

  (Array.isArray(targetFields) ? targetFields : []).forEach((target) => {
    const scope = s(target?.scope).toLowerCase();
    const key = s(target?.key);
    if (!scope || !key) return;
    const container = scope === 'scoring' ? sourceScoring : sourcePayload;
    if (!Object.prototype.hasOwnProperty.call(container, key)) return;
    const normalizedContainer = scope === 'scoring'
      ? safeObject(normalizedScoring, {})
      : safeObject(normalizedPayload, {});
    if (!Object.prototype.hasOwnProperty.call(normalizedContainer, key)) {
      warnings.push(`Dropped unsupported suggestion field: ${scope}.${key}.`);
      return;
    }
    const meta = fieldMetaMap.get(`${scope}:${key}`) || { label: key, inputType: 'text' };
    suggestions.push({
      scope,
      fieldKey: key,
      label: meta.label,
      inputType: meta.inputType,
      currentValue: getExistingValueByScope(existingPayload, existingScoring, scope, key),
      suggestedValue: getNormalizedValueByScope(normalizedPayload, normalizedScoring, scope, key)
    });
  });

  if (!suggestions.length) {
    warnings.push('AI did not return any valid field suggestions.');
  }
  return { suggestions, warnings };
}

function isExistingFieldUsable(value, key = '') {
  if (!isMeaningfulValue(value)) return false;
  if (key === 'expectedKeyPoints') return Array.isArray(value) && value.length > 0;
  if (key === 'options') return Array.isArray(value) && value.length >= MCQ_OPTION_RULES.minItems;
  if (key === 'traitWeights') return isPlainObject(value) && Object.keys(value).length > 0;
  return true;
}

function controlledFallbackValueForTarget(target, normalizedPlan = {}) {
  const scope = s(target?.scope).toLowerCase();
  const key = s(target?.key);
  const questionType = s(normalizedPlan.questionType).toLowerCase();
  const defaultsByType = safeObject(TARGET_DEFAULTS?.[questionType], {});
  const scopedDefaults = safeObject(defaultsByType?.[scope], {});
  const existingContainer = scope === 'scoring'
    ? safeObject(normalizedPlan.scoringConfig, {})
    : safeObject(normalizedPlan.payload, {});

  if (isDescribeImageVisualPayloadTarget(target, questionType)) {
    if (key === 'expectedKeyPoints') {
      const keyPoints = normalizeDescribeImageKeyPoints(existingContainer[key]);
      const reliableKeyPoints = keyPoints.filter((item) => isReliableDescribeImageVisualText(item));
      return reliableKeyPoints.length >= 2 ? deepClone(keyPoints, []) : [];
    }
    const existingText = s(existingContainer[key]);
    if (isReliableDescribeImageVisualText(existingText)) {
      return existingText;
    }
    return key === 'expectedKeyPoints' ? [] : '';
  }
  if (isExistingFieldUsable(existingContainer[key], key)) {
    return deepClone(existingContainer[key], scopedDefaults[key]);
  }
  if (
    questionType === 'listening_fill_in_blank'
    && scope === 'payload'
    && (key === 'transcriptWithBlanks' || key === 'blankAnswerMap')
  ) {
    if (key === 'blankAnswerMap') return {};
    const transcriptSeed = s(existingContainer.sourceTranscript || existingContainer.transcriptWithBlanks || scopedDefaults.transcriptWithBlanks || '');
    return transcriptSeed;
  }
  if (
    questionType === 'reading_fill_in_blank'
    && scope === 'payload'
    && (key === 'sourcePassage' || key === 'passageWithBlanks' || key === 'blankAnswerMap' || key === 'bankOptions')
  ) {
    if (key === 'blankAnswerMap') return {};
    if (key === 'bankOptions') return [];
    const sourceSeed = s(existingContainer.sourcePassage || existingContainer.passageWithBlanks || scopedDefaults.sourcePassage || scopedDefaults.passageWithBlanks || '');
    return sourceSeed;
  }
  if (
    questionType === 'reading_writing_fill_in_blank'
    && scope === 'payload'
    && (key === 'sourcePassage' || key === 'passageWithBlanks' || key === 'blankAnswerMap' || key === 'blankOptionsMap')
  ) {
    if (key === 'blankAnswerMap') return {};
    if (key === 'blankOptionsMap') return {};
    const sourceSeed = s(existingContainer.sourcePassage || existingContainer.passageWithBlanks || scopedDefaults.sourcePassage || scopedDefaults.passageWithBlanks || '');
    return sourceSeed;
  }
  if (
    questionType === 'reading_reorder_paragraphs'
    && scope === 'payload'
    && (key === 'paragraphItems' || key === 'correctOrder')
  ) {
    const existingParagraphs = normalizeReorderParagraphItems(existingContainer.paragraphItems || [], []);
    if (key === 'paragraphItems') return existingParagraphs;
    return normalizeReorderCorrectOrder(existingContainer.correctOrder || [], existingParagraphs, []);
  }
  if (Object.prototype.hasOwnProperty.call(scopedDefaults, key)) {
    return deepClone(scopedDefaults[key], scopedDefaults[key]);
  }
  if (scope === 'scoring' && key === 'traitWeights') {
    return normalizeTraitWeights({}, questionType, []);
  }
  return '';
}

const questionBankAiAutofillService = {
  async suggestTypeFields(questionPlan = {}, requestingUser, options = {}) {
    const normalizedPlan = normalizeQuestionPlan(questionPlan);
    let workingPlan = normalizedPlan;
    const preNormalizeWarnings = [];
    let runtimeProvider = null;
    const lockedSuggestionTargets = new Set();
    let transcriptionMeta = null;
    let generatedTranscriptForAssist = '';
    const normalizedQuestionType = s(workingPlan.questionType).toLowerCase();
    const resolvedObjectId = s(normalizedPlan?.id || questionPlan?.id) || 'DRAFT:question';
    const buildUsageContext = (requestLabel = '') => ({
      requestingUser,
      section: 'PTE_QUESTIONS_BANK',
      operation: 'UPDATE',
      objectId: resolvedObjectId,
      requestLabel: s(requestLabel),
      providerRecordId: s(runtimeProvider?.providerRecord?.id),
      providerRecordName: s(runtimeProvider?.providerRecord?.name),
      source: {
        module: 'pte-question-bank-ai-assist',
        eventType: 'type_fields'
      }
    });
    const asqPromptToken = s(workingPlan?.payload?.promptTextOrAudio);
    const shouldPreTranscribeListeningPrompt = (
      normalizedQuestionType === 'listening_mcq_single'
      || normalizedQuestionType === 'listening_select_missing_word'
      || normalizedQuestionType === 'listening_mcq_multiple'
      || normalizedQuestionType === 'listening_fill_in_blank'
      || normalizedQuestionType === 'listening_highlight_incorrect_words'
      || normalizedQuestionType === 'listening_dictation'
      || normalizedQuestionType === 'listening_summarize_spoken_text'
      || normalizedQuestionType === 'speaking_repeat_sentence'
    );
    const hasAttachedAsqPromptMedia = Boolean(
      asqPromptToken && findMediaAssetByRef(Array.isArray(workingPlan?.mediaAssets) ? workingPlan.mediaAssets : [], asqPromptToken)
    );
    const shouldPreTranscribeAsqPrompt = (
      normalizedQuestionType === 'speaking_answer_short_question'
      && (isLikelyAudioReferenceToken(asqPromptToken) || hasAttachedAsqPromptMedia)
    );

    if (shouldPreTranscribeListeningPrompt || shouldPreTranscribeAsqPrompt) {
      runtimeProvider = await pteAiProviderDataService.resolveRuntimeProvider(
        requestingUser,
        options?.accessContext || {},
        options
      );
      if (!SUPPORTED_AI_PROVIDERS.has(s(runtimeProvider?.providerId).toLowerCase())) {
        throw new Error(
          `Selected PTE AI provider "${s(runtimeProvider?.providerId)}" is not supported for AI Assist. Use a supported provider key in /pte/ai-assisst/api-providers.`
        );
      }

      const transcription = await tryTranscribeListeningMcqAudio({
        normalizedPlan: workingPlan,
        runtimeProvider,
        usageContext: buildUsageContext('pte-question-bank-ai-assist-audio-transcript')
      });
      transcriptionMeta = transcription?.coverage && typeof transcription.coverage === 'object'
        ? {
          status: s(transcription.coverage.status).toLowerCase() || 'not_attempted',
          wholeFile: typeof transcription.coverage.wholeFile === 'boolean'
            ? transcription.coverage.wholeFile
            : null,
          message: s(transcription.coverage.message),
          source: 'prompt_audio'
        }
        : null;
      preNormalizeWarnings.push(
        ...((Array.isArray(transcription?.warnings) ? transcription.warnings : []).filter(Boolean))
      );

      const generatedTranscript = s(transcription?.transcript);
      const repeatSentencePromptAudioAssetId = normalizedQuestionType === 'speaking_repeat_sentence'
        ? s(workingPlan?.payload?.promptAudioAssetId)
        : '';
      if (!generatedTranscript && repeatSentencePromptAudioAssetId) {
        const transcriptFailureReason = s(transcriptionMeta?.message)
          || s(Array.isArray(transcription?.warnings) ? transcription.warnings[0] : '');
        throw new Error(
          `Repeat Sentence AI Assist could not transcribe the selected prompt audio. ${
            transcriptFailureReason || 'Attach a readable prompt audio file and retry.'
          }`
        );
      }
      if (generatedTranscript) {
        generatedTranscriptForAssist = generatedTranscript;
        if (normalizedQuestionType === 'listening_fill_in_blank') {
          const currentSourceTranscript = s(workingPlan?.payload?.sourceTranscript);
          const currentTranscriptWithBlanks = s(workingPlan?.payload?.transcriptWithBlanks);
          workingPlan = {
            ...workingPlan,
            payload: {
              ...safeObject(workingPlan.payload, {}),
              sourceTranscript: generatedTranscript,
              transcriptWithBlanks: currentTranscriptWithBlanks || generatedTranscript
            }
          };
          preNormalizeWarnings.push(
            currentSourceTranscript
              ? 'Source transcript was refreshed from attached prompt audio before AI suggestion generation.'
              : 'Source transcript was generated from attached prompt audio before AI suggestion generation.'
          );
        } else if (normalizedQuestionType === 'listening_highlight_incorrect_words') {
          const currentSourceTranscript = s(workingPlan?.payload?.transcript || workingPlan?.payload?.sourceTranscript);
          workingPlan = {
            ...workingPlan,
            payload: {
              ...safeObject(workingPlan.payload, {}),
              transcript: generatedTranscript,
              sourceTranscript: generatedTranscript
            }
          };
          lockedSuggestionTargets.add('payload.transcript');
          preNormalizeWarnings.push(
            currentSourceTranscript
              ? 'Source transcript was refreshed from attached prompt audio before AI suggestion generation.'
              : 'Source transcript was generated from attached prompt audio before AI suggestion generation.'
          );
        } else if (normalizedQuestionType === 'listening_dictation' || normalizedQuestionType === 'speaking_repeat_sentence') {
          const currentExpectedTranscript = s(workingPlan?.payload?.expectedTranscript);
          workingPlan = {
            ...workingPlan,
            payload: {
              ...safeObject(workingPlan.payload, {}),
              expectedTranscript: generatedTranscript
            }
          };
          lockedSuggestionTargets.add('payload.expectedTranscript');
          preNormalizeWarnings.push(
            currentExpectedTranscript
              ? 'Expected transcript was refreshed from attached prompt audio before AI suggestion generation.'
              : 'Expected transcript was generated from attached prompt audio before AI suggestion generation.'
          );
        } else {
          const currentTranscript = s(workingPlan?.payload?.transcript);
          workingPlan = {
            ...workingPlan,
            payload: {
              ...safeObject(workingPlan.payload, {}),
              transcript: generatedTranscript
            }
          };
          lockedSuggestionTargets.add('payload.transcript');
          preNormalizeWarnings.push(
            currentTranscript
              ? 'Transcript was refreshed from attached prompt audio before AI suggestion generation.'
              : 'Transcript was generated from attached prompt audio before AI suggestion generation.'
          );
        }
      }
    }

    let promptConfig = null;
    try {
      promptConfig = promptRegistry.getPromptConfig(workingPlan);
    } catch (error) {
      if (preNormalizeWarnings.length) {
        throw new Error(
          `${s(error?.message) || 'Unable to build AI Assist prompt.'} ${preNormalizeWarnings.join(' ')}`
        );
      }
      throw error;
    }
    if (!promptConfig.supported) {
      return {
        questionType: workingPlan.questionType,
        supported: false,
        suggestions: [],
        warnings: [promptConfig.warning || 'Question type is not supported in this phase.'],
        providerMeta: {}
      };
    }

    if (!runtimeProvider) {
      runtimeProvider = await pteAiProviderDataService.resolveRuntimeProvider(
        requestingUser,
        options?.accessContext || {},
        options
      );
      if (!SUPPORTED_AI_PROVIDERS.has(s(runtimeProvider?.providerId).toLowerCase())) {
        throw new Error(
          `Selected PTE AI provider "${s(runtimeProvider?.providerId)}" is not supported for AI Assist. Use a supported provider key in /pte/ai-assisst/api-providers.`
        );
      }
    }

    const mediaBundle = await buildAiAssistMediaPromptParts({ normalizedPlan: workingPlan });
    preNormalizeWarnings.push(...(Array.isArray(mediaBundle.warnings) ? mediaBundle.warnings : []));
    const describeImageEvidenceStatus = normalizedQuestionType === 'speaking_describe_image'
      ? getDescribeImageVisualEvidenceStatus(workingPlan, mediaBundle)
      : { hasAttachedImage: false, hasTextContext: false, hasEvidence: true };

    if (
      normalizedQuestionType === 'speaking_describe_image'
      && describeImageEvidenceStatus.hasAttachedImage
      && hasDescribeImageVisualDraft(workingPlan.payload)
    ) {
      promptConfig = promptRegistry.getPromptConfig(withoutDescribeImageVisualDraft(workingPlan));
      preNormalizeWarnings.push(
        'Attached prompt image was treated as authoritative; existing caption/key points/chart type were withheld from AI Assist to avoid stale visual context.'
      );
    }

    if (normalizedQuestionType === 'speaking_describe_image' && !describeImageEvidenceStatus.hasEvidence) {
      return {
        questionType: normalizedPlan.questionType,
        supported: true,
        suggestions: [],
        warnings: preNormalizeWarnings.concat([DESCRIBE_IMAGE_AI_ASSIST_NO_EVIDENCE_WARNING]),
        transcriptionMeta,
        providerMeta: {
          providerId: s(runtimeProvider.providerId),
          providerLabel: s(runtimeProvider.providerLabel || runtimeProvider.providerRecord?.name || runtimeProvider.providerId),
          modelUsed: s(runtimeProvider.modelId),
          providerRecordId: s(runtimeProvider.providerRecord?.id || '')
        }
      };
    }
    if (normalizedQuestionType === 'speaking_describe_image' && !describeImageEvidenceStatus.hasAttachedImage) {
      preNormalizeWarnings.push(
        'Describe Image AI Assist could not read the attached prompt image, so visual fields will not be generated or overwritten. Only non-visual timing/scoring suggestions can be used safely.'
      );
    }

    let aiResult = null;
    try {
      aiResult = await pteAiProviderService.sendPrompt({
        messages: [
          { role: 'system', content: promptConfig.systemPrompt },
          { role: 'user', content: buildUserPromptParts(promptConfig.userPrompt, mediaBundle) }
        ],
        providerId: runtimeProvider.providerId,
        modelId: runtimeProvider.modelId || null,
        credentials: runtimeProvider.credentials || {},
        responseMimeType: 'application/json',
        responseSchema: promptConfig.responseSchema || null,
        disableCache: true,
        requestLabel: 'pte-question-bank-ai-assist',
        timeoutMs: 60000,
        usageContext: buildUsageContext('pte-question-bank-ai-assist')
      });
    } catch (error) {
      const hasMedia = Array.isArray(mediaBundle.parts) && mediaBundle.parts.length > 0;
      if (hasMedia && isLikelyMediaPayloadError(error)) {
        if (normalizedQuestionType === 'speaking_describe_image' && !describeImageEvidenceStatus.hasTextContext) {
          return {
            questionType: normalizedPlan.questionType,
            supported: true,
            suggestions: [],
            warnings: preNormalizeWarnings.concat([
              `Provider rejected the Describe Image media payload (${s(error?.message) || 'unknown error'}). AI Assist stopped instead of retrying text-only so it would not invent visual facts. Reattach the image using a provider that supports image input, or enter reliable caption/key points first.`
            ]),
            transcriptionMeta,
            providerMeta: {
              providerId: s(runtimeProvider.providerId),
              providerLabel: s(runtimeProvider.providerLabel || runtimeProvider.providerRecord?.name || runtimeProvider.providerId),
              modelUsed: s(runtimeProvider.modelId),
              providerRecordId: s(runtimeProvider.providerRecord?.id || '')
            }
          };
        }
        preNormalizeWarnings.push(
          `Provider rejected media payload for AI Assist (${s(error?.message) || 'unknown error'}). Retried with text-only prompt.`
        );
        aiResult = await pteAiProviderService.sendTextPrompt({
          systemPrompt: promptConfig.systemPrompt,
          prompt: promptConfig.userPrompt,
          providerId: runtimeProvider.providerId,
          modelId: runtimeProvider.modelId || null,
          credentials: runtimeProvider.credentials || {},
          responseMimeType: 'application/json',
          responseSchema: promptConfig.responseSchema || null,
          disableCache: true,
          requestLabel: 'pte-question-bank-ai-assist-fallback-text-only',
          timeoutMs: 60000,
          usageContext: buildUsageContext('pte-question-bank-ai-assist-fallback-text-only')
        });
      } else {
        throw error;
      }
    }

    const targetFields = Array.isArray(promptConfig.targetFields)
      ? promptConfig.targetFields
      : [];
    const effectiveTargetFields = targetFields;

    const firstPass = parseAiSuggestionPayload(
      aiResult?.text || '',
      effectiveTargetFields,
      normalizedPlan.questionType,
      {
        mediaRows: Array.isArray(workingPlan?.mediaAssets) ? workingPlan.mediaAssets : [],
        describeImageVisualEvidence: describeImageEvidenceStatus.hasAttachedImage
      }
    );
    let scopedSuggestions = mergeScopedSuggestions({ payload: {}, scoring: {} }, firstPass.suggestions);
    if (lockedSuggestionTargets.has('payload.transcript') && generatedTranscriptForAssist) {
      if (!scopedSuggestions.payload || typeof scopedSuggestions.payload !== 'object') scopedSuggestions.payload = {};
      scopedSuggestions.payload.transcript = generatedTranscriptForAssist;
      preNormalizeWarnings.push('Verbatim transcript from prompt audio is preserved and used for Transcript.');
    }
    if (lockedSuggestionTargets.has('payload.expectedTranscript') && generatedTranscriptForAssist) {
      if (!scopedSuggestions.payload || typeof scopedSuggestions.payload !== 'object') scopedSuggestions.payload = {};
      scopedSuggestions.payload.expectedTranscript = generatedTranscriptForAssist;
      preNormalizeWarnings.push('Verbatim transcript from prompt audio is preserved and used for Expected Transcript.');
    }
    preNormalizeWarnings.push(...(Array.isArray(firstPass.warnings) ? firstPass.warnings : []));

    let missingTargets = getMissingTargets(effectiveTargetFields, scopedSuggestions);
    if (missingTargets.length) {
      try {
        const completionPrompt = buildMissingFieldCompletionPrompt({
          promptConfig,
          existingSuggestions: scopedSuggestions,
          missingTargets
        });
        let completionResult = null;
        try {
          completionResult = await pteAiProviderService.sendPrompt({
            messages: [
              { role: 'system', content: promptConfig.systemPrompt },
              { role: 'user', content: buildUserPromptParts(completionPrompt, mediaBundle) }
            ],
            providerId: runtimeProvider.providerId,
            modelId: runtimeProvider.modelId || null,
            credentials: runtimeProvider.credentials || {},
            responseMimeType: 'application/json',
            responseSchema: buildSuggestionSchemaForTargets(missingTargets, promptConfig),
            disableCache: true,
            requestLabel: 'pte-question-bank-ai-assist-fill-missing',
            timeoutMs: 60000,
            usageContext: buildUsageContext('pte-question-bank-ai-assist-fill-missing')
          });
        } catch (error) {
          const hasMedia = Array.isArray(mediaBundle.parts) && mediaBundle.parts.length > 0;
          if (hasMedia && isLikelyMediaPayloadError(error)) {
            if (normalizedQuestionType === 'speaking_describe_image' && !describeImageEvidenceStatus.hasTextContext) {
              preNormalizeWarnings.push(
                `Follow-up prompt rejected the Describe Image media payload (${s(error?.message) || 'unknown error'}). Skipped text-only follow-up to avoid inventing visual facts.`
              );
              throw error;
            }
            preNormalizeWarnings.push(
              `Follow-up prompt rejected media payload (${s(error?.message) || 'unknown error'}). Retried with text-only prompt.`
            );
            completionResult = await pteAiProviderService.sendTextPrompt({
              systemPrompt: promptConfig.systemPrompt,
              prompt: completionPrompt,
              providerId: runtimeProvider.providerId,
              modelId: runtimeProvider.modelId || null,
              credentials: runtimeProvider.credentials || {},
              responseMimeType: 'application/json',
              responseSchema: buildSuggestionSchemaForTargets(missingTargets, promptConfig),
              disableCache: true,
              requestLabel: 'pte-question-bank-ai-assist-fill-missing-fallback-text-only',
              timeoutMs: 60000,
              usageContext: buildUsageContext('pte-question-bank-ai-assist-fill-missing-fallback-text-only')
            });
          } else {
            throw error;
          }
        }

        const secondPass = parseAiSuggestionPayload(
          completionResult?.text || '',
          missingTargets,
          normalizedPlan.questionType,
          {
            mediaRows: Array.isArray(workingPlan?.mediaAssets) ? workingPlan.mediaAssets : [],
            describeImageVisualEvidence: describeImageEvidenceStatus.hasAttachedImage
          }
        );
        scopedSuggestions = mergeScopedSuggestions(scopedSuggestions, secondPass.suggestions);
        preNormalizeWarnings.push(
          ...((Array.isArray(secondPass.warnings) ? secondPass.warnings : []).map((msg) => `Follow-up: ${msg}`))
        );
      } catch (error) {
        preNormalizeWarnings.push(
          `Follow-up for missing AI fields failed: ${s(error?.message) || 'unknown error'}.`
        );
      }
      missingTargets = getMissingTargets(effectiveTargetFields, scopedSuggestions);
      if (missingTargets.length) {
        preNormalizeWarnings.push(
          `AI did not return all fields. Missing: ${missingTargets.map((row) => `${row.scope}.${row.key}`).join(', ')}.`
        );
        const appliedFallbackTargets = [];
        missingTargets.forEach((target) => {
          const scope = s(target.scope).toLowerCase();
          const key = s(target.key);
          if (!scope || !key) return;
          const fallbackValue = controlledFallbackValueForTarget(target, workingPlan);
          if (isDescribeImageVisualPayloadTarget(target, normalizedQuestionType) && !describeImageEvidenceStatus.hasAttachedImage) {
            preNormalizeWarnings.push(`Skipped fallback for payload.${key}; Describe Image visual fields require a readable attached image in AI Assist.`);
            return;
          }
          if (isDescribeImageVisualPayloadTarget(target, normalizedQuestionType) && !isMeaningfulValue(fallbackValue)) {
            preNormalizeWarnings.push(`Skipped fallback for payload.${key}; Describe Image visual fields require real image evidence.`);
            return;
          }
          if (!scopedSuggestions[scope]) scopedSuggestions[scope] = {};
          scopedSuggestions[scope][key] = fallbackValue;
          appliedFallbackTargets.push(`${scope}.${key}`);
        });
        if (appliedFallbackTargets.length) {
          preNormalizeWarnings.push(
            `Applied fallback values for missing fields: ${appliedFallbackTargets.join(', ')}.`
          );
        }
      }
    }

    if (
      normalizedQuestionType === 'listening_dictation'
      || normalizedQuestionType === 'speaking_repeat_sentence'
    ) {
      const expectedTranscript = s(
        safeObject(scopedSuggestions.payload, {}).expectedTranscript
        || safeObject(workingPlan.payload, {}).expectedTranscript
      );
      if (expectedTranscript) {
        if (!scopedSuggestions.payload || typeof scopedSuggestions.payload !== 'object') {
          scopedSuggestions.payload = {};
        }
        scopedSuggestions.payload.transcriptVariants = alignTranscriptVariantsToExpected(
          expectedTranscript,
          scopedSuggestions.payload.transcriptVariants,
          preNormalizeWarnings
        );
      }
    }

    const typeDef = questionTypeRegistry.getDefinition(normalizedPlan.questionType);
    if (!typeDef) {
      throw new Error(`Unsupported question type '${normalizedPlan.questionType}'.`);
    }
    const fieldMetaMap = buildFieldMetaMap(typeDef);

    const mergedPayload = {
      ...safeObject(normalizedPlan.payload, {}),
      ...safeObject(scopedSuggestions.payload, {})
    };
    const mergedScoring = {
      ...safeObject(normalizedPlan.scoringConfig, {}),
      ...safeObject(scopedSuggestions.scoring, {})
    };

    if (normalizedQuestionType === 'speaking_answer_short_question') {
      const transcriptToken = s(mergedPayload.transcript || '');
      const promptToken = s(mergedPayload.promptTextOrAudio || '');
      const hasAttachedPromptMedia = Boolean(
        promptToken && findMediaAssetByRef(Array.isArray(workingPlan?.mediaAssets) ? workingPlan.mediaAssets : [], promptToken)
      );
      const looksLikeMediaRef = (
        isLikelyAudioReferenceToken(promptToken)
        || hasAttachedPromptMedia
      );
      if (!transcriptToken && promptToken && !looksLikeMediaRef) {
        mergedPayload.transcript = promptToken.slice(0, 5000);
        if (!scopedSuggestions.payload || typeof scopedSuggestions.payload !== 'object') {
          scopedSuggestions.payload = {};
        }
        scopedSuggestions.payload.transcript = mergedPayload.transcript;
        preNormalizeWarnings.push('Transcript was populated from prompt text for practice-mode reference.');
      }
    }

    if (
      normalizedQuestionType === 'listening_fill_in_blank'
      || normalizedQuestionType === 'reading_fill_in_blank'
      || normalizedQuestionType === 'reading_writing_fill_in_blank'
    ) {
      const fillBlankWarnings = [];
      if (normalizedQuestionType === 'reading_fill_in_blank') {
        const existingFillBlankPayload = normalizeReadingFillBlankPayload({
          sourcePassage: s(normalizedPlan?.payload?.sourcePassage || normalizedPlan?.payload?.passageWithBlanks || ''),
          passageWithBlanks: s(normalizedPlan?.payload?.passageWithBlanks || normalizedPlan?.payload?.sourcePassage || ''),
          blankAnswerMap: safeObject(normalizedPlan?.payload, {}).blankAnswerMap,
          bankOptions: safeObject(normalizedPlan?.payload, {}).bankOptions
        }, []);
        let normalizedFillBlankPayload = normalizeReadingFillBlankPayload({
          sourcePassage: s(mergedPayload.sourcePassage || mergedPayload.passageWithBlanks || ''),
          passageWithBlanks: s(mergedPayload.passageWithBlanks || mergedPayload.sourcePassage || ''),
          blankAnswerMap: mergedPayload.blankAnswerMap,
          bankOptions: mergedPayload.bankOptions
        }, fillBlankWarnings);
        const hasExistingMap = Object.keys(safeObject(existingFillBlankPayload.blankAnswerMap, {})).length > 0;
        const hasSuggestedMap = Object.keys(safeObject(normalizedFillBlankPayload.blankAnswerMap, {})).length > 0;
        if (hasExistingMap && !hasSuggestedMap) {
          normalizedFillBlankPayload = {
            sourcePassage: existingFillBlankPayload.sourcePassage,
            passageWithBlanks: existingFillBlankPayload.passageWithBlanks,
            blankAnswerMap: existingFillBlankPayload.blankAnswerMap,
            bankOptions: normalizeReadingFillBankOptions(
              []
                .concat(Array.isArray(existingFillBlankPayload.bankOptions) ? existingFillBlankPayload.bankOptions : [])
                .concat(Array.isArray(normalizedFillBlankPayload.bankOptions) ? normalizedFillBlankPayload.bankOptions : []),
              fillBlankWarnings
            )
          };
          fillBlankWarnings.push('AI suggested an empty blankAnswerMap; existing reading blanks were preserved.');
        }
        mergedPayload.sourcePassage = normalizedFillBlankPayload.sourcePassage;
        mergedPayload.passageWithBlanks = normalizedFillBlankPayload.passageWithBlanks;
        mergedPayload.blankAnswerMap = normalizedFillBlankPayload.blankAnswerMap;
        mergedPayload.bankOptions = normalizedFillBlankPayload.bankOptions;
        if (!scopedSuggestions.payload || typeof scopedSuggestions.payload !== 'object') {
          scopedSuggestions.payload = {};
        }
        scopedSuggestions.payload.sourcePassage = normalizedFillBlankPayload.sourcePassage;
        scopedSuggestions.payload.passageWithBlanks = normalizedFillBlankPayload.passageWithBlanks;
        scopedSuggestions.payload.blankAnswerMap = normalizedFillBlankPayload.blankAnswerMap;
        scopedSuggestions.payload.bankOptions = normalizedFillBlankPayload.bankOptions;
      } else if (normalizedQuestionType === 'reading_writing_fill_in_blank') {
        const existingFillBlankPayload = normalizeReadingWritingFillBlankPayload({
          sourcePassage: s(normalizedPlan?.payload?.sourcePassage || normalizedPlan?.payload?.passageWithBlanks || ''),
          passageWithBlanks: s(normalizedPlan?.payload?.passageWithBlanks || normalizedPlan?.payload?.sourcePassage || ''),
          blankAnswerMap: safeObject(normalizedPlan?.payload, {}).blankAnswerMap,
          blankOptionsMap: safeObject(normalizedPlan?.payload, {}).blankOptionsMap
        }, []);
        let normalizedFillBlankPayload = normalizeReadingWritingFillBlankPayload({
          sourcePassage: s(mergedPayload.sourcePassage || mergedPayload.passageWithBlanks || ''),
          passageWithBlanks: s(mergedPayload.passageWithBlanks || mergedPayload.sourcePassage || ''),
          blankAnswerMap: mergedPayload.blankAnswerMap,
          blankOptionsMap: mergedPayload.blankOptionsMap
        }, fillBlankWarnings);
        const hasExistingMap = Object.keys(safeObject(existingFillBlankPayload.blankAnswerMap, {})).length > 0;
        const hasSuggestedMap = Object.keys(safeObject(normalizedFillBlankPayload.blankAnswerMap, {})).length > 0;
        if (hasExistingMap && !hasSuggestedMap) {
          normalizedFillBlankPayload = {
            sourcePassage: existingFillBlankPayload.sourcePassage,
            passageWithBlanks: existingFillBlankPayload.passageWithBlanks,
            blankAnswerMap: existingFillBlankPayload.blankAnswerMap,
            blankOptionsMap: normalizeReadingWritingBlankOptionsMap(
              normalizedFillBlankPayload.blankOptionsMap,
              existingFillBlankPayload.blankAnswerMap,
              fillBlankWarnings
            )
          };
          fillBlankWarnings.push('AI suggested an empty blankAnswerMap; existing reading & writing blanks were preserved.');
        }
        mergedPayload.sourcePassage = normalizedFillBlankPayload.sourcePassage;
        mergedPayload.passageWithBlanks = normalizedFillBlankPayload.passageWithBlanks;
        mergedPayload.blankAnswerMap = normalizedFillBlankPayload.blankAnswerMap;
        mergedPayload.blankOptionsMap = normalizedFillBlankPayload.blankOptionsMap;
        if (!scopedSuggestions.payload || typeof scopedSuggestions.payload !== 'object') {
          scopedSuggestions.payload = {};
        }
        scopedSuggestions.payload.sourcePassage = normalizedFillBlankPayload.sourcePassage;
        scopedSuggestions.payload.passageWithBlanks = normalizedFillBlankPayload.passageWithBlanks;
        scopedSuggestions.payload.blankAnswerMap = normalizedFillBlankPayload.blankAnswerMap;
        scopedSuggestions.payload.blankOptionsMap = normalizedFillBlankPayload.blankOptionsMap;
      } else {
        const existingFillBlankPayload = normalizeListeningFillBlankPayload({
          transcriptWithBlanks: s(normalizedPlan?.payload?.transcriptWithBlanks || normalizedPlan?.payload?.sourceTranscript || ''),
          blankAnswerMap: safeObject(normalizedPlan?.payload, {}).blankAnswerMap
        }, []);
        let normalizedFillBlankPayload = normalizeListeningFillBlankPayload({
          transcriptWithBlanks: s(mergedPayload.transcriptWithBlanks || mergedPayload.sourceTranscript || ''),
          blankAnswerMap: mergedPayload.blankAnswerMap
        }, fillBlankWarnings);
        const hasExistingMap = Object.keys(safeObject(existingFillBlankPayload.blankAnswerMap, {})).length > 0;
        const hasSuggestedMap = Object.keys(safeObject(normalizedFillBlankPayload.blankAnswerMap, {})).length > 0;
        if (hasExistingMap && !hasSuggestedMap) {
          normalizedFillBlankPayload = {
            transcriptWithBlanks: existingFillBlankPayload.transcriptWithBlanks,
            blankAnswerMap: existingFillBlankPayload.blankAnswerMap
          };
          fillBlankWarnings.push('AI suggested an empty blankAnswerMap; existing listening blanks were preserved.');
        }
        mergedPayload.transcriptWithBlanks = normalizedFillBlankPayload.transcriptWithBlanks;
        mergedPayload.blankAnswerMap = normalizedFillBlankPayload.blankAnswerMap;
        if (!scopedSuggestions.payload || typeof scopedSuggestions.payload !== 'object') {
          scopedSuggestions.payload = {};
        }
        scopedSuggestions.payload.transcriptWithBlanks = normalizedFillBlankPayload.transcriptWithBlanks;
        scopedSuggestions.payload.blankAnswerMap = normalizedFillBlankPayload.blankAnswerMap;
      }
      preNormalizeWarnings.push(...fillBlankWarnings.filter(Boolean));
    }

    let normalizedContracts = null;
    try {
      normalizedContracts = questionTypeRegistry.normalizeQuestionContracts(
        normalizedPlan.questionType,
        mergedPayload,
        mergedScoring
      );
    } catch (error) {
      if (
        normalizedQuestionType === 'listening_fill_in_blank'
        || normalizedQuestionType === 'reading_fill_in_blank'
        || normalizedQuestionType === 'reading_writing_fill_in_blank'
      ) {
        normalizedContracts = {
          payload: {
            ...safeObject(mergedPayload, {})
          },
          scoringConfig: {
            ...safeObject(mergedScoring, {})
          },
          responseContract: safeObject(typeDef.responseShape, {}),
          errors: []
        };
        preNormalizeWarnings.push(
          (normalizedQuestionType === 'reading_fill_in_blank' || normalizedQuestionType === 'reading_writing_fill_in_blank')
            ? 'Reading Fill in the Blanks AI Assist returned passage-first suggestions without blanks. Select text in passage and mark blanks manually.'
            : 'Listening Fill in the Blanks AI Assist returned transcript-first suggestions without blanks. Select text in transcript and create blanks manually.'
        );
      } else {
        throw new Error(`AI suggestions could not be normalized safely: ${error.message}`);
      }
    }

    const suggestionBundle = coerceSuggestionsFromNormalized({
      rawSuggestions: scopedSuggestions,
      normalizedPayload: safeObject(normalizedContracts.payload, {}),
      normalizedScoring: safeObject(normalizedContracts.scoringConfig, {}),
      existingPayload: safeObject(normalizedPlan.payload, {}),
      existingScoring: safeObject(normalizedPlan.scoringConfig, {}),
      targetFields: effectiveTargetFields,
      fieldMetaMap
    });

    const warnings = []
      .concat(preNormalizeWarnings)
      .concat(Array.isArray(suggestionBundle.warnings) ? suggestionBundle.warnings : [])
      .concat(Array.isArray(normalizedContracts.errors) ? normalizedContracts.errors : [])
      .filter(Boolean);

    return {
      questionType: normalizedPlan.questionType,
      supported: true,
      suggestions: suggestionBundle.suggestions,
      warnings,
      transcriptionMeta,
      providerMeta: {
        providerId: s(aiResult?.provider || runtimeProvider.providerId),
        providerLabel: s(runtimeProvider.providerLabel || runtimeProvider.providerRecord?.name || runtimeProvider.providerId),
        modelUsed: s(aiResult?.modelUsed || runtimeProvider.modelId),
        providerRecordId: s(runtimeProvider.providerRecord?.id || '')
      }
    };
  }
};

questionBankAiAutofillService._private = {
  parseAiSuggestionPayload,
  sanitizeScopedSuggestions,
  normalizeTraitWeights,
  getMissingTargets,
  buildSuggestionSchemaForTargets,
  coerceSuggestionsFromNormalized,
  resolveAbsoluteMediaPath,
  resolveMediaPathCandidates,
  resolveDetachedMediaPathByRef
};

module.exports = questionBankAiAutofillService;
