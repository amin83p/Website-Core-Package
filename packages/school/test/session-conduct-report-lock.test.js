const test = require('node:test');
const assert = require('node:assert/strict');

const sessionConductReportLockService = require('../MVC/services/school/sessionConductReportLockService');
const sessionConductService = require('../MVC/services/school/sessionConductService');

test('instanceLinksConductForLock requires session scope and conductRequiredBeforeFill', () => {
  const assignment = {
    targetType: 'session',
    sessionId: 'SES-1',
    conductRequiredBeforeFill: true
  };
  const instance = { sessionId: 'SES-1', assignmentRowId: '' };
  assert.equal(sessionConductReportLockService.instanceLinksConductForLock(assignment, instance), true);

  const noConduct = { ...assignment, conductRequiredBeforeFill: false };
  assert.equal(sessionConductReportLockService.instanceLinksConductForLock(noConduct, instance), false);

  const notSession = { conductRequiredBeforeFill: true, targetType: 'class' };
  assert.equal(sessionConductReportLockService.instanceLinksConductForLock(notSession, {}), false);
});

test('isRosterConductLockedByReport uses conductLockedByReportAt', () => {
  assert.equal(sessionConductReportLockService.isRosterConductLockedByReport({}), false);
  assert.equal(
    sessionConductReportLockService.isRosterConductLockedByReport({ conductLockedByReportAt: '2026-01-01T00:00:00.000Z' }),
    true
  );
});

test('applyLockFieldsToRosterRow sets audit fields', () => {
  const row = sessionConductReportLockService.applyLockFieldsToRosterRow(
    { personId: 'P1', classEffortPercent: 80 },
    { instanceId: 'INST-1', lockedAt: '2026-02-01T12:00:00.000Z' }
  );
  assert.equal(row.conductLockedByReportInstanceId, 'INST-1');
  assert.equal(row.conductLockedByReportAt, '2026-02-01T12:00:00.000Z');
  assert.equal(row.classEffortPercent, 80);
});

test('applyConductRosterToSession skips locked persons when canEditPersonConduct returns false', () => {
  const session = {
    roster: [{
      personId: 'P_LOCKED',
      classEffortPercent: 90,
      conductLockedByReportAt: '2026-01-01T00:00:00.000Z'
    }]
  };
  sessionConductService.applyConductRosterToSession(session, [{
    personId: 'P_LOCKED',
    classEffortPercent: 10
  }], {
    canEditPersonConduct: () => false
  });
  assert.equal(session.roster[0].classEffortPercent, 90);
});

test('applyConductRosterToSession updates when canEditPersonConduct returns true', () => {
  const session = {
    roster: [{
      personId: 'P_LOCKED',
      classEffortPercent: 90,
      conductLockedByReportAt: '2026-01-01T00:00:00.000Z'
    }]
  };
  sessionConductService.applyConductRosterToSession(session, [{
    personId: 'P_LOCKED',
    classEffortPercent: 10
  }], {
    canEditPersonConduct: () => true
  });
  assert.equal(session.roster[0].classEffortPercent, 10);
});

test('assertCanEditRosterConduct throws when locked and values change', async () => {
  await assert.rejects(
    () => sessionConductReportLockService.assertCanEditRosterConduct({
      existingRow: { personId: 'P1', conductLockedByReportAt: '2026-01-01', classEffortPercent: 80 },
      incomingRow: { classEffortPercent: 50 },
      reqUser: null,
      ipAddress: ''
    }),
    (err) => err.code === 'CONDUCT_LOCKED_BY_REPORT'
  );
});

test('assertCanEditRosterConduct allows no-op when locked', async () => {
  await sessionConductReportLockService.assertCanEditRosterConduct({
    existingRow: { conductLockedByReportAt: '2026-01-01', classEffortPercent: 80 },
    incomingRow: { classEffortPercent: 80 },
    reqUser: null,
    ipAddress: ''
  });
});

test('conductPayloadDiffers detects percent changes only when incoming includes key', () => {
  assert.equal(
    sessionConductReportLockService.conductPayloadDiffers(
      { classEffortPercent: 80 },
      {}
    ),
    false
  );
  assert.equal(
    sessionConductReportLockService.conductPayloadDiffers(
      { classEffortPercent: 80 },
      { classEffortPercent: 50 }
    ),
    true
  );
});
