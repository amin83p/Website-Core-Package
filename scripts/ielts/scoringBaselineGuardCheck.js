const { scoringRules } = require('../../MVC/services/ielts/scoringRules');
const { baselineVersion, baselineProfiles } = require('./behaviorFreezeBaseline');

function runBaselineCheck() {
  const drifts = [];
  let assertionCount = 0;

  for (const profile of baselineProfiles) {
    const expectedMap = profile?.expected || {};
    const ctx = profile?.context || {};

    for (const [ruleKey, expectedValue] of Object.entries(expectedMap)) {
      assertionCount += 1;
      const ruleFn = scoringRules?.[ruleKey];
      if (typeof ruleFn !== 'function') {
        drifts.push({
          profileId: profile.id,
          ruleKey,
          expectedValue,
          actualValue: '<missing_rule>'
        });
        continue;
      }

      let actualValue;
      try {
        actualValue = ruleFn(ctx);
      } catch (err) {
        actualValue = `<error:${err?.message || 'unknown'}>`;
      }

      if (actualValue !== expectedValue) {
        drifts.push({
          profileId: profile.id,
          ruleKey,
          expectedValue,
          actualValue
        });
      }
    }
  }

  return { drifts, assertionCount };
}

function printReport(result) {
  if (!Array.isArray(result?.drifts) || result.drifts.length === 0) {
    console.log(`[freeze-check] baseline=${baselineVersion} assertions=${result.assertionCount} drift=0`);
    return;
  }

  console.error(`[freeze-check] baseline=${baselineVersion} assertions=${result.assertionCount} drift=${result.drifts.length}`);
  for (const drift of result.drifts) {
    console.error(
      `[freeze-check] ${drift.profileId} ${drift.ruleKey}: expected=${JSON.stringify(drift.expectedValue)} actual=${JSON.stringify(drift.actualValue)}`
    );
  }
}

function main() {
  const result = runBaselineCheck();
  printReport(result);
  if (result.drifts.length > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  runBaselineCheck
};
