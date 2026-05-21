const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const SCORING_RULES_PATH = path.resolve(__dirname, '..', 'MVC', 'services', 'ielts', 'scoringRules.js');

function loadScoringRulesFresh() {
  delete require.cache[SCORING_RULES_PATH];
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(SCORING_RULES_PATH);
}

test('rule patch hardening metadata is exposed', () => {
  delete process.env.IELTS_RULE_PATCH_DISABLED_GROUPS;
  delete process.env.IELTS_RULE_PATCH_PHASE6_CC7_THIN_CONCLUSION;

  const { scoringRules, scoringRuleHelpers } = loadScoringRulesFresh();
  assert.equal(typeof scoringRules['CC7-4'], 'function');
  assert.equal(typeof scoringRuleHelpers.isRulePatchGroupEnabled, 'function');
  assert.equal(typeof scoringRuleHelpers.patchGroupMeta, 'object');
  assert.equal(typeof scoringRuleHelpers.patchGroupByRuleKey, 'object');
  assert.equal(scoringRuleHelpers.patchGroupByRuleKey['CC7-4'], 'phase6_cc7_thin_conclusion');
  assert.equal(scoringRuleHelpers.patchGroupByRuleKey['TR8-1'], 'phase9_tr8_cc7_boundary_recovery');
  assert.equal(scoringRuleHelpers.patchGroupByRuleKey['CC7-1'], 'phase9_tr8_cc7_boundary_recovery');
});

test('rule patch hardening supports per-group disable toggles', () => {
  const originalDisabled = process.env.IELTS_RULE_PATCH_DISABLED_GROUPS;
  const originalSingle = process.env.IELTS_RULE_PATCH_PHASE6_CC7_THIN_CONCLUSION;
  try {
    process.env.IELTS_RULE_PATCH_DISABLED_GROUPS = '';
    process.env.IELTS_RULE_PATCH_PHASE6_CC7_THIN_CONCLUSION = 'off';

    const { scoringRules, scoringRuleHelpers } = loadScoringRulesFresh();
    assert.equal(scoringRuleHelpers.isRulePatchGroupEnabled('phase6_cc7_thin_conclusion'), false);
    assert.equal(scoringRules['CC7-4']({}), null);
  } finally {
    if (originalDisabled === undefined) delete process.env.IELTS_RULE_PATCH_DISABLED_GROUPS;
    else process.env.IELTS_RULE_PATCH_DISABLED_GROUPS = originalDisabled;

    if (originalSingle === undefined) delete process.env.IELTS_RULE_PATCH_PHASE6_CC7_THIN_CONCLUSION;
    else process.env.IELTS_RULE_PATCH_PHASE6_CC7_THIN_CONCLUSION = originalSingle;
  }
});

test('rule patch hardening keeps groups enabled by default', () => {
  delete process.env.IELTS_RULE_PATCH_DISABLED_GROUPS;
  delete process.env.IELTS_RULE_PATCH_PHASE6_CC7_THIN_CONCLUSION;

  const { scoringRuleHelpers } = loadScoringRulesFresh();
  assert.equal(scoringRuleHelpers.isRulePatchGroupEnabled('phase6_cc7_thin_conclusion'), true);
  assert.equal(scoringRuleHelpers.isRulePatchGroupEnabled('phase5_cc_gra_boundary'), true);
  assert.equal(scoringRuleHelpers.isRulePatchGroupEnabled('phase9_tr8_cc7_boundary_recovery'), true);
});
