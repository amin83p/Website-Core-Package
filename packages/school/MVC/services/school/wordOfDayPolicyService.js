'use strict';

const { requireCoreModule } = require('./schoolCoreModuleResolver');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const DEFAULT_POLICY = Object.freeze({
  schoolDashboardEnabled: true,
  publicHomeEnabled: false,
  publicSourceOrgId: '',
  showAuthorOnDisplay: true,
  showDifficultyOnDisplay: true,
  yearlyContributionLimitPerUser: 0
});

function cleanBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function cleanOrgId(value) {
  return toPublicId(String(value || '').trim());
}

function cleanNonNegativeInt(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function normalizePolicyFromStored(raw = {}) {
  return {
    schoolDashboardEnabled: cleanBool(raw.schoolDashboardEnabled, DEFAULT_POLICY.schoolDashboardEnabled),
    publicHomeEnabled: cleanBool(raw.publicHomeEnabled, DEFAULT_POLICY.publicHomeEnabled),
    publicSourceOrgId: cleanOrgId(raw.publicSourceOrgId),
    showAuthorOnDisplay: cleanBool(raw.showAuthorOnDisplay, DEFAULT_POLICY.showAuthorOnDisplay),
    showDifficultyOnDisplay: cleanBool(raw.showDifficultyOnDisplay, DEFAULT_POLICY.showDifficultyOnDisplay),
    yearlyContributionLimitPerUser: cleanNonNegativeInt(
      raw.yearlyContributionLimitPerUser,
      DEFAULT_POLICY.yearlyContributionLimitPerUser
    )
  };
}

function resolvePolicy(patch = {}) {
  return normalizePolicyFromStored({ ...DEFAULT_POLICY, ...(patch && typeof patch === 'object' ? patch : {}) });
}

function validatePolicyInput(body = {}) {
  const normalized = normalizePolicyFromStored(body);
  if (normalized.publicHomeEnabled && !normalized.publicSourceOrgId) {
    const error = new Error('Select a source organization when public home display is enabled.');
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

module.exports = {
  DEFAULT_POLICY,
  resolvePolicy,
  validatePolicyInput,
  normalizePolicyFromStored
};