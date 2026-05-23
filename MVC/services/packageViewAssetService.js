const fs = require('fs');
const path = require('path');
const express = require('express');

const startupLogger = require('../utils/startupLogger');

let mountedAssetKeys = new Set();

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

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function unique(values = []) {
  const seen = new Set();
  const out = [];
  values.forEach((value) => {
    const token = cleanText(value, 2000);
    const key = token.toLowerCase();
    if (!token || seen.has(key)) return;
    seen.add(key);
    out.push(token);
  });
  return out;
}

function resolveInsideProject(inputPath = '', label = 'path') {
  const token = cleanText(inputPath, 1600);
  if (!token) throw new Error(`${label} is required.`);
  const projectRoot = resolveProjectRoot();
  const resolved = path.isAbsolute(token)
    ? path.resolve(token)
    : path.resolve(projectRoot, token);
  const rel = path.relative(projectRoot, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`${label} must stay inside project root: ${token}`);
  }
  return resolved;
}

function pathExists(directoryPath = '') {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch (_) {
    return false;
  }
}

function normalizeMountPath(value = '', fallback = '') {
  const token = cleanText(value || fallback, 600).replace(/\\/g, '/');
  if (!token) return '';
  if (!token.startsWith('/')) throw new Error('publicPath must start with "/".');
  if (/\s/.test(token)) throw new Error('publicPath must not include whitespace.');
  return token.length > 1 ? token.replace(/\/+$/, '') : token;
}

function createSummary(packageId = '', category = '') {
  return {
    packageId: normalizePackageId(packageId),
    category: cleanText(category, 80),
    requested: 0,
    prepared: 0,
    registered: 0,
    mounted: 0,
    skipped: 0,
    failed: 0,
    results: []
  };
}

function addResult(summary, row = {}) {
  summary.results.push({
    id: cleanText(row.id, 180),
    path: cleanText(row.path, 1600),
    root: cleanText(row.root, 1600),
    publicPath: cleanText(row.publicPath, 600),
    metadataOnly: row.metadataOnly === true,
    status: cleanText(row.status, 60).toLowerCase(),
    message: cleanText(row.message, 2000)
  });
}

function normalizeDeclarationList(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.entries)) return value.entries;
  return Object.keys(value).length ? [value] : [];
}

function normalizeViewDeclaration(row = {}, index = 0) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`views declaration ${index + 1} must be an object.`);
  }

  const paths = unique([
    ...toArray(row.roots),
    ...toArray(row.root),
    ...toArray(row.rootPath),
    ...toArray(row.viewRoot),
    ...toArray(row.path),
    ...toArray(row.paths)
  ]);
  if (!paths.length) throw new Error('views declaration requires path or root.');

  return {
    id: cleanText(row.id || row.name, 180) || `views-${index + 1}`,
    paths,
    metadataOnly: row.metadataOnly === true,
    active: row.active !== false
  };
}

function normalizeAssetDeclaration(row = {}, packageId = '', index = 0) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`assets declaration ${index + 1} must be an object.`);
  }

  let assetPath = cleanText(
    row.path
    || row.root
    || row.rootPath
    || row.assetRoot
    || row.directory
    || '',
    1600
  );
  let publicPath = cleanText(
    row.publicMountPath
    || row.mountPath
    || row.urlPath
    || '',
    600
  );
  const publicPathValue = cleanText(row.publicPath || '', 1600);
  if (!assetPath && publicPathValue && !publicPathValue.startsWith('/')) {
    assetPath = publicPathValue;
  } else if (!publicPath && publicPathValue && publicPathValue.startsWith('/')) {
    publicPath = publicPathValue;
  }

  if (!assetPath) throw new Error('assets declaration requires path.');

  return {
    id: cleanText(row.id || row.name, 180) || `assets-${index + 1}`,
    path: assetPath,
    publicPath: normalizeMountPath(publicPath, `/package-assets/${normalizePackageId(packageId)}`),
    metadataOnly: row.metadataOnly === true,
    active: row.active !== false
  };
}

function getCurrentViewRoots(app) {
  if (!app || typeof app.get !== 'function') return [];
  return unique(toArray(app.get('views')));
}

function setViewRoots(app, roots = []) {
  if (!app || typeof app.set !== 'function') return;
  app.set('views', roots.length === 1 ? roots[0] : roots);
}

async function registerManifestViews(context = {}, options = {}) {
  const packageId = normalizePackageId(context?.packageId || context?.manifest?.id || '');
  const summary = createSummary(packageId, 'views');
  const logger = options?.logger || startupLogger;
  const app = context?.app || options?.app || null;
  const declarations = normalizeDeclarationList(context?.manifest?.views);

  if (!packageId || !declarations.length) return summary;

  for (let index = 0; index < declarations.length; index += 1) {
    summary.requested += 1;
    let declaration;
    try {
      declaration = normalizeViewDeclaration(declarations[index], index);
    } catch (error) {
      summary.failed += 1;
      addResult(summary, { status: 'failed', message: error?.message || String(error) });
      continue;
    }

    if (!declaration.active) {
      summary.skipped += 1;
      addResult(summary, { ...declaration, status: 'skipped', message: 'View declaration is inactive.' });
      continue;
    }

    let roots;
    try {
      roots = declaration.paths.map((candidate) => resolveInsideProject(candidate, 'views path'));
      const missing = roots.find((candidate) => !pathExists(candidate));
      if (missing) throw new Error(`View path does not exist: ${path.relative(resolveProjectRoot(), missing)}`);
    } catch (error) {
      summary.failed += 1;
      addResult(summary, { ...declaration, path: declaration.paths.join(','), status: 'failed', message: error?.message || String(error) });
      continue;
    }

    summary.prepared += 1;
    if (declaration.metadataOnly) {
      addResult(summary, { ...declaration, path: roots.join(','), status: 'prepared', message: 'View metadata prepared (metadataOnly=true).' });
      continue;
    }

    if (!app || typeof app.get !== 'function' || typeof app.set !== 'function') {
      addResult(summary, { ...declaration, path: roots.join(','), status: 'prepared', message: 'No express app context; views are prepared but not registered.' });
      continue;
    }

    const currentRoots = getCurrentViewRoots(app);
    const currentKeys = new Set(currentRoots.map((candidate) => path.resolve(candidate).toLowerCase()));
    const additions = roots.filter((candidate) => !currentKeys.has(path.resolve(candidate).toLowerCase()));
    if (!additions.length) {
      summary.skipped += 1;
      addResult(summary, { ...declaration, path: roots.join(','), status: 'skipped', message: 'View roots already registered.' });
      continue;
    }

    setViewRoots(app, [...currentRoots, ...additions]);
    summary.registered += additions.length;
    addResult(summary, { ...declaration, path: additions.join(','), status: 'registered', message: 'View roots registered.' });
  }

  if (logger && typeof logger.info === 'function' && (summary.requested || summary.registered || summary.failed)) {
    logger.info('PACKAGE_VIEWS', 'REGISTER', `Processed view declarations for ${packageId}.`, {
      packageId,
      requested: summary.requested,
      registered: summary.registered,
      failed: summary.failed
    });
  }

  return summary;
}

async function registerManifestAssets(context = {}, options = {}) {
  const packageId = normalizePackageId(context?.packageId || context?.manifest?.id || '');
  const summary = createSummary(packageId, 'assets');
  const logger = options?.logger || startupLogger;
  const app = context?.app || options?.app || null;
  const staticFactory = options?.staticFactory || express.static;
  const declarations = normalizeDeclarationList(context?.manifest?.assets);

  if (!packageId || !declarations.length) return summary;

  for (let index = 0; index < declarations.length; index += 1) {
    summary.requested += 1;
    let declaration;
    try {
      declaration = normalizeAssetDeclaration(declarations[index], packageId, index);
    } catch (error) {
      summary.failed += 1;
      addResult(summary, { status: 'failed', message: error?.message || String(error) });
      continue;
    }

    if (!declaration.active) {
      summary.skipped += 1;
      addResult(summary, { ...declaration, status: 'skipped', message: 'Asset declaration is inactive.' });
      continue;
    }

    let assetRoot;
    try {
      assetRoot = resolveInsideProject(declaration.path, 'assets path');
      if (!pathExists(assetRoot)) {
        throw new Error(`Asset path does not exist: ${path.relative(resolveProjectRoot(), assetRoot)}`);
      }
    } catch (error) {
      summary.failed += 1;
      addResult(summary, { ...declaration, status: 'failed', message: error?.message || String(error) });
      continue;
    }

    summary.prepared += 1;
    if (declaration.metadataOnly) {
      addResult(summary, { ...declaration, root: assetRoot, status: 'prepared', message: 'Asset metadata prepared (metadataOnly=true).' });
      continue;
    }

    if (!app || typeof app.use !== 'function') {
      addResult(summary, { ...declaration, root: assetRoot, status: 'prepared', message: 'No express app context; assets are prepared but not mounted.' });
      continue;
    }

    const mountKey = `${packageId}|${declaration.publicPath}|${assetRoot}`.toLowerCase();
    if (mountedAssetKeys.has(mountKey)) {
      summary.skipped += 1;
      addResult(summary, { ...declaration, root: assetRoot, status: 'skipped', message: 'Asset mount already registered in this process.' });
      continue;
    }

    app.use(declaration.publicPath, staticFactory(assetRoot));
    mountedAssetKeys.add(mountKey);
    summary.mounted += 1;
    addResult(summary, { ...declaration, root: assetRoot, status: 'mounted', message: 'Asset static mount registered.' });
  }

  if (logger && typeof logger.info === 'function' && (summary.requested || summary.mounted || summary.failed)) {
    logger.info('PACKAGE_ASSETS', 'REGISTER', `Processed asset declarations for ${packageId}.`, {
      packageId,
      requested: summary.requested,
      mounted: summary.mounted,
      failed: summary.failed
    });
  }

  return summary;
}

function resetMountedAssets() {
  mountedAssetKeys = new Set();
}

function createLoaderHooks(options = {}) {
  return {
    registerViews: async (context = {}) => registerManifestViews(context, options),
    registerAssets: async (context = {}) => registerManifestAssets(context, options)
  };
}

module.exports = {
  registerManifestViews,
  registerManifestAssets,
  resetMountedAssets,
  createLoaderHooks
};
