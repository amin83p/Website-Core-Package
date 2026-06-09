const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const REGISTRY_PATH = path.join(ROOT_DIR, 'test/school-package-ownership-registry.json');
const CONTROLLERS_DIR = path.join(ROOT_DIR, 'packages/school/MVC/controllers/school');

function walkJsFiles(directory) {
  const out = [];
  if (!fs.existsSync(directory)) return out;
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  entries.forEach((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkJsFiles(fullPath));
      return;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) out.push(fullPath);
  });
  return out;
}

test('school ownership registry should provide domain keys', () => {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  assert.deepEqual(Object.keys(registry).sort(), ['controllers', 'models', 'repositories', 'services']);
});

test('school ownership registry controller list should match package-owned controller surface', () => {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const expected = walkJsFiles(CONTROLLERS_DIR)
    .map((filePath) => path.basename(filePath))
    .sort();
  const actual = [...new Set((registry.controllers || []).map(String))].sort();

  assert.deepEqual(actual, expected);
});
