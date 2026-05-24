const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PTE_VIEW_DIR = path.join(ROOT_DIR, 'packages/pte/MVC/views/pte');
const PTE_PARTIAL_DIR = path.join(ROOT_DIR, 'packages/pte/MVC/views/partials');
const CORE_PARTIAL_DIR = path.join(ROOT_DIR, 'MVC/views/partials');

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
    if (token.startsWith('../../partials/')) {
      matches.push(token.replace('../../partials/', ''));
    }
  }
  return matches;
}

const PTE_VIEW_FILES = walkFiles(PTE_VIEW_DIR);
const EXPECTED_PARTIAL_BRIDGES = new Set([
  'modal',
  'modal_AudioPreview',
  'modal_GenericPicker',
  'modal_ImageViewer',
  'modal_MediaManager',
  'pagination',
  'tablePages-end',
  'tablePages-search',
  'tablePages-start'
]);

test('package views should keep partial includes inside package partial bridge directory', () => {
  const referencedPartials = new Set();

  for (const viewFile of PTE_VIEW_FILES) {
    for (const includeName of extractPartialIncludes(viewFile)) {
      referencedPartials.add(includeName);
      const bridgePath = path.join(PTE_PARTIAL_DIR, `${includeName}.ejs`);
      assert.ok(
        fs.existsSync(bridgePath),
        `Missing package partial bridge: ${includeName} (expected ${bridgePath})`
      );
    }
  }

  for (const partialName of [...EXPECTED_PARTIAL_BRIDGES].sort()) {
    assert.ok(
      referencedPartials.has(partialName),
      `Expected package view usage to cover partial: ${partialName}`
    );
  }
});

test('package partial bridges should delegate to core view partials', () => {
  for (const partialName of [...EXPECTED_PARTIAL_BRIDGES].sort()) {
    const bridgePath = path.join(PTE_PARTIAL_DIR, `${partialName}.ejs`);
    const source = fs.readFileSync(bridgePath, 'utf8');
    const expectedCoreDelegate = `../../../../MVC/views/partials/${partialName}`;
    assert.ok(
      source.includes(`<%- include('${expectedCoreDelegate}') %>`) ||
        source.includes(`<%- include("${expectedCoreDelegate}") %>`),
      `Partial bridge ${partialName} should include core partial: ${expectedCoreDelegate}`
    );
    const corePartial = path.join(CORE_PARTIAL_DIR, `${partialName}.ejs`);
    assert.ok(fs.existsSync(corePartial), `Expected core partial exists before delegation: ${corePartial}`);
  }
});
