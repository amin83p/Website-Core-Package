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
  if (start < 0) throw new Error(`Function ${functionName} not found`);

  const firstBrace = source.indexOf('{', start);
  if (firstBrace < 0) throw new Error(`Function ${functionName} opening brace not found`);

  let depth = 0;
  for (let i = firstBrace; i < source.length; i += 1) {
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

function baseEssay() {
  return {
    normalizedText: 'This is a short calibration essay.',
    paragraphs: [
      { paragraphNumber: 1, text: 'This is a short calibration essay.' },
      { paragraphNumber: 2, text: 'It has a position and one support point.' }
    ],
    sentences: [
      { index: 0, paragraphIndex: 0, paragraphNumber: 1, text: 'This is a short calibration essay.' },
      { index: 1, paragraphIndex: 1, paragraphNumber: 2, text: 'It has a position and one support point.' },
      { index: 2, paragraphIndex: 1, paragraphNumber: 2, text: 'Some language is repetitive.' }
    ],
    stats: {
      wordCount: 85,
      sentenceCount: 3,
      paragraphCount: 2,
      charCount: 150
    }
  };
}

function baseStep2() {
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
    lexical: { topRepeatedWords: [{ word: 'essay', count: 3 }] },
    cohesion: { densityPer100: '2.10' }
  };
}

function baseExtraction() {
  return {
    answersBySubquestion: {},
    position: {
      stance: 'agree',
      stanceSentenceIndex: 0,
      contradictionSentenceIndices: []
    },
    topicSentenceByParagraph: [
      { paragraphIndex: 0, topicSentenceIndex: 0 },
      { paragraphIndex: 1, topicSentenceIndex: 1 }
    ],
    bodySupport: [
      { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [1] }
    ]
  };
}

function createAiStub(answerById = {}) {
  return async (messages, modelId) => {
    const prompt = String(messages?.[0]?.content || '');
    const ids = Array.from(prompt.matchAll(/ID:\s*([^\r\n]+)/g)).map((m) => String(m[1] || '').trim());
    const payload = {};
    for (const id of ids) {
      const fallbackBaseKey = id.split('::')[0];
      const configured = answerById[id] ?? answerById[fallbackBaseKey] ?? { value: 'No', evidence: [] };
      if (configured && typeof configured === 'object' && Object.prototype.hasOwnProperty.call(configured, 'value')) {
        payload[id] = {
          value: configured.value,
          evidence: Array.isArray(configured.evidence) ? configured.evidence : []
        };
      } else {
        payload[id] = { value: configured, evidence: [] };
      }
    }
    return {
      text: JSON.stringify(payload),
      modelUsed: modelId || 'stub-model',
      usage: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
      requestMeta: { provider: 'stub', providerId: 'stub', modelId: modelId || 'stub-model' }
    };
  };
}

async function runStep3WithStub({ microAssessments, answerById }) {
  const stack = createRestoreStack();
  stack.stub(aiService, 'sendMessage', createAiStub(answerById));
  try {
    return await step3ScoringService.runStep3Scoring({
      essayObj: baseEssay(),
      step2Features: baseStep2(),
      extraction: baseExtraction(),
      microAssessments,
      taskPrompt: 'Discuss both views and give your opinion.',
      options: {
        modelId: 'stub-model',
        disableCache: true,
        concurrency: 1
      }
    });
  } finally {
    stack.restoreAll();
  }
}

function buildBaselineRow(criterion) {
  return {
    baseKey: `${criterion}1-BASE`,
    is_active: true,
    scope: 'essay',
    criterion,
    band: 1,
    answer_type: 'Boolean',
    polarity: 'FEATURE_CHECK',
    scoredAnswers: ['Yes'],
    notScoredAnswers: ['No'],
    atomic_question: `${criterion} baseline pass check`,
    rubric_anchor: `${criterion} baseline`
  };
}

test('explicit scored/not-scored answers override polarity inference in Step 4', async () => {
  const result = await runStep3WithStub({
    microAssessments: [
      buildBaselineRow('TR'),
      {
        baseKey: 'TR2-EXPLICIT-OVERRIDE',
        is_active: true,
        scope: 'essay',
        criterion: 'TR',
        band: 2,
        answer_type: 'Boolean',
        polarity: 'FEATURE_CHECK',
        scoredAnswers: ['No'],
        notScoredAnswers: ['Yes'],
        atomic_question: 'Are main ideas difficult to identify?',
        rubric_anchor: 'Negative wording row for override validation'
      }
    ],
    answerById: {
      'TR1-BASE': { value: 'Yes', evidence: [0] },
      'TR2-EXPLICIT-OVERRIDE': { value: 'No', evidence: [] }
    }
  });

  assert.equal(result.scores.TR, 2, 'TR should pass Band 2 using explicit answer contract');
  const gate = result.meta?.gateTrace?.TR?.evaluatedGates?.[1];
  const rowCheck = gate?.rowChecks?.[0];
  assert.equal(rowCheck?.scoringMode, 'explicit_answer_contract');
  assert.equal(rowCheck?.passRule, 'scored_answers');
  assert.equal(rowCheck?.pass, true);
});

test('explicit contract handles boolean, categorical, and ordinal rows', async () => {
  const boolPass = await runStep3WithStub({
    microAssessments: [
      buildBaselineRow('TR'),
      {
        baseKey: 'TR2-BOOL-FAULT',
        is_active: true,
        scope: 'essay',
        criterion: 'TR',
        band: 2,
        answer_type: 'Boolean',
        scoredAnswers: ['No'],
        notScoredAnswers: ['Yes'],
        atomic_question: 'Is no clear position expressed?'
      }
    ],
    answerById: {
      'TR1-BASE': { value: 'Yes', evidence: [0] },
      'TR2-BOOL-FAULT': { value: 'No', evidence: [] }
    }
  });
  assert.equal(boolPass.scores.TR, 2);

  const boolFail = await runStep3WithStub({
    microAssessments: [
      buildBaselineRow('TR'),
      {
        baseKey: 'TR2-BOOL-FEATURE',
        is_active: true,
        scope: 'essay',
        criterion: 'TR',
        band: 2,
        answer_type: 'Boolean',
        scoredAnswers: ['Yes'],
        notScoredAnswers: ['No'],
        atomic_question: 'Is a clear position present?'
      }
    ],
    answerById: {
      'TR1-BASE': { value: 'Yes', evidence: [0] },
      'TR2-BOOL-FEATURE': { value: 'No', evidence: [] }
    }
  });
  assert.equal(boolFail.scores.TR, 1);

  const categoricalPass = await runStep3WithStub({
    microAssessments: [
      buildBaselineRow('TR'),
      {
        baseKey: 'TR2-CAT',
        is_active: true,
        scope: 'essay',
        criterion: 'TR',
        band: 2,
        answer_type: 'Categorical (none/unclear/clear)',
        scoredAnswers: ['clear'],
        notScoredAnswers: ['none', 'unclear'],
        atomic_question: 'Is the position clear?'
      }
    ],
    answerById: {
      'TR1-BASE': { value: 'Yes', evidence: [0] },
      'TR2-CAT': { value: 'clear', evidence: [1] }
    }
  });
  assert.equal(categoricalPass.scores.TR, 2);

  const ordinalPass = await runStep3WithStub({
    microAssessments: [
      buildBaselineRow('LR'),
      {
        baseKey: 'LR2-ORD',
        is_active: true,
        scope: 'essay',
        criterion: 'LR',
        band: 2,
        answer_type: 'Ordinal (none/some/strain)',
        scoredAnswers: ['none', 'some'],
        notScoredAnswers: ['strain'],
        atomic_question: 'Do lexical errors cause strain?'
      }
    ],
    answerById: {
      'LR1-BASE': { value: 'Yes', evidence: [0] },
      'LR2-ORD': { value: 'some', evidence: [1] }
    }
  });
  assert.equal(ordinalPass.scores.LR, 2);
});

test('Step 5 weakness detection uses explicit contract before polarity fallback', async () => {
  const stack = createRestoreStack();
  stack.stub(aiService, 'sendMessage', async () => {
    throw new Error('Force deterministic fallback');
  });

  try {
    const feedback = await step5FeedbackService.generateFeedback(
      baseEssay(),
      {
        overallBand: 2,
        aggregatedResults: [
          {
            criterion: 'TR',
            band: 2,
            baseKey: 'TR2-STRONG',
            atomic_question: 'Is no clear position expressed?',
            value: 'No',
            polarity: 'FEATURE_CHECK',
            scoredAnswers: ['No'],
            notScoredAnswers: ['Yes'],
            evidenceSentenceIndices: [0]
          },
          {
            criterion: 'TR',
            band: 2,
            baseKey: 'TR2-WEAK',
            atomic_question: 'Does the response barely address the task?',
            value: 'Yes',
            polarity: 'FAULT_CHECK',
            scoredAnswers: ['No'],
            notScoredAnswers: ['Yes'],
            evidenceSentenceIndices: [1]
          }
        ]
      }
    );

    const issues = (feedback.improvements || []).map((item) => String(item.issue || '').toLowerCase());
    assert.ok(
      issues.some((text) => text.includes('barely address the task')),
      'weakness list should include explicit-contract failing row'
    );
    assert.ok(
      issues.every((text) => !text.includes('no clear position expressed')),
      'explicit-contract passing row should not be treated as weakness'
    );
  } finally {
    stack.restoreAll();
  }
});

test('client/backend band calculations stay in parity with explicit contracts', async () => {
  const calculateBandScoresClient = loadClientBandCalculator();
  const result = await runStep3WithStub({
    microAssessments: [
      buildBaselineRow('TR'),
      buildBaselineRow('CC'),
      buildBaselineRow('LR'),
      buildBaselineRow('GRA'),
      {
        baseKey: 'TR2-GATE',
        is_active: true,
        scope: 'essay',
        criterion: 'TR',
        band: 2,
        answer_type: 'Boolean',
        scoredAnswers: ['No'],
        notScoredAnswers: ['Yes'],
        atomic_question: 'Is no clear position expressed?'
      },
      {
        baseKey: 'CC2-GATE',
        is_active: true,
        scope: 'essay',
        criterion: 'CC',
        band: 2,
        answer_type: 'Boolean',
        scoredAnswers: ['No'],
        notScoredAnswers: ['Yes'],
        atomic_question: 'Is there very little organisational control?'
      },
      {
        baseKey: 'LR2-GATE',
        is_active: true,
        scope: 'essay',
        criterion: 'LR',
        band: 2,
        answer_type: 'Ordinal (none/some/strain)',
        scoredAnswers: ['none', 'some'],
        notScoredAnswers: ['strain'],
        atomic_question: 'Do lexical errors cause strain?'
      },
      {
        baseKey: 'GRA2-GATE',
        is_active: true,
        scope: 'essay',
        criterion: 'GRA',
        band: 2,
        answer_type: 'Boolean',
        scoredAnswers: ['No'],
        notScoredAnswers: ['Yes'],
        atomic_question: 'Can the writer not use sentence forms except in memorised phrases?'
      }
    ],
    answerById: {
      'TR1-BASE': { value: 'Yes', evidence: [0] },
      'CC1-BASE': { value: 'Yes', evidence: [0] },
      'LR1-BASE': { value: 'Yes', evidence: [0] },
      'GRA1-BASE': { value: 'Yes', evidence: [0] },
      'TR2-GATE': { value: 'No', evidence: [] },
      'CC2-GATE': { value: 'No', evidence: [] },
      'LR2-GATE': { value: 'some', evidence: [] },
      'GRA2-GATE': { value: 'Yes', evidence: [] }
    }
  });

  const clientScore = calculateBandScoresClient(result.aggregatedResults);
  assert.equal(clientScore.overall, result.overallBand);
  assert.equal(clientScore.criteria.TR, result.scores.TR);
  assert.equal(clientScore.criteria.CC, result.scores.CC);
  assert.equal(clientScore.criteria.LR, result.scores.LR);
  assert.equal(clientScore.criteria.GRA, result.scores.GRA);
});

test('legacy rows without explicit answer maps still use polarity fallback', async () => {
  const result = await runStep3WithStub({
    microAssessments: [
      buildBaselineRow('TR'),
      {
        baseKey: 'TR2-LEGACY',
        is_active: true,
        scope: 'essay',
        criterion: 'TR',
        band: 2,
        answer_type: 'Boolean',
        polarity: 'FAULT_CHECK',
        atomic_question: 'Legacy polarity-only row'
      }
    ],
    answerById: {
      'TR1-BASE': { value: 'Yes', evidence: [0] },
      'TR2-LEGACY': { value: 'No', evidence: [] }
    }
  });

  assert.equal(result.scores.TR, 2);
  const gate = result.meta?.gateTrace?.TR?.evaluatedGates?.[1];
  const rowCheck = gate?.rowChecks?.[0];
  assert.equal(rowCheck?.scoringMode, 'legacy_polarity');
});

