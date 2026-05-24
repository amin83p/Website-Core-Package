const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT_DIR, relativePath));
}

test('Step 13 physical move map records all required PTE file groups', () => {
  const doc = readText('docs/pte-package-physical-move-map-step13.md');
  [
    'MVC/controllers/pte',
    'MVC/routes/pte',
    'MVC/services/pte',
    'MVC/models/pte',
    'MVC/views/pte',
    'MVC/repositories/pte*.js',
    'MVC/middleware/pteUploadContextMiddleware.js',
    'MVC/utils/pteUploadPathUtils.js',
    'public/scripts/ptePracticeCoachRules.js',
    'data/pte*.json',
    'scripts/seed-pte-*.js',
    'scripts/pte',
    'packages/pte/package.manifest.json'
  ].forEach((token) => {
    assert.ok(doc.includes(token), `Expected Step 13 map to mention ${token}`);
  });
});

test('Step 13 keeps PTE in compatibility-first locations', () => {
  assert.equal(exists('MVC/routes/pte/pteMainRoute.js'), true);
  assert.equal(exists('MVC/controllers/pte/infoController.js'), true);
  assert.equal(exists('MVC/services/pte/ptePublicJoinService.js'), true);
  assert.equal(exists('MVC/views/pte/testInfo.ejs'), true);

  assert.equal(exists('packages/pte/MVC/routes/pteMainRoute.js'), true);
  assert.equal(exists('packages/pte/MVC/controllers/infoController.js'), true);
  assert.equal(exists('packages/pte/MVC/services/pte/ptePublicJoinService.js'), true);
  assert.equal(exists('packages/pte/MVC/models/pte/pteApplicantModel.js'), true);
  assert.equal(exists('packages/pte/MVC/repositories/pteApplicantRepository.js'), true);
  assert.equal(exists('packages/pte/MVC/middleware/pteUploadContextMiddleware.js'), true);
  assert.equal(exists('packages/pte/MVC/utils/pteUploadPathUtils.js'), true);
  assert.equal(exists('packages/pte/MVC/views/pte/testInfo.ejs'), true);
  assert.equal(exists('packages/pte/public/scripts/ptePracticeCoachRules.js'), true);
  assert.equal(exists('packages/pte/package.support-files.json'), true);
  assert.equal(exists('packages/pte/scripts/seed/seed-pte-sections.js'), true);
  assert.equal(exists('packages/pte/scripts/maintenance/enable-pte-package.js'), true);
});

test('Step 13 keeps /pte hardcoded while package route is mount-ready', () => {
  const appSource = readText('app.js');
  assert.match(appSource, /const pteRoutes\s*=\s*require\('\.\/MVC\/routes\/pte\/pteMainRoute'\)/);
  assert.match(appSource, /app\.use\('\/pte',\s*pteRoutes\)/);

  const manifest = JSON.parse(readText('packages/pte/package.manifest.json'));
  const pteUseRoutes = (manifest.routes || []).filter((route) => (
    String(route?.method || 'USE').toUpperCase() === 'USE'
    && route?.path === '/pte'
  ));

  assert.equal(pteUseRoutes.length, 1);
  assert.equal(pteUseRoutes[0].metadataOnly, false);
});

test('Step 13 map preserves core-owned service boundaries for PTE consumption', () => {
  const doc = readText('docs/pte-package-physical-move-map-step13.md');
  [
    'Auth and session middleware',
    'Access middleware',
    'Action state',
    'Persons, users, organizations',
    'coreFilesService',
    'Activity Quota',
    'JSON/Mongo',
    'shared AI providers'
  ].forEach((token) => {
    assert.ok(doc.includes(token), `Expected Step 13 map to mention ${token}`);
  });
});
