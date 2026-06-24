const fs = require('fs/promises');
const path = require('path');
const pteAttemptSessionRepository = require('../../repositories/pteAttemptSessionRepository');
const pteAttemptItemRepository = require('../../repositories/pteAttemptItemRepository');
const pteAttemptLedgerEventRepository = require('../../repositories/pteAttemptLedgerEventRepository');
const pteAttemptArtifactRepository = require('../../repositories/pteAttemptArtifactRepository');
const pteTestVersionRepository = require('../../repositories/pteTestVersionRepository');
const pteQuestionVersionRepository = require('../../repositories/pteQuestionVersionRepository');
const pteApplicantRepository = require('../../repositories/pteApplicantRepository');
const {
  adminChekersService,
  dataService,
  coreFilesService,
  isRailwayProxyMode,
  activityQuotaLedgerService,
  consumptionDefinitionPolicyService,
  resolveEntity
} = require('./pteCoreContracts');
const pteUploadPathUtils = require('../../utils/pteUploadPathUtils');
const { toPublicId, idsEqual } = require('../../utils/idAdapter');
const { applyGenericFilter } = require('../../utils/queryEngine');
const pteQuestionScoringProfileService = require('./pteQuestionScoringProfileService');
const attemptLifecycleAnalytics = require('./pteAttemptLifecycleAnalytics');
const pteScoringEngineService = require('./pteScoringEngineService');
const pteAiProviderDataService = require('./pteAiProviderDataService');
const pteAiProviderService = require('./ai/aiProviderService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

const ORGANIZATION_SCOPE_NAMES = new Set(['ADMIN', 'GLOBAL', 'ORGANIZATION', 'ORG']);
const FEEDBACK_ORGANIZATION_SCOPE_NAMES = new Set(['ADMIN', 'GLOBAL', 'ORGANIZATION', 'ORG', 'DIVISION']);
const ATTEMPT_TYPES = Object.freeze(['test_run', 'single_question_practice', 'skill_practice_run']);
const SKILLS = Object.freeze(['speaking', 'writing', 'reading', 'listening']);
const SELF_DIFFICULTY_VALUES = Object.freeze(['very_easy', 'easy', 'medium', 'hard', 'very_hard']);
const PRACTICE_FEEDBACK_SEARCH_FIELDS = Object.freeze([
  'id',
  'practiceName',
  'userId',
  'userLabel',
  'status',
  'practiceSkill',
  'startedAt',
  'finishedAt'
]);
const ITEM_STATUSES = Object.freeze([
  'pending',
  'in_progress',
  'saved',
  'submitted',
  'auto_submitted',
  'scored',
  'feedback_provided',
  'abandoned'
]);
const FINAL_ITEM_STATUSES = new Set(['submitted', 'auto_submitted', 'scored', 'feedback_provided']);
const SESSION_STATUSES = new Set(['in_progress', 'submitted', 'finished', 'abandoned']);
const ACTIVE_SESSION_STATUS = 'in_progress';
const FINAL_SESSION_STATUSES = new Set(['submitted', 'finished', 'abandoned']);
const EVENT_TYPES = Object.freeze([
  'attempt_started',
  'question_started',
  'response_saved',
  'question_skipped',
  'question_submitted',
  'question_auto_submitted',
  'score_recorded',
  'score_updated',
  'feedback_added',
  'feedback_updated',
  'difficulty_rated',
  'attempt_submitted',
  'attempt_finished',
  'attempt_abandoned'
]);
const ATTEMPT_LEDGER_APPEND_ONLY = true;
const PRACTICE_QUOTA_SECTION_CANDIDATES = Object.freeze([
  SECTIONS.PTE_PRACTICE_BY_SKILLS,
  SECTIONS.PTE_PRACTICE,
  SECTIONS.PTE
]);
const PRACTICE_QUOTA_SECTION_ID = SECTIONS.PTE_PRACTICE_BY_SKILLS;
const PRACTICE_SCORING_QUOTA_EVENT_TYPE = 'practice_item_scored';
const PRACTICE_SCORING_TOKEN_QUOTA_EVENT_TYPE = 'practice_item_scoring_tokens_consumed';
const MAX_PTE_SKILL_PRACTICE_QUESTIONS = 15;
const MAX_PTE_SKILL_PRACTICE_NAME_LENGTH = 120;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 4000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const text = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function cleanNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return Number(fallback || 0);
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) throw new Error('Invalid numeric value.');
  return Number(numeric.toFixed(6));
}

function cleanNonNegativeInteger(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return Number(fallback || 0);
  const numeric = Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric) || numeric < 0) {
    throw new Error('Integer fields must be zero or positive integers.');
  }
  return numeric;
}

function sanitizePracticeName(value, { required = false } = {}) {
  const token = cleanString(value, { max: MAX_PTE_SKILL_PRACTICE_NAME_LENGTH, allowEmpty: true }) || '';
  if (required && !token) {
    throw new Error('practiceName is required for skill_practice_run.');
  }
  return token;
}

function parseNonNegativeIntOrFallback(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 0) {
    return Math.max(0, Number.parseInt(String(fallback || 0), 10) || 0);
  }
  return parsed;
}

function normalizeAttemptType(value, fallback = '') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  if (ATTEMPT_TYPES.includes(token)) return token;
  if (ATTEMPT_TYPES.includes(fallback)) return fallback;
  return '';
}

function normalizeSkill(value, fallback = '') {
  const token = cleanString(value, { max: 30, allowEmpty: true }).toLowerCase();
  if (SKILLS.includes(token)) return token;
  if (SKILLS.includes(fallback)) return fallback;
  return '';
}

function normalizeSelfDifficulty(value, fallback = '') {
  const token = cleanString(value, { max: 30, allowEmpty: true }).toLowerCase();
  if (SELF_DIFFICULTY_VALUES.includes(token)) return token;
  if (SELF_DIFFICULTY_VALUES.includes(fallback)) return fallback;
  return '';
}

function normalizeViewInstanceId(value, fallback = '') {
  const token = cleanString(value, { max: 200, allowEmpty: true }) || '';
  if (token) return token;
  const fallbackToken = cleanString(fallback, { max: 200, allowEmpty: true }) || '';
  return fallbackToken;
}

function normalizeSessionStatus(value, fallback = ACTIVE_SESSION_STATUS) {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  if (SESSION_STATUSES.has(token)) return token;
  return SESSION_STATUSES.has(fallback) ? fallback : ACTIVE_SESSION_STATUS;
}

function isAttemptSessionActive(value) {
  return normalizeSessionStatus(value, ACTIVE_SESSION_STATUS) === ACTIVE_SESSION_STATUS;
}

function buildPracticeSectionIdentifierSet() {
  const out = new Set();
  PRACTICE_QUOTA_SECTION_CANDIDATES.forEach((token) => {
    const value = cleanString(token, { max: 160, allowEmpty: true }) || '';
    if (value) out.add(value.toUpperCase());
  });
  return out;
}

async function resolvePracticeQuotaAdminAuthority(requestingUser, operationId = OPERATIONS.CREATE) {
  const orgId = toPublicId(
    requestingUser?.activeOrgId
    || requestingUser?.primaryOrgId
    || requestingUser?.orgId
    || ''
  );
  const operation = cleanString(operationId, { max: 120, allowEmpty: true }) || OPERATIONS.CREATE;

  for (const sectionId of PRACTICE_QUOTA_SECTION_CANDIDATES) {
    // eslint-disable-next-line no-await-in-loop
    const isRequestAdmin = await adminChekersService.isAdminForRequestAsync(
      requestingUser,
      sectionId,
      operation,
      {
        orgId,
        section: {
          id: sectionId,
          category: 'PTE'
        }
      }
    );
    if (!isRequestAdmin) continue;
    const authority = await adminChekersService.resolveAdminAuthorityAsync({
      user: requestingUser,
      sectionId,
      operationId: operation,
      orgId,
      section: {
        id: sectionId,
        category: 'PTE'
      }
    });
    if (authority?.isRequestAdmin) return authority;
  }

  return null;
}

function isPracticeQuotaAdminContext(accessContext = {}) {
  const adminContext = isPlainObject(accessContext?.adminContext) ? accessContext.adminContext : null;
  if (!adminContext?.isRequestAdmin) return false;
  if (adminContext.isSuperAdmin || adminContext.isSystemAdmin) return true;

  const category = cleanString(adminContext.category, { max: 80, allowEmpty: true }).toUpperCase();
  if (category === 'PTE') return true;

  const contextSectionId = cleanString(adminContext.sectionId, { max: 160, allowEmpty: true }) || '';
  if (!contextSectionId) return false;
  return buildPracticeSectionIdentifierSet().has(contextSectionId.toUpperCase());
}

async function shouldBypassPracticeQuotaForUser(requestingUser, operationId = OPERATIONS.CREATE, accessContext = {}) {
  if (!requestingUser || typeof requestingUser !== 'object') return false;
  if (isPracticeQuotaAdminContext(accessContext)) return true;

  const practiceAuthority = await resolvePracticeQuotaAdminAuthority(requestingUser, operationId);
  return Boolean(practiceAuthority?.isRequestAdmin);
}

function normalizeIso(value, { allowEmpty = true } = {}) {
  if (value === undefined || value === null || value === '') return allowEmpty ? '' : null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid datetime value.');
  return parsed.toISOString();
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

function resolveActiveOrgId(requestingUser) {
  return toPublicId(requestingUser?.activeOrgId || requestingUser?.primaryOrgId) || '';
}

function resolveRequesterUserId(requestingUser) {
  return toPublicId(requestingUser?.id || '') || '';
}

function isPteSectionAdminSync(requestingUser, sectionId, operationId = OPERATIONS.READ_ALL) {
  return adminChekersService.isAdminForRequest(requestingUser, sectionId, operationId, {
    orgId: resolveActiveOrgId(requestingUser),
    section: { id: sectionId, category: 'PTE' }
  });
}

async function isPteSectionAdmin(requestingUser, sectionId, operationId = OPERATIONS.READ_ALL) {
  return adminChekersService.isAdminForRequestAsync(requestingUser, sectionId, operationId, {
    orgId: resolveActiveOrgId(requestingUser),
    section: { id: sectionId, category: 'PTE' }
  });
}

function canSelectPracticeStudent(requestingUser) {
  return isPteSectionAdminSync(requestingUser, SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.READ_ALL);
}

const FRIENDLY_AI_PROVIDER_INACTIVE_MESSAGE = 'The assigned API Key for scoring is not active';

function canViewDetailedAiScoringProviderErrors(requestingUser) {
  return isPteSectionAdminSync(requestingUser, SECTIONS.PTE_SCORING, OPERATIONS.READ_ALL);
}

function normalizeBooleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const token = String(value).trim().toLowerCase();
  if (!token) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function hasExplicitAdminSignalOnUser(requestingUser) {
  return normalizeBooleanFlag(requestingUser?.isVirtualSuperAdmin, false)
    || normalizeBooleanFlag(requestingUser?.isSuperAdmin, false)
    || normalizeBooleanFlag(requestingUser?.isSystemAdmin, false)
    || normalizeBooleanFlag(requestingUser?.isAdmin, false);
}

function hasResolvableAdminHintsOnUser(requestingUser) {
  if (!isPlainObject(requestingUser)) return false;
  if (isPlainObject(requestingUser.activeProfile)) return true;
  if (isPlainObject(requestingUser.activePolicy)) return true;
  if (isPlainObject(requestingUser.activeOrgPolicy)) return true;
  if (Array.isArray(requestingUser.accessProfileIds) && requestingUser.accessProfileIds.length) return true;
  if (cleanString(requestingUser.systemAccessProfileId, { max: 120, allowEmpty: true })) return true;
  return false;
}

async function canRequesterRescoreSameRevision(requestingUser, accessContext = {}) {
  if (hasExplicitAdminSignalOnUser(requestingUser)) return true;
  if (isPteSectionAdminSync(requestingUser, SECTIONS.PTE_PRACTICE_BY_SKILLS, OPERATIONS.AI_SCORING)) {
    return true;
  }
  if (isPracticeQuotaAdminContext(accessContext)) return true;
  if (!hasResolvableAdminHintsOnUser(requestingUser)) return false;
  const authority = await resolvePracticeQuotaAdminAuthority(requestingUser, OPERATIONS.AI_SCORING);
  return Boolean(authority?.isRequestAdmin);
}

function resolveRequestedResponseRevision(item = {}, payload = {}) {
  const itemMetadata = isPlainObject(item?.metadata) ? item.metadata : {};
  return cleanNonNegativeInteger(
    payload?.responseRevision,
    cleanNonNegativeInteger(itemMetadata.responseRevision, 0)
  );
}

function hasStoredScoredResultForRevision(item = {}, responseRevision = 0) {
  const itemMetadata = isPlainObject(item?.metadata) ? item.metadata : {};
  const scoringMetadata = isPlainObject(itemMetadata.scoring) ? itemMetadata.scoring : {};
  const scoringStatus = cleanString(scoringMetadata.status, { max: 40, allowEmpty: true }).toLowerCase();
  if (scoringStatus && scoringStatus !== 'scored' && scoringStatus !== 'feedback_provided') return false;

  const itemStatus = cleanString(item?.status, { max: 40, allowEmpty: true }).toLowerCase();
  const hasStoredScore = cleanNonNegativeInteger(item?.scoreRevisionCount, 0) > 0
    || itemStatus === 'scored'
    || itemStatus === 'feedback_provided';
  if (!hasStoredScore) return false;

  const itemRevision = cleanNonNegativeInteger(itemMetadata.responseRevision, 0);
  const scoringRevision = cleanNonNegativeInteger(scoringMetadata.responseRevision, itemRevision);
  if (responseRevision > 0) return scoringRevision === responseRevision;
  if (itemRevision > 0) return scoringRevision === itemRevision;
  return true;
}

function buildReusedAutoScoringResult(item = {}, responseRevision = 0) {
  const metadata = isPlainObject(item?.metadata) ? item.metadata : {};
  const scoring = isPlainObject(metadata.scoring) ? metadata.scoring : {};
  return {
    status: 'scored',
    reason: 'score_reused_for_current_response_revision',
    reused: true,
    result: {
      status: 'scored',
      reused: true,
      metadata: scoring,
      warnings: Array.isArray(scoring?.warnings) ? scoring.warnings : []
    },
    item,
    responseRevision
  };
}

function isAiProviderConfigurationWarning(value) {
  const token = cleanString(value, { max: 2000, allowEmpty: true }).toLowerCase();
  if (!token) return false;
  return token.includes('pte ai scoring provider')
    || token.includes('pte ai provider')
    || token.includes('ai provider key')
    || token.includes('api provider key')
    || token.includes('no active pte ai provider')
    || token.includes('no active ai provider')
    || token.includes('active default pte ai provider')
    || token.includes('default provider was used')
    || token.includes('/pte/ai-assisst/api-providers')
    || token.includes('/pte/ai-assist/api-providers');
}

function sanitizeScoringWarningsForRequester(warnings = [], requestingUser) {
  const rows = Array.isArray(warnings) ? warnings : [];
  if (canViewDetailedAiScoringProviderErrors(requestingUser)) return rows;
  if (!rows.some(isAiProviderConfigurationWarning)) return rows;
  return [FRIENDLY_AI_PROVIDER_INACTIVE_MESSAGE];
}

function sanitizeScoringResultForRequester(scoreResult, requestingUser) {
  if (!scoreResult || canViewDetailedAiScoringProviderErrors(requestingUser)) return scoreResult;

  const metadata = isPlainObject(scoreResult.metadata) ? scoreResult.metadata : {};
  const warnings = [
    ...(Array.isArray(scoreResult.warnings) ? scoreResult.warnings : []),
    ...(Array.isArray(metadata.warnings) ? metadata.warnings : [])
  ];

  if (!warnings.some(isAiProviderConfigurationWarning)) return scoreResult;

  return {
    ...scoreResult,
    warnings: [FRIENDLY_AI_PROVIDER_INACTIVE_MESSAGE],
    metadata: {
      ...metadata,
      warnings: [FRIENDLY_AI_PROVIDER_INACTIVE_MESSAGE]
    }
  };
}

async function resolveVisibility(requestingUser, accessContext = {}, options = {}) {
  const activeOrgId = resolveActiveOrgId(requestingUser);
  const requesterUserId = resolveRequesterUserId(requestingUser);
  const orgScopeNames = options?.treatDivisionAsOrg ? FEEDBACK_ORGANIZATION_SCOPE_NAMES : ORGANIZATION_SCOPE_NAMES;

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

  if (await isPteSectionAdmin(requestingUser, SECTIONS.PTE_ATTEMPT_LEDGER)) {
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

  if (orgScopeNames.has(scopeName)) {
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

function isCreatorVisibleRow(row, visibility) {
  if (!row) return false;
  if (visibility.mode === 'all') return true;
  if (!idsEqual(row?.orgId, visibility.activeOrgId)) return false;
  if (visibility.mode === 'org') return true;
  const creatorUserId = toPublicId(row?.creator?.userId || row?.audit?.createUser || '');
  return creatorUserId ? idsEqual(creatorUserId, visibility.requesterUserId) : false;
}

function buildPracticeQuestionScope(visibility = {}) {
  if (!visibility || visibility.mode === 'all') return { canViewAll: true };
  return {
    canViewAll: false,
    orgId: visibility.activeOrgId
  };
}

function isPracticeQuestionVisibleRow(row, visibility) {
  if (!row) return false;
  if (visibility?.mode === 'all') return true;
  if (!visibility?.activeOrgId) return false;
  return idsEqual(row?.orgId, visibility.activeOrgId);
}

function normalizeList(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function collectUserOrgIds(user = {}) {
  const out = new Set();
  const add = (value) => {
    const id = toPublicId(value);
    if (id) out.add(id);
  };

  add(user?.orgId);
  add(user?.activeOrgId);
  add(user?.primaryOrgId);
  add(user?.creator?.orgId);

  const organizations = Array.isArray(user?.organizations) ? user.organizations : [];
  organizations.forEach((org) => {
    add(org?.orgId);
    add(org?.id);
  });

  const allowedOrgs = Array.isArray(user?.allowedOrgs) ? user.allowedOrgs : [];
  allowedOrgs.forEach((org) => {
    add(org?.orgId);
    add(org?.id);
  });

  return Array.from(out);
}

function userBelongsToOrg(user = {}, orgId = '') {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) return false;
  return collectUserOrgIds(user).some((item) => idsEqual(item, targetOrgId));
}

function canTargetUserByVisibility(userRow, visibility) {
  if (!visibility || !userRow) return false;
  if (visibility.mode === 'all') return true;
  if (visibility.mode === 'creator') {
    return idsEqual(userRow?.id, visibility.requesterUserId);
  }
  if (visibility.mode === 'org') {
    return userBelongsToOrg(userRow, visibility.activeOrgId);
  }
  return false;
}

function buildUserDisplayLabel(userRow = {}) {
  const id = toPublicId(userRow?.id || userRow?.userId || '') || '';
  const username = cleanString(userRow?.username, { max: 160, allowEmpty: true }) || '';
  const email = cleanString(userRow?.email, { max: 220, allowEmpty: true }) || '';
  const name = cleanString(
    userRow?.name
      || userRow?.displayName
      || userRow?.fullName
      || userRow?.identity?.displayName
      || '',
    { max: 220, allowEmpty: true }
  ) || '';
  const label = name || username || email || id || '-';
  if (!id) return label;
  if (label === id) return id;
  return `${label} (${id})`;
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function stripHtmlTags(value = '') {
  return String(value || '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTitleCaseFromSnake(value = '') {
  const token = cleanString(value, { max: 180, allowEmpty: true }).toLowerCase();
  if (!token) return '';
  return token
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function parseJsonSafe(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  const raw = cleanString(value, { max: 200000, allowEmpty: true }) || '';
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function collectQuestionStatementText(question = {}) {
  const out = [];
  const push = (value) => {
    const text = stripHtmlTags(value);
    if (!text) return;
    if (out.includes(text)) return;
    out.push(text);
  };

  const payload = isPlainObject(question?.payload) ? question.payload : {};
  push(question?.instructions);
  push(question?.instructionText);
  push(payload?.instructions);
  push(payload?.instruction);
  push(payload?.stem);
  push(payload?.questionText);
  push(payload?.taskText);
  push(payload?.taskBody);
  push(payload?.promptText);
  push(payload?.promptTextOrAudio);
  push(payload?.sourceText);
  push(payload?.sourcePrompt);
  push(payload?.situation);
  push(payload?.situationText);
  push(payload?.itemPrompt);
  push(payload?.passage);
  push(payload?.passageHtml);
  push(payload?.transcriptText);
  push(payload?.transcriptWithGap);
  push(payload?.transcriptWithBlanks);
  push(payload?.expectedTranscript);

  const expectedKeyPoints = Array.isArray(payload?.expectedKeyPoints)
    ? payload.expectedKeyPoints.map((row) => stripHtmlTags(row)).filter(Boolean)
    : [];
  if (expectedKeyPoints.length) {
    push(`Expected key points: ${expectedKeyPoints.join(' | ')}`);
  }

  const options = Array.isArray(payload?.options) ? payload.options : [];
  const optionRows = options
    .map((row, index) => {
      if (isPlainObject(row)) {
        const key = cleanString(row.key || row.id || row.value || `Option ${index + 1}`, { max: 80, allowEmpty: true }) || `Option ${index + 1}`;
        const text = stripHtmlTags(row.text || row.label || row.content || row.value || '');
        if (!text) return '';
        return `${key}: ${text}`;
      }
      const text = stripHtmlTags(row);
      return text ? `Option ${index + 1}: ${text}` : '';
    })
    .filter(Boolean);
  if (optionRows.length) {
    push(`Options: ${optionRows.join(' | ')}`);
  }

  return cleanString(out.join('\n'), { max: 6000, allowEmpty: true }) || '';
}

function collectResponseTextForFeedback(item = {}) {
  const metadata = isPlainObject(item?.metadata) ? item.metadata : {};
  const responsePayload = isPlainObject(metadata?.responsePayload) ? metadata.responsePayload : {};
  const out = [];
  const push = (label, value) => {
    const text = stripHtmlTags(value);
    if (!text) return;
    out.push(label ? `${label}: ${text}` : text);
  };

  push('Text', responsePayload?.text || responsePayload?.transcript);
  push('Selected single', responsePayload?.selectedSingle);
  const selectedMultiple = Array.isArray(responsePayload?.selectedMultiple)
    ? responsePayload.selectedMultiple.map((row) => cleanString(row, { max: 120, allowEmpty: true })).filter(Boolean)
    : [];
  if (selectedMultiple.length) {
    out.push(`Selected multiple: ${selectedMultiple.join(', ')}`);
  }

  const mapData = parseJsonSafe(responsePayload?.mapText, responsePayload?.mapText);
  if (Array.isArray(mapData) && mapData.length) {
    const rows = mapData.slice(0, 10).map((row, index) => {
      if (isPlainObject(row)) {
        const left = stripHtmlTags(row.left || row.leftItem || row.prompt || row.source || row.a || `Item ${index + 1}`);
        const right = stripHtmlTags(row.right || row.rightItem || row.target || row.match || row.b || '');
        return `${left} -> ${right || '-'}`;
      }
      return stripHtmlTags(row) || `Item ${index + 1}`;
    }).filter(Boolean);
    if (rows.length) out.push(`Mappings: ${rows.join(' | ')}`);
  } else if (isPlainObject(mapData)) {
    const rows = Object.entries(mapData).slice(0, 12).map(([key, value]) => {
      const left = stripHtmlTags(key);
      const right = stripHtmlTags(value);
      return left ? `${left}: ${right || '-'}` : '';
    }).filter(Boolean);
    if (rows.length) out.push(`Mappings: ${rows.join(' | ')}`);
  } else {
    push('Map', responsePayload?.mapText);
  }

  if (!out.length) {
    const summary = isPlainObject(item?.responseSummary) ? item.responseSummary : {};
    const kind = cleanString(summary?.kind, { max: 80, allowEmpty: true }) || '';
    const words = cleanNonNegativeInteger(summary?.wordCount, 0);
    if (kind || words > 0) {
      out.push(`Response summary: ${[kind, words > 0 ? `${words} words` : ''].filter(Boolean).join(', ')}`);
    }
  }

  return cleanString(out.join('\n'), { max: 6000, allowEmpty: true }) || '';
}

function collectScoringTextForFeedback(item = {}) {
  const out = [];
  const scoreFinal = parseOptionalNumber(item?.scoreFinal);
  const maxScore = parseOptionalNumber(item?.maxScore);
  const percentage = parseOptionalNumber(item?.percentage);
  if (scoreFinal !== null || maxScore !== null || percentage !== null) {
    const parts = [];
    if (scoreFinal !== null && maxScore !== null && maxScore > 0) {
      parts.push(`Score ${Number(scoreFinal).toFixed(2)}/${Number(maxScore).toFixed(2)}`);
    } else if (scoreFinal !== null) {
      parts.push(`Score ${Number(scoreFinal).toFixed(2)}`);
    }
    if (percentage !== null) {
      parts.push(`Percentage ${Number(percentage).toFixed(2)}%`);
    }
    if (parts.length) out.push(parts.join(' | '));
  }

  const traitScores = isPlainObject(item?.traitScores) ? item.traitScores : {};
  const traitRows = Object.entries(traitScores)
    .map(([key, value]) => {
      const numeric = parseOptionalNumber(value);
      if (numeric === null) return '';
      return `${toTitleCaseFromSnake(key) || key}: ${Number(numeric).toFixed(2)}`;
    })
    .filter(Boolean);
  if (traitRows.length) out.push(`Traits: ${traitRows.join(' | ')}`);

  const scoring = isPlainObject(item?.metadata?.scoring) ? item.metadata.scoring : {};
  const status = cleanString(scoring?.status, { max: 80, allowEmpty: true }) || '';
  if (status) out.push(`Scoring status: ${status.replace(/_/g, ' ')}`);
  const scoringWarnings = Array.isArray(scoring?.warnings)
    ? scoring.warnings.map((row) => stripHtmlTags(row)).filter(Boolean)
    : [];
  if (scoringWarnings.length) {
    out.push(`Scoring warnings: ${scoringWarnings.slice(0, 3).join(' | ')}`);
  }

  return cleanString(out.join('\n'), { max: 4000, allowEmpty: true }) || '';
}

function buildPracticeFeedbackItemDigest(item = {}, index = 0) {
  const question = isPlainObject(item?.question) ? item.question : {};
  const metadata = isPlainObject(item?.metadata) ? item.metadata : {};
  const questionType = cleanString(question?.questionType || item?.questionType, { max: 120, allowEmpty: true }).toLowerCase() || '';
  const skill = normalizeSkill(question?.skill || item?.skill, '') || '';
  const title = cleanString(question?.title || metadata?.questionTitle || `Question ${index + 1}`, { max: 260, allowEmpty: true }) || `Question ${index + 1}`;
  const teacherFeedback = cleanString(stripHtmlTags(item?.latestFeedback || item?.latestFeedbackText || ''), { max: 3000, allowEmpty: true }) || '';
  const statement = collectQuestionStatementText(question);
  const response = collectResponseTextForFeedback(item);
  const scoring = collectScoringTextForFeedback(item);

  return {
    index: index + 1,
    itemId: cleanString(item?.id, { max: 120, allowEmpty: true }) || '',
    title,
    questionType,
    questionTypeLabel: toTitleCaseFromSnake(questionType) || questionType || '-',
    skill,
    skillLabel: skill ? `${skill.charAt(0).toUpperCase()}${skill.slice(1)}` : '-',
    statement,
    response,
    scoring,
    teacherFeedback
  };
}

function buildPracticeDetailedFeedbackPrompt({ session = {}, userLabel = '', digests = [] } = {}) {
  const rows = Array.isArray(digests) ? digests : [];
  const questionBlocks = rows.map((row) => [
    `Question ${row.index} | Skill: ${row.skillLabel} | Type: ${row.questionTypeLabel} | ItemId: ${row.itemId || '-'}`,
    `Title: ${row.title}`,
    `Question statement: ${row.statement || 'Not available.'}`,
    `Student answer: ${row.response || 'Not available.'}`,
    `Scoring: ${row.scoring || 'Not available.'}`,
    `Teacher feedback: ${row.teacherFeedback || 'Not available.'}`
  ].join('\n'));

  return [
    'You are an experienced PTE coach.',
    'Create one detailed, student-facing feedback report using ONLY the provided evidence.',
    'Do not invent facts. If evidence is missing, state that clearly.',
    'Use clear markdown headings and concise bullets.',
    '',
    'Required sections in this exact order:',
    '1) Overall Performance Snapshot',
    '2) Strengths (evidence-based)',
    '3) Priority Improvements (evidence-based)',
    '4) Question-by-Question Coaching Notes',
    '5) 7-Day Action Plan',
    '6) Encouraging Closing Note',
    '',
    `Student: ${cleanString(userLabel, { max: 240, allowEmpty: true }) || '-'}`,
    `Session id: ${cleanString(session?.id, { max: 120, allowEmpty: true }) || '-'}`,
    `Session status: ${cleanString(session?.status, { max: 60, allowEmpty: true }) || '-'}`,
    `Questions count: ${rows.length}`,
    '',
    'Evidence:',
    questionBlocks.join('\n\n')
  ].join('\n');
}

function buildDeterministicPracticeFeedbackReport({ session = {}, userLabel = '', digests = [] } = {}) {
  const rows = Array.isArray(digests) ? digests : [];
  const scoredRows = rows
    .map((row) => {
      const raw = cleanString(row?.scoring, { max: 600, allowEmpty: true }) || '';
      const scoreMatch = raw.match(/Score\s+([0-9.]+)\s*\/\s*([0-9.]+)/i);
      const percentageMatch = raw.match(/Percentage\s+([0-9.]+)%/i);
      const percentage = percentageMatch ? Number(percentageMatch[1]) : null;
      const ratio = scoreMatch
        ? (Number(scoreMatch[2]) > 0 ? (Number(scoreMatch[1]) / Number(scoreMatch[2])) * 100 : null)
        : percentage;
      return {
        ...row,
        ratio: Number.isFinite(ratio) ? Number(ratio) : null
      };
    })
    .filter((row) => row.ratio !== null);

  const avgPercentage = scoredRows.length
    ? Number((scoredRows.reduce((sum, row) => sum + row.ratio, 0) / scoredRows.length).toFixed(2))
    : null;
  const weakest = scoredRows.slice().sort((a, b) => a.ratio - b.ratio).slice(0, 3);
  const strongest = scoredRows.slice().sort((a, b) => b.ratio - a.ratio).slice(0, 3);

  const lines = [];
  lines.push('# Detailed Practice Feedback');
  lines.push('');
  lines.push(`Student: ${cleanString(userLabel, { max: 240, allowEmpty: true }) || '-'}`);
  lines.push(`Session: ${cleanString(session?.id, { max: 120, allowEmpty: true }) || '-'}`);
  lines.push(`Questions reviewed: ${rows.length}`);
  if (avgPercentage !== null) {
    lines.push(`Average scored performance: ${avgPercentage.toFixed(2)}%`);
  }
  lines.push('');
  lines.push('## Strengths');
  if (strongest.length) {
    strongest.forEach((row) => {
      lines.push(`- Q${row.index} (${row.skillLabel} / ${row.questionTypeLabel}) performed better (${row.ratio.toFixed(2)}%).`);
    });
  } else {
    lines.push('- Scoring evidence was limited, but submitted responses were captured for review.');
  }
  lines.push('');
  lines.push('## Priority Improvements');
  if (weakest.length) {
    weakest.forEach((row) => {
      lines.push(`- Q${row.index} (${row.skillLabel} / ${row.questionTypeLabel}) needs focus (${row.ratio.toFixed(2)}%).`);
      if (row.teacherFeedback) {
        lines.push(`  Evidence: ${cleanString(row.teacherFeedback, { max: 240, allowEmpty: true })}`);
      }
    });
  } else {
    lines.push('- Add more scored attempts so improvement priorities can be measured precisely.');
  }
  lines.push('');
  lines.push('## Question-by-Question Coaching Notes');
  rows.forEach((row) => {
    lines.push(`- Q${row.index} ${row.title}`);
    lines.push(`  Type: ${row.questionTypeLabel} | Skill: ${row.skillLabel}`);
    lines.push(`  Student answer: ${row.response || 'Not available.'}`);
    lines.push(`  Scoring: ${row.scoring || 'Not available.'}`);
    lines.push(`  Teacher feedback: ${row.teacherFeedback || 'Not available.'}`);
  });
  lines.push('');
  lines.push('## 7-Day Action Plan');
  lines.push('- Day 1-2: Re-attempt the weakest question types and focus on accuracy first.');
  lines.push('- Day 3-4: Practice pacing/clarity with timed responses and review your own outputs.');
  lines.push('- Day 5-6: Mix strong and weak question types to stabilize performance under variation.');
  lines.push('- Day 7: Do one full mini-run and compare scores/feedback against today\'s baseline.');
  lines.push('');
  lines.push('## Encouraging Closing Note');
  lines.push('Your progress is trackable now. Keep practicing with deliberate focus on the weakest patterns, and your overall score should become more stable.');
  return cleanString(lines.join('\n'), { max: 80000, allowEmpty: true }) || '';
}

function toDateMs(value = '') {
  const token = cleanString(value, { max: 80, allowEmpty: true }) || '';
  if (!token) return null;
  const parsed = Date.parse(token);
  return Number.isFinite(parsed) ? parsed : null;
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizePathToken(value, fallback = '') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '');
  return cleaned || fallback;
}

function isPathInsideBase(basePath = '', candidatePath = '') {
  const base = path.resolve(String(basePath || '')).replace(/[\\/]+$/, '');
  const target = path.resolve(String(candidatePath || ''));
  if (!base || !target) return false;
  const baseLower = base.toLowerCase();
  const targetLower = target.toLowerCase();
  return targetLower === baseLower || targetLower.startsWith(`${baseLower}${path.sep.toLowerCase()}`);
}

function resolveUploadsRoot() {
  return coreFilesService.getUploadRootAbsolute();
}

function toAbsoluteUploadPath(rawPath = '', uploadsRoot = '') {
  const token = cleanString(rawPath, { max: 2000, allowEmpty: true }) || '';
  if (!token || !uploadsRoot) return '';

  const normalizedRoot = path.resolve(uploadsRoot);
  const fromUploadUrl = coreFilesService.fromUploadsUrlToDiskPath(token, normalizedRoot);
  if (fromUploadUrl && isPathInsideBase(normalizedRoot, fromUploadUrl)) {
    return fromUploadUrl;
  }

  const candidate = token.replace(/^\/+/, '');
  const withoutUploadsPrefix = candidate.replace(/^uploads[\\/]/i, '');
  const resolved = path.isAbsolute(token)
    ? path.resolve(token)
    : path.resolve(path.join(normalizedRoot, withoutUploadsPrefix));
  return isPathInsideBase(normalizedRoot, resolved) ? resolved : '';
}

function isUploadUrlLike(value = '') {
  const token = cleanString(value, { max: 2000, allowEmpty: true }) || '';
  if (!token) return false;
  const withoutHost = token.replace(/^https?:\/\/[^/]+/i, '');
  return /^\/?uploads\//i.test(withoutHost.replace(/\\/g, '/'));
}

function toUploadUrlFromRelativePath(value = '') {
  const token = cleanString(value, { max: 2000, allowEmpty: true }).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!token) return '';
  if (/^uploads\//i.test(token)) return `/${token}`;
  return `/uploads/${token}`;
}

function collectArtifactLocationValues(row = {}) {
  const source = isPlainObject(row) ? row : {};
  const metadata = isPlainObject(source.metadata) ? source.metadata : {};
  return [
    source.path,
    source.url,
    source.filePath,
    source.localPath,
    source.storagePath,
    source.uploadUrl,
    source.previewUrl,
    source.downloadUrl,
    metadata.path,
    metadata.url,
    metadata.filePath,
    metadata.localPath,
    metadata.storagePath,
    metadata.uploadUrl,
    metadata.previewUrl,
    metadata.downloadUrl,
    toUploadUrlFromRelativePath(metadata.gatewayRelativePath),
    toUploadUrlFromRelativePath(source.gatewayRelativePath)
  ].map((value) => cleanString(value, { max: 2000, allowEmpty: true }) || '').filter(Boolean);
}

async function removeRemoteUploadIfExists(uploadUrl = '') {
  const token = cleanString(uploadUrl, { max: 2000, allowEmpty: true }) || '';
  if (!token || !isUploadUrlLike(token) || !isRailwayProxyMode()) return false;
  try {
    await coreFilesService.deleteFilePaths([token]);
    return true;
  } catch (_) {
    return false;
  }
}

async function removePathIfExists(targetPath = '', { recursive = false } = {}) {
  const resolved = path.resolve(String(targetPath || ''));
  if (!resolved) return false;
  try {
    await fs.access(resolved);
  } catch (_) {
    return false;
  }
  await fs.rm(resolved, { recursive: Boolean(recursive), force: true });
  return true;
}

async function cleanupPracticeAttemptUploads(session = {}, artifacts = [], events = []) {
  const uploadsRoot = resolveUploadsRoot();
  if (!uploadsRoot) {
    return {
      uploadsRoot: '',
      removedFiles: 0,
      removedRemoteFiles: 0,
      removedDirectories: 0
    };
  }

  const filePaths = new Set();
  const remoteUploadUrls = new Set();
  const addFilePath = (value) => {
    const absolute = toAbsoluteUploadPath(value, uploadsRoot);
    if (absolute) filePaths.add(absolute);
    if (isUploadUrlLike(value)) remoteUploadUrls.add(cleanString(value, { max: 2000, allowEmpty: true }) || '');
  };

  (Array.isArray(artifacts) ? artifacts : []).forEach((artifact) => {
    collectArtifactLocationValues(artifact).forEach(addFilePath);
  });
  (Array.isArray(events) ? events : []).forEach((event) => {
    const refs = Array.isArray(event?.artifactRefs) ? event.artifactRefs : [];
    refs.forEach((row) => collectArtifactLocationValues(row).forEach(addFilePath));
  });

  let removedFiles = 0;
  for (const filePath of filePaths) {
    // eslint-disable-next-line no-await-in-loop
    const removed = await removePathIfExists(filePath);
    if (removed) removedFiles += 1;
  }

  let removedRemoteFiles = 0;
  for (const uploadUrl of remoteUploadUrls) {
    // eslint-disable-next-line no-await-in-loop
    const removed = await removeRemoteUploadIfExists(uploadUrl);
    if (removed) removedRemoteFiles += 1;
  }

  const orgId = cleanString(session?.orgId, { max: 120, allowEmpty: true }) || '';
  const userToken = sanitizePathToken(session?.userId, 'user_unsaved');
  const sessionToken = sanitizePathToken(session?.id, 'session_unsaved');
  const metadata = isPlainObject(session?.metadata) ? session.metadata : {};
  const practiceMeta = isPlainObject(metadata?.practice) ? metadata.practice : {};
  const mockMeta = isPlainObject(metadata?.mockExam) ? metadata.mockExam : {};
  const attemptType = cleanString(session?.attemptType, { max: 80, allowEmpty: true }).toLowerCase();
  const hasSmartPlan = isPlainObject(metadata?.smartPractice);
  const practiceName = pteUploadPathUtils.sanitizeFolderToken(
    practiceMeta?.name || metadata?.practiceName || '',
    'practice_unspecified'
  );
  const testName = pteUploadPathUtils.sanitizeFolderToken(
    mockMeta?.testTitle || mockMeta?.testCode || metadata?.testName || '',
    'test_unspecified'
  );

  const relativeCandidates = new Set([
    path.join(userToken, sessionToken),
    path.join('pte-attempts', userToken, sessionToken)
  ]);

  const addNewPteSessionCandidate = (bucket, nameToken) => {
    const built = pteUploadPathUtils.buildAttemptCategory({
      bucket,
      userId: userToken,
      sessionId: sessionToken,
      itemId: 'item_unsaved',
      practiceName: bucket === pteUploadPathUtils.PTE_BUCKETS.MOCK_EXAMS ? '' : nameToken,
      testName: bucket === pteUploadPathUtils.PTE_BUCKETS.MOCK_EXAMS ? nameToken : ''
    });
    if (!built) return;
    relativeCandidates.add(path.dirname(built));
  };

  if (attemptType === 'test_run') {
    addNewPteSessionCandidate(pteUploadPathUtils.PTE_BUCKETS.MOCK_EXAMS, testName);
  } else {
    addNewPteSessionCandidate(
      hasSmartPlan ? pteUploadPathUtils.PTE_BUCKETS.SMART_PRACTICE : pteUploadPathUtils.PTE_BUCKETS.PRACTICE_BY_SKILLS,
      practiceName
    );
    // Keep one additional fallback runtime bucket candidate in case of historical mismatched metadata.
    addNewPteSessionCandidate(
      hasSmartPlan ? pteUploadPathUtils.PTE_BUCKETS.PRACTICE_BY_SKILLS : pteUploadPathUtils.PTE_BUCKETS.SMART_PRACTICE,
      practiceName
    );
  }

  let removedDirectories = 0;
  const baseRoots = new Set();
  if (orgId) baseRoots.add(coreFilesService.getRootPath(orgId));
  baseRoots.add(coreFilesService.getRootPath('GLOBAL'));

  for (const baseRoot of baseRoots) {
    const normalizedBaseRoot = path.resolve(String(baseRoot || ''));
    if (!isPathInsideBase(uploadsRoot, normalizedBaseRoot)) continue;
    for (const relativePath of relativeCandidates) {
      let targetDirectory = '';
      try {
        targetDirectory = coreFilesService.resolveSafePath(normalizedBaseRoot, relativePath);
      } catch (_) {
        targetDirectory = '';
      }
      if (!targetDirectory || !isPathInsideBase(uploadsRoot, targetDirectory)) continue;
      // eslint-disable-next-line no-await-in-loop
      const removed = await removePathIfExists(targetDirectory, { recursive: true });
      if (removed) removedDirectories += 1;
    }
  }

  return {
    uploadsRoot,
    removedFiles,
    removedRemoteFiles,
    removedDirectories
  };
}

function toEventCounters(existing = {}, incrementEventType = '') {
  const out = {};
  EVENT_TYPES.forEach((eventType) => {
    out[eventType] = cleanNonNegativeInteger(existing?.[eventType], 0);
  });
  if (incrementEventType && Object.prototype.hasOwnProperty.call(out, incrementEventType)) {
    out[incrementEventType] += 1;
  }
  return out;
}

function resolveCreator(orgId, requestingUser) {
  return activityQuotaLedgerService.createUserCreatorSnapshot(requestingUser, orgId)
    || activityQuotaLedgerService.createSystemCreatorSnapshot(orgId);
}

function buildSource(inputSource = {}, { eventType = '', defaultIdPrefix = 'PTA-RUN' } = {}) {
  const source = isPlainObject(inputSource) ? inputSource : {};
  return {
    module: cleanString(source.module, { max: 80, allowEmpty: true }) || 'pte_attempt_runtime',
    eventType: cleanString(source.eventType, { max: 80, allowEmpty: true }) || eventType,
    eventId: cleanString(source.eventId, { max: 180, allowEmpty: true }) || `${defaultIdPrefix}-${Date.now()}`,
    idempotencyKey: cleanString(source.idempotencyKey, { max: 220, allowEmpty: true }) || ''
  };
}

function deepClone(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value == null ? fallback : value));
  } catch (_) {
    return fallback;
  }
}

function buildQuestionSnapshot(questionRow = {}, scoringConfig = {}) {
  if (!isPlainObject(questionRow) || !questionRow.id) return null;
  return {
    id: cleanString(questionRow.id, { max: 120, allowEmpty: true }) || '',
    orgId: cleanString(questionRow.orgId, { max: 120, allowEmpty: true }) || '',
    familyId: cleanString(questionRow.familyId, { max: 140, allowEmpty: true }) || '',
    status: cleanString(questionRow.status, { max: 80, allowEmpty: true }) || '',
    code: cleanString(questionRow.code, { max: 120, allowEmpty: true }) || '',
    title: cleanString(questionRow.title, { max: 260, allowEmpty: true }) || '',
    instructions: cleanString(questionRow.instructions, { max: 5000, allowEmpty: true }) || '',
    testType: cleanString(questionRow.testType, { max: 80, allowEmpty: true }) || '',
    skill: normalizeSkill(questionRow.skill, ''),
    questionType: cleanString(questionRow.questionType, { max: 120, allowEmpty: true }).toLowerCase() || '',
    payload: deepClone(questionRow.payload, {}),
    scoringConfig: deepClone(scoringConfig || questionRow.scoringConfig, {}),
    responseContract: deepClone(questionRow.responseContract, {}),
    mediaAssets: deepClone(questionRow.mediaAssets, []),
    snapshotAt: nowIso()
  };
}

function resolveAttemptItemQuestionSnapshot(item = {}) {
  const metadata = isPlainObject(item?.metadata) ? item.metadata : {};
  const snapshot = isPlainObject(metadata.questionSnapshot) ? metadata.questionSnapshot : null;
  if (!snapshot || !snapshot.id) return null;
  return {
    ...snapshot,
    id: cleanString(snapshot.id, { max: 120, allowEmpty: true }) || cleanString(item.questionVersionId, { max: 120, allowEmpty: true }) || '',
    questionType: cleanString(snapshot.questionType || item.questionType, { max: 120, allowEmpty: true }).toLowerCase() || '',
    skill: normalizeSkill(snapshot.skill, item.skill || ''),
    payload: isPlainObject(snapshot.payload) ? snapshot.payload : {},
    scoringConfig: isPlainObject(snapshot.scoringConfig) ? snapshot.scoringConfig : {},
    responseContract: isPlainObject(snapshot.responseContract) ? snapshot.responseContract : {},
    mediaAssets: Array.isArray(snapshot.mediaAssets) ? snapshot.mediaAssets : []
  };
}

function resolveQuestionForAttemptItem(item = {}, questionMap = new Map()) {
  const snapshot = resolveAttemptItemQuestionSnapshot(item);
  if (snapshot) return snapshot;
  const questionId = cleanString(item?.questionVersionId, { max: 120, allowEmpty: true }) || '';
  return questionMap.get(questionId) || null;
}

async function assertIdempotency(orgId, source = {}, options = {}) {
  const key = cleanString(source?.idempotencyKey, { max: 220, allowEmpty: true }) || '';
  if (!key) return;
  const duplicate = await pteAttemptLedgerEventRepository.findByIdempotencyKey(orgId, key, {
    backendMode: options?.backendMode
  });
  if (duplicate) {
    throw new Error('Duplicate idempotency key detected for this organization.');
  }
}

function flattenAllocations(allocations = {}) {
  const source = isPlainObject(allocations) ? allocations : {};
  const out = [];
  SKILLS.forEach((skill) => {
    const rows = Array.isArray(source[skill]) ? source[skill] : [];
    rows.forEach((row, index) => {
      out.push({
        questionVersionId: cleanString(row?.questionVersionId || row?.id, { max: 120, allowEmpty: true }) || '',
        questionFamilyId: cleanString(row?.questionFamilyId, { max: 140, allowEmpty: true }) || '',
        questionType: cleanString(row?.questionType, { max: 120, allowEmpty: true }).toLowerCase() || '',
        questionCode: cleanString(row?.questionCode, { max: 120, allowEmpty: true }) || '',
        questionTitle: cleanString(row?.questionTitle, { max: 260, allowEmpty: true }) || '',
        skill,
        sequenceNo: Math.max(1, cleanNonNegativeInteger(row?.sequenceNo, index + 1))
      });
    });
  });
  return out.filter((row) => row.questionVersionId);
}

async function buildQuestionItemsForRuntime(payload = {}, requestingUser, visibility, options = {}) {
  const input = isPlainObject(payload) ? payload : {};
  const attemptType = normalizeAttemptType(input.attemptType, '');
  if (!attemptType) throw new Error('attemptType is required.');
  const scoringProfileCache = new Map();

  if (attemptType === 'test_run') {
    const testVersionId = cleanString(input.testVersionId, { max: 120, allowEmpty: true }) || '';
    if (!testVersionId) throw new Error('testVersionId is required for test_run.');
    const allowPublishedTestRuntimeAccess = options?.allowPublishedTestRuntimeAccess === true
      || cleanString(input?.metadata?.mockExam?.mode, { max: 40, allowEmpty: true }).toLowerCase() === 'strict';
    const testRow = await pteTestVersionRepository.getById(testVersionId, {
      backendMode: options?.backendMode
    });
    if (!testRow) throw new Error('Test version not found.');
    if (allowPublishedTestRuntimeAccess) {
      if (!isPracticeQuestionVisibleRow(testRow, visibility)) throw new Error('Test version is not accessible.');
    } else if (!isCreatorVisibleRow(testRow, visibility)) {
      throw new Error('Test version is not accessible.');
    }
    if (String(testRow.status || '').toLowerCase() !== 'published') {
      throw new Error('Only published tests can be used for runtime attempts.');
    }

    const flattened = flattenAllocations(testRow.allocations || {});
    if (!flattened.length) throw new Error('Selected test has no runtime question allocations.');
    const byId = new Map(flattened.map((row) => [row.questionVersionId, row]));

    const selectedRows = Array.isArray(input.questionItems) ? input.questionItems : [];
    const selected = selectedRows.length
      ? selectedRows.map((entry, index) => {
        const row = isPlainObject(entry) ? entry : { questionVersionId: entry };
        return {
          questionVersionId: cleanString(row.questionVersionId || row.id, { max: 120, allowEmpty: true }) || '',
          questionOrder: Math.max(1, cleanNonNegativeInteger(row.questionOrder, index + 1))
        };
      }).filter((row) => row.questionVersionId)
      : flattened.map((row, index) => ({
        questionVersionId: row.questionVersionId,
        questionOrder: Math.max(1, cleanNonNegativeInteger(row.sequenceNo, index + 1))
      }));

    const dedup = [];
    const seen = new Set();
    selected.forEach((row) => {
      if (seen.has(row.questionVersionId)) return;
      seen.add(row.questionVersionId);
      dedup.push(row);
    });

    const items = [];
    for (const entry of dedup) {
      const fromAllocation = byId.get(entry.questionVersionId);
      if (!fromAllocation) {
        throw new Error(`Question '${entry.questionVersionId}' is not allocated in selected test version.`);
      }

      // eslint-disable-next-line no-await-in-loop
      const questionRow = await pteQuestionVersionRepository.getById(entry.questionVersionId, {
        backendMode: options?.backendMode
      });
      if (!questionRow) throw new Error(`Question '${entry.questionVersionId}' was not found.`);
      if (allowPublishedTestRuntimeAccess) {
        if (!isPracticeQuestionVisibleRow(questionRow, visibility)) throw new Error(`Question '${entry.questionVersionId}' is not accessible.`);
      } else if (!isCreatorVisibleRow(questionRow, visibility)) {
        throw new Error(`Question '${entry.questionVersionId}' is not accessible.`);
      }
      if (String(questionRow.status || '').toLowerCase() !== 'published') {
        throw new Error(`Question '${entry.questionVersionId}' is not published.`);
      }
      // eslint-disable-next-line no-await-in-loop
      const scoringState = await pteQuestionScoringProfileService.resolveQuestionScoring(questionRow, {
        backendMode: options?.backendMode,
        cacheMap: scoringProfileCache
      });

      items.push({
        questionVersionId: questionRow.id,
        questionFamilyId: cleanString(questionRow.familyId, { max: 140, allowEmpty: true }) || fromAllocation.questionFamilyId || '',
        questionType: cleanString(questionRow.questionType, { max: 120, allowEmpty: true }).toLowerCase() || fromAllocation.questionType,
        skill: normalizeSkill(questionRow.skill, fromAllocation.skill),
        questionOrder: entry.questionOrder,
        maxScore: cleanNumber(scoringState?.effectiveScoringConfig?.maxScore, 0),
        scoringProfileVersion: cleanNonNegativeInteger(scoringState?.profileVersion, 1),
        questionCode: cleanString(questionRow?.code, { max: 120, allowEmpty: true }) || fromAllocation.questionCode || '',
        questionTitle: cleanString(questionRow?.title, { max: 260, allowEmpty: true }) || fromAllocation.questionTitle || '',
        scoringConfig: deepClone(scoringState?.effectiveScoringConfig || questionRow.scoringConfig, {}),
        questionSnapshot: buildQuestionSnapshot(questionRow, scoringState?.effectiveScoringConfig || questionRow.scoringConfig || {})
      });
    }

    items.sort((a, b) => a.questionOrder - b.questionOrder);
    return {
      attemptType,
      testVersionId: testRow.id,
      testFamilyId: cleanString(testRow.familyId, { max: 140, allowEmpty: true }) || '',
      items,
      metadata: isPlainObject(input.metadata) ? deepClone(input.metadata, {}) : {}
    };
  }

  if (attemptType === 'skill_practice_run') {
    const practiceName = sanitizePracticeName(input.practiceName, { required: true });
    const pickRandomRows = (rows = [], count = 0) => {
      const pool = Array.isArray(rows) ? rows.slice() : [];
      const targetCount = Math.max(0, Math.min(cleanNonNegativeInteger(count, 0), pool.length));
      for (let i = 0; i < targetCount; i += 1) {
        const j = i + Math.floor(Math.random() * (pool.length - i));
        const temp = pool[i];
        pool[i] = pool[j];
        pool[j] = temp;
      }
      return pool.slice(0, targetCount);
    };
    const explicitSmartSelections = normalizeList(input.selectedQuestions || input.smartSelectedQuestions)
      .map((entry, index) => {
        const row = isPlainObject(entry) ? entry : { questionVersionId: entry };
        return {
          questionVersionId: cleanString(row.questionVersionId || row.id, { max: 120, allowEmpty: true }) || '',
          questionOrder: Math.max(1, cleanNonNegativeInteger(row.questionOrder, index + 1) || index + 1),
          reason: cleanString(row.reason, { max: 500, allowEmpty: true }) || '',
          targetDifficulty: cleanString(row.targetDifficulty || row.difficulty, { max: 40, allowEmpty: true }).toLowerCase() || ''
        };
      })
      .filter((row) => row.questionVersionId);

    if (explicitSmartSelections.length) {
      const dedupedSelections = [];
      const selectedExplicitIds = new Set();
      explicitSmartSelections.forEach((row) => {
        if (selectedExplicitIds.has(row.questionVersionId)) return;
        selectedExplicitIds.add(row.questionVersionId);
        dedupedSelections.push(row);
      });
      if (dedupedSelections.length > MAX_PTE_SKILL_PRACTICE_QUESTIONS) {
        throw new Error(`A skill practice attempt can include at most ${MAX_PTE_SKILL_PRACTICE_QUESTIONS} questions.`);
      }

      const items = [];
      for (const selection of dedupedSelections) {
        // eslint-disable-next-line no-await-in-loop
        const questionRow = await pteQuestionVersionRepository.getById(selection.questionVersionId, {
          backendMode: options?.backendMode
        });
        if (!questionRow) throw new Error(`Question '${selection.questionVersionId}' was not found.`);
        if (!isPracticeQuestionVisibleRow(questionRow, visibility)) {
          throw new Error(`Question '${selection.questionVersionId}' is not accessible.`);
        }
        if (String(questionRow.status || '').toLowerCase() !== 'published') {
          throw new Error(`Question '${selection.questionVersionId}' is not published.`);
        }
        if (questionRow.practiceEnabled === false) {
          throw new Error(`Question '${selection.questionVersionId}' is not enabled for practice.`);
        }
        // eslint-disable-next-line no-await-in-loop
        const scoringState = await pteQuestionScoringProfileService.resolveQuestionScoring(questionRow, {
          backendMode: options?.backendMode,
          cacheMap: scoringProfileCache
        });
        items.push({
          questionVersionId: questionRow.id,
          questionFamilyId: cleanString(questionRow.familyId, { max: 140, allowEmpty: true }) || '',
          questionType: cleanString(questionRow.questionType, { max: 120, allowEmpty: true }).toLowerCase(),
          skill: normalizeSkill(questionRow.skill, ''),
          questionOrder: selection.questionOrder,
          maxScore: cleanNumber(scoringState?.effectiveScoringConfig?.maxScore, 0),
          scoringProfileVersion: cleanNonNegativeInteger(scoringState?.profileVersion, 1),
          questionCode: cleanString(questionRow?.code, { max: 120, allowEmpty: true }) || '',
          questionTitle: cleanString(questionRow?.title, { max: 260, allowEmpty: true }) || '',
          scoringConfig: deepClone(scoringState?.effectiveScoringConfig || questionRow.scoringConfig, {}),
          questionSnapshot: buildQuestionSnapshot(questionRow, scoringState?.effectiveScoringConfig || questionRow.scoringConfig || {})
        });
      }

      if (!items.length) {
        throw new Error('No published practice-enabled questions matched the smart practice plan.');
      }

      items.sort((a, b) => a.questionOrder - b.questionOrder);
      const baseMetadata = isPlainObject(input.metadata) ? deepClone(input.metadata, {}) : {};
      const inputPractice = isPlainObject(baseMetadata.practice) ? baseMetadata.practice : {};
      const selectedSkills = Array.from(new Set(items.map((row) => row.skill).filter(Boolean)));
      const questionTypes = Array.from(new Set(items.map((row) => row.questionType).filter(Boolean))).sort((a, b) => a.localeCompare(b));
      baseMetadata.practice = {
        ...inputPractice,
        mode: cleanString(inputPractice.mode, { max: 40, allowEmpty: true }) || 'smart',
        skill: selectedSkills.length === 1 ? selectedSkills[0] : 'multi',
        selectedSkills,
        name: practiceName,
        questionTypes,
        requestedQuestionCount: cleanNonNegativeInteger(inputPractice.requestedQuestionCount, items.length) || items.length,
        selectedQuestionCount: items.length,
        poolQuestionCount: cleanNonNegativeInteger(inputPractice.poolQuestionCount, items.length) || items.length
      };

      return {
        attemptType,
        testVersionId: '',
        testFamilyId: '',
        items,
        metadata: baseMetadata
      };
    }

    const normalizedSkillPlanMap = new Map();
    const rawSkillPlans = normalizeList(input.skillPlans);
    rawSkillPlans.forEach((entry) => {
      const plan = isPlainObject(entry) ? entry : { skill: entry };
      const skillToken = normalizeSkill(plan.skill, '');
      if (!skillToken) return;

      if (!normalizedSkillPlanMap.has(skillToken)) {
        normalizedSkillPlanMap.set(skillToken, {
          skill: skillToken,
          typeCountMap: new Map()
        });
      }
      const skillBucket = normalizedSkillPlanMap.get(skillToken);

      let rawTypePlans = Array.isArray(plan.typePlans) ? plan.typePlans : [];
      if (!rawTypePlans.length) {
        const inlineQuestionTypes = normalizeList(plan.questionTypes)
          .map((value) => cleanString(value, { max: 120, allowEmpty: true }).toLowerCase())
          .filter(Boolean);
        const inlineRawCount = Math.max(1, cleanNonNegativeInteger(plan.questionCount, 1) || 1);
        if (inlineRawCount > MAX_PTE_SKILL_PRACTICE_QUESTIONS) {
          throw new Error(`Each selected question type can include at most ${MAX_PTE_SKILL_PRACTICE_QUESTIONS} questions.`);
        }
        const inlineCount = Math.max(1, Math.min(MAX_PTE_SKILL_PRACTICE_QUESTIONS, inlineRawCount));
        rawTypePlans = inlineQuestionTypes.map((questionType) => ({
          questionType,
          questionCount: inlineCount
        }));
      }

      rawTypePlans.forEach((typeEntry) => {
        const row = isPlainObject(typeEntry) ? typeEntry : { questionType: typeEntry };
        const questionType = cleanString(
          row.questionType || row.type || row.value,
          { max: 120, allowEmpty: true }
        ).toLowerCase();
        if (!questionType) return;
        const rawRequestedTypeCount = Math.max(1, cleanNonNegativeInteger(
          row.questionCount !== undefined ? row.questionCount : (row.count !== undefined ? row.count : plan.questionCount),
          1
        ) || 1);
        if (rawRequestedTypeCount > MAX_PTE_SKILL_PRACTICE_QUESTIONS) {
          throw new Error(`Each selected question type can include at most ${MAX_PTE_SKILL_PRACTICE_QUESTIONS} questions.`);
        }
        const questionCount = Math.max(1, Math.min(MAX_PTE_SKILL_PRACTICE_QUESTIONS, rawRequestedTypeCount));
        const previous = cleanNonNegativeInteger(skillBucket.typeCountMap.get(questionType), 0);
        skillBucket.typeCountMap.set(questionType, previous + questionCount);
      });
    });

    const normalizedSkillPlans = Array.from(normalizedSkillPlanMap.values())
      .map((entry) => ({
        skill: entry.skill,
        typePlans: Array.from(entry.typeCountMap.entries())
          .map(([questionType, questionCount]) => ({
            questionType,
            questionCount: Math.max(1, Math.min(MAX_PTE_SKILL_PRACTICE_QUESTIONS, cleanNonNegativeInteger(questionCount, 1) || 1))
          }))
          .filter((row) => row.questionType && row.questionCount > 0)
      }))
      .filter((entry) => entry.skill && entry.typePlans.length);

    const requestedQuestionCountFromPlan = normalizedSkillPlans.reduce((sum, skillPlan) => {
      const skillCount = Array.isArray(skillPlan?.typePlans)
        ? skillPlan.typePlans.reduce((typeSum, typePlan) => (
          typeSum + Math.max(1, cleanNonNegativeInteger(typePlan?.questionCount, 1) || 1)
        ), 0)
        : 0;
      return sum + skillCount;
    }, 0);
    if (requestedQuestionCountFromPlan > MAX_PTE_SKILL_PRACTICE_QUESTIONS) {
      throw new Error(`A skill practice attempt can include at most ${MAX_PTE_SKILL_PRACTICE_QUESTIONS} questions.`);
    }

    if (normalizedSkillPlans.length) {
      const projection = {
        id: 1,
        orgId: 1,
        familyId: 1,
        testType: 1,
        questionType: 1,
        skill: 1,
        code: 1,
        title: 1,
        instructions: 1,
        status: 1,
        practiceEnabled: 1,
        creator: 1,
        audit: 1,
        payload: 1,
        scoringConfig: 1,
        scoringConfigMode: 1,
        useQuestionScoringOverride: 1,
        responseContract: 1,
        mediaAssets: 1
      };
      const scope = buildPracticeQuestionScope(visibility);
      const selectedIds = new Set();
      const items = [];
      const metadataSkillPlans = [];
      const metadataTypeSet = new Set();
      let requestedQuestionCountTotal = 0;
      let selectedQuestionCountTotal = 0;
      let poolQuestionCountTotal = 0;

      for (const skillPlan of normalizedSkillPlans) {
        const questionTypes = Array.from(new Set(
          skillPlan.typePlans
            .map((row) => cleanString(row.questionType, { max: 120, allowEmpty: true }).toLowerCase())
            .filter(Boolean)
        ));

        const query = {
          status__eq: 'published',
          skill__eq: skillPlan.skill
        };
        if (visibility?.activeOrgId) {
          query.orgId__eq = visibility.activeOrgId;
        }
        if (questionTypes.length) {
          query.questionType__in = questionTypes.join(',');
        }

        // eslint-disable-next-line no-await-in-loop
        const rowsRaw = await pteQuestionVersionRepository.list({
          query,
          scope,
          sort: { id: -1 },
          projection,
          backendMode: options?.backendMode
        });

        const pool = (Array.isArray(rowsRaw) ? rowsRaw : [])
          .filter((row) => isPracticeQuestionVisibleRow(row, visibility))
          .filter((row) => String(row?.status || '').toLowerCase() === 'published')
          .filter((row) => row?.practiceEnabled !== false);

        const byQuestionType = new Map();
        pool.forEach((row) => {
          const typeToken = cleanString(row?.questionType, { max: 120, allowEmpty: true }).toLowerCase();
          if (!typeToken) return;
          if (!byQuestionType.has(typeToken)) byQuestionType.set(typeToken, []);
          byQuestionType.get(typeToken).push(row);
        });

        poolQuestionCountTotal += pool.length;
        const typeSummaries = [];
        let skillRequestedCount = 0;
        let skillSelectedCount = 0;

        for (const typePlan of skillPlan.typePlans) {
          const questionType = cleanString(typePlan.questionType, { max: 120, allowEmpty: true }).toLowerCase();
          if (!questionType) continue;
          const requestedCount = Math.max(1, Math.min(MAX_PTE_SKILL_PRACTICE_QUESTIONS, cleanNonNegativeInteger(typePlan.questionCount, 1) || 1));
          const typePool = Array.isArray(byQuestionType.get(questionType)) ? byQuestionType.get(questionType) : [];
          const pickedRows = pickRandomRows(typePool, requestedCount);

          let selectedForType = 0;
          for (const questionRow of pickedRows) {
            const questionVersionId = cleanString(questionRow?.id, { max: 120, allowEmpty: true }) || '';
            if (!questionVersionId || selectedIds.has(questionVersionId)) continue;
            selectedIds.add(questionVersionId);
            // eslint-disable-next-line no-await-in-loop
            const scoringState = await pteQuestionScoringProfileService.resolveQuestionScoring(questionRow, {
              backendMode: options?.backendMode,
              cacheMap: scoringProfileCache
            });
            selectedForType += 1;
            items.push({
              questionVersionId,
              questionFamilyId: cleanString(questionRow.familyId, { max: 140, allowEmpty: true }) || '',
              questionType: cleanString(questionRow.questionType, { max: 120, allowEmpty: true }).toLowerCase(),
              skill: normalizeSkill(questionRow.skill, skillPlan.skill),
              questionOrder: items.length + 1,
              maxScore: cleanNumber(scoringState?.effectiveScoringConfig?.maxScore, 0),
              scoringProfileVersion: cleanNonNegativeInteger(scoringState?.profileVersion, 1),
              questionCode: cleanString(questionRow?.code, { max: 120, allowEmpty: true }) || '',
              questionTitle: cleanString(questionRow?.title, { max: 260, allowEmpty: true }) || '',
              scoringConfig: deepClone(scoringState?.effectiveScoringConfig || questionRow.scoringConfig, {}),
              questionSnapshot: buildQuestionSnapshot(questionRow, scoringState?.effectiveScoringConfig || questionRow.scoringConfig || {})
            });
          }

          metadataTypeSet.add(questionType);
          requestedQuestionCountTotal += requestedCount;
          selectedQuestionCountTotal += selectedForType;
          skillRequestedCount += requestedCount;
          skillSelectedCount += selectedForType;
          typeSummaries.push({
            questionType,
            requestedQuestionCount: requestedCount,
            selectedQuestionCount: selectedForType,
            poolQuestionCount: typePool.length
          });
        }

        metadataSkillPlans.push({
          skill: skillPlan.skill,
          requestedQuestionCount: skillRequestedCount,
          selectedQuestionCount: skillSelectedCount,
          poolQuestionCount: pool.length,
          questionTypes: typeSummaries
        });
      }

      if (!items.length) {
        throw new Error('No published practice-enabled questions matched the selected skill/type filters.');
      }

      return {
        attemptType,
        testVersionId: '',
        testFamilyId: '',
        items,
        metadata: {
          practice: {
            mode: normalizedSkillPlans.length > 1 ? 'multi_skill' : 'single_skill',
            skill: normalizedSkillPlans.length === 1 ? normalizedSkillPlans[0].skill : 'multi',
            selectedSkills: normalizedSkillPlans.map((row) => row.skill),
            name: practiceName,
            questionTypes: Array.from(metadataTypeSet).sort((a, b) => a.localeCompare(b)),
            requestedQuestionCount: requestedQuestionCountTotal,
            selectedQuestionCount: selectedQuestionCountTotal,
            poolQuestionCount: poolQuestionCountTotal,
            skillPlans: metadataSkillPlans
          }
        }
      };
    }

    const skill = normalizeSkill(input.skill, '');
    if (!skill) throw new Error('skill is required for skill_practice_run.');

    const requestedQuestionTypes = Array.from(new Set(
      normalizeList(input.questionTypes)
        .map((row) => cleanString(row, { max: 120, allowEmpty: true }).toLowerCase())
        .filter(Boolean)
    ));
    const questionTypeSet = new Set(requestedQuestionTypes);
    const requestedCountRaw = Math.max(1, cleanNonNegativeInteger(input.questionCount, 20) || 20);
    if (requestedCountRaw > MAX_PTE_SKILL_PRACTICE_QUESTIONS) {
      throw new Error(`A skill practice attempt can include at most ${MAX_PTE_SKILL_PRACTICE_QUESTIONS} questions.`);
    }
    const requestedCount = Math.max(1, Math.min(MAX_PTE_SKILL_PRACTICE_QUESTIONS, requestedCountRaw));

    const query = {
      status__eq: 'published',
      skill__eq: skill
    };
    if (visibility?.activeOrgId) {
      query.orgId__eq = visibility.activeOrgId;
    }
    if (questionTypeSet.size > 0) {
      query.questionType__in = Array.from(questionTypeSet).join(',');
    }

    const rowsRaw = await pteQuestionVersionRepository.list({
      query,
      scope: buildPracticeQuestionScope(visibility),
      sort: { id: -1 },
      projection: {
        id: 1,
        orgId: 1,
        familyId: 1,
        testType: 1,
        questionType: 1,
        skill: 1,
        code: 1,
        title: 1,
        instructions: 1,
        status: 1,
        practiceEnabled: 1,
        creator: 1,
        audit: 1,
        payload: 1,
        scoringConfig: 1,
        scoringConfigMode: 1,
        useQuestionScoringOverride: 1,
        responseContract: 1,
        mediaAssets: 1
      },
      backendMode: options?.backendMode
    });

    const pool = (Array.isArray(rowsRaw) ? rowsRaw : [])
      .filter((row) => isPracticeQuestionVisibleRow(row, visibility))
      .filter((row) => String(row?.status || '').toLowerCase() === 'published')
      .filter((row) => row?.practiceEnabled !== false);

    if (!pool.length) {
      throw new Error('No published practice-enabled questions matched the selected skill/type filters.');
    }

    const selectedRows = pickRandomRows(pool, Math.min(requestedCount, pool.length));
    const items = [];
    for (let index = 0; index < selectedRows.length; index += 1) {
      const questionRow = selectedRows[index];
      // eslint-disable-next-line no-await-in-loop
      const scoringState = await pteQuestionScoringProfileService.resolveQuestionScoring(questionRow, {
        backendMode: options?.backendMode,
        cacheMap: scoringProfileCache
      });
      items.push({
        questionVersionId: questionRow.id,
        questionFamilyId: cleanString(questionRow.familyId, { max: 140, allowEmpty: true }) || '',
        questionType: cleanString(questionRow.questionType, { max: 120, allowEmpty: true }).toLowerCase(),
        skill: normalizeSkill(questionRow.skill, skill),
        questionOrder: index + 1,
        maxScore: cleanNumber(scoringState?.effectiveScoringConfig?.maxScore, 0),
        scoringProfileVersion: cleanNonNegativeInteger(scoringState?.profileVersion, 1),
        questionCode: cleanString(questionRow?.code, { max: 120, allowEmpty: true }) || '',
        questionTitle: cleanString(questionRow?.title, { max: 260, allowEmpty: true }) || '',
        scoringConfig: deepClone(scoringState?.effectiveScoringConfig || questionRow.scoringConfig, {}),
        questionSnapshot: buildQuestionSnapshot(questionRow, scoringState?.effectiveScoringConfig || questionRow.scoringConfig || {})
      });
    }

    return {
      attemptType,
      testVersionId: '',
      testFamilyId: '',
      items,
      metadata: {
        practice: {
          mode: 'single_skill',
          skill,
          selectedSkills: [skill],
          name: practiceName,
          questionTypes: requestedQuestionTypes,
          requestedQuestionCount: requestedCount,
          selectedQuestionCount: items.length,
          poolQuestionCount: pool.length
        }
      }
    };
  }

  const questionVersionId = cleanString(input.questionVersionId, { max: 120, allowEmpty: true }) || '';
  if (!questionVersionId) {
    throw new Error('questionVersionId is required for single_question_practice.');
  }
  const questionRow = await pteQuestionVersionRepository.getById(questionVersionId, {
    backendMode: options?.backendMode
  });
  if (!questionRow) throw new Error('Question version not found.');
  if (!isCreatorVisibleRow(questionRow, visibility)) throw new Error('Question version is not accessible.');
  if (String(questionRow.status || '').toLowerCase() !== 'published') {
    throw new Error('Only published questions can be used for single_question_practice.');
  }
  const scoringState = await pteQuestionScoringProfileService.resolveQuestionScoring(questionRow, {
    backendMode: options?.backendMode,
    cacheMap: scoringProfileCache
  });

  return {
    attemptType,
    testVersionId: '',
    testFamilyId: '',
    items: [{
      questionVersionId: questionRow.id,
      questionFamilyId: cleanString(questionRow.familyId, { max: 140, allowEmpty: true }) || '',
      questionType: cleanString(questionRow.questionType, { max: 120, allowEmpty: true }).toLowerCase(),
      skill: normalizeSkill(questionRow.skill, ''),
      questionOrder: 1,
      maxScore: cleanNumber(scoringState?.effectiveScoringConfig?.maxScore, 0),
      scoringProfileVersion: cleanNonNegativeInteger(scoringState?.profileVersion, 1),
      questionCode: cleanString(questionRow?.code, { max: 120, allowEmpty: true }) || '',
      questionTitle: cleanString(questionRow?.title, { max: 260, allowEmpty: true }) || '',
      scoringConfig: deepClone(scoringState?.effectiveScoringConfig || questionRow.scoringConfig, {}),
      questionSnapshot: buildQuestionSnapshot(questionRow, scoringState?.effectiveScoringConfig || questionRow.scoringConfig || {})
    }],
    metadata: {}
  };
}

function sanitizeResponseSummary(raw = {}, existing = {}) {
  const input = isPlainObject(raw) ? raw : {};
  const prev = isPlainObject(existing) ? existing : {};
  return {
    kind: cleanString(input.kind || prev.kind, { max: 80, allowEmpty: true }) || '',
    payloadBytes: cleanNonNegativeInteger(input.payloadBytes, cleanNonNegativeInteger(prev.payloadBytes, 0)),
    textLength: cleanNonNegativeInteger(input.textLength, cleanNonNegativeInteger(prev.textLength, 0)),
    wordCount: cleanNonNegativeInteger(input.wordCount, cleanNonNegativeInteger(prev.wordCount, 0)),
    optionCount: cleanNonNegativeInteger(input.optionCount, cleanNonNegativeInteger(prev.optionCount, 0)),
    blankCount: cleanNonNegativeInteger(input.blankCount, cleanNonNegativeInteger(prev.blankCount, 0)),
    pairCount: cleanNonNegativeInteger(input.pairCount, cleanNonNegativeInteger(prev.pairCount, 0)),
    audioDurationSeconds: cleanNumber(input.audioDurationSeconds, cleanNumber(prev.audioDurationSeconds, 0)),
    artifactCount: cleanNonNegativeInteger(input.artifactCount, cleanNonNegativeInteger(prev.artifactCount, 0))
  };
}

function sanitizeCoachingHintRow(raw = {}) {
  const row = isPlainObject(raw) ? raw : {};
  return {
    level: cleanNonNegativeInteger(row.level, 0),
    text: cleanString(row.text, { max: 1200, allowEmpty: true }) || '',
    shownAt: cleanString(row.shownAt, { max: 80, allowEmpty: true }) || ''
  };
}

function sanitizeCoachingCheckRow(raw = {}) {
  const row = isPlainObject(raw) ? raw : {};
  const statusToken = cleanString(row.status, { max: 24, allowEmpty: true }).toLowerCase();
  const status = statusToken === 'pass' || statusToken === 'warn' ? statusToken : 'warn';
  return {
    id: cleanString(row.id, { max: 120, allowEmpty: true }) || '',
    label: cleanString(row.label, { max: 300, allowEmpty: true }) || '',
    status,
    detail: cleanString(row.detail, { max: 1200, allowEmpty: true }) || ''
  };
}

function sanitizeCoachingFeedbackRow(raw = {}, maxItems = 8) {
  const row = isPlainObject(raw) ? raw : {};
  const pullList = (value) => normalizeList(value)
    .map((entry) => cleanString(entry, { max: 1200, allowEmpty: true }) || '')
    .filter(Boolean)
    .slice(0, maxItems);
  return {
    questionType: cleanString(row.questionType, { max: 120, allowEmpty: true }) || '',
    whatWentWell: pullList(row.whatWentWell),
    whatToImprove: pullList(row.whatToImprove),
    tryThisNext: pullList(row.tryThisNext)
  };
}

function sanitizeCoachingPayload(raw = {}, existing = {}) {
  const input = isPlainObject(raw) ? raw : {};
  const prev = isPlainObject(existing) ? existing : {};
  const inputSelfCheck = isPlainObject(input.selfCheck) ? input.selfCheck : (isPlainObject(prev.selfCheck) ? prev.selfCheck : {});
  const prevTimestamps = isPlainObject(prev.timestamps) ? prev.timestamps : {};
  const inputTimestamps = isPlainObject(input.timestamps) ? input.timestamps : {};

  return {
    hintLevelUsed: Math.min(3, cleanNonNegativeInteger(input.hintLevelUsed, cleanNonNegativeInteger(prev.hintLevelUsed, 0))),
    hintsShown: normalizeList(input.hintsShown !== undefined ? input.hintsShown : prev.hintsShown)
      .map((row) => sanitizeCoachingHintRow(row))
      .filter((row) => row.level > 0 && row.text)
      .slice(0, 40),
    selfCheck: {
      questionType: cleanString(inputSelfCheck.questionType, { max: 120, allowEmpty: true }) || '',
      passCount: cleanNonNegativeInteger(inputSelfCheck.passCount, 0),
      warnCount: cleanNonNegativeInteger(inputSelfCheck.warnCount, 0),
      passed: inputSelfCheck.passed === true,
      checks: normalizeList(inputSelfCheck.checks)
        .map((row) => sanitizeCoachingCheckRow(row))
        .slice(0, 40)
    },
    afterSubmitFeedback: sanitizeCoachingFeedbackRow(
      input.afterSubmitFeedback !== undefined ? input.afterSubmitFeedback : prev.afterSubmitFeedback
    ),
    timestamps: {
      firstHintAt: cleanString(inputTimestamps.firstHintAt || prevTimestamps.firstHintAt, { max: 80, allowEmpty: true }) || '',
      lastHintAt: cleanString(inputTimestamps.lastHintAt || prevTimestamps.lastHintAt, { max: 80, allowEmpty: true }) || '',
      lastSelfCheckAt: cleanString(inputTimestamps.lastSelfCheckAt || prevTimestamps.lastSelfCheckAt, { max: 80, allowEmpty: true }) || '',
      lastFeedbackAt: cleanString(inputTimestamps.lastFeedbackAt || prevTimestamps.lastFeedbackAt, { max: 80, allowEmpty: true }) || ''
    }
  };
}

function sanitizeResponsePayload(raw = {}, existing = {}) {
  const input = isPlainObject(raw) ? raw : {};
  const prev = isPlainObject(existing) ? existing : {};
  const out = {
    kind: cleanString(input.kind || prev.kind, { max: 80, allowEmpty: true }) || '',
    text: cleanString(input.text || prev.text, { max: 200000, allowEmpty: true }) || '',
    mapText: cleanString(input.mapText || prev.mapText, { max: 200000, allowEmpty: true }) || '',
    selectedSingle: cleanString(input.selectedSingle || prev.selectedSingle, { max: 80, allowEmpty: true }) || '',
    selectedMultiple: normalizeList(input.selectedMultiple !== undefined ? input.selectedMultiple : prev.selectedMultiple)
      .map((value) => cleanString(value, { max: 80, allowEmpty: true }) || '')
      .filter(Boolean)
      .slice(0, 200),
    selectedTrueFalse: cleanString(input.selectedTrueFalse || prev.selectedTrueFalse, { max: 40, allowEmpty: true }).toLowerCase() || '',
    transcript: cleanString(input.transcript || prev.transcript, { max: 200000, allowEmpty: true }) || '',
    audioDurationSeconds: cleanNumber(input.audioDurationSeconds, cleanNumber(prev.audioDurationSeconds, 0)),
    artifactId: cleanString(input.artifactId || prev.artifactId, { max: 120, allowEmpty: true }) || '',
    artifactUrl: cleanString(input.artifactUrl || prev.artifactUrl, { max: 2000, allowEmpty: true }) || '',
    coaching: sanitizeCoachingPayload(
      input.coaching,
      isPlainObject(prev.coaching) ? prev.coaching : {}
    )
  };
  if (!Array.isArray(out.selectedMultiple)) out.selectedMultiple = [];
  return out;
}

async function resolvePersonApplicantContext(orgId, requestingUser, payload = {}, options = {}) {
  const out = {
    personId: cleanString(payload.personId || requestingUser?.personId || requestingUser?.linkedPersonId || '', { max: 120, allowEmpty: true }) || '',
    applicantId: cleanString(payload.applicantId || '', { max: 120, allowEmpty: true }) || ''
  };

  if (out.applicantId) {
    const row = await pteApplicantRepository.getById(out.applicantId, {
      backendMode: options?.backendMode
    });
    if (row && idsEqual(row.orgId, orgId)) {
      out.personId = out.personId || cleanString(row.personId, { max: 120, allowEmpty: true }) || '';
      return out;
    }
  }

  const userId = toPublicId(requestingUser?.id || '');
  if (!userId) return out;
  const rows = await pteApplicantRepository.list({
    query: { orgId__eq: orgId, userId__eq: userId },
    scope: { canViewAll: true },
    sort: { 'audit.createDateTime': -1 },
    backendMode: options?.backendMode
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return out;
  out.applicantId = out.applicantId || cleanString(row.id, { max: 120, allowEmpty: true }) || '';
  out.personId = out.personId || cleanString(row.personId, { max: 120, allowEmpty: true }) || '';
  return out;
}

function normalizeCollapseMode(value = '') {
  const token = cleanString(value, { max: 24, allowEmpty: true }).toLowerCase();
  if (token === 'session' || token === 'item') return token;
  return '';
}

async function findCollapsedEvent(payload = {}, collapseMode = '', options = {}) {
  const mode = normalizeCollapseMode(collapseMode);
  if (!mode) return null;

  const orgId = cleanString(payload?.orgId, { max: 120, allowEmpty: true }) || '';
  const attemptSessionId = cleanString(payload?.attemptSessionId, { max: 120, allowEmpty: true }) || '';
  const attemptItemId = mode === 'item'
    ? (cleanString(payload?.attemptItemId, { max: 120, allowEmpty: true }) || '')
    : '';

  if (!orgId || !attemptSessionId) return null;
  if (mode === 'item' && !attemptItemId) return null;

  const rows = await pteAttemptLedgerEventRepository.list({
    query: {
      orgId__eq: orgId,
      attemptSessionId__eq: attemptSessionId,
      attemptItemId__eq: attemptItemId,
      page: 1,
      limit: 1
    },
    scope: { canViewAll: true },
    sort: { eventAt: -1, id: -1 },
    backendMode: options?.backendMode
  });

  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function buildCollapsedEventMetadata(
  existingMetadata = {},
  payloadMetadata = {},
  {
    collapseMode = '',
    eventType = '',
    eventAt = '',
    isUpdate = false
  } = {}
) {
  const prev = isPlainObject(existingMetadata) ? existingMetadata : {};
  const next = isPlainObject(payloadMetadata) ? payloadMetadata : {};
  const latestEventType = cleanString(eventType, { max: 80, allowEmpty: true }).toLowerCase() || '';
  const latestEventAt = cleanString(eventAt, { max: 80, allowEmpty: true }) || nowIso();

  const firstEventType = cleanString(
    prev.firstEventType || prev.latestEventType || latestEventType,
    { max: 80, allowEmpty: true }
  ).toLowerCase();
  const firstEventAt = cleanString(
    prev.firstEventAt || prev.latestEventAt || latestEventAt,
    { max: 80, allowEmpty: true }
  ) || latestEventAt;

  const baseUpdateCount = cleanNonNegativeInteger(prev.updateCount, 0);

  return {
    ...prev,
    ...next,
    collapsedEvent: true,
    collapseMode,
    firstEventType,
    firstEventAt,
    latestEventType,
    latestEventAt,
    updateCount: isUpdate ? (baseUpdateCount + 1) : baseUpdateCount
  };
}

async function appendEvent(payload = {}, options = {}) {
  const eventType = cleanString(payload?.eventType, { max: 80, allowEmpty: true }).toLowerCase();
  const eventAt = cleanString(payload?.eventAt, { max: 80, allowEmpty: true }) || nowIso();
  const collapseMode = ATTEMPT_LEDGER_APPEND_ONLY
    ? ''
    : normalizeCollapseMode(payload?.collapseKey || options?.collapseKey || '');
  const source = buildSource(payload.source, {
    eventType,
    defaultIdPrefix: 'PTA-EVT'
  });
  await assertIdempotency(payload.orgId, source, options);

  if (!collapseMode) {
    return pteAttemptLedgerEventRepository.create({
      ...payload,
      eventAt,
      source
    }, {
      backendMode: options?.backendMode
    });
  }

  const existing = await findCollapsedEvent(payload, collapseMode, options);
  if (existing?.id) {
    const updateActor = payload?.creator?.type === 'system'
      ? 'System'
      : (payload?.creator?.userId || 'System');
    const collapsedMetadata = buildCollapsedEventMetadata(
      existing?.metadata,
      payload?.metadata,
      {
        collapseMode,
        eventType,
        eventAt,
        isUpdate: true
      }
    );

    return pteAttemptLedgerEventRepository.update(existing.id, {
      ...payload,
      eventAt,
      source,
      metadata: collapsedMetadata,
      audit: {
        lastUpdateUser: updateActor,
        lastUpdateDateTime: eventAt
      }
    }, {
      backendMode: options?.backendMode
    });
  }

  const collapsedMetadata = buildCollapsedEventMetadata(
    {},
    payload?.metadata,
    {
      collapseMode,
      eventType,
      eventAt,
      isUpdate: false
    }
  );
  return pteAttemptLedgerEventRepository.create({
    ...payload,
    eventAt,
    source,
    metadata: collapsedMetadata
  }, {
    backendMode: options?.backendMode
  });
}

function calculateTimeSpentSeconds(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) return 0;
  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(finishedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 0;
  return Math.max(0, Math.floor((endMs - startMs) / 1000));
}

function calculateSaveTimingForAttemptItem(item = {}, payload = {}, options = {}) {
  const isPracticeRun = options?.isPracticeRun === true;
  const eventAt = cleanString(options?.eventAt, { max: 80, allowEmpty: true }) || nowIso();
  const startedAt = cleanString(item?.startedAt, { max: 80, allowEmpty: true }) || eventAt;
  const lastViewStartedAt = cleanString(
    item?.metadata?.lastViewStartedAt || startedAt,
    { max: 80, allowEmpty: true }
  ) || startedAt;
  const hasSeenSeconds = Object.prototype.hasOwnProperty.call(payload || {}, 'seenSeconds');
  const seenSeconds = isPracticeRun
    ? (hasSeenSeconds
      ? cleanNonNegativeInteger(payload.seenSeconds, 0)
      : calculateTimeSpentSeconds(lastViewStartedAt, eventAt))
    : 0;

  return {
    startedAt,
    lastViewStartedAt,
    seenSeconds,
    nextTotalSeenSeconds: isPracticeRun
      ? (cleanNonNegativeInteger(item?.totalSeenSeconds, 0) + seenSeconds)
      : cleanNonNegativeInteger(item?.totalSeenSeconds, 0),
    nextTimeSpentSeconds: isPracticeRun
      ? (cleanNonNegativeInteger(item?.timeSpentSeconds, 0) + seenSeconds)
      : cleanNonNegativeInteger(item?.timeSpentSeconds, 0)
  };
}

async function recalculateSessionSummary(session, options = {}) {
  const rows = await pteAttemptItemRepository.list({
    query: { attemptSessionId__eq: session.id },
    scope: { canViewAll: true },
    sort: { questionOrder: 1, id: 1 },
    backendMode: options?.backendMode
  });
  const items = Array.isArray(rows) ? rows : [];
  const totalQuestions = items.length;
  const submittedQuestions = items.filter((row) => FINAL_ITEM_STATUSES.has(String(row?.status || '').toLowerCase())).length;
  const feedbackCount = items.filter((row) => cleanString(row?.feedbackProvidedAt, { max: 80, allowEmpty: true })).length;

  const totalScore = items.reduce((sum, row) => sum + cleanNumber(row?.scoreFinal, 0), 0);
  const maxScore = items.reduce((sum, row) => sum + cleanNumber(row?.maxScore, 0), 0);
  const percentage = maxScore > 0 ? Number(((totalScore / maxScore) * 100).toFixed(2)) : 0;

  const correctnessRows = items.filter((row) => row?.isCorrect === true || row?.isCorrect === false);
  const correctCount = correctnessRows.filter((row) => row?.isCorrect === true).length;
  const accuracyRate = correctnessRows.length
    ? Number(((correctCount / correctnessRows.length) * 100).toFixed(2))
    : 0;

  const timeRows = items.filter((row) => cleanNonNegativeInteger(row?.timeSpentSeconds, 0) > 0);
  const averageTimePerQuestionSeconds = timeRows.length
    ? Number((timeRows.reduce((sum, row) => sum + cleanNonNegativeInteger(row?.timeSpentSeconds, 0), 0) / timeRows.length).toFixed(2))
    : 0;

  const skillSummary = {};
  SKILLS.forEach((skill) => {
    const skillRows = items.filter((row) => normalizeSkill(row?.skill, '') === skill);
    const skillSubmitted = skillRows.filter((row) => FINAL_ITEM_STATUSES.has(String(row?.status || '').toLowerCase()));
    const scoredRows = skillRows.filter((row) => cleanNumber(row?.maxScore, 0) > 0 || cleanNumber(row?.scoreFinal, 0) > 0);
    const avgScore = scoredRows.length
      ? Number((scoredRows.reduce((sum, row) => sum + cleanNumber(row?.percentage, 0), 0) / scoredRows.length).toFixed(2))
      : 0;
    const timedRows = skillRows.filter((row) => cleanNonNegativeInteger(row?.timeSpentSeconds, 0) > 0);
    const avgTime = timedRows.length
      ? Number((timedRows.reduce((sum, row) => sum + cleanNonNegativeInteger(row?.timeSpentSeconds, 0), 0) / timedRows.length).toFixed(2))
      : 0;
    const latestWithScore = skillRows
      .filter((row) => cleanNumber(row?.percentage, 0) >= 0)
      .sort((a, b) => String(b?.finishedAt || b?.submittedAt || '').localeCompare(String(a?.finishedAt || a?.submittedAt || '')))[0];
    skillSummary[skill] = {
      itemCount: skillRows.length,
      submittedCount: skillSubmitted.length,
      averagePercentage: avgScore,
      averageTimeSeconds: avgTime,
      latestPercentage: latestWithScore ? cleanNumber(latestWithScore?.percentage, 0) : 0
    };
  });

  const lastQuestionFinishedAt = items
    .map((row) => cleanString(row?.finishedAt || row?.submittedAt, { max: 80, allowEmpty: true }))
    .filter(Boolean)
    .sort()
    .pop() || '';

  return {
    items,
    patch: {
      totalQuestions,
      submittedQuestions,
      feedbackCount,
      scoreRaw: totalScore,
      scoreFinal: totalScore,
      maxScore,
      percentage,
      accuracyRate,
      averageTimePerQuestionSeconds,
      lastQuestionFinishedAt,
      skillSummary
    }
  };
}

function sortItemsByQuestionOrder(items = []) {
  return (Array.isArray(items) ? items : []).slice().sort((a, b) => {
    const orderA = cleanNonNegativeInteger(a?.questionOrder, 0);
    const orderB = cleanNonNegativeInteger(b?.questionOrder, 0);
    if (orderA !== orderB) return orderA - orderB;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
}

async function getSessionByIdOrThrow(sessionId, visibility, options = {}) {
  const row = await pteAttemptSessionRepository.getById(sessionId, {
    backendMode: options?.backendMode
  });
  if (!row) throw new Error('Attempt session not found.');
  if (visibility.mode === 'all') return row;
  if (!idsEqual(row.orgId, visibility.activeOrgId)) throw new Error('Attempt session is not accessible.');
  if (visibility.mode === 'creator' && !idsEqual(row.userId, visibility.requesterUserId)) {
    throw new Error('Attempt session is not accessible.');
  }
  return row;
}

async function getItemByIdOrThrow(itemId, visibility, options = {}) {
  const row = await pteAttemptItemRepository.getById(itemId, {
    backendMode: options?.backendMode
  });
  if (!row) throw new Error('Attempt item not found.');
  if (visibility.mode === 'all') return row;
  if (!idsEqual(row.orgId, visibility.activeOrgId)) throw new Error('Attempt item is not accessible.');
  if (visibility.mode === 'creator' && !idsEqual(row.userId, visibility.requesterUserId)) {
    throw new Error('Attempt item is not accessible.');
  }
  return row;
}

async function listArtifactsForAttemptItem(itemId, visibility, options = {}) {
  const token = cleanString(itemId, { max: 120, allowEmpty: true }) || '';
  if (!token) return [];
  const rows = await pteAttemptArtifactRepository.list({
    query: { attemptItemId__eq: token },
    scope: buildRepositoryScope(visibility),
    sort: { createdAt: 1, id: 1 },
    backendMode: options?.backendMode
  });
  return Array.isArray(rows) ? rows : [];
}

async function resolveScoringContextForAttemptItem(session, item, visibility, requestingUser, options = {}) {
  const itemMetadata = isPlainObject(item?.metadata) ? item.metadata : {};
  const questionSnapshot = resolveAttemptItemQuestionSnapshot(item);
  let question = null;
  const questionVersionId = cleanString(item?.questionVersionId, { max: 120, allowEmpty: true }) || '';
  if (questionVersionId) {
    question = await pteQuestionVersionRepository.getById(questionVersionId, {
      backendMode: options?.backendMode
    });
    if (question && !isPracticeQuestionVisibleRow(question, visibility)) {
      question = null;
    }
  }
  const scoringQuestion = questionSnapshot
    ? {
      ...(question || {}),
      ...questionSnapshot,
      id: questionSnapshot.id || questionVersionId,
      payload: questionSnapshot.payload,
      scoringConfig: questionSnapshot.scoringConfig,
      responseContract: questionSnapshot.responseContract,
      mediaAssets: questionSnapshot.mediaAssets
    }
    : (question || {});

  let scoringState = null;
  let scoringWarning = '';
  if (question && !questionSnapshot) {
    try {
      scoringState = await pteQuestionScoringProfileService.resolveQuestionScoring(question, {
        requestingUser,
        backendMode: options?.backendMode,
        cacheMap: options?.scoringProfileCache || null
      });
    } catch (error) {
      scoringWarning = cleanString(error?.message || error, { max: 500, allowEmpty: true }) || '';
    }
  }

  const questionScoringConfig = isPlainObject(scoringQuestion?.scoringConfig) ? scoringQuestion.scoringConfig : {};
  const scoringConfig = isPlainObject(itemMetadata.scoringConfig)
    ? itemMetadata.scoringConfig
    : (isPlainObject(scoringState?.effectiveScoringConfig) ? scoringState.effectiveScoringConfig : questionScoringConfig);
  const artifacts = await listArtifactsForAttemptItem(item.id, visibility, options);
  const responsePayload = isPlainObject(itemMetadata.responsePayload) ? itemMetadata.responsePayload : {};

  return {
    session,
    item,
    question: scoringQuestion || {},
    artifacts,
    responsePayload,
    scoringConfig,
    scoringProfileVersion: cleanNonNegativeInteger(
      scoringState?.profileVersion,
      cleanNonNegativeInteger(itemMetadata.scoringProfileVersion, 1)
    ),
    warnings: scoringWarning ? [`Unable to resolve scoring profile: ${scoringWarning}`] : []
  };
}

async function persistAttemptItemScoringMetadata(item, scoringMetadata = {}, requestingUser, sourceInput = {}, options = {}) {
  if (!item?.id || !isPlainObject(scoringMetadata)) return item;
  const eventAt = nowIso();
  const creator = resolveCreator(item.orgId, requestingUser);
  const source = buildSource(sourceInput, {
    eventType: 'scoring_metadata_recorded',
    defaultIdPrefix: 'PTA-QSCMETA'
  });
  const itemMetadata = isPlainObject(item.metadata) ? item.metadata : {};
  const existingScoring = isPlainObject(itemMetadata.scoring) ? itemMetadata.scoring : {};
  const responseRevision = cleanNonNegativeInteger(
    scoringMetadata.responseRevision,
    cleanNonNegativeInteger(itemMetadata.responseRevision, 0)
  );

  return pteAttemptItemRepository.update(item.id, {
    metadata: {
      ...itemMetadata,
      scoring: {
        ...existingScoring,
        ...scoringMetadata,
        ...(responseRevision > 0 ? { responseRevision } : {})
      }
    },
    revisionNo: cleanNonNegativeInteger(item.revisionNo, 0) + 1,
    source,
    audit: {
      lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
      lastUpdateDateTime: eventAt
    }
  }, {
    backendMode: options?.backendMode
  });
}

async function tryAutoScoreSubmittedAttemptItem({
  service,
  session,
  item,
  visibility,
  payload,
  requestingUser,
  accessContext,
  options
} = {}) {
  if (!session?.id || !item?.id) return null;
  if (payload?.disableAutoScoring === true || options?.disableAutoScoring === true) {
    return { status: 'skipped', reason: 'disabled' };
  }
  if (!pteScoringEngineService.isAutoScoringSupported(item.questionType)) {
    return { status: 'skipped', reason: 'unsupported_question_type' };
  }

  const questionTypeKey = cleanString(item.questionType, { max: 120, allowEmpty: true }).toLowerCase() || '';
  const rubric = pteScoringEngineService.getRubric(questionTypeKey) || {};
  const source = {
    module: 'pte_attempt_scoring',
    eventType: `${questionTypeKey || 'attempt_item'}_auto_score`
  };
  const requestedResponseRevision = resolveRequestedResponseRevision(item, payload);
  const canRescoreSameRevision = await canRequesterRescoreSameRevision(requestingUser, accessContext);
  const forceRescoreRequested = normalizeBooleanFlag(payload?.forceRescore, false)
    || normalizeBooleanFlag(options?.forceRescore, false);
  const allowForcedRescore = forceRescoreRequested
    && (canRescoreSameRevision || options?.allowForceRescore === true);
  if (
    !canRescoreSameRevision
    && !allowForcedRescore
    && hasStoredScoredResultForRevision(item, requestedResponseRevision)
  ) {
    return buildReusedAutoScoringResult(item, requestedResponseRevision);
  }
  const shouldEnforceScoringQuota = String(session.attemptType || '').toLowerCase() === 'skill_practice_run'
    && isPlainObject(payload?.activityQuotaPolicy);

  try {
    const context = await resolveScoringContextForAttemptItem(session, item, visibility, requestingUser, options);
    const scoringQuotaReservation = shouldEnforceScoringQuota
      ? await reservePracticeScoringQuota({
        session: context.session,
        item: context.item,
        source: payload?.source,
        resolvedPolicy: payload.activityQuotaPolicy,
        requestingUser,
        accessContext,
        options
      })
      : null;
    let scoreResult = await pteScoringEngineService.scoreAttemptItem({
      session: context.session,
      item: context.item,
      question: context.question,
      artifacts: context.artifacts,
      responsePayload: context.responsePayload,
      scoringConfig: context.scoringConfig,
      requestingUser
    }, options?.scoringOptions || {});
    scoreResult = sanitizeScoringResultForRequester(scoreResult, requestingUser);

    let scoringTokenQuota = null;
    if (scoringQuotaReservation) {
      try {
        scoringTokenQuota = await recordPracticeScoringTokenConsumption({
          quotaReservation: scoringQuotaReservation,
          scoreResult,
          requestingUser,
          options
        });
        if (scoringTokenQuota?.warning && isPlainObject(scoreResult?.metadata)) {
          scoreResult.metadata.warnings = [
            ...(Array.isArray(scoreResult.metadata.warnings) ? scoreResult.metadata.warnings : []),
            scoringTokenQuota.warning
          ];
        }
      } catch (quotaError) {
        if (isPlainObject(scoreResult?.metadata)) {
          scoreResult.metadata.warnings = [
            ...(Array.isArray(scoreResult.metadata.warnings) ? scoreResult.metadata.warnings : []),
            `Activity quota token recording failed: ${cleanString(quotaError?.message || quotaError, { max: 500, allowEmpty: true }) || 'unknown error'}.`
          ];
        }
      }
    }

    if (Array.isArray(context.warnings) && context.warnings.length && isPlainObject(scoreResult?.metadata)) {
      scoreResult.metadata.warnings = [
        ...(Array.isArray(scoreResult.metadata.warnings) ? scoreResult.metadata.warnings : []),
        ...context.warnings
      ];
    }

    if (scoreResult?.status === 'scored' && isPlainObject(scoreResult.scorePayload)) {
      const responseRevision = cleanNonNegativeInteger(
        payload?.responseRevision,
        cleanNonNegativeInteger(context?.item?.metadata?.responseRevision, 0)
      );
      const persistedScore = await service.recordAttemptItemScore(session.id, item.id, {
        ...scoreResult.scorePayload,
        responseRevision,
        scoringProfileVersion: context.scoringProfileVersion,
        scoringMetadata: {
          ...(isPlainObject(scoreResult.metadata) ? scoreResult.metadata : {}),
          ...(responseRevision > 0 ? { responseRevision } : {})
        },
        source
      }, requestingUser, accessContext, options);
      return {
        status: 'scored',
        result: scoreResult,
        session: persistedScore.session,
        item: persistedScore.item,
        event: persistedScore.event,
        activityQuota: scoringQuotaReservation
          ? {
            scoringCall: scoringQuotaReservation,
            scoringTokens: scoringTokenQuota
          }
          : null
      };
    }

    if (scoreResult?.status === 'needs_evidence' || scoreResult?.status === 'failed') {
      const updatedItem = await persistAttemptItemScoringMetadata(
        item,
        {
          ...(isPlainObject(scoreResult.metadata) ? scoreResult.metadata : {
            status: scoreResult.status,
            warnings: Array.isArray(scoreResult.warnings) ? scoreResult.warnings : []
          }),
          responseRevision: cleanNonNegativeInteger(
            payload?.responseRevision,
            cleanNonNegativeInteger(item?.metadata?.responseRevision, 0)
          )
        },
        requestingUser,
        source,
        options
      );
      return {
        status: scoreResult.status,
        result: scoreResult,
        item: updatedItem,
        activityQuota: scoringQuotaReservation
          ? {
            scoringCall: scoringQuotaReservation,
            scoringTokens: scoringTokenQuota
          }
          : null
      };
    }

    return {
      status: scoreResult?.status || 'skipped',
      result: scoreResult || null,
      activityQuota: scoringQuotaReservation
        ? {
          scoringCall: scoringQuotaReservation,
          scoringTokens: scoringTokenQuota
        }
        : null
    };
  } catch (error) {
    const errorCode = cleanString(error?.code, { max: 120, allowEmpty: true }) || '';
    if (errorCode.startsWith('PTE_SCORING_QUOTA') || errorCode.startsWith('QUOTA_POLICY')) {
      throw error;
    }
    const failedWarnings = sanitizeScoringWarningsForRequester([
      `Automatic scoring failed: ${cleanString(error?.message || error, { max: 800, allowEmpty: true }) || 'unknown error'}.`
    ], requestingUser);
    const failedMetadata = {
      status: 'failed',
      scorerKey: cleanString(rubric.scorerKey || questionTypeKey, { max: 120, allowEmpty: true }) || questionTypeKey,
      scorerVersion: cleanString(rubric.scorerVersion, { max: 120, allowEmpty: true }) || '',
      warnings: failedWarnings,
      scoredAt: nowIso(),
      responseRevision: cleanNonNegativeInteger(
        payload?.responseRevision,
        cleanNonNegativeInteger(item?.metadata?.responseRevision, 0)
      )
    };
    let updatedItem = item;
    try {
      updatedItem = await persistAttemptItemScoringMetadata(item, failedMetadata, requestingUser, source, options);
    } catch (_) {
      updatedItem = item;
    }
    return {
      status: 'failed',
      result: {
        status: 'failed',
        metadata: failedMetadata,
        warnings: failedMetadata.warnings
      },
      item: updatedItem
    };
  }
}

async function addArtifactsForSave({
  orgId,
  userId,
  personId,
  applicantId,
  attemptSessionId,
  attemptItemId,
  attemptType,
  artifacts,
  creator,
  source,
  backendMode
}) {
  const rows = Array.isArray(artifacts) ? artifacts : [];
  if (!rows.length) return [];

  const created = [];
  for (const entry of rows) {
    const row = isPlainObject(entry) ? entry : {};
    const clientArtifactId = cleanString(row.clientArtifactId || row.id, { max: 160, allowEmpty: true }) || '';
    if (clientArtifactId) {
      // eslint-disable-next-line no-await-in-loop
      const existing = await pteAttemptArtifactRepository.list({
        query: {
          orgId__eq: orgId,
          attemptItemId__eq: attemptItemId,
          clientArtifactId__eq: clientArtifactId
        },
        scope: { canViewAll: true },
        sort: { createdAt: -1 },
        backendMode
      });
      if (Array.isArray(existing) && existing.length) {
        created.push(existing[0]);
        continue;
      }
    }

    // eslint-disable-next-line no-await-in-loop
    const artifact = await pteAttemptArtifactRepository.create({
      orgId,
      userId,
      personId,
      applicantId,
      attemptSessionId,
      attemptItemId,
      attemptType,
      artifactType: cleanString(row.artifactType || row.type, { max: 80, allowEmpty: true }).toLowerCase() || 'other',
      status: 'active',
      clientArtifactId,
      name: cleanString(row.name, { max: 260, allowEmpty: true }) || '',
      mimeType: cleanString(row.mimeType, { max: 120, allowEmpty: true }) || '',
      sizeBytes: cleanNonNegativeInteger(row.sizeBytes || row.size, 0),
      checksum: cleanString(row.checksum, { max: 200, allowEmpty: true }) || '',
      url: cleanString(row.url, { max: 1200, allowEmpty: true }) || '',
      path: cleanString(row.path, { max: 1200, allowEmpty: true }) || '',
      referenceId: cleanString(row.referenceId, { max: 200, allowEmpty: true }) || '',
      durationSeconds: cleanNumber(row.durationSeconds, 0),
      payloadBytes: cleanNonNegativeInteger(row.payloadBytes, 0),
      summary: isPlainObject(row.summary) ? row.summary : {},
      metadata: isPlainObject(row.metadata) ? row.metadata : {},
      createdAt: nowIso(),
      source: buildSource(source, {
        eventType: 'response_saved',
        defaultIdPrefix: 'PTA-ART'
      }),
      creator,
      audit: {
        createUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        createDateTime: nowIso(),
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: nowIso()
      }
    }, {
      backendMode
    });
    created.push(artifact);
  }
  return created;
}

function buildRoadmapHints({ weakSkills = [], weakQuestionTypes = [], trendDelta = 0, paceBuckets = {} }) {
  const hints = [];
  const formatQuestionTypeLabel = (value) => cleanString(value, { max: 120, allowEmpty: true })
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  if (weakSkills.length) {
    hints.push(`Prioritize ${weakSkills.slice(0, 2).map((row) => row.skill).join(' and ')} with targeted drills and short review cycles.`);
  }
  if (weakQuestionTypes.length) {
    hints.push(`Focus on question types: ${weakQuestionTypes.slice(0, 3).map((row) => formatQuestionTypeLabel(row.questionType) || row.questionType).join(', ')}.`);
  }
  if (trendDelta < -3) {
    hints.push('Recent scoring trend declined; reduce volume and increase feedback frequency before next full run.');
  } else if (trendDelta > 3) {
    hints.push('Recent scoring trend improved; increase mixed-skill practice complexity gradually.');
  }
  const fastLow = paceBuckets.fast_low || 0;
  const slowLow = paceBuckets.slow_low || 0;
  if (fastLow > slowLow && fastLow > 0) {
    hints.push('Low scores with fast submissions suggest rushing; add timed reflection checkpoints before submit.');
  } else if (slowLow > 0) {
    hints.push('Low scores with slow responses suggest concept gaps; add guided examples before timed attempts.');
  }
  return hints;
}

async function applyAttemptUsageIncrement(runtimeConfig = {}, options = {}) {
  const testVersionId = cleanString(runtimeConfig?.testVersionId, { max: 120, allowEmpty: true }) || '';
  if (testVersionId) {
    const testRow = await pteTestVersionRepository.getById(testVersionId, {
      backendMode: options?.backendMode
    });
    if (testRow) {
      const usageMeta = isPlainObject(testRow.usageMeta) ? testRow.usageMeta : {};
      await pteTestVersionRepository.update(testRow.id, {
        usageMeta: {
          ...usageMeta,
          attemptsCount: cleanNonNegativeInteger(usageMeta.attemptsCount, 0) + 1
        }
      }, {
        backendMode: options?.backendMode
      });
    }
  }

  const questionIds = new Set(
    (Array.isArray(runtimeConfig?.items) ? runtimeConfig.items : [])
      .map((row) => cleanString(row?.questionVersionId, { max: 120, allowEmpty: true }) || '')
      .filter(Boolean)
  );
  for (const questionVersionId of questionIds) {
    // eslint-disable-next-line no-await-in-loop
    const questionRow = await pteQuestionVersionRepository.getById(questionVersionId, {
      backendMode: options?.backendMode
    });
    if (!questionRow) continue;
    const usageMeta = isPlainObject(questionRow.usageMeta) ? questionRow.usageMeta : {};
    // eslint-disable-next-line no-await-in-loop
    await pteQuestionVersionRepository.update(questionRow.id, {
      usageMeta: {
        ...usageMeta,
        attemptsCount: cleanNonNegativeInteger(usageMeta.attemptsCount, 0) + 1
      }
    }, {
      backendMode: options?.backendMode
    });
  }
}

function queueAttemptUsageIncrement(runtimeConfig = {}, options = {}) {
  setTimeout(() => {
    applyAttemptUsageIncrement(runtimeConfig, options).catch((error) => {
      const message = cleanString(error?.message || error, { max: 400, allowEmpty: true }) || 'Unknown usage increment error.';
      // eslint-disable-next-line no-console
      console.warn(`[PTE_ATTEMPT_LEDGER][USAGE_INCREMENT][WARN] ${message}`);
    });
  }, 0);
}

async function reservePracticeAttemptQuota({
  orgId,
  userId,
  questionCount = 0,
  volumeUnits = 0,
  bypassAvailabilityCheck = false,
  operationId = OPERATIONS.CREATE,
  sourceEventType = 'practice_attempt_started',
  source,
  resolvedPolicy = null,
  requestingUser,
  options = {}
}) {
  const resolvedOrgId = toPublicId(orgId || '');
  const resolvedUserId = toPublicId(userId || '');
  if (!resolvedOrgId || !resolvedUserId) {
    throw new Error('orgId and userId are required for practice quota usage.');
  }

  const baseEventId = cleanString(source?.eventId, { max: 180, allowEmpty: true }) || `PTE-PRACTICE-${Date.now()}`;
  const baseIdempotency = cleanString(source?.idempotencyKey, { max: 220, allowEmpty: true }) || `${baseEventId}-QUOTA`;
  const quotaSource = {
    module: 'pte_practice_runtime',
    eventType: sourceEventType,
    eventId: baseEventId,
    idempotencyKey: `${baseIdempotency}:consumption`
  };

  const normalizedOperation = cleanString(operationId, { max: 120, allowEmpty: true }) || OPERATIONS.CREATE;
  const policyResolution = (
    isPlainObject(resolvedPolicy)
    && isPlainObject(resolvedPolicy.definition)
    && cleanString(resolvedPolicy?.section, { max: 120, allowEmpty: true }) === PRACTICE_QUOTA_SECTION_ID
    && cleanString(resolvedPolicy?.operation, { max: 120, allowEmpty: true }) === normalizedOperation
  )
    ? resolvedPolicy
    : await consumptionDefinitionPolicyService.resolvePolicyDefinition({
      orgId: resolvedOrgId,
      userId: resolvedUserId,
      sectionId: PRACTICE_QUOTA_SECTION_ID,
      operationId: normalizedOperation,
      sourceEventType
    }, {
      backendMode: options?.backendMode
    });

  const policy = {
    definition: policyResolution.definition,
    context: isPlainObject(policyResolution.context) ? policyResolution.context : {}
  };

  const context = {
    ...policy.context,
    orgId: resolvedOrgId,
    userId: resolvedUserId,
    sectionId: PRACTICE_QUOTA_SECTION_ID,
    operationId: normalizedOperation,
    sourceEventType,
    questionCount: Math.max(0, cleanNonNegativeInteger(questionCount, 0)),
    volumeUnits: Math.max(0, cleanNonNegativeInteger(volumeUnits || questionCount, 0))
  };

  const consumption = await consumptionDefinitionPolicyService.consumeUsingResolvedDefinition({
    policy,
    context,
    source: quotaSource,
    consumeTiming: 'on_attempt',
    bypassAvailabilityCheck,
    dateTime: nowIso()
  }, {
    requestUser: requestingUser,
    backendMode: options?.backendMode
  });

  return {
    consumed: consumption?.consumed || null,
    needs: activityQuotaLedgerService.normalizeNeeds(consumption?.needs || {}),
    section: cleanString(policy?.definition?.sectionId, { max: 120, allowEmpty: true }) || PRACTICE_QUOTA_SECTION_ID,
    operation: cleanString(policy?.definition?.operationId, { max: 120, allowEmpty: true }) || normalizedOperation,
    policyDefinitionId: cleanString(policy?.definition?.id, { max: 140, allowEmpty: true }) || '',
    source: quotaSource,
    bypassAvailabilityCheck
  };
}

async function rollbackPracticeAttemptQuota(reservation = {}, requestingUser, options = {}) {
  const call = Math.abs(Number(reservation?.needs?.call || 0));
  const amount = Math.abs(Number(reservation?.needs?.amount || 0));
  const token = Math.abs(Number(reservation?.needs?.token || 0));
  const volume = Math.abs(Number(reservation?.needs?.volume || 0));
  if (call <= 0 && amount <= 0 && token <= 0 && volume <= 0) return null;

  const orgId = toPublicId(reservation?.consumed?.orgId || '');
  const userId = toPublicId(reservation?.consumed?.userId || '');
  const section = cleanString(reservation?.section, { max: 120, allowEmpty: true }) || '';
  const operation = cleanString(reservation?.operation, { max: 120, allowEmpty: true }) || '';
  if (!orgId || !userId || !section || !operation) return null;

  const baseIdempotency = cleanString(reservation?.source?.idempotencyKey, { max: 220, allowEmpty: true }) || '';
  return activityQuotaLedgerService.recordAdjustment({
    dateTime: nowIso(),
    orgId,
    userId,
    section,
    operation,
    call: -call,
    amount: -amount,
    token: -token,
    volume: -volume,
    source: {
      module: 'pte_practice_runtime',
      eventType: 'practice_attempt_rollback',
      eventId: cleanString(reservation?.source?.eventId, { max: 180, allowEmpty: true }) || `PTE-PRACTICE-ROLLBACK-${Date.now()}`,
      idempotencyKey: `${baseIdempotency || `PTE-PRACTICE-ROLLBACK-${Date.now()}`}:rollback`
    }
  }, {
    requestUser: requestingUser,
    backendMode: options?.backendMode
  });
}

function resolveScoringTokenUsage(scoreResult = {}) {
  const metadata = isPlainObject(scoreResult?.metadata) ? scoreResult.metadata : {};
  const provider = isPlainObject(metadata.provider) ? metadata.provider : {};
  const usage = isPlainObject(provider.tokenUsage)
    ? provider.tokenUsage
    : (isPlainObject(provider.usage) ? provider.usage : {});
  const prompt = Number(usage.promptTokenCount);
  const candidates = Number(usage.candidatesTokenCount);
  const total = Number(usage.totalTokenCount);
  const cached = Number(usage.cachedContentTokenCount);
  const promptCount = Number.isFinite(prompt) && prompt > 0 ? Math.floor(prompt) : 0;
  const candidatesCount = Number.isFinite(candidates) && candidates > 0 ? Math.floor(candidates) : 0;
  const totalCount = Number.isFinite(total) && total > 0
    ? Math.floor(total)
    : Math.floor(promptCount + candidatesCount);

  return {
    promptTokenCount: promptCount || null,
    candidatesTokenCount: candidatesCount || null,
    totalTokenCount: totalCount > 0 ? totalCount : null,
    cachedContentTokenCount: Number.isFinite(cached) && cached >= 0 ? Math.floor(cached) : null
  };
}

function hasResolvedQuotaPolicyForOperation(resolvedPolicy = {}, operationId = '') {
  if (!isPlainObject(resolvedPolicy) || !isPlainObject(resolvedPolicy.definition)) return false;
  const section = cleanString(resolvedPolicy.section || resolvedPolicy.definition.sectionId, { max: 120, allowEmpty: true }) || '';
  const operation = cleanString(resolvedPolicy.operation || resolvedPolicy.definition.operationId, { max: 120, allowEmpty: true }) || '';
  return section === PRACTICE_QUOTA_SECTION_ID && operation === operationId;
}

function buildScoringQuotaRequestId(item = {}) {
  const itemId = cleanString(item?.id, { max: 80, allowEmpty: true }) || 'ITEM';
  const revision = cleanNonNegativeInteger(item?.scoreRevisionCount, 0) + 1;
  const entropy = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `PTE-PRACTICE-SCORE-${itemId}-R${revision}-${Date.now()}-${entropy}`;
}

async function reservePracticeScoringQuota({
  session = {},
  item = {},
  source,
  resolvedPolicy = null,
  requestingUser,
  accessContext = {},
  options = {}
}) {
  const resolvedOrgId = toPublicId(session?.orgId || item?.orgId || '');
  const resolvedUserId = toPublicId(session?.userId || item?.userId || '');
  if (!resolvedOrgId || !resolvedUserId) {
    throw new Error('Session org/user context is required for scoring quota usage.');
  }

  const baseEventId = cleanString(source?.eventId, { max: 180, allowEmpty: true }) || buildScoringQuotaRequestId(item);
  const baseIdempotency = cleanString(source?.idempotencyKey, { max: 220, allowEmpty: true }) || `${baseEventId}-QUOTA`;
  const quotaSource = {
    module: 'pte_practice_runtime',
    eventType: PRACTICE_SCORING_QUOTA_EVENT_TYPE,
    eventId: baseEventId,
    idempotencyKey: `${baseIdempotency}:scoring-call`
  };

  const operationId = OPERATIONS.AI_SCORING;
  const policyResolution = hasResolvedQuotaPolicyForOperation(resolvedPolicy, operationId)
    ? resolvedPolicy
    : await consumptionDefinitionPolicyService.resolvePolicyDefinition({
      orgId: resolvedOrgId,
      userId: resolvedUserId,
      sectionId: PRACTICE_QUOTA_SECTION_ID,
      operationId,
      sourceEventType: PRACTICE_SCORING_QUOTA_EVENT_TYPE
    }, {
      backendMode: options?.backendMode
    });

  const definition = policyResolution.definition || {};
  const section = cleanString(definition.sectionId, { max: 120, allowEmpty: true }) || PRACTICE_QUOTA_SECTION_ID;
  const operation = cleanString(definition.operationId, { max: 120, allowEmpty: true }) || operationId;
  const policyContext = isPlainObject(policyResolution.context) ? policyResolution.context : {};
  const context = {
    ...policyContext,
    orgId: resolvedOrgId,
    userId: resolvedUserId,
    sectionId: section,
    operationId: operation,
    sourceEventType: PRACTICE_SCORING_QUOTA_EVENT_TYPE,
    questionCount: 1,
    volumeUnits: 1,
    scoringCallCount: 1,
    scoreRevisionCount: cleanNonNegativeInteger(item?.scoreRevisionCount, 0)
  };
  const computedNeeds = activityQuotaLedgerService.normalizeNeeds(
    consumptionDefinitionPolicyService.computeNeedsFromDefinition(definition, context)
  );
  const callNeed = Math.max(1, Number(computedNeeds.call || 0));
  const upfrontNeeds = activityQuotaLedgerService.normalizeNeeds({
    ...computedNeeds,
    call: callNeed
  });
  const preflightNeeds = upfrontNeeds;
  const bypassAvailabilityCheck = await shouldBypassPracticeQuotaForUser(requestingUser, operationId, accessContext);

  if (!bypassAvailabilityCheck) {
    const evaluation = await activityQuotaLedgerService.evaluateQuota({
      orgId: resolvedOrgId,
      userId: resolvedUserId,
      section,
      operation,
      needs: preflightNeeds
    }, {
      backendMode: options?.backendMode
    });
    if (!evaluation?.allowed) {
      const message = cleanString(evaluation?.message, { max: 600, allowEmpty: true }) || 'Insufficient activity quota for scoring.';
      const error = new Error(message);
      error.code = 'PTE_SCORING_QUOTA_UNAVAILABLE';
      throw error;
    }
  }

  let consumedCall = null;
  if (bypassAvailabilityCheck) {
    consumedCall = await activityQuotaLedgerService.recordConsumptionWithoutCheck({
      dateTime: nowIso(),
      orgId: resolvedOrgId,
      userId: resolvedUserId,
      section,
      operation,
      needs: upfrontNeeds,
      source: {
        ...quotaSource,
        eventType: `${quotaSource.eventType}_bypass`
      }
    }, {
      requestUser: requestingUser,
      backendMode: options?.backendMode
    });
  } else {
    const callAttempt = await activityQuotaLedgerService.consumeIfAvailable({
      dateTime: nowIso(),
      orgId: resolvedOrgId,
      userId: resolvedUserId,
      section,
      operation,
      needs: upfrontNeeds,
      source: quotaSource
    }, {
      requestUser: requestingUser,
      backendMode: options?.backendMode
    });
    if (!callAttempt?.allowed) {
      const message = cleanString(callAttempt?.message, { max: 600, allowEmpty: true }) || 'Insufficient activity quota for scoring.';
      const error = new Error(message);
      error.code = 'PTE_SCORING_QUOTA_UNAVAILABLE';
      throw error;
    }
    consumedCall = callAttempt.entry;
  }

  return {
    consumedCall,
    computedNeeds,
    callNeeds: upfrontNeeds,
    upfrontNeeds,
    preflightNeeds,
    section,
    operation,
    policyDefinitionId: cleanString(definition.id, { max: 140, allowEmpty: true }) || '',
    source: quotaSource,
    bypassAvailabilityCheck
  };
}

async function recordPracticeScoringTokenConsumption({
  quotaReservation = null,
  scoreResult = {},
  requestingUser,
  options = {}
} = {}) {
  if (!quotaReservation || !isPlainObject(quotaReservation)) {
    return { skipped: true, reason: 'no_quota_reservation' };
  }
  const usage = resolveScoringTokenUsage(scoreResult);
  const totalTokens = Math.max(0, cleanNonNegativeInteger(usage.totalTokenCount, 0));
  if (totalTokens <= 0) {
    return { skipped: true, reason: 'no_token_usage', usage };
  }

  const orgId = toPublicId(quotaReservation?.consumedCall?.orgId || '');
  const userId = toPublicId(quotaReservation?.consumedCall?.userId || '');
  const section = cleanString(quotaReservation?.section, { max: 120, allowEmpty: true }) || '';
  const operation = cleanString(quotaReservation?.operation, { max: 120, allowEmpty: true }) || '';
  if (!orgId || !userId || !section || !operation) {
    return { skipped: true, reason: 'incomplete_quota_context', usage };
  }

  const baseEventId = cleanString(quotaReservation?.source?.eventId, { max: 180, allowEmpty: true }) || `PTE-PRACTICE-SCORE-TOKENS-${Date.now()}`;
  const baseIdempotency = cleanString(quotaReservation?.source?.idempotencyKey, { max: 220, allowEmpty: true }) || baseEventId;
  const needs = activityQuotaLedgerService.normalizeNeeds({ token: totalTokens });
  const consumedTokens = await activityQuotaLedgerService.recordConsumptionWithoutCheck({
    dateTime: nowIso(),
    orgId,
    userId,
    section,
    operation,
    needs,
    source: {
      module: 'pte_practice_runtime',
      eventType: PRACTICE_SCORING_TOKEN_QUOTA_EVENT_TYPE,
      eventId: `${baseEventId}-TOKENS`,
      idempotencyKey: `${baseIdempotency}:scoring-tokens`
    }
  }, {
    requestUser: requestingUser,
    backendMode: options?.backendMode
  });

  try {
    await activityQuotaLedgerService.rebuildProjectionForKey({
      orgId,
      userId,
      section,
      operation
    }, {
      backendMode: options?.backendMode
    });
  } catch (error) {
    return {
      consumedTokens,
      needs,
      usage,
      warning: `Activity quota token projection rebuild failed: ${cleanString(error?.message || error, { max: 500, allowEmpty: true }) || 'unknown error'}.`
    };
  }

  return {
    consumedTokens,
    needs,
    usage
  };
}

async function markPracticeRunnerOpened(session = {}, openedByUserId = '', options = {}) {
  const sessionMetadata = isPlainObject(session?.metadata) ? session.metadata : {};
  const practiceRuntime = isPlainObject(sessionMetadata?.practiceRuntime) ? sessionMetadata.practiceRuntime : {};
  const runnerOpenCount = parseNonNegativeIntOrFallback(practiceRuntime?.runnerOpenCount, 0);
  const now = nowIso();
  const metadata = {
    ...sessionMetadata,
    practiceRuntime: {
      ...practiceRuntime,
      runnerFirstOpenPending: false,
      runnerOpenCount: runnerOpenCount + 1,
      lastRunnerOpenedAt: now
    }
  };

  return pteAttemptSessionRepository.update(session.id, {
    metadata,
    audit: {
      lastUpdateUser: cleanString(openedByUserId, { max: 120, allowEmpty: true }) || 'System',
      lastUpdateDateTime: now
    }
  }, {
    backendMode: options?.backendMode
  });
}

const pteAttemptLedgerService = {
  EVENT_TYPES,
  ATTEMPT_TYPES,

  async startAttemptSession(payload = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const activeOrgId = visibility.activeOrgId;
    if (!activeOrgId) throw new Error('Active organization context is required.');
    const requesterUserId = toPublicId(requestingUser?.id || '');
    if (!requesterUserId) throw new Error('Authenticated user context is required.');

    const runtimeConfig = await buildQuestionItemsForRuntime(payload, requestingUser, visibility, options);
    const creator = resolveCreator(activeOrgId, requestingUser);
    const source = buildSource(payload.source, {
      eventType: 'attempt_started',
      defaultIdPrefix: 'PTA-START'
    });
    await assertIdempotency(activeOrgId, source, options);
    const now = nowIso();
    let quotaReservation = null;
    const isPracticeRunAttempt = String(runtimeConfig.attemptType || '').toLowerCase() === 'skill_practice_run';
    const runtimeQuotaPolicy = isPlainObject(payload?.activityQuotaPolicy) ? payload.activityQuotaPolicy : null;
    const bypassPracticeQuota = isPracticeRunAttempt
      ? await shouldBypassPracticeQuotaForUser(requestingUser, OPERATIONS.CREATE, accessContext)
      : false;
    const runtimeMetadata = isPlainObject(runtimeConfig?.metadata) ? { ...runtimeConfig.metadata } : {};
    if (isPracticeRunAttempt) {
      const practiceRuntime = isPlainObject(runtimeMetadata.practiceRuntime) ? runtimeMetadata.practiceRuntime : {};
      runtimeMetadata.practiceRuntime = {
        ...practiceRuntime,
        runnerFirstOpenPending: true,
        runnerOpenCount: parseNonNegativeIntOrFallback(practiceRuntime?.runnerOpenCount, 0),
        lastRunnerOpenedAt: cleanString(practiceRuntime?.lastRunnerOpenedAt, { max: 80, allowEmpty: true }) || ''
      };
    }
    if (isPracticeRunAttempt) {
      quotaReservation = await reservePracticeAttemptQuota({
        orgId: activeOrgId,
        userId: requesterUserId,
        questionCount: Array.isArray(runtimeConfig?.items) ? runtimeConfig.items.length : 0,
        volumeUnits: Array.isArray(runtimeConfig?.items) ? runtimeConfig.items.length : 0,
        operationId: OPERATIONS.CREATE,
        bypassAvailabilityCheck: bypassPracticeQuota,
        source,
        sourceEventType: 'practice_attempt_started',
        resolvedPolicy: runtimeQuotaPolicy,
        requestingUser,
        options
      });
    }

    try {
      const context = await resolvePersonApplicantContext(activeOrgId, requestingUser, payload, options);
      const session = await pteAttemptSessionRepository.create({
        orgId: activeOrgId,
        userId: requesterUserId,
        personId: context.personId,
        applicantId: context.applicantId,
        attemptType: runtimeConfig.attemptType,
        status: ACTIVE_SESSION_STATUS,
        testVersionId: runtimeConfig.testVersionId,
        testFamilyId: runtimeConfig.testFamilyId,
        startedAt: now,
        totalQuestions: runtimeConfig.items.length,
        submittedQuestions: 0,
        feedbackCount: 0,
        firstEventAt: now,
        lastEventAt: now,
        latestEventType: 'attempt_started',
        eventCounters: toEventCounters({}, 'attempt_started'),
        metadata: runtimeMetadata,
        source,
        creator,
        audit: {
          createUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
          createDateTime: now,
          lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
          lastUpdateDateTime: now
        }
      }, {
        backendMode: options?.backendMode
      });

      const items = [];
      for (const row of runtimeConfig.items) {
        // eslint-disable-next-line no-await-in-loop
        const created = await pteAttemptItemRepository.create({
          orgId: activeOrgId,
          userId: requesterUserId,
          personId: context.personId,
          applicantId: context.applicantId,
          attemptSessionId: session.id,
          attemptType: runtimeConfig.attemptType,
          status: 'pending',
          testVersionId: runtimeConfig.testVersionId,
          questionVersionId: row.questionVersionId,
          questionFamilyId: row.questionFamilyId,
          questionType: row.questionType,
          skill: row.skill,
          questionOrder: row.questionOrder,
          maxScore: row.maxScore,
          metadata: {
            questionCode: cleanString(row.questionCode, { max: 120, allowEmpty: true }) || '',
            questionTitle: cleanString(row.questionTitle, { max: 260, allowEmpty: true }) || '',
            scoringProfileVersion: cleanNonNegativeInteger(row.scoringProfileVersion, 1),
            scoringConfig: deepClone(row.scoringConfig, {}),
            questionSnapshot: deepClone(row.questionSnapshot, null)
          },
          source,
          creator,
          audit: {
            createUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
            createDateTime: now,
            lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
            lastUpdateDateTime: now
          }
        }, {
          backendMode: options?.backendMode
        });
        items.push(created);
      }

      const event = await appendEvent({
        eventAt: now,
        orgId: activeOrgId,
        userId: requesterUserId,
        personId: context.personId,
        applicantId: context.applicantId,
        attemptSessionId: session.id,
        attemptItemId: '',
        attemptType: runtimeConfig.attemptType,
        eventType: 'attempt_started',
        testVersionId: runtimeConfig.testVersionId,
        questionVersionId: '',
        questionType: '',
        skill: '',
        questionOrder: 0,
        startedAt: now,
        finishedAt: '',
        feedbackProvidedAt: '',
        timeSpentSeconds: 0,
        scoreRaw: 0,
        scoreFinal: 0,
        maxScore: 0,
        percentage: 0,
        traitScores: {},
        responseSummary: {},
        artifactRefs: [],
        collapseKey: 'session',
        source,
        creator,
        audit: {
          createUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
          createDateTime: now,
          lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
          lastUpdateDateTime: now
        }
      }, options);

      const refreshed = await pteAttemptSessionRepository.update(session.id, {
        latestEventId: event.id,
        latestEventType: event.eventType
      }, {
        backendMode: options?.backendMode
      });

      queueAttemptUsageIncrement(runtimeConfig, options);

      return {
        session: refreshed,
        items: sortItemsByQuestionOrder(items)
      };
    } catch (error) {
      if (quotaReservation) {
        try {
          await rollbackPracticeAttemptQuota(quotaReservation, requestingUser, options);
        } catch (rollbackError) {
          const rollbackMessage = cleanString(
            rollbackError?.message || rollbackError,
            { max: 400, allowEmpty: true }
          ) || 'Unknown quota rollback error.';
          // eslint-disable-next-line no-console
          console.warn(`[PTE_ATTEMPT_LEDGER][QUOTA_ROLLBACK][WARN] ${rollbackMessage}`);
        }
      }
      throw error;
    }
  },

  async consumePracticeReopenQuota(payload = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const sessionInput = isPlainObject(payload?.session) ? payload.session : null;
    const sessionId = cleanString(payload?.sessionId || sessionInput?.id, { max: 120, allowEmpty: true }) || '';
    if (!sessionId) throw new Error('Session id is required.');

    const session = sessionInput || await getSessionByIdOrThrow(sessionId, visibility, options);
    if (String(session?.attemptType || '').toLowerCase() !== 'skill_practice_run') {
      return { skipped: true, reason: 'not_skill_practice_run', sessionId };
    }

    const sessionStatus = cleanString(session?.status, { max: 40, allowEmpty: true }).toLowerCase();
    if (sessionStatus && sessionStatus !== 'in_progress') {
      return { skipped: true, reason: 'not_in_progress', sessionId, status: sessionStatus };
    }

    const resolvedOrgId = toPublicId(session?.orgId || visibility.activeOrgId || '') || '';
    const resolvedUserId = toPublicId(session?.userId || '') || '';
    if (!resolvedOrgId || !resolvedUserId) {
      throw new Error('Session org/user context is required for practice quota usage.');
    }

    const requesterUserId = resolveRequesterUserId(requestingUser) || resolvedUserId || 'System';
    const sessionMetadata = isPlainObject(session?.metadata) ? session.metadata : {};
    const practiceRuntime = isPlainObject(sessionMetadata?.practiceRuntime) ? sessionMetadata.practiceRuntime : {};
    const isInitialOpenAfterCreate = practiceRuntime?.runnerFirstOpenPending === true;
    if (isInitialOpenAfterCreate) {
      await markPracticeRunnerOpened(session, requesterUserId, options);
      return {
        skipped: true,
        reason: 'initial_open_after_create',
        sessionId: session.id,
        operation: OPERATIONS.UPDATE,
        bypassAvailabilityCheck: await shouldBypassPracticeQuotaForUser(requestingUser, OPERATIONS.UPDATE, accessContext)
      };
    }

    let questionCount = cleanNonNegativeInteger(payload?.questionCount, 0);
    if (questionCount <= 0) {
      questionCount = cleanNonNegativeInteger(session?.totalQuestions, 0);
    }
    if (questionCount <= 0) {
      questionCount = await pteAttemptItemRepository.count({
        query: { attemptSessionId__eq: session.id },
        scope: buildRepositoryScope(visibility),
        backendMode: options?.backendMode
      });
    }

    const source = buildSource(payload?.source, {
      eventType: 'practice_attempt_reopened',
      defaultIdPrefix: 'PTA-REOPEN'
    });
    const resolvedPolicy = isPlainObject(payload?.activityQuotaPolicy) ? payload.activityQuotaPolicy : null;
    const bypassAvailabilityCheck = await shouldBypassPracticeQuotaForUser(requestingUser, OPERATIONS.UPDATE, accessContext);
    const reservation = await reservePracticeAttemptQuota({
      orgId: resolvedOrgId,
      userId: resolvedUserId,
      questionCount,
      volumeUnits: questionCount,
      bypassAvailabilityCheck,
      operationId: OPERATIONS.UPDATE,
      sourceEventType: 'practice_attempt_reopened',
      source,
      resolvedPolicy,
      requestingUser,
      options
    });

    try {
      await markPracticeRunnerOpened(session, requesterUserId, options);
    } catch (metadataError) {
      const message = cleanString(metadataError?.message || metadataError, { max: 400, allowEmpty: true }) || 'Unknown practice runner metadata update error.';
      // eslint-disable-next-line no-console
      console.warn(`[PTE_ATTEMPT_LEDGER][RUNNER_OPEN_METADATA][WARN] ${message}`);
    }

    return {
      ...reservation,
      sessionId: session.id,
      bypassAvailabilityCheck
    };
  },

  async consumePracticeAccessQuota(payload = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const requesterUserId = resolveRequesterUserId(requestingUser);
    if (!requesterUserId) {
      throw new Error('Authenticated user context is required.');
    }

    const activeOrgId = resolveActiveOrgId(requestingUser);
    const allowCrossOrg = adminChekersService.isSuperAdmin(requestingUser) && !activeOrgId;
    if (!activeOrgId && allowCrossOrg) {
      return { skipped: true, reason: 'no_active_org_for_super_admin' };
    }
    if (!activeOrgId) {
      throw new Error('No active organization context found.');
    }

    const operationToken = cleanString(payload?.operation, { max: 40, allowEmpty: true }).toUpperCase();
    const operationCandidate = operationToken === OPERATIONS.READ_ALL ? OPERATIONS.READ_ALL : OPERATIONS.READ;
    const volumeUnits = Math.max(1, cleanNonNegativeInteger(payload?.volumeUnits, 1));
    const sourceEventType = operationCandidate === OPERATIONS.READ_ALL
      ? 'practice_attempts_list_viewed'
      : 'practice_attempt_detail_viewed';

    const source = buildSource(payload?.source, {
      eventType: sourceEventType,
      defaultIdPrefix: operationCandidate === OPERATIONS.READ_ALL ? 'PTA-LIST' : 'PTA-DETAIL'
    });
    const resolvedPolicy = isPlainObject(payload?.activityQuotaPolicy) ? payload.activityQuotaPolicy : null;
    const bypassAvailabilityCheck = await shouldBypassPracticeQuotaForUser(requestingUser, operationCandidate, accessContext);
    const reservation = await reservePracticeAttemptQuota({
      orgId: activeOrgId,
      userId: requesterUserId,
      questionCount: volumeUnits,
      volumeUnits,
      bypassAvailabilityCheck,
      operationId: operationCandidate,
      sourceEventType,
      source,
      resolvedPolicy,
      requestingUser,
      options
    });

    return {
      ...reservation,
      operation: operationCandidate,
      volumeUnits,
      bypassAvailabilityCheck
    };
  },

  async startAttemptItem(sessionId, itemId, payload = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const session = await getSessionByIdOrThrow(sessionId, visibility, options);
    const item = await getItemByIdOrThrow(itemId, visibility, options);
    if (!idsEqual(item.attemptSessionId, session.id)) {
      throw new Error('Attempt item does not belong to the target session.');
    }
    if (!isAttemptSessionActive(session.status)) {
      throw new Error('Attempt session is not active.');
    }
    if (FINAL_ITEM_STATUSES.has(String(item.status || '').toLowerCase())) {
      throw new Error('Attempt item is already finalized.');
    }

    const creator = resolveCreator(session.orgId, requestingUser);
    const eventAt = nowIso();
    const startedAt = item.startedAt || eventAt;
    const isPracticeRun = String(session.attemptType || '').toLowerCase() === 'skill_practice_run';
    const viewInstanceId = normalizeViewInstanceId(
      payload?.viewInstanceId,
      `${item.id || itemId || 'item'}-${Date.now()}`
    );
    const source = buildSource(payload.source, {
      eventType: 'question_started',
      defaultIdPrefix: 'PTA-QSTART'
    });

    const event = await appendEvent({
      eventAt,
      orgId: session.orgId,
      userId: session.userId,
      personId: session.personId || '',
      applicantId: session.applicantId || '',
      attemptSessionId: session.id,
      attemptItemId: item.id,
      attemptType: session.attemptType,
      eventType: 'question_started',
      testVersionId: session.testVersionId || '',
      questionVersionId: item.questionVersionId || '',
      questionType: item.questionType || '',
      skill: item.skill || '',
      questionOrder: cleanNonNegativeInteger(item.questionOrder, 0),
      startedAt,
      finishedAt: '',
      feedbackProvidedAt: '',
      timeSpentSeconds: cleanNonNegativeInteger(
        isPracticeRun ? item.totalSeenSeconds : item.timeSpentSeconds,
        0
      ),
      scoreRaw: cleanNumber(item.scoreRaw, 0),
      scoreFinal: cleanNumber(item.scoreFinal, 0),
      maxScore: cleanNumber(item.maxScore, 0),
      percentage: cleanNumber(item.percentage, 0),
      traitScores: isPlainObject(item.traitScores) ? item.traitScores : {},
      responseSummary: isPlainObject(item.responseSummary) ? item.responseSummary : {},
      artifactRefs: [],
      metadata: {
        viewInstanceId,
        viewStartedAt: eventAt
      },
      collapseKey: 'item',
      source,
      creator,
      audit: {
        createUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        createDateTime: eventAt,
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: eventAt
      }
    }, options);

    const updatedItem = await pteAttemptItemRepository.update(item.id, {
      startedAt,
      status: 'in_progress',
      viewCount: isPracticeRun
        ? (cleanNonNegativeInteger(item.viewCount, 0) + 1)
        : cleanNonNegativeInteger(item.viewCount, 0),
      metadata: {
        ...(isPlainObject(item.metadata) ? item.metadata : {}),
        lastViewStartedAt: eventAt,
        lastViewInstanceId: viewInstanceId
      },
      revisionNo: cleanNonNegativeInteger(item.revisionNo, 0) + 1,
      source,
      audit: {
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: eventAt
      }
    }, {
      backendMode: options?.backendMode
    });

    const updatedSession = await pteAttemptSessionRepository.update(session.id, {
      firstQuestionStartedAt: session.firstQuestionStartedAt || startedAt,
      firstEventAt: session.firstEventAt || eventAt,
      lastEventAt: eventAt,
      latestEventType: event.eventType,
      latestEventId: event.id,
      eventCounters: toEventCounters(session.eventCounters || {}, 'question_started'),
      audit: {
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: eventAt
      }
    }, {
      backendMode: options?.backendMode
    });

    return {
      session: updatedSession,
      item: updatedItem,
      event
    };
  },

  async saveAttemptItem(sessionId, itemId, payload = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const session = await getSessionByIdOrThrow(sessionId, visibility, options);
    const item = await getItemByIdOrThrow(itemId, visibility, options);
    if (!idsEqual(item.attemptSessionId, session.id)) {
      throw new Error('Attempt item does not belong to the target session.');
    }
    if (!isAttemptSessionActive(session.status)) {
      throw new Error('Attempt session is not active.');
    }
    const isPracticeRun = String(session.attemptType || '').toLowerCase() === 'skill_practice_run';
    const allowReanswer = isPracticeRun
      && (payload.allowReanswer === true || String(payload.allowReanswer || '').trim().toLowerCase() === 'true');
    const replaceExistingResponse = allowReanswer
      || payload.replaceExistingResponse === true
      || String(payload.replaceExistingResponse || '').trim().toLowerCase() === 'true';
    if (FINAL_ITEM_STATUSES.has(String(item.status || '').toLowerCase()) && !allowReanswer) {
      throw new Error('Finalized attempt items cannot be saved.');
    }

    const eventAt = nowIso();
    const creator = resolveCreator(session.orgId, requestingUser);
    const source = buildSource(payload.source, {
      eventType: 'response_saved',
      defaultIdPrefix: 'PTA-QSAVE'
    });
    await assertIdempotency(session.orgId, source, options);
    const timing = calculateSaveTimingForAttemptItem(item, payload, { isPracticeRun, eventAt });
    const startedAt = timing.startedAt;
    const lastViewStartedAt = timing.lastViewStartedAt;
    const seenSeconds = timing.seenSeconds;
    const nextTotalSeenSeconds = timing.nextTotalSeenSeconds;
    const nextTimeSpentSeconds = timing.nextTimeSpentSeconds;
    const viewInstanceId = normalizeViewInstanceId(
      payload?.viewInstanceId,
      item?.metadata?.lastViewInstanceId || ''
    );

    const itemMetadata = isPlainObject(item.metadata) ? item.metadata : {};
    const previousResponseRevision = cleanNonNegativeInteger(
      itemMetadata.responseRevision,
      cleanNonNegativeInteger(item.saveCount, 0)
    );
    const responseRevision = cleanNonNegativeInteger(item.saveCount, 0) + 1;
    const existingSummary = replaceExistingResponse ? {} : (isPlainObject(item.responseSummary) ? item.responseSummary : {});
    const nextSummary = sanitizeResponseSummary(payload.responseSummary, existingSummary);
    const responsePayload = sanitizeResponsePayload(
      payload.responsePayload,
      replaceExistingResponse ? {} : (isPlainObject(itemMetadata.responsePayload) ? itemMetadata.responsePayload : {})
    );
    const createdArtifacts = await addArtifactsForSave({
      orgId: session.orgId,
      userId: session.userId,
      personId: session.personId || '',
      applicantId: session.applicantId || '',
      attemptSessionId: session.id,
      attemptItemId: item.id,
      attemptType: session.attemptType,
      artifacts: payload.artifacts,
      creator,
      source,
      backendMode: options?.backendMode
    });
    const primaryCreatedArtifact = createdArtifacts.find((row) => row && typeof row === 'object') || null;
    if (primaryCreatedArtifact && !responsePayload.artifactId) {
      responsePayload.artifactId = cleanString(primaryCreatedArtifact.id, { max: 120, allowEmpty: true }) || '';
    }
    if (primaryCreatedArtifact && !responsePayload.artifactUrl) {
      responsePayload.artifactUrl = cleanString(primaryCreatedArtifact.url, { max: 2000, allowEmpty: true }) || '';
    }
    if (primaryCreatedArtifact && !responsePayload.audioDurationSeconds) {
      responsePayload.audioDurationSeconds = cleanNumber(primaryCreatedArtifact.durationSeconds, 0);
    }
    const responsePayloadArtifactIds = [
      responsePayload.artifactId,
      responsePayload.audioArtifactId,
      responsePayload.audioAssetId
    ].map((value) => cleanString(value, { max: 120, allowEmpty: true }) || '').filter(Boolean);
    const mergedArtifactIds = Array.from(new Set([
      ...(replaceExistingResponse ? [] : (Array.isArray(item.artifactIds) ? item.artifactIds : [])),
      ...responsePayloadArtifactIds,
      ...createdArtifacts.map((row) => cleanString(row?.id, { max: 120, allowEmpty: true }) || '').filter(Boolean)
    ]));
    nextSummary.artifactCount = mergedArtifactIds.length;

    const event = await appendEvent({
      eventAt,
      orgId: session.orgId,
      userId: session.userId,
      personId: session.personId || '',
      applicantId: session.applicantId || '',
      attemptSessionId: session.id,
      attemptItemId: item.id,
      attemptType: session.attemptType,
      eventType: 'response_saved',
      testVersionId: session.testVersionId || '',
      questionVersionId: item.questionVersionId || '',
      questionType: item.questionType || '',
      skill: item.skill || '',
      questionOrder: cleanNonNegativeInteger(item.questionOrder, 0),
      startedAt,
      finishedAt: '',
      feedbackProvidedAt: '',
      timeSpentSeconds: isPracticeRun ? seenSeconds : cleanNonNegativeInteger(item.timeSpentSeconds, 0),
      scoreRaw: cleanNumber(item.scoreRaw, 0),
      scoreFinal: cleanNumber(item.scoreFinal, 0),
      maxScore: cleanNumber(item.maxScore, 0),
      percentage: cleanNumber(item.percentage, 0),
      traitScores: isPlainObject(item.traitScores) ? item.traitScores : {},
      responseSummary: nextSummary,
      artifactRefs: createdArtifacts.map((row) => ({
        artifactId: row.id,
        artifactType: row.artifactType,
        name: row.name,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        url: row.url,
        path: row.path,
        referenceId: row.referenceId
      })),
      metadata: {
        seenSeconds,
        viewInstanceId,
        viewStartedAt: lastViewStartedAt,
        responseRevision,
        isReanswer: allowReanswer,
        replacesRevision: allowReanswer ? previousResponseRevision : 0,
        responsePayload: deepClone(responsePayload, {}),
        responseSummary: deepClone(nextSummary, {})
      },
      collapseKey: 'item',
      source,
      creator,
      audit: {
        createUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        createDateTime: eventAt,
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: eventAt
      }
    }, options);

    const updatedItem = await pteAttemptItemRepository.update(item.id, {
      startedAt,
      firstSavedAt: item.firstSavedAt || eventAt,
      lastSavedAt: eventAt,
      submittedAt: allowReanswer ? '' : cleanString(item.submittedAt, { max: 80, allowEmpty: true }) || '',
      finishedAt: allowReanswer ? '' : cleanString(item.finishedAt, { max: 80, allowEmpty: true }) || '',
      saveCount: cleanNonNegativeInteger(item.saveCount, 0) + 1,
      status: 'saved',
      timeSpentSeconds: nextTimeSpentSeconds,
      totalSeenSeconds: nextTotalSeenSeconds,
      responseSummary: nextSummary,
      artifactIds: mergedArtifactIds,
      metadata: {
        ...itemMetadata,
        responsePayload,
        responseRevision,
        latestResponseSavedAt: eventAt,
        latestResponseIsReanswer: allowReanswer,
        ...(replaceExistingResponse
          ? {
            scoring: null,
            lastScoringClearedAt: eventAt
          }
          : {}),
        lastViewStartedAt: eventAt,
        lastViewInstanceId: viewInstanceId
      },
      ...(replaceExistingResponse
        ? {
          scoreRaw: 0,
          scoreFinal: 0,
          percentage: 0,
          traitScores: {},
          isCorrect: null,
          scoreRevisionCount: 0
        }
        : {}),
      revisionNo: cleanNonNegativeInteger(item.revisionNo, 0) + 1,
      source,
      audit: {
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: eventAt
      }
    }, {
      backendMode: options?.backendMode
    });

    const updatedSession = await pteAttemptSessionRepository.update(session.id, {
      firstEventAt: session.firstEventAt || eventAt,
      lastEventAt: eventAt,
      latestEventType: event.eventType,
      latestEventId: event.id,
      eventCounters: toEventCounters(session.eventCounters || {}, 'response_saved'),
      audit: {
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: eventAt
      }
    }, {
      backendMode: options?.backendMode
    });

    return {
      session: updatedSession,
      item: updatedItem,
      event,
      artifacts: createdArtifacts
    };
  },

  async skipAttemptItem(sessionId, itemId, payload = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const session = await getSessionByIdOrThrow(sessionId, visibility, options);
    const item = await getItemByIdOrThrow(itemId, visibility, options);
    if (!idsEqual(item.attemptSessionId, session.id)) {
      throw new Error('Attempt item does not belong to the target session.');
    }
    if (!isAttemptSessionActive(session.status)) {
      throw new Error('Attempt session is not active.');
    }
    if (String(session.attemptType || '').toLowerCase() !== 'skill_practice_run') {
      throw new Error('Question skip is available only for skill practice sessions.');
    }
    if (FINAL_ITEM_STATUSES.has(String(item.status || '').toLowerCase())) {
      throw new Error('Finalized attempt items cannot be skipped.');
    }

    const eventAt = nowIso();
    const creator = resolveCreator(session.orgId, requestingUser);
    const source = buildSource(payload.source, {
      eventType: 'question_skipped',
      defaultIdPrefix: 'PTA-QSKIP'
    });
    await assertIdempotency(session.orgId, source, options);

    const startedAt = item.startedAt || eventAt;
    const viewStart = cleanString(item?.metadata?.lastViewStartedAt || startedAt, { max: 80, allowEmpty: true }) || startedAt;
    const viewInstanceId = normalizeViewInstanceId(
      payload?.viewInstanceId,
      item?.metadata?.lastViewInstanceId || ''
    );
    const seenSeconds = cleanNonNegativeInteger(
      payload.seenSeconds,
      calculateTimeSpentSeconds(viewStart, eventAt)
    );
    const nextTotalSeenSeconds = cleanNonNegativeInteger(item.totalSeenSeconds, 0) + seenSeconds;
    const nextTimeSpentSeconds = cleanNonNegativeInteger(item.timeSpentSeconds, 0) + seenSeconds;

    const event = await appendEvent({
      eventAt,
      orgId: session.orgId,
      userId: session.userId,
      personId: session.personId || '',
      applicantId: session.applicantId || '',
      attemptSessionId: session.id,
      attemptItemId: item.id,
      attemptType: session.attemptType,
      eventType: 'question_skipped',
      testVersionId: session.testVersionId || '',
      questionVersionId: item.questionVersionId || '',
      questionType: item.questionType || '',
      skill: item.skill || '',
      questionOrder: cleanNonNegativeInteger(item.questionOrder, 0),
      startedAt: viewStart,
      finishedAt: eventAt,
      feedbackProvidedAt: '',
      timeSpentSeconds: seenSeconds,
      scoreRaw: cleanNumber(item.scoreRaw, 0),
      scoreFinal: cleanNumber(item.scoreFinal, 0),
      maxScore: cleanNumber(item.maxScore, 0),
      percentage: cleanNumber(item.percentage, 0),
      traitScores: isPlainObject(item.traitScores) ? item.traitScores : {},
      selfDifficultyRating: normalizeSelfDifficulty(item.selfDifficultyRating, ''),
      responseSummary: isPlainObject(item.responseSummary) ? item.responseSummary : {},
      artifactRefs: [],
      metadata: {
        seenSeconds,
        viewInstanceId,
        viewStartedAt: viewStart
      },
      collapseKey: 'item',
      source,
      creator,
      audit: {
        createUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        createDateTime: eventAt,
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: eventAt
      }
    }, options);

    const updatedItem = await pteAttemptItemRepository.update(item.id, {
      startedAt,
      finishedAt: eventAt,
      status: 'abandoned',
      skipCount: cleanNonNegativeInteger(item.skipCount, 0) + 1,
      totalSeenSeconds: nextTotalSeenSeconds,
      timeSpentSeconds: nextTimeSpentSeconds,
      metadata: {
        ...(isPlainObject(item.metadata) ? item.metadata : {}),
        lastViewStartedAt: '',
        lastViewInstanceId: ''
      },
      revisionNo: cleanNonNegativeInteger(item.revisionNo, 0) + 1,
      source,
      audit: {
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: eventAt
      }
    }, {
      backendMode: options?.backendMode
    });

    const summary = await recalculateSessionSummary(session, options);
    const updatedSession = await pteAttemptSessionRepository.update(session.id, {
      ...summary.patch,
      firstEventAt: session.firstEventAt || eventAt,
      lastEventAt: eventAt,
      firstQuestionStartedAt: session.firstQuestionStartedAt || startedAt,
      lastQuestionFinishedAt: eventAt,
      latestEventType: event.eventType,
      latestEventId: event.id,
      eventCounters: toEventCounters(session.eventCounters || {}, 'question_skipped'),
      audit: {
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: eventAt
      }
    }, {
      backendMode: options?.backendMode
    });

    return {
      session: updatedSession,
      item: updatedItem,
      event
    };
  },

  async submitAttemptItem(sessionId, itemId, payload = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const session = await getSessionByIdOrThrow(sessionId, visibility, options);
    const item = await getItemByIdOrThrow(itemId, visibility, options);
    if (!idsEqual(item.attemptSessionId, session.id)) {
      throw new Error('Attempt item does not belong to the target session.');
    }
    if (!isAttemptSessionActive(session.status)) {
      throw new Error('Attempt session is not active.');
    }
    if (FINAL_ITEM_STATUSES.has(String(item.status || '').toLowerCase())) {
      throw new Error('Attempt item is already finalized.');
    }

    const autoSubmit = payload.autoSubmit === true || String(payload.autoSubmit || '').trim().toLowerCase() === 'true';
    const eventType = autoSubmit ? 'question_auto_submitted' : 'question_submitted';
    const eventAt = nowIso();
    const creator = resolveCreator(session.orgId, requestingUser);
    const source = buildSource(payload.source, {
      eventType,
      defaultIdPrefix: autoSubmit ? 'PTA-QAUTO' : 'PTA-QSUB'
    });
    await assertIdempotency(session.orgId, source, options);

    const startedAt = item.startedAt || eventAt;
    const finishedAt = eventAt;
    const isPracticeRun = String(session.attemptType || '').toLowerCase() === 'skill_practice_run';
    const hasExplicitTime = Object.prototype.hasOwnProperty.call(payload || {}, 'timeSpentSeconds');
    const lastViewStartedAt = cleanString(item?.metadata?.lastViewStartedAt || startedAt, { max: 80, allowEmpty: true }) || startedAt;
    const viewInstanceId = normalizeViewInstanceId(
      payload?.viewInstanceId,
      item?.metadata?.lastViewInstanceId || ''
    );
    const seenIncrement = calculateTimeSpentSeconds(lastViewStartedAt, finishedAt);
    const responseSummary = sanitizeResponseSummary(payload.responseSummary, item.responseSummary || {});
    const responsePayload = sanitizeResponsePayload(
      payload.responsePayload,
      isPlainObject(item?.metadata?.responsePayload) ? item.metadata.responsePayload : {}
    );
    responseSummary.artifactCount = Array.isArray(item.artifactIds) ? item.artifactIds.length : 0;
    const existingTimeSpent = cleanNonNegativeInteger(item.timeSpentSeconds, 0);
    const timeSpentSeconds = hasExplicitTime
      ? cleanNonNegativeInteger(payload.timeSpentSeconds, existingTimeSpent)
      : (isPracticeRun
        ? existingTimeSpent + seenIncrement
        : cleanNonNegativeInteger(payload.timeSpentSeconds, calculateTimeSpentSeconds(startedAt, finishedAt)));
    const totalSeenSeconds = isPracticeRun
      ? (cleanNonNegativeInteger(item.totalSeenSeconds, 0) + seenIncrement)
      : cleanNonNegativeInteger(item.totalSeenSeconds, cleanNonNegativeInteger(item.timeSpentSeconds, 0));

    const event = await appendEvent({
      eventAt,
      orgId: session.orgId,
      userId: session.userId,
      personId: session.personId || '',
      applicantId: session.applicantId || '',
      attemptSessionId: session.id,
      attemptItemId: item.id,
      attemptType: session.attemptType,
      eventType,
      testVersionId: session.testVersionId || '',
      questionVersionId: item.questionVersionId || '',
      questionType: item.questionType || '',
      skill: item.skill || '',
      questionOrder: cleanNonNegativeInteger(item.questionOrder, 0),
      startedAt,
      finishedAt,
      feedbackProvidedAt: '',
      timeSpentSeconds,
      scoreRaw: cleanNumber(item.scoreRaw, 0),
      scoreFinal: cleanNumber(item.scoreFinal, 0),
      maxScore: cleanNumber(item.maxScore, 0),
      percentage: cleanNumber(item.percentage, 0),
      traitScores: isPlainObject(item.traitScores) ? item.traitScores : {},
      selfDifficultyRating: normalizeSelfDifficulty(item.selfDifficultyRating, ''),
      responseSummary,
      artifactRefs: [],
      metadata: isPracticeRun
        ? {
          seenSecondsIncrement: seenIncrement,
          viewInstanceId,
          viewStartedAt: lastViewStartedAt
        }
        : {},
      collapseKey: 'item',
      source,
      creator,
      audit: {
        createUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        createDateTime: eventAt,
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: eventAt
      }
    }, options);

    const nextStatus = autoSubmit ? 'auto_submitted' : 'submitted';
    const updatedItem = await pteAttemptItemRepository.update(item.id, {
      startedAt,
      submittedAt: item.submittedAt || eventAt,
      finishedAt: eventAt,
      status: nextStatus,
      submitCount: cleanNonNegativeInteger(item.submitCount, 0) + 1,
      timeSpentSeconds,
      totalSeenSeconds,
      responseSummary,
      metadata: {
        ...(isPlainObject(item.metadata) ? item.metadata : {}),
        responsePayload,
        lastViewStartedAt: '',
        lastViewInstanceId: ''
      },
      revisionNo: cleanNonNegativeInteger(item.revisionNo, 0) + 1,
      source,
      audit: {
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: eventAt
      }
    }, {
      backendMode: options?.backendMode
    });

    const summary = await recalculateSessionSummary(session, options);
    const updatedSession = await pteAttemptSessionRepository.update(session.id, {
      ...summary.patch,
      firstEventAt: session.firstEventAt || eventAt,
      lastEventAt: eventAt,
      firstQuestionStartedAt: session.firstQuestionStartedAt || startedAt,
      lastQuestionFinishedAt: eventAt,
      latestEventType: event.eventType,
      latestEventId: event.id,
      eventCounters: toEventCounters(session.eventCounters || {}, eventType),
      audit: {
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: eventAt
      }
    }, {
      backendMode: options?.backendMode
    });

    const autoScoring = await tryAutoScoreSubmittedAttemptItem({
      service: this,
      session: updatedSession,
      item: updatedItem,
      visibility,
      payload,
      requestingUser,
      accessContext,
      options
    });

    return {
      session: autoScoring?.session || updatedSession,
      item: autoScoring?.item || updatedItem,
      event,
      autoScoring: autoScoring || null
    };
  },

  async scoreAttemptItem(sessionId, itemId, payload = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const session = await getSessionByIdOrThrow(sessionId, visibility, options);
    const item = await getItemByIdOrThrow(itemId, visibility, options);
    if (!idsEqual(item.attemptSessionId, session.id)) {
      throw new Error('Attempt item does not belong to the target session.');
    }
    if (!isAttemptSessionActive(session.status) && options?.allowClosedSessionScoring !== true) {
      throw new Error('Attempt session is not active.');
    }

    const currentStatus = cleanString(item.status, { max: 40, allowEmpty: true }).toLowerCase() || 'pending';
    if (currentStatus !== 'saved' && !FINAL_ITEM_STATUSES.has(currentStatus)) {
      throw new Error('Attempt item must be saved before scoring.');
    }
    const itemMetadata = isPlainObject(item.metadata) ? item.metadata : {};
    const currentResponseRevision = cleanNonNegativeInteger(itemMetadata.responseRevision, 0);
    const requestedResponseRevision = cleanNonNegativeInteger(payload.responseRevision, currentResponseRevision);
    if (currentResponseRevision > 0 && requestedResponseRevision > 0 && requestedResponseRevision !== currentResponseRevision) {
      throw new Error('This score request is for an older response. Save the latest response before scoring.');
    }

    const autoScoring = await tryAutoScoreSubmittedAttemptItem({
      service: this,
      session,
      item,
      visibility,
      payload,
      requestingUser,
      accessContext,
      options
    });

    return {
      session: autoScoring?.session || session,
      item: autoScoring?.item || item,
      autoScoring: autoScoring || null
    };
  },

  async rateAttemptItem(sessionId, itemId, payload = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const session = await getSessionByIdOrThrow(sessionId, visibility, options);
    const item = await getItemByIdOrThrow(itemId, visibility, options);
    if (!idsEqual(item.attemptSessionId, session.id)) {
      throw new Error('Attempt item does not belong to the target session.');
    }
    if (!isAttemptSessionActive(session.status)) {
      throw new Error('Attempt session is not active.');
    }
    if (String(session.attemptType || '').toLowerCase() !== 'skill_practice_run') {
      throw new Error('Difficulty rating is available only for skill practice sessions.');
    }

    const rating = normalizeSelfDifficulty(payload.selfDifficultyRating || payload.rating, '');
    if (!rating) {
      throw new Error('A valid self difficulty rating is required.');
    }

    const eventAt = nowIso();
    const creator = resolveCreator(session.orgId, requestingUser);
    const source = buildSource(payload.source, {
      eventType: 'difficulty_rated',
      defaultIdPrefix: 'PTA-QRATE'
    });
    await assertIdempotency(session.orgId, source, options);

    const event = await appendEvent({
      eventAt,
      orgId: session.orgId,
      userId: session.userId,
      personId: session.personId || '',
      applicantId: session.applicantId || '',
      attemptSessionId: session.id,
      attemptItemId: item.id,
      attemptType: session.attemptType,
      eventType: 'difficulty_rated',
      testVersionId: session.testVersionId || '',
      questionVersionId: item.questionVersionId || '',
      questionType: item.questionType || '',
      skill: item.skill || '',
      questionOrder: cleanNonNegativeInteger(item.questionOrder, 0),
      startedAt: item.startedAt || '',
      finishedAt: item.finishedAt || '',
      feedbackProvidedAt: '',
      timeSpentSeconds: cleanNonNegativeInteger(item.timeSpentSeconds, 0),
      scoreRaw: cleanNumber(item.scoreRaw, 0),
      scoreFinal: cleanNumber(item.scoreFinal, 0),
      maxScore: cleanNumber(item.maxScore, 0),
      percentage: cleanNumber(item.percentage, 0),
      traitScores: isPlainObject(item.traitScores) ? item.traitScores : {},
      selfDifficultyRating: rating,
      responseSummary: isPlainObject(item.responseSummary) ? item.responseSummary : {},
      artifactRefs: [],
      metadata: {
        rating
      },
      collapseKey: 'item',
      source,
      creator,
      audit: {
        createUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        createDateTime: eventAt,
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: eventAt
      }
    }, options);

    const updatedItem = await pteAttemptItemRepository.update(item.id, {
      selfDifficultyRating: rating,
      selfDifficultyRatedAt: eventAt,
      revisionNo: cleanNonNegativeInteger(item.revisionNo, 0) + 1,
      source,
      audit: {
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: eventAt
      }
    }, {
      backendMode: options?.backendMode
    });

    const updatedSession = await pteAttemptSessionRepository.update(session.id, {
      firstEventAt: session.firstEventAt || eventAt,
      lastEventAt: eventAt,
      latestEventType: event.eventType,
      latestEventId: event.id,
      eventCounters: toEventCounters(session.eventCounters || {}, 'difficulty_rated'),
      audit: {
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: eventAt
      }
    }, {
      backendMode: options?.backendMode
    });

    return {
      session: updatedSession,
      item: updatedItem,
      event
    };
  },

  async recordAttemptItemScore(sessionId, itemId, payload = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const session = await getSessionByIdOrThrow(sessionId, visibility, options);
    const item = await getItemByIdOrThrow(itemId, visibility, options);
    if (!idsEqual(item.attemptSessionId, session.id)) {
      throw new Error('Attempt item does not belong to the target session.');
    }
    if (!FINAL_ITEM_STATUSES.has(String(item.status || '').toLowerCase()) && String(item.status || '').toLowerCase() !== 'saved') {
      throw new Error('Attempt item must be submitted before scoring.');
    }

    const eventAt = nowIso();
    const creator = resolveCreator(session.orgId, requestingUser);
    const scoreRaw = cleanNumber(payload.scoreRaw, cleanNumber(item.scoreRaw, 0));
    const maxScore = cleanNumber(payload.maxScore, cleanNumber(item.maxScore, 0));
    const scoreFinal = cleanNumber(payload.scoreFinal, scoreRaw);
    const percentage = maxScore > 0 ? Number(((scoreFinal / maxScore) * 100).toFixed(2)) : cleanNumber(payload.percentage, cleanNumber(item.percentage, 0));
    const traitScores = isPlainObject(payload.traitScores) ? payload.traitScores : (isPlainObject(item.traitScores) ? item.traitScores : {});
    const scoringProfileVersion = cleanNonNegativeInteger(
      payload.scoringProfileVersion,
      cleanNonNegativeInteger(item?.metadata?.scoringProfileVersion, 1)
    );
    const scoringMetadata = isPlainObject(payload.scoringMetadata)
      ? payload.scoringMetadata
      : (isPlainObject(payload?.metadata?.scoring) ? payload.metadata.scoring : null);
    const itemMetadata = isPlainObject(item.metadata) ? item.metadata : {};
    const currentResponseRevision = cleanNonNegativeInteger(itemMetadata.responseRevision, 0);
    const requestedResponseRevision = Object.prototype.hasOwnProperty.call(payload || {}, 'responseRevision')
      ? cleanNonNegativeInteger(payload.responseRevision, 0)
      : currentResponseRevision;
    if (currentResponseRevision > 0 && requestedResponseRevision > 0 && requestedResponseRevision !== currentResponseRevision) {
      throw new Error('This score request is for an older response. Save the latest response before scoring.');
    }
    const responseRevision = currentResponseRevision || requestedResponseRevision;
    const scoreEventType = cleanNumber(item.scoreRevisionCount, 0) > 0 ? 'score_updated' : 'score_recorded';
    const source = buildSource(payload.source, {
      eventType: scoreEventType,
      defaultIdPrefix: 'PTA-QSCORE'
    });
    await assertIdempotency(session.orgId, source, options);

    const event = await appendEvent({
      eventAt,
      orgId: session.orgId,
      userId: session.userId,
      personId: session.personId || '',
      applicantId: session.applicantId || '',
      attemptSessionId: session.id,
      attemptItemId: item.id,
      attemptType: session.attemptType,
      eventType: scoreEventType,
      testVersionId: session.testVersionId || '',
      questionVersionId: item.questionVersionId || '',
      questionType: item.questionType || '',
      skill: item.skill || '',
      questionOrder: cleanNonNegativeInteger(item.questionOrder, 0),
      startedAt: item.startedAt || '',
      finishedAt: item.finishedAt || '',
      feedbackProvidedAt: item.feedbackProvidedAt || '',
      timeSpentSeconds: cleanNonNegativeInteger(item.timeSpentSeconds, 0),
      scoreRaw,
      scoreFinal,
      maxScore,
      percentage,
      traitScores,
      selfDifficultyRating: normalizeSelfDifficulty(item.selfDifficultyRating, ''),
      responseSummary: isPlainObject(item.responseSummary) ? item.responseSummary : {},
      artifactRefs: [],
      metadata: {
        responseRevision,
        scoringProfileVersion,
        scoring: scoringMetadata
          ? {
            responseRevision,
            status: cleanString(scoringMetadata.status, { max: 80, allowEmpty: true }) || '',
            scorerKey: cleanString(scoringMetadata.scorerKey, { max: 120, allowEmpty: true }) || '',
            scorerVersion: cleanString(scoringMetadata.scorerVersion, { max: 120, allowEmpty: true }) || '',
            scoreScale: cleanString(scoringMetadata.scoreScale, { max: 120, allowEmpty: true }) || '',
            provider: isPlainObject(scoringMetadata.provider) ? scoringMetadata.provider : {},
            warnings: Array.isArray(scoringMetadata.warnings) ? scoringMetadata.warnings : []
          }
          : undefined
      },
      collapseKey: 'item',
      source,
      creator,
      audit: {
        createUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        createDateTime: eventAt,
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: eventAt
      }
    }, options);

    const updatedItem = await pteAttemptItemRepository.update(item.id, {
      scoreRaw,
      scoreFinal,
      maxScore,
      percentage,
      traitScores,
      status: String(item.status || '').toLowerCase() === 'feedback_provided' ? 'feedback_provided' : 'scored',
      isCorrect: payload.isCorrect === true ? true : (payload.isCorrect === false ? false : item.isCorrect),
      scoreRevisionCount: cleanNonNegativeInteger(item.scoreRevisionCount, 0) + 1,
      metadata: {
        ...itemMetadata,
        scoringProfileVersion,
        ...(scoringMetadata
          ? {
            scoring: {
              ...(isPlainObject(itemMetadata.scoring) ? itemMetadata.scoring : {}),
              ...scoringMetadata,
              ...(responseRevision > 0 ? { responseRevision } : {})
            }
          }
          : {})
      },
      revisionNo: cleanNonNegativeInteger(item.revisionNo, 0) + 1,
      source,
      audit: {
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: eventAt
      }
    }, {
      backendMode: options?.backendMode
    });

    const summary = await recalculateSessionSummary(session, options);
    const updatedSession = await pteAttemptSessionRepository.update(session.id, {
      ...summary.patch,
      firstEventAt: session.firstEventAt || eventAt,
      lastEventAt: eventAt,
      latestEventType: event.eventType,
      latestEventId: event.id,
      eventCounters: toEventCounters(session.eventCounters || {}, scoreEventType),
      audit: {
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: eventAt
      }
    }, {
      backendMode: options?.backendMode
    });

    return {
      session: updatedSession,
      item: updatedItem,
      event
    };
  },

  async recordAttemptItemFeedback(sessionId, itemId, payload = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext, {
      treatDivisionAsOrg: options?.treatDivisionAsOrg === true
    });
    assertReadableVisibility(visibility);
    const session = await getSessionByIdOrThrow(sessionId, visibility, options);
    const item = await getItemByIdOrThrow(itemId, visibility, options);
    if (!idsEqual(item.attemptSessionId, session.id)) {
      throw new Error('Attempt item does not belong to the target session.');
    }
    const currentItemStatus = cleanString(item.status, { max: 40, allowEmpty: true }).toLowerCase() || 'pending';
    const isPracticeRun = String(session.attemptType || '').toLowerCase() === 'skill_practice_run';
    const allowAnyStarted = options?.allowAnyStarted === true && isPracticeRun;
    if (allowAnyStarted) {
      if (!ITEM_STATUSES.includes(currentItemStatus) || currentItemStatus === 'abandoned') {
        throw new Error('Feedback is not allowed for this attempt item status.');
      }
    } else if (!FINAL_ITEM_STATUSES.has(currentItemStatus) && currentItemStatus !== 'saved') {
      throw new Error('Attempt item must be submitted before feedback.');
    }

    const feedbackText = cleanString(payload.feedback || payload.feedbackText, { max: 20000, allowEmpty: true }) || '';
    const feedbackAt = normalizeIso(payload.feedbackProvidedAt, { allowEmpty: true }) || nowIso();
    const eventAt = nowIso();
    const feedbackEventType = cleanString(item.feedbackProvidedAt, { max: 80, allowEmpty: true }) ? 'feedback_updated' : 'feedback_added';
    const creator = resolveCreator(session.orgId, requestingUser);
    const source = buildSource(payload.source, {
      eventType: feedbackEventType,
      defaultIdPrefix: 'PTA-QFDBK'
    });
    await assertIdempotency(session.orgId, source, options);

    const event = await appendEvent({
      eventAt,
      orgId: session.orgId,
      userId: session.userId,
      personId: session.personId || '',
      applicantId: session.applicantId || '',
      attemptSessionId: session.id,
      attemptItemId: item.id,
      attemptType: session.attemptType,
      eventType: feedbackEventType,
      testVersionId: session.testVersionId || '',
      questionVersionId: item.questionVersionId || '',
      questionType: item.questionType || '',
      skill: item.skill || '',
      questionOrder: cleanNonNegativeInteger(item.questionOrder, 0),
      startedAt: item.startedAt || '',
      finishedAt: item.finishedAt || '',
      feedbackProvidedAt: feedbackAt,
      timeSpentSeconds: cleanNonNegativeInteger(item.timeSpentSeconds, 0),
      scoreRaw: cleanNumber(item.scoreRaw, 0),
      scoreFinal: cleanNumber(item.scoreFinal, 0),
      maxScore: cleanNumber(item.maxScore, 0),
      percentage: cleanNumber(item.percentage, 0),
      traitScores: isPlainObject(item.traitScores) ? item.traitScores : {},
      selfDifficultyRating: normalizeSelfDifficulty(item.selfDifficultyRating, ''),
      responseSummary: isPlainObject(item.responseSummary) ? item.responseSummary : {},
      artifactRefs: [],
      metadata: {
        feedback: feedbackText
      },
      collapseKey: 'item',
      source,
      creator,
      audit: {
        createUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        createDateTime: eventAt,
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: eventAt
      }
    }, options);

    const preserveStatusForActive = options?.preserveStatusForActive === true && isPracticeRun;
    const nextStatus = preserveStatusForActive && ['pending', 'in_progress', 'saved'].includes(currentItemStatus)
      ? currentItemStatus
      : 'feedback_provided';
    const updatedItem = await pteAttemptItemRepository.update(item.id, {
      feedbackProvidedAt: feedbackAt,
      latestFeedback: feedbackText,
      status: nextStatus,
      feedbackRevisionCount: cleanNonNegativeInteger(item.feedbackRevisionCount, 0) + 1,
      revisionNo: cleanNonNegativeInteger(item.revisionNo, 0) + 1,
      source,
      audit: {
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: eventAt
      }
    }, {
      backendMode: options?.backendMode
    });

    const summary = await recalculateSessionSummary(session, options);
    const updatedSession = await pteAttemptSessionRepository.update(session.id, {
      ...summary.patch,
      firstEventAt: session.firstEventAt || eventAt,
      lastEventAt: eventAt,
      latestEventType: event.eventType,
      latestEventId: event.id,
      eventCounters: toEventCounters(session.eventCounters || {}, feedbackEventType),
      audit: {
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: eventAt
      }
    }, {
      backendMode: options?.backendMode
    });

    return {
      session: updatedSession,
      item: updatedItem,
      event
    };
  },

  async submitAttemptSession(sessionId, payload = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    let session = await getSessionByIdOrThrow(sessionId, visibility, options);
    const currentStatus = normalizeSessionStatus(session.status, ACTIVE_SESSION_STATUS);
    if (FINAL_SESSION_STATUSES.has(currentStatus)) {
      throw new Error('Attempt session is already finalized.');
    }
    if (currentStatus !== ACTIVE_SESSION_STATUS) {
      throw new Error('Attempt session is not active.');
    }

    const autoSubmitRemaining = payload.autoSubmitRemaining === true
      || String(payload.autoSubmitRemaining || '').trim().toLowerCase() === 'true';
    const creator = resolveCreator(session.orgId, requestingUser);
    const rows = await pteAttemptItemRepository.list({
      query: { attemptSessionId__eq: session.id },
      scope: { canViewAll: true },
      sort: { questionOrder: 1, id: 1 },
      backendMode: options?.backendMode
    });
    const items = sortItemsByQuestionOrder(rows);
    const pendingItems = items.filter((row) => !FINAL_ITEM_STATUSES.has(String(row?.status || '').toLowerCase()));
    const isPracticeRun = String(session.attemptType || '').toLowerCase() === 'skill_practice_run';

    if (pendingItems.length && !isPracticeRun && !autoSubmitRemaining) {
      throw new Error('Attempt session contains unsubmitted items. Submit all items or enable autoSubmitRemaining.');
    }

    if (!isPracticeRun) {
      for (const item of pendingItems) {
        // eslint-disable-next-line no-await-in-loop
        await this.submitAttemptItem(session.id, item.id, {
          autoSubmit: true,
          source: {
            module: 'pte_attempt_runtime',
            eventType: 'question_auto_submitted',
            eventId: `PTA-AUTOSUB-${session.id}-${item.id}-${Date.now()}`
          }
        }, requestingUser, accessContext, options);
      }
    }

    session = await getSessionByIdOrThrow(session.id, visibility, options);
    const submittedAt = nowIso();
    const submitSource = buildSource(payload.source, {
      eventType: 'attempt_submitted',
      defaultIdPrefix: 'PTA-SUBMIT'
    });
    await assertIdempotency(session.orgId, submitSource, options);
    const submitEvent = await appendEvent({
      eventAt: submittedAt,
      orgId: session.orgId,
      userId: session.userId,
      personId: session.personId || '',
      applicantId: session.applicantId || '',
      attemptSessionId: session.id,
      attemptItemId: '',
      attemptType: session.attemptType,
      eventType: 'attempt_submitted',
      testVersionId: session.testVersionId || '',
      questionVersionId: '',
      questionType: '',
      skill: '',
      questionOrder: 0,
      startedAt: session.startedAt || '',
      finishedAt: '',
      feedbackProvidedAt: '',
      timeSpentSeconds: 0,
      scoreRaw: cleanNumber(session.scoreRaw, 0),
      scoreFinal: cleanNumber(session.scoreFinal, 0),
      maxScore: cleanNumber(session.maxScore, 0),
      percentage: cleanNumber(session.percentage, 0),
      traitScores: {},
      responseSummary: {},
      artifactRefs: [],
      collapseKey: 'session',
      source: submitSource,
      creator,
      audit: {
        createUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        createDateTime: submittedAt,
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: submittedAt
      }
    }, options);

    const finishAt = nowIso();
    const finishSource = buildSource(payload.finishSource || payload.source, {
      eventType: 'attempt_finished',
      defaultIdPrefix: 'PTA-FINISH'
    });
    await assertIdempotency(session.orgId, finishSource, options);
    const finishEvent = await appendEvent({
      eventAt: finishAt,
      orgId: session.orgId,
      userId: session.userId,
      personId: session.personId || '',
      applicantId: session.applicantId || '',
      attemptSessionId: session.id,
      attemptItemId: '',
      attemptType: session.attemptType,
      eventType: 'attempt_finished',
      testVersionId: session.testVersionId || '',
      questionVersionId: '',
      questionType: '',
      skill: '',
      questionOrder: 0,
      startedAt: session.startedAt || '',
      finishedAt: finishAt,
      feedbackProvidedAt: '',
      timeSpentSeconds: cleanNonNegativeInteger(
        payload.timeSpentSeconds,
        calculateTimeSpentSeconds(session.startedAt, finishAt)
      ),
      scoreRaw: cleanNumber(session.scoreRaw, 0),
      scoreFinal: cleanNumber(session.scoreFinal, 0),
      maxScore: cleanNumber(session.maxScore, 0),
      percentage: cleanNumber(session.percentage, 0),
      traitScores: {},
      responseSummary: {},
      artifactRefs: [],
      collapseKey: 'session',
      source: finishSource,
      creator,
      audit: {
        createUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        createDateTime: finishAt,
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: finishAt
      }
    }, options);

    const summary = await recalculateSessionSummary(session, options);
    const updatedSession = await pteAttemptSessionRepository.update(session.id, {
      ...summary.patch,
      status: 'finished',
      submittedAt: submittedAt,
      finishedAt: finishAt,
      firstEventAt: session.firstEventAt || submittedAt,
      lastEventAt: finishAt,
      latestEventType: 'attempt_finished',
      latestEventId: finishEvent.id,
      eventCounters: toEventCounters(
        toEventCounters(session.eventCounters || {}, 'attempt_submitted'),
        'attempt_finished'
      ),
      audit: {
        lastUpdateUser: creator.type === 'system' ? 'System' : (creator.userId || 'System'),
        lastUpdateDateTime: finishAt
      }
    }, {
      backendMode: options?.backendMode
    });

    return {
      session: updatedSession,
      events: {
        submit: submitEvent,
        finish: finishEvent
      }
    };
  },

  async getAttemptSessionDetail(sessionId, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const session = await getSessionByIdOrThrow(sessionId, visibility, options);
    const items = await pteAttemptItemRepository.list({
      query: { attemptSessionId__eq: session.id },
      scope: buildRepositoryScope(visibility),
      sort: { questionOrder: 1, id: 1 },
      backendMode: options?.backendMode
    });
    const includeEvents = options?.includeEvents !== false;
    const includeArtifacts = options?.includeArtifacts !== false;
    const includeLifecycle = options?.includeLifecycle !== false;
    const eventLimit = Math.max(1, Math.min(5000, cleanNonNegativeInteger(options?.eventLimit, 800)));
    const events = includeEvents
      ? await pteAttemptLedgerEventRepository.list({
        query: {
          attemptSessionId__eq: session.id,
          page: 1,
          limit: eventLimit
        },
        scope: buildRepositoryScope(visibility),
        sort: { eventAt: -1, id: -1 },
        backendMode: options?.backendMode
      })
      : [];
    const artifacts = includeArtifacts
      ? await pteAttemptArtifactRepository.list({
        query: { attemptSessionId__eq: session.id },
        scope: buildRepositoryScope(visibility),
        sort: { createdAt: -1, id: -1 },
        backendMode: options?.backendMode
      })
      : [];
    const sortedEvents = attemptLifecycleAnalytics.stableSortEvents(Array.isArray(events) ? events : []);
    const sortedItems = sortItemsByQuestionOrder(items);
    const lifecycle = includeLifecycle
      ? attemptLifecycleAnalytics.buildAttemptLifecycle(
        session,
        sortedItems,
        sortedEvents
      )
      : null;
    return {
      session,
      items: sortedItems,
      events: sortedEvents,
      artifacts: Array.isArray(artifacts) ? artifacts : [],
      lifecycle
    };
  },

  getPracticeFeedbackFilterOptions() {
    return {
      sessionStatuses: ['in_progress', 'submitted', 'finished', 'abandoned'].map((value) => ({
        value,
        label: value.replace(/_/g, ' ')
      })),
      withFeedback: [
        { value: '', label: 'All' },
        { value: 'yes', label: 'With Feedback' },
        { value: 'no', label: 'Without Feedback' }
      ],
      skills: SKILLS.map((value) => ({
        value,
        label: value.charAt(0).toUpperCase() + value.slice(1)
      }))
    };
  },

  async listPracticeFeedbackSessions(rawFilters = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext, { treatDivisionAsOrg: true });
    assertReadableVisibility(visibility);
    const requesterUserId = resolveRequesterUserId(requestingUser);
    const canSelectStudent = canSelectPracticeStudent(requestingUser);
    if (!requesterUserId) {
      throw new Error('Authenticated user context is required.');
    }

    const filters = isPlainObject(rawFilters) ? rawFilters : {};
    const q = cleanString(filters.q || filters.search, { max: 220, allowEmpty: true }) || '';
    const searchType = cleanString(filters.type, { max: 40, allowEmpty: true }).toLowerCase();
    const searchFields = cleanString(filters.searchFields, { max: 400, allowEmpty: true });
    const status = cleanString(filters.status, { max: 40, allowEmpty: true }).toLowerCase();
    const skill = normalizeSkill(filters.skill, '');
    const withFeedback = cleanString(filters.withFeedback, { max: 10, allowEmpty: true }).toLowerCase();
    const userIds = normalizeList(filters.userIds)
      .map((value) => toPublicId(value))
      .filter(Boolean);
    const startDate = cleanString(
      filters.startDate || filters.startedFrom || filters.from || filters.dateFrom || '',
      { max: 80, allowEmpty: true }
    ) || '';
    const endDate = cleanString(
      filters.endDate || filters.startedTo || filters.to || filters.dateTo || '',
      { max: 80, allowEmpty: true }
    ) || '';
    const startMs = toDateMs(startDate);
    const endMs = toDateMs(endDate);
    const requestedPage = Math.max(1, cleanNonNegativeInteger(
      filters.page !== undefined ? filters.page : options?.pagination?.page,
      1
    ) || 1);
    const requestedLimit = Math.max(1, Math.min(200, cleanNonNegativeInteger(
      filters.limit !== undefined ? filters.limit : options?.pagination?.limit,
      30
    ) || 30));

    const listProjection = {
      _id: 0,
      id: 1,
      orgId: 1,
      userId: 1,
      status: 1,
      attemptType: 1,
      totalQuestions: 1,
      submittedQuestions: 1,
      feedbackCount: 1,
      startedAt: 1,
      finishedAt: 1,
      metadata: 1
    };

    const toPagination = (totalItems, page, limit) => {
      const total = Math.max(0, cleanNonNegativeInteger(totalItems, 0));
      const safeLimit = Math.max(1, cleanNonNegativeInteger(limit, 30) || 30);
      const totalPages = Math.max(1, Math.ceil(total / safeLimit) || 1);
      const currentPage = Math.min(Math.max(cleanNonNegativeInteger(page, 1) || 1, 1), totalPages);
      const startIndex = (currentPage - 1) * safeLimit;
      const endIndex = Math.min(startIndex + safeLimit, total);
      return {
        currentPage,
        totalPages,
        totalItems: total,
        limit: safeLimit,
        startItem: total > 0 ? startIndex + 1 : 0,
        endItem: endIndex
      };
    };

    const toSummaryRow = (row, userMap = new Map()) => {
      const rowSkill = normalizeSkill(row?.metadata?.practice?.skill, '');
      const rowPracticeName = cleanString(row?.metadata?.practice?.name, { max: MAX_PTE_SKILL_PRACTICE_NAME_LENGTH, allowEmpty: true }) || '';
      const userRow = userMap.get(toPublicId(row?.userId || '')) || null;
      const userLabel = buildUserDisplayLabel(userRow || { id: row?.userId || '' });
      return {
        id: cleanString(row?.id, { max: 120, allowEmpty: true }) || '',
        practiceName: rowPracticeName,
        orgId: cleanString(row?.orgId, { max: 120, allowEmpty: true }) || '',
        userId: cleanString(row?.userId, { max: 120, allowEmpty: true }) || '',
        userLabel,
        status: cleanString(row?.status, { max: 40, allowEmpty: true }).toLowerCase() || '',
        practiceSkill: rowSkill || '',
        totalQuestions: cleanNonNegativeInteger(row?.totalQuestions, 0),
        submittedQuestions: cleanNonNegativeInteger(row?.submittedQuestions, 0),
        feedbackCount: cleanNonNegativeInteger(row?.feedbackCount, 0),
        startedAt: cleanString(row?.startedAt, { max: 80, allowEmpty: true }) || '',
        finishedAt: cleanString(row?.finishedAt, { max: 80, allowEmpty: true }) || '',
        startedAtDisplay: cleanString(row?.startedAt, { max: 80, allowEmpty: true })
          ? new Date(row.startedAt).toLocaleString()
          : '-',
        finishedAtDisplay: cleanString(row?.finishedAt, { max: 80, allowEmpty: true })
          ? new Date(row.finishedAt).toLocaleString()
          : '-'
      };
    };

    const buildOptionSets = (rows = []) => {
      const statusOptions = Array.from(new Set(
        (Array.isArray(rows) ? rows : [])
          .map((row) => String(row?.status || '').toLowerCase().trim())
          .filter(Boolean)
      ))
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value.replace(/_/g, ' ') }));

      const skillOptions = Array.from(new Set(
        (Array.isArray(rows) ? rows : [])
          .map((row) => String(row?.practiceSkill || '').toLowerCase().trim())
          .filter(Boolean)
      ))
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }));

      return {
        statuses: statusOptions,
        skills: skillOptions
      };
    };

    const query = {
      attemptType__eq: 'skill_practice_run'
    };
    if (status) query.status__eq = status;
    if (skill) query['metadata.practice.skill__eq'] = skill;
    if (!canSelectStudent) {
      query.userId__eq = requesterUserId;
    } else if (userIds.length === 1) {
      query.userId__eq = userIds[0];
    } else if (userIds.length > 1) {
      query.userId__in = userIds.join(',');
    }
    const requiresLegacyFiltering = Boolean(
      q
      || withFeedback === 'yes'
      || withFeedback === 'no'
      || startDate
      || endDate
    );

    const repositoryScope = buildRepositoryScope(visibility);
    const repositorySort = { startedAt: -1, id: -1 };
    const repositoryOptions = {
      scope: repositoryScope,
      sort: repositorySort,
      projection: listProjection,
      backendMode: options?.backendMode
    };

    if (!requiresLegacyFiltering) {
      const countQuery = { ...query };
      const totalItems = await pteAttemptSessionRepository.count({
        query: countQuery,
        scope: repositoryScope,
        backendMode: options?.backendMode
      });
      const pagination = toPagination(totalItems, requestedPage, requestedLimit);
      const rowsRaw = await pteAttemptSessionRepository.list({
        ...repositoryOptions,
        query,
        pagination: {
          page: pagination.currentPage,
          limit: pagination.limit
        }
      });

      const rows = (Array.isArray(rowsRaw) ? rowsRaw : [])
        .filter((row) => String(row?.attemptType || '').toLowerCase() === 'skill_practice_run');
      const resolvedUserIds = Array.from(new Set(
        rows.map((row) => toPublicId(row?.userId || '')).filter(Boolean)
      ));
      const userRows = resolvedUserIds.length
        ? await dataService.fetchData(
          'users',
          {
            id__in: resolvedUserIds.join(','),
            limit: Math.max(resolvedUserIds.length, 200)
          },
          requestingUser,
          options?.backendMode ? { backendMode: options.backendMode } : {}
        )
        : [];
      const userMap = new Map((Array.isArray(userRows) ? userRows : []).map((row) => [toPublicId(row?.id || ''), row]));
      const enriched = rows.map((row) => toSummaryRow(row, userMap));
      return {
        rows: enriched,
        pagination,
        optionSets: buildOptionSets(enriched)
      };
    }

    let rowsRaw = await pteAttemptSessionRepository.list({
      ...repositoryOptions,
      query
    });

    rowsRaw = (Array.isArray(rowsRaw) ? rowsRaw : [])
      .filter((row) => String(row?.attemptType || '').toLowerCase() === 'skill_practice_run');

    if (withFeedback === 'yes') {
      rowsRaw = rowsRaw.filter((row) => cleanNonNegativeInteger(row?.feedbackCount, 0) > 0);
    } else if (withFeedback === 'no') {
      rowsRaw = rowsRaw.filter((row) => cleanNonNegativeInteger(row?.feedbackCount, 0) <= 0);
    }
    if (startMs !== null || endMs !== null) {
      rowsRaw = rowsRaw.filter((row) => {
        const startedAtMs = toDateMs(row?.startedAt || '');
        if (startedAtMs === null) return startMs === null;
        if (startMs !== null && startedAtMs < startMs) return false;
        if (endMs !== null && startedAtMs > endMs) return false;
        return true;
      });
    }

    let filteredRows = rowsRaw;
    let filteredEnrichedRows = [];
    if (q) {
      const resolvedUserIds = Array.from(new Set(
        rowsRaw.map((row) => toPublicId(row?.userId || '')).filter(Boolean)
      ));
      const userRows = resolvedUserIds.length
        ? await dataService.fetchData(
          'users',
          {
            id__in: resolvedUserIds.join(','),
            limit: Math.max(resolvedUserIds.length, 200)
          },
          requestingUser,
          options?.backendMode ? { backendMode: options.backendMode } : {}
        )
        : [];
      const userMap = new Map((Array.isArray(userRows) ? userRows : []).map((row) => [toPublicId(row?.id || ''), row]));
      const enrichedRows = rowsRaw.map((row) => toSummaryRow(row, userMap));
      const searchQuery = {
        q,
        ...(searchType ? { type: searchType } : {}),
        ...(searchFields ? { searchFields } : {})
      };
      filteredEnrichedRows = applyGenericFilter(enrichedRows, searchQuery, {
        defaultSearchFields: PRACTICE_FEEDBACK_SEARCH_FIELDS,
        dateFields: ['startedAt', 'finishedAt']
      });
      filteredRows = filteredEnrichedRows;
    }

    const pagination = toPagination(filteredRows.length, requestedPage, requestedLimit);
    const startIndex = pagination.startItem > 0 ? pagination.startItem - 1 : 0;
    const endIndex = pagination.endItem;
    let pagedRows = [];

    if (q) {
      pagedRows = filteredEnrichedRows.slice(startIndex, endIndex);
    } else {
      const pageSourceRows = filteredRows.slice(startIndex, endIndex);
      const pageUserIds = Array.from(new Set(
        pageSourceRows.map((row) => toPublicId(row?.userId || '')).filter(Boolean)
      ));
      const pageUserRows = pageUserIds.length
        ? await dataService.fetchData(
          'users',
          {
            id__in: pageUserIds.join(','),
            limit: Math.max(pageUserIds.length, 200)
          },
          requestingUser,
          options?.backendMode ? { backendMode: options.backendMode } : {}
        )
        : [];
      const pageUserMap = new Map((Array.isArray(pageUserRows) ? pageUserRows : []).map((row) => [toPublicId(row?.id || ''), row]));
      pagedRows = pageSourceRows.map((row) => toSummaryRow(row, pageUserMap));
    }

    return {
      rows: pagedRows,
      pagination,
      optionSets: buildOptionSets(q ? filteredEnrichedRows : filteredRows.map((row) => ({
        status: cleanString(row?.status, { max: 40, allowEmpty: true }).toLowerCase() || '',
        practiceSkill: normalizeSkill(row?.metadata?.practice?.skill, '') || ''
      })))
    };
  },

  async getPracticeFeedbackSessionDetail(sessionId, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext, { treatDivisionAsOrg: true });
    assertReadableVisibility(visibility);
    const requesterUserId = resolveRequesterUserId(requestingUser);
    const canSelectStudent = canSelectPracticeStudent(requestingUser);
    if (!requesterUserId) {
      throw new Error('Authenticated user context is required.');
    }

    const session = await getSessionByIdOrThrow(sessionId, visibility, options);
    if (String(session.attemptType || '').toLowerCase() !== 'skill_practice_run') {
      throw new Error('The selected session is not a skill practice run.');
    }
    if (!canSelectStudent && !idsEqual(session?.userId, requesterUserId)) {
      throw new Error('Attempt session is not accessible.');
    }

    const [itemsRaw, artifactsRaw] = await Promise.all([
      pteAttemptItemRepository.list({
        query: { attemptSessionId__eq: session.id },
        scope: buildRepositoryScope(visibility),
        sort: { questionOrder: 1, id: 1 },
        backendMode: options?.backendMode
      }),
      pteAttemptArtifactRepository.list({
        query: { attemptSessionId__eq: session.id },
        scope: buildRepositoryScope(visibility),
        sort: { createdAt: -1, id: -1 },
        backendMode: options?.backendMode
      })
    ]);

    const items = sortItemsByQuestionOrder(itemsRaw);
    const artifacts = Array.isArray(artifactsRaw) ? artifactsRaw : [];
    const artifactMap = new Map();
    artifacts.forEach((artifact) => {
      const key = cleanString(artifact?.attemptItemId, { max: 120, allowEmpty: true }) || '';
      if (!key) return;
      if (!artifactMap.has(key)) artifactMap.set(key, []);
      artifactMap.get(key).push(artifact);
    });

    const questionIds = Array.from(new Set(
      items.map((row) => cleanString(row?.questionVersionId, { max: 120, allowEmpty: true }) || '').filter(Boolean)
    ));
    const sessionOrgId = cleanString(session.orgId, { max: 120, allowEmpty: true }) || '';
    const questionRows = questionIds.length
      ? await pteQuestionVersionRepository.list({
        query: {
          id__in: questionIds.join(','),
          ...(sessionOrgId ? { orgId__eq: sessionOrgId } : {})
        },
        scope: { canViewAll: true },
        backendMode: options?.backendMode
      })
      : [];
    const questionMap = new Map((Array.isArray(questionRows) ? questionRows : []).map((row) => [cleanString(row?.id, { max: 120, allowEmpty: true }) || '', row]));

    const sessionUserId = cleanString(session.userId, { max: 120, allowEmpty: true }) || '';
    const userRows = sessionUserId
      ? await dataService.fetchData(
        'users',
        { id__eq: sessionUserId, limit: 1 },
        requestingUser,
        options?.backendMode ? { backendMode: options.backendMode } : {}
      )
      : [];
    const userRow = Array.isArray(userRows) ? userRows[0] : null;

    return {
      session,
      userLabel: buildUserDisplayLabel(userRow || { id: session.userId || '' }),
      items: items.map((item) => ({
        ...item,
        latestFeedbackText: stripHtmlTags(item?.latestFeedback || ''),
        question: resolveQuestionForAttemptItem(item, questionMap),
        artifacts: artifactMap.get(cleanString(item?.id, { max: 120, allowEmpty: true }) || '') || []
      }))
    };
  },

  async savePracticeItemFeedback(sessionId, itemId, payload = {}, requestingUser, accessContext = {}, options = {}) {
    return this.recordAttemptItemFeedback(
      sessionId,
      itemId,
      payload,
      requestingUser,
      accessContext,
      {
        ...options,
        allowAnyStarted: true,
        preserveStatusForActive: true,
        treatDivisionAsOrg: true
      }
    );
  },

  async generatePracticeSessionDetailedFeedback(sessionId, requestingUser, accessContext = {}, options = {}) {
    const detail = await this.getPracticeFeedbackSessionDetail(
      sessionId,
      requestingUser,
      accessContext,
      options
    );
    const session = isPlainObject(detail?.session) ? detail.session : {};
    const digests = (Array.isArray(detail?.items) ? detail.items : [])
      .map((item, index) => buildPracticeFeedbackItemDigest(item, index));
    if (!digests.length) {
      throw new Error('No question data found in this session to generate detailed feedback.');
    }

    const prompt = buildPracticeDetailedFeedbackPrompt({
      session,
      userLabel: cleanString(detail?.userLabel, { max: 240, allowEmpty: true }) || '',
      digests
    });

    let generatedText = '';
    let providerMeta = null;
    const warnings = [];

    try {
      const runtimeProvider = await pteAiProviderDataService.resolveRuntimeProvider(
        requestingUser,
        accessContext,
        options
      );
      const aiResult = await pteAiProviderService.sendTextPrompt({
        systemPrompt: 'You are a strict, evidence-grounded PTE coach. Never invent details not present in the provided evidence.',
        prompt,
        providerId: runtimeProvider.providerId,
        modelId: runtimeProvider.modelId || null,
        credentials: runtimeProvider.credentials || {},
        generationConfig: {
          temperature: 0.2,
          topP: 1,
          maxOutputTokens: 3500
        },
        disableCache: true,
        requestLabel: 'pte-practice-detailed-feedback',
        timeoutMs: 120000,
        usageContext: {
          requestingUser,
          section: SECTIONS.PTE_FEEDBACK_ON_PRACTICE,
          operation: OPERATIONS.CREATE,
          objectId: cleanString(session?.id, { max: 160, allowEmpty: true }) || `DRAFT:${cleanString(sessionId, { max: 120, allowEmpty: true }) || 'session'}`,
          requestLabel: 'pte-practice-detailed-feedback',
          providerRecordId: cleanString(runtimeProvider?.providerRecord?.id, { max: 160, allowEmpty: true }) || '',
          providerRecordName: cleanString(runtimeProvider?.providerRecord?.name, { max: 220, allowEmpty: true }) || '',
          source: {
            module: 'pte_feedback_practice',
            eventType: 'generate_detailed_feedback'
          }
        }
      });
      generatedText = cleanString(aiResult?.text, { max: 100000, allowEmpty: true }) || '';
      providerMeta = {
        providerId: cleanString(aiResult?.provider || runtimeProvider.providerId, { max: 80, allowEmpty: true }) || '',
        modelUsed: cleanString(aiResult?.modelUsed || runtimeProvider.modelId, { max: 220, allowEmpty: true }) || '',
        providerRecordId: cleanString(runtimeProvider?.providerRecord?.id, { max: 160, allowEmpty: true }) || '',
        providerRecordName: cleanString(runtimeProvider?.providerRecord?.name, { max: 220, allowEmpty: true }) || '',
        tokenUsage: isPlainObject(aiResult?.usage) ? {
          promptTokenCount: parseOptionalNumber(aiResult.usage.promptTokenCount),
          candidatesTokenCount: parseOptionalNumber(aiResult.usage.candidatesTokenCount),
          totalTokenCount: parseOptionalNumber(aiResult.usage.totalTokenCount),
          cachedContentTokenCount: parseOptionalNumber(aiResult.usage.cachedContentTokenCount)
        } : null
      };
      if (!generatedText) {
        warnings.push('AI provider returned an empty response, so deterministic fallback feedback was generated.');
      }
    } catch (error) {
      warnings.push(`AI generation was unavailable (${cleanString(error?.message || error, { max: 500, allowEmpty: true }) || 'unknown error'}). Deterministic fallback feedback was generated.`);
    }

    if (!generatedText) {
      generatedText = buildDeterministicPracticeFeedbackReport({
        session,
        userLabel: detail?.userLabel,
        digests
      });
    }

    return {
      sessionId: cleanString(session?.id || sessionId, { max: 120, allowEmpty: true }) || '',
      userLabel: cleanString(detail?.userLabel, { max: 240, allowEmpty: true }) || '',
      feedback: generatedText,
      provider: providerMeta,
      warnings,
      evidenceSummary: {
        questionCount: digests.length,
        questionTypes: Array.from(new Set(digests.map((row) => row.questionType).filter(Boolean))),
        skills: Array.from(new Set(digests.map((row) => row.skill).filter(Boolean)))
      },
      generatedAt: nowIso()
    };
  },

  async savePracticeSessionDetailedFeedback(sessionId, payload = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext, { treatDivisionAsOrg: true });
    assertReadableVisibility(visibility);
    const session = await getSessionByIdOrThrow(sessionId, visibility, options);
    if (String(session.attemptType || '').toLowerCase() !== 'skill_practice_run') {
      throw new Error('The selected session is not a skill practice run.');
    }

    const feedbackText = cleanString(payload?.feedback || payload?.text, { max: 100000, allowEmpty: true }) || '';
    if (!feedbackText) {
      throw new Error('Detailed feedback text is required before saving.');
    }

    const now = nowIso();
    const generatedAt = normalizeIso(payload?.generatedAt, { allowEmpty: true }) || now;
    const sourceWarnings = Array.isArray(payload?.warnings)
      ? payload.warnings
      : [];
    const warnings = sourceWarnings
      .map((row) => cleanString(row, { max: 500, allowEmpty: true }))
      .filter(Boolean)
      .slice(0, 12);

    const sourceProvider = isPlainObject(payload?.provider) ? payload.provider : {};
    const provider = {
      providerId: cleanString(sourceProvider.providerId, { max: 80, allowEmpty: true }) || '',
      modelUsed: cleanString(sourceProvider.modelUsed, { max: 220, allowEmpty: true }) || '',
      providerRecordId: cleanString(sourceProvider.providerRecordId, { max: 160, allowEmpty: true }) || '',
      providerRecordName: cleanString(sourceProvider.providerRecordName, { max: 220, allowEmpty: true }) || '',
      tokenUsage: isPlainObject(sourceProvider.tokenUsage) ? {
        promptTokenCount: parseOptionalNumber(sourceProvider.tokenUsage.promptTokenCount),
        candidatesTokenCount: parseOptionalNumber(sourceProvider.tokenUsage.candidatesTokenCount),
        totalTokenCount: parseOptionalNumber(sourceProvider.tokenUsage.totalTokenCount),
        cachedContentTokenCount: parseOptionalNumber(sourceProvider.tokenUsage.cachedContentTokenCount)
      } : null
    };

    const sourceEvidence = isPlainObject(payload?.evidenceSummary) ? payload.evidenceSummary : {};
    const evidenceSummary = {
      questionCount: cleanNonNegativeInteger(sourceEvidence.questionCount, 0),
      questionTypes: Array.isArray(sourceEvidence.questionTypes)
        ? sourceEvidence.questionTypes
            .map((row) => cleanString(row, { max: 120, allowEmpty: true }).toLowerCase())
            .filter(Boolean)
            .slice(0, 60)
        : [],
      skills: Array.isArray(sourceEvidence.skills)
        ? sourceEvidence.skills
            .map((row) => normalizeSkill(row, ''))
            .filter(Boolean)
            .slice(0, 20)
        : []
    };

    const existingMetadata = isPlainObject(session?.metadata) ? session.metadata : {};
    const existingDetailed = isPlainObject(existingMetadata?.practiceDetailedFeedback)
      ? existingMetadata.practiceDetailedFeedback
      : {};
    const savedByUserId = toPublicId(requestingUser?.id || '') || '';
    const savedByUserLabel = buildUserDisplayLabel(requestingUser || {});
    const revisionNo = cleanNonNegativeInteger(existingDetailed?.revisionNo, 0) + 1;

    const nextDetailed = {
      text: feedbackText,
      generatedAt,
      provider,
      warnings,
      evidenceSummary,
      savedAt: now,
      savedByUserId,
      savedByUserLabel,
      revisionNo
    };

    const updatedSession = await pteAttemptSessionRepository.update(session.id, {
      metadata: {
        ...existingMetadata,
        practiceDetailedFeedback: nextDetailed
      },
      audit: {
        lastUpdateUser: savedByUserId || 'System',
        lastUpdateDateTime: now
      }
    }, {
      backendMode: options?.backendMode
    });

    return {
      session: updatedSession,
      savedDetailedFeedback: nextDetailed
    };
  },

  async getMyAnalytics(requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);
    const userId = toPublicId(requestingUser?.id || '');
    if (!userId) throw new Error('Authenticated user context is required.');
    const orgId = visibility.activeOrgId;

    const fromIso = normalizeIso(options?.from || options?.dateFrom, { allowEmpty: true }) || '';
    const toIso = normalizeIso(options?.to || options?.dateTo, { allowEmpty: true }) || '';

    const itemsRaw = await pteAttemptItemRepository.list({
      query: {
        orgId__eq: orgId,
        userId__eq: userId
      },
      scope: { canViewAll: true },
      sort: { finishedAt: -1, submittedAt: -1, id: -1 },
      backendMode: options?.backendMode
    });

    const items = (Array.isArray(itemsRaw) ? itemsRaw : []).filter((row) => {
      const ts = cleanString(row?.finishedAt || row?.submittedAt || row?.startedAt, { max: 80, allowEmpty: true });
      if (!ts) return true;
      const ms = Date.parse(ts);
      if (!Number.isFinite(ms)) return true;
      if (fromIso && ms < Date.parse(fromIso)) return false;
      if (toIso && ms > Date.parse(toIso)) return false;
      return true;
    });

    const submittedItems = items.filter((row) => FINAL_ITEM_STATUSES.has(String(row?.status || '').toLowerCase()));
    const totalItems = items.length;
    const submittedCount = submittedItems.length;
    const avgPercentage = submittedItems.length
      ? Number((submittedItems.reduce((sum, row) => sum + cleanNumber(row?.percentage, 0), 0) / submittedItems.length).toFixed(2))
      : 0;
    const timedItems = submittedItems.filter((row) => cleanNonNegativeInteger(row?.timeSpentSeconds, 0) > 0);
    const avgTimeSeconds = timedItems.length
      ? Number((timedItems.reduce((sum, row) => sum + cleanNonNegativeInteger(row?.timeSpentSeconds, 0), 0) / timedItems.length).toFixed(2))
      : 0;

    const correctnessItems = submittedItems.filter((row) => row?.isCorrect === true || row?.isCorrect === false);
    const accuracy = correctnessItems.length
      ? Number(((correctnessItems.filter((row) => row?.isCorrect === true).length / correctnessItems.length) * 100).toFixed(2))
      : 0;

    const latencyRows = submittedItems.filter((row) => row?.submittedAt && row?.feedbackProvidedAt);
    const feedbackLatencySecondsAvg = latencyRows.length
      ? Number((
        latencyRows.reduce((sum, row) => {
          const diff = calculateTimeSpentSeconds(row.submittedAt, row.feedbackProvidedAt);
          return sum + diff;
        }, 0) / latencyRows.length
      ).toFixed(2))
      : 0;

    const bySkillMap = new Map();
    submittedItems.forEach((row) => {
      const key = normalizeSkill(row?.skill, '') || 'unknown';
      if (!bySkillMap.has(key)) {
        bySkillMap.set(key, {
          skill: key,
          itemCount: 0,
          totalPercentage: 0,
          totalTime: 0,
          timedCount: 0
        });
      }
      const bucket = bySkillMap.get(key);
      bucket.itemCount += 1;
      bucket.totalPercentage += cleanNumber(row?.percentage, 0);
      const time = cleanNonNegativeInteger(row?.timeSpentSeconds, 0);
      if (time > 0) {
        bucket.totalTime += time;
        bucket.timedCount += 1;
      }
    });

    const bySkill = Array.from(bySkillMap.values()).map((row) => ({
      skill: row.skill,
      itemCount: row.itemCount,
      averagePercentage: row.itemCount ? Number((row.totalPercentage / row.itemCount).toFixed(2)) : 0,
      averageTimeSeconds: row.timedCount ? Number((row.totalTime / row.timedCount).toFixed(2)) : 0
    })).sort((a, b) => a.averagePercentage - b.averagePercentage);

    const byTypeMap = new Map();
    submittedItems.forEach((row) => {
      const key = cleanString(row?.questionType, { max: 120, allowEmpty: true }).toLowerCase() || 'unknown';
      if (!byTypeMap.has(key)) {
        byTypeMap.set(key, {
          questionType: key,
          itemCount: 0,
          totalPercentage: 0
        });
      }
      const bucket = byTypeMap.get(key);
      bucket.itemCount += 1;
      bucket.totalPercentage += cleanNumber(row?.percentage, 0);
    });
    const byQuestionType = Array.from(byTypeMap.values()).map((row) => ({
      questionType: row.questionType,
      itemCount: row.itemCount,
      averagePercentage: row.itemCount ? Number((row.totalPercentage / row.itemCount).toFixed(2)) : 0
    })).sort((a, b) => a.averagePercentage - b.averagePercentage);

    const trendRows = submittedItems
      .map((row) => ({
        percentage: cleanNumber(row?.percentage, 0),
        ts: cleanString(row?.finishedAt || row?.submittedAt || row?.startedAt, { max: 80, allowEmpty: true }) || ''
      }))
      .sort((a, b) => a.ts.localeCompare(b.ts));
    let trend = {
      olderAverage: 0,
      recentAverage: 0,
      delta: 0
    };
    if (trendRows.length >= 4) {
      const pivot = Math.floor(trendRows.length / 2);
      const older = trendRows.slice(0, pivot);
      const recent = trendRows.slice(pivot);
      const olderAverage = older.length ? Number((older.reduce((sum, row) => sum + row.percentage, 0) / older.length).toFixed(2)) : 0;
      const recentAverage = recent.length ? Number((recent.reduce((sum, row) => sum + row.percentage, 0) / recent.length).toFixed(2)) : 0;
      trend = {
        olderAverage,
        recentAverage,
        delta: Number((recentAverage - olderAverage).toFixed(2))
      };
    }

    const timedPercentRows = submittedItems
      .filter((row) => cleanNonNegativeInteger(row?.timeSpentSeconds, 0) > 0)
      .map((row) => ({
        time: cleanNonNegativeInteger(row?.timeSpentSeconds, 0),
        percentage: cleanNumber(row?.percentage, 0)
      }));
    const paceBuckets = {
      fast_low: 0,
      fast_high: 0,
      mid_low: 0,
      mid_high: 0,
      slow_low: 0,
      slow_high: 0
    };
    if (timedPercentRows.length) {
      const sortedTimes = timedPercentRows.map((row) => row.time).sort((a, b) => a - b);
      const medianTime = sortedTimes[Math.floor(sortedTimes.length / 2)] || 0;
      timedPercentRows.forEach((row) => {
        const speed = row.time <= (medianTime * 0.8)
          ? 'fast'
          : (row.time >= (medianTime * 1.2) ? 'slow' : 'mid');
        const score = row.percentage >= 70 ? 'high' : 'low';
        const key = `${speed}_${score}`;
        if (Object.prototype.hasOwnProperty.call(paceBuckets, key)) {
          paceBuckets[key] += 1;
        }
      });
    }

    const weakSkills = bySkill.filter((row) => row.itemCount > 0).slice(0, 3);
    const weakQuestionTypes = byQuestionType.filter((row) => row.itemCount > 0).slice(0, 5);
    const roadmap = buildRoadmapHints({
      weakSkills,
      weakQuestionTypes,
      trendDelta: trend.delta,
      paceBuckets
    });

    return {
      generatedAt: nowIso(),
      orgId,
      userId,
      filters: {
        from: fromIso || '',
        to: toIso || ''
      },
      summary: {
        totalItems,
        submittedCount,
        averagePercentage: avgPercentage,
        averageTimeSeconds: avgTimeSeconds,
        accuracyPercentage: accuracy,
        feedbackLatencySecondsAvg
      },
      bySkill,
      byQuestionType,
      trend,
      paceBuckets,
      roadmap
    };
  },

  async getPracticeOverview(requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const scope = buildPracticeQuestionScope(visibility);
    const questionRowsRaw = await pteQuestionVersionRepository.list({
      query: {
        status__eq: 'published'
      },
      scope,
      sort: { skill: 1, questionType: 1, 'audit.createDateTime': -1 },
      backendMode: options?.backendMode
    });

    let questionRows = (Array.isArray(questionRowsRaw) ? questionRowsRaw : [])
      .filter((row) => isPracticeQuestionVisibleRow(row, visibility))
      .filter((row) => String(row?.status || '').toLowerCase() === 'published')
      .filter((row) => row?.practiceEnabled !== false);

    if (visibility?.activeOrgId) {
      questionRows = questionRows.filter((row) => idsEqual(row?.orgId, visibility.activeOrgId));
    }

    const bySkill = SKILLS.map((skill) => {
      const rows = questionRows.filter((row) => normalizeSkill(row?.skill, '') === skill);
      const typeCounter = new Map();
      rows.forEach((row) => {
        const questionType = cleanString(row?.questionType, { max: 120, allowEmpty: true }).toLowerCase() || 'unknown';
        typeCounter.set(questionType, (typeCounter.get(questionType) || 0) + 1);
      });
      const questionTypes = Array.from(typeCounter.entries())
        .map(([questionType, count]) => ({ questionType, count }))
        .sort((a, b) => b.count - a.count || a.questionType.localeCompare(b.questionType));
      return {
        skill,
        availableQuestionCount: rows.length,
        availableQuestionTypes: questionTypes.length,
        questionTypes
      };
    });

    const byQuestionTypeMap = new Map();
    questionRows.forEach((row) => {
      const questionType = cleanString(row?.questionType, { max: 120, allowEmpty: true }).toLowerCase() || 'unknown';
      const skill = normalizeSkill(row?.skill, '') || 'unknown';
      const key = `${skill}::${questionType}`;
      const existing = byQuestionTypeMap.get(key) || {
        skill,
        questionType,
        count: 0
      };
      existing.count += 1;
      byQuestionTypeMap.set(key, existing);
    });

    const questionTypeStats = Array.from(byQuestionTypeMap.values())
      .sort((a, b) => b.count - a.count || a.questionType.localeCompare(b.questionType));

    const requesterUserId = toPublicId(requestingUser?.id || '');
    const recentSessionsRaw = requesterUserId
      ? await pteAttemptSessionRepository.list({
        query: {
          ...(visibility.activeOrgId ? { orgId__eq: visibility.activeOrgId } : {}),
          userId__eq: requesterUserId,
          attemptType__eq: 'skill_practice_run',
          page: 1,
          limit: 25
        },
        scope: { canViewAll: true },
        sort: { startedAt: -1, id: -1 },
        backendMode: options?.backendMode
      })
      : [];
    const recentSessions = (Array.isArray(recentSessionsRaw) ? recentSessionsRaw : [])
      .map((row) => ({
        id: cleanString(row?.id, { max: 120, allowEmpty: true }) || '',
        practiceName: cleanString(row?.metadata?.practice?.name, { max: MAX_PTE_SKILL_PRACTICE_NAME_LENGTH, allowEmpty: true }) || '',
        status: cleanString(row?.status, { max: 40, allowEmpty: true }).toLowerCase() || '',
        startedAt: cleanString(row?.startedAt, { max: 80, allowEmpty: true }) || '',
        finishedAt: cleanString(row?.finishedAt, { max: 80, allowEmpty: true }) || '',
        totalQuestions: cleanNonNegativeInteger(row?.totalQuestions, 0),
        submittedQuestions: cleanNonNegativeInteger(row?.submittedQuestions, 0),
        percentage: cleanNumber(row?.percentage, 0),
        averageTimePerQuestionSeconds: cleanNumber(row?.averageTimePerQuestionSeconds, 0)
      }));

    let analytics = null;
    if (requesterUserId) {
      try {
        analytics = await this.getMyAnalytics(requestingUser, accessContext, options);
      } catch (_) {
        analytics = null;
      }
    }

    return {
      generatedAt: nowIso(),
      orgId: visibility.activeOrgId || '',
      userId: requesterUserId || '',
      totalPracticeEnabledQuestions: questionRows.length,
      skills: bySkill,
      questionTypeStats,
      analytics,
      recentSessions
    };
  },

  getMyPracticeAttemptsFilterOptions() {
    return {
      statuses: ['in_progress', 'submitted', 'finished', 'abandoned'].map((value) => ({
        value,
        label: value.replace(/_/g, ' ')
      })),
      skills: SKILLS.map((value) => ({
        value,
        label: value.charAt(0).toUpperCase() + value.slice(1)
      })),
      feedbackStates: [
        { value: '', label: 'All' },
        { value: 'with_feedback', label: 'With Feedback' },
        { value: 'without_feedback', label: 'Without Feedback' },
        { value: 'unread_feedback', label: 'Unread Feedback' }
      ]
    };
  },

  async listMyPracticeAttempts(rawFilters = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const requesterUserId = resolveRequesterUserId(requestingUser);
    if (!requesterUserId) {
      throw new Error('Authenticated user context is required.');
    }
    const activeOrgId = resolveActiveOrgId(requestingUser);
    const allowCrossOrg = adminChekersService.isSuperAdmin(requestingUser) && !activeOrgId;
    if (!activeOrgId && !allowCrossOrg) {
      throw new Error('No active organization context found.');
    }
    const canSelectStudent = canSelectPracticeStudent(requestingUser);

    const filters = isPlainObject(rawFilters) ? rawFilters : {};
    const q = cleanString(filters.q || filters.search, { max: 220, allowEmpty: true }) || '';
    const status = cleanString(filters.status, { max: 40, allowEmpty: true }).toLowerCase();
    const skill = normalizeSkill(filters.skill, '');
    const feedbackState = cleanString(filters.feedbackState || filters.withFeedback, { max: 30, allowEmpty: true }).toLowerCase();
    const selectedUserId = toPublicId(filters.userId || filters.studentId || '');
    const startedFrom = cleanString(filters.startedFrom || filters.from || filters.startDate || '', { max: 80, allowEmpty: true }) || '';
    const startedTo = cleanString(filters.startedTo || filters.to || filters.endDate || '', { max: 80, allowEmpty: true }) || '';
    const startMs = toDateMs(filters.startedFrom || filters.from || filters.startDate || '');
    const endMs = toDateMs(filters.startedTo || filters.to || filters.endDate || '');
    const requestedPage = Math.max(1, cleanNonNegativeInteger(
      filters.page !== undefined ? filters.page : options?.pagination?.page,
      1
    ) || 1);
    const requestedLimit = Math.max(1, Math.min(200, cleanNonNegativeInteger(
      filters.limit !== undefined ? filters.limit : options?.pagination?.limit,
      30
    ) || 30));

    const sessionQuery = {
      attemptType__eq: 'skill_practice_run',
      ...(activeOrgId ? { orgId__eq: activeOrgId } : {})
    };
    if (!canSelectStudent) {
      sessionQuery.userId__eq = requesterUserId;
    }
    if (canSelectStudent && selectedUserId) {
      sessionQuery.userId__eq = selectedUserId;
    }
    if (status) sessionQuery.status__eq = status;
    if (skill) sessionQuery['metadata.practice.skill__eq'] = skill;

    const toPagination = (totalItems, page, limit) => {
      const total = Math.max(0, cleanNonNegativeInteger(totalItems, 0));
      const safeLimit = Math.max(1, cleanNonNegativeInteger(limit, 30) || 30);
      const totalPages = Math.max(1, Math.ceil(total / safeLimit) || 1);
      const currentPage = Math.min(Math.max(cleanNonNegativeInteger(page, 1) || 1, 1), totalPages);
      const startIndex = (currentPage - 1) * safeLimit;
      const endIndex = Math.min(startIndex + safeLimit, total);
      return {
        currentPage,
        totalPages,
        totalItems: total,
        limit: safeLimit,
        startItem: total > 0 ? startIndex + 1 : 0,
        endItem: endIndex
      };
    };

    const requiresLegacyFiltering = Boolean(q || feedbackState || startedFrom || startedTo);
    if (!requiresLegacyFiltering) {
      const sessionProjection = {
        _id: 0,
        id: 1,
        orgId: 1,
        userId: 1,
        status: 1,
        attemptType: 1,
        startedAt: 1,
        finishedAt: 1,
        submittedQuestions: 1,
        totalQuestions: 1,
        percentage: 1,
        averageTimePerQuestionSeconds: 1,
        feedbackCount: 1,
        metadata: 1
      };
      const repositoryScope = { canViewAll: true };
      const repositorySort = { startedAt: -1, id: -1 };
      const totalItems = await pteAttemptSessionRepository.count({
        query: sessionQuery,
        scope: repositoryScope,
        backendMode: options?.backendMode
      });
      const pagination = toPagination(totalItems, requestedPage, requestedLimit);
      const sessionsRaw = await pteAttemptSessionRepository.list({
        query: sessionQuery,
        scope: repositoryScope,
        sort: repositorySort,
        projection: sessionProjection,
        pagination: {
          page: pagination.currentPage,
          limit: pagination.limit
        },
        backendMode: options?.backendMode
      });
      const sessions = (Array.isArray(sessionsRaw) ? sessionsRaw : [])
        .filter((row) => String(row?.attemptType || '').toLowerCase() === 'skill_practice_run');

      let studentOptions = [];
      if (canSelectStudent) {
        const candidateSessionsRaw = await pteAttemptSessionRepository.list({
          query: {
            attemptType__eq: 'skill_practice_run',
            ...(activeOrgId ? { orgId__eq: activeOrgId } : {})
          },
          scope: repositoryScope,
          sort: repositorySort,
          projection: { _id: 0, userId: 1 },
          backendMode: options?.backendMode
        });
        const candidateUserIds = Array.from(new Set(
          (Array.isArray(candidateSessionsRaw) ? candidateSessionsRaw : [])
            .map((row) => toPublicId(row?.userId || ''))
            .filter(Boolean)
        ));
        const studentRows = candidateUserIds.length
          ? await dataService.fetchData(
            'users',
            {
              id__in: candidateUserIds.join(','),
              limit: Math.max(candidateUserIds.length, 300)
            },
            requestingUser,
            options?.backendMode ? { backendMode: options.backendMode } : {}
          )
          : [];
        const userMap = new Map((Array.isArray(studentRows) ? studentRows : []).map((row) => [toPublicId(row?.id || ''), row]));
        studentOptions = candidateUserIds
          .map((userId) => ({
            value: userId,
            label: buildUserDisplayLabel(userMap.get(userId) || { id: userId })
          }))
          .filter((row) => cleanString(row?.value, { max: 120, allowEmpty: true }))
          .sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
      }

      const rows = sessions
        .map((row) => {
          const metadata = isPlainObject(row?.metadata) ? row.metadata : {};
          const feedbackMeta = isPlainObject(metadata.studentFeedback) ? metadata.studentFeedback : {};
          const latestFeedbackAt = cleanString(feedbackMeta.latestFeedbackAt, { max: 80, allowEmpty: true }) || '';
          const lastViewedAt = cleanString(feedbackMeta.lastViewedAt, { max: 80, allowEmpty: true }) || '';
          const hasFeedback = cleanNonNegativeInteger(row?.feedbackCount, 0) > 0 || Boolean(latestFeedbackAt);
          const unreadFeedback = hasFeedback && (!lastViewedAt || (latestFeedbackAt && latestFeedbackAt > lastViewedAt));
          return {
            id: cleanString(row?.id, { max: 120, allowEmpty: true }) || '',
            status: cleanString(row?.status, { max: 40, allowEmpty: true }).toLowerCase() || '',
            practiceName: cleanString(row?.metadata?.practice?.name, { max: MAX_PTE_SKILL_PRACTICE_NAME_LENGTH, allowEmpty: true }) || '',
            practiceSkill: normalizeSkill(row?.metadata?.practice?.skill, '') || '',
            startedAt: cleanString(row?.startedAt, { max: 80, allowEmpty: true }) || '',
            finishedAt: cleanString(row?.finishedAt, { max: 80, allowEmpty: true }) || '',
            submittedQuestions: cleanNonNegativeInteger(row?.submittedQuestions, 0),
            totalQuestions: cleanNonNegativeInteger(row?.totalQuestions, 0),
            percentage: cleanNumber(row?.percentage, 0),
            averageTimePerQuestionSeconds: cleanNumber(row?.averageTimePerQuestionSeconds, 0),
            feedbackCount: cleanNonNegativeInteger(row?.feedbackCount, 0),
            latestFeedbackAt,
            lastFeedbackViewedAt: lastViewedAt,
            hasFeedback,
            unreadFeedback,
            startedAtDisplay: cleanString(row?.startedAt, { max: 80, allowEmpty: true })
              ? new Date(row.startedAt).toLocaleString()
              : '-',
            finishedAtDisplay: cleanString(row?.finishedAt, { max: 80, allowEmpty: true })
              ? new Date(row.finishedAt).toLocaleString()
              : '-',
            latestFeedbackAtDisplay: latestFeedbackAt ? new Date(latestFeedbackAt).toLocaleString() : '-'
          };
        })
        .sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));

      return {
        rows,
        pagination,
        filters: {
          q,
          status,
          skill,
          feedbackState,
          userId: canSelectStudent ? (selectedUserId || '') : '',
          startedFrom: startedFrom || '',
          startedTo: startedTo || ''
        },
        canSelectStudent,
        optionSets: {
          ...this.getMyPracticeAttemptsFilterOptions(),
          students: studentOptions
        }
      };
    }

    const sessionsRaw = await pteAttemptSessionRepository.list({
      query: sessionQuery,
      scope: { canViewAll: true },
      sort: { startedAt: -1, id: -1 },
      backendMode: options?.backendMode
    });

    const allCandidateSessions = (Array.isArray(sessionsRaw) ? sessionsRaw : [])
      .filter((row) => String(row?.attemptType || '').toLowerCase() === 'skill_practice_run');
    let sessions = allCandidateSessions.slice();
    if (canSelectStudent && selectedUserId) {
      sessions = sessions.filter((row) => idsEqual(row?.userId, selectedUserId));
    }
    if (status) {
      sessions = sessions.filter((row) => cleanString(row?.status, { max: 40, allowEmpty: true }).toLowerCase() === status);
    }
    if (skill) {
      sessions = sessions.filter((row) => normalizeSkill(row?.metadata?.practice?.skill, '') === skill);
    }
    if (startMs !== null) {
      sessions = sessions.filter((row) => {
        const ts = toDateMs(row?.startedAt || row?.audit?.createDateTime || '');
        return ts !== null && ts >= startMs;
      });
    }
    if (endMs !== null) {
      sessions = sessions.filter((row) => {
        const ts = toDateMs(row?.startedAt || row?.audit?.createDateTime || '');
        return ts !== null && ts <= endMs;
      });
    }

    let studentOptions = [];
    if (canSelectStudent) {
      const candidateUserIds = Array.from(new Set(
        allCandidateSessions
          .map((row) => toPublicId(row?.userId || ''))
          .filter(Boolean)
      ));
      const studentRows = candidateUserIds.length
        ? await dataService.fetchData(
          'users',
          {
            id__in: candidateUserIds.join(','),
            limit: Math.max(candidateUserIds.length, 300)
          },
          requestingUser,
          options?.backendMode ? { backendMode: options.backendMode } : {}
        )
        : [];
      const userMap = new Map((Array.isArray(studentRows) ? studentRows : []).map((row) => [toPublicId(row?.id || ''), row]));
      studentOptions = candidateUserIds
        .map((userId) => ({
          value: userId,
          label: buildUserDisplayLabel(userMap.get(userId) || { id: userId })
        }))
        .filter((row) => cleanString(row?.value, { max: 120, allowEmpty: true }))
        .sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
    }

    const sessionIds = Array.from(new Set(
      sessions.map((row) => cleanString(row?.id, { max: 120, allowEmpty: true }) || '').filter(Boolean)
    ));
    const itemRowsRaw = sessionIds.length
      ? await pteAttemptItemRepository.list({
        query: {
          ...(activeOrgId ? { orgId__eq: activeOrgId } : {}),
          attemptSessionId__in: sessionIds.join(',')
        },
        scope: { canViewAll: true },
        sort: { questionOrder: 1, id: 1 },
        backendMode: options?.backendMode
      })
      : [];
    const itemRows = Array.isArray(itemRowsRaw) ? itemRowsRaw : [];

    const bySession = new Map();
    itemRows.forEach((item) => {
      const sid = cleanString(item?.attemptSessionId, { max: 120, allowEmpty: true }) || '';
      if (!sid) return;
      if (!bySession.has(sid)) {
        bySession.set(sid, {
          feedbackCount: 0,
          latestFeedbackAt: '',
          totalItems: 0
        });
      }
      const bucket = bySession.get(sid);
      bucket.totalItems += 1;
      const feedbackAt = cleanString(item?.feedbackProvidedAt, { max: 80, allowEmpty: true }) || '';
      if (feedbackAt) {
        bucket.feedbackCount += 1;
        if (!bucket.latestFeedbackAt || feedbackAt > bucket.latestFeedbackAt) {
          bucket.latestFeedbackAt = feedbackAt;
        }
      }
    });

    let rows = sessions.map((row) => {
      const sid = cleanString(row?.id, { max: 120, allowEmpty: true }) || '';
      const aggregate = bySession.get(sid) || {};
      const latestFeedbackAt = cleanString(aggregate.latestFeedbackAt, { max: 80, allowEmpty: true }) || '';
      const metadata = isPlainObject(row?.metadata) ? row.metadata : {};
      const feedbackMeta = isPlainObject(metadata.studentFeedback) ? metadata.studentFeedback : {};
      const lastViewedAt = cleanString(feedbackMeta.lastViewedAt, { max: 80, allowEmpty: true }) || '';
      const hasFeedback = cleanNonNegativeInteger(aggregate.feedbackCount, cleanNonNegativeInteger(row?.feedbackCount, 0)) > 0
        || Boolean(latestFeedbackAt);
      const unreadFeedback = hasFeedback && (!lastViewedAt || (latestFeedbackAt && latestFeedbackAt > lastViewedAt));
      return {
        id: sid,
        status: cleanString(row?.status, { max: 40, allowEmpty: true }).toLowerCase() || '',
        practiceName: cleanString(row?.metadata?.practice?.name, { max: MAX_PTE_SKILL_PRACTICE_NAME_LENGTH, allowEmpty: true }) || '',
        practiceSkill: normalizeSkill(row?.metadata?.practice?.skill, '') || '',
        startedAt: cleanString(row?.startedAt, { max: 80, allowEmpty: true }) || '',
        finishedAt: cleanString(row?.finishedAt, { max: 80, allowEmpty: true }) || '',
        submittedQuestions: cleanNonNegativeInteger(row?.submittedQuestions, 0),
        totalQuestions: cleanNonNegativeInteger(row?.totalQuestions, 0),
        percentage: cleanNumber(row?.percentage, 0),
        averageTimePerQuestionSeconds: cleanNumber(row?.averageTimePerQuestionSeconds, 0),
        feedbackCount: cleanNonNegativeInteger(aggregate.feedbackCount, cleanNonNegativeInteger(row?.feedbackCount, 0)),
        latestFeedbackAt,
        lastFeedbackViewedAt: lastViewedAt,
        hasFeedback,
        unreadFeedback,
        startedAtDisplay: cleanString(row?.startedAt, { max: 80, allowEmpty: true })
          ? new Date(row.startedAt).toLocaleString()
          : '-',
        finishedAtDisplay: cleanString(row?.finishedAt, { max: 80, allowEmpty: true })
          ? new Date(row.finishedAt).toLocaleString()
          : '-',
        latestFeedbackAtDisplay: latestFeedbackAt ? new Date(latestFeedbackAt).toLocaleString() : '-'
      };
    });

    if (feedbackState === 'with_feedback') {
      rows = rows.filter((row) => row.hasFeedback === true);
    } else if (feedbackState === 'without_feedback') {
      rows = rows.filter((row) => row.hasFeedback !== true);
    } else if (feedbackState === 'unread_feedback') {
      rows = rows.filter((row) => row.unreadFeedback === true);
    }

    if (q) {
      const qToken = q.toLowerCase();
      rows = rows.filter((row) => {
        const token = [
          row.id,
          row.practiceName,
          row.status,
          row.practiceSkill,
          row.startedAt,
          row.finishedAt,
          row.latestFeedbackAt
        ]
          .map((value) => String(value || '').toLowerCase())
          .join(' ');
        return token.includes(qToken);
      });
    }

    rows.sort((a, b) => {
      const unreadA = a.unreadFeedback === true ? 1 : 0;
      const unreadB = b.unreadFeedback === true ? 1 : 0;
      if (unreadA !== unreadB) return unreadB - unreadA;
      if (unreadA === 1 && unreadB === 1) {
        const fa = a.latestFeedbackAt || '';
        const fb = b.latestFeedbackAt || '';
        if (fa !== fb) return fb.localeCompare(fa);
      }
      const sa = a.startedAt || '';
      const sb = b.startedAt || '';
      if (sa !== sb) return sb.localeCompare(sa);
      return String(b.id || '').localeCompare(String(a.id || ''));
    });

    return {
      rows,
      filters: {
        q,
        status,
        skill,
        feedbackState,
        userId: canSelectStudent ? (selectedUserId || '') : '',
        startedFrom: cleanString(filters.startedFrom, { max: 80, allowEmpty: true }) || '',
        startedTo: cleanString(filters.startedTo, { max: 80, allowEmpty: true }) || ''
      },
      canSelectStudent,
      optionSets: {
        ...this.getMyPracticeAttemptsFilterOptions(),
        students: studentOptions
      }
    };
  },

  async getMyPracticeAttemptFeedbackDetail(sessionId, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const requesterUserId = resolveRequesterUserId(requestingUser);
    if (!requesterUserId) {
      throw new Error('Authenticated user context is required.');
    }

    const session = await getSessionByIdOrThrow(sessionId, visibility, options);
    if (!idsEqual(session?.userId, requesterUserId)) {
      throw new Error('Attempt session is not accessible.');
    }
    if (String(session?.attemptType || '').toLowerCase() !== 'skill_practice_run') {
      throw new Error('The selected session is not a skill practice run.');
    }

    const itemsRaw = await pteAttemptItemRepository.list({
      query: { attemptSessionId__eq: session.id },
      scope: buildRepositoryScope(visibility),
      sort: { questionOrder: 1, id: 1 },
      backendMode: options?.backendMode
    });
    const items = sortItemsByQuestionOrder(itemsRaw);
    const questionIds = Array.from(new Set(
      items.map((row) => cleanString(row?.questionVersionId, { max: 120, allowEmpty: true }) || '').filter(Boolean)
    ));
    const questionRows = questionIds.length
      ? await pteQuestionVersionRepository.list({
        query: {
          id__in: questionIds.join(','),
          ...(session?.orgId ? { orgId__eq: session.orgId } : {})
        },
        scope: { canViewAll: true },
        backendMode: options?.backendMode
      })
      : [];
    const questionMap = new Map((Array.isArray(questionRows) ? questionRows : []).map((row) => [
      cleanString(row?.id, { max: 120, allowEmpty: true }) || '',
      row
    ]));

    const latestFeedbackAt = items
      .map((row) => cleanString(row?.feedbackProvidedAt, { max: 80, allowEmpty: true }) || '')
      .filter(Boolean)
      .sort()
      .pop() || '';
    const feedbackCount = items.filter((row) => cleanString(row?.feedbackProvidedAt, { max: 80, allowEmpty: true }) || '').length;
    const sessionMetadata = isPlainObject(session?.metadata) ? session.metadata : {};
    const feedbackMeta = isPlainObject(sessionMetadata?.studentFeedback) ? sessionMetadata.studentFeedback : {};
    const lastViewedAt = cleanString(feedbackMeta?.lastViewedAt, { max: 80, allowEmpty: true }) || '';
    const hasUnreadFeedback = Boolean(latestFeedbackAt && (!lastViewedAt || latestFeedbackAt > lastViewedAt));

    let updatedSession = session;
    if (hasUnreadFeedback) {
      const now = nowIso();
      const mergedMetadata = {
        ...sessionMetadata,
        studentFeedback: {
          ...(isPlainObject(sessionMetadata.studentFeedback) ? sessionMetadata.studentFeedback : {}),
          lastViewedAt: now,
          latestFeedbackAt: latestFeedbackAt
        }
      };
      updatedSession = await pteAttemptSessionRepository.update(session.id, {
        metadata: mergedMetadata,
        audit: {
          lastUpdateUser: requesterUserId || 'System',
          lastUpdateDateTime: now
        }
      }, {
        backendMode: options?.backendMode
      });
    }

    return {
      session: updatedSession,
      feedbackSummary: {
        feedbackCount,
        latestFeedbackAt,
        latestFeedbackAtDisplay: latestFeedbackAt ? new Date(latestFeedbackAt).toLocaleString() : '-',
        previouslyViewedAt: lastViewedAt || '',
        previouslyViewedAtDisplay: lastViewedAt ? new Date(lastViewedAt).toLocaleString() : '-',
        wasUnreadBeforeOpen: hasUnreadFeedback
      },
      items: items.map((item) => ({
        ...item,
        question: resolveQuestionForAttemptItem(item, questionMap),
        latestFeedbackText: stripHtmlTags(item?.latestFeedback || '')
      }))
    };
  },

  async getMyPracticeAttemptLifecycleDetail(sessionId, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const requesterUserId = resolveRequesterUserId(requestingUser);
    if (!requesterUserId) {
      throw new Error('Authenticated user context is required.');
    }

    const session = await getSessionByIdOrThrow(sessionId, visibility, options);
    if (String(session?.attemptType || '').toLowerCase() !== 'skill_practice_run') {
      throw new Error('The selected session is not a skill practice run.');
    }

    const isPracticeAdmin = canSelectPracticeStudent(requestingUser);
    if (!isPracticeAdmin && !idsEqual(session?.userId, requesterUserId)) {
      throw new Error('Attempt session is not accessible.');
    }

    const detail = await this.getAttemptSessionDetail(
      session.id,
      requestingUser,
      accessContext,
      {
        ...options,
        includeEvents: true,
        includeArtifacts: true,
        includeLifecycle: true,
        eventLimit: Math.max(300, Math.min(2000, cleanNonNegativeInteger(options?.eventLimit, 1200) || 1200))
      }
    );

    const items = Array.isArray(detail?.items) ? detail.items : [];
    const questionIds = Array.from(new Set(
      items.map((row) => cleanString(row?.questionVersionId, { max: 120, allowEmpty: true }) || '').filter(Boolean)
    ));
    const questionRows = questionIds.length
      ? await pteQuestionVersionRepository.list({
        query: {
          id__in: questionIds.join(','),
          ...(session?.orgId ? { orgId__eq: session.orgId } : {})
        },
        scope: { canViewAll: true },
        backendMode: options?.backendMode
      })
      : [];
    const questionMap = new Map((Array.isArray(questionRows) ? questionRows : []).map((row) => [
      cleanString(row?.id, { max: 120, allowEmpty: true }) || '',
      row
    ]));

    const lifecycle = (detail?.lifecycle && typeof detail.lifecycle === 'object')
      ? detail.lifecycle
      : attemptLifecycleAnalytics.buildAttemptLifecycle(
        detail?.session || session,
        items,
        Array.isArray(detail?.events) ? detail.events : []
      );

    return {
      session: detail?.session || session,
      items: items.map((item) => ({
        ...item,
        question: resolveQuestionForAttemptItem(item, questionMap)
      })),
      events: Array.isArray(detail?.events) ? detail.events : [],
      artifacts: Array.isArray(detail?.artifacts) ? detail.artifacts : [],
      lifecycle
    };
  },

  async deleteMyPracticeAttempt(sessionId, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const requesterUserId = resolveRequesterUserId(requestingUser);
    if (!requesterUserId) {
      throw new Error('Authenticated user context is required.');
    }

    const normalizedSessionId = cleanString(sessionId, { max: 120, allowEmpty: true }) || '';
    if (!normalizedSessionId) {
      throw new Error('Session id is required.');
    }

    const session = await getSessionByIdOrThrow(normalizedSessionId, visibility, options);
    const deletableAttemptTypes = new Set(['skill_practice_run', 'single_question_practice']);
    if (!deletableAttemptTypes.has(String(session?.attemptType || '').toLowerCase())) {
      throw new Error('Only practice attempt sessions can be deleted from this view.');
    }

    const isPracticeAdmin = canSelectPracticeStudent(requestingUser);
    if (!isPracticeAdmin && !idsEqual(session?.userId, requesterUserId)) {
      throw new Error('You can only delete your own practice attempts.');
    }

    const backendMode = options?.backendMode;
    const [itemsRaw, eventsRaw, artifactsRaw] = await Promise.all([
      pteAttemptItemRepository.list({
        query: { attemptSessionId__eq: session.id },
        scope: { canViewAll: true },
        sort: { questionOrder: 1, id: 1 },
        backendMode
      }),
      pteAttemptLedgerEventRepository.list({
        query: { attemptSessionId__eq: session.id },
        scope: { canViewAll: true },
        sort: { eventAt: -1, id: -1 },
        backendMode
      }),
      pteAttemptArtifactRepository.list({
        query: { attemptSessionId__eq: session.id },
        scope: { canViewAll: true },
        sort: { createdAt: -1, id: -1 },
        backendMode
      })
    ]);

    const items = Array.isArray(itemsRaw) ? itemsRaw : [];
    const events = Array.isArray(eventsRaw) ? eventsRaw : [];
    const artifacts = Array.isArray(artifactsRaw) ? artifactsRaw : [];

    let cleanup = {
      uploadsRoot: '',
      removedFiles: 0,
      removedRemoteFiles: 0,
      removedDirectories: 0
    };
    let cleanupWarning = '';
    try {
      cleanup = await cleanupPracticeAttemptUploads(session, artifacts, events);
    } catch (error) {
      cleanupWarning = cleanString(error?.message, { max: 600, allowEmpty: true }) || 'Upload cleanup encountered an unexpected error.';
    }

    const removeRows = async (rows, removeFn) => {
      let removed = 0;
      for (const row of (Array.isArray(rows) ? rows : [])) {
        const rowId = cleanString(row?.id, { max: 120, allowEmpty: true }) || '';
        if (!rowId) continue;
        // eslint-disable-next-line no-await-in-loop
        await removeFn(rowId);
        removed += 1;
      }
      return removed;
    };

    const removedArtifacts = await removeRows(artifacts, async (id) => {
      await pteAttemptArtifactRepository.remove(id, { backendMode });
    });
    const removedEvents = await removeRows(events, async (id) => {
      await pteAttemptLedgerEventRepository.remove(id, { backendMode });
    });
    const removedItems = await removeRows(items, async (id) => {
      await pteAttemptItemRepository.remove(id, { backendMode });
    });
    await pteAttemptSessionRepository.remove(session.id, { backendMode });

    return {
      deletedSessionId: session.id,
      counts: {
        items: removedItems,
        events: removedEvents,
        artifacts: removedArtifacts
      },
      uploads: {
        root: cleanup.uploadsRoot || '',
        removedFiles: cleanup.removedFiles || 0,
        removedRemoteFiles: cleanup.removedRemoteFiles || 0,
        removedDirectories: cleanup.removedDirectories || 0
      },
      warning: cleanupWarning
    };
  },

  getRuntimeFilterOptions() {
    return {
      attemptTypes: ATTEMPT_TYPES.map((value) => ({
        value,
        label: value === 'test_run'
          ? 'Test Run'
          : (value === 'single_question_practice'
            ? 'Single Question Practice'
            : 'Skill Practice Run')
      })),
      eventTypes: EVENT_TYPES.map((value) => ({
        value,
        label: value.replace(/_/g, ' ')
      })),
      skills: SKILLS.map((value) => ({
        value,
        label: value.charAt(0).toUpperCase() + value.slice(1)
      })),
      itemStatuses: ITEM_STATUSES.map((value) => ({
        value,
        label: value.replace(/_/g, ' ')
      }))
    };
  },

  async listRuntimeLedgerEvents(rawFilters = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const filters = isPlainObject(rawFilters) ? rawFilters : {};
    const searchText = cleanString(filters.q || filters.search, { max: 220, allowEmpty: true }) || '';
    const searchType = cleanString(filters.type, { max: 32, allowEmpty: true }) || '';
    const searchFields = cleanString(filters.searchFields, { max: 400, allowEmpty: true }) || '';

    const attemptTypes = normalizeList(filters.attemptTypes)
      .map((value) => cleanString(value, { max: 40, allowEmpty: true }).toLowerCase())
      .filter((value) => ATTEMPT_TYPES.includes(value));
    const eventTypes = normalizeList(filters.eventTypes)
      .map((value) => cleanString(value, { max: 80, allowEmpty: true }).toLowerCase())
      .filter((value) => EVENT_TYPES.includes(value));
    const skills = normalizeList(filters.skills)
      .map((value) => cleanString(value, { max: 30, allowEmpty: true }).toLowerCase())
      .filter((value) => SKILLS.includes(value));
    const userIds = normalizeList(filters.userIds)
      .map((value) => toPublicId(value))
      .filter(Boolean);

    const questionType = cleanString(filters.questionType, { max: 120, allowEmpty: true }).toLowerCase();
    const sessionStatus = cleanString(filters.sessionStatus, { max: 40, allowEmpty: true }).toLowerCase();
    const itemStatus = cleanString(filters.itemStatus, { max: 40, allowEmpty: true }).toLowerCase();
    const sessionId = cleanString(filters.sessionId, { max: 120, allowEmpty: true }) || '';
    const itemId = cleanString(filters.itemId, { max: 120, allowEmpty: true }) || '';
    const testVersionId = cleanString(filters.testVersionId, { max: 120, allowEmpty: true }) || '';
    const questionVersionId = cleanString(filters.questionVersionId, { max: 120, allowEmpty: true }) || '';
    const withFeedback = cleanString(filters.withFeedback, { max: 10, allowEmpty: true }).toLowerCase();

    const minScoreFinal = parseOptionalNumber(filters.minScoreFinal);
    const maxScoreFinal = parseOptionalNumber(filters.maxScoreFinal);
    const minTimeSpent = parseOptionalNumber(filters.minTimeSpentSeconds);
    const maxTimeSpent = parseOptionalNumber(filters.maxTimeSpentSeconds);

    const startDate = cleanString(filters.startDate || filters.eventFrom || filters.from, { max: 80, allowEmpty: true }) || '';
    const endDate = cleanString(filters.endDate || filters.eventTo || filters.to, { max: 80, allowEmpty: true }) || '';
    const requestedPage = Math.max(1, cleanNonNegativeInteger(
      filters.page !== undefined ? filters.page : options?.pagination?.page,
      1
    ) || 1);
    const requestedLimit = Math.max(1, Math.min(200, cleanNonNegativeInteger(
      filters.limit !== undefined ? filters.limit : options?.pagination?.limit,
      30
    ) || 30));

    const query = {};
    if (searchText) query.q = searchText;
    if (searchType) query.type = searchType;
    if (searchFields) query.searchFields = searchFields;
    if (startDate) query.startDate = startDate;
    if (endDate) query.endDate = endDate;

    const addEqOrIn = (field, values) => {
      const rows = Array.isArray(values) ? values.filter(Boolean) : [];
      if (!rows.length) return;
      if (rows.length === 1) {
        query[`${field}__eq`] = rows[0];
      } else {
        query[`${field}__in`] = rows.join(',');
      }
    };

    addEqOrIn('attemptType', attemptTypes);
    addEqOrIn('eventType', eventTypes);
    addEqOrIn('skill', skills);
    addEqOrIn('userId', userIds);

    if (questionType) query.questionType__eq = questionType;
    if (sessionId) query.attemptSessionId__eq = sessionId;
    if (itemId) query.attemptItemId__eq = itemId;
    if (testVersionId) query.testVersionId__eq = testVersionId;
    if (questionVersionId) query.questionVersionId__eq = questionVersionId;

    const toPagination = (totalItems, page, limit) => {
      const total = Math.max(0, cleanNonNegativeInteger(totalItems, 0));
      const safeLimit = Math.max(1, cleanNonNegativeInteger(limit, 30) || 30);
      const totalPages = Math.max(1, Math.ceil(total / safeLimit) || 1);
      const currentPage = Math.min(Math.max(cleanNonNegativeInteger(page, 1) || 1, 1), totalPages);
      const startIndex = (currentPage - 1) * safeLimit;
      const endIndex = Math.min(startIndex + safeLimit, total);
      return {
        currentPage,
        totalPages,
        totalItems: total,
        limit: safeLimit,
        startItem: total > 0 ? startIndex + 1 : 0,
        endItem: endIndex
      };
    };

    const eventProjection = {
      _id: 0,
      id: 1,
      orgId: 1,
      userId: 1,
      attemptSessionId: 1,
      attemptItemId: 1,
      attemptType: 1,
      eventType: 1,
      testVersionId: 1,
      questionVersionId: 1,
      questionType: 1,
      skill: 1,
      eventAt: 1,
      feedbackProvidedAt: 1,
      timeSpentSeconds: 1,
      scoreFinal: 1
    };

    const applyPostFilters = (rows = []) => {
      return (Array.isArray(rows) ? rows : []).filter((row) => {
        const scoreFinal = cleanNumber(row?.scoreFinal, 0);
        const timeSpent = cleanNumber(row?.timeSpentSeconds, 0);
        const feedbackAt = cleanString(row?.feedbackProvidedAt, { max: 80, allowEmpty: true }) || '';

        if (minScoreFinal !== null && scoreFinal < minScoreFinal) return false;
        if (maxScoreFinal !== null && scoreFinal > maxScoreFinal) return false;
        if (minTimeSpent !== null && timeSpent < minTimeSpent) return false;
        if (maxTimeSpent !== null && timeSpent > maxTimeSpent) return false;
        if (withFeedback === 'yes' && !feedbackAt) return false;
        if (withFeedback === 'no' && feedbackAt) return false;
        return true;
      });
    };

    const applyStatusFilters = (rows = []) => {
      return (Array.isArray(rows) ? rows : []).filter((row) => {
        const rowSessionStatus = cleanString(row?.sessionStatus, { max: 40, allowEmpty: true }).toLowerCase();
        const rowItemStatus = cleanString(row?.itemStatus, { max: 40, allowEmpty: true }).toLowerCase();
        if (sessionStatus && rowSessionStatus !== sessionStatus) return false;
        if (itemStatus && rowItemStatus !== itemStatus) return false;
        return true;
      });
    };

    const enrichRows = async (rows = []) => {
      const sessionIds = Array.from(new Set(
        (Array.isArray(rows) ? rows : [])
          .map((row) => cleanString(row?.attemptSessionId, { max: 120, allowEmpty: true }) || '')
          .filter(Boolean)
      ));
      const itemIds = Array.from(new Set(
        (Array.isArray(rows) ? rows : [])
          .map((row) => cleanString(row?.attemptItemId, { max: 120, allowEmpty: true }) || '')
          .filter(Boolean)
      ));
      const resolvedUserIds = Array.from(new Set(
        (Array.isArray(rows) ? rows : [])
          .map((row) => toPublicId(row?.userId || ''))
          .filter(Boolean)
      ));

      const scope = buildRepositoryScope(visibility);
      const [sessionRows, itemRows, userRows] = await Promise.all([
        sessionIds.length
          ? pteAttemptSessionRepository.list({
            query: { id__in: sessionIds.join(',') },
            scope,
            projection: { _id: 0, id: 1, status: 1, metadata: 1 },
            backendMode: options?.backendMode
          })
          : [],
        itemIds.length
          ? pteAttemptItemRepository.list({
            query: { id__in: itemIds.join(',') },
            scope,
            backendMode: options?.backendMode
          })
          : [],
        resolvedUserIds.length
          ? dataService.fetchData(
            'users',
            {
              id__in: resolvedUserIds.join(','),
              limit: Math.max(resolvedUserIds.length, 100)
            },
            requestingUser,
            options?.backendMode ? { backendMode: options.backendMode } : {}
          )
          : []
      ]);

      const sessionMap = new Map((Array.isArray(sessionRows) ? sessionRows : []).map((row) => [toPublicId(row?.id || ''), row]));
      const itemMap = new Map((Array.isArray(itemRows) ? itemRows : []).map((row) => [toPublicId(row?.id || ''), row]));
      const userMap = new Map((Array.isArray(userRows) ? userRows : []).map((row) => [toPublicId(row?.id || ''), row]));

      const questionTypeSet = new Set();
      const enrichedRows = (Array.isArray(rows) ? rows : []).map((row) => {
        const sessionRow = sessionMap.get(toPublicId(row?.attemptSessionId || '')) || null;
        const itemRow = itemMap.get(toPublicId(row?.attemptItemId || '')) || null;
        const userRow = userMap.get(toPublicId(row?.userId || '')) || null;
        const qType = cleanString(row?.questionType, { max: 120, allowEmpty: true }).toLowerCase();
        if (qType) questionTypeSet.add(qType);

        return {
          ...row,
          practiceName: cleanString(sessionRow?.metadata?.practice?.name, { max: MAX_PTE_SKILL_PRACTICE_NAME_LENGTH, allowEmpty: true }) || '',
          userLabel: buildUserDisplayLabel(userRow || { id: row?.userId || '' }),
          sessionStatus: cleanString(sessionRow?.status, { max: 40, allowEmpty: true }).toLowerCase() || '',
          itemStatus: cleanString(itemRow?.status, { max: 40, allowEmpty: true }).toLowerCase() || '',
          eventAtDisplay: cleanString(row?.eventAt, { max: 80, allowEmpty: true })
            ? new Date(row.eventAt).toLocaleString()
            : '-'
        };
      });

      return {
        rows: enrichedRows,
        questionTypes: Array.from(questionTypeSet).sort((a, b) => a.localeCompare(b))
      };
    };

    const requiresPostFiltering = Boolean(
      minScoreFinal !== null
      || maxScoreFinal !== null
      || minTimeSpent !== null
      || maxTimeSpent !== null
      || withFeedback === 'yes'
      || withFeedback === 'no'
      || sessionStatus
      || itemStatus
    );

    const repositoryScope = buildRepositoryScope(visibility);
    const repositorySort = options?.sort || { eventAt: -1, id: -1 };

    if (!requiresPostFiltering) {
      const totalItems = await pteAttemptLedgerEventRepository.count({
        query,
        scope: repositoryScope,
        backendMode: options?.backendMode
      });
      const pagination = toPagination(totalItems, requestedPage, requestedLimit);
      const rowsRaw = await pteAttemptLedgerEventRepository.list({
        query,
        scope: repositoryScope,
        sort: repositorySort,
        projection: eventProjection,
        pagination: {
          page: pagination.currentPage,
          limit: pagination.limit
        },
        backendMode: options?.backendMode
      });
      const enriched = await enrichRows(rowsRaw);
      return {
        rows: enriched.rows,
        pagination,
        optionSets: {
          questionTypes: enriched.questionTypes
        }
      };
    }

    const rowsRaw = await pteAttemptLedgerEventRepository.list({
      query,
      scope: repositoryScope,
      sort: repositorySort,
      projection: eventProjection,
      backendMode: options?.backendMode
    });
    const filteredRows = applyPostFilters(rowsRaw);
    const enrichedAll = await enrichRows(filteredRows);
    const statusFilteredRows = applyStatusFilters(enrichedAll.rows || []);
    const finalPagination = toPagination(statusFilteredRows.length, requestedPage, requestedLimit);
    const finalStartIndex = finalPagination.startItem > 0 ? finalPagination.startItem - 1 : 0;
    const finalEndIndex = finalPagination.endItem;
    const pagedRows = statusFilteredRows.slice(finalStartIndex, finalEndIndex);

    const questionTypes = Array.from(new Set(
      statusFilteredRows
        .map((row) => cleanString(row?.questionType, { max: 120, allowEmpty: true }).toLowerCase())
        .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b));

    return {
      rows: pagedRows,
      pagination: finalPagination,
      optionSets: {
        questionTypes
      }
    };
  },

  getAttemptDetailsFilterOptions() {
    return {
      attemptTypes: ATTEMPT_TYPES.map((value) => ({
        value,
        label: value === 'test_run'
          ? 'Test Run'
          : (value === 'single_question_practice'
            ? 'Single Question Practice'
            : 'Skill Practice Run')
      })),
      sessionStatuses: ['in_progress', 'submitted', 'finished', 'abandoned'].map((value) => ({
        value,
        label: value.replace(/_/g, ' ')
      }))
    };
  },

  async listAttemptSessionsForDetails(rawFilters = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const filters = isPlainObject(rawFilters) ? rawFilters : {};
    const q = cleanString(filters.q || filters.search, { max: 220, allowEmpty: true }) || '';
    const sessionId = cleanString(filters.sessionId, { max: 120, allowEmpty: true }) || '';
    const attemptType = normalizeAttemptType(filters.attemptType, '');
    const status = cleanString(filters.status, { max: 40, allowEmpty: true }).toLowerCase();
    const userId = toPublicId(filters.userId || '');
    const startedFrom = cleanString(filters.startedFrom || filters.startDate || filters.from, { max: 80, allowEmpty: true }) || '';
    const startedTo = cleanString(filters.startedTo || filters.endDate || filters.to, { max: 80, allowEmpty: true }) || '';

    const requestedPage = Math.max(1, cleanNonNegativeInteger(
      filters.page !== undefined ? filters.page : options?.pagination?.page,
      1
    ) || 1);
    const requestedLimit = Math.max(1, Math.min(200, cleanNonNegativeInteger(
      filters.limit !== undefined ? filters.limit : options?.pagination?.limit,
      20
    ) || 20));

    if (userId) {
      if (visibility.mode === 'creator' && !idsEqual(userId, visibility.requesterUserId)) {
        throw new Error('Creator-scoped access can only filter your own user id.');
      }
      if (visibility.mode === 'org' || visibility.mode === 'all') {
        const candidateUsers = await dataService.fetchData(
          'users',
          { id__in: userId, limit: 2 },
          requestingUser,
          options?.backendMode ? { backendMode: options.backendMode } : {}
        );
        const candidate = Array.isArray(candidateUsers) ? candidateUsers[0] : null;
        if (!candidate || !canTargetUserByVisibility(candidate, visibility)) {
          throw new Error('Selected user is outside your attempt visibility scope.');
        }
      }
    }

    const toPagination = (totalItems, page, limit) => {
      const total = Math.max(0, cleanNonNegativeInteger(totalItems, 0));
      const safeLimit = Math.max(1, cleanNonNegativeInteger(limit, 20) || 20);
      const totalPages = Math.max(1, Math.ceil(total / safeLimit) || 1);
      const currentPage = Math.min(Math.max(cleanNonNegativeInteger(page, 1) || 1, 1), totalPages);
      const startIndex = (currentPage - 1) * safeLimit;
      const endIndex = Math.min(startIndex + safeLimit, total);
      return {
        currentPage,
        totalPages,
        totalItems: total,
        limit: safeLimit,
        startItem: total > 0 ? startIndex + 1 : 0,
        endItem: endIndex
      };
    };

    const query = {};
    if (q) query.q = q;
    if (sessionId) query.id__eq = sessionId;
    if (attemptType) query.attemptType__eq = attemptType;
    if (status) query.status__eq = status;
    if (userId) query.userId__eq = userId;
    if (startedFrom) query.startDate = startedFrom;
    if (startedTo) query.endDate = startedTo;

    const repositoryScope = buildRepositoryScope(visibility);
    const projection = {
      _id: 0,
      id: 1,
      orgId: 1,
      userId: 1,
      personId: 1,
      applicantId: 1,
      attemptType: 1,
      status: 1,
      startedAt: 1,
      submittedAt: 1,
      finishedAt: 1,
      totalQuestions: 1,
      submittedQuestions: 1,
      scoreRaw: 1,
      scoreFinal: 1,
      maxScore: 1,
      percentage: 1,
      averageTimePerQuestionSeconds: 1,
      feedbackCount: 1,
      latestEventType: 1,
      metadata: 1
    };

    const [totalRows, rowsRaw] = await Promise.all([
      pteAttemptSessionRepository.count({
        query,
        scope: repositoryScope,
        backendMode: options?.backendMode
      }),
      pteAttemptSessionRepository.list({
        query,
        scope: repositoryScope,
        sort: { startedAt: -1, id: -1 },
        projection,
        pagination: {
          page: requestedPage,
          limit: requestedLimit
        },
        backendMode: options?.backendMode
      })
    ]);

    const uniqueUserIds = Array.from(new Set(
      (Array.isArray(rowsRaw) ? rowsRaw : [])
        .map((row) => toPublicId(row?.userId || ''))
        .filter(Boolean)
    ));
    const userRows = uniqueUserIds.length
      ? await dataService.fetchData(
        'users',
        {
          id__in: uniqueUserIds.join(','),
          limit: Math.max(uniqueUserIds.length * 2, 200)
        },
        requestingUser,
        options?.backendMode ? { backendMode: options.backendMode } : {}
      )
      : [];
    const userMap = new Map((Array.isArray(userRows) ? userRows : []).map((row) => [toPublicId(row?.id || ''), row]));
    const rows = (Array.isArray(rowsRaw) ? rowsRaw : []).map((row) => {
      const rowObject = isPlainObject(row) ? row : {};
      const userRow = userMap.get(toPublicId(rowObject?.userId || '')) || { id: rowObject?.userId || '' };
      const metadata = isPlainObject(rowObject?.metadata) ? rowObject.metadata : {};
      const practiceName = cleanString(metadata?.practice?.name, { max: MAX_PTE_SKILL_PRACTICE_NAME_LENGTH, allowEmpty: true }) || '';
      const rowWithoutMetadata = { ...rowObject };
      delete rowWithoutMetadata.metadata;
      return {
        ...rowWithoutMetadata,
        practiceName,
        userLabel: buildUserDisplayLabel(userRow),
        startedAtDisplay: cleanString(rowObject?.startedAt, { max: 80, allowEmpty: true })
          ? new Date(rowObject.startedAt).toLocaleString()
          : '-',
        finishedAtDisplay: cleanString(rowObject?.finishedAt, { max: 80, allowEmpty: true })
          ? new Date(rowObject.finishedAt).toLocaleString()
          : '-',
        submittedAtDisplay: cleanString(rowObject?.submittedAt, { max: 80, allowEmpty: true })
          ? new Date(rowObject.submittedAt).toLocaleString()
          : '-'
      };
    });

    return {
      rows,
      pagination: toPagination(totalRows, requestedPage, requestedLimit),
      filters: {
        q,
        sessionId,
        attemptType,
        status,
        userId: userId || '',
        startedFrom,
        startedTo
      },
      optionSets: this.getAttemptDetailsFilterOptions()
    };
  },

  async getAttemptOverallPerformance(rawFilters = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const filters = isPlainObject(rawFilters) ? rawFilters : {};
    const q = cleanString(filters.q || filters.search, { max: 220, allowEmpty: true }) || '';
    const attemptType = normalizeAttemptType(filters.attemptType, '');
    const status = cleanString(filters.status, { max: 40, allowEmpty: true }).toLowerCase();
    const userId = toPublicId(filters.userId || '');
    const startedFrom = cleanString(filters.startedFrom || filters.startDate || filters.from, { max: 80, allowEmpty: true }) || '';
    const startedTo = cleanString(filters.startedTo || filters.endDate || filters.to, { max: 80, allowEmpty: true }) || '';

    if (userId) {
      if (visibility.mode === 'creator' && !idsEqual(userId, visibility.requesterUserId)) {
        throw new Error('Creator-scoped access can only filter your own user id.');
      }
      if (visibility.mode === 'org' || visibility.mode === 'all') {
        const candidateUsers = await dataService.fetchData(
          'users',
          { id__in: userId, limit: 2 },
          requestingUser,
          options?.backendMode ? { backendMode: options.backendMode } : {}
        );
        const candidate = Array.isArray(candidateUsers) ? candidateUsers[0] : null;
        if (!candidate || !canTargetUserByVisibility(candidate, visibility)) {
          throw new Error('Selected user is outside your attempt visibility scope.');
        }
      }
    }

    const maxSessions = Math.max(100, Math.min(3000, cleanNonNegativeInteger(filters.maxSessions, 1200) || 1200));
    const maxItems = Math.max(500, Math.min(15000, cleanNonNegativeInteger(filters.maxItems, 9000) || 9000));

    const query = {};
    if (q) query.q = q;
    if (attemptType) query.attemptType__eq = attemptType;
    if (status) query.status__eq = status;
    if (userId) query.userId__eq = userId;
    if (startedFrom) query.startDate = startedFrom;
    if (startedTo) query.endDate = startedTo;
    query.page = 1;
    query.limit = maxSessions;

    const repositoryScope = buildRepositoryScope(visibility);
    const sessionRows = await pteAttemptSessionRepository.list({
      query,
      scope: repositoryScope,
      sort: { startedAt: -1, id: -1 },
      projection: {
        _id: 0,
        id: 1,
        orgId: 1,
        userId: 1,
        attemptType: 1,
        status: 1,
        startedAt: 1,
        finishedAt: 1,
        submittedAt: 1,
        totalQuestions: 1,
        submittedQuestions: 1,
        scoreRaw: 1,
        scoreFinal: 1,
        maxScore: 1,
        percentage: 1,
        averageTimePerQuestionSeconds: 1,
        feedbackCount: 1
      },
      backendMode: options?.backendMode
    });
    const sessions = Array.isArray(sessionRows) ? sessionRows : [];
    const sessionIds = sessions
      .map((row) => cleanString(row?.id, { max: 120, allowEmpty: true }) || '')
      .filter(Boolean);

    const itemRows = sessionIds.length
      ? await pteAttemptItemRepository.list({
        query: {
          attemptSessionId__in: sessionIds.join(','),
          page: 1,
          limit: maxItems
        },
        scope: repositoryScope,
        sort: { startedAt: -1, id: -1 },
        projection: {
          _id: 0,
          id: 1,
          attemptSessionId: 1,
          userId: 1,
          status: 1,
          skill: 1,
          questionType: 1,
          scoreFinal: 1,
          maxScore: 1,
          percentage: 1,
          timeSpentSeconds: 1,
          submittedAt: 1,
          finishedAt: 1,
          feedbackProvidedAt: 1
        },
        backendMode: options?.backendMode
      })
      : [];
    const items = Array.isArray(itemRows) ? itemRows : [];

    const toNumeric = (value, fallback = 0) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || Number.isNaN(numeric)) return Number(fallback || 0);
      return numeric;
    };
    const avg = (rows = [], selector = () => 0) => {
      if (!rows.length) return 0;
      const sum = rows.reduce((acc, row) => acc + toNumeric(selector(row), 0), 0);
      return Number((sum / rows.length).toFixed(2));
    };

    const completedSessions = sessions.filter((row) => {
      const token = cleanString(row?.status, { max: 40, allowEmpty: true }).toLowerCase();
      return token === 'submitted' || token === 'finished';
    });
    const submittedItems = items.filter((row) => FINAL_ITEM_STATUSES.has(cleanString(row?.status, { max: 40, allowEmpty: true }).toLowerCase()));
    const feedbackItems = items.filter((row) => cleanString(row?.feedbackProvidedAt, { max: 80, allowEmpty: true }));

    const bySkillMap = new Map();
    submittedItems.forEach((row) => {
      const skill = normalizeSkill(row?.skill, '') || 'unknown';
      if (!bySkillMap.has(skill)) {
        bySkillMap.set(skill, {
          skill,
          itemCount: 0,
          averagePercentage: 0,
          averageTimeSeconds: 0
        });
      }
      const target = bySkillMap.get(skill);
      target.itemCount += 1;
      target.averagePercentage += toNumeric(row?.percentage, 0);
      target.averageTimeSeconds += toNumeric(row?.timeSpentSeconds, 0);
    });
    const bySkill = Array.from(bySkillMap.values())
      .map((row) => ({
        skill: row.skill,
        itemCount: row.itemCount,
        averagePercentage: row.itemCount ? Number((row.averagePercentage / row.itemCount).toFixed(2)) : 0,
        averageTimeSeconds: row.itemCount ? Number((row.averageTimeSeconds / row.itemCount).toFixed(2)) : 0
      }))
      .sort((a, b) => b.itemCount - a.itemCount);

    const byTypeMap = new Map();
    sessions.forEach((row) => {
      const type = normalizeAttemptType(row?.attemptType, '') || 'unknown';
      if (!byTypeMap.has(type)) {
        byTypeMap.set(type, {
          attemptType: type,
          sessionCount: 0,
          completedCount: 0,
          averagePercentage: 0
        });
      }
      const target = byTypeMap.get(type);
      const statusToken = cleanString(row?.status, { max: 40, allowEmpty: true }).toLowerCase();
      target.sessionCount += 1;
      if (statusToken === 'submitted' || statusToken === 'finished') target.completedCount += 1;
      target.averagePercentage += toNumeric(row?.percentage, 0);
    });
    const byAttemptType = Array.from(byTypeMap.values())
      .map((row) => ({
        attemptType: row.attemptType,
        sessionCount: row.sessionCount,
        completedCount: row.completedCount,
        averagePercentage: row.sessionCount ? Number((row.averagePercentage / row.sessionCount).toFixed(2)) : 0
      }))
      .sort((a, b) => b.sessionCount - a.sessionCount);

    const uniqueUserIds = Array.from(new Set(
      sessions.map((row) => toPublicId(row?.userId || '')).filter(Boolean)
    ));
    const userRows = uniqueUserIds.length
      ? await dataService.fetchData(
        'users',
        {
          id__in: uniqueUserIds.join(','),
          limit: Math.max(uniqueUserIds.length * 2, 300)
        },
        requestingUser,
        options?.backendMode ? { backendMode: options.backendMode } : {}
      )
      : [];
    const userMap = new Map((Array.isArray(userRows) ? userRows : []).map((row) => [toPublicId(row?.id || ''), row]));
    const byUserMap = new Map();
    sessions.forEach((row) => {
      const uid = toPublicId(row?.userId || '');
      if (!uid) return;
      if (!byUserMap.has(uid)) {
        byUserMap.set(uid, {
          userId: uid,
          userLabel: buildUserDisplayLabel(userMap.get(uid) || { id: uid }),
          sessionCount: 0,
          averagePercentage: 0,
          latestStartedAt: ''
        });
      }
      const target = byUserMap.get(uid);
      target.sessionCount += 1;
      target.averagePercentage += toNumeric(row?.percentage, 0);
      const startedAt = cleanString(row?.startedAt, { max: 80, allowEmpty: true }) || '';
      if (!target.latestStartedAt || (startedAt && startedAt > target.latestStartedAt)) {
        target.latestStartedAt = startedAt;
      }
    });
    const byUser = Array.from(byUserMap.values())
      .map((row) => ({
        ...row,
        averagePercentage: row.sessionCount ? Number((row.averagePercentage / row.sessionCount).toFixed(2)) : 0,
        latestStartedAtDisplay: row.latestStartedAt ? new Date(row.latestStartedAt).toLocaleString() : '-'
      }))
      .sort((a, b) => b.sessionCount - a.sessionCount);

    const trend = sessions
      .map((row) => ({
        id: cleanString(row?.id, { max: 120, allowEmpty: true }) || '',
        startedAt: cleanString(row?.startedAt, { max: 80, allowEmpty: true }) || '',
        percentage: Number(toNumeric(row?.percentage, 0).toFixed(2)),
        attemptType: normalizeAttemptType(row?.attemptType, '') || 'unknown'
      }))
      .filter((row) => row.id && row.startedAt)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .slice(-20);

    return {
      generatedAt: nowIso(),
      filters: {
        q,
        attemptType,
        status,
        userId: userId || '',
        startedFrom,
        startedTo
      },
      summary: {
        totalSessions: sessions.length,
        completedSessions: completedSessions.length,
        inProgressSessions: sessions.filter((row) => cleanString(row?.status, { max: 40, allowEmpty: true }).toLowerCase() === 'in_progress').length,
        totalItems: items.length,
        submittedItems: submittedItems.length,
        feedbackItems: feedbackItems.length,
        averageSessionPercentage: avg(sessions, (row) => row?.percentage),
        averageItemPercentage: avg(submittedItems, (row) => row?.percentage),
        averageItemTimeSeconds: avg(submittedItems, (row) => row?.timeSpentSeconds)
      },
      bySkill,
      byAttemptType,
      byUser,
      trend,
      optionSets: this.getAttemptDetailsFilterOptions()
    };
  },

  async listRuntimePickerUsers(rawQuery = {}, requestingUser, accessContext = {}, options = {}) {
    const visibility = await resolveVisibility(requestingUser, accessContext);
    assertReadableVisibility(visibility);

    const query = isPlainObject(rawQuery) ? rawQuery : {};
    const rowsRaw = await dataService.fetchData(
      'users',
      {
        ...query,
        limit: Math.max(Number(query.limit || 0) || 0, 800)
      },
      requestingUser,
      options?.backendMode ? { backendMode: options.backendMode } : {}
    );

    const mapped = (Array.isArray(rowsRaw) ? rowsRaw : [])
      .filter((row) => canTargetUserByVisibility(row, visibility))
      .map((row) => {
        const id = toPublicId(row?.id || '') || '';
        const username = cleanString(row?.username, { max: 140, allowEmpty: true }) || '';
        const email = cleanString(row?.email, { max: 220, allowEmpty: true }) || '';
        const name = cleanString(
          row?.name
            || row?.displayName
            || row?.fullName
            || row?.identity?.displayName
            || '',
          { max: 220, allowEmpty: true }
        ) || '';
        return {
          id,
          name: name || username || email || id,
          username,
          email,
          orgId: collectUserOrgIds(row)[0] || ''
        };
      });

    return applyGenericFilter(mapped, query, {
      defaultSearchFields: ['id', 'name', 'username', 'email'],
      dateFields: []
    });
  }
};

pteAttemptLedgerService.__testables = {
  calculateTimeSpentSeconds,
  calculateSaveTimingForAttemptItem,
  shouldBypassPracticeQuotaForUser
};

module.exports = pteAttemptLedgerService;
