const userRepository = require('../repositories/userRepository');
const personRepository = require('../repositories/personRepository');
const roleRegistryService = require('./person/roleRegistryService');
const {
  INACTIVE_STATUSES,
  dedupe,
  isActiveMembership,
  isActivePerson,
  analyzeRoleTokens,
  analyzePersonRoleScope,
  collectMembershipRoleTokens
} = require('./person/packageRoleAssignmentService');
const { idsEqual, toIdArray, toPublicId } = require('../utils/idAdapter');

const PERSON_QUERY_OPTIONS = Object.freeze({
  enrichment: { includeSchoolRoles: false }
});

const DEFAULT_CONTACT_LIMIT = 20;
const MAX_CONTACT_LIMIT = 50;
const OUTSIDE_SCOPE_REASON = 'This user is outside your current organization and package-role contact scope.';
const READ_ONLY_REASON = 'This conversation is read-only because you no longer share an allowed organization and package-role contact scope.';

function createHttpError(message, statusCode = 403) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isVirtualRoot(user = {}) {
  return user?.isVirtualSuperAdmin === true;
}

function isActiveUser(user = {}) {
  if (!user || user.active === false) return false;
  const status = String(user?.status || user?.state || user?.accountStatus || 'active')
    .trim()
    .toLowerCase();
  return !INACTIVE_STATUSES.has(status);
}

function formatPersonName(person = {}, fallback = '') {
  const preferred = String(person?.preferredName || person?.name?.preferred || '').trim();
  if (preferred) return preferred;
  const first = String(person?.firstName || person?.name?.first || '').trim();
  const middle = String(person?.middleName || person?.name?.middle || '').trim();
  const last = String(person?.lastName || person?.name?.last || '').trim();
  return [first, middle, last].filter(Boolean).join(' ')
    || String(person?.displayName || (typeof person?.name === 'string' ? person.name : '') || fallback).trim();
}

function readPersonEmail(person = {}) {
  const emails = Array.isArray(person?.contact?.emails) ? person.contact.emails : [];
  const primary = emails.find((row) => row?.isPrimary) || emails[0] || null;
  return String(
    person?.contact?.email
    || person?.contact?.primaryEmail
    || person?.email
    || primary?.email
    || ''
  ).trim();
}

function readPersonAvatar(person = {}) {
  return String(person?.avatarUrl || person?.avatar || '').trim() || null;
}

function userDisplayName(user = {}, person = null) {
  return String(user?.identity?.displayName || user?.displayName || user?.name || '').trim()
    || (person ? formatPersonName(person, '') : '')
    || String(user?.username || user?.email || user?.id || 'Unknown User').trim();
}

function userAvatar(user = {}, person = null) {
  return String(user?.avatarUrl || user?.avatar || '').trim()
    || (person ? readPersonAvatar(person) : null)
    || null;
}

function roleProjection(role = {}) {
  return {
    key: String(role?.key || '').trim(),
    label: String(role?.label || role?.key || '').trim(),
    packageName: String(role?.packageName || role?.domain || '').trim(),
    domain: String(role?.domain || '').trim()
  };
}

function activeMemberships(person = {}) {
  return (Array.isArray(person?.organizations) ? person.organizations : [])
    .filter(isActiveMembership);
}

function summarizeRootPerson(person, registry = {}) {
  if (!person || !isActivePerson(person)) {
    return {
      packageRoles: [],
      packageDomains: [],
      unknownTokens: [],
      isPlain: false,
      memberships: []
    };
  }
  const memberships = activeMemberships(person);
  const analysis = analyzeRoleTokens(
    memberships.flatMap((membership) => collectMembershipRoleTokens(membership)),
    registry
  );
  return { ...analysis, memberships };
}

function buildRequesterContext({ requestingUser, requesterPerson = null, registry = {} } = {}) {
  if (isVirtualRoot(requestingUser)) {
    return {
      eligible: true,
      bypass: true,
      requestingUser,
      requesterPerson: null,
      activeOrgId: toPublicId(requestingUser?.activeOrgId),
      registry,
      roleScope: null,
      reason: ''
    };
  }

  const activeOrgId = toPublicId(requestingUser?.activeOrgId);
  if (!activeOrgId || String(activeOrgId).toUpperCase() === 'SYSTEM') {
    return {
      eligible: false,
      bypass: false,
      requestingUser,
      requesterPerson,
      activeOrgId,
      registry,
      roleScope: null,
      reason: 'Select an organization before using role-scoped Chat contacts.'
    };
  }

  if (!requesterPerson || !isActivePerson(requesterPerson)) {
    return {
      eligible: false,
      bypass: false,
      requestingUser,
      requesterPerson,
      activeOrgId,
      registry,
      roleScope: null,
      reason: 'Your User account must be linked to an active Person before using Chat contacts.'
    };
  }

  const roleScope = analyzePersonRoleScope(requesterPerson, activeOrgId, registry);
  if (!roleScope.eligible) {
    return {
      eligible: false,
      bypass: false,
      requestingUser,
      requesterPerson,
      activeOrgId,
      registry,
      roleScope,
      reason: roleScope.reason || 'Your Person has no active membership in the selected organization.'
    };
  }

  if (!roleScope.isPlain && roleScope.packageDomains.length === 0) {
    return {
      eligible: false,
      bypass: false,
      requestingUser,
      requesterPerson,
      activeOrgId,
      registry,
      roleScope,
      reason: 'Your Person membership contains an unrecognized role assignment that must be resolved before using Chat contacts.'
    };
  }

  return {
    eligible: true,
    bypass: false,
    requestingUser,
    requesterPerson,
    activeOrgId,
    registry,
    roleScope,
    reason: ''
  };
}

function evaluateTargetContact(context = {}, targetUser = null, targetPerson = null) {
  if (!context?.eligible) {
    return {
      allowed: false,
      reason: context?.reason || OUTSIDE_SCOPE_REASON,
      matchingDomains: [],
      targetRoleScope: null
    };
  }
  if (!targetUser || !isActiveUser(targetUser)) {
    return {
      allowed: false,
      reason: OUTSIDE_SCOPE_REASON,
      matchingDomains: [],
      targetRoleScope: null
    };
  }
  if (idsEqual(targetUser?.id, context?.requestingUser?.id)) {
    return {
      allowed: false,
      reason: 'You cannot start a chat with yourself.',
      matchingDomains: [],
      targetRoleScope: null
    };
  }

  if (context.bypass) {
    return {
      allowed: true,
      reason: '',
      matchingDomains: [],
      targetRoleScope: summarizeRootPerson(targetPerson, context.registry)
    };
  }

  if (!targetPerson || !isActivePerson(targetPerson)) {
    return {
      allowed: false,
      reason: OUTSIDE_SCOPE_REASON,
      matchingDomains: [],
      targetRoleScope: null
    };
  }

  const targetRoleScope = analyzePersonRoleScope(
    targetPerson,
    context.activeOrgId,
    context.registry
  );
  if (!targetRoleScope.eligible) {
    return {
      allowed: false,
      reason: OUTSIDE_SCOPE_REASON,
      matchingDomains: [],
      targetRoleScope
    };
  }

  const requesterDomains = new Set(context.roleScope?.packageDomains || []);
  const matchingDomains = (targetRoleScope.packageDomains || [])
    .filter((domain) => requesterDomains.has(domain));
  if (matchingDomains.length > 0) {
    return {
      allowed: true,
      reason: '',
      matchingDomains: dedupe(matchingDomains),
      targetRoleScope
    };
  }

  if (context.roleScope?.isPlain && targetRoleScope.isPlain) {
    return {
      allowed: true,
      reason: '',
      matchingDomains: [],
      targetRoleScope
    };
  }

  return {
    allowed: false,
    reason: OUTSIDE_SCOPE_REASON,
    matchingDomains: [],
    targetRoleScope
  };
}

async function loadPersonsByIds(personIds = [], options = {}) {
  const ids = toIdArray(personIds);
  if (!ids.length) return new Map();
  const rows = await personRepository.list({
    query: { id__in: ids },
    scope: { canViewAll: true },
    ...PERSON_QUERY_OPTIONS,
    ...(options || {})
  });
  return new Map((Array.isArray(rows) ? rows : [])
    .map((person) => [toPublicId(person?.id), person])
    .filter(([id]) => Boolean(id)));
}

async function loadUsersByIds(userIds = []) {
  const ids = toIdArray(userIds);
  if (!ids.length) return new Map();
  const rows = await userRepository.list({
    query: { id__in: ids },
    scope: { canViewAll: true }
  });
  const map = new Map((Array.isArray(rows) ? rows : [])
    .map((user) => [toPublicId(user?.id), user])
    .filter(([id]) => Boolean(id)));

  const missing = ids.filter((id) => !map.has(id));
  if (missing.length) {
    const resolved = await Promise.all(missing.map((id) => userRepository.getById(id)));
    resolved.filter(Boolean).forEach((user) => map.set(toPublicId(user?.id), user));
  }
  return map;
}

async function buildContactContext(requestingUser) {
  const registry = await roleRegistryService.getRoleRegistry();
  if (isVirtualRoot(requestingUser)) {
    return buildRequesterContext({ requestingUser, registry });
  }

  const personId = toPublicId(requestingUser?.personId);
  const requesterPerson = personId
    ? await personRepository.getById(personId, PERSON_QUERY_OPTIONS)
    : null;
  return buildRequesterContext({ requestingUser, requesterPerson, registry });
}

function projectionOrgName(roleScope = {}, fallback = 'General') {
  const membership = Array.isArray(roleScope?.memberships) ? roleScope.memberships[0] : null;
  return String(
    membership?.displayLabel
    || membership?.name
    || membership?.organizationName
    || fallback
  ).trim() || fallback;
}

function projectContact(user, person, roleScope = null) {
  const roles = (roleScope?.packageRoles || []).map(roleProjection);
  const packageLabels = dedupe(roles.map((role) => role.packageName).filter(Boolean));
  return {
    id: toPublicId(user?.id),
    name: userDisplayName(user, person),
    avatar: userAvatar(user, person),
    email: String(user?.email || readPersonEmail(person) || '').trim(),
    org: projectionOrgName(roleScope),
    roles,
    roleLabels: dedupe(roles.map((role) => role.label).filter(Boolean)),
    packages: packageLabels,
    packageDomains: dedupe(roleScope?.packageDomains || []),
    plainMember: roleScope?.isPlain === true
  };
}

function matchesContactQuery(contact = {}, user = {}, person = {}, query = '') {
  const token = String(query || '').trim().toLowerCase();
  if (!token) return true;
  const searchText = [
    contact?.id,
    contact?.name,
    contact?.email,
    contact?.org,
    user?.username,
    user?.personId,
    formatPersonName(person, ''),
    readPersonEmail(person),
    ...(Array.isArray(contact?.roleLabels) ? contact.roleLabels : []),
    ...(Array.isArray(contact?.packages) ? contact.packages : [])
  ].join(' ').toLowerCase();
  return searchText.includes(token);
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CONTACT_LIMIT;
  return Math.min(parsed, MAX_CONTACT_LIMIT);
}

async function searchContacts(requestingUser, query = '', options = {}) {
  const context = await buildContactContext(requestingUser);
  if (!context.eligible) throw createHttpError(context.reason, 403);

  const allPersons = await personRepository.list({
    query: {},
    scope: { canViewAll: true },
    ...PERSON_QUERY_OPTIONS,
    roleRegistry: context.registry
  });
  const personById = new Map((Array.isArray(allPersons) ? allPersons : [])
    .map((person) => [toPublicId(person?.id), person])
    .filter(([id]) => Boolean(id)));

  let users;
  if (context.bypass) {
    users = await userRepository.list({ query: {}, scope: { canViewAll: true } });
  } else {
    const eligiblePersonIds = [];
    personById.forEach((person, personId) => {
      const targetScope = analyzePersonRoleScope(person, context.activeOrgId, context.registry);
      if (!targetScope.eligible) return;
      const targetStub = { id: `PERSON:${personId}`, active: true, status: 'active' };
      const decision = evaluateTargetContact(context, targetStub, person);
      if (decision.allowed) eligiblePersonIds.push(personId);
    });
    users = eligiblePersonIds.length
      ? await userRepository.list({
        query: { personId__in: eligiblePersonIds },
        scope: { canViewAll: true }
      })
      : [];
  }

  const contacts = [];
  (Array.isArray(users) ? users : []).forEach((user) => {
    if (!isActiveUser(user) || idsEqual(user?.id, requestingUser?.id)) return;
    const person = personById.get(toPublicId(user?.personId)) || null;
    const decision = evaluateTargetContact(context, user, person);
    if (!decision.allowed) return;
    const contact = projectContact(user, person, decision.targetRoleScope);
    if (matchesContactQuery(contact, user, person || {}, query)) contacts.push(contact);
  });

  return contacts
    .sort((left, right) => String(left?.name || left?.id).localeCompare(
      String(right?.name || right?.id),
      undefined,
      { sensitivity: 'base' }
    ))
    .slice(0, normalizeLimit(options?.limit));
}

async function getContactDecision(requestingUser, targetUserId) {
  const context = await buildContactContext(requestingUser);
  if (!context.eligible) {
    return { allowed: false, reason: context.reason, context, targetUser: null, targetPerson: null };
  }

  const targetUser = await userRepository.getById(targetUserId);
  const targetPersonId = toPublicId(targetUser?.personId);
  const targetPerson = targetPersonId
    ? await personRepository.getById(targetPersonId, PERSON_QUERY_OPTIONS)
    : null;
  return {
    ...evaluateTargetContact(context, targetUser, targetPerson),
    context,
    targetUser,
    targetPerson
  };
}

async function assertCanContact(requestingUser, targetUserId) {
  const decision = await getContactDecision(requestingUser, targetUserId);
  if (!decision.allowed) throw createHttpError(decision.reason || OUTSIDE_SCOPE_REASON, 403);
  return decision;
}

function otherParticipantIds(conversation = {}, requestingUserId = '') {
  return dedupe((Array.isArray(conversation?.participants) ? conversation.participants : [])
    .map((participant) => toPublicId(participant?.userId || participant))
    .filter((userId) => userId && !idsEqual(userId, requestingUserId)));
}

async function buildConversationContactStates(requestingUser, conversations = []) {
  const rows = Array.isArray(conversations) ? conversations : [];
  const targetUserIds = dedupe(rows.flatMap((conversation) => (
    otherParticipantIds(conversation, requestingUser?.id)
  )));
  const [context, userById] = await Promise.all([
    buildContactContext(requestingUser),
    loadUsersByIds(targetUserIds)
  ]);
  const personById = await loadPersonsByIds(
    [...userById.values()].map((user) => user?.personId).filter(Boolean),
    { roleRegistry: context.registry }
  );

  const stateByConversationId = new Map();
  rows.forEach((conversation) => {
    const targetIds = otherParticipantIds(conversation, requestingUser?.id);
    const participantRows = targetIds.map((userId) => {
      const user = userById.get(userId) || null;
      const person = personById.get(toPublicId(user?.personId)) || null;
      const decision = evaluateTargetContact(context, user, person);
      return {
        userId,
        user,
        person,
        decision,
        display: user
          ? projectContact(user, person, decision.targetRoleScope || summarizeRootPerson(person, context.registry))
          : {
            id: userId,
            name: 'Unknown User',
            avatar: null,
            email: '',
            org: 'General',
            roles: [],
            roleLabels: [],
            packages: [],
            packageDomains: [],
            plainMember: false
          }
      };
    });
    const denied = participantRows.find((row) => !row.decision.allowed);
    stateByConversationId.set(toPublicId(conversation?.id), {
      canMessage: participantRows.length > 0 && !denied,
      reason: denied ? READ_ONLY_REASON : '',
      participants: participantRows
    });
  });

  return stateByConversationId;
}

async function getConversationMessagingEligibility(requestingUser, conversation) {
  const states = await buildConversationContactStates(requestingUser, [conversation]);
  return states.get(toPublicId(conversation?.id)) || {
    canMessage: false,
    reason: READ_ONLY_REASON,
    participants: []
  };
}

module.exports = {
  DEFAULT_CONTACT_LIMIT,
  MAX_CONTACT_LIMIT,
  OUTSIDE_SCOPE_REASON,
  READ_ONLY_REASON,
  isVirtualRoot,
  isActiveUser,
  formatPersonName,
  buildRequesterContext,
  evaluateTargetContact,
  buildContactContext,
  projectContact,
  searchContacts,
  getContactDecision,
  assertCanContact,
  buildConversationContactStates,
  getConversationMessagingEligibility
};
