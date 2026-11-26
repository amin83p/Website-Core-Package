const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const FEE_CATEGORIES = Object.freeze([
  'Domestic',
  'International',
  'Corporate',
  'Scholarship',
  'Government Funded',
  'Self Funded',
  'LINC Alberta',
  'WCB Alberta',
  'Others'
]);

const FEE_CATEGORY_SET = new Set(FEE_CATEGORIES);
const ALL_FEE_CATEGORIES_KEY = '__ALL__';
const ALL_FEE_CATEGORIES_LABEL = 'All Categories';

const STUDENT_FEE_CATEGORY_CONTROL_CODE = Object.freeze({
  domestic: '1221',
  international: '1222',
  corporate: '1223',
  scholarship: '1224',
  government_funded: '1225',
  self_funded: '1229',
  self: '1229',
  linc: '1227',
  linc_alberta: '1227',
  wcb: '1228',
  wcb_alberta: '1228',
  others: '1226',
  other: '1226'
});

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

function normalizeFeeCategoryKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getStudentFeeCategoryControlAccountCode(feeCategory) {
  const key = normalizeFeeCategoryKey(feeCategory);
  if (!key) return null;
  return STUDENT_FEE_CATEGORY_CONTROL_CODE[key] || null;
}

module.exports = {
  FEE_CATEGORIES,
  FEE_CATEGORY_SET,
  ALL_FEE_CATEGORIES_KEY,
  ALL_FEE_CATEGORIES_LABEL,
  STUDENT_FEE_CATEGORY_CONTROL_CODE,
  getFeeCategories,
  isValidFeeCategory,
  getFeeCategoryLabel,
  normalizeFeeCategoryKey,
  getStudentFeeCategoryControlAccountCode
};