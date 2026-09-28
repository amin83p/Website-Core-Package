const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildActiveClassesForSchedulePerson,
  collectClassIdsWithSessionsInEvents,
  isActiveClassForSchedulePicker
} = require('../MVC/controllers/school/scheduleController');

test('isActiveClassForSchedulePicker accepts only active status', () => {
  assert.equal(isActiveClassForSchedulePicker({ status: 'active' }), true);
  assert.equal(isActiveClassForSchedulePicker({ status: 'Active' }), true);
  assert.equal(isActiveClassForSchedulePicker({ status: 'draft' }), false);
  assert.equal(isActiveClassForSchedulePicker({ status: 'archived' }), false);
});

test('collectClassIdsWithSessionsInEvents only includes class_session events in range payload', () => {
  const ids = collectClassIdsWithSessionsInEvents([
    { eventType: 'class_session', classId: 'C1' },
    { eventType: 'class_session', classId: 'C2' },
    { eventType: 'class_session', classId: 'C1' },
    { eventType: 'school_activity', classId: 'C9' },
    { eventType: 'report_task', classId: 'C8' }
  ]);
  assert.deepEqual([...ids].sort(), ['C1', 'C2']);
});

test('buildActiveClassesForSchedulePerson filters and sorts picker items', () => {
  const classMap = new Map([
    ['C2', { id: 'C2', title: 'Beta Class', status: 'active' }],
    ['C1', { id: 'C1', title: 'Alpha Class', status: 'active' }],
    ['C3', { id: 'C3', title: 'Closed Class', status: 'closed' }],
    ['C4', { id: 'C4', title: 'Orphan', status: 'active' }]
  ]);
  const candidateClassIds = new Set(['C1', 'C2', 'C3']);
  const items = buildActiveClassesForSchedulePerson(classMap, candidateClassIds);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, 'C1');
  assert.equal(items[0].title, 'Alpha Class');
  assert.equal(items[1].id, 'C2');
  assert.deepEqual(items.map((row) => row.id), ['C1', 'C2']);
});
