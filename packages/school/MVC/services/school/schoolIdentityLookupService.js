const { requireCoreModule, constants } = require('./schoolCoreContracts');

const dataService = requireCoreModule('MVC/services/dataService');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const SYSTEM_CONTEXT = constants.SYSTEM_CONTEXT;
const PERSON_QUERY_OPTIONS = Object.freeze({ enrichment: { includeSchoolRoles: false } });

function normalizeId(value) {
  return toPublicId(value);
}

function normalizeText(value) {
  return String(value || '').trim();
}

function getActiveOrgId(reqUser = {}) {
  return normalizeId(reqUser.activeOrgId || reqUser.orgId || reqUser.organizationId);
}

function readStatus(row = {}) {
  return normalizeText(row.status || row.state || row.lifecycleStatus || row.accountStatus || 'active').toLowerCase();
}

function isActiveRow(row = {}) {
  return !['archived', 'deleted', 'inactive', 'disabled', 'removed', 'suspended'].includes(readStatus(row));
}

function membershipOrgId(entry = {}) {
  return normalizeId(entry.orgId || entry.organizationId || entry.id);
}

function membershipIsActive(entry = {}) {
  const status = normalizeText(entry.memberStatus || entry.status || 'active').toLowerCase();
  return !['archived', 'deleted', 'inactive', 'disabled', 'removed', 'suspended'].includes(status);
}

function roleTokensFromMembership(entry = {}) {
  const raw = Array.isArray(entry.roles) ? entry.roles : (entry.role ? [entry.role] : []);
  return raw
    .flatMap((token) => String(token || '').split(/[\s,;|]+/))
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .flatMap((token) => {
      if (token === 'memberschool_student') return ['member', 'school_student'];
      if (token === 'memberschool_teacher') return ['member', 'school_teacher'];
      if (token === 'memberschool_staff') return ['member', 'school_staff'];
      return [token];
    });
}

function personBelongsToOrg(person = {}, activeOrgId = '') {
  if (!activeOrgId) return false;
  const memberships = Array.isArray(person.organizations) ? person.organizations : [];
  if (!memberships.length) return true;
  return memberships.some((entry) => idsEqual(membershipOrgId(entry), activeOrgId) && membershipIsActive(entry));
}

function userBelongsToOrg(user = {}, activeOrgId = '') {
  if (!activeOrgId) return false;
  const directOrgIds = [
    user.primaryOrgId,
    user.activeOrgId,
    user.orgId,
    user.organizationId
  ].map(normalizeId).filter(Boolean);
  if (directOrgIds.some((orgId) => idsEqual(orgId, activeOrgId))) return true;
  const memberships = Array.isArray(user.organizations) ? user.organizations : [];
  if (!memberships.length && !directOrgIds.length) return true;
  return memberships.some((entry) => {
    if (typeof entry === 'string' || typeof entry === 'number') return idsEqual(entry, activeOrgId);
    return idsEqual(membershipOrgId(entry), activeOrgId) && membershipIsActive(entry);
  });
}

function extractSchoolRoles(person = {}, activeOrgId = '') {
  const memberships = Array.isArray(person.organizations) ? person.organizations : [];
  const roles = new Set();
  memberships.forEach((entry) => {
    if (activeOrgId && !idsEqual(membershipOrgId(entry), activeOrgId)) return;
    if (!membershipIsActive(entry)) return;
    roleTokensFromMembership(entry)
      .filter((role) => role.startsWith('school_'))
      .forEach((role) => roles.add(role));
  });
  return [...roles].sort();
}

function normalizeAllowedSchoolRoles(value = []) {
  const raw = Array.isArray(value)
    ? value
    : String(value || '').split(/[\s,;|]+/);
  return new Set(raw
    .map((role) => normalizeText(role).toLowerCase())
    .filter(Boolean)
    .map((role) => (role.startsWith('school_') ? role : `school_${role}`)));
}

function hasAllowedSchoolRole(row = {}, allowedRoles = new Set()) {
  if (!allowedRoles || allowedRoles.size === 0) return true;
  const roles = Array.isArray(row.roles) ? row.roles : (Array.isArray(row.schoolRoles) ? row.schoolRoles : []);
  return roles
    .map((role) => normalizeText(role).toLowerCase())
    .some((role) => allowedRoles.has(role.startsWith('school_') ? role : `school_${role}`));
}

function formatPersonName(person = {}, fallback = '') {
  const preferred = normalizeText(person.preferredName || person.name?.preferred);
  if (preferred) return preferred;
  const first = normalizeText(person.firstName || person.name?.first);
  const last = normalizeText(person.lastName || person.name?.last);
  return [first, last].filter(Boolean).join(' ')
    || normalizeText(person.displayName || person.fullName || person.name)
    || fallback;
}

function readPersonEmail(person = {}) {
  const emails = Array.isArray(person.contact?.emails) ? person.contact.emails : [];
  return normalizeText(person.contact?.email || person.contact?.primaryEmail || person.email || emails[0]?.email);
}

function readUserEmail(user = {}) {
  return normalizeText(user.email || user.identity?.email || user.profile?.email);
}

function userDisplayName(user = {}, linkedPerson = null) {
  return normalizeText(user.identity?.displayName || user.displayName || user.name)
    || (linkedPerson ? formatPersonName(linkedPerson, '') : '')
    || normalizeText(user.username || user.email || user.id);
}

function rowMatchesQuery(row = {}, q = '') {
  const query = normalizeText(q).toLowerCase();
  if (!query) return true;
  return [
    row.id,
    row.personId,
    row.userId,
    row.username,
    row.displayName,
    row.name,
    row.email,
    ...(Array.isArray(row.roles) ? row.roles : [])
  ].join(' ').toLowerCase().includes(query);
}

function paginateRows(rows = [], query = {}) {
  const page = Math.max(1, Number.parseInt(String(query.page || '1'), 10) || 1);
  const limit = Math.max(1, Math.min(100, Number.parseInt(String(query.limit || '20'), 10) || 20));
  const start = (page - 1) * limit;
  return {
    data: rows.slice(start, start + limit),
    pagination: {
      page,
      limit,
      totalItems: rows.length,
      totalPages: Math.max(1, Math.ceil(rows.length / limit))
    }
  };
}

async function fetchCoreRows(entityType, query = {}, options = {}) {
  return dataService.fetchData(entityType, query, SYSTEM_CONTEXT, options);
}

async function listSchoolPersons({ reqUser, q = '', query = {}, requireSchoolRole = false, allowedSchoolRoles = [] } = {}) {
  const activeOrgId = getActiveOrgId(reqUser);
  if (!activeOrgId) return { rows: [], pagination: paginateRows([], query).pagination };
  const allowedRoles = normalizeAllowedSchoolRoles(allowedSchoolRoles);
  const persons = await fetchCoreRows('persons', {}, PERSON_QUERY_OPTIONS);
  const mapped = (Array.isArray(persons) ? persons : [])
    .filter((person) => personBelongsToOrg(person, activeOrgId))
    .filter(isActiveRow)
    .map((person) => {
      const personId = normalizeId(person.id || person.personId);
      const roles = extractSchoolRoles(person, activeOrgId);
      const firstName = normalizeText(person.firstName || person.name?.first);
      const lastName = normalizeText(person.lastName || person.name?.last);
      const preferredName = normalizeText(person.preferredName || person.name?.preferred);
      return {
        id: personId,
        personId,
        displayName: formatPersonName(person, personId),
        name: formatPersonName(person, personId),
        firstName,
        lastName,
        preferredName,
        email: readPersonEmail(person),
        roles,
        schoolRoles: roles,
        status: readStatus(person) || 'active'
      };
    })
    .filter((row) => row.id)
    .filter((row) => !requireSchoolRole || row.roles.length > 0)
    .filter((row) => hasAllowedSchoolRole(row, allowedRoles))
    .filter((row) => rowMatchesQuery(row, q || query.q));
  const sorted = mapped.sort((a, b) => String(a.displayName || a.id).localeCompare(String(b.displayName || b.id)));
  const { data, pagination } = paginateRows(sorted, query);
  return { rows: data, pagination, allRows: sorted };
}

async function listSchoolUsers({ reqUser, q = '', query = {}, requireSchoolPerson = true } = {}) {
  const activeOrgId = getActiveOrgId(reqUser);
  if (!activeOrgId) return { rows: [], pagination: paginateRows([], query).pagination };
  const [users, persons] = await Promise.all([
    fetchCoreRows('users', {}),
    fetchCoreRows('persons', {}, PERSON_QUERY_OPTIONS)
  ]);
  const personById = new Map((Array.isArray(persons) ? persons : [])
    .filter((person) => personBelongsToOrg(person, activeOrgId))
    .map((person) => [normalizeId(person.id || person.personId), person])
    .filter(([id]) => Boolean(id)));
  const mapped = (Array.isArray(users) ? users : [])
    .filter((user) => userBelongsToOrg(user, activeOrgId))
    .filter(isActiveRow)
    .map((user) => {
      const userId = normalizeId(user.id || user.userId || user._id);
      const personId = normalizeId(user.personId || user.identity?.personId || user.profile?.personId);
      const person = personId ? personById.get(personId) : null;
      const roles = person ? extractSchoolRoles(person, activeOrgId) : [];
      return {
        id: userId,
        userId,
        personId,
        displayName: userDisplayName(user, person),
        name: userDisplayName(user, person),
        username: normalizeText(user.username),
        email: readUserEmail(user) || (person ? readPersonEmail(person) : ''),
        roles,
        schoolRoles: roles,
        status: readStatus(user) || 'active'
      };
    })
    .filter((row) => row.id)
    .filter((row) => !requireSchoolPerson || (row.personId && row.roles.length > 0))
    .filter((row) => rowMatchesQuery(row, q || query.q));
  const sorted = mapped.sort((a, b) => String(a.displayName || a.id).localeCompare(String(b.displayName || b.id)));
  const { data, pagination } = paginateRows(sorted, query);
  return { rows: data, pagination, allRows: sorted };
}

async function listTaggableUsers({ reqUser, q = '', query = {} } = {}) {
  return listSchoolUsers({ reqUser, q, query, requireSchoolPerson: true });
}

module.exports = {
  listSchoolPersons,
  listSchoolUsers,
  listTaggableUsers
};
