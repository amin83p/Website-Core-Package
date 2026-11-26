'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  sectionIsSchoolPackageDashboard,
  normalizeDashboardHeroFeeds
} = require('../../../MVC/services/dashboardHeroFeedService');

const repoRoot = path.join(__dirname, '..', '..', '..');

test('sectionIsSchoolPackageDashboard identifies school section', () => {
  assert.equal(sectionIsSchoolPackageDashboard({ id: 'SCHOOL' }), true);
  assert.equal(
    sectionIsSchoolPackageDashboard({ id: '122740', name: 'SCHOOL', homeURL: '', packageId: 'school' }),
    true
  );
  assert.equal(sectionIsSchoolPackageDashboard({ id: 'NEWS', homeURL: '/news' }), false);
});

test('unifiedDashboard uses dashboardHeroFeeds not wod flags', () => {
  const unified = fs.readFileSync(
    path.join(repoRoot, 'MVC', 'views', 'partials', 'dashboard', 'unifiedDashboard.ejs'),
    'utf8'
  );
  assert.match(unified, /dashboardHeroFeedItems/);
  assert.doesNotMatch(unified, /showWordOfDayDashboardWidget/);
});

test('normalizeDashboardHeroFeeds drops empty partials', () => {
  const rows = normalizeDashboardHeroFeeds([
    { id: 'a', partial: 'foo/bar', show: true },
    { id: 'b', partial: '', show: true },
    null
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'a');
});