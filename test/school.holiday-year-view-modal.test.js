const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('holiday list provides year-view modal trigger and renderer', () => {
  const view = read('packages/school/MVC/views/school/holiday/holidays.ejs');

  assert.match(view, /id="btnOpenHolidayYearView"/);
  assert.match(view, /id="holidayYearViewModal"/);
  assert.match(view, /id="holidayYearSummaryReport"/);
  assert.match(view, /function renderHolidayYearCalendar\(\)/);
  assert.match(view, /function renderHolidayYearSummary\(holidayLookup\)/);
  assert.match(view, /Teachers Working Days:/);
  assert.match(view, /Total Saturday and Sundays:/);
  assert.match(view, /Total days school is off:/);
  assert.match(view, /Total Days school is off excluding saturdays and sundays:/);
  assert.match(view, /holidayYearData/);
  assert.match(view, /bg-danger/);
  assert.match(view, /bg-warning/);
  assert.match(view, /Saturdays and Sundays/);
  assert.match(view, /data-bs-toggle="tooltip"/);
});

test('holiday controller passes full year data to list view', () => {
  const controller = read('packages/school/MVC/controllers/school/holidayController.js');
  assert.match(controller, /yearHolidayData:\s*filteredHolidays/);
});
