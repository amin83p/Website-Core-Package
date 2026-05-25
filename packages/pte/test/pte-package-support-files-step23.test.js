const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function findProjectRoot(startDir) {
  let current = startDir;
  while (current && current !== path.dirname(current)) {
    if (
      fs.existsSync(path.join(current, 'package.json'))
      && fs.existsSync(path.join(current, 'packages/pte/package.support-files.json'))
    ) {
      return current;
    }
    current = path.dirname(current);
  }
  throw new Error(`Unable to locate project root from ${startDir}`);
}

const ROOT_DIR = findProjectRoot(__dirname);
const SUPPORT_MAP_PATH = path.join(ROOT_DIR, 'packages/pte/package.support-files.json');

function toRepoPath(filePath) {
  return path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function walkFiles(rootDir) {
  const out = [];
  if (!fs.existsSync(rootDir)) return out;
  function visit(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        return;
      }
      if (entry.isFile()) out.push(fullPath);
    });
  }
  visit(rootDir);
  return out;
}

function listExpectedScripts() {
  const rootScripts = fs.readdirSync(path.join(ROOT_DIR, 'scripts'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /pte.*\.js$/i.test(entry.name))
    .map((entry) => `scripts/${entry.name}`);
  const pteScripts = walkFiles(path.join(ROOT_DIR, 'scripts/pte')).map(toRepoPath);
  return [
    ...rootScripts,
    ...pteScripts,
    'scripts/packages/enable-pte-package.js'
  ].sort();
}

function listExpectedDocs() {
  return walkFiles(path.join(ROOT_DIR, 'docs'))
    .map(toRepoPath)
    .filter((filePath) => (
      filePath.includes('/pte/')
      || path.basename(filePath).toLowerCase().includes('pte')
    ))
    .sort();
}

function listExpectedTests() {
  return fs.readdirSync(path.join(ROOT_DIR, 'test'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^(pte[.-]|pte-package|pte-student-role-token)/.test(entry.name))
    .map((entry) => `test/${entry.name}`)
    .sort();
}

function sourcesFor(mapRows = []) {
  return mapRows.map((row) => row.source).sort();
}

test('PTE package support-file map covers root-active scripts, docs, and tests', () => {
  const supportMap = readJson(SUPPORT_MAP_PATH);

  assert.equal(supportMap.packageId, 'pte');
  assert.equal(supportMap.step, 23);
  assert.deepEqual(sourcesFor(supportMap.scripts), listExpectedScripts());
  assert.deepEqual(sourcesFor(supportMap.docs), listExpectedDocs());
  assert.deepEqual(sourcesFor(supportMap.tests), listExpectedTests());
});

test('PTE package support-file map sources exist and targets stay inside package', () => {
  const supportMap = readJson(SUPPORT_MAP_PATH);
  [
    ...(supportMap.scripts || []),
    ...(supportMap.docs || []),
    ...(supportMap.tests || [])
  ].forEach((row) => {
    assert.equal(fs.existsSync(path.join(ROOT_DIR, row.source)), true, `${row.source} should exist`);
    assert.ok(row.target.startsWith('packages/pte/'), `${row.target} should stay inside packages/pte`);
    assert.equal(row.status, 'root-active');
  });
});

test('PTE package support-file map uses expected target folders', () => {
  const supportMap = readJson(SUPPORT_MAP_PATH);

  (supportMap.scripts || []).forEach((row) => {
    assert.match(row.target, /^packages\/pte\/scripts\/(seed|migration|maintenance)\//);
  });
  (supportMap.docs || []).forEach((row) => {
    assert.match(row.target, /^packages\/pte\/docs\//);
  });
  (supportMap.tests || []).forEach((row) => {
    assert.match(row.target, /^packages\/pte\/test\//);
  });
});
