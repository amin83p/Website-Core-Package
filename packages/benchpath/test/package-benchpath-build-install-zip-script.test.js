const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const PizZip = require('pizzip');

const buildPackageInstallZip = require('../../../scripts/packages/build-package-install-zip');

function createFixtureRoot(prefix = 'benchpath-build-zip-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, 'packages', 'benchpath'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'packages', 'benchpath', 'package.manifest.json'),
    JSON.stringify({ id: 'benchpath', name: 'BenchPath', version: '1.0.0', mountPath: '/benchpath' }, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(root, 'packages', 'benchpath', 'package.support-files.json'),
    JSON.stringify({ packageId: 'benchpath', scripts: [], docs: [], tests: [] }, null, 2),
    'utf8'
  );
  fs.writeFileSync(path.join(root, 'packages', 'benchpath', 'README.md'), '# BenchPath\n', 'utf8');
  fs.writeFileSync(path.join(root, 'data', 'packageRegistry.json'), '[]', 'utf8');
  return root;
}

test('build-package-install-zip script fails for BenchPath when signing key is missing', () => {
  const fixtureRoot = createFixtureRoot('benchpath-build-zip-missing-key-');
  const originalKeyFile = process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_FILE;
  const originalKeyBase64 = process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_BASE64;

  try {
    process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_FILE = '';
    process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_BASE64 = '';
    assert.throws(
      () => buildPackageInstallZip.run({
        argv: ['--package-id', 'benchpath'],
        projectRoot: fixtureRoot,
        stdout: { write() {} }
      }),
      /signing private key is not configured/i
    );
  } finally {
    if (originalKeyFile === undefined) delete process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_FILE;
    else process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_FILE = originalKeyFile;
    if (originalKeyBase64 === undefined) delete process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_BASE64;
    else process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_BASE64 = originalKeyBase64;
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('build-package-install-zip script builds signed BenchPath zip with stable private key env', () => {
  const fixtureRoot = createFixtureRoot('benchpath-build-zip-success-');
  const originalKeyFile = process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_FILE;
  const originalKeyBase64 = process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_BASE64;

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

    process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_FILE = 'install_packages/signing/package-install-ed25519.private.pem';
    delete process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_BASE64;
    let stdout = '';
    const payload = buildPackageInstallZip.run({
      argv: ['--package-id', 'benchpath'],
      projectRoot: fixtureRoot,
      stdout: {
        write(chunk) {
          stdout += String(chunk || '');
        }
      }
    });
    assert.deepEqual(JSON.parse(stdout), payload);
    assert.equal(payload.status, 'success');
    assert.equal(payload.packageId, 'benchpath');
    assert.match(String(payload.signingKeySource || ''), /file:/i);
    assert.equal(fs.existsSync(payload.artifacts.zip), true);
    assert.equal(fs.existsSync(payload.artifacts.signature), true);
    assert.equal(fs.existsSync(payload.artifacts.publicKeyPem), true);

    const zipBuffer = fs.readFileSync(payload.artifacts.zip);
    const zip = new PizZip(zipBuffer);
    const fileNames = Object.keys(zip.files || {});
    assert.equal(fileNames.some((name) => name === 'benchpath/package.manifest.json'), true);
    assert.equal(fileNames.some((name) => name === 'benchpath/package.support-files.json'), true);
    assert.equal(fileNames.some((name) => name.startsWith('benchpath/data/')), false);
    const topFolders = new Set(fileNames.map((name) => String(name || '').split('/')[0]).filter(Boolean));
    assert.deepEqual([...topFolders], ['benchpath']);
  } finally {
    if (originalKeyFile === undefined) delete process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_FILE;
    else process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_FILE = originalKeyFile;
    if (originalKeyBase64 === undefined) delete process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_BASE64;
    else process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_BASE64 = originalKeyBase64;
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
