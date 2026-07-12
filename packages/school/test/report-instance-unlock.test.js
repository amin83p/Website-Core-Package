const test = require('node:test');
const assert = require('node:assert/strict');

const reportIntegrityService = require('../MVC/services/school/reportIntegrityService');
const {
  mapAssignmentDeletePreviewInstances
} = require('../MVC/services/school/reportViewService');

test('resolveInstanceUnlockTargetStatus returns submitted when previously submitted', () => {
  const status = reportIntegrityService.resolveInstanceUnlockTargetStatus({
    status: 'locked',
    audit: { submittedAt: '2026-03-01T10:00:00.000Z' }
  });
  assert.equal(status, 'submitted');
});

test('resolveInstanceUnlockTargetStatus returns draft when never submitted', () => {
  const status = reportIntegrityService.resolveInstanceUnlockTargetStatus({
    status: 'locked',
    audit: { lockedAt: '2026-03-01T10:00:00.000Z' }
  });
  assert.equal(status, 'draft');
});

test('resolveInstanceDeleteEligibility still blocks locked instances', () => {
  const locked = reportIntegrityService.resolveInstanceDeleteEligibility('locked');
  assert.equal(locked.allowed, false);
  assert.match(locked.reason, /locked/i);
});

test('mapAssignmentDeletePreviewInstances sets canUnlock only for locked rows when admin flag is true', () => {
  const rows = mapAssignmentDeletePreviewInstances([
    {
      id: 'RI-1',
      isPendingAssignment: false,
      teacherName: 'Teacher A',
      studentName: 'Student A',
      sessionDate: '2026-03-01',
      status: 'draft'
    },
    {
      id: 'RI-2',
      isPendingAssignment: false,
      teacherName: 'Teacher B',
      studentName: 'Whole class',
      sessionDate: '2026-03-02',
      status: 'locked'
    }
  ], { canUnlockAssignmentInstances: true });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].canUnlock, false);
  assert.equal(rows[1].canUnlock, true);
});

test('mapAssignmentDeletePreviewInstances does not set canUnlock without admin flag', () => {
  const rows = mapAssignmentDeletePreviewInstances([
    {
      id: 'RI-2',
      isPendingAssignment: false,
      teacherName: 'Teacher B',
      studentName: 'Whole class',
      sessionDate: '2026-03-02',
      status: 'locked'
    }
  ]);

  assert.equal(rows[0].canUnlock, false);
});
