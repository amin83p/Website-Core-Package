const test = require('node:test');
const assert = require('node:assert/strict');
const feed = require('../MVC/services/school/studentAttendanceReportOverallFeedService');
const orderService = require('../MVC/services/school/studentAttendanceReportClassOrderService');

const slots = [
  { slotKey: 'T1', templateId: 'TPL', order: 1 },
  { slotKey: 'T2', templateId: 'TPL', order: 2 }
];

test('a class start time is the time shared by at least 80 percent of sessions', () => {
  const minutes = orderService.resolveDominantStartMinutes([
    { startTime: '09:00' },
    { startTime: '09:00' },
    { startTime: '09:00' },
    { startTime: '09:00' },
    { startTime: '13:00' }
  ]);
  assert.equal(minutes, 9 * 60);
});

test('October enrollment feeds two classes, then only the replacement class', () => {
  const { sourceRuns } = feed.buildOverallSlotRuns({
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    personId: 'P1',
    templateId: 'TPL',
    slots,
    classes: [
      {
        classId: 'AM1',
        className: 'Morning AM',
        teacherId: 'TCH',
        daypartRank: 0,
        enrollmentWindows: [{ start: '2026-10-01', end: '2026-10-12' }]
      },
      {
        classId: 'PM1',
        className: 'Afternoon PM',
        teacherId: 'TCH',
        daypartRank: 1,
        enrollmentWindows: [{ start: '2026-10-01', end: '2026-10-12' }]
      },
      {
        classId: 'NEW1',
        className: 'Replacement',
        teacherId: 'TCH',
        daypartRank: 2,
        enrollmentWindows: [{ start: '2026-10-13', end: '2026-10-31' }]
      }
    ]
  });
  const bySlot = new Map(sourceRuns.map((run) => [run.slotKey, run]));
  assert.equal(bySlot.get('T1').segments.length, 2);
  assert.equal(bySlot.get('T1').segments[0].classId, 'AM1');
  assert.equal(bySlot.get('T1').segments[0].reportDueDate, '2026-10-12');
  assert.equal(bySlot.get('T1').segments[1].classId, 'NEW1');
  assert.equal(bySlot.get('T1').segments[1].reportStartDate, '2026-10-13');
  assert.equal(bySlot.get('T2').classId, 'PM1');
  assert.equal(bySlot.get('T2').reportDueDate, '2026-10-12');
  assert.equal(bySlot.get('T2').segments, undefined);
});

test('a morning class change keeps the same afternoon class in one slot', () => {
  const { sourceRuns } = feed.buildOverallSlotRuns({
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    personId: 'P1',
    templateId: 'TPL',
    slots,
    classes: [
      {
        classId: 'AM1',
        className: 'Morning AM',
        teacherId: 'TCH',
        daypartRank: 0,
        enrollmentWindows: [{ start: '2026-10-01', end: '2026-10-10' }]
      },
      {
        classId: 'AM2',
        className: 'Morning AM 2',
        teacherId: 'TCH',
        daypartRank: 0,
        enrollmentWindows: [{ start: '2026-10-11', end: '2026-10-31' }]
      },
      {
        classId: 'PM1',
        className: 'Afternoon PM',
        teacherId: 'TCH',
        daypartRank: 1,
        enrollmentWindows: [{ start: '2026-10-01', end: '2026-10-31' }]
      }
    ]
  });
  const morning = sourceRuns.find((run) => run.slotKey === 'T1');
  const afternoon = sourceRuns.find((run) => run.slotKey === 'T2');
  assert.equal(morning.segments.length, 2);
  assert.deepEqual(morning.segments.map((row) => row.classId), ['AM1', 'AM2']);
  assert.equal(afternoon.classId, 'PM1');
  assert.equal(afternoon.reportStartDate, '2026-10-01');
  assert.equal(afternoon.reportDueDate, '2026-10-31');
});

test('two classes with attendance on the same day fill slot one then slot two', () => {
  const { sourceRuns } = feed.buildOverallSlotRuns({
    startDate: '2026-10-01',
    endDate: '2026-10-20',
    personId: 'P1',
    templateId: 'TPL',
    slots,
    classes: [
      {
        classId: 'EARLY',
        className: 'Nine AM first',
        teacherId: 'TCH',
        dominantStartMinutes: 9 * 60,
        enrollmentWindows: [{ start: '2026-10-01', end: '2026-10-10' }]
      },
      {
        classId: 'LATER',
        className: 'Nine AM second',
        teacherId: 'TCH',
        dominantStartMinutes: 9 * 60,
        enrollmentWindows: [{ start: '2026-10-08', end: '2026-10-20' }]
      }
    ]
  });
  const morning = sourceRuns.find((run) => run.slotKey === 'T1');
  const second = sourceRuns.find((run) => run.slotKey === 'T2');
  assert.deepEqual(morning.segments.map((row) => row.classId), ['EARLY', 'LATER']);
  assert.equal(morning.segments[0].reportStartDate, '2026-10-01');
  assert.equal(morning.segments[0].reportDueDate, '2026-10-10');
  assert.equal(morning.segments[1].reportStartDate, '2026-10-11');
  assert.equal(second.classId, 'LATER');
  assert.equal(second.reportStartDate, '2026-10-08');
  assert.equal(second.reportDueDate, '2026-10-10');
});

test('one class is fed for the whole report without reading each day', () => {
  const { sourceRuns } = feed.buildOverallSlotRuns({
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    personId: 'P1',
    templateId: 'TPL',
    slots,
    classes: [
      {
        classId: 'ONLY',
        className: 'Only class',
        teacherId: 'TCH',
        dominantStartMinutes: 9 * 60,
        enrollmentWindows: [{ start: '2026-10-05', end: '2026-10-10' }],
        days: [
          { date: '2026-10-05', hasSession: true, status: 'present' },
          { date: '2026-10-06', hasSession: false, status: '' }
        ]
      }
    ]
  });
  assert.equal(sourceRuns.length, 1);
  assert.equal(sourceRuns[0].slotKey, 'T1');
  assert.equal(sourceRuns[0].classId, 'ONLY');
  assert.equal(sourceRuns[0].reportStartDate, '2026-10-01');
  assert.equal(sourceRuns[0].reportDueDate, '2026-10-31');
  assert.equal(sourceRuns[0].segments, undefined);
});

test('two classes that cover the whole report fill both slots without a day walk', () => {
  const { sourceRuns } = feed.buildOverallSlotRuns({
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    personId: 'P1',
    templateId: 'TPL',
    slots,
    classes: [
      {
        classId: 'LATER',
        className: 'Afternoon',
        teacherId: 'TCH',
        dominantStartMinutes: 13 * 60,
        enrollmentWindows: [{ start: '2026-09-01', end: '2026-11-30' }]
      },
      {
        classId: 'EARLY',
        className: 'Morning',
        teacherId: 'TCH',
        dominantStartMinutes: 9 * 60,
        enrollmentWindows: [{ start: '2026-10-01', end: '' }]
      }
    ]
  });
  const first = sourceRuns.find((run) => run.slotKey === 'T1');
  const second = sourceRuns.find((run) => run.slotKey === 'T2');
  assert.equal(first.classId, 'EARLY');
  assert.equal(first.reportStartDate, '2026-10-01');
  assert.equal(first.reportDueDate, '2026-10-31');
  assert.equal(first.segments, undefined);
  assert.equal(second.classId, 'LATER');
  assert.equal(second.reportStartDate, '2026-10-01');
  assert.equal(second.reportDueDate, '2026-10-31');
  assert.equal(second.segments, undefined);
});

test('a weekend between the same class stays one report', () => {
  const session = (date, status) => ({ date, hasSession: true, status });
  const { sourceRuns } = feed.buildOverallSlotRuns({
    startDate: '2026-10-01',
    endDate: '2026-10-20',
    personId: 'P1',
    templateId: 'TPL',
    slots,
    classes: [
      {
        classId: 'AM',
        className: 'Morning',
        teacherId: 'TCH',
        dominantStartMinutes: 9 * 60,
        enrollmentWindows: [{ start: '2026-10-01', end: '2026-10-20' }],
        days: [session('2026-10-02', 'present'), session('2026-10-05', 'present')]
      },
      {
        classId: 'NEW',
        className: 'Later',
        teacherId: 'TCH',
        dominantStartMinutes: 10 * 60,
        enrollmentWindows: [{ start: '2026-10-15', end: '2026-10-20' }],
        days: [session('2026-10-15', 'absent')]
      }
    ]
  });
  const first = sourceRuns.find((run) => run.slotKey === 'T1');
  assert.equal(first.segments.length, 2);
  assert.equal(first.segments[0].classId, 'AM');
  assert.equal(first.segments[0].reportStartDate, '2026-10-02');
  assert.equal(first.segments[0].reportDueDate, '2026-10-14');
  assert.equal(first.segments[1].classId, 'NEW');
  assert.equal(first.segments[1].reportStartDate, '2026-10-15');
});

test('an empty attendance grid still fills slots from enrollment', () => {
  const days = [
    { date: '2026-10-01', hasSession: false, status: '' },
    { date: '2026-10-02', hasSession: false, status: '' }
  ];
  const { sourceRuns } = feed.buildOverallSlotRuns({
    startDate: '2026-10-01',
    endDate: '2026-10-02',
    personId: 'P1',
    templateId: 'TPL',
    slots,
    classes: [
      {
        classId: 'AM1',
        className: 'Morning AM',
        teacherId: 'TCH',
        daypartRank: 0,
        enrollmentWindows: [{ start: '2026-10-01', end: '2026-10-02' }],
        days
      }
    ]
  });
  assert.equal(sourceRuns.length, 1);
  assert.equal(sourceRuns[0].slotKey, 'T1');
  assert.equal(sourceRuns[0].classId, 'AM1');
  assert.equal(sourceRuns[0].reportStartDate, '2026-10-01');
  assert.equal(sourceRuns[0].reportDueDate, '2026-10-02');
});

test('merged class segments keep one period end date', () => {
  const merged = feed.mergeEngineResults([
    {
      rows: [{
        studentId: 'P1',
        payload: { placeholders: { report_period_start_date: '2026-10-01', report_period_due_date: '2026-10-12', report_period_month_name: 'October' } }
      }]
    },
    {
      rows: [{
        studentId: 'P1',
        payload: { placeholders: { report_period_start_date: '2026-10-13', report_period_due_date: '2026-10-31', report_period_month_name: 'October' } }
      }]
    }
  ]);
  const placeholders = merged.rows[0].payload.placeholders;
  assert.equal(placeholders.report_period_start_date, '2026-10-01');
  assert.equal(placeholders.report_period_due_date, '2026-10-31');
  assert.equal(placeholders.report_period_month_name, 'October');
  const braced = feed.mergeEngineResults([
    { rows: [{ studentId: 'P1', payload: { placeholders: { '{{report_period_due_date}}': '2026-10-12' } } }] },
    { rows: [{ studentId: 'P1', payload: { placeholders: { '{{report_period_due_date}}': '2026-10-31' } } }] }
  ]);
  assert.equal(braced.rows[0].payload.placeholders['{{report_period_due_date}}'], '2026-10-31');
  const presence = feed.mergeEngineResults([
    { rows: [{ studentId: 'P1', payload: { placeholders: { '{{attendance_presence_01}}': 'Y' } } }] },
    { rows: [{ studentId: 'P1', payload: { placeholders: { '{{attendance_presence_01}}': 'X' } } }] }
  ]);
  assert.equal(presence.rows[0].payload.placeholders['{{attendance_presence_01}}'], 'Y');
});
