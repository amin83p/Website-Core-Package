const test = require('node:test');
const assert = require('node:assert/strict');

const model = require('../MVC/models/packageEvolutionItemModel');

test('normalizePackageEvolutionItem builds upsert key and validates change type', () => {
  const row = model.normalizePackageEvolutionItem({
    packageName: 'school',
    commitSha: 'abc123def456',
    committedAt: '2026-03-01T12:00:00.000Z',
    changeType: 'bug',
    title: 'Fix enrollment filter'
  }, null, { strict: true });
  assert.equal(row.packageName, 'SCHOOL');
  assert.equal(row.changeType, 'bug');
  assert.match(row.upsertKey, /abc123def456/);
});

test('normalizePackageEvolutionItem clamps negative task duration', () => {
  const row = model.normalizePackageEvolutionItem({
    packageName: 'CORE',
    commitSha: 'fff',
    committedAt: '2026-03-01T12:00:00.000Z',
    title: 'T',
    taskDuration: { days: -1, hours: 2, minutes: 90 }
  }, null, { strict: true });
  assert.equal(row.taskDuration.days, 0);
  assert.equal(row.taskDuration.hours, 2);
  assert.equal(row.taskDuration.minutes, 90);
});