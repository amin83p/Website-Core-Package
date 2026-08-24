const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

test('main.css defines standard sections-page width for most pages', () => {
  const source = read('public/styles/main.css');
  assert.match(source, /--sections-page-max-width:\s*min\(1400px/);
  assert.match(source, /\.sections-page\s*\{[^}]*max-width:\s*var\(--sections-page-max-width\)/s);
  assert.doesNotMatch(source, /--sections-page-max-width:\s*var\(--app-page-max-width\)/);
});

test('main.css defines pixel-based wide and full modes for sections pages', () => {
  const source = read('public/styles/main.css');
  assert.match(source, /html\.app-page-width-wide/);
  assert.match(source, /html\.app-page-width-full/);
  assert.match(source, /html\.app-page-width-wide[\s\S]*--sections-page-max-width:\s*min\(1640px/s);
  assert.match(source, /html\.app-page-width-full[\s\S]*--sections-page-max-width:\s*min\(90%/s);
  assert.match(source, /html\.app-page-width-wide main\.container[\s\S]*max-width:\s*100%/s);
  assert.match(source, /html\.app-page-width-wide main\.container[\s\S]*width:\s*100%/s);
  assert.match(source, /html\.app-page-width-full main\.container[\s\S]*min\(90%/s);
});

test('main.css scopes percentage widths to Master Schedule Viewer only', () => {
  const source = read('public/styles/main.css');
  assert.match(source, /\.master-schedule-viewer-page/);
  assert.match(source, /--master-schedule-viewer-max-width:\s*min\(70%/);
  assert.match(source, /html\.app-page-width-wide \.master-schedule-viewer-page[\s\S]*min\(80%/s);
  assert.match(source, /html\.app-page-width-full \.master-schedule-viewer-page[\s\S]*min\(90%/s);
  assert.match(source, /main\.container:has\(\.master-schedule-viewer-page\)/);
});

test('layout.ejs early-applies stored page width class', () => {
  const source = read('MVC/views/layouts/layout.ejs');
  assert.match(source, /app_page_width/);
  assert.match(source, /app-page-width-wide/);
  assert.match(source, /app-page-width-full/);
});

test('header display settings modal includes page width controls', () => {
  const source = read('MVC/views/partials/header.ejs');
  assert.match(source, /Page Width/);
  assert.match(source, /appPageWidthMenuBlock/);
  assert.match(source, /id="appPageWidthStandard"/);
  assert.match(source, /id="appPageWidthWide"/);
  assert.match(source, /id="appPageWidthFull"/);
});

test('main.js persists and applies page width preference', () => {
  const source = read('public/scripts/main.js');
  assert.match(source, /APP_PAGE_WIDTH_STORAGE_KEY\s*=\s*'app_page_width'/);
  assert.match(source, /function initAppPageWidthControls/);
  assert.match(source, /function applyAppPageWidth/);
  assert.match(source, /initAppPageWidthControls\(\)/);
});

test('main.css reserves left gutter for side controls in full page width mode', () => {
  const source = read('public/styles/main.css');
  assert.match(source, /--app-side-controls-gutter/);
  assert.match(source, /html\.app-page-width-full main\.container[\s\S]*padding-left/s);
});

test('wide page width mode uses the same left gutter as full mode', () => {
  const source = read('public/styles/main.css');
  assert.match(source, /html\.app-page-width-wide[\s\S]*--app-side-controls-gutter:\s*64px/s);
  assert.match(source, /html\.app-page-width-wide main\.container[\s\S]*padding-left/s);
  assert.match(source, /html\.app-page-width-wide[\s\S]*min\(1640px/s);
});

test('Master Schedule Viewer marks its sections-page wrapper', () => {
  const source = read('packages/school/MVC/views/school/schedule/personSchedule.ejs');
  assert.match(source, /sectionsPageClass:\s*'master-schedule-viewer-page'/);
});

test('academic ledger pages inherit global sections-page width', () => {
  const ledgerSource = read('packages/school/MVC/views/school/academicLedger/ledgerList.ejs');
  const overviewSource = read('packages/school/MVC/views/school/academicLedger/studentOverview.ejs');
  assert.doesNotMatch(ledgerSource, /max-width:\s*min\(1640px/);
  assert.doesNotMatch(overviewSource, /max-width:\s*min\(1640px/);
});
