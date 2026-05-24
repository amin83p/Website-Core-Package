const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

test('PTE package middleware files should use package-local dependency adapters', () => {
  const middlewareDir = path.join(ROOT_DIR, 'packages/pte/MVC/middleware');
  const files = fs.readdirSync(middlewareDir).filter((name) => name.endsWith('.js'));

  const forbiddenPatterns = [
    '../../../../MVC/',
    '../../../../../MVC/',
    '../../..\\MVC\\',
    '../../../../config/'
  ];

  files.forEach((fileName) => {
    const fullPath = path.join(middlewareDir, fileName);
    const source = fs.readFileSync(fullPath, 'utf8');

    if (fileName === 'pteUploadContextMiddleware.js') {
      assert.equal(
        source.includes("require('../services/pte/pteUploadContextDependencies')"),
        true,
        `${fileName} should consume upload-context dependency adapter.`
      );
    }

    forbiddenPatterns.forEach((pattern) => {
      assert.equal(
        source.includes(pattern),
        false,
        `${fileName} should not directly import deep core paths like ${pattern}`
      );
    });
  });
});
