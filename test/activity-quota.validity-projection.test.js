const test = require('node:test');
const assert = require('node:assert/strict');

const activityQuotaLedgerService = require('../MVC/services/activityQuotaLedgerService');
const activityQuotaLedgerRepository = require('../MVC/repositories/activityQuotaLedgerRepository');

const {
  allocateNeedsAcrossLots,
  isValidityActive,
  isValidityExpired,
  normalizeValidityPayload
} = activityQuotaLedgerService.__testables || {};

test('activity quota test helpers are exposed', () => {
  assert.equal(typeof allocateNeedsAcrossLots, 'function');
  assert.equal(typeof isValidityActive, 'function');
  assert.equal(typeof isValidityExpired, 'function');
  assert.equal(typeof normalizeValidityPayload, 'function');
});

test('FEFO allocation splits across eligible lots and satisfies need 200 from 36+150+200', () => {
  const lots = [
    {
      id: 'lot-A',
      status: 'active',
      creditDateTime: '2026-01-01T00:00:00.000Z',
      validity: { mode: 'date_range', startDate: '2026-01-01', endDate: '2026-05-01' },
      remaining: { call: 0, amount: 0, token: 0, volume: 36 }
    },
    {
      id: 'lot-B',
      status: 'active',
      creditDateTime: '2026-01-10T00:00:00.000Z',
      validity: { mode: 'date_range', startDate: '2026-01-01', endDate: '2026-06-01' },
      remaining: { call: 0, amount: 0, token: 0, volume: 150 }
    },
    {
      id: 'lot-C',
      status: 'active',
      creditDateTime: '2026-02-01T00:00:00.000Z',
      validity: { mode: 'date_range', startDate: '2026-01-01', endDate: '2026-12-31' },
      remaining: { call: 0, amount: 0, token: 0, volume: 200 }
    }
  ];
  const needs = { call: 0, amount: 0, token: 0, volume: 200 };
  const result = allocateNeedsAcrossLots(lots, needs, '2026-04-29');

  assert.equal(result.ok, true);
  assert.equal(result.deficits.volume, 0);
  assert.equal(result.allocation.get('lot-A').volume, 36);
  assert.equal(result.allocation.get('lot-B').volume, 150);
  assert.equal(result.allocation.get('lot-C').volume, 14);
});

test('allocation denies when combined eligible lots are insufficient', () => {
  const lots = [
    {
      id: 'lot-A',
      status: 'active',
      validity: { mode: 'date_range', startDate: '2026-01-01', endDate: '2026-05-01' },
      remaining: { call: 0, amount: 0, token: 0, volume: 36 }
    },
    {
      id: 'lot-B',
      status: 'active',
      validity: { mode: 'date_range', startDate: '2026-01-01', endDate: '2026-06-01' },
      remaining: { call: 0, amount: 0, token: 0, volume: 150 }
    }
  ];
  const needs = { call: 0, amount: 0, token: 0, volume: 200 };
  const result = allocateNeedsAcrossLots(lots, needs, '2026-04-29');

  assert.equal(result.ok, false);
  assert.equal(result.deficits.volume, 14);
});

test('validity logic excludes future-start and expired lots and includes end date boundary', () => {
  assert.equal(
    isValidityActive({ mode: 'date_range', startDate: '2026-05-01', endDate: '2026-05-31' }, '2026-04-30'),
    false
  );
  assert.equal(
    isValidityActive({ mode: 'date_range', startDate: '2026-05-01', endDate: '2026-05-31' }, '2026-05-01'),
    true
  );
  assert.equal(
    isValidityActive({ mode: 'date_range', startDate: '2026-05-01', endDate: '2026-05-31' }, '2026-05-31'),
    true
  );
  assert.equal(
    isValidityExpired({ mode: 'date_range', startDate: '2026-05-01', endDate: '2026-05-31' }, '2026-05-31'),
    false
  );
  assert.equal(
    isValidityExpired({ mode: 'date_range', startDate: '2026-05-01', endDate: '2026-05-31' }, '2026-06-01'),
    true
  );
});

test('normalizeValidityPayload supports no-expiry and date_range payloads', () => {
  const none = normalizeValidityPayload({});
  assert.deepEqual(none, {
    mode: 'none',
    startDate: '',
    endDate: '',
    timezone: 'UTC'
  });

  const window = normalizeValidityPayload({
    mode: 'date_range',
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    timezone: 'America/Edmonton'
  });
  assert.equal(window.mode, 'date_range');
  assert.equal(window.startDate, '2026-04-01');
  assert.equal(window.endDate, '2026-04-30');
  assert.equal(window.timezone, 'America/Edmonton');
});

test('package_credit without date_range validity is rejected before ledger write', async () => {
  const stamp = Date.now();
  const orgId = `ORG-PKG-${stamp}`;
  const userId = `USER-PKG-${stamp}`;
  const section = 'ACTIVITY_QUOTA';
  const operation = 'CONFIGURE';

  const beforeRows = await activityQuotaLedgerRepository.list({
    query: {
      orgId__eq: orgId,
      userId__eq: userId,
      section__eq: section,
      operation__eq: operation,
      page: 1,
      limit: 100
    },
    scope: { canViewAll: true },
    backendMode: 'json'
  });

  await assert.rejects(
    activityQuotaLedgerService.recordCredit({
      orgId,
      userId,
      section,
      operation,
      call: 0,
      amount: 0,
      token: 0,
      volume: 10,
      source: {
        module: 'test',
        eventType: 'package_credit',
        eventId: `PKG-${stamp}`
      },
      validity: { mode: 'none' }
    }, {
      backendMode: 'json',
      requestUser: { id: userId, activeOrgId: orgId, primaryOrgId: orgId }
    }),
    /date_range validity window/
  );

  const afterRows = await activityQuotaLedgerRepository.list({
    query: {
      orgId__eq: orgId,
      userId__eq: userId,
      section__eq: section,
      operation__eq: operation,
      page: 1,
      limit: 100
    },
    scope: { canViewAll: true },
    backendMode: 'json'
  });

  assert.equal(Array.isArray(beforeRows) ? beforeRows.length : 0, Array.isArray(afterRows) ? afterRows.length : 0);
});
