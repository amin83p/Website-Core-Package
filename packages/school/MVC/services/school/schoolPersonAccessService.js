const { requireCoreModule, constants } = require('./schoolCoreContracts');
const schoolIdentityLookupService = require('./schoolIdentityLookupService');

const dataService = requireCoreModule('MVC/services/dataService');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { resolveCanonicalOrganizationName } = requireCoreModule('MVC/utils/organizationDisplay');
const { normalizeOrgRoleTokens } = require('../../utils/schoolRoleTokenUtils');

const SYSTEM_CONTEXT = constants.SYSTEM_CONTEXT;
const authContextInvalidationService = requireCoreModule('MVC/services/cache/authContextInvalidationService');

async function invalidateLinkedUserAuthContext(personId) {
  await authContextInvalidationService.invalidateAuthContextForPersonId(personId);
}

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
  if (!person || typeof person !== 'object') {
    return normalizeText(fallback);
  }
  const preferred = readNamePart(person, 'preferred');
  if (preferred) return preferred;
  const first = readNamePart(person, 'first');
  const last = readNamePart(person, 'last');
  const organizationLegalName = normalizeText(person?.organizationProfile?.legalName || person?.organizationLegalName);
  return [first, last].filter(Boolean).join(' ')
    || organizationLegalName
    || normalizeText(person.displayName || person.fullName || (typeof person.name === 'string' ? person.name : ''))
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
    await invalidateLinkedUserAuthContext(normalizeId(person.id || person.personId));
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
  await invalidateLinkedUserAuthContext(normalizeId(person.id || person.personId));

  return {
    changed: true,
    personId: normalizeId(person.id || person.personId),
    beforeOrganizations
  };
}

async function restorePersonOrganizations({ personId, organizations = [], reqUser, options = {} } = {}) {
  const person = await getPersonById({ reqUser, personId, requireSchoolRole: false });
  if (!person) return null;
  const updated = await dataService.updateData(
    'persons',
    normalizeId(person.id || person.personId),
    { ...person, organizations: Array.isArray(organizations) ? organizations : [] },
    SYSTEM_CONTEXT,
    options
  );
  await invalidateLinkedUserAuthContext(normalizeId(person.id || person.personId));
  return updated;
}

function resolveActiveClassInstructor(classData = {}) {
  const instructors = Array.isArray(classData?.instructors) ? classData.instructors : [];
  const active = instructors.find((row) => normalizeText(row?.status).toLowerCase() === 'active') || instructors[0] || null;
  return {
    teacherId: normalizeId(active?.personId),
    teacherName: normalizeText(active?.name)
  };
}

function isTimesheetApprovedSessionLock(session = {}) {
  const locked = session?.locked === true || String(session?.locked) === 'true';
  return locked && normalizeText(session?.lockReason) === 'timesheet_approved';
}

function applyCanonicalTeacherNames({
  classData = {},
  sessions = [],
  nameByPersonId = new Map(),
  fillMissingTeacher = true
} = {}) {
  const fallback = resolveActiveClassInstructor(classData);
  const nameFor = (personId, snapshot = '') => {
    const id = normalizeId(personId);
    const canonical = id ? normalizeText(nameByPersonId.get(id)) : '';
    if (canonical) return canonical;
    if (id && idsEqual(id, fallback.teacherId) && fallback.teacherName) return fallback.teacherName;
    return normalizeText(snapshot);
  };
  const instructors = (Array.isArray(classData?.instructors) ? classData.instructors : []).map((row) => {
    const personId = normalizeId(row?.personId);
    const nextName = nameFor(personId, row?.name);
    if (!nextName || nextName === normalizeText(row?.name)) return row;
    return { ...row, personId, name: nextName };
  });
  const incomingNames = {};
  let blankFilled = 0;
  const nextSessions = (Array.isArray(sessions) ? sessions : []).map((session) => {
    const row = session && typeof session === 'object' ? { ...session } : {};
    const delivery = row.delivery && typeof row.delivery === 'object' ? { ...row.delivery } : {};
    const incomingName = normalizeText(delivery.deliveredByName);
    const incomingKey = incomingName || '(blank)';
    incomingNames[incomingKey] = (incomingNames[incomingKey] || 0) + 1;
    let teacherId = normalizeId(delivery.deliveredBy);
    if (!teacherId && fillMissingTeacher && !isTimesheetApprovedSessionLock(row) && fallback.teacherId) {
      teacherId = fallback.teacherId;
      blankFilled += 1;
    }
    if (teacherId) delivery.deliveredBy = teacherId;
    const nextName = nameFor(teacherId, teacherId ? incomingName : '');
    if (nextName) delivery.deliveredByName = nextName;
    else if (!teacherId) delivery.deliveredByName = '';
    if (Array.isArray(delivery.coTeachers)) {
      delivery.coTeachers = delivery.coTeachers.map((coTeacher) => {
        const personId = normalizeId(coTeacher?.personId);
        const nextCoName = nameFor(personId, coTeacher?.name);
        if (!personId || !nextCoName || nextCoName === normalizeText(coTeacher?.name)) return coTeacher;
        return { ...coTeacher, personId, name: nextCoName };
      });
    }
    row.delivery = delivery;
    return row;
  });
  const outgoingNames = {};
  nextSessions.forEach((row) => {
    const key = normalizeText(row?.delivery?.deliveredByName) || '(blank)';
    outgoingNames[key] = (outgoingNames[key] || 0) + 1;
  });
  return { sessions: nextSessions, instructors, blankFilled, incomingNames, outgoingNames };
}

async function applyCanonicalTeacherNamesToClassSessions({
  classData = {},
  sessions = [],
  reqUser,
  fillMissingTeacher = true
} = {}) {
  const ids = new Set();
  const addId = (value) => {
    const id = normalizeId(value);
    if (id) ids.add(id);
  };
  addId(resolveActiveClassInstructor(classData).teacherId);
  (Array.isArray(classData?.instructors) ? classData.instructors : []).forEach((row) => addId(row?.personId));
  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    addId(session?.delivery?.deliveredBy);
    (Array.isArray(session?.delivery?.coTeachers) ? session.delivery.coTeachers : []).forEach((row) => addId(row?.personId));
  });
  let personById = new Map();
  if (ids.size) {
    try {
      personById = await buildPersonByIdMap({ reqUser, personIds: [...ids] });
    } catch (_) {
      personById = new Map();
    }
  }
  const nameByPersonId = new Map();
  personById.forEach((person, id) => {
    const name = formatPersonName(person, '');
    if (name) nameByPersonId.set(normalizeId(id), name);
  });
  return applyCanonicalTeacherNames({ classData, sessions, nameByPersonId, fillMissingTeacher });
}

module.exports = {
  applyCanonicalTeacherNames,
  applyCanonicalTeacherNamesToClassSessions,
  buildPersonByIdMap,
  ensurePersonHasSchoolRole,
  formatPersonName,
  getPersonById,
  listActiveOrgPersons,
  listPickerPersons,
  readPersonEmail,
  removePersonSchoolRole,
  resolveActiveClassInstructor,
  restorePersonOrganizations,
  toPickerRow
};
