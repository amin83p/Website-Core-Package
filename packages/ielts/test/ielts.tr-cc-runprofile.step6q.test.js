const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { scoringRules } = require('../MVC/services/ielts/scoringRules');
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
        restorers.pop()();
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

function loadControllerRunProfileExtractor() {
  const filePath = path.join(process.cwd(), 'MVC', 'controllers', 'ielts', 'ieltsController.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const start = source.indexOf('function toPositiveInt');
  const end = source.indexOf('function normalizeUnstableRows');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Could not locate run-profile helper block in ieltsController.js');
  }
  const script = `${source.slice(start, end)}\nmodule.exports = { extractStepRunProfile };`;
  const mod = { exports: {} };
  const fn = new Function('module', 'exports', script);
  fn(mod, mod.exports);
  return mod.exports.extractStepRunProfile;
}

function buildWeakSinglePartCtx() {
  return {
    step1: { stats: { wordCount: 272 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 2, 2, 1],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4
      },
      taskEcho: {
        effectiveContentWordCount: 260,
        effectiveContentRatio: 0.96,
        severity: 'none',
        reusedPromptPhraseCount: 0,
        reusedPromptSentenceLikeCount: 0,
        copiedWordEstimate: 0
      }
    },
    step25: {
      answersBySubquestion: {
        q1: [1, 2, 3, 4, 5, 6]
      },
      position: {
        stance: 'unclear',
        stanceSentenceIndex: null,
        contradictionSentenceIndices: []
      },
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [2] },
        { paragraphIndex: 2, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [5] }
      ]
    }
  };
}

function buildStrongSinglePartCtx() {
  return {
    step1: { stats: { wordCount: 318 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 3, 3, 2],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4
      },
      taskEcho: {
        effectiveContentWordCount: 305,
        effectiveContentRatio: 0.96,
        severity: 'none',
        reusedPromptPhraseCount: 0,
        reusedPromptSentenceLikeCount: 0,
        copiedWordEstimate: 0
      }
    },
    step25: {
      answersBySubquestion: {
        q1: [1, 2, 4, 5]
      },
      position: {
        stance: 'agree',
        stanceSentenceIndex: 1,
        contradictionSentenceIndices: []
      },
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [2, 3] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [5, 6] }
      ]
    }
  };
}

function buildEssayFixture() {
  return {
    normalizedText: 'Weakly controlled cohesion sample text.',
    paragraphs: [
      { paragraphNumber: 1, text: 'Introduction paragraph.' },
      { paragraphNumber: 2, text: 'Body paragraph one with weak progression.' },
      { paragraphNumber: 3, text: 'Body paragraph two with weak progression.' },
      { paragraphNumber: 4, text: 'Conclusion paragraph.' }
    ],
    sentences: [
      { index: 0, paragraphIndex: 0, paragraphNumber: 1, text: 'Introduction paragraph.' },
      { index: 1, paragraphIndex: 1, paragraphNumber: 2, text: 'Body paragraph one with weak progression.' },
      { index: 2, paragraphIndex: 2, paragraphNumber: 3, text: 'Body paragraph two with weak progression.' },
      { index: 3, paragraphIndex: 3, paragraphNumber: 4, text: 'Conclusion paragraph.' }
    ],
    stats: {
      wordCount: 240,
      sentenceCount: 4,
      paragraphCount: 4,
      charCount: 180
    }
  };
}

function buildWeakCcStep2Fixture() {
  return {
    structure: {
      paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
      paragraphSentenceCounts: [2, 2, 2, 1],
      hasIntro: true,
      hasConclusion: true,
      paragraphCount: 4
    },
    perParagraphFeatures: [
      { paragraphIndex: 0, paragraphNumber: 1, role: 'intro', sentenceCount: 2, paragraphWordCount: 40, virtualSentenceCount: 0 },
      { paragraphIndex: 1, paragraphNumber: 2, role: 'body', sentenceCount: 2, paragraphWordCount: 65, virtualSentenceCount: 0 },
      { paragraphIndex: 2, paragraphNumber: 3, role: 'body', sentenceCount: 2, paragraphWordCount: 64, virtualSentenceCount: 0 },
      { paragraphIndex: 3, paragraphNumber: 4, role: 'conclusion', sentenceCount: 1, paragraphWordCount: 35, virtualSentenceCount: 0 }
    ],
    cohesion: {
      densityPer100ExcludingBasic: 0.85,
      distinctConnectorsExcludingBasic: 1,
      usageMapExcludingBasic: { however: 5 }
    },
    lexical: {
      topRepeatedWords: [{ word: 'advantage', count: 8 }],
      referencingDensity: 0.8
    }
  };
}

function buildWeakCcExtractionFixture() {
  return {
    answersBySubquestion: {
      q1: [1]
    },
    position: {
      stance: 'partial',
      stanceSentenceIndex: 1,
      contradictionSentenceIndices: [2]
    },
    topicSentenceByParagraph: [],
    bodySupport: [
      { paragraphIndex: 1, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [] },
      { paragraphIndex: 2, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [] }
    ]
  };
}

function buildCcMidBandAssessments() {
  const make = (baseKey, atomicQuestion) => ({
    baseKey,
    question_key: baseKey,
    criterion: 'CC',
    band: Number(baseKey.startsWith('CC4') ? 4 : 5),
    is_active: true,
    scope: 'essay',
    answer_type: 'Boolean',
    atomic_question: atomicQuestion,
    rubric_anchor: atomicQuestion,
    scoredAnswers: ['No'],
    notScoredAnswers: ['Yes']
  });
  return [
    make('CC4-1', 'Are ideas not arranged coherently?'),
    make('CC5-3', 'Are cohesive devices inadequate?'),
    make('CC5-4', 'Are cohesive devices sometimes inaccurate?'),
    make('CC5-5', 'Are cohesive devices overused?'),
    make('CC5-6', 'Is repetition caused by weak referencing/substitution?')
  ];
}

function buildGateCriticalEssayFixture() {
  return {
    normalizedText: 'Gate-critical deterministic fixture text.',
    paragraphs: [
      { paragraphNumber: 1, text: 'Introduction with broad setup.' },
      { paragraphNumber: 2, text: 'First body paragraph gives one reason with limited explanation and weak linking.' },
      { paragraphNumber: 3, text: 'Second body paragraph partly repeats ideas and does not fully develop the point.' },
      { paragraphNumber: 4, text: 'Conclusion restates the main idea.' }
    ],
    sentences: [
      { index: 0, paragraphIndex: 0, paragraphNumber: 1, text: 'Introduction with broad setup.' },
      { index: 1, paragraphIndex: 1, paragraphNumber: 2, text: 'First body paragraph gives one reason.' },
      { index: 2, paragraphIndex: 1, paragraphNumber: 2, text: 'It has limited explanation and weak linking.' },
      { index: 3, paragraphIndex: 2, paragraphNumber: 3, text: 'Second body paragraph partly repeats ideas.' },
      { index: 4, paragraphIndex: 2, paragraphNumber: 3, text: 'It does not fully develop the point.' },
      { index: 5, paragraphIndex: 3, paragraphNumber: 4, text: 'Conclusion restates the main idea.' }
    ],
    stats: {
      wordCount: 252,
      sentenceCount: 6,
      paragraphCount: 4,
      charCount: 220
    }
  };
}

function buildGateCriticalStep2Fixture() {
  return {
    structure: {
      paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
      paragraphSentenceCounts: [1, 2, 2, 1],
      hasIntro: true,
      hasConclusion: true,
      paragraphCount: 4
    },
    perParagraphFeatures: [
      { paragraphIndex: 0, paragraphNumber: 1, role: 'intro', sentenceCount: 1, paragraphWordCount: 34, virtualSentenceCount: 0 },
      { paragraphIndex: 1, paragraphNumber: 2, role: 'body', sentenceCount: 2, paragraphWordCount: 82, virtualSentenceCount: 0 },
      { paragraphIndex: 2, paragraphNumber: 3, role: 'body', sentenceCount: 2, paragraphWordCount: 80, virtualSentenceCount: 0 },
      { paragraphIndex: 3, paragraphNumber: 4, role: 'conclusion', sentenceCount: 1, paragraphWordCount: 36, virtualSentenceCount: 0 }
    ],
    cohesion: {
      densityPer100ExcludingBasic: 1.15,
      distinctConnectorsExcludingBasic: 2,
      usageMapExcludingBasic: { however: 3, therefore: 2 }
    },
    lexical: {
      topRepeatedWords: [{ word: 'advantage', count: 6 }, { word: 'problem', count: 4 }],
      referencingDensity: 1.18
    },
    taskEcho: {
      effectiveContentWordCount: 246,
      effectiveContentRatio: 0.97,
      severity: 'none',
      reusedPromptPhraseCount: 0,
      reusedPromptSentenceLikeCount: 0,
      copiedWordEstimate: 0
    }
  };
}

function buildGateCriticalExtractionFixture() {
  return {
    answersBySubquestion: {
      q1: [1, 2, 3]
    },
    position: {
      stance: 'partial',
      stanceSentenceIndex: 1,
      contradictionSentenceIndices: [4]
    },
    topicSentenceByParagraph: [
      { paragraphIndex: 1, topicSentenceIndex: 1 },
      { paragraphIndex: 2, topicSentenceIndex: 3 }
    ],
    bodySupport: [
      { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [2] },
      { paragraphIndex: 2, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [] }
    ],
    grammarControl: {
      structureRange: 'mixed',
      complexSentenceControl: 'weak',
      errorFrequency: 'noticeable',
      errorFreeSentenceShareBand: 'low',
      clarityImpactFromGrammar: 'some',
      subjectVerbAgreement: 'mixed',
      articleControl: 'weak',
      prepositionControl: 'mixed',
      punctuationControl: 'weak',
      sentenceBoundaryControl: 'weak'
    },
    errorProfiles: {
      grammar: 'occasional',
      punctuation: 'occasional'
    }
  };
}

function buildGateCriticalAssessments() {
  const make = ({ baseKey, criterion, band, answer_type = 'Boolean', scope = 'essay', paragraphRoleConstraint = 'any' }) => ({
    baseKey,
    question_key: baseKey,
    criterion,
    band,
    is_active: true,
    scope,
    paragraphRoleConstraint,
    answer_type,
    atomic_question: baseKey,
    rubric_anchor: baseKey
  });

  return [
    make({ baseKey: 'TR3-3A', criterion: 'TR', band: 3 }),
    make({ baseKey: 'TR3-3B', criterion: 'TR', band: 3, scope: 'paragraph', paragraphRoleConstraint: 'body' }),
    make({ baseKey: 'TR9-4', criterion: 'TR', band: 9 }),
    make({ baseKey: 'CC3-1B', criterion: 'CC', band: 3, scope: 'paragraph', paragraphRoleConstraint: 'body' }),
    make({ baseKey: 'CC6-4', criterion: 'CC', band: 6 }),
    make({ baseKey: 'GRA3-1', criterion: 'GRA', band: 3, answer_type: 'Ordinal (none/some/distort)' }),
    make({ baseKey: 'GRA4-4', criterion: 'GRA', band: 4 })
  ];
}

test('single-subquestion weak stance/development does not auto-promote TR7/8/9 from dense indexing', () => {
  const ctx = buildWeakSinglePartCtx();
  assert.ok(scoringRules['TR6-1'](ctx) !== 'Yes');
  assert.equal(scoringRules['TR7-1'](ctx), 'No');
  assert.equal(scoringRules['TR8-1'](ctx), 'No');
  assert.equal(scoringRules['TR9-1'](ctx), 'No');
});

test('strong single-subquestion response can still progress through tightened TR gates', () => {
  const ctx = buildStrongSinglePartCtx();
  assert.equal(scoringRules['TR6-1'](ctx), 'Yes');
  assert.equal(scoringRules['TR7-1'](ctx), 'Yes');
  assert.equal(scoringRules['TR8-1'](ctx), 'Yes');
  assert.equal(scoringRules['TR9-1'](ctx), 'Yes');
});

test('CC mid-band volatility rows resolve deterministically without fallback for obvious weak cohesion', async () => {
  const stack = createRestoreStack();
  stack.stub(aiService, 'sendMessage', async () => {
    throw new Error('AI fallback should not be needed for deterministic CC mid-band regression fixture.');
  });

  try {
    const runA = await step3ScoringService.runStep3Scoring({
      essayObj: buildEssayFixture(),
      step2Features: buildWeakCcStep2Fixture(),
      extraction: buildWeakCcExtractionFixture(),
      microAssessments: buildCcMidBandAssessments(),
      taskPrompt: 'Discuss the advantages and disadvantages and give your opinion.',
      options: { disableCache: true, modelId: 'stub-model', mode: 'hybrid_extension' }
    });
    const runB = await step3ScoringService.runStep3Scoring({
      essayObj: buildEssayFixture(),
      step2Features: buildWeakCcStep2Fixture(),
      extraction: buildWeakCcExtractionFixture(),
      microAssessments: buildCcMidBandAssessments(),
      taskPrompt: 'Discuss the advantages and disadvantages and give your opinion.',
      options: { disableCache: true, modelId: 'stub-model', mode: 'hybrid_extension' }
    });

    const keys = ['CC4-1', 'CC5-3', 'CC5-4', 'CC5-5', 'CC5-6'];
    const mapA = new Map();
    const mapB = new Map();
    for (const row of runA.results.filter((r) => keys.includes(String(r.baseKey || '')))) {
      mapA.set(String(row.baseKey), row);
    }
    for (const row of runB.results.filter((r) => keys.includes(String(r.baseKey || '')))) {
      mapB.set(String(row.baseKey), row);
    }

    assert.equal(mapA.size, keys.length);
    assert.equal(mapB.size, keys.length);
    for (const key of keys) {
      const a = mapA.get(key);
      const b = mapB.get(key);
      assert.equal(a.source, 'deterministic', `${key} should be deterministic`);
      assert.equal(b.source, 'deterministic', `${key} should be deterministic`);
      assert.equal(a.fallbackReason, null, `${key} should not keep fallbackReason`);
      assert.equal(b.fallbackReason, null, `${key} should not keep fallbackReason`);
      assert.equal(String(a.value), String(b.value), `${key} should be stable across identical runs`);
    }
  } finally {
    stack.restoreAll();
  }
});

test('gate-critical TR/CC/GRA rows resolve deterministically with stable outputs across identical runs', async () => {
  const stack = createRestoreStack();
  stack.stub(aiService, 'sendMessage', async () => {
    throw new Error('AI fallback should not be needed for deterministic gate-critical rows.');
  });

  const payload = {
    essayObj: buildGateCriticalEssayFixture(),
    step2Features: buildGateCriticalStep2Fixture(),
    extraction: buildGateCriticalExtractionFixture(),
    microAssessments: buildGateCriticalAssessments(),
    taskPrompt: 'Discuss advantages and disadvantages and give your opinion.',
    options: { disableCache: true, modelId: 'stub-model', mode: 'hybrid_extension' }
  };

  try {
    const runA = await step3ScoringService.runStep3Scoring(payload);
    const runB = await step3ScoringService.runStep3Scoring(payload);

    const targetKeys = new Set(['TR3-3A', 'TR3-3B', 'TR9-4', 'CC3-1B', 'CC6-4', 'GRA3-1', 'GRA4-4']);
    const rowsA = runA.results.filter((row) => targetKeys.has(String(row.baseKey || '')));
    const rowsB = runB.results.filter((row) => targetKeys.has(String(row.baseKey || '')));

    assert.equal(rowsA.length, rowsB.length);
    assert.ok(rowsA.length >= targetKeys.size);

    const mapB = new Map(rowsB.map((row) => [String(row.instanceKey || row.baseKey), row]));
    for (const row of rowsA) {
      const key = String(row.instanceKey || row.baseKey);
      const paired = mapB.get(key);
      assert.ok(paired, `Missing paired result for ${key}`);
      assert.equal(row.source, 'deterministic', `${key} should resolve deterministically`);
      assert.equal(paired.source, 'deterministic', `${key} should resolve deterministically`);
      assert.equal(row.fallbackReason, null, `${key} should not keep fallbackReason`);
      assert.equal(paired.fallbackReason, null, `${key} should not keep fallbackReason`);
      assert.notEqual(String(row.fallbackReason || ''), 'no_rule', `${key} should not be no_rule`);
      assert.notEqual(String(row.fallbackReason || ''), 'rule_returned_null', `${key} should not be rule_returned_null`);
      assert.equal(String(row.value), String(paired.value), `${key} should be stable across identical runs`);
    }

    const cc64Rows = rowsA.filter((row) => String(row.baseKey || '') === 'CC6-4');
    assert.equal(cc64Rows.length, 1);
    assert.equal(cc64Rows[0].source, 'deterministic');
    assert.equal(cc64Rows[0].fallbackReason, null);

    const tr94Rows = rowsA.filter((row) => String(row.baseKey || '') === 'TR9-4');
    assert.equal(tr94Rows.length, 1);
    assert.equal(String(tr94Rows[0].value), 'No');
  } finally {
    stack.restoreAll();
  }
});

test('row-level deterministic outputs for the 8 patched keys are repeatable for identical ctx', () => {
  const baseCtx = {
    step1: { stats: { wordCount: 252 } },
    step2: buildGateCriticalStep2Fixture(),
    step25: buildGateCriticalExtractionFixture(),
    essay: buildGateCriticalEssayFixture()
  };

  const essayKeys = ['TR3-3A', 'TR9-4', 'CC6-4', 'GRA3-1', 'GRA4-4'];
  for (const key of essayKeys) {
    const a = scoringRules[key](baseCtx);
    const b = scoringRules[key](baseCtx);
    assert.equal(String(a), String(b), `${key} should be stable on identical essay ctx`);
  }

  const paragraphIndices = [1, 2];
  const paragraphKeys = ['TR3-3B', 'CC3-1B'];
  for (const paragraphIndex of paragraphIndices) {
    const paragraphNumber = paragraphIndex + 1;
    const feature = baseCtx.step2.perParagraphFeatures.find((row) => row.paragraphIndex === paragraphIndex) || null;
    const paragraph = baseCtx.essay.paragraphs[paragraphIndex];
    const sentences = baseCtx.essay.sentences.filter((row) => row.paragraphIndex === paragraphIndex);
    const topicSentence = baseCtx.step25.topicSentenceByParagraph.find((row) => row.paragraphIndex === paragraphIndex) || null;
    const bodySupport = baseCtx.step25.bodySupport.find((row) => row.paragraphIndex === paragraphIndex) || null;
    const role = baseCtx.step2.structure.paragraphRoles[paragraphIndex] || null;
    const paragraphCtx = {
      ...baseCtx,
      currentParagraph: {
        paragraphIndex,
        paragraphNumber,
        role,
        feature,
        features: feature,
        text: paragraph?.text || '',
        paragraphText: paragraph?.text || '',
        sentences,
        topicSentence,
        bodySupport
      },
      paragraph: null
    };
    paragraphCtx.paragraph = paragraphCtx.currentParagraph;

    for (const key of paragraphKeys) {
      const a = scoringRules[key](paragraphCtx);
      const b = scoringRules[key](paragraphCtx);
      assert.equal(String(a), String(b), `${key} should be stable for paragraph ${paragraphNumber}`);
    }
  }
});

test('no-rule fallback regressions are closed for the newly deterministic gate rows in scoringRules map', () => {
  const keys = [
    'TR3-1', 'TR3-3A', 'TR3-3B', 'TR4-3', 'TR4-4', 'TR4-5', 'TR4-6', 'TR5-2', 'TR5-7', 'TR6-5', 'TR6-6', 'TR6-7', 'TR9-4',
    'CC3-1B', 'CC4-4', 'CC5-2', 'CC5-4', 'CC5-5', 'CC5-8', 'CC6-1', 'CC7-1', 'CC7-2', 'CC7-3', 'CC8-1',
    'LR3-1', 'LR3-2', 'LR5-2',
    'GRA3-1', 'GRA4-4'
  ];
  for (const key of keys) {
    assert.equal(typeof scoringRules[key], 'function', `${key} should exist as a deterministic rule`);
  }
});

test('run-profile reconstruction prefers true stability evidence and preserves true single-run sessions', () => {
  const extractStepRunProfile = loadControllerRunProfileExtractor();

  const consensusSession = {
    steps: {
      step3extract: {
        request: { mode: 'single_run', runCount: 1 },
        response: { json: { status: 'success', data: {}, meta: {} } }
      },
      step3stability: {
        response: { json: { status: 'success', data: { enabled: true, autoConsensus: true, metrics: { runCount: 3 } } } }
      }
    }
  };
  const consensusProfile = extractStepRunProfile(consensusSession, 'step3extract');
  assert.equal(consensusProfile.mode, 'stability_gate_auto_consensus');
  assert.equal(consensusProfile.runCount, 3);
  assert.equal(consensusProfile.usedThreeRuns, true);

  const singleRunSession = {
    steps: {
      step4grade: {
        request: { mode: 'single_run', runCount: 1 },
        response: { json: { status: 'success', data: { meta: {} } } }
      }
    }
  };
  const singleProfile = extractStepRunProfile(singleRunSession, 'step4grade');
  assert.equal(singleProfile.mode, 'single_run');
  assert.equal(singleProfile.runCount, 1);
  assert.equal(singleProfile.usedThreeRuns, false);
});

test('scoringV0326 no longer hard-overwrites Step 3/4 run metadata to single_run=1', () => {
  const filePath = path.join(process.cwd(), 'MVC', 'views', 'ielts', 'scoringV0326.ejs');
  const source = fs.readFileSync(filePath, 'utf8');
  assert.equal(source.includes('SESSION_BUNDLE.steps.step3extract.request.mode = "single_run"'), false);
  assert.equal(source.includes('SESSION_BUNDLE.steps.step3extract.request.runCount = 1'), false);
  assert.equal(source.includes('SESSION_BUNDLE.steps.step4grade.request.mode = "single_run"'), false);
  assert.equal(source.includes('SESSION_BUNDLE.steps.step4grade.request.runCount = 1'), false);
});
