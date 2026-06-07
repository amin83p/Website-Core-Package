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
  return normalized.includes('/packages/credit/') || normalized.includes('/uploads/packages/credit/');
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

const CREDIT_SECTIONS = Object.freeze({
  CREDIT_LOANS: 'CREDIT_LOANS',
  CREDIT_CUSTOMERS: 'CREDIT_CUSTOMERS',
  CREDIT_REQUESTS: 'CREDIT_REQUESTS',
  CREDIT_INSTALLMENTS: 'CREDIT_INSTALLMENTS'
});

const CREDIT_ROLES = Object.freeze({
  ADMIN: 'credit_admin',
  USER: 'credit_user',
  CUSTOMER: 'credit_customer'
});

const CREDIT_UPLOAD_FOLDERS = Object.freeze({});

const SECTIONS = Object.freeze({
  ...(CORE_SECTIONS || {}),
  ...CREDIT_SECTIONS
});

module.exports = {
  CREDIT_SECTIONS,
  CREDIT_ROLES,
  CREDIT_UPLOAD_FOLDERS,
  SECTIONS,
  OPERATIONS
};
