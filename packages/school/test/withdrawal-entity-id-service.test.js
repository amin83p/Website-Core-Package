const test = require('node:test');
const assert = require('node:assert/strict');

const { candidateWithdrawalId, allocateUniqueWithdrawalId } = require('../MVC/services/school/withdrawalEntityIdService');

test('withdrawal ids use typed prefixes', () => {
  assert.match(candidateWithdrawalId('class'), /^CWD-\d+-[0-9]+$/);
  assert.match(candidateWithdrawalId('term'), /^TWD-\d+-[0-9]+$/);
  assert.match(candidateWithdrawalId('program'), /^PWD-\d+-[0-9]+$/);
});

test('allocateUniqueWithdrawalId skips reserved ids', async () => {
  const id = await allocateUniqueWithdrawalId({
    withdrawalType: 'program',
    existingIds: ['PWD-1-1']
  });
  assert.match(id, /^PWD-\d+-[0-9]+$/);
});
