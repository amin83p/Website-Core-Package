const test = require('node:test');
const assert = require('node:assert/strict');

const parser = require('../MVC/utils/clbLevelValueParser');

test('parseClbLevelValue orders 3 < 3+ < 4- < 4', () => {
  const values = ['3', '3+', '4-', '4'];
  const sortKeys = values.map((value) => parser.parseClbLevelValue(value).sortKey);
  assert.deepEqual(sortKeys, [3, 3.25, 3.75, 4]);
  assert.equal(parser.compareClbLevelValues('3', '3+'), -1);
  assert.equal(parser.compareClbLevelValues('3+', '4-'), -1);
  assert.equal(parser.compareClbLevelValues('4-', '4'), -1);
  assert.equal(parser.compareClbLevelValues('4', '3'), 1);
});

test('compareClbLevelValues returns null for non-parsable tokens', () => {
  assert.equal(parser.compareClbLevelValues('7-8', '4'), null);
  assert.equal(parser.compareClbLevelValues('-', '4'), null);
  assert.equal(parser.compareClbLevelValues('', '4'), null);
});

test('getClbBaseInteger keeps placement-compatible base values', () => {
  assert.equal(parser.getClbBaseInteger('3+'), 3);
  assert.equal(parser.getClbBaseInteger('4-'), 4);
  assert.equal(parser.getClbBaseInteger('7'), 7);
});

test('evaluateClbEntryWarnings flags backward goal, result, and new-entry current values', () => {
  const entryWarnings = parser.evaluateClbEntryWarnings({
    goal: { listening: '3' },
    current: { listening: '4-' },
    result: { listening: '3+' }
  });
  assert.equal(entryWarnings.length, 2);
  assert.match(entryWarnings[0].message, /goal/i);
  assert.match(entryWarnings[1].message, /result/i);

  const newEntryWarnings = parser.evaluateClbEntryWarnings({
    goal: { listening: '5' },
    current: { listening: '3' },
    result: { listening: '5' }
  }, {
    mode: 'new',
    previousEntry: {
      result: { listening: '4' }
    }
  });
  assert.equal(newEntryWarnings.length, 1);
  assert.match(newEntryWarnings[0].message, /previous result/i);
});

test('evaluateClbEditorWarnings maps warnings to field keys', () => {
  const warnings = parser.evaluateClbEditorWarnings({
    goal: { speaking: '3' },
    current: { speaking: '4' },
    result: { speaking: '4' }
  });
  assert.ok(warnings['goal:speaking']);
  assert.equal(parser.resolveClbEditorInputId(warnings['goal:speaking'], 'student'), 'inp_clb_goal_speaking');
  assert.equal(parser.resolveClbEditorInputId(warnings['goal:speaking'], 'rolling'), 'inp_rolling_clb_goal_speaking');
});
