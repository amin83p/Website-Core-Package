const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const gradebookWeightService = require('./gradebookWeightService');

function resolveAssignmentCellScore(cell, total) {
  let score = cell?.score;
  if (score == null && cell?.percent != null && Number.isFinite(Number(cell.percent))) {
    score = (Number(cell.percent) / 100) * total;
  }
  if (score == null || !Number.isFinite(Number(score))) return null;
  return Number(score);
}

function assignmentsCategoryAveragePercents(cells, columns) {
  const gradebookPairs = [];
  let otherEarned = 0;
  let otherPossible = 0;

  for (let i = 0; i < columns.length; i += 1) {
    const col = columns[i];
    const cell = cells[i];
    if (!col || !cell) continue;
    if (!col.includeInGradeCalculation) continue;
    if (!cell.effective) continue;
    const total = Number(col.totalScore);
    if (!Number.isFinite(total) || total <= 0) continue;
    const score = resolveAssignmentCellScore(cell, total);
    if (score == null) continue;

    if (String(col.kind || '').trim().toLowerCase() === 'gradebook') {
      gradebookPairs.push({ col, cell, score, total });
      continue;
    }

    otherEarned += score;
    otherPossible += total;
  }

  const gradebookAvg = gradebookPairs.length
    ? gradebookWeightService.computeWeightedAveragePercent(
      gradebookPairs.map(({ col }, index) => ({
        id: String(col.colKey || col.itemId || `gb_${index}`).trim(),
        weight: gradebookWeightService.resolveActivityWeight(col),
        totalScore: Number(col.totalScore) || 0,
        includeInGradeCalculation: col.includeInGradeCalculation !== false
      })),
      (_, index) => {
        const pair = gradebookPairs[index];
        return {
          score: pair.score,
          totalScore: pair.total
        };
      }
    )
    : null;

  const otherAvg = otherPossible
    ? Math.round((otherEarned / otherPossible) * 10000) / 100
    : null;

  if (gradebookAvg != null && otherAvg != null) {
    const gbWeightSum = gradebookPairs.reduce(
      (sum, { col }) => sum + gradebookWeightService.resolveActivityWeight(col),
      0
    );
    const blendWeight = gbWeightSum + otherPossible;
    if (!blendWeight) return null;
    return Math.round((((gradebookAvg * gbWeightSum) + (otherAvg * otherPossible)) / blendWeight) * 100) / 100;
  }
  if (gradebookAvg != null) return gradebookAvg;
  if (otherAvg != null) return otherAvg;
  return null;
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
  const { classData, orgPolicyCatalog, evaluation, includeAttendanceInFinal = false } = context;
  const columns = Array.isArray(payload?.columns) ? payload.columns : [];
  const sessionIdSet = new Set(
    columns.map((col) => String(col?.sessionId || '').trim()).filter(Boolean)
  );
  const matrix = Array.isArray(payload?.matrix) ? payload.matrix : [];
  const finalOptions = { includeAttendanceInFinal };
  return {
    ...payload,
    includeAttendanceInFinal,
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
        null,
        finalOptions
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
  const { classData, orgPolicyCatalog, evaluation, includeAttendanceInFinal = false } = context;
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
    const { finalPercent, parts } = computeFinalPercent(
      evaluation,
      attendancePct,
      assignmentsPct,
      null,
      null,
      finalOptions
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
  assignmentsCategoryAveragePercents,
  computeFinalPercent,
  rollupRecordsForStudentRow,
  recomputeAttendanceMatrixRollups,
  summarizeAttendanceRollupsForStudents,
  recomputeGradesMatrixRollups,
  summarizeGradesRollupsForRows
};
