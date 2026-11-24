'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sortTimelineEvents,
  computeTimelineDateRange,
  isValidTimelineDate,
  buildClbTooltipLines,
  buildEnrollmentTooltipLines
} = require('../MVC/services/school/studentFileTimelineService');

test('isValidTimelineDate accepts ISO calendar dates only', () => {
  assert.equal(isValidTimelineDate('2026-03-01'), true);
  assert.equal(isValidTimelineDate('2026-3-01'), false);
  assert.equal(isValidTimelineDate(''), false);
  assert.equal(isValidTimelineDate('not-a-date'), false);
});

test('computeTimelineDateRange returns min and max from events', () => {
  const range = computeTimelineDateRange([
    { date: '2026-02-15' },
    { date: '2026-01-01' },
    { date: 'invalid' },
    { date: '2026-12-31' }
  ]);
  assert.deepEqual(range, { minDate: '2026-01-01', maxDate: '2026-12-31' });
});

test('computeTimelineDateRange is empty when no valid dates', () => {
  assert.deepEqual(computeTimelineDateRange([]), { minDate: '', maxDate: '' });
  assert.deepEqual(computeTimelineDateRange([{ date: 'nope' }]), { minDate: '', maxDate: '' });
});

test('buildClbTooltipLines includes goal and result bands', () => {
  const lines = buildClbTooltipLines({
    goal: { listening: '5', speaking: '5' },
    result: { reading: '6', writing: '6' },
    note: 'Placement'
  });
  assert.ok(lines.some((line) => line.startsWith('Goal:')));
  assert.ok(lines.some((line) => line.startsWith('Result:')));
  assert.ok(lines.some((line) => line.startsWith('Note:')));
});

test('buildEnrollmentTooltipLines includes class and teacher', () => {
  const lines = buildEnrollmentTooltipLines({
    classTitle: 'ESL 101',
    teacherName: 'Alex Teacher'
  });
  assert.ok(lines.includes('Class: ESL 101'));
  assert.ok(lines.includes('Teacher: Alex Teacher'));
});

test('sortTimelineEvents orders by date then type', () => {
  const sorted = sortTimelineEvents([
    { id: 'b', date: '2026-02-01', type: 'class_enrollment_end', label: 'B' },
    { id: 'a', date: '2026-01-01', type: 'clb_recorded', label: 'A' },
    { id: 'c', date: '2026-02-01', type: 'class_enrollment_start', label: 'C' }
  ]);
  assert.equal(sorted[0].id, 'a');
  assert.equal(sorted[1].id, 'b');
  assert.equal(sorted[2].id, 'c');
});