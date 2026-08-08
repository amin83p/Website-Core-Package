const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseMatrixWindowQuery,
  planAttendanceMatrixBuild,
  planGradesMatrixBuild,
  applyAttendanceMatrixWindow,
  applyGradesMatrixWindow,
  applyReportMatrixRowWindow
} = require('../MVC/services/school/matrixWindowService');

function buildAttendancePayload(studentCount, sessionCount) {
  const sessions = Array.from({ length: sessionCount }, (_, index) => ({
    id: `SES-${index + 1}`,
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    status: 'scheduled'
  }));
  const matrix = Array.from({ length: studentCount }, (_, studentIndex) => ({
    personId: `P-${studentIndex + 1}`,
    name: `Student ${studentIndex + 1}`,
    records: sessions.map((session) => ({
      sessionId: session.id,
      status: 'present'
    })),
    summary: { performancePercent: 100 }
  }));
  return { sessions, matrix };
}

test('applyAttendanceMatrixWindow slices students and sessions', () => {
  const payload = buildAttendancePayload(12, 25);
  const windowed = applyAttendanceMatrixWindow(payload, {
    applyWindow: true,
    studentOffset: 5,
    studentLimit: 4,
    sessionOffset: 10,
    sessionLimit: 8
  });

  assert.equal(windowed.matrix.length, 4);
  assert.equal(windowed.sessions.length, 8);
  assert.equal(windowed.matrix[0].personId, 'P-6');
  assert.equal(windowed.sessions[0].id, 'SES-11');
  assert.equal(windowed.window.hasMoreStudents, true);
  assert.equal(windowed.window.hasMoreSessions, true);
  assert.equal(windowed.window.totalStudents, 12);
  assert.equal(windowed.window.totalSessions, 25);
});

test('applyGradesMatrixWindow slices columns and students', () => {
  const columns = Array.from({ length: 30 }, (_, index) => ({
    colKey: `COL-${index + 1}`,
    label: `Item ${index + 1}`
  }));
  const matrix = Array.from({ length: 8 }, (_, studentIndex) => ({
    personId: `P-${studentIndex + 1}`,
    cells: columns.map(() => ({ score: 10 }))
  }));
  const windowed = applyGradesMatrixWindow({ columns, matrix }, {
    applyWindow: true,
    studentOffset: 2,
    studentLimit: 3,
    columnOffset: 15,
    columnLimit: 10
  });

  assert.equal(windowed.matrix.length, 3);
  assert.equal(windowed.columns.length, 10);
  assert.equal(windowed.matrix[0].personId, 'P-3');
  assert.equal(windowed.columns[0].colKey, 'COL-16');
  assert.equal(windowed.window.hasMoreColumns, true);
  assert.equal(windowed.window.hasMoreStudents, true);
});

test('applyReportMatrixRowWindow slices student rows only', () => {
  const rows = Array.from({ length: 75 }, (_, index) => ({
    studentId: `STU-${index + 1}`,
    studentName: `Student ${index + 1}`
  }));
  const windowed = applyReportMatrixRowWindow({ rows }, {
    applyWindow: true,
    studentOffset: 50,
    studentLimit: 50
  });

  assert.equal(windowed.rows.length, 25);
  assert.equal(windowed.rows[0].studentId, 'STU-51');
  assert.equal(windowed.window.hasMoreStudents, false);
  assert.equal(windowed.window.totalStudents, 75);
});

test('parseMatrixWindowQuery honors fullMatrix=1', () => {
  const params = parseMatrixWindowQuery({ fullMatrix: '1', studentLimit: '10' });
  assert.equal(params.applyWindow, false);
});

test('planAttendanceMatrixBuild resolves slice ranges before matrix assembly', () => {
  const plan = planAttendanceMatrixBuild(120, 80, {
    applyWindow: true,
    studentOffset: 10,
    studentLimit: 25,
    sessionOffset: 15,
    sessionLimit: 20
  });
  assert.equal(plan.studentStart, 10);
  assert.equal(plan.studentEnd, 35);
  assert.equal(plan.sessionStart, 15);
  assert.equal(plan.sessionEnd, 35);
  assert.equal(plan.window.totalStudents, 120);
  assert.equal(plan.window.totalSessions, 80);
  assert.equal(plan.window.hasMoreStudents, true);
  assert.equal(plan.window.hasMoreSessions, true);
});

test('planGradesMatrixBuild resolves student and column slice ranges', () => {
  const plan = planGradesMatrixBuild(60, 100, {
    applyWindow: true,
    studentOffset: 5,
    studentLimit: 10,
    columnOffset: 30,
    columnLimit: 15
  });
  assert.equal(plan.studentStart, 5);
  assert.equal(plan.studentEnd, 15);
  assert.equal(plan.columnStart, 30);
  assert.equal(plan.columnEnd, 45);
  assert.equal(plan.window.totalColumns, 100);
  assert.equal(plan.window.hasMoreColumns, true);
});
