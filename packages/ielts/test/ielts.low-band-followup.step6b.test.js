const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const step3ScoringService = require('../packages/ielts/MVC/services/ielts/step3ScoringService');
const step5FeedbackService = require('../packages/ielts/MVC/services/ielts/step5FeedbackService');
const aiService = require('../packages/ielts/MVC/services/ielts/aiService');
const { scoringRules } = require('../packages/ielts/MVC/services/ielts/scoringRules');

function createRestoreStack() {
  const restorers = [];
  return {
    stub(target, methodName, replacement) {
      const original = target[methodName];
      target[methodName] = replacement;
      restorers.push(() => {
        target[methodName] = original;
      });
    },
    restoreAll() {
      while (restorers.length) {
        const restore = restorers.pop();
        restore();
      }
    }
  };
}

function extractFunctionSource(source, functionName) {
  const signature = `function ${functionName}`;
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`Function ${functionName} not found`);
  const open = source.indexOf('{', start);
  if (open < 0) throw new Error(`Function ${functionName} opening brace not found`);

  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Function ${functionName} closing brace not found`);
}

function loadClientBandCalculator() {
  const filePath = path.join(process.cwd(), 'MVC', 'views', 'ielts', 'scoringV0326.ejs');
  const source = fs.readFileSync(filePath, 'utf8');
  const script = [
    extractFunctionSource(source, 'normalizeVoteValue'),
    extractFunctionSource(source, 'isEvaluableMicroAnswer'),
    extractFunctionSource(source, 'isSupportiveMicroAnswer'),
    extractFunctionSource(source, 'normalizeGateBandValue'),
    extractFunctionSource(source, 'getAvailableBandGates'),
    extractFunctionSource(source, 'calculateBandScoresClient'),
    'module.exports = { calculateBandScoresClient };'
  ].join('\n\n');
  const mod = { exports: {} };
  const fn = new Function('module', 'exports', script);
  fn(mod, mod.exports);
  return mod.exports.calculateBandScoresClient;
}

function buildSparseEssay() {
  return {
    normalizedText: 'I agree with the statement and provide support.',
    paragraphs: [
      { paragraphNumber: 1, text: 'I agree with the statement.' },
      { paragraphNumber: 2, text: 'Support is given with examples.' }
    ],
    sentences: [
      { index: 0, paragraphIndex: 0, paragraphNumber: 1, text: 'I agree with the statement.' },
      { index: 1, paragraphIndex: 1, paragraphNumber: 2, text: 'Support is given with examples.' }
    ],
    stats: {
      wordCount: 180,
      sentenceCount: 2,
      paragraphCount: 2,
      charCount: 90
    }
  };
}

function buildSparseStep2() {
  return {
    structure: {
      paragraphRoles: ['intro', 'body'],
      paragraphSentenceCounts: [1, 1],
      hasIntro: true,
      hasConclusion: false,
      paragraphCount: 2
    },
    perParagraphFeatures: [
      { paragraphIndex: 0, paragraphNumber: 1, role: 'intro', sentenceCount: 1 },
      { paragraphIndex: 1, paragraphNumber: 2, role: 'body', sentenceCount: 1 }
    ],
    lexical: { topRepeatedWords: [] },
    cohesion: { densityPer100: '2.00' }
  };
}

function buildSparseExtraction() {
  return {
    answersBySubquestion: {
      q1: [0],
      q2: [1]
    },
    position: {
      stance: 'agree',
      stanceSentenceIndex: 0,
      contradictionSentenceIndices: []
    }
  };
}

function buildFollowupEssayAndAnalysis() {
  return {
    essayObj: {
      normalizedText: 'The response has clear stance and developed body paragraphs.',
      paragraphs: [
        { paragraphNumber: 1, text: 'I strongly agree.' },
        { paragraphNumber: 2, text: 'First body paragraph has a clear topic and explanation.' },
        { paragraphNumber: 3, text: 'Second body paragraph has clear development and support.' },
        { paragraphNumber: 4, text: 'In conclusion, the position remains clear.' }
      ],
      sentences: [
        { index: 0, paragraphIndex: 0, paragraphNumber: 1, text: 'I strongly agree.' },
        { index: 1, paragraphIndex: 0, paragraphNumber: 1, text: 'This thesis answers the prompt directly.' },
        { index: 2, paragraphIndex: 1, paragraphNumber: 2, text: 'First body paragraph has a clear topic.' },
        { index: 3, paragraphIndex: 1, paragraphNumber: 2, text: 'It explains the idea with support.' },
        { index: 4, paragraphIndex: 1, paragraphNumber: 2, text: 'The example is relevant.' },
        { index: 5, paragraphIndex: 1, paragraphNumber: 2, text: 'This strengthens coherence.' },
        { index: 6, paragraphIndex: 2, paragraphNumber: 3, text: 'Second body paragraph has clear development.' },
        { index: 7, paragraphIndex: 2, paragraphNumber: 3, text: 'The explanation is logical.' },
        { index: 8, paragraphIndex: 2, paragraphNumber: 3, text: 'Supporting details are provided.' },
        { index: 9, paragraphIndex: 2, paragraphNumber: 3, text: 'The paragraph stays on topic.' },
        { index: 10, paragraphIndex: 3, paragraphNumber: 4, text: 'In conclusion, the position remains clear.' },
        { index: 11, paragraphIndex: 3, paragraphNumber: 4, text: 'Therefore the argument is coherent overall.' }
      ],
      stats: {
        wordCount: 225,
        sentenceCount: 12,
        paragraphCount: 4,
        charCount: 370
      }
    },
    step2Features: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 4, 4, 2],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, paragraphNumber: 1, role: 'intro', sentenceCount: 2 },
        { paragraphIndex: 1, paragraphNumber: 2, role: 'body', sentenceCount: 4 },
        { paragraphIndex: 2, paragraphNumber: 3, role: 'body', sentenceCount: 4 },
        { paragraphIndex: 3, paragraphNumber: 4, role: 'conclusion', sentenceCount: 2 }
      ],
      lexical: { topRepeatedWords: [] },
      cohesion: { densityPer100: '4.80' }
    },
    extraction: {
      answersBySubquestion: {
        q1: [1, 2],
        q2: [5, 6]
      },
      position: {
        stance: 'agree',
        stanceSentenceIndex: 0,
        contradictionSentenceIndices: []
      },
      topicSentenceByParagraph: [
        { paragraphIndex: 1, topicSentenceIndex: 2 },
        { paragraphIndex: 2, topicSentenceIndex: 6 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [2, 3] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [6, 7] }
      ]
    }
  };
}

function createAiStubForFollowup(calls) {
  return async (messages, modelId) => {
    const prompt = String(messages?.[0]?.content || '');
    const ids = Array.from(prompt.matchAll(/ID:\s*([^\r\n]+)/g)).map((m) => String(m[1] || '').trim());
    const payload = {};
    for (const id of ids) {
      if (id.startsWith('CC3-2::')) payload[id] = { value: 'Yes', evidence: [1] };
      else payload[id] = { value: 'No', evidence: [] };
    }
    calls.push({ modelId, ids });
    return {
      text: JSON.stringify(payload),
      modelUsed: modelId || 'stub-model',
      usage: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
      requestMeta: { provider: 'stub', providerId: 'stub', modelId: modelId || 'stub-model' }
    };
  };
}

test('sparse-band progression only evaluates real gates and keeps backend/client parity', async () => {
  const calculateBandScoresClient = loadClientBandCalculator();

  const sparseResult = await step3ScoringService.runStep3Scoring({
    essayObj: buildSparseEssay(),
    step2Features: buildSparseStep2(),
    extraction: buildSparseExtraction(),
    microAssessments: [
      {
        baseKey: 'TR2-2',
        is_active: true,
        scope: 'essay',
        criterion: 'TR',
        band: 2,
        answer_type: 'Boolean',
        polarity: 'FAULT_CHECK'
      },
      {
        baseKey: 'TR4-1',
        is_active: true,
        scope: 'essay',
        criterion: 'TR',
        band: 4,
        answer_type: 'Boolean',
        polarity: 'FAULT_CHECK'
      }
    ],
    taskPrompt: 'Discuss both views and give your opinion.',
    options: {
      modelId: 'stub-model',
      disableCache: true
    }
  });

  assert.equal(sparseResult.scores.TR, 4, 'TR should stop at highest evaluated gate, not auto-advance to 9');
  const clientScore = calculateBandScoresClient(sparseResult.aggregatedResults);
  assert.equal(clientScore.criteria.TR, sparseResult.scores.TR);
  assert.equal(clientScore.overall, sparseResult.overallBand);
});

test('step5 feedback fallback uses both atomic_question and atomicQuestion text consistently', async () => {
  const stack = createRestoreStack();
  stack.stub(aiService, 'sendMessage', async () => {
    throw new Error('Force deterministic fallback for text normalization test');
  });

  try {
    const feedback = await step5FeedbackService.generateFeedback(
      {
        normalizedText: 'Short essay text.',
        sentences: [
          { index: 0, paragraphNumber: 1, paragraphIndex: 0, text: 'Sentence one.' },
          { index: 1, paragraphNumber: 1, paragraphIndex: 0, text: 'Sentence two.' }
        ]
      },
      {
        overallBand: 3,
        aggregatedResults: [
          {
            criterion: 'TR',
            band: 3,
            baseKey: 'TR3-2',
            atomicQuestion: 'Camel-case weakness text',
            value: 'Yes',
            polarity: 'FAULT_CHECK',
            evidenceSentenceIndices: [0],
            source: 'deterministic',
            weight: 1
          },
          {
            criterion: 'CC',
            band: 3,
            baseKey: 'CC3-2',
            atomic_question: 'Snake-case weakness text',
            value: 'Yes',
            polarity: 'FAULT_CHECK',
            evidenceSentenceIndices: [1],
            source: 'ai',
            weight: 1
          },
          {
            criterion: 'LR',
            band: 3,
            baseKey: 'LR3-1',
            atomicQuestion: 'Camel-case strength text',
            value: 'No',
            polarity: 'FAULT_CHECK',
            evidenceSentenceIndices: [],
            source: 'ai',
            weight: 1
          }
        ]
      },
      {
        modelId: 'stub-model'
      }
    );

    const issues = (feedback.improvements || []).map((x) => String(x.issue || ''));
    assert.ok(issues.some((txt) => txt.includes('Camel-case weakness text')));
    assert.ok(issues.some((txt) => txt.includes('Snake-case weakness text')));
    assert.ok((feedback.strengths || []).some((txt) => String(txt).includes('Camel-case strength text')));
  } finally {
    stack.restoreAll();
  }
});

test('new conservative low-band deterministic rules run while unsupported low-band items still fallback to AI', async () => {
  const stack = createRestoreStack();
  const calls = [];
  stack.stub(aiService, 'sendMessage', createAiStubForFollowup(calls));

  const { essayObj, step2Features, extraction } = buildFollowupEssayAndAnalysis();

  try {
    const result = await step3ScoringService.runStep3Scoring({
      essayObj,
      step2Features,
      extraction,
      microAssessments: [
        {
          baseKey: 'TR2-3A',
          is_active: true,
          scope: 'essay',
          criterion: 'TR',
          band: 2,
          answer_type: 'Boolean',
          polarity: 'FAULT_CHECK',
          atomic_question: 'Are there only one or two ideas across the whole response?'
        },
        {
          baseKey: 'CC2-1A',
          is_active: true,
          scope: 'essay',
          criterion: 'CC',
          band: 2,
          answer_type: 'Boolean',
          polarity: 'FAULT_CHECK',
          atomic_question: 'Is there very little overall control of organisational features across the response?'
        },
        {
          baseKey: 'CC2-1B',
          is_active: true,
          scope: 'paragraph',
          paragraphRoleConstraint: 'body',
          criterion: 'CC',
          band: 2,
          answer_type: 'Boolean',
          polarity: 'FAULT_CHECK',
          atomic_question: 'Does this body paragraph show very little control of organisational features?'
        },
        {
          baseKey: 'CC3-2',
          is_active: true,
          scope: 'paragraph',
          paragraphRoleConstraint: 'body',
          criterion: 'CC',
          band: 3,
          answer_type: 'Boolean',
          polarity: 'FAULT_CHECK',
          atomic_question: 'Is the range of cohesive devices very limited?'
        },
        {
          baseKey: 'CC3-9Z',
          is_active: true,
          scope: 'essay',
          criterion: 'CC',
          band: 3,
          answer_type: 'Boolean',
          polarity: 'FAULT_CHECK',
          atomic_question: 'Unsupported calibration probe'
        }
      ],
      taskPrompt: 'Discuss both views and give your opinion.',
      options: {
        modelId: 'stub-model',
        disableCache: true
      }
    });

    const tr23a = result.results.find((row) => row.baseKey === 'TR2-3A');
    assert.ok(tr23a);
    assert.equal(tr23a.source, 'deterministic');

    const cc21a = result.results.find((row) => row.baseKey === 'CC2-1A');
    assert.ok(cc21a);
    assert.equal(cc21a.source, 'deterministic');

    const cc21bRows = result.results.filter((row) => row.baseKey === 'CC2-1B');
    assert.ok(cc21bRows.length >= 2);
    assert.ok(cc21bRows.every((row) => row.source === 'deterministic'));

    const cc32Rows = result.results.filter((row) => row.baseKey === 'CC3-2');
    assert.ok(cc32Rows.length >= 2);
    assert.ok(cc32Rows.every((row) => row.source === 'deterministic' || String(row.source || '').startsWith('ai')));
    assert.ok(cc32Rows.some((row) => row.source === 'deterministic'));

    const cc32Agg = result.aggregatedResults.filter((row) => row.baseKey === 'CC3-2');
    assert.equal(cc32Agg.length, 1);
    assert.equal(cc32Agg[0].source, 'aggregate');

    const cc39zRows = result.results.filter((row) => row.baseKey === 'CC3-9Z');
    assert.equal(cc39zRows.length, 1);
    assert.ok(String(cc39zRows[0].source || '').startsWith('ai'));
    assert.ok(calls.length >= 1);
  } finally {
    stack.restoreAll();
  }
});

function loadMidbandRows(keys) {
  const bankPath = path.join(process.cwd(), 'data', 'ielts', 'microAssessments.json');
  const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
  return keys
    .map((key) => bank.find((row) => String(row?.question_key || row?.baseKey || '').trim() === key))
    .filter(Boolean)
    .map((row) => ({ ...row }));
}

function buildMidbandWeakEssay() {
  return {
    normalizedText: 'This essay addresses the topic in a limited way with repeated points and weak development.',
    paragraphs: [
      { paragraphNumber: 1, text: 'This essay gives a basic opinion.' },
      { paragraphNumber: 2, text: 'The first body idea is short and not explained.' },
      { paragraphNumber: 3, text: 'The second paragraph repeats earlier points.' }
    ],
    sentences: [
      { index: 0, paragraphIndex: 0, paragraphNumber: 1, text: 'This essay gives a basic opinion.' },
      { index: 1, paragraphIndex: 1, paragraphNumber: 2, text: 'The first body idea is short.' },
      { index: 2, paragraphIndex: 1, paragraphNumber: 2, text: 'It is not clearly developed.' },
      { index: 3, paragraphIndex: 2, paragraphNumber: 3, text: 'The second paragraph repeats earlier points.' },
      { index: 4, paragraphIndex: 2, paragraphNumber: 3, text: 'Linking is limited and mechanical.' }
    ],
    stats: {
      wordCount: 225,
      sentenceCount: 5,
      paragraphCount: 3,
      charCount: 220
    }
  };
}

function buildMidbandWeakStep2() {
  return {
    structure: {
      paragraphRoles: ['intro', 'body', 'body'],
      paragraphSentenceCounts: [1, 2, 2],
      hasIntro: true,
      hasConclusion: false,
      paragraphCount: 3
    },
    perParagraphFeatures: [
      { paragraphIndex: 0, paragraphNumber: 1, role: 'intro', sentenceCount: 1 },
      { paragraphIndex: 1, paragraphNumber: 2, role: 'body', sentenceCount: 2 },
      { paragraphIndex: 2, paragraphNumber: 3, role: 'body', sentenceCount: 2 }
    ],
    cohesion: {
      densityPer100ExcludingBasic: '0.90',
      distinctConnectorsExcludingBasic: 1,
      usageMapExcludingBasic: { however: 4 }
    },
    lexical: {
      referencingDensity: '0.80',
      topRepeatedWords: [{ word: 'people', count: 9 }, { word: 'society', count: 6 }]
    }
  };
}

function buildMidbandWeakExtraction() {
  return {
    answersBySubquestion: {
      partA: [1],
      partB: []
    },
    position: {
      stance: 'agree',
      stanceSentenceIndex: 0,
      contradictionSentenceIndices: []
    },
    topicSentenceByParagraph: [
      { paragraphIndex: 0, topicSentenceIndex: 0 },
      { paragraphIndex: 1, topicSentenceIndex: 1 },
      { paragraphIndex: 2, topicSentenceIndex: null }
    ],
    bodySupport: [
      { paragraphIndex: 1, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [1] },
      { paragraphIndex: 2, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [3] }
    ]
  };
}

function buildMidbandStrongEssay() {
  return {
    normalizedText: 'This response addresses all prompt parts with clear progression and developed support.',
    paragraphs: [
      { paragraphNumber: 1, text: 'I agree and will discuss both parts.' },
      { paragraphNumber: 2, text: 'First body paragraph develops the first task part with explanation and example.' },
      { paragraphNumber: 3, text: 'Second body paragraph develops the second task part with explanation and example.' },
      { paragraphNumber: 4, text: 'In conclusion, the argument is restated clearly.' }
    ],
    sentences: [
      { index: 0, paragraphIndex: 0, paragraphNumber: 1, text: 'I agree and will discuss both parts.' },
      { index: 1, paragraphIndex: 0, paragraphNumber: 1, text: 'The position is explicit from the start.' },
      { index: 2, paragraphIndex: 1, paragraphNumber: 2, text: 'First body paragraph develops the first task part.' },
      { index: 3, paragraphIndex: 1, paragraphNumber: 2, text: 'It includes explanation and a concrete example.' },
      { index: 4, paragraphIndex: 1, paragraphNumber: 2, text: 'This point stays focused on the task.' },
      { index: 5, paragraphIndex: 2, paragraphNumber: 3, text: 'Second body paragraph develops the second task part.' },
      { index: 6, paragraphIndex: 2, paragraphNumber: 3, text: 'It includes explanation and a concrete example.' },
      { index: 7, paragraphIndex: 2, paragraphNumber: 3, text: 'This point also stays focused on the task.' },
      { index: 8, paragraphIndex: 3, paragraphNumber: 4, text: 'In conclusion, the argument is restated clearly.' },
      { index: 9, paragraphIndex: 3, paragraphNumber: 4, text: 'Overall progression remains easy to follow.' }
    ],
    stats: {
      wordCount: 272,
      sentenceCount: 10,
      paragraphCount: 4,
      charCount: 460
    }
  };
}

function buildMidbandStrongStep2() {
  return {
    structure: {
      paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
      paragraphSentenceCounts: [2, 3, 3, 2],
      hasIntro: true,
      hasConclusion: true,
      paragraphCount: 4
    },
    perParagraphFeatures: [
      { paragraphIndex: 0, paragraphNumber: 1, role: 'intro', sentenceCount: 2 },
      { paragraphIndex: 1, paragraphNumber: 2, role: 'body', sentenceCount: 3 },
      { paragraphIndex: 2, paragraphNumber: 3, role: 'body', sentenceCount: 3 },
      { paragraphIndex: 3, paragraphNumber: 4, role: 'conclusion', sentenceCount: 2 }
    ],
    cohesion: {
      densityPer100ExcludingBasic: '1.80',
      distinctConnectorsExcludingBasic: 4,
      usageMapExcludingBasic: { however: 2, therefore: 1, moreover: 1, consequently: 1 }
    },
    lexical: {
      referencingDensity: '1.80',
      topRepeatedWords: [{ word: 'education', count: 4 }, { word: 'students', count: 3 }]
    }
  };
}

function buildMidbandStrongExtraction() {
  return {
    answersBySubquestion: {
      partA: [2, 3],
      partB: [5, 6]
    },
    position: {
      stance: 'agree',
      stanceSentenceIndex: 0,
      contradictionSentenceIndices: []
    },
    topicSentenceByParagraph: [
      { paragraphIndex: 0, topicSentenceIndex: 0 },
      { paragraphIndex: 1, topicSentenceIndex: 2 },
      { paragraphIndex: 2, topicSentenceIndex: 5 },
      { paragraphIndex: 3, topicSentenceIndex: 8 }
    ],
    bodySupport: [
      { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [2, 3] },
      { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [5, 6] }
    ]
  };
}

test('step4 built-in prompt is rubric-neutral and free from high-band coaching anchors', async () => {
  const preview = await step3ScoringService.buildStep4PromptPreview({
    essayObj: buildMidbandWeakEssay(),
    step2Features: buildMidbandWeakStep2(),
    extraction: buildMidbandWeakExtraction(),
    microAssessments: [
      {
        baseKey: 'ZZ-PROMPT-CHECK',
        question_key: 'ZZ-PROMPT-CHECK',
        criterion: 'TR',
        band: 5,
        answer_type: 'Boolean',
        polarity: 'FEATURE_CHECK',
        scope: 'essay',
        is_active: true,
        atomic_question: 'Prompt neutrality check',
        rubric_anchor: 'Prompt neutrality check anchor'
      }
    ],
    taskPrompt: 'Discuss both views and give your opinion.',
    options: { modelId: 'stub-model', disableCache: true }
  });

  assert.ok(Array.isArray(preview.prompts));
  assert.ok(preview.prompts.length >= 1);
  const prompt = String(preview.prompts[0] || '');
  assert.ok(!prompt.includes('Do not punish a Band 7 essay for not being Band 9.'));
  assert.ok(!/Band 7 essay/i.test(prompt));
  assert.ok(prompt.includes('Do not over-credit visible stance statements, paragraph breaks, or connector words'));
  assert.ok(prompt.includes('Repetition and weak referencing/substitution should count against cohesion and clarity'));
});

test('band-5-like weak TR/CC profile does not inflate to high TR/CC bands', async () => {
  const keys = ['TR4-1', 'TR5-1', 'TR6-1', 'TR6-2', 'TR6-7', 'CC5-2', 'CC5-6', 'CC6-1', 'CC6-3', 'CC6-4', 'CC6-5'];
  const result = await step3ScoringService.runStep3Scoring({
    essayObj: buildMidbandWeakEssay(),
    step2Features: buildMidbandWeakStep2(),
    extraction: buildMidbandWeakExtraction(),
    microAssessments: loadMidbandRows(keys),
    taskPrompt: 'Discuss both views and give your opinion.',
    options: { modelId: 'stub-model', disableCache: true }
  });

  assert.ok(Number.isFinite(result?.scores?.TR));
  assert.ok(Number.isFinite(result?.scores?.CC));
  assert.ok(result.scores.TR <= 6, `Expected TR <= 6 for weak profile, got ${result.scores.TR}`);
  assert.ok(result.scores.CC <= 6, `Expected CC <= 6 for weak profile, got ${result.scores.CC}`);
});

test('strong TR/CC profile keeps plausible high-band path after recalibration', async () => {
  const keys = ['TR4-1', 'TR5-1', 'TR6-1', 'TR6-2', 'TR6-7', 'CC5-2', 'CC5-6', 'CC6-1', 'CC6-3', 'CC6-4', 'CC6-5'];
  const result = await step3ScoringService.runStep3Scoring({
    essayObj: buildMidbandStrongEssay(),
    step2Features: buildMidbandStrongStep2(),
    extraction: buildMidbandStrongExtraction(),
    microAssessments: loadMidbandRows(keys),
    taskPrompt: 'Discuss both views and give your opinion.',
    options: { modelId: 'stub-model', disableCache: true }
  });

  assert.ok(Number.isFinite(result?.scores?.TR));
  assert.ok(Number.isFinite(result?.scores?.CC));
  assert.ok(result.scores.TR >= 6, `Expected TR >= 6 for strong profile, got ${result.scores.TR}`);
  assert.ok(result.scores.CC >= 6, `Expected CC >= 6 for strong profile, got ${result.scores.CC}`);
});

test('underlength alone does not auto-trigger TR5-1 partial-coverage fault when coverage is strong', () => {
  const value = scoringRules['TR5-1']({
    step1: { stats: { wordCount: 235 } },
    step25: {
      answersBySubquestion: {
        partA: [2, 3],
        partB: [5, 6]
      },
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [2, 3] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [5, 6] }
      ]
    }
  });

  assert.equal(value, 'No');
});

