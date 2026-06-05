const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const step3ScoringService = require('../packages/ielts/MVC/services/ielts/step3ScoringService');
const step5FeedbackService = require('../packages/ielts/MVC/services/ielts/step5FeedbackService');
const aiService = require('../packages/ielts/MVC/services/ielts/aiService');

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
  if (start < 0) {
    throw new Error(`Function ${functionName} not found in scoringV0326.ejs`);
  }

  const firstBrace = source.indexOf('{', start);
  if (firstBrace < 0) {
    throw new Error(`Function ${functionName} has no opening brace`);
  }

  let depth = 0;
  for (let i = firstBrace; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (depth === 0) {
      return source.slice(start, i + 1);
    }
  }

  throw new Error(`Function ${functionName} closing brace not found`);
}

function loadClientBandCalculator() {
  const filePath = path.join(process.cwd(), 'MVC', 'views', 'ielts', 'scoringV0326.ejs');
  const source = fs.readFileSync(filePath, 'utf8');
  const snippet = [
    extractFunctionSource(source, 'normalizeVoteValue'),
    extractFunctionSource(source, 'isEvaluableMicroAnswer'),
    extractFunctionSource(source, 'isSupportiveMicroAnswer'),
    extractFunctionSource(source, 'normalizeGateBandValue'),
    extractFunctionSource(source, 'getAvailableBandGates'),
    extractFunctionSource(source, 'calculateBandScoresClient'),
    'module.exports = { calculateBandScoresClient };'
  ].join('\n\n');

  const mod = { exports: {} };
  const fn = new Function('module', 'exports', snippet);
  fn(mod, mod.exports);
  return mod.exports.calculateBandScoresClient;
}

function buildWeakEssay() {
  return {
    normalizedText: 'This essay is short and unclear. Ideas are limited. It is repetitive.',
    paragraphs: [
      { paragraphNumber: 1, text: 'This essay is short and unclear.' },
      { paragraphNumber: 2, text: 'Ideas are limited. It is repetitive.' }
    ],
    sentences: [
      { index: 0, paragraphIndex: 0, paragraphNumber: 1, text: 'This essay is short and unclear.' },
      { index: 1, paragraphIndex: 1, paragraphNumber: 2, text: 'Ideas are limited.' },
      { index: 2, paragraphIndex: 1, paragraphNumber: 2, text: 'It is repetitive.' }
    ],
    stats: {
      wordCount: 90,
      sentenceCount: 3,
      paragraphCount: 2,
      charCount: 120
    }
  };
}

function buildStrongEssay() {
  return {
    normalizedText: 'This response presents a clear position and develops ideas across multiple paragraphs with support.',
    paragraphs: [
      { paragraphNumber: 1, text: 'I agree that structured education improves outcomes.' },
      { paragraphNumber: 2, text: 'First, access to guided practice improves understanding and retention.' },
      { paragraphNumber: 3, text: 'Second, collaboration and feedback improve critical thinking.' },
      { paragraphNumber: 4, text: 'Overall, the position remains clear and the argument is coherent.' }
    ],
    sentences: [
      { index: 0, paragraphIndex: 0, paragraphNumber: 1, text: 'I agree that structured education improves outcomes.' },
      { index: 1, paragraphIndex: 1, paragraphNumber: 2, text: 'First, access to guided practice improves understanding and retention.' },
      { index: 2, paragraphIndex: 1, paragraphNumber: 2, text: 'This leads to better long-term performance.' },
      { index: 3, paragraphIndex: 2, paragraphNumber: 3, text: 'Second, collaboration and feedback improve critical thinking.' },
      { index: 4, paragraphIndex: 2, paragraphNumber: 3, text: 'Learners refine their ideas through discussion.' },
      { index: 5, paragraphIndex: 3, paragraphNumber: 4, text: 'Overall, the position remains clear and the argument is coherent.' },
      { index: 6, paragraphIndex: 3, paragraphNumber: 4, text: 'Therefore, the benefits outweigh the drawbacks in most contexts.' },
      { index: 7, paragraphIndex: 0, paragraphNumber: 1, text: 'This essay directly answers the prompt requirements.' },
      { index: 8, paragraphIndex: 1, paragraphNumber: 2, text: 'The main point is consistently maintained.' },
      { index: 9, paragraphIndex: 2, paragraphNumber: 3, text: 'Examples are linked to claims.' },
      { index: 10, paragraphIndex: 3, paragraphNumber: 4, text: 'The final paragraph synthesizes the argument.' },
      { index: 11, paragraphIndex: 1, paragraphNumber: 2, text: 'Transitions are used effectively.' },
      { index: 12, paragraphIndex: 2, paragraphNumber: 3, text: 'Vocabulary remains varied and precise.' }
    ],
    stats: {
      wordCount: 270,
      sentenceCount: 13,
      paragraphCount: 4,
      charCount: 460
    }
  };
}

function buildWeakStep2() {
  return {
    structure: {
      paragraphRoles: ['intro', 'body'],
      paragraphSentenceCounts: [1, 2],
      hasIntro: true,
      hasConclusion: false,
      paragraphCount: 2
    },
    perParagraphFeatures: [
      { paragraphIndex: 0, paragraphNumber: 1, role: 'intro', sentenceCount: 1 },
      { paragraphIndex: 1, paragraphNumber: 2, role: 'body', sentenceCount: 2 }
    ],
    lexical: {
      topRepeatedWords: [
        { word: 'education', count: 10 }
      ]
    },
    cohesion: { densityPer100: '1.00' }
  };
}

function buildStrongStep2() {
  return {
    structure: {
      paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
      paragraphSentenceCounts: [2, 3, 3, 5],
      hasIntro: true,
      hasConclusion: true,
      paragraphCount: 4
    },
    perParagraphFeatures: [
      { paragraphIndex: 0, paragraphNumber: 1, role: 'intro', sentenceCount: 2 },
      { paragraphIndex: 1, paragraphNumber: 2, role: 'body', sentenceCount: 3 },
      { paragraphIndex: 2, paragraphNumber: 3, role: 'body', sentenceCount: 3 },
      { paragraphIndex: 3, paragraphNumber: 4, role: 'conclusion', sentenceCount: 5 }
    ],
    lexical: {
      topRepeatedWords: [
        { word: 'education', count: 3 }
      ]
    },
    cohesion: { densityPer100: '5.20', densityPer100ExcludingBasic: '4.10' }
  };
}

function buildWeakExtraction() {
  return {
    answersBySubquestion: {},
    position: {
      stance: null,
      stanceSentenceIndex: null,
      contradictionSentenceIndices: []
    },
    topicSentenceByParagraph: [
      { paragraphIndex: 0, topicSentenceIndex: null },
      { paragraphIndex: 1, topicSentenceIndex: null }
    ],
    bodySupport: [
      { paragraphIndex: 1, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [1] }
    ],
    errorProfiles: {
      grammar: 'frequent',
      punctuation: 'frequent'
    }
  };
}

function buildStrongExtraction() {
  return {
    answersBySubquestion: {
      q1: [1, 2],
      q2: [3, 4]
    },
    position: {
      stance: 'agree',
      stanceSentenceIndex: 0,
      contradictionSentenceIndices: []
    },
    topicSentenceByParagraph: [
      { paragraphIndex: 1, topicSentenceIndex: 1 },
      { paragraphIndex: 2, topicSentenceIndex: 3 }
    ],
    bodySupport: [
      { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [1, 2] },
      { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [3, 4] }
    ],
    errorProfiles: {
      grammar: 'rare',
      punctuation: 'rare'
    },
    lexicalQuality: {
      range: 'wide'
    }
  };
}

function buildLowBandMicroAssessments() {
  return [
    {
      baseKey: 'TR2-2',
      is_active: true,
      scope: 'essay',
      criterion: 'TR',
      band: 2,
      answer_type: 'Boolean',
      polarity: 'FAULT_CHECK',
      atomic_question: 'Is no position expressed?',
      rubric_anchor: 'Band 2 position requirement'
    },
    {
      baseKey: 'TR3-2',
      is_active: true,
      scope: 'essay',
      criterion: 'TR',
      band: 3,
      answer_type: 'Boolean',
      polarity: 'FAULT_CHECK',
      atomic_question: 'Is there no clear position expressed?',
      rubric_anchor: 'Band 3 position requirement'
    },
    {
      baseKey: 'TR4-1',
      is_active: true,
      scope: 'essay',
      criterion: 'TR',
      band: 4,
      answer_type: 'Boolean',
      polarity: 'FAULT_CHECK',
      atomic_question: 'Does the response fail to fully address the prompt?',
      rubric_anchor: 'Band 4 task response threshold'
    },
    {
      baseKey: 'CC3-2',
      is_active: true,
      scope: 'paragraph',
      paragraphRoleConstraint: 'any',
      criterion: 'CC',
      band: 3,
      answer_type: 'Boolean',
      polarity: 'FAULT_CHECK',
      atomic_question: 'Is cohesion weak and unclear in this paragraph?',
      rubric_anchor: 'Band 3 cohesion threshold'
    },
    {
      baseKey: 'CC4-5',
      is_active: true,
      scope: 'essay',
      criterion: 'CC',
      band: 4,
      answer_type: 'Categorical (absent/confusing/ok)',
      polarity: 'FAULT_CHECK',
      atomic_question: 'Is paragraphing absent or confusing?',
      rubric_anchor: 'Band 4 organization threshold'
    },
    {
      baseKey: 'LR3-1',
      is_active: true,
      scope: 'essay',
      criterion: 'LR',
      band: 3,
      answer_type: 'Boolean',
      polarity: 'FAULT_CHECK',
      atomic_question: 'Is lexical range very limited?',
      rubric_anchor: 'Band 3 lexical threshold'
    },
    {
      baseKey: 'LR4-2',
      is_active: true,
      scope: 'essay',
      criterion: 'LR',
      band: 4,
      answer_type: 'Boolean',
      polarity: 'FAULT_CHECK',
      atomic_question: 'Is vocabulary repetitive and limited?',
      rubric_anchor: 'Band 4 lexical threshold'
    },
    {
      baseKey: 'GRA3-1',
      is_active: true,
      scope: 'essay',
      criterion: 'GRA',
      band: 3,
      answer_type: 'Ordinal (none/some/distort)',
      polarity: 'FAULT_CHECK',
      atomic_question: 'Do grammar and punctuation errors distort meaning?',
      rubric_anchor: 'Band 3 grammar threshold'
    },
    {
      baseKey: 'GRA4-1',
      is_active: true,
      scope: 'essay',
      criterion: 'GRA',
      band: 4,
      answer_type: 'Boolean',
      polarity: 'FAULT_CHECK',
      atomic_question: 'Are grammar errors frequent?',
      rubric_anchor: 'Band 4 grammar threshold'
    }
  ];
}

function createAiStub(mode, calls) {
  return async (messages, modelId) => {
    const prompt = String(messages?.[0]?.content || '');
    const ids = Array.from(prompt.matchAll(/ID:\s*([^\r\n]+)/g)).map((m) => String(m[1] || '').trim());
    const payload = {};

    for (const id of ids) {
      if (mode === 'weak') {
        if (id.startsWith('CC3-2::')) payload[id] = { value: 'Yes', evidence: [1] };
        else if (id === 'LR3-1') payload[id] = { value: 'Yes', evidence: [1] };
        else if (id === 'GRA3-1') payload[id] = { value: 'distort', evidence: [0, 1] };
        else if (id === 'GRA4-1') payload[id] = { value: 'Yes', evidence: [0, 1] };
        else payload[id] = { value: 'No', evidence: [] };
      } else {
        if (id.startsWith('CC3-2::')) payload[id] = { value: 'No', evidence: [1] };
        else if (id === 'LR3-1') payload[id] = { value: 'No', evidence: [1] };
        else if (id === 'GRA3-1') payload[id] = { value: 'none', evidence: [] };
        else if (id === 'GRA4-1') payload[id] = { value: 'No', evidence: [] };
        else payload[id] = { value: 'No', evidence: [] };
      }
    }

    calls.push({ mode, modelId, ids });
    return {
      text: JSON.stringify(payload),
      modelUsed: modelId || 'stub-model',
      usage: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
      requestMeta: { provider: 'stub', providerId: 'stub', modelId: modelId || 'stub-model' }
    };
  };
}

test('low-band activation: backend/client scoring, deterministic+ai routing, aggregation, and step5 low-band scoping', async () => {
  const stack = createRestoreStack();
  const calls = [];
  const calculateBandScoresClient = loadClientBandCalculator();
  const microAssessments = buildLowBandMicroAssessments();

  try {
    // Weak run (should be able to score < 4)
    stack.stub(aiService, 'sendMessage', createAiStub('weak', calls));
    const weakResult = await step3ScoringService.runStep3Scoring({
      essayObj: buildWeakEssay(),
      step2Features: buildWeakStep2(),
      extraction: buildWeakExtraction(),
      microAssessments,
      taskPrompt: 'Discuss both views and give your opinion.',
      options: {
        modelId: 'stub-model',
        disableCache: true
      }
    });

    // A/B/C/D/E coverage against weak run
    assert.ok(weakResult.overallBand < 4, 'Weak essay should now be able to score below 4');

    const tr32 = weakResult.results.find((r) => r.baseKey === 'TR3-2');
    assert.ok(tr32, 'TR3-2 result should exist');
    assert.equal(tr32.source, 'deterministic');
    assert.equal(tr32.value, 'Yes');

    const cc32Rows = weakResult.results.filter((r) => r.baseKey === 'CC3-2');
    assert.equal(cc32Rows.length, 2, 'CC3-2 should instantiate per paragraph');
    assert.ok(cc32Rows.every((r) => String(r.source || '').startsWith('ai')), 'CC3-2 should use AI (no deterministic rule)');

    const cc32Agg = weakResult.aggregatedResults.filter((r) => r.baseKey === 'CC3-2');
    assert.equal(cc32Agg.length, 1, 'CC3-2 should aggregate to one baseKey row');
    assert.equal(cc32Agg[0].source, 'aggregate');
    assert.equal(cc32Agg[0].scope, 'essay');

    // F coverage: Step5 must include low-band weaknesses when currentBand < 4.
    stack.stub(aiService, 'sendMessage', async () => {
      throw new Error('Step5 AI disabled for deterministic fallback verification');
    });

    const feedback = await step5FeedbackService.generateFeedback(buildWeakEssay(), {
      overallBand: 3,
      aggregatedResults: [
        {
          criterion: 'TR',
          band: 3,
          baseKey: 'TR3-2',
          atomic_question: 'Is there no clear position expressed?',
          value: 'Yes',
          polarity: 'FAULT_CHECK',
          evidenceSentenceIndices: [0],
          source: 'deterministic',
          weight: 1
        },
        {
          criterion: 'TR',
          band: 4,
          baseKey: 'TR4-1',
          atomic_question: 'Does the response fail to fully address the prompt?',
          value: 'No',
          polarity: 'FAULT_CHECK',
          evidenceSentenceIndices: [1],
          source: 'deterministic',
          weight: 1
        }
      ]
    }, {
      modelId: 'stub-model'
    });

    const hasLowBandCriterion = (feedback.improvements || []).some((item) =>
      String(item?.criterion || '').toUpperCase() === 'TR'
    );
    assert.ok(hasLowBandCriterion, 'Step5 feedback should keep low-band weaknesses in scoped analysis');

    // Strong run (should remain >= 4 under existing behavior)
    stack.stub(aiService, 'sendMessage', createAiStub('strong', calls));
    const strongResult = await step3ScoringService.runStep3Scoring({
      essayObj: buildStrongEssay(),
      step2Features: buildStrongStep2(),
      extraction: buildStrongExtraction(),
      microAssessments,
      taskPrompt: 'Discuss both views and give your opinion.',
      options: {
        modelId: 'stub-model',
        disableCache: true
      }
    });

    assert.ok(strongResult.overallBand >= 4, 'Mid/high-quality essay should remain at or above 4');

    // G coverage: client-side and backend score calculations should match.
    const clientScore = calculateBandScoresClient(strongResult.aggregatedResults);
    assert.deepEqual(clientScore.criteria, strongResult.scores);
    assert.equal(clientScore.overall, strongResult.overallBand);
  } finally {
    stack.restoreAll();
  }
});

