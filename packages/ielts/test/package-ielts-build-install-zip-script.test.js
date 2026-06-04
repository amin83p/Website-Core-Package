const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const PizZip = require('pizzip');

function runNodeScript(scriptPath, args = [], options = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    ...options
  });
}

function createFixtureRoot(prefix = 'ielts-build-zip-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, 'packages', 'ielts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'packages', 'ielts', 'package.manifest.json'),
    JSON.stringify({ id: 'ielts', name: 'IELTS', version: '1.0.0', mountPath: '/ielts' }, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(root, 'packages', 'ielts', 'package.support-files.json'),
    JSON.stringify({ packageId: 'ielts', scripts: [], docs: [], tests: [] }, null, 2),
    'utf8'
  );
  fs.writeFileSync(path.join(root, 'packages', 'ielts', 'README.md'), '# IELTS\n', 'utf8');
  fs.writeFileSync(path.join(root, 'data', 'packageRegistry.json'), '[]', 'utf8');
  return root;
}

test('build-ielts-install-zip script fails when signing key is missing', () => {
  const repoRoot = process.cwd();
  const scriptPath = path.join(repoRoot, 'scripts', 'packages', 'build-ielts-install-zip.js');
  const fixtureRoot = createFixtureRoot('ielts-build-zip-missing-key-');

  try {
    const result = runNodeScript(scriptPath, [], {
      cwd: fixtureRoot,
      env: {
        ...process.env,
        PACKAGE_SIGNING_ED25519_PRIVATE_KEY_FILE: '',
        PACKAGE_SIGNING_ED25519_PRIVATE_KEY_BASE64: ''
      }
    });
    assert.notEqual(result.status, 0);
    assert.match(String(result.stderr || ''), /signing private key is not configured/i);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('build-ielts-install-zip script builds signed zip with stable private key env', () => {
  const repoRoot = process.cwd();
  const scriptPath = path.join(repoRoot, 'scripts', 'packages', 'build-ielts-install-zip.js');
  const fixtureRoot = createFixtureRoot('ielts-build-zip-success-');

  try {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    const signingDir = path.join(fixtureRoot, 'install_packages', 'signing');
    fs.mkdirSync(signingDir, { recursive: true });
    const privatePath = path.join(signingDir, 'package-install-ed25519.private.pem');
    fs.writeFileSync(
      privatePath,
      privateKey.export({ type: 'pkcs8', format: 'pem' }),
      'utf8'
    );

    const result = runNodeScript(scriptPath, [], {
      cwd: fixtureRoot,
      env: {
        ...process.env,
        PACKAGE_SIGNING_ED25519_PRIVATE_KEY_FILE: 'install_packages/signing/package-install-ed25519.private.pem'
      }
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(String(result.stdout || '{}'));
    assert.equal(payload.status, 'success');
    assert.equal(payload.packageId, 'ielts');
    assert.match(String(payload.signingKeySource || ''), /file:/i);
    assert.equal(fs.existsSync(payload.artifacts.zip), true);
    assert.equal(fs.existsSync(payload.artifacts.signature), true);
    assert.equal(fs.existsSync(payload.artifacts.publicKeyPem), true);

    const zipBuffer = fs.readFileSync(payload.artifacts.zip);
    const zip = new PizZip(zipBuffer);
    const fileNames = Object.keys(zip.files || {});
    assert.equal(fileNames.some((name) => name === 'ielts/package.manifest.json'), true);
    assert.equal(fileNames.some((name) => name === 'ielts/package.support-files.json'), true);
    assert.equal(fileNames.some((name) => name.startsWith('ielts/data/')), false);
    const topFolders = new Set(fileNames.map((name) => String(name || '').split('/')[0]).filter(Boolean));
    assert.deepEqual([...topFolders], ['ielts']);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
