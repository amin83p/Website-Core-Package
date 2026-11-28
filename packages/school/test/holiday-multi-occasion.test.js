const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function readPkg(rel) {
  return fs.readFileSync(path.join(PKG_ROOT, rel), 'utf8');
}

function readRepo(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

test('holiday model defaults countsAsSchoolOff and cultural observance type', () => {
  const holidayModel = require('../MVC/models/school/holidayModel');

  const defaultRow = holidayModel.sanitizeHolidayInput({
    orgId: 'ORG_1',
    date: '2026-07-01',
    title: 'Canada Day'
  });
  assert.equal(defaultRow.countsAsSchoolOff, true);

  const observance = holidayModel.sanitizeHolidayInput({
    orgId: 'ORG_1',
    date: '2026-11-11',
    title: 'Remembrance Day observance',
    type: holidayModel.SCHOOL_OPEN_OBSERVANCE_TYPE
  });
  assert.equal(observance.countsAsSchoolOff, false);

  const explicitOpen = holidayModel.sanitizeHolidayInput({
    orgId: 'ORG_1',
    date: '2026-03-21',
    title: 'Norouz',
    type: 'Other',
    countsAsSchoolOff: false
  });
  assert.equal(explicitOpen.countsAsSchoolOff, false);
});

test('holiday list view supports staged day-session editor and year view clicks', () => {
  const view = readPkg('MVC/views/school/holiday/holidays.ejs');
  assert.match(view, /openHolidayDaySession/);
  assert.match(view, /openHolidayModalForDate/);
  assert.match(view, /holidayOccasionFormPanel/);
  assert.match(view, /btn_applyOccasion/);
  assert.match(view, /btn_saveDaySession/);
  assert.match(view, /holiday-date-open/);
  assert.match(view, /Discard unsaved changes/);
  assert.match(view, /syncYearModalKeyboardLock/);
  assert.match(view, /data-bs-keyboard/);
  assert.match(view, /renderHolidayDayOccasionsList/);
  assert.match(view, /persistDaySession/);
  assert.match(view, /hol_counts_as_off/);
  assert.match(view, /Cultural Observance \(School Open\)/);
  assert.match(view, /countsAsSchoolOff !== false/);
  assert.match(view, /dataset\.holidayDate/);
  assert.match(view, /modal-lg/);
  assert.match(view, /holiday-modal-above-year/);
});

test('holiday copy-year preserves countsAsSchoolOff', () => {
  const source = readPkg('MVC/services/school/holidayCopyYearService.js');
  assert.match(source, /countsAsSchoolOff/);
});

test('school calendar marks observance metadata', () => {
  const view = readPkg('MVC/services/school/schoolCalendarService.js');
  assert.match(view, /schoolClosed:/);
  assert.match(view, /holidayCountsAsSchoolOff/);
});