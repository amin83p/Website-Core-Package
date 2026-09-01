const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const gradebookWeightService = require('./gradebookWeightService');

function assignmentsCategoryAveragePercents(cells, columns) {
  return gradebookWeightService.computeStudentPeriodAssignmentPercent(cells, columns);
}

const FINAL_COMPONENT_LABELS = {
  attendance: 'Attendance',
  assignments: 'Assignments',
  midterm: 'Midterm',
  finalExam: 'Final exam'
};

function computeMatrixFinalPercent(assignmentsPct) {
  if (assignmentsPct == null || Number.isNaN(Number(assignmentsPct))) return null;
  return Math.round(Number(assignmentsPct) * 100) / 100;
}

function buildMatrixGradeCalculationBreakdown({ cells, columns }) {
  const assignments = gradebookWeightService.buildStudentPeriodAssignmentBreakdown(cells, columns);
  const finalPercent = computeMatrixFinalPercent(assignments.assignmentsPercent);
  return {
    assignments,
    finalPercent
  };
}

function buildStudentGradeCalculationBreakdown({
  cells,
  columns,
  evaluation,
  attendancePct,
  includeAttendanceInFinal = false
}) {
  const assignments = gradebookWeightService.buildStudentPeriodAssignmentBreakdown(cells, columns);
  const assignmentsPct = assignments.assignmentsPercent;
  const { finalPercent, parts } = computeFinalPercent(
    evaluation,
    attendancePct,
    assignmentsPct,
    null,
    null,
    { includeAttendanceInFinal }
  );
  const finalWeightSum = parts.reduce((sum, part) => sum + part.weight, 0);
  const finalComponents = parts.map((part) => {
    const classWeightPercent = Number(part.weight);
    const categoryPercent = Number(part.pct);
    const contributionPercent = finalWeightSum
      ? Math.round((classWeightPercent * categoryPercent / finalWeightSum) * 100) / 100
      : null;
    return {
      key: part.key,
      label: FINAL_COMPONENT_LABELS[part.key] || part.key,
      classWeightPercent,
      categoryPercent,
      contributionPercent
    };
  });

  return {
    assignments,
    attendancePercent: attendancePct == null ? null : Number(attendancePct),
    includeAttendanceInFinal: Boolean(includeAttendanceInFinal),
    evaluationWeights: evaluation?.weights || {},
    finalComponents,
    finalWeightSum,
    finalPercent
  };
}

function computeFinalPercent(evaluation, attendancePct, assignmentsPct, midtermPct, finalExamPct, options = {}) {
  const w = evaluation?.weights || {};
  const includeAttendance = Boolean(options.includeAttendanceInFinal);
  const parts = [];
  if (includeAttendance && Number(w.attendance) > 0 && attendancePct != null && !Number.isNaN(Number(attendancePct))) {
    parts.push({ key: 'attendance', weight: Number(w.attendance), pct: Number(attendancePct) });
  }
  if (Number(w.assignments) > 0 && assignmentsPct != null && !Number.isNaN(Number(assignmentsPct))) {
    parts.push({ key: 'assignments', weight: Number(w.assignments), pct: Number(assignmentsPct) });
  }
  if (Number(w.midterm) > 0 && midtermPct != null && !Number.isNaN(Number(midtermPct))) {
    parts.push({ key: 'midterm', weight: Number(w.midterm), pct: Number(midtermPct) });
  }
  if (Number(w.finalExam) > 0 && finalExamPct != null && !Number.isNaN(Number(finalExamPct))) {
    parts.push({ key: 'finalExam', weight: Number(w.finalExam), pct: Number(finalExamPct) });
  }
  const sumW = parts.reduce((s, p) => s + p.weight, 0);
  if (!sumW) return { finalPercent: null, parts: [] };
  const finalPercent = parts.reduce((s, p) => s + p.weight * p.pct, 0) / sumW;
  return { finalPercent: Math.round(finalPercent * 100) / 100, parts };
}

function rollupRecordsForStudentRow(row = {}) {
  if (Array.isArray(row._rollupRecords) && row._rollupRecords.length) {
    return row._rollupRecords;
  }
  return Array.isArray(row.records) ? row.records : [];
}

function recomputeAttendanceMatrixRollups(payload = {}, context = {}) {
  const { classData, orgPolicyCatalog } = context;
  const matrix = Array.isArray(payload?.matrix) ? payload.matrix : [];
  return {
    ...payload,
    matrix: matrix.map((row) => {
      const { _rollupRecords, ...rest } = row;
      return {
        ...rest,
        summary: attendanceMatrixMetricsService.computeStudentMatrixSummary(
          rollupRecordsForStudentRow(row),
          classData,
          orgPolicyCatalog
        )
      };
    })
  };
}

function summarizeAttendanceRollupsForStudents(students = [], context = {}) {
  const { classData, orgPolicyCatalog } = context;
  const rollups = {};
  (Array.isArray(students) ? students : []).forEach((row) => {
    const personId = String(row?.personId || '').trim();
    if (!personId) return;
    rollups[personId] = attendanceMatrixMetricsService.computeStudentMatrixSummary(
      rollupRecordsForStudentRow(row),
      classData,
      orgPolicyCatalog
    );
  });
  return rollups;
}

function recomputeGradesMatrixRollups(payload = {}, context = {}) {
  const { classData, orgPolicyCatalog, evaluation, includeAttendanceInFinal = false, assignmentsOnlyFinal = false } = context;
  const columns = Array.isArray(payload?.columns) ? payload.columns : [];
  const sessionIdSet = new Set(
    columns.map((col) => String(col?.sessionId || '').trim()).filter(Boolean)
  );
  const matrix = Array.isArray(payload?.matrix) ? payload.matrix : [];
  const finalOptions = { includeAttendanceInFinal };
  return {
    ...payload,
    includeAttendanceInFinal: assignmentsOnlyFinal ? false : includeAttendanceInFinal,
    assignmentsOnlyFinal: Boolean(assignmentsOnlyFinal),
    matrix: matrix.map((row) => {
      const attendanceRecords = Array.isArray(row?._attendanceRecords)
        ? row._attendanceRecords.filter((rec) => sessionIdSet.has(String(rec?.sessionId || '').trim()))
        : [];
      const attSummary = attendanceMatrixMetricsService.computeStudentMatrixSummary(
        attendanceRecords,
        classData,
        orgPolicyCatalog
      );
      const attendancePct = attSummary.performancePercent;
      const assignmentsPct = assignmentsCategoryAveragePercents(row.cells, columns);
      let finalPercent;
      let parts;
      let gradeCalculationBreakdown;
      if (assignmentsOnlyFinal) {
        finalPercent = computeMatrixFinalPercent(assignmentsPct);
        parts = [];
        gradeCalculationBreakdown = buildMatrixGradeCalculationBreakdown({
          cells: row.cells,
          columns
        });
      } else {
        const computed = computeFinalPercent(
          evaluation,
          attendancePct,
          assignmentsPct,
          null,
          null,
          finalOptions
        );
        finalPercent = computed.finalPercent;
        parts = computed.parts;
        gradeCalculationBreakdown = buildStudentGradeCalculationBreakdown({
          cells: row.cells,
          columns,
          evaluation,
          attendancePct,
          includeAttendanceInFinal
        });
      }
      const { _attendanceRecords, ...rest } = row;
      return {
        ...rest,
        _attendanceRecords,
        attendancePct,
        attendanceSummary: attSummary,
        assignmentsPct,
        finalPercent,
        finalParts: parts,
        gradeCalculationBreakdown
      };
    })
  };
}

function summarizeGradesRollupsForRows(rows = [], columns = [], context = {}) {
  const {
    classData,
    orgPolicyCatalog,
    evaluation,
    includeAttendanceInFinal = false,
    assignmentsOnlyFinal = false
  } = context;
  const rollups = {};
  const sessionIdSet = new Set(
    (Array.isArray(columns) ? columns : []).map((col) => String(col?.sessionId || '').trim()).filter(Boolean)
  );
  const finalOptions = { includeAttendanceInFinal };
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const personId = String(row?.personId || '').trim();
    if (!personId) return;
    const attendanceRecords = Array.isArray(row?._attendanceRecords)
      ? row._attendanceRecords.filter((rec) => sessionIdSet.has(String(rec?.sessionId || '').trim()))
      : [];
    const attSummary = attendanceMatrixMetricsService.computeStudentMatrixSummary(
      attendanceRecords,
      classData,
      orgPolicyCatalog
    );
    const attendancePct = attSummary.performancePercent;
    const cells = Array.isArray(row?.cells) ? row.cells : [];
    const assignmentsPct = assignmentsCategoryAveragePercents(cells, columns);
    let finalPercent;
    let parts;
    let gradeCalculationBreakdown;
    if (assignmentsOnlyFinal) {
      finalPercent = computeMatrixFinalPercent(assignmentsPct);
      parts = [];
      gradeCalculationBreakdown = buildMatrixGradeCalculationBreakdown({ cells, columns });
    } else {
      const computed = computeFinalPercent(
        evaluation,
        attendancePct,
        assignmentsPct,
        null,
        null,
        finalOptions
      );
      finalPercent = computed.finalPercent;
      parts = computed.parts;
      gradeCalculationBreakdown = buildStudentGradeCalculationBreakdown({
        cells,
        columns,
        evaluation,
        attendancePct,
        includeAttendanceInFinal
      });
    }
    rollups[personId] = {
      attendancePct,
      attendanceSummary: attSummary,
      assignmentsPct,
      finalPercent,
      finalParts: parts,
      gradeCalculationBreakdown
    };
  });
  return rollups;
}

module.exports = {
  assignmentsCategoryAveragePercents,
  computeFinalPercent,
  computeMatrixFinalPercent,
  buildStudentGradeCalculationBreakdown,
  buildMatrixGradeCalculationBreakdown,
  rollupRecordsForStudentRow,
  recomputeAttendanceMatrixRollups,
  summarizeAttendanceRollupsForStudents,
  recomputeGradesMatrixRollups,
  summarizeGradesRollupsForRows
};
