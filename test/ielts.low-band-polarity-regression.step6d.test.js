const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const step3ScoringService = require('../MVC/services/ielts/step3ScoringService');
const aiService = require('../MVC/services/ielts/aiService');

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

function buildEssayFixture() {
  return {
    normalizedText: 'I agree with the statement. This is developed in body paragraphs with examples.',
    paragraphs: [
      { paragraphNumber: 1, text: 'I agree with the statement.' },
      { paragraphNumber: 2, text: 'First body paragraph gives support.' },
      { paragraphNumber: 3, text: 'Second body paragraph gives support.' },
      { paragraphNumber: 4, text: 'Conclusion restates the position.' }
    ],
    sentences: [
      { index: 0, paragraphIndex: 0, paragraphNumber: 1, text: 'I agree with the statement.' },
      { index: 1, paragraphIndex: 1, paragraphNumber: 2, text: 'First body paragraph gives support.' },
      { index: 2, paragraphIndex: 1, paragraphNumber: 2, text: 'It includes an example.' },
      { index: 3, paragraphIndex: 2, paragraphNumber: 3, text: 'Second body paragraph gives support.' },
      { index: 4, paragraphIndex: 2, paragraphNumber: 3, text: 'It includes another example.' },
      { index: 5, paragraphIndex: 3, paragraphNumber: 4, text: 'Conclusion restates the position.' }
    ],
    stats: {
      wordCount: 210,
      sentenceCount: 6,
      paragraphCount: 4,
      charCount: 260
    }
  };
}

function buildStep2Fixture() {
  return {
    structure: {
      paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
      paragraphSentenceCounts: [1, 2, 2, 1],
      hasIntro: true,
      hasConclusion: true,
      paragraphCount: 4
    },
    perParagraphFeatures: [
      { paragraphIndex: 0, paragraphNumber: 1, role: 'intro', sentenceCount: 1 },
      { paragraphIndex: 1, paragraphNumber: 2, role: 'body', sentenceCount: 2 },
      { paragraphIndex: 2, paragraphNumber: 3, role: 'body', sentenceCount: 2 },
      { paragraphIndex: 3, paragraphNumber: 4, role: 'conclusion', sentenceCount: 1 }
    ],
    lexical: { topRepeatedWords: [] },
    cohesion: { densityPer100: '4.20', densityPer100ExcludingBasic: '3.80' }
  };
}

function buildExtractionFixture({ hasStance = true, sparseSupport = false } = {}) {
  const answersBySubquestion = sparseSupport
    ? { q1: [1], q2: [] }
    : { q1: [1, 2], q2: [3, 4] };
  const topicSentenceByParagraph = sparseSupport
    ? [
      { paragraphIndex: 1, topicSentenceIndex: 1 },
      { paragraphIndex: 2, topicSentenceIndex: null }
    ]
    : [
      { paragraphIndex: 1, topicSentenceIndex: 1 },
      { paragraphIndex: 2, topicSentenceIndex: 3 }
    ];
  const bodySupport = sparseSupport
    ? [
      { paragraphIndex: 1, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [1] },
      { paragraphIndex: 2, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [] }
    ]
    : [
      { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [1, 2] },
      { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [3, 4] }
    ];

  return {
    answersBySubquestion,
    position: {
      stance: hasStance ? 'agree' : null,
      stanceSentenceIndex: hasStance ? 0 : null,
      contradictionSentenceIndices: []
    },
    topicSentenceByParagraph,
    bodySupport,
    errorProfiles: {
      grammar: 'rare',
      punctuation: 'rare'
    }
  };
}

function createAiStub(answerById = {}) {
  return async (messages, modelId) => {
    const prompt = String(messages?.[0]?.content || '');
    const ids = Array.from(prompt.matchAll(/ID:\s*([^\r\n]+)/g)).map((m) => String(m[1] || '').trim());
    const payload = {};
    for (const id of ids) {
      const answer = answerById[id] || answerById.DEFAULT || { value: 'No', evidence: [] };
      payload[id] = answer;
    }
    return {
      text: JSON.stringify(payload),
      modelUsed: modelId || 'stub-model',
      usage: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
      requestMeta: { provider: 'stub', providerId: 'stub', modelId: modelId || 'stub-model' }
    };
  };
}

function getGateRowPass(gateTrace, criterion, band, baseKey) {
  const trace = gateTrace?.[criterion];
  const gate = (Array.isArray(trace?.evaluatedGates) ? trace.evaluatedGates : [])
    .find((row) => Number(row?.band) === Number(band));
  const rowCheck = (Array.isArray(gate?.rowChecks) ? gate.rowChecks : [])
    .find((row) => String(row?.baseKey || '') === String(baseKey));
  return rowCheck ? Boolean(rowCheck.pass) : null;
}

test('polarity regression guard: negative-fault "No" passes, "Yes" fails, and positive feature logic is unchanged', async () => {
  const stack = createRestoreStack();
  const calculateBandScoresClient = loadClientBandCalculator();
  stack.stub(aiService, 'sendMessage', createAiStub({
    CC_B1: { value: 'Yes', evidence: [1] },
    CC_POS_2: { value: 'No', evidence: [1] },
    DEFAULT: { value: 'No', evidence: [] }
  }));

  const microAssessments = [
    { baseKey: 'TR_B1', is_active: true, scope: 'essay', criterion: 'TR', band: 1, answer_type: 'Boolean', polarity: 'FAULT_CHECK', atomic_question: 'Is task response absent?' },
    { baseKey: 'TR2-2', is_active: true, scope: 'essay', criterion: 'TR', band: 2, answer_type: 'Boolean', atomic_question: 'Is no position expressed?' },

    { baseKey: 'CC_B1', is_active: true, scope: 'essay', criterion: 'CC', band: 1, answer_type: 'Boolean', polarity: 'FEATURE_CHECK', atomic_question: 'Is organization clear at baseline?' },
    { baseKey: 'CC_POS_2', is_active: true, scope: 'essay', criterion: 'CC', band: 2, answer_type: 'Boolean', polarity: 'FEATURE_CHECK', atomic_question: 'Is organization clear and controlled?' },

    { baseKey: 'LR_B1', is_active: true, scope: 'essay', criterion: 'LR', band: 1, answer_type: 'Boolean', polarity: 'FAULT_CHECK', atomic_question: 'Is lexical control poor?' },
    { baseKey: 'LR_B2', is_active: true, scope: 'essay', criterion: 'LR', band: 2, answer_type: 'Boolean', polarity: 'FAULT_CHECK', atomic_question: 'Is lexical control poor?' },

    { baseKey: 'GRA_B1', is_active: true, scope: 'essay', criterion: 'GRA', band: 1, answer_type: 'Boolean', polarity: 'FAULT_CHECK', atomic_question: 'Are grammar errors severe?' },
    { baseKey: 'GRA_B2', is_active: true, scope: 'essay', criterion: 'GRA', band: 2, answer_type: 'Boolean', polarity: 'FAULT_CHECK', atomic_question: 'Are grammar errors severe?' }
  ];

  try {
    const runNo = await step3ScoringService.runStep3Scoring({
      essayObj: buildEssayFixture(),
      step2Features: buildStep2Fixture(),
      extraction: buildExtractionFixture({ hasStance: true }),
      microAssessments,
      taskPrompt: 'Discuss both views and give your opinion.',
      options: { modelId: 'stub-model', disableCache: true }
    });

    const tr22No = runNo.results.find((row) => row.baseKey === 'TR2-2');
    assert.ok(tr22No);
    assert.equal(tr22No.value, 'No');
    assert.equal(tr22No.polarity, 'FAULT_CHECK');
    assert.equal(getGateRowPass(runNo.meta.gateTrace, 'TR', 2, 'TR2-2'), true);
    assert.equal(runNo.scores.TR, 2);

    // Positive FEATURE_CHECK item with value "No" should still fail (unchanged behavior).
    assert.equal(getGateRowPass(runNo.meta.gateTrace, 'CC', 2, 'CC_POS_2'), false);
    assert.equal(runNo.scores.CC, 1);

    const clientNo = calculateBandScoresClient(runNo.aggregatedResults);
    assert.deepEqual(clientNo.criteria, runNo.scores);
    assert.equal(clientNo.overall, runNo.overallBand);

    const runYes = await step3ScoringService.runStep3Scoring({
      essayObj: buildEssayFixture(),
      step2Features: buildStep2Fixture(),
      extraction: buildExtractionFixture({ hasStance: false, sparseSupport: true }),
      microAssessments,
      taskPrompt: 'Discuss both views and give your opinion.',
      options: { modelId: 'stub-model', disableCache: true }
    });

    const tr22Yes = runYes.results.find((row) => row.baseKey === 'TR2-2');
    assert.ok(tr22Yes);
    assert.equal(tr22Yes.value, 'Yes');
    assert.equal(tr22Yes.polarity, 'FAULT_CHECK');
    assert.equal(getGateRowPass(runYes.meta.gateTrace, 'TR', 2, 'TR2-2'), false);
    assert.equal(runYes.scores.TR, 1);
  } finally {
    stack.restoreAll();
  }
});

test('Cambridge-style low-band polarity guard: TR2-2/CC2-1A/GRA2-1 with "No" no longer collapses criteria to 1', async () => {
  const stack = createRestoreStack();
  const calculateBandScoresClient = loadClientBandCalculator();
  stack.stub(aiService, 'sendMessage', createAiStub({
    DEFAULT: { value: 'No', evidence: [1] }
  }));

  const microAssessments = [
    { baseKey: 'TR_B1', is_active: true, scope: 'essay', criterion: 'TR', band: 1, answer_type: 'Boolean', polarity: 'FAULT_CHECK', atomic_question: 'Is task response absent?' },
    { baseKey: 'TR2-2', is_active: true, scope: 'essay', criterion: 'TR', band: 2, answer_type: 'Boolean', atomic_question: 'Is no position expressed?' },
    { baseKey: 'TR_B4', is_active: true, scope: 'essay', criterion: 'TR', band: 4, answer_type: 'Boolean', polarity: 'FAULT_CHECK', atomic_question: 'Does task response fail clearly?' },

    { baseKey: 'CC_B1', is_active: true, scope: 'essay', criterion: 'CC', band: 1, answer_type: 'Boolean', polarity: 'FAULT_CHECK', atomic_question: 'Is organization absent?' },
    { baseKey: 'CC2-1A', is_active: true, scope: 'essay', criterion: 'CC', band: 2, answer_type: 'Boolean', atomic_question: 'Is there very little overall control of organisational features across the response?' },
    { baseKey: 'CC_B4', is_active: true, scope: 'essay', criterion: 'CC', band: 4, answer_type: 'Boolean', polarity: 'FAULT_CHECK', atomic_question: 'Are ideas not arranged coherently?' },

    { baseKey: 'LR_B1', is_active: true, scope: 'essay', criterion: 'LR', band: 1, answer_type: 'Boolean', polarity: 'FAULT_CHECK', atomic_question: 'Is lexical range absent?' },
    { baseKey: 'LR_B4', is_active: true, scope: 'essay', criterion: 'LR', band: 4, answer_type: 'Boolean', polarity: 'FAULT_CHECK', atomic_question: 'Is vocabulary repetitive and limited?' },

    { baseKey: 'GRA_B1', is_active: true, scope: 'essay', criterion: 'GRA', band: 1, answer_type: 'Boolean', polarity: 'FAULT_CHECK', atomic_question: 'Are sentence forms absent?' },
    { baseKey: 'GRA2-1', is_active: true, scope: 'essay', criterion: 'GRA', band: 2, answer_type: 'Boolean', atomic_question: 'Can the writer not use sentence forms except in memorised phrases?' },
    { baseKey: 'GRA_B4', is_active: true, scope: 'essay', criterion: 'GRA', band: 4, answer_type: 'Boolean', polarity: 'FAULT_CHECK', atomic_question: 'Are grammatical errors frequent?' }
  ];

  try {
    const result = await step3ScoringService.runStep3Scoring({
      essayObj: buildEssayFixture(),
      step2Features: buildStep2Fixture(),
      extraction: buildExtractionFixture({ hasStance: true }),
      microAssessments,
      taskPrompt: 'Discuss both views and give your opinion.',
      options: { modelId: 'stub-model', disableCache: true }
    });

    const tr22 = result.results.find((row) => row.baseKey === 'TR2-2');
    const cc21a = result.results.find((row) => row.baseKey === 'CC2-1A');
    const gra21 = result.results.find((row) => row.baseKey === 'GRA2-1');
    assert.ok(tr22 && cc21a && gra21);
    assert.equal(tr22.value, 'No');
    assert.equal(cc21a.value, 'No');
    assert.equal(gra21.value, 'No');
    assert.equal(tr22.polarity, 'FAULT_CHECK');
    assert.equal(cc21a.polarity, 'FAULT_CHECK');
    assert.equal(gra21.polarity, 'FAULT_CHECK');

    assert.ok(result.scores.TR > 1, `Expected TR > 1, got ${result.scores.TR}`);
    assert.ok(result.scores.CC > 1, `Expected CC > 1, got ${result.scores.CC}`);
    assert.ok(result.scores.GRA > 1, `Expected GRA > 1, got ${result.scores.GRA}`);
    assert.ok(result.overallBand > 2.5, `Expected overall to avoid collapse, got ${result.overallBand}`);

    const client = calculateBandScoresClient(result.aggregatedResults);
    assert.deepEqual(client.criteria, result.scores);
    assert.equal(client.overall, result.overallBand);
  } finally {
    stack.restoreAll();
  }
});

test('paragraph-scoped low-band items still instantiate and aggregate after polarity fix', async () => {
  const stack = createRestoreStack();
  stack.stub(aiService, 'sendMessage', createAiStub({
    DEFAULT: { value: 'No', evidence: [1] }
  }));

  const microAssessments = [
    { baseKey: 'CC_B1', is_active: true, scope: 'essay', criterion: 'CC', band: 1, answer_type: 'Boolean', polarity: 'FAULT_CHECK', atomic_question: 'Is organization absent?' },
    { baseKey: 'CC2-1B', is_active: true, scope: 'paragraph', paragraphRoleConstraint: 'body', criterion: 'CC', band: 2, answer_type: 'Boolean', atomic_question: 'Does this body paragraph show very little control of organisational features?' },
    { baseKey: 'CC_B4', is_active: true, scope: 'essay', criterion: 'CC', band: 4, answer_type: 'Boolean', polarity: 'FAULT_CHECK', atomic_question: 'Is paragraphing absent or confusing?' }
  ];

  try {
    const result = await step3ScoringService.runStep3Scoring({
      essayObj: buildEssayFixture(),
      step2Features: buildStep2Fixture(),
      extraction: buildExtractionFixture({ hasStance: true }),
      microAssessments,
      taskPrompt: 'Discuss both views and give your opinion.',
      options: { modelId: 'stub-model', disableCache: true }
    });

    const rawParagraphRows = result.results.filter((row) => row.baseKey === 'CC2-1B');
    assert.equal(rawParagraphRows.length, 2);
    assert.ok(rawParagraphRows.every((row) => row.scope === 'paragraph'));
    assert.ok(rawParagraphRows.every((row) => row.polarity === 'FAULT_CHECK'));

    const aggregatedRow = result.aggregatedResults.find((row) => row.baseKey === 'CC2-1B');
    assert.ok(aggregatedRow);
    assert.equal(aggregatedRow.scope, 'essay');
    assert.equal(aggregatedRow.source, 'aggregate');
    assert.ok(Array.isArray(result?.meta?.aggregationTrace?.CC));
    assert.ok(result.meta.aggregationTrace.CC.some((entry) => entry?.baseKey === 'CC2-1B'));
  } finally {
    stack.restoreAll();
  }
});
