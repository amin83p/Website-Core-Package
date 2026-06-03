const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const CORE_VIEW_ROOT = path.join(ROOT_DIR, 'MVC/views/school');
const PACKAGE_VIEW_ROOT = path.join(ROOT_DIR, 'packages/school/MVC/views/school');

function walkFiles(directory) {
  const out = [];
  if (!fs.existsSync(directory)) return out;
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  entries.forEach((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(fullPath));
      return;
    }
    if (entry.isFile()) out.push(fullPath);
  });
  return out;
}

test('school package view mirror should cover current core school view tree', () => {
  const coreFiles = walkFiles(CORE_VIEW_ROOT)
    .map((filePath) => path.relative(CORE_VIEW_ROOT, filePath).replace(/\\/g, '/'))
    .filter((filePath) => filePath.endsWith('.ejs'))
    .sort();
  const packageFiles = walkFiles(PACKAGE_VIEW_ROOT)
    .map((filePath) => path.relative(PACKAGE_VIEW_ROOT, filePath).replace(/\\/g, '/'))
    .filter((filePath) => filePath.endsWith('.ejs'))
    .sort();

  const missingInPackage = coreFiles.filter((filePath) => !packageFiles.includes(filePath));
  assert.deepEqual(missingInPackage, []);
  assert.equal(packageFiles.length >= coreFiles.length, true);
});
