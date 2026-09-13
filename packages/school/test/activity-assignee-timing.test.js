'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const activityAssigneeTimingService = require('../MVC/services/school/activityAssigneeTimingService');
const { backfillActivityDocument } = require('../../../scripts/school/migration/backfillActivityAssigneeTiming');

test('deriveAssigneeEndTime adds paid hours to start time', () => {
  assert.equal(
    activityAssigneeTimingService.deriveAssigneeEndTime('08:00', 6),
    '14:00'
  );
  assert.equal(
    activityAssigneeTimingService.deriveAssigneeEndTime('09:30', 1.5),
    '11:00'
  );
});

test('applyAssigneeTiming derives end from start and paid hours', () => {
  const result = activityAssigneeTimingService.applyAssigneeTiming(
    { personId: 'P1', paidHours: 4 },
    { startTime: '10:00', endTime: '18:00', durationHours: 8 },
    { startTime: '10:00', paidHours: 4 }
  );
  assert.equal(result.startTime, '10:00');
  assert.equal(result.endTime, '14:00');
  assert.equal(result.paidHours, 4);
});

test('applyAssigneeTiming preserves explicit endTime override', () => {
  const result = activityAssigneeTimingService.applyAssigneeTiming(
    { personId: 'P1', paidHours: 4, startTime: '10:00', endTime: '16:00' },
    { startTime: '10:00', endTime: '18:00', durationHours: 8 },
    { startTime: '10:00', endTime: '16:00', paidHours: 4 }
  );
  assert.equal(result.startTime, '10:00');
  assert.equal(result.endTime, '16:00');
  assert.equal(result.paidHours, 4);
});

test('applyAssigneeTiming preserves existing assignee endTime when override omitted', () => {
  const result = activityAssigneeTimingService.applyAssigneeTiming(
    { personId: 'P1', paidHours: 4, startTime: '10:00', endTime: '15:30' },
    { startTime: '10:00', endTime: '18:00', durationHours: 8 },
    { startTime: '10:00', paidHours: 4 }
  );
  assert.equal(result.endTime, '15:30');
});

test('assigneeTimingMatchesRule accepts custom start and end times', () => {
  const matches = activityAssigneeTimingService.assigneeTimingMatchesRule(
    { personId: 'P1', paidHours: 4, startTime: '10:00', endTime: '16:00' },
    { startTime: '10:00', endTime: '18:00', durationHours: 8 }
  );
  assert.equal(matches, true);
});

test('resolveAssigneeTiming falls back to entry times when assignee times missing', () => {
  const timing = activityAssigneeTimingService.resolveAssigneeTiming({
    assignee: { paidHours: 3 },
    entry: { startTime: '08:00', endTime: '17:00', durationHours: 9 }
  });
  assert.equal(timing.startTime, '08:00');
  assert.equal(timing.endTime, '11:00');
});

test('backfillAssigneeTiming uses entry start and paid hours', () => {
  const result = activityAssigneeTimingService.backfillAssigneeTiming(
    { personId: 'P1', paidHours: 5 },
    { startTime: '08:00', durationHours: 12 }
  );
  assert.equal(result.startTime, '08:00');
  assert.equal(result.endTime, '13:00');
});

test('shouldShiftAssigneeStartOnSessionChange only when start matches prior session', () => {
  assert.equal(activityAssigneeTimingService.shouldShiftAssigneeStartOnSessionChange({
    assignee: { startTime: '08:00' },
    priorSessionStartTime: '08:00',
    newSessionStartTime: '09:00'
  }), true);
  assert.equal(activityAssigneeTimingService.shouldShiftAssigneeStartOnSessionChange({
    assignee: { startTime: '10:00' },
    priorSessionStartTime: '08:00',
    newSessionStartTime: '09:00'
  }), false);
});

test('backfillActivityDocument updates assignees without timing', () => {
  const result = backfillActivityDocument({
    id: 'ACT-1',
    entries: [{
      entryId: 'ENTRY-1',
      startTime: '08:00',
      endTime: '20:00',
      durationHours: 12,
      assignees: [{ personId: 'P1', paidHours: 6 }]
    }]
  });
  assert.equal(result.changedAssignees, 1);
  assert.equal(result.activity.entries[0].assignees[0].startTime, '08:00');
  assert.equal(result.activity.entries[0].assignees[0].endTime, '14:00');
});

test('backfillActivityDocument is idempotent for matching timing', () => {
  const activity = {
    id: 'ACT-1',
    entries: [{
      entryId: 'ENTRY-1',
      startTime: '08:00',
      endTime: '20:00',
      durationHours: 12,
      assignees: [{ personId: 'P1', paidHours: 6, startTime: '08:00', endTime: '14:00' }]
    }]
  };
  const result = backfillActivityDocument(activity);
  assert.equal(result.changedAssignees, 0);
  assert.equal(result.changed, false);
});
