const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

test('main.css defines page width CSS variable and html modifier classes', () => {
  const source = read('public/styles/main.css');
  assert.match(source, /--sections-page-max-width:\s*1200px/);
  assert.match(source, /\.sections-page\s*\{[^}]*max-width:\s*var\(--sections-page-max-width\)/s);
  assert.match(source, /html\.app-page-width-wide/);
  assert.match(source, /html\.app-page-width-full/);
  assert.match(source, /html\.app-page-width-wide main\.container/);
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
  assert.match(source, /html\.app-page-width-wide[\s\S]*calc\(100vw - 32px - var\(--app-side-controls-gutter\)\)/s);
});

test('academic ledger pages inherit global sections-page width', () => {
  const ledgerSource = read('packages/school/MVC/views/school/academicLedger/ledgerList.ejs');
  const overviewSource = read('packages/school/MVC/views/school/academicLedger/studentOverview.ejs');
  assert.doesNotMatch(ledgerSource, /max-width:\s*min\(1640px/);
  assert.doesNotMatch(overviewSource, /max-width:\s*min\(1640px/);
});
