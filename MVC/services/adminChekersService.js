// Compatibility wrapper for the historical misspelled service name.
// New code should prefer adminAuthorityService directly.
const adminAuthorityService = require('./adminAuthorityService');

function isSuperAdmin(user, orgContext) {
  return adminAuthorityService.isSuperAdmin(user, orgContext);
}

function isAdmin(user, orgContext) {
  return adminAuthorityService.isAdmin(user, orgContext);
}

async function isAdminAsync(user, orgContext) {
  return adminAuthorityService.isAdminAsync(user, orgContext);
}

function isOrgAdmin(user, orgContext) {
  return adminAuthorityService.isOrgAdmin(user, orgContext);
}

async function isOrgAdminAsync(user, orgContext) {
  return adminAuthorityService.isOrgAdminAsync(user, orgContext);
}

module.exports = {
  ...adminAuthorityService,
  isSuperAdmin,
  isAdmin,
  isAdminAsync,
  isOrgAdmin,
  isOrgAdminAsync
};
