const test = require('node:test');
const assert = require('node:assert/strict');

const writingScoringService = require('../packages/pte/MVC/services/pte/pteWritingScoringService');
const scoringEngineService = require('../packages/pte/MVC/services/pte/pteScoringEngineService');

const {
  calculateWritingScore,
  parseAiWritingAnalysis,
  scoreWritingAttemptItem
} = writingScoringService;

const SUMMARY_QUESTION = Object.freeze({
  questionType: 'writing_summarize_written_text',
  payload: {
    sourceTitle: 'Urban Trees',
    sourceText: 'Urban trees reduce heat, improve air quality, and support public health, but they require careful maintenance and equitable distribution.',
    expectedKeyPoints: ['reduce heat', 'improve air quality', 'support public health', 'need maintenance'],
    minWords: 5,
    maxWords: 75,
    recommendedTimeMinutes: 10
  }
});

const LISTENING_SUMMARY_QUESTION = Object.freeze({
  questionType: 'listening_summarize_spoken_text',
  payload: {
    promptAudioAssetId: 'audio-asset-1',
    transcript: 'Urban trees reduce heat, improve air quality, and support public health, but they require careful maintenance and equitable distribution.',
    expectedKeyPoints: ['reduce heat', 'improve air quality', 'support public health', 'need maintenance'],
    minWords: 50,
    maxWords: 70,
    recommendedTimeMinutes: 10
  }
});

const EMAIL_QUESTION = Object.freeze({
  questionType: 'writing_write_email',
  payload: {
    scenarioText: 'You cannot attend a project meeting and need to inform your manager.',
    recipientRole: 'manager',
    senderRole: 'employee',
    purpose: 'apologize, explain absence, and request a new meeting time',
    requiredPoints: ['apologize', 'explain absence', 'request a new meeting time'],
    targetRegister: 'formal',
    minWords: 50,
    maxWords: 120
  }
});

const SUMMARY_MICRO = Object.freeze([
  { id: 'content_main_idea', choice: 'yes', evidence: 'Captures the main benefit of urban trees.', confidence: 0.9 },
  { id: 'content_key_points', choice: 'yes', evidence: 'Includes heat, air quality, health, and maintenance.', confidence: 0.9 },
  { id: 'content_no_distortion', choice: 'yes', evidence: 'No invented meaning.', confidence: 0.9 },
  { id: 'grammar_control', choice: 'good', evidence: 'Mostly accurate single sentence.', confidence: 0.9 },
  { id: 'vocabulary_precision', choice: 'developing', evidence: 'Adequate but simple paraphrase.', confidence: 0.8 }
]);

const EMAIL_MICRO = Object.freeze([
  { id: 'content_purpose', choice: 'yes', evidence: 'Explains absence and requests rescheduling.', confidence: 0.9 },
  { id: 'content_required_points', choice: 'partial', evidence: 'Most required points are covered.', confidence: 0.82 },
  { id: 'content_relevance', choice: 'yes', evidence: 'All details stay on scenario.', confidence: 0.9 },
  { id: 'email_tone_register', choice: 'partial', evidence: 'Mostly formal, with some casual phrasing.', confidence: 0.82 },
  { id: 'organization_sequence', choice: 'yes', evidence: 'Clear opening, explanation, request, and close.', confidence: 0.9 },
  { id: 'organization_cohesion', choice: 'partial', evidence: 'Connections are understandable but basic.', confidence: 0.82 },
  { id: 'vocabulary_appropriacy', choice: 'good', evidence: 'Appropriate workplace vocabulary.', confidence: 0.86 },
  { id: 'grammar_control', choice: 'developing', evidence: 'Meaning is clear with some awkward grammar.', confidence: 0.78 },
  { id: 'spelling_accuracy', choice: 'excellent', evidence: 'No spelling errors noticed.', confidence: 0.9 }
]);

test('Writing analysis parser accepts microAssessments JSON only', () => {
  const parsed = parseAiWritingAnalysis(JSON.stringify({
    microAssessments: SUMMARY_MICRO,
    confidence: 0.91,
    languageNotes: 'Clear but simple.',
    warnings: []
  }));

  assert.equal(parsed.microAssessments.length, SUMMARY_MICRO.length);
  assert.equal(parsed.confidence, 0.91);
  assert.equal(parsed.languageNotes, 'Clear but simple.');
});

test('Writing score calculation sums deterministic micro-assessment trait scores', () => {
  const result = calculateWritingScore({
    questionType: 'writing_summarize_written_text',
    microTraitScores: {
      content: 2,
      form: 1,
      grammar: 2,
      vocabulary: 1
    }
  });

  assert.equal(result.scoreFinal, 6);
  assert.equal(result.maxScore, 7);
  assert.equal(result.percentage, 85.71);
});

test('Summarize Written Text scorer returns micro-assessment score payload and feedback', async () => {
  const result = await scoreWritingAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'writing_summarize_written_text',
      metadata: {}
    },
    question: SUMMARY_QUESTION,
    responsePayload: {
      text: 'Urban trees help cities by lowering heat, improving air quality, supporting health, and requiring fair maintenance across neighborhoods.'
    },
    scoringConfig: {}
  }, {
    aiAnalysis: {
      microAssessments: SUMMARY_MICRO,
      confidence: 0.9,
      warnings: []
    },
    provider: { providerId: 'test-provider', modelUsed: 'test-model' }
  });

  assert.equal(result.status, 'scored');
  assert.equal(result.scorePayload.scoreFinal, 6);
  assert.equal(result.scorePayload.maxScore, 7);
  assert.deepEqual(result.scorePayload.traitScores, {
    content: 2,
    form: 1,
    grammar: 2,
    vocabulary: 1
  });
  assert.equal(result.metadata.microAssessments.length, 7);
  assert.equal(result.metadata.scoringContractVersion, 2);
  assert.equal(Boolean(result.metadata.feedbackDraft), true);
});

test('Write Email scorer returns micro-assessment score payload and feedback', async () => {
  const result = await scoreWritingAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'writing_write_email',
      metadata: {}
    },
    question: EMAIL_QUESTION,
    responsePayload: {
      text: 'Dear Manager,\n\nI am sorry, but I cannot attend the project meeting today because I have an urgent medical appointment. Could we please move the meeting to tomorrow afternoon or another time that works for you? I will review the notes and complete my tasks before then.\n\nKind regards,\nAlex'
    },
    scoringConfig: {}
  }, {
    aiAnalysis: {
      microAssessments: EMAIL_MICRO,
      confidence: 0.88,
      warnings: []
    },
    provider: { providerId: 'test-provider', modelUsed: 'test-model' }
  });

  assert.equal(result.status, 'scored');
  assert.equal(result.scorePayload.scoreFinal, 14);
  assert.equal(result.scorePayload.maxScore, 15);
  assert.deepEqual(result.scorePayload.traitScores, {
    content: 3,
    emailConventions: 2,
    form: 2,
    organization: 2,
    vocabulary: 2,
    grammar: 1,
    spelling: 2
  });
  assert.equal(result.metadata.microAssessments.length, 12);
  assert.equal(Boolean(result.metadata.feedbackDraft), true);
});

test('Summarize Spoken Text scorer returns micro-assessment score payload and feedback', async () => {
  const result = await scoreWritingAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'listening_summarize_spoken_text',
      metadata: {}
    },
    question: LISTENING_SUMMARY_QUESTION,
    responsePayload: {
      text: 'Urban trees reduce city heat, improve air quality, and support public health, although cities must maintain them fairly across neighborhoods to keep these benefits sustainable and accessible.'
    },
    scoringConfig: {}
  }, {
    aiAnalysis: {
      microAssessments: SUMMARY_MICRO,
      confidence: 0.9,
      warnings: []
    },
    provider: { providerId: 'test-provider', modelUsed: 'test-model' }
  });

  assert.equal(result.status, 'scored');
  assert.equal(result.scorePayload.scoreFinal, 6);
  assert.equal(result.scorePayload.maxScore, 7);
  assert.deepEqual(result.scorePayload.traitScores, {
    content: 2,
    form: 1,
    grammar: 2,
    vocabulary: 1
  });
  assert.equal(result.metadata.scorerKey, 'listening_summarize_spoken_text');
  assert.equal(result.metadata.scorerVersion, 'pte-listening-summarize-spoken-text-v1');
  assert.equal(result.metadata.microAssessments.length, 7);
  assert.equal(Boolean(result.metadata.feedbackDraft), true);
});

test('Writing scorer fails safely when required micro-assessments are missing', async () => {
  const result = await scoreWritingAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'writing_summarize_written_text',
      metadata: {}
    },
    question: SUMMARY_QUESTION,
    responsePayload: {
      text: 'Urban trees help cities by improving health and reducing heat.'
    },
    scoringConfig: {}
  }, {
    aiAnalysis: {
      microAssessments: [
        { id: 'content_main_idea', choice: 'yes', evidence: 'Main idea present.', confidence: 0.9 }
      ],
      confidence: 0.4,
      warnings: []
    },
    provider: { providerId: 'test-provider', modelUsed: 'test-model' }
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.scorePayload, null);
  assert.equal(result.metadata.warnings.some((row) => row.includes('Missing required writing micro-assessments')), true);
});

test('Scoring engine supports active Writing and listening summary text micro-assessment types', async () => {
  assert.equal(scoringEngineService.isAutoScoringSupported('writing_summarize_written_text'), true);
  assert.equal(scoringEngineService.isAutoScoringSupported('writing_write_email'), true);
  assert.equal(scoringEngineService.isAutoScoringSupported('listening_summarize_spoken_text'), true);
});

test('Scoring engine dispatches listening summarize spoken text to writing micro-assessment scorer', async () => {
  const scored = await scoringEngineService.scoreAttemptItem({
    session: { id: 'session-1' },
    item: { id: 'item-1', questionType: 'listening_summarize_spoken_text', metadata: {} },
    question: LISTENING_SUMMARY_QUESTION,
    responsePayload: {
      text: 'Urban trees reduce heat, improve air quality, and support public health, but cities need fair maintenance to sustain these benefits.'
    },
    scoringConfig: {}
  }, {
    aiAnalysis: {
      microAssessments: SUMMARY_MICRO,
      confidence: 0.9,
      warnings: []
    },
    provider: { providerId: 'test-provider', modelUsed: 'test-model' }
  });

  assert.equal(scored.status, 'scored');
  assert.equal(scored.scorePayload.scoreFinal, 6);
  assert.equal(scored.metadata.scorerVersion, 'pte-listening-summarize-spoken-text-v1');
});
