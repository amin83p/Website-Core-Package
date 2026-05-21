const test = require('node:test');
const assert = require('node:assert/strict');

const entitlementService = require('../MVC/services/security/entitlementService');

test('normalizeMembershipPeriods preserves period history rows', () => {
  const periods = [
    { startDate: '2026-04-01', endDate: '2026-04-10' },
    { startDate: '2026-04-08', endDate: '2026-04-15' },
    { startDate: '2026-04-16', endDate: '2026-04-20' },
    { startDate: '2026-05-01', endDate: '2026-05-03' }
  ];

  const normalized = entitlementService.normalizeMembershipPeriods(periods);
  assert.equal(normalized.length, 4);
  assert.equal(normalized[0].startDate, '2026-04-01');
  assert.equal(normalized[0].endDate, '2026-04-10');
});

test('mergeMembershipPeriods computes effective validity timeline', () => {
  const periods = [
    { startDate: '2026-04-01', endDate: '2026-04-10' },
    { startDate: '2026-04-08', endDate: '2026-04-15' },
    { startDate: '2026-04-16', endDate: '2026-04-20' },
    { startDate: '2026-05-01', endDate: '2026-05-03' }
  ];

  const merged = entitlementService.mergeMembershipPeriods(periods);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].startDate, '2026-04-01');
  assert.equal(merged[0].endDate, '2026-04-20');
  assert.equal(merged[1].startDate, '2026-05-01');
  assert.equal(merged[1].endDate, '2026-05-03');
});

test('evaluateUserEntitlement returns backward-compatible allow when no records', () => {
  const result = entitlementService.evaluateUserEntitlement([], 'U1', '1', { today: '2026-04-09' });
  assert.equal(result.enforced, false);
  assert.equal(result.active, true);
  assert.equal(result.status, 'not_configured');
});

test('evaluateUserEntitlement denies expired timelines', () => {
  const records = [
    {
      userId: 'U1',
      orgId: '1',
      active: true,
      periods: [{ startDate: '2026-01-01', endDate: '2026-01-31' }]
    }
  ];
  const result = entitlementService.evaluateUserEntitlement(records, 'U1', '1', { today: '2026-04-09' });
  assert.equal(result.enforced, true);
  assert.equal(result.active, false);
  assert.equal(result.status, 'expired');
});

test('evaluateUserEntitlement allows active global records for org context', () => {
  const records = [
    {
      userId: 'U1',
      orgId: null,
      active: true,
      periods: [{ startDate: '2026-04-01', endDate: '2026-04-30' }]
    }
  ];
  const result = entitlementService.evaluateUserEntitlement(records, 'U1', '55', { today: '2026-04-09' });
  assert.equal(result.enforced, true);
  assert.equal(result.active, true);
  assert.equal(result.status, 'active');
});

test('evaluateUserEntitlement allows active membership when no periods are configured', () => {
  const records = [
    {
      userId: 'U1',
      orgId: '55',
      active: true,
      periods: []
    }
  ];
  const result = entitlementService.evaluateUserEntitlement(records, 'U1', '55', { today: '2026-04-09' });
  assert.equal(result.enforced, false);
  assert.equal(result.active, true);
  assert.equal(result.status, 'no_period_bypass');
});

test('evaluateUserEntitlement blocks all orgs when global membership row is deactivated', () => {
  const records = [
    {
      userId: 'U1',
      orgId: null,
      active: false,
      periods: [{ startDate: '2026-01-01', endDate: '2026-12-31' }]
    }
  ];
  const result = entitlementService.evaluateUserEntitlement(records, 'U1', '55', { today: '2026-04-09' });
  assert.equal(result.enforced, true);
  assert.equal(result.active, false);
  assert.equal(result.status, 'deactivated_global');
  assert.equal(result.appliesToAllOrgs, true);
});

test('evaluateUserEntitlement blocks only targeted org when scoped row is deactivated', () => {
  const records = [
    {
      userId: 'U1',
      orgId: '55',
      active: false,
      periods: [{ startDate: '2026-01-01', endDate: '2026-12-31' }]
    }
  ];
  const blocked = entitlementService.evaluateUserEntitlement(records, 'U1', '55', { today: '2026-04-09' });
  const otherOrg = entitlementService.evaluateUserEntitlement(records, 'U1', '77', { today: '2026-04-09' });
  assert.equal(blocked.status, 'deactivated_org');
  assert.equal(blocked.active, false);
  assert.equal(otherOrg.status, 'not_configured');
  assert.equal(otherOrg.active, true);
});

test('evaluateUserEntitlement respects period org scope for global memberships', () => {
  const records = [
    {
      userId: 'U1',
      orgId: null,
      active: true,
      periods: [
        { startDate: '2026-04-01', endDate: '2026-04-30', orgId: '200' }
      ]
    }
  ];

  const blocked = entitlementService.evaluateUserEntitlement(records, 'U1', '100', { today: '2026-04-09' });
  const allowed = entitlementService.evaluateUserEntitlement(records, 'U1', '200', { today: '2026-04-09' });

  assert.equal(blocked.status, 'no_period_for_org');
  assert.equal(blocked.active, false);
  assert.equal(allowed.status, 'active');
  assert.equal(allowed.active, true);
});

test('normalizeMembershipPayload locks period org to scoped membership org', () => {
  const payload = entitlementService.normalizeMembershipPayload({
    userId: 'U1',
    orgId: '500',
    active: true,
    periods: [
      { startDate: '2026-01-01', endDate: '2026-12-31', orgId: '700' }
    ]
  });

  assert.equal(payload.orgId, '500');
  assert.equal(Array.isArray(payload.periods), true);
  assert.equal(payload.periods.length, 1);
  assert.equal(payload.periods[0].orgId, '500');
});
