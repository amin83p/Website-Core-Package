const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function routeFileNames() {
  return [
    'attemptRoutes.js',
    'courseRoutes.js',
    'feedbackRoutes.js',
    'practiceRoutes.js',
    'publicApplicantRoutes.js',
    'questionBankRoutes.js',
    'scoringRoutes.js',
    'studentRoutes.js',
    'teacherRoutes.js',
    'testRoutes.js'
  ];
}

test('PTE package route tree mirrors the current PTE route module names', () => {
  routeFileNames().forEach((fileName) => {
    assert.equal(fs.existsSync(path.join(ROOT_DIR, 'MVC/routes/pte', fileName)), true);
    assert.equal(fs.existsSync(path.join(ROOT_DIR, 'packages/pte/MVC/routes', fileName)), true);
  });
});

test('PTE package main route uses package-local subroute shims', () => {
  const source = readText('packages/pte/MVC/routes/pteMainRoute.js');
  assert.doesNotMatch(source, /module\.exports\s*=\s*require\('\.\.\/\.\.\/\.\.\/\.\.\/MVC\/routes\/pte\/pteMainRoute'\)/);

  [
    './studentRoutes',
    './publicApplicantRoutes',
    './teacherRoutes',
    './questionBankRoutes',
    './testRoutes',
    './courseRoutes',
    './aiAssistRoutes',
    './scoringRoutes',
    './practiceRoutes',
    './feedbackRoutes',
    './attemptRoutes'
  ].forEach((token) => {
    assert.ok(source.includes(`require('${token}')`), `Expected package main route to require ${token}`);
  });
});

test('PTE route shims delegate to current MVC route modules until physical move', () => {
  const packageOwnedRouteModules = new Set([
    'attemptRoutes.js',
    'courseRoutes.js',
    'feedbackRoutes.js',
    'practiceRoutes.js',
    'publicApplicantRoutes.js',
    'questionBankRoutes.js',
    'studentRoutes.js',
    'scoringRoutes.js',
    'teacherRoutes.js',
    'testRoutes.js'
  ]);

  routeFileNames().forEach((fileName) => {
    if (packageOwnedRouteModules.has(fileName)) {
      return;
    }

    const source = readText(`packages/pte/MVC/routes/${fileName}`);
    assert.ok(
      source.includes(`../../../../MVC/routes/pte/${fileName.replace(/\.js$/, '')}`),
      `${fileName} should delegate to the current MVC route module`
    );
  });
});

test('PTE AI Assist route remains package-owned', () => {
  const source = readText('packages/pte/MVC/routes/aiAssistRoutes.js');
  assert.ok(
    source.includes('express = require(\'express\')'),
    'AI Assist route should expose express router setup'
  );
  assert.ok(
    !source.includes('../../../../MVC/routes/pte/aiAssistRoutes'),
    'AI Assist route should not delegate to core MVC route module'
  );
});
