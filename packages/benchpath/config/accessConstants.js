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
  return normalized.includes('/packages/benchpath/') || normalized.includes('/uploads/packages/benchpath/');
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

const BENCHPATH_SECTIONS = Object.freeze({
  BENCHPATH: 'BENCHPATH',
  BENCHPATH_DASHBOARD: 'BENCHPATH',
  BENCHPATH_REFERENCE: 'BENCHPATH_REFERENCE',
  BENCHPATH_SOURCES: 'BENCHPATH_SOURCES',
  BENCHPATH_SOURCE_FRAGMENTS: 'BENCHPATH_SOURCE_FRAGMENTS',
  BENCHPATH_CLB_FRAMEWORK: 'BENCHPATH_CLB_FRAMEWORK',
  BENCHPATH_CLB_STAGES: 'BENCHPATH_CLB_STAGES',
  BENCHPATH_CLB_SKILLS: 'BENCHPATH_CLB_SKILLS',
  BENCHPATH_CLB_COMPETENCY_AREAS: 'BENCHPATH_CLB_COMPETENCY_AREAS',
  BENCHPATH_CLB_BENCHMARKS: 'BENCHPATH_CLB_BENCHMARKS',
  BENCHPATH_CLB_COMPETENCIES: 'BENCHPATH_CLB_COMPETENCIES',
  BENCHPATH_CLB_INDICATORS: 'BENCHPATH_CLB_INDICATORS',
  BENCHPATH_CLB_PROFILE_OF_ABILITY: 'BENCHPATH_CLB_PROFILE_OF_ABILITY',
  BENCHPATH_CLB_FEATURES_OF_COMMUNICATION: 'BENCHPATH_CLB_FEATURES_OF_COMMUNICATION',
  BENCHPATH_CLB_SAMPLE_TASK_LABELS: 'BENCHPATH_CLB_SAMPLE_TASK_LABELS',
  BENCHPATH_TASK_AUTHORING: 'BENCHPATH_TASK_AUTHORING'
});

const BENCHPATH_ROLES = Object.freeze({
  AUTHOR: 'benchpath_author',
  REVIEWER: 'benchpath_reviewer',
  ADMIN: 'benchpath_admin'
});

const BENCHPATH_UPLOAD_FOLDERS = Object.freeze({
  REPORTS: 'generated.benchpathReports'
});

const SECTIONS = Object.freeze({
  ...(CORE_SECTIONS || {}),
  ...BENCHPATH_SECTIONS
});

module.exports = {
  BENCHPATH_SECTIONS,
  BENCHPATH_ROLES,
  BENCHPATH_UPLOAD_FOLDERS,
  SECTIONS,
  OPERATIONS
};
