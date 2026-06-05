const test = require('node:test');
const assert = require('node:assert/strict');

const { scoringRules } = require('../packages/ielts/MVC/services/ielts/scoringRules');
const { baselineVersion, baselineProfiles } = require('../scripts/ielts/behaviorFreezeBaseline');
const { runBaselineCheck } = require('../scripts/ielts/scoringBaselineGuardCheck');

test(`behavior freeze baseline remains stable (${baselineVersion})`, () => {
  const result = runBaselineCheck();
  assert.equal(result.drifts.length, 0, `Behavior freeze drift detected:\n${JSON.stringify(result.drifts, null, 2)}`);
});

test('behavior freeze baseline profiles have valid rule references', () => {
  for (const profile of baselineProfiles) {
    const expectedMap = profile?.expected || {};
    for (const ruleKey of Object.keys(expectedMap)) {
      assert.equal(
        typeof scoringRules?.[ruleKey],
        'function',
        `Missing rule '${ruleKey}' in freeze profile '${profile.id}'`
      );
    }
  }
});

