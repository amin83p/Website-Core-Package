const test = require('node:test');
const assert = require('node:assert/strict');

const { SCOPE_MODES } = require('../packages/school/MVC/services/school/schoolDataScopeBuilder');
const schoolRecordAccessService = require('../packages/school/MVC/services/school/schoolRecordAccessService');

const classRow = {
  id: 'CLASS_1',
  orgId: 'ORG_1',
  instructors: [{ personId: 'TEACHER_A', status: 'active' }],
  audit: { createUser: 'USER_CREATOR' }
};

const sessionRow = {
  sessionId: 'SESSION_1',
  delivery: { deliveredBy: 'TEACHER_B', deliveredByName: 'Teacher B' },
  audit: { createUser: 'USER_SESSION_CREATOR' }
};

const orgWideAccess = { scopeMode: SCOPE_MODES.ORG_WIDE, denyAll: false, personId: 'TEACHER_A', userId: 'USER_1' };
const assignmentAccess = { scopeMode: SCOPE_MODES.ASSIGNMENT, denyAll: false, personId: 'TEACHER_A', userId: 'USER_1' };
const ownerAccess = { scopeMode: SCOPE_MODES.OWNER, denyAll: false, personId: 'TEACHER_A', userId: 'USER_SESSION_CREATOR' };
const userDeniedAccess = { scopeMode: SCOPE_MODES.USER, denyAll: true, personId: 'TEACHER_A', userId: 'USER_1' };

test('org-wide scope allows manage session for any session in org', () => {
  assert.equal(
    schoolRecordAccessService.isSessionAccessible({
      classRow,
      session: sessionRow,
      access: orgWideAccess,
      context: 'manageSession'
    }),
    true
  );
});

test('assignment scope denies manage session when user is not session teacher', () => {
  assert.equal(
    schoolRecordAccessService.isSessionAccessible({
      classRow,
      session: sessionRow,
      access: assignmentAccess,
      context: 'manageSession'
    }),
    false
  );

  assert.throws(() => {
    schoolRecordAccessService.assertSessionAccessible({
      classRow,
      session: sessionRow,
      access: assignmentAccess,
      context: 'manageSession'
    });
  }, /do not have access/i);
});

test('assignment scope allows manage session when deliveredBy matches personId', () => {
  const access = { ...assignmentAccess, personId: 'TEACHER_B' };
  assert.equal(
    schoolRecordAccessService.isSessionAccessible({
      classRow,
      session: sessionRow,
      access,
      context: 'manageSession'
    }),
    true
  );
});

test('owner scope denies manage session when user did not create the session', () => {
  const access = { ...ownerAccess, userId: 'OTHER_USER' };
  assert.equal(
    schoolRecordAccessService.isSessionAccessible({
      classRow,
      session: sessionRow,
      access,
      context: 'manageSession'
    }),
    false
  );
});

test('owner scope allows manage session when user created the session', () => {
  assert.equal(
    schoolRecordAccessService.isSessionAccessible({
      classRow,
      session: sessionRow,
      access: ownerAccess,
      context: 'manageSession'
    }),
    true
  );
});

test('assignment scope allows class list when user is instructor or class creator', () => {
  const instructorAccess = { ...assignmentAccess, personId: 'TEACHER_A' };
  assert.equal(schoolRecordAccessService.isClassAccessible(classRow, instructorAccess), true);

  const ownerClassAccess = { ...assignmentAccess, personId: 'OTHER', userId: 'USER_CREATOR' };
  assert.equal(schoolRecordAccessService.isClassAccessible(classRow, ownerClassAccess), true);

  const deniedAccess = { ...assignmentAccess, personId: 'OTHER', userId: 'OTHER_USER' };
  assert.equal(schoolRecordAccessService.isClassAccessible(classRow, deniedAccess), false);
});

test('USER scope always denies session access', () => {
  assert.equal(
    schoolRecordAccessService.isSessionAccessible({
      classRow,
      session: sessionRow,
      access: userDeniedAccess,
      context: 'manageSession'
    }),
    false
  );
});

test('assignment scope allows class list when user is instructor even if not session teacher', () => {
  assert.equal(
    schoolRecordAccessService.isClassAccessible(classRow, assignmentAccess),
    true
  );
  assert.equal(
    schoolRecordAccessService.isSessionAccessible({
      classRow,
      session: sessionRow,
      access: assignmentAccess,
      context: 'list'
    }),
    true
  );
});
