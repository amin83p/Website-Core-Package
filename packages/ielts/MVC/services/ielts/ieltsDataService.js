const { requireCoreModule } = require('./ieltsCoreModuleResolver');
const ieltsRepositories = requireCoreModule('MVC/repositories/ielts');
const { normalizeQueryOptions } = requireCoreModule('MVC/utils/queryOptionsAdapter');
const adminChekersService = requireCoreModule('MVC/services/adminChekersService');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const { resolveEntity } = requireCoreModule('MVC/utils/entityResolver');
const {
  assertCreateOrgContextOrThrow: assertCreateOrgContextOrThrowShared
} = requireCoreModule('MVC/utils/orgContextUtils');

const IELTS_ENTITY_REGISTRY = Object.freeze({
  task2Samples: { repository: ieltsRepositories.task2Samples, scopeMode: 'org' },
  microAssessments: { repository: ieltsRepositories.microAssessments, scopeMode: 'org' },
  prompts: { repository: ieltsRepositories.prompts, scopeMode: 'org' },
  apiProviders: { repository: ieltsRepositories.apiProviders, scopeMode: 'user' },
  aiTokenUsages: { repository: ieltsRepositories.aiTokenUsages, scopeMode: 'org' },
  scoringHistory: { repository: ieltsRepositories.scoringHistory, scopeMode: 'org' }
});
const SYSTEM_ORG_ID = 'SYSTEM';
const IELTS_SCORING_HISTORY_SECTION = 'IELTS_SCORING_HISTORY';
const SCORING_SCOPE_MODE = Object.freeze({
  ALL: 'all',
  ORGANIZATION: 'organization',
  OWNER: 'owner'
});
const SCORING_HISTORY_LIST_PROFILE = Object.freeze({
  SUMMARY: 'summary'
});
const SCORING_HISTORY_SUMMARY_PROJECTION = Object.freeze({
  id: 1,
  sessionId: 1,
  orgId: 1,
  userId: 1,
  sampleId: 1,
  sampleName: 1,
  status: 1,
  pipelineMode: 1,
  scoringView: 1,
  overallBand: 1,
  examinerBandScore: 1,
  savedAt: 1,
  step3ModelUsed: 1,
  step4ModelUsed: 1,
  step5ModelUsed: 1,
  step3RunCount: 1,
  step3UnstableCount: 1,
  step4RunCount: 1,
  step4UnstableCount: 1,
  pipelineStrategy: 1,
  runCategoryAssigned: 1,
  runCategoryKey: 1,
  runCategoryLabel: 1,
  runCategoryColor: 1,
  isArchived: 1,
  audit: 1,
  'metadata.sampleName': 1,
  'metadata.sampleRefName': 1,
  'metadata.sampleId': 1,
  'metadata.examinerBandScore': 1,
  'metadata.savedAt': 1,
  'metadata.pipelineMode': 1,
  'metadata.scoringView': 1,
  'metadata.isArchived': 1,
  'metadata.runCategory.key': 1,
  'metadata.runCategory.label': 1,
  'metadata.runCategory.color': 1,
  'metadata.runCategory.assigned': 1,
  'researchConfig.pipelineMode': 1,
  'researchConfig.scoringView': 1,
  'researchConfig.selectedModels.step3': 1,
  'researchConfig.selectedModels.step4': 1,
  'researchConfig.selectedModels.step5': 1,
  'uiState.scoringView': 1,
  'uiState.selectedModels.step3': 1,
  'uiState.selectedModels.step4': 1,
  'uiState.selectedModels.step5': 1,
  'steps.step1freeze.response.json.meta.sampleBandScore': 1,
  'steps.step1freeze.response.json.status': 1,
  'steps.step2analyze.response.json.status': 1,
  'steps.step3extract.response.json.status': 1,
  'steps.step3extract.response.json.meta.modelUsed': 1,
  'steps.step3extract.response.json.meta.selectedModel': 1,
  'steps.step3extract.response.json.meta.providerModel': 1,
  'steps.step4grade.response.json.status': 1,
  'steps.step4grade.response.json.data.overallBand': 1,
  'steps.step4grade.response.json.data.overall.band': 1,
  'steps.step4grade.response.json.data.scores.TR': 1,
  'steps.step4grade.response.json.data.scores.CC': 1,
  'steps.step4grade.response.json.data.scores.LR': 1,
  'steps.step4grade.response.json.data.scores.GRA': 1,
  'steps.step4grade.response.json.data.meta.gateTrace.TR.resultingCriterionScore': 1,
  'steps.step4grade.response.json.data.meta.gateTrace.CC.resultingCriterionScore': 1,
  'steps.step4grade.response.json.data.meta.gateTrace.LR.resultingCriterionScore': 1,
  'steps.step4grade.response.json.data.meta.gateTrace.GRA.resultingCriterionScore': 1,
  'steps.step4grade.response.json.data.meta.modelUsed': 1,
  'steps.step4grade.response.json.data.meta.selectedModel': 1,
  'steps.step4grade.request.payload.modelId': 1,
  'steps.step5feedback.response.json.status': 1,
  'steps.step5feedback.response.json.data.meta.modelUsed': 1,
  'steps.step5feedback.request.payload.modelId': 1
});
const OWNER_SCOPE_NAMES = new Set(['DEPARTMENT', 'DIVISION', 'OWNER', 'USER']);
const SCORING_SCOPE_ID_TO_NAME = Object.freeze({
  SCP_ADMIN: 'ADMIN',
  SCP_ORG: 'ORGANIZATION',
  SCP_DEPT: 'DEPARTMENT',
  SCP_DIV: 'DIVISION',
  SCP_OWNER: 'OWNER',
  SCP_USER: 'USER'
});
const ENTITY_RESOLUTION_CACHE = new Map();

function resolveEntityConfig(entityType) {
  return IELTS_ENTITY_REGISTRY[String(entityType || '')] || null;
}

function getScopedActiveOrgId(requestingUser) {
  return toPublicId(requestingUser?.activeOrgId) || null;
}

function getScopedUserId(requestingUser) {
  return toPublicId(requestingUser?.id) || null;
}

async function assertIeltsCreateContextOrThrow(requestingUser, scopeLabel = 'IELTS records') {
  return await assertCreateOrgContextOrThrowShared(requestingUser, { scopeLabel });
}

async function resolveEntityCached(type, identifier) {
  const raw = String(identifier || '').trim();
  if (!raw) return null;
  const cacheKey = `${String(type || '').trim().toLowerCase()}::${raw}`;
  if (ENTITY_RESOLUTION_CACHE.has(cacheKey)) {
    return ENTITY_RESOLUTION_CACHE.get(cacheKey) || null;
  }
  const resolved = await resolveEntity(type, raw);
  ENTITY_RESOLUTION_CACHE.set(cacheKey, resolved || null);
  return resolved || null;
}

function isSystemScopedSuperAdmin(requestingUser) {
  if (!requestingUser) return false;
  if (!adminChekersService.isSuperAdmin(requestingUser)) return false;
  const activeOrgId = getScopedActiveOrgId(requestingUser);
  return String(activeOrgId || '').toUpperCase() === SYSTEM_ORG_ID;
}

function buildIeltsScope(requestingUser) {
  if (!requestingUser) {
    return {
      denyAll: true,
      canViewAll: false,
      activeOrgId: null
    };
  }

  const activeOrgId = getScopedActiveOrgId(requestingUser);
  if (!activeOrgId) {
    return {
      denyAll: true,
      canViewAll: false,
      activeOrgId: null
    };
  }

  if (isSystemScopedSuperAdmin(requestingUser)) {
    return {
      denyAll: false,
      canViewAll: true,
      activeOrgId
    };
  }

  return {
    denyAll: false,
    canViewAll: false,
    activeOrgId
  };
}

function buildUserOwnedScope(requestingUser) {
  const userId = getScopedUserId(requestingUser);
  const activeOrgId = getScopedActiveOrgId(requestingUser);
  if (!activeOrgId) {
    return {
      denyAll: true,
      userId: null,
      activeOrgId: null
    };
  }
  if (!userId) {
    return {
      denyAll: true,
      userId: null,
      activeOrgId: null
    };
  }
  return {
    denyAll: false,
    userId,
    activeOrgId
  };
}

function normalizeScoringScopeName(scopeName = '') {
  const token = String(scopeName || '').trim().toUpperCase();
  if (!token) return null;
  if (token === 'ADMIN') return 'ADMIN';
  if (token === 'ORGANIZATION') return 'ORGANIZATION';
  if (OWNER_SCOPE_NAMES.has(token)) return token;
  return null;
}

async function resolveScopeNameById(scopeIdOrName = '') {
  const token = String(scopeIdOrName || '').trim();
  if (!token) return null;

  const byName = normalizeScoringScopeName(token);
  if (byName) return byName;

  const mappedName = normalizeScoringScopeName(SCORING_SCOPE_ID_TO_NAME[String(token).toUpperCase()] || '');
  if (mappedName) return mappedName;

  const scopeEntity = await resolveEntityCached('scopes', token);
  return normalizeScoringScopeName(scopeEntity?.name || '');
}

function getUserSectionConfigs(requestingUser) {
  const sections = Array.isArray(requestingUser?.activeProfile?.sections)
    ? requestingUser.activeProfile.sections
    : [];
  return sections.filter((row) => row && typeof row === 'object');
}

function isMatchingId(value, candidates = []) {
  const tokens = candidates
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (!tokens.length) return false;

  const valueRaw = String(value || '').trim();
  if (!valueRaw) return false;
  if (tokens.some((token) => token === valueRaw)) return true;

  const valuePublic = toPublicId(value);
  if (!valuePublic) return false;
  return tokens.some((token) => idsEqual(token, valuePublic));
}

async function resolveSectionOperationContext(sectionIdOrName, operationIdOrName) {
  const sectionEntity = await resolveEntityCached('sections', sectionIdOrName);
  const operationEntity = operationIdOrName
    ? await resolveEntityCached('operations', operationIdOrName)
    : null;

  const sectionCandidates = [
    sectionIdOrName,
    sectionEntity?.id,
    sectionEntity?.name
  ].filter(Boolean);
  const operationCandidates = [
    operationIdOrName,
    operationEntity?.id,
    operationEntity?.name
  ].filter(Boolean);

  return {
    sectionEntity,
    operationEntity,
    sectionCandidates,
    operationCandidates
  };
}

async function hasSectionAdminAccess(requestingUser, sectionIdOrName) {
  const sections = getUserSectionConfigs(requestingUser);
  if (!sections.length) return false;

  const { sectionCandidates } = await resolveSectionOperationContext(sectionIdOrName, null);
  const sectionRow = sections.find((row) => isMatchingId(row?.sectionId, sectionCandidates));
  return sectionRow?.adminAccess === true;
}

async function resolveProfileOperationScopeId(requestingUser, sectionIdOrName, operationIdOrName) {
  const sections = getUserSectionConfigs(requestingUser);
  if (!sections.length) return null;

  const { sectionCandidates, operationCandidates } = await resolveSectionOperationContext(
    sectionIdOrName,
    operationIdOrName
  );
  const sectionRow = sections.find((row) => isMatchingId(row?.sectionId, sectionCandidates));
  if (!sectionRow) return null;

  const operationRows = Array.isArray(sectionRow.operations) ? sectionRow.operations : [];
  if (!operationCandidates.length) return null;
  const operationRow = operationRows.find((row) => isMatchingId(row?.operationId, operationCandidates));
  return toPublicId(operationRow?.scopeId) || String(operationRow?.scopeId || '').trim() || null;
}

function mapScopeNameToVisibilityMode(scopeName = '') {
  const normalized = normalizeScoringScopeName(scopeName);
  if (normalized === 'ADMIN') return SCORING_SCOPE_MODE.ALL;
  if (normalized === 'ORGANIZATION') return SCORING_SCOPE_MODE.ORGANIZATION;
  if (OWNER_SCOPE_NAMES.has(String(normalized || '').toUpperCase())) {
    return SCORING_SCOPE_MODE.OWNER;
  }
  return SCORING_SCOPE_MODE.OWNER;
}

function withScoringOwnerFilter(query = {}, userId = null, activeOrgId = null) {
  return withUserFilter(query, userId, activeOrgId);
}

function resolveScoringHistoryListProjection(accessContext = {}) {
  const explicitProjection = accessContext?.projection;
  if (explicitProjection && typeof explicitProjection === 'object' && !Array.isArray(explicitProjection)) {
    return explicitProjection;
  }

  const profileToken = String(
    accessContext?.listProfile ||
    accessContext?.projectionProfile ||
    ''
  ).trim().toLowerCase();
  if (profileToken === SCORING_HISTORY_LIST_PROFILE.SUMMARY) {
    return { ...SCORING_HISTORY_SUMMARY_PROJECTION };
  }
  return null;
}

function buildScoringHistoryListOptions(query = {}, visibility = {}, accessContext = {}) {
  const normalizedQuery = normalizeQueryOptions(query);
  const projection = resolveScoringHistoryListProjection(accessContext);
  const projectionOptions = projection ? { projection } : {};
  if (visibility.mode === SCORING_SCOPE_MODE.ALL) {
    return {
      query: normalizedQuery,
      scope: { canViewAll: true, denyAll: false, activeOrgId: null },
      ...projectionOptions
    };
  }

  if (visibility.mode === SCORING_SCOPE_MODE.ORGANIZATION) {
    return {
      query: normalizedQuery,
      scope: { canViewAll: false, denyAll: false, activeOrgId: visibility.activeOrgId },
      ...projectionOptions
    };
  }

  return {
    query: normalizeQueryOptions(withScoringOwnerFilter(normalizedQuery, visibility.userId, visibility.activeOrgId)),
    scope: { canViewAll: false, denyAll: false, activeOrgId: visibility.activeOrgId },
    ...projectionOptions
  };
}

function isScoringHistoryRecordVisible(record, visibility = {}) {
  if (!record) return false;
  if (visibility.mode === SCORING_SCOPE_MODE.ALL) return true;

  if (!idsEqual(resolveRecordOrgId(record), visibility.activeOrgId)) {
    return false;
  }

  if (visibility.mode === SCORING_SCOPE_MODE.ORGANIZATION) return true;
  return idsEqual(resolveRecordUserId(record), visibility.userId);
}

async function resolveScoringHistoryVisibility(requestingUser, accessContext = {}) {
  const userScope = buildUserOwnedScope(requestingUser);
  assertReadableUserScope(userScope);

  const sectionId = String(accessContext?.sectionId || IELTS_SCORING_HISTORY_SECTION).trim() || IELTS_SCORING_HISTORY_SECTION;
  const operationId = String(accessContext?.operationId || 'READ_ALL').trim() || 'READ_ALL';
  const explicitScopeId = toPublicId(accessContext?.scopeId) || String(accessContext?.scopeId || '').trim() || null;

  const isGlobalAdmin = adminChekersService.isAdmin(requestingUser) || adminChekersService.isSuperAdmin(requestingUser);
  const isSectionAdmin = await hasSectionAdminAccess(requestingUser, sectionId);

  if (isGlobalAdmin || isSectionAdmin) {
    return {
      mode: SCORING_SCOPE_MODE.ALL,
      activeOrgId: userScope.activeOrgId,
      userId: userScope.userId,
      scopeName: 'ADMIN'
    };
  }

  let resolvedScopeName = await resolveScopeNameById(explicitScopeId);
  if (!resolvedScopeName) {
    const profileScopeId = await resolveProfileOperationScopeId(requestingUser, sectionId, operationId);
    resolvedScopeName = await resolveScopeNameById(profileScopeId);
  }

  const mode = mapScopeNameToVisibilityMode(resolvedScopeName || 'OWNER');
  return {
    mode,
    activeOrgId: userScope.activeOrgId,
    userId: userScope.userId,
    scopeName: resolvedScopeName || 'OWNER'
  };
}

function resolveRecordOrgId(record) {
  return toPublicId(record?.orgId) || SYSTEM_ORG_ID;
}

function isRecordInScope(record, scope) {
  if (!record || !scope) return false;
  if (scope.canViewAll === true) return true;
  if (scope.denyAll === true) return false;
  return idsEqual(resolveRecordOrgId(record), scope.activeOrgId);
}

function assertReadableScope(scope) {
  if (!scope || scope.denyAll === true || !scope.activeOrgId) {
    throw new Error('No active organization context found for IELTS data access.');
  }
}

function assertCreateScope(scope) {
  assertReadableScope(scope);
}

function assertReadableUserScope(scope) {
  if (!scope || scope.denyAll === true || !scope.userId || !scope.activeOrgId) {
    throw new Error('No authenticated user context found for IELTS data access.');
  }
}

function resolveRecordUserId(record) {
  return toPublicId(record?.userId) || null;
}

function isRecordInUserScope(record, scope) {
  if (!record || !scope || scope.denyAll === true || !scope.userId || !scope.activeOrgId) return false;
  if (!idsEqual(resolveRecordUserId(record), scope.userId)) return false;
  return idsEqual(resolveRecordOrgId(record), scope.activeOrgId);
}

function withUserFilter(query = {}, userId = null, activeOrgId = null) {
  const scopedUserId = toPublicId(userId);
  const scopedOrgId = toPublicId(activeOrgId);
  if (!scopedUserId || !scopedOrgId) return { ...(query || {}) };
  return {
    ...(query || {}),
    userId__eq: scopedUserId,
    orgId__eq: scopedOrgId
  };
}

const ieltsDataService = {
  fetchData: async (entityType, query, requestingUser, accessContext = {}) => {
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown IELTS entity type: ${entityType}`);
    if (String(entityType) === 'scoringHistory') {
      const visibility = await resolveScoringHistoryVisibility(requestingUser, {
        sectionId: accessContext?.sectionId || IELTS_SCORING_HISTORY_SECTION,
        operationId: accessContext?.operationId || 'READ_ALL',
        scopeId: accessContext?.scopeId || null
      });
      return await config.repository.list(buildScoringHistoryListOptions(query, visibility, accessContext));
    }
    if (config.scopeMode === 'user') {
      const userScope = buildUserOwnedScope(requestingUser);
      assertReadableUserScope(userScope);
      return await config.repository.list({
        query: normalizeQueryOptions(withUserFilter(query, userScope.userId, userScope.activeOrgId)),
        scope: { canViewAll: true, denyAll: false, activeOrgId: null }
      });
    }
    const scope = buildIeltsScope(requestingUser);
    assertReadableScope(scope);
    return await config.repository.list({
      query: normalizeQueryOptions(query),
      scope
    });
  },

  countData: async (entityType, query, requestingUser, accessContext = {}) => {
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown IELTS entity type for count: ${entityType}`);
    if (String(entityType) === 'scoringHistory') {
      const visibility = await resolveScoringHistoryVisibility(requestingUser, {
        sectionId: accessContext?.sectionId || IELTS_SCORING_HISTORY_SECTION,
        operationId: accessContext?.operationId || 'READ_ALL',
        scopeId: accessContext?.scopeId || null
      });
      return await config.repository.count(buildScoringHistoryListOptions(query, visibility));
    }
    if (config.scopeMode === 'user') {
      const userScope = buildUserOwnedScope(requestingUser);
      assertReadableUserScope(userScope);
      return await config.repository.count({
        query: normalizeQueryOptions(withUserFilter(query, userScope.userId, userScope.activeOrgId)),
        scope: { canViewAll: true, denyAll: false, activeOrgId: null }
      });
    }
    const scope = buildIeltsScope(requestingUser);
    assertReadableScope(scope);
    return await config.repository.count({
      query: normalizeQueryOptions(query),
      scope
    });
  },

  addData: async (entityType, data, requestingUser, accessContext = {}) => {
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown IELTS entity type for add: ${entityType}`);
    await assertIeltsCreateContextOrThrow(requestingUser, 'IELTS records');
    if (String(entityType) === 'scoringHistory') {
      const visibility = await resolveScoringHistoryVisibility(requestingUser, {
        sectionId: accessContext?.sectionId || IELTS_SCORING_HISTORY_SECTION,
        operationId: accessContext?.operationId || 'CREATE',
        scopeId: accessContext?.scopeId || null
      });
      const payload = {
        ...(data && typeof data === 'object' ? data : {}),
        orgId: visibility.activeOrgId,
        userId: visibility.userId
      };
      return await config.repository.create(payload);
    }
    if (config.scopeMode === 'user') {
      const userScope = buildUserOwnedScope(requestingUser);
      assertReadableUserScope(userScope);
      const orgScope = buildIeltsScope(requestingUser);
      assertCreateScope(orgScope);
      const payload = {
        ...(data && typeof data === 'object' ? data : {}),
        orgId: orgScope.activeOrgId,
        userId: userScope.userId
      };
      return await config.repository.create(payload);
    }
    const scope = buildIeltsScope(requestingUser);
    assertCreateScope(scope);
    const payload = {
      ...(data && typeof data === 'object' ? data : {}),
      orgId: scope.activeOrgId
    };
    return await config.repository.create(payload);
  },

  updateData: async (entityType, id, data, requestingUser, accessContext = {}) => {
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown IELTS entity type for update: ${entityType}`);
    if (String(entityType) === 'scoringHistory') {
      const visibility = await resolveScoringHistoryVisibility(requestingUser, {
        sectionId: accessContext?.sectionId || IELTS_SCORING_HISTORY_SECTION,
        operationId: accessContext?.operationId || 'UPDATE',
        scopeId: accessContext?.scopeId || null
      });
      const existing = await config.repository.getById(id);
      if (!existing) throw new Error('Record not found.');
      if (!isScoringHistoryRecordVisible(existing, visibility)) {
        throw new Error('Unauthorized access for IELTS scoring history record.');
      }
      const payload = {
        ...(data && typeof data === 'object' ? data : {}),
        userId: resolveRecordUserId(existing) || visibility.userId,
        orgId: resolveRecordOrgId(existing)
      };
      return await config.repository.update(id, payload);
    }
    if (config.scopeMode === 'user') {
      const userScope = buildUserOwnedScope(requestingUser);
      assertReadableUserScope(userScope);
      const existing = await config.repository.getById(id);
      if (!existing) throw new Error('Record not found.');
      if (!isRecordInUserScope(existing, userScope)) {
        throw new Error('Unauthorized user access for IELTS record.');
      }
      const payload = {
        ...(data && typeof data === 'object' ? data : {}),
        userId: userScope.userId,
        orgId: resolveRecordOrgId(existing)
      };
      return await config.repository.update(id, payload);
    }
    const scope = buildIeltsScope(requestingUser);
    assertReadableScope(scope);
    const existing = await config.repository.getById(id);
    if (!existing) throw new Error('Record not found.');
    if (!isRecordInScope(existing, scope)) {
      throw new Error('Unauthorized organization access for IELTS record.');
    }
    const payload = {
      ...(data && typeof data === 'object' ? data : {}),
      orgId: resolveRecordOrgId(existing)
    };
    return await config.repository.update(id, payload);
  },

  getDataById: async (entityType, id, requestingUser, accessContext = {}) => {
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown IELTS entity type for ID: ${entityType}`);
    if (String(entityType) === 'scoringHistory') {
      const visibility = await resolveScoringHistoryVisibility(requestingUser, {
        sectionId: accessContext?.sectionId || IELTS_SCORING_HISTORY_SECTION,
        operationId: accessContext?.operationId || 'READ',
        scopeId: accessContext?.scopeId || null
      });
      const record = await config.repository.getById(id);
      if (!record) return null;
      if (!isScoringHistoryRecordVisible(record, visibility)) return null;
      return record;
    }
    if (config.scopeMode === 'user') {
      const userScope = buildUserOwnedScope(requestingUser);
      assertReadableUserScope(userScope);
      const record = await config.repository.getById(id);
      if (!record) return null;
      if (!isRecordInUserScope(record, userScope)) return null;
      return record;
    }
    const scope = buildIeltsScope(requestingUser);
    assertReadableScope(scope);
    const record = await config.repository.getById(id);
    if (!record) return null;
    if (!isRecordInScope(record, scope)) return null;
    return record;
  },

  deleteData: async (entityType, id, requestingUser, accessContext = {}) => {
    const config = resolveEntityConfig(entityType);
    if (!config) throw new Error(`Unknown IELTS entity type for delete: ${entityType}`);
    if (String(entityType) === 'scoringHistory') {
      const visibility = await resolveScoringHistoryVisibility(requestingUser, {
        sectionId: accessContext?.sectionId || IELTS_SCORING_HISTORY_SECTION,
        operationId: accessContext?.operationId || 'DELETE',
        scopeId: accessContext?.scopeId || null
      });
      const existing = await config.repository.getById(id);
      if (!existing) throw new Error('Record not found.');
      if (!isScoringHistoryRecordVisible(existing, visibility)) {
        throw new Error('Unauthorized access for IELTS scoring history record.');
      }
      return await config.repository.remove(id, { orgId: resolveRecordOrgId(existing) });
    }
    if (config.scopeMode === 'user') {
      const userScope = buildUserOwnedScope(requestingUser);
      assertReadableUserScope(userScope);
      const existing = await config.repository.getById(id);
      if (!existing) throw new Error('Record not found.');
      if (!isRecordInUserScope(existing, userScope)) {
        throw new Error('Unauthorized user access for IELTS record.');
      }
      return await config.repository.remove(id, { userId: userScope.userId });
    }
    const scope = buildIeltsScope(requestingUser);
    assertReadableScope(scope);
    const existing = await config.repository.getById(id);
    if (!existing) throw new Error('Record not found.');
    if (!isRecordInScope(existing, scope)) {
      throw new Error('Unauthorized organization access for IELTS record.');
    }
    return await config.repository.remove(id, { orgId: resolveRecordOrgId(existing) });
  },

  // --- SPECIALIZED LOGIC ---
  getMicroAssessmentFields: async () => {
    return await ieltsRepositories.getMicroAssessmentFields();
  }
};

module.exports = ieltsDataService;
