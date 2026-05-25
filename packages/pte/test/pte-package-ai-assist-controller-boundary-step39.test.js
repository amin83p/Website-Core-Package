const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const FILES = [
  'packages/pte/MVC/controllers/aiProviderController.js',
  'packages/pte/MVC/controllers/aiTokenUsageController.js'
];

for (const relativePath of FILES) {
  test(`AI Assist controller boundary helper import for ${path.basename(relativePath)}`, () => {
    const source = readText(relativePath);
    assert.ok(
      source.includes("require('./pte/coreHelpers')"),
      `${relativePath} should import package-owned helper entrypoint`
    );
    assert.ok(
      !source.includes("require('./coreHelpers')"),
      `${relativePath} should not import stale helper path`
    );
  });
}
