const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function findProjectRoot(startDir) {
  let current = startDir;
  while (current && current !== path.dirname(current)) {
    if (
      fs.existsSync(path.join(current, 'package.json'))
      && fs.existsSync(path.join(current, 'packages/ielts/package.support-files.json'))
    ) {
      return current;
    }
    current = path.dirname(current);
  }
  throw new Error(`Unable to locate project root from ${startDir}`);
}

const ROOT_DIR = findProjectRoot(__dirname);
const SUPPORT_MAP_PATH = path.join(ROOT_DIR, 'packages/ielts/package.support-files.json');

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
    .filter((entry) => entry.isFile() && /ielts.*\.(js|ps1)$/i.test(entry.name))
    .map((entry) => `scripts/${entry.name}`);
  const ieltsScripts = walkFiles(path.join(ROOT_DIR, 'scripts/ielts')).map(toRepoPath);
  return [
    ...rootScripts,
    ...ieltsScripts,
    'scripts/packages/enable-ielts-package.js'
  ].sort();
}

function listExpectedDocs() {
  return walkFiles(path.join(ROOT_DIR, 'docs'))
    .map(toRepoPath)
    .filter((filePath) => (
      filePath.includes('/ielts/')
      || path.basename(filePath).toLowerCase().includes('ielts')
    ))
    .sort();
}

function listExpectedTests() {
  return fs.readdirSync(path.join(ROOT_DIR, 'test'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().includes('ielts'))
    .map((entry) => `test/${entry.name}`)
    .sort();
}

function sourcesFor(mapRows = []) {
  return mapRows.map((row) => row.source).sort();
}

test('IELTS package pass13 support-file map covers root-active scripts, docs, and tests', () => {
  const supportMap = readJson(SUPPORT_MAP_PATH);

  assert.equal(supportMap.packageId, 'ielts');
  assert.equal(supportMap.step, 13);
  assert.deepEqual(sourcesFor(supportMap.scripts), listExpectedScripts());
  assert.deepEqual(sourcesFor(supportMap.docs), listExpectedDocs());
  assert.deepEqual(sourcesFor(supportMap.tests), listExpectedTests());
});

test('IELTS package pass13 support-file map sources and mirrored targets exist', () => {
  const supportMap = readJson(SUPPORT_MAP_PATH);
  [
    ...(supportMap.scripts || []),
    ...(supportMap.docs || []),
    ...(supportMap.tests || [])
  ].forEach((row) => {
    assert.equal(fs.existsSync(path.join(ROOT_DIR, row.source)), true, `${row.source} should exist`);
    assert.equal(fs.existsSync(path.join(ROOT_DIR, row.target)), true, `${row.target} should exist`);
    assert.ok(row.target.startsWith('packages/ielts/'), `${row.target} should stay inside packages/ielts`);
    assert.equal(row.status, 'root-active');
    assert.ok(['package-owned', 'package-mirrored'].includes(row.targetStatus), `${row.target} should declare target status`);
  });
});

test('IELTS package pass13 support-file map uses expected target folders', () => {
  const supportMap = readJson(SUPPORT_MAP_PATH);

  (supportMap.scripts || []).forEach((row) => {
    assert.match(row.target, /^packages\/ielts\/scripts\/(ielts|maintenance|migration)\//);
  });
  (supportMap.docs || []).forEach((row) => {
    assert.match(row.target, /^packages\/ielts\/docs\//);
  });
  (supportMap.tests || []).forEach((row) => {
    assert.match(row.target, /^packages\/ielts\/test\//);
  });
});
