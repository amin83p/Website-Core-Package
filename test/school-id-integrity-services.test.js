const test = require('node:test');
const assert = require('node:assert/strict');

const activityEntryIdService = require('../packages/school/MVC/services/school/activityEntryIdService');
const manualSessionIdService = require('../packages/school/MVC/services/school/manualSessionIdService');

test('activity entry ids are activity-scoped and unique', () => {
  const activityId = 'ACT-100';
  const ensured = activityEntryIdService.ensureActivityEntryIds(activityId, [
    { entryId: 'ENTRY-1', title: 'A' },
    { entryId: 'ENTRY-1', title: 'B' },
    { entryId: 'ENTRY-2', title: 'C' }
  ]);
  assert.equal(ensured.reassigned > 0, true);
  const ids = ensured.entries.map((row) => row.entryId);
  assert.equal(new Set(ids).size, ids.length);
  ids.forEach((entryId) => {
    assert.equal(activityEntryIdService.isActivityScopedEntryId(entryId, activityId), true);
  });
});

test('manual session ids are scoped and deduplicated', () => {
  const scopeId = '598269';
  const ensured = manualSessionIdService.ensureManualSessionIds(scopeId, [
    { sessionId: 'MAN_123', isManual: true },
    { sessionId: 'MAN_123', isManual: true }
  ]);
  const ids = ensured.entries.map((row) => row.sessionId);
  assert.equal(new Set(ids).size, ids.length);
  ids.forEach((sessionId) => {
    assert.equal(manualSessionIdService.isScopedManualSessionId(sessionId, scopeId), true);
  });
});

test('ensureTimesheetManualSessionIds scopes by class or activity', () => {
  const rows = manualSessionIdService.ensureTimesheetManualSessionIds('TS-1', [
    { isManual: true, classId: 'CLS-A', sessionId: 'MAN_legacy' },
    { isManual: true, activityId: 'ACT-B', sessionId: 'MAN_legacy2' }
  ]);
  assert.equal(manualSessionIdService.isScopedManualSessionId(rows[0].sessionId, 'CLS-A'), true);
  assert.equal(manualSessionIdService.isScopedManualSessionId(rows[1].sessionId, 'ACT-B'), true);
});
