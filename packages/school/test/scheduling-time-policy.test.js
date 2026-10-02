'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../MVC/services/school/schedulingTimePolicyService');
const catalog = require('../MVC/config/schedulingTimePolicyCatalog');

test('resolvePolicy applies default day bounds and three standard frames', () => {
  const policy = service.resolvePolicy({});
  assert.equal(policy.dayBounds.earliestStart, '08:00');
  assert.equal(policy.dayBounds.latestEnd, '20:00');
  assert.equal(policy.timeFrames.length, catalog.DEFAULT_TIME_FRAMES.length);
  assert.equal(policy.timeFrames[0].startTime, '09:00');
  assert.equal(policy.timeFrames[0].endTime, '12:00');
});

test('validatePolicyInput rejects overlapping time frames', () => {
  const frames = JSON.stringify([
    { id: 'a', label: 'A', startTime: '09:00', endTime: '12:00' },
    { id: 'b', label: 'B', startTime: '11:00', endTime: '14:00' }
  ]);
  assert.throws(
    () => service.validatePolicyInput({ earliestStart: '08:00', latestEnd: '20:00', timeFrames: frames }),
    /overlap/i
  );
});

test('validatePolicyInput rejects frames outside day bounds', () => {
  const frames = JSON.stringify([
    { id: 'a', label: 'Early', startTime: '07:00', endTime: '08:30' }
  ]);
  assert.throws(
    () => service.validatePolicyInput({ earliestStart: '08:00', latestEnd: '20:00', timeFrames: frames }),
    /within day bounds/i
  );
});

test('validatePolicyInput rejects earliest start after latest end', () => {
  assert.throws(
    () => service.validatePolicyInput({ earliestStart: '21:00', latestEnd: '20:00', timeFrames: '[]' }),
    /Earliest class start must be before latest class end/
  );
});

test('freeMinutesInFrame subtracts busy intervals', () => {
  const frame = { startTime: '09:00', endTime: '12:00' };
  const free = service.freeMinutesInFrame(frame, [
    { startTime: '10:00', endTime: '11:00' }
  ]);
  assert.equal(free, 120);
});
