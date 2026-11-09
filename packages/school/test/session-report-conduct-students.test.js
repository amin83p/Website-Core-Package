const test = require('node:test');
const assert = require('node:assert/strict');

const sessionConductService = require('../MVC/services/school/sessionConductService');

function buildAssignment(overrides = {}) {
  return {
    id: 'ASN-1',
    classId: 'CLS-1',
    status: 'active',
    reportScope: 'each_student',
    targetRows: [{
      rowId: 'row-1',
      targetType: 'session',
      sessionId: 'SES-1',
      sessionDate: '2026-09-15',
      reportStartDate: '2026-09-15',
      reportDueDate: '2026-09-15',
      status: 'active',
      conductRequiredBeforeFill: true,
      targetStudentIds: ['STU-1', 'STU-2']
    }],
    ...overrides
  };
}

test('resolveSessionReportConductPersonIds uses report targetStudentIds not session roster', () => {
  const personIds = sessionConductService.resolveSessionReportConductPersonIds({
    assignments: [buildAssignment()],
    sessionContext: { classId: 'CLS-1', sessionId: 'SES-1', sessionDate: '2026-09-15' }
  });
  assert.deepEqual(personIds.sort(), ['STU-1', 'STU-2']);
});

test('resolveSessionReportConductPersonIds unions students across matching rows', () => {
  const personIds = sessionConductService.resolveSessionReportConductPersonIds({
    assignments: [buildAssignment({
      targetRows: [
        {
          rowId: 'row-1',
          targetType: 'session',
          sessionId: 'SES-1',
          sessionDate: '2026-09-15',
          status: 'active',
          conductRequiredBeforeFill: true,
          targetStudentIds: ['STU-1']
        },
        {
          rowId: 'row-2',
          targetType: 'session',
          sessionId: 'SES-1',
          sessionDate: '2026-09-15',
          status: 'active',
          conductRequiredBeforeFill: true,
          targetStudentIds: ['STU-2', 'STU-3']
        }
      ]
    })],
    sessionContext: { classId: 'CLS-1', sessionId: 'SES-1', sessionDate: '2026-09-15' }
  });
  assert.deepEqual(personIds.sort(), ['STU-1', 'STU-2', 'STU-3']);
});

test('resolveSessionReportConductPersonIds includes session roster for class scope when conduct required', () => {
  const personIds = sessionConductService.resolveSessionReportConductPersonIds({
    assignments: [buildAssignment({ reportScope: 'class' })],
    sessionContext: { classId: 'CLS-1', sessionId: 'SES-1', sessionDate: '2026-09-15' },
    sessionRoster: [{ personId: 'P1' }, { personId: 'P2' }]
  });
  assert.deepEqual(personIds.sort(), ['P1', 'P2']);
});

test('resolveSessionReportConductPersonIds falls back to session roster for each_student without targetStudentIds', () => {
  const personIds = sessionConductService.resolveSessionReportConductPersonIds({
    assignments: [buildAssignment({
      targetRows: [{
        rowId: 'row-1',
        targetType: 'session',
        sessionId: 'SES-1',
        sessionDate: '2026-09-15',
        status: 'active',
        conductRequiredBeforeFill: true,
        targetStudentIds: []
      }]
    })],
    sessionContext: { classId: 'CLS-1', sessionId: 'SES-1', sessionDate: '2026-09-15' },
    sessionRoster: [{ personId: 'P1' }, { personId: 'P2' }]
  });
  assert.deepEqual(personIds.sort(), ['P1', 'P2']);
});

test('resolveSessionReportConductPersonIds skips class scope assignments', () => {
  const personIds = sessionConductService.resolveSessionReportConductPersonIds({
    assignments: [buildAssignment({ reportScope: 'class' })],
    sessionContext: { classId: 'CLS-1', sessionId: 'SES-1', sessionDate: '2026-09-15' }
  });
  assert.deepEqual(personIds, []);
});

test('buildReportConductRoster includes selected students even when absent from session roster', () => {
  const roster = sessionConductService.buildReportConductRoster({
    personIds: ['STU-ONLY-REPORT'],
    sessionRoster: [{ personId: 'STU-ON-ROSTER', name: 'Roster Student' }],
    prefetchedStudents: [{ id: 'REG-1', personId: 'STU-ONLY-REPORT', name: 'Report Student' }]
  });
  assert.equal(roster.length, 1);
  assert.equal(roster[0].personId, 'STU-ONLY-REPORT');
  assert.equal(roster[0].name, 'Report Student');
});

test('buildReportConductRoster resolves synthetic row names from person records', () => {
  const roster = sessionConductService.buildReportConductRoster({
    personIds: ['474361'],
    sessionRoster: [{ personId: 'STU-ON-ROSTER', name: 'Roster Student' }],
    prefetchedStudents: [{ id: 'REG-474361', personId: '474361' }],
    prefetchedPersons: [{ id: '474361', name: { first: 'Jane', last: 'Example' } }]
  });
  assert.equal(roster.length, 1);
  assert.equal(roster[0].personId, '474361');
  assert.equal(roster[0].name, 'Jane Example');
});

test('buildReportConductRoster enriches session roster rows missing display names', () => {
  const roster = sessionConductService.buildReportConductRoster({
    personIds: ['474361'],
    sessionRoster: [{ personId: '474361', classEffortPercent: null }],
    prefetchedStudents: [{ id: 'REG-474361', personId: '474361', name: 'Report Student' }],
    prefetchedPersons: [{ id: '474361', name: { first: 'Jane', last: 'Example' } }]
  });
  assert.equal(roster.length, 1);
  assert.equal(roster[0].personId, '474361');
  assert.equal(roster[0].name, 'Jane Example');
});

test('buildReportConductRoster applies saved attendance display order', () => {
  const roster = sessionConductService.buildReportConductRoster({
    personIds: ['P_C', 'P_A', 'P_B'],
    sessionRoster: [
      { personId: 'P_A', name: 'Alpha' },
      { personId: 'P_B', name: 'Bravo' },
      { personId: 'P_C', name: 'Charlie' }
    ],
    attendanceRosterPersonOrder: ['P_C', 'P_B', 'P_A']
  });
  assert.deepEqual(roster.map((row) => row.personId), ['P_C', 'P_B', 'P_A']);
});

test('resolveVoluntaryConductPersonIds falls back to session roster without reqUser', async () => {
  const personIds = await sessionConductService.resolveVoluntaryConductPersonIds({
    classId: 'CLS-1',
    session: { date: '2026-09-15', roster: [{ personId: 'P1' }, { personId: 'P2' }] }
  });
  assert.deepEqual(personIds.sort(), ['P1', 'P2']);
});

test('resolveVoluntaryConductPersonIds prefers enrollment on session date', async (t) => {
  const enrollment = require('../MVC/services/school/classEnrollmentReadService');
  const original = enrollment.listPersonIdsOverlappingEnrollmentWindow;
  enrollment.listPersonIdsOverlappingEnrollmentWindow = async () => ({
    personIds: new Set(['ENROLLED-1', 'ENROLLED-2'])
  });
  t.after(() => {
    enrollment.listPersonIdsOverlappingEnrollmentWindow = original;
  });
  const personIds = await sessionConductService.resolveVoluntaryConductPersonIds({
    reqUser: { activeOrgId: 'ORG' },
    classId: 'CLS-1',
    classData: { id: 'CLS-1', orgId: 'ORG' },
    session: { date: '2026-09-15', roster: [{ personId: 'ATTEND-ONLY' }] }
  });
  assert.deepEqual(personIds.sort(), ['ENROLLED-1', 'ENROLLED-2']);
});

test('buildSessionReportConductUiPayload uses enrollment for voluntary conduct', async (t) => {
  const enrollment = require('../MVC/services/school/classEnrollmentReadService');
  const original = enrollment.listPersonIdsOverlappingEnrollmentWindow;
  enrollment.listPersonIdsOverlappingEnrollmentWindow = async () => ({
    personIds: new Set(['ENROLLED-ONLY'])
  });
  t.after(() => {
    enrollment.listPersonIdsOverlappingEnrollmentWindow = original;
  });
  const payload = await sessionConductService.buildSessionReportConductUiPayload({
    session: {
      sessionId: 'SES-1',
      date: '2026-09-15',
      conductReportStepEnabled: true,
      roster: [{ personId: 'ATTEND-ONLY', name: 'Attendance Only' }]
    },
    sessions: [{ sessionId: 'SES-1', date: '2026-09-15', roster: [{ personId: 'ATTEND-ONLY', name: 'Attendance Only' }] }],
    sessionRoster: [{ personId: 'ATTEND-ONLY', name: 'Attendance Only' }],
    assignmentMap: [],
    instanceRows: [],
    sessionId: 'SES-1',
    classId: 'CLS-1',
    reqUser: { activeOrgId: 'ORG' },
    classData: { id: 'CLS-1', orgId: 'ORG' },
    prefetchedStudents: [{ id: 'REG-1', personId: 'ENROLLED-ONLY', name: 'Enrolled Student' }]
  });
  assert.equal(payload.conductRequiredByAssignment, false);
  assert.equal(payload.reportConductRoster.length, 1);
  assert.equal(payload.reportConductRoster[0].personId, 'ENROLLED-ONLY');
});
