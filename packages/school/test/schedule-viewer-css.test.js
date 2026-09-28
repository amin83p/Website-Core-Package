const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const repoRoot = path.join(root, '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

test('personSchedule links external schedule-viewer stylesheet', () => {
  const view = read('MVC/views/school/schedule/personSchedule.ejs');
  assert.match(view, /href="\/styles\/schedule-viewer\.css"/);
  assert.doesNotMatch(view, /^<style>/m);
});

test('personSchedule loads session-calendar.css at most once', () => {
  const view = read('MVC/views/school/schedule/personSchedule.ejs');
  const matches = view.match(/session-calendar\.css/g) || [];
  assert.equal(matches.length, 1);
});

test('schedule-viewer.css includes critical layout selectors', () => {
  const css = read('public/styles/schedule-viewer.css');
  assert.match(css, /\.schedule-shell\b/);
  assert.match(css, /\.schedule-viewbar-sticky\b/);
  assert.match(css, /body\.schedule-stage-overlay-open/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test('package mirror matches served schedule-viewer.css', () => {
  const pkgCss = fs.readFileSync(path.join(root, 'public/styles/schedule-viewer.css'), 'utf8');
  const servedCss = fs.readFileSync(path.join(repoRoot, 'public/styles/schedule-viewer.css'), 'utf8');
  assert.equal(pkgCss, servedCss);
});
