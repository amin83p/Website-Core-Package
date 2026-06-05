const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

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

function buildEssayFixture() {
  return {
    normalizedText: 'Intro sentence. Body one has clear explanation. Body two adds example. Conclusion sentence.',
    paragraphs: [
      { paragraphNumber: 1, text: 'Intro sentence.' },
      { paragraphNumber: 2, text: 'Body one has clear explanation.' },
      { paragraphNumber: 3, text: 'Body two adds example.' },
      { paragraphNumber: 4, text: 'Conclusion sentence.' }
    ],
    sentences: [
      { index: 0, paragraphIndex: 0, paragraphNumber: 1, text: 'Intro sentence.' },
      { index: 1, paragraphIndex: 1, paragraphNumber: 2, text: 'Body one has clear explanation.' },
      { index: 2, paragraphIndex: 2, paragraphNumber: 3, text: 'Body two adds example.' },
      { index: 3, paragraphIndex: 3, paragraphNumber: 4, text: 'Conclusion sentence.' }
    ],
    stats: {
      wordCount: 210,
      sentenceCount: 4,
      paragraphCount: 4
    }
  };
}

function buildStep2Fixture() {
  return {
    structure: {
      paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
      paragraphSentenceCounts: [1, 1, 1, 1],
      hasIntro: true,
      hasConclusion: true,
      paragraphCount: 4
    },
    perParagraphFeatures: [
      { paragraphIndex: 0, paragraphNumber: 1, role: 'intro', sentenceCount: 1 },
      { paragraphIndex: 1, paragraphNumber: 2, role: 'body', sentenceCount: 1 },
      { paragraphIndex: 2, paragraphNumber: 3, role: 'body', sentenceCount: 1 },
      { paragraphIndex: 3, paragraphNumber: 4, role: 'conclusion', sentenceCount: 1 }
    ],
    cohesion: { densityPer100: '4.20' },
    lexical: { topRepeatedWords: [{ word: 'technology', count: 3 }] }
  };
}

function buildExtractionFixture() {
  return {
    position: {
      stance: 'agree',
      stanceSentenceIndex: 0,
      contradictionSentenceIndices: []
    },
    answersBySubquestion: {
      q1_task_response: [1, 2],
      q2_task_response: [2]
    },
    lexicalControl: {
      rangeBand: 'wide',
      precisionBand: 'high',
      collocationControl: 'good',
      awkwardExpressionCountBand: 'few',
      spellingImpact: 'minor',
      wordFormationImpact: 'minor',
      repetitionImpact: 'mild',
      clarityImpactFromLexis: 'minor'
    },
    grammarControl: {
      structureRange: 'wide',
      complexSentenceControl: 'good',
      errorFrequency: 'rare',
      subjectVerbAgreement: 'strong',
      articleControl: 'mixed',
      prepositionControl: 'mixed',
      punctuationControl: 'strong',
      sentenceBoundaryControl: 'strong',
      clarityImpactFromGrammar: 'minor',
      errorFreeSentenceShareBand: 'high'
    }
  };
}

function buildCeilingStrongButLimitedContext() {
  return {
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 2, 2, 1],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: false,
        misplacedConclusionSignpost: true
      },
      cohesion: {
        densityPer100ExcludingBasic: '3.10',
        distinctConnectorsExcludingBasic: 3,
        usageMapExcludingBasic: { however: 4, therefore: 3 }
      },
      lexical: {
        referencingDensity: '1.15',
        topRepeatedWords: [{ word: 'people', count: 8 }]
      }
    },
    step25: {
      topicSentenceByParagraph: [
        { paragraphIndex: 1, topicSentenceIndex: 1 },
        { paragraphIndex: 2, topicSentenceIndex: 3 }
      ],
      lexicalControl: {
        rangeBand: 'wide',
        precisionBand: 'good',
        collocationControl: 'good',
        awkwardExpressionCountBand: 'few',
        spellingImpact: 'minor',
        wordFormationImpact: 'minor',
        repetitionImpact: 'noticeable',
        clarityImpactFromLexis: 'minor'
      },
      grammarControl: {
        structureRange: 'wide',
        complexSentenceControl: 'good',
        errorFrequency: 'occasional',
        subjectVerbAgreement: 'mixed',
        articleControl: 'mixed',
        prepositionControl: 'mixed',
        punctuationControl: 'strong',
        sentenceBoundaryControl: 'strong',
        clarityImpactFromGrammar: 'minor',
        errorFreeSentenceShareBand: 'moderate'
      }
    }
  };
}

function buildCeilingBand9Context() {
  return {
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 3, 3, 2],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: true,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '2.00',
        distinctConnectorsExcludingBasic: 5,
        usageMapExcludingBasic: { however: 2, moreover: 1, consequently: 1, overall: 1 }
      },
      lexical: {
        referencingDensity: '1.95',
        topRepeatedWords: [{ word: 'education', count: 4 }]
      }
    },
    step25: {
      topicSentenceByParagraph: [
        { paragraphIndex: 1, topicSentenceIndex: 2 },
        { paragraphIndex: 2, topicSentenceIndex: 5 }
      ],
      lexicalControl: {
        rangeBand: 'wide',
        precisionBand: 'high',
        collocationControl: 'good',
        awkwardExpressionCountBand: 'none',
        spellingImpact: 'none',
        wordFormationImpact: 'none',
        repetitionImpact: 'none',
        clarityImpactFromLexis: 'none'
      },
      grammarControl: {
        structureRange: 'wide',
        complexSentenceControl: 'good',
        errorFrequency: 'rare',
        subjectVerbAgreement: 'strong',
        articleControl: 'strong',
        prepositionControl: 'strong',
        punctuationControl: 'strong',
        sentenceBoundaryControl: 'strong',
        clarityImpactFromGrammar: 'none',
        errorFreeSentenceShareBand: 'high'
      }
    }
  };
}

test('High-band LR/GRA rows are aligned to rich Step 3 signal paths in the bank', () => {
  const rows = JSON.parse(fs.readFileSync('data/ielts/microAssessments.json', 'utf8'));

  const graKeys = ['GRA6-1', 'GRA6-2', 'GRA6-3', 'GRA7-1', 'GRA7-2', 'GRA7-3', 'GRA7-4', 'GRA8-1', 'GRA8-2', 'GRA8-3', 'GRA9-1', 'GRA9-2'];
  const lrKeys = ['LR6-1', 'LR6-2', 'LR6-3', 'LR6-4', 'LR7-1', 'LR7-2', 'LR7-3', 'LR8-1', 'LR8-2', 'LR8-3', 'LR9-1', 'LR9-2'];
  const ccHighKeys = ['CC8-1', 'CC8-2', 'CC8-3', 'CC9-1', 'CC9-2'];

  for (const key of graKeys) {
    const row = rows.find((item) => (item.question_key || item.baseKey) === key);
    assert.ok(row, `Missing bank row: ${key}`);
    assert.ok(Array.isArray(row.signal_signals), `${key} must have signal_signals`);
    assert.ok(
      row.signal_signals.every((token) => String(token).startsWith('grammarControl.')),
      `${key} should reference grammarControl.* signals`
    );
  }

  for (const key of lrKeys) {
    const row = rows.find((item) => (item.question_key || item.baseKey) === key);
    assert.ok(row, `Missing bank row: ${key}`);
    assert.ok(Array.isArray(row.signal_signals), `${key} must have signal_signals`);
    assert.ok(
      row.signal_signals.every((token) => String(token).startsWith('lexicalControl.')),
      `${key} should reference lexicalControl.* signals`
    );
  }

  for (const key of ccHighKeys) {
    const row = rows.find((item) => (item.question_key || item.baseKey) === key);
    assert.ok(row, `Missing bank row: ${key}`);
    assert.ok(Array.isArray(row.signal_signals), `${key} must have signal_signals`);
    assert.ok(row.signal_signals.some((token) => String(token).startsWith('structure.')), `${key} should include structure.* signals`);
  }

  const fixedContracts = ['GRA6-2', 'GRA7-2', 'GRA8-2', 'CC9-1'];
  for (const key of fixedContracts) {
    const row = rows.find((item) => (item.question_key || item.baseKey) === key);
    assert.deepEqual(row.scoredAnswers, ['Yes'], `${key} scoredAnswers should be Yes`);
    assert.deepEqual(row.notScoredAnswers, ['No'], `${key} notScoredAnswers should be No`);
  }
});

test('Strong rich grammar evidence can progress GRA through high-band gates without AI fallback', async () => {
  const restoreStack = createRestoreStack();
  try {
    restoreStack.stub(aiService, 'sendMessage', async () => {
      throw new Error('AI should not be called for deterministic high-band GRA test.');
    });

    const microAssessments = [
      { baseKey: 'GRA5-4', question_key: 'GRA5-4', is_active: true, criterion: 'GRA', band: 5, answer_type: 'Boolean', atomic_question: 'Band 5 grammar error frequency', scoredAnswers: ['No'], notScoredAnswers: ['Yes'] },
      { baseKey: 'GRA6-1', question_key: 'GRA6-1', is_active: true, criterion: 'GRA', band: 6, answer_type: 'Boolean', atomic_question: 'Band 6 structure range', scoredAnswers: ['Yes'], notScoredAnswers: ['No'] },
      { baseKey: 'GRA6-2', question_key: 'GRA6-2', is_active: true, criterion: 'GRA', band: 6, answer_type: 'Boolean', atomic_question: 'Band 6 error presence', scoredAnswers: ['Yes'], notScoredAnswers: ['No'] },
      { baseKey: 'GRA6-3', question_key: 'GRA6-3', is_active: true, criterion: 'GRA', band: 6, answer_type: 'Ordinal (rarely/sometimes/often)', atomic_question: 'Band 6 communication impact', scoredAnswers: ['rarely'], notScoredAnswers: ['sometimes', 'often'] },
      { baseKey: 'GRA7-1', question_key: 'GRA7-1', is_active: true, criterion: 'GRA', band: 7, answer_type: 'Boolean', atomic_question: 'Band 7 structure variety', scoredAnswers: ['Yes'], notScoredAnswers: ['No'] },
      { baseKey: 'GRA7-2', question_key: 'GRA7-2', is_active: true, criterion: 'GRA', band: 7, answer_type: 'Boolean', atomic_question: 'Band 7 error-free frequency', scoredAnswers: ['Yes'], notScoredAnswers: ['No'] },
      { baseKey: 'GRA7-3', question_key: 'GRA7-3', is_active: true, criterion: 'GRA', band: 7, answer_type: 'Boolean', atomic_question: 'Band 7 control quality', scoredAnswers: ['Yes'], notScoredAnswers: ['No'] },
      { baseKey: 'GRA7-4', question_key: 'GRA7-4', is_active: true, criterion: 'GRA', band: 7, answer_type: 'Ordinal (none/few/occasional/frequent)', atomic_question: 'Band 7 error frequency bucket', scoredAnswers: ['none', 'few', 'occasional'], notScoredAnswers: ['frequent'] },
      { baseKey: 'GRA8-1', question_key: 'GRA8-1', is_active: true, criterion: 'GRA', band: 8, answer_type: 'Boolean', atomic_question: 'Band 8 structure breadth', scoredAnswers: ['Yes'], notScoredAnswers: ['No'] },
      { baseKey: 'GRA8-2', question_key: 'GRA8-2', is_active: true, criterion: 'GRA', band: 8, answer_type: 'Boolean', atomic_question: 'Band 8 majority error-free', scoredAnswers: ['Yes'], notScoredAnswers: ['No'] },
      { baseKey: 'GRA8-3', question_key: 'GRA8-3', is_active: true, criterion: 'GRA', band: 8, answer_type: 'Ordinal (none/very_occasional/occasional/frequent)', atomic_question: 'Band 8 error frequency bucket', scoredAnswers: ['none', 'very_occasional'], notScoredAnswers: ['occasional', 'frequent'] }
    ];

    const result = await step3ScoringService.runStep3Scoring({
      essayObj: buildEssayFixture(),
      step2Features: buildStep2Fixture(),
      extraction: buildExtractionFixture(),
      taskPrompt: 'Discuss both views and give your opinion.',
      microAssessments,
      options: { mode: 'hybrid_extension', modelId: 'gemini-2.0-flash' }
    });

    assert.ok(result?.scores?.GRA >= 7, `Expected GRA >= 7, got ${result?.scores?.GRA}`);
    assert.ok(result?.scores?.GRA > 5.5, `Expected GRA to exceed 5.5 ceiling, got ${result?.scores?.GRA}`);
    const graRows = result.results.filter((row) => row.criterion === 'GRA');
    assert.ok(graRows.length >= 10);
    assert.ok(graRows.every((row) => row.source === 'deterministic'), 'Expected high-band GRA rows to be deterministic in this fixture.');
  } finally {
    restoreStack.restoreAll();
  }
});

test('Strong rich lexical evidence can drive LR high-band items deterministically', async () => {
  const restoreStack = createRestoreStack();
  try {
    restoreStack.stub(aiService, 'sendMessage', async () => {
      throw new Error('AI should not be called for deterministic high-band LR test.');
    });

    const microAssessments = [
      { baseKey: 'LR5-1', question_key: 'LR5-1', is_active: true, criterion: 'LR', band: 5, answer_type: 'Boolean', atomic_question: 'Band 5 lexical limitation check', scoredAnswers: ['No'], notScoredAnswers: ['Yes'] },
      { baseKey: 'LR6-1', question_key: 'LR6-1', is_active: true, criterion: 'LR', band: 6, answer_type: 'Boolean', atomic_question: 'Band 6 lexical range', scoredAnswers: ['Yes'], notScoredAnswers: ['No'] },
      { baseKey: 'LR6-2', question_key: 'LR6-2', is_active: true, criterion: 'LR', band: 6, answer_type: 'Boolean', atomic_question: 'Band 6 less common attempts', scoredAnswers: ['Yes'], notScoredAnswers: ['No'] },
      { baseKey: 'LR6-4', question_key: 'LR6-4', is_active: true, criterion: 'LR', band: 6, answer_type: 'Ordinal (none/some_non_impeding/impeding)', atomic_question: 'Band 6 spelling/formation impact', scoredAnswers: ['none', 'some_non_impeding'], notScoredAnswers: ['impeding'] },
      { baseKey: 'LR7-1', question_key: 'LR7-1', is_active: true, criterion: 'LR', band: 7, answer_type: 'Boolean', atomic_question: 'Band 7 range and precision', scoredAnswers: ['Yes'], notScoredAnswers: ['No'] },
      { baseKey: 'LR7-2', question_key: 'LR7-2', is_active: true, criterion: 'LR', band: 7, answer_type: 'Boolean', atomic_question: 'Band 7 collocation/style awareness', scoredAnswers: ['Yes'], notScoredAnswers: ['No'] },
      { baseKey: 'LR7-3', question_key: 'LR7-3', is_active: true, criterion: 'LR', band: 7, answer_type: 'Ordinal (none/rare/occasional/frequent)', atomic_question: 'Band 7 lexical error frequency', scoredAnswers: ['none', 'rare', 'occasional'], notScoredAnswers: ['frequent'] },
      { baseKey: 'LR8-1', question_key: 'LR8-1', is_active: true, criterion: 'LR', band: 8, answer_type: 'Boolean', atomic_question: 'Band 8 fluent precision', scoredAnswers: ['Yes'], notScoredAnswers: ['No'] },
      { baseKey: 'LR8-2', question_key: 'LR8-2', is_active: true, criterion: 'LR', band: 8, answer_type: 'Boolean', atomic_question: 'Band 8 skilful uncommon use', scoredAnswers: ['Yes'], notScoredAnswers: ['No'] },
      { baseKey: 'LR8-3', question_key: 'LR8-3', is_active: true, criterion: 'LR', band: 8, answer_type: 'Ordinal (none/rare/occasional/frequent)', atomic_question: 'Band 8 lexical error rarity', scoredAnswers: ['none', 'rare'], notScoredAnswers: ['occasional', 'frequent'] }
    ];

    const result = await step3ScoringService.runStep3Scoring({
      essayObj: buildEssayFixture(),
      step2Features: buildStep2Fixture(),
      extraction: buildExtractionFixture(),
      taskPrompt: 'Discuss both views and give your opinion.',
      microAssessments,
      options: { mode: 'hybrid_extension', modelId: 'gemini-2.0-flash' }
    });

    assert.ok(result?.scores?.LR >= 7, `Expected LR >= 7, got ${result?.scores?.LR}`);
    const lrRows = result.results.filter((row) => row.criterion === 'LR');
    assert.ok(lrRows.length >= 9);
    assert.ok(lrRows.every((row) => row.source === 'deterministic'), 'Expected high-band LR rows to be deterministic in this fixture.');
  } finally {
    restoreStack.restoreAll();
  }
});

test('high-band ceiling: strong-but-limited profile is capped below 9-level CC/GRA/LR outputs', () => {
  const ctx = buildCeilingStrongButLimitedContext();
  assert.equal(scoringRules['CC9-1'](ctx), 'No');
  assert.equal(scoringRules['CC9-2'](ctx), 'No');
  assert.equal(scoringRules['GRA9-1'](ctx), 'No');
  assert.ok(['very_occasional', 'occasional', 'frequent'].includes(scoringRules['GRA9-2'](ctx)));
  assert.equal(scoringRules['LR9-1'](ctx), 'No');
  assert.ok(['occasional', 'frequent'].includes(scoringRules['LR9-2'](ctx)));
});

test('high-band ceiling: genuine band-9-like control can still pass 9-level gates', () => {
  const ctx = buildCeilingBand9Context();
  assert.equal(scoringRules['CC9-1'](ctx), 'Yes');
  assert.equal(scoringRules['CC9-2'](ctx), 'Yes');
  assert.equal(scoringRules['GRA9-1'](ctx), 'Yes');
  assert.ok(['none', 'rare_slips'].includes(scoringRules['GRA9-2'](ctx)));
  assert.equal(scoringRules['LR9-1'](ctx), 'Yes');
  assert.ok(['none', 'rare_slips'].includes(scoringRules['LR9-2'](ctx)));
});

test('high-band boundary: band-8 grammar profile stays below GRA9 while preserving GRA8 path', () => {
  const ctx = {
    step25: {
      grammarControl: {
        structureRange: 'wide',
        complexSentenceControl: 'good',
        errorFrequency: 'rare',
        subjectVerbAgreement: 'strong',
        articleControl: 'weak',
        prepositionControl: 'strong',
        punctuationControl: 'strong',
        sentenceBoundaryControl: 'strong',
        clarityImpactFromGrammar: 'minor',
        errorFreeSentenceShareBand: 'high'
      }
    }
  };
  assert.equal(scoringRules['GRA8-1'](ctx), 'Yes');
  assert.equal(scoringRules['GRA8-2'](ctx), 'Yes');
  assert.equal(scoringRules['GRA9-1'](ctx), 'No');
});

test('high-band boundary: band-8 lexical profile stays below LR9 while preserving LR8 path', () => {
  const ctx = {
    step25: {
      lexicalControl: {
        rangeBand: 'wide',
        precisionBand: 'good',
        collocationControl: 'good',
        awkwardExpressionCountBand: 'few',
        spellingImpact: 'minor',
        wordFormationImpact: 'minor',
        repetitionImpact: 'mild',
        clarityImpactFromLexis: 'minor'
      }
    }
  };
  assert.equal(scoringRules['LR8-1'](ctx), 'Yes');
  assert.equal(scoringRules['LR8-2'](ctx), 'Yes');
  assert.equal(scoringRules['LR9-1'](ctx), 'No');
});

test('step5 strengths do not emit band-9-only praise rows when band-9 gates fail', async () => {
  const feedback = await step5FeedbackService.generateFeedback(
    {
      normalizedText: 'Sample essay text.',
      sentences: [
        { index: 0, paragraphNumber: 1, paragraphIndex: 0, text: 'Sentence one.' },
        { index: 1, paragraphNumber: 2, paragraphIndex: 1, text: 'Sentence two.' }
      ]
    },
    {
      overallBand: 8,
      aggregatedResults: [
        {
          criterion: 'CC',
          band: 8,
          baseKey: 'CC8-2',
          atomic_question: 'Is cohesion well managed overall (links + referencing work consistently)?',
          value: 'Yes',
          scoredAnswers: ['Yes'],
          notScoredAnswers: ['No'],
          source: 'deterministic',
          evidenceSentenceIndices: [0]
        },
        {
          criterion: 'CC',
          band: 9,
          baseKey: 'CC9-1',
          atomic_question: 'Does cohesion attract no attention (smooth, natural, no noticeable misuse/mechanical linking)?',
          value: 'No',
          scoredAnswers: ['Yes'],
          notScoredAnswers: ['No'],
          source: 'deterministic',
          evidenceSentenceIndices: [1]
        }
      ]
    },
    { modelId: 'stub-model' }
  );

  const strengths = Array.isArray(feedback?.strengths) ? feedback.strengths.map((s) => String(s)) : [];
  assert.ok(strengths.some((s) => s.includes('cohesion well managed overall')));
  assert.ok(!strengths.some((s) => s.includes('cohesion attract no attention')));
});

