#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PizZip = require('pizzip');

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function readJsonFile(filePath = '') {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function loadLocalEnvFile(projectRoot = process.cwd()) {
  try {
    const envPath = path.join(projectRoot, '.env');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = String(line || '').trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
      let value = trimmed.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (error) {
    process.stderr.write(`[env] Unable to load .env file: ${error.message}\n`);
  }
}

function parseSemver(version = '') {
  const token = cleanText(version, 120);
  const [coreAndPre] = token.split('+');
  const [core, prereleaseRaw = ''] = String(coreAndPre || '').split('-');
  const coreParts = core.split('.').map((item) => Number.parseInt(item, 10));
  const prerelease = prereleaseRaw ? prereleaseRaw.split('.') : [];
  return { coreParts, prerelease };
}

function compareSemver(a = '', b = '') {
  const left = parseSemver(a);
  const right = parseSemver(b);
  for (let index = 0; index < 3; index += 1) {
    const l = Number.isFinite(left.coreParts[index]) ? left.coreParts[index] : 0;
    const r = Number.isFinite(right.coreParts[index]) ? right.coreParts[index] : 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }

  if (!left.prerelease.length && !right.prerelease.length) return 0;
  if (!left.prerelease.length) return 1;
  if (!right.prerelease.length) return -1;

  const max = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < max; index += 1) {
    const l = left.prerelease[index];
    const r = right.prerelease[index];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const lNumeric = /^\d+$/.test(l);
    const rNumeric = /^\d+$/.test(r);
    if (lNumeric && rNumeric) {
      const lNum = Number.parseInt(l, 10);
      const rNum = Number.parseInt(r, 10);
      if (lNum > rNum) return 1;
      if (lNum < rNum) return -1;
      continue;
    }
    if (lNumeric && !rNumeric) return -1;
    if (!lNumeric && rNumeric) return 1;
    if (l > r) return 1;
    if (l < r) return -1;
  }

  return 0;
}

function walkFiles(rootDir = '') {
  const out = [];
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        out.push(fullPath);
      }
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function formatTimestamp(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}-${hh}${mm}${ss}`;
}

function getInstalledVersion(registryRows = [], packageId = '') {
  if (!packageId) return '';
  const rows = Array.isArray(registryRows) ? registryRows : [];
  const found = rows.find((row) => cleanText(row?.packageId || row?.id, 120).toLowerCase() === String(packageId).toLowerCase());
  return cleanText(found?.version, 120);
}

function loadRegistryRows(registryPath = '') {
  if (!fs.existsSync(registryPath)) return [];
  try {
    const rows = readJsonFile(registryPath);
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

function parseArgs(argv = []) {
  const out = {
    packageId: '',
    packageRoot: '',
    manifestPath: '',
    targetRoot: '',
    outputDir: '',
    force: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || '').trim();
    if (!token) continue;
    if (token === '--help' || token === '-h') {
      out.help = true;
    } else if (token === '--package-id') {
      out.packageId = cleanText(argv[index + 1], 160);
      index += 1;
    } else if (token === '--package-root') {
      out.packageRoot = cleanText(argv[index + 1], 512);
      index += 1;
    } else if (token === '--manifest') {
      out.manifestPath = cleanText(argv[index + 1], 512);
      index += 1;
    } else if (token === '--target-root') {
      out.targetRoot = cleanText(argv[index + 1], 512);
      index += 1;
    } else if (token === '--output-dir') {
      out.outputDir = cleanText(argv[index + 1], 512);
      index += 1;
    } else if (token === '--force') {
      out.force = true;
    }
  }
  return out;
}

function createPrivateKeyFromContent(rawContent = '', sourceLabel = 'key material') {
  const token = String(rawContent || '').trim();
  if (!token) throw new Error(`Package signing private key is empty in ${sourceLabel}.`);
  if (token.includes('BEGIN PRIVATE KEY')) {
    return crypto.createPrivateKey({ key: token, format: 'pem' });
  }
  const compact = token.replace(/\s+/g, '');
  const decoded = Buffer.from(compact, 'base64');
  if (!decoded.length) throw new Error(`Package signing private key is invalid in ${sourceLabel}.`);
  return crypto.createPrivateKey({ key: decoded, format: 'der', type: 'pkcs8' });
}

function resolveSigningPrivateKey(projectRoot = process.cwd()) {
  const privateKeyFileToken = cleanText(process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_FILE, 1600);
  const privateKeyBase64Token = cleanText(process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_BASE64, 100000);
  if (privateKeyFileToken) {
    const privateKeyPath = path.isAbsolute(privateKeyFileToken)
      ? privateKeyFileToken
      : path.resolve(projectRoot, privateKeyFileToken);
    if (!fs.existsSync(privateKeyPath)) {
      throw new Error(
        `Package signing private key was not found at "${privateKeyPath}". ` +
          'Run "npm run pte:signing:bootstrap -- --apply" first.'
      );
    }
    const raw = fs.readFileSync(privateKeyPath, 'utf8');
    return {
      privateKey: createPrivateKeyFromContent(raw, privateKeyPath),
      source: `file:${privateKeyPath}`
    };
  }

  if (privateKeyBase64Token) {
    return {
      privateKey: createPrivateKeyFromContent(privateKeyBase64Token, 'PACKAGE_SIGNING_ED25519_PRIVATE_KEY_BASE64'),
      source: 'env:PACKAGE_SIGNING_ED25519_PRIVATE_KEY_BASE64'
    };
  }

  throw new Error(
    'Package signing private key is not configured. ' +
      'Set PACKAGE_SIGNING_ED25519_PRIVATE_KEY_FILE (recommended) or PACKAGE_SIGNING_ED25519_PRIVATE_KEY_BASE64, ' +
      'or run "npm run pte:signing:bootstrap -- --apply".'
  );
}

function printUsage() {
  console.log('Usage: node scripts/packages/build-package-install-zip.js [--package-id=<id>] [--package-root=<dir>] [--target-root=<dir>] [--force] [--manifest=<path>] [--output-dir=<path>]');
  console.log('Examples:');
  console.log('  node scripts/packages/build-package-install-zip.js --package-id=pte');
  console.log('  node scripts/packages/build-package-install-zip.js --package-id=school');
  console.log('  node scripts/packages/build-package-install-zip.js --package-root=packages/school --target-root=../website-core-only');
}

function resolvePackageOptions(projectRoot, options = {}) {
  const providedManifest = options.manifestPath ? path.resolve(projectRoot, options.manifestPath) : '';
  const preferredId = cleanText(options.packageId, 120);

  let packageRoot = providedManifest ? path.dirname(providedManifest) : '';
  let manifestPath = providedManifest;

  if (!manifestPath) {
    const rootCandidate = cleanText(options.packageRoot, 512);
    const manifestCandidate = cleanText(rootCandidate, 512)
      ? path.join(rootCandidate, 'package.manifest.json')
      : (preferredId ? path.join(projectRoot, 'packages', preferredId, 'package.manifest.json') : '');
    packageRoot = rootCandidate ? path.resolve(projectRoot, rootCandidate) : (preferredId ? path.resolve(projectRoot, 'packages', preferredId) : '');
    manifestPath = manifestCandidate ? path.resolve(projectRoot, manifestCandidate) : '';
  }

  if (!manifestPath) {
    throw new Error('No package manifest could be resolved. Set --package-id or --package-root or --manifest.');
  }

  if (!packageRoot) {
    packageRoot = path.dirname(manifestPath);
  }

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Package manifest not found: ${manifestPath}`);
  }

  return { packageRoot, manifestPath };
}

function resolveOutputDir(projectRoot, options = {}) {
  const outputDir = cleanText(options.outputDir, 512)
    ? path.resolve(projectRoot, options.outputDir)
    : path.join(projectRoot, 'install_packages');
  fs.mkdirSync(outputDir, { recursive: true });
  return outputDir;
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const projectRoot = process.cwd();
  loadLocalEnvFile(projectRoot);

  const { packageRoot, manifestPath } = resolvePackageOptions(projectRoot, options);
  const manifest = readJsonFile(manifestPath);
  const declaredPackageId = cleanText(manifest?.id, 120);
  if (!declaredPackageId) throw new Error('Package manifest id is required.');
  if (options.packageId && cleanText(options.packageId, 120).toLowerCase() !== declaredPackageId.toLowerCase()) {
    throw new Error(`Manifest id "${declaredPackageId}" does not match requested package id "${options.packageId}".`);
  }

  const packageId = declaredPackageId;
  const packageVersion = cleanText(manifest?.version, 120);
  if (!packageVersion) {
    throw new Error('Package manifest version is required.');
  }

  const targetRoot = options.targetRoot ? path.resolve(projectRoot, options.targetRoot) : projectRoot;
  const registryPath = path.join(targetRoot, 'data', 'packageRegistry.json');
  const installedVersion = getInstalledVersion(loadRegistryRows(registryPath), packageId);
  if (!options.force && installedVersion && compareSemver(installedVersion, packageVersion) >= 0) {
    throw new Error(
      `Version gate check failed: installed package "${packageId}" version "${installedVersion}" is same/newer than manifest version "${packageVersion}". ` +
        'Uninstall existing package first, or bump package.manifest.json version and rebuild.'
    );
  }

  const filePaths = walkFiles(packageRoot);
  if (!filePaths.length) {
    throw new Error(`No files found under ${packageRoot}`);
  }

  const zip = new PizZip();
  for (const fullPath of filePaths) {
    const rel = path.relative(packageRoot, fullPath).replace(/\\/g, '/');
    const zipPath = `${packageId}/${rel}`;
    const payload = fs.readFileSync(fullPath);
    zip.file(zipPath, payload);
  }

  const manifestZipPath = `${packageId}/package.manifest.json`;
  if (!zip.files[manifestZipPath]) {
    throw new Error(`ZIP layout invalid: missing ${manifestZipPath}`);
  }

  const signing = resolveSigningPrivateKey(projectRoot);
  const publicKey = crypto.createPublicKey(signing.privateKey);
  const zipBuffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  const signatureBuffer = crypto.sign(null, zipBuffer, signing.privateKey);

  const outputDir = resolveOutputDir(projectRoot, options);
  const stamp = formatTimestamp();
  const baseName = `${packageId}-${packageVersion}-${stamp}`;
  const zipPath = path.join(outputDir, `${baseName}.zip`);
  const sigPath = path.join(outputDir, `${baseName}.sig`);
  const publicPemPath = path.join(outputDir, `${baseName}.public.pem`);

  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  fs.writeFileSync(zipPath, zipBuffer);
  fs.writeFileSync(sigPath, signatureBuffer);
  fs.writeFileSync(publicPemPath, publicPem);

  const report = {
    status: 'success',
    packageId,
    packageVersion,
    fileCount: filePaths.length,
    zipBytes: zipBuffer.length,
    versionGate: {
      targetRoot,
      registryPath,
      installedVersion: installedVersion || '',
      result: 'pass'
    },
    artifacts: {
      zip: zipPath,
      signature: sigPath,
      publicKeyPem: publicPemPath
    },
    signingKeySource: signing.source,
    installHint: {
      step1: 'Ensure installer .env has PACKAGE_INSTALL_ED25519_PUBLIC_KEYS configured with the trusted key.',
      step2: 'In Package Manager choose ZIP Upload (Signature Verified).',
      step3: 'Upload .zip and matching .sig, then complete admin verification.'
    }
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

try {
  run();
} catch (error) {
  process.stderr.write(`${error.message || String(error)}\n`);
  process.exit(1);
}
