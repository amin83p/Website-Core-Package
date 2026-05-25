const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const repeatSentenceScoringService = require('../MVC/services/pte/pteRepeatSentenceScoringService');
const scoringEngineService = require('../MVC/services/pte/pteScoringEngineService');
const pteAiProviderDataService = require('../MVC/services/pte/pteAiProviderDataService');
const pteAiProviderService = require('../MVC/services/pte/ai/aiProviderService');

const {
  tokenizeForRepeatSentence,
  alignRepeatSentenceTokens,
  calculateRepeatSentenceContentScore,
  calculateRepeatSentenceScore,
  parseAiRepeatSentenceAnalysis,
  scoreRepeatSentenceAttemptItem
} = repeatSentenceScoringService;

const BASE_AI_ANALYSIS = Object.freeze({
  transcript: 'Many people believe public parks improve city life',
  pronunciation: { score: 4, evidence: ['Mostly intelligible.'] },
  fluency: { score: 4, evidence: ['Steady rhythm.'] },
  speechMetrics: {
    speechDurationSeconds: 4.2,
    estimatedWpm: 100,
    longPauseCount: 0,
    hesitationCount: 0,
    repetitionCount: 0
  },
  microResponses: [
    { id: 'pronunciation_quality', choice: 'good', evidence: 'Mostly intelligible.', confidence: 0.86 },
    { id: 'fluency_quality', choice: 'good', evidence: 'Steady rhythm.', confidence: 0.86 }
  ],
  confidence: 0.86
});

const ORIGINALS = {
  resolveRuntimeProvider: pteAiProviderDataService.resolveRuntimeProvider,
  sendPrompt: pteAiProviderService.sendPrompt,
  ffmpegPath: process.env.PTE_SCORING_FFMPEG_PATH
};

test.afterEach(() => {
  pteAiProviderDataService.resolveRuntimeProvider = ORIGINALS.resolveRuntimeProvider;
  pteAiProviderService.sendPrompt = ORIGINALS.sendPrompt;
  if (ORIGINALS.ffmpegPath === undefined) delete process.env.PTE_SCORING_FFMPEG_PATH;
  else process.env.PTE_SCORING_FFMPEG_PATH = ORIGINALS.ffmpegPath;
});

test('Repeat Sentence content scoring gives full credit for exact ordered recall', () => {
  const sourceTokens = tokenizeForRepeatSentence('Many people believe public parks improve city life.');
  const responseTokens = tokenizeForRepeatSentence('Many people believe public parks improve city life.');
  const alignment = alignRepeatSentenceTokens(sourceTokens, responseTokens);

  assert.equal(alignment.sourceWordCount, 8);
  assert.equal(alignment.responseWordCount, 8);
  assert.equal(alignment.matchCount, 8);
  assert.equal(alignment.matchRatio, 1);
  assert.equal(calculateRepeatSentenceContentScore(alignment), 3);
});

test('Repeat Sentence content scoring bands partial ordered recall', () => {
  const expected = tokenizeForRepeatSentence('Many people believe public parks improve city life.');

  const halfOrMore = alignRepeatSentenceTokens(
    expected,
    tokenizeForRepeatSentence('Many people believe parks improve')
  );
  assert.equal(halfOrMore.matchCount, 5);
  assert.equal(calculateRepeatSentenceContentScore(halfOrMore), 2);

  const someButLow = alignRepeatSentenceTokens(
    expected,
    tokenizeForRepeatSentence('Many parks')
  );
  assert.equal(someButLow.matchCount, 2);
  assert.equal(calculateRepeatSentenceContentScore(someButLow), 1);

  const empty = alignRepeatSentenceTokens(expected, []);
  assert.equal(empty.matchCount, 0);
  assert.equal(calculateRepeatSentenceContentScore(empty), 0);
});

test('Repeat Sentence raw score uses fixed content max plus pronunciation and fluency', () => {
  const result = calculateRepeatSentenceScore({
    expectedTranscript: 'Many people believe public parks improve city life.',
    transcript: 'Many people believe public parks improve city life.',
    aiAnalysis: BASE_AI_ANALYSIS
  });

  assert.equal(result.traitScores.content, 3);
  assert.equal(result.traitScores.pronunciation, 4);
  assert.equal(result.traitScores.fluency, 4);
  assert.equal(result.scoreFinal, 11);
  assert.equal(result.maxScore, 13);
  assert.equal(result.percentage, 84.62);
});

test('AI Repeat Sentence analysis parsing clamps bands and accepts nested transcripts', () => {
  const parsed = parseAiRepeatSentenceAnalysis('```json\n{"transcription":{"text":"Many people believe public parks improve city life."},"pronunciation":{"score":9},"oralFluency":{"score":-2},"speechMetrics":{"estimatedWpm":101.555,"longPauseCount":1.9},"confidence":91,"warnings":["low confidence","low confidence"]}\n```');

  assert.equal(parsed.transcript, 'Many people believe public parks improve city life.');
  assert.equal(parsed.pronunciation.score, 5);
  assert.equal(parsed.fluency.score, 0);
  assert.equal(parsed.speechMetrics.estimatedWpm, 101.56);
  assert.equal(parsed.speechMetrics.longPauseCount, 1);
  assert.equal(parsed.confidence, 0.91);
  assert.deepEqual(parsed.warnings, ['low confidence']);
});

test('Repeat Sentence scorer refuses missing expected transcript', async () => {
  const result = await scoreRepeatSentenceAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'speaking_repeat_sentence',
      artifactIds: ['audio-1'],
      metadata: {}
    },
    question: {
      questionType: 'speaking_repeat_sentence',
      payload: {}
    },
    artifacts: [
      {
        id: 'audio-1',
        artifactType: 'audio',
        mimeType: 'audio/webm',
        path: '/tmp/audio-1.webm'
      }
    ],
    responsePayload: {
      artifactId: 'audio-1',
      audioDurationSeconds: 4.2
    },
    scoringConfig: {}
  }, {
    aiAnalysis: BASE_AI_ANALYSIS
  });

  assert.equal(result.status, 'needs_evidence');
  assert.equal(result.scorePayload, null);
  assert.equal(result.metadata.status, 'needs_evidence');
  assert.equal(result.metadata.warnings.some((row) => row.includes('expected transcript')), true);
});

test('Repeat Sentence scorer refuses typed transcript notes without uploaded audio', async () => {
  const result = await scoreRepeatSentenceAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'speaking_repeat_sentence',
      metadata: {
        responsePayload: {
          transcript: BASE_AI_ANALYSIS.transcript
        }
      }
    },
    question: {
      questionType: 'speaking_repeat_sentence',
      payload: {
        expectedTranscript: 'Many people believe public parks improve city life.'
      }
    },
    artifacts: [],
    responsePayload: {
      transcript: BASE_AI_ANALYSIS.transcript
    },
    scoringConfig: {}
  }, {
    aiAnalysis: BASE_AI_ANALYSIS
  });

  assert.equal(result.status, 'needs_evidence');
  assert.equal(result.scorePayload, null);
  assert.equal(result.metadata.status, 'needs_evidence');
  assert.equal(result.metadata.warnings.some((row) => row.includes('uploaded audio')), true);
});

test('Repeat Sentence scorer returns score payload and feedback draft with audio evidence', async () => {
  const result = await scoreRepeatSentenceAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'speaking_repeat_sentence',
      artifactIds: ['audio-1'],
      metadata: {}
    },
    question: {
      questionType: 'speaking_repeat_sentence',
      payload: {
        expectedTranscript: 'Many people believe public parks improve city life.'
      }
    },
    artifacts: [
      {
        id: 'audio-1',
        artifactType: 'audio',
        mimeType: 'audio/webm',
        path: '/tmp/audio-1.webm'
      }
    ],
    responsePayload: {
      artifactId: 'audio-1',
      audioDurationSeconds: 4.2
    },
    scoringConfig: {
      idealWpmMin: 90,
      idealWpmMax: 170
    }
  }, {
    aiAnalysis: BASE_AI_ANALYSIS,
    provider: { providerId: 'test-provider', modelUsed: 'test-model' }
  });

  assert.equal(result.status, 'scored');
  assert.equal(result.scorePayload.scoreFinal, 11);
  assert.equal(result.scorePayload.maxScore, 13);
  assert.deepEqual(result.scorePayload.traitScores, {
    content: 3,
    pronunciation: 4,
    fluency: 4
  });
  assert.equal(result.metadata.status, 'scored');
  assert.equal(result.metadata.scorerVersion, 'pte-repeat-sentence-v1');
  assert.equal(result.metadata.provider.providerId, 'test-provider');
  assert.equal(result.metadata.alignment.matchCount, 8);
  assert.equal(Boolean(result.metadata.feedbackDraft), true);
});

test('Repeat Sentence scorer reports provider context when analysis has no transcript', async () => {
  const result = await scoreRepeatSentenceAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'speaking_repeat_sentence',
      artifactIds: ['audio-1'],
      metadata: {}
    },
    question: {
      questionType: 'speaking_repeat_sentence',
      payload: {
        expectedTranscript: 'Many people believe public parks improve city life.'
      }
    },
    artifacts: [
      {
        id: 'audio-1',
        artifactType: 'audio',
        mimeType: 'audio/webm',
        path: '/tmp/audio-1.webm'
      }
    ],
    responsePayload: {
      artifactId: 'audio-1',
      audioDurationSeconds: 4.2
    },
    scoringConfig: {}
  }, {
    aiAnalysis: {
      pronunciation: { score: 4 },
      fluency: { score: 4 },
      warnings: ['Model returned empty transcription.']
    },
    provider: { providerId: 'google-gemini', modelUsed: 'gemini-test' }
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.scorePayload, null);
  assert.equal(result.metadata.provider.providerId, 'google-gemini');
  assert.equal(result.metadata.warnings.some((row) => row.includes('google-gemini')), true);
  assert.equal(result.metadata.warnings.some((row) => row.includes('empty transcription')), true);
});

test('OpenAI Repeat Sentence scoring prepares browser WebM audio as WAV before provider request', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-repeat-sentence-openai-${Date.now()}.webm`);
  const fakeFfmpegPath = path.join(os.tmpdir(), `pte-fake-ffmpeg-repeat-${Date.now()}.js`);
  await fs.writeFile(tmpAudioPath, Buffer.from('fake-webm-audio'));
  await fs.writeFile(fakeFfmpegPath, [
    '#!/usr/bin/env node',
    "const fs = require('fs');",
    'const out = process.argv[process.argv.length - 1];',
    "fs.writeFileSync(out, Buffer.from('RIFF fake wav data'));"
  ].join('\n'));
  await fs.chmod(fakeFfmpegPath, 0o755);
  process.env.PTE_SCORING_FFMPEG_PATH = fakeFfmpegPath;
  const calls = [];

  pteAiProviderDataService.resolveRuntimeProvider = async () => ({
    providerId: 'openai',
    modelId: 'gpt-4o-audio-preview',
    credentials: {},
    providerRecord: {
      id: 'PROVIDER-OPENAI',
      name: 'OpenAI'
    }
  });
  pteAiProviderService.sendPrompt = async (payload) => {
    calls.push(payload);
    return {
      provider: 'openai',
      modelUsed: 'gpt-4o-audio-preview',
      text: '{"transcript":"Many people believe public parks improve city life.","microResponses":[{"id":"pronunciation_quality","choice":"good","evidence":"clear","confidence":0.86},{"id":"fluency_quality","choice":"good","evidence":"steady","confidence":0.86}],"pronunciation":{"score":1},"fluency":{"score":1},"speechMetrics":{"estimatedWpm":100},"confidence":0.86,"warnings":[]}',
      usage: { promptTokenCount: 30, candidatesTokenCount: 10, totalTokenCount: 40 }
    };
  };

  try {
    const result = await scoreRepeatSentenceAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_repeat_sentence',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: {
        questionType: 'speaking_repeat_sentence',
        payload: {
          expectedTranscript: 'Many people believe public parks improve city life.'
        }
      },
      artifacts: [
        {
          id: 'audio-1',
          artifactType: 'audio',
          mimeType: 'audio/webm',
          path: tmpAudioPath
        }
      ],
      responsePayload: {
        artifactId: 'audio-1',
        audioDurationSeconds: 4.2
      },
      scoringConfig: {}
    }, {});

    assert.equal(result.status, 'scored');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].responseSchema, undefined);
    assert.equal(calls[0].responseMimeType, undefined);
    const userMessage = calls[0].messages.find((row) => row.role === 'user');
    const audioPart = userMessage.content.find((part) => part.inlineData);
    assert.equal(audioPart.inlineData.mimeType, 'audio/wav');
    assert.equal(result.metadata.provider.providerId, 'openai');
    assert.equal(result.metadata.provider.audioPreparation.converted, true);
    assert.equal(result.metadata.provider.audioPreparation.sourceMimeType, 'audio/webm');
    assert.equal(result.metadata.provider.audioPreparation.preparedMimeType, 'audio/wav');
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
    await fs.unlink(fakeFfmpegPath).catch(() => {});
  }
});

test('OpenAI Repeat Sentence scoring rejects non-audio OpenAI models clearly', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-repeat-sentence-openai-model-guard-${Date.now()}.wav`);
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
    const result = await scoreRepeatSentenceAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_repeat_sentence',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: {
        questionType: 'speaking_repeat_sentence',
        payload: {
          expectedTranscript: 'Many people believe public parks improve city life.'
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
        audioDurationSeconds: 4.2
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

test('Scoring engine supports Repeat Sentence in v1', async () => {
  assert.equal(scoringEngineService.isAutoScoringSupported('speaking_repeat_sentence'), true);

  const unsupported = await scoringEngineService.scoreAttemptItem({
    item: { questionType: 'speaking_future_type' }
  });
  assert.equal(unsupported.status, 'unsupported');
});
