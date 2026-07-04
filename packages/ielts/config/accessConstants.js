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
  return normalized.includes('/packages/ielts/') || normalized.includes('/uploads/packages/ielts/');
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

const IELTS_SECTIONS = Object.freeze({
  IELTS: 'IELTS',
  IELTS_DASHBOARD: 'IELTS',
  IELTS_SCORING_PIPELINES: 'IELTS_SCORING_PIPELINES',
  IELTS_SCORING_HISTORY: 'IELTS_SCORING_HISTORY',
  IELTS_API_PROVIDERS: 'IELTS_API_PROVIDERS',
  IELTS_AI_TOKEN_USAGE: 'IELTS_AI_TOKEN_USAGE'
});

const SECTION_KEYS = Object.freeze({
  IELTS: IELTS_SECTIONS.IELTS,
  IELTS_API_PROVIDERS: IELTS_SECTIONS.IELTS_API_PROVIDERS,
  IELTS_AI_TOKEN_USAGE: IELTS_SECTIONS.IELTS_AI_TOKEN_USAGE
});

const SECTIONS = Object.freeze({
  ...(CORE_SECTIONS || {}),
  ...IELTS_SECTIONS
});

module.exports = {
  IELTS_SECTIONS,
  SECTION_KEYS,
  SECTIONS,
  OPERATIONS
};
