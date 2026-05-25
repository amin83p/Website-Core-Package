const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const repositoryDir = path.join(ROOT_DIR, 'packages/pte/MVC/repositories');

const authorizedDeepImportRepositories = new Set([
  'pteAiRepositoryDependencies.js'
]);

const shimPattern = /^\s*module\.exports\s*=\s*require\(['"]\.\.\/\.\.\/\.\.\/\.\.\/MVC\/repositories\/pte[^'"]+['"]\)\s*;?\s*$/;
const deepImportPatterns = [
  '../../../../../MVC/',
  '../../../../MVC/',
  '../../../../config/'
];

test('PTE package repositories should keep deep core imports behind package-level adapters', () => {
  const files = fs.readdirSync(repositoryDir).filter((name) => name.endsWith('.js')).sort();

  files.forEach((fileName) => {
    const fullPath = path.join(repositoryDir, fileName);
    const source = fs.readFileSync(fullPath, 'utf8');
    const hasDeepImport = deepImportPatterns.some((token) => source.includes(token));
    if (!hasDeepImport) return;

    if (authorizedDeepImportRepositories.has(fileName)) return;

    const isDomainShim = shimPattern.test(source.trim());
    assert.equal(
      isDomainShim,
      true,
      `${fileName} contains deep core imports outside an expected package adapter. Keep as shim or route imports via repository dependency adapter.`
    );
  });
});
