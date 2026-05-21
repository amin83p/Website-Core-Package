const test = require('node:test');
const assert = require('node:assert/strict');

const creditCheckDataService = require('../MVC/services/activityQuota/creditCheckDataService');
const addCreditDataService = require('../MVC/services/activityQuota/addCreditDataService');

const {
  buildLatestLabelMapFromPackages,
  toRemainingRows,
  classifyLotValidity,
  applyRemainingValidity,
  resolveRequestedUserIdForMode,
  resolveTargetUserId
} = creditCheckDataService.__testables || {};

test('credit-check service test helpers are exposed', () => {
  assert.equal(typeof buildLatestLabelMapFromPackages, 'function');
  assert.equal(typeof toRemainingRows, 'function');
  assert.equal(typeof classifyLotValidity, 'function');
  assert.equal(typeof applyRemainingValidity, 'function');
  assert.equal(typeof resolveRequestedUserIdForMode, 'function');
});

test('classifyLotValidity detects active/upcoming/expired/perpetual windows', () => {
  const active = classifyLotValidity({
    validity: { mode: 'date_range', startDate: '2000-01-01', endDate: '9999-12-31', timezone: 'UTC' }
  });
  const upcoming = classifyLotValidity({
    validity: { mode: 'date_range', startDate: '9999-01-01', endDate: '9999-12-31', timezone: 'UTC' }
  });
  const expired = classifyLotValidity({
    validity: { mode: 'date_range', startDate: '2000-01-01', endDate: '2000-12-31', timezone: 'UTC' }
  });
  const perpetual = classifyLotValidity({
    validity: { mode: 'none', timezone: 'UTC' }
  });

  assert.equal(active.status, 'active');
  assert.equal(upcoming.status, 'upcoming');
  assert.equal(expired.status, 'expired');
  assert.equal(perpetual.status, 'perpetual');
});

test('applyRemainingValidity decorates remaining rows with validity metadata', () => {
  const remainingRows = [
    { sectionId: 'SEC_A', operationId: 'OP_X', label: 'Label X', call: 1, amount: 0, token: 0, volume: 10 }
  ];
  const lotRows = [
    {
      section: 'SEC_A',
      operation: 'OP_X',
      remaining: { call: 1, amount: 0, token: 0, volume: 10 },
      validity: { mode: 'date_range', startDate: '2000-01-01', endDate: '9999-12-31', timezone: 'UTC' }
    }
  ];

  const out = applyRemainingValidity(remainingRows, lotRows);
  assert.equal(Array.isArray(out.rows), true);
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].validityStatus, 'active');
  assert.equal(out.rows[0].validityStatusLabel, 'Active');
  assert.equal(out.rows[0].validityUntil, '9999-12-31');
});

test('latest package label wins per section/operation key', () => {
  const packagesNewestFirst = [
    {
      id: 'pkg-new',
      sections: [
        {
          id: 'SEC_A',
          operations: [
            { id: 'OP_X', label: 'Newest Label X' },
            { id: 'OP_Y', label: 'Newest Label Y' }
          ]
        }
      ]
    },
    {
      id: 'pkg-old',
      sections: [
        {
          id: 'SEC_A',
          operations: [
            { id: 'OP_X', label: 'Old Label X' },
            { id: 'OP_Z', label: 'Old Label Z' }
          ]
        }
      ]
    }
  ];

  const map = buildLatestLabelMapFromPackages(packagesNewestFirst);
  assert.equal(map.get('SEC_A::OP_X'), 'Newest Label X');
  assert.equal(map.get('SEC_A::OP_Y'), 'Newest Label Y');
  assert.equal(map.get('SEC_A::OP_Z'), 'Old Label Z');
});

test('remaining rows hide all-zero balances', () => {
  const labelMap = new Map([
    ['SEC_A::OP_X', 'Label X']
  ]);
  const rows = [
    {
      id: 'snap-1',
      section: 'SEC_A',
      operation: 'OP_X',
      metrics: { call: 0, amount: 0, token: 0, volume: 0 }
    },
    {
      id: 'snap-2',
      section: 'SEC_A',
      operation: 'OP_Y',
      metrics: { call: 0, amount: 0, token: 0, volume: 12 }
    }
  ];

  const out = toRemainingRows(rows, labelMap);
  assert.equal(out.length, 1);
  assert.equal(out[0].operationId, 'OP_Y');
  assert.equal(out[0].volume, 12);
});

test('creator mode always forces self target user', () => {
  const resolved = resolveRequestedUserIdForMode(
    { mode: 'creator', requesterUserId: 'U_SELF' },
    'U_OTHER',
    { id: 'U_SELF' }
  );
  assert.equal(resolved.forcedByMode, true);
  assert.equal(resolved.candidateUserId, 'U_SELF');
});

test('org/admin mode can switch to requested target user', () => {
  const resolved = resolveRequestedUserIdForMode(
    { mode: 'org', scopeName: 'ADMIN', requesterUserId: 'U_SELF' },
    'U_OTHER',
    { id: 'U_SELF' }
  );
  assert.equal(resolved.forcedByMode, false);
  assert.equal(resolved.candidateUserId, 'U_OTHER');
});

test('non-admin org scope is forced to self target user', () => {
  const resolved = resolveRequestedUserIdForMode(
    { mode: 'org', scopeName: 'ORGANIZATION', requesterUserId: 'U_SELF' },
    'U_OTHER',
    { id: 'U_SELF' }
  );
  assert.equal(resolved.forcedByMode, true);
  assert.equal(resolved.candidateUserId, 'U_SELF');
});

test('self target does not require picker validation', async () => {
  const original = addCreditDataService.listPickerUsers;
  let pickerCallCount = 0;
  addCreditDataService.listPickerUsers = async () => {
    pickerCallCount += 1;
    return [];
  };

  try {
    const resolved = await resolveTargetUserId(
      { mode: 'org', scopeName: 'ADMIN', requesterUserId: 'U_SELF' },
      'U_SELF',
      { id: 'U_SELF' },
      {}
    );
    assert.equal(resolved.targetUserId, 'U_SELF');
    assert.equal(resolved.forced, false);
    assert.equal(pickerCallCount, 0);
  } finally {
    addCreditDataService.listPickerUsers = original;
  }
});
