const test = require('node:test');
const assert = require('node:assert/strict');

const sessionIdService = require('../packages/school/MVC/services/school/sessionIdService');
const sessionIdRemapService = require('../packages/school/MVC/services/school/sessionIdRemapService');
const sessionNavigationService = require('../packages/school/MVC/services/school/sessionNavigationService');

const CLASS_ID = 'CLS-2026-TEST1';

test('buildSessionId and parseSessionId round-trip class-scoped ids', () => {
  const sessionId = sessionIdService.buildSessionId(CLASS_ID, 42);
  assert.equal(sessionId, 'SES-CLS-2026-TEST1-0042');
  assert.deepEqual(sessionIdService.parseSessionId(sessionId), {
    classId: CLASS_ID,
    sequence: 42
  });
  assert.equal(sessionIdService.isClassScopedSessionId(sessionId, CLASS_ID), true);
});

test('buildNextSessionId allocates the next unused sequential id for a class', () => {
  const existing = [
    { sessionId: 'SES-CLS-2026-TEST1-0001', date: '2026-07-01' },
    { sessionId: 'SES-CLS-2026-TEST1-0002', date: '2026-07-02' }
  ];
  assert.equal(
    sessionIdService.buildNextSessionId(CLASS_ID, existing),
    'SES-CLS-2026-TEST1-0003'
  );
});

test('assignSequentialSessionIds rewrites sessions chronologically', () => {
  const sessions = [
    { sessionId: 'SES_DUP', date: '2026-08-05', startTime: '09:00' },
    { sessionId: 'SES_DUP', date: '2026-07-20', startTime: '09:00' }
  ];
  const reassigned = sessionIdService.assignSequentialSessionIds(CLASS_ID, sessions);
  assert.equal(reassigned.length, 2);
  assert.equal(reassigned[0].sessionId, 'SES-CLS-2026-TEST1-0001');
  assert.equal(reassigned[0].date, '2026-07-20');
  assert.equal(reassigned[1].sessionId, 'SES-CLS-2026-TEST1-0002');
  assert.equal(reassigned[1].date, '2026-08-05');
});

test('ensureClassSessionIds reassigns duplicate and legacy ids', () => {
  const sessions = [
    { sessionId: 'SES_17846880401069603', date: '2026-07-20', startTime: '09:00' },
    { sessionId: 'SES_17846880401069603', date: '2026-08-05', startTime: '09:00' },
    { sessionId: '', date: '2026-08-06', startTime: '09:00' }
  ];
  const result = sessionIdService.ensureClassSessionIds(CLASS_ID, sessions);
  const ids = result.sessions.map((row) => row.sessionId);
  assert.equal(new Set(ids).size, ids.length);
  ids.forEach((sessionId) => {
    assert.equal(sessionIdService.isClassScopedSessionId(sessionId, CLASS_ID), true);
  });
  assert.equal(result.reassigned.length, 3);
});

test('findDuplicateSessionIds reports duplicate groups', () => {
  const duplicates = sessionIdService.findDuplicateSessionIds([
    { sessionId: 'SES_A', date: '2026-07-01' },
    { sessionId: 'SES_A', date: '2026-08-01' },
    { sessionId: 'SES_B', date: '2026-08-02' }
  ]);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].sessionId, 'SES_A');
  assert.equal(duplicates[0].rows.length, 2);
});

test('buildClassSessionRemapPlan maps duplicate legacy ids by date', () => {
  const plan = sessionIdRemapService.buildClassSessionRemapPlan(CLASS_ID, [
    { sessionId: 'SES_DUP', date: '2026-07-20', startTime: '09:00' },
    { sessionId: 'SES_DUP', date: '2026-08-05', startTime: '09:00' }
  ]);
  assert.equal(plan.changes.length, 2);
  const julId = sessionIdRemapService.resolveRemappedSessionId(plan, 'SES_DUP', '2026-07-20');
  const augId = sessionIdRemapService.resolveRemappedSessionId(plan, 'SES_DUP', '2026-08-05');
  assert.notEqual(julId, augId);
  assert.equal(julId, 'SES-CLS-2026-TEST1-0001');
  assert.equal(augId, 'SES-CLS-2026-TEST1-0002');
});

test('class-scoped session navigation does not require sessionDate in href', () => {
  const href = sessionNavigationService.buildManageSessionHref(CLASS_ID, {
    sessionId: 'SES-CLS-2026-TEST1-0007',
    date: '2026-08-05'
  });
  assert.equal(
    href,
    `/school/classes/${encodeURIComponent(CLASS_ID)}/sessions/${encodeURIComponent('SES-CLS-2026-TEST1-0007')}`
  );
});

test('legacy duplicate ids still use sessionDate in href', () => {
  const href = sessionNavigationService.buildManageSessionHref(CLASS_ID, {
    sessionId: 'SES_DUP',
    date: '2026-08-05'
  });
  assert.equal(
    href,
    `/school/classes/${encodeURIComponent(CLASS_ID)}/sessions/SES_DUP?sessionDate=2026-08-05`
  );
});
