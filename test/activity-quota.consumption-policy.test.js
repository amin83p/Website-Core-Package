const test = require('node:test');
const assert = require('node:assert/strict');

const policyService = require('../MVC/services/activityQuota/consumptionDefinitionPolicyService');
const consumptionDefinitionDataService = require('../MVC/services/activityQuota/consumptionDefinitionDataService');
const repository = require('../MVC/repositories/activityQuotaConsumptionDefinitionRepository');
const { SYSTEM_CONTEXT } = require('../config/constants');

const {
  definitionIsValidityActive,
  pickDefinitionByPrecedence,
  resolveContextValue
} = policyService.__testables || {};

test('consumption policy test helpers are exposed', () => {
  assert.equal(typeof definitionIsValidityActive, 'function');
  assert.equal(typeof pickDefinitionByPrecedence, 'function');
  assert.equal(typeof resolveContextValue, 'function');
  assert.equal(typeof policyService.computeNeedsFromDefinition, 'function');
});

test('PTE practice AI scoring is an activity quota enabled key', () => {
  assert.ok(policyService.MIDDLEWARE_ENABLED_KEYS.includes('PTE_PRACTICE_BY_SKILLS::AI_SCORING'));
});

test('activity quota rule event picker includes PTE item scoring', async () => {
  const rows = await consumptionDefinitionDataService.listPickerEventTypes({}, SYSTEM_CONTEXT, {});
  assert.ok(rows.some((row) => row.id === 'practice_item_scored'));
});

test('activity quota rule form options expose hybrid consume timing', () => {
  const options = consumptionDefinitionDataService.getFormOptions();
  const rows = Array.isArray(options?.consumeTimings) ? options.consumeTimings : [];
  assert.ok(rows.some((row) => row?.value === 'hybrid'));
});

test('definition validity uses timezone-aware date-range window', () => {
  const active = definitionIsValidityActive({
    active: true,
    validity: {
      mode: 'date_range',
      startDate: '2026-04-01',
      endDate: '2026-04-30',
      timezone: 'America/Edmonton'
    }
  }, '2026-04-30T22:00:00.000Z');
  assert.equal(active, true);

  const inactive = definitionIsValidityActive({
    active: true,
    validity: {
      mode: 'date_range',
      startDate: '2026-04-01',
      endDate: '2026-04-20',
      timezone: 'America/Edmonton'
    }
  }, '2026-04-30T22:00:00.000Z');
  assert.equal(inactive, false);
});

test('definition validity treats always mode as active for active rows', () => {
  const active = definitionIsValidityActive({
    active: true,
    validity: {
      mode: 'always',
      startDate: '',
      endDate: '',
      timezone: 'UTC'
    }
  }, '2026-04-30T22:00:00.000Z');
  assert.equal(active, true);
});

test('precedence resolves targeted over generic and fallback', () => {
  const chosen = pickDefinitionByPrecedence([
    {
      id: 'A',
      sourceEventType: '',
      targetUserIds: [],
      isFallback: true,
      validity: { startDate: '2026-04-01' },
      audit: { lastUpdateDateTime: '2026-04-10T00:00:00.000Z' }
    },
    {
      id: 'B',
      sourceEventType: '',
      targetUserIds: [],
      isFallback: false,
      validity: { startDate: '2026-04-10' },
      audit: { lastUpdateDateTime: '2026-04-12T00:00:00.000Z' }
    },
    {
      id: 'C',
      sourceEventType: '',
      targetUserIds: ['U-100'],
      isFallback: false,
      validity: { startDate: '2026-04-05' },
      audit: { lastUpdateDateTime: '2026-04-11T00:00:00.000Z' }
    }
  ], {
    userId: 'U-100',
    sourceEventType: 'practice_attempt_started'
  });

  assert.equal(chosen.id, 'C');
});

test('precedence picks latest validity.startDate then audit.lastUpdateDateTime', () => {
  const chosen = pickDefinitionByPrecedence([
    {
      id: 'A',
      sourceEventType: '',
      targetUserIds: [],
      isFallback: false,
      validity: { startDate: '2026-04-01' },
      audit: { lastUpdateDateTime: '2026-04-20T00:00:00.000Z' }
    },
    {
      id: 'B',
      sourceEventType: '',
      targetUserIds: [],
      isFallback: false,
      validity: { startDate: '2026-04-11' },
      audit: { lastUpdateDateTime: '2026-04-10T00:00:00.000Z' }
    }
  ], {
    userId: 'U-200',
    sourceEventType: ''
  });

  assert.equal(chosen.id, 'B');
});

test('formula computes base + multiplier * context value for all metrics', () => {
  const needs = policyService.computeNeedsFromDefinition({
    formula: {
      call: { base: 1, multiplier: 0, contextKey: '' },
      amount: { base: 2, multiplier: 3, contextKey: 'price' },
      token: { base: 0, multiplier: 2, contextKey: 'tokenCount' },
      volume: { base: 0, multiplier: 1, contextKey: 'questionCount' }
    }
  }, {
    price: 4,
    tokenCount: 10,
    questionCount: 5
  });

  assert.deepEqual(needs, {
    call: 1,
    amount: 14,
    token: 20,
    volume: 5
  });
});

test('resolvePolicyDefinition blocks when active fallback is missing', async () => {
  const originalList = repository.list;
  try {
    repository.list = async () => ([
      {
        id: 'RULE-ONLY-GENERIC',
        orgId: 'ORG-1',
        active: true,
        sectionId: 'PTE_PRACTICE_BY_SKILLS',
        operationId: 'CREATE',
        sourceEventType: '',
        targetUserIds: [],
        isFallback: false,
        consumeTiming: 'on_attempt',
        validity: {
          mode: 'date_range',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          timezone: 'UTC'
        },
        formula: {
          call: { base: 1, multiplier: 0, contextKey: '' },
          amount: { base: 0, multiplier: 0, contextKey: '' },
          token: { base: 0, multiplier: 0, contextKey: '' },
          volume: { base: 0, multiplier: 1, contextKey: 'questionCount' }
        },
        audit: { lastUpdateDateTime: '2026-04-20T00:00:00.000Z' }
      }
    ]);

    await assert.rejects(
      policyService.resolvePolicyDefinition({
        orgId: 'ORG-1',
        userId: 'USR-1',
        sectionId: 'PTE_PRACTICE_BY_SKILLS',
        operationId: 'CREATE',
        sourceEventType: 'practice_attempt_started',
        atIso: '2026-04-20T12:00:00.000Z'
      }),
      /does not have an active Activity Quota definition/
    );
  } finally {
    repository.list = originalList;
  }
});

test('resolveContextValue supports nested keys and defaults to 0', () => {
  assert.equal(resolveContextValue({ a: { b: 7 } }, 'a.b'), 7);
  assert.equal(resolveContextValue({ a: { b: 'x' } }, 'a.b'), 0);
  assert.equal(resolveContextValue({}, 'missing.value'), 0);
});
