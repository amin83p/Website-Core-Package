const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const PTE_VIEW_DIR = path.join(ROOT_DIR, 'packages/pte/MVC/views/pte');
const CORE_PARTIAL_DIR = path.join(ROOT_DIR, 'MVC/views/partials');
const PACKAGE_PARTIAL_DIR = path.join(ROOT_DIR, 'packages/pte/MVC/views/partials');
const CORE_PARTIAL_INCLUDE_PREFIX = '../../../../../../MVC/views/partials/';

function walkFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile() && fullPath.endsWith('.ejs')) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractPartialIncludes(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const matches = [];
  const re = /include\(\s*['"]([^'"]+)['"]/g;
  let match = null;
  while ((match = re.exec(source)) !== null) {
    const token = match[1].trim();
    if (token.startsWith(CORE_PARTIAL_INCLUDE_PREFIX)) {
      matches.push(token);
    }
  }
  return matches;
}

const PTE_VIEW_FILES = walkFiles(PTE_VIEW_DIR);

test('package views should reference core partials directly, with no local bridge copy', () => {
  const referencedPartials = new Set();

  for (const viewFile of PTE_VIEW_FILES) {
    for (const includeName of extractPartialIncludes(viewFile)) {
      const partialName = includeName.replace(CORE_PARTIAL_INCLUDE_PREFIX, '');
      referencedPartials.add(partialName);
    }
  }

  assert.equal(
    fs.existsSync(PACKAGE_PARTIAL_DIR),
    false,
    'PTE package-local partial bridge directory should be removed; package views must use core partials directly.'
  );

  for (const partialName of [...referencedPartials].sort()) {
    const corePartial = path.join(CORE_PARTIAL_DIR, `${partialName}.ejs`);
    assert.ok(
      fs.existsSync(corePartial),
      `Referenced core partial should exist before rendering: ${corePartial}`
    );
  }

  assert.equal(referencedPartials.size > 0, true, 'Expected PTE package views to reference shared table/page/modal partials.');
});

test('package views should never include package-local partial path tokens', () => {
  for (const viewFile of PTE_VIEW_FILES) {
    const source = fs.readFileSync(viewFile, 'utf8');
    assert.equal(source.includes("'../../partials/"), false, `${path.relative(PTE_VIEW_DIR, viewFile)} should not include '../../partials/'`);
    assert.equal(source.includes('"../../partials/'), false, `${path.relative(PTE_VIEW_DIR, viewFile)} should not include "../../partials/"`);
  }
});
