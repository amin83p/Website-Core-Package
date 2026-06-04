const test = require('node:test');
const assert = require('node:assert/strict');

const essayPreprocessingService = require('../MVC/services/ielts/essayPreprocessingService');
const essayAnalysisService = require('../MVC/services/ielts/essayAnalysisService');
const { scoringRules } = require('../MVC/services/ielts/scoringRules');

const SCHOOL_START_PROMPT = 'Many people believe that children should start school at a very early age, while others think they should start school later. Discuss both views and give your own opinion.';

function buildDistortedCopyEssay() {
  return [
    'Many people believe children should start school at very early age while others think children should start school later and in this essay I discuss both views and give my own opinion but the ideas are weak.',
    'Many people believe that children should start school early while others think they should start school later and I will discuss both views and give my opinion with limited support.',
    'Some parents like early classes because of childcare, however the argument is not explained clearly and examples are thin.',
    'In conclusion I repeat that children should start school at very early age while others think they should start school later and this response again restates the task.'
  ].join('\n\n');
}

function buildTopicReuseEssay() {
  return [
    'School entry age is an important policy issue for families and teachers.',
    'Early enrollment may improve routine and literacy habits, but emotional maturity differs by child and by home context.',
    'A flexible policy can combine readiness checks, parent guidance, and optional transition classes for nervous learners.',
    'This balanced approach keeps educational goals while reducing stress for children who need more time.'
  ].join('\n\n');
}

function buildContext(taskEcho) {
  return {
    step1: { stats: { wordCount: 275 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 2, 2, 1],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4
      },
      taskEcho
    },
    step25: {
      answersBySubquestion: {
        q1: [1, 2],
        q2: [5]
      },
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [2] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [5] }
      ],
      position: {
        stance: 'partial',
        stanceSentenceIndex: 5,
        contradictionSentenceIndices: [2]
      }
    }
  };
}

test('A) distorted Cambridge-like prompt-copy no longer reports zero reuse', () => {
  const essayObj = essayPreprocessingService.buildEssayObject(buildDistortedCopyEssay());
  const taskEcho = essayAnalysisService.computeTaskEchoSignals(essayObj, SCHOOL_START_PROMPT);

  assert.ok(taskEcho.wordOverlapRatio > 0);
  assert.ok(taskEcho.reusedPromptPhraseCount >= 2);
  assert.ok(taskEcho.reusedPromptSentenceLikeCount >= 1);
  assert.ok(taskEcho.copiedWordEstimate >= 25);
  assert.ok(taskEcho.effectiveContentWordCount < essayObj.stats.wordCount);
  assert.notEqual(taskEcho.severity, 'none');
  assert.ok(Array.isArray(taskEcho.matchedUnitDiagnostics));
  assert.ok(taskEcho.matchedUnitDiagnostics.length >= 1);
});

test('B) topic reuse without direct restatement is not falsely flagged as severe copying', () => {
  const essayObj = essayPreprocessingService.buildEssayObject(buildTopicReuseEssay());
  const taskEcho = essayAnalysisService.computeTaskEchoSignals(essayObj, SCHOOL_START_PROMPT);

  assert.ok(['none', 'mild'].includes(taskEcho.severity));
  assert.equal(taskEcho.reusedPromptSentenceLikeCount, 0);
  assert.ok(taskEcho.copiedWordEstimate < 15);
});

test('C) repeated restatement across intro/body/conclusion raises severity strongly', () => {
  const essayObj = essayPreprocessingService.buildEssayObject(buildDistortedCopyEssay());
  const taskEcho = essayAnalysisService.computeTaskEchoSignals(essayObj, SCHOOL_START_PROMPT);

  assert.ok(taskEcho.reusedPromptSentenceLikeCount >= 2);
  assert.ok(taskEcho.reusedPromptPhraseCount >= 3);
  assert.equal(taskEcho.severity, 'severe');
});

test('D) stronger task-echo primarily affects TR while CC remains stable by default', () => {
  const baselineCtx = buildContext({
    wordOverlapRatio: 0.08,
    reusedPromptPhraseCount: 0,
    reusedPromptSentenceLikeCount: 0,
    copiedWordEstimate: 0,
    effectiveContentWordCount: 275,
    effectiveContentRatio: 1,
    severity: 'none',
    anchorReuseCount: 0,
    matchedUnitDiagnostics: []
  });

  const copiedCtx = buildContext({
    wordOverlapRatio: 0.41,
    reusedPromptPhraseCount: 4,
    reusedPromptSentenceLikeCount: 2,
    copiedWordEstimate: 70,
    effectiveContentWordCount: 205,
    effectiveContentRatio: 0.745,
    severity: 'severe',
    anchorReuseCount: 7,
    matchedUnitDiagnostics: [{ unitIndex: 0 }, { unitIndex: 1 }]
  });

  const trBase = scoringRules['TR5-1'](baselineCtx);
  const trCopied = scoringRules['TR5-1'](copiedCtx);
  const ccBase = scoringRules['CC2-1A'](baselineCtx);
  const ccCopied = scoringRules['CC2-1A'](copiedCtx);

  assert.notEqual(trCopied, trBase);
  assert.equal(trCopied, 'Yes');
  assert.equal(ccCopied, ccBase);
});

test('E) non-regression: stronger essays remain plausible with low task-echo signals', () => {
  const strongEssay = [
    'Debates about school starting age should focus on readiness evidence and family context.',
    'Early entry can help many children build routines and social confidence when classrooms are supportive and well resourced.',
    'Some children benefit from a later start because emotional maturity and language development vary, so policies should remain flexible.',
    'A balanced policy can prioritise child welfare while still maintaining clear educational goals.'
  ].join('\n\n');
  const essayObj = essayPreprocessingService.buildEssayObject(strongEssay);
  const taskEcho = essayAnalysisService.computeTaskEchoSignals(essayObj, SCHOOL_START_PROMPT);

  assert.ok(['none', 'mild'].includes(taskEcho.severity));
  assert.ok(taskEcho.copiedWordEstimate < 20);

  const ctx = {
    step1: { stats: { wordCount: 268 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 3, 3, 2],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4
      },
      taskEcho: {
        ...taskEcho,
        effectiveContentWordCount: 268,
        effectiveContentRatio: 1,
        severity: 'none'
      }
    },
    step25: {
      answersBySubquestion: {
        q1: [1, 2],
        q2: [5, 6]
      },
      bodySupport: [
        { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [1, 2] },
        { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [5, 6] }
      ],
      position: {
        stance: 'agree',
        stanceSentenceIndex: 0,
        contradictionSentenceIndices: []
      }
    }
  };

  assert.equal(scoringRules['TR5-1'](ctx), 'No');
  assert.equal(scoringRules['TR6-1'](ctx), 'Yes');
});
