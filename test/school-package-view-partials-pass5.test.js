const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const SCHOOL_VIEW_ROOT = path.join(ROOT_DIR, 'packages/school/MVC/views/school');
const SCHOOL_PARTIAL_ROOT = path.join(ROOT_DIR, 'packages/school/MVC/views/partials');

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

test('school package should mirror shared partials required by school package views', () => {
  assert.equal(fs.existsSync(SCHOOL_PARTIAL_ROOT), true);

  const partialFiles = walkFiles(SCHOOL_PARTIAL_ROOT)
    .map((filePath) => path.relative(SCHOOL_PARTIAL_ROOT, filePath).replace(/\\/g, '/'))
    .filter((filePath) => filePath.endsWith('.ejs'));

  // Core school views rely heavily on these shared partials.
  const requiredPartials = [
    'dashboard/unifiedDashboard.ejs',
    'modal_GenericPicker.ejs',
    'pagination.ejs',
    'tablePages-start.ejs',
    'tablePages-search.ejs',
    'tablePages-end.ejs'
  ];

  const missing = requiredPartials.filter((partialPath) => !partialFiles.includes(partialPath));
  assert.deepEqual(missing, []);
  assert.equal(partialFiles.length > 0, true);
});

test('school package views should use stable partial include paths', () => {
  const viewFiles = walkFiles(SCHOOL_VIEW_ROOT).filter((filePath) => filePath.endsWith('.ejs'));
  const offenders = [];

  viewFiles.forEach((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(SCHOOL_VIEW_ROOT, filePath).replace(/\\/g, '/');

    if (/include\(\s*['"]\.\.\//.test(source)) {
      offenders.push(`${relativePath}: contains relative include traversal`);
    }
    if (/include\(\s*['"](?:MVC\/views|packages\/)/.test(source)) {
      offenders.push(`${relativePath}: includes direct root/package filesystem path`);
    }
  });

  assert.deepEqual(offenders, []);
});
