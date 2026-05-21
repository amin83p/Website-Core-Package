const pteQuestionVersionRepository = require('../../repositories/pteQuestionVersionRepository');
const pteTestVersionRepository = require('../../repositories/pteTestVersionRepository');
const pteAttemptItemRepository = require('../../repositories/pteAttemptItemRepository');
const adminChekersService = require('../adminChekersService');
const activityQuotaLedgerService = require('../activityQuotaLedgerService');
const { normalizeQueryOptions } = require('../../utils/queryOptionsAdapter');
const { resolveEntity } = require('../../utils/entityResolver');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');
const { assertCreateOrgContextOrThrow, getActiveOrgIdOrThrow } = require('../../utils/orgContextUtils');
const settingService = require('../settingService');
const questionTypeRegistry = require('./questionTypeRegistry');
const pteQuestionScoringProfileService = require('./pteQuestionScoringProfileService');

const ORGANIZATION_SCOPE_NAMES = new Set(['ADMIN', 'GLOBAL', 'ORGANIZATION', 'ORG']);
const DIFFICULTY_OPTIONS = Object.freeze(['easy', 'medium', 'hard']);
const STATUS_OPTIONS = Object.freeze(['draft', 'published', 'retired', 'archived']);
const TEST_TYPE_OPTIONS = Object.freeze(
  Array.isArray(questionTypeRegistry.VALID_TEST_TYPES)
    ? questionTypeRegistry.VALID_TEST_TYPES.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
    : ['core', 'academic']
);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepClone(value, fallback = {}) {
  try {
    if (value === undefined) return fallback;
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallback;
  }
}

function deepEqual(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch (_) {
    return false;
  }
}

function cleanString(value, { max = 4000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const text = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeList(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function normalizeTagArray(value) {
  const rows = normalizeList(value);
  const out = [];
  const seen = new Set();
  rows.forEach((entry) => {
    const list = Array.isArray(entry) ? entry : String(entry || '').split(',');
    list.forEach((item) => {
      const clean = cleanString(item, { max: 120, allowEmpty: true }) || '';
      if (!clean) return;
      const key = clean.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(clean);
    });
  });
  return out;
}

function normalizeDifficulty(value, fallback = 'medium') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  if (!token) return fallback;
  return DIFFICULTY_OPTIONS.includes(token) ? token : fallback;
}

function normalizeStatus(value, fallback = 'draft') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  if (!token) return fallback;
  return STATUS_OPTIONS.includes(token) ? token : fallback;
}

function normalizeTestType(value, fallback = '') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  if (token && TEST_TYPE_OPTIONS.includes(token)) return token;
  const fallbackToken = cleanString(fallback, { max: 40, allowEmpty: true }).toLowerCase();
  return TEST_TYPE_OPTIONS.includes(fallbackToken) ? fallbackToken : '';
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const token = String(value || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function parseBooleanFilter(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value;
  const token = String(value || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
  return null;
}

function resolveActiveOrgId(requestingUser) {
  return toPublicId(requestingUser?.activeOrgId || requestingUser?.primaryOrgId) || '';
}

function resolveRequesterUserId(requestingUser) {
  return toPublicId(requestingUser?.id) || '';
}

function normalizeScopeName(scopeName = '') {
  const token = String(scopeName || '').trim().toUpperCase();
  if (!token) return '';
  if (token === 'GLOBAL') return 'GLOBAL';
  if (token === 'ORGANIZATION') return 'ORGANIZATION';
  if (token === 'ORG') return 'ORG';
  if (token === 'ADMIN') return 'ADMIN';
  if (token === 'OWNER') return 'OWNER';
  if (token === 'USER') return 'USER';
  if (token === 'DEPARTMENT') return 'DEPARTMENT';
  if (token === 'DIVISION') return 'DIVISION';
  return '';
}

async function resolveScopeNameById(scopeIdOrName = '') {
  const token = String(scopeIdOrName || '').trim();
  if (!token) return '';

  const byName = normalizeScopeName(token);
  if (byName) return byName;

  const scopeEntity = await resolveEntity('scopes', token);
  return normalizeScopeName(scopeEntity?.name || '');
}

async function resolveVisibility(requestingUser, accessContext = {}) {
  const activeOrgId = resolveActiveOrgId(requestingUser);
  const requesterUserId = resolveRequesterUserId(requestingUser);

  if (adminChekersService.isSuperAdmin(requestingUser)) {
    return {
      mode: 'all',
      activeOrgId,
      requesterUserId,
      scopeName: 'ADMIN'
    };
  }

  if (!activeOrgId) {
    return {
      mode: 'none',
      activeOrgId: '',
      requesterUserId,
      scopeName: ''
    };
  }

  if (adminChekersService.isOrgAdmin(requestingUser)) {
    return {
      mode: 'org',
      activeOrgId,
      requesterUserId,
      scopeName: 'ADMIN'
    };
  }

  const scopeName = await resolveScopeNameById(
    accessContext.scopeId
    || accessContext.accessScope
    || accessContext.scope
    || ''
  );

  if (ORGANIZATION_SCOPE_NAMES.has(scopeName)) {
    return {
      mode: 'org',
      activeOrgId,
      requesterUserId,
      scopeName
    };
  }

  return {
    mode: 'creator',
    activeOrgId,
    requesterUserId,
    scopeName: scopeName || 'OWNER'
  };
}

function assertReadableVisibility(visibility) {
  if (!visibility || visibility.mode === 'none') {
    throw new Error('No active organization context found.');
  }
  if (visibility.mode !== 'all' && !visibility.activeOrgId) {
    throw new Error('No active organization context found.');
  }
  if (visibility.mode === 'creator' && !visibility.requesterUserId) {
    throw new Error('Authenticated user context is required for creator-scoped access.');
  }
}

function buildRepositoryScope(visibility = {}) {
  if (!visibility || visibility.mode === 'all') return { canViewAll: true };
  if (visibility.mode === 'creator') {
    return {
      canViewAll: false,
      orgId: visibility.activeOrgId,
      userId: visibility.requesterUserId
    };
  }
  return {
    canViewAll: false,
    orgId: visibility.activeOrgId
  };
}

function isVisibleQuestionRow(row, visibility) {
  if (!row) return false;
  if (visibility.mode === 'all') return true;
  if (!idsEqual(row?.orgId, visibility.activeOrgId)) return false;
  if (visibility.mode === 'org') return true;
  const creatorUserId = toPublicId(row?.creator?.userId || row?.audit?.createUser || '');
  return creatorUserId ? idsEqual(creatorUserId, visibility.requesterUserId) : false;
}

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const out = { ...query };
  delete out.page;
  delete out.limit;
  return out;
}

const TRANSCRIPT_SEARCH_KEY_PATTERN = /transcript/i;
const MEDIA_SEARCH_KEY_PATTERN = /(artifact|asset|audio|file|filename|image|media|path|url)/i;

function normalizeSearchText(value, max = 1000) {
  return cleanString(value, { max, allowEmpty: true }).toLowerCase();
}

function collectPayloadSearchText(value, key = '', out = [], inheritedRelevant = false) {
  const relevant = inheritedRelevant
    || TRANSCRIPT_SEARCH_KEY_PATTERN.test(String(key || ''))
    || MEDIA_SEARCH_KEY_PATTERN.test(String(key || ''));

  if (value === undefined || value === null) return out;

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (relevant) {
      const text = cleanString(value, { max: 10000, allowEmpty: true });
      if (text) out.push(text);
    }
    return out;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectPayloadSearchText(entry, key, out, relevant));
    return out;
  }

  if (isPlainObject(value)) {
    Object.entries(value).forEach(([childKey, childValue]) => {
      collectPayloadSearchText(childValue, childKey, out, relevant);
    });
  }

  return out;
}

function collectMediaAssetSearchText(mediaAssets = []) {
  const rows = Array.isArray(mediaAssets) ? mediaAssets : [];
  const out = [];
  rows.forEach((row) => {
    if (!isPlainObject(row)) return;
    [
      row.id,
      row.name,
      row.originalName,
      row.filename,
      row.path,
      row.url,
      row.mimeType,
      row.type,
      row.kind
    ].forEach((value) => {
      const text = cleanString(value, { max: 4000, allowEmpty: true });
      if (text) out.push(text);
    });
  });
  return out;
}

function questionMatchesTranscriptArtifactSearch(row = {}, rawSearch = '') {
  const needle = normalizeSearchText(rawSearch, 500);
  if (!needle) return true;

  const haystack = [
    ...collectPayloadSearchText(row?.payload || {}),
    ...collectMediaAssetSearchText(row?.mediaAssets || [])
  ].join('\n').toLowerCase();

  return haystack.includes(needle);
}

function resolveDefaultPageSize() {
  const configured = Number.parseInt(String(settingService.getValue('app', 'defaultPageSize') || ''), 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 20;
}

function normalizePagination(input = {}, fallback = {}) {
  const fromInput = isPlainObject(input) ? input : {};
  const fromFallback = isPlainObject(fallback) ? fallback : {};
  const defaultLimit = resolveDefaultPageSize();
  const page = Math.max(
    1,
    Number.parseInt(
      fromInput.page
      ?? fromFallback.page
      ?? 1,
      10
    ) || 1
  );
  const parsedLimit = Number.parseInt(
    fromInput.limit
    ?? fromFallback.limit
    ?? 0,
    10
  );
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : defaultLimit;
  return { page, limit };
}

function buildPaginationMeta(totalRows = 0, page = 1, limit = 0) {
  const safeTotal = Math.max(0, Number(totalRows) || 0);
  const safeLimit = Number(limit) > 0 ? Number(limit) : resolveDefaultPageSize();
  const totalPages = Math.max(1, Math.ceil(safeTotal / safeLimit));
  const currentPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const startIndex = (currentPage - 1) * safeLimit;
  const endIndex = Math.min(startIndex + safeLimit, safeTotal);
  return {
    currentPage,
    totalPages,
    totalItems: safeTotal,
    limit: safeLimit,
    startItem: safeTotal > 0 ? startIndex + 1 : 0,
    endItem: endIndex
  };
}

const QUESTION_LIST_PROJECTION = Object.freeze({
  id: 1,
  orgId: 1,
  familyId: 1,
  parentVersionId: 1,
  revisionNumber: 1,
  isLatestRevision: 1,
  status: 1,
  code: 1,
  title: 1,
  testType: 1,
  skill: 1,
  questionType: 1,
  practiceEnabled: 1,
  difficulty: 1,
  tags: 1,
  validation: 1,
  usageMeta: 1,
  publishingMeta: 1,
  creator: 1,
  audit: 1
});

function sanitizeMediaRows(rawRows = undefined, fallbackRows = []) {
  const hasExplicitRows = Array.isArray(rawRows);
  const source = hasExplicitRows
    ? rawRows
    : (Array.isArray(fallbackRows) ? fallbackRows : []);
  const out = [];
  const seen = new Set();
  source.forEach((raw, index) => {
    const row = isPlainObject(raw) ? raw : {};
    const id = cleanString(row.id, { max: 140, allowEmpty: true }) || `QMEDIA-${Date.now()}-${index}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      name: cleanString(row.name, { max: 260, allowEmpty: true }) || '',
      originalName: cleanString(row.originalName, { max: 260, allowEmpty: true }) || '',
      filename: cleanString(row.filename, { max: 260, allowEmpty: true }) || '',
      path: cleanString(row.path, { max: 1200, allowEmpty: true }) || '',
      url: cleanString(row.url, { max: 1200, allowEmpty: true }) || '',
      mimeType: cleanString(row.mimeType, { max: 120, allowEmpty: true }) || '',
      size: Number(row.size || 0) || 0,
      uploadDate: cleanString(row.uploadDate, { max: 80, allowEmpty: true }) || new Date().toISOString(),
      comment: cleanString(row.comment, { max: 1200, allowEmpty: true }) || ''
    });
  });
  return out;
}

function sanitizeQuestionInput(payload = {}, { existing = null, scoringInput = undefined } = {}) {
  const source = isPlainObject(payload) ? payload : {};
  const current = isPlainObject(existing) ? existing : {};
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  const title = cleanString(source.title, { max: 260, allowEmpty: true })
    || cleanString(current.title, { max: 260, allowEmpty: true });
  if (!title) throw new Error('Question title is required.');

  const skill = cleanString(source.skill, { max: 40, allowEmpty: true }).toLowerCase()
    || cleanString(current.skill, { max: 40, allowEmpty: true }).toLowerCase();
  if (!skill || !questionTypeRegistry.VALID_SKILLS.includes(skill)) {
    throw new Error('A valid skill is required.');
  }

  const questionType = cleanString(source.questionType, { max: 120, allowEmpty: true }).toLowerCase()
    || cleanString(current.questionType, { max: 120, allowEmpty: true }).toLowerCase();
  const typeDef = questionTypeRegistry.getDefinition(questionType);
  if (!typeDef) throw new Error('A valid question type is required.');
  const existingQuestionType = cleanString(current.questionType, { max: 120, allowEmpty: true }).toLowerCase();
  if (typeDef.hiddenFromAuthoring === true && existingQuestionType !== questionType) {
    throw new Error(`Question type '${questionType}' is a legacy type and cannot be authored for new questions.`);
  }
  if (String(typeDef.skill || '').toLowerCase() !== skill) {
    throw new Error(`Question type '${questionType}' does not belong to skill '${skill}'.`);
  }
  const defaultTestType = questionTypeRegistry.inferDefaultTestTypeForType(questionType);
  const testType = normalizeTestType(
    source.testType,
    normalizeTestType(current.testType, defaultTestType)
  );
  if (!testType) throw new Error('A valid test type is required.');
  if (!questionTypeRegistry.isTypeAllowedForTestType(questionType, testType)) {
    throw new Error(`Question type '${questionType}' is not available for test type '${testType}'.`);
  }

  const contracts = questionTypeRegistry.normalizeQuestionContracts(
    questionType,
    source.payload !== undefined ? source.payload : current.payload,
    scoringInput !== undefined
      ? scoringInput
      : (source.scoringConfig !== undefined ? source.scoringConfig : current.scoringConfig)
  );

  const code = hasOwn(source, 'code')
    ? cleanString(source.code, { max: 120, allowEmpty: true })
    : (cleanString(current.code, { max: 120, allowEmpty: true }) || '');

  return {
    code,
    title,
    testType,
    skill,
    questionType,
    difficulty: normalizeDifficulty(source.difficulty, normalizeDifficulty(current.difficulty, 'medium')),
    tags: normalizeTagArray(source.tags !== undefined ? source.tags : current.tags || []),
    instructions: cleanString(source.instructions, { max: 10000, allowEmpty: true })
      || cleanString(current.instructions, { max: 10000, allowEmpty: true })
      || '',
    internalNotes: cleanString(source.internalNotes, { max: 10000, allowEmpty: true })
      || cleanString(current.internalNotes, { max: 10000, allowEmpty: true })
      || '',
    practiceEnabled: hasOwn(source, 'practiceEnabled')
      ? normalizeBoolean(source.practiceEnabled, true)
      : normalizeBoolean(current.practiceEnabled, true),
    payload: contracts.payload,
    scoringConfig: contracts.scoringConfig,
    responseContract: contracts.responseContract,
    validationErrors: contracts.errors,
    mediaAssets: sanitizeMediaRows(source.mediaAssets, current.mediaAssets || [])
  };
}

function assertPublishedScoringOnlyUpdate(existingNormalized = {}, incomingNormalized = {}) {
  const blockedKeys = [
    'code',
    'title',
    'testType',
    'skill',
    'questionType',
    'difficulty',
    'tags',
    'instructions',
    'internalNotes',
    'practiceEnabled',
    'payload',
    'responseContract',
    'mediaAssets'
  ];
  const changed = blockedKeys.filter((key) => !deepEqual(existingNormalized?.[key], incomingNormalized?.[key]));
  if (changed.length) {
    throw new Error(`Published questions only allow scoring updates. Locked fields changed: ${changed.join(', ')}.`);
  }
}

function buildValidationSnapshot(errors = [], requestingUser = null) {
  const nowIso = new Date().toISOString();
  return {
    isValid: Array.isArray(errors) ? errors.length === 0 : true,
    errors: Array.isArray(errors) ? errors : [],
    validatedAt: nowIso,
    validatedBy: toPublicId(requestingUser?.id || '') || 'System'
  };
}

function buildAuditFromCreator(creator, existingAudit = {}, options = {}) {
  const nowIso = new Date().toISOString();
  const sourceAudit = isPlainObject(existingAudit) ? existingAudit : {};
  const isUpdate = options?.isUpdate === true;
  const creatorUser = String(creator?.type || '').toLowerCase() === 'system'
    ? 'System'
    : (toPublicId(creator?.userId) || 'System');

  return {
    createUser: isUpdate
      ? (cleanString(sourceAudit.createUser, { max: 120, allowEmpty: true }) || creatorUser)
      : creatorUser,
    createDateTime: isUpdate
      ? (cleanString(sourceAudit.createDateTime, { max: 80, allowEmpty: true }) || nowIso)
      : nowIso,
    lastUpdateUser: creatorUser,
    lastUpdateDateTime: nowIso
  };
}

function buildDefaultUsageMeta(existing = {}) {
  const source = isPlainObject(existing) ? existing : {};
  return {
    testsCount: Math.max(0, Number.parseInt(String(source.testsCount || '0'), 10) || 0),
    assignmentsCount: Math.max(0, Number.parseInt(String(source.assignmentsCount || '0'), 10) || 0),
    attemptsCount: Math.max(0, Number.parseInt(String(source.attemptsCount || '0'), 10) || 0)
  };
}

function usageMetaEquals(left = {}, right = {}) {
  const a = buildDefaultUsageMeta(left);
  const b = buildDefaultUsageMeta(right);
  return a.testsCount === b.testsCount
    && a.assignmentsCount === b.assignmentsCount
    && a.attemptsCount === b.attemptsCount;
}

function collectQuestionIdsFromTestAllocations(allocations = {}) {
  const source = isPlainObject(allocations) ? allocations : {};
  const ids = new Set();
  Object.keys(source).forEach((skillKey) => {
    const rows = Array.isArray(source[skillKey]) ? source[skillKey] : [];
    rows.forEach((row) => {
      const token = cleanString(row?.questionVersionId, { max: 120, allowEmpty: true }) || '';
      if (token) ids.add(token);
    });
  });
  return ids;
}

async function resolveLiveUsageMetaForQuestion(questionRow = {}, options = {}) {
  const questionId = cleanString(questionRow?.id, { max: 120, allowEmpty: true }) || '';
  const orgId = cleanString(questionRow?.orgId, { max: 120, allowEmpty: true }) || '';
  if (!questionId) {
    return buildDefaultUsageMeta(questionRow?.usageMeta || {});
  }

  const backendMode = options?.backendMode;
  const [testRowsRaw, attemptRowsRaw] = await Promise.all([
    pteTestVersionRepository.list({
      query: orgId ? { orgId__eq: orgId } : {},
      scope: { canViewAll: true },
      sort: { id: -1 },
      backendMode
    }),
    pteAttemptItemRepository.list({
      query: {
        questionVersionId__eq: questionId,
        ...(orgId ? { orgId__eq: orgId } : {})
      },
      scope: { canViewAll: true },
      sort: { id: -1 },
      backendMode
    })
  ]);

  const testRows = Array.isArray(testRowsRaw) ? testRowsRaw : [];
  const attemptRows = Array.isArray(attemptRowsRaw) ? attemptRowsRaw : [];

  let testsCount = 0;
  let assignmentsCount = 0;
  testRows.forEach((testRow) => {
    const questionIds = collectQuestionIdsFromTestAllocations(testRow?.allocations || {});
    if (!questionIds.has(questionId)) return;
    testsCount += 1;
    const testUsage = buildDefaultUsageMeta(testRow?.usageMeta || {});
    assignmentsCount += testUsage.assignmentsCount;
  });

  const attemptSessionIds = new Set();
  attemptRows.forEach((attemptRow) => {
    const sessionId = cleanString(attemptRow?.attemptSessionId, { max: 120, allowEmpty: true }) || '';
    if (sessionId) attemptSessionIds.add(sessionId);
  });

  return buildDefaultUsageMeta({
    testsCount,
    assignmentsCount,
    attemptsCount: attemptSessionIds.size
  });
}

async function resolveAndSyncQuestionUsageMeta(questionRow = {}, options = {}) {
  const cached = buildDefaultUsageMeta(questionRow?.usageMeta || {});
  let live = cached;
  try {
    live = await resolveLiveUsageMetaForQuestion(questionRow, options);
  } catch (_) {
    return cached;
  }

  if (!usageMetaEquals(cached, live) && cleanString(questionRow?.id, { max: 120, allowEmpty: true })) {
    await pteQuestionVersionRepository.update(questionRow.id, {
      usageMeta: live
    }, {
      backendMode: options?.backendMode
    });
  }
  return live;
}

function buildPublishingMetaForStatus(existing = {}, nextStatus = 'draft', requestingUser = null, options = {}) {
  const source = isPlainObject(existing) ? existing : {};
  const actor = toPublicId(requestingUser?.id || '') || 'System';
  const nowIso = new Date().toISOString();

  const out = {
    publishedBy: cleanString(source.publishedBy, { max: 120, allowEmpty: true }) || '',
    publishedAt: cleanString(source.publishedAt, { max: 80, allowEmpty: true }) || '',
    retiredBy: cleanString(source.retiredBy, { max: 120, allowEmpty: true }) || '',
    retiredAt: cleanString(source.retiredAt, { max: 80, allowEmpty: true }) || '',
    archivedBy: cleanString(source.archivedBy, { max: 120, allowEmpty: true }) || '',
    archivedAt: cleanString(source.archivedAt, { max: 80, allowEmpty: true }) || '',
    unpublishedBy: cleanString(source.unpublishedBy, { max: 120, allowEmpty: true }) || '',
    unpublishedAt: cleanString(source.unpublishedAt, { max: 80, allowEmpty: true }) || ''
  };

  if (nextStatus === 'published') {
    out.publishedBy = actor;
    out.publishedAt = nowIso;
  } else if (nextStatus === 'retired') {
    out.retiredBy = actor;
    out.retiredAt = nowIso;
  } else if (nextStatus === 'archived') {
    out.archivedBy = actor;
    out.archivedAt = nowIso;
  } else if (nextStatus === 'draft' && options?.markUnpublished === true) {
    out.unpublishedBy = actor;
    out.unpublishedAt = nowIso;
  }

  return out;
}

function resolveRowTestType(row = {}) {
  const questionType = cleanString(row?.questionType, { max: 120, allowEmpty: true }).toLowerCase();
  const inferred = questionTypeRegistry.inferDefaultTestTypeForType(questionType);
  return normalizeTestType(row?.testType, inferred) || inferred;
}

async function syncFamilyLatestRevision(familyId, latestId, options = {}) {
  const token = toPublicId(familyId);
  if (!token) return;
  const rows = await pteQuestionVersionRepository.listByFamily(token, {
    scope: { canViewAll: true },
    backendMode: options?.backendMode
  });
  for (const row of rows) {
    const shouldBeLatest = idsEqual(row?.id, latestId);
    // eslint-disable-next-line no-await-in-loop
    await pteQuestionVersionRepository.update(row.id, {
      isLatestRevision: shouldBeLatest
    }, {
      backendMode: options?.backendMode
    });
  }
}

async function promoteLatestRevisionAfterDelete(familyId, options = {}) {
  const token = toPublicId(familyId);
  if (!token) return;
  const rows = await pteQuestionVersionRepository.listByFamily(token, {
    scope: { canViewAll: true },
    backendMode: options?.backendMode
  });
  if (!Array.isArray(rows) || !rows.length) return;
  const winner = rows
    .slice()
    .sort((a, b) => {
      const revA = Number(a?.revisionNumber || 0);
      const revB = Number(b?.revisionNumber || 0);
      if (revA !== revB) return revB - revA;
      const dtA = String(a?.audit?.createDateTime || '');
      const dtB = String(b?.audit?.createDateTime || '');
      return dtA < dtB ? 1 : -1;
    })[0];
  await syncFamilyLatestRevision(token, winner?.id || '', options);
}

function toSummaryRow(row = {}) {
  return {
    ...row,
    practiceEnabled: row?.practiceEnabled !== false,
    testType: resolveRowTestType(row),
    summary: {
      validationErrors: Array.isArray(row?.validation?.errors) ? row.validation.errors.length : 0,
      testsCount: Number(row?.usageMeta?.testsCount || 0),
      assignmentsCount: Number(row?.usageMeta?.assignmentsCount || 0),
      attemptsCount: Number(row?.usageMeta?.attemptsCount || 0)
    }
  };
}

const pteQuestionBankDataService = {
  async assertCreateContext(requestingUser) {
    return assertCreateOrgContextOrThrow(requestingUser, { scopeLabel: 'PTE questions bank' });
  },

  getFormOptions() {
    return {
      statuses: STATUS_OPTIONS.map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) })),
      difficulties: DIFFICULTY_OPTIONS.map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) })),
      testTypes: questionTypeRegistry.listTestTypes(),
      skills: questionTypeRegistry.VALID_SKILLS.map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) })),
      practiceStates: [
        { value: 'true', label: 'Practice Enabled' },
        { value: 'false', label: 'Practice Disabled' }
      ],
      questionTypes: questionTypeRegistry.getEditorRegistry()
    };
  },

  async listQuestions(query = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const normalizedQuery = normalizeQueryOptions(query || {});
    const listQuery = stripPaginationFromQuery(normalizedQuery);
    const requestedPracticeEnabled = parseBooleanFilter(
      listQuery.practiceEnabled !== undefined
        ? listQuery.practiceEnabled
        : listQuery['practiceEnabled__eq']
    );
    delete listQuery.practiceEnabled;
    delete listQuery['practiceEnabled__eq'];
    const requestedTestType = normalizeTestType(
      listQuery.testType !== undefined ? listQuery.testType : listQuery['testType__eq'],
      ''
    );
    delete listQuery.testType;
    delete listQuery['testType__eq'];
    const requestedTranscriptArtifactSearch = cleanString(
      listQuery.transcriptArtifactSearch !== undefined
        ? listQuery.transcriptArtifactSearch
        : listQuery['transcriptArtifactSearch__contains'],
      { max: 500, allowEmpty: true }
    );
    delete listQuery.transcriptArtifactSearch;
    delete listQuery['transcriptArtifactSearch__contains'];
    const scope = buildRepositoryScope(visibility);
    const sort = options?.sort || { 'audit.createDateTime': -1, id: -1 };
    const baseProjection = (options?.projection && isPlainObject(options.projection))
      ? options.projection
      : QUESTION_LIST_PROJECTION;
    const projection = requestedTranscriptArtifactSearch
      ? { ...baseProjection, payload: 1, mediaAssets: 1 }
      : baseProjection;
    const paginationInput = normalizePagination(
      options?.pagination || {},
      normalizedQuery
    );
    const paginated = options?.paginated === true || paginationInput.limit > 0;
    const needsPostFilter = Boolean(requestedTestType)
      || requestedPracticeEnabled !== null
      || Boolean(requestedTranscriptArtifactSearch);

    if (paginated && !needsPostFilter) {
      const [totalRows, rows] = await Promise.all([
        pteQuestionVersionRepository.count({
          query: listQuery,
          scope,
          backendMode: options?.backendMode
        }),
        pteQuestionVersionRepository.list({
          query: listQuery,
          scope,
          sort,
          pagination: {
            page: paginationInput.page,
            limit: paginationInput.limit
          },
          projection,
          backendMode: options?.backendMode
        })
      ]);

      const mappedRows = (Array.isArray(rows) ? rows : [])
        .filter((row) => isVisibleQuestionRow(row, visibility))
        .map((row) => toSummaryRow(row));

      return {
        rows: mappedRows,
        totalRows: Math.max(totalRows, mappedRows.length),
        pagination: buildPaginationMeta(totalRows, paginationInput.page, paginationInput.limit)
      };
    }

    const rows = await pteQuestionVersionRepository.list({
      query: listQuery,
      scope,
      sort,
      projection,
      backendMode: options?.backendMode
    });
    const mappedRows = (Array.isArray(rows) ? rows : [])
      .filter((row) => isVisibleQuestionRow(row, visibility))
      .map((row) => toSummaryRow(row))
      .filter((row) => {
        if (!requestedTestType) return true;
        return normalizeTestType(row?.testType, '') === requestedTestType;
      })
      .filter((row) => {
        if (requestedPracticeEnabled === null) return true;
        return (row?.practiceEnabled !== false) === requestedPracticeEnabled;
      })
      .filter((row) => {
        if (!requestedTranscriptArtifactSearch) return true;
        return questionMatchesTranscriptArtifactSearch(row, requestedTranscriptArtifactSearch);
      });

    if (!paginated) return mappedRows;

    const totalRows = mappedRows.length;
    const startIndex = paginationInput.limit > 0
      ? Math.max(0, (paginationInput.page - 1) * paginationInput.limit)
      : 0;
    const endIndex = paginationInput.limit > 0
      ? startIndex + paginationInput.limit
      : mappedRows.length;
    return {
      rows: mappedRows.slice(startIndex, endIndex),
      totalRows,
      pagination: buildPaginationMeta(totalRows, paginationInput.page, paginationInput.limit)
    };
  },

  async getQuestionById(id, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const row = await pteQuestionVersionRepository.getById(id, {
      backendMode: options?.backendMode
    });
    if (!row || !isVisibleQuestionRow(row, visibility)) return null;
    const summary = toSummaryRow(row);
    if (options?.resolveScoring === true) {
      const scoringState = await pteQuestionScoringProfileService.resolveQuestionScoring(row, {
        requestingUser,
        backendMode: options?.backendMode,
        cacheMap: options?.scoringProfileCache || null
      });
      summary.scoringConfig = deepClone(scoringState.effectiveScoringConfig, {});
      summary.scoringConfigOverrides = deepClone(scoringState.questionScoringOverrides, {});
      summary.scoringConfigGlobal = deepClone(scoringState.profileScoringConfig, {});
      summary.scoringProfileVersion = Number(scoringState.profileVersion || 1);
      summary.useQuestionScoringOverride = scoringState.useQuestionScoringOverride === true;
      summary.scoringConfigMode = summary.useQuestionScoringOverride ? 'override' : 'global';
    }
    return summary;
  },

  async createQuestion(payload = {}, requestingUser, accessContext = {}, options = {}) {
    const activeOrgId = await this.assertCreateContext(requestingUser);
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const applyGlobalProfile = normalizeBoolean(payload?.applyScoringAsGlobal, false);
    const useQuestionScoringOverride = normalizeBoolean(payload?.useQuestionScoringOverride, true);
    const sanitizedBase = sanitizeQuestionInput(payload, {});
    const scoringWriteState = await pteQuestionScoringProfileService.buildQuestionSaveScoringState({
      orgId: activeOrgId,
      testType: sanitizedBase.testType,
      questionType: sanitizedBase.questionType,
      payload: sanitizedBase.payload,
      scoringConfig: sanitizedBase.scoringConfig,
      existingQuestion: null,
      applyGlobalProfile,
      useQuestionScoringOverride
    }, {
      requestingUser,
      backendMode: options?.backendMode
    });
    const contracts = questionTypeRegistry.normalizeQuestionContracts(
      sanitizedBase.questionType,
      sanitizedBase.payload,
      scoringWriteState.effectiveScoringConfig
    );
    const sanitized = {
      ...sanitizedBase,
      scoringConfig: contracts.scoringConfig,
      responseContract: contracts.responseContract,
      validationErrors: contracts.errors
    };
    const creator = activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, activeOrgId)
      || activityQuotaLedgerService.createSystemCreatorSnapshot(activeOrgId);
    const audit = buildAuditFromCreator(creator, null, { isUpdate: false });

    const created = await pteQuestionVersionRepository.create({
      orgId: activeOrgId,
      familyId: cleanString(payload.familyId, { max: 140, allowEmpty: true }) || '',
      parentVersionId: cleanString(payload.parentVersionId, { max: 120, allowEmpty: true }) || '',
      revisionNumber: Math.max(1, Number.parseInt(String(payload.revisionNumber || '1'), 10) || 1),
      isLatestRevision: normalizeBoolean(payload.isLatestRevision, true),
      status: 'draft',
      code: sanitized.code,
      title: sanitized.title,
      testType: sanitized.testType,
      skill: sanitized.skill,
      questionType: sanitized.questionType,
      practiceEnabled: sanitized.practiceEnabled,
      difficulty: sanitized.difficulty,
      tags: sanitized.tags,
      instructions: sanitized.instructions,
      internalNotes: sanitized.internalNotes,
      payload: sanitized.payload,
      scoringConfig: scoringWriteState.questionScoringOverrides,
      scoringConfigMode: scoringWriteState.scoringConfigMode || 'override',
      useQuestionScoringOverride: scoringWriteState.useQuestionScoringOverride === true,
      responseContract: sanitized.responseContract,
      mediaAssets: sanitized.mediaAssets,
      validation: buildValidationSnapshot(sanitized.validationErrors, requestingUser),
      usageMeta: buildDefaultUsageMeta(),
      publishingMeta: buildPublishingMetaForStatus({}, 'draft', requestingUser),
      creator,
      audit
    }, {
      backendMode: options?.backendMode
    });

    if (created?.familyId && created?.isLatestRevision) {
      await syncFamilyLatestRevision(created.familyId, created.id, options);
    }
    return toSummaryRow(created);
  },

  async updateQuestion(id, payload = {}, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getQuestionById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('Question not found or inaccessible.');
    const statusToken = String(existing.status || '').toLowerCase();
    const isDraft = statusToken === 'draft';
    const isPublished = statusToken === 'published';
    if (!isDraft && !isPublished) {
      throw new Error('Only draft questions or published scoring can be edited.');
    }

    const activeOrgId = getActiveOrgIdOrThrow(requestingUser);
    if (!adminChekersService.isSuperAdmin(requestingUser) && !idsEqual(existing.orgId, activeOrgId)) {
      throw new Error('Active organization does not match this question.');
    }

    const applyGlobalProfile = normalizeBoolean(payload?.applyScoringAsGlobal, false);
    const useQuestionScoringOverride = normalizeBoolean(payload?.useQuestionScoringOverride, true);
    const sanitizedBase = sanitizeQuestionInput(payload, { existing });
    const scoringWriteState = await pteQuestionScoringProfileService.buildQuestionSaveScoringState({
      orgId: existing.orgId,
      testType: sanitizedBase.testType,
      questionType: sanitizedBase.questionType,
      payload: sanitizedBase.payload,
      scoringConfig: sanitizedBase.scoringConfig,
      existingQuestion: existing,
      applyGlobalProfile,
      useQuestionScoringOverride
    }, {
      requestingUser,
      backendMode: options?.backendMode
    });
    const contracts = questionTypeRegistry.normalizeQuestionContracts(
      sanitizedBase.questionType,
      sanitizedBase.payload,
      scoringWriteState.effectiveScoringConfig
    );
    const sanitized = {
      ...sanitizedBase,
      scoringConfig: contracts.scoringConfig,
      responseContract: contracts.responseContract,
      validationErrors: contracts.errors
    };

    if (isPublished) {
      const existingNormalized = sanitizeQuestionInput(existing, { existing });
      assertPublishedScoringOnlyUpdate(existingNormalized, sanitizedBase);
    }

    const creator = isPlainObject(existing.creator)
      ? existing.creator
      : (activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, existing.orgId)
        || activityQuotaLedgerService.createSystemCreatorSnapshot(existing.orgId));
    const audit = buildAuditFromCreator(creator, existing.audit || {}, { isUpdate: true });

    let updated = null;
    if (isDraft) {
      updated = await pteQuestionVersionRepository.update(existing.id, {
        code: sanitized.code,
        title: sanitized.title,
        testType: sanitized.testType,
        skill: sanitized.skill,
        questionType: sanitized.questionType,
        practiceEnabled: sanitized.practiceEnabled,
        difficulty: sanitized.difficulty,
        tags: sanitized.tags,
        instructions: sanitized.instructions,
        internalNotes: sanitized.internalNotes,
        payload: sanitized.payload,
        scoringConfig: scoringWriteState.questionScoringOverrides,
        scoringConfigMode: scoringWriteState.scoringConfigMode || 'override',
        useQuestionScoringOverride: scoringWriteState.useQuestionScoringOverride === true,
        responseContract: sanitized.responseContract,
        mediaAssets: sanitized.mediaAssets,
        validation: buildValidationSnapshot(sanitized.validationErrors, requestingUser),
        creator,
        audit
      }, {
        backendMode: options?.backendMode
      });
    } else {
      updated = await pteQuestionVersionRepository.update(existing.id, {
        scoringConfig: scoringWriteState.questionScoringOverrides,
        scoringConfigMode: scoringWriteState.scoringConfigMode || 'override',
        useQuestionScoringOverride: scoringWriteState.useQuestionScoringOverride === true,
        validation: buildValidationSnapshot(sanitized.validationErrors, requestingUser),
        creator,
        audit
      }, {
        backendMode: options?.backendMode
      });
    }

    return toSummaryRow(updated);
  },

  async validateQuestionPayload(payload = {}, requestingUser = null) {
    const sanitizedBase = sanitizeQuestionInput(payload, {});
    const activeOrgId = resolveActiveOrgId(requestingUser) || cleanString(payload?.orgId, { max: 120, allowEmpty: true }) || '';
    let validationErrors = Array.isArray(sanitizedBase.validationErrors) ? sanitizedBase.validationErrors : [];
    if (activeOrgId) {
      const useQuestionScoringOverride = normalizeBoolean(payload?.useQuestionScoringOverride, true);
      const scoringWriteState = await pteQuestionScoringProfileService.buildQuestionSaveScoringState({
        orgId: activeOrgId,
        testType: sanitizedBase.testType,
        questionType: sanitizedBase.questionType,
        payload: sanitizedBase.payload,
        scoringConfig: sanitizedBase.scoringConfig,
        existingQuestion: null,
        applyGlobalProfile: false,
        useQuestionScoringOverride
      }, {
        requestingUser,
        backendMode: null
      });
      validationErrors = questionTypeRegistry.validateQuestionContracts(
        sanitizedBase.questionType,
        sanitizedBase.payload || {},
        scoringWriteState.effectiveScoringConfig || {}
      );
    }
    return {
      isValid: validationErrors.length === 0,
      errors: validationErrors
    };
  },

  async publishQuestion(id, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getQuestionById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('Question not found or inaccessible.');
    if (String(existing.status || '').toLowerCase() !== 'draft') {
      throw new Error('Only draft questions can be published.');
    }

    const scoringState = await pteQuestionScoringProfileService.resolveQuestionScoring(existing, {
      requestingUser,
      backendMode: options?.backendMode
    });

    const errors = questionTypeRegistry.validateQuestionContracts(
      existing.questionType,
      existing.payload || {},
      scoringState.effectiveScoringConfig || {}
    );
    if (errors.length) {
      throw new Error(`Publish validation failed: ${errors.join(' ')}`);
    }

    const creator = isPlainObject(existing.creator)
      ? existing.creator
      : (activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, existing.orgId)
        || activityQuotaLedgerService.createSystemCreatorSnapshot(existing.orgId));
    const audit = buildAuditFromCreator(creator, existing.audit || {}, { isUpdate: true });

    const updated = await pteQuestionVersionRepository.update(existing.id, {
      status: 'published',
      isLatestRevision: true,
      validation: buildValidationSnapshot([], requestingUser),
      publishingMeta: buildPublishingMetaForStatus(existing.publishingMeta || {}, 'published', requestingUser),
      creator,
      audit
    }, {
      backendMode: options?.backendMode
    });

    await syncFamilyLatestRevision(updated.familyId, updated.id, options);
    return toSummaryRow(updated);
  },

  async unpublishQuestion(id, requestingUser, accessContext = {}, options = {}) {
    if (!adminChekersService.isSuperAdmin(requestingUser)) {
      throw new Error('Only super users can unpublish questions.');
    }

    const existing = await this.getQuestionById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('Question not found or inaccessible.');
    if (String(existing.status || '').toLowerCase() !== 'published') {
      throw new Error('Only published questions can be unpublished.');
    }

    const usage = await resolveAndSyncQuestionUsageMeta(existing, options);
    if ((usage.testsCount + usage.assignmentsCount + usage.attemptsCount) > 0) {
      throw new Error(
        `Cannot unpublish a question that is already used in tests, assignments, or attempts. `
        + `Current usage => tests: ${usage.testsCount}, assignments: ${usage.assignmentsCount}, attempts: ${usage.attemptsCount}.`
      );
    }

    const creator = isPlainObject(existing.creator)
      ? existing.creator
      : (activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, existing.orgId)
        || activityQuotaLedgerService.createSystemCreatorSnapshot(existing.orgId));
    const audit = buildAuditFromCreator(creator, existing.audit || {}, { isUpdate: true });

    const updated = await pteQuestionVersionRepository.update(existing.id, {
      status: 'draft',
      validation: buildValidationSnapshot([], requestingUser),
      publishingMeta: buildPublishingMetaForStatus(existing.publishingMeta || {}, 'draft', requestingUser, {
        markUnpublished: true
      }),
      creator,
      audit
    }, {
      backendMode: options?.backendMode
    });
    return toSummaryRow(updated);
  },

  async reviseQuestion(id, requestingUser, accessContext = {}, options = {}) {
    const source = await this.getQuestionById(id, requestingUser, accessContext, options);
    if (!source) throw new Error('Question not found or inaccessible.');
    const status = String(source.status || '').toLowerCase();
    if (status === 'draft') {
      throw new Error('Draft questions cannot be revised. Edit the draft directly.');
    }

    const familyRows = await pteQuestionVersionRepository.listByFamily(source.familyId, {
      scope: { canViewAll: true },
      backendMode: options?.backendMode
    });
    const maxRevision = (Array.isArray(familyRows) ? familyRows : [])
      .reduce((max, row) => Math.max(max, Number(row?.revisionNumber || 0)), 0);

    const creator = activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, source.orgId)
      || activityQuotaLedgerService.createSystemCreatorSnapshot(source.orgId);
    const sourceScoringState = await pteQuestionScoringProfileService.resolveQuestionScoring(source, {
      requestingUser,
      backendMode: options?.backendMode
    });
    const sourceUsesQuestionScoringOverride = sourceScoringState.useQuestionScoringOverride === true;
    const clonedScoringWriteState = await pteQuestionScoringProfileService.buildQuestionSaveScoringState({
      orgId: source.orgId,
      testType: normalizeTestType(source.testType, questionTypeRegistry.inferDefaultTestTypeForType(source.questionType || '')),
      questionType: source.questionType || '',
      payload: isPlainObject(source.payload) ? source.payload : {},
      scoringConfig: sourceScoringState.effectiveScoringConfig || {},
      existingQuestion: source,
      applyGlobalProfile: false,
      useQuestionScoringOverride: sourceUsesQuestionScoringOverride
    }, {
      requestingUser,
      backendMode: options?.backendMode
    });
    const clonedValidation = questionTypeRegistry.validateQuestionContracts(
      source.questionType,
      source.payload || {},
      clonedScoringWriteState.effectiveScoringConfig || {}
    );

    const created = await pteQuestionVersionRepository.create({
      orgId: source.orgId,
      familyId: source.familyId,
      parentVersionId: source.id,
      revisionNumber: maxRevision + 1,
      isLatestRevision: true,
      status: 'draft',
      code: source.code || '',
      title: source.title || '',
      testType: normalizeTestType(source.testType, questionTypeRegistry.inferDefaultTestTypeForType(source.questionType || '')),
      skill: source.skill || '',
      questionType: source.questionType || '',
      practiceEnabled: source.practiceEnabled !== false,
      difficulty: source.difficulty || 'medium',
      tags: Array.isArray(source.tags) ? source.tags : [],
      instructions: source.instructions || '',
      internalNotes: source.internalNotes || '',
      payload: isPlainObject(source.payload) ? source.payload : {},
      scoringConfig: clonedScoringWriteState.questionScoringOverrides || {},
      scoringConfigMode: clonedScoringWriteState.scoringConfigMode || 'override',
      useQuestionScoringOverride: clonedScoringWriteState.useQuestionScoringOverride === true,
      responseContract: isPlainObject(source.responseContract) ? source.responseContract : {},
      mediaAssets: Array.isArray(source.mediaAssets) ? source.mediaAssets : [],
      validation: buildValidationSnapshot(clonedValidation, requestingUser),
      usageMeta: buildDefaultUsageMeta(),
      publishingMeta: buildPublishingMetaForStatus({}, 'draft', requestingUser),
      creator,
      audit: buildAuditFromCreator(creator, null, { isUpdate: false })
    }, {
      backendMode: options?.backendMode
    });

    await syncFamilyLatestRevision(source.familyId, created.id, options);
    return toSummaryRow(created);
  },

  async retireQuestion(id, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getQuestionById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('Question not found or inaccessible.');
    if (String(existing.status || '').toLowerCase() !== 'published') {
      throw new Error('Only published questions can be retired.');
    }
    const creator = isPlainObject(existing.creator)
      ? existing.creator
      : (activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, existing.orgId)
        || activityQuotaLedgerService.createSystemCreatorSnapshot(existing.orgId));
    const audit = buildAuditFromCreator(creator, existing.audit || {}, { isUpdate: true });
    const updated = await pteQuestionVersionRepository.update(existing.id, {
      status: 'retired',
      publishingMeta: buildPublishingMetaForStatus(existing.publishingMeta || {}, 'retired', requestingUser),
      creator,
      audit
    }, {
      backendMode: options?.backendMode
    });
    return toSummaryRow(updated);
  },

  async archiveQuestion(id, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getQuestionById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('Question not found or inaccessible.');
    if (String(existing.status || '').toLowerCase() === 'archived') {
      return existing;
    }
    const creator = isPlainObject(existing.creator)
      ? existing.creator
      : (activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, existing.orgId)
        || activityQuotaLedgerService.createSystemCreatorSnapshot(existing.orgId));
    const audit = buildAuditFromCreator(creator, existing.audit || {}, { isUpdate: true });
    const updated = await pteQuestionVersionRepository.update(existing.id, {
      status: 'archived',
      publishingMeta: buildPublishingMetaForStatus(existing.publishingMeta || {}, 'archived', requestingUser),
      creator,
      audit
    }, {
      backendMode: options?.backendMode
    });
    return toSummaryRow(updated);
  },

  async duplicateFamily(id, requestingUser, accessContext = {}, options = {}) {
    const source = await this.getQuestionById(id, requestingUser, accessContext, options);
    if (!source) throw new Error('Question not found or inaccessible.');

    const creator = activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, source.orgId)
      || activityQuotaLedgerService.createSystemCreatorSnapshot(source.orgId);
    const sourceScoringState = await pteQuestionScoringProfileService.resolveQuestionScoring(source, {
      requestingUser,
      backendMode: options?.backendMode
    });
    const sourceUsesQuestionScoringOverride = sourceScoringState.useQuestionScoringOverride === true;
    const duplicateScoringWriteState = await pteQuestionScoringProfileService.buildQuestionSaveScoringState({
      orgId: source.orgId,
      testType: normalizeTestType(source.testType, questionTypeRegistry.inferDefaultTestTypeForType(source.questionType || '')),
      questionType: source.questionType || '',
      payload: isPlainObject(source.payload) ? source.payload : {},
      scoringConfig: sourceScoringState.effectiveScoringConfig || {},
      existingQuestion: source,
      applyGlobalProfile: false,
      useQuestionScoringOverride: sourceUsesQuestionScoringOverride
    }, {
      requestingUser,
      backendMode: options?.backendMode
    });
    const copiedValidationErrors = questionTypeRegistry.validateQuestionContracts(
      source.questionType,
      source.payload || {},
      duplicateScoringWriteState.effectiveScoringConfig || {}
    );

    const duplicate = await pteQuestionVersionRepository.create({
      orgId: source.orgId,
      familyId: '',
      parentVersionId: '',
      revisionNumber: 1,
      isLatestRevision: true,
      status: 'draft',
      code: source.code ? `${source.code}-COPY` : '',
      title: `${source.title || 'Question'} (Copy)`,
      testType: normalizeTestType(source.testType, questionTypeRegistry.inferDefaultTestTypeForType(source.questionType || '')),
      skill: source.skill || '',
      questionType: source.questionType || '',
      practiceEnabled: source.practiceEnabled !== false,
      difficulty: source.difficulty || 'medium',
      tags: Array.isArray(source.tags) ? source.tags : [],
      instructions: source.instructions || '',
      internalNotes: source.internalNotes || '',
      payload: isPlainObject(source.payload) ? source.payload : {},
      scoringConfig: duplicateScoringWriteState.questionScoringOverrides || {},
      scoringConfigMode: duplicateScoringWriteState.scoringConfigMode || 'override',
      useQuestionScoringOverride: duplicateScoringWriteState.useQuestionScoringOverride === true,
      responseContract: isPlainObject(source.responseContract) ? source.responseContract : {},
      mediaAssets: Array.isArray(source.mediaAssets) ? source.mediaAssets : [],
      validation: buildValidationSnapshot(copiedValidationErrors, requestingUser),
      usageMeta: buildDefaultUsageMeta(),
      publishingMeta: buildPublishingMetaForStatus({}, 'draft', requestingUser),
      creator,
      audit: buildAuditFromCreator(creator, null, { isUpdate: false })
    }, {
      backendMode: options?.backendMode
    });

    return toSummaryRow(duplicate);
  },

  async deleteQuestion(id, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getQuestionById(id, requestingUser, accessContext, options);
    if (!existing) throw new Error('Question not found or inaccessible.');
    if (String(existing.status || '').toLowerCase() !== 'draft') {
      throw new Error('Only draft questions can be deleted.');
    }

    const usage = await resolveAndSyncQuestionUsageMeta(existing, options);
    if ((usage.testsCount + usage.assignmentsCount + usage.attemptsCount) > 0) {
      throw new Error(
        `Draft question has usage references and cannot be deleted. `
        + `Current usage => tests: ${usage.testsCount}, assignments: ${usage.assignmentsCount}, attempts: ${usage.attemptsCount}.`
      );
    }

    const result = await pteQuestionVersionRepository.remove(existing.id, {
      backendMode: options?.backendMode
    });

    if (existing.familyId && existing.isLatestRevision) {
      await promoteLatestRevisionAfterDelete(existing.familyId, options);
    }
    return result === true || Number(result?.deletedCount || 0) > 0;
  },

  async resolveReadVisibility(requestingUser, accessContext = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    return visibility;
  },

  buildQuestionTypeMatrix() {
    const registry = questionTypeRegistry.getEditorRegistry();
    return registry.map((row) => ({
      key: row.key,
      skill: row.skill,
      testTypes: Array.isArray(row.testTypes) ? row.testTypes : questionTypeRegistry.getAllowedTestTypesForType(row.key),
      shownFields: [...(row.requiredFields || []), ...(row.optionalFields || [])].map((fieldRow) => fieldRow.key),
      hiddenFields: Array.isArray(row.hiddenFields) ? row.hiddenFields : [],
      scoringFields: (row.scoringFields || []).map((fieldRow) => fieldRow.key),
      responseShape: row.responseShape || {},
      editorPartial: row.editorBehavior?.partial || row.key,
      mediaInputs: row.editorBehavior?.mediaInputs || [],
      timingInputs: row.editorBehavior?.timingInputs || []
    }));
  },

  async listFamilyRevisions(familyId, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const token = toPublicId(familyId);
    if (!token) return [];
    const rows = await pteQuestionVersionRepository.listByFamily(token, {
      scope: buildRepositoryScope(visibility),
      sort: { revisionNumber: -1, 'audit.createDateTime': -1 },
      backendMode: options?.backendMode
    });
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => isVisibleQuestionRow(row, visibility))
      .map((row) => toSummaryRow(row));
  },

  async listQuestionTypes(query = {}, requestingUser, accessContext = {}) {
    await this.resolveReadVisibility(requestingUser, accessContext);
    const normalized = normalizeQueryOptions(stripPaginationFromQuery(query || {}));
    const rows = questionTypeRegistry.getEditorRegistry().map((row) => ({
      id: row.key,
      key: row.key,
      name: row.label,
      skill: row.skill,
      purpose: row.purpose,
      testTypes: Array.isArray(row.testTypes) ? row.testTypes : questionTypeRegistry.getAllowedTestTypesForType(row.key)
    }));

    const testTypeToken = normalizeTestType(normalized.testType, '');
    const scopedRows = testTypeToken
      ? rows.filter((row) => Array.isArray(row.testTypes) && row.testTypes.includes(testTypeToken))
      : rows;

    const token = cleanString(normalized.q, { max: 220, allowEmpty: true }).toLowerCase();
    if (!token) return scopedRows;
    return scopedRows.filter((row) => {
      return [row.id, row.name, row.skill, row.purpose].some((fieldValue) => String(fieldValue || '').toLowerCase().includes(token));
    });
  }
};

module.exports = pteQuestionBankDataService;
