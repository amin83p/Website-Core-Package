'use strict';

const assert = require('assert');
const test = require('node:test');

process.env.MAIN_SECRET_KEY ||= '0123456789abcdef0123456789abcdef';
process.env.SESSION_SECRET ||= 'fedcba9876543210fedcba9876543210';
process.env.SESSION_ENCRYPTION_KEY ||= '00112233445566778899aabbccddeeff';
process.env.ACTION_STATE_KEY ||= 'ffeeddccbbaa99887766554433221100';
process.env.DATA_BACKEND = 'json';
process.env.DATA_BACKEND_STRICT = 'false';

const composeService = require('../MVC/services/school/notificationCenterComposeService');
const { zonedWallClockToIso } = require('../../../MVC/utils/timezoneUtils');

test('resolveDefaultSendAtLocal uses rule sendAtTime on cycle date', () => {
  const rule = { channels: { email: { sendAtTime: '18:00' } } };
  const local = composeService.resolveDefaultSendAtLocal({
    rule,
    timeZone: 'UTC',
    cycleDate: '2030-06-15'
  });
  assert.equal(local, '2030-06-15T18:00');
});

test('resolveSendAtForSchedule sendNow returns near-future ISO', () => {
  const before = Date.now();
  const iso = composeService.resolveSendAtForSchedule({
    sendNow: '1',
    timeZone: 'UTC'
  });
  const ms = new Date(iso).getTime();
  assert.ok(ms >= before);
  assert.ok(ms <= before + 120_000);
});

test('resolveSendAtForSchedule rejects past scheduled time', () => {
  assert.throws(
    () => composeService.resolveSendAtForSchedule({
      sendAtLocal: '2000-01-01T08:00',
      sendNow: false,
      timeZone: 'UTC'
    }),
    /future/i
  );
});

test('isTruthySendNow accepts common truthy tokens', () => {
  assert.equal(composeService.isTruthySendNow('1'), true);
  assert.equal(composeService.isTruthySendNow('true'), true);
  assert.equal(composeService.isTruthySendNow(''), false);
});

test('resolveDefaultSendAtIso rolls to next day when send time already passed', () => {
  const timeZone = 'UTC';
  const today = new Date();
  const cycleDate = today.toISOString().slice(0, 10);
  const pastHour = String(Math.max(0, today.getUTCHours() - 2)).padStart(2, '0');
  const rule = { channels: { email: { sendAtTime: `${pastHour}:30` } } };
  const iso = composeService.resolveDefaultSendAtIso({ rule, timeZone, cycleDate });
  const expectedTomorrow = zonedWallClockToIso(
    composeService.resolveDefaultSendAtLocal({ rule, timeZone, cycleDate }).startsWith(cycleDate)
      ? cycleDate
      : cycleDate,
    `${pastHour}:30`,
    timeZone
  );
  assert.ok(iso);
  assert.ok(new Date(iso).getTime() > Date.now() - 60_000);
});
