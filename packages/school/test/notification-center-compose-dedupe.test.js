'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDedupeKey,
  hashSelectionKeys
} = require('../MVC/services/school/notificationCenterComposeService');

test('buildDedupeKey stays under outbox dedupe max length with many selection keys', () => {
  const keys = Array.from({ length: 40 }, (_, i) => `batch-q248ml8a:SES-${100000 + i}-0001`);
  const dedupe = buildDedupeKey({
    orgId: '900000',
    ruleId: 'SNCR-1791301472681-6337',
    runId: 'SNRUN-1792803526107-1212',
    recipientPersonId: '526625',
    selectionKeys: keys
  });
  assert.ok(dedupe.length <= 500);
  assert.match(dedupe, /^nc-email::/);
  assert.doesNotMatch(dedupe, /SES-100000/);
});

test('buildDedupeKey is stable for selection order and send time is not in key', () => {
  const keys = ['b', 'a', 'c'];
  const a = buildDedupeKey({
    orgId: '1',
    ruleId: 'r',
    runId: 'run',
    recipientPersonId: 't',
    selectionKeys: keys
  });
  const b = buildDedupeKey({
    orgId: '1',
    ruleId: 'r',
    runId: 'run',
    recipientPersonId: 't',
    selectionKeys: ['c', 'a', 'b']
  });
  assert.equal(a, b);
  assert.equal(hashSelectionKeys(['a', 'b']), hashSelectionKeys(['b', 'a']));
});
