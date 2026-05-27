#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function cleanText(value, max = 4000) {
  const token = String(value || '').replace(/\0/g, '').trim();
  if (!token) return '';
  return token.length > max ? token.slice(0, max) : token;
}

function parseArgs(argv = []) {
  const out = {
    apply: false,
    coreRoot: '',
    builderRoot: ''
  };
  const tokens = Array.isArray(argv) ? argv : [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = cleanText(tokens[index], 200);
    if (!token) continue;
    if (token === '--apply') {
      out.apply = true;
      continue;
    }
    if (token === '--core-root') {
      out.coreRoot = cleanText(tokens[index + 1], 1600);
      index += 1;
      continue;
    }
    if (token === '--builder-root') {
      out.builderRoot = cleanText(tokens[index + 1], 1600);
      index += 1;
      continue;
    }
  }
  return out;
}

function normalizeRelPath(value = '') {
  return String(value || '').replace(/\\/g, '/');
}

function ensureTrailingNewline(text = '') {
  return String(text || '').endsWith('\n') ? String(text || '') : `${String(text || '')}\n`;
}

function readFileIfExists(filePath = '') {
  try {
    if (!fs.existsSync(filePath)) return { exists: false, text: '' };
    return { exists: true, text: fs.readFileSync(filePath, 'utf8') };
  } catch (_) {
    return { exists: false, text: '' };
  }
}

function upsertEnvValue(originalText = '', key = '', value = '') {
  const cleanKey = cleanText(key, 200);
  if (!cleanKey) throw new Error('Environment key is required.');
  const replacement = `${cleanKey}=${String(value || '')}`;
  const lines = String(originalText || '').split(/\r?\n/);
  const out = [];
  let replaced = false;

  for (const rawLine of lines) {
    const line = String(rawLine || '');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !line.includes('=')) {
      out.push(line);
      continue;
    }
    const eqIndex = line.indexOf('=');
    const currentKey = line.slice(0, eqIndex).trim();
    if (currentKey !== cleanKey) {
      out.push(line);
      continue;
    }
    if (!replaced) {
      out.push(replacement);
      replaced = true;
    }
  }

  if (!replaced) {
    if (out.length && out[out.length - 1].trim() !== '') out.push('');
    out.push(replacement);
  }

  return ensureTrailingNewline(out.join('\n'));
}

function generateSigningKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }),
    publicBase64Spki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  };
}

function derivePublicFromPrivatePem(privatePem = '') {
  const privateKey = crypto.createPrivateKey({ key: String(privatePem || ''), format: 'pem' });
  const publicKey = crypto.createPublicKey(privateKey);
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }),
    publicBase64Spki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  };
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const builderRoot = args.builderRoot
    ? path.resolve(process.cwd(), args.builderRoot)
    : process.cwd();
  const coreRoot = args.coreRoot
    ? path.resolve(process.cwd(), args.coreRoot)
    : path.resolve(builderRoot, '..', 'Website-Core-Only');
  const apply = args.apply === true;

  if (!fs.existsSync(builderRoot)) {
    throw new Error(`Builder root does not exist: ${builderRoot}`);
  }
  if (!fs.existsSync(coreRoot)) {
    throw new Error(`Core installer root does not exist: ${coreRoot}`);
  }

  const signingDir = path.join(builderRoot, 'install_packages', 'signing');
  const privateKeyPath = path.join(signingDir, 'package-install-ed25519.private.pem');
  const publicKeyPath = path.join(signingDir, 'package-install-ed25519.public.pem');
  const publicKeyValuePath = path.join(signingDir, 'package-install-ed25519.public-key.value.txt');

  const builderEnvPath = path.join(builderRoot, '.env');
  const coreEnvPath = path.join(coreRoot, '.env');
  const privateKeyEnvValue = normalizeRelPath(path.relative(builderRoot, privateKeyPath));

  const privateState = readFileIfExists(privateKeyPath);
  const publicState = readFileIfExists(publicKeyPath);

  let keyMaterial;
  let keySource = 'existing';
  if (privateState.exists) {
    keyMaterial = {
      privatePem: privateState.text,
      ...derivePublicFromPrivatePem(privateState.text)
    };
  } else {
    keyMaterial = generateSigningKeyPair();
    keySource = 'generated';
  }

  const builderEnvState = readFileIfExists(builderEnvPath);
  const coreEnvState = readFileIfExists(coreEnvPath);
  const nextBuilderEnv = upsertEnvValue(
    builderEnvState.text,
    'PACKAGE_SIGNING_ED25519_PRIVATE_KEY_FILE',
    privateKeyEnvValue
  );
  const nextCoreEnv = upsertEnvValue(
    coreEnvState.text,
    'PACKAGE_INSTALL_ED25519_PUBLIC_KEYS',
    keyMaterial.publicBase64Spki
  );

  const changes = {
    writePrivateKey: !privateState.exists,
    writePublicKey: !publicState.exists || cleanText(publicState.text, 200000) !== cleanText(keyMaterial.publicPem, 200000),
    writeBuilderEnv: nextBuilderEnv !== ensureTrailingNewline(builderEnvState.text),
    writeCoreEnv: nextCoreEnv !== ensureTrailingNewline(coreEnvState.text)
  };

  if (apply) {
    fs.mkdirSync(signingDir, { recursive: true });
    if (!privateState.exists) {
      fs.writeFileSync(privateKeyPath, keyMaterial.privatePem);
    }
    if (changes.writePublicKey) {
      fs.writeFileSync(publicKeyPath, keyMaterial.publicPem);
    }
    fs.writeFileSync(
      publicKeyValuePath,
      [
        '# Trusted installer key value (SPKI DER base64)',
        keyMaterial.publicBase64Spki,
        ''
      ].join('\n'),
      'utf8'
    );
    if (changes.writeBuilderEnv) fs.writeFileSync(builderEnvPath, nextBuilderEnv, 'utf8');
    if (changes.writeCoreEnv) fs.writeFileSync(coreEnvPath, nextCoreEnv, 'utf8');
  }

  const report = {
    status: 'success',
    mode: apply ? 'apply' : 'dry-run',
    builderRoot,
    coreRoot,
    keySource,
    files: {
      privateKey: privateKeyPath,
      publicKey: publicKeyPath,
      publicKeyValue: publicKeyValuePath
    },
    envTargets: {
      builder: {
        path: builderEnvPath,
        key: 'PACKAGE_SIGNING_ED25519_PRIVATE_KEY_FILE',
        value: privateKeyEnvValue
      },
      coreInstaller: {
        path: coreEnvPath,
        key: 'PACKAGE_INSTALL_ED25519_PUBLIC_KEYS',
        valuePreview: `${keyMaterial.publicBase64Spki.slice(0, 24)}...`
      }
    },
    plannedChanges: changes,
    nextSteps: [
      'Restart both apps after .env changes.',
      'Build zip with: npm run pte:build:install-zip',
      'Upload .zip and .sig in Package Manager ZIP install.'
    ]
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

try {
  run();
} catch (error) {
  process.stderr.write(`${error.message || String(error)}\n`);
  process.exit(1);
}
