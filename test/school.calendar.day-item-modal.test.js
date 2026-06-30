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

test('calendar day modal renders timeline gaps and holiday full-day indicators', () => {
  const view = read('packages/school/MVC/views/school/calendar/calendar.ejs');

  assert.match(view, /function buildDayTimeline\(dayEvents = \[\]\)/);
  assert.match(view, /function buildDayState\(dayEvents = \[\]\)/);
  assert.match(view, /function gapSpacingPx\(gapMinutes\)/);
  assert.match(view, /--gap-space:/);
  assert.match(view, /calendar-day-deadline-ribbon/);
  assert.match(view, /calendar-duration-chip/);
  assert.match(view, /Timeline by Occurrence/);
  assert.match(view, /This day is holiday\/off-day/);
  assert.match(view, /is-holiday-with-events/);
  assert.match(view, /if \(isDeadlineEvent\(event\)\) return 0;/);
  assert.match(view, /if \(isDeadlineEvent\(event\)\) return 'Deadline spot';/);
  assert.match(view, /Deadline Spot/);
  assert.match(view, /function isHolidayDayOffEvent\(event = \{\}\)/);
});
