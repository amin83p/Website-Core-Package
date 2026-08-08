const DEFAULT_MATRIX_STUDENT_WINDOW = 50;
const MAX_MATRIX_STUDENT_WINDOW = 200;
const DEFAULT_MATRIX_SESSION_WINDOW = 20;
const MAX_MATRIX_SESSION_WINDOW = 60;
const DEFAULT_MATRIX_COLUMN_WINDOW = 40;
const MAX_MATRIX_COLUMN_WINDOW = 120;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseOffset(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function clampLimit(value, defaultLimit, maxLimit) {
  return Math.min(parsePositiveInt(value, defaultLimit), maxLimit);
}

function parseMatrixWindowQuery(query = {}, options = {}) {
  const studentLimitDefault = options.studentLimitDefault || DEFAULT_MATRIX_STUDENT_WINDOW;
  const sessionLimitDefault = options.sessionLimitDefault || DEFAULT_MATRIX_SESSION_WINDOW;
  const columnLimitDefault = options.columnLimitDefault || DEFAULT_MATRIX_COLUMN_WINDOW;
  const fullMatrix = String(query.fullMatrix || query.full || '').trim() === '1';

  return {
    studentOffset: parseOffset(query.studentOffset),
    studentLimit: clampLimit(query.studentLimit, studentLimitDefault, MAX_MATRIX_STUDENT_WINDOW),
    sessionOffset: parseOffset(query.sessionOffset),
    sessionLimit: clampLimit(query.sessionLimit, sessionLimitDefault, MAX_MATRIX_SESSION_WINDOW),
    columnOffset: parseOffset(query.columnOffset),
    columnLimit: clampLimit(query.columnLimit, columnLimitDefault, MAX_MATRIX_COLUMN_WINDOW),
    applyWindow: !fullMatrix
  };
}

function buildStudentWindowMeta(totalStudents, offset, loadedCount) {
  const studentOffset = Math.min(offset, totalStudents);
  const studentLimit = loadedCount;
  return {
    studentOffset,
    studentLimit,
    totalStudents,
    hasMoreStudents: studentOffset + studentLimit < totalStudents
  };
}

function buildSessionWindowMeta(totalSessions, offset, loadedCount) {
  const sessionOffset = Math.min(offset, totalSessions);
  const sessionLimit = loadedCount;
  return {
    sessionOffset,
    sessionLimit,
    totalSessions,
    hasMoreSessions: sessionOffset + sessionLimit < totalSessions
  };
}

function buildColumnWindowMeta(totalColumns, offset, loadedCount) {
  const columnOffset = Math.min(offset, totalColumns);
  const columnLimit = loadedCount;
  return {
    columnOffset,
    columnLimit,
    totalColumns,
    hasMoreColumns: columnOffset + columnLimit < totalColumns
  };
}

function resolveSliceRange(total, offset, limit, applyWindow, defaultLimit, maxLimit) {
  const safeTotal = Math.max(0, Number(total) || 0);
  if (!applyWindow) {
    return { start: 0, end: safeTotal, loaded: safeTotal, total: safeTotal };
  }
  const start = Math.min(parseOffset(offset), safeTotal);
  const end = Math.min(start + clampLimit(limit, defaultLimit, maxLimit), safeTotal);
  return { start, end, loaded: end - start, total: safeTotal };
}

function planAttendanceMatrixBuild(totalStudents, totalSessions, windowParams = {}) {
  const applyWindow = Boolean(windowParams.applyWindow);
  const studentRange = resolveSliceRange(
    totalStudents,
    windowParams.studentOffset,
    windowParams.studentLimit,
    applyWindow,
    DEFAULT_MATRIX_STUDENT_WINDOW,
    MAX_MATRIX_STUDENT_WINDOW
  );
  const sessionRange = resolveSliceRange(
    totalSessions,
    windowParams.sessionOffset,
    windowParams.sessionLimit,
    applyWindow,
    DEFAULT_MATRIX_SESSION_WINDOW,
    MAX_MATRIX_SESSION_WINDOW
  );
  return {
    applyWindow,
    studentStart: studentRange.start,
    studentEnd: studentRange.end,
    sessionStart: sessionRange.start,
    sessionEnd: sessionRange.end,
    window: {
      ...buildStudentWindowMeta(studentRange.total, studentRange.start, studentRange.loaded),
      ...buildSessionWindowMeta(sessionRange.total, sessionRange.start, sessionRange.loaded),
      fullMatrix: !applyWindow
    }
  };
}

function planGradesMatrixBuild(totalStudents, totalColumns, windowParams = {}) {
  const applyWindow = Boolean(windowParams.applyWindow);
  const studentRange = resolveSliceRange(
    totalStudents,
    windowParams.studentOffset,
    windowParams.studentLimit,
    applyWindow,
    DEFAULT_MATRIX_STUDENT_WINDOW,
    MAX_MATRIX_STUDENT_WINDOW
  );
  const columnRange = resolveSliceRange(
    totalColumns,
    windowParams.columnOffset,
    windowParams.columnLimit,
    applyWindow,
    DEFAULT_MATRIX_COLUMN_WINDOW,
    MAX_MATRIX_COLUMN_WINDOW
  );
  return {
    applyWindow,
    studentStart: studentRange.start,
    studentEnd: studentRange.end,
    columnStart: columnRange.start,
    columnEnd: columnRange.end,
    window: {
      ...buildStudentWindowMeta(studentRange.total, studentRange.start, studentRange.loaded),
      ...buildColumnWindowMeta(columnRange.total, columnRange.start, columnRange.loaded),
      fullMatrix: !applyWindow
    }
  };
}

function buildRosterLookupMaps(sessions = []) {
  const maps = new Map();
  (Array.isArray(sessions) ? sessions : []).forEach((ses) => {
    const sessionKey = String(ses?.sessionId || ses?.id || '').trim();
    if (!sessionKey) return;
    const byPerson = new Map();
    (Array.isArray(ses?.roster) ? ses.roster : []).forEach((row) => {
      const personId = String(row?.personId || '').trim();
      if (personId) byPerson.set(personId, row);
    });
    maps.set(sessionKey, byPerson);
  });
  return maps;
}

function rosterRecordForSession(rosterMaps, sessionRow, personId) {
  const sessionKey = String(sessionRow?.sessionId || sessionRow?.id || '').trim();
  const pid = String(personId || '').trim();
  if (!sessionKey || !pid) return null;
  return rosterMaps.get(sessionKey)?.get(pid) || null;
}

function applyAttendanceMatrixWindow(payload, windowParams = {}) {
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
  const matrix = Array.isArray(payload?.matrix) ? payload.matrix : [];
  const totalSessions = sessions.length;
  const totalStudents = matrix.length;

  if (!windowParams.applyWindow) {
    return {
      ...payload,
      window: {
        ...buildStudentWindowMeta(totalStudents, 0, totalStudents),
        ...buildSessionWindowMeta(totalSessions, 0, totalSessions),
        fullMatrix: true
      }
    };
  }

  const sessionStart = Math.min(windowParams.sessionOffset, totalSessions);
  const sessionEnd = Math.min(sessionStart + windowParams.sessionLimit, totalSessions);
  const studentStart = Math.min(windowParams.studentOffset, totalStudents);
  const studentEnd = Math.min(studentStart + windowParams.studentLimit, totalStudents);
  const windowedSessions = sessions.slice(sessionStart, sessionEnd);
  const windowedMatrix = matrix.slice(studentStart, studentEnd).map((row) => ({
    ...row,
    records: Array.isArray(row.records) ? row.records.slice(sessionStart, sessionEnd) : []
  }));

  return {
    ...payload,
    sessions: windowedSessions,
    matrix: windowedMatrix,
    window: {
      ...buildStudentWindowMeta(totalStudents, studentStart, windowedMatrix.length),
      ...buildSessionWindowMeta(totalSessions, sessionStart, windowedSessions.length),
      fullMatrix: false
    }
  };
}

function applyGradesMatrixWindow(payload, windowParams = {}) {
  const columns = Array.isArray(payload?.columns) ? payload.columns : [];
  const matrix = Array.isArray(payload?.matrix) ? payload.matrix : [];
  const totalColumns = columns.length;
  const totalStudents = matrix.length;

  if (!windowParams.applyWindow) {
    return {
      ...payload,
      window: {
        ...buildStudentWindowMeta(totalStudents, 0, totalStudents),
        ...buildColumnWindowMeta(totalColumns, 0, totalColumns),
        fullMatrix: true
      }
    };
  }

  const columnStart = Math.min(windowParams.columnOffset, totalColumns);
  const columnEnd = Math.min(columnStart + windowParams.columnLimit, totalColumns);
  const studentStart = Math.min(windowParams.studentOffset, totalStudents);
  const studentEnd = Math.min(studentStart + windowParams.studentLimit, totalStudents);
  const windowedColumns = columns.slice(columnStart, columnEnd);
  const windowedMatrix = matrix.slice(studentStart, studentEnd).map((row) => ({
    ...row,
    cells: Array.isArray(row.cells) ? row.cells.slice(columnStart, columnEnd) : []
  }));

  return {
    ...payload,
    columns: windowedColumns,
    matrix: windowedMatrix,
    window: {
      ...buildStudentWindowMeta(totalStudents, studentStart, windowedMatrix.length),
      ...buildColumnWindowMeta(totalColumns, columnStart, windowedColumns.length),
      fullMatrix: false
    }
  };
}

function applyReportMatrixRowWindow(payload, windowParams = {}) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const totalStudents = rows.length;

  if (!windowParams.applyWindow) {
    return {
      ...payload,
      window: {
        ...buildStudentWindowMeta(totalStudents, 0, totalStudents),
        fullMatrix: true
      }
    };
  }

  const studentStart = Math.min(windowParams.studentOffset, totalStudents);
  const studentEnd = Math.min(studentStart + windowParams.studentLimit, totalStudents);
  const windowedRows = rows.slice(studentStart, studentEnd);

  return {
    ...payload,
    rows: windowedRows,
    window: {
      ...buildStudentWindowMeta(totalStudents, studentStart, windowedRows.length),
      fullMatrix: false
    }
  };
}

module.exports = {
  DEFAULT_MATRIX_STUDENT_WINDOW,
  MAX_MATRIX_STUDENT_WINDOW,
  DEFAULT_MATRIX_SESSION_WINDOW,
  MAX_MATRIX_SESSION_WINDOW,
  DEFAULT_MATRIX_COLUMN_WINDOW,
  MAX_MATRIX_COLUMN_WINDOW,
  parseMatrixWindowQuery,
  planAttendanceMatrixBuild,
  planGradesMatrixBuild,
  buildRosterLookupMaps,
  rosterRecordForSession,
  applyAttendanceMatrixWindow,
  applyGradesMatrixWindow,
  applyReportMatrixRowWindow
};
