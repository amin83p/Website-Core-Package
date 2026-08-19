const test = require('node:test');
const assert = require('node:assert/strict');

const extensionService = require('../MVC/services/school/extensionEnrollmentService');

const sourcePeriod = {
  id: 'PER_SOURCE',
  orgId: 'ORG_001',
  classId: 'CLS_001',
  studentId: 'STU_001',
  personId: 'PERSON_001',
  startDate: '2026-01-01',
  endDate: '2026-03-31',
  status: 'completed',
  programId: 'PRG_001',
  termId: 'TRM_001',
  enrollmentSource: 'office',
  funderType: 'self',
  funderId: '',
  enrollmentExtensions: []
};

function buildMocks() {
  const periodStore = new Map([[sourcePeriod.id, { ...sourcePeriod }]]);
  const created = [];
  return {
    repositories: {
      classEnrollmentPeriods: {
        async getById(id) {
          const row = periodStore.get(id);
          return row ? { ...row } : null;
        },
        async update(id, patch) {
          const existing = periodStore.get(id);
          if (!existing) return null;
          const updated = { ...existing, ...patch };
          periodStore.set(id, updated);
          return updated;
        }
      }
    },
    enrollmentPeriodService: {
      async createPeriod(payload, user) {
        const period = {
          id: `PER_EXT_${created.length + 1}`,
          ...payload,
          status: payload.status || 'active'
        };
        created.push(period);
        periodStore.set(period.id, period);
        return { period, overlapCheck: null, reentryCheck: null };
      }
    },
    created,
    periodStore
  };
}

test('createExtensionEnrollment creates additional_sessions extension and audits source', async () => {
  const mocks = buildMocks();
  extensionService.__setDependenciesForTest({
    repositories: mocks.repositories,
    enrollmentPeriodService: mocks.enrollmentPeriodService
  });
  try {
    const result = await extensionService.createExtensionEnrollment({
      sourcePeriodId: sourcePeriod.id,
      extensionKind: 'additional_sessions',
      additionalSessions: 3,
      startDate: '2026-04-01',
      reason: 'Student needs more sessions after excused absences',
      requestingUser: { id: 'USR_1' }
    });
    assert.equal(result.extensionPeriod.enrollmentKind, 'extension');
    assert.equal(result.extensionPeriod.extensionOfPeriodId, sourcePeriod.id);
    assert.equal(result.extensionPeriod.targetSessionCount, 3);
    const source = mocks.periodStore.get(sourcePeriod.id);
    assert.equal(source.enrollmentExtensions.length, 1);
    assert.equal(source.enrollmentExtensions[0].extensionKind, 'additional_sessions');
  } finally {
    extensionService.__resetDependenciesForTest();
  }
});

test('createExtensionEnrollment rejects extended_end_date before source end', async () => {
  const mocks = buildMocks();
  extensionService.__setDependenciesForTest({
    repositories: mocks.repositories,
    enrollmentPeriodService: mocks.enrollmentPeriodService
  });
  try {
    await assert.rejects(
      () => extensionService.createExtensionEnrollment({
        sourcePeriodId: sourcePeriod.id,
        extensionKind: 'extended_end_date',
        newEndDate: '2026-03-15',
        startDate: '2026-03-01',
        reason: 'Need more time',
        requestingUser: { id: 'USR_1' }
      }),
      /after the source enrollment end date/i
    );
  } finally {
    extensionService.__resetDependenciesForTest();
  }
});

test('createExtensionEnrollment requires reason', async () => {
  const mocks = buildMocks();
  extensionService.__setDependenciesForTest({
    repositories: mocks.repositories,
    enrollmentPeriodService: mocks.enrollmentPeriodService
  });
  try {
    await assert.rejects(
      () => extensionService.createExtensionEnrollment({
        sourcePeriodId: sourcePeriod.id,
        extensionKind: 'additional_hours',
        additionalHours: 2,
        startDate: '2026-04-01',
        reason: '',
        requestingUser: { id: 'USR_1' }
      }),
      /reason is required/i
    );
  } finally {
    extensionService.__resetDependenciesForTest();
  }
});
