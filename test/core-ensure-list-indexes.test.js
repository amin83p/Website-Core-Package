'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runEnsureCoreListIndexes,
  TARGET_COLLECTIONS
} = require('../scripts/core/ensure-core-list-indexes');

test('TARGET_COLLECTIONS includes logs for mongo-native pagination', () => {
  assert.equal(TARGET_COLLECTIONS.has('logs'), true);
});

test('runEnsureCoreListIndexes skips when mongo backend is not configured', async () => {
  const result = await runEnsureCoreListIndexes({
    args: {},
    env: {
      DATA_BACKEND: 'json',
      MONGODB_URI: '',
      MONGO_URI: ''
    }
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'mongo-not-configured');
});
