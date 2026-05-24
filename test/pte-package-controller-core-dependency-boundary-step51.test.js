const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const controllerDir = path.join(ROOT_DIR, 'packages/pte/MVC/controllers');

const authorizedShims = new Set([]);
const shimPattern = /^\s*module\.exports\s*=\s*require\(['"]\.\.\/\.\.\/\.\.\/\.\.\/MVC\/controllers\/pte\/[^'"]+['"]\)\s*;?\s*$/;
const deepImportPatterns = [
  '../../../../../MVC/',
  '../../../../MVC/',
  '../../../../config/'
];

test('PTE package controllers should not import core directly', () => {
  const files = fs.readdirSync(controllerDir).filter((name) => name.endsWith('.js')).sort();

  files.forEach((fileName) => {
    const fullPath = path.join(controllerDir, fileName);
    const source = fs.readFileSync(fullPath, 'utf8');
    const hasDeepImport = deepImportPatterns.some((token) => source.includes(token));

    if (!hasDeepImport) return;

    if (authorizedShims.has(fileName)) return;

    const isDomainShim = shimPattern.test(source.trim());
    assert.equal(
      isDomainShim,
      true,
      `${fileName} contains deep core imports. Keep this shimmed adapter pattern or move imports behind a package-local dependency adapter.`
    );
  });
});
