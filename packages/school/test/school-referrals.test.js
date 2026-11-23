const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { sanitizeReferralInput, REFERRAL_STATUSES } = require('../MVC/models/school/referralModel');
const { buildSchoolInlinePersonPayload } = require('../MVC/services/school/schoolInlinePersonPayload');
const {
  SCHOOL_REFERRING_ORGANIZATIONS,
  sanitizeSchoolReferringOrganizationIds,
  formatSchoolReferringOrganizationLabels
} = require('../config/schoolReferringOrganizations');
const duplicateGuardPath = path.join(__dirname, '../MVC/services/school/schoolPeopleDuplicateGuardService.js');
const roleTagProviderPath = path.join(__dirname, '../MVC/services/school/schoolRoleTagProvider.js');

test('sanitizeReferralInput requires orgId, personId, and valid status', () => {
  assert.throws(() => sanitizeReferralInput({}), /orgId is required/);
  assert.throws(() => sanitizeReferralInput({ orgId: 'ORG1' }), /personId is required/);
  assert.throws(
    () => sanitizeReferralInput({ orgId: 'ORG1', personId: 'P1', status: 'Pending' }),
    /Invalid referral status/
  );
  const out = sanitizeReferralInput({
    orgId: 'ORG1',
    personId: 'P1',
    status: 'Active',
    notes: ' hello ',
    organizationIds: ['CBI', 'CBI', 'INVALID', '']
  });
  assert.equal(out.orgId, 'ORG1');
  assert.equal(out.personId, 'P1');
  assert.equal(out.status, 'Active');
  assert.equal(out.notes, 'hello');
  assert.deepEqual(out.organizationIds, ['CBI']);
});

test('school referring organizations catalog is the canonical hardcoded list', () => {
  const labels = SCHOOL_REFERRING_ORGANIZATIONS.map((row) => row.label);
  assert.deepEqual(labels, [
    'CBI',
    'Lifemark',
    'Millard Health',
    'Veritus',
    'Work Safe BC',
    'WCB Alberta'
  ]);
  assert.deepEqual(sanitizeSchoolReferringOrganizationIds(['LIFEMARK', 'WCB_ALBERTA', 'LIFEMARK']), [
    'LIFEMARK',
    'WCB_ALBERTA'
  ]);
  assert.equal(
    formatSchoolReferringOrganizationLabels(['CBI', 'WORK_SAFE_BC']),
    'CBI, Work Safe BC'
  );
});

test('REFERRAL_STATUSES contains Active and Archived only', () => {
  assert.deepEqual(new Set(REFERRAL_STATUSES), new Set(['Active', 'Archived']));
});

test('duplicate guard and role index wire referrals entity type', () => {
  const duplicateGuardSource = fs.readFileSync(duplicateGuardPath, 'utf8');
  assert.match(duplicateGuardSource, /referrals:\s*\{/);
  assert.match(duplicateGuardSource, /\/school\/referrals\/edit\//);
  const roleTagSource = fs.readFileSync(roleTagProviderPath, 'utf8');
  assert.match(roleTagSource, /school_referral/);
  assert.match(roleTagSource, /referrals\.list/);
});

test('buildSchoolInlinePersonPayload applies defaultDateOfBirth when omitted', () => {
  const body = {
    newPersonFirstName: 'Alex',
    newPersonLastName: 'River',
    newPersonGender: 'female',
    newPersonEmail: 'alex@example.com'
  };
  const payload = buildSchoolInlinePersonPayload(
    body,
    { id: 'U1', activeOrgId: '100', allowedOrgs: [{ orgId: '100', name: 'Demo School' }] },
    { defaultDateOfBirth: '2000-01-01' }
  );
  assert.equal(payload.demographics.dateOfBirth, '2000-01-01');
  assert.equal(payload.name.first, 'Alex');
  assert.equal(payload.name.last, 'River');
});

test('buildSchoolRoleIndex indexes active referral persons', async () => {
  const schoolRepositories = require('../MVC/repositories/school');
  const prior = {
    students: schoolRepositories.students.list,
    teachers: schoolRepositories.teachers.list,
    staff: schoolRepositories.staff.list,
    funders: schoolRepositories.funders.list,
    referrals: schoolRepositories.referrals.list
  };
  schoolRepositories.students.list = async () => [];
  schoolRepositories.teachers.list = async () => [];
  schoolRepositories.staff.list = async () => [];
  schoolRepositories.funders.list = async () => [];
  schoolRepositories.referrals.list = async () => ([
    { personId: 'P100', status: 'Active' },
    { personId: 'P200', status: 'Archived' }
  ]);
  try {
    const { buildSchoolRoleIndex } = require('../MVC/services/school/schoolRoleTagProvider');
    const index = await buildSchoolRoleIndex();
    assert.ok(index.get('P100')?.has('school_referral'));
    assert.ok(!index.get('P200')?.has('school_referral'));
  } finally {
    schoolRepositories.students.list = prior.students;
    schoolRepositories.teachers.list = prior.teachers;
    schoolRepositories.staff.list = prior.staff;
    schoolRepositories.funders.list = prior.funders;
    schoolRepositories.referrals.list = prior.referrals;
  }
});