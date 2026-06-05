const test = require('node:test');
const assert = require('node:assert/strict');

const { scoringRules } = require('../packages/ielts/MVC/services/ielts/scoringRules');

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
      topicSentenceByParagraph: [
        { paragraphIndex: 1, topicSentenceIndex: null }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [1] }
      ]
    },
    essay: {
      paragraphs: [
        { paragraphNumber: 1, text: 'Thin intro' },
        { paragraphNumber: 2, text: 'Thin body' }
      ]
    }
  };
}

function buildModerateGrammarCtx() {
  return {
    step25: {
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
    }
  };
}

function buildSevereGrammarCtx() {
  return {
    step25: {
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
    }
  };
}

function buildGra2SinglePartRecoverableBoundaryCtx() {
  return {
    step1: {
      stats: {
        wordCount: 252
      }
    },
    step2: {
      taskEcho: {
        severity: 'moderate',
        effectiveContentWordCount: 226,
        effectiveContentRatio: 0.9,
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 1
      }
    },
    step25: {
      answersBySubquestion: {
        q1_task_response: [1, 3, 5, 7]
      },
      position: {
        stance: 'agree',
        stanceSentenceIndex: 0,
        contradictionSentenceIndices: []
      },
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [3, 4] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [6] },
        { paragraphIndex: 3, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [8] },
        { paragraphIndex: 4, hasExplanation: false, hasExample: true, evidenceSentenceIndices: [10] }
      ],
      grammarControl: {
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
      }
    }
  };
}

function buildTr7CoverageSignalThinRecoverableCtx() {
  return {
    step1: { stats: { wordCount: 332 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 3, 3, 3, 1],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 5,
        conclusionSignpostFoundInLast: true,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '1.62',
        distinctConnectorsExcludingBasic: 4,
        usageMapExcludingBasic: {
          however: 2,
          therefore: 1,
          moreover: 1
        }
      },
      lexical: {
        referencingDensity: 5.8,
        topRepeatedWords: [
          { word: 'education', count: 8 },
          { word: 'students', count: 6 }
        ]
      },
      taskEcho: {
        severity: 'moderate',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 2,
        copiedWordEstimate: 18,
        effectiveContentWordCount: 316,
        effectiveContentRatio: 0.95
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 39, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 3, paragraphWordCount: 87, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 3, paragraphWordCount: 82, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'body', sentenceCount: 3, paragraphWordCount: 79, virtualSentenceCount: 0 },
        { paragraphIndex: 4, role: 'conclusion', sentenceCount: 1, paragraphWordCount: 29, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      position: { stance: 'agree', stanceSentenceIndex: 1, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1_task_response: [3]
      },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 0 },
        { paragraphIndex: 1, topicSentenceIndex: 2 },
        { paragraphIndex: 2, topicSentenceIndex: 5 },
        { paragraphIndex: 3, topicSentenceIndex: 8 },
        { paragraphIndex: 4, topicSentenceIndex: 10 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [3, 4] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [6, 7] },
        { paragraphIndex: 3, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [9] }
      ]
    }
  };
}

function buildLr6SinglePartCoverageSignalBoundaryCtx() {
  return {
    step1: { stats: { wordCount: 332 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [5, 4, 6, 2, 3],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 5,
        conclusionSignpostFoundInLast: true,
        misplacedConclusionSignpost: false
      },
      lexical: {
        referencingDensity: '7.83',
        topRepeatedWords: [
          { word: 'goods', count: 8 },
          { word: 'buy', count: 8 },
          { word: 'advertising', count: 7 }
        ]
      },
      taskEcho: {
        severity: 'none',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 0,
        copiedWordEstimate: 0,
        effectiveContentWordCount: 332,
        effectiveContentRatio: 1
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 5, paragraphWordCount: 73, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 4, paragraphWordCount: 78, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 6, paragraphWordCount: 102, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'body', sentenceCount: 2, paragraphWordCount: 41, virtualSentenceCount: 0 },
        { paragraphIndex: 4, role: 'conclusion', sentenceCount: 3, paragraphWordCount: 38, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      position: { stance: 'partial', stanceSentenceIndex: 18, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1_to_what_extent_do_you_agree_or_disagree: [5]
      },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: null },
        { paragraphIndex: 1, topicSentenceIndex: 5 },
        { paragraphIndex: 2, topicSentenceIndex: 9 },
        { paragraphIndex: 3, topicSentenceIndex: 15 },
        { paragraphIndex: 4, topicSentenceIndex: 17 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [6, 7, 8] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [10, 11, 12, 13, 14] },
        { paragraphIndex: 3, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [16] }
      ],
      lexicalControl: {
        rangeBand: 'adequate',
        precisionBand: 'mixed',
        collocationControl: 'mixed',
        awkwardExpressionCountBand: 'some',
        spellingImpact: 'minor',
        wordFormationImpact: 'minor',
        repetitionImpact: 'mild',
        clarityImpactFromLexis: 'minor'
      }
    }
  };
}

function buildTr8PartialStanceHighControlBoundaryCtx() {
  return {
    step1: { stats: { wordCount: 268 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 4, 4, 1],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: true,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '1.55',
        distinctConnectorsExcludingBasic: 4,
        usageMapExcludingBasic: {
          however: 2,
          therefore: 1,
          moreover: 1
        }
      },
      lexical: {
        referencingDensity: 5.4,
        topRepeatedWords: [
          { word: 'technology', count: 6 },
          { word: 'people', count: 5 }
        ]
      },
      taskEcho: {
        severity: 'none',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 0,
        copiedWordEstimate: 0,
        effectiveContentWordCount: 251,
        effectiveContentRatio: 1
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 42, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 4, paragraphWordCount: 101, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 4, paragraphWordCount: 92, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 1, paragraphWordCount: 33, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      position: { stance: 'partial', stanceSentenceIndex: 10, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1_task_response: [2, 3, 4, 5, 6, 7, 8, 9, 10]
      },
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [3, 4, 5] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [7, 8, 9] }
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

function buildCc6ThinConclusionHighControlBoundaryCtx() {
  return {
    step1: { stats: { wordCount: 266 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 4, 4, 1],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: false,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '1.20',
        distinctConnectorsExcludingBasic: 3,
        usageMapExcludingBasic: {
          however: 2,
          therefore: 1,
          moreover: 1
        }
      },
      lexical: {
        referencingDensity: 7.6,
        topRepeatedWords: [
          { word: 'technology', count: 6 },
          { word: 'people', count: 4 }
        ]
      },
      taskEcho: {
        severity: 'none',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 0,
        copiedWordEstimate: 0,
        effectiveContentWordCount: 251,
        effectiveContentRatio: 1
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 35, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 4, paragraphWordCount: 96, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 4, paragraphWordCount: 91, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 1, paragraphWordCount: 29, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      position: { stance: 'agree', stanceSentenceIndex: 1, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1_task_response: [2, 3, 4, 5, 6, 7, 8, 9, 10]
      },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 0 },
        { paragraphIndex: 1, topicSentenceIndex: 2 },
        { paragraphIndex: 2, topicSentenceIndex: 6 },
        { paragraphIndex: 3, topicSentenceIndex: 10 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [2, 3, 4] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [6, 7, 8] }
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

function buildModerateLexicalCtx() {
  return {
    step25: {
      lexicalControl: {
        rangeBand: 'limited',
        precisionBand: 'low',
        collocationControl: 'weak',
        awkwardExpressionCountBand: 'many',
        spellingImpact: 'some',
        wordFormationImpact: 'some',
        repetitionImpact: 'noticeable',
        clarityImpactFromLexis: 'some'
      }
    }
  };
}

function buildSevereLexicalCtx() {
  return {
    step25: {
      lexicalControl: {
        rangeBand: 'limited',
        precisionBand: 'low',
        collocationControl: 'weak',
        awkwardExpressionCountBand: 'many',
        spellingImpact: 'frequent',
        wordFormationImpact: 'frequent',
        repetitionImpact: 'strong',
        clarityImpactFromLexis: 'major'
      }
    }
  };
}

function buildBand8LexicalNotWideBoundaryCtx() {
  return {
    step25: {
      lexicalControl: {
        rangeBand: 'sufficient',
        precisionBand: 'good',
        collocationControl: 'good',
        awkwardExpressionCountBand: 'few',
        spellingImpact: 'minor',
        wordFormationImpact: 'minor',
        repetitionImpact: 'mild',
        clarityImpactFromLexis: 'minor'
      },
      lexicalQuality: {
        range: 'adequate',
        precision: 'high',
        uncommonSkill: 'skilful'
      }
    }
  };
}

function buildBand8LexicalWideControlCtx() {
  return {
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
      },
      lexicalQuality: {
        range: 'wide',
        precision: 'high',
        uncommonSkill: 'skilful'
      }
    }
  };
}

function buildHighBandTargetMicroBatchCtx() {
  return {
    step1: { stats: { wordCount: 319 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [3, 6, 8, 4],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: false,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '1.57',
        distinctConnectorsExcludingBasic: 5,
        usageMapExcludingBasic: {
          nevertheless: 1,
          therefore: 1,
          also: 1,
          first: 1,
          secondly: 1
        }
      },
      lexical: {
        referencingDensity: 7.52,
        topRepeatedWords: [
          { word: 'day', count: 6 },
          { word: 'working', count: 4 }
        ]
      },
      taskEcho: {
        severity: 'none',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 0,
        effectiveContentWordCount: 319,
        effectiveContentRatio: 1
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 3, paragraphWordCount: 44, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 6, paragraphWordCount: 111, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 8, paragraphWordCount: 122, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 4, paragraphWordCount: 42, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      position: { stance: 'disagree', stanceSentenceIndex: 0, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1: [0, 1, 16, 17]
      },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 0 },
        { paragraphIndex: 1, topicSentenceIndex: 3 },
        { paragraphIndex: 2, topicSentenceIndex: 9 },
        { paragraphIndex: 3, topicSentenceIndex: 16 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [4, 5, 6, 7, 8] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [10, 11, 12, 13, 14, 15] }
      ],
      grammarControl: {
        structureRange: 'varied',
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
    },
    essay: {
      paragraphs: [
        { paragraphNumber: 1, text: 'Introduction paragraph.' },
        { paragraphNumber: 2, text: 'Body paragraph one with development.' },
        { paragraphNumber: 3, text: 'Body paragraph two with development.' },
        { paragraphNumber: 4, text: 'Conclusion paragraph.' }
      ]
    }
  };
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

function buildTrRecoveredPositionCtx() {
  const ctx = buildCollapsedParagraphCtx();
  ctx.step25.position = {
    stance: 'unclear',
    stanceSentenceIndex: null,
    contradictionSentenceIndices: []
  };
  return ctx;
}

function buildTrBodyParagraphRuntime(ctx, paragraphIndex = 1) {
  const paragraphFeature = Array.isArray(ctx?.step2?.perParagraphFeatures)
    ? ctx.step2.perParagraphFeatures.find((item) => Number(item?.paragraphIndex) === Number(paragraphIndex))
    : null;
  const paragraphRow = Array.isArray(ctx?.essay?.paragraphs)
    ? ctx.essay.paragraphs[paragraphIndex]
    : null;
  const topicSentence = Array.isArray(ctx?.step25?.topicSentenceByParagraph)
    ? ctx.step25.topicSentenceByParagraph.find((row) => Number(row?.paragraphIndex) === Number(paragraphIndex))
    : null;
  const bodySupport = Array.isArray(ctx?.step25?.bodySupport)
    ? ctx.step25.bodySupport.find((row) => Number(row?.paragraphIndex) === Number(paragraphIndex))
    : null;

  const currentParagraph = {
    paragraphIndex,
    paragraphNumber: paragraphIndex + 1,
    role: paragraphFeature?.role || 'body',
    feature: paragraphFeature || null,
    text: paragraphRow?.text || '',
    sentences: [],
    topicSentence,
    bodySupport
  };

  return { ...ctx, currentParagraph, paragraph: currentParagraph };
}

function buildStrongDiscourseLexicalBoundaryCtx() {
  const ctx = buildCollapsedParagraphCtx();
  ctx.step25.lexicalControl = {
    rangeBand: 'limited',
    precisionBand: 'mixed',
    collocationControl: 'mixed',
    awkwardExpressionCountBand: 'some',
    spellingImpact: 'minor',
    wordFormationImpact: 'minor',
    repetitionImpact: 'mild',
    clarityImpactFromLexis: 'some'
  };
  return ctx;
}

function buildStrongDiscourseGrammarBoundaryCtx() {
  const ctx = buildCollapsedParagraphCtx();
  ctx.step25.grammarControl = {
    structureRange: 'mixed',
    complexSentenceControl: 'mixed',
    errorFrequency: 'noticeable',
    subjectVerbAgreement: 'strong',
    articleControl: 'mixed',
    prepositionControl: 'mixed',
    punctuationControl: 'strong',
    sentenceBoundaryControl: 'strong',
    clarityImpactFromGrammar: 'minor',
    errorFreeSentenceShareBand: 'moderate'
  };
  return ctx;
}

function buildStrongDiscourseGrammarSevereCtx() {
  const ctx = buildCollapsedParagraphCtx();
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

function buildAdequateMixedLexicalCtx() {
  const ctx = buildCollapsedParagraphCtx();
  ctx.step25.lexicalControl = {
    rangeBand: 'adequate',
    precisionBand: 'mixed',
    collocationControl: 'mixed',
    awkwardExpressionCountBand: 'some',
    spellingImpact: 'some',
    wordFormationImpact: 'some',
    repetitionImpact: 'mild',
    clarityImpactFromLexis: 'minor'
  };
  return ctx;
}

function buildHarshButSupportedLanguageCtx() {
  const ctx = buildCollapsedParagraphCtx();
  ctx.step25.lexicalControl = {
    rangeBand: 'limited',
    precisionBand: 'low',
    collocationControl: 'weak',
    awkwardExpressionCountBand: 'many',
    spellingImpact: 'some',
    wordFormationImpact: 'some',
    repetitionImpact: 'noticeable',
    clarityImpactFromLexis: 'some'
  };
  ctx.step25.grammarControl = {
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
  };
  return ctx;
}

function buildStrongDiscourseSevereLanguageRecoverableCtx() {
  return {
    step1: { stats: { wordCount: 383 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [1, 2, 1, 2, 2],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 5,
        conclusionSignpostFoundInLast: false,
        misplacedConclusionSignpost: false
      },
      lexical: {
        topRepeatedWords: [{ word: 'country', count: 10 }],
        referencingDensity: 4.44
      },
      taskEcho: {
        severity: 'mild',
        effectiveContentWordCount: 360,
        effectiveContentRatio: 0.94
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 1, paragraphWordCount: 38, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 2, paragraphWordCount: 102, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 1, paragraphWordCount: 73, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'body', sentenceCount: 2, paragraphWordCount: 128, virtualSentenceCount: 0 },
        { paragraphIndex: 4, role: 'conclusion', sentenceCount: 2, paragraphWordCount: 42, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      answersBySubquestion: {
        q1: [0, 2, 3, 4, 5, 6, 7]
      },
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [1, 2] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [3] },
        { paragraphIndex: 3, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [4, 5] }
      ],
      lexicalControl: {
        rangeBand: 'limited',
        precisionBand: 'low',
        collocationControl: 'weak',
        awkwardExpressionCountBand: 'many',
        spellingImpact: 'frequent',
        wordFormationImpact: 'frequent',
        repetitionImpact: 'noticeable',
        clarityImpactFromLexis: 'major'
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
        clarityImpactFromGrammar: 'major',
        errorFreeSentenceShareBand: 'very_low'
      }
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

function buildGRA4ControlledNoticeableCtx() {
  return {
    step1: { stats: { wordCount: 296 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [4, 5, 5, 1],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4
      },
      lexical: {
        topRepeatedWords: [{ word: 'mobile', count: 4 }],
        referencingDensity: 7.43
      },
      taskEcho: {
        severity: 'none',
        effectiveContentWordCount: 288,
        effectiveContentRatio: 0.97
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 4, paragraphWordCount: 76, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 5, paragraphWordCount: 101, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 5, paragraphWordCount: 97, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 1, paragraphWordCount: 22, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      answersBySubquestion: {
        q1: [4, 7, 9, 10, 11, 13, 14]
      },
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
    }
  };
}

function buildClearConclusionCtx() {
  const ctx = buildCollapsedParagraphCtx();
  ctx.step2.structure = {
    ...ctx.step2.structure,
    paragraphRoles: ['intro', 'body', 'conclusion'],
    paragraphSentenceCounts: [4, 6, 2],
    hasConclusion: true,
    paragraphCount: 3,
    conclusionSignpostFoundInLast: true,
    misplacedConclusionSignpost: false
  };
  ctx.step2.perParagraphFeatures = [
    { paragraphIndex: 0, role: 'intro', sentenceCount: 4, paragraphWordCount: 88, virtualSentenceCount: 0 },
    { paragraphIndex: 1, role: 'body', sentenceCount: 6, paragraphWordCount: 162, virtualSentenceCount: 0 },
    { paragraphIndex: 2, role: 'conclusion', sentenceCount: 2, paragraphWordCount: 46, virtualSentenceCount: 0 }
  ];
  return ctx;
}

function buildLikelyIrrelevantDetailCtx() {
  const ctx = buildCollapsedParagraphCtx();
  ctx.step2.taskEcho = {
    severity: 'severe',
    reusedPromptSentenceLikeCount: 3,
    reusedPromptPhraseCount: 6,
    copiedWordEstimate: 64,
    anchorReuseCount: 8,
    matchedUnitCount: 8,
    effectiveContentWordCount: 244,
    effectiveContentRatio: 0.68
  };
  ctx.step25.answersBySubquestion = {
    q1: [2, 3, 4, 5, 6],
    q2: []
  };
  ctx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [7] }
  ];
  return ctx;
}

function buildOverlinkedRepetitiveMidBandCtx() {
  return {
    step1: { stats: { wordCount: 189 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 3, 2, 2],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: true,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '4.23',
        distinctConnectorsExcludingBasic: 5,
        usageMapExcludingBasic: {
          'to sum up': 1,
          while: 1,
          but: 2,
          because: 3,
          finally: 1
        }
      },
      lexical: {
        referencingDensity: 8.99,
        topRepeatedWords: [
          { word: 'products', count: 7 },
          { word: 'businesses', count: 6 },
          { word: 'some', count: 6 }
        ]
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 42, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 3, paragraphWordCount: 74, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 2, paragraphWordCount: 48, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 2, paragraphWordCount: 25, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [2, 3, 4] },
        { paragraphIndex: 2, hasExplanation: false, hasExample: true, evidenceSentenceIndices: [5, 6] }
      ],
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 0 },
        { paragraphIndex: 1, topicSentenceIndex: 2 },
        { paragraphIndex: 2, topicSentenceIndex: 5 },
        { paragraphIndex: 3, topicSentenceIndex: 7 }
      ],
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
    essay: {
      paragraphs: [
        { paragraphNumber: 1, text: 'Intro' },
        { paragraphNumber: 2, text: 'Body one' },
        { paragraphNumber: 3, text: 'Body two' },
        { paragraphNumber: 4, text: 'Conclusion' }
      ]
    }
  };
}

function buildCcFoundationWeakCtx() {
  return {
    step1: { stats: { wordCount: 232 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [5, 4, 3, 1],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: false,
        misplacedConclusionSignpost: true
      },
      cohesion: {
        densityPer100ExcludingBasic: '3.70',
        distinctConnectorsExcludingBasic: 7,
        usageMapExcludingBasic: {
          'in conclusion': 1,
          'for example': 1,
          'such as': 1,
          moreover: 1,
          furthermore: 1,
          also: 2,
          first: 1
        }
      },
      lexical: {
        referencingDensity: '6.48',
        topRepeatedWords: [
          { word: 'like', count: 7 },
          { word: 'students', count: 5 },
          { word: 'study', count: 5 }
        ]
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 5, paragraphWordCount: 90, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 4, paragraphWordCount: 78, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 3, paragraphWordCount: 51, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 1, paragraphWordCount: 13, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 0 },
        { paragraphIndex: 1, topicSentenceIndex: 5 },
        { paragraphIndex: 2, topicSentenceIndex: 9 },
        { paragraphIndex: 3, topicSentenceIndex: null }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [5, 6] },
        { paragraphIndex: 2, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [9] }
      ]
    }
  };
}

function buildCcHighBandThinConclusionRecoveryCtx() {
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
          however: 2,
          because: 4,
          therefore: 1,
          moreover: 1,
          additionally: 1,
          consequently: 1,
          while: 1,
          although: 1,
          finally: 1,
          furthermore: 1
        }
      },
      lexical: {
        referencingDensity: 7.43,
        topRepeatedWords: [
          { word: 'students', count: 4 },
          { word: 'work', count: 4 }
        ]
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 4, paragraphWordCount: 70, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 5, paragraphWordCount: 103, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 5, paragraphWordCount: 98, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 1, paragraphWordCount: 25, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 2 },
        { paragraphIndex: 1, topicSentenceIndex: null },
        { paragraphIndex: 2, topicSentenceIndex: null },
        { paragraphIndex: 3, topicSentenceIndex: null }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [4, 5, 6, 7, 8] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [9, 10, 11, 12, 13] }
      ]
    }
  };
}

function buildCcMechanicalOveruseWeakCtx() {
  return {
    step1: { stats: { wordCount: 214 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 2, 2, 1],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: false,
        misplacedConclusionSignpost: true
      },
      cohesion: {
        densityPer100ExcludingBasic: '4.10',
        distinctConnectorsExcludingBasic: 2,
        usageMapExcludingBasic: {
          because: 5,
          also: 4
        }
      },
      lexical: {
        referencingDensity: 0.95,
        topRepeatedWords: [
          { word: 'people', count: 9 },
          { word: 'problem', count: 7 }
        ]
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 41, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 2, paragraphWordCount: 59, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 2, paragraphWordCount: 62, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 1, paragraphWordCount: 22, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 0 },
        { paragraphIndex: 1, topicSentenceIndex: null },
        { paragraphIndex: 2, topicSentenceIndex: null },
        { paragraphIndex: 3, topicSentenceIndex: null }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [2] },
        { paragraphIndex: 2, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [4] }
      ]
    }
  };
}

function buildCcLowConnectorThinConclusionRecoverableCtx() {
  return {
    step1: { stats: { wordCount: 305 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [3, 2, 4, 4, 1],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 5,
        conclusionSignpostFoundInLast: false,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '0.33',
        distinctConnectorsExcludingBasic: 1,
        usageMapExcludingBasic: { but: 1 }
      },
      lexical: {
        referencingDensity: 5.25,
        topRepeatedWords: [
          { word: 'holidays', count: 9 },
          { word: 'summer', count: 8 }
        ]
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 3, paragraphWordCount: 52, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 2, paragraphWordCount: 49, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 4, paragraphWordCount: 92, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'body', sentenceCount: 4, paragraphWordCount: 86, virtualSentenceCount: 0 },
        { paragraphIndex: 4, role: 'conclusion', sentenceCount: 1, paragraphWordCount: 26, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      position: { stance: 'agree', stanceSentenceIndex: 13, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1: [3, 7, 8],
        q2: [4, 9, 10, 12]
      },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: null },
        { paragraphIndex: 1, topicSentenceIndex: 3 },
        { paragraphIndex: 2, topicSentenceIndex: 7 },
        { paragraphIndex: 3, topicSentenceIndex: 9 },
        { paragraphIndex: 4, topicSentenceIndex: 13 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [3, 4] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [7, 8] },
        { paragraphIndex: 3, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [9, 10, 12] }
      ]
    }
  };
}

function buildGRA4NoticeableBoundaryRecoverableCtx() {
  const ctx = buildCcLowConnectorThinConclusionRecoverableCtx();
  ctx.step25.grammarControl = {
    structureRange: 'mixed',
    complexSentenceControl: 'mixed',
    errorFrequency: 'noticeable',
    subjectVerbAgreement: 'strong',
    articleControl: 'mixed',
    prepositionControl: 'mixed',
    punctuationControl: 'mixed',
    sentenceBoundaryControl: 'mixed',
    clarityImpactFromGrammar: 'minor',
    errorFreeSentenceShareBand: 'moderate'
  };
  return ctx;
}

function buildSinglePartHighBandBoundaryCtx() {
  return {
    step1: { stats: { wordCount: 289 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [3, 2, 3, 3, 1],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 5,
        conclusionSignpostFoundInLast: true,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '3.11',
        distinctConnectorsExcludingBasic: 5,
        usageMapExcludingBasic: {
          'in conclusion': 1,
          however: 1,
          but: 2,
          therefore: 1,
          also: 4
        }
      },
      lexical: {
        referencingDensity: 7.96,
        topRepeatedWords: [
          { word: 'work', count: 8 },
          { word: 'students', count: 5 }
        ]
      },
      taskEcho: {
        severity: 'none',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 0,
        copiedWordEstimate: 0,
        effectiveContentWordCount: 289,
        effectiveContentRatio: 1
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 3, paragraphWordCount: 66, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 2, paragraphWordCount: 59, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 3, paragraphWordCount: 71, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'body', sentenceCount: 3, paragraphWordCount: 69, virtualSentenceCount: 0 },
        { paragraphIndex: 4, role: 'conclusion', sentenceCount: 1, paragraphWordCount: 24, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      position: { stance: 'agree', stanceSentenceIndex: 2, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1: [2, 11]
      },
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [3, 4] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [5, 6, 7] },
        { paragraphIndex: 3, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [8, 9, 10] }
      ],
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: null },
        { paragraphIndex: 1, topicSentenceIndex: 3 },
        { paragraphIndex: 2, topicSentenceIndex: 5 },
        { paragraphIndex: 3, topicSentenceIndex: 8 },
        { paragraphIndex: 4, topicSentenceIndex: null }
      ]
    }
  };
}

function buildSinglePartWeakBoundaryCtx() {
  return {
    step1: { stats: { wordCount: 232 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 2, 2, 1],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: false,
        misplacedConclusionSignpost: true
      },
      cohesion: {
        densityPer100ExcludingBasic: '3.20',
        distinctConnectorsExcludingBasic: 5,
        usageMapExcludingBasic: {
          because: 3,
          also: 3,
          however: 1
        }
      },
      lexical: {
        referencingDensity: 5.1,
        topRepeatedWords: [
          { word: 'people', count: 9 },
          { word: 'problem', count: 7 }
        ]
      },
      taskEcho: {
        severity: 'moderate',
        reusedPromptSentenceLikeCount: 1,
        reusedPromptPhraseCount: 2,
        copiedWordEstimate: 18,
        effectiveContentWordCount: 225,
        effectiveContentRatio: 0.97
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 42, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 2, paragraphWordCount: 58, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 2, paragraphWordCount: 61, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 1, paragraphWordCount: 21, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      position: { stance: 'agree', stanceSentenceIndex: 1, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1: [1]
      },
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [2] },
        { paragraphIndex: 2, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [4] }
      ],
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 0 },
        { paragraphIndex: 1, topicSentenceIndex: 2 },
        { paragraphIndex: 2, topicSentenceIndex: null },
        { paragraphIndex: 3, topicSentenceIndex: null }
      ]
    }
  };
}

function buildBand6CcOverlinkRecoverableCtx() {
  return {
    step1: { stats: { wordCount: 267 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [3, 3, 3, 2],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: true,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '3.75',
        distinctConnectorsExcludingBasic: 4,
        usageMapExcludingBasic: {
          'to sum up': 1,
          although: 2,
          but: 3,
          because: 4
        }
      },
      lexical: {
        referencingDensity: 14.23,
        topRepeatedWords: [
          { word: 'hard', count: 9 },
          { word: 'achieve', count: 7 }
        ]
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 3, paragraphWordCount: 54, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 3, paragraphWordCount: 75, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 3, paragraphWordCount: 78, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 2, paragraphWordCount: 35, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      position: { stance: 'agree', stanceSentenceIndex: 8, contradictionSentenceIndices: [] },
      answersBySubquestion: { q1: [3, 4, 5, 6, 7, 8] },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: null },
        { paragraphIndex: 1, topicSentenceIndex: 3 },
        { paragraphIndex: 2, topicSentenceIndex: 6 },
        { paragraphIndex: 3, topicSentenceIndex: 9 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [3, 4, 5] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [6, 7, 8] }
      ]
    }
  };
}

function buildBand6TrMultiPartInflationCtx() {
  return {
    step1: { stats: { wordCount: 301 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 7, 7, 3],
        paragraphVirtualSentenceCounts: [0, 0, 1, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: false,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '1.43',
        distinctConnectorsExcludingBasic: 5,
        usageMapExcludingBasic: {
          'in addition': 1,
          however: 1,
          but: 1,
          because: 1,
          also: 1
        }
      },
      lexical: {
        referencingDensity: 7.14,
        topRepeatedWords: [
          { word: 'books', count: 9 },
          { word: 'will', count: 6 }
        ]
      },
      taskEcho: {
        severity: 'none',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 0,
        copiedWordEstimate: 0,
        effectiveContentWordCount: 301,
        effectiveContentRatio: 1
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 38, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 7, paragraphWordCount: 116, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 7, paragraphWordCount: 114, virtualSentenceCount: 1 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 3, paragraphWordCount: 33, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      position: { stance: 'partial', stanceSentenceIndex: 15, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1: [1, 8, 14, 15, 16],
        q2: [9, 14, 15, 16]
      },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 1 },
        { paragraphIndex: 1, topicSentenceIndex: 2 },
        { paragraphIndex: 2, topicSentenceIndex: 9 },
        { paragraphIndex: 3, topicSentenceIndex: 16 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [3, 4, 5, 6, 7, 8] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [10, 11, 12, 13, 14, 15] }
      ]
    }
  };
}

function buildBand8TrMultiPartCleanCtx() {
  return {
    step1: { stats: { wordCount: 316 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 4, 4, 3],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: true,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '1.62',
        distinctConnectorsExcludingBasic: 5,
        usageMapExcludingBasic: {
          however: 2,
          therefore: 1,
          moreover: 1,
          although: 1
        }
      },
      lexical: {
        referencingDensity: 4.4,
        topRepeatedWords: [
          { word: 'education', count: 5 },
          { word: 'students', count: 4 }
        ]
      },
      taskEcho: {
        severity: 'none',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 0,
        copiedWordEstimate: 0,
        effectiveContentWordCount: 316,
        effectiveContentRatio: 1
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 34, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 4, paragraphWordCount: 95, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 4, paragraphWordCount: 98, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 3, paragraphWordCount: 39, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      position: { stance: 'agree', stanceSentenceIndex: 1, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1: [2, 3, 4, 5],
        q2: [6, 7, 8, 9]
      },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 1 },
        { paragraphIndex: 1, topicSentenceIndex: 2 },
        { paragraphIndex: 2, topicSentenceIndex: 6 },
        { paragraphIndex: 3, topicSentenceIndex: 10 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [2, 3, 4, 5] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [6, 7, 8, 9] }
      ]
    }
  };
}

function buildBand6HighBoundaryOverscoreCtx() {
  const ctx = buildBand8TrMultiPartCleanCtx();
  ctx.step1 = { stats: { wordCount: 286 } };
  ctx.step2.taskEcho = {
    ...ctx.step2.taskEcho,
    severity: 'mild',
    reusedPromptSentenceLikeCount: 0,
    reusedPromptPhraseCount: 2,
    effectiveContentWordCount: 286,
    effectiveContentRatio: 1
  };
  ctx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [2, 3, 4] },
    { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [6, 7] }
  ];
  ctx.step25.lexicalControl = {
    rangeBand: 'sufficient',
    precisionBand: 'good',
    collocationControl: 'mixed',
    awkwardExpressionCountBand: 'some',
    spellingImpact: 'minor',
    wordFormationImpact: 'minor',
    repetitionImpact: 'noticeable',
    clarityImpactFromLexis: 'minor'
  };
  ctx.step25.grammarControl = {
    structureRange: 'wide',
    complexSentenceControl: 'good',
    errorFrequency: 'occasional',
    subjectVerbAgreement: 'mixed',
    articleControl: 'mixed',
    prepositionControl: 'mixed',
    punctuationControl: 'strong',
    sentenceBoundaryControl: 'mixed',
    clarityImpactFromGrammar: 'minor',
    errorFreeSentenceShareBand: 'moderate'
  };
  return ctx;
}

function buildBand8HighBoundaryGuardCtx() {
  const ctx = buildBand8TrMultiPartCleanCtx();
  ctx.step25.lexicalControl = {
    rangeBand: 'wide',
    precisionBand: 'good',
    collocationControl: 'good',
    awkwardExpressionCountBand: 'few',
    spellingImpact: 'minor',
    wordFormationImpact: 'minor',
    repetitionImpact: 'mild',
    clarityImpactFromLexis: 'minor'
  };
  ctx.step25.grammarControl = {
    structureRange: 'wide',
    complexSentenceControl: 'good',
    errorFrequency: 'occasional',
    subjectVerbAgreement: 'strong',
    articleControl: 'strong',
    prepositionControl: 'mixed',
    punctuationControl: 'strong',
    sentenceBoundaryControl: 'strong',
    clarityImpactFromGrammar: 'minor',
    errorFreeSentenceShareBand: 'high'
  };
  return ctx;
}

function buildBand9SinglePartSparseCohesionBoundaryCtx() {
  return {
    step1: { stats: { wordCount: 280 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [3, 4, 5, 2],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: false,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '0.71',
        distinctConnectorsExcludingBasic: 2,
        usageMapExcludingBasic: {
          however: 1,
          therefore: 1
        }
      },
      lexical: {
        referencingDensity: 11.43,
        topRepeatedWords: [
          { word: 'technology', count: 5 },
          { word: 'people', count: 4 }
        ]
      },
      taskEcho: {
        severity: 'none',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 0,
        copiedWordEstimate: 0,
        effectiveContentWordCount: 280,
        effectiveContentRatio: 1
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 3, paragraphWordCount: 44, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 4, paragraphWordCount: 94, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 5, paragraphWordCount: 103, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 2, paragraphWordCount: 39, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      position: { stance: 'partial', stanceSentenceIndex: 12, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1_task_response: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
      },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 0 },
        { paragraphIndex: 1, topicSentenceIndex: 3 },
        { paragraphIndex: 2, topicSentenceIndex: 7 },
        { paragraphIndex: 3, topicSentenceIndex: 12 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [4, 5, 6] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [8, 9, 10, 11] }
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

function buildBand45SinglePartBoundaryCtx() {
  return {
    step1: { stats: { wordCount: 189 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 3, 2, 2],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 46, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 3, paragraphWordCount: 67, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 2, paragraphWordCount: 46, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 2, paragraphWordCount: 30, virtualSentenceCount: 0 }
      ],
      taskEcho: {
        severity: 'none',
        effectiveContentWordCount: 189,
        effectiveContentRatio: 1,
        reusedPromptPhraseCount: 0,
        reusedPromptSentenceLikeCount: 0,
        copiedWordEstimate: 0,
        anchorReuseCount: 0,
        wordOverlapRatio: 0
      }
    },
    step25: {
      answersBySubquestion: {
        q1: [1, 2]
      },
      position: {
        stance: 'agree',
        stanceSentenceIndex: 2,
        contradictionSentenceIndices: []
      },
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [3, 4] },
        { paragraphIndex: 2, hasExplanation: false, hasExample: true, evidenceSentenceIndices: [5, 6] }
      ],
      grammarControl: {
        structureRange: 'mixed',
        complexSentenceControl: 'weak',
        errorFrequency: 'frequent',
        subjectVerbAgreement: 'mixed',
        articleControl: 'mixed',
        prepositionControl: 'weak',
        punctuationControl: 'weak',
        sentenceBoundaryControl: 'weak',
        clarityImpactFromGrammar: 'some',
        errorFreeSentenceShareBand: 'very_low'
      }
    }
  };
}

function buildGra3CompactMajorBoundaryRecoverableCtx() {
  return {
    step1: { stats: { wordCount: 228 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [4, 2, 1, 3],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 4, paragraphWordCount: 112, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 2, paragraphWordCount: 46, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 1, paragraphWordCount: 34, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 3, paragraphWordCount: 36, virtualSentenceCount: 0 }
      ],
      taskEcho: {
        severity: 'none',
        effectiveContentWordCount: 228,
        effectiveContentRatio: 1,
        reusedPromptPhraseCount: 0,
        reusedPromptSentenceLikeCount: 0,
        copiedWordEstimate: 0,
        anchorReuseCount: 0,
        wordOverlapRatio: 0
      }
    },
    step25: {
      answersBySubquestion: {
        q1_task_response: [0, 1, 2, 3, 4, 5, 6, 7, 9]
      },
      position: {
        stance: 'agree',
        stanceSentenceIndex: 7,
        contradictionSentenceIndices: []
      },
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [5] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [6] }
      ],
      grammarControl: {
        structureRange: 'mixed',
        complexSentenceControl: 'weak',
        errorFrequency: 'frequent',
        subjectVerbAgreement: 'weak',
        articleControl: 'weak',
        prepositionControl: 'weak',
        punctuationControl: 'weak',
        sentenceBoundaryControl: 'weak',
        clarityImpactFromGrammar: 'major',
        errorFreeSentenceShareBand: 'very_low'
      }
    }
  };
}

function buildGra3SingleBodyLongFormBoundaryCtx() {
  return {
    step1: { stats: { wordCount: 272 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'conclusion'],
        paragraphSentenceCounts: [5, 9, 3],
        paragraphVirtualSentenceCounts: [0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 3
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 5, paragraphWordCount: 78, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 9, paragraphWordCount: 146, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'conclusion', sentenceCount: 3, paragraphWordCount: 48, virtualSentenceCount: 0 }
      ],
      taskEcho: {
        severity: 'none',
        effectiveContentWordCount: 272,
        effectiveContentRatio: 1,
        reusedPromptPhraseCount: 0,
        reusedPromptSentenceLikeCount: 0,
        copiedWordEstimate: 0,
        anchorReuseCount: 0,
        wordOverlapRatio: 0
      }
    },
    step25: {
      answersBySubquestion: {
        q1_task_response: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
      },
      position: {
        stance: 'partial',
        stanceSentenceIndex: 14,
        contradictionSentenceIndices: [8]
      },
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [5, 6, 7, 8, 9, 10, 11, 12, 13] }
      ],
      grammarControl: {
        structureRange: 'mixed',
        complexSentenceControl: 'weak',
        errorFrequency: 'frequent',
        subjectVerbAgreement: 'weak',
        articleControl: 'mixed',
        prepositionControl: 'mixed',
        punctuationControl: 'weak',
        sentenceBoundaryControl: 'weak',
        clarityImpactFromGrammar: 'some',
        errorFreeSentenceShareBand: 'very_low'
      }
    }
  };
}

function buildLr3CompactMajorBoundaryRecoverableCtx() {
  return {
    step1: { stats: { wordCount: 228 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [4, 2, 1, 3],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 4, paragraphWordCount: 112, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 2, paragraphWordCount: 46, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 1, paragraphWordCount: 34, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 3, paragraphWordCount: 36, virtualSentenceCount: 0 }
      ],
      taskEcho: {
        severity: 'none',
        effectiveContentWordCount: 228,
        effectiveContentRatio: 1,
        reusedPromptPhraseCount: 0,
        reusedPromptSentenceLikeCount: 0,
        copiedWordEstimate: 0,
        anchorReuseCount: 0,
        wordOverlapRatio: 0
      }
    },
    step25: {
      answersBySubquestion: {
        q1_task_response: [0, 1, 2, 3, 4, 5, 6, 7, 9]
      },
      position: {
        stance: 'agree',
        stanceSentenceIndex: 7,
        contradictionSentenceIndices: []
      },
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [5] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [6] }
      ],
      lexicalControl: {
        rangeBand: 'limited',
        precisionBand: 'low',
        collocationControl: 'weak',
        awkwardExpressionCountBand: 'many',
        spellingImpact: 'frequent',
        wordFormationImpact: 'frequent',
        repetitionImpact: 'noticeable',
        clarityImpactFromLexis: 'major'
      }
    }
  };
}

function buildTr5CoveredDevelopedBoundaryCtx() {
  return {
    step1: { stats: { wordCount: 228 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [4, 2, 1, 3],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 4, paragraphWordCount: 112, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 2, paragraphWordCount: 46, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 1, paragraphWordCount: 34, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 3, paragraphWordCount: 36, virtualSentenceCount: 0 }
      ],
      taskEcho: {
        severity: 'none',
        effectiveContentWordCount: 228,
        effectiveContentRatio: 1,
        reusedPromptPhraseCount: 0,
        reusedPromptSentenceLikeCount: 0,
        copiedWordEstimate: 0,
        anchorReuseCount: 0,
        wordOverlapRatio: 0
      }
    },
    step25: {
      answersBySubquestion: {
        q1_task_response: [0, 1, 2, 3, 4, 5, 6, 7, 9]
      },
      position: {
        stance: 'agree',
        stanceSentenceIndex: 7,
        contradictionSentenceIndices: []
      },
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [5] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [6] }
      ]
    }
  };
}

function buildBand9SinglePartThinConclusionHighBandBoundaryCtx() {
  return {
    step1: { stats: { wordCount: 269 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 3, 4, 1],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: false,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '1.49',
        distinctConnectorsExcludingBasic: 4,
        usageMapExcludingBasic: {
          'such as': 1,
          while: 1,
          but: 1,
          first: 1
        }
      },
      lexical: {
        referencingDensity: 8.92,
        topRepeatedWords: [
          { word: 'people', count: 10 },
          { word: 'population', count: 4 },
          { word: 'longer', count: 4 }
        ]
      },
      taskEcho: {
        severity: 'none',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 0,
        copiedWordEstimate: 0,
        effectiveContentWordCount: 269,
        effectiveContentRatio: 1
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 40, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 3, paragraphWordCount: 88, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 4, paragraphWordCount: 104, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 1, paragraphWordCount: 37, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      position: { stance: 'agree', stanceSentenceIndex: 1, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1_task_response: [1, 9]
      },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: null },
        { paragraphIndex: 1, topicSentenceIndex: 2 },
        { paragraphIndex: 2, topicSentenceIndex: 5 },
        { paragraphIndex: 3, topicSentenceIndex: 9 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [2, 3, 4] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [5, 6, 7, 8] }
      ],
      lexicalControl: {
        rangeBand: 'wide',
        precisionBand: 'high',
        collocationControl: 'good',
        awkwardExpressionCountBand: 'none',
        spellingImpact: 'minor',
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

function buildTr8MultiPartHighContentBoundaryRecoverableCtx() {
  return {
    step1: { stats: { wordCount: 305 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 5, 5, 2],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: true,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '1.52',
        distinctConnectorsExcludingBasic: 4,
        usageMapExcludingBasic: {
          however: 1,
          moreover: 1,
          therefore: 1,
          additionally: 1
        }
      },
      lexical: {
        referencingDensity: 4.8,
        topRepeatedWords: [
          { word: 'workers', count: 12 },
          { word: 'satisfaction', count: 4 }
        ]
      },
      taskEcho: {
        severity: 'none',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 0,
        copiedWordEstimate: 0,
        effectiveContentWordCount: 305,
        effectiveContentRatio: 1
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 38, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 5, paragraphWordCount: 118, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 5, paragraphWordCount: 112, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 2, paragraphWordCount: 37, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      position: { stance: 'unclear', stanceSentenceIndex: null, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1: [1, 2, 3, 4, 5, 6],
        q2: [7, 8, 9, 10, 11, 12]
      },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 1 },
        { paragraphIndex: 1, topicSentenceIndex: 2 },
        { paragraphIndex: 2, topicSentenceIndex: 7 },
        { paragraphIndex: 3, topicSentenceIndex: 12 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [2, 3, 4, 5, 6] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [7, 8, 9] }
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

function buildCc7HighReferenceBoundaryRecoverableCtx() {
  return {
    step1: { stats: { wordCount: 305 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 6, 4, 2],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: false,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '3.28',
        distinctConnectorsExcludingBasic: 6,
        usageMapExcludingBasic: {
          however: 3,
          moreover: 1,
          therefore: 1,
          additionally: 1
        }
      },
      lexical: {
        referencingDensity: 7.54,
        topRepeatedWords: [
          { word: 'job', count: 12 },
          { word: 'satisfaction', count: 7 }
        ]
      },
      taskEcho: {
        severity: 'none',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 0,
        copiedWordEstimate: 0,
        effectiveContentWordCount: 305,
        effectiveContentRatio: 1
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 36, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 6, paragraphWordCount: 134, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 4, paragraphWordCount: 102, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 2, paragraphWordCount: 33, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      position: { stance: 'unclear', stanceSentenceIndex: null, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1: [1, 2, 3, 4, 5, 6],
        q2: [7, 8, 9, 10, 11, 12]
      },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: null },
        { paragraphIndex: 1, topicSentenceIndex: 2 },
        { paragraphIndex: 2, topicSentenceIndex: 8 },
        { paragraphIndex: 3, topicSentenceIndex: null }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [3, 4, 5, 6, 7] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [9, 10, 11] }
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

function buildBand7MultiPartVirtualRecoveryBoundaryCtx() {
  return {
    step1: { stats: { wordCount: 350 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 7, 7, 3],
        paragraphVirtualSentenceCounts: [0, 0, 1, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: false,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '1.43',
        distinctConnectorsExcludingBasic: 5,
        usageMapExcludingBasic: {
          'in addition': 1,
          however: 1,
          but: 1,
          because: 1,
          also: 1
        }
      },
      lexical: {
        referencingDensity: 7.14,
        topRepeatedWords: [
          { word: 'books', count: 9 },
          { word: 'will', count: 6 },
          { word: 'some', count: 5 }
        ]
      },
      taskEcho: {
        severity: 'none',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 0,
        copiedWordEstimate: 0,
        effectiveContentWordCount: 350,
        effectiveContentRatio: 1
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 48, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 7, paragraphWordCount: 104, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 7, paragraphWordCount: 137, virtualSentenceCount: 1 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 3, paragraphWordCount: 61, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      position: { stance: 'partial', stanceSentenceIndex: 15, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1: [1, 8, 14, 15, 16],
        q2: [9, 14, 15, 16]
      },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 1 },
        { paragraphIndex: 1, topicSentenceIndex: 2 },
        { paragraphIndex: 2, topicSentenceIndex: 9 },
        { paragraphIndex: 3, topicSentenceIndex: 16 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [3, 4, 5, 6, 7, 8] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [10, 11, 12, 13, 14, 15] }
      ]
    }
  };
}

function buildCcGraHighBandCeilingRiskCtx() {
  return {
    step1: { stats: { wordCount: 350 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 7, 7, 3],
        paragraphVirtualSentenceCounts: [0, 0, 1, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        virtualRecoveryApplied: true,
        conclusionSignpostFoundInLast: false,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '1.43',
        distinctConnectorsExcludingBasic: 5,
        usageMapExcludingBasic: {
          'in addition': 1,
          however: 1,
          but: 1,
          because: 1,
          also: 1
        }
      },
      lexical: {
        referencingDensity: 7.14,
        topRepeatedWords: [
          { word: 'books', count: 9 },
          { word: 'people', count: 5 }
        ]
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 42, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 7, paragraphWordCount: 116, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 7, paragraphWordCount: 114, virtualSentenceCount: 1 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 3, paragraphWordCount: 36, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 1 },
        { paragraphIndex: 1, topicSentenceIndex: 2 },
        { paragraphIndex: 2, topicSentenceIndex: 9 },
        { paragraphIndex: 3, topicSentenceIndex: 16 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [3, 4, 5, 6, 7, 8] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [10, 11, 12, 13, 14, 15] }
      ],
      grammarControl: {
        structureRange: 'varied',
        complexSentenceControl: 'good',
        errorFrequency: 'occasional',
        subjectVerbAgreement: 'mixed',
        articleControl: 'mixed',
        prepositionControl: 'strong',
        punctuationControl: 'strong',
        sentenceBoundaryControl: 'strong',
        clarityImpactFromGrammar: 'minor',
        errorFreeSentenceShareBand: 'moderate'
      }
    }
  };
}

function buildGra7HighControlCtx() {
  const ctx = buildCc7StrongCtx();
  ctx.step25 = {
    ...ctx.step25,
    grammarControl: {
      structureRange: 'varied',
      complexSentenceControl: 'good',
      errorFrequency: 'rare',
      subjectVerbAgreement: 'strong',
      articleControl: 'strong',
      prepositionControl: 'mixed',
      punctuationControl: 'strong',
      sentenceBoundaryControl: 'strong',
      clarityImpactFromGrammar: 'minor',
      errorFreeSentenceShareBand: 'high'
    }
  };
  return ctx;
}

function buildBand6FloorRescueCtx() {
  const ctx = buildCollapsedParagraphCtx();
  ctx.step25 = {
    ...ctx.step25,
    lexicalControl: {
      rangeBand: 'adequate',
      precisionBand: 'low',
      collocationControl: 'weak',
      awkwardExpressionCountBand: 'many',
      spellingImpact: 'frequent',
      wordFormationImpact: 'frequent',
      repetitionImpact: 'noticeable',
      clarityImpactFromLexis: 'major'
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

function buildBand6SinglePartUnclearStanceBoundaryCtx() {
  const ctx = buildStrongDiscourseSevereLanguageRecoverableCtx();
  ctx.step25 = {
    ...ctx.step25,
    position: { stance: 'unclear', stanceSentenceIndex: null, contradictionSentenceIndices: [] },
    lexicalControl: {
      rangeBand: 'adequate',
      precisionBand: 'low',
      collocationControl: 'weak',
      awkwardExpressionCountBand: 'many',
      spellingImpact: 'frequent',
      wordFormationImpact: 'frequent',
      repetitionImpact: 'noticeable',
      clarityImpactFromLexis: 'major'
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
      clarityImpactFromGrammar: 'major',
      errorFreeSentenceShareBand: 'very_low'
    }
  };
  return ctx;
}

function buildBand65SinglePartDerivedRelevanceCtx() {
  return {
    step1: { stats: { wordCount: 267 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [3, 3, 3, 2],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: false,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '1.43',
        distinctConnectorsExcludingBasic: 5,
        usageMapExcludingBasic: {
          however: 1,
          but: 1,
          because: 1,
          therefore: 1,
          also: 1
        }
      },
      lexical: {
        referencingDensity: 6.4,
        topRepeatedWords: [
          { word: 'technology', count: 7 },
          { word: 'books', count: 5 }
        ]
      },
      taskEcho: {
        severity: 'none',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 0,
        copiedWordEstimate: 0,
        effectiveContentWordCount: 267,
        effectiveContentRatio: 1
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 3, paragraphWordCount: 50, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 3, paragraphWordCount: 87, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 3, paragraphWordCount: 82, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 2, paragraphWordCount: 48, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      position: { stance: 'unclear', stanceSentenceIndex: null, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1: [3, 4, 5, 6, 7, 8]
      },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 1 },
        { paragraphIndex: 1, topicSentenceIndex: 3 },
        { paragraphIndex: 2, topicSentenceIndex: 6 },
        { paragraphIndex: 3, topicSentenceIndex: 8 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [3, 4, 5] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [6, 7, 8] }
      ]
    }
  };
}

function buildBand65SinglePartNoStanceClosureRescueCtx() {
  const ctx = buildBand65SinglePartDerivedRelevanceCtx();
  ctx.step2.structure = {
    ...ctx.step2.structure,
    conclusionSignpostFoundInLast: true,
    misplacedConclusionSignpost: false
  };
  ctx.step25.position = { stance: 'unclear', stanceSentenceIndex: null, contradictionSentenceIndices: [] };
  return ctx;
}

function buildBand65SinglePartNoStanceExplanationOnlyCtx() {
  const ctx = buildBand65SinglePartNoStanceClosureRescueCtx();
  ctx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [3, 4] },
    { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [6, 7] }
  ];
  return ctx;
}

function buildBand65SinglePartClosureRepetitionBoundaryCtx() {
  const ctx = buildBand65SinglePartNoStanceClosureRescueCtx();
  ctx.step2.taskEcho = {
    severity: 'moderate',
    reusedPromptSentenceLikeCount: 2,
    reusedPromptPhraseCount: 4,
    copiedWordEstimate: 18,
    effectiveContentWordCount: 249,
    effectiveContentRatio: 0.93
  };
  ctx.step2.lexical = {
    ...ctx.step2.lexical,
    topRepeatedWords: [
      { word: 'children', count: 9 },
      { word: 'success', count: 5 }
    ]
  };
  return ctx;
}

function buildBand5SinglePartWeakClosureRepetitionCtx() {
  const ctx = buildBand65SinglePartClosureRepetitionBoundaryCtx();
  ctx.step1 = { stats: { wordCount: 186 } };
  ctx.step2.structure = {
    ...ctx.step2.structure,
    paragraphSentenceCounts: [2, 2, 2, 1]
  };
  ctx.step2.taskEcho = {
    ...ctx.step2.taskEcho,
    severity: 'severe',
    reusedPromptSentenceLikeCount: 3,
    reusedPromptPhraseCount: 5,
    effectiveContentWordCount: 170,
    effectiveContentRatio: 0.84
  };
  ctx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [3] },
    { paragraphIndex: 2, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [5] }
  ];
  return ctx;
}

function buildBand7SinglePartNoStanceLanguageBackedCtx() {
  const ctx = buildBand65SinglePartNoStanceClosureRescueCtx();
  ctx.step1 = { stats: { wordCount: 327 } };
  ctx.step2.structure = {
    ...ctx.step2.structure,
    paragraphRoles: ['intro', 'body', 'body', 'body', 'body', 'conclusion'],
    paragraphSentenceCounts: [2, 1, 1, 1, 1, 2],
    paragraphVirtualSentenceCounts: [0, 1, 1, 0, 1, 0],
    hasIntro: true,
    hasConclusion: true,
    paragraphCount: 6,
    conclusionSignpostFoundInLast: false,
    misplacedConclusionSignpost: false
  };
  ctx.step2.perParagraphFeatures = [
    { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 36, virtualSentenceCount: 0 },
    { paragraphIndex: 1, role: 'body', sentenceCount: 1, paragraphWordCount: 62, virtualSentenceCount: 1 },
    { paragraphIndex: 2, role: 'body', sentenceCount: 1, paragraphWordCount: 57, virtualSentenceCount: 1 },
    { paragraphIndex: 3, role: 'body', sentenceCount: 1, paragraphWordCount: 54, virtualSentenceCount: 0 },
    { paragraphIndex: 4, role: 'body', sentenceCount: 1, paragraphWordCount: 51, virtualSentenceCount: 1 },
    { paragraphIndex: 5, role: 'conclusion', sentenceCount: 2, paragraphWordCount: 40, virtualSentenceCount: 0 }
  ];
  ctx.step2.taskEcho = {
    severity: 'none',
    reusedPromptSentenceLikeCount: 0,
    reusedPromptPhraseCount: 0,
    copiedWordEstimate: 0,
    effectiveContentWordCount: 327,
    effectiveContentRatio: 1
  };
  ctx.step2.lexical = {
    referencingDensity: 2.1,
    topRepeatedWords: [
      { word: 'education', count: 8 },
      { word: 'children', count: 6 }
    ]
  };
  ctx.step25.position = { stance: 'unclear', stanceSentenceIndex: null, contradictionSentenceIndices: [] };
  ctx.step25.answersBySubquestion = {
    q1_task_response: [3, 4, 5, 6, 7, 8]
  };
  ctx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [3, 4] },
    { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [5, 6] }
  ];
  ctx.step25.lexicalControl = {
    rangeBand: 'wide',
    precisionBand: 'good',
    collocationControl: 'good',
    awkwardExpressionCountBand: 'few',
    spellingImpact: 'minor',
    wordFormationImpact: 'minor',
    repetitionImpact: 'mild',
    clarityImpactFromLexis: 'minor'
  };
  ctx.step25.grammarControl = {
    structureRange: 'varied',
    complexSentenceControl: 'good',
    errorFrequency: 'occasional',
    subjectVerbAgreement: 'mixed',
    articleControl: 'mixed',
    prepositionControl: 'strong',
    punctuationControl: 'strong',
    sentenceBoundaryControl: 'strong',
    clarityImpactFromGrammar: 'minor',
    errorFreeSentenceShareBand: 'moderate'
  };
  return ctx;
}

function buildBand5SinglePartNoStanceLanguageWeakCtx() {
  const ctx = buildBand7SinglePartNoStanceLanguageBackedCtx();
  ctx.step1 = { stats: { wordCount: 236 } };
  ctx.step2.taskEcho = {
    ...ctx.step2.taskEcho,
    effectiveContentWordCount: 236
  };
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
  ctx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [3] },
    { paragraphIndex: 2, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [5] }
  ];
  return ctx;
}

function buildCcRunOnSectionRecoveryCtx() {
  const ctx = buildBand7SinglePartNoStanceLanguageBackedCtx();
  ctx.step1 = { stats: { wordCount: 246 } };
  ctx.step2.cohesion = {
    densityPer100ExcludingBasic: '1.38',
    distinctConnectorsExcludingBasic: 4,
    usageMapExcludingBasic: {
      however: 2,
      therefore: 1,
      moreover: 1
    }
  };
  ctx.step2.lexical = {
    referencingDensity: 1.45,
    topRepeatedWords: [
      { word: 'people', count: 7 },
      { word: 'society', count: 5 }
    ]
  };
  ctx.step25.topicSentenceByParagraph = [
    { paragraphIndex: 0, topicSentenceIndex: 1 },
    { paragraphIndex: 1, topicSentenceIndex: 2 },
    { paragraphIndex: 2, topicSentenceIndex: 4 },
    { paragraphIndex: 3, topicSentenceIndex: null },
    { paragraphIndex: 4, topicSentenceIndex: null },
    { paragraphIndex: 5, topicSentenceIndex: 9 }
  ];
  return ctx;
}

function buildCcRunOnSparseWeakCtx() {
  const ctx = buildCcRunOnSectionRecoveryCtx();
  ctx.step2.structure = {
    ...ctx.step2.structure,
    paragraphRoles: ['intro', 'body', 'body', 'body', 'body', 'conclusion'],
    paragraphSentenceCounts: [2, 1, 1, 1, 1, 1],
    paragraphVirtualSentenceCounts: [0, 0, 0, 0, 0, 0],
    hasIntro: true,
    hasConclusion: true,
    paragraphCount: 6,
    conclusionSignpostFoundInLast: false,
    misplacedConclusionSignpost: false
  };
  ctx.step2.perParagraphFeatures = [
    { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 34, virtualSentenceCount: 0 },
    { paragraphIndex: 1, role: 'body', sentenceCount: 1, paragraphWordCount: 32, virtualSentenceCount: 0 },
    { paragraphIndex: 2, role: 'body', sentenceCount: 1, paragraphWordCount: 29, virtualSentenceCount: 0 },
    { paragraphIndex: 3, role: 'body', sentenceCount: 1, paragraphWordCount: 33, virtualSentenceCount: 0 },
    { paragraphIndex: 4, role: 'body', sentenceCount: 1, paragraphWordCount: 31, virtualSentenceCount: 0 },
    { paragraphIndex: 5, role: 'conclusion', sentenceCount: 1, paragraphWordCount: 17, virtualSentenceCount: 0 }
  ];
  ctx.step2.lexical = {
    referencingDensity: 6.2,
    topRepeatedWords: [
      { word: 'knowledge', count: 10 },
      { word: 'people', count: 6 }
    ]
  };
  ctx.step2.cohesion = {
    densityPer100ExcludingBasic: '2.14',
    distinctConnectorsExcludingBasic: 5,
    usageMapExcludingBasic: {
      however: 2,
      therefore: 1,
      moreover: 1,
      because: 1
    }
  };
  ctx.step25.topicSentenceByParagraph = [
    { paragraphIndex: 0, topicSentenceIndex: 1 },
    { paragraphIndex: 1, topicSentenceIndex: null },
    { paragraphIndex: 2, topicSentenceIndex: null },
    { paragraphIndex: 3, topicSentenceIndex: null },
    { paragraphIndex: 4, topicSentenceIndex: null },
    { paragraphIndex: 5, topicSentenceIndex: null }
  ];
  ctx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [3] }
  ];
  return ctx;
}

function buildCc6HighRefRepetitionOverliftCtx() {
  return {
    step1: { stats: { wordCount: 234 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [1, 1, 2, 1, 1, 1],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 6
      },
      cohesion: {
        densityPer100ExcludingBasic: '2.14',
        distinctConnectorsExcludingBasic: 5,
        usageMapExcludingBasic: {
          however: 2,
          therefore: 1,
          moreover: 1,
          because: 1
        }
      },
      lexical: {
        referencingDensity: 6.41,
        topRepeatedWords: [
          { word: 'knowledge', count: 10 },
          { word: 'people', count: 6 }
        ]
      }
    },
    step25: {
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 0 },
        { paragraphIndex: 1, topicSentenceIndex: null },
        { paragraphIndex: 2, topicSentenceIndex: null },
        { paragraphIndex: 3, topicSentenceIndex: null },
        { paragraphIndex: 4, topicSentenceIndex: null },
        { paragraphIndex: 5, topicSentenceIndex: null }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [3] }
      ]
    }
  };
}

function buildCc6HighRefRepetitionGuardCtx() {
  const ctx = buildCc6HighRefRepetitionOverliftCtx();
  ctx.step1 = { stats: { wordCount: 327 } };
  ctx.step2.lexical = {
    referencingDensity: 3.67,
    topRepeatedWords: [
      { word: 'crime', count: 6 },
      { word: 'people', count: 4 }
    ]
  };
  ctx.step2.cohesion = {
    densityPer100ExcludingBasic: '1.53',
    distinctConnectorsExcludingBasic: 3,
    usageMapExcludingBasic: {
      however: 3,
      therefore: 1,
      moreover: 1
    }
  };
  return ctx;
}

function buildCcBand5RunOnBodyBoundaryRecoveryCtx() {
  return {
    step1: { stats: { wordCount: 349 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [4, 4, 2, 1, 3],
        paragraphVirtualSentenceCounts: [1, 0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 5,
        conclusionSignpostFoundInLast: false,
        misplacedConclusionSignpost: false
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 4, paragraphWordCount: 76, virtualSentenceCount: 1 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 4, paragraphWordCount: 133, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 2, paragraphWordCount: 52, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'body', sentenceCount: 1, paragraphWordCount: 40, virtualSentenceCount: 0 },
        { paragraphIndex: 4, role: 'conclusion', sentenceCount: 3, paragraphWordCount: 48, virtualSentenceCount: 0 }
      ],
      cohesion: {
        densityPer100ExcludingBasic: '1.15',
        distinctConnectorsExcludingBasic: 4,
        usageMapExcludingBasic: {
          however: 1,
          therefore: 1,
          moreover: 1,
          in_addition: 1
        }
      },
      lexical: {
        referencingDensity: 11.17,
        topRepeatedWords: [
          { word: 'water', count: 11 },
          { word: 'clean', count: 6 }
        ]
      }
    },
    step25: {
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 0 },
        { paragraphIndex: 1, topicSentenceIndex: 4 },
        { paragraphIndex: 2, topicSentenceIndex: 8 },
        { paragraphIndex: 3, topicSentenceIndex: 10 },
        { paragraphIndex: 4, topicSentenceIndex: 12 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [4, 5, 6] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [8, 9] },
        { paragraphIndex: 3, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [10, 11] }
      ]
    }
  };
}

function buildCcBand5LowGuidanceThinConclusionCtx() {
  return {
    step1: { stats: { wordCount: 305 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [3, 2, 4, 4, 1],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 5,
        conclusionSignpostFoundInLast: false,
        misplacedConclusionSignpost: false
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 3, paragraphWordCount: 57, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 2, paragraphWordCount: 78, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 4, paragraphWordCount: 79, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'body', sentenceCount: 4, paragraphWordCount: 70, virtualSentenceCount: 0 },
        { paragraphIndex: 4, role: 'conclusion', sentenceCount: 1, paragraphWordCount: 21, virtualSentenceCount: 0 }
      ],
      cohesion: {
        densityPer100ExcludingBasic: '0.33',
        distinctConnectorsExcludingBasic: 1,
        usageMapExcludingBasic: {
          however: 1
        }
      },
      lexical: {
        referencingDensity: 5.25,
        topRepeatedWords: [
          { word: 'holidays', count: 9 },
          { word: 'children', count: 6 }
        ]
      }
    },
    step25: {
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 0 },
        { paragraphIndex: 1, topicSentenceIndex: 2 },
        { paragraphIndex: 2, topicSentenceIndex: 4 },
        { paragraphIndex: 3, topicSentenceIndex: 8 },
        { paragraphIndex: 4, topicSentenceIndex: 12 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [3, 4] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [5, 6] },
        { paragraphIndex: 3, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [9, 10] }
      ]
    }
  };
}

function buildGra4MixedBoundaryRecoverableCtx() {
  return {
    step25: {
      grammarControl: {
        structureRange: 'mixed',
        complexSentenceControl: 'mixed',
        errorFrequency: 'noticeable',
        subjectVerbAgreement: 'mixed',
        articleControl: 'mixed',
        prepositionControl: 'mixed',
        punctuationControl: 'strong',
        sentenceBoundaryControl: 'strong',
        clarityImpactFromGrammar: 'minor',
        errorFreeSentenceShareBand: 'low'
      }
    }
  };
}

function buildGra4MixedBoundaryHarshCtx() {
  return {
    step25: {
      grammarControl: {
        structureRange: 'mixed',
        complexSentenceControl: 'mixed',
        errorFrequency: 'frequent',
        subjectVerbAgreement: 'weak',
        articleControl: 'weak',
        prepositionControl: 'mixed',
        punctuationControl: 'weak',
        sentenceBoundaryControl: 'weak',
        clarityImpactFromGrammar: 'some',
        errorFreeSentenceShareBand: 'very_low'
      }
    }
  };
}

function buildGra4RunOnBoundarySentenceWeakRecoverableCtx() {
  const ctx = buildCcBand5RunOnBodyBoundaryRecoveryCtx();
  ctx.step25 = {
    ...ctx.step25,
    position: { stance: 'agree', stanceSentenceIndex: 12, contradictionSentenceIndices: [] },
    answersBySubquestion: {
      q1: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
    },
    grammarControl: {
      structureRange: 'mixed',
      complexSentenceControl: 'weak',
      errorFrequency: 'frequent',
      subjectVerbAgreement: 'mixed',
      articleControl: 'mixed',
      prepositionControl: 'mixed',
      punctuationControl: 'weak',
      sentenceBoundaryControl: 'weak',
      clarityImpactFromGrammar: 'some',
      errorFreeSentenceShareBand: 'low'
    }
  };
  return ctx;
}

function buildCcLrGraBand6BoundaryRecoveryCtx() {
  const ctx = buildCcBand5RunOnBodyBoundaryRecoveryCtx();
  ctx.step25 = {
    ...ctx.step25,
    position: { stance: 'agree', stanceSentenceIndex: 12, contradictionSentenceIndices: [] },
    answersBySubquestion: {
      q1: [4, 5, 6, 8, 9, 10, 11, 12]
    },
    lexicalControl: {
      rangeBand: 'adequate',
      precisionBand: 'mixed',
      collocationControl: 'mixed',
      awkwardExpressionCountBand: 'some',
      spellingImpact: 'some',
      wordFormationImpact: 'minor',
      repetitionImpact: 'mild',
      clarityImpactFromLexis: 'some'
    },
    grammarControl: {
      structureRange: 'mixed',
      complexSentenceControl: 'weak',
      errorFrequency: 'frequent',
      subjectVerbAgreement: 'mixed',
      articleControl: 'mixed',
      prepositionControl: 'mixed',
      punctuationControl: 'weak',
      sentenceBoundaryControl: 'weak',
      clarityImpactFromGrammar: 'some',
      errorFreeSentenceShareBand: 'low'
    }
  };
  return ctx;
}

function buildCcLrBand6LowGuidanceBoundaryCtx() {
  const ctx = buildCcBand5LowGuidanceThinConclusionCtx();
  ctx.step25 = {
    ...ctx.step25,
    position: { stance: 'agree', stanceSentenceIndex: 13, contradictionSentenceIndices: [] },
    answersBySubquestion: {
      q1: [3, 4, 5],
      q2: [7, 8, 9, 10]
    },
    lexicalControl: {
      rangeBand: 'adequate',
      precisionBand: 'mixed',
      collocationControl: 'mixed',
      awkwardExpressionCountBand: 'some',
      spellingImpact: 'minor',
      wordFormationImpact: 'minor',
      repetitionImpact: 'noticeable',
      clarityImpactFromLexis: 'minor'
    }
  };
  return ctx;
}

function buildCc7ThinConclusionHighRefBoundaryCtx() {
  return {
    step1: { stats: { wordCount: 289 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [3, 2, 3, 3, 1],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 5,
        conclusionSignpostFoundInLast: true,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '3.11',
        distinctConnectorsExcludingBasic: 5,
        usageMapExcludingBasic: {
          'in conclusion': 1,
          however: 1,
          but: 2,
          therefore: 1,
          also: 4
        }
      },
      lexical: {
        referencingDensity: '7.96',
        topRepeatedWords: [
          { word: 'work', count: 8 },
          { word: 'will', count: 8 },
          { word: 'students', count: 5 }
        ]
      },
      taskEcho: {
        severity: 'none',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 0,
        copiedWordEstimate: 0,
        effectiveContentWordCount: 289,
        effectiveContentRatio: 1
      }
    },
    step25: {
      position: { stance: 'agree', stanceSentenceIndex: 2, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1: [3, 6]
      },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: null },
        { paragraphIndex: 1, topicSentenceIndex: 3 },
        { paragraphIndex: 2, topicSentenceIndex: 5 },
        { paragraphIndex: 3, topicSentenceIndex: 8 },
        { paragraphIndex: 4, topicSentenceIndex: null }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [3, 4] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [5, 6, 7] },
        { paragraphIndex: 3, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [8, 9, 10] }
      ]
    }
  };
}

function buildBand6SinglePartFourIdeaBoundaryRescueCtx() {
  const ctx = buildBand65SinglePartNoStanceClosureRescueCtx();
  ctx.step1 = { stats: { wordCount: 239 } };
  ctx.step25.answersBySubquestion = {
    q1: [3, 4, 6, 7]
  };
  return ctx;
}

function buildBand5SinglePartFourIdeaWeakGuardCtx() {
  const ctx = buildBand6SinglePartFourIdeaBoundaryRescueCtx();
  ctx.step1 = { stats: { wordCount: 201 } };
  ctx.step2.taskEcho = {
    severity: 'severe',
    reusedPromptSentenceLikeCount: 2,
    reusedPromptPhraseCount: 4,
    copiedWordEstimate: 28,
    effectiveContentWordCount: 186,
    effectiveContentRatio: 0.86
  };
  ctx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [3] },
    { paragraphIndex: 2, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [6] }
  ];
  return ctx;
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

function buildBand7SinglePartCoverageThinBoundaryRescueCtx() {
  return {
    step1: { stats: { wordCount: 342 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'body', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [3, 3, 7, 1, 1, 1, 2],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 7,
        conclusionSignpostFoundInLast: false,
        misplacedConclusionSignpost: false
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 3, paragraphWordCount: 32, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 3, paragraphWordCount: 54, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 7, paragraphWordCount: 106, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'body', sentenceCount: 1, paragraphWordCount: 41, virtualSentenceCount: 0 },
        { paragraphIndex: 4, role: 'body', sentenceCount: 1, paragraphWordCount: 38, virtualSentenceCount: 0 },
        { paragraphIndex: 5, role: 'body', sentenceCount: 1, paragraphWordCount: 36, virtualSentenceCount: 0 },
        { paragraphIndex: 6, role: 'conclusion', sentenceCount: 2, paragraphWordCount: 35, virtualSentenceCount: 0 }
      ],
      lexical: {
        referencingDensity: 3.8,
        topRepeatedWords: [
          { word: 'money', count: 9 },
          { word: 'life', count: 7 },
          { word: 'things', count: 5 }
        ]
      },
      taskEcho: {
        severity: 'none',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 0,
        copiedWordEstimate: 0,
        effectiveContentWordCount: 342,
        effectiveContentRatio: 1
      }
    },
    step25: {
      position: { stance: 'agree', stanceSentenceIndex: 0, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1: [1]
      },
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [4, 5] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [7, 8, 10, 11, 12] },
        { paragraphIndex: 3, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [] },
        { paragraphIndex: 4, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [] },
        { paragraphIndex: 5, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [] }
      ],
      lexicalControl: {
        rangeBand: 'adequate',
        precisionBand: 'mixed',
        collocationControl: 'mixed',
        awkwardExpressionCountBand: 'some',
        spellingImpact: 'minor',
        wordFormationImpact: 'none',
        repetitionImpact: 'mild',
        clarityImpactFromLexis: 'minor'
      },
      grammarControl: {
        structureRange: 'mixed',
        complexSentenceControl: 'mixed',
        errorFrequency: 'occasional',
        subjectVerbAgreement: 'strong',
        articleControl: 'mixed',
        prepositionControl: 'mixed',
        punctuationControl: 'mixed',
        sentenceBoundaryControl: 'strong',
        clarityImpactFromGrammar: 'minor',
        errorFreeSentenceShareBand: 'moderate'
      }
    }
  };
}

function buildGra4MixedBoundaryHighContentRecoveryCtx() {
  return {
    step1: { stats: { wordCount: 305 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 4, 4, 3, 2],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 5
      },
      taskEcho: {
        severity: 'none',
        effectiveContentWordCount: 305,
        effectiveContentRatio: 1
      }
    },
    step25: {
      position: { stance: 'agree', stanceSentenceIndex: 0, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1: [2, 3, 4],
        q2: [6, 7, 8]
      },
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [2, 3] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [5, 6] },
        { paragraphIndex: 3, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [7, 8] }
      ],
      grammarControl: {
        structureRange: 'mixed',
        complexSentenceControl: 'mixed',
        errorFrequency: 'noticeable',
        subjectVerbAgreement: 'mixed',
        articleControl: 'mixed',
        prepositionControl: 'mixed',
        punctuationControl: 'mixed',
        sentenceBoundaryControl: 'mixed',
        clarityImpactFromGrammar: 'minor',
        errorFreeSentenceShareBand: 'low'
      }
    }
  };
}

function buildBand7SinglePartCoverageThinMildEchoBoundaryCtx() {
  const ctx = buildBand7SinglePartCoverageThinBoundaryRescueCtx();
  ctx.step1 = { stats: { wordCount: 338 } };
  ctx.step2.taskEcho = {
    ...(ctx.step2.taskEcho || {}),
    severity: 'mild',
    reusedPromptSentenceLikeCount: 0,
    reusedPromptPhraseCount: 0,
    copiedWordEstimate: 0,
    effectiveContentWordCount: 338,
    effectiveContentRatio: 1
  };
  return ctx;
}

function buildTr7TwoIdeaHighContentBoundaryCtx() {
  return {
    step1: { stats: { wordCount: 356 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [3, 4, 4, 2, 2],
        paragraphVirtualSentenceCounts: [0, 0, 0, 1, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 5,
        conclusionSignpostFoundInLast: true,
        misplacedConclusionSignpost: false
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 3, paragraphWordCount: 40, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 4, paragraphWordCount: 86, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 4, paragraphWordCount: 90, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'body', sentenceCount: 2, paragraphWordCount: 74, virtualSentenceCount: 1 },
        { paragraphIndex: 4, role: 'conclusion', sentenceCount: 2, paragraphWordCount: 42, virtualSentenceCount: 0 }
      ],
      lexical: {
        referencingDensity: 4.1,
        topRepeatedWords: [
          { word: 'water', count: 11 },
          { word: 'public', count: 6 },
          { word: 'service', count: 5 }
        ]
      },
      taskEcho: {
        severity: 'none',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 0,
        copiedWordEstimate: 0,
        effectiveContentWordCount: 349,
        effectiveContentRatio: 1
      }
    },
    step25: {
      position: { stance: 'agree', stanceSentenceIndex: 12, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1_task_response: [6, 12]
      },
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [4, 5, 6] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [8, 9, 10] },
        { paragraphIndex: 3, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [12] }
      ]
    }
  };
}

function buildGra5TwoIdeaSinglePartBoundaryCtx() {
  const ctx = buildTr7TwoIdeaHighContentBoundaryCtx();
  ctx.step25 = {
    ...ctx.step25,
    grammarControl: {
      structureRange: 'mixed',
      complexSentenceControl: 'weak',
      errorFrequency: 'frequent',
      subjectVerbAgreement: 'mixed',
      articleControl: 'mixed',
      prepositionControl: 'mixed',
      punctuationControl: 'weak',
      sentenceBoundaryControl: 'weak',
      clarityImpactFromGrammar: 'some',
      errorFreeSentenceShareBand: 'low'
    }
  };
  return ctx;
}

function buildLr6TwoIdeaWeakCollocationBoundaryCtx() {
  const ctx = buildTr7TwoIdeaHighContentBoundaryCtx();
  ctx.step25 = {
    ...ctx.step25,
    lexicalControl: {
      rangeBand: 'adequate',
      precisionBand: 'mixed',
      collocationControl: 'weak',
      awkwardExpressionCountBand: 'some',
      spellingImpact: 'some',
      wordFormationImpact: 'minor',
      repetitionImpact: 'mild',
      clarityImpactFromLexis: 'some'
    }
  };
  return ctx;
}

function buildGra7LongHighContentLowAccuracyBoundaryCtx() {
  return {
    step1: { stats: { wordCount: 386 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [3, 3, 5, 1],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: true,
        misplacedConclusionSignpost: false
      },
      lexical: {
        referencingDensity: 7.8,
        topRepeatedWords: [
          { word: 'sugar', count: 8 },
          { word: 'food', count: 6 }
        ]
      },
      taskEcho: {
        severity: 'moderate',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 0,
        copiedWordEstimate: 0,
        effectiveContentWordCount: 377,
        effectiveContentRatio: 0.98
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 3, paragraphWordCount: 94, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 3, paragraphWordCount: 101, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 5, paragraphWordCount: 143, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 1, paragraphWordCount: 48, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      position: { stance: 'disagree', stanceSentenceIndex: 11, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1_task_response: [3, 6]
      },
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [4, 5, 6] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [7, 8, 9, 10] }
      ],
      grammarControl: {
        structureRange: 'varied',
        complexSentenceControl: 'mixed',
        errorFrequency: 'noticeable',
        subjectVerbAgreement: 'mixed',
        articleControl: 'mixed',
        prepositionControl: 'weak',
        punctuationControl: 'strong',
        sentenceBoundaryControl: 'strong',
        clarityImpactFromGrammar: 'minor',
        errorFreeSentenceShareBand: 'low'
      }
    }
  };
}

function buildTr7CompactSingleBodyBoundaryRescueCtx() {
  return {
    step1: { stats: { wordCount: 214 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 6, 2],
        paragraphVirtualSentenceCounts: [0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 3,
        conclusionSignpostFoundInLast: true,
        misplacedConclusionSignpost: false
      },
      lexical: {
        referencingDensity: 6.4,
        topRepeatedWords: [
          { word: 'people', count: 7 },
          { word: 'money', count: 4 }
        ]
      },
      taskEcho: {
        severity: 'moderate',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 0,
        copiedWordEstimate: 0,
        effectiveContentWordCount: 208,
        effectiveContentRatio: 0.97
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 44, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 6, paragraphWordCount: 128, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'conclusion', sentenceCount: 2, paragraphWordCount: 42, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      position: { stance: 'agree', stanceSentenceIndex: 9, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1_task_response: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
      },
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [3, 4, 5] }
      ]
    }
  };
}

function buildLr6CompactSingleBodyBoundaryRescueCtx() {
  const ctx = buildTr7CompactSingleBodyBoundaryRescueCtx();
  ctx.step25 = {
    ...ctx.step25,
    lexicalControl: {
      rangeBand: 'adequate',
      precisionBand: 'mixed',
      collocationControl: 'mixed',
      awkwardExpressionCountBand: 'some',
      spellingImpact: 'minor',
      wordFormationImpact: 'minor',
      repetitionImpact: 'mild',
      clarityImpactFromLexis: 'minor'
    }
  };
  return ctx;
}

function buildTr9SinglePartLowBreadthOverliftCtx() {
  return {
    step1: { stats: { wordCount: 434 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [4, 4, 8, 2],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4
      },
      taskEcho: {
        severity: 'none',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 0,
        copiedWordEstimate: 0,
        effectiveContentWordCount: 434,
        effectiveContentRatio: 1
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 4, paragraphWordCount: 82, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 4, paragraphWordCount: 116, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 8, paragraphWordCount: 188, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 2, paragraphWordCount: 48, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      position: { stance: 'partial', stanceSentenceIndex: 17, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1_task_response: [2, 5, 9, 14]
      },
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [5, 6, 7] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [10, 11, 12, 13, 14, 15, 16] }
      ]
    }
  };
}

function buildTr9SinglePartExplanationLedFullDevelopmentCtx() {
  const ctx = buildTr9SinglePartLowBreadthOverliftCtx();
  ctx.step25.answersBySubquestion = {
    q1_task_response: [2, 4, 6, 8, 10, 12]
  };
  ctx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [5, 6, 7] },
    { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [10, 11, 12, 13, 14] }
  ];
  return ctx;
}

function buildBook5Test04HighBandBoundaryCtx() {
  return {
    taskPrompt: 'Which do you consider to be the major influence on a person\'s personality: innate characteristics or experiences in life?',
    step1: { stats: { wordCount: 251 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [3, 3, 4, 2],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: true,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '1.59',
        distinctConnectorsExcludingBasic: 3,
        usageMapExcludingBasic: {
          'in conclusion': 1,
          but: 2,
          yet: 1
        }
      },
      lexical: {
        topRepeatedWords: [
          { word: 'life', count: 5 },
          { word: 'personality', count: 4 },
          { word: 'development', count: 3 }
        ],
        referencingDensity: '9.96'
      },
      taskEcho: {
        severity: 'none',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 0,
        copiedWordEstimate: 0,
        effectiveContentWordCount: 251,
        effectiveContentRatio: 1
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 3, paragraphWordCount: 54, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 3, paragraphWordCount: 77, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 4, paragraphWordCount: 79, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 2, paragraphWordCount: 41, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      position: { stance: 'partial', stanceSentenceIndex: 6, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1_which_do_you_consider_to_be_the_major_influence: [6, 7, 8, 10]
      },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 1 },
        { paragraphIndex: 1, topicSentenceIndex: 3 },
        { paragraphIndex: 2, topicSentenceIndex: 6 },
        { paragraphIndex: 3, topicSentenceIndex: 10 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [4, 5, 6] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [7, 8, 9] }
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

function buildBook5Test04BoundaryWeakLanguageGuardCtx() {
  const ctx = buildBook5Test04HighBandBoundaryCtx();
  ctx.step25.lexicalControl = {
    rangeBand: 'adequate',
    precisionBand: 'mixed',
    collocationControl: 'mixed',
    awkwardExpressionCountBand: 'some',
    spellingImpact: 'minor',
    wordFormationImpact: 'minor',
    repetitionImpact: 'noticeable',
    clarityImpactFromLexis: 'minor'
  };
  ctx.step25.grammarControl = {
    structureRange: 'mixed',
    complexSentenceControl: 'mixed',
    errorFrequency: 'noticeable',
    subjectVerbAgreement: 'mixed',
    articleControl: 'mixed',
    prepositionControl: 'mixed',
    punctuationControl: 'strong',
    sentenceBoundaryControl: 'strong',
    clarityImpactFromGrammar: 'minor',
    errorFreeSentenceShareBand: 'moderate'
  };
  return ctx;
}

function buildBook5Test04BoundaryLowDensityGuardCtx() {
  const ctx = buildBook5Test04HighBandBoundaryCtx();
  ctx.step2.cohesion = {
    ...(ctx.step2.cohesion || {}),
    densityPer100ExcludingBasic: '1.45',
    distinctConnectorsExcludingBasic: 3
  };
  return ctx;
}

function buildBand55SinglePartLexicalBoundaryCtx() {
  return {
    taskPrompt: 'Some people think music can influence emotions and behaviour. To what extent do you agree?',
    step1: { stats: { wordCount: 241 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 6, 2],
        paragraphVirtualSentenceCounts: [0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 3,
        virtualRecoveryApplied: false,
        conclusionSignpostFoundInLast: true,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '1.24',
        distinctConnectorsExcludingBasic: 2,
        usageMapExcludingBasic: {
          however: 1,
          therefore: 2
        }
      },
      lexical: {
        topRepeatedWords: [
          { word: 'music', count: 11 },
          { word: 'different', count: 4 }
        ],
        referencingDensity: 10.79
      },
      taskEcho: {
        severity: 'none',
        effectiveContentWordCount: 241,
        effectiveContentRatio: 1
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 36, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 6, paragraphWordCount: 163, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'conclusion', sentenceCount: 2, paragraphWordCount: 42, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      answersBySubquestion: {
        q1: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
      },
      position: { stance: 'agree', stanceSentenceIndex: 0, contradictionSentenceIndices: [] },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 0 },
        { paragraphIndex: 1, topicSentenceIndex: 2 },
        { paragraphIndex: 2, topicSentenceIndex: 8 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [2, 3, 4, 5, 6, 7, 8] }
      ],
      lexicalControl: {
        rangeBand: 'limited',
        precisionBand: 'low',
        collocationControl: 'weak',
        awkwardExpressionCountBand: 'many',
        spellingImpact: 'frequent',
        wordFormationImpact: 'some',
        repetitionImpact: 'strong',
        clarityImpactFromLexis: 'some'
      }
    },
    essay: {
      paragraphs: [
        { paragraphNumber: 1, text: 'Music introduction paragraph.' },
        { paragraphNumber: 2, text: 'Developed body paragraph with examples and explanation.' },
        { paragraphNumber: 3, text: 'Conclusion paragraph.' }
      ]
    }
  };
}

function buildCc6ThinConnectorGuidanceCtx() {
  return {
    step1: { stats: { wordCount: 288 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 4, 2, 4, 1],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 5,
        conclusionSignpostFoundInLast: false,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '1.74',
        distinctConnectorsExcludingBasic: 4,
        usageMapExcludingBasic: {
          'for example': 1,
          'such as': 2,
          therefore: 1,
          moreover: 1
        }
      },
      lexical: {
        topRepeatedWords: [
          { word: 'should', count: 5 },
          { word: 'school', count: 4 }
        ],
        referencingDensity: 6.94
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 39, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 4, paragraphWordCount: 66, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 2, paragraphWordCount: 51, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'body', sentenceCount: 4, paragraphWordCount: 88, virtualSentenceCount: 0 },
        { paragraphIndex: 4, role: 'conclusion', sentenceCount: 1, paragraphWordCount: 44, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      answersBySubquestion: {
        q1: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
      },
      position: { stance: 'agree', stanceSentenceIndex: 10, contradictionSentenceIndices: [] },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 0 },
        { paragraphIndex: 1, topicSentenceIndex: 2 },
        { paragraphIndex: 2, topicSentenceIndex: 6 },
        { paragraphIndex: 3, topicSentenceIndex: 8 },
        { paragraphIndex: 4, topicSentenceIndex: 12 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [3, 4, 5] },
        { paragraphIndex: 2, hasExplanation: false, hasExample: true, evidenceSentenceIndices: [6] },
        { paragraphIndex: 3, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [8, 9, 10] }
      ]
    },
    essay: {
      paragraphs: [
        { paragraphNumber: 1, text: 'Intro paragraph.' },
        { paragraphNumber: 2, text: 'Body paragraph one.' },
        { paragraphNumber: 3, text: 'Body paragraph two.' },
        { paragraphNumber: 4, text: 'Body paragraph three.' },
        { paragraphNumber: 5, text: 'Conclusion paragraph.' }
      ]
    }
  };
}

function buildTrStabilityStrongCtx() {
  return {
    step1: { stats: { wordCount: 274 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 3, 3, 2],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: true,
        misplacedConclusionSignpost: false
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 42, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 3, paragraphWordCount: 82, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 3, paragraphWordCount: 84, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 2, paragraphWordCount: 39, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      answersBySubquestion: {
        q1: [1, 2, 3],
        q2: [4, 5, 6]
      },
      position: {
        stance: 'agree',
        stanceSentenceIndex: 8,
        contradictionSentenceIndices: []
      },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 0 },
        { paragraphIndex: 1, topicSentenceIndex: 2 },
        { paragraphIndex: 2, topicSentenceIndex: 5 },
        { paragraphIndex: 3, topicSentenceIndex: 8 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [2, 3, 4] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [5, 6, 7] }
      ]
    },
    essay: {
      paragraphs: [
        { paragraphNumber: 1, text: 'Intro' },
        { paragraphNumber: 2, text: 'Body one with developed support.' },
        { paragraphNumber: 3, text: 'Body two with developed support.' },
        { paragraphNumber: 4, text: 'In conclusion, I agree with this view.' }
      ]
    }
  };
}

function buildTrStabilityWeakCtx() {
  return {
    step1: { stats: { wordCount: 218 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 2, 1, 1],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: false,
        misplacedConclusionSignpost: true
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 39, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 2, paragraphWordCount: 58, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 1, paragraphWordCount: 37, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 1, paragraphWordCount: 17, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      answersBySubquestion: {
        q1: [1, 2, 3, 4],
        q2: []
      },
      position: {
        stance: 'partial',
        stanceSentenceIndex: 1,
        contradictionSentenceIndices: []
      },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 0 },
        { paragraphIndex: 1, topicSentenceIndex: 2 },
        { paragraphIndex: 2, topicSentenceIndex: null },
        { paragraphIndex: 3, topicSentenceIndex: null }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [2] },
        { paragraphIndex: 2, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [] }
      ]
    },
    essay: {
      paragraphs: [
        { paragraphNumber: 1, text: 'Intro' },
        { paragraphNumber: 2, text: 'Thin body one.' },
        { paragraphNumber: 3, text: 'Thin body two.' },
        { paragraphNumber: 4, text: 'Weak ending.' }
      ]
    }
  };
}

function buildTrStabilityAmbiguousParagraphCtx() {
  const ctx = buildTrStabilityStrongCtx();
  ctx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [2] },
    { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [5, 6, 7] }
  ];
  ctx.step2.perParagraphFeatures = [
    { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 42, virtualSentenceCount: 0 },
    { paragraphIndex: 1, role: 'body', sentenceCount: 2, paragraphWordCount: 72, virtualSentenceCount: 0 },
    { paragraphIndex: 2, role: 'body', sentenceCount: 3, paragraphWordCount: 84, virtualSentenceCount: 0 },
    { paragraphIndex: 3, role: 'conclusion', sentenceCount: 2, paragraphWordCount: 39, virtualSentenceCount: 0 }
  ];
  return ctx;
}

function buildTrSinglePartBand45Ctx() {
  return {
    step1: { stats: { wordCount: 189 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 3, 2, 2],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: true,
        misplacedConclusionSignpost: false
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 46, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 3, paragraphWordCount: 67, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 2, paragraphWordCount: 46, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 2, paragraphWordCount: 30, virtualSentenceCount: 0 }
      ],
      taskEcho: {
        severity: 'none',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 0,
        copiedWordEstimate: 0,
        anchorReuseCount: 0,
        effectiveContentWordCount: 189,
        effectiveContentRatio: 1
      }
    },
    step25: {
      answersBySubquestion: {
        q1: [1, 2, 4, 5, 6, 7]
      },
      position: {
        stance: 'agree',
        stanceSentenceIndex: 2,
        contradictionSentenceIndices: []
      },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 0 },
        { paragraphIndex: 1, topicSentenceIndex: 2 },
        { paragraphIndex: 2, topicSentenceIndex: 5 },
        { paragraphIndex: 3, topicSentenceIndex: 7 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [2, 3, 4] },
        { paragraphIndex: 2, hasExplanation: false, hasExample: true, evidenceSentenceIndices: [5, 6] }
      ]
    },
    essay: {
      paragraphs: [
        { paragraphNumber: 1, text: 'Intro paragraph.' },
        { paragraphNumber: 2, text: 'Body paragraph with explanation but weak development quality.' },
        { paragraphNumber: 3, text: 'Body paragraph with short example and no explanation.' },
        { paragraphNumber: 4, text: 'To sum up, final position sentence.' }
      ]
    }
  };
}

function buildTrFormatMismatchCtx() {
  return {
    step1: { stats: { wordCount: 212 } },
    step2: {
      structure: {
        paragraphRoles: ['intro'],
        paragraphSentenceCounts: [1],
        paragraphVirtualSentenceCounts: [0],
        hasIntro: true,
        hasConclusion: false,
        paragraphCount: 1
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 1, paragraphWordCount: 212, virtualSentenceCount: 0 }
      ],
      cohesion: {
        densityPer100ExcludingBasic: '0.92',
        distinctConnectorsExcludingBasic: 1,
        usageMapExcludingBasic: {}
      },
      lexical: {
        referencingDensity: 0.85,
        topRepeatedWords: [{ word: 'product', count: 8 }]
      }
    },
    step25: {
      answersBySubquestion: {
        q1: [1, 2]
      },
      position: {
        stance: 'partial',
        stanceSentenceIndex: 0,
        contradictionSentenceIndices: []
      },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 0 }
      ],
      bodySupport: []
    },
    essay: {
      paragraphs: [
        { paragraphNumber: 1, text: 'Single long block with no clear body paragraph separation.' }
      ]
    }
  };
}

function buildTrMiniBatchWeakCtx() {
  return {
    step1: { stats: { wordCount: 138 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'conclusion'],
        paragraphSentenceCounts: [1, 1, 1],
        paragraphVirtualSentenceCounts: [0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 3,
        conclusionSignpostFoundInLast: false,
        misplacedConclusionSignpost: true
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 1, paragraphWordCount: 35, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 1, paragraphWordCount: 55, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'conclusion', sentenceCount: 1, paragraphWordCount: 26, virtualSentenceCount: 0 }
      ],
      taskEcho: {
        severity: 'severe',
        reusedPromptSentenceLikeCount: 2,
        reusedPromptPhraseCount: 5,
        copiedWordEstimate: 52,
        anchorReuseCount: 7,
        effectiveContentWordCount: 126,
        effectiveContentRatio: 0.91
      }
    },
    step25: {
      answersBySubquestion: {
        q1: [1],
        q2: []
      },
      position: {
        stance: 'partial',
        stanceSentenceIndex: 0,
        contradictionSentenceIndices: [2]
      },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 0 },
        { paragraphIndex: 1, topicSentenceIndex: 1 },
        { paragraphIndex: 2, topicSentenceIndex: null }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [1] }
      ]
    },
    essay: {
      paragraphs: [
        { paragraphNumber: 1, text: 'Intro.' },
        { paragraphNumber: 2, text: 'Thin body support.' },
        { paragraphNumber: 3, text: 'In conclusion, this repeats the prompt.' }
      ]
    }
  };
}

function buildCc7StrongCtx() {
  return {
    step1: { stats: { wordCount: 288 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 3, 3, 2],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: true,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '1.82',
        distinctConnectorsExcludingBasic: 5,
        usageMapExcludingBasic: {
          however: 2,
          therefore: 1,
          moreover: 1,
          'for example': 1,
          consequently: 1
        }
      },
      lexical: {
        referencingDensity: 1.65,
        topRepeatedWords: [{ word: 'technology', count: 5 }]
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 54, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 3, paragraphWordCount: 84, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 3, paragraphWordCount: 87, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 2, paragraphWordCount: 43, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 0 },
        { paragraphIndex: 1, topicSentenceIndex: 2 },
        { paragraphIndex: 2, topicSentenceIndex: 5 },
        { paragraphIndex: 3, topicSentenceIndex: 8 }
      ]
    }
  };
}

function buildCc7HighReferenceNoConclusionSignpostBoundaryCtx() {
  const ctx = buildCc7StrongCtx();
  ctx.step2.structure = {
    ...ctx.step2.structure,
    conclusionSignpostFoundInLast: false
  };
  ctx.step2.cohesion = {
    densityPer100ExcludingBasic: '1.88',
    distinctConnectorsExcludingBasic: 4,
    usageMapExcludingBasic: {
      however: 2,
      therefore: 1,
      moreover: 1,
      'for example': 1
    }
  };
  ctx.step2.lexical = {
    ...ctx.step2.lexical,
    referencingDensity: 7.24,
    topRepeatedWords: [
      { word: 'technology', count: 5 },
      { word: 'education', count: 4 }
    ]
  };
  return ctx;
}

function buildCc7NoSignpostConnectorRepeatBoundaryCtx() {
  const ctx = buildCc7StrongCtx();
  ctx.step2.structure = {
    ...ctx.step2.structure,
    conclusionSignpostFoundInLast: false
  };
  ctx.step2.cohesion = {
    densityPer100ExcludingBasic: '2.81',
    distinctConnectorsExcludingBasic: 5,
    usageMapExcludingBasic: {
      'in addition': 1,
      but: 3,
      consequently: 1,
      also: 2,
      first: 1
    }
  };
  ctx.step2.lexical = {
    ...ctx.step2.lexical,
    referencingDensity: 5.61,
    topRepeatedWords: [
      { word: 'not', count: 5 },
      { word: 'people', count: 4 },
      { word: 'past', count: 4 }
    ]
  };
  return ctx;
}

function buildCc7MinorImbalanceCtx() {
  const ctx = buildCc7StrongCtx();
  ctx.step2.cohesion = {
    densityPer100ExcludingBasic: '3.25',
    distinctConnectorsExcludingBasic: 4,
    usageMapExcludingBasic: {
      however: 4,
      therefore: 2,
      moreover: 1,
      'for example': 1
    }
  };
  ctx.step2.lexical = {
    ...ctx.step2.lexical,
    referencingDensity: 1.32
  };
  return ctx;
}

function buildCc7HighReferenceRepetitionBoundaryRecoveryCtx() {
  const fillerLexis = 'policy education transport infrastructure healthcare employment technology innovation sustainability economic social cultural community international domestic environmental governance evidence analysis perspective framework planning investment development services outcomes';
  const repeatedCorpus = Array.from({ length: 10 }, () => fillerLexis).join(' ');
  const essayText = `${'people '.repeat(8)} ${repeatedCorpus}`.trim();

  return {
    step1: { stats: { wordCount: 332 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [5, 4, 6, 2, 3],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 5,
        conclusionSignpostFoundInLast: true,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '3.01',
        distinctConnectorsExcludingBasic: 10,
        usageMapExcludingBasic: {
          however: 1,
          therefore: 1,
          moreover: 1,
          additionally: 1,
          consequently: 1,
          meanwhile: 1,
          overall: 1,
          similarly: 1,
          alternatively: 1,
          thus: 1
        }
      },
      lexical: {
        referencingDensity: 7.83,
        topRepeatedWords: [
          { word: 'people', count: 8 },
          { word: 'government', count: 6 },
          { word: 'development', count: 5 }
        ]
      },
      taskEcho: {
        severity: 'none',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 0,
        copiedWordEstimate: 0,
        effectiveContentWordCount: 332,
        effectiveContentRatio: 1
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 5, paragraphWordCount: 62, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 4, paragraphWordCount: 83, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 6, paragraphWordCount: 108, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'body', sentenceCount: 2, paragraphWordCount: 59, virtualSentenceCount: 0 },
        { paragraphIndex: 4, role: 'conclusion', sentenceCount: 3, paragraphWordCount: 40, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 0 },
        { paragraphIndex: 1, topicSentenceIndex: 5 },
        { paragraphIndex: 2, topicSentenceIndex: 9 },
        { paragraphIndex: 3, topicSentenceIndex: 15 },
        { paragraphIndex: 4, topicSentenceIndex: 18 }
      ],
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [6, 7, 8] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [10, 11, 12, 13, 14] },
        { paragraphIndex: 3, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [16] }
      ]
    },
    essay: {
      rawText: essayText,
      normalizedText: essayText
    }
  };
}

function buildCc7HighReferenceRepetitionOverTriggerGuardCtx() {
  const ctx = buildCc7HighReferenceRepetitionBoundaryRecoveryCtx();
  const fillerLexis = 'policy education transport infrastructure healthcare employment technology innovation sustainability economic social cultural community international domestic environmental governance evidence analysis perspective framework planning investment development services outcomes';
  const repeatedCorpus = Array.from({ length: 10 }, () => fillerLexis).join(' ');
  const essayText = `${'people '.repeat(9)} ${repeatedCorpus}`.trim();
  ctx.step2.lexical = {
    ...ctx.step2.lexical,
    topRepeatedWords: [
      { word: 'people', count: 9 },
      { word: 'government', count: 10 },
      { word: 'development', count: 7 }
    ]
  };
  ctx.essay = {
    ...(ctx.essay || {}),
    rawText: essayText,
    normalizedText: essayText
  };
  return ctx;
}

function buildLrMiniControlledCtx() {
  return {
    step25: {
      lexicalControl: {
        rangeBand: 'adequate',
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
}

function buildCcMiniBatchWeakCtx() {
  return {
    step1: { stats: { wordCount: 309 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [9, 4, 4, 2],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: true,
        misplacedConclusionSignpost: false
      },
      cohesion: {
        densityPer100ExcludingBasic: '3.24',
        distinctConnectorsExcludingBasic: 7,
        usageMapExcludingBasic: {
          'in conclusion': 1,
          'for instance': 1,
          'for example': 1,
          because: 3,
          moreover: 1,
          furthermore: 1,
          also: 2
        }
      },
      lexical: {
        referencingDensity: 5.5,
        topRepeatedWords: [
          { word: 'more', count: 9 },
          { word: 'young', count: 6 },
          { word: 'people', count: 9 }
        ]
      },
      taskEcho: {
        severity: 'none',
        reusedPromptPhraseCount: 0,
        reusedPromptSentenceLikeCount: 0,
        copiedWordEstimate: 0,
        anchorReuseCount: 0,
        effectiveContentWordCount: 309,
        effectiveContentRatio: 1
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 9, paragraphWordCount: 118, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 4, paragraphWordCount: 84, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 4, paragraphWordCount: 77, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 2, paragraphWordCount: 30, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      answersBySubquestion: {
        q1: [1, 2, 3, 4, 5, 6, 7],
        q2: [8, 9, 10, 11, 12, 13]
      },
      position: {
        stance: 'unclear',
        stanceSentenceIndex: null,
        contradictionSentenceIndices: []
      },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 0 },
        { paragraphIndex: 1, topicSentenceIndex: 9 },
        { paragraphIndex: 2, topicSentenceIndex: 13 },
        { paragraphIndex: 3, topicSentenceIndex: 17 }
      ],
      bodySupport: [
        { paragraphIndex: 0, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [4, 5, 6, 7, 8] },
        { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [9, 10, 11, 12] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [13, 14, 15, 16] }
      ],
      lexicalControl: {
        rangeBand: 'limited',
        precisionBand: 'low',
        collocationControl: 'weak',
        awkwardExpressionCountBand: 'many',
        spellingImpact: 'frequent',
        wordFormationImpact: 'frequent',
        repetitionImpact: 'strong',
        clarityImpactFromLexis: 'major'
      }
    },
    essay: {
      paragraphs: [
        { paragraphNumber: 1, text: 'Intro paragraph with repeated lexical framing.' },
        { paragraphNumber: 2, text: 'Body paragraph one with mixed development.' },
        { paragraphNumber: 3, text: 'Body paragraph two with mixed development.' },
        { paragraphNumber: 4, text: 'Conclusion paragraph.' }
      ]
    }
  };
}

function buildTrRepetitiveWeakCtx() {
  return {
    step1: { stats: { wordCount: 198 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 2, 2, 1],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4
      },
      lexical: {
        topRepeatedWords: [{ word: 'advertising', count: 10 }],
        referencingDensity: 1.05
      },
      taskEcho: {
        severity: 'none',
        reusedPromptPhraseCount: 0,
        reusedPromptSentenceLikeCount: 0,
        copiedWordEstimate: 0,
        anchorReuseCount: 0,
        effectiveContentWordCount: 198,
        effectiveContentRatio: 1
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 42, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 2, paragraphWordCount: 60, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 2, paragraphWordCount: 58, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 1, paragraphWordCount: 24, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      answersBySubquestion: {
        q1: [1, 2],
        q2: [3]
      },
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [1] },
        { paragraphIndex: 2, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [2] }
      ],
      position: {
        stance: 'partial',
        stanceSentenceIndex: 1,
        contradictionSentenceIndices: []
      },
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 0 },
        { paragraphIndex: 1, topicSentenceIndex: 2 },
        { paragraphIndex: 2, topicSentenceIndex: 4 },
        { paragraphIndex: 3, topicSentenceIndex: 6 }
      ]
    }
  };
}

test('CC2-1A/CC3-1A do not auto-collapse when long essays likely have collapsed paragraph segmentation', () => {
  const ctx = buildCollapsedParagraphCtx();
  assert.equal(scoringRules['CC2-1A'](ctx), 'No');
  assert.equal(scoringRules['CC3-1A'](ctx), 'No');
});

test('Batch 1: CC4 gate respects collapsed segmentation and deterministic CC4-3 stays stable', () => {
  const ctx = buildCollapsedParagraphCtx();
  assert.equal(scoringRules['CC4-1'](ctx), 'No');
  assert.equal(scoringRules['CC4-3'](ctx), 'No');
  assert.equal(scoringRules['CC4-5'](ctx), 'ok');
});

test('CC2-1A/CC3-1A remain harsh for genuinely thin low-control two-paragraph scripts', () => {
  const ctx = buildThinLowParagraphCtx();
  assert.equal(scoringRules['CC2-1A'](ctx), 'Yes');
  assert.equal(scoringRules['CC3-1A'](ctx), 'Yes');
  assert.equal(scoringRules['CC4-1'](ctx), 'Yes');
  assert.equal(scoringRules['CC4-3'](ctx), 'Yes');
  assert.equal(scoringRules['CC4-5'](ctx), 'confusing');
});

test('Batch 13B (Phase 12): CC3-2 uses conservative deterministic coherence/weakness boundary and preserves null for ambiguous profiles', () => {
  const coherentCtx = buildCollapsedParagraphCtx();

  const weakOneBlockCtx = buildThinLowParagraphCtx();
  weakOneBlockCtx.step2.structure = {
    ...weakOneBlockCtx.step2.structure,
    paragraphRoles: ['body'],
    paragraphSentenceCounts: [3],
    paragraphVirtualSentenceCounts: [0],
    hasIntro: false,
    hasConclusion: false,
    paragraphCount: 1
  };
  weakOneBlockCtx.step2.perParagraphFeatures = [
    { paragraphIndex: 0, role: 'body', sentenceCount: 3, paragraphWordCount: 72, virtualSentenceCount: 0 }
  ];
  weakOneBlockCtx.step25.topicSentenceByParagraph = [
    { paragraphIndex: 0, topicSentenceIndex: null }
  ];
  weakOneBlockCtx.step25.bodySupport = [];
  weakOneBlockCtx.essay = {
    paragraphs: [{ paragraphNumber: 1, text: 'Thin one-block response with little progression.' }]
  };

  const ambiguousCtx = buildThinLowParagraphCtx();

  assert.equal(scoringRules['CC3-2'](coherentCtx), 'No');
  assert.equal(scoringRules['CC3-2'](weakOneBlockCtx), 'Yes');
  assert.equal(scoringRules['CC3-2'](ambiguousCtx), null);
});

test('GRA3-1 requires very severe profile for "distort"; low-band frequent errors can stay at "some"', () => {
  assert.equal(scoringRules['GRA3-1'](buildModerateGrammarCtx()), 'some');
  assert.equal(scoringRules['GRA3-1'](buildSevereGrammarCtx()), 'distort');
});

test('Batch 11A (Phase 8): TR4-1/GRA3-1 compact single-part boundary relief lifts recoverable 4.5 profile and preserves severe guards', () => {
  const boundaryCtx = buildBand45SinglePartBoundaryCtx();
  const sparseBoundaryCtx = buildBand45SinglePartBoundaryCtx();
  sparseBoundaryCtx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [] }
  ];

  assert.equal(scoringRules['TR4-1'](boundaryCtx), 'No');
  assert.equal(scoringRules['GRA3-1'](boundaryCtx), 'some');
  assert.equal(scoringRules['GRA3-1'](sparseBoundaryCtx), 'distort');

  assert.equal(scoringRules['TR4-1'](buildThinLowParagraphCtx()), 'Yes');
  assert.equal(scoringRules['GRA3-1'](buildSevereGrammarCtx()), 'distort');
});

test('Batch 11C (Phase 8): GRA3-1 compact major-clarity boundary relief lifts recoverable single-part profile but preserves harsh weak-case guard', () => {
  const recoverableCtx = buildGra3CompactMajorBoundaryRecoverableCtx();
  const weakCtx = buildGra3CompactMajorBoundaryRecoverableCtx();
  weakCtx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [5] },
    { paragraphIndex: 2, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [] }
  ];

  assert.equal(scoringRules['GRA3-1'](recoverableCtx), 'some');
  assert.equal(scoringRules['GRA3-1'](weakCtx), 'distort');
  assert.equal(scoringRules['GRA3-1'](buildThinSevereLanguageCtx()), 'distort');
});

test('Batch 11D (Phase 8): LR3-2 compact major-clarity boundary relief lifts recoverable single-part profile but preserves harsh weak-case guard', () => {
  const recoverableCtx = buildLr3CompactMajorBoundaryRecoverableCtx();
  const weakCtx = buildLr3CompactMajorBoundaryRecoverableCtx();
  weakCtx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [5] },
    { paragraphIndex: 2, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [] }
  ];

  assert.equal(scoringRules['LR3-2'](recoverableCtx), 'some');
  assert.equal(scoringRules['LR3-2'](weakCtx), 'severe');
  assert.equal(scoringRules['LR3-2'](buildThinSevereLanguageCtx()), 'severe');
});

test('Batch 11E (Phase 8): TR5-1 deterministic covered/developed No path avoids AI fallback drift while preserving weak-case Yes guards', () => {
  const recoverableCtx = buildTr5CoveredDevelopedBoundaryCtx();
  const weakThinCtx = buildTr5CoveredDevelopedBoundaryCtx();
  weakThinCtx.step25.answersBySubquestion = { q1_task_response: [0] };
  const moderateEchoCtx = buildTr5CoveredDevelopedBoundaryCtx();
  moderateEchoCtx.step2.taskEcho.severity = 'moderate';

  assert.equal(scoringRules['TR5-1'](recoverableCtx), 'No');
  assert.equal(scoringRules['TR5-1'](weakThinCtx), 'Yes');
  assert.equal(scoringRules['TR5-1'](moderateEchoCtx), 'Yes');
  assert.equal(scoringRules['TR5-1'](buildThinLowParagraphCtx()), 'Yes');
});

test('Batch 11F (Phase 8): CC7-2 blocks high-reference no-signpost boundary overscore while preserving strong and low-band guards', () => {
  const targetCtx = buildCc7HighReferenceNoConclusionSignpostBoundaryCtx();
  const strongCtx = buildCc7StrongCtx();
  const lowBandCtx = buildThinLowParagraphCtx();

  assert.equal(scoringRules['CC7-2'](targetCtx), 'No');
  assert.equal(scoringRules['CC7-2'](strongCtx), 'Yes');
  assert.equal(scoringRules['CC7-2'](lowBandCtx), 'No');
});

test('Batch 11G (Phase 8): CC7-2 blocks no-signpost connector-repeat boundary while preserving strong/sparse and low-band guards', () => {
  const targetCtx = buildCc7NoSignpostConnectorRepeatBoundaryCtx();
  const strongCtx = buildCc7StrongCtx();
  const sparseHighBandCtx = buildBand9SinglePartSparseCohesionBoundaryCtx();
  const lowBandCtx = buildThinLowParagraphCtx();

  assert.equal(scoringRules['CC7-2'](targetCtx), 'No');
  assert.equal(scoringRules['CC7-2'](strongCtx), 'Yes');
  assert.equal(scoringRules['CC7-2'](sparseHighBandCtx), 'Yes');
  assert.equal(scoringRules['CC7-2'](lowBandCtx), 'No');
});

test('Batch 11H (Phase 9): GRA3-1 single-body long-form boundary rescue lifts recoverable profile while preserving weak and low-band guards', () => {
  const recoverableCtx = buildGra3SingleBodyLongFormBoundaryCtx();
  const weakCtx = buildGra3SingleBodyLongFormBoundaryCtx();
  weakCtx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [5, 6] }
  ];

  assert.equal(scoringRules['GRA3-1'](recoverableCtx), 'some');
  assert.equal(scoringRules['GRA3-1'](weakCtx), 'distort');
  assert.equal(scoringRules['GRA3-1'](buildThinSevereLanguageCtx()), 'distort');
});

test('Batch 11I (Phase 9): GRA3-1 allows severe-echo long-form rescue only when effective ratio remains high', () => {
  const severeEchoRecoverableCtx = buildGra3SingleBodyLongFormBoundaryCtx();
  severeEchoRecoverableCtx.step1.stats.wordCount = 240;
  severeEchoRecoverableCtx.step2.taskEcho = {
    ...severeEchoRecoverableCtx.step2.taskEcho,
    severity: 'severe',
    effectiveContentWordCount: 240,
    effectiveContentRatio: 0.9
  };

  const severeEchoWeakCtx = buildGra3SingleBodyLongFormBoundaryCtx();
  severeEchoWeakCtx.step1.stats.wordCount = 240;
  severeEchoWeakCtx.step2.taskEcho = {
    ...severeEchoWeakCtx.step2.taskEcho,
    severity: 'severe',
    effectiveContentWordCount: 240,
    effectiveContentRatio: 0.74
  };

  assert.equal(scoringRules['GRA3-1'](severeEchoRecoverableCtx), 'some');
  assert.equal(scoringRules['GRA3-1'](severeEchoWeakCtx), 'distort');
  assert.equal(scoringRules['GRA3-1'](buildThinSevereLanguageCtx()), 'distort');
});

test('LR4-3/LR4-4/LR4-5 avoid over-penalising moderate lexical weakness but still flag severe breakdown', () => {
  assert.equal(scoringRules['LR4-3'](buildModerateLexicalCtx()), 'No');
  assert.equal(scoringRules['LR4-4'](buildModerateLexicalCtx()), 'No');
  assert.equal(scoringRules['LR4-5'](buildModerateLexicalCtx()), 'some');

  assert.equal(scoringRules['LR4-3'](buildSevereLexicalCtx()), 'Yes');
  assert.equal(scoringRules['LR4-4'](buildSevereLexicalCtx()), 'Yes');
  assert.equal(scoringRules['LR4-5'](buildSevereLexicalCtx()), 'strain');
});

test('Batch 2A: CC5/CC6 rows avoid null fallback in clear cohesion profiles', () => {
  const strongCtx = buildCollapsedParagraphCtx();
  const weakCtx = buildThinLowParagraphCtx();
  const keys = ['CC5-3', 'CC5-5', 'CC5-7', 'CC6-2', 'CC6-3'];

  for (const key of keys) {
    assert.notEqual(scoringRules[key](strongCtx), null, `${key} should avoid null for strong profile`);
    assert.notEqual(scoringRules[key](weakCtx), null, `${key} should avoid null for weak profile`);
  }

  assert.equal(scoringRules['CC5-3'](strongCtx), 'No');
  assert.equal(scoringRules['CC6-2'](strongCtx), 'Yes');
  assert.equal(scoringRules['CC6-3'](strongCtx), 'No');

  assert.equal(scoringRules['CC5-3'](weakCtx), 'Yes');
  assert.equal(scoringRules['CC6-2'](weakCtx), 'No');
  assert.equal(scoringRules['CC6-3'](weakCtx), 'Yes');
});

test('Batch 2B: TR5-6 has deterministic coverage for clear strong vs thin profiles', () => {
  assert.equal(scoringRules['TR5-6'](buildCollapsedParagraphCtx()), 'No');
  assert.equal(scoringRules['TR5-6'](buildThinLowParagraphCtx()), 'Yes');
});

test('Batch 2E-TR: targeted TR volatility rows resolve deterministically in strong and weak profiles', () => {
  const strongCtx = buildTrStabilityStrongCtx();
  const weakCtx = buildTrStabilityWeakCtx();
  const strongParagraphCtx = buildTrBodyParagraphRuntime(strongCtx, 1);
  const weakParagraphCtx = buildTrBodyParagraphRuntime(weakCtx, 2);

  assert.equal(scoringRules['TR2-3B'](strongParagraphCtx), 'No');
  assert.equal(scoringRules['TR2-3B'](weakParagraphCtx), 'Yes');

  assert.equal(scoringRules['TR3-3C'](strongParagraphCtx), 'No');
  assert.equal(scoringRules['TR3-3C'](weakParagraphCtx), 'Yes');

  assert.equal(scoringRules['TR4-5'](strongCtx), 'No');
  assert.equal(scoringRules['TR4-5'](weakCtx), 'Yes');

  assert.equal(scoringRules['TR6-2'](strongCtx), 'No');
  assert.equal(scoringRules['TR6-2'](weakCtx), 'Yes');

  assert.equal(scoringRules['TR6-4'](strongCtx), 'No');
  assert.equal(scoringRules['TR6-4'](weakCtx), 'Yes');
});

test('Batch 2E-TR: paragraph underdevelopment/relevance rules stay conservative on ambiguous paragraph evidence', () => {
  const ambiguousCtx = buildTrStabilityAmbiguousParagraphCtx();
  const paragraphCtx = buildTrBodyParagraphRuntime(ambiguousCtx, 1);

  assert.equal(scoringRules['TR2-3B'](paragraphCtx), null);
  assert.equal(scoringRules['TR3-3C'](paragraphCtx), null);
});

test('Batch 2F-TR: single-part Cambridge-4.5 profile closes mini-batch null fallbacks deterministically', () => {
  const ctx = buildTrSinglePartBand45Ctx();
  const p2Ctx = buildTrBodyParagraphRuntime(ctx, 1);
  const p3Ctx = buildTrBodyParagraphRuntime(ctx, 2);

  assert.equal(scoringRules['TR2-3B'](p2Ctx), 'No');
  assert.equal(scoringRules['TR2-3B'](p3Ctx), 'Yes');
  assert.equal(scoringRules['TR4-5'](ctx), 'Yes');
  assert.equal(scoringRules['TR6-2'](ctx), 'No');
});

test('Batch 3A-mini: TR3-1/TR4-3/TR6-5 resolve deterministically for clear strong vs weak profiles', () => {
  const strongCtx = buildTrStabilityStrongCtx();
  const weakCtx = buildTrMiniBatchWeakCtx();

  assert.equal(scoringRules['TR3-1'](strongCtx), 'No');
  assert.equal(scoringRules['TR4-3'](strongCtx), 'No');
  assert.equal(scoringRules['TR6-5'](strongCtx), 'No');

  assert.equal(scoringRules['TR3-1'](weakCtx), 'Yes');
  assert.equal(scoringRules['TR4-3'](weakCtx), 'Yes');
  assert.equal(scoringRules['TR6-5'](weakCtx), 'Yes');

  assert.notEqual(scoringRules['TR3-1'](strongCtx), null);
  assert.notEqual(scoringRules['TR4-3'](strongCtx), null);
  assert.notEqual(scoringRules['TR6-5'](strongCtx), null);
  assert.notEqual(scoringRules['TR3-1'](weakCtx), null);
  assert.notEqual(scoringRules['TR4-3'](weakCtx), null);
  assert.notEqual(scoringRules['TR6-5'](weakCtx), null);
});

test('Batch 3A-mini: CC7-1/CC7-2/CC7-3 resolve deterministically for strong, weak, and minor-imbalance profiles', () => {
  const strongCtx = buildCc7StrongCtx();
  const weakCtx = buildCcFoundationWeakCtx();
  const minorImbalanceCtx = buildCc7MinorImbalanceCtx();

  assert.equal(scoringRules['CC7-1'](strongCtx), 'Yes');
  assert.equal(scoringRules['CC7-2'](strongCtx), 'Yes');
  assert.equal(scoringRules['CC7-3'](strongCtx), 'No');

  assert.equal(scoringRules['CC7-1'](weakCtx), 'No');
  assert.equal(scoringRules['CC7-2'](weakCtx), 'No');
  assert.equal(scoringRules['CC7-3'](weakCtx), 'No');

  assert.equal(scoringRules['CC7-3'](minorImbalanceCtx), 'Yes');

  assert.notEqual(scoringRules['CC7-1'](strongCtx), null);
  assert.notEqual(scoringRules['CC7-2'](strongCtx), null);
  assert.notEqual(scoringRules['CC7-3'](strongCtx), null);
  assert.notEqual(scoringRules['CC7-1'](weakCtx), null);
  assert.notEqual(scoringRules['CC7-2'](weakCtx), null);
  assert.notEqual(scoringRules['CC7-3'](weakCtx), null);
});

test('Batch 3A-mini: LR3-1/LR3-2 resolve deterministically for severe, moderate, and controlled lexical profiles', () => {
  const severeCtx = buildSevereLexicalCtx();
  const moderateCtx = buildModerateLexicalCtx();
  const controlledCtx = buildLrMiniControlledCtx();

  assert.equal(scoringRules['LR3-1'](severeCtx), 'Yes');
  assert.equal(scoringRules['LR3-2'](severeCtx), 'severe');

  assert.equal(scoringRules['LR3-1'](moderateCtx), 'Yes');
  assert.equal(scoringRules['LR3-2'](moderateCtx), 'some');

  assert.equal(scoringRules['LR3-1'](controlledCtx), 'No');
  assert.equal(scoringRules['LR3-2'](controlledCtx), 'none');

  assert.notEqual(scoringRules['LR3-1'](severeCtx), null);
  assert.notEqual(scoringRules['LR3-2'](severeCtx), null);
  assert.notEqual(scoringRules['LR3-1'](moderateCtx), null);
  assert.notEqual(scoringRules['LR3-2'](moderateCtx), null);
  assert.notEqual(scoringRules['LR3-1'](controlledCtx), null);
  assert.notEqual(scoringRules['LR3-2'](controlledCtx), null);
});

test('Batch 3B-mini: TR4-4 closes null fallback on repetitive weak vs broad-coverage profiles', () => {
  const repetitiveWeakCtx = buildTrRepetitiveWeakCtx();
  const broadCoverageCtx = buildCcMiniBatchWeakCtx();
  const strongCtx = buildTrStabilityStrongCtx();

  assert.equal(scoringRules['TR4-4'](repetitiveWeakCtx), 'Yes');
  assert.equal(scoringRules['TR4-4'](broadCoverageCtx), 'No');
  assert.equal(scoringRules['TR4-4'](strongCtx), 'No');

  assert.notEqual(scoringRules['TR4-4'](repetitiveWeakCtx), null);
  assert.notEqual(scoringRules['TR4-4'](broadCoverageCtx), null);
  assert.notEqual(scoringRules['TR4-4'](strongCtx), null);
});

test('Batch 3C-mini: TR5-2 resolves deterministically for clear format mismatch vs normal essay structure', () => {
  const mismatchCtx = buildTrFormatMismatchCtx();
  const normalCtx = buildTrStabilityStrongCtx();

  assert.equal(scoringRules['TR5-2'](mismatchCtx), 'Yes');
  assert.equal(scoringRules['TR5-2'](normalCtx), 'No');

  assert.notEqual(scoringRules['TR5-2'](mismatchCtx), null);
  assert.notEqual(scoringRules['TR5-2'](normalCtx), null);
});

test('Batch 3D-mini: remaining TR volatility rows resolve deterministically in strong vs weak profiles', () => {
  const strongCtx = buildTrStabilityStrongCtx();
  const weakCtx = buildTrStabilityWeakCtx();

  assert.equal(scoringRules['TR4-5'](strongCtx), 'No');
  assert.equal(scoringRules['TR4-6'](strongCtx), 'No');
  assert.equal(scoringRules['TR5-7'](strongCtx), 'No');
  assert.equal(scoringRules['TR6-6'](strongCtx), 'Yes');
  assert.equal(scoringRules['TR6-7'](strongCtx), 'No');

  assert.equal(scoringRules['TR4-5'](weakCtx), 'Yes');
  assert.equal(scoringRules['TR4-6'](weakCtx), 'Yes');
  assert.equal(scoringRules['TR5-7'](weakCtx), 'Yes');
  assert.equal(scoringRules['TR6-6'](weakCtx), 'No');
  assert.equal(scoringRules['TR6-7'](weakCtx), 'Yes');

  const keys = ['TR4-5', 'TR4-6', 'TR5-7', 'TR6-6', 'TR6-7'];
  for (const key of keys) {
    assert.notEqual(scoringRules[key](strongCtx), null, `${key} should avoid null for strong profile`);
    assert.notEqual(scoringRules[key](weakCtx), null, `${key} should avoid null for weak profile`);
  }
});

test('Batch 3B-mini: CC5-2/CC6-1/CC8-1 resolve deterministically for overloaded vs controlled cohesion', () => {
  const weakCtx = buildCcMiniBatchWeakCtx();
  const strongCtx = buildCc7StrongCtx();

  assert.equal(scoringRules['CC5-2'](weakCtx), 'Yes');
  assert.equal(scoringRules['CC6-1'](weakCtx), 'No');
  assert.equal(scoringRules['CC8-1'](weakCtx), 'No');

  assert.equal(scoringRules['CC5-2'](strongCtx), 'No');
  assert.equal(scoringRules['CC6-1'](strongCtx), 'Yes');
  assert.equal(scoringRules['CC8-1'](strongCtx), 'Yes');

  assert.notEqual(scoringRules['CC5-2'](weakCtx), null);
  assert.notEqual(scoringRules['CC6-1'](weakCtx), null);
  assert.notEqual(scoringRules['CC8-1'](weakCtx), null);
  assert.notEqual(scoringRules['CC5-2'](strongCtx), null);
  assert.notEqual(scoringRules['CC6-1'](strongCtx), null);
  assert.notEqual(scoringRules['CC8-1'](strongCtx), null);
});

test('Batch 3B-mini: LR5-2 is deterministic for severe-limited and adequate lexical profiles', () => {
  const severeCtx = buildCcMiniBatchWeakCtx();
  const adequateCtx = buildAdequateMixedLexicalCtx();
  const boundaryCtx = buildStrongDiscourseLexicalBoundaryCtx();

  assert.equal(scoringRules['LR5-2'](severeCtx), 'Yes');
  assert.equal(scoringRules['LR5-2'](adequateCtx), 'No');
  assert.equal(scoringRules['LR5-2'](boundaryCtx), 'No');

  assert.notEqual(scoringRules['LR5-2'](severeCtx), null);
  assert.notEqual(scoringRules['LR5-2'](adequateCtx), null);
  assert.notEqual(scoringRules['LR5-2'](boundaryCtx), null);
});

test('Batch 2D-C: LR5 boundary cases with strong discourse resolve deterministically to non-harsh outcomes', () => {
  const boundaryCtx = buildStrongDiscourseLexicalBoundaryCtx();
  assert.equal(scoringRules['LR5-1'](boundaryCtx), 'No');
  assert.equal(scoringRules['LR5-2'](boundaryCtx), 'No');
  assert.equal(scoringRules['LR5-3'](boundaryCtx), 'No');
  assert.equal(scoringRules['LR5-4'](boundaryCtx), 'none');
});

test('Batch 2D-C: GRA4 boundary cases with strong discourse resolve deterministically, severe profiles remain fail', () => {
  const boundaryCtx = buildStrongDiscourseGrammarBoundaryCtx();
  const severeCtx = buildStrongDiscourseGrammarSevereCtx();
  assert.equal(scoringRules['GRA4-3'](boundaryCtx), 'No');
  assert.equal(scoringRules['GRA4-4'](boundaryCtx), 'No');
  assert.equal(scoringRules['GRA4-5'](boundaryCtx), 'No');

  assert.equal(scoringRules['GRA4-3'](severeCtx), 'Yes');
  assert.equal(scoringRules['GRA4-4'](severeCtx), 'Yes');
  assert.equal(scoringRules['GRA4-5'](severeCtx), 'No');
});

test('Batch 2C: TR7/TR8 formerly AI-volatile rows now resolve deterministically with stable polarity', () => {
  const strongCtx = buildCollapsedParagraphCtx();
  const weakCtx = buildThinLowParagraphCtx();
  const keys = ['TR7-3', 'TR7-4', 'TR7-5', 'TR8-2', 'TR8-3'];

  for (const key of keys) {
    assert.notEqual(scoringRules[key](strongCtx), null, `${key} should avoid null for strong profile`);
    assert.notEqual(scoringRules[key](weakCtx), null, `${key} should avoid null for weak profile`);
  }

  assert.equal(scoringRules['TR7-3'](strongCtx), 'Yes');
  assert.equal(scoringRules['TR7-4'](strongCtx), 'No');
  assert.equal(scoringRules['TR7-5'](strongCtx), 'No');
  assert.equal(scoringRules['TR8-2'](strongCtx), 'No');
  assert.equal(scoringRules['TR8-3'](strongCtx), 'No');

  assert.equal(scoringRules['TR7-3'](weakCtx), 'No');
  assert.equal(scoringRules['TR7-4'](weakCtx), 'Yes');
  assert.equal(scoringRules['TR7-5'](weakCtx), 'Yes');
  assert.equal(scoringRules['TR8-2'](weakCtx), 'No');
  assert.equal(scoringRules['TR8-3'](weakCtx), 'No');
});

test('Batch 2C: CC5-6 and LR5-2 avoid ambiguous fallback in common mid-band profiles', () => {
  const strongCtx = buildCollapsedParagraphCtx();
  const weakCtx = buildThinLowParagraphCtx();
  const lexicalCtx = buildAdequateMixedLexicalCtx();

  assert.notEqual(scoringRules['CC5-6'](strongCtx), null);
  assert.notEqual(scoringRules['CC5-6'](weakCtx), null);
  assert.equal(scoringRules['CC5-6'](strongCtx), 'No');
  assert.equal(scoringRules['CC5-6'](weakCtx), 'Yes');

  assert.equal(scoringRules['LR5-2'](lexicalCtx), 'No');
  assert.notEqual(scoringRules['LR5-3'](lexicalCtx), null);
  assert.notEqual(scoringRules['LR5-4'](lexicalCtx), null);
});

test('Batch 2D-C: weak language profiles are not auto de-escalated by discourse-only signals', () => {
  const ctx = buildHarshButSupportedLanguageCtx();

  assert.equal(scoringRules['LR5-1'](ctx), 'Yes');
  assert.equal(scoringRules['LR5-2'](ctx), 'Yes');
  assert.equal(scoringRules['LR5-3'](ctx), 'Yes');
  assert.equal(scoringRules['LR5-4'](ctx), 'some');

  assert.equal(scoringRules['GRA4-3'](ctx), 'Yes');
  assert.equal(scoringRules['GRA4-4'](ctx), 'Yes');
  assert.equal(scoringRules['GRA4-5'](ctx), 'Yes');
});

test('Batch 2D-B: TR5-5 and TR5-8 reduce AI volatility on conclusion/irrelevance boundaries', () => {
  const collapsedCtx = buildCollapsedParagraphCtx();
  const clearConclusionCtx = buildClearConclusionCtx();
  const weakCtx = buildThinLowParagraphCtx();
  const irrelevantCtx = buildLikelyIrrelevantDetailCtx();

  assert.equal(scoringRules['TR5-5'](collapsedCtx), 'No');
  assert.equal(scoringRules['TR5-5'](clearConclusionCtx), 'No');
  assert.equal(scoringRules['TR5-5'](weakCtx), 'Yes');

  assert.equal(scoringRules['TR5-8'](collapsedCtx), 'No');
  assert.equal(scoringRules['TR5-8'](irrelevantCtx), 'Yes');
});

test('Batch 2D-D: CC6/GRA6 do not auto-pass repetitive mid-band profiles', () => {
  const ctx = buildOverlinkedRepetitiveMidBandCtx();

  assert.equal(scoringRules['CC6-1'](ctx), 'No');
  assert.equal(scoringRules['CC6-2'](ctx), 'No');
  assert.equal(scoringRules['CC6-3'](ctx), 'Yes');

  assert.equal(scoringRules['GRA6-1'](ctx), 'Yes');
  assert.equal(scoringRules['GRA6-2'](ctx), 'Yes');
  assert.equal(scoringRules['GRA6-3'](ctx), 'sometimes');
});

test('Batch 6K (Phase 1): CC6 repetition-overload boundary does not over-penalize target-like high-referencing scripts while keeping true overlinked profiles blocked', () => {
  const targetLikeCtx = buildBand65SinglePartNoStanceClosureRescueCtx();
  targetLikeCtx.step2.cohesion = {
    densityPer100ExcludingBasic: '3.75',
    distinctConnectorsExcludingBasic: 4,
    usageMapExcludingBasic: {
      'to sum up': 1,
      although: 2,
      but: 3,
      because: 4
    }
  };
  targetLikeCtx.step2.lexical = {
    ...(targetLikeCtx.step2.lexical || {}),
    referencingDensity: '14.23',
    topRepeatedWords: [
      { word: 'hard', count: 9 },
      { word: 'achieve', count: 7 }
    ]
  };
  targetLikeCtx.step25.topicSentenceByParagraph = [
    { paragraphIndex: 0, topicSentenceIndex: 2 },
    { paragraphIndex: 1, topicSentenceIndex: 3 },
    { paragraphIndex: 2, topicSentenceIndex: 6 },
    { paragraphIndex: 3, topicSentenceIndex: 9 }
  ];
  targetLikeCtx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [4, 5] },
    { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [7, 8] }
  ];

  const overlinkedCtx = buildOverlinkedRepetitiveMidBandCtx();

  assert.equal(scoringRules['CC6-2'](targetLikeCtx), 'Yes');
  assert.equal(scoringRules['CC6-3'](targetLikeCtx), 'No');

  assert.equal(scoringRules['CC6-2'](overlinkedCtx), 'No');
  assert.equal(scoringRules['CC6-3'](overlinkedCtx), 'Yes');
});

test('TR low-band boundary: derived position recovery avoids false absent-position collapse', () => {
  const ctx = buildTrRecoveredPositionCtx();

  assert.equal(scoringRules['TR2-2'](ctx), 'No');
  assert.equal(scoringRules['TR3-2'](ctx), 'No');
});

test('TR low-band boundary: sparse weak profile still triggers TR2/TR3 faults', () => {
  const ctx = buildThinLowParagraphCtx();
  const paragraphCtx = buildTrBodyParagraphRuntime(ctx, 1);

  assert.equal(scoringRules['TR2-2'](ctx), 'Yes');
  assert.equal(scoringRules['TR3-2'](ctx), 'Yes');
  assert.equal(scoringRules['TR2-3A'](ctx), 'Yes');
  assert.equal(scoringRules['TR3-3A'](ctx), 'Yes');
  assert.equal(scoringRules['TR3-3B'](paragraphCtx), 'Yes');
});

test('TR low-band boundary: developed profile remains non-fault on sparse-idea rows', () => {
  const ctx = buildCollapsedParagraphCtx();
  const paragraphCtx = buildTrBodyParagraphRuntime(ctx, 1);

  assert.equal(scoringRules['TR2-3A'](ctx), 'No');
  assert.equal(scoringRules['TR3-3A'](ctx), 'No');
  assert.equal(scoringRules['TR3-3B'](paragraphCtx), 'No');
});

test('CC-Foundation C1: weak progression + overloaded cohesion trigger CC5/CC6 blockers', () => {
  const ctx = buildCcFoundationWeakCtx();

  assert.equal(scoringRules['CC5-4'](ctx), 'Yes');
  assert.equal(scoringRules['CC5-6'](ctx), 'Yes');

  assert.equal(scoringRules['CC6-2'](ctx), 'No');
  assert.equal(scoringRules['CC6-3'](ctx), 'Yes');
  assert.equal(scoringRules['CC6-4'](ctx), 'Yes');
});

test('CC-Foundation C1: blocker does not alter non-overloaded collapsed-segmentation profile', () => {
  const ctx = buildCollapsedParagraphCtx();

  assert.equal(scoringRules['CC5-4'](ctx), 'No');
  assert.equal(scoringRules['CC5-6'](ctx), 'No');

  assert.equal(scoringRules['CC6-2'](ctx), 'Yes');
  assert.equal(scoringRules['CC6-3'](ctx), 'No');
  assert.equal(scoringRules['CC6-4'](ctx), 'No');
});

test('Batch 4A-mini: CC4-4/CC5-2/CC5-4/CC5-5/CC5-8 stay strict on mechanical overuse and avoid over-penalizing strong thin-conclusion scripts', () => {
  const strongCtx = buildCcHighBandThinConclusionRecoveryCtx();
  const weakCtx = buildCcMechanicalOveruseWeakCtx();
  const lowBandCtx = buildThinLowParagraphCtx();
  const keys = ['CC4-4', 'CC5-2', 'CC5-4', 'CC5-5', 'CC5-8'];

  for (const key of keys) {
    assert.notEqual(scoringRules[key](strongCtx), null, `${key} should avoid null for strong higher-band profile`);
    assert.notEqual(scoringRules[key](weakCtx), null, `${key} should avoid null for weak mechanical profile`);
  }

  assert.equal(scoringRules['CC4-4'](strongCtx), 'No');
  assert.equal(scoringRules['CC5-2'](strongCtx), 'No');
  assert.equal(scoringRules['CC5-4'](strongCtx), 'No');
  assert.equal(scoringRules['CC5-5'](strongCtx), 'No');
  assert.equal(scoringRules['CC5-8'](strongCtx), 'No');

  assert.equal(scoringRules['CC4-4'](weakCtx), 'Yes');
  assert.equal(scoringRules['CC5-2'](weakCtx), 'Yes');
  assert.equal(scoringRules['CC5-4'](weakCtx), 'Yes');
  assert.equal(scoringRules['CC5-5'](weakCtx), 'Yes');
  assert.equal(scoringRules['CC5-8'](weakCtx), 'Yes');

  assert.equal(scoringRules['CC5-2'](lowBandCtx), 'Yes');
  assert.equal(scoringRules['CC5-8'](lowBandCtx), 'Yes');
});

test('Batch 4B-mini: LR3/GRA3 severe-floor rescue applies only to strong-content scripts and preserves low-band harshness', () => {
  const recoverableCtx = buildStrongDiscourseSevereLanguageRecoverableCtx();
  const lowBandSevereCtx = buildThinSevereLanguageCtx();

  assert.equal(scoringRules['LR3-1'](recoverableCtx), 'No');
  assert.equal(scoringRules['LR3-2'](recoverableCtx), 'some');
  assert.equal(scoringRules['GRA3-1'](recoverableCtx), 'some');

  assert.equal(scoringRules['LR3-1'](lowBandSevereCtx), 'Yes');
  assert.equal(scoringRules['LR3-2'](lowBandSevereCtx), 'severe');
  assert.equal(scoringRules['GRA3-1'](lowBandSevereCtx), 'distort');
});

test('Batch 4C-mini: GRA4 controlled-noticeable scripts are not over-penalized, while low-band severe scripts remain harsh', () => {
  const controlledCtx = buildGRA4ControlledNoticeableCtx();
  const lowBandSevereCtx = buildThinSevereLanguageCtx();

  assert.equal(scoringRules['GRA4-3'](controlledCtx), 'No');
  assert.equal(scoringRules['GRA4-5'](controlledCtx), 'No');

  assert.equal(scoringRules['GRA4-3'](lowBandSevereCtx), 'Yes');
  assert.equal(scoringRules['GRA4-5'](lowBandSevereCtx), 'No');
});

test('Batch 4D-mini: CC4 does not collapse thin-conclusion scripts when body support and topic coverage are strong', () => {
  const recoverableCtx = buildCcLowConnectorThinConclusionRecoverableCtx();
  const weakCtx = buildCcMechanicalOveruseWeakCtx();

  assert.equal(scoringRules['CC4-2'](recoverableCtx), 'No');
  assert.equal(scoringRules['CC4-3'](recoverableCtx), 'No');
  assert.equal(scoringRules['CC4-4'](recoverableCtx), 'No');

  assert.equal(scoringRules['CC4-2'](weakCtx), 'Yes');
  assert.equal(scoringRules['CC4-3'](weakCtx), 'Yes');
  assert.equal(scoringRules['CC4-4'](weakCtx), 'Yes');
});

test('Batch 4D-mini: GRA4 boundary profiles with noticeable but controlled errors stay non-fault at Band 4', () => {
  const boundaryCtx = buildGRA4NoticeableBoundaryRecoverableCtx();
  const lowBandSevereCtx = buildThinSevereLanguageCtx();

  assert.equal(scoringRules['GRA4-3'](boundaryCtx), 'No');
  assert.equal(scoringRules['GRA4-5'](boundaryCtx), 'No');

  assert.equal(scoringRules['GRA4-3'](lowBandSevereCtx), 'Yes');
  assert.equal(scoringRules['GRA4-5'](lowBandSevereCtx), 'No');
});

test('Batch 5A-mini: CC5 blockers do not over-fire on thin-conclusion scripts with strong support and progression', () => {
  const strongSinglePartCtx = buildSinglePartHighBandBoundaryCtx();
  const weakCtx = buildCcMechanicalOveruseWeakCtx();

  assert.equal(scoringRules['CC5-2'](strongSinglePartCtx), 'No');
  assert.equal(scoringRules['CC5-4'](strongSinglePartCtx), 'No');
  assert.equal(scoringRules['CC5-5'](strongSinglePartCtx), 'No');
  assert.equal(scoringRules['CC5-8'](strongSinglePartCtx), 'No');

  assert.equal(scoringRules['CC5-2'](weakCtx), 'Yes');
  assert.equal(scoringRules['CC5-4'](weakCtx), 'Yes');
  assert.equal(scoringRules['CC5-5'](weakCtx), 'Yes');
  assert.equal(scoringRules['CC5-8'](weakCtx), 'Yes');
});

test('Batch 5A-mini: TR8 single-part path allows strong responses and blocks weak boundary cases', () => {
  const strongSinglePartCtx = buildSinglePartHighBandBoundaryCtx();
  const weakSinglePartCtx = buildSinglePartWeakBoundaryCtx();

  assert.equal(scoringRules['TR8-1'](strongSinglePartCtx), 'Yes');
  assert.equal(scoringRules['TR8-2'](strongSinglePartCtx), 'Yes');
  assert.equal(scoringRules['TR8-3'](strongSinglePartCtx), 'Yes');

  assert.equal(scoringRules['TR8-1'](weakSinglePartCtx), 'No');
  assert.equal(scoringRules['TR8-2'](weakSinglePartCtx), 'No');
  assert.equal(scoringRules['TR8-3'](weakSinglePartCtx), 'No');
});

test('Batch 6A-mini: CC5 overlink recovery avoids false blocker stacking on structured mid-band responses', () => {
  const recoverableCtx = buildBand6CcOverlinkRecoverableCtx();
  const weakCtx = buildCcMechanicalOveruseWeakCtx();

  assert.equal(scoringRules['CC5-2'](recoverableCtx), 'No');
  assert.equal(scoringRules['CC5-4'](recoverableCtx), 'No');
  assert.equal(scoringRules['CC5-5'](recoverableCtx), 'No');
  assert.equal(scoringRules['CC5-8'](recoverableCtx), 'No');

  assert.equal(scoringRules['CC5-2'](weakCtx), 'Yes');
  assert.equal(scoringRules['CC5-4'](weakCtx), 'Yes');
  assert.equal(scoringRules['CC5-5'](weakCtx), 'Yes');
  assert.equal(scoringRules['CC5-8'](weakCtx), 'Yes');
});

test('Batch 6A-mini: TR8 multi-part ceiling blocks repetition-driven inflation and preserves clean high-band path', () => {
  const inflatedCtx = buildBand6TrMultiPartInflationCtx();
  const cleanCtx = buildBand8TrMultiPartCleanCtx();

  assert.equal(scoringRules['TR8-1'](inflatedCtx), 'No');
  assert.equal(scoringRules['TR8-2'](inflatedCtx), 'No');
  assert.equal(scoringRules['TR8-3'](inflatedCtx), 'No');

  assert.equal(scoringRules['TR8-1'](cleanCtx), 'Yes');
  assert.equal(scoringRules['TR8-2'](cleanCtx), 'Yes');
  assert.equal(scoringRules['TR8-3'](cleanCtx), 'Yes');
});

test('Batch 6B (Phase 1): LR5 boundary rows stay non-harsh for recoverable profiles while GRA3 severe floor still guards', () => {
  const lexicalBoundaryCtx = buildStrongDiscourseLexicalBoundaryCtx();
  const grammarBoundaryCtx = buildStrongDiscourseGrammarBoundaryCtx();
  const grammarSevereCtx = buildStrongDiscourseGrammarSevereCtx();

  assert.equal(scoringRules['LR5-2'](lexicalBoundaryCtx), 'No');
  assert.equal(scoringRules['LR5-3'](lexicalBoundaryCtx), 'No');
  assert.equal(scoringRules['LR5-4'](lexicalBoundaryCtx), 'none');

  assert.equal(scoringRules['GRA3-1'](grammarBoundaryCtx), 'some');
  assert.equal(scoringRules['GRA3-1'](grammarSevereCtx), 'distort');
});

test('Batch 6C (Phase 1): CC5-8 treats likely collapsed segmentation as recoverable but keeps thin true one-block scripts harsh', () => {
  const collapsedOneBlockCtx = buildCollapsedParagraphCtx();
  collapsedOneBlockCtx.step2.structure = {
    ...collapsedOneBlockCtx.step2.structure,
    paragraphRoles: ['body'],
    paragraphSentenceCounts: [13],
    paragraphVirtualSentenceCounts: [0],
    hasIntro: false,
    hasConclusion: false,
    paragraphCount: 1
  };
  collapsedOneBlockCtx.step2.perParagraphFeatures = [
    { paragraphIndex: 0, role: 'body', sentenceCount: 13, paragraphWordCount: 314, virtualSentenceCount: 0 }
  ];
  collapsedOneBlockCtx.step25.topicSentenceByParagraph = [
    { paragraphIndex: 0, topicSentenceIndex: 0 }
  ];
  collapsedOneBlockCtx.step25.bodySupport = [
    { paragraphIndex: 0, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [1, 2, 3, 4] }
  ];
  collapsedOneBlockCtx.essay = {
    paragraphs: [{ paragraphNumber: 1, text: 'Merged paragraph with substantial development and progression.' }]
  };

  const thinOneBlockCtx = buildThinLowParagraphCtx();
  thinOneBlockCtx.step2.structure = {
    ...thinOneBlockCtx.step2.structure,
    paragraphRoles: ['body'],
    paragraphSentenceCounts: [3],
    paragraphVirtualSentenceCounts: [0],
    hasIntro: false,
    hasConclusion: false,
    paragraphCount: 1
  };
  thinOneBlockCtx.step2.perParagraphFeatures = [
    { paragraphIndex: 0, role: 'body', sentenceCount: 3, paragraphWordCount: 72, virtualSentenceCount: 0 }
  ];
  thinOneBlockCtx.step25.topicSentenceByParagraph = [
    { paragraphIndex: 0, topicSentenceIndex: null }
  ];
  thinOneBlockCtx.step25.bodySupport = [
    { paragraphIndex: 0, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [1] }
  ];
  thinOneBlockCtx.essay = {
    paragraphs: [{ paragraphNumber: 1, text: 'Thin one block with little control.' }]
  };

  assert.equal(scoringRules['CC5-8'](collapsedOneBlockCtx), 'No');
  assert.equal(scoringRules['CC5-8'](thinOneBlockCtx), 'Yes');
});

test('Batch 6D (Phase 1): TR8 multi-part ceiling requires stronger depth/length and blocks near-threshold inflation', () => {
  const cleanCtx = buildBand8TrMultiPartCleanCtx();
  const nearThresholdCtx = buildBand8TrMultiPartCleanCtx();
  nearThresholdCtx.step1.stats.wordCount = 281;
  nearThresholdCtx.step2.taskEcho = {
    ...nearThresholdCtx.step2.taskEcho,
    effectiveContentWordCount: 281,
    effectiveContentRatio: 1
  };

  assert.equal(scoringRules['TR8-1'](cleanCtx), 'Yes');
  assert.equal(scoringRules['TR8-2'](cleanCtx), 'Yes');
  assert.equal(scoringRules['TR8-3'](cleanCtx), 'Yes');

  assert.equal(scoringRules['TR8-1'](nearThresholdCtx), 'No');
  assert.equal(scoringRules['TR8-2'](nearThresholdCtx), 'No');
  assert.equal(scoringRules['TR8-3'](nearThresholdCtx), 'No');
});

test('Batch 6E-A (Phase 1): CC7/CC8 and GRA7 ceiling keys reject boundary inflation but preserve strong control', () => {
  const ceilingRiskCtx = buildCcGraHighBandCeilingRiskCtx();
  const strongCcCtx = buildCc7StrongCtx();
  const strongGraCtx = buildGra7HighControlCtx();

  assert.equal(scoringRules['CC7-1'](ceilingRiskCtx), 'No');
  assert.equal(scoringRules['CC7-2'](ceilingRiskCtx), 'No');
  assert.equal(scoringRules['CC8-1'](ceilingRiskCtx), 'No');
  assert.equal(scoringRules['GRA7-1'](ceilingRiskCtx), 'No');
  assert.equal(scoringRules['GRA7-3'](ceilingRiskCtx), 'No');

  assert.equal(scoringRules['CC7-1'](strongCcCtx), 'Yes');
  assert.equal(scoringRules['CC7-2'](strongCcCtx), 'Yes');
  assert.equal(scoringRules['CC8-1'](strongCcCtx), 'Yes');
  assert.equal(scoringRules['GRA7-1'](strongGraCtx), 'Yes');
  assert.equal(scoringRules['GRA7-3'](strongGraCtx), 'Yes');
});

test('Batch 6E-B (Phase 1): LR4/GRA4/GRA3 floor rows allow high-content rescue but keep low-band severe scripts harsh', () => {
  const rescueCtx = buildBand6FloorRescueCtx();
  const lowBandSevereCtx = buildThinSevereLanguageCtx();

  assert.equal(scoringRules['LR4-3'](rescueCtx), 'No');
  assert.equal(scoringRules['LR4-4'](rescueCtx), 'No');
  assert.equal(scoringRules['GRA4-3'](rescueCtx), 'No');
  assert.equal(scoringRules['GRA4-4'](rescueCtx), 'No');
  assert.equal(scoringRules['GRA3-1'](rescueCtx), 'some');

  assert.equal(scoringRules['LR4-3'](lowBandSevereCtx), 'Yes');
  assert.equal(scoringRules['LR4-4'](lowBandSevereCtx), 'Yes');
  assert.equal(scoringRules['GRA4-3'](lowBandSevereCtx), 'Yes');
  assert.equal(scoringRules['GRA4-4'](lowBandSevereCtx), 'Yes');
  assert.equal(scoringRules['GRA3-1'](lowBandSevereCtx), 'distort');
});

test('Batch 6E-B2 (Phase 1): LR4/GRA4 boundary rows recover high-content single-part scripts even with unclear stance', () => {
  const rescueCtx = buildBand6SinglePartUnclearStanceBoundaryCtx();
  const lowBandSevereCtx = buildThinSevereLanguageCtx();

  assert.equal(scoringRules['LR4-3'](rescueCtx), 'No');
  assert.equal(scoringRules['LR4-4'](rescueCtx), 'No');
  assert.equal(scoringRules['LR4-5'](rescueCtx), 'some');
  assert.equal(scoringRules['GRA4-3'](rescueCtx), 'No');
  assert.equal(scoringRules['GRA4-4'](rescueCtx), 'No');

  assert.equal(scoringRules['LR4-3'](lowBandSevereCtx), 'Yes');
  assert.equal(scoringRules['LR4-4'](lowBandSevereCtx), 'Yes');
  assert.equal(scoringRules['LR4-5'](lowBandSevereCtx), 'strain');
  assert.equal(scoringRules['GRA4-3'](lowBandSevereCtx), 'Yes');
  assert.equal(scoringRules['GRA4-4'](lowBandSevereCtx), 'Yes');
});

test('Batch 6E-C (Phase 1): LR5/GRA5 boundary rows recover high-content mid-band scripts while keeping low-band severe scripts harsh', () => {
  const rescueCtx = buildBand65BoundaryRescueCtx();
  const lowBandSevereCtx = buildThinSevereLanguageCtx();

  assert.equal(scoringRules['LR5-2'](rescueCtx), 'No');
  assert.equal(scoringRules['LR5-3'](rescueCtx), 'No');
  assert.equal(scoringRules['GRA5-4'](rescueCtx), 'No');

  assert.equal(scoringRules['LR5-2'](lowBandSevereCtx), 'Yes');
  assert.equal(scoringRules['LR5-3'](lowBandSevereCtx), 'Yes');
  assert.equal(scoringRules['GRA5-4'](lowBandSevereCtx), 'Yes');
});

test('Batch 6F (Phase 1): LR5/GRA5 severe-high-content boundary de-harshing applies to C13/T04 profile but keeps true low-band severe scripts harsh', () => {
  const rescueCtx = buildBand6SinglePartUnclearStanceBoundaryCtx();
  const lowBandSevereCtx = buildThinSevereLanguageCtx();

  assert.equal(scoringRules['LR5-2'](rescueCtx), 'No');
  assert.equal(scoringRules['LR5-3'](rescueCtx), 'No');
  assert.equal(scoringRules['GRA5-4'](rescueCtx), 'No');
  assert.equal(scoringRules['GRA5-6'](rescueCtx), 'none');

  assert.equal(scoringRules['LR5-2'](lowBandSevereCtx), 'Yes');
  assert.equal(scoringRules['LR5-3'](lowBandSevereCtx), 'Yes');
  assert.equal(scoringRules['GRA5-4'](lowBandSevereCtx), 'Yes');
  assert.equal(scoringRules['GRA5-6'](lowBandSevereCtx), 'some');
});

test('Batch 6J (Phase 1): TR6-3 single-part no-stance relevance rescue works for explanation-led rows without explicit examples', () => {
  const targetLikeCtx = buildBand65SinglePartNoStanceExplanationOnlyCtx();
  const lowBandSevereCtx = buildThinSevereLanguageCtx();

  assert.equal(scoringRules['TR6-3'](targetLikeCtx), 'relevant');
  assert.equal(scoringRules['TR6-3'](lowBandSevereCtx), 'none');
});

test('Batch 6I (Phase 1): LR5-4/GRA5-1/GRA5-5 boundary blockers de-harsh for high-content single-part severe-language profile while preserving low-band severe guard', () => {
  const rescueCtx = buildBand6SinglePartUnclearStanceBoundaryCtx();
  const lowBandSevereCtx = buildThinSevereLanguageCtx();

  assert.equal(scoringRules['LR5-4'](rescueCtx), 'none');
  assert.equal(scoringRules['GRA5-1'](rescueCtx), 'No');
  assert.equal(scoringRules['GRA5-5'](rescueCtx), 'No');

  assert.equal(scoringRules['LR5-4'](lowBandSevereCtx), 'some');
  assert.equal(scoringRules['GRA5-1'](lowBandSevereCtx), 'Yes');
  assert.equal(scoringRules['GRA5-5'](lowBandSevereCtx), 'Yes');
});

test('Batch 7A (Phase 2): CC6/LR4 micro-batch targets C11/T02 over-score and C14/T03 under-score without low-band drift', () => {
  const ccRiskCtx = buildCc6ThinConnectorGuidanceCtx();
  const strongCcCtx = buildCc7StrongCtx();
  const lrBoundaryCtx = buildBand55SinglePartLexicalBoundaryCtx();
  const lowBandSevereCtx = buildThinSevereLanguageCtx();

  assert.equal(scoringRules['CC6-4'](ccRiskCtx), 'Yes');
  assert.equal(scoringRules['CC6-4'](strongCcCtx), 'No');

  assert.equal(scoringRules['LR4-2'](lrBoundaryCtx), 'No');
  assert.equal(scoringRules['LR4-5'](lrBoundaryCtx), 'some');

  assert.equal(scoringRules['LR4-2'](lowBandSevereCtx), 'Yes');
  assert.equal(scoringRules['LR4-5'](lowBandSevereCtx), 'strain');
});

test('Batch 7B (Phase 3): LR8 lexical gates require wide-range Step-3 control and avoid fallback inflation', () => {
  const notWideBoundaryCtx = buildBand8LexicalNotWideBoundaryCtx();
  const wideControlCtx = buildBand8LexicalWideControlCtx();

  assert.equal(scoringRules['LR8-1'](notWideBoundaryCtx), 'No');
  assert.equal(scoringRules['LR8-2'](notWideBoundaryCtx), 'No');
  assert.notEqual(scoringRules['LR8-1'](notWideBoundaryCtx), null);
  assert.notEqual(scoringRules['LR8-2'](notWideBoundaryCtx), null);

  assert.equal(scoringRules['LR8-1'](wideControlCtx), 'Yes');
  assert.equal(scoringRules['LR8-2'](wideControlCtx), 'Yes');
});

test('Batch 7C (Phase 3): TR9-4/CC7-4/GRA7-4 tighten high-band inflation while preserving guard and low-band behavior', () => {
  const targetCtx = buildHighBandTargetMicroBatchCtx();
  const guardCtx = buildHighBandGuardMicroBatchCtx();
  const lowBandSevereCtx = buildThinSevereLanguageCtx();

  assert.equal(scoringRules['TR9-4'](targetCtx), 'No');
  assert.equal(scoringRules['CC7-4'](targetCtx), 'No');
  assert.equal(scoringRules['GRA7-4'](targetCtx), 'frequent');

  assert.equal(scoringRules['TR9-4'](guardCtx), 'Yes');
  assert.equal(scoringRules['CC7-4'](guardCtx), 'No');
  assert.equal(scoringRules['GRA7-4'](guardCtx), 'occasional');

  assert.equal(scoringRules['TR9-4'](lowBandSevereCtx), 'No');
  assert.equal(scoringRules['CC7-4'](lowBandSevereCtx), 'No');
  assert.equal(scoringRules['GRA7-4'](lowBandSevereCtx), 'frequent');
});

test('Batch 7D (Phase 3): TR8 single-part depth guard blocks shallow 2-body/4-idea inflation while preserving strong guard path', () => {
  const targetCtx = buildHighBandTargetMicroBatchCtx();
  const guardCtx = buildHighBandGuardMicroBatchCtx();

  assert.equal(scoringRules['TR8-2'](targetCtx), 'No');
  assert.equal(scoringRules['TR8-3'](targetCtx), 'No');

  assert.equal(scoringRules['TR8-2'](guardCtx), 'Yes');
  assert.equal(scoringRules['TR8-3'](guardCtx), 'Yes');
});

test('Batch 8A (Phase 4): TR6-3 derived single-part relevance rescue and TR8 multi-part virtual-recovery ceiling tighten 6.0-6.5 drift', () => {
  const underScoreCtx = buildBand65SinglePartDerivedRelevanceCtx();
  const lowBandCtx = buildThinLowParagraphCtx();
  const overScoreCtx = buildBand7MultiPartVirtualRecoveryBoundaryCtx();
  const cleanCtx = buildBand8TrMultiPartCleanCtx();

  assert.equal(scoringRules['TR6-3'](underScoreCtx), 'relevant');
  assert.equal(scoringRules['TR6-3'](lowBandCtx), 'none');

  assert.equal(scoringRules['TR8-2'](overScoreCtx), 'No');
  assert.equal(scoringRules['TR8-3'](overScoreCtx), 'No');

  assert.equal(scoringRules['TR8-2'](cleanCtx), 'Yes');
  assert.equal(scoringRules['TR8-3'](cleanCtx), 'Yes');
});

test('Batch 8B (Phase 4): TR6 single-part no-stance closure rescue lifts strong scripts without relaxing weak low-band behavior', () => {
  const rescueCtx = buildBand65SinglePartNoStanceClosureRescueCtx();
  const guardCtx = buildHighBandGuardMicroBatchCtx();
  const lowBandCtx = buildThinLowParagraphCtx();

  assert.equal(scoringRules['TR6-1'](rescueCtx), 'Yes');
  assert.equal(scoringRules['TR6-3'](rescueCtx), 'relevant');
  assert.equal(scoringRules['TR6-4'](rescueCtx), 'No');

  assert.equal(scoringRules['TR6-4'](guardCtx), 'No');
  assert.equal(scoringRules['TR6-4'](lowBandCtx), 'Yes');
});

test('Batch 8C (Phase 4): TR6-5 single-part closure repetition boundary rescue lifts C15/T04-like scripts without weakening low-band harshness', () => {
  const boundaryRescueCtx = buildBand65SinglePartClosureRepetitionBoundaryCtx();
  const weakBoundaryCtx = buildBand5SinglePartWeakClosureRepetitionCtx();

  assert.equal(scoringRules['TR6-5'](boundaryRescueCtx), 'No');
  assert.equal(scoringRules['TR6-5'](weakBoundaryCtx), 'Yes');
});

test('Batch 8D (Phase 4): TR6 single-part four-idea boundary rescue lifts target profile while preserving weak severe guards', () => {
  const boundaryRescueCtx = buildBand6SinglePartFourIdeaBoundaryRescueCtx();
  const weakGuardCtx = buildBand5SinglePartFourIdeaWeakGuardCtx();

  assert.equal(scoringRules['TR6-1'](boundaryRescueCtx), 'Yes');
  assert.equal(scoringRules['TR6-3'](boundaryRescueCtx), 'relevant');
  assert.equal(scoringRules['TR6-4'](boundaryRescueCtx), 'No');

  assert.equal(scoringRules['TR6-1'](weakGuardCtx), 'No');
  assert.equal(scoringRules['TR6-3'](weakGuardCtx), 'none');
  assert.equal(scoringRules['TR6-4'](weakGuardCtx), 'Yes');
});

test('Batch 8E (Phase 4): TR6 rescue remains active for C15/T04-like payload shape (q1_task_response + higher lexical repetition)', () => {
  const targetLikeCtx = buildBand65SinglePartNoStanceClosureRescueCtx();
  targetLikeCtx.step25.answersBySubquestion = {
    q1_task_response: [3, 4, 5, 6, 7, 8]
  };
  targetLikeCtx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [4, 5] },
    { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [7, 8] }
  ];
  targetLikeCtx.step2.lexical = {
    ...targetLikeCtx.step2.lexical,
    topRepeatedWords: [
      { word: 'hard', count: 9 },
      { word: 'achieve', count: 7 }
    ]
  };

  assert.equal(scoringRules['TR6-1'](targetLikeCtx), 'Yes');
  assert.equal(scoringRules['TR6-3'](targetLikeCtx), 'relevant');
  assert.equal(scoringRules['TR6-4'](targetLikeCtx), 'No');
  assert.equal(scoringRules['TR6-5'](targetLikeCtx), 'No');
});

test('Batch 8F (Phase 4): TR6 direct no-stance single-part rescue triggers only with valid closure signal', () => {
  const targetLikeCtx = buildBand65SinglePartNoStanceClosureRescueCtx();
  targetLikeCtx.step25.answersBySubquestion = {
    q1_task_response: [3, 4, 5, 6, 7, 8]
  };
  targetLikeCtx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [4, 5] },
    { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [7, 8] }
  ];
  targetLikeCtx.step2.lexical = {
    ...targetLikeCtx.step2.lexical,
    topRepeatedWords: [
      { word: 'hard', count: 9 },
      { word: 'achieve', count: 7 }
    ]
  };

  const weakClosureCtx = JSON.parse(JSON.stringify(targetLikeCtx));
  weakClosureCtx.step2.structure = {
    ...weakClosureCtx.step2.structure,
    conclusionSignpostFoundInLast: false
  };

  assert.equal(scoringRules['TR6-1'](targetLikeCtx), 'Yes');
  assert.equal(scoringRules['TR6-3'](targetLikeCtx), 'relevant');
  assert.equal(scoringRules['TR6-4'](targetLikeCtx), 'No');
  assert.equal(scoringRules['TR6-5'](targetLikeCtx), 'No');

  assert.equal(scoringRules['TR6-4'](weakClosureCtx), 'Yes');
});

test('Batch 8G (Phase 4): coverage-signal dropout rescue prevents false low-band collapse on high-content scripts', () => {
  const dropoutCtx = {
    step1: {
      stats: { wordCount: 309, sentenceCount: 19, paragraphCount: 4, charCount: 1869 }
    },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [9, 4, 4, 2],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4,
        conclusionSignpostFoundInLast: true,
        misplacedConclusionSignpost: false
      },
      lexical: {
        topRepeatedWords: [
          { word: 'people', count: 9 },
          { word: 'more', count: 9 },
          { word: 'some', count: 7 }
        ],
        referencingDensity: 5.5
      },
      taskEcho: {
        severity: 'none',
        reusedPromptSentenceLikeCount: 0,
        reusedPromptPhraseCount: 0,
        copiedWordEstimate: 0,
        effectiveContentWordCount: 309,
        effectiveContentRatio: 1
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 9, paragraphWordCount: 110, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 4, paragraphWordCount: 76, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'body', sentenceCount: 4, paragraphWordCount: 82, virtualSentenceCount: 0 },
        { paragraphIndex: 3, role: 'conclusion', sentenceCount: 2, paragraphWordCount: 41, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      position: { stance: 'unclear', stanceSentenceIndex: null, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1_do_the_advantages_of_this_situation_outweigh_the_disadvantages: []
      },
      bodySupport: [
        { paragraphIndex: 0, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [4, 5, 6, 7, 8] },
        { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [9, 10, 11, 12] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [13, 14, 15, 16] }
      ],
      lexicalControl: {
        rangeBand: 'limited',
        precisionBand: 'low',
        collocationControl: 'weak',
        awkwardExpressionCountBand: 'many',
        spellingImpact: 'frequent',
        wordFormationImpact: 'frequent',
        repetitionImpact: 'strong',
        clarityImpactFromLexis: 'major'
      },
      grammarControl: {
        structureRange: 'mixed',
        complexSentenceControl: 'weak',
        errorFrequency: 'frequent',
        subjectVerbAgreement: 'weak',
        articleControl: 'weak',
        prepositionControl: 'weak',
        punctuationControl: 'mixed',
        sentenceBoundaryControl: 'weak',
        clarityImpactFromGrammar: 'major',
        errorFreeSentenceShareBand: 'very_low'
      }
    }
  };

  assert.equal(scoringRules['TR3-1'](dropoutCtx), 'No');
  assert.equal(scoringRules['TR3-2'](dropoutCtx), 'No');
  assert.equal(scoringRules['TR2-2'](dropoutCtx), 'No');
  assert.equal(scoringRules['TR2-3A'](dropoutCtx), 'No');
  assert.equal(scoringRules['TR3-3A'](dropoutCtx), 'No');
  assert.equal(scoringRules['LR3-1'](dropoutCtx), 'No');
  assert.equal(scoringRules['LR3-2'](dropoutCtx), 'some');
  assert.equal(scoringRules['GRA3-1'](dropoutCtx), 'some');
});

test('Batch 8G (Phase 4): coverage-signal dropout rescue does not relax true low-band sparse scripts', () => {
  const weakDropoutCtx = {
    step1: {
      stats: { wordCount: 176, sentenceCount: 8, paragraphCount: 3, charCount: 920 }
    },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 3, 1],
        paragraphVirtualSentenceCounts: [0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 3,
        conclusionSignpostFoundInLast: true,
        misplacedConclusionSignpost: false
      },
      lexical: {
        topRepeatedWords: [
          { word: 'people', count: 12 },
          { word: 'good', count: 10 }
        ],
        referencingDensity: 1.2
      },
      taskEcho: {
        severity: 'severe',
        reusedPromptSentenceLikeCount: 2,
        reusedPromptPhraseCount: 4,
        copiedWordEstimate: 28,
        effectiveContentWordCount: 160,
        effectiveContentRatio: 0.9
      },
      perParagraphFeatures: [
        { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 38, virtualSentenceCount: 0 },
        { paragraphIndex: 1, role: 'body', sentenceCount: 3, paragraphWordCount: 76, virtualSentenceCount: 0 },
        { paragraphIndex: 2, role: 'conclusion', sentenceCount: 1, paragraphWordCount: 18, virtualSentenceCount: 0 }
      ]
    },
    step25: {
      position: { stance: 'unclear', stanceSentenceIndex: null, contradictionSentenceIndices: [] },
      answersBySubquestion: {
        q1_task_response: []
      },
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [3] }
      ],
      lexicalControl: {
        rangeBand: 'limited',
        precisionBand: 'low',
        collocationControl: 'weak',
        awkwardExpressionCountBand: 'many',
        spellingImpact: 'frequent',
        wordFormationImpact: 'frequent',
        repetitionImpact: 'strong',
        clarityImpactFromLexis: 'major'
      },
      grammarControl: {
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
      }
    }
  };

  assert.equal(scoringRules['TR3-1'](weakDropoutCtx), 'Yes');
  assert.equal(scoringRules['TR3-2'](weakDropoutCtx), 'Yes');
  assert.equal(scoringRules['TR2-2'](weakDropoutCtx), 'Yes');
  assert.equal(scoringRules['TR2-3A'](weakDropoutCtx), 'Yes');
  assert.equal(scoringRules['TR3-3A'](weakDropoutCtx), 'Yes');
  assert.equal(scoringRules['LR3-1'](weakDropoutCtx), 'Yes');
  assert.equal(scoringRules['LR3-2'](weakDropoutCtx), 'severe');
  assert.equal(scoringRules['GRA3-1'](weakDropoutCtx), 'distort');
});

test('Batch 8H (Phase 4): TR6 closure lift remains active even when bodySupport rows are missing from extraction payload', () => {
  const targetLikeCtx = buildBand65SinglePartNoStanceClosureRescueCtx();
  targetLikeCtx.step25.answersBySubquestion = {
    q1_task_response: [3, 4, 5, 6, 7, 8]
  };
  targetLikeCtx.step25.bodySupport = [];
  targetLikeCtx.step2.lexical = {
    ...targetLikeCtx.step2.lexical,
    topRepeatedWords: [
      { word: 'hard', count: 9 },
      { word: 'achieve', count: 7 }
    ]
  };
  targetLikeCtx.step2.taskEcho = {
    ...targetLikeCtx.step2.taskEcho,
    severity: 'none',
    reusedPromptPhraseCount: 0,
    reusedPromptSentenceLikeCount: 0,
    effectiveContentWordCount: 267,
    effectiveContentRatio: 1
  };

  assert.equal(scoringRules['TR6-1'](targetLikeCtx), 'Yes');
  assert.equal(scoringRules['TR6-3'](targetLikeCtx), 'relevant');
  assert.equal(scoringRules['TR6-4'](targetLikeCtx), 'No');
  assert.equal(scoringRules['TR6-5'](targetLikeCtx), 'No');
});

test('Batch 6G (Phase 1): TR6 no-stance support rescue lifts explanation-led single-part scripts without weakening low-band guard', () => {
  const targetLikeCtx = buildBand65SinglePartNoStanceClosureRescueCtx();
  targetLikeCtx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [3] },
    { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [6] }
  ];
  targetLikeCtx.step2.lexical = {
    ...targetLikeCtx.step2.lexical,
    topRepeatedWords: [
      { word: 'hard', count: 9 },
      { word: 'achieve', count: 7 }
    ]
  };
  targetLikeCtx.step2.taskEcho = {
    ...targetLikeCtx.step2.taskEcho,
    severity: 'none',
    reusedPromptPhraseCount: 0,
    reusedPromptSentenceLikeCount: 0,
    effectiveContentWordCount: 267,
    effectiveContentRatio: 1
  };

  assert.equal(scoringRules['TR6-1'](targetLikeCtx), 'Yes');
  assert.equal(scoringRules['TR6-3'](targetLikeCtx), 'relevant');

  const weakGuardCtx = buildBand5SinglePartWeakClosureRepetitionCtx();
  weakGuardCtx.step25.position = { stance: 'unclear', stanceSentenceIndex: null, contradictionSentenceIndices: [] };
  weakGuardCtx.step25.answersBySubquestion = {
    q1_task_response: [3, 4, 5, 6, 7]
  };
  weakGuardCtx.step2.structure = {
    ...weakGuardCtx.step2.structure,
    paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
    paragraphSentenceCounts: [2, 2, 2, 1],
    conclusionSignpostFoundInLast: true,
    misplacedConclusionSignpost: false,
    hasConclusion: true
  };
  weakGuardCtx.step1 = { stats: { wordCount: 214 } };
  weakGuardCtx.step2.taskEcho = {
    ...weakGuardCtx.step2.taskEcho,
    severity: 'none',
    reusedPromptSentenceLikeCount: 0,
    reusedPromptPhraseCount: 0,
    effectiveContentWordCount: 214,
    effectiveContentRatio: 1
  };
  weakGuardCtx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [3] },
    { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [5] }
  ];
  weakGuardCtx.step2.lexical = {
    ...weakGuardCtx.step2.lexical,
    topRepeatedWords: [
      { word: 'people', count: 9 },
      { word: 'problem', count: 8 }
    ]
  };

  assert.equal(scoringRules['TR6-1'](weakGuardCtx), 'No');
  assert.equal(scoringRules['TR6-3'](weakGuardCtx), 'none');
});

test('Batch 6H (Phase 1): LR6-2 controlled single-part boundary lifts adequate-mixed profile but keeps severe lexical profile blocked', () => {
  const boundaryCtx = buildBand65SinglePartNoStanceClosureRescueCtx();
  boundaryCtx.step25.lexicalControl = {
    rangeBand: 'adequate',
    precisionBand: 'mixed',
    collocationControl: 'mixed',
    awkwardExpressionCountBand: 'some',
    spellingImpact: 'minor',
    wordFormationImpact: 'minor',
    repetitionImpact: 'mild',
    clarityImpactFromLexis: 'minor'
  };

  assert.equal(scoringRules['LR6-2'](boundaryCtx), 'Yes');
  boundaryCtx.step2.lexical = {
    ...(boundaryCtx.step2.lexical || {}),
    topRepeatedWords: [
      { word: 'hard', count: 11 },
      { word: 'life', count: 8 }
    ]
  };
  assert.equal(scoringRules['LR6-2'](boundaryCtx), 'Yes');

  const weakLexicalCtx = buildBand5SinglePartWeakClosureRepetitionCtx();
  weakLexicalCtx.step25.answersBySubquestion = {
    q1_task_response: [3, 4, 5, 6, 7]
  };
  weakLexicalCtx.step1 = { stats: { wordCount: 267 } };
  weakLexicalCtx.step2.taskEcho = {
    ...weakLexicalCtx.step2.taskEcho,
    severity: 'none',
    reusedPromptPhraseCount: 0,
    reusedPromptSentenceLikeCount: 0,
    effectiveContentWordCount: 267,
    effectiveContentRatio: 1
  };
  weakLexicalCtx.step2.structure = {
    ...weakLexicalCtx.step2.structure,
    paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
    paragraphSentenceCounts: [3, 3, 3, 2],
    paragraphVirtualSentenceCounts: [0, 0, 0, 0],
    hasConclusion: true,
    conclusionSignpostFoundInLast: true,
    misplacedConclusionSignpost: false
  };
  weakLexicalCtx.step25.lexicalControl = {
    rangeBand: 'limited',
    precisionBand: 'low',
    collocationControl: 'weak',
    awkwardExpressionCountBand: 'many',
    spellingImpact: 'frequent',
    wordFormationImpact: 'frequent',
    repetitionImpact: 'strong',
    clarityImpactFromLexis: 'major'
  };

  assert.equal(scoringRules['LR6-2'](weakLexicalCtx), 'No');
});

test('Batch 10A (Phase 5): TR6 language-backed no-stance rescue lifts strong single-part scripts while preserving weak guards', () => {
  const strongCtx = buildBand7SinglePartNoStanceLanguageBackedCtx();
  const weakCtx = buildBand5SinglePartNoStanceLanguageWeakCtx();

  assert.equal(scoringRules['TR6-1'](strongCtx), 'Yes');
  assert.equal(scoringRules['TR6-4'](strongCtx), 'No');

  assert.equal(scoringRules['TR6-1'](weakCtx), 'No');
  assert.equal(scoringRules['TR6-4'](weakCtx), 'Yes');
});

test('Batch 10A (Phase 5): CC3-1A run-on sectioned skeleton recovery avoids false band-3 floor collapse', () => {
  const recoverableCtx = buildCcRunOnSectionRecoveryCtx();
  const sparseWeakCtx = buildCcRunOnSparseWeakCtx();
  const weakCtx = buildThinLowParagraphCtx();

  assert.equal(scoringRules['CC3-1A'](recoverableCtx), 'No');
  assert.equal(scoringRules['CC3-1A'](sparseWeakCtx), 'Yes');
  assert.equal(scoringRules['CC3-1A'](weakCtx), 'Yes');
});

test('Batch 10B (Phase 5): CC6-4 blocks high-referencing heavy-repetition over-lift while preserving moderate guard profile', () => {
  const targetCtx = buildCc6HighRefRepetitionOverliftCtx();
  const guardCtx = buildCc6HighRefRepetitionGuardCtx();

  assert.equal(scoringRules['CC6-4'](targetCtx), 'Yes');
  assert.equal(scoringRules['CC6-4'](guardCtx), 'No');
});

test('Batch 10C (Phase 5): CC5-2/CC5-6 recover run-on body boundary but keep low-guidance thin-conclusion profile blocked', () => {
  const boundaryCtx = buildCcBand5RunOnBodyBoundaryRecoveryCtx();
  const weakCtx = buildCcBand5LowGuidanceThinConclusionCtx();

  assert.equal(scoringRules['CC5-2'](boundaryCtx), 'No');
  assert.equal(scoringRules['CC5-6'](boundaryCtx), 'No');

  assert.equal(scoringRules['CC5-2'](weakCtx), 'Yes');
  assert.equal(scoringRules['CC5-6'](weakCtx), 'Yes');
});

test('Batch 10C (Phase 5): GRA4-2 promotes recoverable mixed-boundary profile but keeps harsh mixed profile blocked', () => {
  const recoverableCtx = buildGra4MixedBoundaryRecoverableCtx();
  const harshCtx = buildGra4MixedBoundaryHarshCtx();

  assert.equal(scoringRules['GRA4-2'](recoverableCtx), 'Yes');
  assert.equal(scoringRules['GRA4-2'](harshCtx), 'No');
});

test('Batch 10M (Phase 6): GRA4-2 stabilizes high-content mixed boundary without promoting harsh guards', () => {
  const highContentBoundaryCtx = buildGra4MixedBoundaryHighContentRecoveryCtx();
  const harshCtx = buildGra4MixedBoundaryHarshCtx();

  assert.equal(scoringRules['GRA4-2'](highContentBoundaryCtx), 'Yes');
  assert.equal(scoringRules['GRA4-2'](harshCtx), 'No');
});

test('Batch 10D (Phase 5): GRA4-3 de-harshes weak sentence-boundary recoverable profile and preserves low-band severe guard', () => {
  const recoverableCtx = buildGra4RunOnBoundarySentenceWeakRecoverableCtx();
  const lowBandSevereCtx = buildThinSevereLanguageCtx();

  assert.equal(scoringRules['GRA4-3'](recoverableCtx), 'No');
  assert.equal(scoringRules['GRA4-3'](lowBandSevereCtx), 'Yes');
});

test('Batch 10E (Phase 5): CC5-4 de-harshes high-reference low-guidance boundary while preserving mechanical and low-band guards', () => {
  const boundaryCtx = buildCcBand5LowGuidanceThinConclusionCtx();
  const weakCtx = buildCcMechanicalOveruseWeakCtx();
  const lowBandCtx = buildThinLowParagraphCtx();

  assert.equal(scoringRules['CC5-4'](boundaryCtx), 'No');
  assert.equal(scoringRules['CC5-4'](weakCtx), 'Yes');
  assert.notEqual(scoringRules['CC5-4'](lowBandCtx), 'No');
});

test('Batch 10F (Phase 5): CC6/LR6 boundary rescue lifts high-content profiles while preserving weak guards', () => {
  const runOnBoundaryCtx = buildCcLrGraBand6BoundaryRecoveryCtx();
  const lowGuidanceBoundaryCtx = buildCcLrBand6LowGuidanceBoundaryCtx();
  const lowBandSevereCtx = buildThinSevereLanguageCtx();

  assert.equal(scoringRules['CC6-1'](runOnBoundaryCtx), 'Yes');
  assert.equal(scoringRules['CC6-2'](runOnBoundaryCtx), 'Yes');
  assert.equal(scoringRules['CC6-3'](runOnBoundaryCtx), 'No');
  assert.equal(scoringRules['CC6-5'](runOnBoundaryCtx), 'No');
  assert.equal(scoringRules['LR6-1'](runOnBoundaryCtx), 'Yes');

  assert.equal(scoringRules['CC6-1'](lowGuidanceBoundaryCtx), 'Yes');
  assert.equal(scoringRules['CC6-2'](lowGuidanceBoundaryCtx), 'Yes');
  assert.equal(scoringRules['CC6-3'](lowGuidanceBoundaryCtx), 'No');
  assert.equal(scoringRules['CC6-5'](lowGuidanceBoundaryCtx), 'No');
  assert.equal(scoringRules['LR6-1'](lowGuidanceBoundaryCtx), 'Yes');

  assert.equal(scoringRules['CC6-1'](lowBandSevereCtx), 'No');
  assert.equal(scoringRules['CC6-2'](lowBandSevereCtx), 'No');
  assert.equal(scoringRules['CC6-3'](lowBandSevereCtx), 'Yes');
  assert.equal(scoringRules['LR6-1'](lowBandSevereCtx), 'No');
});

test('Batch 10F (Phase 5): GRA5 sentence-boundary rescue de-harshes high-content boundary while preserving low-band severe guard', () => {
  const boundaryCtx = buildCcLrGraBand6BoundaryRecoveryCtx();
  const lowBandSevereCtx = buildThinSevereLanguageCtx();

  assert.equal(scoringRules['GRA5-1'](boundaryCtx), 'No');
  assert.equal(scoringRules['GRA5-4'](boundaryCtx), 'No');
  assert.equal(scoringRules['GRA5-5'](boundaryCtx), 'No');
  assert.equal(scoringRules['GRA5-6'](boundaryCtx), 'some');

  assert.equal(scoringRules['GRA5-1'](lowBandSevereCtx), 'Yes');
  assert.equal(scoringRules['GRA5-4'](lowBandSevereCtx), 'Yes');
  assert.equal(scoringRules['GRA5-5'](lowBandSevereCtx), 'Yes');
});

test('Batch 10G (Phase 6): CC7 thin-conclusion high-reference boundary passes while low-band and overlinked guards remain strict', () => {
  const boundaryCtx = buildCc7ThinConclusionHighRefBoundaryCtx();
  const lowBandCtx = buildThinLowParagraphCtx();
  const overlinkedCtx = buildCc6HighRefRepetitionOverliftCtx();

  assert.equal(scoringRules['CC7-1'](boundaryCtx), 'Yes');
  assert.equal(scoringRules['CC7-2'](boundaryCtx), 'No');
  assert.equal(scoringRules['CC7-4'](boundaryCtx), 'Yes');

  assert.equal(scoringRules['CC7-1'](lowBandCtx), 'No');
  assert.equal(scoringRules['CC7-4'](lowBandCtx), 'No');

  assert.equal(scoringRules['CC7-1'](overlinkedCtx), 'No');
  assert.equal(scoringRules['CC7-4'](overlinkedCtx), 'No');
});

test('Batch 10H/10I (Phase 6): TR8-1/LR7-1/LR7-2/GRA8-1 tighten 6.0 overscore boundary while preserving clean high-band path', () => {
  const targetBoundaryCtx = buildBand6HighBoundaryOverscoreCtx();
  const highBandGuardCtx = buildBand8HighBoundaryGuardCtx();
  const variedHighGuardCtx = buildBand8HighBoundaryGuardCtx();
  variedHighGuardCtx.step25.grammarControl = {
    ...variedHighGuardCtx.step25.grammarControl,
    structureRange: 'varied',
    errorFreeSentenceShareBand: 'high'
  };

  assert.equal(scoringRules['TR8-1'](targetBoundaryCtx), 'No');
  assert.equal(scoringRules['LR7-1'](targetBoundaryCtx), 'No');
  assert.equal(scoringRules['LR7-2'](targetBoundaryCtx), 'No');
  assert.equal(scoringRules['GRA8-1'](targetBoundaryCtx), 'No');

  assert.equal(scoringRules['TR8-1'](highBandGuardCtx), 'Yes');
  assert.equal(scoringRules['LR7-1'](highBandGuardCtx), 'Yes');
  assert.equal(scoringRules['LR7-2'](highBandGuardCtx), 'Yes');
  assert.equal(scoringRules['GRA8-1'](highBandGuardCtx), 'Yes');
  assert.equal(scoringRules['GRA8-1'](variedHighGuardCtx), 'Yes');
});

test('Batch 10N (Phase 7): TR8-1/TR8-2 and CC7-1/CC7-2/CC7-4 recover strong sparse-linking boundary without promoting overscore/low-band guards', () => {
  const targetBoundaryCtx = buildBand9SinglePartSparseCohesionBoundaryCtx();
  const thinConclusionTargetCtx = buildBand9SinglePartThinConclusionHighBandBoundaryCtx();
  const overscoreGuardCtx = buildBand6HighBoundaryOverscoreCtx();
  const ccOverlinkedGuardCtx = buildCc6HighRefRepetitionOverliftCtx();
  const lowBandCtx = buildThinLowParagraphCtx();

  assert.equal(scoringRules['TR8-1'](targetBoundaryCtx), 'Yes');
  assert.equal(scoringRules['TR8-2'](targetBoundaryCtx), 'Yes');
  assert.equal(scoringRules['CC7-1'](targetBoundaryCtx), 'Yes');
  assert.equal(scoringRules['CC7-2'](targetBoundaryCtx), 'Yes');
  assert.equal(scoringRules['CC7-4'](targetBoundaryCtx), 'Yes');
  assert.equal(scoringRules['TR8-1'](thinConclusionTargetCtx), 'Yes');
  assert.equal(scoringRules['TR8-2'](thinConclusionTargetCtx), 'Yes');
  assert.equal(scoringRules['CC7-1'](thinConclusionTargetCtx), 'Yes');
  assert.equal(scoringRules['CC7-2'](thinConclusionTargetCtx), 'Yes');
  assert.equal(scoringRules['CC7-4'](thinConclusionTargetCtx), 'Yes');

  assert.equal(scoringRules['TR8-1'](overscoreGuardCtx), 'No');
  assert.equal(scoringRules['TR8-2'](overscoreGuardCtx), 'No');
  assert.equal(scoringRules['CC7-1'](ccOverlinkedGuardCtx), 'No');
  assert.equal(scoringRules['CC7-2'](ccOverlinkedGuardCtx), 'No');
  assert.equal(scoringRules['CC7-4'](ccOverlinkedGuardCtx), 'No');

  assert.notEqual(scoringRules['TR8-1'](lowBandCtx), 'Yes');
  assert.notEqual(scoringRules['TR8-2'](lowBandCtx), 'Yes');
  assert.equal(scoringRules['CC7-1'](lowBandCtx), 'No');
  assert.equal(scoringRules['CC7-2'](lowBandCtx), 'No');
  assert.equal(scoringRules['CC7-4'](lowBandCtx), 'No');
});

test('Batch 10J (Phase 6): coverage-thin single-part rescue lifts TR7-1/LR6-2/GRA7-2 while weak guard remains blocked', () => {
  const boundaryCtx = buildBand7SinglePartCoverageThinBoundaryRescueCtx();
  const weakCtx = buildBand5SinglePartWeakClosureRepetitionCtx();

  assert.equal(scoringRules['TR7-1'](boundaryCtx), 'Yes');
  assert.equal(scoringRules['LR6-2'](boundaryCtx), 'Yes');
  assert.equal(scoringRules['GRA7-2'](boundaryCtx), 'Yes');

  assert.equal(scoringRules['TR7-1'](weakCtx), 'No');
  assert.notEqual(scoringRules['LR6-2'](weakCtx), 'Yes');
  assert.notEqual(scoringRules['GRA7-2'](weakCtx), 'Yes');
});

test('Batch 11J (Phase 9): GRA7-2 long high-content low-accuracy boundary rescue stays narrow and preserves guards', () => {
  const recoverableCtx = buildGra7LongHighContentLowAccuracyBoundaryCtx();
  const shortCtx = buildGra7LongHighContentLowAccuracyBoundaryCtx();
  shortCtx.step1 = { stats: { wordCount: 300 } };
  shortCtx.step2.taskEcho = {
    ...(shortCtx.step2.taskEcho || {}),
    effectiveContentWordCount: 300,
    effectiveContentRatio: 1
  };
  const severeEchoCtx = buildGra7LongHighContentLowAccuracyBoundaryCtx();
  severeEchoCtx.step2.taskEcho = {
    ...(severeEchoCtx.step2.taskEcho || {}),
    severity: 'severe'
  };
  const lowBandCtx = buildBand5SinglePartWeakClosureRepetitionCtx();

  assert.equal(scoringRules['GRA7-2'](recoverableCtx), 'Yes');
  assert.equal(scoringRules['GRA7-2'](shortCtx), 'No');
  assert.equal(scoringRules['GRA7-2'](severeEchoCtx), 'No');
  assert.notEqual(scoringRules['GRA7-2'](lowBandCtx), 'Yes');
});

test('Batch 11K (Phase 9): TR7-1 compact single-body high-coverage boundary rescue stays narrow and preserves guards', () => {
  const recoverableCtx = buildTr7CompactSingleBodyBoundaryRescueCtx();
  const shortCtx = buildTr7CompactSingleBodyBoundaryRescueCtx();
  shortCtx.step1 = { stats: { wordCount: 196 } };
  shortCtx.step2.taskEcho = {
    ...(shortCtx.step2.taskEcho || {}),
    effectiveContentWordCount: 190,
    effectiveContentRatio: 0.96
  };
  const severeEchoCtx = buildTr7CompactSingleBodyBoundaryRescueCtx();
  severeEchoCtx.step2.taskEcho = {
    ...(severeEchoCtx.step2.taskEcho || {}),
    severity: 'severe'
  };
  const lowBandCtx = buildBand5SinglePartWeakClosureRepetitionCtx();

  assert.equal(scoringRules['TR7-1'](recoverableCtx), 'Yes');
  assert.equal(scoringRules['TR7-1'](shortCtx), 'No');
  assert.equal(scoringRules['TR7-1'](severeEchoCtx), 'No');
  assert.equal(scoringRules['TR7-1'](lowBandCtx), 'No');
});

test('Batch 11L (Phase 9): LR6-2 compact single-body lexical boundary rescue stays narrow and preserves guards', () => {
  const recoverableCtx = buildLr6CompactSingleBodyBoundaryRescueCtx();
  const shortCtx = buildLr6CompactSingleBodyBoundaryRescueCtx();
  shortCtx.step1 = { stats: { wordCount: 196 } };
  shortCtx.step2.taskEcho = {
    ...(shortCtx.step2.taskEcho || {}),
    effectiveContentWordCount: 190,
    effectiveContentRatio: 0.96
  };
  const severeEchoCtx = buildLr6CompactSingleBodyBoundaryRescueCtx();
  severeEchoCtx.step2.taskEcho = {
    ...(severeEchoCtx.step2.taskEcho || {}),
    severity: 'severe'
  };
  const lowBandCtx = buildBand5SinglePartWeakClosureRepetitionCtx();

  assert.equal(scoringRules['LR6-2'](recoverableCtx), 'Yes');
  assert.equal(scoringRules['LR6-2'](shortCtx), 'No');
  assert.equal(scoringRules['LR6-2'](severeEchoCtx), 'No');
  assert.notEqual(scoringRules['LR6-2'](lowBandCtx), 'Yes');
});

test('Batch 11M (Phase 9): TR9-2 blocks compact single-part low-breadth over-lift and keeps higher-breadth guard path', () => {
  const lowBreadthCtx = buildTr9SinglePartLowBreadthOverliftCtx();
  const highBreadthCtx = buildTr9SinglePartLowBreadthOverliftCtx();
  highBreadthCtx.step25.answersBySubquestion = {
    q1_task_response: [2, 4, 6, 8, 10, 12]
  };
  const lowBandCtx = buildBand5SinglePartWeakClosureRepetitionCtx();

  assert.equal(scoringRules['TR9-2'](lowBreadthCtx), 'No');
  assert.equal(scoringRules['TR9-2'](highBreadthCtx), 'Yes');
  assert.notEqual(scoringRules['TR9-2'](lowBandCtx), 'Yes');
});

test('Batch 11N (Phase 9): TR8-2 recovers long high-content multi-part boundary with strong language while preserving imbalance/low-band guards', () => {
  const recoverableCtx = buildTr8MultiPartHighContentBoundaryRecoverableCtx();
  const unbalancedGuardCtx = buildTr8MultiPartHighContentBoundaryRecoverableCtx();
  unbalancedGuardCtx.step25.answersBySubquestion = {
    q1: [1, 2, 3],
    q2: [4, 5, 6, 7, 8, 9, 10, 11, 12]
  };
  const overscoreGuardCtx = buildBand6HighBoundaryOverscoreCtx();
  const lowBandCtx = buildBand5SinglePartWeakClosureRepetitionCtx();

  assert.equal(scoringRules['TR8-2'](recoverableCtx), 'Yes');
  assert.equal(scoringRules['TR8-2'](unbalancedGuardCtx), 'No');
  assert.equal(scoringRules['TR8-2'](overscoreGuardCtx), 'No');
  assert.notEqual(scoringRules['TR8-2'](lowBandCtx), 'Yes');
});

test('Batch 11P (Phase 9): TR8-2 recovers compact balanced high-content multi-part no-stance boundary while preserving lexical/imbalance/low-band guards', () => {
  const compactRecoverableCtx = buildTr8MultiPartHighContentBoundaryRecoverableCtx();
  compactRecoverableCtx.step25.answersBySubquestion = {
    q1: [1, 2, 3, 4, 5],
    q2: [6, 7, 8, 9, 10]
  };
  const lexicalRepetitionGuardCtx = buildTr8MultiPartHighContentBoundaryRecoverableCtx();
  lexicalRepetitionGuardCtx.step25.answersBySubquestion = {
    q1: [1, 2, 3, 4, 5],
    q2: [6, 7, 8, 9, 10]
  };
  lexicalRepetitionGuardCtx.step25.lexicalControl = {
    ...(lexicalRepetitionGuardCtx.step25.lexicalControl || {}),
    repetitionImpact: 'noticeable'
  };
  const unbalancedGuardCtx = buildTr8MultiPartHighContentBoundaryRecoverableCtx();
  unbalancedGuardCtx.step25.answersBySubquestion = {
    q1: [1, 2],
    q2: [3, 4, 5, 6, 7, 8, 9, 10]
  };
  const overscoreGuardCtx = buildBand6HighBoundaryOverscoreCtx();
  const lowBandCtx = buildBand5SinglePartWeakClosureRepetitionCtx();

  assert.equal(scoringRules['TR8-2'](compactRecoverableCtx), 'Yes');
  assert.equal(scoringRules['TR8-2'](lexicalRepetitionGuardCtx), 'No');
  assert.equal(scoringRules['TR8-2'](unbalancedGuardCtx), 'No');
  assert.equal(scoringRules['TR8-2'](overscoreGuardCtx), 'No');
  assert.notEqual(scoringRules['TR8-2'](lowBandCtx), 'Yes');
});

test('Batch 11Q (Phase 9): TR8 moderate-echo boundary and CC7 high-reference boundary recover target-like profiles while preserving overscore/low-band guards', () => {
  const trMultiModerateEchoCtx = buildTr8MultiPartHighContentBoundaryRecoverableCtx();
  trMultiModerateEchoCtx.step2.taskEcho = {
    ...(trMultiModerateEchoCtx.step2.taskEcho || {}),
    severity: 'moderate',
    reusedPromptSentenceLikeCount: 0,
    reusedPromptPhraseCount: 1,
    copiedWordEstimate: 18,
    effectiveContentWordCount: 305,
    effectiveContentRatio: 0.95
  };
  const trSingleModerateEchoCtx = buildBand9SinglePartSparseCohesionBoundaryCtx();
  trSingleModerateEchoCtx.step2.taskEcho = {
    ...(trSingleModerateEchoCtx.step2.taskEcho || {}),
    severity: 'moderate',
    reusedPromptSentenceLikeCount: 0,
    reusedPromptPhraseCount: 1,
    copiedWordEstimate: 14,
    effectiveContentWordCount: 280,
    effectiveContentRatio: 0.96
  };
  const trSevereEchoGuardCtx = buildTr8MultiPartHighContentBoundaryRecoverableCtx();
  trSevereEchoGuardCtx.step2.taskEcho = {
    ...(trSevereEchoGuardCtx.step2.taskEcho || {}),
    severity: 'severe',
    reusedPromptSentenceLikeCount: 2,
    reusedPromptPhraseCount: 3,
    copiedWordEstimate: 36,
    effectiveContentWordCount: 305,
    effectiveContentRatio: 0.9
  };
  const trOverscoreGuardCtx = buildBand6HighBoundaryOverscoreCtx();

  const ccHighReferenceBoundaryCtx = buildCc7HighReferenceBoundaryRecoverableCtx();
  const ccOverlinkedGuardCtx = buildCc6HighRefRepetitionOverliftCtx();
  const lowBandCtx = buildThinLowParagraphCtx();

  assert.equal(scoringRules['TR8-1'](trMultiModerateEchoCtx), 'Yes');
  assert.equal(scoringRules['TR8-2'](trMultiModerateEchoCtx), 'Yes');
  assert.equal(scoringRules['TR8-1'](trSingleModerateEchoCtx), 'Yes');
  assert.equal(scoringRules['TR8-2'](trSingleModerateEchoCtx), 'Yes');
  assert.equal(scoringRules['TR8-1'](trSevereEchoGuardCtx), 'No');
  assert.equal(scoringRules['TR8-2'](trSevereEchoGuardCtx), 'No');
  assert.equal(scoringRules['TR8-1'](trOverscoreGuardCtx), 'No');
  assert.equal(scoringRules['TR8-2'](trOverscoreGuardCtx), 'No');

  assert.equal(scoringRules['CC7-1'](ccHighReferenceBoundaryCtx), 'Yes');
  assert.equal(scoringRules['CC7-2'](ccHighReferenceBoundaryCtx), 'Yes');
  assert.equal(scoringRules['CC7-1'](ccOverlinkedGuardCtx), 'No');
  assert.equal(scoringRules['CC7-2'](ccOverlinkedGuardCtx), 'No');
  assert.equal(scoringRules['CC7-1'](lowBandCtx), 'No');
  assert.equal(scoringRules['CC7-2'](lowBandCtx), 'No');
});

test('Batch 11O (Phase 9): TR8-1 recovers balanced high-content multi-part boundary with unclear stance while preserving imbalance/low-band guards', () => {
  const recoverableCtx = buildTr8MultiPartHighContentBoundaryRecoverableCtx();
  const lexicalRepetitionGuardCtx = buildTr8MultiPartHighContentBoundaryRecoverableCtx();
  lexicalRepetitionGuardCtx.step25.lexicalControl = {
    ...(lexicalRepetitionGuardCtx.step25.lexicalControl || {}),
    repetitionImpact: 'noticeable'
  };
  const unbalancedGuardCtx = buildTr8MultiPartHighContentBoundaryRecoverableCtx();
  unbalancedGuardCtx.step25.answersBySubquestion = {
    q1: [1, 2, 3],
    q2: [4, 5, 6, 7, 8, 9, 10, 11, 12]
  };
  const overscoreGuardCtx = buildBand6HighBoundaryOverscoreCtx();
  const lowBandCtx = buildBand5SinglePartWeakClosureRepetitionCtx();

  assert.equal(scoringRules['TR8-1'](recoverableCtx), 'Yes');
  assert.equal(scoringRules['TR8-1'](lexicalRepetitionGuardCtx), 'No');
  assert.equal(scoringRules['TR8-1'](unbalancedGuardCtx), 'No');
  assert.equal(scoringRules['TR8-1'](overscoreGuardCtx), 'No');
  assert.notEqual(scoringRules['TR8-1'](lowBandCtx), 'Yes');
});

test('Batch 10L (Phase 6): LR6-2 mild-echo thin-coverage rescue lifts target-like profile without promoting broader guards', () => {
  const targetLikeCtx = buildBand7SinglePartCoverageThinMildEchoBoundaryCtx();
  const broadGuardCtx = buildBand7SinglePartCoverageThinBoundaryRescueCtx();
  broadGuardCtx.step25.answersBySubquestion = { q1: [1, 2, 3] };
  broadGuardCtx.step2.taskEcho = {
    ...(broadGuardCtx.step2.taskEcho || {}),
    severity: 'moderate',
    effectiveContentWordCount: 334,
    effectiveContentRatio: 0.96
  };
  broadGuardCtx.step1 = { stats: { wordCount: 334 } };

  const weakCtx = buildBand5SinglePartWeakClosureRepetitionCtx();

  assert.equal(scoringRules['LR6-2'](targetLikeCtx), 'Yes');
  assert.equal(scoringRules['LR6-2'](broadGuardCtx), 'No');
  assert.notEqual(scoringRules['LR6-2'](weakCtx), 'Yes');
});

test('Batch 12C (Phase 10): GRA2-1 single-part recoverable boundary de-harshes only high-content consistent stance profiles', () => {
  const recoverableCtx = buildGra2SinglePartRecoverableBoundaryCtx();
  const compactRecoverableCtx = buildGra2SinglePartRecoverableBoundaryCtx();
  compactRecoverableCtx.step1 = { stats: { wordCount: 198 } };
  compactRecoverableCtx.step2.taskEcho = {
    ...(compactRecoverableCtx.step2.taskEcho || {}),
    severity: 'moderate',
    effectiveContentWordCount: 176,
    effectiveContentRatio: 0.88
  };
  const belowFloorGuardCtx = buildGra2SinglePartRecoverableBoundaryCtx();
  belowFloorGuardCtx.step1 = { stats: { wordCount: 192 } };
  belowFloorGuardCtx.step2.taskEcho = {
    ...(belowFloorGuardCtx.step2.taskEcho || {}),
    severity: 'moderate',
    effectiveContentWordCount: 170,
    effectiveContentRatio: 0.87
  };
  const contradictionGuardCtx = buildGra2SinglePartRecoverableBoundaryCtx();
  contradictionGuardCtx.step25.position = {
    ...(contradictionGuardCtx.step25.position || {}),
    contradictionSentenceIndices: [7]
  };
  const severeEchoGuardCtx = buildGra2SinglePartRecoverableBoundaryCtx();
  severeEchoGuardCtx.step2.taskEcho = {
    ...(severeEchoGuardCtx.step2.taskEcho || {}),
    severity: 'severe',
    effectiveContentRatio: 0.78
  };
  const lowBandCtx = buildBand5SinglePartNoStanceLanguageWeakCtx();

  assert.equal(scoringRules['GRA2-1'](recoverableCtx), 'No');
  assert.equal(scoringRules['GRA2-1'](compactRecoverableCtx), 'No');
  assert.equal(scoringRules['GRA2-1'](belowFloorGuardCtx), 'Yes');
  assert.equal(scoringRules['GRA2-1'](contradictionGuardCtx), 'Yes');
  assert.equal(scoringRules['GRA2-1'](severeEchoGuardCtx), 'Yes');
  assert.equal(scoringRules['GRA2-1'](lowBandCtx), 'Yes');
});

test('Batch 12E (Phase 10): TR7-1/TR7-3 recover single-part high-content sparse-coverage boundary without promoting severe-echo or weak-support guards', () => {
  const recoverableCtx = buildTr7CoverageSignalThinRecoverableCtx();
  const supportGuardCtx = buildTr7CoverageSignalThinRecoverableCtx();
  supportGuardCtx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [3] }
  ];
  const severeEchoGuardCtx = buildTr7CoverageSignalThinRecoverableCtx();
  severeEchoGuardCtx.step2.taskEcho = {
    ...(severeEchoGuardCtx.step2.taskEcho || {}),
    severity: 'severe',
    reusedPromptSentenceLikeCount: 2,
    reusedPromptPhraseCount: 5,
    effectiveContentRatio: 0.86
  };
  const lowBandCtx = buildBand5SinglePartWeakClosureRepetitionCtx();

  assert.equal(scoringRules['TR7-1'](recoverableCtx), 'Yes');
  assert.equal(scoringRules['TR7-3'](recoverableCtx), 'Yes');
  assert.equal(scoringRules['TR7-1'](supportGuardCtx), 'No');
  assert.equal(scoringRules['TR7-3'](supportGuardCtx), 'No');
  assert.equal(scoringRules['TR7-1'](severeEchoGuardCtx), 'No');
  assert.equal(scoringRules['TR7-3'](severeEchoGuardCtx), 'No');
  assert.notEqual(scoringRules['TR7-1'](lowBandCtx), 'Yes');
  assert.notEqual(scoringRules['TR7-3'](lowBandCtx), 'Yes');
});

test('Batch 12F (Phase 10): TR7-1 allows explanation-led single-part high-content boundary even when explicit examples are absent', () => {
  const noExampleBoundaryCtx = buildTr7CoverageSignalThinRecoverableCtx();
  noExampleBoundaryCtx.step2.taskEcho = {
    ...(noExampleBoundaryCtx.step2.taskEcho || {}),
    severity: 'none',
    reusedPromptSentenceLikeCount: 0,
    reusedPromptPhraseCount: 0,
    effectiveContentWordCount: 316,
    effectiveContentRatio: 1
  };
  noExampleBoundaryCtx.step25.position = {
    ...(noExampleBoundaryCtx.step25.position || {}),
    stance: 'partial'
  };
  noExampleBoundaryCtx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [3, 4, 5] },
    { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [6, 7, 8, 9] },
    { paragraphIndex: 3, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [10] }
  ];

  const lowLengthGuardCtx = buildTr7CoverageSignalThinRecoverableCtx();
  lowLengthGuardCtx.step2.taskEcho = {
    ...(lowLengthGuardCtx.step2.taskEcho || {}),
    severity: 'moderate',
    effectiveContentWordCount: 210,
    effectiveContentRatio: 0.84
  };
  lowLengthGuardCtx.step1 = { stats: { wordCount: 232 } };
  lowLengthGuardCtx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [3, 4] },
    { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [6] }
  ];
  lowLengthGuardCtx.step25.answersBySubquestion = {
    q1_task_response: [2, 7]
  };

  assert.equal(scoringRules['TR7-1'](noExampleBoundaryCtx), 'Yes');
  assert.equal(scoringRules['TR7-3'](noExampleBoundaryCtx), 'No');
  assert.equal(scoringRules['TR7-1'](lowLengthGuardCtx), 'No');
});

test('Batch 12T (Phase 11): TR7-1 recovers two-idea high-content single-part boundary while keeping repetition and low-band guards blocked', () => {
  const recoverableCtx = buildTr7TwoIdeaHighContentBoundaryCtx();
  const repetitionGuardCtx = buildTr7TwoIdeaHighContentBoundaryCtx();
  repetitionGuardCtx.step2.lexical = {
    ...(repetitionGuardCtx.step2.lexical || {}),
    topRepeatedWords: [
      { word: 'water', count: 12 },
      { word: 'public', count: 6 },
      { word: 'service', count: 5 }
    ]
  };
  const lowBandCtx = buildBand5SinglePartWeakClosureRepetitionCtx();

  assert.equal(scoringRules['TR7-1'](recoverableCtx), 'Yes');
  assert.equal(scoringRules['TR7-1'](repetitionGuardCtx), 'No');
  assert.notEqual(scoringRules['TR7-1'](lowBandCtx), 'Yes');
});

test('Batch 12U (Phase 11): GRA5-1 recovers two-idea high-content single-part sentence-weak boundary while keeping weak/repetition and low-band guards strict', () => {
  const recoverableCtx = buildGra5TwoIdeaSinglePartBoundaryCtx();
  const oneStrongBoundaryCtx = buildGra5TwoIdeaSinglePartBoundaryCtx();
  oneStrongBoundaryCtx.step25.bodySupport = oneStrongBoundaryCtx.step25.bodySupport.map((row, idx) => (
    idx === 1
      ? { ...row, hasExample: false }
      : row
  ));
  const weakControlGuardCtx = buildGra5TwoIdeaSinglePartBoundaryCtx();
  weakControlGuardCtx.step25.grammarControl = {
    ...weakControlGuardCtx.step25.grammarControl,
    subjectVerbAgreement: 'weak'
  };
  const zeroStrongGuardCtx = buildGra5TwoIdeaSinglePartBoundaryCtx();
  zeroStrongGuardCtx.step25.bodySupport = zeroStrongGuardCtx.step25.bodySupport.map((row) => ({
    ...row,
    hasExample: false
  }));
  const repetitionGuardCtx = buildGra5TwoIdeaSinglePartBoundaryCtx();
  repetitionGuardCtx.step2.lexical = {
    ...(repetitionGuardCtx.step2.lexical || {}),
    topRepeatedWords: [
      { word: 'water', count: 12 },
      { word: 'public', count: 6 },
      { word: 'service', count: 5 }
    ]
  };
  const lowBandCtx = buildThinSevereLanguageCtx();

  assert.equal(scoringRules['GRA5-1'](recoverableCtx), 'No');
  assert.equal(scoringRules['GRA5-1'](oneStrongBoundaryCtx), 'No');
  assert.equal(scoringRules['GRA5-1'](weakControlGuardCtx), 'Yes');
  assert.equal(scoringRules['GRA5-1'](zeroStrongGuardCtx), 'Yes');
  assert.equal(scoringRules['GRA5-1'](repetitionGuardCtx), 'Yes');
  assert.equal(scoringRules['GRA5-1'](lowBandCtx), 'Yes');
});

test('Batch 12W (Phase 11): GRA5-6 de-harshes two-idea high-content single-part sentence-weak boundary while preserving weak/repetition and low-band guards', () => {
  const recoverableCtx = buildGra5TwoIdeaSinglePartBoundaryCtx();
  const weakControlGuardCtx = buildGra5TwoIdeaSinglePartBoundaryCtx();
  weakControlGuardCtx.step25.grammarControl = {
    ...weakControlGuardCtx.step25.grammarControl,
    subjectVerbAgreement: 'weak'
  };
  const repetitionGuardCtx = buildGra5TwoIdeaSinglePartBoundaryCtx();
  repetitionGuardCtx.step2.lexical = {
    ...(repetitionGuardCtx.step2.lexical || {}),
    topRepeatedWords: [
      { word: 'water', count: 12 },
      { word: 'public', count: 6 },
      { word: 'service', count: 5 }
    ]
  };
  const lowBandCtx = buildThinSevereLanguageCtx();

  assert.equal(scoringRules['GRA5-6'](recoverableCtx), 'none');
  assert.equal(scoringRules['GRA5-6'](weakControlGuardCtx), 'some');
  assert.equal(scoringRules['GRA5-6'](repetitionGuardCtx), 'some');
  assert.equal(scoringRules['GRA5-6'](lowBandCtx), 'some');
});

test('Batch 12X (Phase 11): LR6-2 recovers two-idea high-content weak-collocation boundary while preserving weak-support/repetition and low-band guards', () => {
  const recoverableCtx = buildLr6TwoIdeaWeakCollocationBoundaryCtx();
  const weakSupportGuardCtx = buildLr6TwoIdeaWeakCollocationBoundaryCtx();
  weakSupportGuardCtx.step25.bodySupport = weakSupportGuardCtx.step25.bodySupport.map((row) => ({
    ...row,
    hasExample: false
  }));
  const repetitionGuardCtx = buildLr6TwoIdeaWeakCollocationBoundaryCtx();
  repetitionGuardCtx.step2.lexical = {
    ...(repetitionGuardCtx.step2.lexical || {}),
    topRepeatedWords: [
      { word: 'water', count: 12 },
      { word: 'public', count: 6 },
      { word: 'service', count: 5 }
    ]
  };
  const lowBandCtx = buildThinSevereLanguageCtx();

  assert.equal(scoringRules['LR6-2'](recoverableCtx), 'Yes');
  assert.equal(scoringRules['LR6-2'](weakSupportGuardCtx), 'No');
  assert.equal(scoringRules['LR6-2'](repetitionGuardCtx), 'No');
  assert.equal(scoringRules['LR6-2'](lowBandCtx), 'No');
});

test('Batch 12G (Phase 10): TR8-1/TR8-2 allow partial-stance high-control single-part boundary but keep weak boundary blocked', () => {
  const recoverableCtx = buildTr8PartialStanceHighControlBoundaryCtx();
  const weakGuardCtx = buildTr8PartialStanceHighControlBoundaryCtx();
  weakGuardCtx.step25.answersBySubquestion = {
    q1_task_response: [3, 6, 9]
  };
  weakGuardCtx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [3, 4] }
  ];
  weakGuardCtx.step25.lexicalControl = {
    rangeBand: 'adequate',
    precisionBand: 'mixed',
    collocationControl: 'mixed',
    awkwardExpressionCountBand: 'some',
    spellingImpact: 'minor',
    wordFormationImpact: 'minor',
    repetitionImpact: 'mild',
    clarityImpactFromLexis: 'minor'
  };
  weakGuardCtx.step25.grammarControl = {
    structureRange: 'mixed',
    complexSentenceControl: 'mixed',
    errorFrequency: 'noticeable',
    subjectVerbAgreement: 'mixed',
    articleControl: 'mixed',
    prepositionControl: 'mixed',
    punctuationControl: 'mixed',
    sentenceBoundaryControl: 'mixed',
    clarityImpactFromGrammar: 'minor',
    errorFreeSentenceShareBand: 'moderate'
  };
  weakGuardCtx.step2.taskEcho = {
    ...(weakGuardCtx.step2.taskEcho || {}),
    severity: 'moderate',
    reusedPromptSentenceLikeCount: 0,
    reusedPromptPhraseCount: 2,
    effectiveContentWordCount: 228,
    effectiveContentRatio: 0.88
  };

  assert.equal(scoringRules['TR8-1'](recoverableCtx), 'Yes');
  assert.equal(scoringRules['TR8-2'](recoverableCtx), 'Yes');
  assert.equal(scoringRules['TR8-1'](weakGuardCtx), 'No');
  assert.equal(scoringRules['TR8-2'](weakGuardCtx), 'No');
});

test('Batch 12E (Phase 10): CC6-1 thin-conclusion high-control boundary recovers only when high language control is present', () => {
  const recoverableCtx = buildCc6ThinConclusionHighControlBoundaryCtx();
  const lowLanguageGuardCtx = buildCc6ThinConclusionHighControlBoundaryCtx();
  lowLanguageGuardCtx.step25.lexicalControl = {
    rangeBand: 'adequate',
    precisionBand: 'mixed',
    collocationControl: 'mixed',
    awkwardExpressionCountBand: 'some',
    spellingImpact: 'some',
    wordFormationImpact: 'some',
    repetitionImpact: 'noticeable',
    clarityImpactFromLexis: 'some'
  };
  lowLanguageGuardCtx.step25.grammarControl = {
    structureRange: 'mixed',
    complexSentenceControl: 'mixed',
    errorFrequency: 'noticeable',
    subjectVerbAgreement: 'mixed',
    articleControl: 'mixed',
    prepositionControl: 'mixed',
    punctuationControl: 'mixed',
    sentenceBoundaryControl: 'mixed',
    clarityImpactFromGrammar: 'some',
    errorFreeSentenceShareBand: 'low'
  };
  const lowBandCtx = buildThinLowParagraphCtx();

  assert.equal(scoringRules['CC6-1'](recoverableCtx), 'Yes');
  assert.equal(scoringRules['CC6-1'](lowLanguageGuardCtx), 'No');
  assert.equal(scoringRules['CC6-1'](lowBandCtx), 'No');
});

test('Batch 12H (Phase 10): CC6-1 thin-conclusion high-control boundary allows one strong + one developed body row and blocks weak support', () => {
  const oneStrongSupportCtx = buildCc6ThinConclusionHighControlBoundaryCtx();
  oneStrongSupportCtx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [2, 3, 4] },
    { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [6, 7, 8] }
  ];

  const weakSupportGuardCtx = buildCc6ThinConclusionHighControlBoundaryCtx();
  weakSupportGuardCtx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [2, 3, 4] },
    { paragraphIndex: 2, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [6] }
  ];

  assert.equal(scoringRules['CC6-1'](oneStrongSupportCtx), 'Yes');
  assert.equal(scoringRules['CC6-1'](weakSupportGuardCtx), 'No');
});

test('Batch 12I (Phase 10): TR8 partial-stance boundary requires explicit stance anchor and CC6-1 thin-boundary requires thin conclusion (not thin intro)', () => {
  const explicitAnchorCtx = buildTr8PartialStanceHighControlBoundaryCtx();
  explicitAnchorCtx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [3, 4, 5] },
    { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [7, 8, 9] },
    { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [8, 9] }
  ];
  const missingAnchorCtx = JSON.parse(JSON.stringify(explicitAnchorCtx));
  missingAnchorCtx.step25.position = {
    ...(missingAnchorCtx.step25.position || {}),
    stance: 'partial',
    stanceSentenceIndex: null,
    contradictionSentenceIndices: []
  };

  const thinIntroGuardCtx = buildCc6ThinConclusionHighControlBoundaryCtx();
  thinIntroGuardCtx.step2.structure = {
    ...(thinIntroGuardCtx.step2.structure || {}),
    paragraphSentenceCounts: [1, 4, 4, 2]
  };
  thinIntroGuardCtx.step2.perParagraphFeatures = [
    { paragraphIndex: 0, role: 'intro', sentenceCount: 1, paragraphWordCount: 35, virtualSentenceCount: 0 },
    { paragraphIndex: 1, role: 'body', sentenceCount: 4, paragraphWordCount: 96, virtualSentenceCount: 0 },
    { paragraphIndex: 2, role: 'body', sentenceCount: 4, paragraphWordCount: 91, virtualSentenceCount: 0 },
    { paragraphIndex: 3, role: 'conclusion', sentenceCount: 2, paragraphWordCount: 29, virtualSentenceCount: 0 }
  ];

  assert.equal(scoringRules['TR8-1'](explicitAnchorCtx), 'Yes');
  assert.equal(scoringRules['TR8-2'](explicitAnchorCtx), 'Yes');
  assert.equal(scoringRules['TR8-1'](missingAnchorCtx), 'No');
  assert.equal(scoringRules['TR8-2'](missingAnchorCtx), 'No');
  assert.equal(scoringRules['CC6-1'](thinIntroGuardCtx), 'No');
});

test('Batch 12J (Phase 10): LR6-1 recovers single-part coverage-signal boundary only with anchored stance and strong support', () => {
  const recoverableCtx = buildLr6SinglePartCoverageSignalBoundaryCtx();
  const noAnchorGuardCtx = buildLr6SinglePartCoverageSignalBoundaryCtx();
  noAnchorGuardCtx.step25.position = {
    ...(noAnchorGuardCtx.step25.position || {}),
    stanceSentenceIndex: null
  };

  const weakSupportGuardCtx = buildLr6SinglePartCoverageSignalBoundaryCtx();
  weakSupportGuardCtx.step1 = { stats: { wordCount: 246 } };
  weakSupportGuardCtx.step2.taskEcho = {
    ...(weakSupportGuardCtx.step2.taskEcho || {}),
    severity: 'moderate',
    effectiveContentWordCount: 232,
    effectiveContentRatio: 0.94
  };
  weakSupportGuardCtx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [6, 7] },
    { paragraphIndex: 2, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [10] }
  ];

  const lowBandCtx = buildBand5SinglePartWeakClosureRepetitionCtx();

  assert.equal(scoringRules['LR6-1'](recoverableCtx), 'Yes');
  assert.equal(scoringRules['LR6-1'](noAnchorGuardCtx), 'No');
  assert.equal(scoringRules['LR6-1'](weakSupportGuardCtx), 'No');
  assert.notEqual(scoringRules['LR6-1'](lowBandCtx), 'Yes');
});

test('Batch 12L (Phase 10): CC7-1 recovers high-reference repetition-boundary profile while preserving over-trigger and low-band guards', () => {
  const recoverableCtx = buildCc7HighReferenceRepetitionBoundaryRecoveryCtx();
  const overTriggerGuardCtx = buildCc7HighReferenceRepetitionOverTriggerGuardCtx();
  const lowBandCtx = buildThinLowParagraphCtx();

  assert.equal(scoringRules['CC7-1'](recoverableCtx), 'Yes');
  assert.equal(scoringRules['CC7-1'](overTriggerGuardCtx), 'No');
  assert.equal(scoringRules['CC7-1'](lowBandCtx), 'No');
});

test('Batch 12M (Phase 10): TR9-2 allows explanation-led full-development boundary while preserving low-breadth and low-band guards', () => {
  const explanationLedRecoverableCtx = buildTr9SinglePartExplanationLedFullDevelopmentCtx();
  const lowBreadthCtx = buildTr9SinglePartLowBreadthOverliftCtx();
  const weakSupportGuardCtx = buildTr9SinglePartExplanationLedFullDevelopmentCtx();
  weakSupportGuardCtx.step25.bodySupport = [
    { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [5] },
    { paragraphIndex: 2, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [10, 11] }
  ];
  const lowBandCtx = buildBand5SinglePartWeakClosureRepetitionCtx();

  assert.equal(scoringRules['TR9-2'](explanationLedRecoverableCtx), 'Yes');
  assert.equal(scoringRules['TR9-2'](lowBreadthCtx), 'No');
  assert.notEqual(scoringRules['TR9-2'](weakSupportGuardCtx), 'Yes');
  assert.notEqual(scoringRules['TR9-2'](lowBandCtx), 'Yes');
});

test('Batch 13A (Phase 12): TR9-2 blocks repetitive single-part two-body over-lift while preserving clean explanation-led boundary', () => {
  const cleanBoundaryCtx = buildTr9SinglePartLowBreadthOverliftCtx();
  cleanBoundaryCtx.step25.answersBySubquestion = {
    q1_task_response: [2, 4, 6, 8, 10, 12]
  };

  const repetitiveBoundaryCtx = buildTr9SinglePartLowBreadthOverliftCtx();
  repetitiveBoundaryCtx.step25.answersBySubquestion = {
    q1_task_response: [2, 4, 6, 8, 10, 12]
  };
  repetitiveBoundaryCtx.step2.lexical = {
    ...(repetitiveBoundaryCtx.step2.lexical || {}),
    topRepeatedWords: [
      { word: 'technology', count: 12 },
      { word: 'society', count: 6 },
      { word: 'people', count: 5 }
    ]
  };
  const lowBandCtx = buildBand5SinglePartWeakClosureRepetitionCtx();

  assert.equal(scoringRules['TR9-2'](cleanBoundaryCtx), 'Yes');
  assert.equal(scoringRules['TR9-2'](repetitiveBoundaryCtx), 'No');
  assert.notEqual(scoringRules['TR9-2'](lowBandCtx), 'Yes');
});

test('Batch 12O (Phase 11): TR8-1/TR8-2 and CC7-1 recover compact high-control single-part boundary while preserving weak/low-band guards', () => {
  const targetCtx = buildBook5Test04HighBandBoundaryCtx();
  const weakLanguageGuardCtx = buildBook5Test04BoundaryWeakLanguageGuardCtx();
  const lowDensityGuardCtx = buildBook5Test04BoundaryLowDensityGuardCtx();
  const lowBandCtx = buildBand5SinglePartWeakClosureRepetitionCtx();

  assert.equal(scoringRules['TR8-1'](targetCtx), 'Yes');
  assert.equal(scoringRules['TR8-2'](targetCtx), 'Yes');
  assert.equal(scoringRules['CC7-1'](targetCtx), 'Yes');

  assert.notEqual(scoringRules['TR8-1'](weakLanguageGuardCtx), 'Yes');
  assert.notEqual(scoringRules['TR8-2'](weakLanguageGuardCtx), 'Yes');
  assert.notEqual(scoringRules['CC7-1'](weakLanguageGuardCtx), 'Yes');

  assert.equal(scoringRules['CC7-1'](lowDensityGuardCtx), 'No');
  assert.notEqual(scoringRules['TR8-1'](lowBandCtx), 'Yes');
  assert.notEqual(scoringRules['TR8-2'](lowBandCtx), 'Yes');
  assert.equal(scoringRules['CC7-1'](lowBandCtx), 'No');
});

test('Batch 12Y (Phase 11): CC9-1/CC9-2 require stronger non-basic connector volume to avoid boundary over-credit while preserving clear Band-9-safe profile', () => {
  const buildCc9Ctx = ({ totalConnectorsExcludingBasic = 7, weakReferencing = false } = {}) => {
    const usageMapExcludingBasic = totalConnectorsExcludingBasic >= 8
      ? {
          however: 2,
          therefore: 1,
          moreover: 1,
          consequently: 1,
          'in addition': 1,
          'for example': 1,
          'in conclusion': 1
        }
      : {
          however: 2,
          therefore: 1,
          moreover: 1,
          consequently: 1,
          'for example': 1,
          'in conclusion': 1
        };

    return {
      step1: { stats: { wordCount: 317 } },
      step2: {
        structure: {
          paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
          paragraphSentenceCounts: [2, 3, 3, 2],
          paragraphVirtualSentenceCounts: [0, 0, 0, 0],
          hasIntro: true,
          hasConclusion: true,
          paragraphCount: 4,
          conclusionSignpostFoundInLast: true,
          misplacedConclusionSignpost: false
        },
        cohesion: {
          densityPer100ExcludingBasic: '2.58',
          distinctConnectorsExcludingBasic: 6,
          totalConnectorsExcludingBasic,
          usageMapExcludingBasic
        },
        lexical: {
          referencingDensity: weakReferencing ? 0.95 : 5.9,
          topRepeatedWords: [
            { word: 'people', count: 5 },
            { word: 'society', count: 4 }
          ]
        },
        perParagraphFeatures: [
          { paragraphIndex: 0, role: 'intro', sentenceCount: 2, paragraphWordCount: 48, virtualSentenceCount: 0 },
          { paragraphIndex: 1, role: 'body', sentenceCount: 3, paragraphWordCount: 91, virtualSentenceCount: 0 },
          { paragraphIndex: 2, role: 'body', sentenceCount: 3, paragraphWordCount: 94, virtualSentenceCount: 0 },
          { paragraphIndex: 3, role: 'conclusion', sentenceCount: 2, paragraphWordCount: 51, virtualSentenceCount: 0 }
        ]
      },
      step25: {
        topicSentenceByParagraph: [
          { paragraphIndex: 0, topicSentenceIndex: 0 },
          { paragraphIndex: 1, topicSentenceIndex: 2 },
          { paragraphIndex: 2, topicSentenceIndex: 5 },
          { paragraphIndex: 3, topicSentenceIndex: 8 }
        ]
      }
    };
  };

  const boundaryCtx = buildCc9Ctx({ totalConnectorsExcludingBasic: 7 });
  const strongBand9SafeCtx = buildCc9Ctx({ totalConnectorsExcludingBasic: 8 });
  const weakReferencingGuardCtx = buildCc9Ctx({ totalConnectorsExcludingBasic: 8, weakReferencing: true });

  assert.equal(scoringRules['CC9-1'](boundaryCtx), 'No');
  assert.equal(scoringRules['CC9-1'](strongBand9SafeCtx), 'Yes');
  assert.equal(scoringRules['CC9-1'](weakReferencingGuardCtx), 'No');
  assert.equal(scoringRules['CC9-2'](boundaryCtx), 'No');
  assert.equal(scoringRules['CC9-2'](strongBand9SafeCtx), 'Yes');
  assert.equal(scoringRules['CC9-2'](weakReferencingGuardCtx), 'No');
});

test('Batch 13D (Phase 12): LR9-1/LR9-2/GRA9-1 require sufficient paragraph-level evidence density for Band-9 claims', () => {
  const buildBand9LanguageCtx = ({ thinConclusion = false } = {}) => ({
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: thinConclusion ? [3, 4, 4, 5, 1] : [3, 4, 4, 5, 2],
        paragraphVirtualSentenceCounts: [0, 0, 0, 0, 0],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 5
      }
    },
    step25: {
      lexicalControl: {
        rangeBand: 'wide',
        precisionBand: 'high',
        collocationControl: 'good',
        awkwardExpressionCountBand: 'none',
        spellingImpact: 'minor',
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
  });

  const thinConclusionCtx = buildBand9LanguageCtx({ thinConclusion: true });
  const sufficientDensityCtx = buildBand9LanguageCtx({ thinConclusion: false });

  assert.equal(scoringRules['LR9-1'](thinConclusionCtx), 'No');
  assert.equal(scoringRules['LR9-2'](thinConclusionCtx), 'occasional');
  assert.equal(scoringRules['GRA9-1'](thinConclusionCtx), 'No');
  assert.equal(scoringRules['LR9-1'](sufficientDensityCtx), 'Yes');
  assert.equal(scoringRules['LR9-2'](sufficientDensityCtx), 'rare_slips');
  assert.equal(scoringRules['GRA9-1'](sufficientDensityCtx), 'Yes');
});

