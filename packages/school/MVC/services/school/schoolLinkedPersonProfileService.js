const schoolDataService = require('./schoolDataService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const personDenormalizedNameSyncService = require('./personDenormalizedNameSyncService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

const coreDataService = requireCoreModule('MVC/services/dataService');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { getActiveOrgIdOrThrow, assertOrgAccess } = requireCoreModule('MVC/utils/orgContextUtils');
const publicRegistrationService = requireCoreModule('MVC/services/person/publicRegistrationService');

const PERSON_LOAD_OPTIONS = Object.freeze({
  enrichment: { includeSchoolRoles: false },
  __skipSchoolIdentityBridge: true
});

const LINK_TYPE_CONFIG = Object.freeze({
  student: {
    entityType: 'students',
    section: SECTIONS.SCHOOL_STUDENTS,
    orgField: 'orgId'
  },
  teacher: {
    entityType: 'teachers',
    section: SECTIONS.SCHOOL_TEACHERS,
    orgField: 'orgId'
  },
  staff: {
    entityType: 'staff',
    section: SECTIONS.SCHOOL_STAFF,
    orgField: 'orgId'
  },
  funder: {
    entityType: 'funders',
    section: SECTIONS.SCHOOL_FUNDERS,
    orgField: 'orgId'
  }
});

const { validatePersonInput, buildPersonFromBody } = publicRegistrationService;

function normalizeLinkType(value) {
  const token = String(value || '').trim().toLowerCase();
  if (!LINK_TYPE_CONFIG[token]) {
    throw new Error('linkType must be student, teacher, staff, or funder.');
  }
  return token;
}

function getLinkConfig(linkType) {
  return LINK_TYPE_CONFIG[normalizeLinkType(linkType)];
}

function hasSectionPermission(reqUser, sectionId, operationId) {
  return Boolean(adminAuthorityService.isAdminForRequest(reqUser, sectionId, operationId, {
    section: { id: sectionId }
  }));
}

async function hasSectionPermissionAsync(reqUser, sectionId, operationId) {
  if (typeof adminAuthorityService.isAdminForRequestAsync === 'function') {
    return Boolean(await adminAuthorityService.isAdminForRequestAsync(reqUser, sectionId, operationId, {
      section: { id: sectionId }
    }));
  }
  return hasSectionPermission(reqUser, sectionId, operationId);
}

function assertSectionPermission(reqUser, sectionId, operationId) {
  if (!hasSectionPermission(reqUser, sectionId, operationId)) {
    throw new Error('You do not have permission to perform this action.');
  }
}

async function evaluateCanEditLinkedPerson({ reqUser, linkType, isEdit = false } = {}) {
  const config = getLinkConfig(linkType);
  const operation = isEdit ? OPERATIONS.UPDATE : OPERATIONS.CREATE;
  return hasSectionPermissionAsync(reqUser, config.section, operation);
}

async function loadLinkedEntity({ reqUser, linkType, linkId, activeOrgId } = {}) {
  const config = getLinkConfig(linkType);
  const entityId = toPublicId(linkId);
  if (!entityId) return null;
  const entity = await schoolDataService.getDataById(config.entityType, entityId, reqUser);
  if (!entity) throw new Error(`${config.entityType.slice(0, -1)} record not found.`);
  assertOrgAccess(entity, activeOrgId, reqUser, { orgField: config.orgField, allowSystemBypass: true });
  return entity;
}

async function assertLinkedPersonAccess({
  reqUser,
  personId,
  linkType,
  linkId = '',
  operation = OPERATIONS.READ_ALL
} = {}) {
  const targetPersonId = toPublicId(personId);
  if (!targetPersonId) throw new Error('personId is required.');

  const config = getLinkConfig(linkType);
  const activeOrgId = getActiveOrgIdOrThrow(reqUser);
  const entityId = toPublicId(linkId);

  if (entityId) {
    const entity = await loadLinkedEntity({ reqUser, linkType, linkId: entityId, activeOrgId });
    if (!idsEqual(entity?.personId, targetPersonId)) {
      throw new Error('Person link does not match the selected school record.');
    }
  } else {
    const person = await schoolPersonAccessService.getPersonById({
      reqUser,
      personId: targetPersonId,
      requireSchoolRole: false
    });
    if (!person) throw new Error('Person is not available in the active organization context.');
  }

  assertSectionPermission(reqUser, config.section, operation);
  return { personId: targetPersonId, activeOrgId, linkType: normalizeLinkType(linkType), linkId: entityId };
}

async function loadPersonRecord(personId, reqUser) {
  const targetPersonId = toPublicId(personId);
  if (!targetPersonId) throw new Error('personId is required.');
  const person = await coreDataService.getDataById('persons', targetPersonId, reqUser, PERSON_LOAD_OPTIONS);
  if (!person) throw new Error('Person not found.');
  return person;
}

function resolvePersonProfileType(personOrBody = {}) {
  return String(personOrBody.personProfileType || '').trim().toLowerCase() === 'organization'
    ? 'organization'
    : 'individual';
}

function toProfileDto(person = {}) {
  const name = person.name || {};
  const demographics = person.demographics || {};
  const contact = person.contact || {};
  const organizationProfile = person.organizationProfile || {};
  const addressesLegacy = person.address || {};
  const addresses = Array.isArray(person.addresses)
    ? person.addresses
    : (Object.keys(addressesLegacy).length ? [addressesLegacy] : []);
  const emails = Array.isArray(contact.emails)
    ? contact.emails
    : (contact.email ? [{ type: 'primary', email: contact.email, isPrimary: true }] : []);
  const personProfileType = resolvePersonProfileType(person);

  return {
    id: toPublicId(person.id || person.personId),
    active: person.active !== false,
    personProfileType,
    organizationLegalName: String(organizationProfile.legalName || '').trim(),
    firstName: String(name.first || '').trim(),
    middleName: String(name.middle || '').trim(),
    lastName: String(name.last || '').trim(),
    preferredName: String(name.preferred || '').trim(),
    gender: String(demographics.gender || '').trim(),
    dateOfBirth: String(demographics.dateOfBirth || '').trim(),
    emails,
    phones: Array.isArray(contact.phones) ? contact.phones : [],
    addresses,
    notes: String(person.notes || '').trim(),
    organizations: Array.isArray(person.organizations) ? person.organizations : []
  };
}

async function getLinkedPersonProfile({ reqUser, personId, linkType, linkId = '' } = {}) {
  await assertLinkedPersonAccess({
    reqUser,
    personId,
    linkType,
    linkId,
    operation: OPERATIONS.READ_ALL
  });
  const person = await loadPersonRecord(personId, reqUser);
  const profile = toProfileDto(person);
  return {
    person: profile,
    displayName: schoolPersonAccessService.formatPersonName(person, profile.id),
    organizations: profile.organizations
  };
}

function assertSchoolProfileFields(body = {}, existing = {}) {
  const personProfileType = resolvePersonProfileType({
    personProfileType: body.personProfileType || existing.personProfileType
  });
  if (personProfileType === 'organization') return;

  const gender = String(body.gender || '').trim();
  const dateOfBirth = String(body.dateOfBirth || '').trim();
  if (!gender) throw new Error('Gender is required.');
  if (!dateOfBirth) throw new Error('Date of birth is required.');
}

async function updateLinkedPersonProfile({ reqUser, personId, linkType, linkId = '', body = {} } = {}) {
  const operation = toPublicId(linkId) ? OPERATIONS.UPDATE : OPERATIONS.CREATE;
  await assertLinkedPersonAccess({
    reqUser,
    personId,
    linkType,
    linkId,
    operation
  });

  const existing = await loadPersonRecord(personId, reqUser);
  const personProfileType = resolvePersonProfileType(existing);
  const organizationLegalName = personProfileType === 'organization'
    ? String(
      Object.prototype.hasOwnProperty.call(body, 'organizationLegalName')
        ? body.organizationLegalName
        : (existing.organizationProfile?.legalName || '')
    ).trim()
    : '';

  const bodyForCore = {
    ...body,
    personProfileType,
    organizationLegalName
  };
  assertSchoolProfileFields(bodyForCore, existing);

  const priorDisplayName = schoolPersonAccessService.formatPersonName(existing, toPublicId(existing.id || personId));

  await validatePersonInput(bodyForCore, {
    isSelfRegistration: false,
    requirePrimaryEmail: true,
    existingPersonId: existing.id,
    checkPersonEmailUnique: true,
    checkUserEmailUnique: true
  });

  const reqUserId = reqUser?.id || reqUser?.username || 'SYSTEM';
  const bodyWithOrganizations = {
    ...bodyForCore,
    organizations: body.organizations || JSON.stringify(Array.isArray(existing.organizations) ? existing.organizations : [])
  };
  const updates = buildPersonFromBody(bodyWithOrganizations, reqUserId, existing);
  updates.organizations = Array.isArray(existing.organizations) ? existing.organizations : [];
  updates.manualTags = Array.isArray(existing.manualTags) ? existing.manualTags : [];
  updates.tags = Array.isArray(existing.tags) ? existing.tags : (Array.isArray(existing.manualTags) ? existing.manualTags : []);
  updates.avatarUrl = existing.avatarUrl || null;

  await coreDataService.updateData('persons', existing.id, updates, reqUser, PERSON_LOAD_OPTIONS);

  const refreshed = await loadPersonRecord(existing.id, reqUser);
  const profile = toProfileDto(refreshed);
  const displayName = schoolPersonAccessService.formatPersonName(refreshed, profile.id);
  let nameSync = null;

  if (displayName && displayName !== priorDisplayName) {
    try {
      const activeOrgId = getActiveOrgIdOrThrow(reqUser);
      nameSync = await personDenormalizedNameSyncService.syncPersonDisplayName({
        personId: profile.id,
        displayName,
        activeOrgId,
        reqUser
      });
    } catch (error) {
      nameSync = {
        personId: profile.id,
        displayName,
        error: error?.message || 'Failed to sync denormalized person names.'
      };
      console.error('schoolLinkedPersonProfileService name sync failed:', error);
    }
  }

  return {
    person: profile,
    displayName,
    organizations: profile.organizations,
    nameSync
  };
}

module.exports = {
  evaluateCanEditLinkedPerson,
  assertLinkedPersonAccess,
  getLinkedPersonProfile,
  updateLinkedPersonProfile,
  toProfileDto
};
