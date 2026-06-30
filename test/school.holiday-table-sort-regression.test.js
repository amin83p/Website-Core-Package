const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('holiday date column includes a stable machine sort value', () => {
  const view = read('packages/school/MVC/views/school/holiday/holidays.ejs');
  assert.match(view, /data-column="date"/);
  assert.match(view, /data-sort-value="<%= item\.date %>"/);
});

test('shared table sorter supports explicit sort values and safe icon updates', () => {
  const script = read('public/scripts/modal-table.js');
  assert.match(script, /function resolveComparableSortValue\(cell\)/);
  assert.match(script, /cell\?\.dataset\?\.sortValue/);
  assert.match(script, /if \(sortIcon\) sortIcon\.innerHTML = '';/);
  assert.match(script, /if \(activeSortIcon\) activeSortIcon\.innerHTML = sortOrder === 'asc' \? '▲' : '▼';/);
});
