const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const enrollmentClassMoveService = require('../MVC/services/school/enrollmentClassMoveService');
const enrollmentMoveService = require('../MVC/services/school/enrollmentMoveService');

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
  enrollmentClassMoveService.__setDependenciesForTest({
    schoolDataService: {
      getClassEnrollmentPeriodsByClassId: async () => mockPeriods,
      fetchAllData: async () => [
        { id: 'STU_1', personId: 'PERSON_1', studentNumber: '100' }
      ]
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
  } finally {
    enrollmentClassMoveService.__resetDependenciesForTest();
  }
});

test('previewClassMoveBatch returns mixed canApply and stable batchPreviewHash', async () => {
  const previewCalls = [];
  enrollmentClassMoveService.__setDependenciesForTest({
    schoolDataService: {
      getDataById: async (collection, id) => {
        if (collection !== 'classEnrollmentPeriods') return null;
        return mockPeriods.find((row) => row.id === id) || null;
      }
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
  assert.match(routesSource, /class-move\/apply/);
  assert.match(viewSource, /classMoveWizardModal/);
  assert.match(viewSource, /btn_openClassMoveWizard/);
  assert.match(viewSource, /class-move\/candidates/);
  assert.match(viewSource, /class-move-claim-select/);
  assert.match(viewSource, /data-field="sessionCapacityType"/);
  assert.doesNotMatch(viewSource, /data-field="closeEffectiveDate"/);
  assert.doesNotMatch(viewSource, /data-field="targetStartDate"/);
  assert.match(viewSource, /classMoveWizardStepPills/);
});

test('OPEN_STATUSES used for candidate filtering matches enrollment move service', () => {
  assert.ok(enrollmentMoveService.OPEN_STATUSES.has('active'));
  assert.ok(!enrollmentMoveService.OPEN_STATUSES.has('completed'));
});
