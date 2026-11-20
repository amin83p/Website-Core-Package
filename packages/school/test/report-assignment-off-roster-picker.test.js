'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const classEnrollmentReadService = require('../MVC/services/school/classEnrollmentReadService');
const classEnrollmentSessionApplicabilityService = require('../MVC/services/school/classEnrollmentSessionApplicabilityService');
const reportAssignmentStudentEligibilityService = require('../MVC/services/school/reportAssignmentStudentEligibilityService');
const pickerUi = require('../public/scripts/reportAssignmentStudentPickerUi.js');

test('assignment picker statuses include closed enrollments overlapping report window', () => {
  const statuses = new Set(classEnrollmentReadService.getAssignmentPickerRosterStatusesForClass({ registrationMode: 'term' }));
  const completedPeriod = {
    status: 'completed',
    startDate: '2026-09-01',
    endDate: '2026-11-16',
    completionDate: '2026-11-16'
  };
  const withdrawnPeriod = {
    status: 'withdrawn',
    startDate: '2026-09-01',
    endDate: '2026-11-16',
    completionDate: '2026-11-16'
  };
  assert.ok(statuses.has('completed'));
  assert.ok(statuses.has('withdrawn'));
  assert.equal(
    classEnrollmentReadService.periodOverlapsWindow(completedPeriod, '2026-10-01', '2026-10-15', statuses),
    true
  );
  assert.equal(
    classEnrollmentReadService.periodOverlapsWindow(withdrawnPeriod, '2026-10-01', '2026-10-15', statuses),
    true
  );
});

test('appendOffRosterPersistedStudents adds saved ids missing from eligible roster', async () => {
  const schoolDataService = require('../MVC/services/school/schoolDataService');
  const original = schoolDataService.fetchAllData;
  schoolDataService.fetchAllData = async () => [
    { id: 'STU-1', personId: '785382', name: 'Sarabpreet Singh' }
  ];
  try {
    const students = await reportAssignmentStudentEligibilityService.appendOffRosterPersistedStudents({
      students: [
        {
          personId: '100538',
          id: '100538',
          name: 'Active Student',
          eligibleSessionCount: 2,
          selectable: true
        }
      ],
      targetRows: [{ targetStudentIds: ['100538', '785382'] }],
      reqUser: { id: 'SYSTEM' },
      personMap: new Map()
    });
    const offRoster = students.find((row) => row.id === '785382');
    assert.ok(offRoster, 'expected off-roster persisted row');
    assert.equal(offRoster.offRosterPersisted, true);
    assert.equal(offRoster.selectable, false);
    assert.match(String(offRoster.ineligibleNote), /Deselect to remove/);
  } finally {
    schoolDataService.fetchAllData = original;
  }
});

test('picker shows off-roster student checked with enabled checkbox', () => {
  const html = pickerUi.buildPickerRowHtml({
    student: {
      id: '785382',
      name: 'Sarabpreet Singh',
      offRosterPersisted: true,
      selectable: false,
      eligibleSessionCount: 0,
      ineligibleNote: reportAssignmentStudentEligibilityService.OFF_ROSTER_PERSISTED_NOTE
    },
    checked: true,
    escapeHtml: (value) => String(value ?? '')
  });
  assert.match(html, /checked/);
  assert.doesNotMatch(html, /disabled/);
});

test('syncSelectionAfterFetch keeps off-roster persisted selections', () => {
  const synced = pickerUi.syncSelectionAfterFetch({
    students: [
      { id: '100538', eligibleSessionCount: 1 },
      { id: '785382', eligibleSessionCount: 0, offRosterPersisted: true, selectable: false }
    ],
    selectedIds: ['100538', '785382'],
    autoSelectAll: false,
    reportScope: 'each_student'
  });
  assert.deepEqual(synced.selectedIds.sort(), ['100538', '785382']);
});