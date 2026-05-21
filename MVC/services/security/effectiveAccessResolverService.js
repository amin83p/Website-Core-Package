const scopeRepository = require('../../repositories/scopeRepository');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');

const ACCESS_TYPE = Object.freeze({
  NONE: 'none',
  CUSTOM: 'custom',
  FULL_ACCESS: 'full_access',
  FULL_BAN: 'full_ban'
});

const DECISION_SOURCE = Object.freeze({
  ORG_POLICY_TARGETED: 'org_policy_targeted',
  PROFILE_POLICY_MERGE: 'profile_policy_merge'
});

const ADMIN_SCOPE_ALIASES = new Set([
  'ADMIN',
  'SCP_ADMIN'
]);

const KNOWN_SCOPE_MODE_BY_ID = Object.freeze({
  SCP_ADMIN: 'admin',
  SCP_ORG: 'organization',
  SCP_DEPT: 'department',
  SCP_DIV: 'division',
  SCP_OWNER: 'owner',
  SCP_USER: 'user'
});

const KNOWN_SCOPE_MODE_BY_NAME = Object.freeze({
  ADMIN: 'admin',
  ORGANIZATION: 'organization',
  ORG: 'organization',
  DEPARTMENT: 'department',
  DEPT: 'department',
  DIVISION: 'division',
  DIV: 'division',
  OWNER: 'owner',
  USER: 'user',
  GLOBAL: 'global'
});

const SCOPE_CACHE_TTL_MS = 60 * 1000;

const scopeModeCache = {
  loadedAt: 0,
  byId: new Map(),
  byName: new Map(),
  loadPromise: null
};

function normalizeToken(value) {
  return String(value || '').trim();
}

function normalizeUpper(value) {
  return normalizeToken(value).toUpperCase();
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const token = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function normalizeAccessType(value, fallback = ACCESS_TYPE.CUSTOM) {
  const token = normalizeToken(value).toLowerCase();
  if (!token) return fallback;
  if (token === ACCESS_TYPE.FULL_ACCESS || token === 'allow') return ACCESS_TYPE.FULL_ACCESS;
  if (token === ACCESS_TYPE.FULL_BAN || token === 'ban' || token === 'suspended') return ACCESS_TYPE.FULL_BAN;
  if (token === ACCESS_TYPE.CUSTOM) return ACCESS_TYPE.CUSTOM;
  if (token === ACCESS_TYPE.NONE) return ACCESS_TYPE.NONE;
  return fallback;
}

function normalizeOrgIdToken(value) {
  const token = normalizeUpper(value);
  if (!token) return '';
  if (token === 'SYSTEM' || token === 'GLOBAL') return 'SYSTEM';
  return token;
}

function cloneDeep(value) {
  if (!value || typeof value !== 'object') return {};
  return JSON.parse(JSON.stringify(value));
}

function resolveSectionId(row = {}) {
  return normalizeToken(row.sectionId || row.id || row.section || row.sectionKey || '');
}

function resolveOperationId(row = {}) {
  return normalizeToken(row.operationId || row.id || row.operation || row.operationKey || '');
}

function findSectionConfig(rows = [], sectionId = '') {
  const target = normalizeToken(sectionId);
  if (!target || !Array.isArray(rows)) return null;
  return rows.find((row) => idsEqual(resolveSectionId(row), target)) || null;
}

function findOperationConfig(rows = [], operationId = '') {
  const target = normalizeToken(operationId);
  if (!target || !Array.isArray(rows)) return null;
  return rows.find((row) => idsEqual(resolveOperationId(row), target)) || null;
}

function policyAppliesToOrg(policy = null, user = null, orgId = '') {
  if (!policy || typeof policy !== 'object') return false;
  if (normalizeBoolean(policy.active, true) === false) return false;
  const policyOrgId = normalizeOrgIdToken(toPublicId(policy.orgId || ''));
  if (!policyOrgId) return true;
  const targetOrgId = normalizeOrgIdToken(toPublicId(orgId || user?.activeOrgId || user?.primaryOrgId || ''));
  if (!targetOrgId) return true;
  return idsEqual(policyOrgId, targetOrgId);
}

function normalizeTargetUserIds(value) {
  const rows = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  rows.forEach((entry) => {
    const id = toPublicId(entry);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

function blockTargetsUser(block = null, userId = '') {
  if (!block || typeof block !== 'object') return false;
  const ids = normalizeTargetUserIds(block.targetUserIds);
  if (!ids.length) return true;
  const targetUserId = toPublicId(userId);
  if (!targetUserId) return false;
  return ids.some((entry) => idsEqual(entry, targetUserId));
}

function sectionTargetsUser(section = null, userId = '') {
  return blockTargetsUser(section, userId);
}

function findTargetedOrgPolicySection(rows = [], sectionId = '', userId = '') {
  const candidate = findSectionConfig(rows, sectionId);
  if (!candidate) return null;
  if (!sectionTargetsUser(candidate, userId)) return null;
  return candidate;
}

function sectionAccessTypeFromProfile(profileSection = null) {
  if (!profileSection || typeof profileSection !== 'object') return ACCESS_TYPE.NONE;
  if (normalizeBoolean(profileSection.adminAccess, false)) return ACCESS_TYPE.FULL_ACCESS;
  return ACCESS_TYPE.CUSTOM;
}

function operationAccessTypeFromProfile(profileOperation = null) {
  if (!profileOperation || typeof profileOperation !== 'object') return ACCESS_TYPE.NONE;
  if (normalizeBoolean(profileOperation.adminAccess, false)) return ACCESS_TYPE.FULL_ACCESS;
  return normalizeAccessType(profileOperation.accessType, ACCESS_TYPE.CUSTOM);
}

function resolveKnownScopeMode(scopeToken = '') {
  const token = normalizeUpper(scopeToken);
  if (!token) return '';
  if (KNOWN_SCOPE_MODE_BY_ID[token]) return KNOWN_SCOPE_MODE_BY_ID[token];
  if (KNOWN_SCOPE_MODE_BY_NAME[token]) return KNOWN_SCOPE_MODE_BY_NAME[token];
  return '';
}

function resolveScopeModeFromCache(scopeToken = '') {
  const token = normalizeUpper(scopeToken);
  if (!token) return '';
  if (scopeModeCache.byId.has(token)) return scopeModeCache.byId.get(token) || '';
  if (scopeModeCache.byName.has(token)) return scopeModeCache.byName.get(token) || '';
  return '';
}

function scopeCacheIsFresh() {
  return (Date.now() - scopeModeCache.loadedAt) < SCOPE_CACHE_TTL_MS;
}

function normalizeScopeMode(value) {
  const token = normalizeToken(value).toLowerCase();
  if (!token) return '';
  if (['admin', 'organization', 'department', 'division', 'owner', 'user', 'global'].includes(token)) {
    return token;
  }
  return '';
}

async function loadScopeModeCache() {
  const rows = await scopeRepository.list({
    scope: { canViewAll: true }
  });
  const byId = new Map();
  const byName = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const scopeId = normalizeUpper(row?.id || '');
    const scopeName = normalizeUpper(row?.name || '');
    const definitionMode = normalizeScopeMode(row?.definition?.mode || '');
    const legacyMode = normalizeScopeMode(resolveKnownScopeMode(scopeName) || resolveKnownScopeMode(scopeId));
    const resolvedMode = definitionMode || legacyMode;
    if (!resolvedMode) return;
    if (scopeId) byId.set(scopeId, resolvedMode);
    if (scopeName) byName.set(scopeName, resolvedMode);
  });
  scopeModeCache.byId = byId;
  scopeModeCache.byName = byName;
  scopeModeCache.loadedAt = Date.now();
}

async function ensureScopeModeCache() {
  if (scopeCacheIsFresh()) return;
  if (scopeModeCache.loadPromise) {
    await scopeModeCache.loadPromise;
    return;
  }
  scopeModeCache.loadPromise = loadScopeModeCache();
  try {
    await scopeModeCache.loadPromise;
  } catch (_) {
    // Keep old cache and fall back to aliases.
  } finally {
    scopeModeCache.loadPromise = null;
  }
}

function isAdminScopeSync(scopeToken = '') {
  const token = normalizeUpper(scopeToken);
  if (!token) return false;
  if (ADMIN_SCOPE_ALIASES.has(token)) return true;
  const knownMode = resolveKnownScopeMode(token);
  if (knownMode === 'admin') return true;
  const cachedMode = resolveScopeModeFromCache(token);
  return cachedMode === 'admin';
}

async function getScopeMode(scopeToken = '') {
  const token = normalizeUpper(scopeToken);
  if (!token) return '';
  const known = resolveKnownScopeMode(token);
  if (known) return known;
  const cached = resolveScopeModeFromCache(token);
  if (cached) return cached;
  await ensureScopeModeCache();
  return resolveScopeModeFromCache(token);
}

async function isAdminScope(scopeToken = '') {
  const mode = await getScopeMode(scopeToken);
  return mode === 'admin' || ADMIN_SCOPE_ALIASES.has(normalizeUpper(scopeToken));
}

function sectionCustomHasAllowedOperation(sectionConfig = null) {
  if (!sectionConfig || typeof sectionConfig !== 'object') return false;
  const rows = Array.isArray(sectionConfig.operations) ? sectionConfig.operations : [];
  return rows.some((op) => operationCanContributeSectionVisibility(op));
}

function buildSectionState({
  profileSection = null,
  policySection = null,
  orgPolicySection = null
} = {}) {
  if (orgPolicySection) {
    const orgPolicyAccessType = normalizeAccessType(orgPolicySection.accessType, ACCESS_TYPE.CUSTOM);
    let allowed = false;
    if (orgPolicyAccessType === ACCESS_TYPE.FULL_ACCESS) {
      allowed = true;
    } else if (orgPolicyAccessType === ACCESS_TYPE.CUSTOM) {
      allowed = sectionCustomHasAllowedOperation(orgPolicySection);
    }
    return {
      accessType: orgPolicyAccessType,
      source: DECISION_SOURCE.ORG_POLICY_TARGETED,
      decisionSource: DECISION_SOURCE.ORG_POLICY_TARGETED,
      allowed,
      isSectionAdmin: orgPolicyAccessType === ACCESS_TYPE.FULL_ACCESS,
      isBanned: orgPolicyAccessType === ACCESS_TYPE.FULL_BAN,
      hasProfileSection: Boolean(profileSection),
      hasPolicySection: Boolean(policySection),
      hasOrgPolicySection: true,
      profileSectionConfig: profileSection || null,
      policySectionConfig: policySection || null,
      orgPolicySectionConfig: orgPolicySection || null
    };
  }

  const profileAccessType = sectionAccessTypeFromProfile(profileSection);
  const policyAccessType = policySection
    ? normalizeAccessType(policySection.accessType, ACCESS_TYPE.CUSTOM)
    : ACCESS_TYPE.NONE;

  let accessType = profileAccessType;
  let source = profileSection ? 'profile' : '';

  if (policySection) {
    if (policyAccessType === ACCESS_TYPE.FULL_BAN) {
      accessType = ACCESS_TYPE.FULL_BAN;
      source = 'policy';
    } else if (policyAccessType === ACCESS_TYPE.FULL_ACCESS) {
      accessType = ACCESS_TYPE.FULL_ACCESS;
      source = 'policy';
    } else {
      accessType = ACCESS_TYPE.CUSTOM;
      source = source ? `${source}+policy` : 'policy';
    }
  }

  let allowed = false;
  if (accessType === ACCESS_TYPE.FULL_ACCESS) {
    allowed = true;
  } else if (accessType === ACCESS_TYPE.CUSTOM) {
    const hasPolicyAllowedOperation = Array.isArray(policySection?.operations)
      && policySection.operations.some((op) => operationCanContributeSectionVisibility(op));
    allowed = Boolean(profileSection) || hasPolicyAllowedOperation;
  } else {
    allowed = false;
  }

  return {
    accessType,
    source,
    decisionSource: DECISION_SOURCE.PROFILE_POLICY_MERGE,
    allowed,
    isSectionAdmin: accessType === ACCESS_TYPE.FULL_ACCESS,
    isBanned: accessType === ACCESS_TYPE.FULL_BAN,
    hasProfileSection: Boolean(profileSection),
    hasPolicySection: Boolean(policySection),
    hasOrgPolicySection: false,
    profileSectionConfig: profileSection || null,
    policySectionConfig: policySection || null,
    orgPolicySectionConfig: null
  };
}

function buildDeniedOperationState({
  source = '',
  profileOperation = null,
  policyOperation = null,
  orgPolicyOperation = null,
  accessType = ACCESS_TYPE.FULL_BAN,
  isBanned = true
} = {}) {
  return {
    accessType,
    source,
    decisionSource: source || DECISION_SOURCE.PROFILE_POLICY_MERGE,
    allowed: false,
    isBanned,
    isOperationAdmin: false,
    scopeId: normalizeToken(
      orgPolicyOperation?.scopeId
      || policyOperation?.scopeId
      || profileOperation?.scopeId
      || ''
    ),
    hasProfileOperation: Boolean(profileOperation),
    hasPolicyOperation: Boolean(policyOperation),
    hasOrgPolicyOperation: Boolean(orgPolicyOperation),
    profileOperationConfig: profileOperation || null,
    policyOperationConfig: policyOperation || null,
    orgPolicyOperationConfig: orgPolicyOperation || null
  };
}

async function buildOperationState({
  sectionState,
  profileOperation = null,
  policyOperation = null,
  orgPolicyOperation = null
} = {}) {
  if (!sectionState || sectionState.isBanned) {
    return buildDeniedOperationState({
      source: sectionState?.decisionSource || DECISION_SOURCE.PROFILE_POLICY_MERGE,
      profileOperation,
      policyOperation,
      orgPolicyOperation
    });
  }

  if (sectionState.decisionSource === DECISION_SOURCE.ORG_POLICY_TARGETED) {
    if (sectionState.isSectionAdmin) {
      return {
        accessType: ACCESS_TYPE.FULL_ACCESS,
        source: DECISION_SOURCE.ORG_POLICY_TARGETED,
        decisionSource: DECISION_SOURCE.ORG_POLICY_TARGETED,
        allowed: true,
        isBanned: false,
        isOperationAdmin: true,
        scopeId: normalizeToken(orgPolicyOperation?.scopeId || ''),
        hasProfileOperation: Boolean(profileOperation),
        hasPolicyOperation: Boolean(policyOperation),
        hasOrgPolicyOperation: Boolean(orgPolicyOperation),
        profileOperationConfig: profileOperation || null,
        policyOperationConfig: policyOperation || null,
        orgPolicyOperationConfig: orgPolicyOperation || null
      };
    }

    if (!orgPolicyOperation) {
      return buildDeniedOperationState({
        source: DECISION_SOURCE.ORG_POLICY_TARGETED,
        profileOperation,
        policyOperation,
        orgPolicyOperation,
        accessType: ACCESS_TYPE.NONE,
        isBanned: false
      });
    }

    const opAccessType = normalizeAccessType(orgPolicyOperation.accessType, ACCESS_TYPE.CUSTOM);
    const scopeId = normalizeToken(orgPolicyOperation?.scopeId || '');
    if (opAccessType === ACCESS_TYPE.FULL_BAN) {
      return buildDeniedOperationState({
        source: DECISION_SOURCE.ORG_POLICY_TARGETED,
        profileOperation,
        policyOperation,
        orgPolicyOperation
      });
    }

    if (opAccessType === ACCESS_TYPE.FULL_ACCESS) {
      return {
        accessType: ACCESS_TYPE.FULL_ACCESS,
        source: DECISION_SOURCE.ORG_POLICY_TARGETED,
        decisionSource: DECISION_SOURCE.ORG_POLICY_TARGETED,
        allowed: true,
        isBanned: false,
        isOperationAdmin: true,
        scopeId,
        hasProfileOperation: Boolean(profileOperation),
        hasPolicyOperation: Boolean(policyOperation),
        hasOrgPolicyOperation: true,
        profileOperationConfig: profileOperation || null,
        policyOperationConfig: policyOperation || null,
        orgPolicyOperationConfig: orgPolicyOperation
      };
    }

    const operationAdminByScope = await isAdminScope(scopeId);
    return {
      accessType: ACCESS_TYPE.CUSTOM,
      source: DECISION_SOURCE.ORG_POLICY_TARGETED,
      decisionSource: DECISION_SOURCE.ORG_POLICY_TARGETED,
      allowed: true,
      isBanned: false,
      isOperationAdmin: operationAdminByScope,
      scopeId,
      hasProfileOperation: Boolean(profileOperation),
      hasPolicyOperation: Boolean(policyOperation),
      hasOrgPolicyOperation: true,
      profileOperationConfig: profileOperation || null,
      policyOperationConfig: policyOperation || null,
      orgPolicyOperationConfig: orgPolicyOperation
    };
  }

  if (sectionState.isSectionAdmin) {
    return {
      accessType: ACCESS_TYPE.FULL_ACCESS,
      source: sectionState.source || 'section',
      decisionSource: DECISION_SOURCE.PROFILE_POLICY_MERGE,
      allowed: true,
      isBanned: false,
      isOperationAdmin: true,
      scopeId: normalizeToken(
        policyOperation?.scopeId
        || profileOperation?.scopeId
        || ''
      ),
      hasProfileOperation: Boolean(profileOperation),
      hasPolicyOperation: Boolean(policyOperation),
      hasOrgPolicyOperation: false,
      profileOperationConfig: profileOperation || null,
      policyOperationConfig: policyOperation || null,
      orgPolicyOperationConfig: null
    };
  }

  const profileAccessType = operationAccessTypeFromProfile(profileOperation);
  const policyAccessType = policyOperation
    ? normalizeAccessType(policyOperation.accessType, ACCESS_TYPE.CUSTOM)
    : ACCESS_TYPE.NONE;

  let accessType = profileAccessType;
  let source = profileOperation ? 'profile' : '';
  let scopeId = normalizeToken(profileOperation?.scopeId || '');

  if (policyOperation) {
    if (policyAccessType === ACCESS_TYPE.FULL_BAN) {
      accessType = ACCESS_TYPE.FULL_BAN;
      source = 'policy';
    } else if (policyAccessType === ACCESS_TYPE.FULL_ACCESS) {
      accessType = ACCESS_TYPE.FULL_ACCESS;
      source = 'policy';
      scopeId = normalizeToken(policyOperation?.scopeId || scopeId || '');
    } else {
      accessType = ACCESS_TYPE.CUSTOM;
      source = source ? `${source}+policy` : 'policy';
      scopeId = normalizeToken(policyOperation?.scopeId || scopeId || '');
    }
  }

  let allowed = false;
  if (accessType === ACCESS_TYPE.FULL_ACCESS) {
    allowed = true;
  } else if (accessType === ACCESS_TYPE.CUSTOM) {
    // Custom policy fallback rule:
    // if policy custom does not ban and exists, allow by fallback to profile OR explicit policy op.
    allowed = Boolean(profileOperation || policyOperation);
  } else {
    allowed = false;
  }

  const operationAdminByScope = accessType === ACCESS_TYPE.CUSTOM
    ? await isAdminScope(scopeId)
    : false;

  const isOperationAdmin = accessType === ACCESS_TYPE.FULL_ACCESS || operationAdminByScope;

  return {
    accessType,
    source,
    decisionSource: DECISION_SOURCE.PROFILE_POLICY_MERGE,
    allowed,
    isBanned: accessType === ACCESS_TYPE.FULL_BAN,
    isOperationAdmin,
    scopeId,
    hasProfileOperation: Boolean(profileOperation),
    hasPolicyOperation: Boolean(policyOperation),
    hasOrgPolicyOperation: false,
    profileOperationConfig: profileOperation || null,
    policyOperationConfig: policyOperation || null,
    orgPolicyOperationConfig: null
  };
}

function getSectionScopeContribution(policySection = null) {
  if (!policySection || typeof policySection !== 'object') return null;
  const sectionId = resolveSectionId(policySection);
  if (!sectionId) return null;
  const accessType = normalizeAccessType(policySection.accessType, ACCESS_TYPE.CUSTOM);
  return {
    sectionId,
    accessType
  };
}

function operationCanContributeSectionVisibility(operationRow = null) {
  if (!operationRow || typeof operationRow !== 'object') return false;
  const accessType = normalizeAccessType(operationRow.accessType, ACCESS_TYPE.CUSTOM);
  if (accessType === ACCESS_TYPE.FULL_BAN || accessType === ACCESS_TYPE.NONE) return false;
  return true;
}

function applyPolicySectionOverrides({
  sections = [],
  profileSections = [],
  userId = '',
  enforceTargetedUsers = false,
  grantedSectionIds,
  bannedSectionIds
} = {}) {
  const rows = Array.isArray(sections) ? sections : [];
  rows.forEach((row) => {
    if (enforceTargetedUsers && !sectionTargetsUser(row, userId)) return;
    const contribution = getSectionScopeContribution(row);
    if (!contribution) return;
    if (contribution.accessType === ACCESS_TYPE.FULL_BAN) {
      bannedSectionIds.add(contribution.sectionId);
      grantedSectionIds.delete(contribution.sectionId);
      return;
    }
    if (contribution.accessType === ACCESS_TYPE.FULL_ACCESS) {
      grantedSectionIds.add(contribution.sectionId);
      bannedSectionIds.delete(contribution.sectionId);
      return;
    }

    const hasAllowedOperation = Array.isArray(row?.operations)
      && row.operations.some((op) => operationCanContributeSectionVisibility(op));

    if (enforceTargetedUsers) {
      if (hasAllowedOperation) {
        grantedSectionIds.add(contribution.sectionId);
        bannedSectionIds.delete(contribution.sectionId);
      } else {
        grantedSectionIds.delete(contribution.sectionId);
        bannedSectionIds.add(contribution.sectionId);
      }
      return;
    }

    if (hasAllowedOperation) {
      grantedSectionIds.add(contribution.sectionId);
      return;
    }

    const hasProfileSection = profileSections.some((profileSection) => idsEqual(resolveSectionId(profileSection), contribution.sectionId));
    if (hasProfileSection) {
      grantedSectionIds.add(contribution.sectionId);
    }
  });
}

async function resolveEffectiveAccess({
  user,
  sectionId,
  operationId,
  orgId
} = {}) {
  const sectionToken = normalizeToken(sectionId);
  const operationToken = normalizeToken(operationId);
  const profile = (user?.activeProfile && typeof user.activeProfile === 'object' && user.activeProfile.active !== false)
    ? user.activeProfile
    : null;
  const candidatePolicy = (user?.activePolicy && typeof user.activePolicy === 'object')
    ? user.activePolicy
    : null;
  const policy = policyAppliesToOrg(candidatePolicy, user, orgId) ? candidatePolicy : null;
  const candidateOrgPolicy = (user?.activeOrgPolicy && typeof user.activeOrgPolicy === 'object')
    ? user.activeOrgPolicy
    : null;
  const orgPolicy = policyAppliesToOrg(candidateOrgPolicy, user, orgId) ? candidateOrgPolicy : null;

  const profileSections = Array.isArray(profile?.sections) ? profile.sections : [];
  const policySections = Array.isArray(policy?.sections) ? policy.sections : [];
  const orgPolicySections = Array.isArray(orgPolicy?.sections) ? orgPolicy.sections : [];
  const userId = toPublicId(user?.id);

  const profileSection = sectionToken ? findSectionConfig(profileSections, sectionToken) : null;
  const policySection = sectionToken ? findSectionConfig(policySections, sectionToken) : null;
  const orgPolicySection = sectionToken
    ? findTargetedOrgPolicySection(orgPolicySections, sectionToken, userId)
    : null;

  const sectionState = buildSectionState({
    profileSection,
    policySection,
    orgPolicySection
  });

  let operationState = null;
  let profileOperation = null;
  let policyOperation = null;
  let orgPolicyOperation = null;

  if (operationToken) {
    const profileOperations = Array.isArray(profileSection?.operations) ? profileSection.operations : [];
    const policyOperations = Array.isArray(policySection?.operations) ? policySection.operations : [];
    const orgPolicyOperations = Array.isArray(orgPolicySection?.operations) ? orgPolicySection.operations : [];
    profileOperation = findOperationConfig(profileOperations, operationToken);
    policyOperation = findOperationConfig(policyOperations, operationToken);
    orgPolicyOperation = findOperationConfig(orgPolicyOperations, operationToken);
    operationState = await buildOperationState({
      sectionState,
      profileOperation,
      policyOperation,
      orgPolicyOperation
    });
  }

  const sectionDecisionSource = sectionState?.decisionSource || DECISION_SOURCE.PROFILE_POLICY_MERGE;
  const decisionSource = operationState?.decisionSource || sectionDecisionSource;

  return {
    sectionId: sectionToken,
    operationId: operationToken || null,
    section: sectionState,
    operation: operationState,
    profile: {
      active: Boolean(profile),
      id: toPublicId(profile?.id || '') || '',
      fullAdmin: normalizeBoolean(profile?.fullAdmin, false)
    },
    policy: {
      active: Boolean(policy),
      id: toPublicId(policy?.id || '')
    },
    orgPolicy: {
      active: Boolean(orgPolicy),
      id: toPublicId(orgPolicy?.id || '')
    },
    decisionSource,
    appliedPolicyContext: {
      orgPolicy: {
        active: Boolean(orgPolicy),
        id: toPublicId(orgPolicy?.id || ''),
        targetedSectionApplied: Boolean(orgPolicySection),
        sectionId: resolveSectionId(orgPolicySection || {}),
        sectionAccessType: orgPolicySection
          ? normalizeAccessType(orgPolicySection.accessType, ACCESS_TYPE.CUSTOM)
          : ACCESS_TYPE.NONE,
        operationId: resolveOperationId(orgPolicyOperation || {}),
        operationAccessType: orgPolicyOperation
          ? normalizeAccessType(orgPolicyOperation.accessType, ACCESS_TYPE.CUSTOM)
          : ACCESS_TYPE.NONE,
        sectionConfig: orgPolicySection || null,
        operationConfig: orgPolicyOperation || null
      },
      userPolicy: {
        active: Boolean(policy),
        id: toPublicId(policy?.id || ''),
        sectionId: resolveSectionId(policySection || {}),
        sectionAccessType: policySection
          ? normalizeAccessType(policySection.accessType, ACCESS_TYPE.CUSTOM)
          : ACCESS_TYPE.NONE,
        operationId: resolveOperationId(policyOperation || {}),
        operationAccessType: policyOperation
          ? normalizeAccessType(policyOperation.accessType, ACCESS_TYPE.CUSTOM)
          : ACCESS_TYPE.NONE,
        sectionConfig: policySection || null,
        operationConfig: policyOperation || null
      },
      profile: {
        active: Boolean(profile),
        id: toPublicId(profile?.id || ''),
        sectionId: resolveSectionId(profileSection || {}),
        operationId: resolveOperationId(profileOperation || {}),
        sectionConfig: profileSection || null,
        operationConfig: profileOperation || null
      }
    }
  };
}

function resolvePolicySectionScopeOverrides(user = null) {
  const profileSections = Array.isArray(user?.activeProfile?.sections) ? user.activeProfile.sections : [];
  const grantedSectionIds = new Set(
    profileSections
      .map((row) => resolveSectionId(row))
      .filter(Boolean)
  );
  const bannedSectionIds = new Set();

  const candidatePolicy = (user?.activePolicy && typeof user.activePolicy === 'object')
    ? user.activePolicy
    : null;
  const policy = policyAppliesToOrg(candidatePolicy, user, user?.activeOrgId) ? candidatePolicy : null;
  applyPolicySectionOverrides({
    sections: Array.isArray(policy?.sections) ? policy.sections : [],
    profileSections,
    grantedSectionIds,
    bannedSectionIds
  });

  const candidateOrgPolicy = (user?.activeOrgPolicy && typeof user.activeOrgPolicy === 'object')
    ? user.activeOrgPolicy
    : null;
  const orgPolicy = policyAppliesToOrg(candidateOrgPolicy, user, user?.activeOrgId) ? candidateOrgPolicy : null;
  applyPolicySectionOverrides({
    sections: Array.isArray(orgPolicy?.sections) ? orgPolicy.sections : [],
    profileSections,
    userId: toPublicId(user?.id),
    enforceTargetedUsers: true,
    grantedSectionIds,
    bannedSectionIds
  });

  return {
    grantedSectionIds: Array.from(grantedSectionIds.values()),
    bannedSectionIds: Array.from(bannedSectionIds.values())
  };
}

function parseLimitNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return fallback;
  if (parsed < 0) return fallback;
  return parsed;
}

function parsePolicyLimitBlock(block = null) {
  const source = block && typeof block === 'object' ? block : {};
  return {
    maxSessions: parseLimitNumber(source.maxSessions, null),
    maxDurationMins: parseLimitNumber(source.maxDuration, null),
    idleTimeoutMins: parseLimitNumber(source.idleTimeout, null)
  };
}

function pickStrictestLimit(candidates = [], fallback) {
  const values = candidates
    .map((value) => parseLimitNumber(value, null))
    .filter((value) => value !== null);
  if (!values.length) return fallback;
  return Math.min(...values);
}

function checkNetwork(networkConfig, userIp) {
  if (!networkConfig || !userIp) return true;
  const ipBlacklist = Array.isArray(networkConfig.ipBlacklist) ? networkConfig.ipBlacklist : [];
  const ipWhitelist = Array.isArray(networkConfig.ipWhitelist) ? networkConfig.ipWhitelist : [];
  if (ipBlacklist.length && ipBlacklist.includes(userIp)) return false;
  if (ipWhitelist.length && !ipWhitelist.includes(userIp)) return false;
  return true;
}

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = String(timeStr).split(':').map(Number);
  return ((h || 0) * 60) + (m || 0);
}

function checkSchedule(scheduleConfig, now = new Date()) {
  const weekdays = scheduleConfig && scheduleConfig.weekdays && typeof scheduleConfig.weekdays === 'object'
    ? scheduleConfig.weekdays
    : {};
  const configuredDays = Object.keys(weekdays);
  if (!configuredDays.length) return true;

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const currentDay = days[now.getDay()];
  const dayRules = Array.isArray(weekdays[currentDay]) ? weekdays[currentDay] : [];
  if (!dayRules.length) return false;

  const currentMinutes = (now.getHours() * 60) + now.getMinutes();
  return dayRules.some((slot) => {
    const start = timeToMinutes(slot?.start);
    const end = timeToMinutes(slot?.end);
    return currentMinutes >= start && currentMinutes <= end;
  });
}

function normalizeDeniedReason(reason, fallback = 'Access is denied by policy.') {
  const text = String(reason || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function buildDeniedResult({
  allowed = false,
  layer = '',
  control = '',
  code = 'ACCESS_DENIED',
  message = 'Access denied by policy.',
  reason = ''
} = {}) {
  return {
    allowed: Boolean(allowed),
    deniedCode: code,
    deniedMeta: {
      layer: String(layer || '').toLowerCase(),
      target: String(control || '').toLowerCase()
    },
    message,
    reason: normalizeDeniedReason(reason, message)
  };
}

async function resolveGlobalPolicyContext({
  user,
  orgId,
  ipAddress = '',
  websitePolicy = null,
  now = new Date()
} = {}) {
  if (!user) {
    return {
      allowed: true,
      website: { active: false, id: '' },
      orgPolicy: { active: false, id: '', targeted: {} },
      userPolicy: { active: false, id: '' },
      sessionLimits: {
        maxSessions: 10,
        maxDurationMins: 720,
        idleTimeoutMins: 60,
        sources: { website: {}, orgPolicy: {}, userPolicy: {} }
      },
      requestControl: {
        website: {},
        orgPolicy: null,
        orgPolicyApplied: false,
        source: 'website'
      },
      denied: null
    };
  }

  const userId = toPublicId(user?.id);
  const targetOrgId = normalizeOrgIdToken(toPublicId(orgId || user?.activeOrgId || user?.primaryOrgId || ''));
  const candidatePolicy = (user?.activePolicy && typeof user.activePolicy === 'object') ? user.activePolicy : null;
  const candidateOrgPolicy = (user?.activeOrgPolicy && typeof user.activeOrgPolicy === 'object') ? user.activeOrgPolicy : null;
  const userPolicy = policyAppliesToOrg(candidatePolicy, user, targetOrgId) ? candidatePolicy : null;
  const orgPolicy = policyAppliesToOrg(candidateOrgPolicy, user, targetOrgId) ? candidateOrgPolicy : null;
  const webPolicy = websitePolicy && typeof websitePolicy === 'object' ? websitePolicy : {};

  const orgNetworkApplies = blockTargetsUser(orgPolicy?.network, userId);
  const orgScheduleApplies = blockTargetsUser(orgPolicy?.globalSchedule, userId);
  const orgSessionApplies = blockTargetsUser(orgPolicy?.sessionControl, userId);
  const orgRequestControlApplies = blockTargetsUser(orgPolicy?.requestControl, userId);

  const websiteBannedUsers = Array.isArray(webPolicy?.bannedUsers) ? webPolicy.bannedUsers : [];
  const websiteBanRecord = websiteBannedUsers.find((row) => idsEqual(row?.userId, userId)) || null;
  if (websiteBanRecord) {
    const reason = normalizeDeniedReason(websiteBanRecord?.reason, 'Account is restricted by website policy.');
    return {
      allowed: false,
      denied: buildDeniedResult({
        layer: 'website',
        control: 'user',
        code: 'WEBSITE_POLICY_BANNED_USER',
        message: 'Your account is restricted by website policy.',
        reason
      }),
      website: { active: true, id: toPublicId(webPolicy?.id || '') },
      orgPolicy: { active: Boolean(orgPolicy), id: toPublicId(orgPolicy?.id || ''), targeted: {} },
      userPolicy: { active: Boolean(userPolicy), id: toPublicId(userPolicy?.id || '') },
      sessionLimits: null,
      requestControl: null
    };
  }

  const orgBannedUsers = Array.isArray(orgPolicy?.bannedUsers) ? orgPolicy.bannedUsers : [];
  const orgBanRecord = orgBannedUsers.find((row) => idsEqual(row?.userId, userId)) || null;
  if (orgBanRecord) {
    const reason = normalizeDeniedReason(orgBanRecord?.reason, 'Account is restricted by organization policy.');
    return {
      allowed: false,
      denied: buildDeniedResult({
        layer: 'organization',
        control: 'user',
        code: 'ORG_POLICY_BANNED_USER',
        message: 'Your account is restricted by organization policy.',
        reason
      }),
      website: { active: true, id: toPublicId(webPolicy?.id || '') },
      orgPolicy: {
        active: Boolean(orgPolicy),
        id: toPublicId(orgPolicy?.id || ''),
        targeted: {
          network: orgNetworkApplies,
          globalSchedule: orgScheduleApplies,
          sessionControl: orgSessionApplies,
          requestControl: orgRequestControlApplies
        }
      },
      userPolicy: { active: Boolean(userPolicy), id: toPublicId(userPolicy?.id || '') },
      sessionLimits: null,
      requestControl: null
    };
  }

  const websiteNetwork = (webPolicy?.network && typeof webPolicy.network === 'object') ? webPolicy.network : null;
  const orgNetwork = orgNetworkApplies && orgPolicy?.network && typeof orgPolicy.network === 'object'
    ? orgPolicy.network
    : null;
  const userNetwork = userPolicy?.network && typeof userPolicy.network === 'object'
    ? userPolicy.network
    : null;

  if (!checkNetwork(websiteNetwork, ipAddress)) {
    return {
      allowed: false,
      denied: buildDeniedResult({
        layer: 'website',
        control: 'network',
        code: 'WEBSITE_POLICY_NETWORK',
        message: `Access denied: IP ${ipAddress || 'unknown'} is blocked by website policy.`
      }),
      website: { active: true, id: toPublicId(webPolicy?.id || '') },
      orgPolicy: { active: Boolean(orgPolicy), id: toPublicId(orgPolicy?.id || ''), targeted: {} },
      userPolicy: { active: Boolean(userPolicy), id: toPublicId(userPolicy?.id || '') },
      sessionLimits: null,
      requestControl: null
    };
  }
  if (!checkNetwork(orgNetwork, ipAddress)) {
    return {
      allowed: false,
      denied: buildDeniedResult({
        layer: 'organization',
        control: 'network',
        code: 'ORG_POLICY_NETWORK',
        message: `Access denied: IP ${ipAddress || 'unknown'} is blocked by organization policy.`
      }),
      website: { active: true, id: toPublicId(webPolicy?.id || '') },
      orgPolicy: { active: Boolean(orgPolicy), id: toPublicId(orgPolicy?.id || ''), targeted: {} },
      userPolicy: { active: Boolean(userPolicy), id: toPublicId(userPolicy?.id || '') },
      sessionLimits: null,
      requestControl: null
    };
  }
  if (!checkNetwork(userNetwork, ipAddress)) {
    return {
      allowed: false,
      denied: buildDeniedResult({
        layer: 'user',
        control: 'network',
        code: 'USER_POLICY_NETWORK',
        message: `Access denied: IP ${ipAddress || 'unknown'} is blocked by your user policy.`
      }),
      website: { active: true, id: toPublicId(webPolicy?.id || '') },
      orgPolicy: { active: Boolean(orgPolicy), id: toPublicId(orgPolicy?.id || ''), targeted: {} },
      userPolicy: { active: Boolean(userPolicy), id: toPublicId(userPolicy?.id || '') },
      sessionLimits: null,
      requestControl: null
    };
  }

  const websiteSchedule = (webPolicy?.globalSchedule && typeof webPolicy.globalSchedule === 'object')
    ? webPolicy.globalSchedule
    : null;
  const orgSchedule = orgScheduleApplies && orgPolicy?.globalSchedule && typeof orgPolicy.globalSchedule === 'object'
    ? orgPolicy.globalSchedule
    : null;
  const userSchedule = userPolicy?.globalSchedule && typeof userPolicy.globalSchedule === 'object'
    ? userPolicy.globalSchedule
    : null;

  if (!checkSchedule(websiteSchedule, now)) {
    return {
      allowed: false,
      denied: buildDeniedResult({
        layer: 'website',
        control: 'schedule',
        code: 'WEBSITE_POLICY_SCHEDULE',
        message: 'Access denied: Outside website operating hours.'
      }),
      website: { active: true, id: toPublicId(webPolicy?.id || '') },
      orgPolicy: { active: Boolean(orgPolicy), id: toPublicId(orgPolicy?.id || ''), targeted: {} },
      userPolicy: { active: Boolean(userPolicy), id: toPublicId(userPolicy?.id || '') },
      sessionLimits: null,
      requestControl: null
    };
  }
  if (!checkSchedule(orgSchedule, now)) {
    return {
      allowed: false,
      denied: buildDeniedResult({
        layer: 'organization',
        control: 'schedule',
        code: 'ORG_POLICY_SCHEDULE',
        message: 'Access denied: Outside organization working hours.'
      }),
      website: { active: true, id: toPublicId(webPolicy?.id || '') },
      orgPolicy: { active: Boolean(orgPolicy), id: toPublicId(orgPolicy?.id || ''), targeted: {} },
      userPolicy: { active: Boolean(userPolicy), id: toPublicId(userPolicy?.id || '') },
      sessionLimits: null,
      requestControl: null
    };
  }
  if (!checkSchedule(userSchedule, now)) {
    return {
      allowed: false,
      denied: buildDeniedResult({
        layer: 'user',
        control: 'schedule',
        code: 'USER_POLICY_SCHEDULE',
        message: 'Access denied: Outside your personal allowed schedule.'
      }),
      website: { active: true, id: toPublicId(webPolicy?.id || '') },
      orgPolicy: { active: Boolean(orgPolicy), id: toPublicId(orgPolicy?.id || ''), targeted: {} },
      userPolicy: { active: Boolean(userPolicy), id: toPublicId(userPolicy?.id || '') },
      sessionLimits: null,
      requestControl: null
    };
  }

  const webSession = parsePolicyLimitBlock(webPolicy?.sessionControl || {});
  const orgSession = orgSessionApplies
    ? parsePolicyLimitBlock(orgPolicy?.sessionControl || {})
    : { maxSessions: null, maxDurationMins: null, idleTimeoutMins: null };
  const usrSession = parsePolicyLimitBlock(userPolicy?.sessionControl || {});

  const maxSessions = pickStrictestLimit(
    [webSession.maxSessions, orgSession.maxSessions, usrSession.maxSessions],
    10
  );
  const maxDurationMins = pickStrictestLimit(
    [webSession.maxDurationMins, orgSession.maxDurationMins, usrSession.maxDurationMins],
    720
  );
  const idleTimeoutMins = pickStrictestLimit(
    [webSession.idleTimeoutMins, orgSession.idleTimeoutMins, usrSession.idleTimeoutMins],
    60
  );

  const websiteRequestControl = (webPolicy?.requestControl && typeof webPolicy.requestControl === 'object')
    ? cloneDeep(webPolicy.requestControl)
    : {};
  const orgRequestControl = orgRequestControlApplies && orgPolicy?.requestControl && typeof orgPolicy.requestControl === 'object'
    ? cloneDeep(orgPolicy.requestControl)
    : null;

  return {
    allowed: true,
    denied: null,
    website: {
      active: true,
      id: toPublicId(webPolicy?.id || ''),
      networkApplied: Boolean(websiteNetwork),
      scheduleApplied: Boolean(websiteSchedule)
    },
    orgPolicy: {
      active: Boolean(orgPolicy),
      id: toPublicId(orgPolicy?.id || ''),
      targeted: {
        network: Boolean(orgNetworkApplies),
        globalSchedule: Boolean(orgScheduleApplies),
        sessionControl: Boolean(orgSessionApplies),
        requestControl: Boolean(orgRequestControlApplies)
      }
    },
    userPolicy: {
      active: Boolean(userPolicy),
      id: toPublicId(userPolicy?.id || ''),
      networkApplied: Boolean(userNetwork),
      scheduleApplied: Boolean(userSchedule)
    },
    sessionLimits: {
      maxSessions,
      maxDurationMins,
      idleTimeoutMins,
      sources: {
        website: webSession,
        orgPolicy: orgSession,
        userPolicy: usrSession
      }
    },
    requestControl: {
      website: websiteRequestControl,
      orgPolicy: orgRequestControl,
      orgPolicyApplied: Boolean(orgRequestControl),
      source: orgRequestControl ? 'website+org' : 'website'
    }
  };
}

module.exports = {
  ACCESS_TYPE,
  DECISION_SOURCE,
  resolveEffectiveAccess,
  resolveGlobalPolicyContext,
  resolvePolicySectionScopeOverrides,
  isAdminScope,
  isAdminScopeSync,
  getScopeMode,
  blockTargetsUser,
  sectionTargetsUser,
  normalizeTargetUserIds
};
