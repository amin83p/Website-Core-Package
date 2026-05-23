const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const describeImageScoringService = require('../MVC/services/pte/pteDescribeImageScoringService');
const scoringEngineService = require('../MVC/services/pte/pteScoringEngineService');
const pteAiProviderDataService = require('../MVC/services/pte/pteAiProviderDataService');
const pteAiProviderService = require('../MVC/services/pte/ai/aiProviderService');

const {
  calculateDescribeImageScore,
  parseAiDescribeImageAnalysis,
  parseAiDescribeImageTranscriptRecovery,
  scoreDescribeImageAttemptItem
} = describeImageScoringService;

const ORIGINALS = {
  resolveRuntimeProvider: pteAiProviderDataService.resolveRuntimeProvider,
  sendPrompt: pteAiProviderService.sendPrompt,
  geminiCapacityRetryDelay: process.env.PTE_SCORING_GEMINI_CAPACITY_RETRY_DELAY_MS
};

test.afterEach(() => {
  pteAiProviderDataService.resolveRuntimeProvider = ORIGINALS.resolveRuntimeProvider;
  pteAiProviderService.sendPrompt = ORIGINALS.sendPrompt;
  if (ORIGINALS.geminiCapacityRetryDelay === undefined) delete process.env.PTE_SCORING_GEMINI_CAPACITY_RETRY_DELAY_MS;
  else process.env.PTE_SCORING_GEMINI_CAPACITY_RETRY_DELAY_MS = ORIGINALS.geminiCapacityRetryDelay;
});

test('AI Describe Image analysis parsing normalizes transcript, trait bands, and warnings', () => {
  const parsed = parseAiDescribeImageAnalysis('```json\n{"transcription":{"text":"The chart shows sales rising steadily."},"content":{"score":9,"missingKeyPoints":["final comparison","final comparison"]},"pronunciation":{"score":-1},"fluency":{"score":4.6},"speechMetrics":{"estimatedWpm":123.45,"longPauseCount":2},"confidence":82,"warnings":["low image context","low image context"]}\n```');

  assert.equal(parsed.transcript, 'The chart shows sales rising steadily.');
  assert.equal(parsed.content.score, 5);
  assert.deepEqual(parsed.content.missingKeyPoints, ['final comparison']);
  assert.equal(parsed.pronunciation.score, 0);
  assert.equal(parsed.fluency.score, 5);
  assert.equal(parsed.speechMetrics.estimatedWpm, 123.45);
  assert.equal(parsed.confidence, 0.82);
  assert.deepEqual(parsed.warnings, ['low image context']);
});

test('Describe Image transcript recovery extracts transcript from malformed fenced JSON', () => {
  const parsed = parseAiDescribeImageTranscriptRecovery('```json\n{ "transcript": "The image shows export volume by country in year twenty twenty four.\n');

  assert.equal(parsed.transcript, 'The image shows export volume by country in year twenty twenty four.');
  assert.equal(parsed.confidence, 0.5);
  assert.equal(parsed.warnings.some((row) => row.includes('malformed JSON')), true);
  assert.equal(parsed.warnings.some((row) => row.includes('plain text')), false);
});

test('Describe Image raw score uses content, pronunciation, and fluency out of 15', () => {
  const score = calculateDescribeImageScore({
    aiAnalysis: {
      content: { score: 4 },
      pronunciation: { score: 3 },
      fluency: { score: 5 }
    },
    scoringConfig: {
      contentMax: 5,
      pronunciationMax: 5,
      fluencyMax: 5
    }
  });

  assert.equal(score.scoreFinal, 12);
  assert.equal(score.maxScore, 15);
  assert.equal(score.percentage, 80);
  assert.deepEqual(score.traitScores, {
    content: 4,
    pronunciation: 3,
    fluency: 5
  });
});

test('Describe Image scorer refuses when no visual evidence is available', async () => {
  const result = await scoreDescribeImageAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'speaking_describe_image',
      artifactIds: ['audio-1'],
      metadata: {}
    },
    question: {
      questionType: 'speaking_describe_image',
      payload: {}
    },
    artifacts: [
      {
        id: 'audio-1',
        artifactType: 'audio',
        mimeType: 'audio/webm',
        path: '/tmp/describe-image-audio.webm'
      }
    ],
    responsePayload: { artifactId: 'audio-1' },
    scoringConfig: {}
  }, {
    aiAnalysis: { transcript: 'A chart is shown.', content: { score: 2 }, pronunciation: { score: 3 }, fluency: { score: 3 } }
  });

  assert.equal(result.status, 'needs_evidence');
  assert.equal(result.scorePayload, null);
  assert.equal(result.metadata.warnings.some((row) => row.includes('prompt image evidence')), true);
});

test('Describe Image scorer refuses typed transcript notes without uploaded audio', async () => {
  const result = await scoreDescribeImageAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'speaking_describe_image',
      metadata: { responsePayload: { transcript: 'The bar chart rises.' } }
    },
    question: {
      questionType: 'speaking_describe_image',
      payload: {
        imageCaption: 'A bar chart showing sales by year.',
        expectedKeyPoints: ['Sales rise each year', 'The final year is highest']
      }
    },
    artifacts: [],
    responsePayload: { transcript: 'The bar chart rises.' },
    scoringConfig: {}
  }, {
    aiAnalysis: { transcript: 'The bar chart rises.', content: { score: 3 }, pronunciation: { score: 3 }, fluency: { score: 3 } }
  });

  assert.equal(result.status, 'needs_evidence');
  assert.equal(result.scorePayload, null);
  assert.equal(result.metadata.warnings.some((row) => row.includes('uploaded audio')), true);
});

test('Describe Image scorer returns score payload and feedback draft with audio and visual evidence', async () => {
  const result = await scoreDescribeImageAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'speaking_describe_image',
      artifactIds: ['audio-1'],
      metadata: {}
    },
    question: {
      questionType: 'speaking_describe_image',
      payload: {
        imageCaption: 'A line chart showing sales increasing from 2020 to 2024.',
        expectedKeyPoints: ['Sales rise over time', '2024 is the highest point'],
        chartType: 'line_chart'
      }
    },
    artifacts: [
      {
        id: 'audio-1',
        artifactType: 'audio',
        mimeType: 'audio/webm',
        path: '/tmp/describe-image-audio.webm'
      }
    ],
    responsePayload: {
      artifactId: 'audio-1',
      audioDurationSeconds: 28
    },
    scoringConfig: {
      contentMax: 5,
      pronunciationMax: 5,
      fluencyMax: 5
    }
  }, {
    aiAnalysis: {
      transcript: 'The line chart shows sales increasing steadily and reaching the highest point in 2024.',
      content: { score: 4, coveredKeyPoints: ['Sales rise over time'], missingKeyPoints: ['2024 highest point'] },
      pronunciation: { score: 4, evidence: ['Mostly clear'] },
      fluency: { score: 3, evidence: ['Some hesitation'] },
      microResponses: [
        { id: 'content_main_idea', choice: 'yes', evidence: 'Mentions increasing sales.', confidence: 0.9 },
        { id: 'content_key_details', choice: 'partial', evidence: 'Covers the trend but only part of the highest-point detail.', confidence: 0.9 },
        { id: 'content_visual_accuracy', choice: 'yes', evidence: 'The statement matches the supplied chart context.', confidence: 0.9 },
        { id: 'pronunciation_quality', choice: 'good', evidence: 'Mostly clear.', confidence: 0.9 },
        { id: 'fluency_quality', choice: 'developing', evidence: 'Some hesitation.', confidence: 0.9 }
      ],
      speechMetrics: { speechDurationSeconds: 28, estimatedWpm: 118 },
      confidence: 0.9
    },
    provider: { providerId: 'test-provider', modelUsed: 'test-model' }
  });

  assert.equal(result.status, 'scored');
  assert.equal(result.scorePayload.scoreFinal, 11);
  assert.equal(result.scorePayload.maxScore, 15);
  assert.equal(result.scorePayload.percentage, 73.33);
  assert.deepEqual(result.scorePayload.traitScores, {
    content: 4,
    pronunciation: 4,
    fluency: 3
  });
  assert.equal(result.metadata.scorerVersion, 'pte-describe-image-v1');
  assert.equal(result.metadata.image.expectedKeyPoints.length, 2);
  assert.equal(Boolean(result.metadata.feedbackDraft), true);
});

test('Describe Image scorer prefers attempt question snapshot over current bank question payload', async () => {
  const result = await scoreDescribeImageAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'speaking_describe_image',
      artifactIds: ['audio-1'],
      metadata: {
        questionSnapshot: {
          id: 'question-export-chart',
          questionType: 'speaking_describe_image',
          payload: {
            imageCaption: 'A bar chart showing export volume by country in 2024.',
            expectedKeyPoints: ['Export volume varies by country', 'South Korea is the highest'],
            chartType: 'bar_chart'
          }
        }
      }
    },
    question: {
      questionType: 'speaking_describe_image',
      payload: {
        imageCaption: 'A pie chart showing website traffic sources.',
        expectedKeyPoints: ['Direct traffic accounts for the largest share at 35%', 'Organic search contributes 25%'],
        chartType: 'pie_chart'
      }
    },
    artifacts: [
      {
        id: 'audio-1',
        artifactType: 'audio',
        mimeType: 'audio/webm',
        path: '/tmp/describe-image-audio.webm'
      }
    ],
    responsePayload: {
      artifactId: 'audio-1',
      audioDurationSeconds: 28
    },
    scoringConfig: {
      contentMax: 5,
      pronunciationMax: 5,
      fluencyMax: 5
    }
  }, {
    aiAnalysis: {
      transcript: 'The image illustrates export volume by country in 2024 and South Korea is the highest.',
      microResponses: [
        { id: 'content_main_idea', choice: 'yes', evidence: 'Mentions export volume by country.', confidence: 0.9 },
        { id: 'content_key_details', choice: 'yes', evidence: 'Mentions South Korea as highest.', confidence: 0.9 },
        { id: 'content_visual_accuracy', choice: 'yes', evidence: 'Matches the snapshot prompt.', confidence: 0.9 },
        { id: 'pronunciation_quality', choice: 'good', evidence: 'Mostly clear.', confidence: 0.9 },
        { id: 'fluency_quality', choice: 'developing', evidence: 'Some hesitation.', confidence: 0.9 }
      ],
      speechMetrics: { estimatedWpm: 118 },
      confidence: 0.9
    },
    provider: { providerId: 'test-provider', modelUsed: 'test-model' }
  });

  assert.equal(result.status, 'scored');
  assert.deepEqual(result.metadata.image.expectedKeyPoints, [
    'Export volume varies by country',
    'South Korea is the highest'
  ]);
  assert.equal(result.metadata.image.imageCaption, 'A bar chart showing export volume by country in 2024.');
  assert.equal(result.metadata.image.imageCaption.includes('website traffic'), false);
  assert.equal(result.metadata.feedbackDraft.nextPracticeAction.includes('website traffic'), false);
});

test('Gemini Flash Describe Image scorer recovers transcript with audio-only follow-up', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-describe-image-flash-${Date.now()}.webm`);
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
        text: '{"microResponses":[{"id":"content_main_idea","choice":"yes","evidence":"main trend","confidence":0.8},{"id":"content_key_details","choice":"partial","evidence":"some details","confidence":0.8},{"id":"content_visual_accuracy","choice":"yes","evidence":"accurate","confidence":0.8},{"id":"pronunciation_quality","choice":"good","evidence":"clear","confidence":0.8},{"id":"fluency_quality","choice":"developing","evidence":"some hesitation","confidence":0.8}],"content":{"score":1},"pronunciation":{"score":1},"fluency":{"score":1},"speechMetrics":{"estimatedWpm":110},"confidence":0.8,"warnings":["missing transcript"]}',
        usage: { promptTokenCount: 20, candidatesTokenCount: 5, totalTokenCount: 25 }
      };
    }
    if (calls.length === 2) {
      return {
        provider: 'google-gemini',
        modelUsed: 'gemini-2.5-flash',
        text: '{"microResponses":[{"id":"content_main_idea","choice":"yes","evidence":"main trend","confidence":0.8},{"id":"content_key_details","choice":"partial","evidence":"some details","confidence":0.8},{"id":"content_visual_accuracy","choice":"yes","evidence":"accurate","confidence":0.8},{"id":"pronunciation_quality","choice":"good","evidence":"clear","confidence":0.8},{"id":"fluency_quality","choice":"developing","evidence":"some hesitation","confidence":0.8}],"content":{"score":1},"pronunciation":{"score":1},"fluency":{"score":1},"speechMetrics":{"estimatedWpm":110},"confidence":0.8,"warnings":["still no transcript"]}',
        usage: { promptTokenCount: 24, candidatesTokenCount: 7, totalTokenCount: 31 }
      };
    }
    return {
      provider: 'google-gemini',
      modelUsed: 'gemini-2.5-flash',
      text: '{"transcript":"The line chart shows sales increasing steadily until 2024.","confidence":0.86,"speechMetrics":{"estimatedWpm":112},"warnings":[]}',
      usage: { promptTokenCount: 12, candidatesTokenCount: 5, totalTokenCount: 17 }
    };
  };

  try {
    const result = await scoreDescribeImageAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_describe_image',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: {
        questionType: 'speaking_describe_image',
        payload: {
          imageCaption: 'A line chart showing sales increasing from 2020 to 2024.',
          expectedKeyPoints: ['Sales rise over time', '2024 is the highest point'],
          chartType: 'line_chart'
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
        audioDurationSeconds: 28
      },
      scoringConfig: {
        contentMax: 5,
        pronunciationMax: 5,
        fluencyMax: 5
      }
    }, {});

    assert.equal(result.status, 'scored');
    assert.equal(calls.length, 3);
    assert.equal(Boolean(calls[0].responseSchema), true);
    assert.equal(calls[1].responseSchema, undefined);
    assert.equal(calls[2].requestLabel, 'pte-describe-image-transcript-recovery-v1');
    assert.equal(result.metadata.transcript, 'The line chart shows sales increasing steadily until 2024.');
    assert.equal(result.metadata.provider.tokenUsage.totalTokenCount, 73);
    assert.equal(result.metadata.provider.transcriptRecovery.tokenUsage.totalTokenCount, 17);
    assert.equal(result.metadata.warnings.some((row) => row.includes('audio-only follow-up')), true);
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
  }
});

test('Describe Image scorer runs strict transcript recovery when primary transcript looks truncated', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-describe-image-partial-transcript-${Date.now()}.webm`);
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
    if (calls.length <= 2) {
      return {
        provider: 'google-gemini',
        modelUsed: 'gemini-2.5-flash',
        text: '{"transcript":"The line chart shows sales increasing and","microResponses":[{"id":"content_main_idea","choice":"yes","evidence":"main trend","confidence":0.8},{"id":"content_key_details","choice":"partial","evidence":"some details","confidence":0.8},{"id":"content_visual_accuracy","choice":"yes","evidence":"accurate","confidence":0.8},{"id":"pronunciation_quality","choice":"good","evidence":"clear","confidence":0.8},{"id":"fluency_quality","choice":"developing","evidence":"some hesitation","confidence":0.8}],"content":{"score":1},"pronunciation":{"score":1},"fluency":{"score":1},"speechMetrics":{"estimatedWpm":110},"confidence":0.8,"warnings":[]}',
        usage: { promptTokenCount: 24, candidatesTokenCount: 8, totalTokenCount: 32 }
      };
    }
    return {
      provider: 'google-gemini',
      modelUsed: 'gemini-2.5-flash',
      text: '{"transcript":"The line chart shows sales increasing steadily until 2024.","confidence":0.86,"speechMetrics":{"estimatedWpm":112},"warnings":[]}',
      usage: { promptTokenCount: 12, candidatesTokenCount: 5, totalTokenCount: 17 }
    };
  };

  try {
    const result = await scoreDescribeImageAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_describe_image',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: {
        questionType: 'speaking_describe_image',
        payload: {
          imageCaption: 'A line chart showing sales increasing from 2020 to 2024.',
          expectedKeyPoints: ['Sales rise over time', '2024 is the highest point'],
          chartType: 'line_chart'
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
        audioDurationSeconds: 28
      },
      scoringConfig: {
        contentMax: 5,
        pronunciationMax: 5,
        fluencyMax: 5
      }
    }, {});

    assert.equal(result.status, 'scored');
    assert.equal(calls.length, 3);
    assert.equal(Boolean(calls[0].responseSchema), true);
    assert.equal(calls[1].responseSchema, undefined);
    assert.equal(calls[2].requestLabel, 'pte-describe-image-transcript-recovery-v1');
    assert.equal(result.metadata.transcript, 'The line chart shows sales increasing steadily until 2024.');
    const recoveryUser = calls[2].messages.find((row) => row.role === 'user');
    const recoveryPrompt = Array.isArray(recoveryUser?.content)
      ? String(recoveryUser.content[0]?.text || '')
      : String(recoveryUser?.content || '');
    assert.equal(recoveryPrompt.includes('complete verbatim transcript'), true);
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
  }
});

test('Describe Image scorer recovers micro rubric when prompt image file is missing but text context exists', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-describe-image-missing-image-${Date.now()}.wav`);
  const missingImagePath = path.join(os.tmpdir(), `pte-describe-image-missing-${Date.now()}.png`);
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
        text: '{"transcript":"The chart shows sales increasing and the final year is the highest.","content":{"score":5},"pronunciation":{"score":5},"fluency":{"score":5},"speechMetrics":{"estimatedWpm":116},"confidence":0.86,"warnings":[]}',
        usage: { promptTokenCount: 30, candidatesTokenCount: 10, totalTokenCount: 40 }
      };
    }
    if (calls.length === 2) {
      return {
        provider: 'openai',
        modelUsed: 'gpt-4o-audio-preview',
        text: '{"transcript":"The chart shows sales increasing and the final year is the highest.","content":{"score":1},"pronunciation":{"score":1},"fluency":{"score":1},"speechMetrics":{"estimatedWpm":116},"confidence":0.86,"warnings":[]}',
        usage: { promptTokenCount: 22, candidatesTokenCount: 8, totalTokenCount: 30 }
      };
    }
    return {
      provider: 'openai',
      modelUsed: 'gpt-4o-audio-preview',
      text: '{"transcript":"The chart shows sales increasing and the final year is the highest.","microResponses":[{"id":"content_main_idea","choice":"yes","evidence":"Mentions the increasing trend.","confidence":0.88},{"id":"content_key_details","choice":"yes","evidence":"Mentions the final year as highest.","confidence":0.88},{"id":"content_visual_accuracy","choice":"yes","evidence":"Matches the supplied caption and key points.","confidence":0.88},{"id":"pronunciation_quality","choice":"good","evidence":"Mostly clear.","confidence":0.88},{"id":"fluency_quality","choice":"developing","evidence":"Some hesitation.","confidence":0.88}],"speechMetrics":{"estimatedWpm":116},"confidence":0.88,"warnings":[]}',
      usage: { promptTokenCount: 14, candidatesTokenCount: 6, totalTokenCount: 20 }
    };
  };

  try {
    const result = await scoreDescribeImageAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_describe_image',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: {
        questionType: 'speaking_describe_image',
        payload: {
          imageAssetId: missingImagePath,
          imageCaption: 'A line chart showing sales increasing from 2020 to 2024.',
          expectedKeyPoints: ['Sales rise over time', '2024 is the highest point'],
          chartType: 'line_chart'
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
        audioDurationSeconds: 24
      },
      scoringConfig: {
        contentMax: 5,
        pronunciationMax: 5,
        fluencyMax: 5
      }
    }, {});

    assert.equal(result.status, 'scored');
    assert.equal(calls.length, 3);
    assert.equal(calls[0].responseSchema, undefined);
    assert.equal(calls[0].responseMimeType, undefined);
    assert.equal(calls[1].requestLabel, 'pte-describe-image-scoring-v1-json-retry');
    assert.equal(calls[2].requestLabel, 'pte-describe-image-micro-rubric-recovery-v1');
    assert.equal(result.scorePayload.scoreFinal, 12);
    assert.deepEqual(result.scorePayload.traitScores, {
      content: 5,
      pronunciation: 4,
      fluency: 3
    });
    assert.equal(result.metadata.provider.tokenUsage.totalTokenCount, 90);
    assert.equal(result.metadata.provider.microRubricRecovery.tokenUsage.totalTokenCount, 20);
    assert.equal(result.metadata.warnings.some((row) => row.includes('Prompt image could not be attached')), true);
    assert.equal(result.metadata.technicalWarnings.some((row) => row.includes('Recovered Describe Image micro-rubric responses')), true);
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
  }
});

test('Describe Image scorer uses deterministic text-context micro fallback when provider omits micro answers', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-describe-image-deterministic-micro-${Date.now()}.wav`);
  const missingImagePath = path.join(os.tmpdir(), `pte-describe-image-still-missing-${Date.now()}.png`);
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
    return {
      provider: 'openai',
      modelUsed: 'gpt-4o-audio-preview',
      text: '{"transcript":"The chart shows sales increasing and the final year is the highest.","content":{"score":5},"pronunciation":{"score":5},"fluency":{"score":5},"speechMetrics":{"estimatedWpm":116},"confidence":0.86,"warnings":[]}',
      usage: { promptTokenCount: 20, candidatesTokenCount: 10, totalTokenCount: 30 }
    };
  };

  try {
    const result = await scoreDescribeImageAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_describe_image',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: {
        questionType: 'speaking_describe_image',
        payload: {
          imageAssetId: missingImagePath,
          imageCaption: 'A line chart showing sales increasing from 2020 to 2024.',
          expectedKeyPoints: ['Sales rise over time', '2024 is the highest point'],
          chartType: 'line_chart'
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
        audioDurationSeconds: 24
      },
      scoringConfig: {
        contentMax: 5,
        pronunciationMax: 5,
        fluencyMax: 5
      }
    }, {});

    assert.equal(result.status, 'scored');
    assert.equal(calls.length, 3);
    assert.equal(calls[0].responseSchema, undefined);
    assert.equal(calls[0].responseMimeType, undefined);
    assert.equal(calls[2].requestLabel, 'pte-describe-image-micro-rubric-recovery-v1');
    assert.equal(result.scorePayload.scoreFinal, 9);
    assert.deepEqual(result.scorePayload.traitScores, {
      content: 2,
      pronunciation: 3,
      fluency: 4
    });
    assert.equal(result.metadata.microResponses.length, 5);
    assert.equal(result.metadata.technicalWarnings.some((row) => row.includes('deterministically')), true);
    assert.equal(result.metadata.warnings.some((row) => row.includes('Prompt image could not be attached')), true);
    assert.equal(result.metadata.legacyDirectModelScores.content, 5);
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
  }
});

test('OpenAI Describe Image scorer extracts image context before audio scoring when no text context exists', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-describe-image-openai-vision-${Date.now()}.wav`);
  const tmpImagePath = path.join(os.tmpdir(), `pte-describe-image-openai-vision-${Date.now()}.png`);
  await fs.writeFile(tmpAudioPath, Buffer.from('RIFF fake wav data'));
  await fs.writeFile(tmpImagePath, Buffer.from('fake-png-data'));
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
        modelUsed: 'gpt-5.4-mini',
        text: '{"imageCaption":"A line chart showing sales increasing from 2020 to 2024.","expectedKeyPoints":["Sales rise over time","2024 is the highest point"],"chartType":"line_chart","warnings":[]}',
        usage: { promptTokenCount: 12, candidatesTokenCount: 8, totalTokenCount: 20 }
      };
    }
    return {
      provider: 'openai',
      modelUsed: 'gpt-audio',
      text: '{"transcript":"The chart shows sales increasing and the final year is the highest.","microResponses":[{"id":"content_main_idea","choice":"yes","evidence":"Mentions the increasing trend.","confidence":0.88},{"id":"content_key_details","choice":"yes","evidence":"Mentions the final year as highest.","confidence":0.88},{"id":"content_visual_accuracy","choice":"yes","evidence":"Matches the extracted visual context.","confidence":0.88},{"id":"pronunciation_quality","choice":"good","evidence":"Mostly clear.","confidence":0.88},{"id":"fluency_quality","choice":"good","evidence":"Steady pace.","confidence":0.88}],"speechMetrics":{"estimatedWpm":116},"confidence":0.88,"warnings":[]}',
      usage: { promptTokenCount: 30, candidatesTokenCount: 10, totalTokenCount: 40 }
    };
  };

  try {
    const result = await scoreDescribeImageAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_describe_image',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: {
        questionType: 'speaking_describe_image',
        payload: {
          imageAssetId: tmpImagePath
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
        audioDurationSeconds: 24
      },
      scoringConfig: {
        contentMax: 5,
        pronunciationMax: 5,
        fluencyMax: 5
      }
    }, {});

    assert.equal(result.status, 'scored');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].requestLabel, 'pte-describe-image-openai-vision-context');
    assert.equal(calls[0].modelId, 'gpt-5.4-mini');
    assert.equal(Boolean(calls[0].responseSchema), true);
    assert.equal(calls[1].requestLabel, 'pte-describe-image-scoring-v1');
    assert.equal(calls[1].modelId, 'gpt-audio');
    assert.equal(calls[1].responseSchema, undefined);
    assert.equal(calls[1].responseMimeType, undefined);
    const scoringUserMessage = calls[1].messages.find((row) => row.role === 'user');
    const imageParts = scoringUserMessage.content.filter((part) => part.inlineData?.mimeType?.startsWith('image/'));
    const audioParts = scoringUserMessage.content.filter((part) => part.inlineData?.mimeType?.startsWith('audio/'));
    assert.equal(imageParts.length, 0);
    assert.equal(audioParts.length, 1);
    assert.equal(result.metadata.image.imageCaption.includes('sales increasing'), true);
    assert.equal(result.metadata.provider.visualContext.modelUsed, 'gpt-5.4-mini');
    assert.equal(result.metadata.provider.tokenUsage.totalTokenCount, 60);
    assert.equal(result.metadata.technicalWarnings.some((row) => row.includes('extracted text visual context')), true);
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
    await fs.unlink(tmpImagePath).catch(() => {});
  }
});

test('OpenAI Describe Image scorer rejects non-audio OpenAI models clearly', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-describe-image-openai-model-guard-${Date.now()}.wav`);
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
    const result = await scoreDescribeImageAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_describe_image',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: {
        questionType: 'speaking_describe_image',
        payload: {
          imageCaption: 'A line chart showing sales increasing from 2020 to 2024.',
          expectedKeyPoints: ['Sales rise over time', '2024 is the highest point']
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
        audioDurationSeconds: 24
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

test('Describe Image scorer scores recovered micro evidence even when original provider JSON was malformed', async () => {
  const result = await scoreDescribeImageAttemptItem({
    session: { id: 'session-1' },
    item: {
      id: 'item-1',
      questionType: 'speaking_describe_image',
      artifactIds: ['audio-1'],
      metadata: {}
    },
    question: {
      questionType: 'speaking_describe_image',
      payload: {
        imageCaption: 'A line chart showing sales increasing from 2020 to 2024.',
        expectedKeyPoints: ['Sales rise over time', '2024 is the highest point'],
        chartType: 'line_chart'
      }
    },
    artifacts: [
      {
        id: 'audio-1',
        artifactType: 'audio',
        mimeType: 'audio/wav',
        path: '/tmp/describe-image-audio.wav'
      }
    ],
    responsePayload: {
      artifactId: 'audio-1',
      audioDurationSeconds: 24
    },
    scoringConfig: {
      contentMax: 5,
      pronunciationMax: 5,
      fluencyMax: 5
    }
  }, {
    aiAnalysis: {
      validJson: false,
      transcript: 'The chart shows sales increasing and the final year is the highest.',
      microResponses: [
        { id: 'content_main_idea', choice: 'yes', evidence: 'Mentions increasing sales.', confidence: 0.8 },
        { id: 'content_key_details', choice: 'yes', evidence: 'Mentions final year as highest.', confidence: 0.8 },
        { id: 'content_visual_accuracy', choice: 'partial', evidence: 'Image file was unavailable; caption/key points match.', confidence: 0.7 },
        { id: 'pronunciation_quality', choice: 'developing', evidence: 'Recovered from fallback evidence.', confidence: 0.6 },
        { id: 'fluency_quality', choice: 'developing', evidence: 'Recovered from fallback evidence.', confidence: 0.6 }
      ],
      speechMetrics: { estimatedWpm: 116 },
      warnings: [
        'Prompt image could not be attached to the AI request: Prompt image asset file is missing on disk.',
        'Generated Describe Image micro-rubric responses deterministically after the AI provider omitted required micro answers during recovery.',
        'Recovered Describe Image micro-rubric responses using deterministic text-context fallback.'
      ]
    },
    provider: { providerId: 'test-provider', modelUsed: 'test-model' }
  });

  assert.equal(result.status, 'scored');
  assert.equal(result.scorePayload.scoreFinal, 10);
  assert.equal(result.metadata.warnings.some((row) => row.includes('Describe Image audio analysis did not return usable micro-rubric responses')), false);
  assert.equal(result.metadata.technicalWarnings.some((row) => row.includes('Recovered Describe Image micro-rubric responses')), true);
});

test('Gemini Pro Describe Image scorer retries malformed structured JSON before transcript-only recovery', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-describe-image-pro-malformed-${Date.now()}.webm`);
  await fs.writeFile(tmpAudioPath, Buffer.from('fake-audio'));
  const calls = [];

  pteAiProviderDataService.resolveRuntimeProvider = async () => ({
    providerId: 'google-gemini',
    modelId: 'gemini-3-pro',
    credentials: {},
    providerRecord: {
      id: 'PROVIDER-GEMINI-3-PRO',
      name: 'Gemini 3 Pro'
    }
  });
  pteAiProviderService.sendPrompt = async (payload) => {
    calls.push(payload);
    if (calls.length === 1) {
      return {
        provider: 'google-gemini',
        modelUsed: 'gemini-3-pro',
        text: '```json\n{ "transcript": "The image shows export volume by country in year twenty twenty four.\n',
        usage: { promptTokenCount: 20, candidatesTokenCount: 8, totalTokenCount: 28 }
      };
    }
    return {
      provider: 'google-gemini',
      modelUsed: 'gemini-3-pro',
      text: '{"transcript":"The image shows export volume by country in year twenty twenty four.","microResponses":[{"id":"content_main_idea","choice":"yes","evidence":"main idea","confidence":0.84},{"id":"content_key_details","choice":"partial","evidence":"some key details","confidence":0.84},{"id":"content_visual_accuracy","choice":"yes","evidence":"accurate","confidence":0.84},{"id":"pronunciation_quality","choice":"good","evidence":"clear","confidence":0.84},{"id":"fluency_quality","choice":"developing","evidence":"some hesitation","confidence":0.84}],"content":{"score":1},"pronunciation":{"score":1},"fluency":{"score":1},"speechMetrics":{"estimatedWpm":112},"confidence":0.84,"warnings":[]}',
      usage: { promptTokenCount: 26, candidatesTokenCount: 10, totalTokenCount: 36 }
    };
  };

  try {
    const result = await scoreDescribeImageAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_describe_image',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: {
        questionType: 'speaking_describe_image',
        payload: {
          imageCaption: 'A bar chart showing export volume by country in 2024.',
          expectedKeyPoints: ['Export volume varies by country', 'The highest country should be identified'],
          chartType: 'bar_chart'
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
        audioDurationSeconds: 24
      },
      scoringConfig: {
        contentMax: 5,
        pronunciationMax: 5,
        fluencyMax: 5
      }
    }, {});

    assert.equal(result.status, 'scored');
    assert.equal(calls.length, 2);
    assert.equal(Boolean(calls[0].responseSchema), true);
    assert.equal(calls[1].responseSchema, undefined);
    assert.equal(calls[1].requestLabel, 'pte-describe-image-scoring-v1-gemini-json-retry');
    assert.equal(result.metadata.transcript, 'The image shows export volume by country in year twenty twenty four.');
    assert.equal(result.scorePayload.scoreFinal, 11);
    assert.equal(result.metadata.provider.tokenUsage.totalTokenCount, 64);
    assert.equal(result.metadata.technicalWarnings.some((row) => row.includes('looser JSON-only request')), true);
    assert.equal(result.metadata.warnings.some((row) => row.includes('audio-only follow-up')), false);
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
  }
});

test('Gemini Pro Describe Image scorer retries capacity errors and falls back to Flash', async () => {
  const tmpAudioPath = path.join(os.tmpdir(), `pte-describe-image-pro-capacity-${Date.now()}.webm`);
  await fs.writeFile(tmpAudioPath, Buffer.from('fake-audio'));
  process.env.PTE_SCORING_GEMINI_CAPACITY_RETRY_DELAY_MS = '0';
  const calls = [];

  pteAiProviderDataService.resolveRuntimeProvider = async () => ({
    providerId: 'google-gemini',
    modelId: 'gemini-2.5-pro',
    credentials: {},
    providerRecord: {
      id: 'PROVIDER-PRO',
      name: 'Gemini Pro'
    }
  });
  pteAiProviderService.sendPrompt = async (payload) => {
    calls.push(payload);
    if (calls.length <= 2) {
      const error = new Error('[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent: [503 Service Unavailable] This model is currently experiencing high demand. Please try again later.');
      error.code = 503;
      throw error;
    }
    return {
      provider: 'google-gemini',
      modelUsed: 'gemini-2.5-flash',
      text: '{"transcript":"The chart shows sales increasing steadily.","microResponses":[{"id":"content_main_idea","choice":"yes","evidence":"main trend","confidence":0.88},{"id":"content_key_details","choice":"partial","evidence":"some detail","confidence":0.88},{"id":"content_visual_accuracy","choice":"yes","evidence":"accurate","confidence":0.88},{"id":"pronunciation_quality","choice":"good","evidence":"clear","confidence":0.88},{"id":"fluency_quality","choice":"good","evidence":"steady","confidence":0.88}],"content":{"score":1},"pronunciation":{"score":1},"fluency":{"score":1},"speechMetrics":{"estimatedWpm":115},"confidence":0.88,"warnings":[]}',
      usage: { promptTokenCount: 30, candidatesTokenCount: 10, totalTokenCount: 40 }
    };
  };

  try {
    const result = await scoreDescribeImageAttemptItem({
      session: { id: 'session-1' },
      item: {
        id: 'item-1',
        questionType: 'speaking_describe_image',
        artifactIds: ['audio-1'],
        metadata: {}
      },
      question: {
        questionType: 'speaking_describe_image',
        payload: {
          imageCaption: 'A chart showing sales increasing over time.',
          expectedKeyPoints: ['Sales rise over time', 'Final period is highest'],
          chartType: 'line_chart'
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
        audioDurationSeconds: 25
      },
      scoringConfig: {
        contentMax: 5,
        pronunciationMax: 5,
        fluencyMax: 5
      }
    }, {});

    assert.equal(result.status, 'scored');
    assert.equal(calls.length, 3);
    assert.equal(calls[0].modelId, 'gemini-2.5-pro');
    assert.equal(calls[1].modelId, 'gemini-2.5-pro');
    assert.equal(calls[2].modelId, 'gemini-2.5-flash');
    assert.equal(result.metadata.provider.modelUsed, 'gemini-2.5-flash');
    assert.equal(result.scorePayload.scoreFinal, 12);
    assert.equal(result.metadata.technicalWarnings.some((row) => row.includes('temporary capacity error')), true);
    assert.equal(result.metadata.technicalWarnings.some((row) => row.includes('switched this request to gemini-2.5-flash')), true);
  } finally {
    await fs.unlink(tmpAudioPath).catch(() => {});
  }
});

test('Scoring engine supports Describe Image in v1', async () => {
  assert.equal(scoringEngineService.isAutoScoringSupported('speaking_read_aloud'), true);
  assert.equal(scoringEngineService.isAutoScoringSupported('speaking_answer_short_question'), true);
  assert.equal(scoringEngineService.isAutoScoringSupported('speaking_describe_image'), true);
});
