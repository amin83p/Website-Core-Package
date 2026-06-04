const baselineVersion = '2026-04-17.freeze.v1';

function buildThinLowParagraphCtx() {
  return {
    step1: { stats: { wordCount: 92 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body'],
        paragraphSentenceCounts: [1, 2],
        paragraphVirtualSentenceCounts: [0, 0],
        hasIntro: true,
        hasConclusion: false,
        paragraphCount: 2
      },
      cohesion: {
        densityPer100ExcludingBasic: '0.80',
        distinctConnectorsExcludingBasic: 1,
        usageMapExcludingBasic: {}
      },
      lexical: {
        referencingDensity: 0.7,
        topRepeatedWords: [{ word: 'education', count: 10 }]
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 1, paragraphWordCount: 26, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 2, paragraphWordCount: 46, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      answersBySubquestion: { q1: [1] },
      position: { stance: null, stanceSentenceIndex: null, contradictionSentenceIndices: [] },
      topicSentenceByParagraph: [{ paragraphIndex: 1, topicSentenceIndex: null }],
      bodySupport: [{ paragraphIndex: 1, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [1] }]
    },
    essay: {
      paragraphs: [
        { paragraphNumber: 1, text: 'Thin intro' },
        { paragraphNumber: 2, text: 'Thin body' }
      ]
    }
  };
}

function buildThinSevereLanguageCtx() {
  const ctx = buildThinLowParagraphCtx();
  ctx.step25.lexicalControl = {
    rangeBand: 'limited',
    precisionBand: 'low',
    collocationControl: 'weak',
    awkwardExpressionCountBand: 'many',
    spellingImpact: 'frequent',
    wordFormationImpact: 'frequent',
    repetitionImpact: 'strong',
    clarityImpactFromLexis: 'major'
  };
  ctx.step25.grammarControl = {
    structureRange: 'simple_only',
    complexSentenceControl: 'weak',
    errorFrequency: 'frequent',
    subjectVerbAgreement: 'weak',
    articleControl: 'weak',
    prepositionControl: 'weak',
    punctuationControl: 'weak',
    sentenceBoundaryControl: 'weak',
    clarityImpactFromGrammar: 'major',
    errorFreeSentenceShareBand: 'very_low'
  };
  return ctx;
}

function buildCollapsedParagraphCtx() {
  return {
    step1: { stats: { wordCount: 314 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body'],
        paragraphSentenceCounts: [7, 6],
        paragraphVirtualSentenceCounts: [0, 0],
        hasIntro: true,
        hasConclusion: false,
        paragraphCount: 2
      },
      cohesion: {
        densityPer100ExcludingBasic: '1.91',
        distinctConnectorsExcludingBasic: 6,
        usageMapExcludingBasic: {
          'for example': 1,
          however: 1,
          but: 1,
          because: 1,
          therefore: 1,
          second: 1
        }
      },
      lexical: {
        referencingDensity: 6.05,
        topRepeatedWords: [{ word: 'country', count: 8 }]
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 7, paragraphWordCount: 148, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 6, paragraphWordCount: 166, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      answersBySubquestion: { q1: [2, 3], q2: [7, 8] },
      position: { stance: 'agree', stanceSentenceIndex: 1, contradictionSentenceIndices: [] },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 0 },
        { paragraphIndex: 1, topicSentenceIndex: 7 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [7, 8, 9, 10, 11] }
      ]
    },
    essay: {
      paragraphs: [
        { paragraphNumber: 1, text: 'Intro text block' },
        { paragraphNumber: 2, text: 'Body text block' }
      ]
    }
  };
}

function buildBand65BoundaryRescueCtx() {
  const ctx = buildCollapsedParagraphCtx();
  ctx.step25 = {
    ...ctx.step25,
    lexicalControl: {
      rangeBand: 'adequate',
      precisionBand: 'low',
      collocationControl: 'weak',
      awkwardExpressionCountBand: 'many',
      spellingImpact: 'some',
      wordFormationImpact: 'minor',
      repetitionImpact: 'noticeable',
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
      errorFreeSentenceShareBand: 'very_low'
    }
  };
  return ctx;
}

function buildHighBandGuardMicroBatchCtx() {
  return {
    step1: { stats: { wordCount: 296 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [4, 5, 5, 1],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: true,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '4.73',
        distinctConnectorsExcludingBasic: 10,
        usageMapExcludingBasic: {
          'for instance': 1,
          'in addition': 1,
          'for example': 1,
          'such as': 1,
          however: 1,
          but: 1,
          moreover: 2,
          also: 4,
          first: 1,
          overall: 1
        }
      },
      lexical: {
        referencingDensity: 7.43,
        topRepeatedWords: [
          { word: 'mobile', count: 4 },
          { word: 'social', count: 4 }
        ]
      },
      taskEcho: {
        severity: 'none',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 0,
        effectiveContentWordCount: 296,
        effectiveContentRatio: 1
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 4, paragraphWordCount: 58, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 5, paragraphWordCount: 96, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 5, paragraphWordCount: 93, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 1, paragraphWordCount: 25, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      position: { stance: 'partial', stanceSentenceIndex: 2, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1: [4, 7, 9, 10, 11, 13, 14]
      },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 2 },
        { paragraphIndex: 1, topicSentenceIndex: 5 },
        { paragraphIndex: 2, topicSentenceIndex: 10 },
        { paragraphIndex: 3, topicSentenceIndex: 14 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [5, 6, 8] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [10, 11, 12, 13] }
      ],
      grammarControl: {
        structureRange: 'mixed',
        complexSentenceControl: 'mixed',
        errorFrequency: 'noticeable',
        subjectVerbAgreement: 'weak',
        articleControl: 'mixed',
        prepositionControl: 'mixed',
        punctuationControl: 'mixed',
        sentenceBoundaryControl: 'strong',
        clarityImpactFromGrammar: 'minor',
        errorFreeSentenceShareBand: 'low'
      }
    },
    essay: {
      paragraphs: [
        { paragraphNumber: 1, text: 'Introduction paragraph.' },
        { paragraphNumber: 2, text: 'Body paragraph one.' },
        { paragraphNumber: 3, text: 'Body paragraph two.' },
        { paragraphNumber: 4, text: 'Conclusion paragraph.' }
      ]
    }
  };
}

const baselineProfiles = [
  {
    id: 'guard_c17_like_high_band',
    context: buildHighBandGuardMicroBatchCtx(),
    expected: {
      'TR8-2': 'Yes',
      'TR8-3': 'Yes',
      'TR9-4': 'Yes',
      'CC7-4': 'No',
      'GRA7-4': 'occasional'
    }
  },
  {
    id: 'guard_low_band_severe_floor',
    context: buildThinSevereLanguageCtx(),
    expected: {
      'LR3-1': 'Yes',
      'LR3-2': 'severe',
      'GRA3-1': 'distort',
      'LR4-3': 'Yes',
      'LR4-4': 'Yes',
      'LR4-5': 'strain',
      'GRA4-3': 'Yes',
      'GRA4-4': 'Yes',
      'GRA5-1': 'Yes',
      'GRA5-4': 'Yes',
      'GRA5-5': 'Yes'
    }
  },
  {
    id: 'guard_band65_boundary_rescue',
    context: buildBand65BoundaryRescueCtx(),
    expected: {
      'LR5-2': 'No',
      'LR5-3': 'No',
      'LR5-4': 'some',
      'GRA5-4': 'No',
      'GRA5-6': 'none'
    }
  }
];

module.exports = {
  baselineVersion,
  baselineProfiles
};
