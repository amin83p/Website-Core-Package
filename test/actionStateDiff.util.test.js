const test = require('node:test');
const assert = require('node:assert/strict');

const { buildActionStateDiff } = require('../MVC/utils/actionStateDiff');

test('buildActionStateDiff captures added and changed fields only', () => {
  const before = {
    id: 'X1',
    name: 'Old',
    nested: { level: 1, keep: true },
    removedField: 'legacy',
    audit: {
      lastUpdateUser: 'A',
      lastUpdateDateTime: '2026-04-01T00:00:00.000Z'
    }
  };
  const after = {
    id: 'X1',
    name: 'New',
    nested: { level: 1, keep: true, extra: 'added' },
    audit: {
      lastUpdateUser: 'B',
      lastUpdateDateTime: '2026-05-01T00:00:00.000Z'
    }
  };

  const out = buildActionStateDiff(before, after);
  const paths = out.changes.map((row) => row.path).sort();

  assert.deepEqual(paths, ['name', 'nested.extra']);
  assert.equal(out.summary.addedCount, 1);
  assert.equal(out.summary.changedCount, 1);
  assert.equal(out.summary.hiddenAuditCount >= 1, true);
});

test('buildActionStateDiff handles array append as added field path', () => {
  const before = {
    tags: ['A']
  };
  const after = {
    tags: ['A', 'B']
  };

  const out = buildActionStateDiff(before, after);
  assert.equal(out.summary.addedCount, 1);
  assert.equal(out.summary.changedCount, 0);
  assert.equal(out.changes[0].path, 'tags[1]');
  assert.equal(out.changes[0].type, 'added');
  assert.equal(out.changes[0].to, 'B');
});
