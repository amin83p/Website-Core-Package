const test = require('node:test');
const assert = require('node:assert/strict');

const { allocateUniqueActivityId } = require('../MVC/services/school/activityIdService');

test('allocateUniqueActivityId skips reserved ids', async () => {
  const id = await allocateUniqueActivityId({
    existingIds: ['ACT-100001', 'ACT-100002'],
    reservedIds: ['ACT-100001']
  });
  assert.match(id, /^ACT-\d{6}$/);
  assert.notEqual(id, 'ACT-100001');
});
