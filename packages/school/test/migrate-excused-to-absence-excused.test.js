const test = require('node:test');
const assert = require('node:assert/strict');

const migration = require('../../../scripts/school/migration/migrateExcusedToAbsenceExcused');

test('migrateRosterRow maps excused to absent + absenceExcused', () => {
  const result = migration.migrateRosterRow({ personId: 'P1', attendance: 'excused' });
  assert.equal(result.changed, true);
  assert.equal(result.row.attendance, 'absent');
  assert.equal(result.row.absenceExcused, true);
});

test('migrateRosterRow clears absenceExcused when not absent-like', () => {
  const result = migration.migrateRosterRow({
    personId: 'P1',
    attendance: 'present',
    absenceExcused: true
  });
  assert.equal(result.changed, true);
  assert.equal(result.row.absenceExcused, false);
});

test('migrateClassDocument strips excused from enabledAttendanceStatuses', () => {
  const result = migration.migrateClassDocument({
    id: 'CLASS-1',
    enabledAttendanceStatuses: ['present', 'late', 'excused', 'absent'],
    sessions: [{
      sessionId: 'S1',
      roster: [{ personId: 'P1', attendance: 'excused' }]
    }]
  });
  assert.equal(result.changed, true);
  assert.equal(result.excusedRowsMigrated, 1);
  assert.equal(result.enabledStatusesStripped, 1);
  assert.deepEqual(result.classRow.enabledAttendanceStatuses, ['present', 'late', 'absent']);
});
