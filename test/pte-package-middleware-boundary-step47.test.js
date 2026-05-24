const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

test('PTE package middleware files should delegate to core middleware where available', () => {
  const middlewareDir = path.join(ROOT_DIR, 'packages/pte/MVC/middleware');
  const files = fs.readdirSync(middlewareDir).filter((name) => name.endsWith('.js'));

  const forbiddenPatterns = [
    '../../../../../MVC/',
    '../../..\\MVC\\',
    '../../../../config/'
  ];

  files.forEach((fileName) => {
    const fullPath = path.join(middlewareDir, fileName);
    const source = fs.readFileSync(fullPath, 'utf8');

    if (fileName === 'pteUploadContextMiddleware.js') {
      assert.equal(
        source.includes("require('../../../../MVC/middleware/pteUploadContextMiddleware')"),
        true,
        `${fileName} should delegate to the core upload middleware.`
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
