const { requireCoreModule, resolveCoreRoot } = require('../services/school/schoolCoreModuleResolver');
const {
  isValidFeeCategory,
  ALL_FEE_CATEGORIES_KEY
} = require('./feeCategoryCatalog');

const ALL_CATEGORY_ALIASES = new Set([
  'all',
  'all category',
  'all categories',
  'all fee category',
  'all fee categories',
  'all_category',
  'all_categories',
  'all-fee-category',
  'all-fee-categories',
  'all_fee_category',
  'all_fee_categories'
]);

function normalizePostingPolicyFeeCategory(value) {
  const raw = String(value || '').trim();
  if (!raw) return ALL_FEE_CATEGORIES_KEY;
  if (raw === ALL_FEE_CATEGORIES_KEY) return ALL_FEE_CATEGORIES_KEY;

  const normalizedLower = raw.toLowerCase();
  if (normalizedLower === ALL_FEE_CATEGORIES_KEY.toLowerCase()) return ALL_FEE_CATEGORIES_KEY;

  const compact = normalizedLower.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (ALL_CATEGORY_ALIASES.has(compact)) return ALL_FEE_CATEGORIES_KEY;

  return raw;
}

function normalizePostingPolicyRows(rowsInput) {
  const rows = Array.isArray(rowsInput) ? rowsInput : [];
  const seen = new Set();

  return rows.map((row) => ({
    feeCategory: normalizePostingPolicyFeeCategory(row?.feeCategory),
    transactionDefinitionId: String(row?.transactionDefinitionId || '').trim(),
    transactionDefinitionCode: String(row?.transactionDefinitionCode || row?.code || '').trim().toUpperCase(),
    transactionDefinitionName: String(row?.transactionDefinitionName || row?.label || '').trim(),
    notes: String(row?.notes || '').trim(),
    active: row?.active !== false && String(row?.active) !== 'false'
  })).filter((row) => {
    if (!isValidFeeCategory(row.feeCategory, { includeAll: true })) return false;
    if (seen.has(row.feeCategory)) return false;
    seen.add(row.feeCategory);
    return true;
  });
}

function selectPostingPolicy(rowsInput, feeCategory) {
  const rows = normalizePostingPolicyRows(rowsInput);
  const normalizedCategory = normalizePostingPolicyFeeCategory(feeCategory);
  const activeRows = rows.filter((row) => row && row.active !== false && String(row.active) !== 'false');
  return activeRows.find((row) => String(row.feeCategory || '').trim() === normalizedCategory)
    || activeRows.find((row) => String(row.feeCategory || '').trim() === ALL_FEE_CATEGORIES_KEY)
    || null;
}

module.exports = {
  normalizePostingPolicyFeeCategory,
  normalizePostingPolicyRows,
  selectPostingPolicy,
  ALL_FEE_CATEGORIES_KEY
};
