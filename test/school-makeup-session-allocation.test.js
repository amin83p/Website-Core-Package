const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const allocation = require('../packages/school/MVC/services/school/makeupSessionAllocationService');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const statusDefinitions = [
  { code: 'scheduled', label: 'Scheduled', makeupDurationPercent: 100 },
  { code: 'completed', label: 'Completed', makeupDurationPercent: 100 },
  { code: 'cancelled', label: 'Cancelled', makeupDurationPercent: 100 },
  { code: 'missed', label: 'Make-up Required', makeUpRequired: true, makeupDurationPercent: 50 }
];

function child(sessionId, startTime, endTime, status = 'scheduled', originalSessionId = 'ORIGINAL') {
  return {
    sessionId,
    date: '2026-08-10',
    startTime,
    endTime,
    status,
    delivery: { deliveredBy: 'T1', deliveredByName: 'Teacher One' },
    room: 'Room 1',
    makeup: {
      isMakeup: true,
      originalClassId: 'CLASS_1',
      originalSessionId
    }
  };
}

test('allocation counts every live direct child status and ignores nested and stale history rows', () => {
  const original = {
    sessionId: 'ORIGINAL',
    startTime: '08:00',
    endTime: '11:00',
    status: 'missed',
    makeupHistory: [{ makeupSessionId: 'STALE_DELETED', makeupDurationHours: 8 }]
  };
  const sessions = [
    original,
    child('SCHEDULED_CHILD', '08:00', '08:45', 'scheduled'),
    child('CANCELLED_CHILD', '09:00', '09:30', 'cancelled'),
    child('NESTED_ORIGINAL', '10:00', '10:15', 'missed'),
    child('NESTED_CHILD', '12:00', '12:10', 'scheduled', 'NESTED_ORIGINAL')
  ];

  const summary = allocation.buildMakeupAllocationSummary({
    classId: 'CLASS_1',
    originalSession: original,
    sessions,
    statusDefinitions
  });

  assert.equal(summary.originalDurationMinutes, 180);
  assert.equal(summary.allowedDurationPercent, 50);
  assert.equal(summary.allowedDurationMinutes, 90);
  assert.equal(summary.allocatedDurationMinutes, 90);
  assert.equal(summary.remainingDurationMinutes, 0);
  assert.equal(summary.sessionCount, 3);
  assert.deepEqual(summary.sessions.map((row) => row.sessionId), [
    'SCHEDULED_CHILD',
    'CANCELLED_CHILD',
    'NESTED_ORIGINAL'
  ]);
  assert.equal(summary.sessions[1].statusLabel, 'Cancelled');
  assert.match(summary.sessions[0].manageUrl, /CLASS_1\/sessions\/SCHEDULED_CHILD$/);
});

test('original-session reference includes operational details and a manager link', () => {
  const reference = allocation.buildSessionReference({
    sessionId: 'ORIGINAL',
    date: '2026-08-04',
    startTime: '08:00',
    endTime: '10:00',
    status: 'missed',
    delivery: { deliveredBy: 'T1', deliveredByName: 'Teacher One' },
    room: 'Room 4'
  }, {
    classId: 'CLASS_1',
    statusDefinitions
  });

  assert.equal(reference.sessionId, 'ORIGINAL');
  assert.equal(reference.durationHours, 2);
  assert.equal(reference.teacherName, 'Teacher One');
  assert.equal(reference.room, 'Room 4');
  assert.equal(reference.statusLabel, 'Make-up Required');
  assert.equal(reference.manageUrl, '/school/classes/CLASS_1/sessions/ORIGINAL');
});

test('nested make-up session receives an independent direct-child allowance', () => {
  const nestedOriginal = {
    ...child('NESTED_ORIGINAL', '10:00', '10:20', 'missed'),
    makeupScheduling: { durationPercent: 100 }
  };
  const nestedChild = child('NESTED_CHILD', '12:00', '12:10', 'completed', 'NESTED_ORIGINAL');
  const summary = allocation.buildMakeupAllocationSummary({
    classId: 'CLASS_1',
    originalSession: nestedOriginal,
    sessions: [nestedOriginal, nestedChild],
    statusDefinitions
  });

  assert.equal(summary.originalDurationMinutes, 20);
  assert.equal(summary.allowedDurationMinutes, 20);
  assert.equal(summary.allocatedDurationMinutes, 10);
  assert.equal(summary.remainingDurationMinutes, 10);
  assert.deepEqual(summary.sessions.map((row) => row.sessionId), ['NESTED_CHILD']);
});

test('removing a live child releases its allocated minutes', () => {
  const original = { sessionId: 'ORIGINAL', startTime: '08:00', endTime: '10:00', status: 'missed' };
  const first = child('FIRST', '08:00', '08:30');
  const second = child('SECOND', '09:00', '09:30', 'cancelled');
  const before = allocation.buildMakeupAllocationSummary({
    classId: 'CLASS_1', originalSession: original, sessions: [original, first, second], statusDefinitions
  });
  const after = allocation.buildMakeupAllocationSummary({
    classId: 'CLASS_1', originalSession: original, sessions: [original, first], statusDefinitions
  });

  assert.equal(before.allocatedDurationMinutes, 60);
  assert.equal(before.remainingDurationMinutes, 0);
  assert.equal(after.allocatedDurationMinutes, 30);
  assert.equal(after.remainingDurationMinutes, 30);
});

test('cap accepts the exact remaining minute and rejects one additional minute even when force is used elsewhere', () => {
  const original = { sessionId: 'ORIGINAL', startTime: '08:00', endTime: '11:00', status: 'missed' };
  const summary = allocation.buildMakeupAllocationSummary({
    classId: 'CLASS_1', originalSession: original, sessions: [original], statusDefinitions
  });
  const exact = allocation.assertMakeupAllocationAvailable(summary, 90);
  assert.equal(exact.remainingAfterMinutes, 0);
  assert.throws(
    () => allocation.assertMakeupAllocationAvailable(summary, 91),
    (error) => error.code === 'MAKEUP_DURATION_EXCEEDED'
  );
});

test('teacher percentage overrides are ignored while valid administrator overrides are honored', () => {
  const original = {
    sessionId: 'ORIGINAL',
    makeupScheduling: { durationPercent: 50 }
  };
  const definition = { makeupDurationPercent: 25 };

  assert.equal(allocation.resolveAllowedDurationPercent({
    originalSession: original,
    statusDefinition: definition,
    requestedPercent: 100,
    allowOverride: false
  }), 50);
  assert.equal(allocation.resolveAllowedDurationPercent({
    originalSession: original,
    statusDefinition: definition,
    requestedPercent: 75,
    allowOverride: true
  }), 75);
  assert.throws(() => allocation.resolveAllowedDurationPercent({
    originalSession: original,
    statusDefinition: definition,
    requestedPercent: 101,
    allowOverride: true
  }), (error) => error.code === 'MAKEUP_DURATION_PERCENT_INVALID');
});

test('an administrator cannot lower the aggregate percentage below allocated hours', () => {
  const original = { sessionId: 'ORIGINAL', startTime: '08:00', endTime: '11:00', status: 'missed' };
  const linked = child('ALLOCATED', '09:00', '10:30');
  const summary = allocation.buildMakeupAllocationSummary({
    classId: 'CLASS_1',
    originalSession: original,
    sessions: [original, linked],
    statusDefinitions,
    allowedDurationPercent: 40
  });

  assert.equal(summary.allowedDurationMinutes, 72);
  assert.equal(summary.allocatedDurationMinutes, 90);
  assert.equal(summary.excessDurationMinutes, 18);
  assert.throws(
    () => allocation.assertAllowedPercentCoversAllocated(summary),
    (error) => error.code === 'MAKEUP_DURATION_PERCENT_BELOW_ALLOCATED'
  );
});

test('same-original allocation work is serialized', async () => {
  let active = 0;
  let peak = 0;
  const order = [];
  const run = (label, delay) => allocation.withMakeupAllocationLock('CLASS_1', 'ORIGINAL', async () => {
    active += 1;
    peak = Math.max(peak, active);
    order.push(`${label}:start`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    order.push(`${label}:end`);
    active -= 1;
  });

  await Promise.all([run('first', 20), run('second', 1)]);
  assert.equal(peak, 1);
  assert.deepEqual(order, ['first:start', 'first:end', 'second:start', 'second:end']);
});

test('controller and all make-up surfaces expose the normalized allocation contract', () => {
  const controller = read('packages/school/MVC/controllers/school/classController.js');
  const manager = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  const masterHub = read('packages/school/MVC/views/school/masterAcademiaHub.ejs');
  const reportHub = read('packages/school/MVC/views/school/reportHub.ejs');
  const statusForm = read('packages/school/MVC/views/school/sessionStatus/sessionStatusForm.ejs');

  assert.match(controller, /withMakeupAllocationLock\(classId, sessionId/);
  assert.match(controller, /assertMakeupAllocationAvailable/);
  assert.match(controller, /canOverrideMakeupDuration = await adminAuthorityService\.isAdminForRequestAsync/);
  assert.match(controller, /makeupSummary: updatedSummary/);
  assert.match(controller, /makeupOriginalSessionReference/);
  assert.match(controller, /buildSessionReference\(originalSession/);
  assert.match(controller, /status: 'warning'[\s\S]*MAKEUP_SESSION_WARNINGS/);
  assert.ok(controller.indexOf('assertMakeupAllocationAvailable') < controller.indexOf("code: 'MAKEUP_SESSION_WARNINGS'"));

  [manager, masterHub, reportHub].forEach((source) => {
    assert.match(source, /Created Make-up Sessions/);
    assert.match(source, /Every directly linked session counts[^.]*regardless of status/);
    assert.match(source, /target="_blank"/);
    assert.match(source, /Already defined/);
    assert.match(source, /Proposed session/);
    assert.match(source, /Missing after creation/);
  });
  assert.match(manager, /sessionCanOverrideMakeupDuration/);
  assert.match(manager, /Open original session/);
  assert.match(manager, /This make-up session was created for the original session shown below/);
  assert.match(manager, /originalSessionReference\.manageUrl/);
  assert.match(masterHub, /hubSessionCanOverrideMakeupDuration/);
  assert.match(reportHub, /hubSessionCanOverrideMakeupDuration/);
  assert.match(statusForm, /maximum combined make-up allowance/i);
});
