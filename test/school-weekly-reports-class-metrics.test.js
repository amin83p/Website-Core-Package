const test = require('node:test');
const assert = require('node:assert/strict');
const weeklyReportsClassMetricsService = require('../packages/school/MVC/services/school/weeklyReportsClassMetricsService');
const attendanceMatrixMetricsService = require('../packages/school/MVC/services/school/attendanceMatrixMetricsService');

function buildStatusMap(entries = []) {
  const map = new Map();
  entries.forEach((row) => {
    map.set(row.code, row);
  });
  return map;
}

test('isWeeklyReportFinalizedSession treats makeup, merged, cancelled, and isFinal as finalized', () => {
  const statusMap = buildStatusMap([
    { code: 'completed', isFinal: true },
    { code: 'makeup_required', makeUpRequired: true },
    { code: 'merged', mergedSessionRequired: true },
    { code: 'cancelled', excludeFromAttendance: true },
    { code: 'scheduled', isFinal: false }
  ]);
  assert.equal(weeklyReportsClassMetricsService.isWeeklyReportFinalizedSession(statusMap, { status: 'completed' }), true);
  assert.equal(weeklyReportsClassMetricsService.isWeeklyReportFinalizedSession(statusMap, { status: 'makeup_required' }), true);
  assert.equal(weeklyReportsClassMetricsService.isWeeklyReportFinalizedSession(statusMap, { status: 'merged' }), true);
  assert.equal(weeklyReportsClassMetricsService.isWeeklyReportFinalizedSession(statusMap, { status: 'cancelled' }), true);
  assert.equal(weeklyReportsClassMetricsService.isWeeklyReportFinalizedSession(statusMap, { status: 'scheduled' }), false);
});

test('sessionHasNotes only checks session.notes', () => {
  assert.equal(weeklyReportsClassMetricsService.sessionHasNotes({ notes: ' hello ' }), true);
  assert.equal(weeklyReportsClassMetricsService.sessionHasNotes({ notes: '' }), false);
  assert.equal(weeklyReportsClassMetricsService.sessionHasNotes({}), false);
});

test('countUnmarkedAttendanceCells counts expected unmarked student-session cells', () => {
  const matrix = [{
    records: [
      { expectedForSession: true, status: attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT },
      { expectedForSession: true, status: '' },
      { expectedForSession: false, status: '' }
    ]
  }];
  const result = weeklyReportsClassMetricsService.countUnmarkedAttendanceCells(matrix, [
    { id: 'S1', date: '2026-01-01' },
    { id: 'S2', date: '2026-01-08' }
  ]);
  assert.equal(result.unmarkedCount, 1);
  assert.equal(result.sessionsWithUnmarked.length, 1);
  assert.equal(result.sessionsWithUnmarked[0].unmarkedCount, 1);
});

test('buildClassWeeklyMetrics summarizes session and attendance buckets', () => {
  const statusMap = buildStatusMap([
    { code: 'completed', isFinal: true },
    { code: 'scheduled', isFinal: false }
  ]);
  const built = weeklyReportsClassMetricsService.buildClassWeeklyMetrics({
    classRow: { id: 'CLS-1' },
    filteredSessions: [
      { sessionId: 'SES-1', date: '2026-01-01', status: 'completed', notes: 'note' },
      { sessionId: 'SES-2', date: '2026-01-08', status: 'scheduled', notes: '' }
    ],
    matrixPayload: {
      matrix: [{
        records: [
          { expectedForSession: true, status: 'present' },
          { expectedForSession: true, status: '' }
        ]
      }],
      sessions: [{ id: 'SES-1' }, { id: 'SES-2' }]
    },
    statusMap,
    orgCaches: {
      bookCoveringReports: [],
      reportAssignments: [],
      reportInstances: [],
      sessionStudentCases: []
    },
    startDate: '2026-01-01',
    endDate: '2026-01-31'
  });
  assert.equal(built.metrics.sessions.total, 2);
  assert.equal(built.metrics.sessions.finalized, 1);
  assert.equal(built.metrics.sessions.uncompleted, 1);
  assert.equal(built.metrics.notes.with, 1);
  assert.equal(built.metrics.notes.without, 1);
  assert.equal(built.metrics.attendance.unmarked, 1);
});

test('buildClassWeeklyMetrics buckets gradebooks and attendance minutes', () => {
  const statusMap = buildStatusMap([{ code: 'completed', isFinal: true }]);
  const built = weeklyReportsClassMetricsService.buildClassWeeklyMetrics({
    classRow: { id: 'CLS-1' },
    filteredSessions: [
      { sessionId: 'SES-1', date: '2026-01-01', status: 'completed', gradebooks: [{ id: 'G1' }] },
      { sessionId: 'SES-2', date: '2026-01-08', status: 'completed', gradebooks: [] }
    ],
    matrixPayload: {
      matrix: [{
        records: [
          { expectedForSession: true, status: 'absent', scheduledMinutes: 60 },
          { expectedForSession: true, status: 'late', lateMinutes: 15 },
          { expectedForSession: true, status: 'present', earlyLeaveMinutes: 10 }
        ]
      }],
      sessions: [{ id: 'SES-1' }]
    },
    statusMap,
    orgCaches: {
      bookCoveringReports: [],
      reportAssignments: [],
      reportInstances: [],
      sessionStudentCases: []
    },
    startDate: '2026-01-01',
    endDate: '2026-01-31'
  });
  assert.equal(built.metrics.gradebooks.with, 1);
  assert.equal(built.metrics.gradebooks.without, 1);
  assert.equal(built.metrics.attendance.absence.count, 1);
  assert.equal(built.metrics.attendance.absence.minutes, 60);
  assert.equal(built.metrics.attendance.late.count, 1);
  assert.equal(built.metrics.attendance.late.minutes, 15);
  assert.equal(built.metrics.attendance.early.count, 1);
  assert.equal(built.metrics.attendance.early.minutes, 10);
});

test('buildWeeklyReportsDrilldown attendanceAbsence lists sessions with absence detail', () => {
  const statusMap = buildStatusMap([{ code: 'completed', isFinal: true, label: 'Completed' }]);
  const drill = weeklyReportsClassMetricsService.buildWeeklyReportsDrilldown({
    metricKey: 'attendanceAbsence',
    classRow: { id: 'CLS-1' },
    filteredSessions: [
      { sessionId: 'SES-1', date: '2026-01-01', status: 'completed' },
      { sessionId: 'SES-2', date: '2026-01-08', status: 'completed' }
    ],
    matrixPayload: {
      matrix: [{
        records: [
          { expectedForSession: true, status: 'absent', scheduledMinutes: 45 },
          { expectedForSession: true, status: 'present' }
        ]
      }],
      sessions: [{ id: 'SES-1' }, { id: 'SES-2' }]
    },
    statusMap,
    orgCaches: {}
  });
  assert.equal(drill.rows.length, 1);
  assert.equal(drill.rows[0].sessionId, 'SES-1');
  assert.match(drill.rows[0].detail, /1 absence · 45 min/);
});

test('buildWeeklyReportsDrilldown returns uncompleted sessions only', () => {
  const statusMap = buildStatusMap([
    { code: 'completed', isFinal: true, label: 'Completed' },
    { code: 'scheduled', isFinal: false, label: 'Scheduled' }
  ]);
  const drill = weeklyReportsClassMetricsService.buildWeeklyReportsDrilldown({
    metricKey: 'sessionsUncompleted',
    classRow: { id: 'CLS-1' },
    filteredSessions: [
      { sessionId: 'SES-1', date: '2026-01-01', status: 'completed' },
      { sessionId: 'SES-2', date: '2026-01-08', status: 'scheduled', startTime: '09:00', endTime: '10:00' }
    ],
    matrixPayload: { matrix: [], sessions: [] },
    statusMap,
    orgCaches: {}
  });
  assert.equal(drill.rows.length, 1);
  assert.equal(drill.rows[0].sessionId, 'SES-2');
  assert.match(drill.rows[0].statusLabel, /Scheduled|scheduled/i);
});

test('summarizeReportInstancesForClass counts completed and incomplete instances', () => {
  const summary = weeklyReportsClassMetricsService.summarizeReportInstancesForClass({
    classId: 'CLS-1',
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    assignments: [{
      id: 'RA-1',
      classId: 'CLS-1',
      targetRows: [{ rowId: 'ROW-1', classId: 'CLS-1', sessionDate: '2026-01-10', status: 'active' }]
    }],
    instances: [
      { assignmentId: 'RA-1', assignmentRowId: 'ROW-1', classId: 'CLS-1', sessionDate: '2026-01-10', status: 'submitted' },
      { assignmentId: 'RA-1', assignmentRowId: 'ROW-1', classId: 'CLS-1', sessionDate: '2026-01-10', status: 'draft' }
    ]
  });
  assert.equal(summary.assigned, 2);
  assert.equal(summary.completed, 1);
  assert.equal(summary.incomplete, 1);
});
