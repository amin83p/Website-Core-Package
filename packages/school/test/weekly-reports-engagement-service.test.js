const test = require('node:test');
const assert = require('node:assert/strict');

const {
  averageClassEngagementPercent,
  mergeEngagementTotals
} = require('../MVC/services/school/weeklyReportsEngagementService');

test('averageClassEngagementPercent averages class percents not minute-weighted rollup', () => {
  const avg = averageClassEngagementPercent([
    { classId: '1', percent: 0, presentMinutes: 0, scheduledMinutes: 100 },
    { classId: '2', percent: 0, presentMinutes: 0, scheduledMinutes: 50 },
    { classId: '3', percent: 30, presentMinutes: 30, scheduledMinutes: 100 }
  ]);
  assert.equal(avg, 10);
});

test('averageClassEngagementPercent treats null class percent as zero', () => {
  const avg = averageClassEngagementPercent([
    { classId: '1', percent: null, scheduledMinutes: 0 },
    { classId: '2', percent: 40, scheduledMinutes: 10 }
  ]);
  assert.equal(avg, 20);
});

test('mergeEngagementTotals still minute-weights for combined minutes', () => {
  const merged = mergeEngagementTotals(
    { presentMinutes: 0, scheduledMinutes: 0, percent: null },
    { presentMinutes: 30, scheduledMinutes: 100, percent: 30 }
  );
  assert.equal(merged.percent, 30);
  assert.equal(merged.presentMinutes, 30);
  assert.equal(merged.scheduledMinutes, 100);
});
