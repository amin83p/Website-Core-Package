const test = require('node:test');
const assert = require('node:assert/strict');

const aiService = require('../packages/ielts/MVC/services/ielts/aiService');
const step3ScoringService = require('../packages/ielts/MVC/services/ielts/step3ScoringService');
const calibrationEvaluationService = require('../packages/ielts/MVC/services/ielts/calibrationEvaluationService');

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
    normalizedText: 'This response is weak and repetitive with limited clarity.',
    paragraphs: [
      { paragraphNumber: 1, text: 'This response is weak and repetitive.' },
      { paragraphNumber: 2, text: 'It has limited clarity and support.' }
    ],
    sentences: [
      { index: 0, paragraphIndex: 0, paragraphNumber: 1, text: 'This response is weak and repetitive.' },
      { index: 1, paragraphIndex: 1, paragraphNumber: 2, text: 'It has limited clarity and support.' },
      { index: 2, paragraphIndex: 1, paragraphNumber: 2, text: 'Evidence is not developed.' }
    ],
    stats: {
      wordCount: 110,
      sentenceCount: 3,
      paragraphCount: 2,
      charCount: 140
    }
  };
}

function buildStep2Fixture() {
  return {
    structure: {
      paragraphRoles: ['intro', 'body'],
      paragraphSentenceCounts: [1, 2],
      hasIntro: true,
      hasConclusion: false,
      paragraphCount: 2
    },
    perParagraphFeatures: [
      { paragraphIndex: 0, paragraphNumber: 1, role: 'intro', sentenceCount: 1 },
      { paragraphIndex: 1, paragraphNumber: 2, role: 'body', sentenceCount: 2 }
    ],
    lexical: {
      topRepeatedWords: [{ word: 'response', count: 5 }]
    },
    cohesion: {
      densityPer100: '1.80'
    }
  };
}

function buildExtractionFixture() {
  return {
    answersBySubquestion: {
      q1: [1]
    },
    position: {
      stance: null,
      stanceSentenceIndex: null,
      contradictionSentenceIndices: []
    },
    topicSentenceByParagraph: [
      { paragraphIndex: 1, topicSentenceIndex: null }
    ],
    bodySupport: [
      { paragraphIndex: 1, hasExplanation: false, hasExample: false, evidenceSentenceIndices: [1] }
    ]
  };
}

function buildMicroAssessmentFixture() {
  return [
    {
      baseKey: 'TR3-2',
      is_active: true,
      scope: 'essay',
      criterion: 'TR',
      band: 3,
      answer_type: 'Boolean',
      polarity: 'FAULT_CHECK',
      atomic_question: 'Is there no clear position expressed?',
      rubric_anchor: 'Band 3 position threshold'
    },
    {
      baseKey: 'TR4-1',
      is_active: true,
      scope: 'essay',
      criterion: 'TR',
      band: 4,
      answer_type: 'Boolean',
      polarity: 'FAULT_CHECK',
      atomic_question: 'Does the response fail to fully address the prompt?',
      rubric_anchor: 'Band 4 task response threshold'
    },
    {
      baseKey: 'ZZ-LB-AI',
      is_active: true,
      scope: 'paragraph',
      paragraphRoleConstraint: 'any',
      criterion: 'CC',
      band: 3,
      answer_type: 'Boolean',
      polarity: 'FAULT_CHECK',
      atomic_question: 'Is cohesion weak in this paragraph?',
      rubric_anchor: 'Band 3 cohesion threshold'
    },
    {
      baseKey: 'LR3-AI',
      is_active: true,
      scope: 'essay',
      criterion: 'LR',
      band: 3,
      answer_type: 'Boolean',
      polarity: 'FAULT_CHECK',
      atomic_question: 'Is lexical range very limited?',
      rubric_anchor: 'Band 3 lexical threshold'
    }
  ];
}

function createAiStub() {
  return async (messages, modelId) => {
    const prompt = String(messages?.[0]?.content || '');
    const ids = Array.from(prompt.matchAll(/ID:\s*([^\r\n]+)/g)).map((m) => String(m[1] || '').trim());
    const payload = {};
    for (const id of ids) {
      if (id.startsWith('ZZ-LB-AI::')) payload[id] = { value: 'Yes', evidence: [1] };
      else if (id === 'LR3-AI') payload[id] = { value: 'Yes', evidence: [1] };
      else if (id === 'TR4-1') payload[id] = { value: 'No', evidence: [] };
      else payload[id] = { value: 'No', evidence: [] };
    }
    return {
      text: JSON.stringify(payload),
      modelUsed: modelId || 'stub-model',
      usage: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
      requestMeta: { provider: 'stub', providerId: 'stub', modelId: modelId || 'stub-model' }
    };
  };
}

test('step3 emits source telemetry, sparse-band gate trace, and paragraph contribution coverage without scoring regression', async () => {
  const stack = createRestoreStack();
  stack.stub(aiService, 'sendMessage', createAiStub());

  try {
    const result = await step3ScoringService.runStep3Scoring({
      essayObj: buildEssayFixture(),
      step2Features: buildStep2Fixture(),
      extraction: buildExtractionFixture(),
      microAssessments: buildMicroAssessmentFixture(),
      taskPrompt: 'Discuss both views and give your opinion.',
      options: {
        modelId: 'stub-model',
        disableCache: true
      }
    });

    assert.equal(typeof result.overallBand, 'number');
    assert.equal(typeof result.scores?.TR, 'number');
    assert.ok(Array.isArray(result.results));
    assert.ok(Array.isArray(result.aggregatedResults));

    const telemetry = result?.meta?.telemetry;
    assert.ok(telemetry);
    assert.ok(Number(telemetry?.sourceCounts?.deterministic) >= 1);
    assert.ok(Number(telemetry?.sourceCounts?.ai) >= 1);
    assert.ok(Number(telemetry?.sourceCounts?.aggregate) >= 1);
    assert.ok(Number(telemetry?.paragraph?.aiRows) >= 1);
    assert.ok(Number(telemetry?.lowBand?.aiFallbackNoRule) >= 1);

    const lowBandCoverage = result?.meta?.lowBandCoverage;
    assert.ok(lowBandCoverage);
    assert.ok(Array.isArray(lowBandCoverage?.paragraphContributions));
    assert.ok(lowBandCoverage.paragraphContributions.length >= 1);

    const gateTrace = result?.meta?.gateTrace;
    assert.ok(gateTrace?.TR);
    assert.deepEqual(gateTrace.TR.availableBandGates, [3, 4]);
    assert.equal(gateTrace.TR.resultingCriterionScore, result.scores.TR);
    assert.ok(Array.isArray(gateTrace.TR.evaluatedGates));
    assert.ok(gateTrace.TR.evaluatedGates.length >= 2);
  } finally {
    stack.restoreAll();
  }
});

test('calibration report computes low-band subset metrics and safely handles missing criterion references', () => {
  const records = [
    {
      id: 'r1',
      sampleId: 's1',
      sampleName: 'Weak Essay',
      savedAt: '2026-04-11T10:00:00.000Z',
      predictedOverall: 3.5,
      predictedCriteria: { TR: 3.5, CC: 3, LR: 4, GRA: 3.5 },
      referenceOverall: 4,
      referenceCriteria: { TR: 4, CC: 4 },
      telemetry: {
        sourceCounts: { deterministic: 8, ai: 4, aggregate: 2 },
        paragraph: { totalRows: 4, deterministicRows: 0, aiRows: 4 },
        lowBand: {
          totalRows: 7,
          rowsByCriterion: { TR: 2, CC: 3, LR: 1, GRA: 1, General: 0 },
          aiFallbackNoRule: 3,
          aiFallbackRuleReturnedNull: 1,
          aiFallbackRuleError: 0,
          errorRows: 0
        }
      },
      weaknessPatternKeys: ['TR:TR3-2', 'CC:ZZ-LB-AI', 'TR:TR3-2']
    },
    {
      id: 'r2',
      sampleId: 's2',
      sampleName: 'Stronger Essay',
      savedAt: '2026-04-11T10:10:00.000Z',
      predictedOverall: 6,
      predictedCriteria: { TR: 6, CC: 6, LR: 6, GRA: 6 },
      referenceOverall: 6,
      referenceCriteria: null,
      telemetry: {
        sourceCounts: { deterministic: 9, ai: 2, aggregate: 1 },
        paragraph: { totalRows: 2, deterministicRows: 1, aiRows: 1 },
        lowBand: {
          totalRows: 1,
          rowsByCriterion: { TR: 0, CC: 0, LR: 1, GRA: 0, General: 0 },
          aiFallbackNoRule: 1,
          aiFallbackRuleReturnedNull: 0,
          aiFallbackRuleError: 0,
          errorRows: 0
        }
      },
      weaknessPatternKeys: ['LR:LR3-AI']
    }
  ];

  const report = calibrationEvaluationService.buildCalibrationReport(records, {
    scoringVersion: 'scoringV0326',
    promptSourceSummary: 'step4:builtin',
    stabilityMetrics: { repeatedRunMeanAgreement: 0.87 }
  });

  assert.equal(report.schema, 'ielts-calibration-report');
  assert.equal(report.sampleCount, 2);
  assert.equal(report.comparedSampleCount, 2);
  assert.equal(report.metrics.overall.sampleCount, 2);
  assert.equal(report.metrics.lowBandSubset.sampleCount, 1);
  assert.equal(report.metrics.confusionByBandBucket.comparedCount, 2);

  assert.ok(report.metrics.criterionDelta.TR);
  assert.equal(report.metrics.criterionDelta.TR.sampleCount, 1);
  assert.equal(report.metrics.criterionDelta.LR, null);
  assert.equal(report.metrics.criterionDelta.GRA, null);

  assert.ok(report.telemetry);
  assert.equal(report.telemetry.runCount, 2);
  assert.ok(report.tweakLogSummary);
  assert.equal(report.tweakLogSummary.essaysEvaluated, 2);
  assert.ok(Array.isArray(report.tweakLogSummary.topRecurringFailurePatterns));
  assert.ok(report.tweakLogSummary.topRecurringFailurePatterns.length >= 1);
});

test('benchmark-style session extraction builds comparable records when reference overall bands exist', () => {
  const sessionA = {
    sessionId: 'bench-A',
    savedAt: '2026-04-11T09:00:00.000Z',
    metadata: {
      sampleId: 'A',
      sampleName: 'Essay A',
      examinerBandScore: 4.5
    },
    steps: {
      step4grade: {
        response: {
          json: {
            data: {
              overallBand: 4,
              scores: { TR: 4, CC: 4, LR: 4.5, GRA: 4 },
              results: [
                { criterion: 'TR', band: 3, baseKey: 'TR3-2', value: 'Yes', source: 'deterministic', scope: 'essay', polarity: 'FAULT_CHECK' },
                { criterion: 'CC', band: 3, baseKey: 'CC3-2::P2', value: 'Yes', source: 'ai', scope: 'paragraph', polarity: 'FAULT_CHECK' }
              ],
              aggregatedResults: [
                { criterion: 'TR', band: 3, baseKey: 'TR3-2', value: 'Yes', source: 'deterministic', scope: 'essay', polarity: 'FAULT_CHECK' },
                { criterion: 'CC', band: 3, baseKey: 'CC3-2', value: 'Yes', source: 'aggregate', scope: 'essay', polarity: 'FAULT_CHECK' }
              ],
              meta: {
                telemetry: {
                  sourceCounts: { deterministic: 1, ai: 1, aggregate: 1 },
                  paragraph: { totalRows: 1, deterministicRows: 0, aiRows: 1 },
                  lowBand: {
                    totalRows: 2,
                    rowsByCriterion: { TR: 1, CC: 1, LR: 0, GRA: 0, General: 0 },
                    aiFallbackNoRule: 1,
                    aiFallbackRuleReturnedNull: 0,
                    aiFallbackRuleError: 0,
                    errorRows: 0
                  }
                }
              }
            }
          }
        }
      },
      step5feedback: {
        response: {
          json: {
            data: {
              improvements: [{ criterion: 'TR', issue: 'Position is unclear.' }]
            }
          }
        }
      }
    }
  };

  const sessionB = {
    sessionId: 'bench-B',
    savedAt: '2026-04-11T09:10:00.000Z',
    metadata: {
      sampleId: 'B',
      sampleName: 'Essay B',
      examinerBandScore: 6
    },
    steps: {
      step4grade: {
        response: {
          json: {
            data: {
              overallBand: 6,
              scores: { TR: 6, CC: 6, LR: 6, GRA: 6 },
              results: [],
              aggregatedResults: []
            }
          }
        }
      }
    }
  };

  const records = [
    calibrationEvaluationService.buildEvaluationRecordFromSession(sessionA),
    calibrationEvaluationService.buildEvaluationRecordFromSession(sessionB)
  ];
  assert.equal(records[0].referenceOverall, 4.5);
  assert.equal(records[1].referenceOverall, 6);

  const report = calibrationEvaluationService.buildCalibrationReport(records, {
    scoringVersion: 'scoringV0326'
  });
  assert.equal(report.metrics.overall.sampleCount, 2);
  assert.equal(report.perEssay.length, 2);
});

