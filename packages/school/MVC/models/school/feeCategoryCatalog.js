const { requireCoreModule, resolveCoreRoot } = require('../services/school/schoolCoreModuleResolver');
const FEE_CATEGORIES = Object.freeze([
  'Domestic',
  'International',
  'Corporate',
  'Scholarship',
  'Government Funded',
  'LINC Alberta',
  'WCB Alberta',
  'Others'
]);

const FEE_CATEGORY_SET = new Set(FEE_CATEGORIES);
const ALL_FEE_CATEGORIES_KEY = '__ALL__';
const ALL_FEE_CATEGORIES_LABEL = 'All Categories';

function getFeeCategories({ includeAll = false } = {}) {
  return includeAll ? [ALL_FEE_CATEGORIES_KEY].concat(FEE_CATEGORIES) : Array.from(FEE_CATEGORIES);
}

function isValidFeeCategory(value, { includeAll = false } = {}) {
  const normalized = String(value || '').trim();
  if (!normalized) return false;
  if (includeAll && normalized === ALL_FEE_CATEGORIES_KEY) return true;
  return FEE_CATEGORY_SET.has(normalized);
}

function getFeeCategoryLabel(value) {
  return String(value || '').trim() === ALL_FEE_CATEGORIES_KEY ? ALL_FEE_CATEGORIES_LABEL : String(value || '').trim();
}

module.exports = {
  FEE_CATEGORIES,
  FEE_CATEGORY_SET,
  ALL_FEE_CATEGORIES_KEY,
  ALL_FEE_CATEGORIES_LABEL,
  getFeeCategories,
  isValidFeeCategory,
  getFeeCategoryLabel
};
