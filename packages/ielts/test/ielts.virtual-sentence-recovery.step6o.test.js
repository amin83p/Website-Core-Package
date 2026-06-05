const test = require('node:test');
const assert = require('node:assert/strict');

const essayPreprocessingService = require('../packages/ielts/MVC/services/ielts/essayPreprocessingService');
const essayAnalysisService = require('../packages/ielts/MVC/services/ielts/essayAnalysisService');
const { scoringRules } = require('../packages/ielts/MVC/services/ielts/scoringRules');

const RUN_ON_PROMPT = 'Some people think students should begin formal education very early, while others believe they should start later. Discuss both views and give your opinion.';

function buildRunOnEssay() {
  return [
    'Some people think students should begin formal education very early while others believe they should start later and this essay will discuss both views and give my opinion although the issue is complex for parents teachers and policy makers in different communities',
    'Firstly many parents support early schooling because children can follow routines from trained teachers and they learn how to manage time in shared classrooms for long days, for example they practise reading habits and respectful behaviour with classmates every day in supervised settings, Secondly parents also mention childcare pressure when both adults work full time and schools provide supervision as well as practical social skills',
    'On the other hand many families prefer a later start because very young children may feel anxious in formal lessons and can lose confidence early in crowded classes, Moreover some children develop language and self control more safely at home before joining large groups, Therefore a single fixed age may ignore developmental differences and local support conditions even when intentions are good',
    'In conclusion I partly agree with early schooling but I also think some children should begin later and rules should not force one age for everybody because readiness family context and emotional development are not identical across all households'
  ].join('\n\n');
}

function buildRunOnExtraction() {
  return {
    answersBySubquestion: {
      q1: [2],
      q2: [4]
    },
    position: {
      stance: 'partial',
      stanceSentenceIndex: 6,
      contradictionSentenceIndices: [3]
    },
    bodySupport: [
      { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [2, 3] },
      { paragraphIndex: 2, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [4] }
    ],
    topicSentenceByParagraph: [
      { paragraphIndex: 0, topicSentenceIndex: 0 },
      { paragraphIndex: 1, topicSentenceIndex: 1 },
      { paragraphIndex: 2, topicSentenceIndex: 4 },
      { paragraphIndex: 3, topicSentenceIndex: 7 }
    ]
  };
}

function buildCtx({ essayObj, step2, extraction }) {
  return {
    essay: essayObj,
    step1: { stats: essayObj.stats },
    step2,
    step25: extraction,
    taskPrompt: RUN_ON_PROMPT
  };
}

function buildCurrentParagraph({ essayObj, step2, extraction, paragraphIndex }) {
  return {
    paragraphIndex,
    paragraphNumber: paragraphIndex + 1,
    role: 'body',
    feature: step2.perParagraphFeatures[paragraphIndex],
    text: essayObj.paragraphs[paragraphIndex].text,
    sentences: essayObj.sentences.filter((s) => s.paragraphIndex === paragraphIndex),
    topicSentence: extraction.topicSentenceByParagraph.find((row) => row.paragraphIndex === paragraphIndex),
    bodySupport: extraction.bodySupport.find((row) => row.paragraphIndex === paragraphIndex)
  };
}

test('run-on recovery: sentence units increase and TR/CC do not collapse as if every paragraph were one sentence', () => {
  const essayObj = essayPreprocessingService.buildEssayObject(buildRunOnEssay());
  const step2 = essayAnalysisService.computeStep2Features(essayObj);
  const extraction = buildRunOnExtraction();
  const ctx = buildCtx({ essayObj, step2, extraction });

  assert.equal(essayObj.flags.baseSentenceCount, 4);
  assert.ok(essayObj.stats.sentenceCount > 4);
  assert.ok(step2.structure.virtualRecoveryApplied);
  assert.notDeepEqual(step2.structure.paragraphSentenceCounts, [1, 1, 1, 1]);
  assert.ok(step2.structure.paragraphVirtualSentenceCounts.some((count) => count >= 1));

  assert.equal(scoringRules['TR2-2'](ctx), 'No');
  assert.notEqual(scoringRules['TR4-6'](ctx), 'Yes');
  assert.notEqual(scoringRules['TR5-7'](ctx), 'Yes');
  assert.equal(scoringRules['CC2-1A'](ctx), 'No');

  const currentParagraph = buildCurrentParagraph({
    essayObj,
    step2,
    extraction,
    paragraphIndex: 1
  });
  const cc21b = scoringRules['CC2-1B']({ ...ctx, currentParagraph, paragraph: currentParagraph });
  assert.notEqual(cc21b, 'Yes');
});

test('genuine thin single-sentence body paragraph still triggers low-band organisational weakness', () => {
  const essayText = [
    'People disagree on school starting age.',
    'I mention one reason but I do not explain details.',
    'This is my conclusion.'
  ].join('\n\n');
  const essayObj = essayPreprocessingService.buildEssayObject(essayText);
  const step2 = essayAnalysisService.computeStep2Features(essayObj, { taskPrompt: RUN_ON_PROMPT });
  const extraction = {
    answersBySubquestion: { q1: [1], q2: [] },
    position: { stance: 'agree', stanceSentenceIndex: 0, contradictionSentenceIndices: [] },
    bodySupport: [
      { paragraphIndex: 1, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [] }
    ],
    topicSentenceByParagraph: [
      { paragraphIndex: 0, topicSentenceIndex: 0 },
      { paragraphIndex: 1, topicSentenceIndex: null },
      { paragraphIndex: 2, topicSentenceIndex: 2 }
    ]
  };
  const ctx = buildCtx({ essayObj, step2, extraction });

  assert.equal(step2.structure.virtualRecoveryApplied, false);
  assert.deepEqual(step2.structure.paragraphSentenceCounts, [1, 1, 1]);

  const currentParagraph = buildCurrentParagraph({
    essayObj,
    step2,
    extraction,
    paragraphIndex: 1
  });
  const cc21b = scoringRules['CC2-1B']({ ...ctx, currentParagraph, paragraph: currentParagraph });
  assert.equal(cc21b, 'Yes');
});

test('strong essay non-regression: virtual recovery remains off when punctuation is already clear', () => {
  const strongEssay = [
    'Many people debate school starting age. I believe early schooling can help most children.',
    'Early schools build routines and social confidence. For example, students can practise cooperation in class activities.',
    'Later starts can still benefit some children. However, this should be a tailored exception based on readiness evidence.',
    'In conclusion, early schooling is generally useful, but policies should stay flexible for individual needs.'
  ].join('\n\n');
  const essayObj = essayPreprocessingService.buildEssayObject(strongEssay);
  const step2 = essayAnalysisService.computeStep2Features(essayObj, { taskPrompt: RUN_ON_PROMPT });
  const extraction = {
    answersBySubquestion: { q1: [1, 2], q2: [4, 5] },
    position: { stance: 'agree', stanceSentenceIndex: 1, contradictionSentenceIndices: [] },
    bodySupport: [
      { paragraphIndex: 1, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [2, 3] },
      { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [4, 5] }
    ],
    topicSentenceByParagraph: [
      { paragraphIndex: 0, topicSentenceIndex: 0 },
      { paragraphIndex: 1, topicSentenceIndex: 2 },
      { paragraphIndex: 2, topicSentenceIndex: 4 },
      { paragraphIndex: 3, topicSentenceIndex: 6 }
    ]
  };
  const ctx = buildCtx({ essayObj, step2, extraction });

  assert.equal(step2.structure.virtualRecoveryApplied, false);
  assert.equal(step2.structure.recoveredSentenceDelta, 0);
  assert.notEqual(scoringRules['TR6-7'](ctx), 'Yes');
  assert.equal(scoringRules['CC2-1A'](ctx), 'No');
});

test('taskEcho compatibility: prompt-echo metrics still compute with virtual recovery enabled', () => {
  const essayObj = essayPreprocessingService.buildEssayObject(buildRunOnEssay());
  const step2 = essayAnalysisService.computeStep2Features(essayObj, { taskPrompt: RUN_ON_PROMPT });

  assert.equal(typeof step2.taskEcho.wordOverlapRatio, 'number');
  assert.equal(typeof step2.taskEcho.reusedPromptPhraseCount, 'number');
  assert.equal(typeof step2.taskEcho.effectiveContentWordCount, 'number');
  assert.ok(step2.taskEcho.effectiveContentWordCount <= essayObj.stats.wordCount);
});

test('evidence traceability: recovered sentence spans stay inspectable and map back to original text', () => {
  const essayObj = essayPreprocessingService.buildEssayObject(buildRunOnEssay());
  const virtualRows = essayObj.sentences.filter((row) => row?.meta?.virtualSplit);
  assert.ok(virtualRows.length >= 1);

  let previousEnd = -1;
  for (const sentence of essayObj.sentences) {
    assert.ok(sentence.startChar >= 0);
    assert.ok(sentence.endChar > sentence.startChar);
    assert.ok(sentence.startChar >= previousEnd);
    const rawSlice = essayObj.normalizedText.slice(sentence.startChar, sentence.endChar).trim();
    assert.equal(rawSlice, sentence.text);
    previousEnd = sentence.endChar;
  }
});

