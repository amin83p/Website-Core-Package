const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const aiService = require('../MVC/services/ielts/aiService');
const step3ScoringService = require('../MVC/services/ielts/step3ScoringService');

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
    normalizedText: 'Intro sentence. Body one development. Body two support. Conclusion sentence.',
    paragraphs: [
      { paragraphNumber: 1, text: 'Intro sentence.' },
      { paragraphNumber: 2, text: 'Body one development.' },
      { paragraphNumber: 3, text: 'Body two support.' },
      { paragraphNumber: 4, text: 'Conclusion sentence.' }
    ],
    sentences: [
      { index: 0, paragraphIndex: 0, paragraphNumber: 1, text: 'Intro sentence.' },
      { index: 1, paragraphIndex: 1, paragraphNumber: 2, text: 'Body one development.' },
      { index: 2, paragraphIndex: 2, paragraphNumber: 3, text: 'Body two support.' },
      { index: 3, paragraphIndex: 3, paragraphNumber: 4, text: 'Conclusion sentence.' }
    ],
    stats: {
      wordCount: 230,
      sentenceCount: 4,
      paragraphCount: 4
    }
  };
}

function buildStep2Fixture() {
  return {
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
    cohesion: { densityPer100: '3.50' },
    lexical: { topRepeatedWords: [{ word: 'technology', count: 3 }] }
  };
}

function buildBaseExtraction() {
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

function buildStrongLexicalProfileExtraction() {
  return {
    ...buildBaseExtraction(),
    lexicalControl: {
      rangeBand: 'wide',
      precisionBand: 'high',
      collocationControl: 'good',
      awkwardExpressionCountBand: 'few',
      spellingImpact: 'minor',
      wordFormationImpact: 'minor',
      repetitionImpact: 'mild',
      clarityImpactFromLexis: 'minor'
    }
  };
}

function buildMidBandLexicalProfileExtraction() {
  return {
    ...buildBaseExtraction(),
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
  };
}

function buildBoundaryLexicalProfileExtraction() {
  return {
    ...buildBaseExtraction(),
    lexicalControl: {
      rangeBand: 'sufficient',
      precisionBand: 'good',
      collocationControl: 'mixed',
      awkwardExpressionCountBand: 'few',
      spellingImpact: 'minor',
      wordFormationImpact: 'minor',
      repetitionImpact: 'mild',
      clarityImpactFromLexis: 'minor'
    }
  };
}

function loadLrBand5To7Rows() {
  const rows = JSON.parse(fs.readFileSync('data/ielts/microAssessments.json', 'utf8'));
  return rows
    .filter((row) => row && row.is_active !== false)
    .filter((row) => String(row.criterion || '').toUpperCase() === 'LR')
    .filter((row) => Number(row.band) >= 5 && Number(row.band) <= 7)
    .sort((a, b) => Number(a.band) - Number(b.band) || String(a.question_key || '').localeCompare(String(b.question_key || '')));
}

async function runLrOnlyScoring(extraction) {
  const lrRows = loadLrBand5To7Rows();
  return step3ScoringService.runStep3Scoring({
    essayObj: buildEssayFixture(),
    step2Features: buildStep2Fixture(),
    extraction,
    taskPrompt: 'Discuss both views and give your opinion.',
    microAssessments: lrRows,
    options: { mode: 'hybrid_extension', modelId: 'stub-model' }
  });
}

test('LR5-LR7 bank rows are aligned to lexicalControl signals', () => {
  const lrRows = loadLrBand5To7Rows();
  const targetKeys = new Set(['LR5-1', 'LR5-2', 'LR5-3', 'LR5-4', 'LR6-1', 'LR6-2', 'LR6-3', 'LR6-4', 'LR7-1', 'LR7-2', 'LR7-3']);
  const subset = lrRows.filter((row) => targetKeys.has(String(row.question_key || row.baseKey)));

  assert.equal(subset.length, 11);
  for (const row of subset) {
    assert.ok(Array.isArray(row.signal_signals), `${row.question_key} should include signal_signals`);
    assert.ok(
      row.signal_signals.every((token) => String(token).startsWith('lexicalControl.')),
      `${row.question_key} should reference lexicalControl.* signals`
    );
  }
});

test('Strong lexical profile does not collapse LR to mid-band path', async () => {
  const restoreStack = createRestoreStack();
  try {
    restoreStack.stub(aiService, 'sendMessage', async () => {
      throw new Error('AI should not be called for strong LR deterministic stability test.');
    });

    const result = await runLrOnlyScoring(buildStrongLexicalProfileExtraction());
    assert.ok(result?.scores?.LR >= 7, `Expected LR >= 7, got ${result?.scores?.LR}`);
    const lrRows = result.results.filter((row) => row.criterion === 'LR');
    assert.ok(lrRows.length >= 11);
    assert.ok(lrRows.every((row) => row.source === 'deterministic'));
  } finally {
    restoreStack.restoreAll();
  }
});

test('Genuine mid-band lexical profile still scores lower on LR path', async () => {
  const restoreStack = createRestoreStack();
  try {
    restoreStack.stub(aiService, 'sendMessage', async () => {
      throw new Error('AI should not be called for mid-band LR deterministic stability test.');
    });

    const result = await runLrOnlyScoring(buildMidBandLexicalProfileExtraction());
    assert.ok(result?.scores?.LR <= 6.5, `Expected LR <= 6.5, got ${result?.scores?.LR}`);
  } finally {
    restoreStack.restoreAll();
  }
});

test('Boundary lexical profile with few awkward phrases remains conservative but not punitive', async () => {
  const restoreStack = createRestoreStack();
  try {
    restoreStack.stub(aiService, 'sendMessage', async () => {
      throw new Error('AI should not be called for boundary LR deterministic stability test.');
    });

    const result = await runLrOnlyScoring(buildBoundaryLexicalProfileExtraction());
    assert.ok(result?.scores?.LR >= 6.5, `Expected LR >= 6.5, got ${result?.scores?.LR}`);
  } finally {
    restoreStack.restoreAll();
  }
});

test('Legacy-only lexical payload remains compatible via existing fallback mapping', async () => {
  const restoreStack = createRestoreStack();
  try {
    restoreStack.stub(aiService, 'sendMessage', async () => {
      throw new Error('AI should not be called for legacy LR compatibility test.');
    });

    const extraction = {
      ...buildBaseExtraction(),
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

    const result = await runLrOnlyScoring(extraction);
    assert.ok(result?.meta?.step3LanguageEvidence?.lexicalControl, 'Expected mapped lexicalControl in Step 4 meta.');
    assert.ok(Number.isFinite(Number(result?.scores?.LR)));
  } finally {
    restoreStack.restoreAll();
  }
});
