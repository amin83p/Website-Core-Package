const test = require('node:test');
const assert = require('node:assert/strict');

const reportIntegrityService = require('../MVC/services/school/reportIntegrityService');
const {
  mapAssignmentDeletePreviewInstances,
  partitionAssignmentDeleteBlockers
} = require('../MVC/services/school/reportViewService');

test('resolveInstanceDeleteEligibility blocks locked instances', () => {
  const locked = reportIntegrityService.resolveInstanceDeleteEligibility('locked');
  assert.equal(locked.allowed, false);
  assert.match(locked.reason, /locked/i);
});

test('resolveInstanceDeleteEligibility allows draft and submitted instances', () => {
  assert.equal(reportIntegrityService.resolveInstanceDeleteEligibility('draft').allowed, true);
  assert.equal(reportIntegrityService.resolveInstanceDeleteEligibility('submitted').allowed, true);
  assert.equal(reportIntegrityService.resolveInstanceDeleteEligibility('archived').allowed, true);
});

test('mapAssignmentDeletePreviewInstances excludes pending rows and flags locked rows', () => {
  const rows = mapAssignmentDeletePreviewInstances([
    {
      id: 'RI-1',
      isPendingAssignment: true,
      teacherName: 'Pending Teacher',
      status: 'pending'
    },
    {
      id: 'RI-2',
      isPendingAssignment: false,
      teacherName: 'Teacher A',
      studentName: 'Student A',
      sessionDate: '2026-03-01',
      status: 'draft'
    },
    {
      id: 'RI-3',
      isPendingAssignment: false,
      teacherName: 'Teacher B',
      studentName: 'Whole class',
      sessionDate: '2026-03-02',
      status: 'locked'
    }
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 'RI-2');
  assert.equal(rows[0].canDelete, true);
  assert.equal(rows[1].id, 'RI-3');
  assert.equal(rows[1].canDelete, false);
  assert.match(rows[0].editUrl, /instances\/edit-v2\/RI-2/);
});

test('partitionAssignmentDeleteBlockers separates timesheet blockers', () => {
  const result = partitionAssignmentDeleteBlockers([
    { code: 'REPORT_INSTANCE', label: 'Report Instances', count: 2, section: 'reports' },
    { code: 'TIMESHEET_APPROVED_REF', label: 'Approved timesheet references', count: 1, section: 'timesheets' }
  ]);
  assert.equal(result.blockers.length, 2);
  assert.equal(result.timesheetBlockers.length, 1);
  assert.equal(result.timesheetBlockers[0].code, 'TIMESHEET_APPROVED_REF');
});
