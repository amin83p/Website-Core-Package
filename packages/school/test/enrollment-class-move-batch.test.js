const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const enrollmentClassMoveService = require('../MVC/services/school/enrollmentClassMoveService');
const enrollmentMoveService = require('../MVC/services/school/enrollmentMoveService');
const enrollmentMoveCompensationService = require('../MVC/services/school/enrollmentMoveCompensationService');

const viewSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/school/class/rollingEnrollment.ejs'),
  'utf8'
);
const routesSource = fs.readFileSync(
  path.join(__dirname, '../MVC/routes/classRoutes.js'),
  'utf8'
);

const mockPeriods = [
  {
    id: 'PER_ACTIVE',
    studentId: 'STU_1',
    startDate: '2026-01-01',
    endDate: '',
    status: 'active',
    funderId: 'self',
    funderType: 'self',
    targetSessionCount: 10,
    targetHours: 0
  },
  {
    id: 'PER_COMPLETED',
    studentId: 'STU_2',
    startDate: '2026-01-01',
    endDate: '',
    status: 'completed',
    funderId: 'self',
    funderType: 'self'
  },
  {
    id: 'PER_FUTURE',
    studentId: 'STU_3',
    startDate: '2026-07-01',
    endDate: '',
    status: 'active',
    funderId: 'self',
    funderType: 'self'
  },
  {
    id: 'PER_ENDED',
    studentId: 'STU_4',
    startDate: '2026-01-01',
    endDate: '2026-02-01',
    status: 'active',
    funderId: 'self',
    funderType: 'self'
  }
];

test('listEligibleMoveCandidates filters open periods covering close date', async () => {
  const getDataByIdCalls = [];
  enrollmentClassMoveService.__setDependenciesForTest({
    schoolDataService: {
      getClassEnrollmentPeriodsByClassId: async () => mockPeriods,
      getDataById: async (type, id) => {
        getDataByIdCalls.push({ type, id });
        if (type === 'students' && id === 'STU_1') {
          return { id: 'STU_1', personId: 'PERSON_1', studentNumber: '100' };
        }
        return null;
      }
    },
    schoolPersonAccessService: {
      buildPersonByIdMap: async () => new Map([
        ['PERSON_1', { firstName: 'Student', lastName: 'One' }]
      ]),
      formatPersonName: (person, fallback) => {
        if (!person) return String(fallback || '');
        return [person.firstName, person.lastName].filter(Boolean).join(' ').trim() || String(fallback || '');
      }
    }
  });
  try {
    const rows = await enrollmentClassMoveService.listEligibleMoveCandidates({
      classId: 'CLS_1',
      closeEffectiveDate: '2026-03-15',
      reqUser: {},
      orgId: 'ORG_1',
      sourceClassTitle: 'Source'
    });
    const periodIds = rows.map((row) => row.periodId);
    assert.deepEqual(periodIds, ['PER_ACTIVE']);
    assert.equal(rows[0].studentLabel, 'Student One (100)');
    assert.equal(rows[0].defaultPayload.close.targetStatus, 'completed');
    assert.equal(rows[0].defaultPayload.close.effectiveDate, '2026-03-15');
    assert.equal(rows[0].defaultPayload.target.startDate, '2026-03-16');
    assert.deepEqual(getDataByIdCalls, [{ type: 'students', id: 'STU_1' }]);
  } finally {
    enrollmentClassMoveService.__resetDependenciesForTest();
  }
});

test('previewClassMoveBatch returns mixed canApply and stable batchPreviewHash', async () => {
  const previewCalls = [];
  enrollmentClassMoveService.__setDependenciesForTest({
    schoolDataService: {
      getClassEnrollmentPeriodsByClassId: async () => mockPeriods,
      getDataById: async () => null
    },
    enrollmentMoveService: {
      previewMoveEnrollment: async (args) => {
        previewCalls.push(args);
        if (String(args.sourcePeriodId) === 'PER_ACTIVE') {
          return {
            canApply: true,
            blockers: [],
            warnings: [],
            previewHash: 'hash-ok',
            summaryLines: ['Ready'],
            normalizedPayload: args.payload
          };
        }
        return {
          canApply: false,
          blockers: [{ code: 'BLOCK', message: 'Not allowed' }],
          warnings: [],
          previewHash: '',
          summaryLines: []
        };
      }
    }
  });
  try {
    const rows = [
      { periodId: 'PER_ACTIVE', studentLabel: 'A', payload: { close: { effectiveDate: '2026-03-15' } } },
      { periodId: 'PER_FUTURE', studentLabel: 'B', payload: { close: { effectiveDate: '2026-03-15' } } }
    ];
    const preview1 = await enrollmentClassMoveService.previewClassMoveBatch({
      sourceClassId: 'CLS_SRC',
      targetClassId: 'CLS_TGT',
      closeUserReason: 'Teacher leaving',
      targetClassTitle: 'Target',
      rows,
      reqUser: {},
      orgId: 'ORG_1',
      options: { sourceClassTitle: 'Source' }
    });
    const preview2 = await enrollmentClassMoveService.previewClassMoveBatch({
      sourceClassId: 'CLS_SRC',
      targetClassId: 'CLS_TGT',
      closeUserReason: 'Teacher leaving',
      targetClassTitle: 'Target',
      rows,
      reqUser: {},
      orgId: 'ORG_1',
      options: { sourceClassTitle: 'Source' }
    });
    assert.equal(preview1.batchPreviewHash, preview2.batchPreviewHash);
    assert.equal(preview1.items.length, 2);
    assert.equal(preview1.items[0].canApply, true);
    assert.equal(preview1.items[1].canApply, false);
    assert.equal(preview1.canApplyAny, true);
    assert.equal(preview1.canApplyAllSelected, false);
    assert.equal(preview1.applyableCount, 1);
    assert.equal(preview1.blockedCount, 1);
    assert.ok(preview1.applyBatchHash);
    assert.notEqual(preview1.applyBatchHash, preview1.batchPreviewHash);
    assert.equal(previewCalls.length, 4);
    assert.equal(previewCalls[0].payload.close.targetStatus, 'completed');
    assert.ok(String(previewCalls[0].payload.close.reason || '').includes('Teacher leaving'));
  } finally {
    enrollmentClassMoveService.__resetDependenciesForTest();
  }
});

test('buildBatchPreviewHash changes when row payload changes', () => {
  const base = {
    sourceClassId: 'CLS_SRC',
    targetClassId: 'CLS_TGT',
    closeUserReason: 'Reason',
    rows: [{ periodId: 'PER_1', payload: { close: { effectiveDate: '2026-03-01' } } }]
  };
  const hash1 = enrollmentClassMoveService.buildBatchPreviewHash(base);
  const hash2 = enrollmentClassMoveService.buildBatchPreviewHash({
    ...base,
    rows: [{ periodId: 'PER_1', payload: { close: { effectiveDate: '2026-03-02' } } }]
  });
  assert.notEqual(hash1, hash2);
});

test('static: routes and rolling enrollment view expose class-move bulk move UI', () => {
  assert.match(routesSource, /class-move\/candidates/);
  assert.match(routesSource, /class-move\/preview/);
  assert.match(routesSource, /class-move\/preview-seal/);
  assert.match(routesSource, /class-move\/apply/);
  assert.match(viewSource, /classMoveWizardModal/);
  assert.match(viewSource, /btn_openClassMoveWizard/);
  assert.match(viewSource, /class-move\/candidates/);
  assert.match(viewSource, /class-move-claim-select/);
  assert.match(viewSource, /data-field="sessionCapacityType"/);
  assert.doesNotMatch(viewSource, /data-field="closeEffectiveDate"/);
  assert.match(viewSource, /classMoveWizardStepPills/);
  assert.match(viewSource, /buildClassMovePayloadForRow[\s\S]*defaultMoveTargetStartAfterClose\(closeDate\)/);
  assert.match(viewSource, /data-field="targetStartDate"/);
  assert.match(viewSource, /validateMoveStartAfterClose/);
  assert.match(viewSource, /move_startDateGapHelp/);
  assert.match(viewSource, /applyBatchHash/);
  assert.match(viewSource, /showClassMoveBusy/);
  assert.match(viewSource, /updateLoading[\s\S]*progress/);
  assert.match(viewSource, /class-move\/preview-seal/);
  assert.match(viewSource, /rows: \[rows\[i\]\]/);
  assert.match(viewSource, /Class Move Rolled Back/);
  assert.match(viewSource, /rollbackSummary/);
});

test('sealClassMovePreview returns batch and apply hashes without preview execution', () => {
  const rows = [
    { periodId: 'PER_ACTIVE', payload: { close: { effectiveDate: '2026-03-15' } } },
    { periodId: 'PER_FUTURE', payload: { close: { effectiveDate: '2026-03-15' } } }
  ];
  const items = [
    { periodId: 'PER_ACTIVE', canApply: true, payload: rows[0].payload },
    { periodId: 'PER_FUTURE', canApply: false, payload: rows[1].payload }
  ];
  const sealed = enrollmentClassMoveService.sealClassMovePreview({
    sourceClassId: 'CLS_SRC',
    targetClassId: 'CLS_TGT',
    closeUserReason: 'Reason',
    rows,
    items
  });
  assert.ok(sealed.batchPreviewHash);
  assert.ok(sealed.applyBatchHash);
  assert.notEqual(sealed.batchPreviewHash, sealed.applyBatchHash);
  assert.equal(sealed.applyableCount, 1);
  assert.equal(sealed.blockedCount, 1);
  assert.equal(sealed.canApplyAny, true);
  assert.equal(sealed.canApplyAllSelected, false);
});

test('applyClassMoveBatch rolls back earlier success when a later row fails', async () => {
  let applyCount = 0;
  const rollbackCalls = [];
  const previewCalls = [];
  enrollmentClassMoveService.__setDependenciesForTest({
    schoolDataService: {
      getClassEnrollmentPeriodsByClassId: async () => mockPeriods,
      getDataById: async () => null
    },
    enrollmentMoveService: {
      previewMoveEnrollment: async (args) => {
        previewCalls.push(args);
        return { canApply: true, previewHash: 'hash-ok' };
      },
      validateMovePreviewForApply: async () => ({
        ok: true,
        normalizedPayload: { target: { classId: 'CLS_TGT', studentId: 'STU_1' } },
        previewHash: 'hash-ok'
      }),
      applyMoveEnrollment: async (args) => {
        assert.equal(args.options?.trustPreviewHash, true);
        applyCount += 1;
        if (applyCount === 2) {
          throw new Error('Simulated failure');
        }
        return {
          closedSource: { id: 'PER_ACTIVE', classId: 'CLS_SRC' },
          targetPeriod: { id: 'PER_TGT_NEW', classId: 'CLS_TGT', status: 'draft' },
          sessionTransferResult: null
        };
      }
    },
    enrollmentMoveCompensationService: {
      buildCompensationRecordFromOutcome: enrollmentMoveCompensationService.buildCompensationRecordFromOutcome,
      rollbackCompensationRecordsLifo: async (records) => {
        rollbackCalls.push(records.length);
        return { allOk: true, results: [] };
      }
    }
  });
  try {
    const rows = [
      { periodId: 'PER_ACTIVE', previewHash: 'hash-ok', payload: { target: { classId: 'CLS_TGT' } } },
      { periodId: 'PER_ACTIVE', previewHash: 'hash-ok', payload: { target: { classId: 'CLS_TGT' } } }
    ];
    const applyHash = enrollmentClassMoveService.buildBatchPreviewHash({
      sourceClassId: 'CLS_SRC',
      targetClassId: 'CLS_TGT',
      closeUserReason: 'Reason',
      rows
    });
    await assert.rejects(
      () => enrollmentClassMoveService.applyClassMoveBatch({
        applyBatchHash: applyHash,
        sourceClassId: 'CLS_SRC',
        targetClassId: 'CLS_TGT',
        closeUserReason: 'Reason',
        rows,
        reqUser: {},
        orgId: 'ORG_1'
      }),
      /Simulated failure|rolled back/i
    );
    assert.equal(rollbackCalls.length, 1);
    assert.equal(rollbackCalls[0], 1);
    assert.equal(previewCalls.length, 0);
  } finally {
    enrollmentClassMoveService.__resetDependenciesForTest();
  }
});

test('OPEN_STATUSES used for candidate filtering matches enrollment move service', () => {
  assert.ok(enrollmentMoveService.OPEN_STATUSES.has('active'));
  assert.ok(!enrollmentMoveService.OPEN_STATUSES.has('completed'));
});

/*
 * Manual QA — Move/New Enrollment (rolling enrollment row action):
 * 1. Close and start: close today, start +4 days, same class or other; preview + apply.
 * 2. New elsewhere: source stays active; target must be a different class.
 */
test('static: rolling enrollment view exposes Move/New Enrollment two-mode row modal', () => {
  assert.match(viewSource, /Move\/New Enrollment/);
  assert.match(viewSource, /move-enrollment-mode-btn-group/);
  assert.match(viewSource, /Close and start a new enrollment/);
  assert.match(viewSource, /data-move-mode="move"/);
  assert.match(viewSource, /data-move-mode="new_elsewhere"/);
  assert.match(viewSource, /btn-success/);
  assert.match(viewSource, /btn-outline-info/);
  assert.doesNotMatch(viewSource, /data-move-mode="close_only"/);
  assert.match(viewSource, /move_transferToAnotherClass/);
  assert.match(viewSource, /syncMoveCloseStartStyleUi/);
  assert.match(viewSource, /title: String\(c\.title/);
  assert.match(viewSource, /enrollment-periods\/preview-create/);
  assert.match(viewSource, /rolling-enrollment\/execute/);
  assert.doesNotMatch(viewSource, /btn-row-move[^>]*>\s*Move<\/button>/);
});
