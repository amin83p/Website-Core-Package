const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const microAssessmentModel = require('../packages/ielts/MVC/models/ielts/microAssessmentModel');
const { scoringRules } = require('../packages/ielts/MVC/services/ielts/scoringRules');
const { loadRowsForAudit } = require('../scripts/ielts/microAssessmentContractAudit');
const {
  getActiveDataBackendConfig,
  setActiveDataBackendConfig
} = require('../MVC/infrastructure/runtime/dataBackendRuntime');

test('micro-assessment normalization keeps baseKey/question_key synchronized on updates', () => {
  const existing = {
    id: 'MA_TEST_1',
    orgId: '900000',
    baseKey: 'TR7-1',
    question_key: 'TR7-1',
    criterion: 'TR',
    band: 7,
    scope: 'essay',
    expectedEvidenceType: 'sentence_indices',
    signalClassification: 'hybrid',
    operationalizedOnlyEligible: false,
    atomic_question: 'Existing question',
    rubric_anchor: 'Existing anchor',
    answer_type: 'Boolean',
    scoredAnswers: ['yes'],
    notScoredAnswers: ['no'],
    is_active: true
  };

  const normalized = microAssessmentModel.normalizeAssessmentRecord(
    { question_key: 'TR7-1A' },
    existing
  );

  assert.equal(normalized.baseKey, 'TR7-1A');
  assert.equal(normalized.question_key, 'TR7-1A');
  assert.equal(normalized.id, 'MA_TEST_1');
  assert.equal(normalized.orgId, '900000');
});

test('micro-assessment normalization parses scoring lists and routing defaults', () => {
  const normalized = microAssessmentModel.normalizeAssessmentRecord({
    id: 'MA_TEST_2',
    orgId: '900000',
    question_key: 'CC5-1',
    criterion: 'CC',
    band: '5',
    atomic_question: 'Is there some organisation?',
    rubric_anchor: 'Presents information with some organisation',
    signal_kind: 'hybrid',
    scoredAnswers: 'Yes\nyes',
    notScoredAnswers: 'No, no'
  });

  assert.equal(normalized.baseKey, 'CC5-1');
  assert.equal(normalized.question_key, 'CC5-1');
  assert.equal(normalized.scope, 'essay');
  assert.equal(normalized.expectedEvidenceType, 'sentence_indices');
  assert.equal(normalized.signalClassification, 'hybrid');
  assert.deepEqual(normalized.scoredAnswers, ['yes']);
  assert.deepEqual(normalized.notScoredAnswers, ['no']);
});

test('active deterministic-classified micro-assessment rows have deterministic rule handlers', () => {
  const bankPath = path.join(process.cwd(), 'data', 'ielts', 'microAssessments.json');
  const rows = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
  const deterministicActiveBaseKeys = rows
    .filter((row) => {
      if (!row || row.is_active === false) return false;
      const classification = String(row.signalClassification || '').trim().toLowerCase();
      const signalKind = String(row.signal_kind || row.signal_source?.kind || '').trim().toLowerCase();
      return classification === 'deterministic' || signalKind === 'deterministic';
    })
    .map((row) => String(row.baseKey || row.question_key || row.id || '').trim())
    .filter(Boolean);

  const missing = deterministicActiveBaseKeys.filter((baseKey) => typeof scoringRules[baseKey] !== 'function');
  assert.deepEqual(missing, []);
});

test('contract-audit loader supports explicit file source', async () => {
  const loaded = await loadRowsForAudit({
    source: 'file',
    dataPath: path.join(process.cwd(), 'data', 'ielts', 'microAssessments.json')
  });

  assert.equal(loaded.source, 'file');
  assert.ok(Array.isArray(loaded.rows));
  assert.ok(loaded.rows.length > 0);
});

test('micro-assessment file model blocks file access when mongo backend is active', async () => {
  const previousConfig = { ...(getActiveDataBackendConfig() || {}) };
  try {
    setActiveDataBackendConfig({ ...previousConfig, mode: 'mongo' });
    await assert.rejects(
      () => microAssessmentModel.getAllAssessments(),
      /DATA_BACKEND=mongo/i
    );
  } finally {
    setActiveDataBackendConfig(previousConfig);
  }
});

