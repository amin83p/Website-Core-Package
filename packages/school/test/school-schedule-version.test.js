const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const scheduleController = require('../MVC/controllers/school/scheduleController');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

test('buildScheduleEventsFingerprint is stable for identical events', () => {
  const events = [
    {
      eventType: 'class_session',
      sessionId: 'SES_001',
      date: '2026-01-05',
      start: '09:00',
      end: '10:00',
      status: 'scheduled',
      locked: false
    }
  ];
  const first = scheduleController.buildScheduleEventsFingerprint(events);
  const second = scheduleController.buildScheduleEventsFingerprint(events.slice());
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('buildScheduleEventsFingerprint changes when session status changes', () => {
  const base = {
    eventType: 'class_session',
    sessionId: 'SES_001',
    date: '2026-01-05',
    start: '09:00',
    end: '10:00',
    locked: false
  };
  const scheduled = scheduleController.buildScheduleEventsFingerprint([{ ...base, status: 'scheduled' }]);
  const completed = scheduleController.buildScheduleEventsFingerprint([{ ...base, status: 'completed' }]);
  assert.notEqual(scheduled, completed);
});

test('schedule routes expose person-schedule-version endpoint', () => {
  const routeSource = read('MVC/routes/scheduleRoutes.js');
  assert.match(routeSource, /person-schedule-version/);
  assert.match(routeSource, /getPersonScheduleVersion/);
  assert.match(routeSource, /requireToken:\s*false,\s*keepActive:\s*true/);
});

test('personSchedule wires smart schedule polling without auto-reload on fingerprint change', () => {
  const source = read('MVC/views/school/schedule/personSchedule.ejs');
  assert.match(source, /person-schedule-version/);
  assert.match(source, /scheduleFingerprintByPersonId/);
  assert.match(source, /pollScheduleVersionForActivePerson/);
  assert.match(source, /startScheduleAutoRefresh/);
  assert.match(source, /remoteUpdatePending/);
  assert.match(source, /hasScheduleLocalWork/);
  assert.match(source, /requestScheduleRefresh/);
  assert.match(source, /promptScheduleRemoteUpdateIfNeeded/);
  assert.match(source, /showMessageModal/);
  assert.doesNotMatch(source, /scheduleRemoteUpdateBanner/);
  assert.match(source, /markRemoteUpdatePending\(nextFingerprint\)/);
  assert.doesNotMatch(source, /loadSchedulePerson\(person,\s*\{\s*silent:\s*true,\s*autoRefresh:\s*true\s*\}\)/);

  const pollFn = source.match(/async function pollScheduleVersionForActivePerson\(\)\s*\{[\s\S]*?\n    \}/);
  assert.ok(pollFn, 'pollScheduleVersionForActivePerson should be defined');
  assert.doesNotMatch(pollFn[0], /loadSchedulePerson/);
});

function buildOverlappingClassSessionEvent(overrides = {}) {
  return {
    eventType: 'class_session',
    personId: 'TEACHER-1',
    date: '2026-08-27',
    start: '09:00',
    end: '10:00',
    classId: 'CLS-A',
    sessionId: 'SES-A',
    blocksConflicts: true,
    scheduleDisplayOnly: false,
    hasOverlap: false,
    ...overrides
  };
}

test('markOverlappingEvents does not flag merge-linked class sessions', () => {
  const source = buildOverlappingClassSessionEvent({
    classId: 'CLS-A',
    sessionId: 'SES-SOURCE',
    merged: {
      isMergedSession: true,
      partnerClassId: 'CLS-B',
      partnerSessionId: 'SES-PARTNER'
    }
  });
  const partner = buildOverlappingClassSessionEvent({
    classId: 'CLS-B',
    sessionId: 'SES-PARTNER',
    mergedPartner: {
      linkedClassId: 'CLS-A',
      linkedSessionId: 'SES-SOURCE',
      ignoreScheduleConflict: true
    }
  });
  const events = [source, partner];
  scheduleController.markOverlappingEvents(events);
  assert.equal(source.hasOverlap, false);
  assert.equal(partner.hasOverlap, false);
});

test('markOverlappingEvents still flags unrelated overlapping class sessions', () => {
  const first = buildOverlappingClassSessionEvent({
    classId: 'CLS-A',
    sessionId: 'SES-1'
  });
  const second = buildOverlappingClassSessionEvent({
    classId: 'CLS-B',
    sessionId: 'SES-2'
  });
  const events = [first, second];
  scheduleController.markOverlappingEvents(events);
  assert.equal(first.hasOverlap, true);
  assert.equal(second.hasOverlap, true);
});

test('markOverlappingEvents still allows embedded report overlap on class sessions', () => {
  const session = buildOverlappingClassSessionEvent({
    classId: 'CLS-A',
    sessionId: 'SES-1'
  });
  const report = {
    eventType: 'report_task',
    personId: 'TEACHER-1',
    date: '2026-08-27',
    start: '09:15',
    end: '09:45',
    classId: 'CLS-A',
    sourceSessionId: 'SES-1',
    targetType: 'session',
    conflictPermitted: false,
    blocksConflicts: true,
    hasOverlap: false
  };
  const events = [session, report];
  scheduleController.markOverlappingEvents(events);
  assert.equal(session.hasOverlap, false);
  assert.equal(report.hasOverlap, false);
});

test('scheduleController wires merged-session overlap exemption', () => {
  const source = read('MVC/controllers/school/scheduleController.js');
  assert.match(source, /function isAllowedMergedSessionOverlap/);
  assert.match(source, /isAllowedMergedSessionOverlap\(current, next\)/);
  assert.match(source, /mergedPartner:/);
});
