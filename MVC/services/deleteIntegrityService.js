const logRepository = require('../repositories/logRepository');
const userRepository = require('../repositories/userRepository');
const personRepository = require('../repositories/personRepository');

const deleteIntegrityService = {
  async assertUserCanBeDeleted(userId) {
    const historyCount = await logRepository.countByUserId(userId);
    if (historyCount > 0) {
      throw new Error(`<b>Constraint Violation:</b><br>Cannot delete User. This account has <b>${historyCount}</b> associated activity logs.<br>Deleting this user would corrupt the audit trail. Please <b>Suspend</b> the user instead.`);
    }
  },

  async assertPersonCanBeDeleted(personId) {
    const hasLinkedUser = await userRepository.existsByPersonId(personId);
    if (!hasLinkedUser) return;

    const linkedUsers = await userRepository.findByPersonId(personId);
    const userRef = linkedUsers[0]?.username || linkedUsers[0]?.email || linkedUsers[0]?.id || 'Unknown User';
    throw new Error(`<b>Constraint Violation:</b><br>Cannot delete Person (ID: ${personId}).<br>A User account (<b>${userRef}</b>) is currently linked to this profile.<br>Please delete or unlink the User account first.`);
  },

  async assertOrganizationCanBeDeleted(orgId) {
    // Direct org delete via dataService is blocked at the controller in favor of
    // organizationPurgeService (multi-step cascade). Keep this guard for any
    // remaining gateway callers so linked persons cannot orphan silently.
    const linkedPersonCount = await personRepository.countByOrganizationId(orgId);
    if (linkedPersonCount <= 0) return;

    const linkedPersons = await personRepository.findByOrganizationId(orgId, {
      limit: 3,
      enrichment: { includeSchoolRoles: false }
    });
    const names = linkedPersons
      .slice(0, 3)
      .map((p) => `${p?.name?.first || ''} ${p?.name?.last || ''}`.trim())
      .filter(Boolean)
      .join(', ');
    const more = linkedPersonCount > 3 ? ` and ${linkedPersonCount - 3} others` : '';
    const examples = names ? ` (e.g., ${names}${more})` : '';
    throw new Error(`<b>Constraint Violation:</b><br>Cannot delete Organization (ID: ${orgId}).<br>There are <b>${linkedPersonCount}</b> persons linked to this organization${examples}.<br>Use the Organizations purge wizard to review and delete related data.`);
  }
};

module.exports = deleteIntegrityService;

