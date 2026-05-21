const dataService = require('../dataService');
const { SYSTEM_CONTEXT } = require('../../../config/constants');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');

function cloneIfObject(value) {
  if (!value || typeof value !== 'object') return {};
  return JSON.parse(JSON.stringify(value));
}

function mergePermissionLimitValue(current, incoming) {
  if (incoming === undefined) return current;
  if (incoming === null) return null;
  if (current === undefined) return incoming;
  if (current === null) return null;
  return Math.max(Number(current) || 0, Number(incoming) || 0);
}

function mergeAccessConfig(baseConfig, nextConfig) {
  const merged = { ...cloneIfObject(baseConfig), ...cloneIfObject(nextConfig) };
  merged.executionLimits = { ...(baseConfig?.executionLimits || {}), ...(nextConfig?.executionLimits || {}) };
  merged.timeLimits = { ...(baseConfig?.timeLimits || {}), ...(nextConfig?.timeLimits || {}) };
  merged.throughputLimits = { ...(baseConfig?.throughputLimits || {}), ...(nextConfig?.throughputLimits || {}) };

  merged.executionLimits.maxAttemptsPerSession = mergePermissionLimitValue(
    baseConfig?.executionLimits?.maxAttemptsPerSession,
    nextConfig?.executionLimits?.maxAttemptsPerSession
  );
  merged.timeLimits.maxSessionDurationMinutes = mergePermissionLimitValue(
    baseConfig?.timeLimits?.maxSessionDurationMinutes,
    nextConfig?.timeLimits?.maxSessionDurationMinutes
  );
  merged.throughputLimits.maxFetchVolumeKB = mergePermissionLimitValue(
    baseConfig?.throughputLimits?.maxFetchVolumeKB,
    nextConfig?.throughputLimits?.maxFetchVolumeKB
  );

  if (nextConfig?.accessType === 'full_access' || baseConfig?.accessType === 'full_access') merged.accessType = 'full_access';
  if (nextConfig?.adminAccess === true || baseConfig?.adminAccess === true) merged.adminAccess = true;

  return merged;
}

function mergeAccessProfiles(profiles, scopeLevelMap) {
  const list = Array.isArray(profiles) ? profiles.filter((p) => p && p.active !== false) : [];
  if (!list.length) return null;
  if (list.length === 1) return list[0];

  const mergedSections = new Map();
  const mergedCategorySet = new Set();

  for (const profile of list) {
    const categories = Array.isArray(profile?.adminCategories) ? profile.adminCategories : [];
    categories.forEach((category) => mergedCategorySet.add(String(category || '').trim()));

    const sections = Array.isArray(profile?.sections) ? profile.sections : [];
    for (const section of sections) {
      const sectionId = String(section?.sectionId || '').trim();
      if (!sectionId) continue;

      if (!mergedSections.has(sectionId)) {
        mergedSections.set(sectionId, { ...cloneIfObject(section), sectionId, operations: [] });
      } else {
        const currentSection = mergedSections.get(sectionId);
        mergedSections.set(sectionId, {
          ...mergeAccessConfig(currentSection, section),
          sectionId,
          operations: Array.isArray(currentSection.operations) ? currentSection.operations : []
        });
      }

      const targetSection = mergedSections.get(sectionId);
      if (section?.adminAccess === true || targetSection?.adminAccess === true) {
        targetSection.adminAccess = true;
        targetSection.operations = [];
        continue;
      }

      const opMap = new Map(
        (Array.isArray(targetSection.operations) ? targetSection.operations : [])
          .map((op) => [String(op.operationId || ''), op])
      );
      const incomingOps = Array.isArray(section?.operations) ? section.operations : [];
      for (const operation of incomingOps) {
        const operationId = String(operation?.operationId || '').trim();
        if (!operationId) continue;

        const currentOp = opMap.get(operationId);
        if (!currentOp) {
          opMap.set(operationId, { ...cloneIfObject(operation), operationId });
          continue;
        }

        const currentScope = Number(scopeLevelMap.get(toPublicId(currentOp.scopeId)) || 0);
        const nextScope = Number(scopeLevelMap.get(toPublicId(operation.scopeId)) || 0);
        const preferred = nextScope > currentScope ? operation : currentOp;
        const mergedOp = mergeAccessConfig(currentOp, operation);
        mergedOp.operationId = operationId;
        mergedOp.scopeId = toPublicId(preferred?.scopeId || currentOp.scopeId || operation.scopeId);
        opMap.set(operationId, mergedOp);
      }
      targetSection.operations = Array.from(opMap.values());
    }
  }

  const mergedProfile = {
    id: `MERGED_${list.map((p) => toPublicId(p.id)).filter(Boolean).join('_')}`,
    name: list.map((p) => p.name).filter(Boolean).join(' + ') || 'Merged Access Profile',
    description: `Merged from ${list.length} local access profiles.`,
    active: true,
    fullAdmin: list.some((p) => p?.fullAdmin === true),
    adminCategories: Array.from(mergedCategorySet).filter(Boolean),
    sections: Array.from(mergedSections.values())
  };

  if (list.some((p) => !p?.orgId)) mergedProfile.orgId = null;
  return mergedProfile;
}

async function loadMergedProfileByIds(profileIds, requestUser = SYSTEM_CONTEXT) {
  const ids = Array.isArray(profileIds)
    ? profileIds.map((id) => toPublicId(id)).filter(Boolean)
    : [];
  if (!ids.length) return null;

  const allScopes = await dataService.fetchData('scopes', {}, SYSTEM_CONTEXT);
  const scopeLevelMap = new Map((allScopes || []).map((scope) => [toPublicId(scope.id), Number(scope.level) || 0]));
  const profiles = (await Promise.all(
    ids.map((profileId) => dataService.getDataById('accesses', profileId, requestUser))
  )).filter((profile) => profile && profile.active);

  return mergeAccessProfiles(profiles, scopeLevelMap);
}

async function loadMergedProfileForOrg(user, orgId, requestUser = SYSTEM_CONTEXT) {
  const orgConfig = Array.isArray(user?.organizations)
    ? user.organizations.find((org) => idsEqual(org?.orgId, orgId))
    : null;
  return loadMergedProfileByIds(orgConfig?.accessProfileIds || [], requestUser);
}

module.exports = {
  mergeAccessProfiles,
  loadMergedProfileByIds,
  loadMergedProfileForOrg
};
