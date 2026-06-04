const test = require('node:test');
const assert = require('node:assert/strict');

const aiService = require('../MVC/services/ielts/aiService');
const step3ScoringService = require('../MVC/services/ielts/step3ScoringService');
const { scoringRules } = require('../MVC/services/ielts/scoringRules');

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
        restorers.pop()();
      }
    }
  };
}

function buildEssayFixture() {
  return {
    normalizedText: 'A short essay for Step 4 reliability tests.',
    paragraphs: [
      { paragraphNumber: 1, text: 'A short essay for Step 4 reliability tests.' }
    ],
    sentences: [
      { index: 0, paragraphIndex: 0, paragraphNumber: 1, text: 'A short essay for Step 4 reliability tests.' }
    ],
    stats: {
      wordCount: 12,
      sentenceCount: 1,
      paragraphCount: 1,
      charCount: 45
    }
  };
}

function buildStep2Fixture() {
  return {
    structure: {
      paragraphRoles: ['intro'],
      paragraphSentenceCounts: [1],
      hasIntro: true,
      hasConclusion: false,
      paragraphCount: 1
    },
    perParagraphFeatures: [
      { paragraphIndex: 0, paragraphNumber: 1, role: 'intro', sentenceCount: 1 }
    ]
  };
}

function buildExtractionFixture() {
  return {
    answersBySubquestion: {},
    position: {
      stance: 'agree',
      stanceSentenceIndex: 0,
      contradictionSentenceIndices: []
    },
    topicSentenceByParagraph: [
      { paragraphIndex: 0, topicSentenceIndex: 0 }
    ],
    bodySupport: []
  };
}

function buildMicroAssessments(baseKey, overrides = {}) {
  const criterion = String(overrides?.criterion || 'TR');
  const answerType = String(overrides?.answer_type || overrides?.answerType || 'Boolean');
  const atomicQuestion = String(overrides?.atomic_question || overrides?.atomicQuestion || 'Is the task response relevant and developed?');
  const rubricAnchor = String(overrides?.rubric_anchor || overrides?.rubricAnchor || 'Band 4 baseline');
  const band = Number.isFinite(Number(overrides?.band)) ? Number(overrides.band) : 4;
  return [
    {
      baseKey,
      is_active: true,
      scope: 'essay',
      criterion,
      band,
      answer_type: answerType,
      scoredAnswers: ['Yes'],
      notScoredAnswers: ['No'],
      atomic_question: atomicQuestion,
      rubric_anchor: rubricAnchor
    }
  ];
}

function extractPromptIds(messages) {
  const prompt = String(messages?.[0]?.content || '');
  return Array.from(prompt.matchAll(/ID:\s*([^\r\n]+)/g))
    .map((match) => String(match?.[1] || '').trim())
    .filter(Boolean);
}

function buildAiJsonResponse(ids, value = 'Yes') {
  const payload = {};
  for (const id of ids) {
    payload[id] = { value, evidence: [0] };
  }
  return JSON.stringify(payload);
}

async function runStep3WithStub({
  baseKey,
  stubFactory,
  options = {},
  assessmentOverrides = {},
  extractionOverrides = {}
}) {
  const stack = createRestoreStack();
  const callLog = [];

  stack.stub(aiService, 'sendMessage', async (messages, modelId, config) => {
    const callContext = {
      messages,
      modelId,
      config: config || {},
      ids: extractPromptIds(messages)
    };
    callLog.push({
      modelId: String(modelId || '').trim(),
      providerId: String(config?.providerId || '').trim().toLowerCase(),
      apiProviderId: String(config?.apiProviderId || '').trim(),
      requestLabel: String(config?.requestLabel || '').trim()
    });
    return await stubFactory(callContext);
  });

  try {
    const result = await step3ScoringService.runStep3Scoring({
      essayObj: buildEssayFixture(),
      step2Features: buildStep2Fixture(),
      extraction: {
        ...buildExtractionFixture(),
        ...extractionOverrides
      },
      microAssessments: buildMicroAssessments(baseKey, assessmentOverrides),
      taskPrompt: 'Discuss both views and give your opinion.',
      options: {
        disableCache: true,
        concurrency: 1,
        modelId: 'primary-model',
        ...options
      }
    });
    return { result, callLog };
  } finally {
    stack.restoreAll();
  }
}

async function withTemporaryScoringRule(baseKey, ruleFn, run) {
  const key = String(baseKey || '').trim();
  const hadOwn = Object.prototype.hasOwnProperty.call(scoringRules, key);
  const previous = scoringRules[key];
  scoringRules[key] = ruleFn;
  try {
    return await run();
  } finally {
    if (hadOwn) scoringRules[key] = previous;
    else delete scoringRules[key];
  }
}

test('recoverable 429 failure retries and succeeds without ai_error rows', async () => {
  let callCount = 0;
  const { result, callLog } = await runStep3WithStub({
    baseKey: 'ZZ-AI-REL-RETRY',
    options: {
      step4RetryLimit: 2,
      step4RetryBackoffMs: 1,
      step4RetryBackoffMaxMs: 2
    },
    stubFactory: async ({ ids, modelId, config }) => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('429 Too Many Requests: quota exceeded for current key.');
      }
      return {
        text: buildAiJsonResponse(ids, 'Yes'),
        modelUsed: modelId || 'primary-model',
        usage: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
        requestMeta: { providerId: config?.providerId || 'google-gemini', modelUsed: modelId || 'primary-model' }
      };
    }
  });

  assert.ok(callLog.length >= 2, 'primary model should be retried after recoverable 429');
  const row = result.results.find((r) => r.baseKey === 'ZZ-AI-REL-RETRY');
  assert.ok(row);
  assert.equal(row.source, 'ai');
  assert.equal(row.value, 'Yes');
  assert.ok(Number(row.retryCount) >= 1);
  assert.equal(row.fallbackUsed, false);
  assert.equal(row.rescuedByRetry, true);
  assert.equal(row.failureClass, 'no_rule');
  assert.equal(Number(result?.meta?.telemetry?.aiReliability?.aiErrorRows || 0), 0);
  assert.ok(Number(result?.meta?.telemetry?.aiReliability?.retryAttempts || 0) >= 1);
  const failedTrace = (result?.meta?.aiRequestTrace || []).find((entry) => entry?.status === 'failed');
  assert.ok(failedTrace);
  assert.equal(failedTrace.failureClass, 'quota_exceeded');
});

test('repeated recoverable failures switch to fallback model/provider and rescue the row', async () => {
  const { result, callLog } = await runStep3WithStub({
    baseKey: 'ZZ-AI-REL-FALLBACK',
    options: {
      step4RetryLimit: 1,
      step4RetryBackoffMs: 1,
      step4RetryBackoffMaxMs: 2,
      step4FallbackRoutes: [
        { modelId: 'backup-model', providerId: 'openai' }
      ]
    },
    stubFactory: async ({ ids, modelId, config }) => {
      if (String(modelId) === 'primary-model') {
        throw new Error('429 Too Many Requests: quota exceeded for primary model.');
      }
      return {
        text: buildAiJsonResponse(ids, 'Yes'),
        modelUsed: modelId || 'backup-model',
        usage: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
        requestMeta: { providerId: config?.providerId || 'openai', modelUsed: modelId || 'backup-model' }
      };
    }
  });

  const primaryCalls = callLog.filter((entry) => entry.modelId === 'primary-model');
  const fallbackCalls = callLog.filter((entry) => entry.modelId === 'backup-model');
  assert.ok(primaryCalls.length >= 2, 'primary route should exhaust retries before fallback');
  assert.ok(fallbackCalls.length >= 1, 'fallback route should be used after recoverable primary failures');

  const row = result.results.find((r) => r.baseKey === 'ZZ-AI-REL-FALLBACK');
  assert.ok(row);
  assert.equal(row.source, 'ai');
  assert.equal(row.fallbackUsed, true);
  assert.equal(row.rescuedByFallback, true);
  assert.equal(String(row.modelRequested || ''), 'backup-model');
  assert.equal(String(row.providerUsed || ''), 'openai');
  assert.ok(Number(row.retryCount) >= 2);
  assert.equal(Number(result?.meta?.telemetry?.aiReliability?.aiErrorRows || 0), 0);
  assert.ok(Number(result?.meta?.telemetry?.aiReliability?.rescuedByFallbackRows || 0) >= 1);
});

test('recoverable parsing failure retries and can route to fallback before returning ai_error', async () => {
  const { result, callLog } = await runStep3WithStub({
    baseKey: 'ZZ-AI-REL-PARSE',
    options: {
      step4RetryLimit: 3,
      step4RetryBackoffMs: 1,
      step4RetryBackoffMaxMs: 2,
      step4FallbackRoutes: [
        { modelId: 'backup-model', providerId: 'openai' }
      ]
    },
    stubFactory: async ({ modelId, config }) => ({
      text: 'not-json-response',
      modelUsed: modelId || 'primary-model',
      usage: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
      requestMeta: { providerId: config?.providerId || 'google-gemini', modelUsed: modelId || 'primary-model' }
    })
  });

  const primaryCalls = callLog.filter((entry) => entry.modelId === 'primary-model');
  const fallbackCalls = callLog.filter((entry) => entry.modelId === 'backup-model');
  assert.ok(primaryCalls.length >= 2, 'parse failure should retry on primary route');
  assert.ok(fallbackCalls.length >= 1, 'parse failure should attempt fallback route after primary retries');
  const row = result.results.find((r) => r.baseKey === 'ZZ-AI-REL-PARSE');
  assert.ok(row);
  assert.equal(row.source, 'ai_error');
  assert.equal(row.failureClass, 'parsing_error');
  assert.ok(Number(row.retryCount || 0) >= 1);
  assert.equal(row.fallbackUsed, true);
  assert.equal(Number(result?.meta?.telemetry?.aiReliability?.aiErrorRows || 0), 1);
  assert.equal(Number(result?.meta?.telemetry?.aiReliability?.recoverableFailureRows || 0), 1);
  assert.equal(Number(result?.meta?.telemetry?.aiReliability?.nonRecoverableFailureRows || 0), 0);
  const failedTrace = (result?.meta?.aiRequestTrace || []).filter((entry) => entry?.status === 'failed');
  assert.ok(failedTrace.length >= 2);
  assert.ok(failedTrace.every((entry) => entry.failureClass === 'parsing_error'));
});

test('clean successful AI call keeps retry/fallback metadata at zero', async () => {
  const { result, callLog } = await runStep3WithStub({
    baseKey: 'ZZ-AI-REL-CLEAN',
    options: {
      step4RetryLimit: 2
    },
    stubFactory: async ({ ids, modelId, config }) => ({
      text: buildAiJsonResponse(ids, 'Yes'),
      modelUsed: modelId || 'primary-model',
      usage: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
      requestMeta: { providerId: config?.providerId || 'google-gemini', modelUsed: modelId || 'primary-model' }
    })
  });

  assert.equal(callLog.length, 1);
  const row = result.results.find((r) => r.baseKey === 'ZZ-AI-REL-CLEAN');
  assert.ok(row);
  assert.equal(row.source, 'ai');
  assert.equal(Number(row.retryCount || 0), 0);
  assert.equal(row.fallbackUsed, false);
  assert.equal(row.rescuedByRetry, false);
  assert.equal(row.rescuedByFallback, false);
  assert.equal(Number(result?.meta?.telemetry?.aiReliability?.aiErrorRows || 0), 0);
  assert.equal(Number(result?.meta?.telemetry?.aiReliability?.retryAttempts || 0), 0);
});

test('deterministic invalid value falls back to AI with explicit failure taxonomy', async () => {
  const baseKey = 'ZZ-AI-REL-INVALID-RULE-VALUE';
  const { result, callLog } = await withTemporaryScoringRule(
    baseKey,
    () => 'Maybe',
    async () => runStep3WithStub({
      baseKey,
      options: {
        step4RetryLimit: 0
      },
      stubFactory: async ({ ids, modelId, config }) => ({
        text: buildAiJsonResponse(ids, 'Yes'),
        modelUsed: modelId || 'primary-model',
        usage: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
        requestMeta: { providerId: config?.providerId || 'google-gemini', modelUsed: modelId || 'primary-model' }
      })
    })
  );

  assert.equal(callLog.length, 1, 'invalid deterministic value should route through AI once');
  const row = result.results.find((r) => r.baseKey === baseKey);
  assert.ok(row);
  assert.equal(row.source, 'ai');
  assert.equal(row.fallbackReason, 'rule_invalid_value');
  assert.equal(row.failureClass, 'deterministic_rule_invalid_value');
  assert.equal(String(row.deterministicRuleInvalidValue || '').toLowerCase(), 'maybe');
  assert.equal(
    Number(result?.meta?.telemetry?.aiCoverage?.fallbackReasonCounts?.rule_invalid_value || 0),
    1
  );
  assert.equal(
    Number(result?.meta?.telemetry?.aiCoverage?.fallbackReasonByBaseKey?.[baseKey]?.rule_invalid_value || 0),
    1
  );
});

test('deterministic low-confidence gate reroutes sensitive LR rows to AI when rich lexical evidence is missing', async () => {
  const baseKey = 'LR5-2';
  const { result, callLog } = await withTemporaryScoringRule(
    baseKey,
    () => 'Yes',
    async () => runStep3WithStub({
      baseKey,
      options: {
        step4RetryLimit: 0
      },
      assessmentOverrides: {
        criterion: 'LR',
        band: 5,
        atomic_question: 'Is lexical range limited?'
      },
      stubFactory: async ({ ids, modelId, config }) => {
        const payload = {};
        for (const id of ids) {
          payload[id] = { value: 'Yes', evidence: [0, 1] };
        }
        return {
          text: JSON.stringify(payload),
          modelUsed: modelId || 'primary-model',
          usage: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
          requestMeta: { providerId: config?.providerId || 'google-gemini', modelUsed: modelId || 'primary-model' }
        };
      }
    })
  );

  assert.equal(callLog.length, 1, 'low-confidence deterministic route should fall back to AI once');
  const row = result.results.find((r) => r.baseKey === baseKey);
  assert.ok(row);
  assert.equal(row.source, 'ai');
  assert.equal(row.fallbackReason, 'rule_low_confidence');
  assert.equal(row.failureClass, 'deterministic_rule_low_confidence');
  assert.equal(String(row.deterministicRuleLowConfidence || ''), 'lexical_rich_evidence_required');
  assert.equal(
    Number(result?.meta?.telemetry?.aiCoverage?.fallbackReasonCounts?.rule_low_confidence || 0),
    1
  );
  assert.equal(
    Number(result?.meta?.telemetry?.aiCoverage?.fallbackReasonByBaseKey?.[baseKey]?.rule_low_confidence || 0),
    1
  );
});

test('T5: LR6 deterministic rows with legacy-mapped lexical evidence route through low-confidence fallback', async () => {
  const baseKey = 'LR6-2';
  const { result, callLog } = await runStep3WithStub({
    baseKey,
    options: {
      step4RetryLimit: 0
    },
    assessmentOverrides: {
      criterion: 'LR',
      band: 6,
      atomic_question: 'Is uncommon lexical control missing?'
    },
    extractionOverrides: {
      lexicalQuality: {
        range: 'adequate',
        precision: 'low',
        uncommonSkill: 'none'
      },
      errorProfiles: {
        grammar: 'occasional',
        lexical: 'occasional',
        punctuation: 'occasional'
      }
    },
    stubFactory: async ({ ids, modelId, config }) => ({
      text: buildAiJsonResponse(ids, 'No'),
      modelUsed: modelId || 'primary-model',
      usage: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
      requestMeta: { providerId: config?.providerId || 'google-gemini', modelUsed: modelId || 'primary-model' }
    })
  });

  assert.equal(callLog.length, 1);
  const row = result.results.find((r) => r.baseKey === baseKey);
  assert.ok(row);
  assert.equal(row.source, 'ai');
  assert.equal(row.fallbackReason, 'rule_low_confidence');
  assert.equal(row.failureClass, 'deterministic_rule_low_confidence');
  assert.equal(String(row.deterministicRuleLowConfidence || ''), 'lexical_rich_evidence_required');
});

test('T5: GRA6 deterministic rows with legacy-mapped grammar evidence route through low-confidence fallback', async () => {
  const baseKey = 'GRA6-2';
  const { result, callLog } = await runStep3WithStub({
    baseKey,
    options: {
      step4RetryLimit: 0
    },
    assessmentOverrides: {
      criterion: 'GRA',
      band: 6,
      atomic_question: 'Are grammar errors present across the response?'
    },
    extractionOverrides: {
      errorProfiles: {
        grammar: 'occasional',
        lexical: 'rare',
        punctuation: 'occasional'
      }
    },
    stubFactory: async ({ ids, modelId, config }) => {
      const payload = {};
      for (const id of ids) {
        payload[id] = { value: 'Yes', evidence: [0, 1] };
      }
      return {
        text: JSON.stringify(payload),
        modelUsed: modelId || 'primary-model',
        usage: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
        requestMeta: { providerId: config?.providerId || 'google-gemini', modelUsed: modelId || 'primary-model' }
      };
    }
  });

  assert.equal(callLog.length, 1);
  const row = result.results.find((r) => r.baseKey === baseKey);
  assert.ok(row);
  assert.equal(row.source, 'ai');
  assert.equal(row.fallbackReason, 'rule_low_confidence');
  assert.equal(row.failureClass, 'deterministic_rule_low_confidence');
  assert.equal(String(row.deterministicRuleLowConfidence || ''), 'grammar_rich_evidence_required');
});

test('T6: LR7 deterministic rows with legacy-mapped lexical evidence route through low-confidence fallback', async () => {
  const baseKey = 'LR7-1';
  const { result, callLog } = await runStep3WithStub({
    baseKey,
    options: {
      step4RetryLimit: 0
    },
    assessmentOverrides: {
      criterion: 'LR',
      band: 7,
      atomic_question: 'Does the script show sufficient lexical range and precision?'
    },
    extractionOverrides: {
      lexicalQuality: {
        range: 'wide',
        precision: 'high',
        uncommonSkill: 'some'
      },
      errorProfiles: {
        grammar: 'occasional',
        lexical: 'occasional',
        punctuation: 'occasional'
      }
    },
    stubFactory: async ({ ids, modelId, config }) => ({
      text: buildAiJsonResponse(ids, 'No'),
      modelUsed: modelId || 'primary-model',
      usage: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
      requestMeta: { providerId: config?.providerId || 'google-gemini', modelUsed: modelId || 'primary-model' }
    })
  });

  assert.equal(callLog.length, 1);
  const row = result.results.find((r) => r.baseKey === baseKey);
  assert.ok(row);
  assert.equal(row.source, 'ai');
  assert.equal(row.fallbackReason, 'rule_low_confidence');
  assert.equal(row.failureClass, 'deterministic_rule_low_confidence');
  assert.equal(String(row.deterministicRuleLowConfidence || ''), 'lexical_rich_evidence_required');
});

test('T6: GRA7 deterministic rows with legacy-mapped grammar evidence route through low-confidence fallback', async () => {
  const baseKey = 'GRA7-1';
  const { result, callLog } = await runStep3WithStub({
    baseKey,
    options: {
      step4RetryLimit: 0
    },
    assessmentOverrides: {
      criterion: 'GRA',
      band: 7,
      atomic_question: 'Does the script maintain strong grammatical control across complex structures?'
    },
    extractionOverrides: {
      errorProfiles: {
        grammar: 'rare',
        lexical: 'rare',
        punctuation: 'rare'
      }
    },
    stubFactory: async ({ ids, modelId, config }) => ({
      text: buildAiJsonResponse(ids, 'No'),
      modelUsed: modelId || 'primary-model',
      usage: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
      requestMeta: { providerId: config?.providerId || 'google-gemini', modelUsed: modelId || 'primary-model' }
    })
  });

  assert.equal(callLog.length, 1);
  const row = result.results.find((r) => r.baseKey === baseKey);
  assert.ok(row);
  assert.equal(row.source, 'ai');
  assert.equal(row.fallbackReason, 'rule_low_confidence');
  assert.equal(row.failureClass, 'deterministic_rule_low_confidence');
  assert.equal(String(row.deterministicRuleLowConfidence || ''), 'grammar_rich_evidence_required');
});

test('T7: LR8 deterministic rows with legacy-mapped lexical evidence route through low-confidence fallback', async () => {
  const baseKey = 'LR8-1';
  const { result, callLog } = await runStep3WithStub({
    baseKey,
    options: {
      step4RetryLimit: 0
    },
    assessmentOverrides: {
      criterion: 'LR',
      band: 8,
      atomic_question: 'Does the script show strong flexible lexical resource?'
    },
    extractionOverrides: {
      lexicalQuality: {
        range: 'wide',
        precision: 'high',
        uncommonSkill: 'skilful'
      },
      errorProfiles: {
        grammar: 'rare',
        lexical: 'occasional',
        punctuation: 'rare'
      }
    },
    stubFactory: async ({ ids, modelId, config }) => ({
      text: buildAiJsonResponse(ids, 'No'),
      modelUsed: modelId || 'primary-model',
      usage: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
      requestMeta: { providerId: config?.providerId || 'google-gemini', modelUsed: modelId || 'primary-model' }
    })
  });

  assert.equal(callLog.length, 1);
  const row = result.results.find((r) => r.baseKey === baseKey);
  assert.ok(row);
  assert.equal(row.source, 'ai');
  assert.equal(row.fallbackReason, 'rule_low_confidence');
  assert.equal(row.failureClass, 'deterministic_rule_low_confidence');
  assert.equal(String(row.deterministicRuleLowConfidence || ''), 'lexical_rich_evidence_required');
});

test('T7: GRA8 deterministic rows with legacy-mapped grammar evidence route through low-confidence fallback', async () => {
  const baseKey = 'GRA8-2';
  const { result, callLog } = await runStep3WithStub({
    baseKey,
    options: {
      step4RetryLimit: 0
    },
    assessmentOverrides: {
      criterion: 'GRA',
      band: 8,
      atomic_question: 'Are most sentences error-free with strong grammatical control?'
    },
    extractionOverrides: {
      errorProfiles: {
        grammar: 'rare',
        lexical: 'rare',
        punctuation: 'rare'
      }
    },
    stubFactory: async ({ ids, modelId, config }) => ({
      text: buildAiJsonResponse(ids, 'No'),
      modelUsed: modelId || 'primary-model',
      usage: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
      requestMeta: { providerId: config?.providerId || 'google-gemini', modelUsed: modelId || 'primary-model' }
    })
  });

  assert.equal(callLog.length, 1);
  const row = result.results.find((r) => r.baseKey === baseKey);
  assert.ok(row);
  assert.equal(row.source, 'ai');
  assert.equal(row.fallbackReason, 'rule_low_confidence');
  assert.equal(row.failureClass, 'deterministic_rule_low_confidence');
  assert.equal(String(row.deterministicRuleLowConfidence || ''), 'grammar_rich_evidence_required');
});

test('T8: LR9 deterministic rows with legacy-mapped lexical evidence route through low-confidence fallback', async () => {
  const baseKey = 'LR9-1';
  const { result, callLog } = await runStep3WithStub({
    baseKey,
    options: {
      step4RetryLimit: 0
    },
    assessmentOverrides: {
      criterion: 'LR',
      band: 9,
      atomic_question: 'Is lexical control at near-flawless high-band level?'
    },
    extractionOverrides: {
      lexicalQuality: {
        range: 'wide',
        precision: 'high',
        uncommonSkill: 'skilful'
      },
      errorProfiles: {
        grammar: 'rare',
        lexical: 'rare',
        punctuation: 'rare'
      }
    },
    stubFactory: async ({ ids, modelId, config }) => ({
      text: buildAiJsonResponse(ids, 'No'),
      modelUsed: modelId || 'primary-model',
      usage: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
      requestMeta: { providerId: config?.providerId || 'google-gemini', modelUsed: modelId || 'primary-model' }
    })
  });

  assert.equal(callLog.length, 1);
  const row = result.results.find((r) => r.baseKey === baseKey);
  assert.ok(row);
  assert.equal(row.source, 'ai');
  assert.equal(row.fallbackReason, 'rule_low_confidence');
  assert.equal(row.failureClass, 'deterministic_rule_low_confidence');
  assert.equal(String(row.deterministicRuleLowConfidence || ''), 'lexical_rich_evidence_required');
});

test('T8: GRA9 deterministic rows with legacy-mapped grammar evidence route through low-confidence fallback', async () => {
  const baseKey = 'GRA9-1';
  const { result, callLog } = await runStep3WithStub({
    baseKey,
    options: {
      step4RetryLimit: 0
    },
    assessmentOverrides: {
      criterion: 'GRA',
      band: 9,
      atomic_question: 'Is grammatical control at full flexible high-band level?'
    },
    extractionOverrides: {
      errorProfiles: {
        grammar: 'rare',
        lexical: 'rare',
        punctuation: 'rare'
      }
    },
    stubFactory: async ({ ids, modelId, config }) => ({
      text: buildAiJsonResponse(ids, 'No'),
      modelUsed: modelId || 'primary-model',
      usage: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
      requestMeta: { providerId: config?.providerId || 'google-gemini', modelUsed: modelId || 'primary-model' }
    })
  });

  assert.equal(callLog.length, 1);
  const row = result.results.find((r) => r.baseKey === baseKey);
  assert.ok(row);
  assert.equal(row.source, 'ai');
  assert.equal(row.fallbackReason, 'rule_low_confidence');
  assert.equal(row.failureClass, 'deterministic_rule_low_confidence');
  assert.equal(String(row.deterministicRuleLowConfidence || ''), 'grammar_rich_evidence_required');
});

test('T9: telemetry reporting exposes criterion/scope fallback breakdown and routing summary', async () => {
  const baseKey = 'LR9-1';
  const { result } = await runStep3WithStub({
    baseKey,
    options: {
      step4RetryLimit: 0
    },
    assessmentOverrides: {
      criterion: 'LR',
      band: 9,
      atomic_question: 'Is lexical control at near-flawless high-band level?'
    },
    extractionOverrides: {
      lexicalQuality: {
        range: 'wide',
        precision: 'high',
        uncommonSkill: 'skilful'
      },
      errorProfiles: {
        grammar: 'rare',
        lexical: 'rare',
        punctuation: 'rare'
      }
    },
    stubFactory: async ({ ids, modelId, config }) => ({
      text: buildAiJsonResponse(ids, 'No'),
      modelUsed: modelId || 'primary-model',
      usage: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
      requestMeta: { providerId: config?.providerId || 'google-gemini', modelUsed: modelId || 'primary-model' }
    })
  });

  const telemetry = result?.meta?.telemetry || {};
  assert.equal(
    Number(telemetry?.aiCoverage?.fallbackReasonByCriterion?.LR?.rule_low_confidence || 0),
    1
  );
  assert.equal(
    Number(telemetry?.aiCoverage?.fallbackReasonByScope?.essay?.rule_low_confidence || 0),
    1
  );

  const routing = telemetry?.reporting?.routingSummary || {};
  assert.equal(Number(routing?.totalAssessmentInstances || 0), 1);
  assert.equal(Number(routing?.aiRoutedRows || 0), 1);
  assert.equal(Number(routing?.deterministicRows || 0), 0);
  assert.equal(Number(routing?.aiRouteRatePct || 0), 100);

  const reasonRows = Array.isArray(routing?.fallbackReasonRows) ? routing.fallbackReasonRows : [];
  assert.ok(reasonRows.length >= 1);
  assert.equal(String(reasonRows[0]?.reason || ''), 'rule_low_confidence');
  assert.equal(Number(reasonRows[0]?.count || 0), 1);
});

test('T10: deterministic rule trace instrumentation exposes helper eligibility for TR7-1/LR6-2/GRA7-2', async () => {
  const scenarios = [
    {
      baseKey: 'TR7-1',
      assessmentOverrides: {
        criterion: 'TR',
        band: 7,
        atomic_question: 'Does the response fully address the task?'
      },
      extractionOverrides: {
        answersBySubquestion: { q1: [0] },
        position: { stance: 'agree', stanceSentenceIndex: 0, contradictionSentenceIndices: [] }
      }
    },
    {
      baseKey: 'LR6-2',
      assessmentOverrides: {
        criterion: 'LR',
        band: 6,
        atomic_question: 'Is lexical control at least adequate?'
      },
      extractionOverrides: {
        answersBySubquestion: { q1: [0] },
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
    },
    {
      baseKey: 'GRA7-2',
      assessmentOverrides: {
        criterion: 'GRA',
        band: 7,
        atomic_question: 'Is control of grammar broadly secure?'
      },
      extractionOverrides: {
        answersBySubquestion: { q1: [0] },
        grammarControl: {
          structureRange: 'mixed',
          complexSentenceControl: 'weak',
          errorFrequency: 'occasional',
          subjectVerbAgreement: 'mixed',
          articleControl: 'mixed',
          prepositionControl: 'mixed',
          punctuationControl: 'mixed',
          sentenceBoundaryControl: 'mixed',
          clarityImpactFromGrammar: 'minor',
          errorFreeSentenceShareBand: 'low'
        }
      }
    }
  ];

  for (const scenario of scenarios) {
    const { result, callLog } = await runStep3WithStub({
      baseKey: scenario.baseKey,
      options: { step4RetryLimit: 0 },
      assessmentOverrides: scenario.assessmentOverrides,
      extractionOverrides: scenario.extractionOverrides,
      stubFactory: async ({ ids, modelId, config }) => ({
        text: buildAiJsonResponse(ids, 'No'),
        modelUsed: modelId || 'primary-model',
        usage: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
        requestMeta: { providerId: config?.providerId || 'google-gemini', modelUsed: modelId || 'primary-model' }
      })
    });

    assert.equal(callLog.length, 0, `${scenario.baseKey} should resolve deterministically in this diagnostic fixture`);
    const row = result.results.find((r) => r.baseKey === scenario.baseKey);
    assert.ok(row, `${scenario.baseKey} row should exist`);
    assert.equal(row.source, 'deterministic');
    assert.equal(row.fallbackReason, null);
    assert.ok(row.deterministicRuleTrace, `${scenario.baseKey} should include deterministicRuleTrace`);
    assert.equal(String(row?.deterministicRuleTrace?.baseKey || ''), scenario.baseKey);
    assert.equal(typeof row?.deterministicRuleTrace?.patchGroup?.enabled, 'boolean');
    assert.ok(
      row?.deterministicRuleTrace?.diagnostics?.helperProfiles?.singlePartCoverageThinBoundaryRescue,
      `${scenario.baseKey} should expose thin-boundary helper diagnostics`
    );

    const byBaseKey = result?.meta?.telemetry?.deterministicRuleTraceByBaseKey?.[scenario.baseKey];
    assert.ok(byBaseKey, `${scenario.baseKey} should be reported in telemetry deterministicRuleTraceByBaseKey`);
    assert.ok(Number(byBaseKey?.rows || 0) >= 1);
  }
});
