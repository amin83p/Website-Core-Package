'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const holidayCopyYearService = require('../MVC/services/school/holidayCopyYearService');

test('shiftHolidayDateToYear keeps month and day', () => {
  assert.equal(holidayCopyYearService.shiftHolidayDateToYear('2024-07-01', '2026'), '2026-07-01');
  assert.equal(holidayCopyYearService.shiftHolidayDateToYear('2024-12-25', '2025'), '2025-12-25');
});

test('shiftHolidayDateToYear maps Feb 29 to Feb 28 in non-leap target year', () => {
  assert.equal(holidayCopyYearService.shiftHolidayDateToYear('2024-02-29', '2025'), '2025-02-28');
  assert.equal(holidayCopyYearService.shiftHolidayDateToYear('2024-02-29', '2028'), '2028-02-29');
});

test('copyHolidaysFromYear skip mode creates new rows only', async () => {
  const holidays = [
    { id: 'H1', orgId: 'ORG1', date: '2024-01-01', title: 'New Year', type: 'National Holiday', notes: 'A' },
    { id: 'H2', orgId: 'ORG1', date: '2025-01-01', title: 'New Year', type: 'National Holiday', notes: 'B' }
  ];
  const added = [];
  const updated = [];

  const summary = await holidayCopyYearService.copyHolidaysFromYear({
    holidays,
    orgId: 'ORG1',
    sourceYear: '2024',
    targetYear: '2025',
    duplicateMode: 'skip',
    addFn: async (payload) => { added.push(payload); },
    updateFn: async (id, payload) => { updated.push({ id, payload }); }
  });

  assert.equal(summary.created, 0);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.updated, 0);
  assert.equal(added.length, 0);
});

test('copyHolidaysFromYear creates rows when target has no duplicate', async () => {
  const holidays = [
    { id: 'H1', orgId: 'ORG1', date: '2024-03-10', title: 'Break', type: 'School Break', notes: '' }
  ];
  const added = [];

  const summary = await holidayCopyYearService.copyHolidaysFromYear({
    holidays,
    orgId: 'ORG1',
    sourceYear: '2024',
    targetYear: '2025',
    duplicateMode: 'skip',
    addFn: async (payload) => { added.push(payload); },
    updateFn: async () => {}
  });

  assert.equal(summary.created, 1);
  assert.equal(added[0].date, '2025-03-10');
  assert.equal(added[0].title, 'Break');
});

test('copyHolidaysFromYear replace mode updates existing row', async () => {
  const holidays = [
    { id: 'H1', orgId: 'ORG1', date: '2024-06-01', title: 'PD Day', type: 'Staff Development', notes: 'old note' },
    { id: 'H2', orgId: 'ORG1', date: '2025-06-01', title: 'PD Day', type: 'Other', notes: 'existing' }
  ];
  const updated = [];

  const summary = await holidayCopyYearService.copyHolidaysFromYear({
    holidays,
    orgId: 'ORG1',
    sourceYear: '2024',
    targetYear: '2025',
    duplicateMode: 'replace',
    addFn: async () => {},
    updateFn: async (id, payload) => { updated.push({ id, payload }); }
  });

  assert.equal(summary.updated, 1);
  assert.equal(updated[0].id, 'H2');
  assert.equal(updated[0].payload.type, 'Staff Development');
  assert.equal(updated[0].payload.notes, 'old note');
});

test('copyHolidaysFromYear abort mode fails before writes', async () => {
  const holidays = [
    { id: 'H1', orgId: 'ORG1', date: '2024-06-01', title: 'PD Day', type: 'Staff Development', notes: '' },
    { id: 'H2', orgId: 'ORG1', date: '2025-06-01', title: 'PD Day', type: 'Other', notes: '' }
  ];
  let addCalls = 0;

  await assert.rejects(
    () => holidayCopyYearService.copyHolidaysFromYear({
      holidays,
      orgId: 'ORG1',
      sourceYear: '2024',
      targetYear: '2025',
      duplicateMode: 'abort',
      addFn: async () => { addCalls += 1; },
      updateFn: async () => {}
    }),
    (error) => {
      assert.equal(error.code, 'HOLIDAY_COPY_ABORT');
      assert.match(error.message, /Copy cancelled/);
      return true;
    }
  );
  assert.equal(addCalls, 0);
});

test('listDistinctHolidayYears returns sorted unique years', () => {
  const years = holidayCopyYearService.listDistinctHolidayYears([
    { date: '2023-01-01' },
    { date: '2025-05-05' },
    { date: '2024-12-25' },
    { date: 'bad' }
  ]);
  assert.deepEqual(years, ['2025', '2024', '2023']);
});
