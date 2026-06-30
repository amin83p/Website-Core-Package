const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('calendar view defines day and event detail modals', () => {
  const view = read('packages/school/MVC/views/school/calendar/calendar.ejs');

  assert.match(view, /id="calendarDayItemsModal"/);
  assert.match(view, /id="calendarEventDetailModal"/);
  assert.match(view, /id="calendarDayItemsModalBody"/);
  assert.match(view, /id="calendarEventDetailModalBody"/);
});

test('calendar script supports clickable day and item modal flow', () => {
  const view = read('packages/school/MVC/views/school/calendar/calendar.ejs');

  assert.match(view, /function showModalSafely\(modalEl,\s*cachedInstance\)/);
  assert.match(view, /function getOrCreateModalInstance\(modalEl,\s*cachedInstance\)/);
  assert.match(view, /function openDayItemsModal\(dateKey\)/);
  assert.match(view, /function openEventDetailModal\(event\)/);
  assert.match(view, /function attachDayClicks\(\)/);
  assert.match(view, /class="calendar-day-cell is-clickable/);
  assert.match(view, /data-day-date="/);
  assert.match(view, /js-calendar-event-item/);
});
