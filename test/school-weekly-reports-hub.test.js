const test = require('node:test');
const assert = require('node:assert/strict');

const weeklyReportsHubService = require('../packages/school/MVC/services/school/weeklyReportsHubService');

test('countExpectedSessionsFromMatrixRow counts only expectedForSession records', () => {
  const count = weeklyReportsHubService.countExpectedSessionsFromMatrixRow({
    records: [
      { expectedForSession: true },
      { expectedForSession: false },
      { expectedForSession: true },
      {}
    ]
  });
  assert.equal(count, 2);
});

test('aggregateMatrixIntoStudentMap sums sessions and tracks class ids', () => {
  const studentMap = new Map();
  weeklyReportsHubService.aggregateMatrixIntoStudentMap(studentMap, 'CLS-1', [
    {
      studentRecordId: 'STU-1',
      personId: 'PER-1',
      name: 'Ada Lovelace',
      records: [{ expectedForSession: true }, { expectedForSession: true }]
    },
    {
      studentRecordId: 'STU-2',
      personId: 'PER-2',
      name: 'Grace Hopper',
      records: [{ expectedForSession: true }]
    }
  ]);
  weeklyReportsHubService.aggregateMatrixIntoStudentMap(studentMap, 'CLS-2', [
    {
      studentRecordId: 'STU-1',
      personId: 'PER-1',
      name: 'Ada Lovelace',
      records: [{ expectedForSession: true }]
    }
  ]);

  const rows = weeklyReportsHubService.mapStudentBoardRows(studentMap);
  assert.equal(rows.length, 2);

  const ada = rows.find((row) => row.studentId === 'STU-1');
  assert.ok(ada);
  assert.equal(ada.sessionCount, 3);
  assert.equal(ada.classCount, 2);
  assert.deepEqual(ada.classIds.sort(), ['CLS-1', 'CLS-2']);

  const grace = rows.find((row) => row.studentId === 'STU-2');
  assert.ok(grace);
  assert.equal(grace.sessionCount, 1);
  assert.equal(grace.classCount, 1);
});

test('mapStudentBoardRows includes zero-session enrolled students and filters by student or person id', () => {
  const studentMap = new Map();
  weeklyReportsHubService.aggregateMatrixIntoStudentMap(studentMap, 'CLS-9', [
    {
      studentRecordId: 'STU-A',
      personId: 'PER-A',
      name: 'Zero Sessions',
      records: []
    },
    {
      studentRecordId: 'STU-B',
      personId: 'PER-B',
      name: 'Has Sessions',
      records: [{ expectedForSession: true }]
    }
  ]);

  const allRows = weeklyReportsHubService.mapStudentBoardRows(studentMap);
  assert.equal(allRows.length, 2);
  const zeroRow = allRows.find((row) => row.studentId === 'STU-A');
  assert.ok(zeroRow);
  assert.equal(zeroRow.sessionCount, 0);

  const byStudent = weeklyReportsHubService.mapStudentBoardRows(studentMap, ['STU-B']);
  assert.equal(byStudent.length, 1);
  assert.equal(byStudent[0].studentId, 'STU-B');

  const byPerson = weeklyReportsHubService.mapStudentBoardRows(studentMap, ['PER-A']);
  assert.equal(byPerson.length, 1);
  assert.equal(byPerson[0].studentId, 'STU-A');
});

test('parseFilterIdList normalizes comma-separated ids', () => {
  assert.deepEqual(weeklyReportsHubService.parseFilterIdList('CLS-1, CLS-2'), ['CLS-1', 'CLS-2']);
  assert.deepEqual(weeklyReportsHubService.parseFilterIdList(['STU-1', 'STU-2']), ['STU-1', 'STU-2']);
});

test('countGradebooksInSessions sums gradebooks across sessions', () => {
  const count = weeklyReportsHubService.countGradebooksInSessions([
    { gradebooks: [{ id: 'GB-1' }, { id: 'GB-2' }] },
    { gradebooks: [{ id: 'GB-3' }] },
    { quizzes: [{ id: 'Q-1' }] },
    {}
  ]);
  assert.equal(count, 3);
});

test('summarizeClassAttendanceMatrix computes session averages and attendance counts', () => {
  const summary = weeklyReportsHubService.summarizeClassAttendanceMatrix([
    {
      records: [
        { expectedForSession: true, status: 'present' },
        { expectedForSession: true, status: 'absent' }
      ]
    },
    {
      records: [
        { expectedForSession: true, status: 'present', earlyLeaveMinutes: 10 },
        { expectedForSession: true, status: 'present', lateMinutes: 3 }
      ]
    }
  ], [
    { id: 'SES-1' },
    { id: 'SES-2' }
  ]);

  assert.equal(summary.sessionCount, 2);
  assert.equal(summary.avgStudentsPerSession, 2);
  assert.equal(summary.absenceCount, 1);
  assert.equal(summary.lateCount, 1);
  assert.equal(summary.earlyLeaveCount, 1);
});

test('buildClassBoardRow shapes class summary rows', () => {
  const row = weeklyReportsHubService.buildClassBoardRow(
    {
      id: 'CLS-1',
      title: 'Math 101',
      deliveryDepartmentId: 'DEPT-1',
      deliveryDepartmentName: 'Science'
    },
    {
      sessionCount: 4,
      avgStudentsPerSession: 12.3,
      absenceCount: 2,
      lateCount: 1,
      earlyLeaveCount: 0
    },
    5
  );

  assert.equal(row.classId, 'CLS-1');
  assert.equal(row.className, 'Math 101');
  assert.equal(row.departmentId, 'DEPT-1');
  assert.equal(row.departmentName, 'Science');
  assert.equal(row.sessionCount, 4);
  assert.equal(row.avgStudentsPerSession, 12.3);
  assert.equal(row.absenceCount, 2);
  assert.equal(row.lateCount, 1);
  assert.equal(row.earlyLeaveCount, 0);
  assert.equal(row.gradebookCount, 5);
});

test('classMatchesDepartment and filterClassesForWeeklyReports filter by deliveryDepartmentId', () => {
  const classes = [
    { id: 'CLS-1', title: 'Math', status: 'active', deliveryDepartmentId: 'DEPT-A' },
    { id: 'CLS-2', title: 'English', status: 'active', deliveryDepartmentId: 'DEPT-B' },
    { id: 'CLS-3', title: 'History', status: 'inactive', deliveryDepartmentId: 'DEPT-A' }
  ];

  assert.equal(weeklyReportsHubService.classMatchesDepartment(classes[0], 'DEPT-A'), true);
  assert.equal(weeklyReportsHubService.classMatchesDepartment(classes[0], 'DEPT-B'), false);
  assert.equal(weeklyReportsHubService.classMatchesDepartment(classes[0], ''), true);

  const filtered = weeklyReportsHubService.filterClassesForWeeklyReports(classes, {
    departmentId: 'DEPT-A'
  });
  assert.deepEqual(filtered.map((row) => row.id), ['CLS-1']);
});

test('filterSessionsForWeeklyReport applies date range and excludes cancelled sessions', () => {
  const statusMap = {
  };
  const filtered = weeklyReportsHubService.filterSessionsForWeeklyReport({
    sessions: [
      { date: '2026-01-05', status: 'scheduled' },
      { date: '2026-01-12', status: 'cancelled', notes: 'Holiday' },
      { date: '2026-02-02', status: 'scheduled' }
    ],
    statusMap,
    startDate: '2026-01-01',
    endDate: '2026-01-31'
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].date, '2026-01-05');
});

test('buildStudentSessionRows includes only expected sessions with labels', () => {
  const rows = weeklyReportsHubService.buildStudentSessionRows({
    records: [
      { expectedForSession: true, status: 'present', date: '2026-01-06', sessionId: 'SES-1' },
      { expectedForSession: false, status: 'absent', date: '2026-01-13', sessionId: 'SES-2' },
      { expectedForSession: true, status: 'late', lateMinutes: 4, date: '2026-01-20', sessionId: 'SES-3' }
    ]
  }, [
    { id: 'SES-1', date: '2026-01-06' },
    { id: 'SES-2', date: '2026-01-13' },
    { id: 'SES-3', date: '2026-01-20' }
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, '2026-01-06');
  assert.equal(rows[0].label, 'Present');
  assert.equal(rows[1].label, 'Late (4m)');
});

test('computeStudentAttendanceHealth scores present highest and absent lowest', () => {
  const allPresent = weeklyReportsHubService.computeStudentAttendanceHealth({
    records: [
      { expectedForSession: true, status: 'present' },
      { expectedForSession: true, status: 'present' }
    ]
  });
  const lateOnly = weeklyReportsHubService.computeStudentAttendanceHealth({
    records: [
      { expectedForSession: true, status: 'late', lateMinutes: 5 }
    ]
  });
  const absent = weeklyReportsHubService.computeStudentAttendanceHealth({
    records: [
      { expectedForSession: true, status: 'absent' }
    ]
  });

  assert.equal(allPresent, 100);
  assert.ok(lateOnly < 100);
  assert.ok(lateOnly > absent);
  assert.equal(absent, 0);
});

test('buildStudentSkillAverages buckets gradebook percents by skill', () => {
  const sessionsById = new Map([
    ['SES-1', {
      sessionId: 'SES-1',
      gradebooks: [{ id: 'GB-1', skills: ['listening', 'speaking'] }]
    }],
    ['SES-2', {
      sessionId: 'SES-2',
      gradebooks: [{ id: 'GB-2', skills: ['listening'] }]
    }]
  ]);
  const averages = weeklyReportsHubService.buildStudentSkillAverages({
    columns: [
      { kind: 'gradebook', sessionId: 'SES-1', itemId: 'GB-1', includeInGradeCalculation: true },
      { kind: 'gradebook', sessionId: 'SES-2', itemId: 'GB-2', includeInGradeCalculation: true }
    ],
    matrix: [{
      personId: 'PER-1',
      cells: [
        { effective: true, percent: 80 },
        { effective: true, percent: 90 }
      ]
    }]
  }, 'PER-1', sessionsById);

  const listening = averages.find((row) => row.skillId === 'listening');
  const speaking = averages.find((row) => row.skillId === 'speaking');
  assert.ok(listening);
  assert.equal(listening.averagePercent, 85);
  assert.ok(speaking);
  assert.equal(speaking.averagePercent, 80);
});

test('countStudentCases counts only matching person and sessions', () => {
  const sessionIdSet = new Set(['SES-1', 'SES-2']);
  const count = weeklyReportsHubService.countStudentCases([
    { studentPersonId: 'PER-1', sessionId: 'SES-1' },
    { studentPersonId: 'PER-1', sessionId: 'SES-9' },
    { studentPersonId: 'PER-2', sessionId: 'SES-1' }
  ], 'PER-1', sessionIdSet);
  assert.equal(count, 1);
});

test('buildWeeklyReportsStudentDetailRow shapes enriched student rows', () => {
  const row = weeklyReportsHubService.buildWeeklyReportsStudentDetailRow({
    studentId: 'STU-1',
    personId: 'PER-1',
    name: 'Ada',
    sessionCount: 2,
    attendanceHealth: 86,
    presentCount: 1,
    lateCount: 1,
    absenceCount: 0,
    sessions: [{ date: '2026-01-06', label: 'Present' }],
    skillAverages: [{ skillId: 'listening', skillLabel: 'Listening', averagePercent: 82.5 }],
    caseCount: 2,
    classIds: new Set(['CLS-1'])
  });

  assert.equal(row.studentId, 'STU-1');
  assert.equal(row.attendanceHealth, 86);
  assert.equal(row.sessions.length, 1);
  assert.equal(row.skillAverages[0].averagePercent, 82.5);
  assert.equal(row.caseCount, 2);
  assert.equal(row.classCount, 1);
});
