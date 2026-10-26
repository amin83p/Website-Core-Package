'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeRoleKey,
  dedupeRecipientsByEmail,
  membershipMatchesRoleKeys,
  buildOutboxDedupeKey
} = require('../MVC/services/newsRoleNotifyService');

test('normalizeRoleKey maps friendly aliases to canonical school roles', () => {
  assert.equal(normalizeRoleKey('school-teacher'), 'school_teacher');
  assert.equal(normalizeRoleKey('schoolteacher'), 'school_teacher');
  assert.equal(normalizeRoleKey('Teacher'), '');
});

test('dedupeRecipientsByEmail merges roles for same email', () => {
  const rows = dedupeRecipientsByEmail([
    { email: 'a@school.test', displayName: 'A', roles: ['Teacher'], included: true },
    { email: 'A@school.test', displayName: 'A', roles: ['Staff'], included: true }
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].roles.sort(), ['Staff', 'Teacher']);
});

test('membershipMatchesRoleKeys matches active org membership roles', () => {
  const membership = {
    orgId: 'ORG_1',
    memberStatus: 'active',
    roles: ['school_teacher', 'school_staff']
  };
  assert.equal(
    membershipMatchesRoleKeys(membership, 'ORG_1', ['school_student']),
    false
  );
  assert.equal(
    membershipMatchesRoleKeys(membership, 'ORG_1', ['school_teacher']),
    true
  );
});

test('buildOutboxDedupeKey changes when resend is true', () => {
  const base = buildOutboxDedupeKey({
    orgId: 'ORG_1',
    articleId: 'NEWS_1',
    email: 'user@test.com',
    resend: false
  });
  const resent = buildOutboxDedupeKey({
    orgId: 'ORG_1',
    articleId: 'NEWS_1',
    email: 'user@test.com',
    resend: true
  });
  assert.match(base, /^news-article::ORG_1::NEWS_1::/);
  assert.notEqual(base, resent);
  assert.match(resent, /::resend::/);
});
