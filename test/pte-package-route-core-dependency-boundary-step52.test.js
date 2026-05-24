const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const routeDir = path.join(ROOT_DIR, 'packages/pte/MVC/routes');

const shimPattern = /^\s*module\.exports\s*=\s*require\(['"]\.\.\/\.\.\/\.\.\/\.\.\/MVC\/routes\/pte\/[^'"]+['"]\)\s*;?\s*$/;
const deepImportPatterns = [
  '../../../../../MVC/',
  '../../../../MVC/',
  '../../../../config/'
];

test('PTE package route shims should avoid direct deep core imports', () => {
  const files = fs.readdirSync(routeDir).filter((name) => name.endsWith('.js')).sort();

  files.forEach((fileName) => {
    const fullPath = path.join(routeDir, fileName);
    const source = fs.readFileSync(fullPath, 'utf8');
    const hasDeepImport = deepImportPatterns.some((token) => source.includes(token));
    if (!hasDeepImport) return;

    if (fileName === 'pteRouteDependencies.js') return;
    const isRouteShim = shimPattern.test(source.trim());
    assert.equal(
      isRouteShim,
      true,
      `${fileName} contains deep core imports; keep this as a pure route shim or move through package-owned dependency adapters.`
    );
  });
});
