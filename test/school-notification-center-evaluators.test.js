const assert = require('assert');
const test = require('node:test');

process.env.MAIN_SECRET_KEY ||= '0123456789abcdef0123456789abcdef';
process.env.SESSION_SECRET ||= 'fedcba9876543210fedcba9876543210';
process.env.SESSION_ENCRYPTION_KEY ||= '00112233445566778899aabbccddeeff';
process.env.ACTION_STATE_KEY ||= 'ffeeddccbbaa99887766554433221100';
process.env.DATA_BACKEND = 'json';
process.env.DATA_BACKEND_STRICT = 'false';

const registry = require('../packages/school/MVC/services/school/notificationCenterEvaluatorRegistry');

test('notification centre evaluator registry exposes all planned rule types', () => {
  assert.ok(registry.getEvaluator('session_not_final'));
  assert.ok(registry.getEvaluator('session_attendance_incomplete'));
  assert.ok(registry.getEvaluator('timesheet_not_submitted'));
  assert.equal(registry.getEvaluator('unknown_type'), null);
});

test('groupFindingsByRecipient groups findings by editor person id', () => {
  const grouped = registry.groupFindingsByRecipient([
    { recipientPersonIds: ['P1', 'P2'], title: 'A' },
    { recipientPersonIds: ['P2'], title: 'B' }
  ]);
  assert.equal(grouped.get('P1')?.length, 1);
  assert.equal(grouped.get('P2')?.length, 2);
});
