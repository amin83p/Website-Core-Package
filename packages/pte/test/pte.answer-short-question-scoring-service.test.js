const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const answerShortQuestionScoringService = require('../MVC/services/pte/pteAnswerShortQuestionScoringService');
const scoringEngineService = require('../MVC/services/pte/pteScoringEngineService');
const pteAiProviderDataService = require('../MVC/services/pte/pteAiProviderDataService');
const pteAiProviderService = require('../MVC/services/pte/ai/aiProviderService');

const {
  normalizeAnswerText,
  matchAnswerShortQuestion,
  calculateAnswerShortQuestionScore,
  parseAiAnswerShortQuestionAnalysis,
  scoreAnswerShortQuestionAttemptItem
} = answerShortQuestionScoringService;

const ORIGINALS = {
  resolveRuntimeProvider: pteAiProviderDataService.resolveRuntimeProvider,
  sendPrompt: pteAiProviderService.sendPrompt
};

test.afterEach(() => {
  pteAiProviderDataService.resolveRuntimeProvider = ORIGINALS.resolveRuntimeProvider;
  pteAiProviderService.sendPrompt = ORIGINALS.sendPrompt;
});

test('Answer Short Question normalization removes filler and punctuation', () => {
  assert.equal(normalizeAnswerText('The answer is Canberra.'), 'canberra');
  assert.equal(normalizeAnswerText("It's the moon!"), 'the moon');
});

test('Answer Short Question matching accepts exact answers and aliases', () => {
  const exact = matchAnswerShortQuestion({
    transcript: 'The answer is Canberra.',
    acceptedAnswers: ['Canberra'],
    answerAliases: []
  });
  assert.equal(exact.isCorrect, true);
  assert.equal(exact.matchType, 'exact');

  const alias = matchAnswerShortQuestion({
    transcript: 'the capital of australia is canberra',
    acceptedAnswers: ['Canberra'],
    answerAliases: ['the capital of Australia is Canberra']
  });
  assert.equal(alias.isCorrect, true);
  assert.equal(alias.matchType, 'alias');
});

test('Answer Short Question semantic matching is gated by config and confidence', () => {
  const rejected = matchAnswerShortQuestion({
    transcript: 'physician',
    acceptedAnswers: ['doctor'],
    allowSemanticMatch: false,
    semanticMatch: { isMatch: true, confidence: 0.95, matchedAnswer: 'doctor' }
  });
  assert.equal(rejected.isCorrect, false);

  const accepted = matchAnswerShortQuestion({
    transcript: 'physician',
    acceptedAnswers: ['doctor'],
    allowSemanticMatch: true,
    minSemanticConfidence: 0.7,
    semanticMatch: { isMatch: true, confidence: 0.95, matchedAnswer: 'doctor' }
  });
  assert.equal(accepted.isCorrect, true);
  assert.equal(accepted.matchType, 'semantic');
});

test('Answer Short Question raw score is correct or incorrect', () => {
  const correct = calculateAnswerShortQuestionScore({
    transcript: 'Canberra',
    acceptedAnswers: ['Canberra'],
    scoringConfig: { maxScore: 1 }
  });
  assert.equal(correct.scoreFinal, 1);
  assert.equal(correct.maxScore, 1);
  assert.equal(correct.percentage, 100);
  assert.equal(correct.traitScores.vocabulary, 1);

  const incorrect = calculateAnswerShortQuestionScore({
    transcript: 'Sydney',
    acceptedAnswers: ['Canberra'],
    scoringConfig: { maxScore: 1 }
  });
  assert.equal(incorrect.scoreFinal, 0);
  assert.equal(incorrect.percentage, 0);
});

test('AI Answer Short Question analysis parsing normalizes nested fields', () => {
  const parsed = parseAiAnswerShortQuestionAnalysis('```json\n{"transcription":{"text":"The answer is Canberra."},"normalizedAnswer":"Canberra","confidence":87,"semanticMatch":{"isMatch":true,"confidence":0.8},"warnings":["low confidence","low confidence"]}\n```');
  assert.equal(parsed.transcript, 'The answer is Canberra.');
  assert.equal(parsed.normalizedAnswer, 'Canberra');
  assert.equal(parsed.confidence, 0.87);
  assert.equal(parsed.semanticMatch.isMatch, true);
  assert.deepEqual(parsed.warnings, ['low confidence']);
});

test('Answer Short Question scorer refuses typed transcript notes without uploaded audio', async () => {
  const result = await scoreAnswerShortQuestionAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'speaking_answer_short_question',
      metadata: { responsePayload: { transcript: 'Canberra' } }
    },
    question: {
      questionType: 'speaking_answer_short_question',
      payload: {
        promptTextOrAudio: 'What is the capital of Australia?',
        acceptedAnswers: ['Canberra']
      }
    },
    artifacts: [],
    responsePayload: { transcript: 'Canberra' },
    scoringConfig: {}
  }, {
    aiAnalysis: { transcript: 'Canberra', confidence: 0.9 }
  });

  assert.equal(result.status, 'needs_evidence');
  assert.equal(result.scorePayload, null);
  assert.equal(result.metadata.warnings.some((row) => row.includes('uploaded audio')), true);
});

test('Answer Short Question scorer returns score payload and feedback draft with audio evidence', async () => {
  const result = await scoreAnswerShortQuestionAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'speaking_answer_short_question',
      artifactIds: ['audio-1'],
      metadata: {}
    },
    question: {
      questionType: 'speaking_answer_short_question',
      payload: {
        promptTextOrAudio: 'What is the capital of Australia?',
        acceptedAnswers: ['Canberra'],
        answerAliases: ['the capital of Australia is Canberra'],
        allowSemanticMatch: false
      }
    },
    artifacts: [
      {
        id: 'audio-1',
        artifactType: 'audio',
        mimeType: 'audio/webm',
        path: '/tmp/asq-audio.webm'
      }
    ],
    responsePayload: {
      artifactId: 'audio-1',
      audioDurationSeconds: 1.4
    },
    scoringConfig: {
      maxScore: 1,
      minSemanticConfidence: 0.7
    }
  }, {
    aiAnalysis: {
      transcript: 'The answer is Canberra.',
      normalizedAnswer: 'Canberra',
      confidence: 0.9
    },
    provider: { providerId: 'test-provider', modelUsed: 'test-model' }
  });

  assert.equal(result.status, 'scored');
  assert.equal(result.scorePayload.scoreFinal, 1);
  assert.equal(result.scorePayload.maxScore, 1);
  assert.equal(result.scorePayload.percentage, 100);
  assert.equal(result.scorePayload.traitScores.vocabulary, 1);
  assert.equal(result.metadata.scorerVersion, 'pte-answer-short-question-v1');
  assert.equal(result.metadata.match.isCorrect, true);
  assert.equal(Boolean(result.metadata.feedbackDraft), true);
});

test('OpenAI Answer Short Question scoring rejects non-audio OpenAI models clearly', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-answer-short-question-openai-model-guard-${Date.now()}.wav`);
  await fs.writeFile(tmpAudioPath, Buffer.from('RIFF fake wav data'));

  pteAiProviderDataService.resolveRuntimeProvider = async () => ({
    providerId: 'openai',
    modelId: 'gpt-5.4-mini',
    credentials: {},
    providerRecord: {
      id: 'PROVIDER-OPENAI',
      name: 'OpenAI'
    }
  });
  pteAiProviderService.sendPrompt = async () => {
    throw new Error('OpenAI scorer should reject the model before sending a prompt');
  };

  try {
    const result = await scoreAnswerShortQuestionAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_answer_short_question',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: {
        questionType: 'speaking_answer_short_question',
        payload: {
          promptTextOrAudio: 'What is the capital of Australia?',
          acceptedAnswers: ['Canberra']
        }
      },
      artifacts: [
        {
          id: 'audio-1',
          artifactType: 'audio',
          mimeType: 'audio/wav',
          path: tmpAudioPath
        }
      ],
      responsePayload: {
        artifactId: 'audio-1',
        audioDurationSeconds: 1.4
      },
      scoringConfig: {}
    }, {});

    assert.equal(result.status, 'failed');
    assert.equal(result.scorePayload, null);
    assert.equal(result.metadata.warnings.some((row) => /requires an OpenAI audio chat model/i.test(row)), true);
    assert.equal(result.metadata.warnings.some((row) => /gpt-5\.4-mini/i.test(row)), true);
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
  }
});

test('Scoring engine supports Answer Short Question in v1', async () => {
  assert.equal(scoringEngineService.isAutoScoringSupported('speaking_read_aloud'), true);
  assert.equal(scoringEngineService.isAutoScoringSupported('speaking_answer_short_question'), true);
  assert.equal(scoringEngineService.isAutoScoringSupported('speaking_describe_image'), true);
});
