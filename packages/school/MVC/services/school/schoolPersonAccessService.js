const { requireCoreModule, constants } = require('./schoolCoreContracts');
const schoolIdentityLookupService = require('./schoolIdentityLookupService');

const dataService = requireCoreModule('MVC/services/dataService');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { resolveCanonicalOrganizationName } = requireCoreModule('MVC/utils/organizationDisplay');
const { normalizeOrgRoleTokens } = require('../../utils/schoolRoleTokenUtils');

const SYSTEM_CONTEXT = constants.SYSTEM_CONTEXT;

function normalizeId(value) {
  return toPublicId(value);
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeRole(value) {
  const role = normalizeText(value).toLowerCase();
  if (!role) return '';
  return role.startsWith('school_') ? role : `school_${role}`;
}

function readNamePart(person = {}, key = '') {
  return normalizeText(
    person?.name?.[key]
    || person?.[`${key}Name`]
    || person?.[`${key}_name`]
  );
}

function formatPersonName(person = {}, fallback = '') {
  const preferred = readNamePart(person, 'preferred');
  if (preferred) return preferred;
  const first = readNamePart(person, 'first');
  const last = readNamePart(person, 'last');
  return [first, last].filter(Boolean).join(' ')
    || normalizeText(person.displayName || person.fullName || person.name)
    || normalizeText(fallback);
}

function readPersonEmail(person = {}) {
  const emails = Array.isArray(person.contact?.emails) ? person.contact.emails : [];
  return normalizeText(person.contact?.email || person.contact?.primaryEmail || person.email || emails[0]?.email);
}

function toPickerRow(person = {}) {
  const personId = normalizeId(person.id || person.personId);
  const firstName = readNamePart(person, 'first');
  const lastName = readNamePart(person, 'last');
  const preferredName = readNamePart(person, 'preferred');
  const displayName = formatPersonName(person, personId);
  const roles = Array.isArray(person.schoolRoles)
    ? person.schoolRoles
    : (Array.isArray(person.roles) ? person.roles : []);
  return {
    id: personId,
    personId,
    displayName,
    name: displayName,
    firstName,
    lastName,
    preferredName,
    email: readPersonEmail(person),
    roles,
    schoolRoles: roles,
    status: normalizeText(person.status || person.state || person.lifecycleStatus || 'active') || 'active'
  };
}

async function listActiveOrgPersons({ reqUser, q = '', query = {}, requireSchoolRole = false, allowedSchoolRoles = [] } = {}) {
  const payload = await schoolIdentityLookupService.listSchoolPersonRecords({
    reqUser,
    q,
    query,
    requireSchoolRole,
    allowedSchoolRoles
  });
  return payload?.allRows || payload?.rows || [];
}

async function listPickerPersons({ reqUser, q = '', query = {}, requireSchoolRole = false, allowedSchoolRoles = [] } = {}) {
  const payload = await schoolIdentityLookupService.listSchoolPersons({
    reqUser,
    q,
    query,
    requireSchoolRole,
    allowedSchoolRoles
  });
  return {
    rows: payload?.rows || [],
    allRows: payload?.allRows || payload?.rows || [],
    pagination: payload?.pagination || {}
  };
}

async function getPersonById({ reqUser, personId, requireSchoolRole = false, allowedSchoolRoles = [] } = {}) {
  const targetId = normalizeId(personId);
  if (!targetId) return null;
  const rows = await listActiveOrgPersons({
    reqUser,
    q: targetId,
    query: { q: targetId, limit: 5000 },
    requireSchoolRole,
    allowedSchoolRoles
  });
  return (Array.isArray(rows) ? rows : [])
    .find((row) => idsEqual(row?.id || row?.personId, targetId)) || null;
}

async function buildPersonByIdMap({ reqUser, personIds = [], requireSchoolRole = false, allowedSchoolRoles = [] } = {}) {
  const wanted = new Set((Array.isArray(personIds) ? personIds : [])
    .map(normalizeId)
    .filter(Boolean));
  const rows = await listActiveOrgPersons({
    reqUser,
    query: { limit: 5000 },
    requireSchoolRole,
    allowedSchoolRoles
  });
  return new Map((Array.isArray(rows) ? rows : [])
    .filter((person) => {
      const personId = normalizeId(person?.id || person?.personId);
      return personId && (!wanted.size || wanted.has(personId));
    })
    .map((person) => [normalizeId(person.id || person.personId), person]));
}

async function getOrganizationName(orgId) {
  const targetOrgId = normalizeId(orgId);
  if (!targetOrgId) return '';
  try {
    const org = await dataService.getDataById('organizations', targetOrgId, SYSTEM_CONTEXT);
    return resolveCanonicalOrganizationName(org || {});
  } catch (_) {
    return '';
  }
}

async function ensurePersonHasSchoolRole({ personId, orgId, role, reqUser, options = {} } = {}) {
  const targetRole = normalizeRole(role);
  if (!targetRole) throw new Error('School role is required.');
  const person = await getPersonById({ reqUser, personId, requireSchoolRole: false });
  if (!person) throw new Error('Linked person record was not found.');

  const targetOrgId = normalizeId(orgId);
  const list = Array.isArray(person.organizations) ? person.organizations.slice() : [];
  const now = new Date().toISOString();
  const idx = list.findIndex((org) => idsEqual(org?.orgId || org?.organizationId || org?.id, targetOrgId));
  const orgName = await getOrganizationName(targetOrgId);
  let changed = false;

  if (idx >= 0) {
    const org = { ...list[idx] };
    const roles = normalizeOrgRoleTokens(org);
    if (!roles.includes(targetRole)) {
      roles.push(targetRole);
      changed = true;
    }
    org.roles = roles;
    org.role = roles[0] || 'member';
    if (!org.memberStatus) {
      org.memberStatus = 'active';
      changed = true;
    }
    if (!org.joinedAt) {
      org.joinedAt = now;
      changed = true;
    }
    if (orgName && normalizeText(org.name) !== orgName) {
      org.name = orgName;
      changed = true;
    }
    list[idx] = org;
  } else {
    list.push({
      orgId: Number.isFinite(Number(targetOrgId)) ? Number(targetOrgId) : targetOrgId,
      name: orgName,
      roles: ['member', targetRole].filter((value, index, arr) => arr.indexOf(value) === index),
      role: 'member',
      memberStatus: 'active',
      joinedAt: now
    });
    changed = true;
  }

  if (changed) {
    await dataService.updateData('persons', normalizeId(person.id || person.personId), { ...person, organizations: list }, SYSTEM_CONTEXT, options);
  }

  return {
    changed,
    personId: normalizeId(person.id || person.personId),
    beforeOrganizations: Array.isArray(person.organizations) ? JSON.parse(JSON.stringify(person.organizations)) : []
  };
}

async function removePersonSchoolRole({ personId, orgId, role, reqUser, options = {} } = {}) {
  const targetRole = normalizeRole(role);
  if (!targetRole) return { changed: false, skipped: true, reason: 'role_not_defined' };
  const person = await getPersonById({ reqUser, personId, requireSchoolRole: false });
  if (!person) return { changed: false, skipped: true, reason: 'person_not_found' };

  const targetOrgId = normalizeId(orgId);
  const list = Array.isArray(person.organizations) ? person.organizations.slice() : [];
  const idx = list.findIndex((org) => idsEqual(org?.orgId || org?.organizationId || org?.id, targetOrgId));
  if (idx < 0) return { changed: false, personId: normalizeId(person.id || person.personId), reason: 'organization_link_not_found' };

  const org = { ...list[idx] };
  const roles = normalizeOrgRoleTokens(org);
  if (!roles.includes(targetRole)) return { changed: false, personId: normalizeId(person.id || person.personId), reason: 'school_role_not_attached' };

  const nextRoles = roles.filter((candidate) => candidate !== targetRole);
  org.roles = nextRoles.length ? nextRoles : ['member'];
  org.role = org.roles[0] || 'member';
  if (!org.memberStatus) org.memberStatus = 'active';
  if (!org.joinedAt) org.joinedAt = new Date().toISOString();
  list[idx] = org;

  const beforeOrganizations = Array.isArray(person.organizations) ? JSON.parse(JSON.stringify(person.organizations)) : [];
  await dataService.updateData('persons', normalizeId(person.id || person.personId), { ...person, organizations: list }, SYSTEM_CONTEXT, options);

  return {
    changed: true,
    personId: normalizeId(person.id || person.personId),
    beforeOrganizations
  };
}

async function restorePersonOrganizations({ personId, organizations = [], reqUser, options = {} } = {}) {
  const person = await getPersonById({ reqUser, personId, requireSchoolRole: false });
  if (!person) return null;
  return dataService.updateData(
    'persons',
    normalizeId(person.id || person.personId),
    { ...person, organizations: Array.isArray(organizations) ? organizations : [] },
    SYSTEM_CONTEXT,
    options
  );
}

module.exports = {
  buildPersonByIdMap,
  ensurePersonHasSchoolRole,
  formatPersonName,
  getPersonById,
  listActiveOrgPersons,
  listPickerPersons,
  readPersonEmail,
  removePersonSchoolRole,
  restorePersonOrganizations,
  toPickerRow
};
