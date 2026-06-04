const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { scoringRules } = require('../MVC/services/ielts/scoringRules');

function buildGrammarControl(overrides = {}) {
  return {
    structureRange: 'mixed',
    complexSentenceControl: 'mixed',
    errorFrequency: 'occasional',
    subjectVerbAgreement: 'mixed',
    articleControl: 'mixed',
    prepositionControl: 'mixed',
    punctuationControl: 'mixed',
    sentenceBoundaryControl: 'mixed',
    clarityImpactFromGrammar: 'minor',
    errorFreeSentenceShareBand: 'moderate',
    ...overrides
  };
}

function buildLexicalControl(overrides = {}) {
  return {
    rangeBand: 'adequate',
    precisionBand: 'mixed',
    collocationControl: 'mixed',
    awkwardExpressionCountBand: 'few',
    spellingImpact: 'minor',
    wordFormationImpact: 'minor',
    repetitionImpact: 'mild',
    clarityImpactFromLexis: 'minor',
    ...overrides
  };
}

test('all active deterministic micro-assessment rows have a live scoring rule', () => {
  const bankRows = JSON.parse(fs.readFileSync('data/ielts/microAssessments.json', 'utf8'));
  const activeDeterministicRows = bankRows.filter(
    (row) => row?.is_active !== false && String(row?.signal_kind || '').toLowerCase() === 'deterministic'
  );
  const missing = activeDeterministicRows
    .map((row) => row.question_key)
    .filter((questionKey) => typeof scoringRules[questionKey] !== 'function');

  assert.deepEqual(missing, []);
});

test('patched deterministic GRA rows are aligned to grammarControl signals in bank', () => {
  const targetKeys = new Set(['GRA4-2', 'GRA4-3', 'GRA4-5', 'GRA5-1', 'GRA5-2', 'GRA5-3']);
  const rows = JSON.parse(fs.readFileSync('data/ielts/microAssessments.json', 'utf8'))
    .filter((row) => targetKeys.has(row?.question_key));

  assert.equal(rows.length, targetKeys.size);
  for (const row of rows) {
    const signals = Array.isArray(row.signal_signals) ? row.signal_signals : [];
    assert.ok(signals.length >= 2, `${row.question_key} should expose grammarControl signal mapping`);
    assert.ok(
      signals.every((signal) => String(signal || '').startsWith('grammarControl.')),
      `${row.question_key} should no longer depend on legacy grammarcheck/syntax paths`
    );
  }
});

test('LR4-4 and LR4-5 resolve deterministically from lexicalControl severity', () => {
  const severeLexicalCtx = {
    step25: {
      lexicalControl: buildLexicalControl({
        spellingImpact: 'frequent',
        wordFormationImpact: 'some',
        clarityImpactFromLexis: 'major',
        awkwardExpressionCountBand: 'many'
      })
    }
  };
  const mildLexicalCtx = {
    step25: {
      lexicalControl: buildLexicalControl({
        spellingImpact: 'minor',
        wordFormationImpact: 'minor',
        clarityImpactFromLexis: 'minor',
        awkwardExpressionCountBand: 'few',
        repetitionImpact: 'mild'
      })
    }
  };

  assert.equal(scoringRules['LR4-4'](severeLexicalCtx), 'Yes');
  assert.equal(scoringRules['LR4-4'](mildLexicalCtx), 'No');
  assert.equal(scoringRules['LR4-5'](severeLexicalCtx), 'strain');
  assert.equal(scoringRules['LR4-5'](mildLexicalCtx), 'none');
});

test('patched deterministic GRA rows resolve from grammarControl without null fallback in clear cases', () => {
  const weakGrammarCtx = {
    step25: {
      grammarControl: buildGrammarControl({
        structureRange: 'simple_only',
        complexSentenceControl: 'weak',
        errorFrequency: 'frequent',
        subjectVerbAgreement: 'weak',
        articleControl: 'weak',
        prepositionControl: 'weak',
        punctuationControl: 'weak',
        sentenceBoundaryControl: 'weak',
        clarityImpactFromGrammar: 'some',
        errorFreeSentenceShareBand: 'very_low'
      })
    }
  };
  const strongGrammarCtx = {
    step25: {
      grammarControl: buildGrammarControl({
        structureRange: 'varied',
        complexSentenceControl: 'good',
        errorFrequency: 'rare',
        subjectVerbAgreement: 'strong',
        articleControl: 'strong',
        prepositionControl: 'strong',
        punctuationControl: 'strong',
        sentenceBoundaryControl: 'strong',
        clarityImpactFromGrammar: 'none',
        errorFreeSentenceShareBand: 'high'
      })
    }
  };

  assert.equal(scoringRules['GRA4-2'](weakGrammarCtx), 'Yes');
  assert.equal(scoringRules['GRA4-2'](strongGrammarCtx), 'No');
  assert.equal(scoringRules['GRA4-3'](weakGrammarCtx), 'Yes');
  assert.equal(scoringRules['GRA4-3'](strongGrammarCtx), 'No');
  assert.equal(scoringRules['GRA4-5'](weakGrammarCtx), 'No');
  assert.equal(scoringRules['GRA4-5'](strongGrammarCtx), 'No');
  assert.equal(scoringRules['GRA5-1'](weakGrammarCtx), 'Yes');
  assert.equal(scoringRules['GRA5-1'](strongGrammarCtx), 'No');
  assert.equal(scoringRules['GRA5-2'](weakGrammarCtx), 'No');
  assert.equal(scoringRules['GRA5-2'](strongGrammarCtx), 'Yes');
  assert.equal(scoringRules['GRA5-3'](weakGrammarCtx), 'No');
  assert.equal(scoringRules['GRA5-3'](strongGrammarCtx), 'No');
  assert.equal(scoringRules['GRA5-6'](weakGrammarCtx), 'some');
  assert.equal(scoringRules['GRA5-6'](strongGrammarCtx), 'none');
});
