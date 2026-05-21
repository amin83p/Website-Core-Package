const test = require('node:test');
const assert = require('node:assert/strict');

const readingScoringService = require('../MVC/services/pte/pteReadingScoringService');
const scoringEngineService = require('../MVC/services/pte/pteScoringEngineService');

const { scoreReadingAttemptItem } = readingScoringService;

test('Reading MCQ Single scorer returns full score for correct keyed option', async () => {
  const result = await scoreReadingAttemptItem({
    item: { id: 'item-1', questionType: 'reading_mcq_single', metadata: {} },
    question: {
      questionType: 'reading_mcq_single',
      payload: {
        stem: 'Which option is correct?',
        options: [{ key: 'A', text: 'Alpha' }, { key: 'B', text: 'Beta' }],
        correctOptionKey: 'A'
      }
    },
    responsePayload: {
      selectedSingle: 'A'
    },
    scoringConfig: {
      maxScore: 1
    }
  });

  assert.equal(result.status, 'scored');
  assert.equal(result.scorePayload.scoreFinal, 1);
  assert.equal(result.scorePayload.maxScore, 1);
  assert.equal(result.scorePayload.percentage, 100);
  assert.equal(result.scorePayload.traitScores.accuracy, 1);
  assert.equal(result.metadata.scorerVersion, 'pte-reading-mcq-single-v1');
});

test('Reading MCQ Multiple scorer supports partial credit mode deterministically', async () => {
  const result = await scoreReadingAttemptItem({
    item: { id: 'item-1', questionType: 'reading_mcq_multiple', metadata: {} },
    question: {
      questionType: 'reading_mcq_multiple',
      payload: {
        stem: 'Select two correct options.',
        options: [{ key: 'A', text: 'Alpha' }, { key: 'B', text: 'Beta' }, { key: 'C', text: 'Gamma' }],
        correctOptionKeys: ['A', 'C']
      }
    },
    responsePayload: {
      selectedMultiple: ['A']
    },
    scoringConfig: {
      maxScore: 2,
      partialCreditEnabled: true,
      negativeMarking: false
    }
  });

  assert.equal(result.status, 'scored');
  assert.equal(result.scorePayload.scoreFinal, 1);
  assert.equal(result.scorePayload.maxScore, 2);
  assert.equal(result.scorePayload.percentage, 50);
});

test('Reading Fill In Blank scorer evaluates blank map and scales score', async () => {
  const result = await scoreReadingAttemptItem({
    item: { id: 'item-1', questionType: 'reading_fill_in_blank', metadata: {} },
    question: {
      questionType: 'reading_fill_in_blank',
      payload: {
        passageWithBlanks: 'The {{1}} jumps over the {{2}}.',
        blankAnswerMap: {
          '{{1}}': 'fox',
          '{{2}}': 'dog'
        },
        caseSensitive: false
      }
    },
    responsePayload: {
      mapText: JSON.stringify({
        '{{1}}': 'Fox',
        '{{2}}': 'cat'
      })
    },
    scoringConfig: {
      maxScore: 2,
      perBlankScore: 1
    }
  });

  assert.equal(result.status, 'scored');
  assert.equal(result.scorePayload.scoreFinal, 1);
  assert.equal(result.scorePayload.maxScore, 2);
  assert.equal(result.scorePayload.traitScores.accuracy, 1);
});

test('Reading Reorder Paragraphs scorer supports partial credit by matched positions', async () => {
  const result = await scoreReadingAttemptItem({
    item: { id: 'item-1', questionType: 'reading_reorder_paragraphs', metadata: {} },
    question: {
      questionType: 'reading_reorder_paragraphs',
      payload: {
        paragraphItems: ['A', 'B', 'C'],
        correctOrder: ['A', 'B', 'C']
      }
    },
    responsePayload: {
      mapText: JSON.stringify(['A', 'C', 'B'])
    },
    scoringConfig: {
      maxScore: 3,
      partialCreditEnabled: true
    }
  });

  assert.equal(result.status, 'scored');
  assert.equal(result.scorePayload.scoreFinal, 1);
  assert.equal(result.scorePayload.maxScore, 3);
  assert.equal(result.scorePayload.percentage, 33.33);
});

test('Reading Matching scorer evaluates pair accuracy from mapText JSON', async () => {
  const result = await scoreReadingAttemptItem({
    item: { id: 'item-1', questionType: 'reading_matching', metadata: {} },
    question: {
      questionType: 'reading_matching',
      payload: {
        leftItems: [{ key: 'L1', text: 'Apple' }, { key: 'L2', text: 'Banana' }],
        rightItems: [{ key: 'R1', text: 'Red' }, { key: 'R2', text: 'Yellow' }],
        correctPairs: [
          { leftKey: 'L1', rightKey: 'R1' },
          { leftKey: 'L2', rightKey: 'R2' }
        ],
        reusableRightItems: false
      }
    },
    responsePayload: {
      mapText: JSON.stringify([
        { leftKey: 'L1', rightKey: 'R1' },
        { leftKey: 'L2', rightKey: 'R1' }
      ])
    },
    scoringConfig: {
      maxScore: 2,
      perPairScore: 1
    }
  });

  assert.equal(result.status, 'scored');
  assert.equal(result.scorePayload.scoreFinal, 1);
  assert.equal(result.scorePayload.maxScore, 2);
  assert.equal(result.scorePayload.percentage, 50);
  assert.equal(result.metadata.scorerVersion, 'pte-reading-matching-v1');
});

test('Reading scorer fails safely when keyed payload is incomplete', async () => {
  const result = await scoreReadingAttemptItem({
    item: { id: 'item-1', questionType: 'reading_true_false', metadata: {} },
    question: {
      questionType: 'reading_true_false',
      payload: {
        stem: 'Sample statement'
      }
    },
    responsePayload: {
      selectedTrueFalse: 'true'
    },
    scoringConfig: {
      maxScore: 1
    }
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.scorePayload, null);
  assert.equal(result.metadata.warnings.some((row) => row.includes('correctValue')), true);
});

test('Scoring engine marks targeted Reading question types as auto-scoring supported', async () => {
  assert.equal(scoringEngineService.isAutoScoringSupported('reading_mcq_single'), true);
  assert.equal(scoringEngineService.isAutoScoringSupported('reading_mcq_multiple'), true);
  assert.equal(scoringEngineService.isAutoScoringSupported('reading_true_false'), true);
  assert.equal(scoringEngineService.isAutoScoringSupported('reading_fill_in_blank'), true);
  assert.equal(scoringEngineService.isAutoScoringSupported('reading_writing_fill_in_blank'), true);
  assert.equal(scoringEngineService.isAutoScoringSupported('reading_reorder_paragraphs'), true);
  assert.equal(scoringEngineService.isAutoScoringSupported('reading_matching'), true);
});
