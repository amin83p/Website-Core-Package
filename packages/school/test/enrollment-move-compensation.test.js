'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const enrollmentMoveCompensationService = require('../MVC/services/school/enrollmentMoveCompensationService');

test('rollbackCompensationRecordsLifo reverses records in last-in-first-out order', async () => {
  const calls = [];
  enrollmentMoveCompensationService.__setDependenciesForTest({
    classEnrollmentUndoCloseService: {
      undoClosePeriod: async (periodId) => {
        calls.push(`undo:${periodId}`);
        return { period: { id: periodId } };
      }
    },
    scheduleMoveSessionsService: {
      rollbackTargetSessionTransfer: async () => {
        calls.push('sessions');
      }
    },
    repositories: {
      classEnrollmentPeriods: {
        getById: async () => ({ id: 'PER_TGT', status: 'draft' }),
        remove: async () => {
          calls.push('delete:target');
        }
      }
    }
  });
  try {
    const records = [
      { sourcePeriodId: 'PER_A', targetPeriodId: 'PER_TGT_A', sourceWasClosed: true, sessionTransferResult: null },
      { sourcePeriodId: 'PER_B', targetPeriodId: 'PER_TGT_B', sourceWasClosed: true, sessionTransferResult: null }
    ];
    const rollback = await enrollmentMoveCompensationService.rollbackCompensationRecordsLifo(records, {});
    assert.equal(rollback.allOk, true);
    assert.deepEqual(calls, [
      'delete:target',
      'undo:PER_B',
      'delete:target',
      'undo:PER_A'
    ]);
  } finally {
    enrollmentMoveCompensationService.__resetDependenciesForTest();
  }
});

test('buildCompensationRecordFromOutcome captures closed source and target period', () => {
  const record = enrollmentMoveCompensationService.buildCompensationRecordFromOutcome({
    closedSource: { id: 'PER_SRC', classId: 'CLS_SRC' },
    targetPeriod: { id: 'PER_TGT', classId: 'CLS_TGT' },
    sessionTransferResult: { rollbackTargetSessions: ['S1'] }
  }, { sourcePeriodId: 'PER_SRC' });
  assert.equal(record.sourceWasClosed, true);
  assert.equal(record.sourcePeriodId, 'PER_SRC');
  assert.equal(record.targetPeriodId, 'PER_TGT');
  assert.deepEqual(record.sessionTransferResult.rollbackTargetSessions, ['S1']);
});