const fs = require('fs');
const path = require('path');

function normalizeFilePath(value = '') {
  return String(value || '').replace(/\\/g, '/').trim();
}

function isPackageOwnedPath(absPath = '') {
  const normalized = normalizeFilePath(absPath).toLowerCase();
  return normalized.includes('/packages/credit/') || normalized.includes('/uploads/packages/credit/');
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

  pushCandidate(path.resolve(__dirname, '../../../../../'));
  pushCandidate(path.resolve(__dirname, '../../../../../../'));
  pushCandidate(process.cwd());

  return out;
}

function fileLooksLoadable(absPath = '') {
  if (!absPath) return false;
  if (fs.existsSync(absPath)) return true;
  if (fs.existsSync(`${absPath}.js`)) return true;
  return fs.existsSync(path.join(absPath, 'index.js'));
}

function resolveCoreRoot() {
  const roots = buildCoreRootCandidates();
  for (const root of roots) {
    if (isPackageOwnedPath(root)) continue;
    const constantsPath = path.resolve(root, 'config/constants.js');
    if (fs.existsSync(constantsPath)) {
      return root;
    }
  }
  return path.resolve(process.cwd());
}

function requireCoreModule(relativeModulePath = '') {
  const rel = normalizeFilePath(relativeModulePath);
  let lastError = null;
  const tried = [];
  const roots = buildCoreRootCandidates();

  for (const root of roots) {
    const absPath = path.resolve(root, rel);
    tried.push(absPath);
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
  resolveCoreRoot,
  requireCoreModule
};

