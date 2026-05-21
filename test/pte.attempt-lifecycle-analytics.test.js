const test = require('node:test');
const assert = require('node:assert/strict');

const lifecycleAnalytics = require('../MVC/services/pte/pteAttemptLifecycleAnalytics');

function makeSession(overrides = {}) {
  return {
    id: 'sess-1',
    startedAt: '2026-04-20T10:00:00.000Z',
    finishedAt: '2026-04-20T10:30:00.000Z',
    ...overrides
  };
}

function makeItem(id, order = 1, overrides = {}) {
  return {
    id,
    questionOrder: order,
    questionVersionId: `qv-${order}`,
    questionType: 'reading_fill_in_blank',
    skill: 'reading',
    metadata: { questionTitle: `Question ${order}` },
    ...overrides
  };
}

function makeEvent(id, eventType, eventAt, itemId = 'item-1', overrides = {}) {
  return {
    id,
    eventType,
    eventAt,
    attemptItemId: itemId,
    metadata: {},
    ...overrides
  };
}

test('single start then save produces one interval and no anomaly', () => {
  const session = makeSession();
  const items = [makeItem('item-1', 1)];
  const events = [
    makeEvent('e1', 'question_started', '2026-04-20T10:00:00.000Z'),
    makeEvent('e2', 'response_saved', '2026-04-20T10:00:30.000Z'),
    makeEvent('e3', 'question_submitted', '2026-04-20T10:01:00.000Z')
  ];
  const result = lifecycleAnalytics.buildAttemptLifecycle(session, items, events);
  assert.equal(result.summary.startCount, 1);
  assert.equal(result.summary.saveCount, 1);
  assert.equal(result.summary.submitCount, 1);
  assert.equal(result.summary.noSaveStartCount, 0);
  assert.equal(result.summary.anomalyCount, 0);
  assert.equal(result.intervals.length, 1);
  assert.equal(result.intervals[0].saveCountInInterval, 1);
  assert.equal(result.intervals[0].submitOccurred, true);
});

test('single start then submit without save increments noSaveStartCount', () => {
  const result = lifecycleAnalytics.buildAttemptLifecycle(
    makeSession(),
    [makeItem('item-1', 1)],
    [
      makeEvent('e1', 'question_started', '2026-04-20T10:00:00.000Z'),
      makeEvent('e2', 'question_submitted', '2026-04-20T10:00:40.000Z')
    ]
  );
  assert.equal(result.summary.startCount, 1);
  assert.equal(result.summary.saveCount, 0);
  assert.equal(result.summary.submitCount, 1);
  assert.equal(result.summary.noSaveStartCount, 1);
});

test('start then skip closes interval with skip reason and no-save count', () => {
  const result = lifecycleAnalytics.buildAttemptLifecycle(
    makeSession(),
    [makeItem('item-1', 1)],
    [
      makeEvent('e1', 'question_started', '2026-04-20T10:00:00.000Z'),
      makeEvent('e2', 'question_skipped', '2026-04-20T10:00:20.000Z')
    ]
  );
  assert.equal(result.summary.startCount, 1);
  assert.equal(result.summary.skipCount, 1);
  assert.equal(result.summary.noSaveStartCount, 1);
  assert.equal(result.intervals[0].endReason, 'question_skipped');
});

test('repeated starts before terminal event creates overlapping_start anomaly', () => {
  const result = lifecycleAnalytics.buildAttemptLifecycle(
    makeSession(),
    [makeItem('item-1', 1)],
    [
      makeEvent('e1', 'question_started', '2026-04-20T10:00:00.000Z'),
      makeEvent('e2', 'question_started', '2026-04-20T10:00:10.000Z'),
      makeEvent('e3', 'response_saved', '2026-04-20T10:00:20.000Z'),
      makeEvent('e4', 'question_submitted', '2026-04-20T10:00:30.000Z')
    ]
  );
  assert.equal(result.summary.startCount, 2);
  assert.equal(result.intervals.length, 2);
  assert.equal(result.intervals[0].endReason, 'overlapping_start');
  assert.equal(result.intervals[1].submitOccurred, true);
  assert.equal(result.anomalies.some((row) => row.type === 'overlapping_start'), true);
});

test('mixed save submit skip sequence across two questions aggregates correctly', () => {
  const items = [makeItem('item-1', 1), makeItem('item-2', 2)];
  const events = [
    makeEvent('e1', 'question_started', '2026-04-20T10:00:00.000Z', 'item-1'),
    makeEvent('e2', 'response_saved', '2026-04-20T10:00:10.000Z', 'item-1'),
    makeEvent('e3', 'question_submitted', '2026-04-20T10:00:30.000Z', 'item-1'),
    makeEvent('e4', 'question_started', '2026-04-20T10:01:00.000Z', 'item-2'),
    makeEvent('e5', 'question_skipped', '2026-04-20T10:01:20.000Z', 'item-2')
  ];
  const result = lifecycleAnalytics.buildAttemptLifecycle(makeSession(), items, events);
  assert.equal(result.summary.itemCount, 2);
  assert.equal(result.summary.startCount, 2);
  assert.equal(result.summary.saveCount, 1);
  assert.equal(result.summary.submitCount, 1);
  assert.equal(result.summary.skipCount, 1);
  assert.equal(result.summary.noSaveStartCount, 1);
  assert.equal(result.summary.anomalyCount, 0);
});

test('open interval on session finalize is closed and flagged', () => {
  const session = makeSession({ finishedAt: '2026-04-20T10:05:00.000Z' });
  const events = [
    makeEvent('e1', 'question_started', '2026-04-20T10:00:00.000Z'),
    makeEvent('e2', 'attempt_finished', '2026-04-20T10:05:00.000Z', '', { attemptItemId: '' })
  ];
  const result = lifecycleAnalytics.buildAttemptLifecycle(session, [makeItem('item-1', 1)], events);
  assert.equal(result.intervals.length, 1);
  assert.equal(result.intervals[0].endReason, 'session_finalized');
  assert.equal(result.anomalies.some((row) => row.type === 'open_interval_on_finalize'), true);
});

test('out-of-order and duplicate timestamp events are processed in stable order', () => {
  const events = [
    makeEvent('e20', 'response_saved', '2026-04-20T10:00:10.000Z'),
    makeEvent('e10', 'question_started', '2026-04-20T10:00:10.000Z'),
    makeEvent('e30', 'question_submitted', '2026-04-20T10:00:10.000Z')
  ];
  const result = lifecycleAnalytics.buildAttemptLifecycle(makeSession(), [makeItem('item-1', 1)], events);
  assert.equal(result.summary.startCount, 1);
  assert.equal(result.summary.saveCount, 1);
  assert.equal(result.summary.submitCount, 1);
  assert.equal(result.summary.anomalyCount, 0);
  assert.equal(result.intervals.length, 1);
  assert.equal(result.intervals[0].startEventId, 'e10');
  assert.equal(result.intervals[0].endEventId, 'e30');
});

test('events for unknown items are reported as orphan_event anomalies', () => {
  const result = lifecycleAnalytics.buildAttemptLifecycle(
    makeSession(),
    [makeItem('item-1', 1)],
    [makeEvent('e1', 'response_saved', '2026-04-20T10:00:00.000Z', 'missing-item')]
  );
  assert.equal(result.summary.anomalyCount, 1);
  assert.equal(result.anomalies[0].type, 'orphan_event');
});
