const test = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../MVC/services/school/studentAdmissionMergeRegistry');
const mergeService = require('../MVC/services/school/studentAdmissionMergeService');

const {
  transformStudentIdRows,
  transformPersonIdRows,
  transformSchedulePersonNotesDoc,
  readMergeStorePayload,
  mergeSessionsForPersonSwap,
  patchClassRosterMaps,
  assertStudentDeletionRegistryParity,
  rosterConflict,
  countPersonIdReferences
} = registry;

test('assertStudentDeletionRegistryParity covers school deletion student.fieldRules entities', () => {
  const parity = assertStudentDeletionRegistryParity();
  assert.equal(parity.missing.includes('classes'), false);
  assert.equal(parity.missing.includes('reportInstances'), false);
});

test('transformStudentIdRows updates reportInstances.studentId and targetKey', () => {
  const rows = [{
    id: 'RI-1',
    orgId: 'ORG-1',
    studentId: 'STU-B',
    targetKey: 'student:STU-B'
  }];
  const result = transformStudentIdRows('reportInstances', rows, 'STU-B', 'STU-A', 'ORG-1');
  assert.equal(result.count, 2);
  assert.equal(result.rows[0].studentId, 'STU-A');
  assert.equal(result.rows[0].targetKey, 'student:STU-A');
});

test('buildProgramRegistrationPlan keeps the oldest date and deletes the extra registration', () => {
  const main = { id: 'STU-A', orgId: 'ORG-1', personId: 'P-A' };
  const secondaries = [{ id: 'STU-B', orgId: 'ORG-1', personId: 'P-B' }];
  const programRows = [
    { id: 'PR-1', orgId: 'ORG-1', studentId: 'STU-A', programId: 'PROG-1', status: 'registered', registrationDate: '2024-05-01' },
    { id: 'PR-2', orgId: 'ORG-1', studentId: 'STU-B', programId: 'PROG-1', status: 'registered', registrationDate: '2020-01-15' }
  ];
  const plan = mergeService.buildProgramRegistrationPlan(main, secondaries, programRows, [
    { id: 'CEP-9', orgId: 'ORG-1', studentId: 'STU-B', classId: 'CLS-1', programId: 'PROG-1' }
  ]);
  assert.equal(plan.blocks.length, 0);
  assert.equal(plan.dateUpdates[0].registrationDate, '2020-01-15');
  assert.equal(plan.deletes[0].id, 'PR-2');
  assert.equal(plan.deletes[0].reason, 'duplicate');
});

test('buildProgramRegistrationPlan adopts a missing program using the oldest date', () => {
  const main = { id: 'STU-A', orgId: 'ORG-1', personId: 'P-A' };
  const secondaries = [{ id: 'STU-B', orgId: 'ORG-1', personId: 'P-B' }];
  const programRows = [
    { id: 'PR-2', orgId: 'ORG-1', studentId: 'STU-B', programId: 'PROG-2', status: 'registered', registrationDate: '2021-03-01' }
  ];
  const plan = mergeService.buildProgramRegistrationPlan(main, secondaries, programRows, [
    { id: 'CEP-9', orgId: 'ORG-1', studentId: 'STU-B', classId: 'CLS-2', programId: 'PROG-2' }
  ]);
  assert.equal(plan.adopts[0].id, 'PR-2');
  assert.equal(plan.adopts[0].registrationDate, '2021-03-01');
  assert.equal(plan.deletes.length, 0);
});

test('buildEnrollmentPeriodPlan keeps earliest start when both have same class', () => {
  const main = { id: 'STU-A', orgId: 'ORG-1', personId: 'P-A' };
  const secondaries = [{ id: 'STU-B', orgId: 'ORG-1', personId: 'P-B' }];
  const periodRows = [
    { id: 'CEP-1', orgId: 'ORG-1', studentId: 'STU-A', classId: 'CLS-1', startDate: '2024-02-01', endDate: '2024-06-01' },
    { id: 'CEP-2', orgId: 'ORG-1', studentId: 'STU-B', classId: 'CLS-1', startDate: '2024-01-01', endDate: '2024-12-31' }
  ];
  const plan = mergeService.buildEnrollmentPeriodPlan(main, secondaries, periodRows);
  assert.equal(plan.merges.length, 1);
  assert.equal(plan.merges[0].keepId, 'CEP-2');
  assert.equal(plan.merges[0].dropId, 'CEP-1');
});

test('mergeSessionsForPersonSwap repoints secondary-only roster rows', () => {
  const sessions = [{
    sessionId: 'SES-1',
    roster: [{ personId: 'P-B', attendance: 'present' }]
  }];
  const result = mergeSessionsForPersonSwap(sessions, 'P-A', 'P-B');
  assert.equal(result.collisions.length, 0);
  assert.equal(result.sessions[0].roster[0].personId, 'P-A');
});

test('mergeSessionsForPersonSwap returns collision when attendance differs', () => {
  const sessions = [{
    sessionId: 'SES-2',
    roster: [
      { personId: 'P-A', attendance: 'present' },
      { personId: 'P-B', attendance: 'absent' }
    ]
  }];
  const result = mergeSessionsForPersonSwap(sessions, 'P-A', 'P-B');
  assert.equal(result.collisions.length, 1);
  assert.equal(result.collisions[0].code, 'attendance_mismatch');
  assert.equal(rosterConflict({ attendance: 'present' }, { attendance: 'absent' }).code, 'attendance_mismatch');
});

test('readMergeStorePayload refuses to treat schedule notes as an array', () => {
  assert.throws(() => readMergeStorePayload([], 'document'), /object/);
  const notes = transformSchedulePersonNotesDoc({
    byOrgId: { 'ORG-1': { byPersonId: { 'P-B': { text: 'keep me' } } } }
  }, 'P-B', 'P-A', 'ORG-1');
  assert.equal(notes.doc.byOrgId['ORG-1'].byPersonId['P-A'].text, 'keep me');
  assert.equal(notes.doc.byOrgId['ORG-1'].byPersonId['P-B'], undefined);
});

test('person rewrite moves ledger personId and report assignment target rows', () => {
  const ledger = transformPersonIdRows('academicLedger', [{
    orgId: 'ORG-1',
    personId: 'P-B',
    studentId: 'STU-B'
  }], 'P-B', 'P-A', 'ORG-1');
  assert.equal(ledger.rows[0].personId, 'P-A');
  assert.equal(ledger.rows[0].studentId, 'STU-B');

  const assignments = transformPersonIdRows('reportAssignments', [{
    orgId: 'ORG-1',
    targetRows: [{ targetStudentIds: ['P-B'] }]
  }], 'P-B', 'P-A', 'ORG-1');
  assert.deepEqual(assignments.rows[0].targetRows[0].targetStudentIds, ['P-A']);
});

test('overall report studentEntries and filters follow the student record id', () => {
  const result = transformStudentIdRows('overallReportInstances', [{
    orgId: 'ORG-1',
    studentEntries: [{ studentId: 'STU-B' }],
    filtersSnapshot: { studentIds: ['STU-B'] },
    generatedDocs: [{ studentId: 'STU-B' }]
  }], 'STU-B', 'STU-A', 'ORG-1');
  assert.equal(result.rows[0].studentEntries[0].studentId, 'STU-A');
  assert.deepEqual(result.rows[0].filtersSnapshot.studentIds, ['STU-A']);
  assert.equal(result.rows[0].generatedDocs[0].studentId, 'STU-A');
});

test('countPersonIdReferences still sees a library loan after a partial rewrite', () => {
  const datasets = {
    libraryLoans: { rows: [{ id: 'LOAN-1', orgId: 'ORG-1', personId: 'P-B', patronId: 'PAT-B' }] }
  };
  const hits = countPersonIdReferences(datasets, 'P-B', 'ORG-1');
  assert.ok(hits.total >= 1);
  assert.ok(hits.counts.libraryLoans >= 1);
});

test('applyProfileUnionToStudentRows keeps unioned profile and drops the secondary row', () => {
  const rows = mergeService.applyProfileUnionToStudentRows(
    [
      { id: 'STU-A', orgId: 'ORG-1', claimNumbers: ['A'], notes: 'main', enrollmentDate: '2024-02-01' },
      { id: 'STU-B', orgId: 'ORG-1', claimNumbers: ['B'], notes: 'secondary', enrollmentDate: '2020-01-01' }
    ],
    { id: 'STU-A' },
    [{ id: 'STU-B', claimNumbers: ['B'], notes: 'secondary', enrollmentDate: '2020-01-01' }]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'STU-A');
  assert.equal(rows[0].enrollmentDate, '2020-01-01');
  assert.ok(rows[0].notes.includes('secondary'));
  assert.ok(rows[0].claimNumbers.includes('B'));
});

test('patchClassRosterMaps moves nickname from secondary person key to main', () => {
  const personMap = new Map([['P-B', 'P-A']]);
  const classRow = {
    attendanceRosterPersonOrder: ['P-A', 'P-B'],
    attendanceRosterNicknames: { 'P-B': 'Bee' }
  };
  const patched = patchClassRosterMaps(classRow, personMap);
  assert.equal(patched.changed, true);
  assert.equal(patched.classRow.attendanceRosterNicknames['P-A'], 'Bee');
  assert.equal(patched.classRow.attendanceRosterNicknames['P-B'], undefined);
});

test('transformStudentIdRows leaves a void record on the original student', () => {
  const rows = [{
    id: 'RI-VOID',
    orgId: 'ORG-1',
    studentId: 'STU-B',
    targetKey: 'student:STU-B',
    status: 'void'
  }];
  const result = transformStudentIdRows('reportInstances', rows, 'STU-B', 'STU-A', 'ORG-1');
  assert.equal(result.count, 0);
  assert.equal(result.rows[0].studentId, 'STU-B');
  assert.equal(result.rows[0].targetKey, 'student:STU-B');
});

test('buildProgramRegistrationPlan deletes a void registration instead of adopting it', () => {
  const main = { id: 'STU-A', orgId: 'ORG-1', personId: 'P-A' };
  const secondaries = [{ id: 'STU-B', orgId: 'ORG-1', personId: 'P-B' }];
  const plan = mergeService.buildProgramRegistrationPlan(main, secondaries, [
    { id: 'PR-VOID', orgId: 'ORG-1', studentId: 'STU-B', programId: 'PROG-9', status: 'void', registrationDate: '2020-01-01' }
  ], []);
  assert.equal(plan.adopts.length, 0);
  assert.equal(plan.moves.length, 0);
  assert.equal(plan.blocks.length, 0);
  assert.equal(plan.deletes[0].id, 'PR-VOID');
  assert.equal(plan.deletes[0].reason, 'void');
});

test('buildEnrollmentPeriodPlan does not move a void enrollment', () => {
  const main = { id: 'STU-A', orgId: 'ORG-1', personId: 'P-A' };
  const secondaries = [{ id: 'STU-B', orgId: 'ORG-1', personId: 'P-B' }];
  const plan = mergeService.buildEnrollmentPeriodPlan(main, secondaries, [
    { id: 'CEP-VOID', orgId: 'ORG-1', studentId: 'STU-B', classId: 'CLS-9', status: 'void', startDate: '2024-01-01' },
    { id: 'CEP-LIVE', orgId: 'ORG-1', studentId: 'STU-B', classId: 'CLS-1', status: 'active', startDate: '2024-02-01' }
  ]);
  assert.equal(plan.moves.length, 1);
  assert.equal(plan.moves[0].id, 'CEP-LIVE');
  assert.equal(plan.deletes[0].id, 'CEP-VOID');
});

test('deletePlannedMergeRecords hard-deletes the duplicate registration', () => {
  const main = { id: 'STU-A', orgId: 'ORG-1', personId: 'P-A' };
  const secondaries = [{ id: 'STU-B', orgId: 'ORG-1', personId: 'P-B' }];
  const rows = [
    { id: 'PR-1', orgId: 'ORG-1', studentId: 'STU-A', programId: 'PROG-1', status: 'registered', registrationDate: '2024-05-01' },
    { id: 'PR-2', orgId: 'ORG-1', studentId: 'STU-B', programId: 'PROG-1', status: 'registered', registrationDate: '2020-01-15' }
  ];
  const plan = mergeService.buildProgramRegistrationPlan(main, secondaries, rows, []);
  const datasets = { studentProgramRegistrations: { rows: rows.map((row) => ({ ...row })) } };
  mergeService.deletePlannedMergeRecords(datasets, { programPlan: plan, termPlan: { deletes: [] }, periodPlan: { deletes: [] } });
  assert.equal(datasets.studentProgramRegistrations.rows.length, 1);
  assert.equal(datasets.studentProgramRegistrations.rows[0].id, 'PR-1');
  assert.equal(datasets.studentProgramRegistrations.rows[0].status, 'registered');
});

test('runMergeExecuteSteps marks a failed verify step and records a successful rollback', async () => {
  let restored = false;
  await assert.rejects(async () => {
    await mergeService.runMergeExecuteSteps({
      confirm: async () => 'Preview is still valid.',
      profile: async () => 'Primary admission profile combined.',
      enrollments: async () => 'Moved.',
      deleteVoids: async () => 'Deleted.',
      studentRefs: async () => 'Repointed.',
      personRefs: async () => 'Repointed.',
      sessions: async () => 'Updated.',
      save: async () => 'Saved.',
      classFiles: async () => 'Updated.',
      verify: async () => {
        throw new Error('references remain');
      },
      indexes: async () => 'Rebuilt.',
      remove: async () => 'Removed.'
    }, {
      rollback: async () => {
        restored = true;
      }
    });
  }, /references remain/);
  assert.equal(restored, true);
});

test('runMergeExecuteSteps stores the failed step and undo result on the error', async () => {
  try {
    await mergeService.runMergeExecuteSteps({
      confirm: async () => 'ok',
      profile: async () => 'ok',
      enrollments: async () => 'ok',
      deleteVoids: async () => 'ok',
      studentRefs: async () => 'ok',
      personRefs: async () => 'ok',
      sessions: async () => 'ok',
      save: async () => 'ok',
      classFiles: async () => 'ok',
      verify: async () => {
        throw new Error('references remain');
      },
      indexes: async () => 'ok',
      remove: async () => 'ok'
    }, { rollback: async () => {} });
    assert.fail('verify failure should reject');
  } catch (error) {
    assert.equal(error.rollbackStatus, 'restored');
    const verify = error.mergeSteps.find((step) => step.id === 'verify');
    const undo = error.mergeSteps.find((step) => step.id === 'undo');
    const indexes = error.mergeSteps.find((step) => step.id === 'indexes');
    assert.equal(verify.status, 'failed');
    assert.equal(undo.status, 'success');
    assert.equal(undo.detail, 'Records restored to the previous state.');
    assert.equal(indexes.status, 'waiting');
  }
});
