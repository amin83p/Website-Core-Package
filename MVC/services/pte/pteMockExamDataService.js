const fs = require('fs');
const path = require('path');
const uploadPathUtils = require('../../utils/uploadPathUtils');
const pteTestVersionRepository = require('../../repositories/pteTestVersionRepository');
const pteQuestionVersionRepository = require('../../repositories/pteQuestionVersionRepository');
const pteAttemptSessionRepository = require('../../repositories/pteAttemptSessionRepository');
const pteAttemptLedgerService = require('./pteAttemptLedgerService');
const questionTypeRegistry = require('./questionTypeRegistry');
const { toPublicId, idsEqual } = require('../../utils/idAdapter');

const SKILLS = Object.freeze(['speaking', 'writing', 'reading', 'listening']);
const FINAL_ITEM_STATUSES = new Set(['submitted', 'auto_submitted', 'scored', 'feedback_provided', 'abandoned']);
const FINAL_SESSION_STATUSES = new Set(['submitted', 'finished', 'abandoned']);

const ACADEMIC_SECTION_RANGES = Object.freeze({
  speaking_writing: Object.freeze({ label: 'Speaking & Writing', minMinutes: 76, maxMinutes: 84, skills: ['speaking', 'writing'] }),
  reading: Object.freeze({ label: 'Reading', minMinutes: 22, maxMinutes: 30, skills: ['reading'] }),
  listening: Object.freeze({ label: 'Listening', minMinutes: 31, maxMinutes: 39, skills: ['listening'] })
});

const CORE_SECTION_RANGES = Object.freeze({
  speaking_writing: Object.freeze({ label: 'Speaking & Writing', minMinutes: 50, maxMinutes: 65, skills: ['speaking', 'writing'] }),
  reading: Object.freeze({ label: 'Reading', minMinutes: 27, maxMinutes: 37, skills: ['reading'] }),
  listening: Object.freeze({ label: 'Listening', minMinutes: 22, maxMinutes: 37, skills: ['listening'] })
});

const PROMPT_AUDIO_REQUIRED_TYPES = new Set([
  'speaking_repeat_sentence',
  'speaking_answer_short_question',
  'listening_summarize_spoken_text',
  'listening_mcq_single',
  'listening_mcq_multiple',
  'listening_fill_in_blank',
  'listening_select_missing_word',
  'listening_highlight_incorrect_words',
  'listening_dictation',
  'listening_matching'
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 4000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const text = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function deepClone(value, fallback) {
  try {
    if (value === undefined || value === null) return fallback;
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallback;
  }
}

function normalizeSkill(value) {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  return SKILLS.includes(token) ? token : '';
}

function normalizeTestType(value) {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  return ['academic', 'core'].includes(token) ? token : '';
}

function resolveActiveOrgId(requestingUser = {}) {
  return toPublicId(requestingUser?.activeOrgId || requestingUser?.primaryOrgId || '') || '';
}

function resolveRequesterUserId(requestingUser = {}) {
  return toPublicId(requestingUser?.id || '') || '';
}

function flattenAllocations(allocations = {}) {
  const source = isPlainObject(allocations) ? allocations : {};
  const out = [];
  SKILLS.forEach((skill) => {
    const rows = Array.isArray(source[skill]) ? source[skill] : [];
    rows.forEach((row, index) => {
      const questionVersionId = cleanString(row?.questionVersionId || row?.id, { max: 120, allowEmpty: true }) || '';
      if (!questionVersionId) return;
      out.push({
        ...row,
        questionVersionId,
        skill,
        sequenceNo: Math.max(1, Number.parseInt(String(row?.sequenceNo || index + 1), 10) || index + 1)
      });
    });
  });
  return out;
}

function buildSkillCoverage(allocations = {}) {
  const out = {};
  SKILLS.forEach((skill) => {
    out[skill] = Array.isArray(allocations?.[skill]) ? allocations[skill].length : 0;
  });
  return out;
}

function formatQuestionTypeLabel(value = '') {
  return cleanString(value, { max: 120, allowEmpty: true })
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function resolveMediaUrl(questionRow = {}, assetRef = '') {
  const tokenRaw = cleanString(assetRef, { max: 1000, allowEmpty: true }) || '';
  const token = tokenRaw.toLowerCase();
  if (!token) return '';
  if (/^https?:\/\//i.test(tokenRaw)) return tokenRaw;
  if (/^data:(audio|image|video)\//i.test(tokenRaw)) return tokenRaw;
  if (/^\/uploads\//i.test(tokenRaw)) return tokenRaw;
  if (/^uploads\//i.test(tokenRaw)) return `/${tokenRaw.replace(/^\/+/, '')}`;

  const mediaRows = Array.isArray(questionRow?.mediaAssets) ? questionRow.mediaAssets : [];
  const media = mediaRows.find((row) => {
    const keys = [
      row?.id,
      row?.name,
      row?.originalName,
      row?.filename,
      row?.path,
      row?.url
    ].map((value) => cleanString(value, { max: 1000, allowEmpty: true }).toLowerCase()).filter(Boolean);
    return keys.includes(token);
  }) || null;
  if (!media) return '';
  if (cleanString(media.url, { max: 1000, allowEmpty: true })) return cleanString(media.url, { max: 1000, allowEmpty: true });
  if (cleanString(media.path, { max: 1000, allowEmpty: true })) {
    const normalized = cleanString(media.path, { max: 1000, allowEmpty: true }).replace(/\\/g, '/');
    const match = normalized.match(/\/uploads\/(.+)$/i);
    if (match && match[1]) return `/uploads/${String(match[1]).replace(/^\/+/, '')}`;
    return normalized;
  }
  return '';
}

function uploadUrlExistsOnDisk(url = '') {
  const token = cleanString(url, { max: 1000, allowEmpty: true }) || '';
  if (!token) return false;
  if (/^https?:\/\//i.test(token) || /^data:/i.test(token)) return true;
  const match = token.replace(/\\/g, '/').match(/\/uploads\/(.+)$/i);
  if (!match || !match[1]) return true;
  const uploadRoot = uploadPathUtils.getUploadRootAbsolute();
  const diskPath = uploadPathUtils.fromUploadsUrlToDiskPath(`/uploads/${match[1]}`, uploadRoot);
  if (!diskPath || !uploadPathUtils.isInsideUploadRoot(diskPath, uploadRoot)) return false;
  return fs.existsSync(diskPath);
}

function hasUsableMedia(questionRow = {}, assetRef = '') {
  const url = resolveMediaUrl(questionRow, assetRef);
  return Boolean(url && uploadUrlExistsOnDisk(url));
}

function resolveRequiredMediaProblems(questionRow = {}) {
  const payload = isPlainObject(questionRow?.payload) ? questionRow.payload : {};
  const questionType = cleanString(questionRow?.questionType, { max: 120, allowEmpty: true }).toLowerCase();
  const problems = [];

  if (PROMPT_AUDIO_REQUIRED_TYPES.has(questionType)) {
    const audioRef = cleanString(
      questionType === 'speaking_answer_short_question'
        ? (payload.promptAudioAssetId || payload.promptTextOrAudio)
        : payload.promptAudioAssetId,
      { max: 1000, allowEmpty: true }
    );
    if (!hasUsableMedia(questionRow, audioRef)) {
      problems.push(`${formatQuestionTypeLabel(questionType) || questionType} requires a readable prompt audio file.`);
    }
  }

  if (questionType === 'speaking_describe_image') {
    const imageRef = cleanString(payload.imageAssetId || payload.promptImageAssetId || payload.imageUrl, {
      max: 1000,
      allowEmpty: true
    });
    if (!hasUsableMedia(questionRow, imageRef)) {
      problems.push('Describe Image requires a readable prompt image file.');
    }
  }

  return problems;
}

function detectTestType(questionRows = []) {
  const rows = Array.isArray(questionRows) ? questionRows : [];
  const explicitTypes = new Set();
  const singleAllowedTypes = new Set();
  let allowedIntersection = new Set(['academic', 'core']);
  const warnings = [];

  rows.forEach((question) => {
    const explicit = normalizeTestType(question?.testType);
    if (explicit) explicitTypes.add(explicit);
    const questionType = cleanString(question?.questionType, { max: 120, allowEmpty: true }).toLowerCase();
    const allowed = typeof questionTypeRegistry.getAllowedTestTypesForType === 'function'
      ? questionTypeRegistry.getAllowedTestTypesForType(questionType).map(normalizeTestType).filter(Boolean)
      : ['academic', 'core'];
    if (allowed.length === 1) singleAllowedTypes.add(allowed[0]);
    allowedIntersection = new Set([...allowedIntersection].filter((type) => allowed.includes(type)));
  });

  if (explicitTypes.size > 1) {
    return {
      testType: 'mixed',
      label: 'Invalid mixed Academic/Core',
      valid: false,
      warnings,
      errors: ['Allocated questions contain both Academic and Core test-type markers.']
    };
  }

  if (explicitTypes.size === 1) {
    const [testType] = Array.from(explicitTypes);
    return {
      testType,
      label: testType === 'core' ? 'PTE Core' : 'PTE Academic',
      valid: true,
      warnings,
      errors: []
    };
  }

  if (singleAllowedTypes.size > 1) {
    return {
      testType: 'mixed',
      label: 'Invalid mixed Academic/Core',
      valid: false,
      warnings,
      errors: ['Allocated question types imply a mix of Academic-only and Core-only items.']
    };
  }

  if (singleAllowedTypes.size === 1) {
    const [testType] = Array.from(singleAllowedTypes);
    return {
      testType,
      label: testType === 'core' ? 'PTE Core' : 'PTE Academic',
      valid: true,
      warnings,
      errors: []
    };
  }

  const fallback = allowedIntersection.has('academic') ? 'academic' : (allowedIntersection.has('core') ? 'core' : 'academic');
  warnings.push('No explicit test-type marker was found; the test was treated as Academic-compatible.');
  return {
    testType: fallback,
    label: fallback === 'core' ? 'PTE Core' : 'PTE Academic',
    valid: true,
    warnings,
    errors: []
  };
}

function buildTimingSnapshot(testType = 'academic', skillCoverage = {}, startedAt = new Date(), allocationSequence = []) {
  const ranges = testType === 'core' ? CORE_SECTION_RANGES : ACADEMIC_SECTION_RANGES;
  const startDate = startedAt instanceof Date && !Number.isNaN(startedAt.getTime()) ? startedAt : new Date();
  let sectionCursorMs = startDate.getTime();
  const itemDeadlines = [];
  const sections = Object.entries(ranges).map(([key, value]) => {
    const questionCount = value.skills.reduce((sum, skill) => sum + (Number(skillCoverage?.[skill] || 0) || 0), 0);
    const sectionStart = new Date(sectionCursorMs);
    const sectionDurationSeconds = Math.max(1, value.maxMinutes * 60);
    const sectionEnd = new Date(sectionCursorMs + (sectionDurationSeconds * 1000));
    const sectionItems = (Array.isArray(allocationSequence) ? allocationSequence : [])
      .filter((item) => value.skills.includes(normalizeSkill(item?.skill)))
      .sort((a, b) => (Number(a?.questionOrder || a?.sequenceNo || 0) || 0) - (Number(b?.questionOrder || b?.sequenceNo || 0) || 0));
    const perItemSeconds = sectionItems.length ? Math.max(1, Math.floor(sectionDurationSeconds / sectionItems.length)) : 0;
    sectionItems.forEach((item, index) => {
      const itemStart = new Date(sectionCursorMs + (perItemSeconds * 1000 * index));
      const isLast = index === sectionItems.length - 1;
      const itemEnd = isLast
        ? sectionEnd
        : new Date(sectionCursorMs + (perItemSeconds * 1000 * (index + 1)));
      itemDeadlines.push({
        questionVersionId: cleanString(item?.questionVersionId, { max: 120, allowEmpty: true }) || '',
        skill: normalizeSkill(item?.skill),
        questionType: cleanString(item?.questionType, { max: 120, allowEmpty: true }).toLowerCase() || '',
        questionOrder: Number(item?.questionOrder || item?.sequenceNo || index + 1) || index + 1,
        sectionKey: key,
        startsAt: itemStart.toISOString(),
        expiresAt: itemEnd.toISOString(),
        durationSeconds: Math.max(1, Math.floor((itemEnd.getTime() - itemStart.getTime()) / 1000))
      });
    });
    sectionCursorMs = sectionEnd.getTime();
    return {
      key,
      label: value.label,
      skills: value.skills.slice(),
      minMinutes: value.minMinutes,
      maxMinutes: value.maxMinutes,
      questionCount,
      startsAt: sectionStart.toISOString(),
      expiresAt: sectionEnd.toISOString(),
      durationSeconds: sectionDurationSeconds
    };
  });
  const totalMinMinutes = sections.reduce((sum, row) => sum + row.minMinutes, 0);
  const totalMaxMinutes = sections.reduce((sum, row) => sum + row.maxMinutes, 0);
  const estimatedMinutes = Math.round((totalMinMinutes + totalMaxMinutes) / 2);
  const globalDurationSeconds = Math.max(1, totalMaxMinutes * 60);
  const expiresAt = new Date(startDate.getTime() + (globalDurationSeconds * 1000));

  return {
    testType,
    sections,
    totalMinMinutes,
    totalMaxMinutes,
    estimatedMinutes,
    globalDurationSeconds,
    startedAt: startDate.toISOString(),
    expiresAt: expiresAt.toISOString(),
    itemDeadlines,
    source: 'pearson_section_guidance_fallback'
  };
}

async function hydrateAllocatedQuestions(testRow = {}, requestingUser, accessContext = {}, options = {}) {
  const refs = flattenAllocations(testRow?.allocations || {});
  const rows = [];
  const errors = [];
  const warnings = [];
  const activeOrgId = resolveActiveOrgId(requestingUser);

  for (const ref of refs) {
    // eslint-disable-next-line no-await-in-loop
    const question = await pteQuestionVersionRepository.getById(ref.questionVersionId, {
      backendMode: options?.backendMode
    });
    if (!question) {
      errors.push(`Question ${ref.questionVersionId} is missing.`);
      continue;
    }
    if (activeOrgId && !idsEqual(question?.orgId, activeOrgId)) {
      errors.push(`Question ${ref.questionVersionId} is outside the active organization.`);
      continue;
    }
    const skill = normalizeSkill(question?.skill || ref.skill);
    if (skill !== ref.skill) {
      errors.push(`Question ${ref.questionVersionId} is allocated under ${ref.skill} but belongs to ${skill || 'unknown'}.`);
      continue;
    }
    const status = cleanString(question?.status, { max: 40, allowEmpty: true }).toLowerCase();
    if (status !== 'published') {
      errors.push(`Question ${ref.questionVersionId} is ${status || 'not published'}.`);
    }
    const mediaProblems = resolveRequiredMediaProblems(question);
    errors.push(...mediaProblems.map((problem) => `${question?.code || ref.questionVersionId}: ${problem}`));
    rows.push(question);
  }

  const allocatedCount = refs.length;
  const loadedCount = rows.length;
  if (!allocatedCount) errors.push('This test has no allocated questions.');
  if (loadedCount !== allocatedCount) warnings.push(`${allocatedCount - loadedCount} allocated question(s) could not be loaded.`);

  return { refs, questions: rows, errors, warnings };
}

async function buildMockTestSummary(testRow = {}, requestingUser, accessContext = {}, options = {}) {
  const allocationState = await hydrateAllocatedQuestions(testRow, requestingUser, accessContext, options);
  const skillCoverage = buildSkillCoverage(testRow?.allocations || {});
  const questionById = new Map(allocationState.questions.map((question) => [cleanString(question?.id, { max: 120, allowEmpty: true }) || '', question]));
  const allocationSequence = allocationState.refs.map((ref, index) => {
    const question = questionById.get(cleanString(ref?.questionVersionId, { max: 120, allowEmpty: true }) || '') || {};
    return {
      questionVersionId: cleanString(ref?.questionVersionId, { max: 120, allowEmpty: true }) || '',
      skill: normalizeSkill(ref?.skill || question?.skill),
      questionType: cleanString(question?.questionType || ref?.questionType, { max: 120, allowEmpty: true }).toLowerCase() || '',
      questionOrder: index + 1,
      sequenceNo: Number(ref?.sequenceNo || index + 1) || index + 1
    };
  });
  const typeState = detectTestType(allocationState.questions);
  const validationErrors = [
    ...(Array.isArray(testRow?.validation?.errors) ? testRow.validation.errors : []),
    ...allocationState.errors,
    ...typeState.errors
  ];
  const validationWarnings = [
    ...(Array.isArray(testRow?.validation?.warnings) ? testRow.validation.warnings : []),
    ...allocationState.warnings,
    ...typeState.warnings
  ];
  const timingSnapshot = buildTimingSnapshot(typeState.testType === 'core' ? 'core' : 'academic', skillCoverage);
  const questionCount = allocationState.refs.length;
  const ready = String(testRow?.status || '').toLowerCase() === 'published'
    && questionCount > 0
    && validationErrors.length === 0
    && typeState.valid !== false;

  return {
    id: cleanString(testRow?.id, { max: 120, allowEmpty: true }) || '',
    familyId: cleanString(testRow?.familyId, { max: 140, allowEmpty: true }) || '',
    code: cleanString(testRow?.code, { max: 120, allowEmpty: true }) || '',
    title: cleanString(testRow?.title, { max: 260, allowEmpty: true }) || 'Untitled PTE Test',
    description: cleanString(testRow?.description, { max: 1200, allowEmpty: true }) || '',
    status: cleanString(testRow?.status, { max: 40, allowEmpty: true }).toLowerCase() || '',
    revisionNumber: Number.parseInt(String(testRow?.revisionNumber || '1'), 10) || 1,
    isLatestRevision: testRow?.isLatestRevision === true,
    publishedAt: cleanString(testRow?.publishingMeta?.publishedAt, { max: 80, allowEmpty: true }) || '',
    questionCount,
    allocationSequence,
    skillCoverage,
    detectedTestType: typeState.testType,
    detectedTestTypeLabel: typeState.label,
    estimatedMinutes: timingSnapshot.estimatedMinutes,
    timingSnapshot,
    ready,
    validationState: {
      valid: ready,
      errors: validationErrors,
      warnings: validationWarnings
    }
  };
}

async function findActiveStrictMockSession(requestingUser, options = {}) {
  const orgId = resolveActiveOrgId(requestingUser);
  const userId = resolveRequesterUserId(requestingUser);
  if (!orgId || !userId) return null;
  const rows = await pteAttemptSessionRepository.list({
    query: {
      orgId__eq: orgId,
      userId__eq: userId,
      attemptType__eq: 'test_run',
      status__eq: 'in_progress',
      page: 1,
      limit: 50
    },
    scope: { canViewAll: true },
    sort: { startedAt: -1, id: -1 },
    backendMode: options?.backendMode
  });
  return (Array.isArray(rows) ? rows : []).find((row) => {
    const metadata = isPlainObject(row?.metadata) ? row.metadata : {};
    const mockExam = isPlainObject(metadata.mockExam) ? metadata.mockExam : {};
    return cleanString(mockExam.mode, { max: 40, allowEmpty: true }).toLowerCase() === 'strict'
      && !FINAL_SESSION_STATUSES.has(cleanString(row?.status, { max: 40, allowEmpty: true }).toLowerCase());
  }) || null;
}

function findCurrentRuntimeItem(items = []) {
  const rows = Array.isArray(items) ? items.slice() : [];
  rows.sort((a, b) => {
    const orderA = Number(a?.questionOrder || 0) || 0;
    const orderB = Number(b?.questionOrder || 0) || 0;
    if (orderA !== orderB) return orderA - orderB;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
  return rows.find((item) => !FINAL_ITEM_STATUSES.has(cleanString(item?.status, { max: 40, allowEmpty: true }).toLowerCase())) || null;
}

function isStrictMockSession(session = {}) {
  const metadata = isPlainObject(session?.metadata) ? session.metadata : {};
  const mockExam = isPlainObject(metadata.mockExam) ? metadata.mockExam : {};
  return cleanString(mockExam.mode, { max: 40, allowEmpty: true }).toLowerCase() === 'strict';
}

function getMockExamTiming(session = {}) {
  const metadata = isPlainObject(session?.metadata) ? session.metadata : {};
  const mockExam = isPlainObject(metadata.mockExam) ? metadata.mockExam : {};
  return isPlainObject(mockExam.timingSnapshot) ? mockExam.timingSnapshot : {};
}

function getRemainingSeconds(session = {}, now = new Date()) {
  const timing = getMockExamTiming(session);
  const expiresAt = Date.parse(timing.expiresAt || '');
  if (!Number.isFinite(expiresAt)) return null;
  const nowMs = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getTime() : Date.now();
  return Math.max(0, Math.floor((expiresAt - nowMs) / 1000));
}

function isExpired(session = {}, now = new Date()) {
  const remaining = getRemainingSeconds(session, now);
  return remaining !== null && remaining <= 0;
}

function buildStartMetadata(summary = {}, equipmentCheck = {}, confirmationAcceptedAt = new Date()) {
  const startDate = confirmationAcceptedAt instanceof Date && !Number.isNaN(confirmationAcceptedAt.getTime())
    ? confirmationAcceptedAt
    : new Date();
  const timingSnapshot = buildTimingSnapshot(
    summary.detectedTestType === 'core' ? 'core' : 'academic',
    summary.skillCoverage || {},
    startDate,
    Array.isArray(summary.allocationSequence) ? summary.allocationSequence : []
  );
  return {
    mockExam: {
      mode: 'strict',
      resumePolicy: 'timer_continues',
      sourceModule: 'pte_mock_exam_ui',
      detectedTestType: summary.detectedTestType,
      detectedTestTypeLabel: summary.detectedTestTypeLabel,
      testTitle: summary.title,
      testCode: summary.code,
      testVersionId: summary.id,
      testFamilyId: summary.familyId,
      questionCount: summary.questionCount,
      skillCoverage: deepClone(summary.skillCoverage, {}),
      timingSnapshot,
      confirmationAcceptedAt: startDate.toISOString(),
      equipmentCheck: {
        microphone: cleanString(equipmentCheck?.microphone, { max: 40, allowEmpty: true }) || '',
        audio: cleanString(equipmentCheck?.audio, { max: 40, allowEmpty: true }) || ''
      },
      rules: {
        noPreviousNavigation: true,
        noPause: true,
        noReRecording: true,
        noPromptReplay: true,
        noMidExamScoring: true
      }
    }
  };
}

async function listPublishedMockTests(requestingUser, accessContext = {}, options = {}) {
  const orgId = resolveActiveOrgId(requestingUser);
  if (!orgId) throw new Error('Active organization context is required.');
  const rows = await pteTestVersionRepository.list({
    query: {
      orgId__eq: orgId,
      status__eq: 'published',
      page: 1,
      limit: Math.max(1, Math.min(250, Number.parseInt(String(options?.limit || '100'), 10) || 100))
    },
    scope: { canViewAll: true },
    sort: { 'publishingMeta.publishedAt': -1, 'audit.createDateTime': -1, id: -1 },
    backendMode: options?.backendMode
  });

  const tests = [];
  for (const row of (Array.isArray(rows) ? rows : [])) {
    // eslint-disable-next-line no-await-in-loop
    tests.push(await buildMockTestSummary(row, requestingUser, accessContext, options));
  }

  const activeSession = await findActiveStrictMockSession(requestingUser, options);
  return {
    tests,
    activeSession
  };
}

async function getMockTestReadiness(testVersionId, requestingUser, accessContext = {}, options = {}) {
  const orgId = resolveActiveOrgId(requestingUser);
  if (!orgId) throw new Error('Active organization context is required.');
  const id = cleanString(testVersionId, { max: 120, allowEmpty: true }) || '';
  if (!id) throw new Error('Test version id is required.');
  const test = await pteTestVersionRepository.getById(id, {
    backendMode: options?.backendMode
  });
  if (!test || !idsEqual(test?.orgId, orgId)) throw new Error('Published PTE test was not found for this organization.');
  if (String(test.status || '').toLowerCase() !== 'published') {
    throw new Error('Only published PTE tests can be used for mock exams.');
  }
  return buildMockTestSummary(test, requestingUser, accessContext, options);
}

async function scoreFinishedMockSession(sessionId, requestingUser, accessContext = {}, options = {}) {
  const detail = await pteAttemptLedgerService.getAttemptSessionDetail(
    sessionId,
    requestingUser,
    accessContext,
    {
      includeEvents: false,
      includeArtifacts: true,
      backendMode: options?.backendMode
    }
  );
  const session = detail?.session || null;
  if (!session || !isStrictMockSession(session)) {
    throw new Error('Strict mock exam session was not found.');
  }
  const items = Array.isArray(detail?.items) ? detail.items : [];
  const results = [];
  for (const item of items) {
    const status = cleanString(item?.status, { max: 40, allowEmpty: true }).toLowerCase();
    if (!['saved', 'submitted', 'auto_submitted', 'scored', 'feedback_provided'].includes(status)) continue;
    if (status === 'scored' || status === 'feedback_provided') {
      results.push({ itemId: item.id, status: 'skipped', reason: 'already_scored' });
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const scored = await pteAttemptLedgerService.scoreAttemptItem(
        session.id,
        item.id,
        {
          source: {
            module: 'pte_mock_exam_scoring',
            eventType: 'mock_exam_item_score_requested',
            eventId: `PTE-MOCK-SCORE-${item.id}-${Date.now()}`
          }
        },
        requestingUser,
        accessContext,
        {
          ...options,
          allowClosedSessionScoring: true
        }
      );
      results.push({ itemId: item.id, status: scored?.autoScoring?.status || 'processed' });
    } catch (error) {
      results.push({
        itemId: item.id,
        status: 'failed',
        message: cleanString(error?.message || error, { max: 500, allowEmpty: true }) || 'Unknown scoring error.'
      });
    }
  }
  return {
    sessionId: session.id,
    results
  };
}

module.exports = {
  FINAL_ITEM_STATUSES,
  buildMockTestSummary,
  buildStartMetadata,
  findActiveStrictMockSession,
  findCurrentRuntimeItem,
  getMockTestReadiness,
  getRemainingSeconds,
  isExpired,
  isStrictMockSession,
  listPublishedMockTests,
  scoreFinishedMockSession
};
