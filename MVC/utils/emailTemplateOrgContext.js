const adminChekersService = require('../services/adminChekersService');
const dataService = require('../services/dataService');
const { SYSTEM_CONTEXT } = require('../../config/constants');
const { toPublicId, idsEqual } = require('./idAdapter');
const {
  assertCreateOrgContextOrThrow,
  getActiveOrgIdOrThrow
} = require('./orgContextUtils');

async function resolveEmailManagementOrgContext(reqUser, options = {}) {
  const scopeLabel = String(options.scopeLabel || 'email management records').trim();
  const activeOrgId = getActiveOrgIdOrThrow(reqUser);
  if (String(activeOrgId).toUpperCase() !== 'SYSTEM') {
    return assertCreateOrgContextOrThrow(reqUser, { scopeLabel });
  }
  if (!adminChekersService.isSuperAdmin(reqUser)) {
    throw new Error(
      '<b>Access Denied</b><br>Only platform administrators can manage records in <b>SYSTEM / GLOBAL MODE</b>.'
    );
  }
  return 'SYSTEM';
}

async function resolveEmailTemplateOrgContext(reqUser, options = {}) {
  return resolveEmailManagementOrgContext(reqUser, {
    ...options,
    scopeLabel: String(options.scopeLabel || 'email templates').trim()
  });
}

async function canManageEmailManagementInActiveOrg(reqUser, options = {}) {
  try {
    await resolveEmailManagementOrgContext(reqUser, options);
    return true;
  } catch (_) {
    return false;
  }
}

async function canManageEmailTemplates(reqUser, options = {}) {
  return canManageEmailManagementInActiveOrg(reqUser, {
    ...options,
    scopeLabel: String(options.scopeLabel || 'email templates').trim()
  });
}

function isSystemTemplateOrg(orgId = '') {
  return String(orgId || '').trim().toUpperCase() === 'SYSTEM';
}

async function resolveActiveOrgEmailContext(user = null) {
  const activeOrgId = toPublicId(user?.activeOrgId) || '';
  if (!activeOrgId) {
    return { activeOrgId: '', activeOrgLabel: 'Unknown organization', isSystemOrg: false };
  }
  if (isSystemTemplateOrg(activeOrgId)) {
    return {
      activeOrgId: 'SYSTEM',
      activeOrgLabel: 'SYSTEM / Platform Defaults',
      isSystemOrg: true
    };
  }

  const allowedOrgs = Array.isArray(user?.allowedOrgs) ? user.allowedOrgs : [];
  const matched = allowedOrgs.find((row) => idsEqual(row?.orgId, activeOrgId));
  const fromSession = String(matched?.name || matched?.orgName || matched?.organizationName || '').trim();
  if (fromSession) {
    return { activeOrgId, activeOrgLabel: fromSession, isSystemOrg: false };
  }

  try {
    const org = await dataService.getDataById('organizations', activeOrgId, SYSTEM_CONTEXT);
    const label = String(
      org?.identity?.displayName
      || org?.identity?.legalName
      || org?.name
      || activeOrgId
    ).trim();
    return { activeOrgId, activeOrgLabel: label || activeOrgId, isSystemOrg: false };
  } catch (_) {
    return { activeOrgId, activeOrgLabel: activeOrgId, isSystemOrg: false };
  }
}

module.exports = {
  resolveEmailManagementOrgContext,
  resolveEmailTemplateOrgContext,
  canManageEmailManagementInActiveOrg,
  canManageEmailTemplates,
  isSystemTemplateOrg,
  resolveActiveOrgEmailContext
};
