const test = require('node:test');
const assert = require('node:assert/strict');

const enrollmentMoveOneOnOneService = require('../MVC/services/school/enrollmentMoveOneOnOneService');
const scheduleMoveSessionsService = require('../MVC/services/school/scheduleMoveSessionsService');
const attendanceMatrixMetricsService = require('../MVC/services/school/attendanceMatrixMetricsService');

const sourcePeriod = {
  id: 'PER_SOURCE',
  studentId: 'STU_001',
  personId: 'PERSON_001',
  startDate: '2026-01-01',
  endDate: '',
  status: 'active'
};

test('selectSourceSessionsForEnrollmentMove keeps future sessions where student is on roster and not N/A', () => {
  const sessions = [
    {
      sessionId: 'S1',
      date: '2026-03-10',
      startTime: '09:00',
      endTime: '10:00',
      roster: [{ personId: 'PERSON_001', attendance: { status: 'present' } }]
    },
    {
      sessionId: 'S2',
      date: '2026-03-17',
      startTime: '09:00',
      endTime: '10:00',
      roster: []
    },
    {
      sessionId: 'S3',
      date: '2026-02-01',
      startTime: '09:00',
      endTime: '10:00',
      roster: [{ personId: 'PERSON_001', attendance: { status: 'present' } }]
    }
  ];
  const selected = enrollmentMoveOneOnOneService.selectSourceSessionsForEnrollmentMove({
    sourcePeriod,
    sourceSessions: sessions,
    moveStartDate: '2026-03-01',
    personId: 'PERSON_001'
  });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].sessionId, 'S1');
});

test('evaluateSessionTransferPlans preserves source session times on target', () => {
  const selectedSessions = [{
    sessionId: 'SRC_1',
    date: '2026-03-20',
    startTime: '14:30',
    endTime: '15:30',
    roster: []
  }];
  const targetSessions = [];
  const result = scheduleMoveSessionsService.evaluateSessionTransferPlans({
    selectedSessions,
    targetSessions,
    targetCapacity: 1,
    sourcePeriods: [sourcePeriod],
    targetPeriods: [],
    cycleStartDate: '2026-01-01',
    cycleEndDate: '2026-12-31'
  });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].action, 'create');
  assert.equal(result.plans[0].startTime, '14:30');
  assert.equal(result.plans[0].endTime, '15:30');
});

test('evaluateSessionTransferPlans blocks occupied one-on-one target slot', () => {
  const selectedSessions = [{
    sessionId: 'SRC_1',
    date: '2026-03-20',
    startTime: '14:30',
    endTime: '15:30',
    roster: []
  }];
  const targetSessions = [{
    sessionId: 'TGT_1',
    date: '2026-03-20',
    startTime: '14:30',
    endTime: '15:30',
    roster: [{ personId: 'OTHER', attendance: { status: 'present' } }]
  }];
  const targetPeriods = [{
    id: 'PER_TGT',
    studentId: 'STU_OTHER',
    startDate: '2026-01-01',
    endDate: '',
    status: 'active'
  }];
  const result = scheduleMoveSessionsService.evaluateSessionTransferPlans({
    selectedSessions,
    targetSessions,
    targetCapacity: 1,
    sourcePeriods: [sourcePeriod],
    targetPeriods,
    cycleStartDate: '2026-01-01',
    cycleEndDate: '2026-12-31'
  });
  assert.ok(result.blockers.some((row) => row.code === 'OCCUPIED_ONE_ON_ONE'));
});

test('buildMasterScheduleUrl includes person and date', () => {
  const url = enrollmentMoveOneOnOneService.buildMasterScheduleUrl({
    personId: 'TEACH_1',
    date: '2026-03-20',
    classId: 'CLS_TGT'
  });
  assert.match(url, /personId=TEACH_1/);
  assert.match(url, /date=2026-03-20/);
  assert.match(url, /classId=CLS_TGT/);
});
