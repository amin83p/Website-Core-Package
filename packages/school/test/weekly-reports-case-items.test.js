const test = require('node:test');
const assert = require('node:assert/strict');

const weeklyReportsClassMetricsService = require('../MVC/services/school/weeklyReportsClassMetricsService');

test('buildStudentCaseSessionHref includes caseId query param', () => {
  const href = weeklyReportsClassMetricsService.buildStudentCaseSessionHref(
    'class-1',
    'session-2',
    'case-3'
  );
  assert.equal(
    href,
    '/school/classes/class-1/sessions/session-2?caseId=case-3'
  );
});

test('buildWeeklyReportCaseItem maps case fields and href', () => {
  const item = weeklyReportsClassMetricsService.buildWeeklyReportCaseItem(
    {
      id: 'case-abc',
      sessionId: 'sess-xyz',
      studentName: 'Jane Doe',
      category: 'Behavior',
      status: 'active',
      summary: 'Needs follow-up'
    },
    { id: 'class-1' },
    { date: '2026-03-10', startTime: '09:00', endTime: '10:00' }
  );
  assert.equal(item.caseId, 'case-abc');
  assert.equal(item.studentName, 'Jane Doe');
  assert.equal(item.statusLabel, 'Active');
  assert.equal(item.detail, 'Needs follow-up');
  assert.match(item.href, /caseId=case-abc/);
  assert.equal(item.date, '2026-03-10');
});

test('buildWeeklyReportsDrilldown studentCases rows include href', () => {
  const result = weeklyReportsClassMetricsService.buildWeeklyReportsDrilldown({
    metricKey: 'studentCases',
    classRow: { id: 'class-1' },
    filteredSessions: [{ id: 'sess-1', date: '2026-03-01', startTime: '08:00', endTime: '09:00' }],
    matrixPayload: { matrix: [] },
    statusMap: new Map(),
    orgCaches: {
      sessionStudentCases: [{
        id: 'case-1',
        classId: 'class-1',
        sessionId: 'sess-1',
        studentName: 'Sam',
        status: 'resolved',
        summary: 'Closed'
      }],
      bookCoveringReports: [],
      reportAssignments: [],
      reportInstances: []
    },
    startDate: '2026-03-01',
    endDate: '2026-03-31'
  });
  assert.equal(result.metricKey, 'studentCases');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].statusLabel, 'Resolved');
  assert.match(result.rows[0].href, /\?caseId=case-1$/);
});
