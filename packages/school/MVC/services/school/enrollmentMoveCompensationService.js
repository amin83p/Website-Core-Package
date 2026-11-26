'use strict';

const classEnrollmentUndoCloseService = require('./classEnrollmentUndoCloseService');
const scheduleMoveSessionsService = require('./scheduleMoveSessionsService');
const schoolRepositories = require('../../repositories/school');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const REVERSIBLE_TARGET_STATUSES = new Set(['draft', 'to_be_confirmed', 'waiting_list', 'planned']);

const ROLLBACK_CLOSE_REASON = 'Automatic rollback: enrollment move failed';

let dependencies = {
  classEnrollmentUndoCloseService,
  scheduleMoveSessionsService,
  repositories: schoolRepositories
};

function buildCompensationRecordFromOutcome(outcome = {}, context = {}) {
  const closedSource = outcome.closedSource || null;
  const targetPeriod = outcome.targetPeriod || null;
  const sessionTransferResult = outcome.sessionTransferResult || null;
  return {
    sourcePeriodId: toPublicId(closedSource?.id || context.sourcePeriodId),
    targetPeriodId: toPublicId(targetPeriod?.id),
    targetClassId: toPublicId(targetPeriod?.classId || context.targetClassId),
    sourceClassId: toPublicId(closedSource?.classId || context.sourceClassId),
    sourceWasClosed: Boolean(closedSource),
    sessionTransferResult: sessionTransferResult
      ? {
          rollbackTargetSessions: sessionTransferResult.rollbackTargetSessions || null
        }
      : null
  };
}

async function rollbackTargetPeriodIfSafe(targetPeriodId, reqUser, options = {}) {
  const periodId = toPublicId(targetPeriodId);
  if (!periodId) return { ok: true, action: 'none', message: 'No target period to roll back.' };
  const period = await dependencies.repositories.classEnrollmentPeriods.getById(periodId, options);
  if (!period) return { ok: true, action: 'skipped', message: 'Target period already removed.' };
  const status = String(period.status || '').trim().toLowerCase();
  if (!REVERSIBLE_TARGET_STATUSES.has(status)) {
    return {
      ok: false,
      action: 'manual_required',
      message: `Target enrollment (${status}) could not be removed automatically. Review the student record manually.`
    };
  }
  await dependencies.repositories.classEnrollmentPeriods.remove(periodId, options);
  return { ok: true, action: 'deleted', message: 'Removed newly created target enrollment.' };
}

async function rollbackCompensationRecord(record = {}, { reqUser, orgId, accessContext } = {}) {
  const options = { accessContext, orgId };
  const steps = [];
  let ok = true;

  if (record.sessionTransferResult?.rollbackTargetSessions?.length && record.targetClassId) {
    try {
      await dependencies.scheduleMoveSessionsService.rollbackTargetSessionTransfer({
        targetClassId: record.targetClassId,
        rollbackTargetSessions: record.sessionTransferResult.rollbackTargetSessions,
        reqUser,
        accessContext
      });
      steps.push({ step: 'session_transfer', ok: true });
    } catch (error) {
      ok = false;
      steps.push({ step: 'session_transfer', ok: false, error: error.message || 'Session rollback failed.' });
    }
  }

  if (record.targetPeriodId) {
    const targetResult = await rollbackTargetPeriodIfSafe(record.targetPeriodId, reqUser, options);
    steps.push({ step: 'target_period', ...targetResult });
    if (targetResult.ok === false) ok = false;
  }

  if (record.sourceWasClosed && record.sourcePeriodId) {
    try {
      await dependencies.classEnrollmentUndoCloseService.undoClosePeriod(
        record.sourcePeriodId,
        { reason: ROLLBACK_CLOSE_REASON },
        reqUser,
        options
      );
      steps.push({ step: 'undo_source_close', ok: true });
    } catch (error) {
      ok = false;
      steps.push({
        step: 'undo_source_close',
        ok: false,
        error: error.message || 'Could not undo source enrollment close.'
      });
    }
  }

  return {
    sourcePeriodId: record.sourcePeriodId,
    targetPeriodId: record.targetPeriodId,
    ok,
    steps
  };
}

async function rollbackCompensationRecordsLifo(records = [], context = {}) {
  const list = Array.isArray(records) ? records : [];
  const results = [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    results.push(await rollbackCompensationRecord(list[i], context));
  }
  const allOk = results.every((row) => row.ok === true);
  return {
    allOk,
    results,
    summary: results
      .flatMap((row) => row.steps.map((step) => ({
        sourcePeriodId: row.sourcePeriodId,
        ...step
      })))
  };
}

function __setDependenciesForTest(nextDeps = {}) {
  dependencies = { ...dependencies, ...nextDeps };
}

function __resetDependenciesForTest() {
  dependencies = {
    classEnrollmentUndoCloseService,
    scheduleMoveSessionsService,
    repositories: schoolRepositories
  };
}

module.exports = {
  ROLLBACK_CLOSE_REASON,
  buildCompensationRecordFromOutcome,
  rollbackCompensationRecord,
  rollbackCompensationRecordsLifo,
  __setDependenciesForTest,
  __resetDependenciesForTest
};