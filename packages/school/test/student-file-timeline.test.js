'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sortTimelineEvents,
  computeTimelineDateRange,
  isValidTimelineDate,
  buildClbTooltipLines,
  buildEnrollmentTooltipLines,
  resolveTimelineEventSource,
  filterTimelineEventsByDateRange,
  parseTimelineLoadQuery,
  countEventsBySource,
  normalizeTimelineSources,
  pushSpanEvent,
  timelineSpanOverlapsFilter,
  buildOnHoldTooltipLines
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

test('resolveTimelineEventSource maps event types to load legend keys', () => {
  assert.equal(resolveTimelineEventSource('student_enrollment_start'), 'enrollment');
  assert.equal(resolveTimelineEventSource('class_enrollment_start'), 'enrollment');
  assert.equal(resolveTimelineEventSource('class_enrollment_on_hold'), 'enrollment');
  assert.equal(resolveTimelineEventSource('term_registration'), 'registration');
  assert.equal(resolveTimelineEventSource('clb_recorded'), 'clb');
  assert.equal(resolveTimelineEventSource('report_instance'), 'report');
  assert.equal(resolveTimelineEventSource('session_case'), 'case');
  assert.equal(resolveTimelineEventSource('activity'), 'activity');
});

test('filterTimelineEventsByDateRange keeps inclusive calendar bounds', () => {
  const rows = [
    { date: '2026-01-01' },
    { date: '2026-02-01' },
    { date: '2026-03-01' }
  ];
  const filtered = filterTimelineEventsByDateRange(rows, '2026-01-15', '2026-02-28');
  assert.deepEqual(filtered.map((row) => row.date), ['2026-02-01']);
});

test('parseTimelineLoadQuery parses sources and dates', () => {
  const parsed = parseTimelineLoadQuery({
    startDate: '2026-01-01',
    endDate: '2026-03-01',
    sources: 'enrollment,clb,report'
  });
  assert.equal(parsed.startDate, '2026-01-01');
  assert.equal(parsed.endDate, '2026-03-01');
  assert.deepEqual(parsed.sources, ['enrollment', 'clb', 'report']);
});

test('normalizeTimelineSources defaults to all keys when empty', () => {
  const all = normalizeTimelineSources([]);
  assert.ok(all.includes('enrollment'));
  assert.ok(all.includes('activity'));
  assert.equal(all.length, 7);
});

test('countEventsBySource tallies by resolved source', () => {
  const counts = countEventsBySource([
    { type: 'clb_recorded', source: 'clb' },
    { type: 'report_instance' },
    { type: 'report_instance' }
  ]);
  assert.equal(counts.clb, 1);
  assert.equal(counts.report, 2);
  assert.equal(counts.enrollment, 0);
});

test('computeTimelineDateRange includes span end dates', () => {
  const range = computeTimelineDateRange([
    { date: '2026-01-15' },
    { date: '2026-02-01', endDate: '2026-04-30', display: 'span' }
  ]);
  assert.deepEqual(range, { minDate: '2026-01-15', maxDate: '2026-04-30' });
});

test('filterTimelineEventsByDateRange keeps overlapping on-hold spans', () => {
  const span = {
    display: 'span',
    date: '2026-01-01',
    endDate: '2026-03-15',
    type: 'class_enrollment_on_hold'
  };
  assert.equal(timelineSpanOverlapsFilter(span, '2026-02-01', '2026-02-28'), true);
  assert.equal(timelineSpanOverlapsFilter(span, '2026-04-01', '2026-05-01'), false);
  const filtered = filterTimelineEventsByDateRange(
    [span, { date: '2026-05-01', type: 'class_enrollment_start' }],
    '2026-02-01',
    '2026-02-28'
  );
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].type, 'class_enrollment_on_hold');
});

test('pushSpanEvent rejects invalid or non-applied hold shapes', () => {
  const bag = [];
  pushSpanEvent(bag, {
    display: 'span',
    date: '2026-02-01',
    endDate: '2026-02-28',
    type: 'class_enrollment_on_hold',
    id: 'hold-1'
  });
  assert.equal(bag.length, 1);
  assert.equal(bag[0].source, 'enrollment');
  pushSpanEvent(bag, { display: 'span', date: '2026-02-28', endDate: '2026-02-01', type: 'class_enrollment_on_hold' });
  assert.equal(bag.length, 1);
});

test('buildOnHoldTooltipLines includes reason and session count', () => {
  const lines = buildOnHoldTooltipLines(
    { startDate: '2026-01-01', endDate: '2026-01-31', reason: 'Medical', sessionIds: ['S1', 'S2'] },
    { classTitle: 'ESL 101' }
  );
  assert.ok(lines.some((line) => line.includes('ESL 101')));
  assert.ok(lines.some((line) => line.includes('Medical')));
  assert.ok(lines.some((line) => line.includes('Sessions marked N/A: 2')));
});