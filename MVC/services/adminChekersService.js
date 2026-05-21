// Compatibility wrapper for the historical misspelled service name.
// New code should prefer adminAuthorityService directly.
const adminAuthorityService = require('./adminAuthorityService');

function isSuperAdmin(user, orgContext) {
  return adminAuthorityService.isSuperAdmin(user, orgContext);
}

function isAdmin(user, orgContext) {
  return adminAuthorityService.isSystemAdmin(user, orgContext);
}

function isOrgAdmin(user, orgContext) {
  return adminAuthorityService.isOrgAdmin(user, orgContext);
}

module.exports = {
  ...adminAuthorityService,
  isSuperAdmin,
  isAdmin,
  isOrgAdmin
};
