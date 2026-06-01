const pteStudentDataService = require('./pteStudentDataService');
const { normalizeOrgRoles } = require('./pteCoreDependencies');
const {
  dataService,
  idsEqual,
  toPublicId,
  SYSTEM_CONTEXT
} = require('./pteCoreDependencies');
const publicRegistrationService = require('../person/publicRegistrationService');

function createPtePublicJoinService(overrides = {}) {
  const deps = {
    dataService,
    publicRegistrationService,
    pteStudentDataService,
    ...overrides
  };

  function getPublicRoleToken() {
    return String(deps.pteStudentDataService.PERSON_ORG_ROLE_PUBLIC_TOKEN || 'pte_student_public');
  }

  function resolvePteJoinOrgSettingId() {
    const fallbackFreeOrgId = deps.publicRegistrationService.resolveFreeOrgSettingId();
    const envParsed = Number.parseInt(String(process.env.PTE_JOIN_ORG_ID ?? '').trim(), 10);
    if (Number.isFinite(envParsed) && envParsed > 0) return envParsed;
    return fallbackFreeOrgId;
  }

  async function resolvePteJoinOrgName() {
    const pteJoinOrgId = resolvePteJoinOrgSettingId();
    return deps.publicRegistrationService.resolveOrgNameById(pteJoinOrgId, 'PTE Public Applicants');
  }

  function isPtePublicRoleToken(value = '') {
    const token = String(value || '').trim().toLowerCase();
    const publicRoleToken = getPublicRoleToken().toLowerCase();
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
      const linkedUser = await deps.dataService.getDataById('users', userId, SYSTEM_CONTEXT);
      if (linkedUser) {
        const userAlreadyJoined = hasPtePublicRoleForOrg(linkedUser.organizations, pteJoinOrgId);
        let personAlreadyJoined = false;
        const personId = toPublicId(linkedUser.personId || currentUser?.personId);
        if (personId && personId !== 'NO_PERSONID') {
          const person = await deps.dataService.getDataById('persons', personId, SYSTEM_CONTEXT, { enrichment: { includeSchoolRoles: false } });
          personAlreadyJoined = hasPtePublicRoleForOrg(person?.organizations, pteJoinOrgId);
        }
        state.alreadyJoined = userAlreadyJoined && personAlreadyJoined;
      }
    } catch (_) {
      state.alreadyJoined = hasPtePublicRoleForOrg(currentUser?.allowedOrgs, pteJoinOrgId);
    }

    return state;
  }

  async function joinExistingUserToPtePublic(currentUser) {
    const userId = toPublicId(currentUser?.id);
    if (!userId) throw new Error('Please log in before joining public PTE practice.');

    const linkedUser = await deps.dataService.getDataById('users', userId, SYSTEM_CONTEXT);
    if (!linkedUser) throw new Error('Your user account could not be found. Please contact support.');

    const personId = toPublicId(linkedUser.personId || currentUser?.personId);
    if (!personId || personId === 'NO_PERSONID') {
      throw new Error('Your user account is not linked to a person profile. Please contact support.');
    }

    const person = await deps.dataService.getDataById('persons', personId, SYSTEM_CONTEXT, { enrichment: { includeSchoolRoles: false } });
    if (!person) throw new Error('Your person profile could not be found. Please contact support.');

    const now = new Date().toISOString();
    const pteJoinOrgId = resolvePteJoinOrgSettingId();
    const pteJoinOrgName = await resolvePteJoinOrgName();
    const publicRoleToken = getPublicRoleToken();
    const requiredRoles = ['member', publicRoleToken];
    const actorId = toPublicId(linkedUser.id || currentUser?.id) || 'SYSTEM';
    const actorContext = {
      ...currentUser,
      id: actorId,
      username: linkedUser.username || currentUser?.username || linkedUser.email || actorId,
      email: linkedUser.email || currentUser?.email || '',
      activeOrgId: deps.publicRegistrationService.toStoredOrgId(pteJoinOrgId),
      primaryOrgId: deps.publicRegistrationService.toStoredOrgId(pteJoinOrgId)
    };

    const personAlreadyJoined = hasPtePublicRoleForOrg(person.organizations, pteJoinOrgId);
    const userAlreadyJoined = hasPtePublicRoleForOrg(linkedUser.organizations, pteJoinOrgId);
    const alreadyJoined = personAlreadyJoined && userAlreadyJoined;

    if (alreadyJoined) {
      const applicant = await deps.pteStudentDataService.createPublicApplicantFromJoin({
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

    const personOrganizations = deps.publicRegistrationService.upsertOrganizationRoles(person.organizations, {
      orgId: pteJoinOrgId,
      orgName: pteJoinOrgName,
      requiredRoles,
      joinedAt: now
    });

    await deps.dataService.updateData('persons', person.id, {
      ...person,
      organizations: personOrganizations,
      audit: {
        ...(person.audit || {}),
        lastUpdateUser: actorId,
        lastUpdateDateTime: now
      }
    }, SYSTEM_CONTEXT);

    const userOrganizations = deps.publicRegistrationService.upsertOrganizationRoles(linkedUser.organizations, {
      orgId: pteJoinOrgId,
      orgName: pteJoinOrgName,
      requiredRoles,
      joinedAt: now
    });

    await deps.dataService.updateData('users', linkedUser.id, {
      ...linkedUser,
      organizations: userOrganizations,
      primaryOrgId: deps.publicRegistrationService.toStoredOrgId(pteJoinOrgId),
      audit: {
        ...(linkedUser.audit || {}),
        lastUpdateUser: actorId,
        lastUpdateDateTime: now
      }
    }, SYSTEM_CONTEXT);

    const applicant = await deps.pteStudentDataService.createPublicApplicantFromJoin({
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

  async function registerGuestPtePublic(body = {}) {
    const pteJoinOrgId = resolvePteJoinOrgSettingId();
    const pteJoinOrgName = await resolvePteJoinOrgName();
    const result = await deps.publicRegistrationService.registerPublicPersonAndUser({
      body,
      orgId: pteJoinOrgId,
      orgName: pteJoinOrgName,
      roles: ['member', getPublicRoleToken()],
      creatorUserId: 'SYSTEM',
      creatorUsername: 'PTE_Public_Sign_Up',
      registrationSource: 'self'
    });

    try {
      const applicant = await deps.pteStudentDataService.createPublicApplicantFromJoin({
        orgId: pteJoinOrgId,
        personId: result.person.id,
        userId: result.user.id,
        status: 'active',
        globalAcademicStatus: 'Active'
      }, result.systemUserContext);

      return {
        ...result,
        applicant,
        orgId: pteJoinOrgId,
        orgName: pteJoinOrgName
      };
    } catch (applicantError) {
      await deps.dataService.deleteData('users', result.user.id, result.systemUserContext).catch(() => {});
      await deps.dataService.deleteData('persons', result.person.id, result.systemUserContext).catch(() => {});
      throw applicantError;
    }
  }

  return {
    resolvePteJoinOrgSettingId,
    resolvePtePublicJoinState,
    isPtePublicRoleToken,
    hasPtePublicRoleForOrg,
    joinExistingUserToPtePublic,
    registerGuestPtePublic
  };
}

const service = createPtePublicJoinService();

module.exports = service;
module.exports.createPtePublicJoinService = createPtePublicJoinService;
