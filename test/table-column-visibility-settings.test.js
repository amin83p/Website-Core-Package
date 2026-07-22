const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('table settings apply visibility by column key instead of nth-child position', () => {
  const script = read('public/scripts/modal-table.js');
  assert.match(script, /function applySettings\(table, settings\)/);
  assert.match(script, /function reapplyCurrentTableSettings\(/);
  assert.match(script, /headerByKey\.get\(key\)/);
  assert.match(script, /window\.reapplyCurrentTableSettings\s*=\s*reapplyCurrentTableSettings/);
  assert.doesNotMatch(script, /thead th:nth-child\(\$\{index \+ 1\}\)/);
  assert.doesNotMatch(script, /tbody tr td:nth-child\(\$\{index \+ 1\}\)/);
  // Must not stamp settings keys onto whatever cell happens to sit at an index
  assert.doesNotMatch(script, /headerCell\.dataset\.column\s*=\s*col\.key/);
});

test('Rolling Enrollment reapplies column settings after dynamic row renders', () => {
  const view = read('packages/school/MVC/views/school/class/rollingEnrollment.ejs');
  assert.match(view, /function renderRows\(/);
  assert.match(view, /reapplyCurrentTableSettings/);
  assert.match(view, /tbody_periods/);
});
