const path = require('path');

function cleanText(value, max = 2000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizePackageId(value = '') {
  return cleanText(value, 80).toLowerCase();
}

function resolveProjectRoot() {
  return path.resolve(__dirname, '../../');
}

function hasParentTraversal(value = '') {
  return cleanText(value, 1600)
    .replace(/\\/g, '/')
    .split('/')
    .some((segment) => segment === '..');
}

function isInsideRoot(resolvedPath = '', rootPath = '') {
  if (!resolvedPath || !rootPath) return false;
  const rel = path.relative(path.resolve(rootPath), path.resolve(resolvedPath));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isInsideAllowedRoot(resolvedPath = '', allowedRoots = []) {
  return allowedRoots.some((rootPath) => isInsideRoot(resolvedPath, rootPath));
}

function assertInsideAllowedRoot(resolvedPath = '', originalPath = '', allowedRoots = []) {
  if (!isInsideAllowedRoot(resolvedPath, allowedRoots)) {
    throw new Error(`Package module path must stay inside project root or package root: ${originalPath}`);
  }
}

function uniquePaths(values = []) {
  const seen = new Set();
  const out = [];
  values.forEach((value) => {
    const token = cleanText(value, 2000);
    if (!token) return;
    const resolved = path.resolve(token);
    const key = resolved.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(resolved);
  });
  return out;
}

function resolvePackageRootCandidates(context = {}, options = {}) {
  const projectRoot = resolveProjectRoot();
  const packageId = normalizePackageId(context?.packageId || context?.manifest?.id || options?.packageId || '');
  const packageRootDir = cleanText(context?.packageRootDir || options?.packageRootDir || '', 1600);
  const manifestPath = cleanText(context?.manifestPath || options?.manifestPath || '', 1600);
  const candidates = [];

  if (manifestPath) {
    const resolvedManifestPath = path.isAbsolute(manifestPath)
      ? path.resolve(manifestPath)
      : path.resolve(projectRoot, manifestPath);
    candidates.push(path.dirname(resolvedManifestPath));
  }

  if (packageRootDir && packageId) {
    const resolvedPackageRootDir = path.isAbsolute(packageRootDir)
      ? path.resolve(packageRootDir)
      : path.resolve(projectRoot, packageRootDir);
    candidates.push(path.join(resolvedPackageRootDir, packageId));
  }

  if (packageId) {
    candidates.push(path.join(projectRoot, 'packages', packageId));
  }

  return uniquePaths(candidates);
}

function tryResolveModule(candidatePath = '', originalPath = '', allowedRoots = []) {
  assertInsideAllowedRoot(candidatePath, originalPath, allowedRoots);
  try {
    // require.resolve handles .js extension and index.js folder resolution consistently with Node.
    // eslint-disable-next-line global-require
    const resolvedModule = require.resolve(candidatePath);
    assertInsideAllowedRoot(resolvedModule, originalPath, allowedRoots);
    return resolvedModule;
  } catch (_) {
    return '';
  }
}

function resolvePackageModulePath(modulePath = '', context = {}, options = {}) {
  const token = cleanText(modulePath, 1600);
  if (!token) return '';
  if (hasParentTraversal(token)) {
    throw new Error(`Package module path must not include parent traversal: ${token}`);
  }

  const projectRoot = resolveProjectRoot();
  const packageRootCandidates = resolvePackageRootCandidates(context, options);
  const allowedRoots = uniquePaths([projectRoot, ...packageRootCandidates]);
  const candidates = [];
  if (path.isAbsolute(token)) {
    candidates.push(path.resolve(token));
  } else {
    packageRootCandidates.forEach((packageRoot) => {
      candidates.push(path.resolve(packageRoot, token));
    });
    candidates.push(path.resolve(projectRoot, token));
  }

  const uniqueCandidates = uniquePaths(candidates);
  for (const candidate of uniqueCandidates) {
    const resolved = tryResolveModule(candidate, token, allowedRoots);
    if (resolved) return resolved;
  }

  throw new Error(`Package module path could not be resolved inside project root: ${token}`);
}

module.exports = {
  resolveProjectRoot,
  resolvePackageRootCandidates,
  resolvePackageModulePath
};
