const test = require('node:test');
const assert = require('node:assert/strict');

const { ExtractionSchema } = require('../MVC/services/ielts/extractionSchema');
const step3ScoringService = require('../MVC/services/ielts/step3ScoringService');
const { scoringRules } = require('../MVC/services/ielts/scoringRules');
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

function buildEssayFixture() {
  return {
    normalizedText: 'Intro sentence. Body one with development. Body two with support. Conclusion sentence.',
    paragraphs: [
      { paragraphNumber: 1, text: 'Intro sentence.' },
      { paragraphNumber: 2, text: 'Body one with development.' },
      { paragraphNumber: 3, text: 'Body two with support.' },
      { paragraphNumber: 4, text: 'Conclusion sentence.' }
    ],
    sentences: [
      { index: 0, paragraphIndex: 0, paragraphNumber: 1, text: 'Intro sentence.' },
      { index: 1, paragraphIndex: 1, paragraphNumber: 2, text: 'Body one with development.' },
      { index: 2, paragraphIndex: 2, paragraphNumber: 3, text: 'Body two with support.' },
      { index: 3, paragraphIndex: 3, paragraphNumber: 4, text: 'Conclusion sentence.' }
    ],
    stats: {
      wordCount: 170,
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
    cohesion: { densityPer100: '3.20' },
    lexical: { topRepeatedWords: [{ word: 'idea', count: 3 }] }
  };
}

function buildExtractionBase() {
  return {
    position: {
      stance: 'agree',
      stanceSentenceIndex: 0,
      contradictionSentenceIndices: []
    },
    answersBySubquestion: {
      q1_task_response: [1, 2]
    },
    bodySupport: [
      { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [1] },
      { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [2] }
    ],
    topicSentenceByParagraph: [
      { paragraphIndex: 0, topicSentenceIndex: 0 },
      { paragraphIndex: 1, topicSentenceIndex: 1 },
      { paragraphIndex: 2, topicSentenceIndex: 2 },
      { paragraphIndex: 3, topicSentenceIndex: 3 }
    ]
  };
}

test('Extraction schema accepts richer LR/GRA fields and legacy payloads', () => {
  const base = buildExtractionBase();

  const richPayload = {
    ...base,
    lexicalControl: {
      rangeBand: 'wide',
      precisionBand: 'good',
      collocationControl: 'good',
      awkwardExpressionCountBand: 'few',
      spellingImpact: 'minor',
      wordFormationImpact: 'minor',
      repetitionImpact: 'mild',
      clarityImpactFromLexis: 'minor'
    },
    grammarControl: {
      structureRange: 'varied',
      complexSentenceControl: 'good',
      errorFrequency: 'occasional',
      subjectVerbAgreement: 'strong',
      articleControl: 'mixed',
      prepositionControl: 'mixed',
      punctuationControl: 'strong',
      sentenceBoundaryControl: 'strong',
      clarityImpactFromGrammar: 'minor',
      errorFreeSentenceShareBand: 'moderate'
    },
    lexicalQuality: {
      range: 'wide',
      precision: 'high',
      uncommonSkill: 'skilful'
    },
    errorProfiles: {
      grammar: 'occasional',
      lexical: 'occasional',
      punctuation: 'rare'
    }
  };

  const parsedRich = ExtractionSchema.parse(richPayload);
  assert.equal(parsedRich.lexicalControl.rangeBand, 'wide');
  assert.equal(parsedRich.grammarControl.errorFrequency, 'occasional');

  const legacyPayload = {
    ...base,
    lexicalQuality: {
      range: 'adequate',
      precision: 'mixed',
      uncommonSkill: 'some'
    },
    errorProfiles: {
      grammar: 'frequent',
      lexical: 'occasional',
      punctuation: 'frequent'
    }
  };
  const parsedLegacy = ExtractionSchema.parse(legacyPayload);
  assert.equal(parsedLegacy.lexicalQuality.range, 'adequate');
  assert.equal(parsedLegacy.lexicalControl, undefined);
});

test('Step 3 runtime context exposes richer LR/GRA evidence for legacy extractions', async () => {
  const restoreStack = createRestoreStack();
  const customRuleKey = '__TEST_LR_GRA_CTX';
  const originalRule = scoringRules[customRuleKey];
  try {
    restoreStack.stub(aiService, 'sendMessage', async () => {
      throw new Error('AI should not be called for deterministic runtime-context test.');
    });

    scoringRules[customRuleKey] = (ctx) => {
      if (ctx?.step25?.lexicalControl && ctx?.step25?.grammarControl) return 'Yes';
      return 'No';
    };

    const extraction = {
      ...buildExtractionBase(),
      lexicalQuality: {
        range: 'adequate',
        precision: 'mixed',
        uncommonSkill: 'some'
      },
      errorProfiles: {
        grammar: 'occasional',
        lexical: 'occasional',
        punctuation: 'occasional'
      }
    };

    const result = await step3ScoringService.runStep3Scoring({
      essayObj: buildEssayFixture(),
      step2Features: buildStep2Fixture(),
      extraction,
      taskPrompt: 'Discuss both views and give your opinion.',
      microAssessments: [
        {
          baseKey: customRuleKey,
          question_key: customRuleKey,
          is_active: true,
          scope: 'essay',
          criterion: 'LR',
          band: 4,
          answer_type: 'Boolean',
          atomic_question: 'Test runtime context for lexical/grammar evidence.'
        }
      ],
      options: { mode: 'hybrid_extension', modelId: 'gemini-2.0-flash' }
    });

    const row = result.results.find((item) => item.baseKey === customRuleKey);
    assert.ok(row, 'Expected custom deterministic row to exist.');
    assert.equal(row.source, 'deterministic');
    assert.equal(row.value, 'Yes');
    assert.ok(result?.meta?.step3LanguageEvidence?.lexicalControl, 'Expected lexicalControl in Step 3 meta.');
    assert.ok(result?.meta?.step3LanguageEvidence?.grammarControl, 'Expected grammarControl in Step 3 meta.');
  } finally {
    if (originalRule) scoringRules[customRuleKey] = originalRule;
    else delete scoringRules[customRuleKey];
    restoreStack.restoreAll();
  }
});

test('Updated LR/GRA deterministic rules consume richer evidence safely', async () => {
  const restoreStack = createRestoreStack();
  try {
    restoreStack.stub(aiService, 'sendMessage', async () => {
      throw new Error('AI should not be called for deterministic LR/GRA rule test.');
    });

    const extraction = {
      ...buildExtractionBase(),
      lexicalControl: {
        rangeBand: 'wide',
        precisionBand: 'good',
        collocationControl: 'good',
        awkwardExpressionCountBand: 'few',
        spellingImpact: 'minor',
        wordFormationImpact: 'minor',
        repetitionImpact: 'mild',
        clarityImpactFromLexis: 'minor'
      },
      grammarControl: {
        structureRange: 'varied',
        complexSentenceControl: 'good',
        errorFrequency: 'occasional',
        subjectVerbAgreement: 'strong',
        articleControl: 'mixed',
        prepositionControl: 'mixed',
        punctuationControl: 'mixed',
        sentenceBoundaryControl: 'mixed',
        clarityImpactFromGrammar: 'minor',
        errorFreeSentenceShareBand: 'moderate'
      }
    };

    const result = await step3ScoringService.runStep3Scoring({
      essayObj: buildEssayFixture(),
      step2Features: buildStep2Fixture(),
      extraction,
      taskPrompt: 'Discuss both views and give your opinion.',
      microAssessments: [
        {
          baseKey: 'LR5-1',
          question_key: 'LR5-1',
          is_active: true,
          scope: 'essay',
          criterion: 'LR',
          band: 5,
          answer_type: 'Boolean',
          atomic_question: 'Is vocabulary limited?'
        },
        {
          baseKey: 'LR7-1',
          question_key: 'LR7-1',
          is_active: true,
          scope: 'essay',
          criterion: 'LR',
          band: 7,
          answer_type: 'Boolean',
          atomic_question: 'Is vocabulary range wide enough for clear precision?'
        },
        {
          baseKey: 'GRA5-4',
          question_key: 'GRA5-4',
          is_active: true,
          scope: 'essay',
          criterion: 'GRA',
          band: 5,
          answer_type: 'Boolean',
          atomic_question: 'Are grammar errors frequent?'
        },
        {
          baseKey: 'GRA6-3',
          question_key: 'GRA6-3',
          is_active: true,
          scope: 'essay',
          criterion: 'GRA',
          band: 6,
          answer_type: 'Ordinal (rarely/sometimes/often)',
          atomic_question: 'How often do grammar or punctuation errors occur?'
        }
      ],
      options: { mode: 'hybrid_extension', modelId: 'gemini-2.0-flash' }
    });

    const lr51 = result.results.find((row) => row.baseKey === 'LR5-1');
    const lr71 = result.results.find((row) => row.baseKey === 'LR7-1');
    const gra54 = result.results.find((row) => row.baseKey === 'GRA5-4');
    const gra63 = result.results.find((row) => row.baseKey === 'GRA6-3');

    assert.equal(lr51?.source, 'deterministic');
    assert.equal(lr71?.source, 'deterministic');
    assert.equal(gra54?.source, 'deterministic');
    assert.equal(gra63?.source, 'deterministic');

    assert.equal(lr51?.value, 'No');
    assert.equal(lr71?.value, 'Yes');
    assert.equal(gra54?.value, 'No');
    assert.equal(gra63?.value, 'rarely');
  } finally {
    restoreStack.restoreAll();
  }
});

test('Step 4 preview prompt includes richer LR/GRA evidence snapshot', async () => {
  const preview = await step3ScoringService.buildStep4PromptPreview({
    essayObj: buildEssayFixture(),
    step2Features: buildStep2Fixture(),
    extraction: {
      ...buildExtractionBase(),
      lexicalControl: {
        rangeBand: 'adequate',
        precisionBand: 'mixed',
        collocationControl: 'mixed',
        awkwardExpressionCountBand: 'some',
        spellingImpact: 'minor',
        wordFormationImpact: 'minor',
        repetitionImpact: 'mild',
        clarityImpactFromLexis: 'minor'
      },
      grammarControl: {
        structureRange: 'mixed',
        complexSentenceControl: 'mixed',
        errorFrequency: 'occasional',
        subjectVerbAgreement: 'mixed',
        articleControl: 'mixed',
        prepositionControl: 'mixed',
        punctuationControl: 'mixed',
        sentenceBoundaryControl: 'mixed',
        clarityImpactFromGrammar: 'minor',
        errorFreeSentenceShareBand: 'moderate'
      }
    },
    taskPrompt: 'Discuss both views and give your opinion.',
    microAssessments: [
      {
        baseKey: 'LR_PREVIEW_AI',
        question_key: 'LR_PREVIEW_AI',
        is_active: true,
        scope: 'essay',
        criterion: 'LR',
        band: 6,
        answer_type: 'Boolean',
        atomic_question: 'Preview-only AI item for prompt inspection.'
      }
    ],
    options: {
      mode: 'hybrid_extension',
      modelId: 'gemini-2.0-flash'
    }
  });

  const prompt = String(preview?.prompts?.[0] || '');
  assert.ok(prompt.includes('LANGUAGE EVIDENCE SNAPSHOT (Step 3):'));
  assert.ok(prompt.includes('lexicalControl'));
  assert.ok(prompt.includes('grammarControl'));
});
