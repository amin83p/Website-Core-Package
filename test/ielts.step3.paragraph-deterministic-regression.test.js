const test = require('node:test');
const assert = require('node:assert/strict');

const step3ScoringService = require('../packages/ielts/MVC/services/ielts/step3ScoringService');
const aiService = require('../packages/ielts/MVC/services/ielts/aiService');

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

function buildFixtureEssay() {
  return {
    paragraphs: [
      { paragraphNumber: 1, text: 'Nowadays many people discuss this issue.' },
      { paragraphNumber: 2, text: 'First, there are benefits for students. They can learn efficiently.' },
      { paragraphNumber: 3, text: 'Second, there are drawbacks in some contexts. Careful planning is needed.' }
    ],
    sentences: [
      { index: 0, paragraphIndex: 0, paragraphNumber: 1, text: 'Nowadays many people discuss this issue.' },
      { index: 1, paragraphIndex: 1, paragraphNumber: 2, text: 'First, there are benefits for students.' },
      { index: 2, paragraphIndex: 1, paragraphNumber: 2, text: 'They can learn efficiently.' },
      { index: 3, paragraphIndex: 2, paragraphNumber: 3, text: 'Second, there are drawbacks in some contexts.' },
      { index: 4, paragraphIndex: 2, paragraphNumber: 3, text: 'Careful planning is needed.' }
    ],
    stats: {
      wordCount: 180,
      sentenceCount: 5,
      paragraphCount: 3,
      charCount: 420
    }
  };
}

function buildFixtureStep2() {
  return {
    structure: {
      paragraphRoles: ['intro', 'body', 'body'],
      paragraphSentenceCounts: [1, 2, 2],
      hasIntro: true,
      hasConclusion: false,
      paragraphCount: 3
    },
    perParagraphFeatures: [
      { paragraphIndex: 0, paragraphNumber: 1, role: 'intro', sentenceCount: 1 },
      { paragraphIndex: 1, paragraphNumber: 2, role: 'body', sentenceCount: 2 },
      { paragraphIndex: 2, paragraphNumber: 3, role: 'body', sentenceCount: 2 }
    ],
    cohesion: { densityPer100: '3.40' },
    lexical: { topRepeatedWords: [] }
  };
}

function buildFixtureExtraction() {
  return {
    answersBySubquestion: {
      q1: [1],
      q2: [3]
    },
    position: {
      stance: 'agree',
      stanceSentenceIndex: 0,
      contradictionSentenceIndices: []
    },
    topicSentenceByParagraph: [
      { paragraphIndex: 1, topicSentenceIndex: 1 },
      { paragraphIndex: 2, topicSentenceIndex: 3 }
    ],
    bodySupport: [
      { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [1, 2] },
      { paragraphIndex: 2, hasExplanation: true, hasExample: true, evidenceSentenceIndices: [3, 4] }
    ]
  };
}

function createPromptAwareAiStub(calls) {
  return async (messages, modelId) => {
    const prompt = String(messages?.[0]?.content || '');
    const ids = Array.from(prompt.matchAll(/ID:\s*([^\r\n]+)/g)).map((m) => String(m[1] || '').trim());
    const payload = {};

    for (const id of ids) {
      if (id.startsWith('CC6-3::')) {
        payload[id] = { value: 'No', evidence: [0] };
      } else {
        payload[id] = { value: 'Yes', evidence: [1] };
      }
    }

    calls.push({ modelId, ids });
    return {
      text: JSON.stringify(payload),
      modelUsed: modelId || 'stub-model',
      usage: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
      requestMeta: { provider: 'stub', providerId: 'stub', modelId: modelId || 'stub-model' }
    };
  };
}

function findRowsByBase(results, baseKey) {
  return (results || []).filter((row) => row.baseKey === baseKey);
}

test('step3 scoring allows paragraph deterministic rules and preserves paragraph aggregation/fallback behavior', async () => {
  const stack = createRestoreStack();
  const aiCalls = [];
  stack.stub(aiService, 'sendMessage', createPromptAwareAiStub(aiCalls));

  const essayObj = buildFixtureEssay();
  const step2Features = buildFixtureStep2();
  const extraction = buildFixtureExtraction();

  const microAssessments = [
    {
      baseKey: 'TR5-3',
      is_active: true,
      scope: 'essay',
      criterion: 'TR',
      band: 5,
      answer_type: 'boolean',
      atomic_question: 'Is there an explicit position statement?',
      rubric_anchor: 'Position is clearly stated.'
    },
    {
      baseKey: 'CC6-5',
      is_active: true,
      scope: 'paragraph',
      paragraphRoleConstraint: 'any',
      criterion: 'CC',
      band: 6,
      answer_type: 'boolean',
      atomic_question: 'Are paragraphing choices problematic?',
      rubric_anchor: 'Paragraphing is logically organized.'
    },
    {
      baseKey: 'ZZ-P-AI',
      is_active: true,
      scope: 'paragraph',
      paragraphRoleConstraint: 'any',
      criterion: 'CC',
      band: 7,
      answer_type: 'boolean',
      atomic_question: 'Custom paragraph check with no deterministic rule.',
      rubric_anchor: 'Custom check.'
    },
    {
      baseKey: 'CC6-3',
      is_active: true,
      scope: 'paragraph',
      paragraphRoleConstraint: 'any',
      criterion: 'CC',
      band: 6,
      answer_type: 'boolean',
      atomic_question: 'Does the essay include intro and conclusion structure?',
      rubric_anchor: 'Intro + conclusion present.'
    }
  ];

  try {
    const scored = await step3ScoringService.runStep3Scoring({
      essayObj,
      step2Features,
      extraction,
      microAssessments,
      taskPrompt: 'Some people think technology improves education. Discuss both views and give your opinion.',
      options: {
        modelId: 'stub-model',
        disableCache: true
      }
    });

    // Essay deterministic item remains deterministic and keeps normalization.
    const tr53 = findRowsByBase(scored.results, 'TR5-3');
    assert.equal(tr53.length, 1);
    assert.equal(tr53[0].source, 'deterministic');
    assert.equal(tr53[0].value, 'Yes');

    // Paragraph deterministic item now executes deterministically (was previously blocked).
    const cc65 = findRowsByBase(scored.results, 'CC6-5');
    assert.equal(cc65.length, 3);
    assert.ok(cc65.every((row) => row.scope === 'paragraph'));
    assert.ok(cc65.every((row) => row.source === 'deterministic'));

    // Paragraph item without rule still goes to AI.
    const paragraphAi = findRowsByBase(scored.results, 'ZZ-P-AI');
    assert.equal(paragraphAi.length, 3);
    assert.ok(paragraphAi.every((row) => String(row.source || '').startsWith('ai')));

    // Paragraph item with a rule that returns null still falls back to AI.
    const paragraphNullFallback = findRowsByBase(scored.results, 'CC6-3');
    assert.equal(paragraphNullFallback.length, 3);
    assert.ok(paragraphNullFallback.every((row) => String(row.source || '').startsWith('ai')));
    assert.ok(paragraphNullFallback.every((row) => row.scope === 'paragraph'));

    // Aggregation still creates essay-level row from paragraph instances.
    const cc65Agg = findRowsByBase(scored.aggregatedResults, 'CC6-5');
    assert.equal(cc65Agg.length, 1);
    assert.equal(cc65Agg[0].scope, 'essay');
    assert.equal(cc65Agg[0].source, 'aggregate');

    // Raw instance storage remains intact.
    assert.ok(scored.results.some((row) => row.instanceKey === 'CC6-5::P2'));

    // AI was used only for fallback/no-rule paragraph items.
    assert.ok(aiCalls.length >= 1);
  } finally {
    stack.restoreAll();
  }
});

test('step3 operationalized_only filtering still works with mixed eligibility', async () => {
  const stack = createRestoreStack();
  let aiCallCount = 0;
  stack.stub(aiService, 'sendMessage', async () => {
    aiCallCount += 1;
    return {
      text: '{}',
      modelUsed: 'stub-model',
      usage: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
      requestMeta: { provider: 'stub', providerId: 'stub', modelId: 'stub-model' }
    };
  });

  try {
    const scored = await step3ScoringService.runStep3Scoring({
      essayObj: buildFixtureEssay(),
      step2Features: buildFixtureStep2(),
      extraction: buildFixtureExtraction(),
      microAssessments: [
        {
          baseKey: 'TR6-1',
          is_active: true,
          scope: 'essay',
          criterion: 'TR',
          band: 6,
          answer_type: 'boolean',
          operationalizedOnlyEligible: true
        },
        {
          baseKey: 'ZZ-NON-OP',
          is_active: true,
          scope: 'essay',
          criterion: 'TR',
          band: 6,
          answer_type: 'boolean',
          operationalizedOnlyEligible: false
        }
      ],
      taskPrompt: 'Task prompt',
      options: {
        modelId: 'stub-model',
        disableCache: true,
        mode: 'operationalized_only'
      }
    });

    assert.equal(scored.meta.runMode, 'operationalized_only');
    assert.equal(scored.meta.totalQuestions, 1);
    assert.equal(scored.meta.totalBaseItems, 1);
    assert.equal(scored.meta.skippedNonOperationalized, 1);
    assert.equal(scored.meta.deterministicCount, 1);
    assert.equal(scored.meta.aiCount, 0);
    assert.equal(aiCallCount, 0);
    assert.ok(scored.results.every((row) => row.baseKey === 'TR6-1'));
  } finally {
    stack.restoreAll();
  }
});

