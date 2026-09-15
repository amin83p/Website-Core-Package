const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schoolRepositories = require('../MVC/repositories/school');
const classEnrollmentPeriodService = require('../MVC/services/school/classEnrollmentPeriodService');
const undoCloseService = require('../MVC/services/school/classEnrollmentUndoCloseService');

const viewSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/class/rollingEnrollment.ejs'),
  'utf8'
);
const controllerSource = fs.readFileSync(
  path.join(__dirname, '../MVC/controllers/school/classRollingEnrollmentController.js'),
  'utf8'
);
const routesSource = fs.readFileSync(
  path.join(__dirname, '../MVC/routes/classRoutes.js'),
  'utf8'
);

const classId = 'CLS_001';
const studentId = 'STU_001';
const periodId = 'PER_001';

function buildClosedPeriod(overrides = {}) {
  return {
    id: periodId,
    classId,
    studentId,
    status: 'withdrawn',
    startDate: '2026-01-01',
    endDate: '2026-03-01',
    reasonEnd: 'Left early',
    transactionSummary: {
      totalAmount: 0,
      lifecycleStatusHistory: [],
      lastCloseSnapshot: {
        previousStatus: 'active',
        previousEndDate: '',
        previousReasonEnd: '',
        closedStatus: 'withdrawn',
        closedEndDate: '2026-03-01',
        closedReason: 'Left early',
        closedAt: '2026-03-01T12:00:00.000Z',
        closedBy: 'USR_1'
      }
    },
    ...overrides
  };
}

function withRepositoryMocks({ periodRow, siblingPeriods = [], rangePeriods = [] } = {}, run) {
  const period = { ...periodRow };
  const originalGetById = schoolRepositories.classEnrollmentPeriods.getById;
  const originalFindByClassId = schoolRepositories.classEnrollmentPeriods.findByClassId;
  const originalFindByClassIdInRange = schoolRepositories.classEnrollmentPeriods.findByClassIdInRange;

  schoolRepositories.classEnrollmentPeriods.getById = async (id) => (
    String(id) === String(period.id) ? { ...period } : null
  );
  schoolRepositories.classEnrollmentPeriods.findByClassId = async () => (
    Array.isArray(siblingPeriods) ? siblingPeriods.map((row) => ({ ...row })) : []
  );
  schoolRepositories.classEnrollmentPeriods.findByClassIdInRange = async () => (
    Array.isArray(rangePeriods) ? rangePeriods.map((row) => ({ ...row })) : []
  );

  classEnrollmentPeriodService.__setDependenciesForTest({
    repositories: {
      classEnrollmentPeriods: {
        getById: schoolRepositories.classEnrollmentPeriods.getById,
        findByClassId: schoolRepositories.classEnrollmentPeriods.findByClassId,
        findByClassIdInRange: schoolRepositories.classEnrollmentPeriods.findByClassIdInRange,
        update: async (id, patch) => {
          Object.assign(period, patch);
          return { ...period };
        }
      },
      classes: {
        getById: async (id) => (String(id) === String(classId) ? { id: classId, orgId: 'ORG_1' } : null)
      },
      studentProgramRegistrations: {
        getById: async () => null
      }
    }
  });

  return run(period).finally(() => {
    schoolRepositories.classEnrollmentPeriods.getById = originalGetById;
    schoolRepositories.classEnrollmentPeriods.findByClassId = originalFindByClassId;
    schoolRepositories.classEnrollmentPeriods.findByClassIdInRange = originalFindByClassIdInRange;
    classEnrollmentPeriodService.__resetDependenciesForTest();
  });
}

test('buildRestoreSnapshot prefers lastCloseSnapshot', () => {
  const snapshot = undoCloseService.buildRestoreSnapshot(buildClosedPeriod());
  assert.equal(snapshot.status, 'active');
  assert.equal(snapshot.endDate, '');
  assert.equal(snapshot.source, 'lastCloseSnapshot');
});

test('buildRestoreSnapshot falls back to lifecycleStatusHistory', () => {
  const snapshot = undoCloseService.buildRestoreSnapshot(buildClosedPeriod({
    transactionSummary: {
      totalAmount: 0,
      lifecycleStatusHistory: [{
        oldStatus: 'waiting_list',
        newStatus: 'completed',
        effectiveDate: '2026-03-01',
        reason: 'Finished'
      }]
    }
  }));
  assert.equal(snapshot.status, 'waiting_list');
  assert.equal(snapshot.source, 'lifecycleStatusHistory');
});

test('assessUndoCloseEligibility blocks when finance transactions are attached', async () => {
  await withRepositoryMocks({
    periodRow: buildClosedPeriod({
      transactionSummary: {
        totalAmount: 0,
        postedTransactionIds: ['TX_001']
      }
    })
  }, async () => {
    const eligibility = await undoCloseService.assessUndoCloseEligibility(buildClosedPeriod({
      transactionSummary: {
        totalAmount: 0,
        postedTransactionIds: ['TX_001']
      }
    }));
    assert.equal(eligibility.canUndo, false);
    assert.equal(eligibility.blockers[0]?.code, 'FINANCE_ATTACHED');
  });
});

test('assessUndoCloseEligibility blocks when another open period exists', async () => {
  const period = buildClosedPeriod();
  await withRepositoryMocks({
    periodRow: period,
    siblingPeriods: [{
      id: 'PER_002',
      classId,
      studentId,
      status: 'active',
      startDate: '2026-03-02',
      endDate: ''
    }]
  }, async () => {
    const eligibility = await undoCloseService.assessUndoCloseEligibility(period);
    assert.equal(eligibility.canUndo, false);
    assert.match(eligibility.blockers.map((row) => row.code).join(','), /OVERLAPPING_OPEN_PERIOD|DOWNSTREAM_PERIOD/);
  });
});

test('undoClosePeriod restores withdrawn close to active with open end date', async () => {
  const period = buildClosedPeriod();
  await withRepositoryMocks({ periodRow: period }, async () => {
    const result = await undoCloseService.undoClosePeriod(periodId, { reason: 'Closed by mistake' }, { id: 'USR_1' });
    assert.equal(result.period.status, 'active');
    assert.equal(result.period.endDate, '');
    assert.equal(result.previousStatus, 'withdrawn');
    assert.equal(result.restorePreview.status, 'active');
    const history = result.period.transactionSummary.lifecycleStatusHistory || [];
    assert.equal(history[history.length - 1]?.eventType, 'undo_close');
    assert.equal(result.period.transactionSummary.lastCloseSnapshot, undefined);
  });
});

test('undoClosePeriod restores completed status from lifecycle history', async () => {
  const period = buildClosedPeriod({
    status: 'completed',
    transactionSummary: {
      totalAmount: 0,
      lifecycleStatusHistory: [{
        oldStatus: 'to_be_confirmed',
        newStatus: 'completed',
        effectiveDate: '2026-03-01',
        reason: 'Done'
      }]
    }
  });
  await withRepositoryMocks({ periodRow: period }, async () => {
    const result = await undoCloseService.undoClosePeriod(periodId, { reason: 'Wrong completion' }, { id: 'USR_1' });
    assert.equal(result.period.status, 'to_be_confirmed');
    assert.equal(result.restorePreview.source, 'lifecycleStatusHistory');
  });
});

test('rolling enrollment view includes undo close modal and handlers', () => {
  assert.match(viewSource, /id="undoClosePeriodModal"/);
  assert.match(viewSource, /btn-row-undo-close/);
  assert.match(viewSource, /function openUndoCloseModal\(/);
  assert.match(viewSource, /function previewUndoClose\(/);
  assert.match(viewSource, /function submitUndoClose\(/);
  assert.match(viewSource, /\/enrollment-periods\/\$\{encodeURIComponent\(resolvedPeriodId\)\}\/undo-close\/preview/);
  assert.match(viewSource, /\/enrollment-periods\/\$\{encodeURIComponent\(periodId\)\}\/undo-close/);
});

test('undo close routes and controller handlers are wired', () => {
  assert.match(routesSource, /\/api\/enrollment-periods\/:periodId\/undo-close\/preview/);
  assert.match(routesSource, /\/api\/enrollment-periods\/:periodId\/undo-close/);
  assert.match(routesSource, /previewUndoCloseClassEnrollmentPeriod/);
  assert.match(routesSource, /undoCloseClassEnrollmentPeriod/);
  assert.match(controllerSource, /async function previewUndoCloseClassEnrollmentPeriod/);
  assert.match(controllerSource, /async function undoCloseClassEnrollmentPeriod/);
  assert.match(controllerSource, /class_enrollment_period_undo_close/);
  assert.match(controllerSource, /undoCloseClassEnrollmentPeriod/);
});
