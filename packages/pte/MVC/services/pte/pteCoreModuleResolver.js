const fs = require('fs');
const path = require('path');

function normalizeFilePath(value = '') {
  return String(value || '').replace(/\\/g, '/').trim();
}

function isPackageOwnedPath(absPath = '') {
  const normalized = normalizeFilePath(absPath).toLowerCase();
  return normalized.includes('/packages/pte/') || normalized.includes('/uploads/packages/pte/');
}

function buildCoreRootCandidates() {
  const unique = new Set();
  const out = [];
  const pushCandidate = (value = '') => {
    const resolved = path.resolve(value);
    const key = normalizeFilePath(resolved).toLowerCase();
    if (!key || unique.has(key)) return;
    unique.add(key);
    out.push(resolved);
  };

  const envRoot = normalizeFilePath(process.env.PACKAGE_CORE_ROOT || '');
  if (envRoot) pushCandidate(envRoot);

  // Repository runtime: <root>/packages/pte/MVC/services/pte
  pushCandidate(path.resolve(__dirname, '../../../../../'));
  // Installed runtime: <root>/uploads/packages/pte/MVC/services/pte
  pushCandidate(path.resolve(__dirname, '../../../../../../'));
  // Final fallback to current process root.
  pushCandidate(process.cwd());

  return out;
}

function fileLooksLoadable(absPath = '') {
  if (!absPath) return false;
  if (fs.existsSync(absPath)) return true;
  if (fs.existsSync(`${absPath}.js`)) return true;
  return fs.existsSync(path.join(absPath, 'index.js'));
}

function requireCoreModule(relativeModulePath = '') {
  const rel = normalizeFilePath(relativeModulePath);
  let lastError = null;
  const tried = [];
  const roots = buildCoreRootCandidates();

  for (const root of roots) {
    const absPath = path.resolve(root, rel);
    tried.push(absPath);
    // Prevent self-resolution loops when env roots point to the package itself.
    if (isPackageOwnedPath(absPath)) continue;
    if (!fileLooksLoadable(absPath)) continue;
    try {
      return require(absPath);
    } catch (error) {
      lastError = error;
    }
  }

  const suffix = lastError ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Unable to resolve core module "${rel}". Tried: ${tried.join(', ')}.${suffix}`);
}

module.exports = {
  requireCoreModule
};
