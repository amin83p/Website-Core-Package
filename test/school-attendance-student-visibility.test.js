'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('attendance matrix includes student visibility dropdown and row hooks', () => {
  const view = read('packages/school/MVC/views/school/attendance/attendanceViewer.ejs');
  assert.match(view, /buildAttendanceStudentFilterDropdownHtml/);
  assert.match(view, /bindAttendanceStudentVisibilityDropdown/);
  assert.match(view, /applyAttendanceStudentVisibility/);
  assert.match(view, /matrix-student-filter-dropdown/);
  assert.match(view, /matrix-student-row/);
  assert.match(view, /attendanceVisiblePersonIds/);
  assert.match(view, /btn_matrixStudentSelectAll/);
  assert.match(view, /btn_matrixStudentClearAll/);
  assert.match(view, /mountStudentFilterDropdownOutside/);
  assert.match(view, /attendance-student-filter-menu-floating/);
  assert.match(view, /document\.body\.appendChild\(menu\)/);
});

test('attendance matrix print uses only visible students', () => {
  const view = read('packages/school/MVC/views/school/attendance/attendanceViewer.ejs');
  assert.match(view, /getVisibleAttendanceMatrixForPrint/);
  assert.match(view, /buildAttendancePrintDocument\(printData/);
  assert.match(view, /No visible students to print/);
});

test('attendance matrix print indexes session and attendance notes separately', () => {
  const view = read('packages/school/MVC/views/school/attendance/attendanceViewer.ejs');
  const collectNotesMatch = view.match(/function attPrintCollectNoteParts\(rec\) \{([\s\S]*?)\n    \}/);
  assert.ok(collectNotesMatch, 'attPrintCollectNoteParts should exist');
  assert.doesNotMatch(collectNotesMatch[1], /sessionLevelNote/);
  assert.match(collectNotesMatch[1], /rosterStudentNotes/);
  assert.match(collectNotesMatch[1], /rec\?\.comments/);
  assert.match(view, /function attPrintFormatCommentEntry\(comment, index = 0, total = 1\)/);
  assert.match(view, /function attPrintBuildSessionNoteIndex\(sessions = \[\], sessionNotesById = new Map\(\)\)/);
  assert.match(view, /session-fn-mark/);
  assert.match(view, /<h2>Session Notes<\/h2>/);
  assert.match(view, /<h2>Attendance Notes<\/h2>/);
  assert.match(view, /attendanceNoteMarkerFor\(name, rec\)/);
  assert.doesNotMatch(view, /day-session-note/);
});

test('attendance matrix save flow uses local cell patching and request-budget guards', () => {
  const view = read('packages/school/MVC/views/school/attendance/attendanceViewer.ejs');
  assert.match(view, /patchAttendanceMatrixCellAfterSave/);
  assert.match(view, /queueAttendanceScopedRollupRefresh/);
  assert.match(view, /refreshAttendanceDisplayRollups\(\{ personIds: queuedIds \}\)/);
  assert.match(view, /handleAttendanceActionStateFailure/);
  assert.match(view, /hydrateAttendanceBudgetFromApi/);
  assert.match(view, /window\.ATTENDANCE_ACTION_LIMITS/);
  assert.match(view, /resolveAttendanceActionStateId/);
  assert.match(view, /captureAttendanceMatrixFilterState/);
  assert.match(view, /buildAttendanceMatrixReloadUrl/);
  assert.match(view, /promptAttendanceMatrixReload/);
  assert.match(view, /ensureAttendanceRequestBudgetAvailable/);
  assert.match(view, /navigateAttendanceMatrixReload/);
  assert.match(view, /normalizeAttendanceRangeToken/);
  assert.match(view, /applyAttendanceRangeSelection\(normalizedRange\)/);
  assert.match(view, /ATTENDANCE_MATRIX_UI_REQUEST_LIMIT_OVERRIDE/);
  assert.match(view, /resolveEffectiveAttendanceRequestCount/);
  assert.match(view, /ATTENDANCE_MATRIX_MUTATION_BUDGET_SOURCES/);
  assert.match(view, /syncAttendanceRequestBudgetFromUsage/);
  assert.doesNotMatch(view, /near the session limit/);
});

test('master hub attendance includes student visibility dropdown for single and batch', () => {
  const hub = read('packages/school/MVC/views/school/masterAcademiaHub.ejs');
  assert.match(hub, /buildHubStudentFilterDropdownHtml/);
  assert.match(hub, /bindHubAttendanceStudentVisibility/);
  assert.match(hub, /applyHubAttendanceStudentVisibility/);
  assert.match(hub, /hub-student-filter-dropdown/);
  assert.match(hub, /hub-attendance-student-row/);
  assert.match(hub, /visibilityByKey/);
  assert.match(hub, /resetHubAttendanceVisibility/);
  assert.match(hub, /data-hub-attendance-scope/);
  assert.match(hub, /mountHubStudentFilterDropdownOutside/);
  assert.match(hub, /attendance-student-filter-menu-floating/);
  assert.match(hub, /document\.body\.appendChild\(menu\)/);
});
