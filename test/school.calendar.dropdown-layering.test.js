const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('school calendar keeps layer dropdown above year-view day badges', () => {
  const view = read('packages/school/MVC/views/school/calendar/calendar.ejs');

  assert.match(view, /\.school-calendar-toolbar\s*\{[\s\S]*position:\s*relative;[\s\S]*z-index:\s*30;/);
  assert.match(view, /\.school-calendar-layer-dropdown\s+\.dropdown-menu\s*\{[\s\S]*z-index:\s*1200;/);
  assert.match(view, /\.school-calendar-grid\s*\{[\s\S]*position:\s*relative;[\s\S]*z-index:\s*1;/);
  assert.match(view, /\.calendar-year-day-count\s*\{[\s\S]*z-index:\s*1;/);
});
