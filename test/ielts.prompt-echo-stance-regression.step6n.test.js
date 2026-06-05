const test = require('node:test');
const assert = require('node:assert/strict');

const essayPreprocessingService = require('../packages/ielts/MVC/services/ielts/essayPreprocessingService');
const essayAnalysisService = require('../packages/ielts/MVC/services/ielts/essayAnalysisService');
const step3ScoringService = require('../packages/ielts/MVC/services/ielts/step3ScoringService');
const { scoringRules } = require('../packages/ielts/MVC/services/ielts/scoringRules');

const CAMBRIDGE_LIKE_PROMPT = 'Many people believe that children should start school at a very early age, while others think they should start school later. Discuss both views and give your own opinion.';

function buildCambridgeLikeEssayText() {
  return [
    'Many people believe that children should start school at a very early age while others think they should start school later and this essay will discuss both views and give my own opinion even though the issue is complex for families.',
    'Many people believe that children should start school at a very early age while others think they should start school later and I mention some benefits and problems but the ideas are not fully developed for each side.',
    'Many people believe that children should start school at a very early age while others think they should start school later and I partly agree with starting early, however I also suggest late starters may still be successful in many situations.',
    'In conclusion I partly support early schooling but I also disagree with forcing every child to begin at the same age because home background and readiness are different.'
  ].join('\n\n');
}

function buildCambridgeLikeExtraction() {
  return {
    answersBySubquestion: {
      q1: [1],
      q2: [2]
    },
    position: {
      stance: 'partial',
      stanceSentenceIndex: 3,
      contradictionSentenceIndices: [2]
    },
    bodySupport: [
      { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [1] },
      { paragraphIndex: 2, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [2] }
    ],
    topicSentenceByParagraph: [
      { paragraphIndex: 0, topicSentenceIndex: 0 },
      { paragraphIndex: 1, topicSentenceIndex: 1 },
      { paragraphIndex: 2, topicSentenceIndex: 2 },
      { paragraphIndex: 3, topicSentenceIndex: 3 }
    ]
  };
}

function buildRuleCtx({ essayObj, step2, extraction }) {
  return {
    essay: essayObj,
    step1: { stats: essayObj.stats },
    step2,
    step25: extraction,
    taskPrompt: CAMBRIDGE_LIKE_PROMPT
  };
}

test('Cambridge-like weak essay: copied prompt + inconsistent stance does not collapse to absent-position and total-CC2', () => {
  const essayObj = essayPreprocessingService.buildEssayObject(buildCambridgeLikeEssayText());
  const step2 = essayAnalysisService.computeStep2Features(essayObj, { taskPrompt: CAMBRIDGE_LIKE_PROMPT });
  const extraction = buildCambridgeLikeExtraction();
  const ctx = buildRuleCtx({ essayObj, step2, extraction });

  assert.ok(step2.taskEcho.reusedPromptPhraseCount >= 1);
  assert.ok(step2.taskEcho.reusedPromptSentenceLikeCount >= 1);
  assert.ok(step2.taskEcho.effectiveContentWordCount < essayObj.stats.wordCount);

  assert.equal(scoringRules['TR2-2'](ctx), 'No');
  assert.equal(scoringRules['TR3-2'](ctx), 'No');
  assert.equal(scoringRules['TR4-2'](ctx), 'unclear');
  assert.equal(scoringRules['CC2-1A'](ctx), 'No');

  const bodyParagraphIndex = 1;
  const currentParagraph = {
    paragraphIndex: bodyParagraphIndex,
    paragraphNumber: bodyParagraphIndex + 1,
    role: 'body',
    feature: step2.perParagraphFeatures[bodyParagraphIndex],
    text: essayObj.paragraphs[bodyParagraphIndex].text,
    sentences: essayObj.sentences.filter((s) => s.paragraphIndex === bodyParagraphIndex),
    topicSentence: extraction.topicSentenceByParagraph.find((row) => row.paragraphIndex === bodyParagraphIndex),
    bodySupport: extraction.bodySupport.find((row) => row.paragraphIndex === bodyParagraphIndex)
  };
  const cc21b = scoringRules['CC2-1B']({ ...ctx, currentParagraph, paragraph: currentParagraph });
  assert.notEqual(cc21b, 'Yes');
});

test('No-position scenario still triggers low-band absent-position faults', () => {
  const ctx = {
    step1: { stats: { wordCount: 190 } },
    step2: {},
    step25: {
      position: {
        stance: 'unclear',
        stanceSentenceIndex: null,
        contradictionSentenceIndices: []
      }
    }
  };

  assert.equal(scoringRules['TR2-2'](ctx), 'Yes');
  assert.equal(scoringRules['TR3-2'](ctx), 'Yes');
  assert.equal(scoringRules['TR4-2'](ctx), 'none');
});

test('Inconsistent-position scenario maps to unclear position, not absent position', () => {
  const ctx = {
    step1: { stats: { wordCount: 210 } },
    step2: {},
    step25: {
      position: {
        stance: 'agree',
        stanceSentenceIndex: 3,
        contradictionSentenceIndices: [1]
      }
    }
  };

  assert.equal(scoringRules['TR2-2'](ctx), 'No');
  assert.equal(scoringRules['TR3-2'](ctx), 'No');
  assert.equal(scoringRules['TR4-2'](ctx), 'unclear');
  assert.equal(scoringRules['TR5-4'](ctx), 'Yes');
});

test('Prompt-copy detection produces lower effective content counts for obvious restatement', () => {
  const essayObj = essayPreprocessingService.buildEssayObject(buildCambridgeLikeEssayText());
  const taskEcho = essayAnalysisService.computeTaskEchoSignals(essayObj, CAMBRIDGE_LIKE_PROMPT);

  assert.ok(taskEcho.reusedPromptPhraseCount >= 1);
  assert.ok(taskEcho.reusedPromptSentenceLikeCount >= 1);
  assert.ok(taskEcho.wordOverlapRatio > 0);
  assert.ok(taskEcho.effectiveContentWordCount < essayObj.stats.wordCount);
  assert.ok(taskEcho.effectiveContentRatio < 1);
});

test('Effective content underlength can trigger TR5-1 when raw length is inflated by prompt-copy', async () => {
  const repeatedPromptChunk = CAMBRIDGE_LIKE_PROMPT.replace(/[.]/g, '');
  const repeatedParas = Array.from(
    { length: 8 },
    () => `${repeatedPromptChunk} and I repeat this wording without adding real development`
  );
  const essayText = [
    ...repeatedParas,
    'My final position is partial because I briefly mention both sides without full support.'
  ].join('\n\n');

  const essayObj = essayPreprocessingService.buildEssayObject(essayText);
  assert.ok(essayObj.stats.wordCount >= 260);

  const step2WithoutPrompt = essayAnalysisService.computeStep2Features(essayObj);
  const extraction = {
    answersBySubquestion: {
      q1: [1],
      q2: [2]
    },
    position: {
      stance: 'partial',
      stanceSentenceIndex: 8,
      contradictionSentenceIndices: [2]
    },
    bodySupport: [
      { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [1] },
      { paragraphIndex: 2, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [2] }
    ]
  };

  const result = await step3ScoringService.runStep3Scoring({
    essayObj,
    step2Features: step2WithoutPrompt,
    extraction,
    microAssessments: [
      {
        baseKey: 'TR5-1',
        question_key: 'TR5-1',
        is_active: true,
        scope: 'essay',
        criterion: 'TR',
        band: 5,
        answer_type: 'Boolean',
        atomic_question: 'Does the response address the task only partially?'
      }
    ],
    taskPrompt: CAMBRIDGE_LIKE_PROMPT,
    options: { disableCache: true, modelId: 'stub-model' }
  });

  const tr51 = result.results.find((row) => row.baseKey === 'TR5-1');
  assert.ok(tr51);
  assert.equal(tr51.source, 'deterministic');
  assert.equal(tr51.value, 'Yes');
});

test('Non-regression: stable band-5+ deterministic paths stay plausible without prompt-echo penalties', () => {
  const ctx = {
    step1: { stats: { wordCount: 270 } },
    step2: {
      structure: {
        paragraphRoles: ['intro', 'body', 'body', 'conclusion'],
        paragraphSentenceCounts: [2, 3, 3, 2],
        hasIntro: true,
        hasConclusion: true,
        paragraphCount: 4
      },
      taskEcho: {
        wordOverlapRatio: 0.08,
        reusedPromptPhraseCount: 0,
        reusedPromptSentenceLikeCount: 0,
        copiedWordEstimate: 0,
        effectiveContentWordCount: 270,
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
      topicSentenceByParagraph: [
        { paragraphIndex: 0, topicSentenceIndex: 0 },
        { paragraphIndex: 1, topicSentenceIndex: 1 },
        { paragraphIndex: 2, topicSentenceIndex: 5 },
        { paragraphIndex: 3, topicSentenceIndex: 7 }
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
  assert.equal(scoringRules['TR6-2'](ctx), 'No');
  assert.equal(scoringRules['CC2-1A'](ctx), 'No');
});

