const test = require('node:test');
const assert = require('node:assert/strict');

const matrixRollupService = require('../MVC/services/school/matrixRollupService');

const classData = { enabledAttendanceStatuses: ['present', 'absent', 'not_applicable'] };
const orgPolicyCatalog = {};

test('attendance rollups use display records when _rollupRecords is absent', () => {
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

test('attendance rollups prefer _rollupRecords over windowed display records', () => {
  const windowedRecords = Array.from({ length: 8 }, () => ({
    status: 'present',
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    scheduledMinutes: 180
  }));
  const rollupRecords = [
    ...windowedRecords,
    { status: 'late', lateMinutes: 0, earlyLeaveMinutes: 60, scheduledMinutes: 180 }
  ];
  const payload = {
    matrix: [{
      personId: 'hamid',
      records: windowedRecords,
      _rollupRecords: rollupRecords
    }]
  };
  const out = matrixRollupService.recomputeAttendanceMatrixRollups(payload, {
    classData,
    orgPolicyCatalog
  });
  assert.equal(out.matrix[0].records.length, 8);
  assert.equal(out.matrix[0].summary.performancePercent, 96.3);
  assert.equal(out.matrix[0].summary.totalPresentSessions, 9);
});

test('summarizeAttendanceRollupsForStudents returns map keyed by personId', () => {
  const rollups = matrixRollupService.summarizeAttendanceRollupsForStudents([
    { personId: 'p1', records: [{ status: 'present' }] },
    { personId: 'p2', records: [{ status: 'absent' }] }
  ], { classData, orgPolicyCatalog });
  assert.equal(rollups.p1.totalPresentSessions, 1);
  assert.equal(rollups.p2.totalAbsentSessions, 1);
});

test('assignmentsOnlyFinal sets final equal to assignments with matrix breakdown', () => {
  const evaluation = {
    weights: { attendance: 50, assignments: 50 },
    passingScore: 60
  };
  const columns = [
    { sessionId: 's1', includeInGradeCalculation: true, label: 'Quiz 1', totalScore: 10, weight: 20, kind: 'gradebook' },
    { sessionId: 's2', includeInGradeCalculation: true, label: 'Quiz 2', totalScore: 20, weight: 30, kind: 'gradebook' }
  ];
  const row = {
    personId: 'p1',
    cells: [
      { percent: 80, score: 8, effective: true },
      { percent: 60, score: 12, effective: true }
    ],
    _attendanceRecords: [
      { sessionId: 's1', status: 'present' },
      { sessionId: 's2', status: 'absent' }
    ]
  };
  const out = matrixRollupService.recomputeGradesMatrixRollups({
    columns,
    matrix: [row]
  }, { classData, orgPolicyCatalog, evaluation, assignmentsOnlyFinal: true });
  assert.equal(out.matrix[0].assignmentsPct, 68);
  assert.equal(out.matrix[0].finalPercent, 68);
  assert.equal(out.matrix[0].gradeCalculationBreakdown.finalPercent, 68);
  assert.equal(out.matrix[0].gradeCalculationBreakdown.finalComponents, undefined);
  assert.equal(out.includeAttendanceInFinal, false);
});

test('buildMatrixGradeCalculationBreakdown omits class evaluation blend', () => {
  const columns = [
    { label: 'Quiz', includeInGradeCalculation: true, weight: 100, totalScore: 10, kind: 'gradebook', kindLabel: 'Gradebook', date: '2026-01-01' }
  ];
  const cells = [{ score: 8, percent: 80, effective: true }];
  const breakdown = matrixRollupService.buildMatrixGradeCalculationBreakdown({ cells, columns });
  assert.equal(breakdown.assignments.assignmentsPercent, 80);
  assert.equal(breakdown.finalPercent, 80);
  assert.equal(breakdown.finalComponents, undefined);
});

test('grades rollups filter attendance records to displayed column sessions', () => {
  const evaluation = {
    weights: { attendance: 50, assignments: 50 },
    passingScore: 60
  };
  const columns = [
    { sessionId: 's1', includeInGradeCalculation: true, label: 'Quiz 1', totalScore: 10 },
    { sessionId: 's2', includeInGradeCalculation: true, label: 'Quiz 2', totalScore: 20 }
  ];
  const row = {
    personId: 'p1',
    cells: [
      { percent: 80, score: 8, effective: true, includeInGradeCalculation: true },
      { percent: 60, score: 12, effective: true, includeInGradeCalculation: true }
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
  }, { classData, orgPolicyCatalog, evaluation, includeAttendanceInFinal: true });
  assert.equal(allColumns.matrix[0].attendancePct, 50);
  assert.equal(allColumns.matrix[0].assignmentsPct, 66.67);
  assert.equal(allColumns.matrix[0].finalPercent, 58.34);

  const excludedAttendance = matrixRollupService.recomputeGradesMatrixRollups({
    columns,
    matrix: [row]
  }, { classData, orgPolicyCatalog, evaluation, includeAttendanceInFinal: false });
  assert.equal(excludedAttendance.matrix[0].finalPercent, 66.67);

  const oneColumn = matrixRollupService.recomputeGradesMatrixRollups({
    columns: [columns[0]],
    matrix: [{
      ...row,
      cells: [row.cells[0]]
    }]
  }, { classData, orgPolicyCatalog, evaluation, includeAttendanceInFinal: true });
  assert.equal(oneColumn.matrix[0].attendancePct, 100);
  assert.equal(oneColumn.matrix[0].assignmentsPct, 80);
  assert.equal(oneColumn.matrix[0].finalPercent, 90);
});

test('assignmentsCategoryAveragePercents weights by activity total points when kind is not gradebook', () => {
  const columns = [
    { includeInGradeCalculation: true, totalScore: 10 },
    { includeInGradeCalculation: true, totalScore: 20 },
    { includeInGradeCalculation: true, totalScore: 50 }
  ];
  const cells = [
    { score: 8, percent: 80, effective: true },
    { score: 15, percent: 75, effective: true },
    { score: 30, percent: 60, effective: true }
  ];
  const weighted = matrixRollupService.assignmentsCategoryAveragePercents(cells, columns);
  assert.equal(weighted, Math.round((53 / 80) * 10000) / 100);
});

test('assignmentsCategoryAveragePercents counts absent applicable cells as 0%', () => {
  const columns = [
    { includeInGradeCalculation: true, totalScore: 10 },
    { includeInGradeCalculation: true, totalScore: 20 }
  ];
  const cells = [
    { score: 8, percent: 80, effective: true },
    { absent: true, effective: true }
  ];
  const weighted = matrixRollupService.assignmentsCategoryAveragePercents(cells, columns);
  assert.equal(weighted, Math.round((8 / 30) * 10000) / 100);
});

test('assignmentsCategoryAveragePercents uses explicit gradebook weights when kind is gradebook', () => {
  const columns = [
    { kind: 'gradebook', includeInGradeCalculation: true, totalScore: 10, weight: 20, colKey: 's1::gradebook::a' },
    { kind: 'gradebook', includeInGradeCalculation: true, totalScore: 20, weight: 30, colKey: 's1::gradebook::b' }
  ];
  const cells = [
    { score: 8, percent: 80, effective: true },
    { score: 15, percent: 75, effective: true }
  ];
  const weighted = matrixRollupService.assignmentsCategoryAveragePercents(cells, columns);
  assert.equal(weighted, 77);
});

test('grades rollups apply absent as 0 and exclude N/A from assignments average', () => {
  const evaluation = {
    weights: { attendance: 50, assignments: 50 },
    passingScore: 60
  };
  const columns = [
    { sessionId: 's1', includeInGradeCalculation: true, label: 'Quiz 1', totalScore: 10, weight: 20, kind: 'gradebook' },
    { sessionId: 's2', includeInGradeCalculation: true, label: 'Quiz 2', totalScore: 20, weight: 30, kind: 'gradebook' },
    { sessionId: 's3', includeInGradeCalculation: true, label: 'Quiz 3', totalScore: 30, weight: 50, kind: 'gradebook' }
  ];
  const row = {
    personId: 'p1',
    cells: [
      { percent: 80, score: 8, effective: true },
      { absent: true, effective: true },
      { notApplicable: true, effective: false }
    ],
    _attendanceRecords: [
      { sessionId: 's1', status: 'present' },
      { sessionId: 's2', status: 'absent' },
      { sessionId: 's3', status: 'not_applicable' }
    ]
  };
  const out = matrixRollupService.recomputeGradesMatrixRollups({
    columns,
    matrix: [row]
  }, { classData, orgPolicyCatalog, evaluation, includeAttendanceInFinal: false });
  assert.equal(out.matrix[0].assignmentsPct, 32);
  assert.equal(out.matrix[0].finalPercent, 32);
  assert.equal(out.matrix[0].gradeCalculationBreakdown.assignments.assignmentsPercent, 32);
  assert.equal(out.matrix[0].gradeCalculationBreakdown.finalPercent, 32);
});

test('buildStudentGradeCalculationBreakdown matches computeFinalPercent components', () => {
  const evaluation = { weights: { attendance: 40, assignments: 60 } };
  const columns = [
    { label: 'Quiz', includeInGradeCalculation: true, weight: 100, totalScore: 10, kind: 'gradebook', kindLabel: 'Gradebook', date: '2026-01-01' }
  ];
  const cells = [{ score: 8, percent: 80, effective: true }];
  const breakdown = matrixRollupService.buildStudentGradeCalculationBreakdown({
    cells,
    columns,
    evaluation,
    attendancePct: 90,
    includeAttendanceInFinal: true
  });
  assert.equal(breakdown.assignments.assignmentsPercent, 80);
  assert.equal(breakdown.finalPercent, 84);
  assert.equal(breakdown.finalComponents.length, 2);
  assert.equal(breakdown.finalComponents[0].key, 'attendance');
  assert.equal(breakdown.finalComponents[1].key, 'assignments');
});

test('summarizeGradesRollupsForRows matches recompute for displayed slice', () => {
  const evaluation = { weights: { attendance: 100 }, passingScore: 60 };
  const columns = [{ sessionId: 's1', includeInGradeCalculation: true, totalScore: 10 }];
  const students = [{
    personId: 'p1',
    cells: [{ percent: 90, score: 9, effective: true }],
    _attendanceRecords: [
      { sessionId: 's1', status: 'present' },
      { sessionId: 's2', status: 'absent' }
    ]
  }];
  const rollups = matrixRollupService.summarizeGradesRollupsForRows(
    students,
    columns,
    { classData, orgPolicyCatalog, evaluation, includeAttendanceInFinal: true }
  );
  assert.equal(rollups.p1.attendancePct, 100);
  assert.equal(rollups.p1.finalPercent, 100);
  assert.ok(rollups.p1.gradeCalculationBreakdown);
  assert.equal(rollups.p1.gradeCalculationBreakdown.finalPercent, 100);
});
