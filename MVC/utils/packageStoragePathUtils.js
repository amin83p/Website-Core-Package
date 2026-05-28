const fs = require('fs');
const path = require('path');

const DEFAULT_PACKAGE_ROOT = path.resolve(process.cwd(), 'packages');
const RAILWAY_PACKAGE_ROOT = '/app/uploads/packages';
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

function isWindowsStylePathToken(value = '') {
  const token = cleanString(value);
  if (!token) return false;
  return /^[A-Za-z]:[\\/]/.test(token) || /^\\\\/.test(token);
}

function isPosixAbsoluteToken(value = '') {
  const token = cleanString(value);
  if (!token) return false;
  return token.startsWith('/');
}

function validateRootToken(token = '', platform = process.platform) {
  const raw = cleanString(token);
  if (!raw) return { valid: true, reason: '' };

  if (platform === 'win32' && isPosixAbsoluteToken(raw) && !isWindowsStylePathToken(raw)) {
    return { valid: false, reason: 'posix_path_on_windows' };
  }
  if (platform !== 'win32' && isWindowsStylePathToken(raw)) {
    return { valid: false, reason: 'windows_path_on_non_windows' };
  }
  return { valid: true, reason: '' };
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

function buildCandidate(source = '', token = '', rootPath = '') {
  return {
    source: cleanString(source),
    token: cleanString(token),
    rootPath: normalizeAbsolutePath(rootPath)
  };
}

function getPackageStorageRootResolution(options = {}) {
  const ensureExists = options?.ensureExists === true;
  const explicitToken = cleanString(options?.packageRootDir);
  const envToken = cleanString(process.env.PACKAGE_STORAGE_ROOT || '');
  const platformOverride = cleanString(options?.platform);
  const platform = platformOverride || process.platform;
  const warnings = [];

  const candidates = [];
  if (explicitToken) {
    candidates.push(buildCandidate('explicit', explicitToken, resolveConfiguredRoot(explicitToken)));
  }
  if (envToken) {
    candidates.push(buildCandidate('env', envToken, resolveConfiguredRoot(envToken)));
  }

  // Prefer Railway persistent default on Linux if explicit/env are invalid or unusable.
  if (platform !== 'win32') {
    candidates.push(buildCandidate('railway-default', RAILWAY_PACKAGE_ROOT, resolveConfiguredRoot(RAILWAY_PACKAGE_ROOT)));
  }
  candidates.push(buildCandidate('default', DEFAULT_PACKAGE_ROOT, DEFAULT_PACKAGE_ROOT));

  for (const candidate of candidates) {
    const validity = validateRootToken(candidate.token || candidate.rootPath, platform);
    if (!validity.valid) {
      warnings.push(`Ignored ${candidate.source} package root "${candidate.token}" (${validity.reason}).`);
      continue;
    }

    const rootPath = candidate.rootPath;
    if (!rootPath) continue;

    if (!ensureExists) {
      return {
        effectiveRoot: rootPath,
        source: candidate.source,
        warnings,
        configuredToken: envToken,
        explicitToken,
        ensureExists
      };
    }

    if (canUseDirectory(rootPath, { ensureExists: true })) {
      return {
        effectiveRoot: rootPath,
        source: candidate.source,
        warnings,
        configuredToken: envToken,
        explicitToken,
        ensureExists
      };
    }

    warnings.push(`Package root "${candidate.token || rootPath}" is not writable/available.`);
  }

  const fallbackRoot = DEFAULT_PACKAGE_ROOT;
  if (!isExistingDirectory(fallbackRoot)) {
    warnInvalidRoot(envToken || explicitToken, fallbackRoot);
  }
  return {
    effectiveRoot: fallbackRoot,
    source: 'default',
    warnings,
    configuredToken: envToken,
    explicitToken,
    ensureExists
  };
}

function getPackageStorageRootAbsolute(options = {}) {
  const resolution = getPackageStorageRootResolution(options);
  return resolution.effectiveRoot;
}

module.exports = {
  DEFAULT_PACKAGE_ROOT,
  RAILWAY_PACKAGE_ROOT,
  getPackageStorageRootAbsolute,
  getPackageStorageRootResolution,
  validateRootToken
};
