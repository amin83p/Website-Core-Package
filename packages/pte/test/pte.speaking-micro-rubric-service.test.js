const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MICRO_SCORING_CONTRACT_VERSION,
  MICRO_RUBRIC_VERSION,
  buildAnswerShortQuestionMicroEvaluation,
  collectLegacyDirectModelScores,
  evaluateSpeakingMicroRubric,
  normalizeMicroResponseRows
} = require('../MVC/services/pte/pteSpeakingMicroRubricService');

test('Speaking micro rubric maps fixed choices to deterministic trait scores', () => {
  const result = evaluateSpeakingMicroRubric({
    questionType: 'speaking_describe_image',
    traitMax: { content: 5, pronunciation: 5, fluency: 5 },
    aiAnalysis: {
      microResponses: [
        { id: 'content_main_idea', choice: 'yes', evidence: 'States the chart topic.', confidence: 0.9 },
        { id: 'content_key_details', choice: 'partial', evidence: 'Mentions one comparison.', confidence: 0.8 },
        { id: 'content_visual_accuracy', choice: 'no', evidence: 'Adds an unsupported value.', confidence: 0.7 },
        { id: 'pronunciation_quality', choice: 'good', evidence: 'Mostly clear.', confidence: 0.85 },
        { id: 'fluency_quality', choice: 'developing', evidence: 'Some hesitation.', confidence: 0.75 }
      ]
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.scoringContractVersion, MICRO_SCORING_CONTRACT_VERSION);
  assert.equal(result.microRubricVersion, MICRO_RUBRIC_VERSION);
  assert.deepEqual(result.traitScores, {
    content: 3,
    pronunciation: 4,
    fluency: 3
  });
  assert.equal(result.aggregationBreakdown.content.method, 'choice_average');
  assert.equal(result.aggregationBreakdown.pronunciation.method, 'descriptor_mapping');
});

test('Speaking micro rubric rejects invalid predefined choices safely', () => {
  const result = evaluateSpeakingMicroRubric({
    questionType: 'speaking_read_aloud',
    traitMax: { pronunciation: 5, fluency: 5 },
    aiAnalysis: {
      microResponses: [
        { id: 'pronunciation_quality', choice: 'pretty clear', evidence: 'Free text should not pass.', confidence: 0.8 },
        { id: 'fluency_quality', choice: 'smooth enough', evidence: 'Free text should not pass.', confidence: 0.8 }
      ],
      pronunciation: { score: 5 },
      fluency: { score: 5 }
    }
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.traitScores, {});
  assert.deepEqual(result.invalidResponses.map((row) => row.id), ['pronunciation_quality', 'fluency_quality']);
  assert.equal(result.warnings.some((row) => row.includes('Invalid micro-rubric response choices')), true);
});

test('Speaking micro rubric fails when required answers are missing', () => {
  const result = evaluateSpeakingMicroRubric({
    questionType: 'speaking_repeat_sentence',
    traitMax: { pronunciation: 5, fluency: 5 },
    aiAnalysis: {
      microResponses: [
        { id: 'pronunciation_quality', choice: 'good', evidence: 'Mostly clear.', confidence: 0.8 }
      ]
    }
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missingRequired, ['fluency_quality']);
  assert.deepEqual(result.traitScores, {});
});

test('Speaking micro aggregation ignores legacy direct numeric bands', () => {
  const microResponses = [
    { id: 'pronunciation_quality', choice: 'good', evidence: 'Mostly clear.', confidence: 0.9 },
    { id: 'fluency_quality', choice: 'developing', evidence: 'Some hesitation.', confidence: 0.9 }
  ];
  const lowLegacy = {
    microResponses,
    pronunciation: { score: 0 },
    fluency: { score: 0 }
  };
  const highLegacy = {
    microResponses,
    pronunciation: { score: 5 },
    fluency: { score: 5 }
  };

  const first = evaluateSpeakingMicroRubric({
    questionType: 'speaking_read_aloud',
    traitMax: { pronunciation: 5, fluency: 5 },
    aiAnalysis: lowLegacy
  });
  const second = evaluateSpeakingMicroRubric({
    questionType: 'speaking_read_aloud',
    traitMax: { pronunciation: 5, fluency: 5 },
    aiAnalysis: highLegacy
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(first.traitScores, second.traitScores);
  assert.deepEqual(collectLegacyDirectModelScores(lowLegacy, ['pronunciation', 'fluency']), {
    pronunciation: 0,
    fluency: 0
  });
  assert.deepEqual(collectLegacyDirectModelScores(highLegacy, ['pronunciation', 'fluency']), {
    pronunciation: 5,
    fluency: 5
  });
});

test('Speaking micro parser normalizes object-shaped responses consistently', () => {
  const rows = normalizeMicroResponseRows({
    microRubric: {
      responses: {
        content_main_idea: { answer: 'yes', reason: 'Main trend mentioned.', confidence: 88 },
        content_key_details: 'partial'
      }
    }
  });

  assert.deepEqual(rows, [
    { id: 'content_main_idea', choice: 'yes', evidence: 'Main trend mentioned.', confidence: 0.88 },
    { id: 'content_key_details', choice: 'partial', evidence: '', confidence: 0 }
  ]);
});

test('Answer Short Question micro metadata follows deterministic answer matching', () => {
  const result = buildAnswerShortQuestionMicroEvaluation({
    transcript: 'blue whale',
    match: {
      isCorrect: true,
      matchedAnswer: 'blue whale',
      normalizedTranscript: 'blue whale'
    },
    confidence: 0.91
  });

  assert.equal(result.ok, true);
  assert.equal(result.scoringContractVersion, MICRO_SCORING_CONTRACT_VERSION);
  assert.equal(result.traitScores.vocabulary, 1);
  assert.equal(result.aggregationBreakdown.vocabulary.method, 'deterministic_answer_match');
  assert.deepEqual(result.microResponses.map((row) => row.choice), ['yes', 'yes']);
});
