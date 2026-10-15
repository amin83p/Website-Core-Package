const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../../..');

function loadBookCoveringTocUtils() {
  const code = fs.readFileSync(path.join(ROOT, 'public/scripts/bookCoveringTocUtils.js'), 'utf8');
  const context = { window: null };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(code, context);
  return context.BookCoveringTocUtils;
}

const sampleToc = [
  { id: 'h1-a', level: 1, parentId: '', sortOrder: 10, label: 'Chapter A', startPage: 1, endPage: 20 },
  { id: 'h2-a1', level: 2, parentId: 'h1-a', sortOrder: 20, label: 'Section A.1', startPage: 5, endPage: 10 },
  { id: 'h2-a2', level: 2, parentId: 'h1-a', sortOrder: 30, label: 'Section A.2', startPage: 11, endPage: 15 },
  { id: 'h1-b', level: 1, parentId: '', sortOrder: 40, label: 'Chapter B', startPage: 21, endPage: 40 },
  { id: 'h3-b1', level: 3, parentId: 'h2-b-missing', sortOrder: 50, label: 'Orphan depth', startPage: 25, endPage: 26 }
];

test('resolveH1EntryId walks parentId chain', () => {
  const utils = loadBookCoveringTocUtils();
  assert.equal(utils.resolveH1EntryId(sampleToc, 'h2-a1'), 'h1-a');
  assert.equal(utils.resolveH1EntryId(sampleToc, 'h1-a'), 'h1-a');
});

test('resolveH1EntryId falls back to prior H1 by sort order', () => {
  const utils = loadBookCoveringTocUtils();
  assert.equal(utils.resolveH1EntryId(sampleToc, 'h3-b1'), 'h1-b');
});

test('normalizeTocEntryIdsToH1 dedupes legacy child ids', () => {
  const utils = loadBookCoveringTocUtils();
  const normalized = utils.normalizeTocEntryIdsToH1(sampleToc, ['h2-a1', 'h1-a', 'h2-a2', 'h1-b']);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0], 'h1-a');
  assert.equal(normalized[1], 'h1-b');
});

test('buildSelectableTocTableHtml marks H1 checkboxes only', () => {
  const utils = loadBookCoveringTocUtils();
  const html = utils.buildSelectableTocTableHtml(sampleToc, ['h1-a'], {});
  assert.match(html, /js-bc-h1-pick/);
  assert.match(html, /book-coverage-toc-list/);
  assert.match(html, /book-coverage-toc-chapter/);
  const h1Checks = (html.match(/js-bc-h1-pick/g) || []).length;
  assert.equal(h1Checks, 2);
  assert.match(html, /book-coverage-toc-section-child/);
  assert.match(html, /js-bc-toc-section-toggle/);
  assert.match(html, /pp\. 5–10/);
});

test('formatTocPageRange matches preview-style ranges', () => {
  const utils = loadBookCoveringTocUtils();
  assert.equal(utils.formatTocPageRange(5, 5), '5');
  assert.equal(utils.formatTocPageRange(5, 10), '5–10');
  assert.equal(utils.formatTocPageRange(null, 10), '—');
});
