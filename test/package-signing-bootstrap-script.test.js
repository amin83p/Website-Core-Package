const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

function runNodeScript(scriptPath, args = [], options = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    ...options
  });
}

test('package signing bootstrap script dry-run reports changes without mutating files', () => {
  const repoRoot = process.cwd();
  const scriptPath = path.join(repoRoot, 'scripts', 'packages', 'bootstrap-package-signing-keys.js');
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-sign-bootstrap-dry-'));
  const builderRoot = path.join(sandboxRoot, 'builder');
  const coreRoot = path.join(sandboxRoot, 'core-only');
  fs.mkdirSync(builderRoot, { recursive: true });
  fs.mkdirSync(coreRoot, { recursive: true });
  fs.writeFileSync(path.join(builderRoot, '.env'), 'MAIN_SECRET_KEY=abc\n', 'utf8');
  fs.writeFileSync(path.join(coreRoot, '.env'), 'MAIN_SECRET_KEY=xyz\n', 'utf8');

  try {
    const result = runNodeScript(scriptPath, [
      '--builder-root', builderRoot,
      '--core-root', coreRoot
    ], { cwd: repoRoot });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(String(result.stdout || '{}'));
    assert.equal(payload.mode, 'dry-run');
    assert.equal(payload.plannedChanges?.writePrivateKey, true);
    assert.equal(payload.plannedChanges?.writeBuilderEnv, true);
    assert.equal(payload.plannedChanges?.writeCoreEnv, true);
    assert.equal(fs.existsSync(path.join(builderRoot, 'install_packages', 'signing', 'package-install-ed25519.private.pem')), false);
  } finally {
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
});

test('package signing bootstrap script apply mode writes keys and env values idempotently', () => {
  const repoRoot = process.cwd();
  const scriptPath = path.join(repoRoot, 'scripts', 'packages', 'bootstrap-package-signing-keys.js');
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-sign-bootstrap-apply-'));
  const builderRoot = path.join(sandboxRoot, 'builder');
  const coreRoot = path.join(sandboxRoot, 'core-only');
  fs.mkdirSync(builderRoot, { recursive: true });
  fs.mkdirSync(coreRoot, { recursive: true });
  fs.writeFileSync(path.join(builderRoot, '.env'), '', 'utf8');
  fs.writeFileSync(path.join(coreRoot, '.env'), '', 'utf8');

  try {
    const first = runNodeScript(scriptPath, [
      '--apply',
      '--builder-root', builderRoot,
      '--core-root', coreRoot
    ], { cwd: repoRoot });
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const firstPayload = JSON.parse(String(first.stdout || '{}'));
    assert.equal(firstPayload.mode, 'apply');

    const privateKeyPath = path.join(builderRoot, 'install_packages', 'signing', 'package-install-ed25519.private.pem');
    const publicKeyPath = path.join(builderRoot, 'install_packages', 'signing', 'package-install-ed25519.public.pem');
    assert.equal(fs.existsSync(privateKeyPath), true);
    assert.equal(fs.existsSync(publicKeyPath), true);

    const builderEnv = fs.readFileSync(path.join(builderRoot, '.env'), 'utf8');
    const coreEnv = fs.readFileSync(path.join(coreRoot, '.env'), 'utf8');
    assert.match(builderEnv, /PACKAGE_SIGNING_ED25519_PRIVATE_KEY_FILE=install_packages\/signing\/package-install-ed25519\.private\.pem/);
    assert.match(coreEnv, /PACKAGE_INSTALL_ED25519_PUBLIC_KEYS=/);

    const second = runNodeScript(scriptPath, [
      '--apply',
      '--builder-root', builderRoot,
      '--core-root', coreRoot
    ], { cwd: repoRoot });
    assert.equal(second.status, 0, second.stderr || second.stdout);
    const secondPayload = JSON.parse(String(second.stdout || '{}'));
    assert.equal(secondPayload.plannedChanges?.writePrivateKey, false);
    assert.equal(secondPayload.plannedChanges?.writeBuilderEnv, false);
    assert.equal(secondPayload.plannedChanges?.writeCoreEnv, false);
  } finally {
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
});
