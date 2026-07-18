const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validatePersonInput,
  buildPersonFromBody
} = require('../MVC/services/person/publicRegistrationService');

test('validatePersonInput accepts organization without individual demographics', async () => {
  await validatePersonInput({
    personProfileType: 'organization',
    organizationLegalName: 'Workers Compensation Board',
    emails: JSON.stringify([{ type: 'primary', email: 'billing@wcb.example', isPrimary: true }])
  }, {
    isSelfRegistration: false,
    requirePrimaryEmail: true,
    checkPersonEmailUnique: false,
    checkUserEmailUnique: false
  });
});

test('validatePersonInput requires organization legal name for organization profiles', async () => {
  await assert.rejects(
    () => validatePersonInput({
      personProfileType: 'organization',
      organizationLegalName: '  ',
      emails: JSON.stringify([{ type: 'primary', email: 'billing@wcb.example', isPrimary: true }])
    }, {
      isSelfRegistration: false,
      requirePrimaryEmail: true,
      checkPersonEmailUnique: false,
      checkUserEmailUnique: false
    }),
    /Organization legal name is required/
  );
});

test('validatePersonInput still requires first and last name for individuals', async () => {
  await assert.rejects(
    () => validatePersonInput({
      personProfileType: 'individual',
      firstName: '',
      lastName: 'Doe',
      emails: JSON.stringify([{ type: 'primary', email: 'jane@example.com', isPrimary: true }])
    }, {
      isSelfRegistration: false,
      requirePrimaryEmail: true,
      checkPersonEmailUnique: false,
      checkUserEmailUnique: false
    }),
    /First name is required/
  );
});

test('buildPersonFromBody derives preferred name from organization legal name', () => {
  const person = buildPersonFromBody({
    personProfileType: 'organization',
    organizationLegalName: 'Workers Compensation Board',
    firstName: 'Should',
    lastName: 'Ignore',
    gender: 'male',
    dateOfBirth: '2000-01-01',
    emails: JSON.stringify([{ type: 'primary', email: 'billing@wcb.example', isPrimary: true }]),
    phones: '[]',
    addresses: '[]',
    organizations: '[]',
    active: 'true'
  }, 'USR-1');

  assert.equal(person.personProfileType, 'organization');
  assert.equal(person.organizationProfile.legalName, 'Workers Compensation Board');
  assert.equal(person.name.preferred, 'Workers Compensation Board');
  assert.equal(person.name.first, '');
  assert.equal(person.name.last, '');
  assert.equal(person.demographics.gender, null);
  assert.equal(person.demographics.dateOfBirth, null);
});

test('buildPersonFromBody keeps explicit preferred name for organizations', () => {
  const person = buildPersonFromBody({
    personProfileType: 'organization',
    organizationLegalName: 'Workers Compensation Board',
    preferredName: 'WCB',
    emails: JSON.stringify([{ type: 'primary', email: 'billing@wcb.example', isPrimary: true }]),
    phones: '[]',
    addresses: '[]',
    organizations: '[]',
    active: 'true'
  }, 'USR-1');

  assert.equal(person.name.preferred, 'WCB');
  assert.equal(person.organizationProfile.legalName, 'Workers Compensation Board');
});

test('person form locks profile type on edit and uses radios on create', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const form = fs.readFileSync(path.resolve(__dirname, '../MVC/views/person/personForm.ejs'), 'utf8');
  const controller = fs.readFileSync(path.resolve(__dirname, '../MVC/controllers/personController.js'), 'utf8');

  assert.match(form, /btn-check[\s\S]*personProfileTypeIndividual/);
  assert.match(form, /personProfileTypeOrganization/);
  assert.match(form, /Profile type cannot be changed after the person is created/);
  assert.match(form, /Choose carefully — profile type cannot be changed later/);
  assert.match(form, /p\.id[\s\S]*type="hidden"[\s\S]*personProfileType/);
  assert.doesNotMatch(form, /<select name="personProfileType"/);
  assert.match(controller, /Profile type is immutable after create/);
  assert.match(controller, /lockedProfileType/);
});
