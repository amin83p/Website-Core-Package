'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const studentManagementView = fs.readFileSync(
  path.join(ROOT, 'MVC', 'views', 'school', 'studentManagement.ejs'),
  'utf8'
);
const studentManagementScript = fs.readFileSync(
  path.join(ROOT, 'public', 'scripts', 'schoolStudentManagement.js'),
  'utf8'
);
const {
  HUB_TIMELINE_MAX_CARDS_PER_BUCKET_PER_SIDE,
  hubTimelineLayoutSideLoad,
  hubTimelineLayoutRegionalLoad,
  hubTimelineLayoutSideCounts,
  pickHubTimelineLayoutSide,
  simulateHubTimelineSideAssignment
} = require('../public/scripts/hubStudentTimelineLayoutBalance.js');

test('student management loads timeline balance script before main client', () => {
  const balanceIdx = studentManagementView.indexOf('hubStudentTimelineLayoutBalance.js');
  const mainIdx = studentManagementView.indexOf('schoolStudentManagement.js');
  assert.ok(balanceIdx >= 0, 'balance script tag missing');
  assert.ok(balanceIdx < mainIdx, 'balance script must load before schoolStudentManagement.js');
});

test('timeline optimizer considers side flip in layout candidates', () => {
  assert.match(studentManagementScript, /hubStudentsRebalanceTimelineSides/);
  assert.match(
    studentManagementScript,
    /flippedSide[\s\S]*hubStudentsTimelineLayoutCandidates/
  );
});

test('pickHubTimelineLayoutSide balances distinct dates', () => {
  const layouts = simulateHubTimelineSideAssignment([5, 15, 25, 35, 45, 55, 65, 75, 85, 95]);
  const counts = hubTimelineLayoutSideCounts(layouts);
  const total = counts.below + counts.above;
  assert.equal(total, 10);
  assert.ok(counts.below >= 4 && counts.below <= 6, 'below count ' + counts.below);
  assert.ok(counts.above >= 4 && counts.above <= 6, 'above count ' + counts.above);
});

test('pickHubTimelineLayoutSide caps each bucket side symmetrically', () => {
  const percent = 42.5;
  const bucket = percent.toFixed(3);
  const belowByBucket = {};
  const aboveByBucket = {};
  belowByBucket[bucket] = HUB_TIMELINE_MAX_CARDS_PER_BUCKET_PER_SIDE;
  aboveByBucket[bucket] = HUB_TIMELINE_MAX_CARDS_PER_BUCKET_PER_SIDE;
  const assignedLayouts = simulateHubTimelineSideAssignment([
    percent,
    percent,
    percent,
    percent
  ]);
  const sameBucket = assignedLayouts.filter(function (layout) {
    return Number(layout.percent).toFixed(3) === bucket;
  });
  assert.equal(sameBucket.length, 4);
  const bucketCounts = hubTimelineLayoutSideCounts(sameBucket);
  assert.ok(
    bucketCounts.below <= HUB_TIMELINE_MAX_CARDS_PER_BUCKET_PER_SIDE,
    'below bucket cap'
  );
  assert.ok(
    bucketCounts.above <= HUB_TIMELINE_MAX_CARDS_PER_BUCKET_PER_SIDE,
    'above bucket cap'
  );
  assert.ok(bucketCounts.below > 0 && bucketCounts.above > 0, 'both sides used');
});

test('side and regional load helpers accumulate footprint', () => {
  const layouts = [
    { percent: 10, side: 'below', stemLen: 48 },
    { percent: 12, side: 'below', stemLen: 100 },
    { percent: 50, side: 'above', stemLen: 48 }
  ];
  assert.ok(hubTimelineLayoutSideLoad(layouts, 'below') > hubTimelineLayoutSideLoad(layouts, 'above'));
  assert.ok(
    hubTimelineLayoutRegionalLoad(layouts, 11, 'below', 4)
      >= hubTimelineLayoutRegionalLoad(layouts, 80, 'below', 4)
  );
  const side = pickHubTimelineLayoutSide({
    percent: 11,
    bucket: '11.000',
    belowByBucket: { '11.000': 0 },
    aboveByBucket: { '11.000': 0 },
    assignedLayouts: layouts
  });
  assert.ok(side === 'above' || side === 'below');
});