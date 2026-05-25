const test = require('node:test');
const assert = require('node:assert/strict');

const questionTypeRegistry = require('../packages/pte/MVC/services/pte/questionTypeRegistry');
const coachRules = require('../public/scripts/ptePracticeCoachRules');

function buildContext(questionType, payload = {}, response = {}) {
  return { questionType, payload, response, runtime: {} };
}

test('coach rules cover all core question types with hint profiles', () => {
  const coreTypeKeys = questionTypeRegistry
    .listTypes()
    .filter((row) => Array.isArray(row.testTypes) && row.testTypes.includes('core'))
    .map((row) => String(row.key || '').trim())
    .filter(Boolean);

  coreTypeKeys.forEach((typeKey) => {
    assert.equal(coachRules.hasHintProfile(typeKey), true, `Missing hint profile for ${typeKey}`);
    const level1 = coachRules.getHint(buildContext(typeKey, {}, {}));
    const level2 = coachRules.getHint({ ...buildContext(typeKey, {}, {}), level: 2 });
    const level3 = coachRules.getHint({ ...buildContext(typeKey, {}, {}), level: 3 });
    assert.equal(typeof level1.text, 'string');
    assert.equal(level1.text.length > 0, true);
    assert.equal(level2.text.length > 0, true);
    assert.equal(level3.text.length > 0, true);
  });
});

test('reading writing fill in blank: self-check warns when not all blanks are completed', () => {
  const ctx = buildContext(
    'reading_writing_fill_in_blank',
    {
      blankAnswerMap: {
        '{{1}}': 'were met',
        '{{2}}': 'gained'
      }
    },
    {
      mapText: JSON.stringify({
        '{{1}}': 'were met'
      })
    }
  );

  const selfCheck = coachRules.runSelfCheck(ctx);
  assert.equal(selfCheck.passed, false);
  assert.equal(selfCheck.warnCount > 0, true);
  assert.equal(
    selfCheck.checks.some((row) => String(row.id || '') === 'blanks_complete'),
    true
  );
});

test('mcq multiple self-check distinguishes empty vs complete selection count guidance', () => {
  const basePayload = {
    correctOptionKeys: ['A', 'C']
  };

  const empty = coachRules.runSelfCheck(buildContext(
    'reading_mcq_multiple',
    basePayload,
    { selectedMultiple: [] }
  ));
  assert.equal(empty.passed, false);
  assert.equal(empty.warnCount > 0, true);

  const complete = coachRules.runSelfCheck(buildContext(
    'reading_mcq_multiple',
    basePayload,
    { selectedMultiple: ['A', 'C'] }
  ));
  assert.equal(complete.passed, true);
  assert.equal(complete.warnCount, 0);
});

test('reorder self-check flags duplicates and incomplete arrangements', () => {
  const payload = {
    paragraphItems: ['P1', 'P2', 'P3']
  };
  const badResponse = {
    mapText: JSON.stringify({
      submittedOrder: ['P1', 'P1']
    })
  };

  const selfCheck = coachRules.runSelfCheck(buildContext('reading_reorder_paragraphs', payload, badResponse));
  assert.equal(selfCheck.passed, false);
  assert.equal(
    selfCheck.checks.some((row) => row.id === 'reorder_unique' && row.status === 'warn'),
    true
  );
  assert.equal(
    selfCheck.checks.some((row) => row.id === 'reorder_length' && row.status === 'warn'),
    true
  );
});

test('hints do not leak keyed answers before submit', () => {
  const payload = {
    blankAnswerMap: {
      '{{1}}': 'were met',
      '{{2}}': 'gained',
      '{{3}}': 'once',
      '{{4}}': 'unravel'
    },
    correctOptionKey: 'B',
    correctOptionKeys: ['A', 'C']
  };
  const answerTokens = [
    'were met',
    'gained',
    'once',
    'unravel',
    'option b',
    'a,c'
  ];

  const hints = [
    coachRules.getHint({ ...buildContext('reading_writing_fill_in_blank', payload, {}), level: 1 }).text,
    coachRules.getHint({ ...buildContext('reading_writing_fill_in_blank', payload, {}), level: 2 }).text,
    coachRules.getHint({ ...buildContext('reading_writing_fill_in_blank', payload, {}), level: 3 }).text
  ].map((row) => String(row || '').toLowerCase());

  hints.forEach((hintText) => {
    answerTokens.forEach((token) => {
      assert.equal(
        hintText.includes(token),
        false,
        `Hint leaked answer token "${token}" in: ${hintText}`
      );
    });
  });
});

test('after submit feedback for dropdown blanks returns deterministic progress summary', () => {
  const feedback = coachRules.buildAfterSubmitFeedback(buildContext(
    'reading_writing_fill_in_blank',
    {
      blankAnswerMap: {
        '{{1}}': 'were met',
        '{{2}}': 'gained'
      }
    },
    {
      mapText: JSON.stringify({
        '{{1}}': 'were met',
        '{{2}}': 'gain'
      })
    }
  ));

  assert.equal(Array.isArray(feedback.whatWentWell), true);
  assert.equal(Array.isArray(feedback.whatToImprove), true);
  assert.equal(Array.isArray(feedback.tryThisNext), true);
  assert.equal(
    feedback.whatWentWell.some((row) => String(row).includes('1 blank')),
    true
  );
});
