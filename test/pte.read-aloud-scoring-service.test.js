const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const readAloudScoringService = require('../packages/pte/MVC/services/pte/pteReadAloudScoringService');
const scoringEngineService = require('../packages/pte/MVC/services/pte/pteScoringEngineService');
const pteAiProviderDataService = require('../packages/pte/MVC/services/pte/pteAiProviderDataService');
const pteAiProviderService = require('../packages/pte/MVC/services/pte/ai/aiProviderService');

const {
  tokenizeForReadAloud,
  alignReadAloudTokens,
  calculateReadAloudScore,
  parseAiReadAloudAnalysis,
  scoreReadAloudAttemptItem
} = readAloudScoringService;

const BASE_AI_ANALYSIS = Object.freeze({
  transcript: 'The quick brown fox jumps',
  pronunciation: { score: 4, evidence: ['Mostly intelligible.'] },
  fluency: { score: 3, evidence: ['One hesitation.'] },
  speechMetrics: {
    speechDurationSeconds: 3.8,
    estimatedWpm: 78,
    longPauseCount: 1,
    hesitationCount: 1
  },
  microResponses: [
    { id: 'pronunciation_quality', choice: 'good', evidence: 'Mostly intelligible.', confidence: 0.8 },
    { id: 'fluency_quality', choice: 'developing', evidence: 'One hesitation.', confidence: 0.8 }
  ],
  confidence: 0.8
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

test('Read Aloud token alignment scores exact match without content errors', () => {
  const sourceTokens = tokenizeForReadAloud('The quick brown fox jumps.');
  const responseTokens = tokenizeForReadAloud('The quick brown fox jumps.');
  const alignment = alignReadAloudTokens(sourceTokens, responseTokens);

  assert.equal(alignment.sourceWordCount, 5);
  assert.equal(alignment.responseWordCount, 5);
  assert.equal(alignment.errorCount, 0);
  assert.equal(alignment.matchCount, 5);
  assert.deepEqual(alignment.samples, []);
});

test('Read Aloud token alignment counts omissions', () => {
  const alignment = alignReadAloudTokens(
    tokenizeForReadAloud('The quick brown fox jumps.'),
    tokenizeForReadAloud('The quick fox jumps.')
  );

  assert.equal(alignment.errorCount, 1);
  assert.equal(alignment.omissionCount, 1);
  assert.equal(alignment.replacementCount, 0);
  assert.equal(alignment.insertionCount, 0);
  assert.equal(alignment.samples[0].type, 'omission');
  assert.equal(alignment.samples[0].sourceWord, 'brown');
});

test('Read Aloud token alignment counts replacement and insertion', () => {
  const alignment = alignReadAloudTokens(
    tokenizeForReadAloud('The quick brown fox jumps.'),
    tokenizeForReadAloud('The slow brown small fox jumps.')
  );

  assert.equal(alignment.errorCount, 2);
  assert.equal(alignment.replacementCount, 1);
  assert.equal(alignment.insertionCount, 1);
});

test('Read Aloud raw score uses dynamic source word max', () => {
  const result = calculateReadAloudScore({
    sourceText: 'The quick brown fox jumps.',
    transcript: 'The quick brown fox jumps.',
    aiAnalysis: BASE_AI_ANALYSIS
  });

  assert.equal(result.traitScores.content, 5);
  assert.equal(result.traitScores.pronunciation, 4);
  assert.equal(result.traitScores.fluency, 3);
  assert.equal(result.scoreFinal, 12);
  assert.equal(result.maxScore, 15);
  assert.equal(result.percentage, 80);
});

test('Read Aloud raw score floors empty response content at zero', () => {
  const result = calculateReadAloudScore({
    sourceText: 'The quick brown fox jumps.',
    transcript: '',
    aiAnalysis: {
      pronunciation: { score: 0 },
      fluency: { score: 0 }
    }
  });

  assert.equal(result.evidence.alignment.errorCount, 5);
  assert.equal(result.traitScores.content, 0);
  assert.equal(result.scoreFinal, 0);
  assert.equal(result.maxScore, 15);
});

test('AI Read Aloud analysis parsing clamps trait bands and normalizes warnings', () => {
  const parsed = parseAiReadAloudAnalysis('```json\n{"transcript":"hello world","pronunciation":{"score":9},"fluency":{"score":-3},"speechMetrics":{"estimatedWpm":145.555,"longPauseCount":2.2},"confidence":82,"warnings":["low confidence","low confidence"]}\n```');

  assert.equal(parsed.transcript, 'hello world');
  assert.equal(parsed.pronunciation.score, 5);
  assert.equal(parsed.fluency.score, 0);
  assert.equal(parsed.speechMetrics.estimatedWpm, 145.56);
  assert.equal(parsed.speechMetrics.longPauseCount, 2);
  assert.equal(parsed.confidence, 0.82);
  assert.deepEqual(parsed.warnings, ['low confidence']);
});

test('AI Read Aloud analysis parsing accepts nested transcript variants', () => {
  const nested = parseAiReadAloudAnalysis({
    transcription: { text: 'The quick brown fox jumps.' },
    pronunciationBand: 4,
    fluencyBand: 4,
    speechMetrics: { wpm: 118 },
    confidence: 0.7
  });
  assert.equal(nested.transcript, 'The quick brown fox jumps.');
  assert.equal(nested.pronunciation.score, 4);
  assert.equal(nested.fluency.score, 4);

  const segmented = parseAiReadAloudAnalysis({
    segments: [
      { text: 'The quick' },
      { transcript: 'brown fox jumps.' }
    ],
    pronunciation: { score: 3 },
    fluency: { score: 3 }
  });
  assert.equal(segmented.transcript, 'The quick brown fox jumps.');
});

test('Read Aloud scorer refuses typed transcript notes without uploaded audio', async () => {
  const result = await scoreReadAloudAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'speaking_read_aloud',
      metadata: {
        responsePayload: {
          transcript: 'The quick brown fox jumps.'
        }
      }
    },
    question: {
      questionType: 'speaking_read_aloud',
      payload: {
        sourceText: 'The quick brown fox jumps.'
      }
    },
    artifacts: [],
    responsePayload: {
      transcript: 'The quick brown fox jumps.'
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

test('Read Aloud scorer returns score payload and feedback draft with audio evidence', async () => {
  const result = await scoreReadAloudAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'speaking_read_aloud',
      artifactIds: ['audio-1'],
      metadata: {}
    },
    question: {
      questionType: 'speaking_read_aloud',
      payload: {
        sourceText: 'The quick brown fox jumps.'
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
      audioDurationSeconds: 3.8
    },
    scoringConfig: {
      idealWpmMin: 90,
      idealWpmMax: 160
    }
  }, {
    aiAnalysis: BASE_AI_ANALYSIS,
    provider: { providerId: 'test-provider', modelUsed: 'test-model' }
  });

  assert.equal(result.status, 'scored');
  assert.equal(result.scorePayload.scoreFinal, 12);
  assert.equal(result.scorePayload.maxScore, 15);
  assert.deepEqual(result.scorePayload.traitScores, {
    content: 5,
    pronunciation: 4,
    fluency: 3
  });
  assert.equal(result.metadata.status, 'scored');
  assert.equal(result.metadata.provider.providerId, 'test-provider');
  assert.equal(Boolean(result.metadata.feedbackDraft), true);
  assert.equal(Array.isArray(result.metadata.feedbackDraft.improvements), true);
});

test('Read Aloud v2 scoring ignores legacy direct numeric bands when micro answers match', async () => {
  const baseRequest = {
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'speaking_read_aloud',
      artifactIds: ['audio-1'],
      metadata: {}
    },
    question: {
      questionType: 'speaking_read_aloud',
      payload: {
        sourceText: 'The quick brown fox jumps.'
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
      audioDurationSeconds: 3.8
    },
    scoringConfig: {}
  };
  const lowLegacy = {
    ...BASE_AI_ANALYSIS,
    pronunciation: { score: 0 },
    fluency: { score: 0 }
  };
  const highLegacy = {
    ...BASE_AI_ANALYSIS,
    pronunciation: { score: 5 },
    fluency: { score: 5 }
  };

  const first = await scoreReadAloudAttemptItem(baseRequest, { aiAnalysis: lowLegacy });
  const second = await scoreReadAloudAttemptItem(baseRequest, { aiAnalysis: highLegacy });

  assert.equal(first.status, 'scored');
  assert.equal(second.status, 'scored');
  assert.equal(first.scorePayload.scoreFinal, second.scorePayload.scoreFinal);
  assert.equal(first.scorePayload.maxScore, second.scorePayload.maxScore);
  assert.equal(first.scorePayload.percentage, second.scorePayload.percentage);
  assert.deepEqual(first.scorePayload.traitScores, second.scorePayload.traitScores);
  assert.equal(first.metadata.scoringContractVersion, 2);
  assert.equal(Boolean(first.metadata.microRubricVersion), true);
  assert.deepEqual(first.metadata.legacyDirectModelScores, { pronunciation: 0, fluency: 0 });
  assert.deepEqual(second.metadata.legacyDirectModelScores, { pronunciation: 5, fluency: 5 });
});

test('Read Aloud v2 scoring fails instead of using direct bands when micro answers are invalid', async () => {
  const result = await scoreReadAloudAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'speaking_read_aloud',
      artifactIds: ['audio-1'],
      metadata: {}
    },
    question: {
      questionType: 'speaking_read_aloud',
      payload: {
        sourceText: 'The quick brown fox jumps.'
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
      audioDurationSeconds: 3.8
    },
    scoringConfig: {}
  }, {
    aiAnalysis: {
      transcript: 'The quick brown fox jumps.',
      pronunciation: { score: 5 },
      fluency: { score: 5 },
      microResponses: [
        { id: 'pronunciation_quality', choice: 'very clear', evidence: 'Unsupported free text.', confidence: 0.9 },
        { id: 'fluency_quality', choice: 'smooth enough', evidence: 'Unsupported free text.', confidence: 0.9 }
      ]
    }
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.scorePayload, null);
  assert.equal(result.metadata.scoringContractVersion, 2);
  assert.deepEqual(result.metadata.legacyDirectModelScores, { pronunciation: 5, fluency: 5 });
  assert.equal(result.metadata.warnings.some((row) => row.includes('Invalid micro-rubric response choices')), true);
});

test('Read Aloud v2 scoring fills missing micro answers deterministically from audio-derived transcript', async () => {
  const result = await scoreReadAloudAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'speaking_read_aloud',
      artifactIds: ['audio-1'],
      metadata: {}
    },
    question: {
      questionType: 'speaking_read_aloud',
      payload: {
        sourceText: 'The quick brown fox jumps.'
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
      audioDurationSeconds: 3.8
    },
    scoringConfig: {
      idealWpmMin: 90,
      idealWpmMax: 160
    }
  }, {
    aiAnalysis: {
      transcript: 'The quick brown fox jumps.',
      pronunciation: { score: 5 },
      fluency: { score: 5 },
      speechMetrics: { estimatedWpm: 100 }
    }
  });

  assert.equal(result.status, 'scored');
  assert.equal(result.scorePayload.scoreFinal, 12);
  assert.deepEqual(result.scorePayload.traitScores, {
    content: 5,
    pronunciation: 3,
    fluency: 4
  });
  assert.equal(result.metadata.microResponses.length, 2);
  assert.equal(result.metadata.warnings.some((row) => row.includes('Generated Read Aloud micro-rubric responses deterministically')), false);
  assert.equal(result.metadata.technicalWarnings.some((row) => row.includes('Generated Read Aloud micro-rubric responses deterministically')), true);
});

test('Read Aloud scorer reports provider context when analysis has no transcript', async () => {
  const result = await scoreReadAloudAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'speaking_read_aloud',
      artifactIds: ['audio-1'],
      metadata: {}
    },
    question: {
      questionType: 'speaking_read_aloud',
      payload: {
        sourceText: 'The quick brown fox jumps.'
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
      audioDurationSeconds: 3.8
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
  assert.equal(result.metadata.technicalWarnings.some((row) => row.includes('google-gemini')), true);
  assert.equal(result.metadata.warnings.some((row) => row.includes('empty transcription')), true);
});

test('Read Aloud scoring recovers missing transcript with an audio-only follow-up request', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-read-aloud-transcript-recovery-${Date.now()}.wav`);
  await fs.writeFile(tmpAudioPath, Buffer.from('RIFF fake wav data'));
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
    if (calls.length === 1) {
      return {
        provider: 'openai',
        modelUsed: 'gpt-4o-audio-preview',
        text: JSON.stringify({
          ...BASE_AI_ANALYSIS,
          transcript: '',
          warnings: ['Primary structured response omitted transcript.']
        }),
        usage: { promptTokenCount: 30, candidatesTokenCount: 10, totalTokenCount: 40 }
      };
    }
    return {
      provider: 'openai',
      modelUsed: 'gpt-4o-audio-preview',
      text: '{"transcript":"The quick brown fox jumps.","speechMetrics":{"estimatedWpm":100},"confidence":0.82,"warnings":[]}',
      usage: { promptTokenCount: 12, candidatesTokenCount: 6, totalTokenCount: 18 }
    };
  };

  try {
    const result = await scoreReadAloudAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_read_aloud',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: {
        questionType: 'speaking_read_aloud',
        payload: {
          sourceText: 'The quick brown fox jumps.'
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
        audioDurationSeconds: 3.8
      },
      scoringConfig: {}
    }, {});

    assert.equal(result.status, 'scored');
    assert.equal(result.scorePayload.scoreFinal, 12);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].requestLabel, 'pte-read-aloud-transcript-recovery-v1');
    assert.equal(calls[1].responseSchema, undefined);
    assert.equal(result.metadata.transcript, 'The quick brown fox jumps.');
    assert.equal(result.metadata.provider.transcriptRecovery.modelUsed, 'gpt-4o-audio-preview');
    assert.equal(result.metadata.provider.tokenUsage.totalTokenCount, 58);
    assert.equal(result.metadata.warnings.some((row) => row.includes('Recovered Read Aloud transcript')), false);
    assert.equal(result.metadata.technicalWarnings.some((row) => row.includes('Recovered Read Aloud transcript')), true);
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
  }
});

test('Read Aloud scoring recovers micro responses after transcript-only recovery', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-read-aloud-micro-after-transcript-${Date.now()}.wav`);
  await fs.writeFile(tmpAudioPath, Buffer.from('RIFF fake wav data'));
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
    if (calls.length === 1) {
      return {
        provider: 'openai',
        modelUsed: 'gpt-4o-audio-preview',
        text: '{"pronunciation":{"score":5},"fluency":{"score":5},"speechMetrics":{"estimatedWpm":100},"confidence":0.8,"warnings":["primary omitted transcript and micro answers"]}',
        usage: { promptTokenCount: 30, candidatesTokenCount: 10, totalTokenCount: 40 }
      };
    }
    if (calls.length === 2) {
      return {
        provider: 'openai',
        modelUsed: 'gpt-4o-audio-preview',
        text: '{"transcript":"The quick brown fox jumps.","speechMetrics":{"estimatedWpm":100},"confidence":0.82,"warnings":[]}',
        usage: { promptTokenCount: 12, candidatesTokenCount: 6, totalTokenCount: 18 }
      };
    }
    return {
      provider: 'openai',
      modelUsed: 'gpt-4o-audio-preview',
      text: '{"transcript":"The quick brown fox jumps.","microResponses":[{"id":"pronunciation_quality","choice":"good","evidence":"mostly clear sounds","confidence":0.82},{"id":"fluency_quality","choice":"developing","evidence":"some hesitation","confidence":0.82}],"speechMetrics":{"estimatedWpm":100},"confidence":0.82,"warnings":[]}',
      usage: { promptTokenCount: 14, candidatesTokenCount: 9, totalTokenCount: 23 }
    };
  };

  try {
    const result = await scoreReadAloudAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_read_aloud',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: {
        questionType: 'speaking_read_aloud',
        payload: {
          sourceText: 'The quick brown fox jumps.'
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
        audioDurationSeconds: 3.8
      },
      scoringConfig: {}
    }, {});

    assert.equal(result.status, 'scored');
    assert.equal(result.scorePayload.scoreFinal, 12);
    assert.equal(calls.length, 3);
    assert.equal(calls[1].requestLabel, 'pte-read-aloud-transcript-recovery-v1');
    assert.equal(calls[2].requestLabel, 'pte-read-aloud-micro-rubric-recovery-v1');
    assert.equal(result.metadata.provider.tokenUsage.totalTokenCount, 81);
    assert.equal(result.metadata.provider.transcriptRecovery.modelUsed, 'gpt-4o-audio-preview');
    assert.equal(result.metadata.provider.microRubricRecovery.modelUsed, 'gpt-4o-audio-preview');
    assert.equal(result.metadata.warnings.some((row) => row.includes('Recovered Read Aloud transcript')), false);
    assert.equal(result.metadata.warnings.some((row) => row.includes('Recovered Read Aloud micro-rubric responses')), false);
    assert.equal(result.metadata.technicalWarnings.some((row) => row.includes('Recovered Read Aloud transcript')), true);
    assert.equal(result.metadata.technicalWarnings.some((row) => row.includes('Recovered Read Aloud micro-rubric responses')), true);
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
  }
});

test('Read Aloud scoring uses deterministic fallback when micro recovery omits required answers', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-read-aloud-deterministic-micro-${Date.now()}.wav`);
  await fs.writeFile(tmpAudioPath, Buffer.from('RIFF fake wav data'));
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
    if (calls.length === 1) {
      return {
        provider: 'openai',
        modelUsed: 'gpt-4o-audio-preview',
        text: '{"speechMetrics":{"estimatedWpm":100},"confidence":0.8,"warnings":["primary omitted transcript and micro answers"]}',
        usage: { promptTokenCount: 30, candidatesTokenCount: 10, totalTokenCount: 40 }
      };
    }
    if (calls.length === 2) {
      return {
        provider: 'openai',
        modelUsed: 'gpt-4o-audio-preview',
        text: '{"transcript":"The quick brown fox jumps.","speechMetrics":{"estimatedWpm":100},"confidence":0.82,"warnings":[]}',
        usage: { promptTokenCount: 12, candidatesTokenCount: 6, totalTokenCount: 18 }
      };
    }
    return {
      provider: 'openai',
      modelUsed: 'gpt-4o-audio-preview',
      text: '{"transcript":"The quick brown fox jumps.","speechMetrics":{"estimatedWpm":100},"confidence":0.82,"warnings":["micro fields omitted again"]}',
      usage: { promptTokenCount: 14, candidatesTokenCount: 6, totalTokenCount: 20 }
    };
  };

  try {
    const result = await scoreReadAloudAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_read_aloud',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: {
        questionType: 'speaking_read_aloud',
        payload: {
          sourceText: 'The quick brown fox jumps.'
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
        audioDurationSeconds: 3.8
      },
      scoringConfig: {
        idealWpmMin: 90,
        idealWpmMax: 160
      }
    }, {});

    assert.equal(result.status, 'scored');
    assert.equal(result.scorePayload.scoreFinal, 12);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].requestLabel, 'pte-read-aloud-micro-rubric-recovery-v1');
    assert.equal(result.metadata.provider.microRubricRecovery.modelUsed, 'gpt-4o-audio-preview');
    assert.equal(result.metadata.warnings.some((row) => row.includes('Recovered Read Aloud micro-rubric responses using deterministic transcript fallback')), false);
    assert.equal(result.metadata.technicalWarnings.some((row) => row.includes('Recovered Read Aloud micro-rubric responses using deterministic transcript fallback')), true);
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
  }
});

test('Gemini Flash Read Aloud analysis retries without strict schema when transcript is missing', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-read-aloud-flash-${Date.now()}.webm`);
  await fs.writeFile(tmpAudioPath, Buffer.from('fake-audio'));
  const calls = [];

  pteAiProviderDataService.resolveRuntimeProvider = async () => ({
    providerId: 'google-gemini',
    modelId: 'gemini-2.5-flash',
    credentials: {},
    providerRecord: {
      id: 'PROVIDER-FLASH',
      name: 'Gemini Flash'
    }
  });
  pteAiProviderService.sendPrompt = async (payload) => {
    calls.push(payload);
    if (calls.length === 1) {
      return {
        provider: 'google-gemini',
        modelUsed: 'gemini-2.5-flash',
        text: '{"pronunciation":{"score":4},"fluency":{"score":4},"speechMetrics":{"estimatedWpm":100},"confidence":0.8,"warnings":["missing transcript"]}',
        usage: { promptTokenCount: 20, candidatesTokenCount: 5, totalTokenCount: 25 }
      };
    }
    return {
      provider: 'google-gemini',
      modelUsed: 'gemini-2.5-flash',
      text: '{"transcript":"The quick brown fox jumps.","microResponses":[{"id":"pronunciation_quality","choice":"good","evidence":"clear","confidence":0.8},{"id":"fluency_quality","choice":"good","evidence":"steady","confidence":0.8}],"pronunciation":{"score":1},"fluency":{"score":1},"speechMetrics":{"estimatedWpm":100},"confidence":0.8,"warnings":[]}',
      usage: { promptTokenCount: 22, candidatesTokenCount: 9, totalTokenCount: 31 }
    };
  };

  try {
    const result = await scoreReadAloudAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_read_aloud',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: {
        questionType: 'speaking_read_aloud',
        payload: {
          sourceText: 'The quick brown fox jumps.'
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
        audioDurationSeconds: 3.8
      },
      scoringConfig: {}
    }, {});

    assert.equal(result.status, 'scored');
    assert.equal(calls.length, 2);
    assert.equal(Boolean(calls[0].responseSchema), true);
    assert.equal(calls[0].responseMimeType, 'application/json');
    assert.equal(calls[1].responseSchema, undefined);
    assert.equal(calls[1].responseMimeType, undefined);
    assert.equal(result.metadata.provider.modelUsed, 'gemini-2.5-flash');
    assert.equal(result.metadata.provider.tokenUsage.totalTokenCount, 31);
    assert.equal(result.metadata.warnings.some((row) => row.includes('retried with a looser JSON-only request')), false);
    assert.equal(result.metadata.technicalWarnings.some((row) => row.includes('retried with a looser JSON-only request')), true);
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
  }
});

test('OpenAI Read Aloud analysis retries once when micro responses are missing', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-read-aloud-openai-micro-retry-${Date.now()}.wav`);
  await fs.writeFile(tmpAudioPath, Buffer.from('RIFF fake wav data'));
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
    if (calls.length === 1) {
      return {
        provider: 'openai',
        modelUsed: 'gpt-4o-audio-preview',
        text: '{"transcript":"The quick brown fox jumps.","pronunciation":{"score":5},"fluency":{"score":5},"speechMetrics":{"estimatedWpm":110},"confidence":0.88,"warnings":[]}',
        usage: { promptTokenCount: 30, candidatesTokenCount: 10, totalTokenCount: 40 }
      };
    }
    return {
      provider: 'openai',
      modelUsed: 'gpt-4o-audio-preview',
      text: '{"transcript":"The quick brown fox jumps.","microResponses":[{"id":"pronunciation_quality","choice":"good","evidence":"clear","confidence":0.88},{"id":"fluency_quality","choice":"good","evidence":"steady","confidence":0.88}],"pronunciation":{"score":1},"fluency":{"score":1},"speechMetrics":{"estimatedWpm":110},"confidence":0.88,"warnings":[]}',
      usage: { promptTokenCount: 20, candidatesTokenCount: 10, totalTokenCount: 30 }
    };
  };

  try {
    const result = await scoreReadAloudAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_read_aloud',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: {
        questionType: 'speaking_read_aloud',
        payload: {
          sourceText: 'The quick brown fox jumps.'
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
        audioDurationSeconds: 3.8
      },
      scoringConfig: {}
    }, {});

    assert.equal(result.status, 'scored');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].responseSchema, undefined);
    assert.equal(calls[0].responseMimeType, undefined);
    assert.equal(calls[1].responseSchema, undefined);
    assert.equal(calls[1].responseMimeType, undefined);
    assert.equal(result.metadata.scoringContractVersion, 2);
    assert.equal(result.metadata.warnings.some((row) => row.includes('retried with a JSON-only request')), false);
    assert.equal(result.metadata.technicalWarnings.some((row) => row.includes('retried with a JSON-only request')), true);
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
  }
});

test('OpenAI Read Aloud scoring prepares browser WebM audio as WAV before provider request', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-read-aloud-openai-${Date.now()}.webm`);
  const fakeFfmpegPath = path.join(os.tmpdir(), `pte-fake-ffmpeg-${Date.now()}.js`);
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
      modelId: 'gpt-4o-audio-preview',
      credentials: {},
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
      modelUsed: 'gpt-4o-audio-preview',
      text: '{"transcript":"The quick brown fox jumps.","microResponses":[{"id":"pronunciation_quality","choice":"good","evidence":"clear","confidence":0.88},{"id":"fluency_quality","choice":"good","evidence":"steady","confidence":0.88}],"pronunciation":{"score":1},"fluency":{"score":1},"speechMetrics":{"estimatedWpm":110},"confidence":0.88,"warnings":[]}',
      usage: { promptTokenCount: 30, candidatesTokenCount: 10, totalTokenCount: 40 }
    };
  };

  try {
    const result = await scoreReadAloudAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_read_aloud',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: {
        questionType: 'speaking_read_aloud',
        payload: {
          sourceText: 'The quick brown fox jumps.'
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
        audioDurationSeconds: 3.8
      },
      scoringConfig: {}
    }, {});

    assert.equal(result.status, 'scored');
    assert.equal(runtimeProviderOptions?.purpose, 'pte_scoring');
    assert.equal(runtimeProviderOptions?.questionType, 'speaking_read_aloud');
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

test('OpenAI Read Aloud scoring rejects non-audio OpenAI models clearly', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-read-aloud-openai-model-${Date.now()}.wav`);
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

  try {
    const result = await scoreReadAloudAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_read_aloud',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: {
        questionType: 'speaking_read_aloud',
        payload: {
          sourceText: 'The quick brown fox jumps.'
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
        audioDurationSeconds: 3.8
      },
      scoringConfig: {}
    }, {});

    assert.equal(result.status, 'failed');
    assert.equal(result.metadata.warnings.some((row) => row.includes('requires an OpenAI audio chat model')), true);
    assert.equal(result.metadata.warnings.some((row) => row.includes('gpt-5.4-mini')), true);
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
  }
});

test('Scoring engine supports automated speaking scorers in v1', async () => {
  assert.equal(scoringEngineService.isAutoScoringSupported('speaking_read_aloud'), true);
  assert.equal(scoringEngineService.isAutoScoringSupported('speaking_repeat_sentence'), true);
  assert.equal(scoringEngineService.isAutoScoringSupported('speaking_answer_short_question'), true);
  assert.equal(scoringEngineService.isAutoScoringSupported('speaking_describe_image'), true);
  assert.equal(scoringEngineService.isAutoScoringSupported('speaking_respond_to_situation'), true);

  const unsupported = await scoringEngineService.scoreAttemptItem({
    item: { questionType: 'speaking_future_type' }
  });
  assert.equal(unsupported.status, 'unsupported');
});
