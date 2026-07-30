const fs = require('fs');
const path = require('path');
const roleRegistryService = require('./person/roleRegistryService');
const {
  normalizeRoleToken,
  dedupe,
  buildPackageSystemRoleIndex,
  collectPackageSystemRoleAssignments
} = require('./person/packageRoleAssignmentService');

const ROOT_DIR = path.resolve(__dirname, '../..');
const PACKAGES_DIR = path.join(ROOT_DIR, 'packages');
const PACKAGE_ROLE_CONFLICT_CODE = 'PERSON_PACKAGE_ROLE_CONFLICT';

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildPackageRoleDeleteBlockedMessage(assignments = []) {
  const packageNames = dedupe(assignments.map((row) => row.packageName));
  const packageLabel = packageNames.length === 1
    ? `<b>${escapeHtml(packageNames[0])}</b>`
    : `these packages: ${packageNames.map((name) => `<b>${escapeHtml(name)}</b>`).join(', ')}`;
  const preview = assignments.slice(0, 8).map((assignment) => {
    const orgLabel = assignment.orgName
      ? `${escapeHtml(assignment.orgName)} (${escapeHtml(assignment.orgId)})`
      : `Org ${escapeHtml(assignment.orgId)}`;
    return `- ${escapeHtml(assignment.packageName)}: ${escapeHtml(assignment.roleLabel)} (<code>${escapeHtml(assignment.roleKey)}</code>) in ${orgLabel}`;
  });
  const extraCount = Math.max(0, assignments.length - preview.length);
  const extraLine = extraCount ? `<br>...and ${extraCount} more package role assignment(s).` : '';
  const details = preview.length ? `<br><br>${preview.join('<br>')}${extraLine}` : '';

  return `<b>Deletion blocked.</b><br>This person still has a system role managed by ${packageLabel}.<br>Please remove or unassign the related package account and role before deleting this person.${details}`;
}

async function collectRegisteredPackageRoleBlocks(person, context = {}) {
  const registryOptions = context?.repositoryOptions || context?.options || {};
  const registry = context?.roleRegistry || await roleRegistryService.getRoleRegistry(registryOptions);
  const assignments = collectPackageSystemRoleAssignments(person, registry);
  if (!assignments.length) return [];
  return [{
    code: PACKAGE_ROLE_CONFLICT_CODE,
    statusCode: 409,
    message: buildPackageRoleDeleteBlockedMessage(assignments),
    assignments
  }];
}

async function stripPackageSystemRolesFromOrganizations(organizations = [], context = {}) {
  const registryOptions = context?.repositoryOptions || context?.options || {};
  const registry = context?.roleRegistry || await roleRegistryService.getRoleRegistry(registryOptions);
  const { aliasToKey } = buildPackageSystemRoleIndex(registry);
  let changed = false;

  const nextOrganizations = (Array.isArray(organizations) ? organizations : []).map((membership) => {
    const sourceRoles = Array.isArray(membership?.roles)
      ? membership.roles
      : (membership?.role ? [membership.role] : []);
    const remainingRoles = sourceRoles.filter((role) => {
      const isPackageRole = aliasToKey.has(normalizeRoleToken(role));
      if (isPackageRole) changed = true;
      return !isPackageRole;
    });
    const normalizedRoles = remainingRoles.length ? remainingRoles : ['member'];
    const currentPrimaryRole = normalizeRoleToken(membership?.role);
    const primaryIsPackageRole = aliasToKey.has(currentPrimaryRole);
    if (primaryIsPackageRole) changed = true;

    const nextMembership = {
      ...(membership || {}),
      roles: normalizedRoles,
      role: primaryIsPackageRole
        ? normalizedRoles[0]
        : (membership?.role || normalizedRoles[0])
    };
    ['roleId', 'roleKey', 'type', 'membershipType'].forEach((field) => {
      if (!aliasToKey.has(normalizeRoleToken(nextMembership[field]))) return;
      delete nextMembership[field];
      changed = true;
    });
    return nextMembership;
  });

  return {
    changed,
    organizations: nextOrganizations
  };
}

function listGuardModules() {
  if (!fs.existsSync(PACKAGES_DIR)) return [];
  return fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(PACKAGES_DIR, entry.name, 'config', 'personDeletionGuard.js'))
    .filter((candidate) => fs.existsSync(candidate));
}

async function collectPersonDeleteBlocks(person, context = {}) {
  const registryBlocks = await collectRegisteredPackageRoleBlocks(person, context);
  if (registryBlocks.length) return registryBlocks;

  const blocks = [];
  for (const modulePath of listGuardModules()) {
    try {
      const guard = require(modulePath);
      if (typeof guard.collectPersonDeleteBlocks !== 'function') continue;
      const result = await guard.collectPersonDeleteBlocks(person, context);
      if (Array.isArray(result)) {
        blocks.push(...result.filter(Boolean));
      } else if (result) {
        blocks.push(result);
      }
    } catch (error) {
      blocks.push({
        statusCode: 500,
        message: `Person dependency guard failed: ${error.message}`
      });
    }
  }
  return blocks;
}

module.exports = {
  PACKAGE_ROLE_CONFLICT_CODE,
  buildPackageSystemRoleIndex,
  collectPackageSystemRoleAssignments,
  collectRegisteredPackageRoleBlocks,
  stripPackageSystemRolesFromOrganizations,
  collectPersonDeleteBlocks
};
