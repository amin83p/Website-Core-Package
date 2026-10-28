const test = require('node:test');
const assert = require('node:assert/strict');

const {
  snapStudentProgressRange,
  clipStudentProgressRange,
  assembleStudentProgressReport
} = require('../MVC/services/school/studentProgressReportService');

function sessionRecord(date, status, sessionId) {
  return {
    sessionId,
    date,
    status,
    expectedForSession: true,
    scheduledMinutes: 60,
    lateMinutes: 0,
    earlyLeaveMinutes: 0
  };
}

test('Wednesday-to-Wednesday range snaps to Monday-Sunday and becomes two weeks', () => {
  const range = snapStudentProgressRange('2026-01-07', '2026-01-14');
  assert.equal(range.startDate, '2026-01-05');
  assert.equal(range.endDate, '2026-01-18');
  assert.deepEqual(range.weeks, [
    { startDate: '2026-01-05', endDate: '2026-01-11' },
    { startDate: '2026-01-12', endDate: '2026-01-18' }
  ]);
});

test('one student in two classes stays in two class blocks', () => {
  const weeks = snapStudentProgressRange('2026-01-05', '2026-01-11').weeks;
  const students = assembleStudentProgressReport({
    studentIds: ['student-1'],
    weeks,
    classes: [
      {
        classRow: { id: 'class-science', title: 'Science' },
        studentIds: ['student-1'],
        matrix: [{
          studentRecordId: 'student-1',
          personId: 'person-1',
          name: 'Ada Student',
          records: [sessionRecord('2026-01-06', 'present', 'science-1')]
        }],
        sessions: [{ id: 'science-1', date: '2026-01-06' }],
        caseRows: [],
        orgPolicyLayer: {}
      },
      {
        classRow: { id: 'class-math', title: 'Math' },
        studentIds: ['student-1'],
        matrix: [{
          studentRecordId: 'student-1',
          personId: 'person-1',
          name: 'Ada Student',
          records: [sessionRecord('2026-01-07', 'present', 'math-1')]
        }],
        sessions: [{ id: 'math-1', date: '2026-01-07' }],
        caseRows: [],
        orgPolicyLayer: {}
      }
    ]
  });

  assert.equal(students.length, 1);
  assert.deepEqual(students[0].classes.map((row) => row.className), ['Math', 'Science']);
  assert.equal(students[0].classes[0].classId, 'class-math');
  assert.equal(students[0].classes[1].classId, 'class-science');
  assert.equal(students[0].classes[0].weeks[0].sessions[0].sessionId, 'math-1');
  assert.equal(students[0].classes[1].weeks[0].sessions[0].sessionId, 'science-1');
  assert.equal(students[0].classes[0].weeks[0].punctuality.punctualityPercent, 100);
  assert.equal(students[0].classes[0].punctuality.punctualityPercent, 100);
});

test('a week with no expected sessions is omitted', () => {
  const weeks = snapStudentProgressRange('2026-01-05', '2026-01-18').weeks;
  const students = assembleStudentProgressReport({
    studentIds: ['student-1'],
    weeks,
    classes: [{
      classRow: { id: 'class-math', title: 'Math' },
      studentIds: ['student-1'],
      matrix: [{
        studentRecordId: 'student-1',
        personId: 'person-1',
        name: 'Ada Student',
        records: [
          sessionRecord('2026-01-06', 'present', 'math-1'),
          {
            sessionId: 'math-2',
            date: '2026-01-13',
            status: 'absent',
            expectedForSession: false,
            scheduledMinutes: 60
          }
        ]
      }],
      sessions: [
        { id: 'math-1', date: '2026-01-06' },
        { id: 'math-2', date: '2026-01-13' }
      ],
      caseRows: [],
      orgPolicyLayer: {}
    }]
  });

  const weeksOut = students[0].classes[0].weeks;
  assert.equal(weeksOut.length, 1);
  assert.equal(weeksOut[0].startDate, '2026-01-05');
  assert.equal(weeksOut[0].endDate, '2026-01-11');
});

test('engagement and attendance are computed from that week only', () => {
  const weeks = snapStudentProgressRange('2026-01-05', '2026-01-18').weeks;
  const students = assembleStudentProgressReport({
    studentIds: ['student-1'],
    weeks,
    classes: [{
      classRow: { id: 'class-math', title: 'Math' },
      studentIds: ['student-1'],
      matrix: [{
        studentRecordId: 'student-1',
        personId: 'person-1',
        name: 'Ada Student',
        records: [
          sessionRecord('2026-01-06', 'present', 'math-1'),
          sessionRecord('2026-01-13', 'absent', 'math-2')
        ]
      }],
      sessions: [
        { id: 'math-1', date: '2026-01-06' },
        { id: 'math-2', date: '2026-01-13' }
      ],
      caseRows: [
        { studentPersonId: 'person-1', sessionId: 'math-1', classId: 'class-math' }
      ],
      orgPolicyLayer: {}
    }]
  });

  const [presentWeek, absentWeek] = students[0].classes[0].weeks;
  assert.equal(presentWeek.attendance.presentCount, 1);
  assert.equal(presentWeek.attendance.absenceCount, 0);
  assert.equal(presentWeek.attendance.sessionCount, 1);
  assert.equal(presentWeek.engagement.percent, 100);
  assert.equal(presentWeek.engagement.scheduledMinutes, 60);
  assert.equal(presentWeek.caseCount, 1);
  assert.equal(presentWeek.sessions.length, 1);

  assert.equal(absentWeek.attendance.presentCount, 0);
  assert.equal(absentWeek.attendance.absenceCount, 1);
  assert.equal(absentWeek.attendance.sessionCount, 1);
  assert.equal(absentWeek.engagement.percent, 0);
  assert.equal(absentWeek.engagement.scheduledMinutes, 60);
  assert.equal(absentWeek.caseCount, 0);
});

test('today inside week two keeps that week and drops the following week', () => {
  const range = snapStudentProgressRange('2026-01-05', '2026-01-25');
  const clipped = clipStudentProgressRange(range, '2026-01-14');
  assert.deepEqual(clipped.weeks, [
    { startDate: '2026-01-05', endDate: '2026-01-11' },
    { startDate: '2026-01-12', endDate: '2026-01-18' }
  ]);
  assert.equal(clipped.endDate, '2026-01-18');
  assert.equal(clipped.loadEndDate, '2026-01-18');
  assert.equal(clipped.noStartedWeeks, false);
});

test('today inside week one drops the following week', () => {
  const range = snapStudentProgressRange('2026-01-05', '2026-01-18');
  const clipped = clipStudentProgressRange(range, '2026-01-07');
  assert.deepEqual(clipped.weeks, [
    { startDate: '2026-01-05', endDate: '2026-01-11' }
  ]);
  assert.equal(clipped.loadEndDate, '2026-01-11');
});

test('activity average uses only that week gradebook percents', () => {
  const weeks = snapStudentProgressRange('2026-01-05', '2026-01-18').weeks;
  const students = assembleStudentProgressReport({
    studentIds: ['student-1'],
    weeks,
    classes: [{
      classRow: { id: 'class-math', title: 'Math' },
      studentIds: ['student-1'],
      matrix: [{
        studentRecordId: 'student-1',
        personId: 'person-1',
        name: 'Ada Student',
        records: [
          sessionRecord('2026-01-06', 'present', 'math-1'),
          sessionRecord('2026-01-13', 'present', 'math-2')
        ]
      }],
      sessions: [
        { id: 'math-1', date: '2026-01-06' },
        { id: 'math-2', date: '2026-01-13' }
      ],
      caseRows: [],
      orgPolicyLayer: {},
      gradesColumns: [
        { kind: 'gradebook', date: '2026-01-06', includeInGradeCalculation: true },
        { kind: 'gradebook', date: '2026-01-06', includeInGradeCalculation: true },
        { kind: 'quiz', date: '2026-01-06', includeInGradeCalculation: true },
        { kind: 'gradebook', date: '2026-01-06', includeInGradeCalculation: false },
        { kind: 'gradebook', date: '2026-01-13', includeInGradeCalculation: true }
      ],
      gradesMatrix: [{
        personId: 'person-1',
        cells: [
          { effective: true, percent: 80 },
          { effective: true, percent: 60 },
          { effective: true, percent: 10 },
          { effective: true, percent: 0 },
          { effective: true, percent: 100 }
        ]
      }]
    }]
  });

  const [firstWeek, secondWeek] = students[0].classes[0].weeks;
  assert.equal(firstWeek.activityAveragePercent, 70);
  assert.equal(secondWeek.activityAveragePercent, 100);
});
