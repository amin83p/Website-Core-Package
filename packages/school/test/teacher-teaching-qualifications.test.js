'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeTeachingQualifications } = require('../MVC/models/school/teacherModel');
const qualificationsService = require('../MVC/services/school/teacherTeachingQualificationsService');

test('sanitizeTeachingQualifications rejects overlapping rows for same department and program', () => {
  assert.throws(
    () => sanitizeTeachingQualifications([
      { departmentId: 'DEPT_A', programId: 'PROG_1', effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' },
      { departmentId: 'DEPT_A', programId: 'PROG_1', effectiveFrom: '2026-03-01', effectiveTo: '2026-12-31' }
    ]),
    /conflict/i
  );
});

test('validateAndSanitize rejects program from another department', () => {
  assert.throws(
    () => qualificationsService.validateAndSanitize(
      [{ departmentId: 'DEPT_A', programId: 'PROG_1' }],
      {
        orgId: 'ORG1',
        departments: [{ id: 'DEPT_A', orgId: 'ORG1' }, { id: 'DEPT_B', orgId: 'ORG1' }],
        programs: [{ id: 'PROG_1', orgId: 'ORG1', departmentId: 'DEPT_B' }]
      }
    ),
    /does not belong to the selected department/i
  );
});

test('teacherMatchesQualificationFilter requires active qualification in range', () => {
  const teacher = {
    teachingQualifications: [
      { departmentId: 'DEPT_A', programId: 'PROG_1', effectiveFrom: '2026-01-01', effectiveTo: '2026-03-31' }
    ]
  };
  assert.equal(
    qualificationsService.teacherMatchesQualificationFilter(teacher, {
      departmentId: 'DEPT_A',
      programId: 'PROG_1',
      startDate: '2026-04-01',
      endDate: '2026-04-30'
    }),
    false
  );
  assert.equal(
    qualificationsService.teacherMatchesQualificationFilter(teacher, {
      departmentId: 'DEPT_A',
      programId: 'PROG_1',
      startDate: '2026-02-01',
      endDate: '2026-02-28'
    }),
    true
  );
});
