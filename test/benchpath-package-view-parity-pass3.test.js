const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const express = require('express');

const ROOT_DIR = path.resolve(__dirname, '..');
const PACKAGE_VIEWS_DIR = path.join(ROOT_DIR, 'packages/benchpath/MVC/views/benchpath');
const PACKAGE_PARTIAL_DIR = path.join(ROOT_DIR, 'packages/benchpath/MVC/views/partials');
const CORE_PARTIAL_DIR = path.join(ROOT_DIR, 'MVC/views/partials');
const REGISTRY_PATH = path.join(ROOT_DIR, 'test/benchpath-package-ownership-registry.json');
const CORE_PARTIAL_INCLUDE_PREFIX = 'partials/';

function listFilesRecursive(dir, baseDir = dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return listFilesRecursive(absPath, baseDir);
      if (!entry.isFile()) return [];
      return [path.relative(baseDir, absPath).replace(/\\/g, '/')];
    })
    .sort();
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function extractCorePartialIncludes(filePath) {
  const source = read(filePath);
  const matches = [];
  const re = /include\(\s*['"]([^'"]+)['"]/g;
  let match = null;
  while ((match = re.exec(source)) !== null) {
    const token = match[1].trim();
    if (token.startsWith(CORE_PARTIAL_INCLUDE_PREFIX)) matches.push(token);
  }
  return matches;
}

function renderBenchpathView(viewName, locals = {}) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', [
    path.join(ROOT_DIR, 'MVC/views'),
    path.join(ROOT_DIR, 'packages/benchpath/MVC/views')
  ]);

  return new Promise((resolve, reject) => {
    app.render(viewName, locals, (error, html) => {
      if (error) reject(error);
      else resolve(html);
    });
  });
}

test('BenchPath package owns view inventory after root view retirement', () => {
  const registry = readJson(REGISTRY_PATH);
  const packageViews = listFilesRecursive(PACKAGE_VIEWS_DIR);

  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'MVC/views/benchpath')), false);
  assert.equal(packageViews.length, 26);
  assert.deepEqual(packageViews, [...registry.views].sort());
});

test('BenchPath package pass3 manifest declares package view namespace', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'packages/benchpath/package.manifest.json'), 'utf8'));

  assert.equal(manifest.views.path, 'packages/benchpath/MVC/views');
  assert.equal(manifest.views.namespace, 'benchpath');
  assert.equal(manifest.views.active, true);
});

test('BenchPath package views reference core partials through stable include paths', () => {
  const packageViews = listFilesRecursive(PACKAGE_VIEWS_DIR);
  const referencedPartials = new Set();

  packageViews.forEach((name) => {
    const viewPath = path.join(PACKAGE_VIEWS_DIR, ...name.split('/'));
    const source = read(viewPath);
    assert.equal(source.includes('../partials/'), false, `${name} should not use relative partial traversal`);
    assert.equal(source.includes('../../partials/'), false, `${name} should not use relative partial traversal`);

    extractCorePartialIncludes(viewPath).forEach((includeName) => {
      referencedPartials.add(includeName.replace(CORE_PARTIAL_INCLUDE_PREFIX, ''));
    });
  });

  assert.equal(
    fs.existsSync(PACKAGE_PARTIAL_DIR),
    false,
    'BenchPath should use shared core partials directly instead of a package-local partial bridge.'
  );
  assert.equal(referencedPartials.size > 0, true, 'Expected BenchPath package views to reference shared core partials.');

  [...referencedPartials].sort().forEach((partialName) => {
    assert.equal(
      fs.existsSync(path.join(CORE_PARTIAL_DIR, `${partialName}.ejs`)),
      true,
      `Referenced core partial should exist: ${partialName}`
    );
  });
});

test('BenchPath package source list view renders with core partials after root view retirement', async () => {
  const html = await renderBenchpathView('benchpath/source/sources', {
    title: 'Sources',
    newUrl: 'benchpath/sources',
    newLabel: 'New Source',
    user: { id: 'TEST_USER', allowedOrgs: [] },
    tableName: 'benchpathSources',
    print: false,
    data: [],
    pagination: {
      startItem: 0,
      endItem: 0,
      totalItems: 0,
      totalPages: 1,
      currentPage: 1,
      limit: 20
    },
    filters: {}
  });

  assert.match(html, /No sources found/);
});
