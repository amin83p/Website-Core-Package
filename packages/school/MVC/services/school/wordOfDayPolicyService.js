'use strict';

const { requireCoreModule } = require('./schoolCoreModuleResolver');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const DEFAULT_POLICY = Object.freeze({
  schoolDashboardEnabled: true,
  publicHomeEnabled: false,
  publicSourceOrgId: ''
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

function normalizePolicyFromStored(raw = {}) {
  return {
    schoolDashboardEnabled: cleanBool(raw.schoolDashboardEnabled, DEFAULT_POLICY.schoolDashboardEnabled),
    publicHomeEnabled: cleanBool(raw.publicHomeEnabled, DEFAULT_POLICY.publicHomeEnabled),
    publicSourceOrgId: cleanOrgId(raw.publicSourceOrgId)
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