const test = require('node:test');
const assert = require('node:assert/strict');

const questionTypeRegistry = require('../MVC/services/pte/questionTypeRegistry');

const RESPOND_PAYLOAD = Object.freeze({
  situationText: 'Your friend invited you to dinner, but you already have a family event.',
  role: 'friend',
  audience: 'friend',
  targetFunction: 'decline invitation politely',
  targetRegister: 'informal',
  prepTimeSeconds: 25,
  responseTimeSeconds: 40
});

const RESPOND_SCORING = Object.freeze({
  method: 'hybrid_ai_audio_situational',
  scorerVersion: 'pte-respond-to-situation-v1',
  maxScore: 13,
  maxScoreMode: 'fixed_appropriacy_3_plus_traits',
  appropriacyMax: 3,
  pronunciationMax: 5,
  fluencyMax: 5,
  traits: ['appropriacy', 'pronunciation', 'fluency'],
  traitWeights: { appropriacy: 0.5, pronunciation: 0.25, fluency: 0.25 },
  contentCoverageMin: 0.6,
  minResponseSeconds: 20,
  idealWpmMin: 85,
  idealWpmMax: 155,
  longPauseSeconds: 2,
  offTopicPenalty: 0.25,
  minAnalysisConfidence: 0.35
});

const DESCRIBE_PAYLOAD = Object.freeze({
  imageAssetId: 'IMG_001',
  prepTimeSeconds: 25,
  responseTimeSeconds: 40
});

const DESCRIBE_SCORING = Object.freeze({
  method: 'hybrid_ai_audio_visual',
  scorerVersion: 'pte-describe-image-v1',
  maxScore: 15,
  traits: ['content', 'pronunciation', 'fluency'],
  traitWeights: { content: 0.5, pronunciation: 0.25, fluency: 0.25 },
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
});

const READ_ALOUD_PAYLOAD = Object.freeze({
  sourceText: 'The quick brown fox jumps over the lazy dog.',
  prepTimeSeconds: 25,
  responseTimeSeconds: 40
});

const READ_ALOUD_SCORING = Object.freeze({
  method: 'hybrid_ai_audio',
  scorerVersion: 'pte-read-aloud-v1',
  maxScoreMode: 'dynamic_source_word_count_plus_traits',
  maxScore: 5,
  traits: ['content', 'pronunciation', 'fluency'],
  contentScoringMode: 'word_alignment_errors',
  pronunciationMax: 5,
  fluencyMax: 5,
  idealWpmMin: 90,
  idealWpmMax: 160,
  longPauseSeconds: 2,
  minAnalysisConfidence: 0.35
});

const REPEAT_SENTENCE_PAYLOAD = Object.freeze({
  promptAudioAssetId: 'RS_AUDIO_001',
  expectedTranscript: 'Many people believe public parks improve city life.',
  transcriptVariants: ['Many people believe that public parks improve city life.'],
  responseTimeSeconds: 20
});

const REPEAT_SENTENCE_SCORING = Object.freeze({
  method: 'hybrid_ai_audio_repetition',
  scorerVersion: 'pte-repeat-sentence-v1',
  maxScore: 13,
  maxScoreMode: 'fixed_content_3_plus_traits',
  contentMax: 3,
  pronunciationMax: 5,
  fluencyMax: 5,
  traits: ['content', 'pronunciation', 'fluency'],
  contentScoringMode: 'ordered_prompt_word_coverage',
  idealWpmMin: 90,
  idealWpmMax: 170,
  longPauseSeconds: 2,
  minAnalysisConfidence: 0.35
});

const ANSWER_SHORT_PAYLOAD = Object.freeze({
  promptTextOrAudio: 'What is the capital of Australia?',
  acceptedAnswers: ['Canberra'],
  answerAliases: ['the capital of Australia is Canberra'],
  caseSensitive: false,
  allowSemanticMatch: true,
  responseTimeSeconds: 15
});

const ANSWER_SHORT_SCORING = Object.freeze({
  method: 'hybrid_ai_audio_objective',
  scorerVersion: 'pte-answer-short-question-v1',
  maxScore: 1,
  traits: ['vocabulary'],
  minAnalysisConfidence: 0.35,
  minSemanticConfidence: 0.7
});

test('registry accepts valid scorer-ready scoring contracts for targeted speaking types', () => {
  const respondErrors = questionTypeRegistry.validateQuestionContracts(
    'speaking_respond_to_situation',
    { ...RESPOND_PAYLOAD },
    { ...RESPOND_SCORING }
  );
  const describeErrors = questionTypeRegistry.validateQuestionContracts(
    'speaking_describe_image',
    { ...DESCRIBE_PAYLOAD },
    { ...DESCRIBE_SCORING }
  );

  assert.deepEqual(respondErrors, []);
  assert.deepEqual(describeErrors, []);
});

test('normalizeQuestionContracts derives composite speaking maxScore from component maxima', () => {
  const cases = [
    {
      typeKey: 'speaking_repeat_sentence',
      payload: REPEAT_SENTENCE_PAYLOAD,
      scoring: REPEAT_SENTENCE_SCORING,
      staleMaxScore: 1,
      expectedMaxScore: 13,
      mismatchText: 'maxScore must equal contentMax + pronunciationMax + fluencyMax'
    },
    {
      typeKey: 'speaking_describe_image',
      payload: DESCRIBE_PAYLOAD,
      scoring: DESCRIBE_SCORING,
      staleMaxScore: 5,
      expectedMaxScore: 15,
      mismatchText: 'maxScore must equal contentMax + pronunciationMax + fluencyMax'
    },
    {
      typeKey: 'speaking_respond_to_situation',
      payload: RESPOND_PAYLOAD,
      scoring: RESPOND_SCORING,
      staleMaxScore: 5,
      expectedMaxScore: 13,
      mismatchText: 'maxScore must equal appropriacyMax + pronunciationMax + fluencyMax'
    }
  ];

  cases.forEach(({ typeKey, payload, scoring, staleMaxScore, expectedMaxScore, mismatchText }) => {
    const normalized = questionTypeRegistry.normalizeQuestionContracts(
      typeKey,
      { ...payload },
      {
        ...scoring,
        maxScore: staleMaxScore
      }
    );

    assert.equal(normalized.scoringConfig.maxScore, expectedMaxScore);
    assert.equal(normalized.errors.some((row) => String(row).includes(mismatchText)), false);
  });
});

test('registry accepts Read Aloud v1 dynamic scoring contract', () => {
  const errors = questionTypeRegistry.validateQuestionContracts(
    'speaking_read_aloud',
    { ...READ_ALOUD_PAYLOAD },
    { ...READ_ALOUD_SCORING }
  );

  assert.deepEqual(errors, []);
});

test('registry accepts Repeat Sentence v1 fixed scoring contract', () => {
  const errors = questionTypeRegistry.validateQuestionContracts(
    'speaking_repeat_sentence',
    { ...REPEAT_SENTENCE_PAYLOAD },
    { ...REPEAT_SENTENCE_SCORING }
  );

  assert.deepEqual(errors, []);
});

test('registry accepts Answer Short Question v1 objective-audio scoring contract', () => {
  const errors = questionTypeRegistry.validateQuestionContracts(
    'speaking_answer_short_question',
    { ...ANSWER_SHORT_PAYLOAD },
    { ...ANSWER_SHORT_SCORING }
  );

  assert.deepEqual(errors, []);
});

test('registry rejects invalid Read Aloud scorer settings', () => {
  const errors = questionTypeRegistry.validateQuestionContracts(
    'speaking_read_aloud',
    { ...READ_ALOUD_PAYLOAD },
    {
      ...READ_ALOUD_SCORING,
      scorerVersion: 'old',
      traits: ['content'],
      idealWpmMin: 170,
      idealWpmMax: 100,
      minAnalysisConfidence: 2
    }
  );

  assert.equal(errors.some((row) => String(row).includes('scorerVersion must be pte-read-aloud-v1')), true);
  assert.equal(errors.some((row) => String(row).includes('Scoring traits are missing: pronunciation')), true);
  assert.equal(errors.some((row) => String(row).includes('Scoring traits are missing: fluency')), true);
  assert.equal(errors.some((row) => String(row).includes('idealWpmMax must be greater than or equal to idealWpmMin')), true);
  assert.equal(errors.some((row) => String(row).includes('minAnalysisConfidence must be between 0 and 1')), true);
});

test('registry rejects invalid Repeat Sentence scorer settings', () => {
  const errors = questionTypeRegistry.validateQuestionContracts(
    'speaking_repeat_sentence',
    { ...REPEAT_SENTENCE_PAYLOAD },
    {
      ...REPEAT_SENTENCE_SCORING,
      scorerVersion: 'old',
      traits: ['content'],
      contentMax: 4,
      maxScore: 99,
      idealWpmMin: 180,
      idealWpmMax: 100,
      minAnalysisConfidence: 2
    }
  );

  assert.equal(errors.some((row) => String(row).includes('scorerVersion must be pte-repeat-sentence-v1')), true);
  assert.equal(errors.some((row) => String(row).includes('Scoring traits are missing: pronunciation')), true);
  assert.equal(errors.some((row) => String(row).includes('Scoring traits are missing: fluency')), true);
  assert.equal(errors.some((row) => String(row).includes('contentMax must be greater than 0 and no more than 3')), true);
  assert.equal(errors.some((row) => String(row).includes('maxScore must equal contentMax + pronunciationMax + fluencyMax')), true);
  assert.equal(errors.some((row) => String(row).includes('idealWpmMax must be greater than or equal to idealWpmMin')), true);
  assert.equal(errors.some((row) => String(row).includes('minAnalysisConfidence must be between 0 and 1')), true);
});

test('registry rejects traitWeights key mismatch and non-unit sums', () => {
  const errors = questionTypeRegistry.validateQuestionContracts(
    'speaking_respond_to_situation',
    { ...RESPOND_PAYLOAD },
    {
      ...RESPOND_SCORING,
      traitWeights: { appropriacy: 0.7, pronunciation: 0.2, wrong_key: 0.1 }
    }
  );

  assert.equal(errors.some((row) => String(row).includes('traitWeights contains unsupported keys')), true);
  assert.equal(errors.some((row) => String(row).includes('traitWeights is missing keys')), true);
  assert.equal(errors.some((row) => String(row).includes('traitWeights values must sum to 1')), true);
});

test('registry rejects invalid Respond to a Situation scorer settings', () => {
  const errors = questionTypeRegistry.validateQuestionContracts(
    'speaking_respond_to_situation',
    { ...RESPOND_PAYLOAD },
    {
      ...RESPOND_SCORING,
      scorerVersion: 'old',
      maxScore: 99,
      traits: ['appropriacy'],
      appropriacyMax: 4,
      idealWpmMin: 180,
      idealWpmMax: 100,
      minAnalysisConfidence: 2
    }
  );

  assert.equal(errors.some((row) => String(row).includes('scorerVersion must be pte-respond-to-situation-v1')), true);
  assert.equal(errors.some((row) => String(row).includes('Scoring traits are missing: pronunciation')), true);
  assert.equal(errors.some((row) => String(row).includes('fluency')), true);
  assert.equal(errors.some((row) => String(row).includes('appropriacyMax must be greater than 0 and no more than 3')), true);
  assert.equal(errors.some((row) => String(row).includes('maxScore must equal appropriacyMax + pronunciationMax + fluencyMax')), true);
  assert.equal(errors.some((row) => String(row).includes('idealWpmMax must be greater than or equal to idealWpmMin')), true);
  assert.equal(errors.some((row) => String(row).includes('minAnalysisConfidence must be between 0 and 1')), true);
});

test('registry rejects out-of-range scoring values and invalid WPM ordering', () => {
  const errors = questionTypeRegistry.validateQuestionContracts(
    'speaking_describe_image',
    { ...DESCRIBE_PAYLOAD },
    {
      ...DESCRIBE_SCORING,
      contentCoverageMin: 1.2,
      offTopicPenalty: -0.2,
      minResponseSeconds: 0,
      idealWpmMin: 120,
      idealWpmMax: 100
    }
  );

  assert.equal(errors.some((row) => String(row).includes('contentCoverageMin must be between 0 and 1')), true);
  assert.equal(errors.some((row) => String(row).includes('offTopicPenalty must be between 0 and 1')), true);
  assert.equal(errors.some((row) => String(row).includes('minResponseSeconds must be an integer greater than or equal to 1')), true);
  assert.equal(errors.some((row) => String(row).includes('idealWpmMax must be greater than or equal to idealWpmMin')), true);
});

test('normalizeQuestionContracts enforces scoring field hard bounds', () => {
  assert.throws(() => {
    questionTypeRegistry.normalizeQuestionContracts(
      'speaking_respond_to_situation',
      { ...RESPOND_PAYLOAD },
      {
        ...RESPOND_SCORING,
        idealWpmMax: 999
      }
    );
  }, /at most 260/i);
});

test('normalizeQuestionContracts keeps listening dictation transcriptVariants up to 500 chars each', () => {
  const longVariant = 'x'.repeat(420);
  const normalized = questionTypeRegistry.normalizeQuestionContracts(
    'listening_dictation',
    {
      promptAudioAssetId: 'DICT_AUDIO_001',
      expectedTranscript: 'Sample expected transcript.',
      transcriptVariants: [longVariant]
    },
    {
      method: 'auto_objective',
      maxScore: 1,
      perWordScore: 1
    }
  );

  assert.equal(Array.isArray(normalized?.payload?.transcriptVariants), true);
  assert.equal(String(normalized.payload.transcriptVariants[0] || '').length, 420);
});

test('official listening question types are enabled for both core and academic', () => {
  const officialListeningTypes = [
    'listening_summarize_spoken_text',
    'listening_mcq_single',
    'listening_mcq_multiple',
    'listening_fill_in_blank',
    'listening_select_missing_word',
    'listening_highlight_incorrect_words',
    'listening_dictation'
  ];

  officialListeningTypes.forEach((typeKey) => {
    const allowed = questionTypeRegistry.getAllowedTestTypesForType(typeKey);
    assert.deepEqual(allowed, ['core', 'academic']);
  });
});

test('legacy listening matching is hidden from authoring registry', () => {
  const editorTypeKeys = questionTypeRegistry
    .getEditorRegistry()
    .map((row) => String(row?.key || '').trim())
    .filter(Boolean);

  assert.equal(editorTypeKeys.includes('listening_matching'), false);
});

test('normalizeQuestionContracts auto-fills reorder correctOrder from paragraphItems when missing', () => {
  const normalized = questionTypeRegistry.normalizeQuestionContracts(
    'reading_reorder_paragraphs',
    {
      paragraphItems: [
        'First paragraph.',
        'Second paragraph.'
      ],
      correctOrder: []
    },
    {
      method: 'auto_objective',
      maxScore: 1,
      partialCreditEnabled: false
    }
  );

  assert.deepEqual(normalized?.payload?.paragraphItems, ['First paragraph.', 'Second paragraph.']);
  assert.deepEqual(normalized?.payload?.correctOrder, ['First paragraph.', 'Second paragraph.']);
});

test('validateQuestionContracts rejects duplicate paragraph items for reorder paragraphs', () => {
  const errors = questionTypeRegistry.validateQuestionContracts(
    'reading_reorder_paragraphs',
    {
      paragraphItems: [
        'Repeated paragraph.',
        'Repeated paragraph.'
      ],
      correctOrder: [
        'Repeated paragraph.',
        'Repeated paragraph.'
      ]
    },
    {
      method: 'auto_objective',
      maxScore: 1,
      partialCreditEnabled: false
    }
  );

  assert.equal(errors.some((row) => String(row).includes('paragraphItems must be unique')), true);
});

test('normalizeQuestionContracts auto-splits sourcePassage into paragraphItems for reorder paragraphs', () => {
  const normalized = questionTypeRegistry.normalizeQuestionContracts(
    'reading_reorder_paragraphs',
    {
      sourcePassage: 'City planners first collected congestion data from major intersections.\n\nThey then compared short-term fixes against long-term infrastructure options.\n\nFinally, they prioritized projects that balanced cost, impact, and timeline.',
      paragraphItems: [],
      correctOrder: []
    },
    {
      method: 'auto_objective',
      maxScore: 1,
      partialCreditEnabled: false
    }
  );

  assert.equal(Array.isArray(normalized?.payload?.paragraphItems), true);
  assert.equal(normalized.payload.paragraphItems.length >= 2, true);
  assert.deepEqual(normalized.payload.correctOrder, normalized.payload.paragraphItems);
});

test('core test type excludes reading true/false and reading matching, and includes reading & writing fill-in-blanks', () => {
  assert.deepEqual(questionTypeRegistry.getAllowedTestTypesForType('reading_true_false'), ['academic']);
  assert.deepEqual(questionTypeRegistry.getAllowedTestTypesForType('reading_matching'), ['academic']);
  assert.deepEqual(questionTypeRegistry.getAllowedTestTypesForType('reading_writing_fill_in_blank'), ['core', 'academic']);
});

test('reading_writing_fill_in_blank accepts per-blank 4-option dropdown maps', () => {
  const errors = questionTypeRegistry.validateQuestionContracts(
    'reading_writing_fill_in_blank',
    {
      sourcePassage: 'The city council launched a pilot to improve public transport reliability.',
      passageWithBlanks: 'The city council {{1}} a pilot to improve public transport {{2}}.',
      blankAnswerMap: {
        '{{1}}': 'launched',
        '{{2}}': 'reliability'
      },
      blankOptionsMap: {
        '{{1}}': ['started', 'launched', 'stopped', 'ignored'],
        '{{2}}': ['instability', 'reliability', 'delay', 'cost']
      },
      caseSensitive: false
    },
    {
      method: 'auto_objective',
      maxScore: 1,
      perBlankScore: 1
    }
  );

  assert.deepEqual(errors, []);
});

test('reading_writing_fill_in_blank rejects invalid dropdown option maps', () => {
  const errors = questionTypeRegistry.validateQuestionContracts(
    'reading_writing_fill_in_blank',
    {
      passageWithBlanks: 'The city council {{1}} a pilot to improve public transport {{2}}.',
      blankAnswerMap: {
        '{{1}}': 'launched',
        '{{2}}': 'reliability'
      },
      blankOptionsMap: {
        '{{1}}': ['started', 'stopped', 'ignored'],
        '{{2}}': ['instability', 'delay', 'cost', 'speed']
      }
    },
    {
      method: 'auto_objective',
      maxScore: 1,
      perBlankScore: 1
    }
  );

  assert.equal(errors.some((row) => String(row).includes("blankOptionsMap['{{1}}'] must contain exactly 4 options")), true);
  assert.equal(errors.some((row) => String(row).includes("blankOptionsMap['{{2}}'] must include the correct answer")), true);
});
