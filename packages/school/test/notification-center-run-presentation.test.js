'use strict';

const assert = require('assert');
const test = require('node:test');
const {
  buildRunPresentationTree,
  resolveSelectedItems,
  computeDaysPassed,
  formatDaysPassedLabel,
  enrichSessionFromFinding
} = require('../MVC/services/school/notificationCenterRunPresentationService');

test('buildRunPresentationTree groups by teacher and class', () => {
  const tree = buildRunPresentationTree({
    asOfDate: '2026-09-10',
    batches: [{
      id: 'b1',
      recipientPersonId: 'T1',
      recipientName: 'Alice Teacher',
      items: [
        { id: 'S1', title: 'Session 1', classTitle: 'Math 101', sessionDate: '2026-09-01' },
        { id: 'S2', title: 'Session 2', classTitle: 'Math 101', sessionDate: '2026-09-02' },
        { id: 'S3', title: 'Session 3', classTitle: '', sessionDate: '2026-09-03' }
      ]
    }]
  });
  assert.equal(tree.teachers.length, 1);
  assert.equal(tree.teachers[0].name, 'Alice Teacher');
  assert.equal(tree.teachers[0].sessionCount, 3);
  assert.equal(tree.teachers[0].classes.length, 2);
  const math = tree.teachers[0].classes.find((c) => c.classTitle === 'Math 101');
  assert.ok(math);
  assert.equal(math.sessions.length, 2);
  const general = tree.teachers[0].classes.find((c) => c.classTitle === 'General');
  assert.ok(general);
  assert.equal(general.sessions.length, 1);
});

test('resolveSelectedItems returns items for selection keys', () => {
  const run = {
    batches: [{
      id: 'b1',
      recipientPersonId: 'T1',
      items: [
        { id: 'S1', title: 'A' },
        { id: 'S2', title: 'B' }
      ]
    }]
  };
  const { items, recipientPersonId } = resolveSelectedItems(run, ['b1:S1']);
  assert.equal(recipientPersonId, 'T1');
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'S1');
});

test('computeDaysPassed uses calendar days', () => {
  assert.equal(computeDaysPassed('2026-09-10', '2026-09-10'), 0);
  assert.equal(computeDaysPassed('2026-09-08', '2026-09-10'), 2);
  assert.equal(formatDaysPassedLabel(0), 'Today');
  assert.equal(formatDaysPassedLabel(1), '1 day');
  assert.equal(formatDaysPassedLabel(4), '4 days');
});

test('enrichSessionFromFinding adds time status and days passed', () => {
  const statusMap = new Map([
    ['scheduled', { label: 'Scheduled', isFinal: false }]
  ]);
  const row = enrichSessionFromFinding({
    id: 'S1',
    title: 'Morning class',
    sessionDate: '2026-09-05',
    href: '/school/classes/C1/sessions/S1',
    payload: {
      session: {
        date: '2026-09-05',
        startTime: '09:00',
        endTime: '10:30',
        status: 'scheduled'
      }
    }
  }, { asOfDate: '2026-09-10', statusMap });
  assert.equal(row.sessionTime, '09:00 – 10:30');
  assert.equal(row.statusLabel, 'Scheduled');
  assert.equal(row.statusIsFinal, false);
  assert.equal(row.daysPassed, 5);
  assert.equal(row.daysPassedLabel, '5 days');
});
