const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const aiService = require('../MVC/services/ielts/aiService');
const {
  runAiExtraction
} = require('../MVC/services/ielts/aiExtractionService');

function extractFunctionSource(source, functionName) {
  const signature = `function ${functionName}`;
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`Function ${functionName} not found.`);
  const firstBrace = source.indexOf('{', start);
  if (firstBrace < 0) throw new Error(`Function ${functionName} has no opening brace.`);
  let depth = 0;
  for (let i = firstBrace; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Function ${functionName} closing brace not found.`);
}

function loadStep3Guard() {
  const sourcePath = path.join(process.cwd(), 'MVC', 'services', 'ielts', 'aiExtractionService.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const snippet = [
    extractFunctionSource(source, 'assertNoBandScoringFields'),
    'module.exports = { assertNoBandScoringFields };'
  ].join('\n\n');
  const mod = { exports: {} };
  const fn = new Function('module', 'exports', snippet);
  fn(mod, mod.exports);
  return mod.exports.assertNoBandScoringFields;
}

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

function buildEssayObj() {
  return {
    normalizedText: 'Intro. Body. Conclusion.',
    paragraphs: [
      { paragraphNumber: 1, text: 'Intro.' },
      { paragraphNumber: 2, text: 'Body.' },
      { paragraphNumber: 3, text: 'Conclusion.' }
    ],
    sentences: [
      { index: 0, paragraphIndex: 0, paragraphNumber: 1, text: 'Intro.' },
      { index: 1, paragraphIndex: 1, paragraphNumber: 2, text: 'Body.' },
      { index: 2, paragraphIndex: 2, paragraphNumber: 3, text: 'Conclusion.' }
    ]
  };
}

function buildBaseExtractionPayload() {
  return {
    position: {
      stance: 'agree',
      stanceSentenceIndex: 0,
      contradictionSentenceIndices: []
    },
    answersBySubquestion: {
      q1_task_response: [1]
    },
    bodySupport: [
      { paragraphIndex: 1, hasExplanation: true, hasExample: false, evidenceSentenceIndices: [1] }
    ],
    topicSentenceByParagraph: [
      { paragraphIndex: 0, topicSentenceIndex: 0 },
      { paragraphIndex: 1, topicSentenceIndex: 1 },
      { paragraphIndex: 2, topicSentenceIndex: 2 }
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
    },
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
    },
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
}

test('Step 3 extraction guard allows lexicalControl.rangeBand evidence fields', async () => {
  const restoreStack = createRestoreStack();
  try {
    const payload = buildBaseExtractionPayload();
    restoreStack.stub(aiService, 'sendMessage', async () => ({
      text: JSON.stringify(payload),
      modelUsed: 'stub-model',
      usage: null,
      requestMeta: null
    }));

    const result = await runAiExtraction({
      essayObj: buildEssayObj(),
      samplePrompt: 'Discuss both views and give your opinion.',
      paragraphRoles: ['intro', 'body', 'conclusion'],
      retries: 1,
      disableCache: true,
      model: 'stub-model'
    });

    assert.equal(result?.extraction?.lexicalControl?.rangeBand, 'adequate');
    assert.equal(result?.extraction?.grammarControl?.errorFrequency, 'occasional');
  } finally {
    restoreStack.restoreAll();
  }
});

test('Step 3 extraction guard still rejects direct scoring keys', () => {
  const guard = loadStep3Guard();
  assert.throws(
    () => guard({
      position: { stance: 'agree' },
      overallBand: 7
    }),
    /Forbidden scoring field found: 'overallBand'/
  );
});
