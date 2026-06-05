const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const step3ScoringService = require('../packages/ielts/MVC/services/ielts/step3ScoringService');
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
        restorers.pop()();
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

function buildEssayFixture() {
  return {
    normalizedText: 'Intro sentence. Body paragraph one. Body paragraph two.',
    paragraphs: [
      { paragraphNumber: 1, text: 'Intro sentence.' },
      { paragraphNumber: 2, text: 'Body paragraph one.' },
      { paragraphNumber: 3, text: 'Body paragraph two.' }
    ],
    sentences: [
      { index: 0, paragraphIndex: 0, paragraphNumber: 1, text: 'Intro sentence.' },
      { index: 1, paragraphIndex: 1, paragraphNumber: 2, text: 'Body paragraph one.' },
      { index: 2, paragraphIndex: 2, paragraphNumber: 3, text: 'Body paragraph two.' }
    ],
    stats: {
      wordCount: 48,
      sentenceCount: 3,
      paragraphCount: 3,
      charCount: 180
    }
  };
}

function buildStep2Fixture() {
  return {
    structure: {
      paragraphRoles: ['intro', 'body', 'body'],
      paragraphSentenceCounts: [1, 1, 1],
      hasIntro: true,
      hasConclusion: false,
      paragraphCount: 3
    },
    perParagraphFeatures: [
      { paragraphIndex: 0, paragraphNumber: 1, role: 'intro', sentenceCount: 1 },
      { paragraphIndex: 1, paragraphNumber: 2, role: 'body', sentenceCount: 1 },
      { paragraphIndex: 2, paragraphNumber: 3, role: 'body', sentenceCount: 1 }
    ]
  };
}

function buildExtractionFixture() {
  return {
    answersBySubquestion: {},
    position: {
      stance: 'agree',
      stanceSentenceIndex: 0,
      contradictionSentenceIndices: []
    },
    topicSentenceByParagraph: [
      { paragraphIndex: 0, topicSentenceIndex: 0 },
      { paragraphIndex: 1, topicSentenceIndex: 1 },
      { paragraphIndex: 2, topicSentenceIndex: 2 }
    ],
    bodySupport: [
      { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [1] },
      { paragraphIndex: 2, hasExplanation: false, hasExample: true, evidenceSentenceIndices: [2] }
    ]
  };
}

function createAiStub(answerById = {}) {
  return async (messages, modelId) => {
    const prompt = String(messages?.[0]?.content || '');
    const ids = Array.from(prompt.matchAll(/ID:\s*([^\r\n]+)/g)).map((m) => String(m[1] || '').trim());
    const payload = {};
    for (const id of ids) {
      const baseKey = id.split('::')[0];
      const configured = answerById[id] ?? answerById[baseKey] ?? answerById.DEFAULT ?? { value: 'No', evidence: [] };
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
      essayObj: buildEssayFixture(),
      step2Features: buildStep2Fixture(),
      extraction: buildExtractionFixture(),
      microAssessments,
      taskPrompt: 'Discuss both views and give your opinion.',
      options: { modelId: 'stub-model', disableCache: true, concurrency: 1 }
    });
  } finally {
    stack.restoreAll();
  }
}

function baselineRow(criterion) {
  return {
    baseKey: `${criterion}1-BASE`,
    is_active: true,
    scope: 'essay',
    criterion,
    band: 1,
    answer_type: 'Boolean',
    scoredAnswers: ['yes'],
    notScoredAnswers: ['no'],
    atomic_question: `${criterion} baseline check`,
    rubric_anchor: `${criterion} baseline`
  };
}

function getCriterionAggregateTrace(result, criterion, baseKey) {
  const trace = Array.isArray(result?.meta?.aggregationTrace?.[criterion]) ? result.meta.aggregationTrace[criterion] : [];
  return trace.find((entry) => String(entry?.baseKey || '') === String(baseKey));
}

test('paragraph aggregation uses scoredAnswers token for fault-style pass majority', async () => {
  const microAssessments = [
    baselineRow('CC'),
    {
      baseKey: 'ZZ-CC-AGG-FAULT',
      is_active: true,
      scope: 'paragraph',
      paragraphRoleConstraint: 'body',
      criterion: 'CC',
      band: 2,
      answer_type: 'Boolean',
      scoredAnswers: ['no'],
      notScoredAnswers: ['yes'],
      atomic_question: 'Does this body paragraph show very little control?'
    }
  ];

  const result = await runStep3WithStub({
    microAssessments,
    answerById: {
      'CC1-BASE': { value: 'Yes', evidence: [0] },
      'ZZ-CC-AGG-FAULT': { value: 'No', evidence: [1] }
    }
  });

  const aggregatedRow = result.aggregatedResults.find((row) => row.baseKey === 'ZZ-CC-AGG-FAULT');
  assert.ok(aggregatedRow);
  assert.equal(aggregatedRow.source, 'aggregate');
  assert.equal(aggregatedRow.value, 'No');
  assert.equal(aggregatedRow.aggregateValueSource, 'scoredAnswers');
  assert.equal(aggregatedRow.aggregateSemanticOutcome, 'pass');

  const traceEntry = getCriterionAggregateTrace(result, 'CC', 'ZZ-CC-AGG-FAULT');
  assert.ok(traceEntry);
  assert.equal(traceEntry.aggregateValueSource, 'scoredAnswers');
  assert.equal(traceEntry.aggregateSemanticOutcome, 'pass');
});

test('paragraph aggregation uses scoredAnswers token for feature-style pass majority', async () => {
  const microAssessments = [
    baselineRow('CC'),
    {
      baseKey: 'ZZ-CC-AGG-FEATURE',
      is_active: true,
      scope: 'paragraph',
      paragraphRoleConstraint: 'body',
      criterion: 'CC',
      band: 2,
      answer_type: 'Boolean',
      scoredAnswers: ['yes'],
      notScoredAnswers: ['no'],
      atomic_question: 'Is organisation clear in this paragraph?'
    }
  ];

  const result = await runStep3WithStub({
    microAssessments,
    answerById: {
      'CC1-BASE': { value: 'Yes', evidence: [0] },
      'ZZ-CC-AGG-FEATURE': { value: 'Yes', evidence: [1] }
    }
  });

  const aggregatedRow = result.aggregatedResults.find((row) => row.baseKey === 'ZZ-CC-AGG-FEATURE');
  assert.ok(aggregatedRow);
  assert.equal(aggregatedRow.value, 'Yes');
  assert.equal(aggregatedRow.aggregateValueSource, 'scoredAnswers');
});

test('paragraph aggregation fail path uses canonical notScoredAnswers token', async () => {
  const microAssessments = [
    baselineRow('CC'),
    {
      baseKey: 'ZZ-CC-AGG-FAIL',
      is_active: true,
      scope: 'paragraph',
      paragraphRoleConstraint: 'body',
      criterion: 'CC',
      band: 2,
      answer_type: 'Boolean',
      scoredAnswers: ['no'],
      notScoredAnswers: ['yes'],
      atomic_question: 'Is there very little control in this paragraph?'
    }
  ];

  const result = await runStep3WithStub({
    microAssessments,
    answerById: {
      'CC1-BASE': { value: 'Yes', evidence: [0] },
      'ZZ-CC-AGG-FAIL': { value: 'Yes', evidence: [2] }
    }
  });

  const aggregatedRow = result.aggregatedResults.find((row) => row.baseKey === 'ZZ-CC-AGG-FAIL');
  assert.ok(aggregatedRow);
  assert.equal(aggregatedRow.value, 'Yes');
  assert.equal(aggregatedRow.aggregateValueSource, 'notScoredAnswers');
  assert.equal(aggregatedRow.aggregateSemanticOutcome, 'fail');
});

test('gate denominator excludes unevaluable rows (Error) and preserves parity with client scoring', async () => {
  const microAssessments = [
    baselineRow('TR'),
    {
      baseKey: 'TR2-PASS',
      is_active: true,
      scope: 'essay',
      criterion: 'TR',
      band: 2,
      answer_type: 'Boolean',
      scoredAnswers: ['yes'],
      notScoredAnswers: ['no'],
      atomic_question: 'Is a clear position present?'
    },
    {
      baseKey: 'TR2-ERR1',
      is_active: true,
      scope: 'essay',
      criterion: 'TR',
      band: 2,
      answer_type: 'Text',
      atomic_question: 'Debug unevaluable row 1'
    },
    {
      baseKey: 'TR2-ERR2',
      is_active: true,
      scope: 'essay',
      criterion: 'TR',
      band: 2,
      answer_type: 'Text',
      atomic_question: 'Debug unevaluable row 2'
    }
  ];

  const result = await runStep3WithStub({
    microAssessments,
    answerById: {
      'TR1-BASE': { value: 'Yes', evidence: [0] },
      'TR2-PASS': { value: 'Yes', evidence: [1] },
      'TR2-ERR1': { value: 'Error', evidence: [] },
      'TR2-ERR2': { value: 'Error', evidence: [] }
    }
  });

  const gate = result?.meta?.gateTrace?.TR?.evaluatedGates?.find((entry) => Number(entry?.band) === 2);
  assert.ok(gate, 'Expected TR band-2 gate trace entry');
  assert.equal(gate.totalWeight, 1);
  assert.equal(gate.passedWeight, 1);
  assert.equal(gate.passRatio, 1);
  assert.equal(gate.excludedUnevaluableWeight, 2);
  assert.equal(gate.status, 'passed');
  assert.equal(result.scores.TR, 2);

  const rowChecks = Array.isArray(gate.rowChecks) ? gate.rowChecks : [];
  assert.equal(rowChecks.length, 3);
  assert.equal(rowChecks.filter((entry) => entry.evaluated === false).length, 2);

  const calculateBandScoresClient = loadClientBandCalculator();
  const clientScores = calculateBandScoresClient(result.aggregatedResults);
  assert.equal(clientScores.criteria.TR, result.scores.TR);
  const clientGate = clientScores?.gateTrace?.TR?.evaluatedGates?.find((entry) => Number(entry?.band) === 2);
  assert.ok(clientGate);
  assert.equal(clientGate.totalWeight, 1);
  assert.equal(clientGate.excludedUnevaluableWeight, 2);
});

test('evaluated rows still count normally in gate ratio math', async () => {
  const microAssessments = [
    baselineRow('TR'),
    {
      baseKey: 'TR2-PASS-EVAL',
      is_active: true,
      scope: 'essay',
      criterion: 'TR',
      band: 2,
      answer_type: 'Boolean',
      scoredAnswers: ['yes'],
      notScoredAnswers: ['no'],
      atomic_question: 'Evaluated pass row'
    },
    {
      baseKey: 'TR2-FAIL-EVAL',
      is_active: true,
      scope: 'essay',
      criterion: 'TR',
      band: 2,
      answer_type: 'Boolean',
      scoredAnswers: ['yes'],
      notScoredAnswers: ['no'],
      atomic_question: 'Evaluated fail row'
    }
  ];

  const result = await runStep3WithStub({
    microAssessments,
    answerById: {
      'TR1-BASE': { value: 'Yes', evidence: [0] },
      'TR2-PASS-EVAL': { value: 'Yes', evidence: [1] },
      'TR2-FAIL-EVAL': { value: 'No', evidence: [2] }
    }
  });

  const gate = result?.meta?.gateTrace?.TR?.evaluatedGates?.find((entry) => Number(entry?.band) === 2);
  assert.ok(gate);
  assert.equal(gate.totalWeight, 2);
  assert.equal(gate.passedWeight, 1);
  assert.equal(gate.passRatio, 0.5);
  assert.equal(gate.excludedUnevaluableWeight, 0);
  assert.equal(gate.status, 'passed');
  assert.equal(result.scores.TR, 2);
});

test('LR band gate with ai_error-style rows is not failed solely by unevaluable denominator inflation', async () => {
  const microAssessments = [
    baselineRow('LR'),
    {
      baseKey: 'LR4-3',
      is_active: true,
      scope: 'essay',
      criterion: 'LR',
      band: 4,
      answer_type: 'Boolean',
      scoredAnswers: ['yes'],
      notScoredAnswers: ['no'],
      atomic_question: 'Evaluated pass row'
    },
    {
      baseKey: 'LR4-4',
      is_active: true,
      scope: 'essay',
      criterion: 'LR',
      band: 4,
      answer_type: 'Text',
      atomic_question: 'AI error-style row 1'
    },
    {
      baseKey: 'LR4-5',
      is_active: true,
      scope: 'essay',
      criterion: 'LR',
      band: 4,
      answer_type: 'Text',
      atomic_question: 'AI error-style row 2'
    }
  ];

  const result = await runStep3WithStub({
    microAssessments,
    answerById: {
      'LR1-BASE': { value: 'Yes', evidence: [0] },
      'LR4-3': { value: 'Yes', evidence: [1] },
      'LR4-4': { value: 'Error', evidence: [] },
      'LR4-5': { value: 'Error', evidence: [] }
    }
  });

  const gate = result?.meta?.gateTrace?.LR?.evaluatedGates?.find((entry) => Number(entry?.band) === 4);
  assert.ok(gate);
  assert.equal(gate.totalWeight, 1);
  assert.equal(gate.passedWeight, 1);
  assert.equal(gate.passRatio, 1);
  assert.equal(gate.excludedUnevaluableWeight, 2);
  assert.equal(gate.status, 'passed');
  assert.equal(result.scores.LR, 4);
});

