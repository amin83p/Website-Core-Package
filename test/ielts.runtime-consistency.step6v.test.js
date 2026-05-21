const test = require('node:test');
const assert = require('node:assert/strict');

const step3ScoringService = require('../MVC/services/ielts/step3ScoringService');
const essayAnalysisService = require('../MVC/services/ielts/essayAnalysisService');

function buildRuntimeConsistencyFixture() {
  return {
    essayObj: {
      rawText: 'Runtime consistency fixture essay.',
      normalizedText: 'Runtime consistency fixture essay.',
      stats: { wordCount: 332 },
      paragraphs: [
        { text: 'Intro paragraph with setup context and position signal.' },
        { text: 'First body paragraph develops one idea with explanation and support detail.' },
        { text: 'Second body paragraph expands the same line of argument with more support.' },
        { text: 'Third body paragraph provides additional explanation tied to the same position.' },
        { text: 'Conclusion restates stance clearly and closes the response.' }
      ],
      sentences: Array.from({ length: 20 }, (_, index) => ({ index, text: `Sentence ${index + 1}.` }))
    },
    step2Features: {
      structure: {
        paragraphCount: 5,
        sentenceCount: 20,
        paragraphRoles: ['intro', 'body', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [5, 4, 6, 2, 3],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 5, paragraphWordCount: 40, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 4, paragraphWordCount: 88, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 6, paragraphWordCount: 96, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'body', sentenceCount: 2, paragraphWordCount: 62, virtualSentenceCount: 0 },
        { paragraphIndex: 4, role: 'conclusion', sentenceCount: 3, paragraphWordCount: 46, virtualSentenceCount: 0 }
      ],
      taskEcho: {
        wordOverlapRatio: 0,
        reusedPromptPhraseCount: 0,
        reusedPromptSentenceLikeCount: 0,
        copiedWordEstimate: 0,
        effectiveContentWordCount: 332,
        effectiveContentRatio: 1,
        severity: 'none',
        anchorReuseCount: 0,
        matchedUnitDiagnostics: []
      }
    },
    extraction: {
      answersBySubquestion: {
        q1_to_what_extent_do_you_agree_or_disagree: [18]
      },
      position: {
        stance: 'partial',
        stanceSentenceIndex: 18,
        contradictionSentenceIndices: []
      },
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [6, 7, 8] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [10, 11, 12, 13, 14] },
        { paragraphIndex: 3, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [16] }
      ],
      topicSentenceByParagraph: [
        { paragraphIndex: 1, topicSentenceIndex: 5 },
        { paragraphIndex: 2, topicSentenceIndex: 9 },
        { paragraphIndex: 3, topicSentenceIndex: 15 }
      ],
      lexicalQuality: {
        range: 'adequate',
        precision: 'mixed',
        uncommonSkill: 'some'
      },
      errorProfiles: {
        grammar: 'occasional',
        lexical: 'rare',
        punctuation: 'rare'
      },
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
        structureRange: 'varied',
        complexSentenceControl: 'mixed',
        errorFrequency: 'occasional',
        subjectVerbAgreement: 'mixed',
        articleControl: 'mixed',
        prepositionControl: 'mixed',
        punctuationControl: 'strong',
        sentenceBoundaryControl: 'strong',
        clarityImpactFromGrammar: 'minor',
        errorFreeSentenceShareBand: 'moderate'
      }
    },
    microAssessments: [
      {
        id: 'MA_RUNTIME_LR6_1',
        orgId: '900000',
        is_active: true,
        baseKey: 'LR6-1',
        question_key: 'LR6-1',
        criterion: 'LR',
        band: 6,
        scope: 'essay',
        answer_type: 'Boolean',
        atomic_question: 'Is vocabulary range adequate for the task?',
        rubric_anchor: 'Band 6 lexical range descriptor.',
        signalClassification: 'deterministic',
        scoredAnswers: ['Yes'],
        notScoredAnswers: ['No'],
        weight: 3
      }
    ]
  };
}

function harshComputedTaskEcho() {
  return {
    wordOverlapRatio: 0,
    reusedPromptPhraseCount: 0,
    reusedPromptSentenceLikeCount: 0,
    copiedWordEstimate: 0,
    effectiveContentWordCount: 316,
    effectiveContentRatio: 0.95,
    severity: 'moderate',
    anchorReuseCount: 0,
    matchedUnitDiagnostics: []
  };
}

test('Step 4 runtime consistency: preserves existing Step-2 taskEcho when complete', async () => {
  const fixture = buildRuntimeConsistencyFixture();
  const originalCompute = essayAnalysisService.computeTaskEchoSignals;
  let computeCalls = 0;

  essayAnalysisService.computeTaskEchoSignals = () => {
    computeCalls += 1;
    return harshComputedTaskEcho();
  };

  try {
    const result = await step3ScoringService.runStep3Scoring({
      essayObj: fixture.essayObj,
      step2Features: fixture.step2Features,
      extraction: fixture.extraction,
      microAssessments: fixture.microAssessments,
      taskPrompt: 'To what extent do you agree or disagree?',
      options: {
        mode: 'hybrid_extension',
        batchSize: 1,
        concurrency: 1,
        disableCache: true
      }
    });

    const row = (result.results || []).find((item) => item.baseKey === 'LR6-1');
    assert.ok(row);
    assert.equal(row.source, 'deterministic');
    assert.equal(row.value, 'Yes');
    assert.equal(computeCalls, 0);
  } finally {
    essayAnalysisService.computeTaskEchoSignals = originalCompute;
  }
});

test('Step 4 runtime consistency: recomputes taskEcho when Step-2 payload is missing', async () => {
  const fixture = buildRuntimeConsistencyFixture();
  const originalCompute = essayAnalysisService.computeTaskEchoSignals;
  let computeCalls = 0;

  essayAnalysisService.computeTaskEchoSignals = () => {
    computeCalls += 1;
    return harshComputedTaskEcho();
  };

  try {
    const step2WithoutTaskEcho = { ...fixture.step2Features };
    delete step2WithoutTaskEcho.taskEcho;

    const result = await step3ScoringService.runStep3Scoring({
      essayObj: fixture.essayObj,
      step2Features: step2WithoutTaskEcho,
      extraction: fixture.extraction,
      microAssessments: fixture.microAssessments,
      taskPrompt: 'To what extent do you agree or disagree?',
      options: {
        mode: 'hybrid_extension',
        batchSize: 1,
        concurrency: 1,
        disableCache: true
      }
    });

    const row = (result.results || []).find((item) => item.baseKey === 'LR6-1');
    assert.ok(row);
    assert.equal(row.source, 'deterministic');
    assert.equal(row.value, 'No');
    assert.equal(computeCalls, 1);
  } finally {
    essayAnalysisService.computeTaskEchoSignals = originalCompute;
  }
});
