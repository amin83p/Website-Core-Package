const dataService = require('../dataService');
const securityService = require('../security');
const adminChekersService = require('../adminChekersService');
const { SYSTEM_CONTEXT } = require('../../../config/constants');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');

function normalizeIdList(values = []) {
  const rows = Array.isArray(values) ? values : [values];
  const out = [];
  const seen = new Set();
  rows.forEach((value) => {
    const id = toPublicId(value);
    if (!id) return;
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

function normalizeSourceType(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeSourceLabel(value = '') {
  return String(value || '').replace(/\0/g, '').trim().slice(0, 240);
}

function normalizeOrigin(origin = {}) {
  const payload = (origin && typeof origin === 'object') ? origin : {};
  const sourceType = normalizeSourceType(payload.type || payload.sourceType || payload.originType || '');
  const sourceRefId = toPublicId(payload.sourceRefId || payload.sourceId || payload.originId || payload.refId || '');
  const sourceLabel = normalizeSourceLabel(payload.sourceLabel || payload.label || payload.originLabel || '');
  const isManaged = Boolean(sourceType && sourceType !== 'manual' && sourceType !== 'direct' && sourceType !== 'user_form');
  return {
    type: isManaged ? sourceType : 'manual',
    sourceRefId: isManaged ? sourceRefId : '',
    sourceLabel: isManaged ? sourceLabel : '',
    isManaged
  };
}

function normalizeManagedAccessProfiles(values = []) {
  const rows = Array.isArray(values) ? values : [];
  const out = [];
  const seen = new Set();
  rows.forEach((row) => {
    if (!row) return;
    const source = (typeof row === 'object') ? row : { profileId: row };
    const profileId = toPublicId(source.profileId || source.id || source.accessProfileId || '');
    if (!profileId) return;
    const sourceType = normalizeSourceType(source.sourceType || source.type || source.originType || '') || 'external';
    const sourceRefId = toPublicId(source.sourceRefId || source.sourceId || source.originId || source.refId || '');
    const sourceLabel = normalizeSourceLabel(source.sourceLabel || source.label || source.originLabel || '');
    const key = `${profileId}::${sourceType}::${sourceRefId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      profileId,
      sourceType,
      sourceRefId,
      sourceLabel,
      locked: true,
      createdAt: String(source.createdAt || source.createDateTime || '').trim() || new Date().toISOString(),
      createdBy: String(source.createdBy || source.createUser || '').trim() || 'System'
    });
  });
  return out;
}

function extractManagedProfileIds(entries = []) {
  return normalizeIdList(normalizeManagedAccessProfiles(entries).map((entry) => entry.profileId));
}

function getDirectProfileIds(membership = {}) {
  const managedEntries = normalizeManagedAccessProfiles(membership?.managedAccessProfiles || []);
  const managedSet = new Set(extractManagedProfileIds(managedEntries));
  if (Array.isArray(membership?.directAccessProfileIds)) {
    return normalizeIdList(membership.directAccessProfileIds);
  }
  const legacy = normalizeIdList(membership?.accessProfileIds || []);
  if (!managedSet.size) return legacy;
  return legacy.filter((id) => !managedSet.has(id));
}

function composeEffectiveProfileIds(directProfileIds = [], managedEntries = []) {
  const managedIds = normalizeManagedAccessProfiles(managedEntries).map((entry) => entry.profileId);
  return normalizeIdList([...(Array.isArray(directProfileIds) ? directProfileIds : []), ...managedIds]);
}

function upsertMembershipAccess(membership = {}, {
  directProfileIds = [],
  managedEntries = []
} = {}) {
  const normalizedDirect = normalizeIdList(directProfileIds);
  const normalizedManaged = normalizeManagedAccessProfiles(managedEntries);
  return {
    ...(membership || {}),
    directAccessProfileIds: normalizedDirect,
    managedAccessProfiles: normalizedManaged,
    accessProfileIds: composeEffectiveProfileIds(normalizedDirect, normalizedManaged)
  };
}

function sameManagedSource(entry = {}, origin = {}) {
  const entryType = normalizeSourceType(entry?.sourceType || '') || 'external';
  const entryRefId = toPublicId(entry?.sourceRefId || '');
  if (!origin?.isManaged) return false;
  if (entryType !== origin.type) return false;
  if (!origin.sourceRefId) return true;
  return entryRefId === origin.sourceRefId;
}

function buildAuditPatch(existingAudit = {}, requestingUser) {
  const now = new Date().toISOString();
  const current = existingAudit && typeof existingAudit === 'object' ? existingAudit : {};
  const updateUserId = toPublicId(requestingUser?.id) || String(requestingUser?.username || 'SYSTEM');
  return {
    createUser: String(current.createUser || updateUserId),
    createDateTime: String(current.createDateTime || now),
    lastUpdateUser: updateUserId,
    lastUpdateDateTime: now
  };
}

async function getTargetUserOrThrow(targetUserId) {
  const id = toPublicId(targetUserId);
  if (!id) throw new Error('targetUserId is required.');
  const user = await dataService.getDataById('users', id, SYSTEM_CONTEXT);
  if (!user) throw new Error(`Target user '${id}' was not found.`);
  return user;
}

function findUserOrgMembership(user = {}, orgId = '') {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) return { index: -1, membership: null };
  const organizations = Array.isArray(user?.organizations) ? user.organizations : [];
  const index = organizations.findIndex((item) => idsEqual(item?.orgId, targetOrgId));
  if (index < 0) return { index: -1, membership: null };
  return { index, membership: organizations[index] };
}

async function validateProfilesForOrg(profileIds = [], orgId = '', requestingUser) {
  const targetOrgId = toPublicId(orgId);
  const ids = normalizeIdList(profileIds);
  const rows = [];

  for (const profileId of ids) {
    // eslint-disable-next-line no-await-in-loop
    const profile = await dataService.getDataById('accesses', profileId, SYSTEM_CONTEXT);
    if (!profile) {
      throw new Error(`Access profile '${profileId}' was not found.`);
    }
    if (!idsEqual(profile?.orgId, targetOrgId)) {
      throw new Error(`Access profile '${profileId}' does not belong to organization '${targetOrgId}'.`);
    }

    if (
      requestingUser
      && requestingUser !== SYSTEM_CONTEXT
      && !adminChekersService.isSuperAdmin(requestingUser)
    ) {
      // eslint-disable-next-line no-await-in-loop
      const delegation = await securityService.validateDelegation(requestingUser, profileId, targetOrgId);
      if (!delegation?.allowed) {
        throw new Error(delegation?.reason || `Delegation check failed for profile '${profileId}'.`);
      }
    }

    rows.push(profile);
  }

  return rows;
}

async function persistUserOrganizations(user, organizations, requestingUser, options = {}) {
  const patch = {
    organizations,
    audit: buildAuditPatch(user?.audit || {}, requestingUser)
  };
  return dataService.updateData('users', user.id, patch, requestingUser || SYSTEM_CONTEXT, options);
}

const userAccessProfileService = {
  async grantProfilesToUserOrg({
    targetUserId,
    orgId,
    profileIds = [],
    origin = {},
    requestingUser,
    options = {}
  } = {}) {
    const targetOrgId = toPublicId(orgId);
    if (!targetOrgId) throw new Error('orgId is required.');

    const requestedProfileIds = normalizeIdList(profileIds);
    if (!requestedProfileIds.length) {
      return {
        updatedUser: await getTargetUserOrThrow(targetUserId),
        addedProfileIds: [],
        existingProfileIds: [],
        finalProfileIds: []
      };
    }

    await validateProfilesForOrg(requestedProfileIds, targetOrgId, requestingUser);

    const user = await getTargetUserOrThrow(targetUserId);
    const organizations = Array.isArray(user.organizations) ? user.organizations.map((item) => ({ ...item })) : [];
    const { index, membership } = findUserOrgMembership(user, targetOrgId);
    if (index < 0 || !membership) {
      throw new Error(`Target user is not a member of organization '${targetOrgId}'.`);
    }

    const resolvedOrigin = normalizeOrigin(origin);
    const currentManaged = normalizeManagedAccessProfiles(membership?.managedAccessProfiles || []);
    const currentDirect = getDirectProfileIds(membership || {});
    const currentEffective = composeEffectiveProfileIds(currentDirect, currentManaged);
    const existingProfileIds = requestedProfileIds.filter((id) => currentEffective.includes(id));
    const addedProfileIds = requestedProfileIds.filter((id) => !currentEffective.includes(id));

    let nextDirect = currentDirect.slice();
    let nextManaged = currentManaged.slice();

    if (resolvedOrigin.isManaged) {
      requestedProfileIds.forEach((profileId) => {
        const alreadyTracked = nextManaged.some(
          (entry) => idsEqual(entry?.profileId, profileId) && sameManagedSource(entry, resolvedOrigin)
        );
        if (alreadyTracked) return;
        nextManaged.push({
          profileId,
          sourceType: resolvedOrigin.type,
          sourceRefId: resolvedOrigin.sourceRefId,
          sourceLabel: resolvedOrigin.sourceLabel,
          locked: true,
          createdAt: new Date().toISOString(),
          createdBy: toPublicId(requestingUser?.id) || String(requestingUser?.username || 'System')
        });
      });
    } else {
      nextDirect = normalizeIdList([...nextDirect, ...requestedProfileIds]);
    }

    organizations[index] = upsertMembershipAccess(membership, {
      directProfileIds: nextDirect,
      managedEntries: nextManaged
    });

    const finalProfileIds = normalizeIdList(organizations[index]?.accessProfileIds || []);

    const updatedUser = await persistUserOrganizations(user, organizations, requestingUser, options);
    return {
      updatedUser,
      addedProfileIds,
      existingProfileIds,
      finalProfileIds
    };
  },

  async revokeProfilesFromUserOrg({
    targetUserId,
    orgId,
    profileIds = [],
    preserveProfileIds = [],
    origin = {},
    requestingUser,
    options = {}
  } = {}) {
    const targetOrgId = toPublicId(orgId);
    if (!targetOrgId) throw new Error('orgId is required.');

    const requestedProfileIds = normalizeIdList(profileIds);
    const protectedProfileIds = new Set(normalizeIdList(preserveProfileIds));
    if (!requestedProfileIds.length) {
      const unchanged = await getTargetUserOrThrow(targetUserId);
      const membership = findUserOrgMembership(unchanged, targetOrgId).membership || {};
      return {
        updatedUser: unchanged,
        removedProfileIds: [],
        retainedProfileIds: normalizeIdList(membership.accessProfileIds || [])
      };
    }

    const user = await getTargetUserOrThrow(targetUserId);
    const organizations = Array.isArray(user.organizations) ? user.organizations.map((item) => ({ ...item })) : [];
    const { index, membership } = findUserOrgMembership(user, targetOrgId);
    if (index < 0 || !membership) {
      throw new Error(`Target user is not a member of organization '${targetOrgId}'.`);
    }

    const resolvedOrigin = normalizeOrigin(origin);
    const currentManaged = normalizeManagedAccessProfiles(membership?.managedAccessProfiles || []);
    const currentDirect = getDirectProfileIds(membership || {});
    const currentEffective = composeEffectiveProfileIds(currentDirect, currentManaged);

    let nextManaged = currentManaged.slice();
    let nextDirect = currentDirect.slice();

    if (resolvedOrigin.isManaged) {
      const requestedSet = new Set(requestedProfileIds);
      let removedManagedCount = 0;
      nextManaged = nextManaged.filter((entry) => {
        const profileId = toPublicId(entry?.profileId || '');
        if (!profileId || !requestedSet.has(profileId)) return true;
        if (sameManagedSource(entry, resolvedOrigin)) {
          removedManagedCount += 1;
          return false;
        }
        return true;
      });
      if (removedManagedCount === 0) {
        // Backward compatibility: legacy rows may not have managed source tracking.
        // In that case, apply preserve-aware direct removal behavior.
        const managedProfileIds = new Set(extractManagedProfileIds(currentManaged));
        const toRemove = new Set(
          requestedProfileIds.filter((id) => !protectedProfileIds.has(id) && !managedProfileIds.has(id))
        );
        nextDirect = nextDirect.filter((id) => !toRemove.has(id));
      }
    } else {
      const managedProfileIds = new Set(extractManagedProfileIds(currentManaged));
      const toRemove = new Set(
        requestedProfileIds.filter((id) => !protectedProfileIds.has(id) && !managedProfileIds.has(id))
      );
      nextDirect = nextDirect.filter((id) => !toRemove.has(id));
    }

    const retainedProfileIds = composeEffectiveProfileIds(nextDirect, nextManaged);
    const removedProfileIds = currentEffective.filter((id) => !retainedProfileIds.includes(id));

    organizations[index] = upsertMembershipAccess(membership, {
      directProfileIds: nextDirect,
      managedEntries: nextManaged
    });

    const updatedUser = await persistUserOrganizations(user, organizations, requestingUser, options);
    return {
      updatedUser,
      removedProfileIds,
      retainedProfileIds
    };
  },

  async applyPackageProfiles({
    targetUserId,
    orgId,
    packageProfileIds = [],
    sourceType = 'activity_quota_package',
    sourceRefId = '',
    sourceLabel = '',
    requestingUser,
    options = {}
  } = {}) {
    const targetOrgId = toPublicId(orgId);
    if (!targetOrgId) throw new Error('orgId is required.');
    const profileIds = normalizeIdList(packageProfileIds);

    const user = await getTargetUserOrThrow(targetUserId);
    const { membership } = findUserOrgMembership(user, targetOrgId);
    if (!membership) {
      throw new Error(`Target user is not a member of organization '${targetOrgId}'.`);
    }

    const currentManaged = normalizeManagedAccessProfiles(membership?.managedAccessProfiles || []);
    const currentDirect = getDirectProfileIds(membership || {});
    const currentProfileIds = composeEffectiveProfileIds(currentDirect, currentManaged);
    const preExistingProfileIds = profileIds.filter((id) => currentProfileIds.includes(id));

    const grantSummary = await this.grantProfilesToUserOrg({
      targetUserId,
      orgId: targetOrgId,
      profileIds,
      origin: {
        type: sourceType,
        sourceRefId,
        sourceLabel
      },
      requestingUser,
      options
    });

    return {
      ...grantSummary,
      preExistingProfileIds
    };
  },

  async removePackageProfiles({
    targetUserId,
    orgId,
    packageProfileIds = [],
    preExistingProfileIds = [],
    sourceType = 'activity_quota_package',
    sourceRefId = '',
    requestingUser,
    options = {}
  } = {}) {
    return this.revokeProfilesFromUserOrg({
      targetUserId,
      orgId,
      profileIds: packageProfileIds,
      preserveProfileIds: preExistingProfileIds,
      origin: {
        type: sourceType,
        sourceRefId
      },
      requestingUser,
      options
    });
  }
};

module.exports = userAccessProfileService;
