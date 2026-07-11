const test = require('node:test');
const assert = require('node:assert/strict');

const applicabilityService = require('../MVC/services/school/classEnrollmentSessionApplicabilityService');
const alignmentService = require('../MVC/services/school/rollingEnrollmentSessionAlignmentService');
const attendanceMatrixMetricsService = require('../MVC/services/school/attendanceMatrixMetricsService');

const studentToPersonMap = new Map([['STU_001', 'PER_001']]);

const sessions = [
  {
    sessionId: 'SES_001',
    date: '2026-02-01',
    status: 'completed',
    roster: [{ personId: 'PER_001', attendance: attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT }]
  },
  {
    sessionId: 'SES_002',
    date: '2026-02-08',
    status: 'completed',
    roster: [{ personId: 'PER_001', attendance: attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT }]
  }
];

test('withdrawn date-window enrollment still gets consumed session summary', () => {
  const result = applicabilityService.resolveRollingEnrollmentApplicability({
    sessions,
    periodRows: [{
      id: 'PERIOD_001',
      studentId: 'STU_001',
      status: 'withdrawn',
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      targetSessionCount: 0
    }],
    studentToPersonMap,
    allowedStatuses: applicabilityService.ROLLING_DISPLAY_PERIOD_STATUSES
  });

  const summary = result.summariesByPeriodId.get('PERIOD_001');
  assert.ok(summary, 'withdrawn period should have applicability summary');
  assert.equal(summary.consumedCount, 2);
  assert.equal(summary.lastConsumedSession?.sessionId, 'SES_002');
});

test('withdrawn period is excluded from open-or-historical applicability set', () => {
  const result = applicabilityService.resolveRollingEnrollmentApplicability({
    sessions,
    periodRows: [{
      id: 'PERIOD_002',
      studentId: 'STU_001',
      status: 'withdrawn',
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      targetSessionCount: 0
    }],
    studentToPersonMap,
    allowedStatuses: applicabilityService.OPEN_OR_HISTORICAL_STATUSES
  });

  assert.equal(result.summariesByPeriodId.size, 0);
});

test('date-window enrollment with end date derives target from countable sessions in window', () => {
  const sessions = [
    { sessionId: 'SES_A', date: '2026-02-01', status: 'scheduled' },
    { sessionId: 'SES_B', date: '2026-02-08', status: 'scheduled' },
    { sessionId: 'SES_C', date: '2026-04-01', status: 'scheduled' }
  ];
  const displayTarget = alignmentService.resolveDisplaySessionTarget({
    sessions,
    startDate: '2026-01-01',
    endDate: '2026-03-31',
    targetSessionCount: 0,
    statusMap: {}
  });
  assert.equal(displayTarget.targetSource, 'date_window');
  assert.equal(displayTarget.effectiveTargetSessionCount, 2);
  assert.equal(displayTarget.windowSessionCount, 2);
});

test('open-ended enrollment without explicit target has no display target', () => {
  const displayTarget = alignmentService.resolveDisplaySessionTarget({
    sessions: [{ sessionId: 'SES_A', date: '2026-02-01', status: 'scheduled' }],
    startDate: '2026-01-01',
    endDate: '',
    targetSessionCount: 0,
    statusMap: {}
  });
  assert.equal(displayTarget.targetSource, 'none');
  assert.equal(displayTarget.effectiveTargetSessionCount, null);
});
