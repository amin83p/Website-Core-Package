const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const reviewService = require('../packages/school/MVC/services/school/schoolSemiMonthlyReportReviewService');
const sessionReportInstanceService = require('../packages/school/MVC/services/school/sessionReportInstanceService');

test('periodOverlaps and targetRowOverlapsDateRange respect inclusive ranges', () => {
  assert.equal(reviewService.periodOverlaps('2026-03-01', '2026-03-15', '2026-03-10', '2026-03-31'), true);
  assert.equal(reviewService.periodOverlaps('2026-03-01', '2026-03-15', '2026-03-16', '2026-03-31'), false);
  assert.equal(reviewService.targetRowOverlapsDateRange({
    reportStartDate: '2026-04-01',
    reportDueDate: '2026-04-30'
  }, '2026-04-10', '2026-04-20'), true);
  assert.equal(reviewService.targetRowOverlapsDateRange({
    sessionDate: '2026-05-01'
  }, '2026-05-01', '2026-05-15'), true);
});

test('sortReviewRowsForTeacherSection orders by class then due date', () => {
  const sorted = reviewService.sortReviewRowsForTeacherSection([
    { className: 'Zeta', templateTitle: 'B', reportDueDate: '2026-03-20' },
    { className: 'Alpha', templateTitle: 'A', reportDueDate: '2026-03-01' },
    { className: 'Alpha', templateTitle: 'B', reportDueDate: '2026-03-15' }
  ]);
  assert.deepEqual(sorted.map((row) => row.className), ['Alpha', 'Alpha', 'Zeta']);
  assert.equal(sorted[1].reportDueDate, '2026-03-15');
});

test('buildRowLifecycleMeta collects lock and unlock targets', () => {
  const meta = reviewService.buildRowLifecycleMeta([
    { status: 'submitted', id: 'INS-1', studentId: 'STU-1' },
    { status: 'submitted', id: 'INS-2' },
    { status: 'locked', id: 'INS-3', studentId: 'STU-3' },
    { status: 'draft', id: 'INS-4', studentId: 'STU-4' }
  ], true);
  assert.equal(meta.canLockSubmitted, true);
  assert.deepEqual(meta.lockStudentIds, ['STU-1']);
  assert.deepEqual(meta.lockInstanceIds, ['INS-2']);
  assert.equal(meta.canUnlockLocked, true);
  assert.deepEqual(meta.unlockInstanceIds, ['INS-3']);
  const noUnlock = reviewService.buildRowLifecycleMeta([
    { status: 'locked', id: 'INS-9', studentId: 'STU-9' }
  ], false);
  assert.equal(noUnlock.canUnlockLocked, false);
  assert.deepEqual(noUnlock.unlockInstanceIds, []);
});

test('tallyInstanceProgress counts pending, draft, submitted, and locked', () => {
  const progress = reviewService.tallyInstanceProgress([
    { isPendingAssignment: true },
    { status: 'draft' },
    { status: 'submitted' },
    { status: 'locked' }
  ]);
  assert.deepEqual(progress, { pending: 1, draft: 1, submitted: 1, locked: 1, total: 4 });
  assert.match(reviewService.buildStatusSummary(progress), /not started/);
  assert.match(reviewService.buildStatusSummary(progress), /locked/);
});

test('buildAssignmentEditUrl targets assignment edit with rowId query', () => {
  const url = reviewService.buildAssignmentEditUrl('ASN-1', 'ROW-9');
  assert.match(url, /\/school\/reports\/assignments\/edit\/ASN-1/);
  assert.match(url, /[?&]rowId=ROW-9/);
});

test('buildSessionManageUrl and resolveSessionManageUrl link session-targeted assignments', () => {
  const manageUrl = reviewService.buildSessionManageUrl('CLS-1', 'SES-42');
  assert.equal(manageUrl, '/school/classes/CLS-1/sessions/SES-42');
  const resolved = reviewService.resolveSessionManageUrl(
    { classId: 'CLS-1', targetType: 'session', sessionId: 'SES-42' },
    { rowId: 'ROW-1', sessionId: 'SES-42', targetType: 'session' },
    'CLS-1'
  );
  assert.equal(resolved, manageUrl);
  assert.equal(reviewService.resolveSessionManageUrl(
    { classId: 'CLS-1', targetType: 'date', dueDate: '2026-03-01' },
    { rowId: 'ROW-1', sessionDate: '2026-03-01' },
    'CLS-1'
  ), '');
});

test('resolvePrimaryInstructorForClass prefers primary role over co-teachers', () => {
  const primary = reviewService.resolvePrimaryInstructorForClass({
    instructors: [
      { personId: 'SUB-1', name: 'Substitute Teacher', role: 'Co-teacher' },
      { personId: 'PRI-1', name: 'Taylor R.', role: 'Primary', primary: true }
    ]
  });
  assert.equal(primary.teacherId, 'PRI-1');
  assert.equal(primary.teacherName, 'Taylor R.');
});

test('filterRelatedInstanceRows keeps instances when session deliverer differs from instances', () => {
  const assignment = { id: 'ASN-1' };
  const targetRow = { rowId: 'ROW-1', teacherId: 'COVER-1' };
  const rows = reviewService.filterRelatedInstanceRows([
    { assignmentId: 'ASN-1', assignmentRowId: 'ROW-1', teacherId: 'PRI-1', status: 'draft' },
    { assignmentId: 'ASN-1', assignmentRowId: 'ROW-1', teacherId: 'COVER-1', status: 'submitted' },
    { assignmentId: 'ASN-1', assignmentRowId: 'ROW-OTHER', teacherId: 'PRI-1', status: 'draft' }
  ], assignment, targetRow);
  assert.equal(rows.length, 2);
  assert.ok(rows.some((row) => row.teacherId === 'PRI-1'));
  assert.ok(rows.some((row) => row.teacherId === 'COVER-1'));
});

test('review service links Fill Reports matrix for student-scoped assignments', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../packages/school/MVC/services/school/schoolSemiMonthlyReportReviewService.js'),
    'utf8'
  );
  assert.match(source, /\/school\/reports\/instances\/matrix\//);
  assert.match(source, /fillReportsUrl/);
});

test('mapRowToDto builds matrix href for each-student assignments', () => {
  const assignment = {
    id: 'ASN-REVIEW',
    templateId: 'TPL-1',
    classId: 'CLS-1',
    reportScope: 'each_student',
    status: 'active'
  };
  const assignmentMap = new Map([[ 'ASN-REVIEW', assignment ]]);
  const dto = sessionReportInstanceService.mapRowToDto({
    assignmentId: 'ASN-REVIEW',
    assignmentRowId: 'ROW-1',
    teacherId: 'TEA-1',
    studentId: 'STU-1',
    status: 'draft'
  }, assignmentMap);
  assert.match(dto.matrixHref, /\/school\/reports\/instances\/matrix\/ASN-REVIEW/);
  assert.match(dto.matrixHref, /assignmentRowId=ROW-1/);
  assert.match(dto.matrixHref, /teacherId=TEA-1/);
});