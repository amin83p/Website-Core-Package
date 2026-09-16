const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const naLockService = require('../MVC/services/school/attendanceEnrollmentNaLockService');
const attendanceMatrixMetricsService = require('../MVC/services/school/attendanceMatrixMetricsService');

const personId = '362617';
const classId = 'CLS_646148';
const sessionId = 'SES-0013';
const session = { sessionId, date: '2026-06-10' };

const lockedPeriodRows = [{
  id: 'PER-1',
  classId,
  personId,
  enrollmentSessionMarks: [{
    sessionId,
    status: 'not_applicable',
    note: 'Office exempt',
    locked: true
  }]
}];

const onHoldPeriodRows = [{
  id: 'PER-2',
  classId,
  personId,
  enrollmentHoldPeriods: [{
    id: 'HOLD-1',
    status: 'applied',
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    reason: 'Medical leave'
  }]
}];

test('isEnrollmentNaLockActive detects locked enrollment session mark', () => {
  assert.equal(naLockService.isEnrollmentNaLockActive({
    periodRows: lockedPeriodRows,
    classId,
    session,
    personId
  }), true);
});

test('isEnrollmentNaLockActive detects on-hold N/A roster row', () => {
  const rosterRow = {
    personId,
    attendance: 'not_applicable',
    notes: 'Medical leave'
  };
  assert.equal(naLockService.isEnrollmentNaLockActive({
    periodRows: onHoldPeriodRows,
    classId,
    session,
    personId,
    rosterRow
  }), true);
});

test('requiresOverrideToLeaveNa only when leaving N/A while lock active', () => {
  const na = attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE;
  assert.equal(naLockService.requiresOverrideToLeaveNa({
    priorAttendance: na,
    nextAttendance: 'present',
    lockActive: true
  }), true);
  assert.equal(naLockService.requiresOverrideToLeaveNa({
    priorAttendance: na,
    nextAttendance: na,
    lockActive: true
  }), false);
  assert.equal(naLockService.requiresOverrideToLeaveNa({
    priorAttendance: na,
    nextAttendance: 'present',
    lockActive: false
  }), false);
});

test('assertCanLeaveEnrollmentNaLock denies without override', () => {
  assert.throws(() => {
    naLockService.assertCanLeaveEnrollmentNaLock({
      attendanceAccess: { canOverrideSessionLock: false },
      periodRows: lockedPeriodRows,
      classData: { id: classId },
      session,
      personId,
      priorAttendance: 'not_applicable',
      nextAttendance: 'present'
    });
  }, /enrollment on-hold or an enrollment office session exemption/i);
});

test('assertCanLeaveEnrollmentNaLock allows with canOverrideSessionLock', () => {
  assert.doesNotThrow(() => {
    naLockService.assertCanLeaveEnrollmentNaLock({
      attendanceAccess: { canOverrideSessionLock: true },
      periodRows: lockedPeriodRows,
      classData: { id: classId },
      session,
      personId,
      priorAttendance: 'not_applicable',
      nextAttendance: 'present'
    });
  });
});

test('listEnrollmentNaLockedPersonIdsForSession includes mark and on-hold roster rows', () => {
  const roster = [{ personId, attendance: 'not_applicable', notes: 'Medical leave' }];
  const ids = naLockService.listEnrollmentNaLockedPersonIdsForSession({
    periodRows: [...lockedPeriodRows, ...onHoldPeriodRows],
    classId,
    session,
    roster
  });
  assert.ok(ids.includes(personId));
});

test('requiresOverrideForEnrollmentNaLockedEdit blocks timing changes while on N/A', () => {
  const na = attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE;
  assert.equal(naLockService.requiresOverrideForEnrollmentNaLockedEdit({
    lockActive: true,
    priorAttendance: na,
    nextAttendance: na,
    priorRow: { attendance: na, lateMinutes: 0 },
    nextRow: { attendance: na, lateMinutes: 5 }
  }), true);
  assert.equal(naLockService.requiresOverrideForEnrollmentNaLockedEdit({
    lockActive: true,
    priorAttendance: na,
    nextAttendance: na,
    priorRow: { attendance: na, notes: 'a' },
    nextRow: { attendance: na, notes: 'b' }
  }), false);
});

test('attendance matrix view references enrollmentNaLock in status edit guards', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../MVC/views/school/attendance/attendanceViewer.ejs'),
    'utf8'
  );
  assert.match(source, /record\.enrollmentNaLock/);
  assert.match(source, /allowStatusEdit/);
  assert.match(source, /allowTimingEdit/);
  assert.match(source, /cell_modal_enrollment_na_lock_notice/);
});
