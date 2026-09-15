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
