const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const integrationVariableModel = require('../MVC/models/integrationVariableModel');
const integrationVariableService = require('../MVC/services/integrationVariableService');
const settingService = require('../MVC/services/settingService');

const viewSource = fs.readFileSync(
  path.join(__dirname, '../MVC/views/systemSettings/appSettings.ejs'),
  'utf8'
);

test('normalizeIntegrationVariableKey uppercases and sanitizes keys', () => {
  assert.equal(
    integrationVariableModel.normalizeIntegrationVariableKey('canada_post_address_api_key'),
    'CANADA_POST_ADDRESS_API_KEY'
  );
});

test('sanitizeIntegrationVariablesFromForm rejects duplicate keys', () => {
  assert.throws(() => {
    integrationVariableModel.sanitizeIntegrationVariablesFromForm({
      integrationVarKey: ['CANADA_POST_ADDRESS_API_KEY', 'CANADA_POST_ADDRESS_API_KEY'],
      integrationVarValue: ['abc', 'def'],
      integrationVarSecret: ['true', 'false']
    }, []);
  }, /Duplicate integration variable key/);
});

test('sanitizeIntegrationVariablesFromForm encrypts secret values and preserves blank secret updates', () => {
  const existing = integrationVariableModel.sanitizeIntegrationVariablesFromForm({
    integrationVarKey: ['CANADA_POST_ADDRESS_API_KEY'],
    integrationVarValue: ['secret-key-value'],
    integrationVarSecret: ['true']
  }, []);

  const preserved = integrationVariableModel.sanitizeIntegrationVariablesFromForm({
    integrationVarKey: ['CANADA_POST_ADDRESS_API_KEY'],
    integrationVarValue: [''],
    integrationVarSecret: ['true']
  }, existing);

  assert.equal(preserved.length, 1);
  assert.equal(preserved[0].key, 'CANADA_POST_ADDRESS_API_KEY');
  assert.ok(preserved[0].valueEncrypted);
  assert.equal(integrationVariableModel.decryptStoredValue(preserved[0]), 'secret-key-value');
});

test('getIntegrationVariable reads from settings cache before env fallback', () => {
  const originalGet = settingService.get;
  const originalEnv = process.env.CANADA_POST_ADDRESS_API_KEY;
  settingService.get = () => ({
    app: {
      integrationVariables: [{
        key: 'CANADA_POST_ADDRESS_API_KEY',
        isSecret: false,
        value: 'from-db'
      }]
    }
  });
  delete process.env.CANADA_POST_ADDRESS_API_KEY;
  try {
    assert.equal(integrationVariableService.getIntegrationVariable('CANADA_POST_ADDRESS_API_KEY'), 'from-db');
    process.env.CANADA_POST_ADDRESS_API_KEY = 'from-env';
    assert.equal(integrationVariableService.getIntegrationVariable('CANADA_POST_ADDRESS_API_KEY'), 'from-db');
    settingService.get = () => ({ app: { integrationVariables: [] } });
    assert.equal(integrationVariableService.getIntegrationVariable('CANADA_POST_ADDRESS_API_KEY'), 'from-env');
  } finally {
    settingService.get = originalGet;
    if (originalEnv === undefined) delete process.env.CANADA_POST_ADDRESS_API_KEY;
    else process.env.CANADA_POST_ADDRESS_API_KEY = originalEnv;
  }
});

test('application defaults view includes integration variables tab', () => {
  assert.match(viewSource, /Integration Variables/);
  assert.match(viewSource, /integrationVarKey/);
  assert.match(viewSource, /app-integration-vars-pane/);
  assert.match(viewSource, /CANADA_POST_ADDRESS_API_KEY/);
  assert.match(viewSource, /Canada Post AddressComplete/);
});
