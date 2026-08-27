const test = require('node:test');
const assert = require('node:assert/strict');

const alignmentService = require('../MVC/services/school/rollingEnrollmentSessionAlignmentService');

test('resolveAnticipatedFinishDate returns Nth session date for session cap', () => {
  const finish = alignmentService.resolveAnticipatedFinishDate({
    countableSessions: [
      { date: '2026-01-05', durationHours: 1 },
      { date: '2026-01-12', durationHours: 1 },
      { date: '2026-01-19', durationHours: 1 }
    ],
    targetSessionCount: 2
  });
  assert.equal(finish, '2026-01-12');
});

test('resolveAnticipatedFinishDate returns null when session cap exceeds available sessions', () => {
  const finish = alignmentService.resolveAnticipatedFinishDate({
    countableSessions: [{ date: '2026-01-05', durationHours: 1 }],
    targetSessionCount: 3
  });
  assert.equal(finish, null);
});

test('resolveAnticipatedFinishDate returns last allocated session date for hour cap', () => {
  const finish = alignmentService.resolveAnticipatedFinishDate({
    countableSessions: [
      { date: '2026-01-05', durationHours: 1 },
      { date: '2026-01-12', durationHours: 1.5 },
      { date: '2026-01-19', durationHours: 2 }
    ],
    targetHours: 2.5
  });
  assert.equal(finish, '2026-01-12');
});

test('resolveAnticipatedFinishDate returns null when hour cap cannot be met', () => {
  const finish = alignmentService.resolveAnticipatedFinishDate({
    countableSessions: [
      { date: '2026-01-05', durationHours: 1 },
      { date: '2026-01-12', durationHours: 1 }
    ],
    targetHours: 5
  });
  assert.equal(finish, null);
});
