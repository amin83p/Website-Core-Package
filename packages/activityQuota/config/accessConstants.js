const path = require('path');

function cleanText(value = '', max = 4000) {
  const out = String(value || '').trim();
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeFilePath(value = '') {
  return cleanText(value).replace(/\\/g, '/');
}

function isPackageOwnedPath(absPath = '') {
  const normalized = normalizeFilePath(absPath).toLowerCase();
  return normalized.includes('/packages/activityquota/') || normalized.includes('/uploads/packages/activityquota/');
}

function buildCoreRootCandidates() {
  const unique = new Set();
  const out = [];
  const add = (value = '') => {
    const resolved = path.resolve(value);
    const key = normalizeFilePath(resolved).toLowerCase();
    if (!key || unique.has(key)) return;
    unique.add(key);
    out.push(resolved);
  };

  add(process.env.PACKAGE_CORE_ROOT || '');
  add(path.resolve(__dirname, '../../../'));
  add(path.resolve(__dirname, '../../../../'));
  add(process.cwd());
  return out;
}

function requireCoreAccessConstants() {
  let lastError = null;
  const tried = [];
  for (const root of buildCoreRootCandidates()) {
    const candidate = path.resolve(root, 'config/accessConstants');
    tried.push(candidate);
    if (isPackageOwnedPath(candidate)) continue;
    try {
      return require(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  const suffix = lastError ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Unable to resolve core access constants. Tried: ${tried.join(', ')}.${suffix}`);
}

const { SECTIONS: CORE_SECTIONS, OPERATIONS } = requireCoreAccessConstants();

const ACTIVITY_QUOTA_SECTIONS = Object.freeze({
  ACTIVITY_QUOTA: 'ACTIVITY_QUOTA',
  ACTIVITY_QUOTA_OVERVIEW: 'ACTIVITY_QUOTA_OVERVIEW',
  ACTIVITY_QUOTA_CREDIT_CHECK: 'ACTIVITY_QUOTA_CREDIT_CHECK',
  ACTIVITY_QUOTA_LEDGER: 'ACTIVITY_QUOTA_LEDGER',
  ACTIVITY_QUOTA_RULES: 'ACTIVITY_QUOTA_RULES',
  ACTIVITY_QUOTA_ADD_CREDIT: 'ACTIVITY_QUOTA_ADD_CREDIT',
  ACTIVITY_QUOTA_PACKAGE: 'ACTIVITY_QUOTA_PACKAGE',
  ACTIVITY_QUOTA_PACKAGE_MANAGER: 'ACTIVITY_QUOTA_PACKAGE_MANAGER'
});

const SECTIONS = Object.freeze({
  ...(CORE_SECTIONS || {}),
  ...ACTIVITY_QUOTA_SECTIONS
});

module.exports = {
  ACTIVITY_QUOTA_SECTIONS,
  SECTIONS,
  OPERATIONS
};
