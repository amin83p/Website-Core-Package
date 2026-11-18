'use strict';

const adminAuthorityService = require('./adminAuthorityService');
const packageEvolutionPathMapperService = require('./packageEvolutionPathMapperService');

function normalizeCategory(value = '') {
  return String(value || '').trim().toUpperCase();
}

function getActiveProfile(user) {
  const profile = user?.activeProfile;
  if (!profile || typeof profile !== 'object' || profile.active === false) return null;
  return profile;
}

function categoryMapsToPackage(category = '') {
  const token = normalizeCategory(category);
  if (!token) return '';
  if (token === 'SYSTEM' || token === 'CORE') return 'CORE';
  return token;
}

function resolveAccessiblePackagesSync(user) {
  if (!user) return [];
  const allPackages = packageEvolutionPathMapperService.listKnownPackageNames();

  if (adminAuthorityService.isSuperAdmin(user)) return allPackages;

  const profile = getActiveProfile(user);
  if (profile && profile.fullAdmin === true) return allPackages;

  if (adminAuthorityService.isSystemAdmin(user)) return allPackages;

  const categories = profile && Array.isArray(profile.adminCategories)
    ? profile.adminCategories.map(normalizeCategory).filter(Boolean)
    : [];

  if (!categories.length) {
    if (adminAuthorityService.hasAnyAdminPrivilege(user)) return ['CORE'];
    return [];
  }

  const packages = new Set();
  for (const category of categories) {
    const pkg = categoryMapsToPackage(category);
    if (pkg) packages.add(pkg);
    if (allPackages.includes(category)) packages.add(category);
  }
  return [...packages].sort((a, b) => a.localeCompare(b));
}

function canViewPackageEvolution(user) {
  return resolveAccessiblePackagesSync(user).length > 0;
}

function assertPackageAccess(user, packageName = '') {
  const token = normalizeCategory(packageName);
  if (!token) return false;
  const allowed = resolveAccessiblePackagesSync(user);
  return allowed.includes(token);
}

module.exports = {
  resolveAccessiblePackagesSync,
  canViewPackageEvolution,
  assertPackageAccess
};