const fs = require('fs');
const path = require('path');

const packageManifestService = require('./packageManifestService');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_PACKAGE_ROOT = path.join(PROJECT_ROOT, 'packages');

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function buildKey(sectionId = '', operationId = '') {
  const section = cleanText(sectionId, 120).toUpperCase();
  const operation = cleanText(operationId, 120).toUpperCase();
  return section && operation ? `${section}::${operation}` : '';
}

function readPackageManifestsSync(packageRoot = DEFAULT_PACKAGE_ROOT) {
  try {
    return fs.readdirSync(packageRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(packageRoot, entry.name, 'package.manifest.json'))
      .filter((manifestPath) => fs.existsSync(manifestPath))
      .map((manifestPath) => {
        try {
          const raw = fs.readFileSync(manifestPath, 'utf8');
          const parsed = JSON.parse(String(raw || '').replace(/^\uFEFF/, ''));
          return packageManifestService.validatePackageManifest(parsed, {
            allowUnknownKeys: true
          });
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

function normalizeQuotaMiddlewareKey(row = {}) {
  if (!row || typeof row !== 'object') return '';
  const explicitKey = cleanText(row.key || row.middlewareKey || '', 260).toUpperCase();
  if (explicitKey.includes('::')) return explicitKey;
  return buildKey(row.sectionId || row.section || '', row.operationId || row.operation || '');
}

function buildEnabledQuotaKeys(options = {}) {
  const manifests = Array.isArray(options.manifests)
    ? options.manifests
    : readPackageManifestsSync(options.packageRoot || DEFAULT_PACKAGE_ROOT);

  const keys = [];
  manifests.forEach((manifest) => {
    const rows = Array.isArray(manifest?.quotaDefinitions) ? manifest.quotaDefinitions : [];
    rows.forEach((row) => {
      if (!row || typeof row !== 'object') return;
      if (row.active === false) return;
      if (row.middlewareEnabled !== true && row.enableMiddleware !== true) return;
      const key = normalizeQuotaMiddlewareKey(row);
      if (key) keys.push(key);
    });
  });

  return Array.from(new Set(keys));
}

module.exports = {
  buildEnabledQuotaKeys,
  normalizeQuotaMiddlewareKey,
  __testables: {
    buildKey,
    readPackageManifestsSync
  }
};
