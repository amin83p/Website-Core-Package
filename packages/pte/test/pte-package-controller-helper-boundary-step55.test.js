const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const helperControllerDir = path.join(ROOT_DIR, 'packages/pte/MVC/controllers/pte');

const allowedDeepImportHelpers = new Set([
  'pteCoreHelpersCoreDependencies.js'
]);

const deepImportPatterns = [
  '../../../../MVC/',
  '../../../../../MVC/',
  '../../../../config/'
];

test('PTE controller helper files should keep deep core imports in explicit adapter files', () => {
  const files = fs.readdirSync(helperControllerDir).filter((name) => name.endsWith('.js')).sort();

  files.forEach((fileName) => {
    const fullPath = path.join(helperControllerDir, fileName);
    const source = fs.readFileSync(fullPath, 'utf8');
    const hasDeepImport = deepImportPatterns.some((token) => source.includes(token));

    if (!hasDeepImport) return;

    const isAllowedAdapter = allowedDeepImportHelpers.has(fileName);
    assert.equal(
      isAllowedAdapter,
      true,
      `${fileName} contains deep core imports outside an allowed controller adapter file.`
    );
  });
});

