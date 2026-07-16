const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const schoolDependencyService = require('../packages/school/MVC/services/school/schoolDependencyService');

test('applySessionAdminLock sets and clears admin lock metadata', () => {
  const session = { sessionId: 's1', locked: false };
  schoolDependencyService.applySessionAdminLock(session, true, { id: 'admin-1' });
  assert.equal(session.locked, true);
  assert.equal(session.lockReason, 'admin_locked');
  assert.ok(session.lockedAt);
  assert.equal(session.lockedBy, 'admin-1');

  schoolDependencyService.applySessionAdminLock(session, false, { id: 'admin-2' });
  assert.equal(session.locked, false);
  assert.equal(session.lockReason, undefined);
  assert.ok(session.unlockedAt);
  assert.equal(session.unlockedBy, 'admin-2');
});

test('applySessionAdminLock rejects changes to timesheet-approved locks', () => {
  const session = {
    sessionId: 's1',
    locked: true,
    lockReason: 'timesheet_approved',
    lockedTimesheetId: 'ts-1'
  };
  assert.throws(
    () => schoolDependencyService.applySessionAdminLock(session, false, { id: 'admin-1' }),
    /approved timesheet/i
  );
});

test('class routes expose admin session lock endpoint', () => {
  const source = read('packages/school/MVC/routes/classRoutes.js');
  assert.match(source, /router\.post\('\/:id\/sessions\/:sessionId\/lock'/);
  assert.match(source, /classCtrl\.setSessionLock/);
  assert.match(source, /trackActionState\(SECTIONS\.SCHOOL_SESSIONS, OPERATIONS\.UPDATE, sessionManagerMutationActionState\)/);
});

test('session manager save routes keep the action state active for repeat saves', () => {
  const source = read('packages/school/MVC/routes/classRoutes.js');
  assert.match(source, new RegExp("router\\.post\\('\\/:id\\/sessions\\/:sessionId\\/gradebooks\\/save'[\\s\\S]*?trackActionState\\(SECTIONS\\.SCHOOL_SESSIONS, OPERATIONS\\.UPDATE, sessionManagerMutationActionState\\)"));
  assert.match(source, new RegExp("router\\.post\\('\\/:id\\/sessions\\/:sessionId\\/save'[\\s\\S]*?trackActionState\\(SECTIONS\\.SCHOOL_SESSIONS, OPERATIONS\\.UPDATE, sessionManagerMutationActionState\\)"));
});

test('session manager shows admin lock/unlock control for eligible admins', () => {
  const source = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  assert.match(source, /canToggleSessionLock/);
  assert.match(source, /id="btnToggleSessionLock"/);
  assert.match(source, /isTimesheetSessionLock/);
  assert.match(source, /\/sessions\/\$\{encodeURIComponent\(String\(sessionManagerSessionId\)\)\}\/lock/);
});

test('setSessionLock controller uses dependency service admin lock helper', () => {
  const source = read('packages/school/MVC/controllers/school/classController.js');
  assert.match(source, /async function setSessionLock/);
  assert.match(source, /schoolDependencyService\.applySessionAdminLock/);
});
