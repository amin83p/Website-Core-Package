'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const availabilityService = require('../MVC/services/school/teacherAvailabilityService');
const schedulingTimePolicyService = require('../MVC/services/school/schedulingTimePolicyService');
const teacherRoutes = require('fs').readFileSync(
  require('path').join(__dirname, '../MVC/routes/teacherRoutes.js'),
  'utf8'
);
const teacherController = require('fs').readFileSync(
  require('path').join(__dirname, '../MVC/controllers/school/teacherController.js'),
  'utf8'
);

test('listDatesInclusive returns each day in range', () => {
  const dates = availabilityService.listDatesInclusive('2026-01-01', '2026-01-03');
  assert.deepEqual(dates, ['2026-01-01', '2026-01-02', '2026-01-03']);
});

test('clipFrameToDayBounds trims frame to configured day bounds', () => {
  const policy = schedulingTimePolicyService.resolvePolicy({});
  const clipped = availabilityService.clipFrameToDayBounds(
    { id: 'f1', label: 'Morning', startTime: '07:00', endTime: '12:00' },
    policy.dayBounds
  );
  assert.equal(clipped.startTime, '08:00');
  assert.equal(clipped.endTime, '12:00');
});

test('busy session consumes frame minutes for ranking math', () => {
  const frame = { startTime: '09:00', endTime: '12:00' };
  const busy = [{ startTime: '09:00', endTime: '12:00' }];
  const freeBusy = schedulingTimePolicyService.freeMinutesInFrame(frame, busy);
  const freeClear = schedulingTimePolicyService.freeMinutesInFrame(frame, []);
  assert.equal(freeBusy, 0);
  assert.equal(freeClear, 180);
  assert.ok(freeClear > freeBusy);
});

test('teacher availability rank route and controller are wired', () => {
  assert.match(teacherRoutes, /\/api\/availability-rank/);
  assert.match(teacherRoutes, /rankTeachersByAvailability/);
  assert.match(teacherController, /rankTeachersByAvailability/);
  assert.match(teacherController, /teacherAvailabilityService\.rankTeachersByAvailability/);
});
