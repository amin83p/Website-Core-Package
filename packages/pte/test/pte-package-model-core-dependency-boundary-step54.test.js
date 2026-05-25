const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const modelDir = path.join(ROOT_DIR, 'packages/pte/MVC/models/pte');

const shimPattern = /^\s*module\.exports\s*=\s*require\(['"]\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/MVC\/models\/pte\/[^'"]+['"]\)\s*;?\s*$/;
const deepImportPatterns = [
  '../../../../../MVC/',
  '../../../../MVC/',
  '../../../../config/'
];

test('PTE package models should remain shims or explicit package adapters', () => {
  const files = fs.readdirSync(modelDir).filter((name) => name.endsWith('.js')).sort();

  files.forEach((fileName) => {
    const fullPath = path.join(modelDir, fileName);
    const source = fs.readFileSync(fullPath, 'utf8');
    const hasDeepImport = deepImportPatterns.some((token) => source.includes(token));
    if (!hasDeepImport) return;

    const isModelShim = shimPattern.test(source.trim());
    assert.equal(
      isModelShim,
      true,
      `${fileName} contains deep core imports. Keep package model files as shims unless converted to explicit package-level adapters.`
    );
  });
});
