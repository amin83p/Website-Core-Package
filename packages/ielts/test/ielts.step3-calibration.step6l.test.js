const test = require('node:test');
const assert = require('node:assert/strict');

const aiService = require('../packages/ielts/MVC/services/ielts/aiService');
const aiExtractionService = require('../packages/ielts/MVC/services/ielts/aiExtractionService');
const step3ScoringService = require('../packages/ielts/MVC/services/ielts/step3ScoringService');

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

function buildEssayObj() {
  return {
    normalizedText: 'Intro sentence. Body support one. Body support two. Conclusion sentence.',
    paragraphs: [
      { paragraphNumber: 1, text: 'Intro sentence.' },
      { paragraphNumber: 2, text: 'Body support one.' },
      { paragraphNumber: 3, text: 'Body support two.' },
      { paragraphNumber: 4, text: 'Conclusion sentence.' }
    ],
    sentences: [
      { index: 0, paragraphIndex: 0, paragraphNumber: 1, text: 'Intro sentence.' },
      { index: 1, paragraphIndex: 1, paragraphNumber: 2, text: 'Body support one.' },
      { index: 2, paragraphIndex: 2, paragraphNumber: 3, text: 'Body support two.' },
      { index: 3, paragraphIndex: 3, paragraphNumber: 4, text: 'Conclusion sentence.' }
    ],
    stats: {
      wordCount: 230,
      sentenceCount: 4,
      paragraphCount: 4
    }
  };
}

function buildBasePayload() {
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

function buildStrongButHarshPayload() {
  return {
    ...buildBasePayload(),
    lexicalQuality: {
      range: 'adequate',
      precision: 'mixed',
      uncommonSkill: 'some'
    },
    errorProfiles: {
      grammar: 'frequent',
      lexical: 'occasional',
      punctuation: 'occasional'
    },
    lexicalControl: {
      rangeBand: 'wide',
      precisionBand: 'high',
      collocationControl: 'good',
      awkwardExpressionCountBand: 'few',
      spellingImpact: 'minor',
      wordFormationImpact: 'minor',
      repetitionImpact: 'mild',
      clarityImpactFromLexis: 'some'
    },
    grammarControl: {
      structureRange: 'wide',
      complexSentenceControl: 'good',
      errorFrequency: 'frequent',
      subjectVerbAgreement: 'mixed',
      articleControl: 'mixed',
      prepositionControl: 'mixed',
      punctuationControl: 'mixed',
      sentenceBoundaryControl: 'mixed',
      clarityImpactFromGrammar: 'some',
      errorFreeSentenceShareBand: 'low'
    }
  };
}

function buildMidBandPayload() {
  return {
    ...buildBasePayload(),
    lexicalQuality: {
      range: 'adequate',
      precision: 'mixed',
      uncommonSkill: 'some'
    },
    errorProfiles: {
      grammar: 'frequent',
      lexical: 'frequent',
      punctuation: 'frequent'
    },
    lexicalControl: {
      rangeBand: 'adequate',
      precisionBand: 'mixed',
      collocationControl: 'weak',
      awkwardExpressionCountBand: 'many',
      spellingImpact: 'frequent',
      wordFormationImpact: 'frequent',
      repetitionImpact: 'strong',
      clarityImpactFromLexis: 'some'
    },
    grammarControl: {
      structureRange: 'mixed',
      complexSentenceControl: 'weak',
      errorFrequency: 'frequent',
      subjectVerbAgreement: 'weak',
      articleControl: 'weak',
      prepositionControl: 'weak',
      punctuationControl: 'weak',
      sentenceBoundaryControl: 'weak',
      clarityImpactFromGrammar: 'some',
      errorFreeSentenceShareBand: 'low'
    }
  };
}

test('Step 3 prompt contains high-band LR/GRA calibration anchors', () => {
  const prompt = aiExtractionService.buildExtractionPrompt({
    taskDefinition: aiExtractionService.prepareTask2Prompt('Discuss both views and give your opinion.'),
    essayObj: buildEssayObj(),
    paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
    stabilityProfile: 'standard'
  });

  assert.ok(prompt.includes('HIGH-BAND LR/GRA CALIBRATION ANCHORS (IMPORTANT):'));
  assert.ok(prompt.includes('Reserve grammar errorFrequency="frequent"'));
  assert.ok(prompt.includes('Do not collapse strong scripts into mid labels'));
});

test('Strong high-band language payload is calibrated to less harsh coherent labels', async () => {
  const restoreStack = createRestoreStack();
  try {
    restoreStack.stub(aiService, 'sendMessage', async () => ({
      text: JSON.stringify(buildStrongButHarshPayload()),
      modelUsed: 'stub-model',
      usage: null,
      requestMeta: null
    }));

    const result = await aiExtractionService.runAiExtraction({
      essayObj: buildEssayObj(),
      samplePrompt: 'Discuss both views and give your opinion.',
      paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
      retries: 1,
      disableCache: true,
      model: 'stub-model'
    });

    assert.equal(result?.extraction?.lexicalControl?.clarityImpactFromLexis, 'minor');
    assert.equal(result?.extraction?.grammarControl?.errorFreeSentenceShareBand, 'moderate');
    assert.equal(result?.extraction?.grammarControl?.errorFrequency, 'noticeable');
    assert.equal(result?.extraction?.grammarControl?.clarityImpactFromGrammar, 'minor');
    assert.equal(result?.extraction?.lexicalQuality?.range, 'wide');
    assert.equal(result?.extraction?.lexicalQuality?.precision, 'high');
    assert.ok(result?.meta?.languageCalibration?.applied);
    assert.ok(Number(result?.meta?.languageCalibration?.adjustmentCount || 0) >= 1);
  } finally {
    restoreStack.restoreAll();
  }
});

test('Mid-band language payload keeps lower labels without unjustified softening', async () => {
  const restoreStack = createRestoreStack();
  try {
    restoreStack.stub(aiService, 'sendMessage', async () => ({
      text: JSON.stringify(buildMidBandPayload()),
      modelUsed: 'stub-model',
      usage: null,
      requestMeta: null
    }));

    const result = await aiExtractionService.runAiExtraction({
      essayObj: buildEssayObj(),
      samplePrompt: 'Discuss both views and give your opinion.',
      paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
      retries: 1,
      disableCache: true,
      model: 'stub-model'
    });

    assert.equal(result?.extraction?.grammarControl?.errorFrequency, 'frequent');
    assert.equal(result?.extraction?.grammarControl?.clarityImpactFromGrammar, 'some');
    assert.equal(result?.extraction?.lexicalControl?.clarityImpactFromLexis, 'some');
    assert.equal(result?.meta?.languageCalibration?.applied, false);
  } finally {
    restoreStack.restoreAll();
  }
});

test('Legacy-only payload remains backward compatible and maps to rich evidence', async () => {
  const restoreStack = createRestoreStack();
  try {
    const legacyOnly = {
      ...buildBasePayload(),
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

    restoreStack.stub(aiService, 'sendMessage', async () => ({
      text: JSON.stringify(legacyOnly),
      modelUsed: 'stub-model',
      usage: null,
      requestMeta: null
    }));

    const result = await aiExtractionService.runAiExtraction({
      essayObj: buildEssayObj(),
      samplePrompt: 'Discuss both views and give your opinion.',
      paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
      retries: 1,
      disableCache: true,
      model: 'stub-model'
    });

    assert.ok(result?.extraction?.lexicalControl);
    assert.ok(result?.extraction?.grammarControl);
  } finally {
    restoreStack.restoreAll();
  }
});

test('Step 4 normalization exposes calibration adjustments for inconsistent loaded evidence', async () => {
  const restoreStack = createRestoreStack();
  try {
    restoreStack.stub(aiService, 'sendMessage', async () => {
      throw new Error('AI should not be called for Step 4 normalization calibration test.');
    });

    const result = await step3ScoringService.runStep3Scoring({
      essayObj: buildEssayObj(),
      step2Features: {
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
        cohesion: { densityPer100: '3.10' },
        lexical: { topRepeatedWords: [{ word: 'idea', count: 3 }] }
      },
      extraction: buildStrongButHarshPayload(),
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
        }
      ],
      options: { mode: 'hybrid_extension', modelId: 'stub-model' }
    });

    const calibration = result?.meta?.step3LanguageEvidence?.calibration || {};
    assert.equal(calibration.applied, true);
    assert.ok(Number(calibration.adjustmentCount || 0) >= 1);
    assert.equal(result?.meta?.step3LanguageEvidence?.grammarControl?.errorFrequency, 'noticeable');
    assert.equal(result?.meta?.step3LanguageEvidence?.lexicalControl?.clarityImpactFromLexis, 'minor');
  } finally {
    restoreStack.restoreAll();
  }
});

