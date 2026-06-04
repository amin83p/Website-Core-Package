const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function toRepoPath(filePath) {
  return path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
}

function walkJs(rootDir) {
  const out = [];
  if (!fs.existsSync(rootDir)) return out;
  function visit(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        return;
      }
      if (entry.isFile() && entry.name.endsWith('.js')) out.push(fullPath);
    });
  }
  visit(rootDir);
  return out;
}

function packageTargetForRootShim(rootRelativePath) {
  if (rootRelativePath === 'MVC/routes/ielts/ieltsMainRoute.js') {
    return 'packages/ielts/MVC/routes/ieltsMainRoute.js';
  }
  if (rootRelativePath === 'MVC/routes/ielts/ieltsRoutes.js') {
    return 'packages/ielts/MVC/routes/ieltsRoutes.js';
  }
  return `packages/ielts/${rootRelativePath}`;
}

function expectedRootShimFiles() {
  const roots = [
    'MVC/controllers/ielts',
    'MVC/models/ielts',
    'MVC/services/ielts',
    'MVC/repositories/ielts'
  ];
  return [
    ...roots.flatMap((dir) => walkJs(path.join(ROOT_DIR, dir)).map(toRepoPath)),
    'MVC/routes/ielts/ieltsMainRoute.js',
    'MVC/routes/ielts/ieltsRoutes.js'
  ].sort();
}

test('IELTS package pass14 root MVC JS files delegate to package-owned implementations', () => {
  const shimFiles = expectedRootShimFiles();
  assert.equal(shimFiles.length >= 1, true);

  shimFiles.forEach((rootRelativePath) => {
    const source = fs.readFileSync(path.join(ROOT_DIR, rootRelativePath), 'utf8').trim();
    const target = packageTargetForRootShim(rootRelativePath);

    assert.equal(fs.existsSync(path.join(ROOT_DIR, target)), true, `${target} should exist`);
    assert.match(source, /^module\.exports = require\('[^']+'\);$/);
    assert.equal(source.includes('packages/ielts/'), true, `${rootRelativePath} should delegate to packages/ielts`);
  });
});

test('IELTS package pass14 keeps runtime data app-level during root shim retirement', () => {
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'data/ielts')), true);
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'packages/ielts/data')), false);
});
