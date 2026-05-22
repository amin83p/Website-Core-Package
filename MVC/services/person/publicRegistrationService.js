const bcrypt = require('bcrypt');

const dataService = require('../dataService');
const settingService = require('../settingService');
const personRepository = require('../../repositories/personRepository');
const organizationRepository = require('../../repositories/organizationRepository');
const { normalizeOrgRoles, getPrimaryOrgRole } = require('../../utils/orgContextUtils');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');
const { resolveCanonicalOrganizationName } = require('../../utils/organizationDisplay');
const { DEFAULTS } = require('../../../config/constants');

const FREE_ORG_ID = Number(DEFAULTS?.FREE_ORG_ID || 900000);
const FREE_ORG_NAME = String(DEFAULTS?.FREE_ORG_NAME || 'Free User');
const SELF_ACCESS_LEVEL = Number(DEFAULTS?.SELF_ACCESS_LEVEL || 1);

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

function resolveFreeOrgSettingName() {
  const name = String(settingService.getValue('organization', 'freeOrgName') || '').trim();
  return name || FREE_ORG_NAME;
}

async function resolveOrgNameById(orgId, fallbackName = '') {
  const org = await organizationRepository.getById(orgId, { scope: { canViewAll: true } }).catch(() => null);
  return resolveCanonicalOrganizationName(org || {}, fallbackName);
}

function parseBool(v) {
  if (typeof v === 'boolean') return v;
  return String(v || '').toLowerCase().trim() === 'true';
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

function generateTempPassword(email) {
  const base = (email || 'user').split('@')[0];
  const rand = Math.random().toString(36).slice(2, 8);
  return `${base}-${rand}`;
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
  if (!targetOrgId) throw new Error('Organization is not configured.');

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

async function autoCreateMinimumUserForPerson(person, { creatorUserId, registrationSource }) {
  const now = new Date().toISOString();
  const primaryEmail = normalizeEmailValue(resolvePrimaryEmailFromPerson(person));

  if (!primaryEmail) return { created: false, reason: 'No primary email found on person record.' };

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

    const newUser = await dataService.addData('users', {
      active: true,
      email: primaryEmail,
      username: primaryEmail,
      passwordHash,
      status: 'active',
      registrationSource: registrationSource || 'self_join',
      accessLevel: SELF_ACCESS_LEVEL,
      personId: person.id,
      organizations: orgSnapshot,
      primaryOrgId,
      isEmailVerified: false,
      lastLoginAt: null,
      audit: {
        createUser: creatorUserId || 'SYSTEM',
        createDateTime: now,
        lastUpdateUser: creatorUserId || 'SYSTEM',
        lastUpdateDateTime: now
      }
    }, creatorUserId || { id: 'SYSTEM', username: 'SYSTEM' });

    return { created: true, tempPassword, user: newUser };
  } catch (e) {
    console.error('[autoCreateMinimumUserForPerson] Failed:', e.message);
    return {
      created: false,
      reason: e.message,
      user: null
    };
  }
}

async function registerPublicPersonAndUser({
  body = {},
  orgId,
  orgName = '',
  roles = ['member'],
  memberStatus = 'active',
  creatorUserId = 'SYSTEM',
  creatorUsername = 'Public_Sign_Up',
  registrationSource = 'self'
} = {}) {
  await validatePersonInput(body, {
    isSelfRegistration: true,
    requirePrimaryEmail: true,
    checkPersonEmailUnique: true,
    checkUserEmailUnique: true
  });

  const now = new Date().toISOString();
  const resolvedOrgId = orgId || resolveFreeOrgSettingId();
  const resolvedOrgName = orgName || await resolveOrgNameById(resolvedOrgId, resolveFreeOrgSettingName());
  const person = buildPersonFromBody(body, null);

  person.organizations = [normalizeOrganizationRoleSet({
    orgId: resolvedOrgId,
    name: resolvedOrgName,
    roles,
    role: Array.isArray(roles) && roles[0] ? roles[0] : 'member',
    memberStatus,
    joinedAt: now
  })];

  const systemUserContext = { id: creatorUserId, username: creatorUsername };
  const regPerson = await dataService.addData('persons', person, systemUserContext);
  const autoUser = await autoCreateMinimumUserForPerson(regPerson, {
    creatorUserId,
    registrationSource
  });

  if (!autoUser.created || !autoUser.user?.id) {
    await dataService.deleteData('persons', regPerson.id, systemUserContext).catch(() => {});
    throw new Error(`Registration failed: ${autoUser.reason || 'Unable to create user account.'}`);
  }

  return {
    person: regPerson,
    autoUser,
    user: autoUser.user,
    tempPassword: autoUser.tempPassword,
    systemUserContext
  };
}

module.exports = {
  FREE_ORG_ID,
  FREE_ORG_NAME,
  resolveConfiguredOrgId,
  resolveFreeOrgSettingId,
  resolveFreeOrgSettingName,
  resolveOrgNameById,
  normalizeEmailValue,
  extractPrimaryEmailFromBody,
  resolvePrimaryEmailFromPerson,
  findExistingPersonByPrimaryEmail,
  findExistingUserByEmail,
  assertPrimaryEmailIsAvailable,
  validatePersonInput,
  buildPersonFromBody,
  normalizeOrganizationRoleSet,
  toStoredOrgId,
  upsertOrganizationRoles,
  autoCreateMinimumUserForPerson,
  registerPublicPersonAndUser
};
