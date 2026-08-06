'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const makeupSessionAllocationService = require('../packages/school/MVC/services/school/makeupSessionAllocationService');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const STATUS_META = [
  { code: 'scheduled', label: 'Scheduled', isFinal: false, timesheetFormula: 'duration' },
  { code: 'completed', label: 'Completed', isFinal: true, timesheetFormula: 'duration' },
  { code: 'missed', label: 'Missed - Make-up Required', isFinal: true, makeUpRequired: true, makeupDurationPercent: 100, timesheetFormula: '0' }
];

test('class routes expose linked make-up delete endpoint', () => {
  const routes = read('packages/school/MVC/routes/classRoutes.js');
  assert.match(routes, /\/sessions\/:sessionId\/makeup\/:makeupSessionId/);
  assert.match(routes, /deleteLinkedMakeupSession/);
});

test('class controller exposes deleteLinkedMakeupSession and hardens generic session delete', () => {
  const source = read('packages/school/MVC/controllers/school/classController.js');
  assert.match(source, /deleteLinkedMakeupSession/);
  assert.match(source, /assertIncomingSessionsHonorMakeupRemovalRules/);
  assert.match(source, /assertSessionRemovalAllowed/);
});

test('session manager exposes scheduled-only make-up delete controls', () => {
  const editor = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  assert.match(editor, /btn-delete-linked-makeup/);
  assert.match(editor, /deleteLinkedMakeupSession/);
  assert.match(editor, /Resolve session status to Scheduled before deletion/);
});

test('scheduled make-up removal cleans makeupHistory on the original session', () => {
  const sessions = [
    {
      sessionId: 'ORIG_1',
      status: 'missed',
      makeupHistory: [{ makeupSessionId: 'MK_1', date: '2026-08-01' }]
    },
    {
      sessionId: 'MK_1',
      status: 'scheduled',
      makeup: { isMakeup: true, originalClassId: 'CLS_1', originalSessionId: 'ORIG_1' }
    }
  ];
  makeupSessionAllocationService.assertMakeupSessionDeletable(sessions[1], STATUS_META);
  const { sessions: next } = makeupSessionAllocationService.removeMakeupSessionFromLedger({
    sessions,
    classId: 'CLS_1',
    originalSessionId: 'ORIG_1',
    makeupSessionId: 'MK_1'
  });
  assert.equal(next.length, 1);
  assert.equal(next[0].sessionId, 'ORIG_1');
  assert.equal(Array.isArray(next[0].makeupHistory) ? next[0].makeupHistory.length : 0, 0);
});

test('non-scheduled make-up sessions cannot be deleted', () => {
  assert.throws(
    () => makeupSessionAllocationService.assertMakeupSessionDeletable({ status: 'completed' }, STATUS_META),
    /Scheduled/
  );
});

test('parent make-up delete is blocked until child make-up sessions are removed', () => {
  const sessions = [
    {
      sessionId: 'MK_PARENT',
      status: 'scheduled',
      makeup: { isMakeup: true, originalClassId: 'CLS_1', originalSessionId: 'ORIG_1' }
    },
    {
      sessionId: 'MK_CHILD',
      status: 'scheduled',
      makeup: { isMakeup: true, originalClassId: 'CLS_1', originalSessionId: 'MK_PARENT' }
    }
  ];
  assert.throws(
    () => makeupSessionAllocationService.assertSessionRemovalAllowed({
      sessions: sessions.filter((row) => row.sessionId !== 'MK_CHILD'),
      allSessions: sessions,
      classId: 'CLS_1',
      sessionToRemove: sessions.find((row) => row.sessionId === 'MK_PARENT'),
      statusDefinitions: STATUS_META
    }),
    /linked make-up sessions/i
  );
});

test('child make-up can be removed before parent make-up', () => {
  const sessions = [
    {
      sessionId: 'ORIG_1',
      status: 'missed',
      makeupHistory: [{ makeupSessionId: 'MK_PARENT' }, { makeupSessionId: 'MK_CHILD' }]
    },
    {
      sessionId: 'MK_PARENT',
      status: 'scheduled',
      makeup: { isMakeup: true, originalClassId: 'CLS_1', originalSessionId: 'ORIG_1' }
    },
    {
      sessionId: 'MK_CHILD',
      status: 'scheduled',
      makeup: { isMakeup: true, originalClassId: 'CLS_1', originalSessionId: 'MK_PARENT' }
    }
  ];
  makeupSessionAllocationService.assertSessionRemovalAllowed({
    sessions: sessions.filter((row) => row.sessionId !== 'MK_CHILD'),
    allSessions: sessions,
    classId: 'CLS_1',
    sessionToRemove: sessions.find((row) => row.sessionId === 'MK_CHILD'),
    statusDefinitions: STATUS_META
  });
});

test('cleanupMakeupHistoryForRemovedSessions strips stale history rows', () => {
  const existing = [
    { sessionId: 'ORIG_1', makeupHistory: [{ makeupSessionId: 'MK_1' }, { makeupSessionId: 'MK_2' }] },
    { sessionId: 'MK_1', status: 'scheduled', makeup: { isMakeup: true, originalClassId: 'CLS_1', originalSessionId: 'ORIG_1' } },
    { sessionId: 'MK_2', status: 'scheduled', makeup: { isMakeup: true, originalClassId: 'CLS_1', originalSessionId: 'ORIG_1' } }
  ];
  const incoming = existing.filter((row) => row.sessionId !== 'MK_1');
  const cleaned = makeupSessionAllocationService.cleanupMakeupHistoryForRemovedSessions(existing, incoming);
  const original = cleaned.find((row) => row.sessionId === 'ORIG_1');
  assert.equal(original.makeupHistory.length, 1);
  assert.equal(original.makeupHistory[0].makeupSessionId, 'MK_2');
});
