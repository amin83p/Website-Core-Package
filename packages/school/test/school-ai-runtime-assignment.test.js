const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const RUNTIME_PATH = path.join(ROOT, 'packages/school/MVC/services/school/schoolAiRuntimeService.js');

test('runtime does not fall back to org default provider when assignment is missing', () => {
  const source = fs.readFileSync(RUNTIME_PATH, 'utf8');
  assert.doesNotMatch(source, /org_default/);
  assert.doesNotMatch(source, /default_fallback/);
  assert.match(source, /resolveAssignedProviderModel/);
  assert.match(source, /is not assigned to a provider and model yet/);
});