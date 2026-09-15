const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const canadaPostAddressCompleteService = require('../MVC/services/canadaPostAddressCompleteService');
const settingService = require('../MVC/services/settingService');

const personFormSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/person/personForm.ejs'),
  'utf8'
);
const profileModalSource = fs.readFileSync(
  path.join(__dirname, '../public/scripts/schoolPersonProfileModal.js'),
  'utf8'
);
const studentFormSource = fs.readFileSync(
  path.join(__dirname, '../packages/school/MVC/views/school/student/studentForm.ejs'),
  'utf8'
);
const routesSource = fs.readFileSync(
  path.join(__dirname, '../MVC/routes/addressRoutes.js'),
  'utf8'
);
const autocompleteSource = fs.readFileSync(
  path.join(__dirname, '../public/scripts/canadianAddressAutocomplete.js'),
  'utf8'
);

test('normalizePostalCode formats Canadian postal codes', () => {
  assert.equal(canadaPostAddressCompleteService.normalizePostalCode('k1a0b1'), 'K1A 0B1');
});

test('mapFindItem maps Canada Post Find rows', () => {
  const suggestion = canadaPostAddressCompleteService.mapFindItem({
    Id: 'CAN|PR|123',
    Text: '2701 Riverside Dr, Ottawa, ON',
    Description: '102 Streets',
    Next: 'Retrieve'
  });
  assert.equal(suggestion.id, 'CAN|PR|123');
  assert.equal(suggestion.next, 'Retrieve');
  assert.match(suggestion.label, /2701 Riverside Dr/);
});

test('mapRetrieveRow maps Canada Post Retrieve rows', () => {
  const address = canadaPostAddressCompleteService.mapRetrieveRow({
    Line1: '2701 Riverside Dr',
    City: 'Ottawa',
    ProvinceCode: 'ON',
    PostalCode: 'K1V2G5'
  });
  assert.equal(address.line1, '2701 Riverside Dr');
  assert.equal(address.city, 'Ottawa');
  assert.equal(address.province, 'ON');
  assert.equal(address.postalCode, 'K1V 2G5');
});

test('findAddresses fails with configuration_error when API key is missing', async () => {
  const originalGet = settingService.get;
  const originalEnv = process.env.CANADA_POST_ADDRESS_API_KEY;
  settingService.get = () => ({ app: { integrationVariables: [] } });
  delete process.env.CANADA_POST_ADDRESS_API_KEY;
  try {
    await assert.rejects(
      () => canadaPostAddressCompleteService.findAddresses({ query: '2701 Riverside' }),
      (error) => error.code === 'configuration_error'
    );
  } finally {
    settingService.get = originalGet;
    if (originalEnv === undefined) delete process.env.CANADA_POST_ADDRESS_API_KEY;
    else process.env.CANADA_POST_ADDRESS_API_KEY = originalEnv;
  }
});

test('address routes expose authenticated search and retrieve endpoints', () => {
  assert.match(routesSource, /\/search/);
  assert.match(routesSource, /\/retrieve/);
  assert.match(routesSource, /requireAuth/);
});

test('frontend supports Canada Post Find and Retrieve flow', () => {
  assert.match(autocompleteSource, /lastId/);
  assert.match(autocompleteSource, /\/api\/address\/retrieve/);
  assert.match(autocompleteSource, /row\.next === 'Find'/);
});

test('consumers use shared autocomplete and no longer call Nominatim', () => {
  assert.doesNotMatch(personFormSource, /nominatim\.openstreetmap\.org/);
  assert.doesNotMatch(profileModalSource, /nominatim\.openstreetmap\.org/);
  assert.doesNotMatch(studentFormSource, /nominatim\.openstreetmap\.org/);
  assert.match(personFormSource, /canadianAddressAutocomplete\.js/);
  assert.match(personFormSource, /CanadianAddressAutocomplete/);
  assert.match(profileModalSource, /CanadianAddressAutocomplete/);
  assert.match(studentFormSource, /canadianAddressAutocomplete\.js/);
});
