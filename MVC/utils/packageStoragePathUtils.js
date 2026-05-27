const fs = require('fs');
const path = require('path');

const DEFAULT_PACKAGE_ROOT = path.resolve(process.cwd(), 'packages');
let lastWarnedInvalidRoot = '';

function cleanString(value) {
  return String(value || '').trim();
}

function normalizeAbsolutePath(inputPath = '') {
  const token = cleanString(inputPath);
  if (!token) return '';
  return path.resolve(token);
}

function resolveConfiguredRoot(value = '') {
  const token = cleanString(value);
  if (!token) return '';
  if (path.isAbsolute(token)) return normalizeAbsolutePath(token);
  return normalizeAbsolutePath(path.resolve(process.cwd(), token));
}

function canUseDirectory(rootPath = '', { ensureExists = false } = {}) {
  const resolved = normalizeAbsolutePath(rootPath);
  if (!resolved) return false;
  try {
    const stat = fs.statSync(resolved);
    return stat.isDirectory();
  } catch (_) {
    if (!ensureExists) return false;
  }

  if (!ensureExists) return false;
  try {
    fs.mkdirSync(resolved, { recursive: true });
    return true;
  } catch (_) {
    return false;
  }
}

function isExistingDirectory(rootPath = '') {
  const resolved = normalizeAbsolutePath(rootPath);
  if (!resolved) return false;
  try {
    return fs.statSync(resolved).isDirectory();
  } catch (_) {
    return false;
  }
}

function warnInvalidRoot(configured, fallback) {
  const key = `${configured}=>${fallback}`;
  if (!configured || lastWarnedInvalidRoot === key) return;
  lastWarnedInvalidRoot = key;
  console.warn(`[PackageStorage] Configured PACKAGE_STORAGE_ROOT is invalid: "${configured}". Falling back to "${fallback}".`);
}

function getPackageStorageRootAbsolute(options = {}) {
  const explicitRoot = cleanString(options?.packageRootDir);
  if (explicitRoot) return normalizeAbsolutePath(explicitRoot);

  const configuredRoot = resolveConfiguredRoot(process.env.PACKAGE_STORAGE_ROOT || '');
  if (!configuredRoot) return DEFAULT_PACKAGE_ROOT;

  const ensureExists = options?.ensureExists === true;
  if (!ensureExists) {
    return configuredRoot;
  }
  if (canUseDirectory(configuredRoot, { ensureExists })) return configuredRoot;

  if (!isExistingDirectory(configuredRoot)) {
    warnInvalidRoot(configuredRoot, DEFAULT_PACKAGE_ROOT);
  }
  return DEFAULT_PACKAGE_ROOT;
}

module.exports = {
  DEFAULT_PACKAGE_ROOT,
  getPackageStorageRootAbsolute
};
