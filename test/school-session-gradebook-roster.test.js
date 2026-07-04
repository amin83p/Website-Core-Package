const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Documents the gradebook roster mismatch: UI uses enriched roster, save used persisted roster only.
 */
test('effective roster includes enrollment students missing from persisted roster', () => {
  const persistedRoster = [{ personId: 'STU-1', attendance: 'present' }];
  const enrichedRoster = [
    { personId: 'STU-1', attendance: 'present' },
    { personId: 'STU-2', attendance: 'present' }
  ];
  const requestScores = { 'STU-1': 9, 'STU-2': 7 };

  const oldPersonIds = [...new Set(persistedRoster.map((r) => r.personId))];
  const oldDropped = Object.keys(requestScores).filter((pid) => !oldPersonIds.includes(pid));
  assert.deepEqual(oldDropped, ['STU-2'], 'bug: persisted-only roster drops enrollment student scores');

  const newPersonIds = [...new Set(enrichedRoster.map((r) => r.personId))];
  const newDropped = Object.keys(requestScores).filter((pid) => !newPersonIds.includes(pid));
  assert.equal(newDropped.length, 0, 'fix: effective roster retains all UI-entered scores');
});
