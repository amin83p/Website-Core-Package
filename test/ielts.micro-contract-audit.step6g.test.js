const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { evaluateRowPassResult } = require('../MVC/services/ielts/answerContractUtils');

const {
  STATUS,
  auditMicroAssessmentContracts,
  loadRowsForAudit
} = require('../scripts/ielts/microAssessmentContractAudit');

function loadStep3EvaluateRowPassResult() {
  return evaluateRowPassResult;
}

function loadStep5EvaluateRowStrength() {
  return function evaluateRowStrength(row) {
    const passResult = evaluateRowPassResult(row);
    if (!passResult.evaluated) return true;
    return !passResult.pass;
  };
}

test('active IELTS micro-assessment bank rows validate as complete explicit contracts (boolean/categorical/ordinal)', async () => {
  const loaded = await loadRowsForAudit({
    source: 'file',
    dataPath: path.join(process.cwd(), 'data', 'ielts', 'microAssessments.json')
  });
  const rows = Array.isArray(loaded?.rows) ? loaded.rows : [];
  const { report } = auditMicroAssessmentContracts(rows, { applyPatches: false });

  assert.equal(report.invalidRows, 0, 'No active rows should be invalid.');
  assert.equal(report.ambiguousRows, 0, 'No active rows should be ambiguous.');
  assert.equal(report.rowsStillRelyingOnFallbackPolarity.length, 0, 'Active rows should not rely on fallback polarity.');
  assert.equal(report.statusCountsAfter[STATUS.INVALID_OVERLAP], 0, 'No overlap allowed after normalization.');
  assert.equal(report.statusCountsAfter[STATUS.INVALID_FOR_ANSWER_TYPE], 0, 'All tokens should align with answer_type options.');
});

test('audit reports unresolved rows and auto-patches only safely inferable rows', () => {
  const sample = [
    {
      id: 'ROW_BOOL_PATCH',
      baseKey: 'TR2-X',
      question_key: 'TR2-X',
      criterion: 'TR',
      band: 2,
      scope: 'essay',
      answer_type: 'Boolean',
      polarity: 'FAULT_CHECK',
      atomic_question: 'Is there no clear position?',
      is_active: true
    },
    {
      id: 'ROW_ORDINAL_AMBIG',
      baseKey: 'LR2-X',
      question_key: 'LR2-X',
      criterion: 'LR',
      band: 2,
      scope: 'essay',
      answer_type: 'Ordinal (none/some/strain)',
      atomic_question: 'How much strain is present?',
      is_active: true
    }
  ];

  const dryRun = auditMicroAssessmentContracts(sample, { applyPatches: false }).report;
  assert.equal(dryRun.statusCountsAfter[STATUS.MISSING_BOTH], 2);
  assert.equal(dryRun.rowsStillRelyingOnFallbackPolarity.length, 2);

  const applyRun = auditMicroAssessmentContracts(sample, { applyPatches: true }).report;
  const patched = applyRun.rowsPatched.find((row) => row.baseKey === 'TR2-X');
  assert.ok(patched, 'Boolean fault-style row should be auto-patched.');
  assert.deepEqual(patched.patchedScoredAnswers, ['No']);
  assert.deepEqual(patched.patchedNotScoredAnswers, ['Yes']);

  const unresolved = applyRun.rowsStillRelyingOnFallbackPolarity.find((row) => row.baseKey === 'LR2-X');
  assert.ok(unresolved, 'Ambiguous ordinal row should stay unresolved and be surfaced.');
});

test('step3 and step5 keep explicit-contract-first behavior with legacy fallback safety', () => {
  const evaluateRowPassResult = loadStep3EvaluateRowPassResult();
  const evaluateRowStrength = loadStep5EvaluateRowStrength();

  const explicitStep3 = evaluateRowPassResult({
    value: 'No',
    scoredAnswers: ['No'],
    notScoredAnswers: ['Yes'],
    polarity: 'FEATURE_CHECK'
  });
  assert.equal(explicitStep3.evaluated, true);
  assert.equal(explicitStep3.pass, true);
  assert.equal(explicitStep3.scoringMode, 'explicit_answer_contract');

  const fallbackStep3 = evaluateRowPassResult({
    value: 'No',
    polarity: 'FAULT_CHECK'
  });
  assert.equal(fallbackStep3.evaluated, true);
  assert.equal(fallbackStep3.pass, true);
  assert.equal(fallbackStep3.scoringMode, 'legacy_polarity');

  const explicitStep5Weak = evaluateRowStrength({
    value: 'No',
    scoredAnswers: ['No'],
    notScoredAnswers: ['Yes']
  });
  assert.equal(explicitStep5Weak, false, 'Explicit pass token should not be treated as weak.');

  const fallbackStep5Weak = evaluateRowStrength({
    value: 'No',
    polarity: 'FAULT_CHECK'
  });
  assert.equal(fallbackStep5Weak, false, 'Legacy fallback should still classify fault-pass as non-weak.');
});
