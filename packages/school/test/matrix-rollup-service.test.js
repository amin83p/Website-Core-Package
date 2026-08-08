const test = require('node:test');
const assert = require('node:assert/strict');

const matrixRollupService = require('../MVC/services/school/matrixRollupService');

const classData = { enabledAttendanceStatuses: ['present', 'absent', 'not_applicable'] };
const orgPolicyCatalog = {};

test('attendance rollups recompute from windowed records only', () => {
  const payload = {
    matrix: [
      {
        personId: 'p1',
        records: [
          { status: 'present', sessionId: 's1' },
          { status: 'absent', sessionId: 's2' }
        ]
      }
    ]
  };
  const full = matrixRollupService.recomputeAttendanceMatrixRollups(payload, {
    classData,
    orgPolicyCatalog
  });
  assert.equal(full.matrix[0].summary.totalPresentSessions, 1);
  assert.equal(full.matrix[0].summary.totalAbsentSessions, 1);

  const windowed = matrixRollupService.recomputeAttendanceMatrixRollups({
    matrix: [{
      personId: 'p1',
      records: [{ status: 'present', sessionId: 's1' }]
    }]
  }, { classData, orgPolicyCatalog });
  assert.equal(windowed.matrix[0].summary.totalPresentSessions, 1);
  assert.equal(windowed.matrix[0].summary.totalAbsentSessions, 0);
});

test('summarizeAttendanceRollupsForStudents returns map keyed by personId', () => {
  const rollups = matrixRollupService.summarizeAttendanceRollupsForStudents([
    { personId: 'p1', records: [{ status: 'present' }] },
    { personId: 'p2', records: [{ status: 'absent' }] }
  ], { classData, orgPolicyCatalog });
  assert.equal(rollups.p1.totalPresentSessions, 1);
  assert.equal(rollups.p2.totalAbsentSessions, 1);
});

test('grades rollups filter attendance records to displayed column sessions', () => {
  const evaluation = {
    weights: { attendance: 50, assignments: 50 },
    passingScore: 60
  };
  const columns = [
    { sessionId: 's1', includeInGradeCalculation: true, label: 'Quiz 1' },
    { sessionId: 's2', includeInGradeCalculation: true, label: 'Quiz 2' }
  ];
  const row = {
    personId: 'p1',
    cells: [
      { percent: 80, effective: true, includeInGradeCalculation: true },
      { percent: 60, effective: true, includeInGradeCalculation: true }
    ],
    _attendanceRecords: [
      { sessionId: 's1', status: 'present' },
      { sessionId: 's2', status: 'absent' },
      { sessionId: 's3', status: 'absent' }
    ]
  };
  const allColumns = matrixRollupService.recomputeGradesMatrixRollups({
    columns,
    matrix: [row]
  }, { classData, orgPolicyCatalog, evaluation });
  assert.equal(allColumns.matrix[0].attendancePct, 50);
  assert.equal(allColumns.matrix[0].assignmentsPct, 70);
  assert.equal(allColumns.matrix[0].finalPercent, 60);

  const oneColumn = matrixRollupService.recomputeGradesMatrixRollups({
    columns: [columns[0]],
    matrix: [{
      ...row,
      cells: [row.cells[0]]
    }]
  }, { classData, orgPolicyCatalog, evaluation });
  assert.equal(oneColumn.matrix[0].attendancePct, 100);
  assert.equal(oneColumn.matrix[0].assignmentsPct, 80);
  assert.equal(oneColumn.matrix[0].finalPercent, 90);
});

test('summarizeGradesRollupsForRows matches recompute for displayed slice', () => {
  const evaluation = { weights: { attendance: 100 }, passingScore: 60 };
  const columns = [{ sessionId: 's1', includeInGradeCalculation: true }];
  const students = [{
    personId: 'p1',
    cells: [{ percent: 90, effective: true }],
    _attendanceRecords: [
      { sessionId: 's1', status: 'present' },
      { sessionId: 's2', status: 'absent' }
    ]
  }];
  const rollups = matrixRollupService.summarizeGradesRollupsForRows(
    students,
    columns,
    { classData, orgPolicyCatalog, evaluation }
  );
  assert.equal(rollups.p1.attendancePct, 100);
  assert.equal(rollups.p1.finalPercent, 100);
});
