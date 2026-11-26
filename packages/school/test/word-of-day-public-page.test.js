'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  buildDateNavigation,
  shiftDateKey,
  FUTURE_DATE_MESSAGE,
  isTodayDateAlias,
  WORD_OF_DAY_TODAY_PATH
} = require('../MVC/controllers/school/wordOfDayPublicController');
const {
  resolveWordOfDayDashboardOrgId,
  isUsableWordOfDayOrgId
} = require('../MVC/services/school/wordOfDayDashboardWidgetService');

const repoRoot = path.join(__dirname, '..', '..', '..');

test('resolveWordOfDayDashboardOrgId skips SYSTEM and uses allowed org', () => {
  assert.equal(isUsableWordOfDayOrgId('SYSTEM'), false);
  assert.equal(isUsableWordOfDayOrgId('900000'), true);
  const resolved = resolveWordOfDayDashboardOrgId({
    activeOrgId: 'SYSTEM',
    allowedOrgs: [{ orgId: '900000', name: 'Demo Org' }]
  });
  assert.equal(resolved.orgId, '900000');
  assert.equal(resolved.source, 'membership');
});

test('shiftDateKey moves by calendar day in UTC', () => {
  assert.equal(shiftDateKey('2026-11-26', -1), '2026-11-25');
  assert.equal(shiftDateKey('2026-11-26', 1), '2026-11-27');
});

test('isTodayDateAlias recognizes stable today path token', () => {
  assert.equal(isTodayDateAlias('today'), true);
  assert.equal(isTodayDateAlias('Today'), true);
  assert.equal(isTodayDateAlias('2026-11-26'), false);
});

test('buildDateNavigation preserves org query suffix when past today', () => {
  const todayKey = '2026-11-28';
  const nav = buildDateNavigation('2026-11-26', '?org=900000', todayKey);
  assert.equal(nav.prevDateHref, '/word-of-the-day/2026-11-25?org=900000');
  assert.equal(nav.nextDateHref, '/word-of-the-day/2026-11-27?org=900000');
  assert.equal(nav.todayHref, `${WORD_OF_DAY_TODAY_PATH}?org=900000`);
  assert.equal(nav.canGoNext, true);
  assert.equal(nav.showTodayNav, true);
  assert.equal(typeof nav.formattedDateLabel, 'string');
  assert.ok(nav.formattedDateLabel.length > 0);
});

test('future date message is set for blocked dates', () => {
  assert.match(FUTURE_DATE_MESSAGE, /Future words/i);
});

test('buildDateNavigation blocks next day on today', () => {
  const todayKey = '2026-11-26';
  const nav = buildDateNavigation('2026-11-26', '', todayKey);
  assert.equal(nav.canGoNext, false);
  assert.equal(nav.nextDateHref, '');
  assert.equal(nav.isViewingToday, true);
  assert.equal(nav.showTodayNav, false);
});

test('public page assets and reaction hooks exist', () => {
  const pkgCss = path.join(repoRoot, 'packages', 'school', 'public', 'styles', 'wordOfDayPublicPage.css');
  const servedCss = path.join(repoRoot, 'public', 'styles', 'wordOfDayPublicPage.css');
  assert.ok(fs.existsSync(pkgCss));
  assert.ok(fs.existsSync(servedCss));
  const view = fs.readFileSync(path.join(repoRoot, 'MVC', 'views', 'wordOfTheDay.ejs'), 'utf8');
  assert.match(view, /data-wod-reaction-panel/);
  assert.match(view, /data-wod-audio-player/);
  assert.match(view, /wod-public-layout/);
  assert.match(view, /data-wod-speak/);
  assert.doesNotMatch(view, /Tap to enlarge/);
  assert.doesNotMatch(view, /linear-gradient\(125deg, #1e3a8a/);
  const css = fs.readFileSync(servedCss, 'utf8');
  assert.match(css, /Fraunces/);
  assert.match(css, /wod-public-word/);
  assert.match(css, /min\(64rem,\s*94vw\)/);
  assert.match(css, /wod-speak-btn/);
  const clientJs = fs.readFileSync(
    path.join(repoRoot, 'packages', 'school', 'public', 'scripts', 'wordOfDayPublicClient.js'),
    'utf8'
  );
  assert.match(clientJs, /initSpeechControls/);
  assert.match(clientJs, /speechSynthesis/);
  assert.match(clientJs, /initSocialImageExport/);
  assert.match(clientJs, /htmlToImage/);
  assert.match(view, /data-wod-social-export/);
  assert.match(view, /wodSocialExportCard/);
  assert.match(view, /data-wod-social-export-open/);
});