const organizationRepository = require('../repositories/organizationRepository');
const adminChekersService = require('../services/adminChekersService');

function normalizeOrgRoles(orgMembership) {
  const rawRoles = Array.isArray(orgMembership?.roles)
    ? orgMembership.roles
    : (orgMembership?.role ? [orgMembership.role] : []);
  const normalized = rawRoles
    .map((role) => String(role || '').trim().toLowerCase())
    .filter(Boolean)
    .filter((role, idx, arr) => arr.indexOf(role) === idx);
  return normalized.length ? normalized : ['member'];
}

function getPrimaryOrgRole(orgMembership, fallback = 'member') {
  const roles = normalizeOrgRoles(orgMembership);
  return roles[0] || fallback;
}

function getOrgRolesDisplay(orgMembership, fallback = 'member') {
  const roles = normalizeOrgRoles(orgMembership);
  return roles.length ? roles.join(', ') : fallback;
}

function getActiveOrgIdOrThrow(reqUser) {
  const activeOrgId = reqUser?.activeOrgId ? String(reqUser.activeOrgId) : '';
  if (!activeOrgId) {
    throw new Error('<b>Security Violation</b><br>No active organization context found.');
  }
  return activeOrgId;
}

async function assertCreateOrgContextOrThrow(reqUser, options = {}) {
  const activeOrgId = getActiveOrgIdOrThrow(reqUser);
  const scopeLabel = String(options.scopeLabel || 'new records').trim();

  if (String(activeOrgId).toUpperCase() === 'SYSTEM') {
    throw new Error(
      `<b>Organization Required</b><br>You are currently in <b>SYSTEM / GLOBAL MODE</b>.<br>Please switch to a valid organization before adding ${scopeLabel}.`
    );
  }

  let org = null;
  try {
    org = await organizationRepository.getById(activeOrgId);
  } catch (_) {
    org = null;
  }

  if (!org) {
    throw new Error(
      '<b>Organization Required</b><br>Your active organization is not found in the Organizations table.<br>Please switch to an existing organization (not SYSTEM / GLOBAL MODE) and try again.'
    );
  }

  return String(activeOrgId);
}

async function canCreateOrgScopedItem(reqUser, options = {}) {
  try {
    await assertCreateOrgContextOrThrow(reqUser, options);
    return true;
  } catch (_) {
    return false;
  }
}

function assertOrgAccess(record, activeOrgId, reqUser, options = {}) {
  if (!record) return;
  if (adminChekersService.isSuperAdmin(reqUser)) return;
  if (options.allowSystemBypass && String(activeOrgId || '').toUpperCase() === 'SYSTEM') return;

  const orgField = String(options.orgField || 'orgId');
  const recordOrgId = String(record?.[orgField] || '').trim();
  if (recordOrgId && recordOrgId !== String(activeOrgId)) {
    throw new Error(options.message || '<b>Security Violation</b><br>Unauthorized organization access.');
  }
}

module.exports = {
  getActiveOrgIdOrThrow,
  assertCreateOrgContextOrThrow,
  canCreateOrgScopedItem,
  assertOrgAccess,
  normalizeOrgRoles,
  getPrimaryOrgRole,
  getOrgRolesDisplay
};
