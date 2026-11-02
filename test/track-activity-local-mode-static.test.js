'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('trackActivityTimeline branches on state.localMode before fetch', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../public/scripts/trackActivityTimeline.js'),
    'utf8'
  );
  assert.ok(src.includes('state.localMode && state.localSession'));
  assert.ok(src.includes('loadTimelineFromLocalSession'));
  const fetchDataIdx = src.indexOf('fetch(`/security/track-activity/data?');
  const localBranchIdx = src.indexOf('if (state.localMode && state.localSession)');
  assert.ok(localBranchIdx > 0);
  assert.ok(localBranchIdx < fetchDataIdx, 'local branch should appear before live data fetch in loadTimeline');
});
