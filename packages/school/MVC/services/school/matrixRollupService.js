const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');

function assignmentsCategoryAveragePercents(cells, columns) {
  const percents = [];
  for (let i = 0; i < columns.length; i += 1) {
    const col = columns[i];
    const cell = cells[i];
    if (!col || !cell) continue;
    if (!col.includeInGradeCalculation) continue;
    if (!cell.effective) continue;
    if (cell.percent == null) continue;
    percents.push(Number(cell.percent));
  }
  if (!percents.length) return null;
  const sum = percents.reduce((a, b) => a + b, 0);
  return Math.round((sum / percents.length) * 100) / 100;
}

function computeFinalPercent(evaluation, attendancePct, assignmentsPct, midtermPct, finalExamPct) {
  const w = evaluation?.weights || {};
  const parts = [];
  if (Number(w.attendance) > 0 && attendancePct != null && !Number.isNaN(Number(attendancePct))) {
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
  const { classData, orgPolicyCatalog, evaluation } = context;
  const columns = Array.isArray(payload?.columns) ? payload.columns : [];
  const sessionIdSet = new Set(
    columns.map((col) => String(col?.sessionId || '').trim()).filter(Boolean)
  );
  const matrix = Array.isArray(payload?.matrix) ? payload.matrix : [];
  return {
    ...payload,
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
      const { finalPercent, parts } = computeFinalPercent(
        evaluation,
        attendancePct,
        assignmentsPct,
        null,
        null
      );
      const { _attendanceRecords, ...rest } = row;
      return {
        ...rest,
        _attendanceRecords,
        attendancePct,
        attendanceSummary: attSummary,
        assignmentsPct,
        finalPercent,
        finalParts: parts
      };
    })
  };
}

function summarizeGradesRollupsForRows(rows = [], columns = [], context = {}) {
  const { classData, orgPolicyCatalog, evaluation } = context;
  const rollups = {};
  const sessionIdSet = new Set(
    (Array.isArray(columns) ? columns : []).map((col) => String(col?.sessionId || '').trim()).filter(Boolean)
  );
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
    const { finalPercent, parts } = computeFinalPercent(
      evaluation,
      attendancePct,
      assignmentsPct,
      null,
      null
    );
    rollups[personId] = {
      attendancePct,
      attendanceSummary: attSummary,
      assignmentsPct,
      finalPercent,
      finalParts: parts
    };
  });
  return rollups;
}

module.exports = {
  rollupRecordsForStudentRow,
  recomputeAttendanceMatrixRollups,
  summarizeAttendanceRollupsForStudents,
  recomputeGradesMatrixRollups,
  summarizeGradesRollupsForRows
};
