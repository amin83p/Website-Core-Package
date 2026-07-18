function normalizeOrgRoles(membership = {}) {
  const candidates = [
    membership.role,
    membership.roleId,
    membership.roleKey,
    membership.type,
    membership.membershipType,
    membership.roles
  ];
  const roles = [];
  candidates.forEach((candidate) => {
    if (Array.isArray(candidate)) {
      candidate.forEach((row) => roles.push(row));
    } else if (candidate !== undefined && candidate !== null) {
      roles.push(candidate);
    }
  });
  return roles.map((role) => String(role || '').trim().toLowerCase()).filter(Boolean);
}

const PERSON_ROLE_DELETE_BLOCK_ORDER = ['school_student', 'school_teacher', 'school_staff', 'school_funder'];
const PERSON_ROLE_DISPLAY_LABELS = Object.freeze({
  school_student: 'student',
  school_teacher: 'teacher',
  school_staff: 'staff',
  school_funder: 'funder'
});
const PERSON_ROLE_ALIASES = {};
const PERSON_ROLE_DELETE_BLOCKED_SET = new Set([
  ...PERSON_ROLE_DELETE_BLOCK_ORDER,
  ...Object.keys(PERSON_ROLE_ALIASES)
]);

function collectBlockedSchoolRoleLinks(person) {
  const memberships = Array.isArray(person?.organizations) ? person.organizations : [];
  const rolesSet = new Set();
  const dedupe = new Set();
  const matches = [];

  memberships.forEach((org) => {
    const rawRoles = normalizeOrgRoles(org);
    rawRoles.forEach((roleValue) => {
      const normalized = String(roleValue || '').trim().toLowerCase();
      if (!normalized || !PERSON_ROLE_DELETE_BLOCKED_SET.has(normalized)) return;

      const canonicalRole = PERSON_ROLE_ALIASES[normalized] || normalized;
      const orgId = String(org?.orgId || '').trim() || 'UNKNOWN';
      const orgName = String(org?.name || '').trim();
      const key = `${canonicalRole}|${orgId}|${orgName}`;
      if (dedupe.has(key)) return;
      dedupe.add(key);

      rolesSet.add(canonicalRole);
      matches.push({ role: canonicalRole, orgId, orgName });
    });
  });

  return { roles: Array.from(rolesSet), matches };
}

function buildDeleteBlockedBySchoolRoleMessage(roleScan) {
  const roleLabels = roleScan.roles.map((role) => `<b>${PERSON_ROLE_DISPLAY_LABELS[role] || role}</b>`).join(', ');
  const preview = roleScan.matches.slice(0, 8);
  const rows = preview.map((item) => {
    const orgLabel = item.orgName ? `${item.orgName} (${item.orgId})` : `Org ${item.orgId}`;
    return `- ${PERSON_ROLE_DISPLAY_LABELS[item.role] || item.role} in ${orgLabel}`;
  });
  const extraCount = Math.max(0, roleScan.matches.length - preview.length);
  const extraLine = extraCount ? `<br>...and ${extraCount} more linked role assignment(s).` : '';
  const details = rows.length ? `<br><br>${rows.join('<br>')}${extraLine}` : '';

  return `<b>Deletion blocked.</b><br>This person is assigned as ${roleLabels} in school records.<br>Please resolve/archive the related records in Students, Teachers, Staff, or School Funders before deleting this person.${details}`;
}

async function collectPersonDeleteBlocks(person) {
  const roleScan = collectBlockedSchoolRoleLinks(person);
  if (!roleScan.roles.length) return [];
  return [{
    statusCode: 409,
    message: buildDeleteBlockedBySchoolRoleMessage(roleScan)
  }];
}

module.exports = {
  collectPersonDeleteBlocks,
  collectBlockedSchoolRoleLinks
};
