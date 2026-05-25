const pteTestVersionRepository = require('../../repositories/pteTestVersionRepository');
const pteQuestionVersionRepository = require('../../repositories/pteQuestionVersionRepository');
const pteQuestionBankDataService = require('./pteQuestionBankDataService');
const questionTypeRegistry = require('./questionTypeRegistry');
const adminChekersService = require('../../../../../MVC/services/adminChekersService');
const activityQuotaLedgerService = require('../../../../../MVC/services/activityQuotaLedgerService');
const { normalizeQueryOptions } = require('../../../../../MVC/utils/queryOptionsAdapter');
const { resolveEntity } = require('../../../../../MVC/utils/entityResolver');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');
const { assertCreateOrgContextOrThrow, getActiveOrgIdOrThrow } = require('../../../../../MVC/utils/orgContextUtils');
const settingService = require('../../../../../MVC/services/settingService');

const ORGANIZATION_SCOPE_NAMES = new Set(['ADMIN', 'GLOBAL', 'ORGANIZATION', 'ORG']);
const VALID_SKILLS = Object.freeze(['speaking', 'writing', 'reading', 'listening']);
const STATUS_OPTIONS = Object.freeze(['draft', 'published', 'archived']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function normalizeSkill(value) {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  return VALID_SKILLS.includes(token) ? token : '';
}

function normalizeQuestionStatus(value, fallback = '') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  if (!token) return fallback;
  if (['draft', 'published', 'retired', 'archived'].includes(token)) return token;
  return fallback;
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

function isVisibleTestRow(row, visibility) {
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

const TEST_LIST_PROJECTION = Object.freeze({
  id: 1,
  orgId: 1,
  familyId: 1,
  parentVersionId: 1,
  revisionNumber: 1,
  isLatestRevision: 1,
  status: 1,
  code: 1,
  title: 1,
  description: 1,
  tags: 1,
  allocations: 1,
  validation: 1,
  usageMeta: 1,
  publishingMeta: 1,
  creator: 1,
  audit: 1
});

function sanitizeQuestionRef(rawRef = {}, skill = '') {
  const input = isPlainObject(rawRef) ? rawRef : {};
  const questionVersionId = cleanString(
    input.questionVersionId || input.id,
    { max: 120, allowEmpty: true }
  );
  if (!questionVersionId) throw new Error(`Question id is required for ${skill}.`);

  return {
    questionVersionId,
    questionFamilyId: cleanString(input.questionFamilyId, { max: 140, allowEmpty: true }) || '',
    questionCode: cleanString(input.questionCode, { max: 120, allowEmpty: true }) || '',
    questionTitle: cleanString(input.questionTitle, { max: 260, allowEmpty: true }) || '',
    questionType: cleanString(input.questionType, { max: 120, allowEmpty: true }).toLowerCase() || '',
    skill,
    statusAtSelection: normalizeQuestionStatus(input.statusAtSelection, ''),
    sequenceNo: Number.parseInt(String(input.sequenceNo || '0'), 10) || 0
  };
}

function sanitizeAllocations(value = {}, fallback = {}) {
  const source = isPlainObject(value) ? value : {};
  const existing = isPlainObject(fallback) ? fallback : {};
  const out = {};
  VALID_SKILLS.forEach((skill) => {
    const rows = source[skill] !== undefined ? source[skill] : existing[skill];
    const list = Array.isArray(rows) ? rows : [];
    const seen = new Set();
    out[skill] = list.reduce((acc, rawRef) => {
      const ref = sanitizeQuestionRef(rawRef, skill);
      const key = cleanString(ref.questionVersionId, { max: 120, allowEmpty: true });
      if (!key || seen.has(key)) return acc;
      seen.add(key);
      acc.push({
        ...ref,
        sequenceNo: acc.length + 1
      });
      return acc;
    }, []);
  });
  return out;
}

function sanitizeTestInput(payload = {}, { existing = null } = {}) {
  const source = isPlainObject(payload) ? payload : {};
  const current = isPlainObject(existing) ? existing : {};

  const title = cleanString(source.title, { max: 260, allowEmpty: true })
    || cleanString(current.title, { max: 260, allowEmpty: true });
  if (!title) throw new Error('Test title is required.');

  return {
    code: cleanString(source.code, { max: 120, allowEmpty: true })
      || cleanString(current.code, { max: 120, allowEmpty: true })
      || '',
    title,
    description: cleanString(source.description, { max: 5000, allowEmpty: true })
      || cleanString(current.description, { max: 5000, allowEmpty: true })
      || '',
    instructions: cleanString(source.instructions, { max: 10000, allowEmpty: true })
      || cleanString(current.instructions, { max: 10000, allowEmpty: true })
      || '',
    tags: normalizeTagArray(source.tags !== undefined ? source.tags : (current.tags || [])),
    allocations: sanitizeAllocations(
      source.allocations !== undefined ? source.allocations : {},
      current.allocations || {}
    )
  };
}

function flattenQuestionRefs(allocations = {}) {
  const list = [];
  VALID_SKILLS.forEach((skill) => {
    const rows = Array.isArray(allocations?.[skill]) ? allocations[skill] : [];
    rows.forEach((row) => {
      list.push({ ...row, skill });
    });
  });
  return list;
}

function buildValidationSnapshot(errors = [], warnings = [], requestingUser = null) {
  const nowIso = new Date().toISOString();
  return {
    isValid: Array.isArray(errors) ? errors.length === 0 : true,
    errors: Array.isArray(errors) ? errors : [],
    warnings: Array.isArray(warnings) ? warnings : [],
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
    assignmentsCount: Math.max(0, Number.parseInt(String(source.assignmentsCount || '0'), 10) || 0),
    attemptsCount: Math.max(0, Number.parseInt(String(source.attemptsCount || '0'), 10) || 0)
  };
}

function buildPublishingMetaForStatus(existing = {}, nextStatus = 'draft', requestingUser = null) {
  const source = isPlainObject(existing) ? existing : {};
  const actor = toPublicId(requestingUser?.id || '') || 'System';
  const nowIso = new Date().toISOString();
  const out = {
    publishedBy: cleanString(source.publishedBy, { max: 120, allowEmpty: true }) || '',
    publishedAt: cleanString(source.publishedAt, { max: 80, allowEmpty: true }) || '',
    archivedBy: cleanString(source.archivedBy, { max: 120, allowEmpty: true }) || '',
    archivedAt: cleanString(source.archivedAt, { max: 80, allowEmpty: true }) || ''
  };
  if (nextStatus === 'published') {
    out.publishedBy = actor;
    out.publishedAt = nowIso;
  }
  if (nextStatus === 'archived') {
    out.archivedBy = actor;
    out.archivedAt = nowIso;
  }
  return out;
}

function buildSkillCounts(allocations = {}) {
  const out = {};
  VALID_SKILLS.forEach((skill) => {
    out[skill] = Array.isArray(allocations?.[skill]) ? allocations[skill].length : 0;
  });
  return out;
}

function toSummaryRow(row = {}) {
  const refs = flattenQuestionRefs(row.allocations || {});
  const counts = buildSkillCounts(row.allocations || {});
  const warnings = Array.isArray(row?.validation?.warnings) ? row.validation.warnings : [];
  const retiredWarnings = warnings.filter((item) => String(item || '').toLowerCase().includes('retired'));
  return {
    ...row,
    summary: {
      questionCount: refs.length,
      skillCounts: counts,
      validationErrors: Array.isArray(row?.validation?.errors) ? row.validation.errors.length : 0,
      retiredWarnings: retiredWarnings.length
    }
  };
}

function toQuestionRefMap(allocations = {}) {
  const out = new Map();
  flattenQuestionRefs(allocations).forEach((ref) => {
    const id = cleanString(ref?.questionVersionId, { max: 120, allowEmpty: true });
    if (!id || out.has(id)) return;
    out.set(id, ref);
  });
  return out;
}

async function syncFamilyLatestRevision(familyId, latestId, options = {}) {
  const token = toPublicId(familyId);
  const latestToken = toPublicId(latestId);
  if (!token || !latestToken) return;

  const rows = await pteTestVersionRepository.listByFamily(token, {
    scope: { canViewAll: true },
    backendMode: options?.backendMode
  });
  const updates = (Array.isArray(rows) ? rows : [])
    .filter((row) => toPublicId(row?.id))
    .map((row) => {
      const rowId = toPublicId(row.id);
      return pteTestVersionRepository.update(rowId, {
        isLatestRevision: idsEqual(rowId, latestToken)
      }, {
        backendMode: options?.backendMode
      });
    });
  await Promise.all(updates);
}

async function promoteLatestRevisionAfterDelete(familyId, options = {}) {
  const token = toPublicId(familyId);
  if (!token) return;
  const rows = await pteTestVersionRepository.listByFamily(token, {
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

function buildPublishReadinessErrors(allocations = {}) {
  const errors = [];
  VALID_SKILLS.forEach((skill) => {
    const rows = Array.isArray(allocations?.[skill]) ? allocations[skill] : [];
    if (!rows.length) {
      errors.push(`Publish requires at least one ${skill} question.`);
    }
  });
  return errors;
}

async function resolveAndHydrateQuestionRefs(
  allocations = {},
  requestingUser,
  accessContext = {},
  options = {}
) {
  const existingRefMap = options?.existingRefMap instanceof Map ? options.existingRefMap : new Map();
  const errors = [];
  const warnings = [];
  const hydrated = {};
  const seenQuestionIds = new Set();

  for (const skill of VALID_SKILLS) {
    const rows = Array.isArray(allocations?.[skill]) ? allocations[skill] : [];
    const nextRows = [];

    for (const row of rows) {
      const questionId = cleanString(row?.questionVersionId, { max: 120, allowEmpty: true });
      if (!questionId) {
        errors.push(`A ${skill} row is missing a question id.`);
        // eslint-disable-next-line no-continue
        continue;
      }
      if (seenQuestionIds.has(questionId)) {
        errors.push(`Question ${questionId} is duplicated in this test.`);
        // eslint-disable-next-line no-continue
        continue;
      }
      seenQuestionIds.add(questionId);

      // eslint-disable-next-line no-await-in-loop
      const question = await pteQuestionBankDataService.getQuestionById(questionId, requestingUser, {
        scopeId: accessContext.scopeId
      }, {
        backendMode: options?.backendMode
      });
      if (!question) {
        errors.push(`Question ${questionId} is missing or inaccessible.`);
        // eslint-disable-next-line no-continue
        continue;
      }

      const questionSkill = normalizeSkill(question.skill);
      if (questionSkill !== skill) {
        errors.push(`Question ${questionId} belongs to skill '${questionSkill || '-'}' and cannot be placed under '${skill}'.`);
        // eslint-disable-next-line no-continue
        continue;
      }

      const questionStatus = normalizeQuestionStatus(question.status, '');
      const wasPreviouslyLinked = existingRefMap.has(questionId);

      if (questionStatus === 'published') {
        // ok
      } else if (questionStatus === 'retired' && wasPreviouslyLinked) {
        warnings.push(`Linked question ${questionId} is retired and will be shown as retired in this test.`);
      } else if (questionStatus === 'retired' && !wasPreviouslyLinked) {
        errors.push(`Question ${questionId} is retired and cannot be newly added.`);
        // eslint-disable-next-line no-continue
        continue;
      } else {
        errors.push(`Question ${questionId} is '${questionStatus || 'unknown'}' and cannot be used in test authoring.`);
        // eslint-disable-next-line no-continue
        continue;
      }

      const currentRef = existingRefMap.get(questionId) || {};
      nextRows.push({
        questionVersionId: questionId,
        questionFamilyId: cleanString(question.familyId, { max: 140, allowEmpty: true }) || '',
        questionCode: cleanString(question.code, { max: 120, allowEmpty: true }) || '',
        questionTitle: cleanString(question.title, { max: 260, allowEmpty: true }) || '',
        questionType: cleanString(question.questionType, { max: 120, allowEmpty: true }).toLowerCase() || '',
        skill,
        statusAtSelection: cleanString(currentRef.statusAtSelection, { max: 40, allowEmpty: true }).toLowerCase() || questionStatus,
        currentStatus: questionStatus,
        sequenceNo: nextRows.length + 1
      });
    }

    hydrated[skill] = nextRows;
  }

  return {
    allocations: hydrated,
    errors,
    warnings
  };
}

function getQuestionIdsFromAllocations(allocations = {}) {
  const ids = new Set();
  flattenQuestionRefs(allocations).forEach((row) => {
    const id = cleanString(row?.questionVersionId, { max: 120, allowEmpty: true });
    if (id) ids.add(id);
  });
  return Array.from(ids);
}

async function applyQuestionUsageDelta(questionIds = [], delta = 0, options = {}) {
  const amount = Number(delta || 0);
  if (!amount) return;
  const ids = Array.isArray(questionIds) ? questionIds : [];

  for (const questionId of ids) {
    const token = cleanString(questionId, { max: 120, allowEmpty: true });
    if (!token) {
      // eslint-disable-next-line no-continue
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const question = await pteQuestionVersionRepository.getById(token, {
      backendMode: options?.backendMode
    });
    if (!question) {
      // eslint-disable-next-line no-continue
      continue;
    }
    const usage = isPlainObject(question.usageMeta) ? question.usageMeta : {};
    const currentTestsCount = Math.max(0, Number.parseInt(String(usage.testsCount || '0'), 10) || 0);
    const nextTestsCount = Math.max(0, currentTestsCount + amount);
    if (nextTestsCount === currentTestsCount) {
      // eslint-disable-next-line no-continue
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await pteQuestionVersionRepository.update(token, {
      usageMeta: {
        ...usage,
        testsCount: nextTestsCount
      }
    }, {
      backendMode: options?.backendMode
    });
  }
}

async function enrichQuestionStatuses(row, requestingUser, accessContext = {}, options = {}) {
  const source = isPlainObject(row) ? row : {};
  const allocations = sanitizeAllocations(source.allocations || {}, {});
  const warnings = [];

  for (const skill of VALID_SKILLS) {
    const rows = Array.isArray(allocations[skill]) ? allocations[skill] : [];
    const nextRows = [];
    for (const questionRef of rows) {
      const questionId = cleanString(questionRef?.questionVersionId, { max: 120, allowEmpty: true });
      if (!questionId) continue;
      // eslint-disable-next-line no-await-in-loop
      const question = await pteQuestionBankDataService.getQuestionById(questionId, requestingUser, {
        scopeId: accessContext.scopeId
      }, {
        backendMode: options?.backendMode
      });
      const currentStatus = normalizeQuestionStatus(question?.status, '');
      const isMissing = !question;
      const isRetired = currentStatus === 'retired';
      if (isMissing) {
        warnings.push(`Question ${questionId} is missing or inaccessible.`);
      } else if (isRetired) {
        warnings.push(`Question ${questionId} is retired.`);
      }
      nextRows.push({
        ...questionRef,
        questionFamilyId: cleanString(question?.familyId, { max: 140, allowEmpty: true }) || questionRef.questionFamilyId || '',
        questionCode: cleanString(question?.code, { max: 120, allowEmpty: true }) || questionRef.questionCode || '',
        questionTitle: cleanString(question?.title, { max: 260, allowEmpty: true }) || questionRef.questionTitle || '',
        questionType: cleanString(question?.questionType, { max: 120, allowEmpty: true }).toLowerCase() || questionRef.questionType || '',
        currentStatus,
        isRetired,
        isMissing
      });
    }
    allocations[skill] = nextRows;
  }

  return {
    ...source,
    allocations,
    runtimeWarnings: warnings
  };
}

const pteTestDataService = {
  async assertCreateContext(requestingUser) {
    return assertCreateOrgContextOrThrow(requestingUser, { scopeLabel: 'PTE tests' });
  },

  getFormOptions() {
    return {
      statuses: STATUS_OPTIONS.map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) })),
      skills: VALID_SKILLS.map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) })),
      questionTypes: questionTypeRegistry.getEditorRegistry().map((row) => ({
        value: row.key,
        label: row.label,
        skill: row.skill
      }))
    };
  },

  async resolveReadVisibility(requestingUser, accessContext = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    return visibility;
  },

  async listTests(query = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const normalizedQuery = normalizeQueryOptions(query || {});
    const listQuery = stripPaginationFromQuery(normalizedQuery);
    const scope = buildRepositoryScope(visibility);
    const sort = options?.sort || { 'audit.createDateTime': -1, id: -1 };
    const projection = (options?.projection && isPlainObject(options.projection))
      ? options.projection
      : TEST_LIST_PROJECTION;
    const paginationInput = normalizePagination(
      options?.pagination || {},
      normalizedQuery
    );
    const paginated = options?.paginated === true || paginationInput.limit > 0;

    if (paginated) {
      const [totalRows, rows] = await Promise.all([
        pteTestVersionRepository.count({
          query: listQuery,
          scope,
          backendMode: options?.backendMode
        }),
        pteTestVersionRepository.list({
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
        .filter((row) => isVisibleTestRow(row, visibility))
        .map((row) => toSummaryRow(row));
      return {
        rows: mappedRows,
        totalRows: Math.max(totalRows, mappedRows.length),
        pagination: buildPaginationMeta(totalRows, paginationInput.page, paginationInput.limit)
      };
    }

    const rows = await pteTestVersionRepository.list({
      query: listQuery,
      scope,
      sort,
      projection,
      backendMode: options?.backendMode
    });
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => isVisibleTestRow(row, visibility))
      .map((row) => toSummaryRow(row));
  },

  async getTestById(id, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const row = await pteTestVersionRepository.getById(id, {
      backendMode: options?.backendMode
    });
    if (!row || !isVisibleTestRow(row, visibility)) return null;
    const withSummary = toSummaryRow(row);
    if (options?.includeQuestionStatus !== false) {
      return enrichQuestionStatuses(withSummary, requestingUser, accessContext, options);
    }
    return withSummary;
  },

  async createTest(payload = {}, requestingUser, accessContext = {}, options = {}) {
    const activeOrgId = await this.assertCreateContext(requestingUser);
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const sanitized = sanitizeTestInput(payload, {});
    const resolvedRefs = await resolveAndHydrateQuestionRefs(
      sanitized.allocations,
      requestingUser,
      accessContext,
      options
    );
    if (resolvedRefs.errors.length) {
      throw new Error(resolvedRefs.errors.join(' '));
    }

    const creator = activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, activeOrgId)
      || activityQuotaLedgerService.createSystemCreatorSnapshot(activeOrgId);
    const audit = buildAuditFromCreator(creator, null, { isUpdate: false });

    const created = await pteTestVersionRepository.create({
      orgId: activeOrgId,
      familyId: cleanString(payload.familyId, { max: 140, allowEmpty: true }) || '',
      parentVersionId: cleanString(payload.parentVersionId, { max: 120, allowEmpty: true }) || '',
      revisionNumber: Math.max(1, Number.parseInt(String(payload.revisionNumber || '1'), 10) || 1),
      isLatestRevision: true,
      status: 'draft',
      code: sanitized.code,
      title: sanitized.title,
      description: sanitized.description,
      instructions: sanitized.instructions,
      tags: sanitized.tags,
      allocations: resolvedRefs.allocations,
      validation: buildValidationSnapshot([], resolvedRefs.warnings, requestingUser),
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

  async updateTest(id, payload = {}, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getTestById(id, requestingUser, accessContext, {
      ...options,
      includeQuestionStatus: false
    });
    if (!existing) throw new Error('Test not found or inaccessible.');
    if (String(existing.status || '').toLowerCase() !== 'draft') {
      throw new Error('Only draft tests can be edited. Use Revise for published items.');
    }

    const activeOrgId = getActiveOrgIdOrThrow(requestingUser);
    if (!adminChekersService.isSuperAdmin(requestingUser) && !idsEqual(existing.orgId, activeOrgId)) {
      throw new Error('Active organization does not match this test.');
    }

    const sanitized = sanitizeTestInput(payload, { existing });
    const resolvedRefs = await resolveAndHydrateQuestionRefs(
      sanitized.allocations,
      requestingUser,
      accessContext,
      {
        ...options,
        existingRefMap: toQuestionRefMap(existing.allocations || {})
      }
    );
    if (resolvedRefs.errors.length) {
      throw new Error(resolvedRefs.errors.join(' '));
    }

    const creator = isPlainObject(existing.creator)
      ? existing.creator
      : (activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, existing.orgId)
        || activityQuotaLedgerService.createSystemCreatorSnapshot(existing.orgId));
    const audit = buildAuditFromCreator(creator, existing.audit || {}, { isUpdate: true });

    const updated = await pteTestVersionRepository.update(existing.id, {
      code: sanitized.code,
      title: sanitized.title,
      description: sanitized.description,
      instructions: sanitized.instructions,
      tags: sanitized.tags,
      allocations: resolvedRefs.allocations,
      validation: buildValidationSnapshot([], resolvedRefs.warnings, requestingUser),
      creator,
      audit
    }, {
      backendMode: options?.backendMode
    });
    return toSummaryRow(updated);
  },

  async validateTestPayload(payload = {}, requestingUser = null, accessContext = {}, options = {}) {
    const existing = options?.existingTestId
      ? await this.getTestById(options.existingTestId, requestingUser, accessContext, {
        ...options,
        includeQuestionStatus: false
      })
      : null;

    const sanitized = sanitizeTestInput(payload, { existing });
    const resolvedRefs = await resolveAndHydrateQuestionRefs(
      sanitized.allocations,
      requestingUser,
      accessContext,
      {
        ...options,
        existingRefMap: toQuestionRefMap(existing?.allocations || {})
      }
    );
    const publishErrors = [
      ...resolvedRefs.errors,
      ...buildPublishReadinessErrors(resolvedRefs.allocations)
    ];
    return {
      isValidDraft: resolvedRefs.errors.length === 0,
      draftErrors: resolvedRefs.errors,
      warnings: resolvedRefs.warnings,
      publishReady: publishErrors.length === 0,
      publishErrors,
      questionCount: flattenQuestionRefs(resolvedRefs.allocations).length,
      skillCounts: buildSkillCounts(resolvedRefs.allocations),
      allocations: resolvedRefs.allocations
    };
  },

  async publishTest(id, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getTestById(id, requestingUser, accessContext, {
      ...options,
      includeQuestionStatus: false
    });
    if (!existing) throw new Error('Test not found or inaccessible.');
    if (String(existing.status || '').toLowerCase() !== 'draft') {
      throw new Error('Only draft tests can be published.');
    }

    const resolvedRefs = await resolveAndHydrateQuestionRefs(
      existing.allocations || {},
      requestingUser,
      accessContext,
      {
        ...options,
        existingRefMap: toQuestionRefMap(existing.allocations || {})
      }
    );
    const publishErrors = [
      ...resolvedRefs.errors,
      ...buildPublishReadinessErrors(resolvedRefs.allocations)
    ];
    if (publishErrors.length) {
      throw new Error(`Publish validation failed: ${publishErrors.join(' ')}`);
    }

    const creator = isPlainObject(existing.creator)
      ? existing.creator
      : (activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, existing.orgId)
        || activityQuotaLedgerService.createSystemCreatorSnapshot(existing.orgId));
    const audit = buildAuditFromCreator(creator, existing.audit || {}, { isUpdate: true });
    const questionIds = getQuestionIdsFromAllocations(resolvedRefs.allocations);

    const updated = await pteTestVersionRepository.update(existing.id, {
      status: 'published',
      isLatestRevision: true,
      allocations: resolvedRefs.allocations,
      validation: buildValidationSnapshot([], resolvedRefs.warnings, requestingUser),
      publishingMeta: buildPublishingMetaForStatus(existing.publishingMeta || {}, 'published', requestingUser),
      creator,
      audit
    }, {
      backendMode: options?.backendMode
    });

    await syncFamilyLatestRevision(updated.familyId, updated.id, options);
    await applyQuestionUsageDelta(questionIds, 1, options);
    return toSummaryRow(updated);
  },

  async reviseTest(id, requestingUser, accessContext = {}, options = {}) {
    const source = await this.getTestById(id, requestingUser, accessContext, {
      ...options,
      includeQuestionStatus: false
    });
    if (!source) throw new Error('Test not found or inaccessible.');
    const status = String(source.status || '').toLowerCase();
    if (status === 'draft') {
      throw new Error('Draft tests cannot be revised. Edit the draft directly.');
    }

    const familyRows = await pteTestVersionRepository.listByFamily(source.familyId, {
      scope: { canViewAll: true },
      backendMode: options?.backendMode
    });
    const maxRevision = (Array.isArray(familyRows) ? familyRows : [])
      .reduce((max, row) => Math.max(max, Number(row?.revisionNumber || 0)), 0);

    const resolvedRefs = await resolveAndHydrateQuestionRefs(
      source.allocations || {},
      requestingUser,
      accessContext,
      {
        ...options,
        existingRefMap: toQuestionRefMap(source.allocations || {})
      }
    );
    if (resolvedRefs.errors.length) {
      throw new Error(`Cannot revise test: ${resolvedRefs.errors.join(' ')}`);
    }

    const creator = activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, source.orgId)
      || activityQuotaLedgerService.createSystemCreatorSnapshot(source.orgId);

    const created = await pteTestVersionRepository.create({
      orgId: source.orgId,
      familyId: source.familyId,
      parentVersionId: source.id,
      revisionNumber: maxRevision + 1,
      isLatestRevision: true,
      status: 'draft',
      code: source.code || '',
      title: source.title || '',
      description: source.description || '',
      instructions: source.instructions || '',
      tags: Array.isArray(source.tags) ? source.tags : [],
      allocations: resolvedRefs.allocations,
      validation: buildValidationSnapshot([], resolvedRefs.warnings, requestingUser),
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

  async archiveTest(id, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getTestById(id, requestingUser, accessContext, {
      ...options,
      includeQuestionStatus: false
    });
    if (!existing) throw new Error('Test not found or inaccessible.');
    if (String(existing.status || '').toLowerCase() === 'archived') {
      return existing;
    }

    const creator = isPlainObject(existing.creator)
      ? existing.creator
      : (activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, existing.orgId)
        || activityQuotaLedgerService.createSystemCreatorSnapshot(existing.orgId));
    const audit = buildAuditFromCreator(creator, existing.audit || {}, { isUpdate: true });
    const wasPublished = String(existing.status || '').toLowerCase() === 'published';
    const questionIds = getQuestionIdsFromAllocations(existing.allocations || {});

    const updated = await pteTestVersionRepository.update(existing.id, {
      status: 'archived',
      publishingMeta: buildPublishingMetaForStatus(existing.publishingMeta || {}, 'archived', requestingUser),
      creator,
      audit
    }, {
      backendMode: options?.backendMode
    });

    if (wasPublished) {
      await applyQuestionUsageDelta(questionIds, -1, options);
    }
    return toSummaryRow(updated);
  },

  async deleteTest(id, requestingUser, accessContext = {}, options = {}) {
    const existing = await this.getTestById(id, requestingUser, accessContext, {
      ...options,
      includeQuestionStatus: false
    });
    if (!existing) throw new Error('Test not found or inaccessible.');
    if (String(existing.status || '').toLowerCase() !== 'draft') {
      throw new Error('Only draft tests can be deleted.');
    }

    const usage = buildDefaultUsageMeta(existing.usageMeta || {});
    if ((usage.assignmentsCount + usage.attemptsCount) > 0) {
      throw new Error('Draft test has usage references and cannot be deleted.');
    }

    const result = await pteTestVersionRepository.remove(existing.id, {
      backendMode: options?.backendMode
    });

    if (existing.familyId && existing.isLatestRevision) {
      await promoteLatestRevisionAfterDelete(existing.familyId, options);
    }
    return result === true || Number(result?.deletedCount || 0) > 0;
  },

  async listFamilyRevisions(familyId, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const token = toPublicId(familyId);
    if (!token) return [];
    const rows = await pteTestVersionRepository.listByFamily(token, {
      scope: buildRepositoryScope(visibility),
      sort: { revisionNumber: -1, 'audit.createDateTime': -1 },
      backendMode: options?.backendMode
    });
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => isVisibleTestRow(row, visibility))
      .map((row) => toSummaryRow(row));
  },

  async listPublishedQuestionPicker(query = {}, requestingUser, accessContext = {}, options = {}) {
    await this.resolveReadVisibility(requestingUser, accessContext);
    const normalized = normalizeQueryOptions(stripPaginationFromQuery(query || {}));
    const skillToken = normalizeSkill(normalized.skill);
    const questionQuery = {
      ...normalized,
      status__eq: 'published'
    };
    if (skillToken) questionQuery.skill__eq = skillToken;

    const questionResult = await pteQuestionBankDataService.listQuestions(
      questionQuery,
      requestingUser,
      accessContext,
      {
        ...options,
        paginated: options?.paginated === true,
        pagination: options?.pagination || null
      }
    );
    const rows = Array.isArray(questionResult?.rows)
      ? questionResult.rows
      : (Array.isArray(questionResult) ? questionResult : []);

    const mappedRows = (Array.isArray(rows) ? rows : []).map((row) => ({
      id: row.id,
      familyId: row.familyId,
      revisionNumber: Number(row.revisionNumber || 0),
      code: row.code || '',
      title: row.title || '',
      skill: row.skill || '',
      questionType: row.questionType || '',
      status: row.status || '',
      difficulty: row.difficulty || '',
      tags: Array.isArray(row.tags) ? row.tags : []
    }));

    if (options?.paginated === true) {
      return {
        rows: mappedRows,
        pagination: questionResult?.pagination || buildPaginationMeta(mappedRows.length, 1, mappedRows.length || 1)
      };
    }

    return mappedRows;
  }
};

module.exports = pteTestDataService;
