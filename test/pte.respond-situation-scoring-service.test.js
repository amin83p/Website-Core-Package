const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const respondSituationScoringService = require('../packages/pte/MVC/services/pte/pteRespondSituationScoringService');
const scoringEngineService = require('../packages/pte/MVC/services/pte/pteScoringEngineService');
const pteAiProviderDataService = require('../packages/pte/MVC/services/pte/pteAiProviderDataService');
const pteAiProviderService = require('../packages/pte/MVC/services/pte/ai/aiProviderService');

const {
  calculateRespondSituationScore,
  parseAiRespondSituationAnalysis,
  parseAiRespondSituationTranscriptRecovery,
  resolveSituationContext,
  isOpenAiAudioChatModel,
  scoreRespondSituationAttemptItem
} = respondSituationScoringService;

const RESPOND_MICRO_RESPONSES = Object.freeze([
  { id: 'appropriacy_situation', choice: 'yes', evidence: 'The response addresses the dinner invitation situation.', confidence: 0.88 },
  { id: 'appropriacy_function', choice: 'yes', evidence: 'It declines the invitation and gives a reason.', confidence: 0.88 },
  { id: 'appropriacy_register', choice: 'yes', evidence: 'The informal tone fits a friend.', confidence: 0.88 },
  { id: 'appropriacy_politeness', choice: 'yes', evidence: 'It thanks the friend and stays polite.', confidence: 0.88 },
  { id: 'appropriacy_key_points', choice: 'yes', evidence: 'Decline, reason, and thanks are covered.', confidence: 0.88 },
  { id: 'pronunciation_quality', choice: 'good', evidence: 'Mostly intelligible.', confidence: 0.88 },
  { id: 'fluency_quality', choice: 'good', evidence: 'Steady rhythm.', confidence: 0.88 }
]);

const RESPOND_PARTIAL_APPROPRIACY_MICRO_RESPONSES = Object.freeze([
  { id: 'appropriacy_situation', choice: 'yes', evidence: 'The response is connected to the invitation.', confidence: 0.82 },
  { id: 'appropriacy_function', choice: 'yes', evidence: 'It starts to decline the invitation.', confidence: 0.82 },
  { id: 'appropriacy_register', choice: 'partial', evidence: 'Tone is acceptable but unfinished.', confidence: 0.82 },
  { id: 'appropriacy_politeness', choice: 'partial', evidence: 'Some politeness is implied but not complete.', confidence: 0.82 },
  { id: 'appropriacy_key_points', choice: 'partial', evidence: 'Reason is incomplete before recovery.', confidence: 0.82 },
  { id: 'pronunciation_quality', choice: 'good', evidence: 'Mostly intelligible.', confidence: 0.82 },
  { id: 'fluency_quality', choice: 'good', evidence: 'Steady enough despite truncation.', confidence: 0.82 }
]);

const BASE_AI_ANALYSIS = Object.freeze({
  transcript: 'I am sorry but I cannot come to dinner because I already have a family event. Thank you for inviting me.',
  appropriacy: { score: 3, evidence: ['Politely declines and gives a reason.'] },
  pronunciation: { score: 4, evidence: ['Mostly intelligible.'] },
  fluency: { score: 4, evidence: ['Steady rhythm.'] },
  speechMetrics: {
    speechDurationSeconds: 9.4,
    estimatedWpm: 128,
    longPauseCount: 0,
    hesitationCount: 0,
    repetitionCount: 0
  },
  microResponses: RESPOND_MICRO_RESPONSES,
  confidence: 0.88
});

const QUESTION = Object.freeze({
  questionType: 'speaking_respond_to_situation',
  payload: {
    situationText: 'Your friend invited you to dinner, but you already have a family event.',
    role: 'friend',
    audience: 'friend',
    targetFunction: 'decline invitation politely',
    targetRegister: 'informal',
    expectedKeyPoints: ['decline', 'give reason', 'thank the friend']
  }
});

const ORIGINALS = {
  resolveRuntimeProvider: pteAiProviderDataService.resolveRuntimeProvider,
  sendPrompt: pteAiProviderService.sendPrompt,
  ffmpegPath: process.env.PTE_SCORING_FFMPEG_PATH,
  geminiRetryDelay: process.env.PTE_SCORING_GEMINI_CAPACITY_RETRY_DELAY_MS
};

test.afterEach(() => {
  pteAiProviderDataService.resolveRuntimeProvider = ORIGINALS.resolveRuntimeProvider;
  pteAiProviderService.sendPrompt = ORIGINALS.sendPrompt;
  if (ORIGINALS.ffmpegPath === undefined) delete process.env.PTE_SCORING_FFMPEG_PATH;
  else process.env.PTE_SCORING_FFMPEG_PATH = ORIGINALS.ffmpegPath;
  if (ORIGINALS.geminiRetryDelay === undefined) delete process.env.PTE_SCORING_GEMINI_CAPACITY_RETRY_DELAY_MS;
  else process.env.PTE_SCORING_GEMINI_CAPACITY_RETRY_DELAY_MS = ORIGINALS.geminiRetryDelay;
});

test('Respond to a Situation raw score uses appropriacy, pronunciation, and fluency out of 13', () => {
  const result = calculateRespondSituationScore({
    aiAnalysis: BASE_AI_ANALYSIS
  });

  assert.equal(result.traitScores.appropriacy, 3);
  assert.equal(result.traitScores.pronunciation, 4);
  assert.equal(result.traitScores.fluency, 4);
  assert.equal(result.scoreFinal, 11);
  assert.equal(result.maxScore, 13);
  assert.equal(result.percentage, 84.62);
});

test('AI Respond to a Situation analysis parsing clamps trait bands and nested transcript', () => {
  const parsed = parseAiRespondSituationAnalysis('```json\n{"transcription":{"text":"Sorry, I cannot come tonight."},"appropriacy":{"score":9},"pronunciation":{"score":-1},"oralFluency":{"score":4},"speechMetrics":{"estimatedWpm":121.555,"longPauseCount":1.9},"confidence":91,"warnings":["low confidence","low confidence"]}\n```');

  assert.equal(parsed.transcript, 'Sorry, I cannot come tonight.');
  assert.equal(parsed.appropriacy.score, 3);
  assert.equal(parsed.pronunciation.score, 0);
  assert.equal(parsed.fluency.score, 4);
  assert.equal(parsed.speechMetrics.estimatedWpm, 121.56);
  assert.equal(parsed.speechMetrics.longPauseCount, 1);
  assert.equal(parsed.confidence, 0.91);
  assert.equal(parsed.rubricScoresUsable, true);
  assert.deepEqual(parsed.warnings, ['low confidence']);
});

test('AI Respond to a Situation analysis parsing accepts alternate score containers and score strings', () => {
  const parsed = parseAiRespondSituationAnalysis({
    transcript: 'I am sorry but I cannot come tonight because I have a family event.',
    evaluation: {
      content: '2/3 mostly appropriate',
      clarity: '4 out of 5',
      oral_fluency_score: 'four out of five'
    }
  });

  assert.equal(parsed.appropriacy.score, 2);
  assert.equal(parsed.pronunciation.score, 4);
  assert.equal(parsed.fluency.score, 4);
  assert.equal(parsed.rubricScoresUsable, true);
});

test('AI Respond to a Situation analysis parsing accepts snake-case nested band fields', () => {
  const parsed = parseAiRespondSituationAnalysis({
    transcript: 'I am sorry but I cannot come tonight because I have a family event.',
    rubric_assessment: {
      task_achievement: { band_score: '2 / 3', notes: 'Relevant to the situation.' },
      speech_clarity: { numeric_score: '4 out of 5' },
      oral_fluency: { point_score: 'four out of five' }
    }
  });

  assert.equal(parsed.appropriacy.score, 2);
  assert.equal(parsed.pronunciation.score, 4);
  assert.equal(parsed.fluency.score, 4);
  assert.equal(parsed.rubricScoresUsable, true);
});

test('AI Respond to a Situation analysis parsing accepts array rubric rows', () => {
  const parsed = parseAiRespondSituationAnalysis({
    transcript: 'I am sorry but I cannot come tonight because I have a family event.',
    scores: [
      { criterion: 'Appropriacy', score: '2/3', evidence: ['Relevant and polite.'] },
      { criterion: 'Pronunciation', rating: '4 out of 5', evidence: ['Mostly intelligible.'] },
      { criterion: 'Oral Fluency', points: 'four out of five', evidence: ['Mostly steady.'] }
    ]
  });

  assert.equal(parsed.appropriacy.score, 2);
  assert.equal(parsed.pronunciation.score, 4);
  assert.equal(parsed.fluency.score, 4);
  assert.equal(parsed.rubricScoresUsable, true);
});

test('AI Respond to a Situation analysis parsing accepts compact one-line rubric text', () => {
  const parsed = parseAiRespondSituationAnalysis([
    'Appropriacy (0-3): 2, Pronunciation (0-5): 4, Oral Fluency (0-5): 4',
    'Transcript: I am sorry but I cannot come tonight because I have a family event.'
  ].join('\n'));

  assert.equal(parsed.appropriacy.score, 2);
  assert.equal(parsed.pronunciation.score, 4);
  assert.equal(parsed.fluency.score, 4);
  assert.equal(parsed.rubricScoresUsable, true);
});

test('AI Respond to a Situation analysis parsing accepts rubric-only markdown tables', () => {
  const parsed = parseAiRespondSituationAnalysis([
    '| Trait | Score | Evidence |',
    '| --- | --- | --- |',
    '| Appropriacy | 2 / 3 | Declines politely and gives a reason. |',
    '| Pronunciation | 4 / 5 | Mostly clear. |',
    '| Oral Fluency | 4 / 5 | Steady rhythm. |'
  ].join('\n'));

  assert.equal(parsed.transcript, '');
  assert.equal(parsed.appropriacy.score, 2);
  assert.equal(parsed.pronunciation.score, 4);
  assert.equal(parsed.fluency.score, 4);
  assert.equal(parsed.rubricScoresUsable, true);
});

test('AI Respond to a Situation analysis parsing recovers labelled plain text scoring fields', () => {
  const parsed = parseAiRespondSituationAnalysis([
    'Transcript: I am sorry but I cannot come to dinner because I have a family event.',
    'Appropriacy: 3 - polite and relevant',
    'Pronunciation: 4 - mostly clear',
    'Fluency: 4 - steady pace',
    'Confidence: 0.82'
  ].join('\n'));

  assert.equal(parsed.transcript, 'I am sorry but I cannot come to dinner because I have a family event.');
  assert.equal(parsed.appropriacy.score, 3);
  assert.equal(parsed.pronunciation.score, 4);
  assert.equal(parsed.fluency.score, 4);
  assert.equal(parsed.confidence, 0.82);
  assert.equal(parsed.rubricScoresUsable, true);
  assert.equal(parsed.warnings.some((row) => row.includes('plain text instead of JSON')), true);
});

test('AI Respond to a Situation transcript recovery extracts malformed JSON transcript fields', () => {
  const recovered = parseAiRespondSituationTranscriptRecovery('```json\n{ "transcript": "I am sorry but I cannot come to dinner because I have a family event.\n```');

  assert.equal(recovered.transcript, 'I am sorry but I cannot come to dinner because I have a family event.');
  assert.equal(recovered.confidence, 0.5);
  assert.equal(recovered.warnings.some((row) => row.includes('transcript field was recovered')), true);
});

test('Respond to a Situation resolves prompt context from question payload', () => {
  const context = resolveSituationContext(QUESTION, {});

  assert.equal(context.situationText.includes('friend invited you'), true);
  assert.equal(context.targetFunction, 'decline invitation politely');
  assert.equal(context.targetRegister, 'informal');
  assert.equal(context.expectedKeyPoints.length, 3);
});

test('OpenAI audio chat model compatibility rejects plain text/image models', () => {
  assert.equal(isOpenAiAudioChatModel('gpt-audio'), true);
  assert.equal(isOpenAiAudioChatModel('gpt-audio-mini'), true);
  assert.equal(isOpenAiAudioChatModel('gpt-4o-audio-preview'), true);
  assert.equal(isOpenAiAudioChatModel('gpt-4o-mini-audio-preview'), true);
  assert.equal(isOpenAiAudioChatModel('gpt-4o'), false);
  assert.equal(isOpenAiAudioChatModel('gpt-4o-transcribe'), false);
  assert.equal(isOpenAiAudioChatModel('gpt-realtime'), false);
});

test('Respond to a Situation scorer refuses missing situation evidence', async () => {
  const result = await scoreRespondSituationAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'speaking_respond_to_situation',
      artifactIds: ['audio-1'],
      metadata: {}
    },
    question: {
      questionType: 'speaking_respond_to_situation',
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
      audioDurationSeconds: 9.4
    },
    scoringConfig: {}
  }, {
    aiAnalysis: BASE_AI_ANALYSIS
  });

  assert.equal(result.status, 'needs_evidence');
  assert.equal(result.scorePayload, null);
  assert.equal(result.metadata.status, 'needs_evidence');
  assert.equal(result.metadata.warnings.some((row) => row.includes('situation text')), true);
});

test('Respond to a Situation scorer refuses typed transcript notes without uploaded audio', async () => {
  const result = await scoreRespondSituationAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'speaking_respond_to_situation',
      metadata: {
        responsePayload: {
          transcript: BASE_AI_ANALYSIS.transcript
        }
      }
    },
    question: QUESTION,
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

test('Respond to a Situation scorer returns score payload and feedback draft with audio evidence', async () => {
  const result = await scoreRespondSituationAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'speaking_respond_to_situation',
      artifactIds: ['audio-1'],
      metadata: {}
    },
    question: QUESTION,
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
      audioDurationSeconds: 9.4
    },
    scoringConfig: {
      idealWpmMin: 85,
      idealWpmMax: 155
    }
  }, {
    aiAnalysis: BASE_AI_ANALYSIS,
    provider: { providerId: 'test-provider', modelUsed: 'test-model' }
  });

  assert.equal(result.status, 'scored');
  assert.equal(result.scorePayload.scoreFinal, 11);
  assert.equal(result.scorePayload.maxScore, 13);
  assert.deepEqual(result.scorePayload.traitScores, {
    appropriacy: 3,
    pronunciation: 4,
    fluency: 4
  });
  assert.equal(result.metadata.status, 'scored');
  assert.equal(result.metadata.scorerVersion, 'pte-respond-to-situation-v1');
  assert.equal(result.metadata.provider.providerId, 'test-provider');
  assert.equal(Boolean(result.metadata.feedbackDraft), true);
});

test('Respond to a Situation scorer refuses incomplete recovered transcripts instead of recording zero', async () => {
  const result = await scoreRespondSituationAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'speaking_respond_to_situation',
      artifactIds: ['audio-1'],
      metadata: {}
    },
    question: QUESTION,
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
      audioDurationSeconds: 36
    },
    scoringConfig: {}
  }, {
    aiAnalysis: {
      transcript: "Hey, how are you today? Unfortunately, I am sick today and I'm",
      appropriacy: { score: 0 },
      pronunciation: { score: 0 },
      fluency: { score: 0 },
      confidence: 0.4
    },
    provider: { providerId: 'test-provider', modelUsed: 'test-model' }
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.scorePayload, null);
  assert.equal(result.metadata.status, 'failed');
  assert.equal(result.metadata.transcriptQuality.appearsIncomplete, true);
  assert.equal(result.metadata.warnings.some((row) => row.includes('incomplete or truncated')), true);
});

test('Respond to a Situation scorer treats refusal fragments as incomplete transcripts', async () => {
  const result = await scoreRespondSituationAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'speaking_respond_to_situation',
      artifactIds: ['audio-1'],
      metadata: {}
    },
    question: QUESTION,
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
      audioDurationSeconds: 36
    },
    scoringConfig: {}
  }, {
    aiAnalysis: {
      transcript: 'Hello, thank you for inviting me, but I cannot',
      speechMetrics: { estimatedWpm: 118 },
      confidence: 0.5
    },
    provider: { providerId: 'test-provider', modelUsed: 'test-model' }
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.scorePayload, null);
  assert.equal(result.metadata.transcriptQuality.appearsIncomplete, true);
  assert.equal(result.metadata.warnings.some((row) => row.includes('incomplete or truncated')), true);
});

test('Respond to a Situation scorer can score longer responses that end with an awkward refusal fragment', async () => {
  const result = await scoreRespondSituationAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'speaking_respond_to_situation',
      artifactIds: ['audio-1'],
      metadata: {}
    },
    question: QUESTION,
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
      audioDurationSeconds: 28
    },
    scoringConfig: {}
  }, {
    aiAnalysis: {
      transcript: "Hello, how are you today? I'm sorry to let you know that I'm sick today and I need to go home and rest to recover. Thank you for inviting me, but I cannot",
      speechMetrics: { estimatedWpm: 118, longPauseCount: 1, hesitationCount: 1, repetitionCount: 0 },
      confidence: 0.64
    },
    provider: { providerId: 'test-provider', modelUsed: 'test-model' }
  });

  assert.equal(result.status, 'scored');
  assert.equal(result.scorePayload.scoreFinal > 0, true);
  assert.equal(result.metadata.transcriptQuality.appearsIncomplete, false);
  assert.equal(result.metadata.microResponses.length, 7);
  assert.equal(result.metadata.technicalWarnings.some((row) => row.includes('Generated Respond to a Situation micro-rubric responses deterministically')), true);
});

test('Respond to a Situation scorer refuses longer transcripts that end on hopeful continuation phrases', async () => {
  const result = await scoreRespondSituationAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'speaking_respond_to_situation',
      artifactIds: ['audio-1'],
      metadata: {}
    },
    question: QUESTION,
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
      audioDurationSeconds: 28
    },
    scoringConfig: {}
  }, {
    aiAnalysis: {
      transcript: "Hello, how are you today? I'm sorry to let you know that I'm sick a bit today and I'm not in a good mood and I need to go home and rest to fully recover. Uh, and I cannot make the invitation for the movie tonight. I'm really sorry to reject your invitation. And hopefully",
      speechMetrics: { estimatedWpm: 118, longPauseCount: 1, hesitationCount: 1, repetitionCount: 0 },
      confidence: 0.64
    },
    provider: { providerId: 'test-provider', modelUsed: 'test-model' }
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.scorePayload, null);
  assert.equal(result.metadata.transcriptQuality.appearsIncomplete, true);
  assert.equal(result.metadata.warnings.some((row) => row.includes('incomplete or truncated')), true);
});

test('OpenAI Respond to a Situation scoring prepares browser WebM audio as WAV before provider request', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-respond-openai-${Date.now()}.webm`);
  const fakeFfmpegPath = path.join(os.tmpdir(), `pte-fake-ffmpeg-respond-${Date.now()}.js`);
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
  let runtimeProviderOptions = null;

  pteAiProviderDataService.resolveRuntimeProvider = async (_requestingUser, _accessContext, options) => {
    runtimeProviderOptions = options;
    return {
      providerId: 'openai',
      modelId: 'gpt-audio',
      credentials: {},
      providerSelectionSource: 'scoring_setting',
      scoringSettingId: 'SETTING_RESPOND',
      providerRecord: {
        id: 'PROVIDER-OPENAI',
        name: 'OpenAI'
      }
    };
  };
  pteAiProviderService.sendPrompt = async (payload) => {
    calls.push(payload);
    return {
      provider: 'openai',
      modelUsed: 'gpt-audio',
      text: JSON.stringify({ transcript: 'I am sorry but I cannot come to dinner because I have a family event.', microResponses: RESPOND_MICRO_RESPONSES, appropriacy: { score: 1 }, pronunciation: { score: 1 }, fluency: { score: 1 }, speechMetrics: { estimatedWpm: 126 }, confidence: 0.88, warnings: [] }),
      usage: { promptTokenCount: 30, candidatesTokenCount: 10, totalTokenCount: 40 }
    };
  };

  try {
    const result = await scoreRespondSituationAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_respond_to_situation',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: QUESTION,
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
        audioDurationSeconds: 9.4
      },
      scoringConfig: {}
    }, {});

    assert.equal(result.status, 'scored');
    assert.equal(runtimeProviderOptions?.purpose, 'pte_scoring');
    assert.equal(runtimeProviderOptions?.questionType, 'speaking_respond_to_situation');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].responseSchema, undefined);
    assert.equal(calls[0].responseMimeType, undefined);
    const userMessage = calls[0].messages.find((row) => row.role === 'user');
    const audioPart = userMessage.content.find((part) => part.inlineData);
    assert.equal(audioPart.inlineData.mimeType, 'audio/wav');
    assert.equal(result.metadata.provider.providerId, 'openai');
    assert.equal(result.metadata.provider.providerSelectionSource, 'scoring_setting');
    assert.equal(result.metadata.provider.scoringSettingId, 'SETTING_RESPOND');
    assert.equal(result.metadata.provider.audioPreparation.converted, true);
    assert.equal(result.metadata.provider.audioPreparation.sourceMimeType, 'audio/webm');
    assert.equal(result.metadata.provider.audioPreparation.preparedMimeType, 'audio/wav');
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
    await fs.unlink(fakeFfmpegPath).catch(() => {});
  }
});

test('OpenAI Respond to a Situation scoring retries JSON-only when first JSON output is malformed', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-respond-openai-retry-${Date.now()}.wav`);
  await fs.writeFile(tmpAudioPath, Buffer.from('RIFF fake wav data'));
  const calls = [];

  pteAiProviderDataService.resolveRuntimeProvider = async () => ({
    providerId: 'openai',
    modelId: 'gpt-audio',
    credentials: {},
    providerRecord: {
      id: 'PROVIDER-OPENAI',
      name: 'OpenAI'
    }
  });
  pteAiProviderService.sendPrompt = async (payload) => {
    calls.push(payload);
    if (calls.length === 1) {
      return {
        provider: 'openai',
        modelUsed: 'gpt-audio',
        text: 'I heard the response and it sounds appropriate.',
        usage: { promptTokenCount: 20, candidatesTokenCount: 5, totalTokenCount: 25 }
      };
    }
    return {
      provider: 'openai',
      modelUsed: 'gpt-audio',
      text: JSON.stringify({ transcript: 'I am sorry but I cannot come to dinner because I have a family event.', microResponses: RESPOND_MICRO_RESPONSES, appropriacy: { score: 1 }, pronunciation: { score: 1 }, fluency: { score: 1 }, speechMetrics: { estimatedWpm: 126 }, confidence: 0.88, warnings: [] }),
      usage: { promptTokenCount: 25, candidatesTokenCount: 10, totalTokenCount: 35 }
    };
  };

  try {
    const result = await scoreRespondSituationAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_respond_to_situation',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: QUESTION,
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
        audioDurationSeconds: 9.4
      },
      scoringConfig: {}
    }, {});

    assert.equal(result.status, 'scored');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].responseSchema, undefined);
    assert.equal(calls[0].responseMimeType, undefined);
    assert.equal(calls[1].responseSchema, undefined);
    assert.equal(calls[1].responseMimeType, undefined);
    assert.equal(result.metadata.provider.modelUsed, 'gpt-audio');
    assert.equal(result.metadata.provider.tokenUsage.totalTokenCount, 60);
    assert.equal(result.metadata.technicalWarnings.some((row) => row.includes('retried with a JSON-only request')), true);
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
  }
});

test('OpenAI Respond to a Situation scoring recovers transcript when scoring JSON has traits but no transcript', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-respond-openai-transcript-recovery-${Date.now()}.wav`);
  await fs.writeFile(tmpAudioPath, Buffer.from('RIFF fake wav data'));
  const calls = [];

  pteAiProviderDataService.resolveRuntimeProvider = async () => ({
    providerId: 'openai',
    modelId: 'gpt-audio',
    credentials: {},
    providerRecord: {
      id: 'PROVIDER-OPENAI',
      name: 'OpenAI'
    }
  });
  pteAiProviderService.sendPrompt = async (payload) => {
    calls.push(payload);
    if (calls.length === 1) {
      return {
        provider: 'openai',
        modelUsed: 'gpt-audio',
        text: JSON.stringify({ microResponses: RESPOND_MICRO_RESPONSES, appropriacy: { score: 1 }, pronunciation: { score: 1 }, fluency: { score: 1 }, speechMetrics: { estimatedWpm: 126 }, confidence: 0.88, warnings: [] }),
        usage: { promptTokenCount: 20, candidatesTokenCount: 5, totalTokenCount: 25 }
      };
    }
    if (calls.length === 2) {
      return {
        provider: 'openai',
        modelUsed: 'gpt-audio',
        text: JSON.stringify({ microResponses: RESPOND_MICRO_RESPONSES, appropriacy: { score: 1 }, pronunciation: { score: 1 }, fluency: { score: 1 }, speechMetrics: { estimatedWpm: 126 }, confidence: 0.88, warnings: [] }),
        usage: { promptTokenCount: 25, candidatesTokenCount: 10, totalTokenCount: 35 }
      };
    }
    return {
      provider: 'openai',
      modelUsed: 'gpt-audio',
      text: 'I am sorry but I cannot come to dinner because I have a family event.',
      usage: { promptTokenCount: 12, candidatesTokenCount: 8, totalTokenCount: 20 }
    };
  };

  try {
    const result = await scoreRespondSituationAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_respond_to_situation',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: QUESTION,
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
        audioDurationSeconds: 9.4
      },
      scoringConfig: {}
    }, {});

    assert.equal(result.status, 'scored');
    assert.equal(calls.length, 3);
    assert.equal(result.metadata.transcript, 'I am sorry but I cannot come to dinner because I have a family event.');
    assert.equal(result.metadata.provider.tokenUsage.totalTokenCount, 80);
    assert.equal(result.metadata.provider.transcriptRecovery.tokenUsage.totalTokenCount, 20);
    assert.equal(result.metadata.technicalWarnings.some((row) => row.includes('Recovered transcript using an audio-only follow-up request')), true);
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
  }
});

test('OpenAI Respond to a Situation scoring requests full transcript recovery when scoring transcript is truncated', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-respond-openai-truncated-recovery-${Date.now()}.wav`);
  await fs.writeFile(tmpAudioPath, Buffer.from('RIFF fake wav data'));
  const calls = [];
  const truncatedTranscript = "Hey, how are you today? Unfortunately, I am sick today and I'm";
  const recoveredTranscript = 'Hey, how are you today? Unfortunately, I am sick today and I am not able to come because I have a family event. Thank you for inviting me.';

  pteAiProviderDataService.resolveRuntimeProvider = async () => ({
    providerId: 'openai',
    modelId: 'gpt-audio',
    credentials: {},
    providerRecord: {
      id: 'PROVIDER-OPENAI',
      name: 'OpenAI'
    }
  });
  pteAiProviderService.sendPrompt = async (payload) => {
    calls.push(payload);
    if (calls.length <= 2) {
      return {
        provider: 'openai',
        modelUsed: 'gpt-audio',
        text: JSON.stringify({
          transcript: truncatedTranscript,
          microResponses: RESPOND_PARTIAL_APPROPRIACY_MICRO_RESPONSES,
          appropriacy: { score: 2 },
          pronunciation: { score: 4 },
          fluency: { score: 4 },
          speechMetrics: { estimatedWpm: 126 },
          confidence: 0.82,
          warnings: []
        }),
        usage: calls.length === 1
          ? { promptTokenCount: 20, candidatesTokenCount: 5, totalTokenCount: 25 }
          : { promptTokenCount: 25, candidatesTokenCount: 10, totalTokenCount: 35 }
      };
    }
    return {
      provider: 'openai',
      modelUsed: 'gpt-audio',
      text: JSON.stringify({
        transcript: recoveredTranscript,
        speechMetrics: { estimatedWpm: 118 },
        confidence: 0.9,
        warnings: []
      }),
      usage: { promptTokenCount: 12, candidatesTokenCount: 8, totalTokenCount: 20 }
    };
  };

  try {
    const result = await scoreRespondSituationAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_respond_to_situation',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: QUESTION,
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
        audioDurationSeconds: 18.2
      },
      scoringConfig: {}
    }, {});

    assert.equal(result.status, 'scored');
    assert.equal(result.scorePayload.scoreFinal, 10);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].requestLabel, 'pte-respond-situation-transcript-recovery-full-v1');
    assert.equal(calls[2].responseSchema, undefined);
    assert.match(calls[2].messages[1].content[0].text, /complete verbatim transcript/);
    assert.equal(result.metadata.transcript, recoveredTranscript);
    assert.equal(result.metadata.transcriptQuality.appearsIncomplete, false);
    assert.equal(result.metadata.provider.tokenUsage.totalTokenCount, 80);
    assert.equal(result.metadata.provider.transcriptRecovery.tokenUsage.totalTokenCount, 20);
    assert.equal(result.metadata.technicalWarnings.some((row) => row.includes('Recovered transcript using an audio-only follow-up request')), true);
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
  }
});

test('OpenAI Respond to a Situation scoring recovers rubric scores when transcript is usable but traits are missing', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-respond-openai-rubric-recovery-${Date.now()}.wav`);
  await fs.writeFile(tmpAudioPath, Buffer.from('RIFF fake wav data'));
  const calls = [];
  const transcript = 'I am sorry but I cannot come to dinner because I have a family event. Thank you for inviting me.';

  pteAiProviderDataService.resolveRuntimeProvider = async () => ({
    providerId: 'openai',
    modelId: 'gpt-audio',
    credentials: {},
    providerRecord: {
      id: 'PROVIDER-OPENAI',
      name: 'OpenAI'
    }
  });
  pteAiProviderService.sendPrompt = async (payload) => {
    calls.push(payload);
    if (calls.length <= 2) {
      return {
        provider: 'openai',
        modelUsed: 'gpt-audio',
        text: JSON.stringify({
          transcript,
          speechMetrics: { estimatedWpm: 126 },
          confidence: 0.82,
          warnings: []
        }),
        usage: calls.length === 1
          ? { promptTokenCount: 20, candidatesTokenCount: 5, totalTokenCount: 25 }
          : { promptTokenCount: 25, candidatesTokenCount: 10, totalTokenCount: 35 }
      };
    }
    return {
      provider: 'openai',
      modelUsed: 'gpt-audio',
      text: JSON.stringify({
        transcript,
        microResponses: [
          { id: 'appropriacy_situation', choice: 'yes', evidence: 'Relevant to the situation.', confidence: 0.9 },
          { id: 'appropriacy_function', choice: 'yes', evidence: 'Declines and gives a reason.', confidence: 0.9 },
          { id: 'appropriacy_register', choice: 'partial', evidence: 'Mostly appropriate informal tone.', confidence: 0.9 },
          { id: 'appropriacy_politeness', choice: 'partial', evidence: 'Polite enough but brief.', confidence: 0.9 },
          { id: 'appropriacy_key_points', choice: 'partial', evidence: 'Some key points covered.', confidence: 0.9 },
          { id: 'pronunciation_quality', choice: 'good', evidence: 'Mostly clear.', confidence: 0.9 },
          { id: 'fluency_quality', choice: 'good', evidence: 'Steady rhythm.', confidence: 0.9 }
        ],
        confidence: 0.9,
        speechMetrics: { estimatedWpm: 126 },
        warnings: []
      }),
      usage: { promptTokenCount: 12, candidatesTokenCount: 8, totalTokenCount: 20 }
    };
  };

  try {
    const result = await scoreRespondSituationAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_respond_to_situation',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: QUESTION,
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
        audioDurationSeconds: 12.6
      },
      scoringConfig: {}
    }, {});

    assert.equal(result.status, 'scored');
    assert.equal(result.scorePayload.scoreFinal, 10);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].requestLabel, 'pte-respond-situation-rubric-recovery-v1');
    assert.match(calls[2].messages[1].content[0].text, /Candidate transcript:/);
    assert.equal(result.metadata.transcript, transcript);
    assert.equal(result.metadata.rubricScoresUsable, true);
    assert.equal(result.metadata.provider.tokenUsage.totalTokenCount, 80);
    assert.equal(result.metadata.provider.rubricRecovery.tokenUsage.totalTokenCount, 20);
    assert.equal(result.metadata.technicalWarnings.some((row) => row.includes('Recovered Respond to a Situation micro-rubric responses')), true);
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
  }
});

test('OpenAI Respond to a Situation scoring uses deterministic fallback when recovery omits rubric micro responses', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-respond-openai-no-rubric-${Date.now()}.wav`);
  await fs.writeFile(tmpAudioPath, Buffer.from('RIFF fake wav data'));
  const calls = [];

  pteAiProviderDataService.resolveRuntimeProvider = async () => ({
    providerId: 'openai',
    modelId: 'gpt-audio',
    credentials: {},
    providerRecord: {
      id: 'PROVIDER-OPENAI',
      name: 'OpenAI'
    }
  });
  pteAiProviderService.sendPrompt = async (payload) => {
    calls.push(payload);
    if (calls.length === 1) {
      return {
        provider: 'openai',
        modelUsed: 'gpt-audio',
        text: 'I heard the response and it sounds appropriate.',
        usage: { promptTokenCount: 20, candidatesTokenCount: 5, totalTokenCount: 25 }
      };
    }
    if (calls.length === 2) {
      return {
        provider: 'openai',
        modelUsed: 'gpt-audio',
        text: 'Still unable to return structured rubric scores.',
        usage: { promptTokenCount: 25, candidatesTokenCount: 10, totalTokenCount: 35 }
      };
    }
    return {
      provider: 'openai',
      modelUsed: 'gpt-audio',
      text: 'I am sorry but I cannot come to dinner because I have a family event.',
      usage: { promptTokenCount: 12, candidatesTokenCount: 8, totalTokenCount: 20 }
    };
  };

  try {
    const result = await scoreRespondSituationAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_respond_to_situation',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: QUESTION,
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
        audioDurationSeconds: 9.4
      },
      scoringConfig: {}
    }, {});

    assert.equal(result.status, 'scored');
    assert.equal(result.scorePayload.scoreFinal, 9);
    assert.equal(calls.length, 4);
    assert.equal(result.metadata.transcript, 'I am sorry but I cannot come to dinner because I have a family event.');
    assert.equal(result.metadata.rubricScoresUsable, true);
    assert.equal(result.metadata.microResponses.length, 7);
    assert.equal(result.metadata.provider.rubricRecovery.tokenUsage.totalTokenCount, 20);
    assert.equal(result.metadata.warnings.length, 0);
    assert.equal(result.metadata.technicalWarnings.some((row) => row.includes('Generated Respond to a Situation micro-rubric responses deterministically')), true);
    assert.equal(result.metadata.technicalWarnings.some((row) => row.includes('deterministic transcript fallback')), true);
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
  }
});

test('OpenAI Respond to a Situation scoring retries JSON-only when the first JSON request fails', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-respond-openai-structured-fail-${Date.now()}.wav`);
  await fs.writeFile(tmpAudioPath, Buffer.from('RIFF fake wav data'));
  const calls = [];

  pteAiProviderDataService.resolveRuntimeProvider = async () => ({
    providerId: 'openai',
    modelId: 'gpt-audio',
    credentials: {},
    providerRecord: {
      id: 'PROVIDER-OPENAI',
      name: 'OpenAI'
    }
  });
  pteAiProviderService.sendPrompt = async (payload) => {
    calls.push(payload);
    if (calls.length === 1) {
      throw new Error('temporary OpenAI audio JSON failure');
    }
    return {
      provider: 'openai',
      modelUsed: 'gpt-audio',
      text: JSON.stringify({ transcript: 'I am sorry but I cannot come to dinner because I have a family event.', microResponses: RESPOND_MICRO_RESPONSES, appropriacy: { score: 1 }, pronunciation: { score: 1 }, fluency: { score: 1 }, speechMetrics: { estimatedWpm: 126 }, confidence: 0.88, warnings: [] }),
      usage: { promptTokenCount: 25, candidatesTokenCount: 10, totalTokenCount: 35 }
    };
  };

  try {
    const result = await scoreRespondSituationAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_respond_to_situation',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: QUESTION,
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
        audioDurationSeconds: 9.4
      },
      scoringConfig: {}
    }, {});

    assert.equal(result.status, 'scored');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].responseSchema, undefined);
    assert.equal(calls[0].responseMimeType, undefined);
    assert.equal(calls[1].responseSchema, undefined);
    assert.equal(calls[1].responseMimeType, undefined);
    assert.equal(result.metadata.technicalWarnings.some((row) => row.includes('JSON-only Respond to a Situation request failed first')), true);
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
  }
});

test('OpenAI Respond to a Situation scoring rejects non-audio OpenAI chat models clearly', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-respond-openai-model-${Date.now()}.wav`);
  await fs.writeFile(tmpAudioPath, Buffer.from('RIFF fake wav data'));
  let sendPromptCalled = false;

  pteAiProviderDataService.resolveRuntimeProvider = async () => ({
    providerId: 'openai',
    modelId: 'gpt-4o',
    credentials: {},
    providerRecord: {
      id: 'PROVIDER-OPENAI',
      name: 'OpenAI'
    }
  });
  pteAiProviderService.sendPrompt = async () => {
    sendPromptCalled = true;
    throw new Error('sendPrompt should not be called');
  };

  try {
    const result = await scoreRespondSituationAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_respond_to_situation',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: QUESTION,
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
        audioDurationSeconds: 9.4
      },
      scoringConfig: {}
    }, {});

    assert.equal(result.status, 'failed');
    assert.equal(sendPromptCalled, false);
    assert.equal(result.metadata.warnings.some((row) => row.includes('requires an OpenAI audio chat model')), true);
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
  }
});

test('Gemini Pro Respond to a Situation scoring retries malformed structured JSON with loose JSON request', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-respond-gemini-${Date.now()}.ogg`);
  await fs.writeFile(tmpAudioPath, Buffer.from('fake-ogg-audio'));
  const calls = [];

  pteAiProviderDataService.resolveRuntimeProvider = async () => ({
    providerId: 'google-gemini',
    modelId: 'gemini-2.5-pro',
    credentials: {},
    providerRecord: {
      id: 'PROVIDER-GEMINI',
      name: 'Gemini'
    }
  });
  pteAiProviderService.sendPrompt = async (payload) => {
    calls.push(payload);
    if (calls.length === 1) {
      return {
        provider: 'google-gemini',
        modelUsed: 'gemini-2.5-pro',
        text: 'Transcript: I am sorry but I cannot come tonight.',
        usage: { promptTokenCount: 20, candidatesTokenCount: 5, totalTokenCount: 25 }
      };
    }
    return {
      provider: 'google-gemini',
      modelUsed: 'gemini-2.5-pro',
      text: JSON.stringify({ transcript: 'I am sorry but I cannot come to dinner because I have a family event.', microResponses: RESPOND_MICRO_RESPONSES, appropriacy: { score: 1 }, pronunciation: { score: 1 }, fluency: { score: 1 }, speechMetrics: { estimatedWpm: 126 }, confidence: 0.88, warnings: [] }),
      usage: { promptTokenCount: 25, candidatesTokenCount: 10, totalTokenCount: 35 }
    };
  };

  try {
    const result = await scoreRespondSituationAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_respond_to_situation',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: QUESTION,
      artifacts: [
        {
          id: 'audio-1',
          artifactType: 'audio',
          mimeType: 'audio/ogg',
          path: tmpAudioPath
        }
      ],
      responsePayload: {
        artifactId: 'audio-1',
        audioDurationSeconds: 9.4
      },
      scoringConfig: {}
    }, {});

    assert.equal(result.status, 'scored');
    assert.equal(calls.length, 2);
    assert.equal(Boolean(calls[0].responseSchema), true);
    assert.equal(calls[1].responseSchema, undefined);
    assert.equal(result.metadata.provider.modelUsed, 'gemini-2.5-pro');
    assert.equal(result.metadata.provider.tokenUsage.totalTokenCount, 60);
    assert.equal(result.metadata.technicalWarnings.some((row) => row.includes('retried with a looser JSON-only request')), true);
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
  }
});

test('Scoring engine supports Respond to a Situation in v1', async () => {
  assert.equal(scoringEngineService.isAutoScoringSupported('speaking_respond_to_situation'), true);

  const unsupported = await scoringEngineService.scoreAttemptItem({
    item: { questionType: 'speaking_future_type' }
  });
  assert.equal(unsupported.status, 'unsupported');
});
