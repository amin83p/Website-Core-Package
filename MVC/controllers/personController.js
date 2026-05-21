// MVC/controllers/personController.js
const dataService = require('../services/dataService'); 
const {isAdmin} = require('../services/adminChekersService');
const bcrypt = require('bcrypt');
const { normalizeOrgRoles, getPrimaryOrgRole } = require('../utils/orgContextUtils');
const { idsEqual, toPublicId } = require('../utils/idAdapter');
const personRepository = require('../repositories/personRepository');
const organizationRepository = require('../repositories/organizationRepository');
const { buildDataServiceQuery } = require('../utils/generalTools');
const settingService = require('../services/settingService');
const pteStudentDataService = require('../services/pte/pteStudentDataService');
const {
  buildOrganizationDisplayMap,
  canonicalizeMembershipOrganizationNames,
  resolveCanonicalOrganizationName,
  resolveMembershipOrganizationLabel
} = require('../utils/organizationDisplay');

const { DEFAULTS, SYSTEM_CONTEXT } = require('../../config/constants');
const FREE_ORG_ID = Number(DEFAULTS?.FREE_ORG_ID || 900000);
const FREE_ORG_NAME = String(DEFAULTS?.FREE_ORG_NAME || 'Free User');
const SELF_ACCESS_LEVEL = Number(DEFAULTS?.SELF_ACCESS_LEVEL || 1);
const HIGH_ACCESS_MIN = Number(DEFAULTS?.HIGH_ACCESS_MIN || 8);
const HIGH_ACCESS_MAX = Number(DEFAULTS?.HIGH_ACCESS_MAX || 10);
const PERSON_WITH_SCHOOL_ENRICHMENT = Object.freeze({ enrichment: { includeSchoolRoles: true } });
const PERSON_LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'active', 'name.first', 'name.last', 'name.preferred'],
  allowedSearchFields: [
    'id',
    'name.first',
    'name.last',
    'name.preferred',
    'contact.emails[0].email',
    'contact.email'
  ],
  defaultSearchFields: [
    'id',
    'name.first',
    'name.last',
    'name.preferred',
    'contact.emails[0].email',
    'contact.email'
  ],
  allowMetaKeys: true
});

async function loadOrganizationDisplayMap() {
  const organizations = await organizationRepository.list({
    scope: { canViewAll: true },
    pagination: { limit: 10000 }
  });
  return buildOrganizationDisplayMap(organizations);
}

async function resolveOrgNameById(orgId, fallbackName = '') {
  const org = await organizationRepository.getById(orgId, { scope: { canViewAll: true } }).catch(() => null);
  return resolveCanonicalOrganizationName(org || {}, fallbackName);
}

async function canonicalizeOrganizationMemberships(organizations = []) {
  const organizationMap = await loadOrganizationDisplayMap();
  return canonicalizeMembershipOrganizationNames(organizations, organizationMap).value;
}

function decorateMembershipOrganizationLabels(rows = [], organizationMap = new Map()) {
  return (Array.isArray(rows) ? rows : []).map((person) => {
    const organizations = Array.isArray(person?.organizations)
      ? person.organizations.map((membership) => ({
        ...membership,
        displayLabel: resolveMembershipOrganizationLabel(membership, organizationMap)
      }))
      : person?.organizations;
    return { ...person, organizations };
  });
}

function resolveConfiguredOrgId(settingKey, fallbackValue) {
  const raw = settingService.getValue('organization', settingKey);
  const parsed = Number.parseInt(String(raw ?? '').trim(), 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  const fallbackParsed = Number.parseInt(String(fallbackValue ?? '').trim(), 10);
  if (Number.isFinite(fallbackParsed) && fallbackParsed > 0) return fallbackParsed;
  return FREE_ORG_ID;
}

function resolveFreeOrgSettingId() {
  return resolveConfiguredOrgId('freeOrgId', FREE_ORG_ID);
}

function resolvePteJoinOrgSettingId() {
  const fallbackFreeOrgId = resolveFreeOrgSettingId();
  return resolveConfiguredOrgId('pteJoinOrgId', fallbackFreeOrgId);
}

function resolveFreeOrgSettingName() {
  const name = String(settingService.getValue('organization', 'freeOrgName') || '').trim();
  return name || FREE_ORG_NAME;
}

// ... (Helper functions: parseBool, normalizeTags, validateEmail, getAccessLevel, generateTempPassword, parseJsonSafe) ...
function parseBool(v) {
  if (typeof v === 'boolean') return v;
  return String(v || '').toLowerCase().trim() === 'true';
}

function getAllowedManualTagSet() {
  return new Set(
    personRepository
      .getAllowedManualTags()
      .map((tag) => String(tag || '').trim().toLowerCase())
      .filter(Boolean)
  );
}

function getSystemRoleTagSet() {
  return new Set(
    personRepository
      .getSystemTagKeys()
      .map((tag) => String(tag || '').trim().toLowerCase())
      .filter(Boolean)
  );
}

function getOrgKey(orgId) {
  return String(orgId ?? '').trim();
}

function collectSystemRolesForOrg(org) {
  const systemRoleTagSet = getSystemRoleTagSet();
  return normalizeOrgRoles(org).filter((role) => systemRoleTagSet.has(String(role || '').trim().toLowerCase()));
}

function applyRoleLockPolicy(submittedOrganizations, existingOrganizations = []) {
  const systemRoleTagSet = getSystemRoleTagSet();
  const existingSystemByOrg = new Map();
  const submittedOrgKeySet = new Set();

  (Array.isArray(existingOrganizations) ? existingOrganizations : []).forEach((org) => {
    const orgKey = getOrgKey(org?.orgId);
    if (!orgKey) return;
    const systemRoles = collectSystemRolesForOrg(org);
    if (systemRoles.length) {
      existingSystemByOrg.set(orgKey, systemRoles);
    }
  });

  const normalized = (Array.isArray(submittedOrganizations) ? submittedOrganizations : []).map((org) => {
    const orgKey = getOrgKey(org?.orgId);
    submittedOrgKeySet.add(orgKey);

    const submittedRoles = normalizeOrgRoles(org);
    const submittedSystem = submittedRoles.filter((role) => systemRoleTagSet.has(String(role || '').trim().toLowerCase()));
    const existingSystem = existingSystemByOrg.get(orgKey) || [];

    const newlyAddedSystem = submittedSystem.filter((role) => !existingSystem.includes(role));
    if (newlyAddedSystem.length) {
      throw new Error(`System roles cannot be added manually: ${newlyAddedSystem.join(', ')}.`);
    }

    const manualRoles = submittedRoles.filter((role) => !systemRoleTagSet.has(String(role || '').trim().toLowerCase()));
    const finalRoles = Array.from(new Set([...manualRoles, ...existingSystem]));
    if (!finalRoles.length) finalRoles.push('member');

    return normalizeOrganizationRoleSet({
      ...org,
      roles: finalRoles,
      role: finalRoles[0]
    });
  });

  const removedSystemOrgs = Array.from(existingSystemByOrg.keys()).filter((orgKey) => !submittedOrgKeySet.has(orgKey));
  if (removedSystemOrgs.length) {
    throw new Error('Organization memberships with system roles cannot be removed from this form.');
  }

  return normalized;
}

function deriveManualTagsFromOrganizations(organizations) {
  const allowedManualTagSet = getAllowedManualTagSet();
  const result = new Set();
  const orgList = Array.isArray(organizations) ? organizations : [];
  orgList.forEach((org) => {
    const roles = normalizeOrgRoles(org);
    roles.forEach((role) => {
      const normalized = String(role || '').trim().toLowerCase();
      if (allowedManualTagSet.has(normalized)) {
        result.add(normalized);
      }
    });
  });
  return Array.from(result);
}

function validateEmail(email) {
  if (!email) return true;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).trim());
}

function normalizeEmailValue(email) {
  return String(email || '').trim().toLowerCase();
}

function extractPrimaryEmailFromBody(body = {}) {
  let primaryEmail = String(body.email || '').trim();
  if (body.emails) {
    try {
      const emails = JSON.parse(body.emails);
      const primary = Array.isArray(emails)
        ? (emails.find(e => e?.isPrimary)?.email || emails[0]?.email || '')
        : '';
      primaryEmail = String(primary || primaryEmail || '').trim();
    } catch {}
  }
  return primaryEmail;
}

function resolvePrimaryEmailFromPerson(person = {}) {
  return String(
    person.contact?.email ||
    (Array.isArray(person.contact?.emails) ? person.contact.emails.find(e => e?.isPrimary)?.email : '') ||
    person.contact?.emails?.[0]?.email ||
    ''
  ).trim();
}

function personPrimaryEmailMatches(person = {}, email = '') {
  const target = normalizeEmailValue(email);
  if (!target) return false;
  if (normalizeEmailValue(person.contact?.email) === target) return true;
  const emails = Array.isArray(person.contact?.emails) ? person.contact.emails : [];
  const primary = emails.find((entry) => entry?.isPrimary);
  return normalizeEmailValue(primary?.email || emails[0]?.email || '') === target;
}

async function findExistingPersonByPrimaryEmail(email, { ignorePersonId = null } = {}) {
  const normalizedEmail = normalizeEmailValue(email);
  if (!normalizedEmail) return null;
  const rows = await personRepository.list({
    query: {
      q: normalizedEmail,
      type: 'exact_match',
      searchFields: 'contact.email,contact.emails[0].email'
    },
    scope: { canViewAll: true },
    enrichment: { includeSchoolRoles: false },
    pagination: { limit: 10 }
  });
  return (Array.isArray(rows) ? rows : [])
    .find((person) => {
      if (ignorePersonId && String(person?.id || '').trim() === String(ignorePersonId).trim()) return false;
      return personPrimaryEmailMatches(person, normalizedEmail);
    }) || null;
}

async function findExistingUserByEmail(email, { ignorePersonId = null } = {}) {
  const normalizedEmail = normalizeEmailValue(email);
  if (!normalizedEmail) return null;
  const existingUsers = await dataService.fetchData('users', {
    q: normalizedEmail,
    type: 'exact_match',
    searchFields: 'email'
  }, null);
  return (Array.isArray(existingUsers) ? existingUsers : [])
    .find((user) => {
      if (ignorePersonId && String(user?.personId || '').trim() === String(ignorePersonId).trim()) return false;
      return normalizeEmailValue(user?.email) === normalizedEmail;
    }) || null;
}

async function assertPrimaryEmailIsAvailable(primaryEmail, { ignorePersonId = null, checkPersons = true, checkUsers = true } = {}) {
  const normalizedEmail = normalizeEmailValue(primaryEmail);
  if (!normalizedEmail) return;

  if (checkPersons) {
    const existingPerson = await findExistingPersonByPrimaryEmail(normalizedEmail, { ignorePersonId });
    if (existingPerson) {
      throw new Error(`A person profile already exists with the primary email ${normalizedEmail}. Please sign in, use password reset, or contact support if this email belongs to you.`);
    }
  }

  if (checkUsers) {
    const existingUser = await findExistingUserByEmail(normalizedEmail, { ignorePersonId });
    if (existingUser) {
      throw new Error(`A user account already exists with the email ${normalizedEmail}. Please sign in, use password reset, or contact support if this email belongs to you.`);
    }
  }
}

function getAccessLevel(user) {
  const lvl = user?.accessLevel ?? user?.minimumAccessRequirement ?? user?.minAccess ?? user?.role ?? 0;
  return Number(lvl || 0);
}

function canEditOrganizationsForUser(user) {
  const accessLevel = getAccessLevel(user);
  return isAdmin(user) || (accessLevel >= HIGH_ACCESS_MIN && accessLevel <= HIGH_ACCESS_MAX);
}

function generateTempPassword(email) {
  const base = (email || 'user').split('@')[0];
  const rand = Math.random().toString(36).slice(2, 8);
  return `${base}-${rand}`;
}

function parseJsonSafe(jsonString) {
  if (!jsonString) return [];
  try {
    const data = JSON.parse(jsonString);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function normalizeOrganizationRoleSet(org) {
  const roles = normalizeOrgRoles(org);
  const orgIdRaw = org?.orgId;
  const orgIdNum = Number(orgIdRaw);
  return {
    ...org,
    orgId: Number.isFinite(orgIdNum) ? orgIdNum : orgIdRaw,
    roles,
    role: getPrimaryOrgRole(org),
    memberStatus: String(org?.memberStatus || 'active').trim().toLowerCase() || 'active',
    joinedAt: org?.joinedAt || new Date().toISOString()
  };
}

function toStoredOrgId(orgId) {
  const token = toPublicId(orgId);
  if (!token) return orgId;
  const parsed = Number(token);
  return Number.isFinite(parsed) ? parsed : token;
}

function upsertOrganizationRoles(organizations = [], {
  orgId,
  orgName = '',
  requiredRoles = [],
  joinedAt = new Date().toISOString()
} = {}) {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('PTE public join organization is not configured.');

  const normalizedRequiredRoles = Array.from(new Set(
    (Array.isArray(requiredRoles) ? requiredRoles : [])
      .map((role) => String(role || '').trim().toLowerCase())
      .filter(Boolean)
  ));
  if (!normalizedRequiredRoles.includes('member')) normalizedRequiredRoles.unshift('member');

  const rows = Array.isArray(organizations) ? organizations.map((org) => ({ ...org })) : [];
  const existingIndex = rows.findIndex((org) => idsEqual(org?.orgId, targetOrgId));

  if (existingIndex >= 0) {
    const current = { ...rows[existingIndex] };
    const roles = normalizeOrgRoles(current);
    normalizedRequiredRoles.forEach((role) => {
      if (!roles.includes(role)) roles.push(role);
    });

    rows[existingIndex] = normalizeOrganizationRoleSet({
      ...current,
      name: String(orgName || current.name || current.orgName || '').trim(),
      roles,
      role: roles[0] || 'member',
      memberStatus: 'active',
      joinedAt: current.joinedAt || joinedAt
    });
    return rows;
  }

  rows.push(normalizeOrganizationRoleSet({
    orgId: toStoredOrgId(targetOrgId),
    name: orgName,
    roles: normalizedRequiredRoles,
    role: normalizedRequiredRoles[0] || 'member',
    memberStatus: 'active',
    joinedAt
  }));
  return rows;
}

function isPtePublicRoleToken(value = '') {
  const token = String(value || '').trim().toLowerCase();
  const publicRoleToken = String(pteStudentDataService.PERSON_ORG_ROLE_PUBLIC_TOKEN || 'pte_student_public').toLowerCase();
  return token === publicRoleToken || token === 'pte_public_student' || token.includes('pte_student_public');
}

function hasPtePublicRoleForOrg(organizations = [], orgId = '') {
  const targetOrgId = toPublicId(orgId);
  return (Array.isArray(organizations) ? organizations : []).some((org) => {
    if (targetOrgId && !idsEqual(org?.orgId, targetOrgId)) return false;
    return normalizeOrgRoles(org).some(isPtePublicRoleToken);
  });
}

async function resolvePtePublicJoinState(currentUser) {
  const pteJoinOrgId = resolvePteJoinOrgSettingId();
  const state = {
    pteJoinOrgId,
    alreadyJoined: false
  };

  const userId = toPublicId(currentUser?.id);
  if (!userId) {
    state.alreadyJoined = hasPtePublicRoleForOrg(currentUser?.allowedOrgs, pteJoinOrgId);
    return state;
  }

  try {
    const linkedUser = await dataService.getDataById('users', userId, SYSTEM_CONTEXT);
    if (linkedUser) {
      const userAlreadyJoined = hasPtePublicRoleForOrg(linkedUser.organizations, pteJoinOrgId);
      let personAlreadyJoined = false;
      const personId = toPublicId(linkedUser.personId || currentUser?.personId);
      if (personId && personId !== 'NO_PERSONID') {
        const person = await dataService.getDataById('persons', personId, SYSTEM_CONTEXT, { enrichment: { includeSchoolRoles: false } });
        personAlreadyJoined = hasPtePublicRoleForOrg(person?.organizations, pteJoinOrgId);
      }
      state.alreadyJoined = userAlreadyJoined && personAlreadyJoined;
    }
  } catch (_) {
    state.alreadyJoined = hasPtePublicRoleForOrg(currentUser?.allowedOrgs, pteJoinOrgId);
  }

  return state;
}

/* ============================================================
   HELPER: AUTO CREATE USER (Shared Logic)
   Used by both Admin-Add-Person and Public-Join
============================================================ */
async function autoCreateMinimumUserForPerson(person, { creatorUserId, registrationSource }) {
  const now = new Date().toISOString();
  const primaryEmail = normalizeEmailValue(resolvePrimaryEmailFromPerson(person));

  if (!primaryEmail) return { created: false, reason: 'No primary email found on person record.' };

  // Determine Org Context
  const personOrgs = Array.isArray(person.organizations) ? person.organizations : [];
  const orgSnapshot = personOrgs.map(o => ({
    orgId: Number(o.orgId),
    name: String(o.name || o.orgName || '').trim(),
    roles: Array.isArray(o.roles) && o.roles.length ? o.roles : [o.role || 'member'],
    role: (Array.isArray(o.roles) && o.roles[0]) || o.role || 'member',
    memberStatus: o.memberStatus || 'active',
    joinedAt: o.joinedAt || now,
    leftAt: null
  }));

  const primaryOrgId = orgSnapshot[0]?.orgId || FREE_ORG_ID;
  const tempPassword = generateTempPassword(primaryEmail);
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  
  let thisUser;
  try {
    const existingUser = await findExistingUserByEmail(primaryEmail);
    if (existingUser) {
      return {
        created: false,
        reason: 'User account with this email already exists.',
        duplicateEmail: primaryEmail,
        existingUserId: existingUser.id || null
      };
    }

    thisUser = {
      active: true,
      email: primaryEmail,
      username: primaryEmail, // Default username to email
      passwordHash,
      status: 'active',
      registrationSource: registrationSource || 'self_join',
      accessLevel: SELF_ACCESS_LEVEL,
      personId: person.id,
      organizations: orgSnapshot,
      primaryOrgId,
      isEmailVerified: false,
      lastLoginAt: null,
      audit: { createUser: creatorUserId || 'SYSTEM', createDateTime: now, lastUpdateUser: creatorUserId || 'SYSTEM', lastUpdateDateTime: now }
    };
    
    // System Context (null) used for creating the user since public users aren't logged in
    thisUser = await dataService.addData('users', thisUser, creatorUserId || { id: 'SYSTEM', username: 'SYSTEM' });
    console.log(thisUser);
    return { created: true, tempPassword, user: thisUser };
  } catch (e) {
    console.error('[autoCreateMinimumUserForPerson] Failed:', e.message);
    return {
      created: false,
      reason: e.message,
      user: null
    };
  }
}

async function extractUserOrganizations(reqUser) {
  if (!reqUser) return [];
  const query = { q: reqUser.username, type: 'exact_match', searchFields: 'username' };
  const users = await dataService.fetchData('users', query, reqUser);
  const user=users[0];
  if(!user) throw new Error('User not found');

  let allowedOrgs = [];
  if (user.personId) {
    const person = await dataService.getDataById('persons', user.personId, reqUser, PERSON_WITH_SCHOOL_ENRICHMENT);
    if (person && Array.isArray(person.organizations)) {
      allowedOrgs = person.organizations;
    }
  }
  return allowedOrgs;
}

async function validatePersonInput(body, {
  isSelfRegistration,
  requirePrimaryEmail = false,
  existingPersonId = null,
  checkPersonEmailUnique = false,
  checkUserEmailUnique = false
} = {}) {
  const errors = [];
  const first = body.firstName?.trim();
  const last = body.lastName?.trim();
  const gender = body.gender?.trim();
  const dob = body.dateOfBirth?.trim();
  const primaryEmail = extractPrimaryEmailFromBody(body);

  if (!first) errors.push('First name is required.');
  if (!last) errors.push('Last name is required.');
  if (primaryEmail && !validateEmail(primaryEmail)) errors.push('Invalid email.');

  if (isSelfRegistration || requirePrimaryEmail) {
    if (!primaryEmail) errors.push('Email is required.');
  }

  if (isSelfRegistration) {
    if (!gender) errors.push('Gender is required.');
    if (!dob) errors.push('Date of birth is required.');
  }

  if (errors.length) throw new Error(errors.join('\n'));

  await assertPrimaryEmailIsAvailable(primaryEmail, {
    ignorePersonId: existingPersonId,
    checkPersons: checkPersonEmailUnique,
    checkUsers: checkUserEmailUnique
  });
}

function buildPersonFromBody(body, reqUserId, existing = null) {
  const now = new Date().toISOString();
  let emails = parseJsonSafe(body.emails);
  let phones = parseJsonSafe(body.phones);
  let addresses = parseJsonSafe(body.addresses);
  let organizations = parseJsonSafe(body.organizations);
  organizations = applyRoleLockPolicy(organizations, existing?.organizations || []);

  if (!emails.length && body.email) {
    emails = [{ type: 'primary', email: body.email.trim(), isPrimary: true }];
  }

  const manualTags = deriveManualTagsFromOrganizations(organizations);

  return {
    active: parseBool(body.active),
    name: {
      first: (body.firstName || '').trim(),
      middle: body.middleName ? body.middleName.trim() : null,
      last: (body.lastName || '').trim(),
      preferred: body.preferredName ? body.preferredName.trim() : null
    },
    demographics: { gender: body.gender || null, dateOfBirth: body.dateOfBirth || null },
    contact: { emails, phones, email: emails.find(e => e.isPrimary)?.email || emails[0]?.email || null },
    addresses,
    address: addresses[0] || {},
    manualTags,
    tags: manualTags,
    notes: body.notes?.trim() || null,
    avatarUrl: body.avatarUrl?.trim() || null,
    organizations,
    audit: {
      createUser: existing?.audit?.createUser ?? reqUserId,
      createDateTime: existing?.audit?.createDateTime ?? now,
      lastUpdateUser: reqUserId,
      lastUpdateDateTime: now
    }
  };
}

const PERSON_ROLE_DELETE_BLOCK_ORDER = ['school_student', 'school_teacher', 'school_staff'];
const PERSON_ROLE_DISPLAY_LABELS = Object.freeze({
  school_student: 'student',
  school_teacher: 'teacher',
  school_staff: 'staff'
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
  const roleLabels = roleScan.roles.map((r) => `<b>${PERSON_ROLE_DISPLAY_LABELS[r] || r}</b>`).join(', ');
  const preview = roleScan.matches.slice(0, 8);
  const rows = preview.map((item) => {
    const orgLabel = item.orgName ? `${item.orgName} (${item.orgId})` : `Org ${item.orgId}`;
    return `- ${PERSON_ROLE_DISPLAY_LABELS[item.role] || item.role} in ${orgLabel}`;
  });
  const extraCount = Math.max(0, roleScan.matches.length - preview.length);
  const extraLine = extraCount ? `<br>...and ${extraCount} more linked role assignment(s).` : '';
  const details = rows.length ? `<br><br>${rows.join('<br>')}${extraLine}` : '';

  return `<b>Deletion blocked.</b><br>This person is assigned as ${roleLabels} in school records.<br>Please resolve/archive the related records in Students, Teachers, or Staff before deleting this person.${details}`;
}

/* ---------------- LIST ---------------- */
async function listPersons(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, PERSON_LIST_QUERY_OPTIONS);
    const page = Number.parseInt(req.query?.page, 10) || Number.parseInt(query?.page, 10) || 1;
    const limit = Number.parseInt(req.query?.limit, 10) || Number.parseInt(query?.limit, 10) || undefined;
    const pagedPersons = await dataService.fetchDataPaged('persons', {
      ...query,
      page,
      limit
    }, req.user, PERSON_WITH_SCHOOL_ENRICHMENT);
    let data = Array.isArray(pagedPersons?.rows) ? pagedPersons.rows : [];
    const pagination = pagedPersons?.pagination || null;
    const organizationMap = await loadOrganizationDisplayMap();
    data = decorateMembershipOrganizationLabels(data, organizationMap);
    
    if (req.headers['x-ajax-request']) {
      if(query.q === 'aaa') {
        data = decorateMembershipOrganizationLabels(await dataService.getAccessiblePersons(req.user), organizationMap);
      }
      return res.json({ status: 'success', results: data , pagination });
    }

    res.render('person/persons', {
      title: 'Persons Management',
      tableName: 'Persons_Management',
      data,
      newUrl: 'persons',
      newLabel: 'Add Person',
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: true,
      print: true,
      pagination,
      searchableFields: PERSON_LIST_QUERY_OPTIONS.defaultSearchFields,
      filters: req.query, 
      user: req.user || null
    });
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', message: error.message }); 
    }
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

/* ---------------- ADD & EDIT ---------------- */
async function showAddPersonForm(req, res) {
  try {
    const canEditOrganizations = canEditOrganizationsForUser(req.user);
    let availableOrganizations = [];
    let fixedOrganizations = [];

    if (canEditOrganizations) {
      availableOrganizations = await dataService.getAccessibleOrganizations(req.user);
    } else {
      fixedOrganizations = await extractUserOrganizations(req.user);
    }
    
    res.render('person/personForm', {
      title: 'Add Person',
      includeModal: true,
      person: null,
      user: req.user || null,
      showOrganizationsTab: true,
      canEditOrganizations,
      availableOrganizations,
      fixedOrganizations,
      manualTagPresets: personRepository.getAllowedManualTags(),
      systemTagKeys: personRepository.getSystemTagKeys(),
      linkedUsers: null,
      // ✅ PASS TRACKING ID
      actionStateId: req.actionStateId
    });
  } catch(error) {
    console.log(error);
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function addPerson(req, res) {
  try {
    await validatePersonInput(req.body, {
      isSelfRegistration: false,
      requirePrimaryEmail: true,
      checkPersonEmailUnique: true,
      checkUserEmailUnique: true
    });
    const canEditOrganizations = canEditOrganizationsForUser(req.user);
    const reqUserId = req.user?.id || null;

    let person = buildPersonFromBody(req.body, reqUserId);
    if (!canEditOrganizations) {
      person.organizations = await extractUserOrganizations(req.user);
    }
    person.organizations = await canonicalizeOrganizationMemberships(person.organizations);

    const regPerson = await dataService.addData('persons', person, req.user); 
    
    const autoUser = await autoCreateMinimumUserForPerson(regPerson, {
      creatorUserId: reqUserId,
      registrationSource: canEditOrganizations ? 'admin_create' : 'org_admin_create'
    });
    
    if(!autoUser.created){
      dataService.deleteData('persons', regPerson.id, req.user);
      // Logic failure (e.g. dup email) -> 400
      return res.status(400).json({
        status: 'error',
        message: '<b>'+autoUser.reason +`</b><br>For user account we cannot register multiple users with the same email address.<br>Registered person deleted.`,
      });
    }

    if (req.headers['x-ajax-request']) {
      return res.json({
        status: 'success',
        message: 'Person saved successfully.',
        userEditUrl: `/users/edit/${autoUser?.user?.id || '0'}`,
        autoUserCreated: autoUser.created,
        tempPassword: autoUser.tempPassword || null
      });
    }
    res.redirect(`/users/edit/${autoUser.id}`);
  } catch (error) {
    if (req.headers['x-ajax-request']) {
        // ✅ FIX: Use 400 for logic/validation errors to keep session active
        return res.status(400).json({ status: 'error', message: error.message }); 
    }
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function showEditPersonForm(req, res) {
  try {
    const person = await dataService.getDataById('persons', req.params.id, req.user, PERSON_WITH_SCHOOL_ENRICHMENT);
    if (!person) return res.status(404).render('404', { title: 'Person Not Found', user: req.user || null });

    const canEditOrganizations = canEditOrganizationsForUser(req.user);
    let availableOrganizations = [];
    if (canEditOrganizations) {
      availableOrganizations = await dataService.getAccessibleOrganizations(req.user);
    }

    let linkedUser = null;
    if(person.id){
      const users = await dataService.fetchData('users',{ q: person.id, type: 'exact_match', searchFields: 'personId' }, req.user);
      linkedUser = users[0];
    }
    
    res.render('person/personForm', {
      title: 'Edit Person',
      includeModal: true,
      person,
      user: req.user || null,
      showOrganizationsTab: true,
      canEditOrganizations,
      availableOrganizations,
      fixedOrganizations: person.organizations || [],
      manualTagPresets: personRepository.getAllowedManualTags(),
      systemTagKeys: personRepository.getSystemTagKeys(),
      linkedUser,
      // ✅ PASS TRACKING ID
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(500).json({ status: 'error', message: error.message }); 
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function editPerson(req, res) {
  try {
    const existing = await dataService.getDataById('persons', req.params.id, req.user, PERSON_WITH_SCHOOL_ENRICHMENT);
    if (!existing) throw new Error('Person not found!');
    await validatePersonInput(req.body, {
      isSelfRegistration: false,
      requirePrimaryEmail: true,
      existingPersonId: existing.id,
      checkPersonEmailUnique: true,
      checkUserEmailUnique: true
    });

    const canEditOrganizations = canEditOrganizationsForUser(req.user);
    const reqUserId = req.user?.id || null;

    let updates = buildPersonFromBody(req.body, reqUserId, existing);
    if (!canEditOrganizations) {
      updates.organizations = existing.organizations || [];
    }
    updates.organizations = await canonicalizeOrganizationMemberships(updates.organizations);
    
    await dataService.updateData('persons', req.params.id, updates, req.user);

    if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'Person updated successfully.' });
    res.redirect('/persons');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
        // ✅ FIX: Use 400 for logic/validation errors
        return res.status(400).json({ status: 'error', message: error.message }); 
    }
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

/* ---------------- DELETE ---------------- */
async function deletePerson(req, res) {
  try {
    const personId = req.params.id;
    const person = await dataService.getDataById('persons', personId, req.user, PERSON_WITH_SCHOOL_ENRICHMENT);
    if (!person) throw new Error('Person not found.');

    const roleScan = collectBlockedSchoolRoleLinks(person);
    if (roleScan.roles.length > 0) {
      const e = new Error(buildDeleteBlockedBySchoolRoleMessage(roleScan));
      e.statusCode = 409;
      throw e;
    }
    // const linkedUsers = await dataService.fetchData('users', { q: personId, type: 'exact_match', searchFields: 'personId' }, req.user);

    // if (linkedUsers && linkedUsers.length > 0) {
    //     const userRef = linkedUsers[0].username || linkedUsers[0].email;
    //     throw new Error(`<b>Constraint Violation:</b><br>Cannot delete Person. A User account (<b>${userRef}</b>) is currently linked to this profile.<br><br>Please delete or unlink the User account first.`);
    // }

    const deleted_item = await dataService.deleteData('persons', personId, req.user);
    
    if (req.headers['x-ajax-request']) return res.json({ status: 'success' ,results:deleted_item, message:'Person deleted successfully.', result: deleted_item});
    res.redirect('/persons');

  } catch (error) {
    if (req.headers['x-ajax-request']) {
      // ✅ FIX: Use 400 for constraint violations
      const statusCode = Number(error?.statusCode || 400);
      return res.status(statusCode).json({ status: 'error', message: error.message });
    }
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

/* ---------------- SELF REGISTRATION & UNLINK (Unchanged) ---------------- */
async function showRegisterForm(req, res) {
  res.render('person/personForm', {
    title: 'Register',
    includeModal: false,
    person: null,
    user: null,
    showOrganizationsTab: false,
    canEditOrganizations: false,
    availableOrganizations: [],
    fixedOrganizations: [],
    manualTagPresets: personRepository.getAllowedManualTags(),
    systemTagKeys: personRepository.getSystemTagKeys()
  });
}

async function registerSelf(req, res) {
  try {
    await validatePersonInput(req.body, {
      isSelfRegistration: true,
      requirePrimaryEmail: true,
      checkPersonEmailUnique: true,
      checkUserEmailUnique: true
    });
    const now = new Date().toISOString();
    let person = buildPersonFromBody(req.body, null);
    
    const freeOrgName = await resolveOrgNameById(FREE_ORG_ID, FREE_ORG_NAME);
    person.organizations = [{
      orgId: FREE_ORG_ID,
      name: freeOrgName,
      roles: ['member'],
      role: 'member',
      memberStatus: 'active',
      joinedAt: now
    }];

    const systemUserContext = { id: 'SYSTEM', username: 'Self_Registration' };
    const regPerson = await dataService.addData('persons', person, systemUserContext);

    const autoUser = await autoCreateMinimumUserForPerson(regPerson, {
      creatorUserId: 'SYSTEM',
      registrationSource: 'self'
    });

    if (!autoUser.created) {
      await dataService.deleteData('persons', regPerson.id, systemUserContext).catch(() => {});
      return res.status(400).json({
        status: 'error',
        message: `Registration failed: ${autoUser.reason || 'Unable to create user account.'}`
      });
    }

    res.json({ status: 'success', message: 'Registration successful.', tempPassword: autoUser.tempPassword });
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(500).json({ status: 'error', message: error.message }); 
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function unlinkUserFromPerson(req, res) {
  try {
    const { personId, userId } = req.params;
    const accessLevel = getAccessLevel(req.user);
    if (accessLevel < HIGH_ACCESS_MIN) {
      return res.status(403).json({ status: 'error', message: 'Not allowed.' });
    }
    await dataService.unlinkPersonFromUser(userId, personId, req.user);
    res.json({ status: 'success', message: 'User unlinked.' });
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(500).json({ status: 'error', message: error.message }); 
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

/* ============================================================
   PUBLIC JOIN / SIGN UP ENDPOINTS
============================================================ */

async function showPublicJoinForm(req, res) {
  return res.render('person/publicJoin', {
    title: 'Join Us',
    person: {},
    user: null,
    includeModal: true,
    showOrganizationsTab: false,
    canEditOrganizations: false,
    availableOrganizations: [],
    fixedOrganizations: [],
    formAction: '/persons/join',
    joinHeadingTitle: 'Join Our Community',
    joinHeadingSubtitle: 'Create your profile to get started.',
    submitButtonLabel: 'Create Account'
  });
}

async function showPtePublicJoinForm(req, res) {
  const currentUser = req.user || null;
  if (currentUser) {
    const joinState = await resolvePtePublicJoinState(currentUser);
    return res.render('person/publicJoin', {
      title: 'Join PTE Public Practice',
      person: {},
      user: currentUser,
      includeModal: true,
      showOrganizationsTab: false,
      canEditOrganizations: false,
      availableOrganizations: [],
      fixedOrganizations: [],
      formAction: '/pte/join',
      existingUserJoin: true,
      existingUserAlreadyJoined: joinState.alreadyJoined,
      existingUserName: currentUser.name || currentUser.username || currentUser.email || 'your account',
      existingUserEmail: currentUser.email || currentUser.username || '',
      joinHeadingTitle: joinState.alreadyJoined ? 'PTE Public Access Active' : 'Join PTE Public Practice',
      joinHeadingSubtitle: joinState.alreadyJoined
        ? 'Your current account already has public PTE access.'
        : 'Use your current account to join public PTE packages and practice access.',
      existingUserContinueHref: joinState.alreadyJoined ? '/pte/packages' : '/pte',
      submitButtonLabel: joinState.alreadyJoined ? 'Browse Public Packages' : 'Join Public PTE'
    });
  }

  return res.render('person/publicJoin', {
    title: 'Join PTE Practice',
    person: {},
    user: null,
    includeModal: true,
    showOrganizationsTab: false,
    canEditOrganizations: false,
    availableOrganizations: [],
    fixedOrganizations: [],
    formAction: '/pte/join',
    joinHeadingTitle: 'Join PTE Practice',
    joinHeadingSubtitle: 'Create your account to start PTE practice and mock exams.',
    submitButtonLabel: 'Create PTE Account'
  });
}

async function joinExistingUserToPtePublic(currentUser) {
  const userId = toPublicId(currentUser?.id);
  if (!userId) throw new Error('Please log in before joining public PTE practice.');

  const linkedUser = await dataService.getDataById('users', userId, SYSTEM_CONTEXT);
  if (!linkedUser) throw new Error('Your user account could not be found. Please contact support.');

  const personId = toPublicId(linkedUser.personId || currentUser?.personId);
  if (!personId || personId === 'NO_PERSONID') {
    throw new Error('Your user account is not linked to a person profile. Please contact support.');
  }

  const person = await dataService.getDataById('persons', personId, SYSTEM_CONTEXT, { enrichment: { includeSchoolRoles: false } });
  if (!person) throw new Error('Your person profile could not be found. Please contact support.');

  const now = new Date().toISOString();
  const pteJoinOrgId = resolvePteJoinOrgSettingId();
  const pteJoinOrgName = await resolveOrgNameById(pteJoinOrgId, 'PTE Public Applicants');
  const publicRoleToken = String(pteStudentDataService.PERSON_ORG_ROLE_PUBLIC_TOKEN || 'pte_student_public');
  const requiredRoles = ['member', publicRoleToken];
  const actorId = toPublicId(linkedUser.id || currentUser?.id) || 'SYSTEM';
  const actorContext = {
    ...currentUser,
    id: actorId,
    username: linkedUser.username || currentUser?.username || linkedUser.email || actorId,
    email: linkedUser.email || currentUser?.email || '',
    activeOrgId: toStoredOrgId(pteJoinOrgId),
    primaryOrgId: toStoredOrgId(pteJoinOrgId)
  };

  const personAlreadyJoined = hasPtePublicRoleForOrg(person.organizations, pteJoinOrgId);
  const userAlreadyJoined = hasPtePublicRoleForOrg(linkedUser.organizations, pteJoinOrgId);
  const alreadyJoined = personAlreadyJoined && userAlreadyJoined;

  if (alreadyJoined) {
    const applicant = await pteStudentDataService.createPublicApplicantFromJoin({
      orgId: pteJoinOrgId,
      personId: person.id,
      userId: linkedUser.id,
      status: 'active',
      globalAcademicStatus: 'Active'
    }, actorContext);

    return {
      applicant,
      alreadyJoined: true,
      orgId: pteJoinOrgId,
      orgName: pteJoinOrgName,
      userId: linkedUser.id,
      personId: person.id
    };
  }

  const personOrganizations = upsertOrganizationRoles(person.organizations, {
    orgId: pteJoinOrgId,
    orgName: pteJoinOrgName,
    requiredRoles,
    joinedAt: now
  });

  await dataService.updateData('persons', person.id, {
    ...person,
    organizations: personOrganizations,
    audit: {
      ...(person.audit || {}),
      lastUpdateUser: actorId,
      lastUpdateDateTime: now
    }
  }, SYSTEM_CONTEXT);

  const userOrganizations = upsertOrganizationRoles(linkedUser.organizations, {
    orgId: pteJoinOrgId,
    orgName: pteJoinOrgName,
    requiredRoles,
    joinedAt: now
  });

  await dataService.updateData('users', linkedUser.id, {
    ...linkedUser,
    organizations: userOrganizations,
    primaryOrgId: toStoredOrgId(pteJoinOrgId),
    audit: {
      ...(linkedUser.audit || {}),
      lastUpdateUser: actorId,
      lastUpdateDateTime: now
    }
  }, SYSTEM_CONTEXT);

  const applicant = await pteStudentDataService.createPublicApplicantFromJoin({
    orgId: pteJoinOrgId,
    personId: person.id,
    userId: linkedUser.id,
    status: 'active',
    globalAcademicStatus: 'Active'
  }, actorContext);

  return {
    applicant,
    alreadyJoined: false,
    orgId: pteJoinOrgId,
    orgName: pteJoinOrgName,
    userId: linkedUser.id,
    personId: person.id
  };
}

async function processPublicJoin(req, res) {
  try {
    await validatePersonInput(req.body, {
      isSelfRegistration: true,
      requirePrimaryEmail: true,
      checkPersonEmailUnique: true,
      checkUserEmailUnique: true
    });
    
    const now = new Date().toISOString();
    let person = buildPersonFromBody(req.body, null);
    
    const freeOrgId = resolveFreeOrgSettingId();
    const freeOrgName = await resolveOrgNameById(freeOrgId, resolveFreeOrgSettingName());
    person.organizations = [{
      orgId: freeOrgId,
      name: freeOrgName,
      roles: ['member'],
      role: 'member',
      memberStatus: 'active',
      joinedAt: now
    }];

    const systemUserContext = { id: 'SYSTEM', username: 'Public_Sign_Up' };
    const regPerson = await dataService.addData('persons', person, systemUserContext);

    const autoUser = await autoCreateMinimumUserForPerson(regPerson, {
      creatorUserId: 'SYSTEM',
      // ✅ FIXED: Changed to 'self' to pass Model Validation
      registrationSource: 'self' 
    });

    if (!autoUser.created) {
      await dataService.deleteData('persons', regPerson.id, systemUserContext);
      return res.status(400).json({
        status: 'error',
        message: `Registration failed: ${autoUser.reason}`
      });
    }

    return res.json({
        status: 'success',
        message: 'Account created successfully.',
        tempPassword: autoUser.tempPassword,
        userEditUrl: null,
        isPublicJoin: true // Flag for frontend to handle redirect differently
    });

  } catch (error) {
    console.error("Join Error:", error);
    if (req.headers['x-ajax-request']) {
        return res.status(400).json({ status: 'error', message: error.message });
    }
    res.status(500).render('error', { title: 'Registration Error', message: error.message, user: null });
  }
}

async function processPtePublicJoin(req, res) {
  try {
    if (req.user) {
      const joinResult = await joinExistingUserToPtePublic(req.user);
      return res.json({
        status: 'success',
        message: joinResult.alreadyJoined
          ? 'Your account already has public PTE access. You can use public PTE packages with this same login.'
          : 'Your account now has public PTE access. You can use public PTE packages with this same login.',
        existingUserJoin: true,
        existingUserAlreadyJoined: joinResult.alreadyJoined === true,
        redirect: '/pte/packages'
      });
    }

    await validatePersonInput(req.body, {
      isSelfRegistration: true,
      requirePrimaryEmail: true,
      checkPersonEmailUnique: true,
      checkUserEmailUnique: true
    });

    const now = new Date().toISOString();
    let person = buildPersonFromBody(req.body, null);
    const pteJoinOrgId = resolvePteJoinOrgSettingId();
    const pteJoinOrgName = await resolveOrgNameById(pteJoinOrgId, 'PTE Public Applicants');
    const publicRoleToken = String(pteStudentDataService.PERSON_ORG_ROLE_PUBLIC_TOKEN || 'pte_student_public');

    person.organizations = [{
      orgId: pteJoinOrgId,
      name: pteJoinOrgName,
      roles: ['member', publicRoleToken],
      role: 'member',
      memberStatus: 'active',
      joinedAt: now
    }];

    const systemUserContext = { id: 'SYSTEM', username: 'PTE_Public_Sign_Up' };
    const regPerson = await dataService.addData('persons', person, systemUserContext);

    const autoUser = await autoCreateMinimumUserForPerson(regPerson, {
      creatorUserId: 'SYSTEM',
      registrationSource: 'self'
    });

    if (!autoUser.created || !autoUser.user?.id) {
      await dataService.deleteData('persons', regPerson.id, systemUserContext);
      return res.status(400).json({
        status: 'error',
        message: `Registration failed: ${autoUser.reason || 'Unable to create user account.'}`
      });
    }

    try {
      await pteStudentDataService.createPublicApplicantFromJoin({
        orgId: pteJoinOrgId,
        personId: regPerson.id,
        userId: autoUser.user.id,
        status: 'active',
        globalAcademicStatus: 'Active'
      }, systemUserContext);
    } catch (applicantError) {
      await dataService.deleteData('users', autoUser.user.id, systemUserContext).catch(() => {});
      await dataService.deleteData('persons', regPerson.id, systemUserContext).catch(() => {});
      throw applicantError;
    }

    return res.json({
      status: 'success',
      message: 'PTE account created successfully.',
      tempPassword: autoUser.tempPassword,
      userEditUrl: null,
      isPublicJoin: true
    });
  } catch (error) {
    console.error('PTE Join Error:', error);
    if (req.headers['x-ajax-request']) {
      return res.status(400).json({ status: 'error', message: error.message });
    }
    return res.status(500).render('error', {
      title: 'Registration Error',
      message: error.message,
      user: null
    });
  }
}

module.exports = {
  listPersons,
  showAddPersonForm,
  addPerson,
  showEditPersonForm,
  editPerson,
  deletePerson,
  showRegisterForm,
  registerSelf,
  unlinkUserFromPerson,
  showPublicJoinForm,
  processPublicJoin,
  showPtePublicJoinForm,
  processPtePublicJoin
};
