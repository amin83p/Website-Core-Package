const path = require('path');

const packageRegistryService = require('./packageRegistryService');
const packageLoaderService = require('./packageLoaderService');
const packageManifestService = require('./packageManifestService');
const startupLogger = require('../utils/startupLogger');
const { getPackageStorageRootAbsolute } = require('../utils/packageStoragePathUtils');

const CACHE_TTL_MS = 60 * 1000;

const VISIBILITY_VALUES = new Set(['all', 'guest', 'authenticated']);

const COMPAT_PACKAGE_DEFAULTS = Object.freeze({
  school: {
    id: 'school',
    name: 'School',
    mountPath: '/school',
    menuEntries: [],
    dashboardEntries: [
      {
        id: 'school-dashboard',
        label: 'School Dashboard',
        href: '/school',
        icon: 'bi-building',
        description: 'Open School package area.',
        visibility: 'authenticated',
        target: '_self'
      }
    ]
  },
  credit: {
    id: 'credit',
    name: 'Credit',
    mountPath: '/credit',
    menuEntries: [],
    dashboardEntries: [
      {
        id: 'credit-dashboard',
        label: 'Credit Dashboard',
        href: '/credit',
        icon: 'bi-cash-coin',
        description: 'Open Credit package area.',
        visibility: 'authenticated',
        target: '_self'
      }
    ]
  }
});

let cache = {
  refreshedAt: 0,
  expiresAt: 0,
  backendMode: '',
  packageRootDir: '',
  packages: [],
  enabledPackageIds: new Set(),
  disabledPackageIds: new Set(),
  disabledMountPaths: [],
  menuEntries: [],
  dashboardEntries: []
};

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizePackageId(value = '') {
  return cleanText(value, 120).toLowerCase();
}

function normalizeMountPath(value = '') {
  const raw = cleanText(value, 500);
  if (!raw) return '';
  const normalized = raw.replace(/\\/g, '/');
  if (!normalized.startsWith('/')) return '';
  if (normalized === '/') return '';
  return normalized.replace(/\/+$/, '');
}

function cleanMenuHref(value = '') {
  const token = cleanText(value, 1200);
  if (!token) return '';
  if (/[\s"'`<>\\]/.test(token)) return '';
  if (/^\/(?!\/)/.test(token)) return token;
  if (/^https:\/\//i.test(token)) return token;
  if (/^(mailto:|tel:)/i.test(token)) return token;
  return '';
}

function cleanMenuIcon(value = '') {
  const token = cleanText(value, 80);
  if (!token || !/^[a-z0-9 _-]+$/i.test(token)) return '';
  const parts = token.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const iconPart = parts.find((part) => /^bi-[a-z0-9-]+$/i.test(part));
  if (iconPart) return iconPart;
  const first = parts.find((part) => part.toLowerCase() !== 'bi') || '';
  if (!first) return '';
  return first.startsWith('bi-') ? first : `bi-${first.replace(/^-+/, '')}`;
}

function normalizeVisibility(value = 'all') {
  const token = cleanText(value, 40).toLowerCase();
  if (!VISIBILITY_VALUES.has(token)) return 'all';
  return token;
}

function normalizeTarget(value = '_self') {
  return cleanText(value, 40) === '_blank' ? '_blank' : '_self';
}

function normalizeMenuEntries(rawRows = [], packageMeta = {}) {
  const rows = Array.isArray(rawRows) ? rawRows : [];
  const out = [];
  rows.forEach((row, index) => {
    const source = row && typeof row === 'object' ? row : {};
    const label = cleanText(source.label || source.title, 120);
    const href = cleanMenuHref(source.href || source.url);
    if (!label || !href) return;
    out.push({
      id: cleanText(source.id, 160) || `${packageMeta.id}-menu-${index + 1}`,
      label,
      href,
      icon: cleanMenuIcon(source.icon),
      visibility: normalizeVisibility(source.visibility),
      target: normalizeTarget(source.target),
      active: source.active !== false,
      sourcePackageId: packageMeta.id,
      sourcePackageName: packageMeta.name || packageMeta.id.toUpperCase(),
      category: cleanText(source.category, 120) || (packageMeta.name || packageMeta.id.toUpperCase()),
      children: []
    });
  });
  return out;
}

function normalizeDashboardEntries(rawRows = [], packageMeta = {}) {
  const rows = Array.isArray(rawRows) ? rawRows : [];
  const out = [];
  rows.forEach((row, index) => {
    const source = row && typeof row === 'object' ? row : {};
    const label = cleanText(source.label || source.title, 120);
    const href = cleanMenuHref(source.href || source.url);
    if (!label || !href) return;
    out.push({
      id: cleanText(source.id, 160) || `${packageMeta.id}-dashboard-${index + 1}`,
      label,
      href,
      description: cleanText(source.description || source.note, 500),
      icon: cleanMenuIcon(source.icon) || 'bi-box-seam',
      visibility: normalizeVisibility(source.visibility || 'authenticated'),
      target: normalizeTarget(source.target),
      active: source.active !== false,
      sourcePackageId: packageMeta.id,
      sourcePackageName: packageMeta.name || packageMeta.id.toUpperCase(),
      category: cleanText(source.category, 120) || (packageMeta.name || packageMeta.id.toUpperCase())
    });
  });
  return out;
}

function dedupeEntries(entries = [], keyBuilder = (row) => `${row.id}|${row.href}`) {
  const out = [];
  const seen = new Set();
  entries.forEach((row) => {
    const key = String(keyBuilder(row) || '').toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(row);
  });
  return out;
}

function isEntryVisibleForUser(entry = {}, user = null) {
  const visibility = normalizeVisibility(entry.visibility);
  const isAuthenticated = Boolean(user);
  if (visibility === 'guest') return !isAuthenticated;
  if (visibility === 'authenticated') return isAuthenticated;
  return true;
}

function isAppRootPathInsideMount(href = '', mountPath = '') {
  const localHref = cleanMenuHref(href);
  const localMount = normalizeMountPath(mountPath);
  if (!localHref || !localMount) return false;
  if (!localHref.startsWith('/')) return false;
  if (localHref === localMount) return true;
  return localHref.startsWith(`${localMount}/`);
}

function removeDisabledMountEntries(items = [], disabledMountPaths = []) {
  if (!Array.isArray(items) || !items.length) return [];
  const mounts = Array.isArray(disabledMountPaths)
    ? disabledMountPaths.map((row) => normalizeMountPath(row)).filter(Boolean)
    : [];
  if (!mounts.length) return items;

  return items.filter((item) => {
    const href = cleanMenuHref(item?.href);
    if (!href) return false;
    return !mounts.some((mountPath) => isAppRootPathInsideMount(href, mountPath));
  });
}

function manifestToPackageMeta(manifest = {}, defaults = {}) {
  const id = normalizePackageId(manifest?.id || defaults.id || '');
  if (!id) return null;
  return {
    id,
    name: cleanText(manifest?.name || defaults.name || '', 180),
    mountPath: normalizeMountPath(manifest?.mountPath || defaults.mountPath || '')
  };
}

function mergePackageDeclarations(base = {}, extra = {}) {
  return {
    ...base,
    ...extra,
    menuEntries: [
      ...(Array.isArray(base.menuEntries) ? base.menuEntries : []),
      ...(Array.isArray(extra.menuEntries) ? extra.menuEntries : [])
    ],
    dashboardEntries: [
      ...(Array.isArray(base.dashboardEntries) ? base.dashboardEntries : []),
      ...(Array.isArray(extra.dashboardEntries) ? extra.dashboardEntries : [])
    ]
  };
}

function getCompatPackage(id = '') {
  const token = normalizePackageId(id);
  return COMPAT_PACKAGE_DEFAULTS[token] || null;
}

function seedCompatEnabledPackages(registryRows = []) {
  const rows = [];
  const registryIds = new Set();

  (Array.isArray(registryRows) ? registryRows : []).forEach((row) => {
    const id = normalizePackageId(row?.packageId || row?.id || '');
    if (!id) return;
    registryIds.add(id);
    rows.push(row);
  });

  Object.values(COMPAT_PACKAGE_DEFAULTS).forEach((base) => {
    if (registryIds.has(base.id)) return;
    rows.push({
      packageId: base.id,
      enabled: true,
      installStatus: 'compat',
      metadata: {
        compat: true
      }
    });
  });

  return rows;
}

async function resolveManifestFromRegistryRow(registryRow = {}, options = {}) {
  const packageId = normalizePackageId(registryRow?.packageId || registryRow?.id || '');
  if (!packageId) return null;
  const packageRootDir = getPackageStorageRootAbsolute({ packageRootDir: options.packageRootDir });
  const manifestPath = await packageLoaderService.resolveManifestPath(packageId, registryRow, packageRootDir);
  if (!manifestPath) return null;
  const rawManifest = await packageLoaderService.readManifestFile(manifestPath);
  const manifest = packageManifestService.validatePackageManifest(rawManifest, {
    knownIds: []
  });
  if (manifest.id !== packageId) {
    throw new Error(`Manifest id "${manifest.id}" does not match registry packageId "${packageId}".`);
  }
  return {
    manifest,
    manifestPath
  };
}

function rebuildCache(next = {}) {
  const menuEntries = dedupeEntries(next.menuEntries || [], (row) => `${row.sourcePackageId}|${row.id}|${row.href}`);
  const dashboardEntries = dedupeEntries(next.dashboardEntries || [], (row) => `${row.sourcePackageId}|${row.id}|${row.href}`);
  const disabledMountPaths = dedupeEntries(next.disabledMountPaths || [], (row) => row).map((row) => normalizeMountPath(row)).filter(Boolean);
  cache = {
    refreshedAt: Date.now(),
    expiresAt: Date.now() + CACHE_TTL_MS,
    backendMode: cleanText(next.backendMode, 30),
    packageRootDir: cleanText(next.packageRootDir, 2000),
    packages: Array.isArray(next.packages) ? next.packages : [],
    enabledPackageIds: new Set((next.enabledPackageIds || []).map((row) => normalizePackageId(row)).filter(Boolean)),
    disabledPackageIds: new Set((next.disabledPackageIds || []).map((row) => normalizePackageId(row)).filter(Boolean)),
    disabledMountPaths,
    menuEntries,
    dashboardEntries
  };
}

async function refreshNavigationRegistry(options = {}) {
  const backendMode = cleanText(options.backendMode, 30) || undefined;
  const packageRootDir = getPackageStorageRootAbsolute({ packageRootDir: options.packageRootDir });
  const registryRows = await packageRegistryService.listPackageRegistry({
    backendMode
  });
  const expandedRegistryRows = seedCompatEnabledPackages(registryRows);

  const packages = [];
  const enabledPackageIds = new Set();
  const disabledPackageIds = new Set();
  const disabledMountPaths = [];
  const menuEntries = [];
  const dashboardEntries = [];

  for (const row of expandedRegistryRows) {
    const packageId = normalizePackageId(row?.packageId || row?.id || '');
    if (!packageId) continue;
    const compat = getCompatPackage(packageId);
    const isEnabled = row?.enabled !== false;

    if (!isEnabled) {
      disabledPackageIds.add(packageId);
      if (compat?.mountPath) disabledMountPaths.push(compat.mountPath);
    } else {
      enabledPackageIds.add(packageId);
    }

    let manifestResult = null;
    try {
      manifestResult = await resolveManifestFromRegistryRow(row, {
        backendMode,
        packageRootDir
      });
    } catch (error) {
      if (isEnabled) {
        startupLogger.warn('PACKAGE_NAV', 'MANIFEST', `Package navigation manifest skipped for ${packageId}.`, {
          reason: error?.message || String(error)
        });
      }
    }

    const manifestMeta = manifestResult?.manifest
      ? manifestToPackageMeta(manifestResult.manifest, {
        id: packageId,
        name: compat?.name || packageId.toUpperCase(),
        mountPath: compat?.mountPath || ''
      })
      : manifestToPackageMeta(compat || {}, {
        id: packageId,
        name: compat?.name || packageId.toUpperCase(),
        mountPath: compat?.mountPath || ''
      });

    if (!manifestMeta) continue;

    if (!isEnabled && manifestMeta.mountPath) {
      disabledMountPaths.push(manifestMeta.mountPath);
    }

    let packageDecl = {
      id: manifestMeta.id,
      name: manifestMeta.name,
      mountPath: manifestMeta.mountPath,
      menuEntries: [],
      dashboardEntries: []
    };

    if (manifestResult?.manifest) {
      packageDecl = mergePackageDeclarations(packageDecl, {
        menuEntries: manifestResult.manifest.menuEntries || [],
        dashboardEntries: manifestResult.manifest.dashboardEntries || []
      });
    }

    if (compat) {
      packageDecl = mergePackageDeclarations(packageDecl, compat);
    }

    packages.push({
      id: packageDecl.id,
      name: packageDecl.name,
      mountPath: packageDecl.mountPath,
      enabled: isEnabled,
      manifestPath: manifestResult?.manifestPath || ''
    });

    if (!isEnabled) continue;
    menuEntries.push(...normalizeMenuEntries(packageDecl.menuEntries, packageDecl));
    dashboardEntries.push(...normalizeDashboardEntries(packageDecl.dashboardEntries, packageDecl));
  }

  rebuildCache({
    backendMode,
    packageRootDir,
    packages,
    enabledPackageIds: [...enabledPackageIds],
    disabledPackageIds: [...disabledPackageIds],
    disabledMountPaths,
    menuEntries,
    dashboardEntries
  });

  return getNavigationSnapshot();
}

function getNavigationSnapshot() {
  return {
    refreshedAt: cache.refreshedAt,
    expiresAt: cache.expiresAt,
    backendMode: cache.backendMode,
    packageRootDir: cache.packageRootDir,
    packages: cache.packages.map((row) => ({ ...row })),
    enabledPackageIds: [...cache.enabledPackageIds],
    disabledPackageIds: [...cache.disabledPackageIds],
    disabledMountPaths: [...cache.disabledMountPaths],
    menuEntries: cache.menuEntries.map((row) => ({ ...row })),
    dashboardEntries: cache.dashboardEntries.map((row) => ({ ...row }))
  };
}

function isPackageEnabled(packageId = '') {
  const token = normalizePackageId(packageId);
  if (!token) return false;
  if (cache.enabledPackageIds.has(token)) return true;
  const compat = getCompatPackage(token);
  if (!compat) return false;
  return !cache.disabledPackageIds.has(token);
}

function getDisabledMountPaths() {
  return [...cache.disabledMountPaths];
}

function getPublicMenuEntries(user = null) {
  return cache.menuEntries
    .filter((row) => row.active !== false)
    .filter((row) => isEntryVisibleForUser(row, user))
    .map((row) => ({ ...row, children: [] }));
}

function getDashboardEntries(user = null) {
  return cache.dashboardEntries
    .filter((row) => row.active !== false)
    .filter((row) => isEntryVisibleForUser(row, user))
    .map((row) => ({ ...row }));
}

function getPrimaryDashboardHref(user = null, options = {}) {
  const fallback = cleanMenuHref(options.fallback || '');
  const entry = getDashboardEntries(user).find((row) => cleanMenuHref(row?.href));
  return cleanMenuHref(entry?.href || '') || fallback;
}

function filterMenuItemsAgainstDisabledPackages(items = []) {
  return removeDisabledMountEntries(items, cache.disabledMountPaths);
}

function resetCache() {
  cache = {
    refreshedAt: 0,
    expiresAt: 0,
    backendMode: '',
    packageRootDir: '',
    packages: [],
    enabledPackageIds: new Set(),
    disabledPackageIds: new Set(),
    disabledMountPaths: [],
    menuEntries: [],
    dashboardEntries: []
  };
}

module.exports = {
  refreshNavigationRegistry,
  getNavigationSnapshot,
  isPackageEnabled,
  getDisabledMountPaths,
  getPublicMenuEntries,
  getDashboardEntries,
  getPrimaryDashboardHref,
  filterMenuItemsAgainstDisabledPackages,
  resetCache
};
