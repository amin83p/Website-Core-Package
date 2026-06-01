const path = require('path');

function cleanText(value = '', max = 4000) {
  const out = String(value || '').trim();
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeFilePath(value = '') {
  return cleanText(value).replace(/\\/g, '/');
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

  // Optional explicit override.
  add(process.env.PACKAGE_CORE_ROOT || '');
  // Repository runtime: <root>/packages/pte/config
  add(path.resolve(__dirname, '../../../'));
  // Installed runtime: <root>/uploads/packages/pte/config
  add(path.resolve(__dirname, '../../../../'));
  // Final fallback.
  add(process.cwd());
  return out;
}

function requireCoreAccessConstants() {
  let lastError = null;
  const tried = [];
  for (const root of buildCoreRootCandidates()) {
    const candidate = path.resolve(root, 'config/accessConstants');
    tried.push(candidate);
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

const PTE_SECTIONS = Object.freeze({
  PTE: 'PTE',
  PTE_PUBLIC_PAGE: 'PTE_PUBLIC_PAGE',
  PTE_PEOPLE: 'PTE_PEOPLE',
  PTE_STUDENTS: 'PTE_STUDENTS',
  PTE_PUBLIC_APPLICANTS: 'PTE_PUBLIC_APPLICANTS',
  PTE_TEACHERS: 'PTE_TEACHERS',
  PTE_QUESTIONS_BANK: 'PTE_QUESTIONS_BANK',
  PTE_TESTS: 'PTE_TESTS',
  PTE_COURSES: 'PTE_COURSES',
  PTE_AI_ASSISST: 'PTE_AI_ASSISST',
  PTE_AI_PROVIDER_KEYS: 'PTE_AI_PROVIDER_KEYS',
  PTE_AI_SCORING_SETTINGS: 'PTE_AI_SCORING_SETTINGS',
  PTE_AI_TOKEN_USAGE: 'PTE_AI_TOKEN_USAGE',
  PTE_SCORING: 'PTE_SCORING',
  PTE_SCORING_DEFAULTS: 'PTE_SCORING_DEFAULTS',
  PTE_ATTEMPT: 'PTE_ATTEMPT',
  PTE_ATTEMPT_LEDGER: 'PTE_ATTEMPT_LEDGER',
  PTE_ATTEMPT_DETAILS: 'PTE_ATTEMPT_DETAILS',
  PTE_ATTEMPT_OVERALL_PERFORMANCE: 'PTE_ATTEMPT_OVERALL_PERFORMANCE',
  PTE_PRACTICE: 'PTE_PRACTICE',
  PTE_PRACTICE_BY_SKILLS: 'PTE_PRACTICE_BY_SKILLS',
  PTE_SMART_PRACTICE: 'PTE_SMART_PRACTICE',
  PTE_MOCK_EXAMS: 'PTE_MOCK_EXAMS',
  PTE_FEEDBACK: 'PTE_FEEDBACK',
  PTE_FEEDBACK_ON_PRACTICE: 'PTE_FEEDBACK_ON_PRACTICE',
  PTE_TOOLS_AND_REPORTS: 'PTE_TOOLS_AND_REPORTS'
});

const SECTIONS = Object.freeze({
  ...(CORE_SECTIONS || {}),
  ...PTE_SECTIONS
});

module.exports = {
  PTE_SECTIONS,
  SECTIONS,
  OPERATIONS
};
