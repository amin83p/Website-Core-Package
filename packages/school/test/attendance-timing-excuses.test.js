const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const attendanceMatrixMetricsService = require('../MVC/services/school/attendanceMatrixMetricsService');
const attendanceExcelExportService = require('../MVC/services/school/attendanceExcelExportService');
const reportService = require('../MVC/services/school/reportService');
const {
  backfillRosterRow,
  backfillClassSessions
} = require('../../../scripts/school/migration/backfillAttendanceTimingExcuses');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const policy = attendanceMatrixMetricsService.resolvePolicy({}, {
  thresholdsEnabled: true,
  scheduledMinutes: 120,
  disqualifyLateMinutes: 30,
  disqualifyEarlyLeaveMinutes: 30,
  disqualifyCombinedMissedMinutes: 45
});

test('timing excuse flags remove late and early minutes from attendance penalty', () => {
  assert.equal(
    attendanceMatrixMetricsService.computePresenceRatio({ status: 'late', lateMinutes: 30 }, policy),
    0.75
  );
  assert.equal(
    attendanceMatrixMetricsService.computePresenceRatio({ status: 'late', lateMinutes: 30, lateExcused: true }, policy),
    1
  );
  assert.equal(
    attendanceMatrixMetricsService.computePresenceRatio({ status: 'late', earlyLeaveMinutes: 30 }, policy),
    0.75
  );
  assert.equal(
    attendanceMatrixMetricsService.computePresenceRatio({ status: 'late', earlyLeaveMinutes: 30, earlyLeaveExcused: true }, policy),
    1
  );
  assert.equal(
    attendanceMatrixMetricsService.computePresenceRatio({
      status: 'late',
      lateMinutes: 15,
      earlyLeaveMinutes: 20,
      lateExcused: true,
      earlyLeaveExcused: true
    }, policy),
    1
  );
});

test('roster rules default missing timing excuse flags to false and clear them without minutes', () => {
  const normalized = attendanceMatrixMetricsService.applyAttendanceMatrixRosterRules({
    attendance: 'present',
    lateMinutes: 12,
    earlyLeaveMinutes: 5
  }, policy, ['present', 'late', 'absent', 'not_applicable']);
  assert.equal(normalized.attendance, 'late');
  assert.equal(normalized.lateExcused, false);
  assert.equal(normalized.earlyLeaveExcused, false);

  const cleared = attendanceMatrixMetricsService.applyAttendanceMatrixRosterRules({
    attendance: 'late',
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    lateExcused: true,
    earlyLeaveExcused: true
  }, policy, ['present', 'late', 'absent', 'not_applicable']);
  assert.equal(cleared.lateExcused, false);
  assert.equal(cleared.earlyLeaveExcused, false);
});

test('excused timing minutes do not trigger absence thresholds', () => {
  const notExcused = attendanceMatrixMetricsService.applyAttendanceMatrixRosterRules({
    attendance: 'present',
    lateMinutes: 35
  }, policy, ['present', 'late', 'absent', 'not_applicable']);
  assert.equal(notExcused.attendance, 'absent');

  const excused = attendanceMatrixMetricsService.applyAttendanceMatrixRosterRules({
    attendance: 'present',
    lateMinutes: 35,
    lateExcused: true
  }, policy, ['present', 'late', 'absent', 'not_applicable']);
  assert.equal(excused.attendance, 'late');
  assert.equal(excused.lateMinutes, 35);
  assert.equal(excused.lateExcused, true);
});

test('attendance views and controller wire timing excuse fields', () => {
  const viewer = read('MVC/views/school/attendance/attendanceViewer.ejs');
  const sessionManager = read('MVC/views/school/class/sessionManager.ejs');
  const classForm = read('MVC/views/school/class/classForm.ejs');
  const controller = read('MVC/controllers/school/attendanceController.js');
  const routes = read('MVC/routes/attendanceRoutes.js');

  assert.match(viewer, /inp_cellLateExcused/);
  assert.match(viewer, /wrap_cellEarlyLeaveExcused/);
  assert.match(viewer, /syncTimingExcuseControls/);
  assert.match(viewer, /attendance-timing-excuse-left/);
  assert.match(viewer, /border:\s*3px\s+solid\s+#198754/);
  assert.match(viewer, /attendance-status-picker/);
  assert.match(viewer, /grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(viewer, /modal-dialog modal-xl/);
  assert.doesNotMatch(viewer, /btn_saveAttendanceTop/);
  assert.doesNotMatch(viewer, /btnSaveAttendanceTop/);
  assert.match(viewer, /btn_cellLateExcused/);
  assert.match(viewer, /btn_cellEarlyLeaveExcused/);
  assert.match(viewer, />Send Note</);
  assert.doesNotMatch(viewer, />Save Note</);
  assert.match(viewer, /captureAttendanceDetailsModalSnapshot/);
  assert.match(viewer, /isAttendanceDetailsModalDirty/);
  assert.match(viewer, /Unsaved attendance details/);
  assert.match(viewer, /Close without applying them/);
  assert.doesNotMatch(viewer, /Session note \(whole class\)/);
  assert.doesNotMatch(viewer, /det_sessionLevelNote/);
  assert.ok(
    viewer.indexOf('function syncTimingExcuseControls') < viewer.indexOf("document.addEventListener('DOMContentLoaded'"),
    'timing excuse sync helper must be global for openInteractiveModal'
  );
  assert.ok(
    viewer.indexOf('function attendanceFlagIsTrue') < viewer.indexOf("document.addEventListener('DOMContentLoaded'"),
    'timing excuse flag helper must be global for openInteractiveModal'
  );
  assert.match(sessionManager, /id="attendanceDetailsModal"/);
  assert.match(sessionManager, /modal-dialog modal-xl/);
  assert.doesNotMatch(sessionManager, /btnSaveDetailsTop/);
  assert.match(sessionManager, /btn_modalLateExcused/);
  assert.match(sessionManager, /btn_modalEarlyLeaveExcused/);
  assert.match(sessionManager, />Send Note</);
  assert.doesNotMatch(sessionManager, /Save Note Directly/);
  assert.match(sessionManager, /Unsaved attendance details/);
  assert.match(sessionManager, /lateExcused:\s*modalLateExcused === true/);
  assert.match(sessionManager, /earlyLeaveExcused:\s*modalEarlyLeaveExcused === true/);
  assert.match(classForm, /attStatus_late_excused/);
  assert.match(classForm, /attStatus_early_leave_excused/);
  assert.match(controller, /lateExcused/);
  assert.match(controller, /earlyLeaveExcused/);
  assert.match(routes, /\/api\/rollups'[\s\S]*?requireToken:\s*false/);
});

test('Excel export and report catalog expose timing excuse details', () => {
  assert.equal(
    attendanceExcelExportService.formatTimingMinutesFragment({
      status: 'late',
      lateMinutes: 12,
      lateExcused: true,
      earlyLeaveMinutes: 8,
      earlyLeaveExcused: true
    }),
    'Late 12m (excused) / Left Early 8m (excused)'
  );
  assert.equal(
    attendanceExcelExportService.buildStatusNoteText({
      status: 'late',
      lateMinutes: 12,
      lateExcused: true,
      earlyLeaveMinutes: 8,
      earlyLeaveExcused: true
    }),
    'Timing: Late 12m (excused) / Left Early 8m (excused)'
  );
  assert.equal(
    attendanceExcelExportService.formatExportCellDisplay({
      status: 'late',
      lateMinutes: 12,
      lateExcused: true,
      earlyLeaveMinutes: 8
    }),
    'L\nLate 12m (excused) / Left Early 8m (not excused)'
  );
  assert.equal(
    attendanceExcelExportService.buildStatusNoteText({
      status: 'late',
      earlyLeaveMinutes: 60,
      earlyLeaveExcused: false
    }),
    'Timing: Left Early 60m (not excused)'
  );

  const catalogKeys = Object.values(reportService.getPrefillCatalog()).flat().map((item) => item.key);
  assert.ok(catalogKeys.includes('student_late_excused_sessions'));
  assert.ok(catalogKeys.includes('student_attendance_span_early_leave_excused_minutes'));
  assert.ok(catalogKeys.includes('student_punctuality_span_late_excused_minutes'));
});

test('backfill adds false timing excuse flags only when timing minutes exist', () => {
  assert.deepEqual(
    backfillRosterRow({ personId: 'p1', lateMinutes: 10 }).row,
    { personId: 'p1', lateMinutes: 10, lateExcused: false }
  );
  assert.equal(
    backfillRosterRow({ personId: 'p2', earlyLeaveMinutes: 0 }).changed,
    false
  );
  const result = backfillClassSessions([
    {
      sessionId: 's1',
      roster: [
        { personId: 'p1', lateMinutes: 5 },
        { personId: 'p2', earlyLeaveMinutes: 6, earlyLeaveExcused: true }
      ]
    }
  ]);
  assert.equal(result.changedRosterRows, 1);
  assert.equal(result.sessions[0].roster[0].lateExcused, false);
  assert.equal(result.sessions[0].roster[1].earlyLeaveExcused, true);
});
