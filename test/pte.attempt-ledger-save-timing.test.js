const test = require('node:test');
const assert = require('node:assert/strict');

const ledgerService = require('../MVC/services/pte/pteAttemptLedgerService');
const policyService = require('../MVC/services/activityQuota/consumptionDefinitionPolicyService');

const {
  calculateSaveTimingForAttemptItem,
  shouldBypassPracticeQuotaForUser
} = ledgerService.__testables || {};

test('service exposes timing test helper', () => {
  assert.equal(typeof calculateSaveTimingForAttemptItem, 'function');
  assert.equal(typeof shouldBypassPracticeQuotaForUser, 'function');
});

test('practice run save increments timeSpentSeconds and totalSeenSeconds by seenSeconds', () => {
  const out = calculateSaveTimingForAttemptItem(
    {
      startedAt: '2026-04-20T10:00:00.000Z',
      timeSpentSeconds: 40,
      totalSeenSeconds: 60,
      metadata: { lastViewStartedAt: '2026-04-20T10:01:00.000Z' }
    },
    { seenSeconds: 17 },
    { isPracticeRun: true, eventAt: '2026-04-20T10:01:30.000Z' }
  );

  assert.equal(out.seenSeconds, 17);
  assert.equal(out.nextTimeSpentSeconds, 57);
  assert.equal(out.nextTotalSeenSeconds, 77);
});

test('practice run save derives seenSeconds from timestamps when payload.seenSeconds missing', () => {
  const out = calculateSaveTimingForAttemptItem(
    {
      startedAt: '2026-04-20T10:00:00.000Z',
      timeSpentSeconds: 5,
      totalSeenSeconds: 8,
      metadata: { lastViewStartedAt: '2026-04-20T10:00:10.000Z' }
    },
    {},
    { isPracticeRun: true, eventAt: '2026-04-20T10:00:31.000Z' }
  );

  assert.equal(out.seenSeconds, 21);
  assert.equal(out.nextTimeSpentSeconds, 26);
  assert.equal(out.nextTotalSeenSeconds, 29);
});

test('non-practice save keeps accumulated timing unchanged', () => {
  const out = calculateSaveTimingForAttemptItem(
    {
      startedAt: '2026-04-20T10:00:00.000Z',
      timeSpentSeconds: 90,
      totalSeenSeconds: 90,
      metadata: { lastViewStartedAt: '2026-04-20T10:00:30.000Z' }
    },
    { seenSeconds: 1000 },
    { isPracticeRun: false, eventAt: '2026-04-20T10:02:00.000Z' }
  );

  assert.equal(out.seenSeconds, 0);
  assert.equal(out.nextTimeSpentSeconds, 90);
  assert.equal(out.nextTotalSeenSeconds, 90);
});

test('definition formula supports call base + volume multiplier (current PTE seeded profile)', () => {
  const needs = policyService.computeNeedsFromDefinition({
    formula: {
      call: { base: 1, multiplier: 0, contextKey: '' },
      amount: { base: 0, multiplier: 0, contextKey: '' },
      token: { base: 0, multiplier: 0, contextKey: '' },
      volume: { base: 0, multiplier: 1, contextKey: 'questionCount' }
    }
  }, {
    questionCount: 27
  });

  assert.deepEqual(needs, {
    call: 1,
    amount: 0,
    token: 0,
    volume: 27
  });
});

test('quota bypass is enabled for admin users', async () => {
  const allowed = await shouldBypassPracticeQuotaForUser({
    isSystemAdmin: true,
    activeProfile: {
      fullAdmin: true
    }
  });
  assert.equal(allowed, true);
});

test('quota bypass is disabled for normal users without admin privileges', async () => {
  const allowed = await shouldBypassPracticeQuotaForUser({
    isSystemAdmin: false,
    activeProfile: {
      fullAdmin: false,
      adminCategories: [],
      sections: []
    }
  });
  assert.equal(allowed, false);
});

test('consumePracticeAccessQuota uses resolved definition engine and computed context', async () => {
  const originalResolve = policyService.resolvePolicyDefinition;
  const originalConsume = policyService.consumeUsingResolvedDefinition;
  try {
    policyService.resolvePolicyDefinition = async () => ({
      definition: {
        id: 'RULE-READ-1',
        orgId: 'ORG-1',
        sectionId: 'PTE_PRACTICE_BY_SKILLS',
        operationId: 'READ',
        consumeTiming: 'on_attempt',
        formula: {
          call: { base: 1, multiplier: 0, contextKey: '' },
          amount: { base: 0, multiplier: 0, contextKey: '' },
          token: { base: 0, multiplier: 0, contextKey: '' },
          volume: { base: 0, multiplier: 1, contextKey: 'questionCount' }
        }
      },
      context: {
        orgId: 'ORG-1',
        userId: 'USR-1',
        sectionId: 'PTE_PRACTICE_BY_SKILLS',
        operationId: 'READ',
        sourceEventType: 'practice_attempt_detail_viewed'
      }
    });

    policyService.consumeUsingResolvedDefinition = async (payload) => {
      assert.equal(payload.context.questionCount, 3);
      assert.equal(payload.context.volumeUnits, 3);
      assert.equal(payload.context.operationId, 'READ');
      return {
        allowed: true,
        consumed: {
          id: 'AQL-1',
          orgId: 'ORG-1',
          userId: 'USR-1'
        },
        needs: {
          call: 1,
          amount: 0,
          token: 0,
          volume: 3
        }
      };
    };

    const result = await ledgerService.consumePracticeAccessQuota(
      {
        operation: 'READ',
        volumeUnits: 3,
        source: {
          module: 'pte_practice_attempt_details_ui',
          eventType: 'practice_attempt_detail_viewed',
          eventId: 'TEST-EVENT-1'
        }
      },
      {
        id: 'USR-1',
        activeOrgId: 'ORG-1',
        activeProfile: { fullAdmin: false, adminCategories: [], sections: [] }
      },
      { scopeId: 'SCOPE-1' }
    );

    assert.equal(result.operation, 'READ');
    assert.equal(result.volumeUnits, 3);
    assert.equal(result.needs.call, 1);
    assert.equal(result.needs.volume, 3);
  } finally {
    policyService.resolvePolicyDefinition = originalResolve;
    policyService.consumeUsingResolvedDefinition = originalConsume;
  }
});
