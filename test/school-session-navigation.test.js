const test = require('node:test');
const assert = require('node:assert/strict');

const sessionNavigationService = require('../packages/school/MVC/services/school/sessionNavigationService');

test('resolveAdjacentSessionIds uses id fallback and preserves chronological neighbors', () => {
  const sessions = [
    { sessionId: 'SES_JUL20', date: '2026-07-20', startTime: '09:00' },
    { sessionId: 'SES_JUL24', date: '2026-07-24', startTime: '09:00' },
    { id: 'SES_AUG05', date: '2026-08-05', startTime: '09:00' }
  ];

  const augNav = sessionNavigationService.resolveAdjacentSessionIds(sessions, 'SES_AUG05', '2026-08-05');
  assert.equal(augNav.currentIndex, 2);
  assert.equal(augNav.prevSessionId, 'SES_JUL24');
  assert.equal(augNav.prevSessionDate, '2026-07-24');
  assert.equal(augNav.nextSessionId, null);

  const jul24Nav = sessionNavigationService.resolveAdjacentSessionIds(sessions, 'SES_JUL24', '2026-07-24');
  assert.equal(jul24Nav.nextSessionId, 'SES_AUG05');
  assert.equal(jul24Nav.nextSessionDate, '2026-08-05');
});

test('duplicate session ids resolve by sessionDate instead of first match', () => {
  const sessions = [
    { sessionId: 'SES_DUP', date: '2026-07-20', startTime: '09:00' },
    { sessionId: 'SES_DUP', date: '2026-08-05', startTime: '09:00' }
  ];

  const augNav = sessionNavigationService.resolveAdjacentSessionIds(sessions, 'SES_DUP', '2026-08-05');
  assert.equal(augNav.currentIndex, 1);
  assert.equal(augNav.prevSessionId, 'SES_DUP');
  assert.equal(augNav.prevSessionDate, '2026-07-20');

  const julNav = sessionNavigationService.resolveAdjacentSessionIds(sessions, 'SES_DUP', '2026-07-20');
  assert.equal(julNav.currentIndex, 0);
  assert.equal(julNav.nextSessionId, 'SES_DUP');
  assert.equal(julNav.nextSessionDate, '2026-08-05');
});

test('buildManageSessionHref includes sessionDate query for duplicate-safe navigation', () => {
  const href = sessionNavigationService.buildManageSessionHref('CLS_1', {
    sessionId: 'SES_DUP',
    date: '2026-08-05'
  });
  assert.equal(href, '/school/classes/CLS_1/sessions/SES_DUP?sessionDate=2026-08-05');
});

test('resolveAdjacentSessionIds does not jump to first session when index is unresolved', () => {
  const sessions = [
    { sessionId: 'SES_JUL20', date: '2026-07-20', startTime: '09:00' },
    { sessionId: 'SES_JUL24', date: '2026-07-24', startTime: '09:00' }
  ];
  const nav = sessionNavigationService.resolveAdjacentSessionIds(sessions, 'MISSING');
  assert.equal(nav.currentIndex, -1);
  assert.equal(nav.prevSessionId, null);
  assert.equal(nav.nextSessionId, null);
});

test('legacy strict sessionId-only navigation would mis-link id-only sessions', () => {
  const sessions = [
    { sessionId: 'SES_JUL20', date: '2026-07-20', startTime: '09:00' },
    { id: 'SES_AUG05', date: '2026-08-05', startTime: '09:00' }
  ];
  const strictIndex = sessions.findIndex((row) => row.sessionId === 'SES_AUG05');
  assert.equal(strictIndex, -1);
  const legacyNext = strictIndex < sessions.length - 1 ? sessions[strictIndex + 1]?.sessionId : null;
  assert.equal(legacyNext, 'SES_JUL20');

  const fixed = sessionNavigationService.resolveAdjacentSessionIds(sessions, 'SES_AUG05');
  assert.equal(fixed.prevSessionId, 'SES_JUL20');
  assert.equal(fixed.nextSessionId, null);
});

test('class-scoped unique session ids resolve without sessionDate', () => {
  const sessions = [
    { sessionId: 'SES-CLS-2026-ABCDE-0001', date: '2026-07-20', startTime: '09:00' },
    { sessionId: 'SES-CLS-2026-ABCDE-0002', date: '2026-08-05', startTime: '09:00' }
  ];

  const augNav = sessionNavigationService.resolveAdjacentSessionIds(sessions, 'SES-CLS-2026-ABCDE-0002');
  assert.equal(augNav.currentIndex, 1);
  assert.equal(augNav.prevSessionId, 'SES-CLS-2026-ABCDE-0001');
  assert.equal(augNav.prevSessionDate, '2026-07-20');
});
