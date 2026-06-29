const path = require('path');
const fs = require('fs/promises');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const { isAjax } = requireCoreModule('MVC/utils/generalTools');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const uploadMiddleware = requireCoreModule('MVC/middleware/upload');
const fileAssetStorage = requireCoreModule('MVC/services/fileAssetStorageService');
const uploadFolderSettingsService = requireCoreModule('MVC/services/uploadFolderSettingsService');
const adminChekersService = requireCoreModule('MVC/services/adminChekersService');
const { SECTIONS, OPERATIONS } = requireCoreModule('config/accessConstants');
const schoolDataService = require('../../services/school/schoolDataService');
const schoolIdentityLookupService = require('../../services/school/schoolIdentityLookupService');
const examValidationService = require('../../services/school/examValidationService');
const classEnrollmentReadService = require('../../services/school/classEnrollmentReadService');
const examTemplateModel = require('../../models/school/examTemplateModel');
const examQuestionModel = require('../../models/school/examQuestionModel');
const examAllocationModel = require('../../models/school/examAllocationModel');
const examAssignmentModel = require('../../models/school/examAssignmentModel');
const {
  getActiveOrgIdOrThrow: getActiveOrgIdOrThrowShared,
  assertCreateOrgContextOrThrow: assertCreateOrgContextOrThrowShared
} = requireCoreModule('MVC/utils/orgContextUtils');

const WINDOW_POLICY_OPTIONS = examAllocationModel.WINDOW_POLICY_OPTIONS || ['strict_fixed_window', 'suggested_window'];
const QUESTION_PRESENTATION_MODE_OPTIONS = examAllocationModel.QUESTION_PRESENTATION_MODE_OPTIONS || ['sequential_one_by_one', 'all_questions_on_one_page'];

function hasOwn(obj, key) {
  return Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);
}

function isExamAdminViewer(reqUser) {
  return adminChekersService.isAdminForRequest(reqUser, SECTIONS.SCHOOL_EXAMS, OPERATIONS.READ_ALL, {
    orgId: reqUser?.activeOrgId,
    section: { id: SECTIONS.SCHOOL_EXAMS, category: 'SCHOOL' }
  });
}

function normalizeSelectedOptionIds(value) {
  if (Array.isArray(value)) return value.map((row) => String(row || '').trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value.split(',').map((row) => row.trim()).filter(Boolean);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).map((row) => String(row || '').trim()).filter(Boolean);
  }
  return [];
}

function deterministicStableHash(value) {
  const text = String(value || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getActiveOrgIdOrThrow(reqUser) {
  return getActiveOrgIdOrThrowShared(reqUser);
}

async function assertCreateOrgContextOrThrow(reqUser) {
  return assertCreateOrgContextOrThrowShared(reqUser, { scopeLabel: 'exams' });
}

function isDraftStatus(status) {
  return String(status || '').trim().toLowerCase() === 'draft';
}

function ensureSameOrg(record, activeOrgId, label) {
  if (!record) throw new Error(`${label} not found.`);
  if (!idsEqual(record.orgId, activeOrgId)) {
    throw new Error(`${label} is not accessible in the active organization.`);
  }
}

function resolveTemplateRootId(template = {}) {
  return String(template?.rootTemplateId || template?.id || '').trim();
}

function resolveTemplateParentId(template = {}) {
  return String(template?.parentTemplateId || '').trim();
}

async function listSchoolPersonRecords(reqUser, { q = '', query = {}, requireSchoolRole = false, allowedSchoolRoles = [] } = {}) {
  const payload = await schoolIdentityLookupService.listSchoolPersonRecords({
    reqUser,
    q,
    query,
    requireSchoolRole,
    allowedSchoolRoles
  });
  return payload?.allRows || payload?.rows || [];
}

function resolveTemplateRevisionDepth(template = {}) {
  const depth = Number(template?.revisionDepth || 0);
  return Number.isFinite(depth) && depth >= 0 ? depth : 0;
}

async function getTemplateLockState(template, reqUser) {
  const publishedLocked = Boolean(String(template?.publishedRevisionId || '').trim());
  const linkedAllocations = await schoolDataService.fetchData('examAllocations', {
    templateId__eq: String(template?.id || '').trim()
  }, reqUser);
  const assignedLocked = Array.isArray(linkedAllocations) && linkedAllocations.length > 0;
  return {
    isLocked: publishedLocked || assignedLocked,
    publishedLocked,
    assignedLocked,
    allocationCount: Array.isArray(linkedAllocations) ? linkedAllocations.length : 0
  };
}

async function assertTemplateEditableOrThrow(template, reqUser) {
  const lock = await getTemplateLockState(template, reqUser);
  if (!lock.isLocked) return lock;
  const reasons = [];
  if (lock.publishedLocked) reasons.push('it has a published revision');
  if (lock.assignedLocked) reasons.push(`it has ${lock.allocationCount} allocation(s)`);
  throw new Error(`Published/allocated templates are immutable because ${reasons.join(' and ')}. Create a revision template copy instead.`);
}

function sortRevisionsDesc(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])]
    .sort((a, b) => Number(b?.revisionNo || 0) - Number(a?.revisionNo || 0));
}

function pickLatestRevision(rows = []) {
  return sortRevisionsDesc(rows)[0] || null;
}

function pickDraftRevision(rows = []) {
  return sortRevisionsDesc(rows)
    .find((row) => String(row?.status || '').trim().toLowerCase() === 'draft') || null;
}

function pickPublishedRevisionFromTemplate(template, rows = []) {
  const publishedRevisionId = String(template?.publishedRevisionId || '').trim();
  if (publishedRevisionId) {
    const exact = (Array.isArray(rows) ? rows : []).find((row) => idsEqual(row?.id, publishedRevisionId));
    if (exact) return exact;
  }
  return sortRevisionsDesc(rows)
    .find((row) => String(row?.status || '').trim().toLowerCase() === 'published') || null;
}

async function getTemplateRevisions(templateId, reqUser) {
  return schoolDataService.fetchData('examRevisions', { templateId__eq: String(templateId || '').trim() }, reqUser);
}

async function resolveTemplateQuestionRevision(template, reqUser, options = {}) {
  const requireEditable = options.requireEditable === true;
  const [revisions, lockState] = await Promise.all([
    getTemplateRevisions(template.id, reqUser),
    getTemplateLockState(template, reqUser)
  ]);

  if (requireEditable) {
    await assertTemplateEditableOrThrow(template, reqUser);
    let draftRevision = pickDraftRevision(revisions);
    if (!draftRevision) {
      draftRevision = await schoolDataService.createExamDraftRevision(template.id, {
        title: `${template.title || 'Exam'} - R${Number(template?.latestRevisionNo || 0) + 1}`
      }, reqUser);
    }
    return {
      revision: draftRevision,
      revisions,
      lockState
    };
  }

  const publishedRevision = pickPublishedRevisionFromTemplate(template, revisions);
  const draftRevision = pickDraftRevision(revisions);
  const latestRevision = pickLatestRevision(revisions);
  const selectedRevision = publishedRevision || draftRevision || latestRevision;
  if (!selectedRevision) {
    throw new Error('Template has no revision data yet.');
  }
  return {
    revision: selectedRevision,
    revisions,
    lockState,
    publishedRevision,
    draftRevision
  };
}

async function resolveTemplatePublishedRevisionOrThrow(template, reqUser) {
  const revisions = await getTemplateRevisions(template.id, reqUser);
  const publishedRevision = pickPublishedRevisionFromTemplate(template, revisions);
  if (!publishedRevision) {
    throw new Error('Publish this template before creating allocations.');
  }
  return {
    revision: publishedRevision,
    revisions
  };
}

async function getTemplateOrThrow(templateId, reqUser) {
  const activeOrgId = getActiveOrgIdOrThrow(reqUser);
  const template = await schoolDataService.getDataById('examTemplates', templateId, reqUser);
  ensureSameOrg(template, activeOrgId, 'Exam template');
  return template;
}

async function getRevisionOrThrow(revisionId, reqUser, template = null) {
  const activeOrgId = getActiveOrgIdOrThrow(reqUser);
  const revision = await schoolDataService.getDataById('examRevisions', revisionId, reqUser);
  ensureSameOrg(revision, activeOrgId, 'Exam revision');
  if (template && !idsEqual(revision.templateId, template.id)) {
    throw new Error('Revision does not belong to template.');
  }
  return revision;
}

async function getQuestionOrThrow(questionId, reqUser, revision = null) {
  const activeOrgId = getActiveOrgIdOrThrow(reqUser);
  const question = await schoolDataService.getDataById('examQuestions', questionId, reqUser);
  ensureSameOrg(question, activeOrgId, 'Exam question');
  if (revision && !idsEqual(question.revisionId, revision.id)) {
    throw new Error('Question does not belong to revision.');
  }
  return question;
}

async function getAllocationOrThrow(allocationId, reqUser) {
  const activeOrgId = getActiveOrgIdOrThrow(reqUser);
  const allocation = await schoolDataService.getDataById('examAllocations', allocationId, reqUser);
  ensureSameOrg(allocation, activeOrgId, 'Exam allocation');
  return allocation;
}

function toIsoUtcFromLocalTokens(localDate, localTime, timezone) {
  const dateToken = String(localDate || '').trim();
  const timeToken = String(localTime || '').trim();
  if (!dateToken || !timeToken) return '';

  const safeTime = timeToken.length === 5 ? `${timeToken}:00` : timeToken;
  const tz = String(timezone || '').trim().toUpperCase();
  if (tz === 'UTC') {
    const iso = `${dateToken}T${safeTime}.000Z`;
    return Number.isNaN(Date.parse(iso)) ? '' : iso;
  }

  const localDateObj = new Date(`${dateToken}T${safeTime}`);
  if (Number.isNaN(localDateObj.getTime())) return '';
  return localDateObj.toISOString();
}

function toLocalTokensFromUtc(isoUtc) {
  const parsed = new Date(String(isoUtc || '').trim());
  if (Number.isNaN(parsed.getTime())) {
    return { date: '', time: '' };
  }
  return {
    date: parsed.toISOString().slice(0, 10),
    time: parsed.toISOString().slice(11, 16)
  };
}

function normalizeId(value) {
  return String(value || '').trim();
}

function resolveLinkedPersonId(rawValue, teacherPersonMap = new Map()) {
  const raw = normalizeId(rawValue);
  if (!raw) return '';
  return normalizeId(teacherPersonMap.get(raw) || raw);
}

function buildTeacherPersonMap(teachers = []) {
  const map = new Map();
  (Array.isArray(teachers) ? teachers : []).forEach((row) => {
    const teacherId = normalizeId(row?.id);
    const personId = normalizeId(row?.personId);
    if (teacherId && personId) map.set(teacherId, personId);
  });
  return map;
}

function classHasInstructorPerson(classRow, personId, teacherPersonMap = new Map()) {
  const normalizedPersonId = normalizeId(personId);
  if (!normalizedPersonId) return false;
  const instructors = Array.isArray(classRow?.instructors) ? classRow.instructors : [];
  return instructors.some((inst) => {
    const linked = resolveLinkedPersonId(inst?.personId, teacherPersonMap);
    return linked && idsEqual(linked, normalizedPersonId);
  });
}

function isFinalizedAssignmentStatus(status) {
  const token = String(status || '').trim().toLowerCase();
  return ['graded', 'submitted', 'auto_submitted', 'cancelled'].includes(token);
}

function isScheduleSyncableAssignmentStatus(status) {
  const token = String(status || '').trim().toLowerCase();
  return ['pending', 'available'].includes(token);
}

const TAKE_EXAM_DATE_PRESET_OPTIONS = Object.freeze([
  'all',
  'today',
  'next_7_days',
  'next_30_days',
  'this_month',
  'custom'
]);

const TAKE_EXAM_LIFECYCLE_OPTIONS = Object.freeze([
  { id: 'all', label: 'All' },
  { id: 'action_required', label: 'Need Attention' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'finished', label: 'Finished' },
  { id: 'expired', label: 'Expired' }
]);
const TAKE_EXAM_DEFAULT_DATE_PRESET = 'today';
const TAKE_EXAM_DEFAULT_LIFECYCLE = 'all';
const TAKE_ASSIGNMENTS_TABLE_NAME = 'School_Exam_Take_Assignments';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toUtcDateToken(dateLike) {
  if (!(dateLike instanceof Date) || Number.isNaN(dateLike.getTime())) return '';
  return `${dateLike.getUTCFullYear()}-${pad2(dateLike.getUTCMonth() + 1)}-${pad2(dateLike.getUTCDate())}`;
}

function coerceDateToken(value) {
  const token = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) return '';
  const ms = Date.parse(`${token}T00:00:00.000Z`);
  return Number.isFinite(ms) ? token : '';
}

function addUtcDays(dateLike, days) {
  if (!(dateLike instanceof Date) || Number.isNaN(dateLike.getTime())) return null;
  return new Date(Date.UTC(
    dateLike.getUTCFullYear(),
    dateLike.getUTCMonth(),
    dateLike.getUTCDate() + Number(days || 0)
  ));
}

function resolveDatePresetRangeUtc(preset, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const normalized = String(preset || '').trim().toLowerCase();
  if (normalized === 'today') {
    const token = toUtcDateToken(today);
    return { startDate: token, endDate: token };
  }
  if (normalized === 'next_7_days') {
    return { startDate: toUtcDateToken(today), endDate: toUtcDateToken(addUtcDays(today, 6)) };
  }
  if (normalized === 'next_30_days') {
    return { startDate: toUtcDateToken(today), endDate: toUtcDateToken(addUtcDays(today, 29)) };
  }
  if (normalized === 'this_month') {
    const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
    return { startDate: toUtcDateToken(first), endDate: toUtcDateToken(last) };
  }
  return { startDate: '', endDate: '' };
}

function resolveTakeExamDateFilters(query = {}) {
  const requestedPreset = String(query?.datePreset || '').trim().toLowerCase();
  const preset = TAKE_EXAM_DATE_PRESET_OPTIONS.includes(requestedPreset) ? requestedPreset : '';
  let windowStartDate = coerceDateToken(query?.windowStartDate);
  let windowEndDate = coerceDateToken(query?.windowEndDate);

  const hasManualDates = Boolean(windowStartDate || windowEndDate);
  let effectivePreset = hasManualDates ? 'custom' : (preset || TAKE_EXAM_DEFAULT_DATE_PRESET);
  if (!hasManualDates) {
    if (effectivePreset === 'all' || effectivePreset === 'custom') {
      windowStartDate = '';
      windowEndDate = '';
    } else {
      const range = resolveDatePresetRangeUtc(effectivePreset, new Date());
      windowStartDate = range.startDate;
      windowEndDate = range.endDate;
    }
  }

  if (windowStartDate && windowEndDate && windowStartDate > windowEndDate) {
    const swap = windowStartDate;
    windowStartDate = windowEndDate;
    windowEndDate = swap;
  }

  const filterStartMs = windowStartDate ? Date.parse(`${windowStartDate}T00:00:00.000Z`) : null;
  const filterEndMs = windowEndDate ? Date.parse(`${windowEndDate}T23:59:59.999Z`) : null;
  return {
    datePreset: effectivePreset,
    windowStartDate,
    windowEndDate,
    filterStartMs: Number.isFinite(filterStartMs) ? filterStartMs : null,
    filterEndMs: Number.isFinite(filterEndMs) ? filterEndMs : null
  };
}

function resolveTakeAssignmentLifecycleBucket({ assignmentStatus, latestAttemptStatus, startWindowUtc, endWindowUtc }, nowMs) {
  const statusToken = String(assignmentStatus || '').trim().toLowerCase();
  const attemptToken = String(latestAttemptStatus || '').trim().toLowerCase();
  const finishedStatuses = new Set(['submitted', 'auto_submitted', 'graded']);
  if (finishedStatuses.has(statusToken)) return 'finished';
  if (statusToken === 'expired') return 'expired';
  if (statusToken === 'started' || attemptToken === 'in_progress') return 'in_progress';

  const endMs = Date.parse(String(endWindowUtc || '').trim());
  if (Number.isFinite(endMs) && endMs < nowMs) return 'expired';

  const startMs = Date.parse(String(startWindowUtc || '').trim());
  if (Number.isFinite(startMs) && startMs > nowMs) return 'scheduled';

  return 'action_required';
}

function resolveAllocationSourceSessionMeta(allocation = {}, classRow = null) {
  const sessions = Array.isArray(classRow?.sessions) ? classRow.sessions : [];
  const existingSessionId = normalizeId(
    allocation?.extensions?.sourceSession?.sessionId
    || allocation?.extensions?.sourceSession?.id
    || allocation?.sourceSessionId
  );
  if (existingSessionId) {
    const matched = sessions.find((row) => idsEqual(row?.sessionId, existingSessionId)) || null;
    return {
      sessionId: existingSessionId,
      date: normalizeId(allocation?.extensions?.sourceSession?.sessionDate || matched?.date),
      startTime: normalizeId(allocation?.extensions?.sourceSession?.startTime || matched?.startTime),
      endTime: normalizeId(allocation?.extensions?.sourceSession?.endTime || matched?.endTime)
    };
  }

  const targetDate = normalizeId(
    allocation?.extensions?.sourceSession?.sessionDate
    || allocation?.windowStartLocalDate
    || allocation?.scheduling?.windowStartLocalDate
  );
  const targetStart = normalizeId(
    allocation?.extensions?.sourceSession?.startTime
    || allocation?.windowStartLocalTime
    || allocation?.scheduling?.windowStartLocalTime
  );
  if (!targetDate || !sessions.length) {
    return { sessionId: '', date: targetDate, startTime: targetStart, endTime: '' };
  }

  const matched = sessions.find((row) => {
    const rowDate = normalizeId(row?.date);
    const rowStart = normalizeId(row?.startTime);
    if (!rowDate || rowDate !== targetDate) return false;
    if (!targetStart) return true;
    return !rowStart || rowStart === targetStart;
  }) || null;

  if (!matched) {
    return { sessionId: '', date: targetDate, startTime: targetStart, endTime: '' };
  }

  return {
    sessionId: normalizeId(matched?.sessionId),
    date: normalizeId(matched?.date),
    startTime: normalizeId(matched?.startTime),
    endTime: normalizeId(matched?.endTime)
  };
}

function resolveTeacherViewerContext(req) {
  const isAdminViewer = isExamAdminViewer(req.user);
  const requestedPersonId = normalizeId(req.query?.personId || req.body?.personId);
  if (isAdminViewer) {
    return {
      isAdminViewer: true,
      personId: requestedPersonId
    };
  }

  const selfPersonId = normalizeId(req.user?.personId);
  if (!selfPersonId) {
    throw new Error('Your user account is not linked to a person. Please contact administrator.');
  }
  return {
    isAdminViewer: false,
    personId: selfPersonId
  };
}

/**
 * Resolves which person scope applies for teacher review (list + detail).
 * Admins pass teacherId (preferred) or legacy personId; teachers use their linked person only.
 */
function resolveTeacherReviewPersonScope(req, teachers = []) {
  const viewer = resolveTeacherViewerContext(req);
  if (!viewer.isAdminViewer) {
    return {
      viewer,
      effectivePersonId: normalizeId(viewer.personId),
      selectedTeacherId: ''
    };
  }

  const selectedTeacherId = normalizeId(req.query?.teacherId || req.body?.teacherId);
  if (selectedTeacherId) {
    const t = (teachers || []).find((row) => idsEqual(row?.id, selectedTeacherId));
    return {
      viewer,
      effectivePersonId: normalizeId(t?.personId),
      selectedTeacherId
    };
  }

  return {
    viewer,
    effectivePersonId: normalizeId(viewer.personId),
    selectedTeacherId: ''
  };
}

async function resolvePersonDisplay(personId, reqUser) {
  const normalizedPersonId = normalizeId(personId);
  if (!normalizedPersonId) return '';
  try {
    const persons = await listSchoolPersonRecords(reqUser, {
      q: normalizedPersonId,
      query: { q: normalizedPersonId, limit: 200 }
    });
    const person = (persons || []).find((row) => idsEqual(row?.id, normalizedPersonId)) || null;
    if (!person) return normalizedPersonId;
    const first = String(person?.name?.first || '').trim();
    const last = String(person?.name?.last || '').trim();
    const fullName = `${first} ${last}`.trim();
    return fullName || String(person?.displayName || person?.id || normalizedPersonId).trim();
  } catch (_) {
    return normalizedPersonId;
  }
}

function resolveUserDisplayName(reqUser = {}) {
  const first = String(reqUser?.name?.first || '').trim();
  const last = String(reqUser?.name?.last || '').trim();
  const fullName = `${first} ${last}`.trim();
  if (fullName) return fullName;
  return String(
    reqUser?.identity?.displayName
    || reqUser?.name
    || reqUser?.username
    || reqUser?.email
    || reqUser?.id
    || ''
  ).trim();
}

function normalizeSubjectIdList(template = {}) {
  const fromArray = Array.isArray(template?.subjectIds) ? template.subjectIds : [];
  if (fromArray.length) return fromArray.map((row) => String(row || '').trim()).filter(Boolean);
  const single = String(template?.subjectId || '').trim();
  return single ? [single] : [];
}

function normalizeAssignmentStatus(value) {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'auto_submitted') return 'submitted';
  return token;
}

function buildAssignmentCounts(rows = []) {
  const counts = { total: 0, pending: 0, started: 0, submitted: 0, graded: 0 };
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    counts.total += 1;
    const st = normalizeAssignmentStatus(row?.status);
    if (st === 'pending') counts.pending += 1;
    else if (st === 'started') counts.started += 1;
    else if (st === 'submitted') counts.submitted += 1;
    else if (st === 'graded') counts.graded += 1;
  });
  return counts;
}

async function resolveRosterStudentIdsByClass(classId, reqUser) {
  const normalizedClassId = String(classId || '').trim();
  if (!normalizedClassId) return { studentIds: [], source: 'none' };

  const classRow = await schoolDataService.getDataById('classes', normalizedClassId, reqUser);
  const activeOrgId = String(reqUser?.activeOrgId || classRow?.orgId || '').trim();
  const today = new Date().toISOString().slice(0, 10);
  const enrollmentSnapshot = await classEnrollmentReadService.listActiveStudentIdsForClass({
    classId: normalizedClassId,
    classItem: classRow,
    reqUser,
    activeOrgId,
    sessionDates: [today],
    startDate: today,
    endDate: today,
    canonicalStatuses: ['active']
  });
  const studentIds = Array.from(
    enrollmentSnapshot?.studentIds instanceof Set
      ? enrollmentSnapshot.studentIds
      : new Set()
  )
    .map((row) => String(row || '').trim())
    .filter(Boolean);
  return {
    studentIds,
    source: String(enrollmentSnapshot?.source || 'canonical')
  };
}

function parseStudentIdsInput(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((row) => String(row || '').trim()).filter(Boolean)));
  }
  return Array.from(new Set(
    String(value || '')
      .split(/[\n,\s;]+/g)
      .map((row) => String(row || '').trim())
      .filter(Boolean)
  ));
}

function getExemptStudentIdSet(allocation = {}) {
  const list = Array.isArray(allocation?.extensions?.exemptStudentIds)
    ? allocation.extensions.exemptStudentIds
    : [];
  return new Set(
    list
      .map((row) => String(row || '').trim())
      .filter(Boolean)
  );
}

async function saveAllocationExemptStudentIds(allocation, exemptStudentIdSet, reqUser) {
  const nextExtensions = {
    ...(allocation?.extensions && typeof allocation.extensions === 'object' ? allocation.extensions : {}),
    exemptStudentIds: Array.from(exemptStudentIdSet).sort((a, b) => a.localeCompare(b))
  };
  return schoolDataService.updateData('examAllocations', allocation.id, {
    extensions: nextExtensions,
    audit: { lastUpdateUser: String(reqUser?.id || '').trim() }
  }, reqUser);
}

async function showHome(req, res) {
  try {
    const [templates, revisions, questions] = await Promise.all([
      schoolDataService.fetchData('examTemplates', {}, req.user),
      schoolDataService.fetchData('examRevisions', {}, req.user),
      schoolDataService.fetchData('examQuestions', {}, req.user)
    ]);
    const summary = {
      templateCount: templates.length,
      draftRevisionCount: revisions.filter((row) => isDraftStatus(row.status)).length,
      publishedRevisionCount: revisions.filter((row) => String(row.status || '').trim().toLowerCase() === 'published').length,
      questionCount: questions.length
    };

    const dashboardSections = [
      {
        title: 'Exam Templates',
        description: `Create original exams or create revisions by cloning any existing template. Total templates: ${summary.templateCount}.`,
        href: '/school/exams/templates',
        icon: 'bi-journal-richtext',
        subtleClass: 'bg-primary-subtle text-primary',
        buttonClass: 'btn btn-primary',
        buttonLabel: 'Open Templates'
      },
      {
        title: 'Exam Allocations',
        description: 'Schedule published templates to classes and generate student assignments.',
        href: '/school/exams/allocations',
        icon: 'bi-calendar2-check',
        subtleClass: 'bg-success-subtle text-success',
        buttonClass: 'btn btn-success',
        buttonLabel: 'Open Allocations'
      },
      {
        title: 'Take Exam',
        description: 'Students can start assigned exams, and admins can take on behalf of selected students.',
        href: '/school/exams/take',
        icon: 'bi-pencil-square',
        subtleClass: 'bg-info-subtle text-info',
        buttonClass: 'btn btn-info',
        buttonLabel: 'Open Take Exam'
      },
      {
        title: 'Teacher Review',
        description: 'Pick a teacher (admins), open an exam, then review and grade student attempts.',
        href: '/school/exams/teacher-assignments',
        icon: 'bi-clipboard-check',
        subtleClass: 'bg-warning-subtle text-warning-emphasis',
        buttonClass: 'btn btn-warning',
        buttonLabel: 'Open Review'
      }
    ];

    return res.render('school/exam/examHome', {
      title: 'School Exams',
      summary,
      dashboardSections,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function listTemplates(req, res) {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const templates = await schoolDataService.fetchData('examTemplates', {}, req.user);
    const allocationRows = await schoolDataService.fetchData('examAllocations', {}, req.user);
    const allocationCountByTemplateId = new Map();
    (allocationRows || []).forEach((row) => {
      const templateId = String(row?.templateId || '').trim();
      if (!templateId) return;
      allocationCountByTemplateId.set(templateId, Number(allocationCountByTemplateId.get(templateId) || 0) + 1);
    });

    const filtered = templates
      .filter((row) => {
        if (!q) return true;
        return [
          row.id,
          row.code,
          row.title,
          row.description,
          row.status,
          row.ownerUserId,
          row.ownerTeacherId,
          row.visibility,
          row.departmentName,
          row.departmentCode
        ]
          .map((value) => String(value || '').toLowerCase())
          .some((value) => value.includes(q));
      })
      .map((row) => {
        const subjectIds = normalizeSubjectIdList(row);
        const parentTemplateId = resolveTemplateParentId(row);
        const rootTemplateId = resolveTemplateRootId(row);
        const depth = resolveTemplateRevisionDepth(row);
        const allocationCount = Number(allocationCountByTemplateId.get(String(row.id || '').trim()) || 0);
        const publishedLocked = Boolean(String(row?.publishedRevisionId || '').trim());
        const assignedLocked = allocationCount > 0;
        return {
          ...row,
          subjectCount: subjectIds.length,
          parentTemplateId,
          rootTemplateId,
          revisionDepth: depth,
          allocationCount,
          isImmutableTemplate: publishedLocked || assignedLocked
        };
      })
      .sort((a, b) => String(b.audit?.lastUpdateDateTime || b.audit?.createDateTime || '')
        .localeCompare(String(a.audit?.lastUpdateDateTime || a.audit?.createDateTime || '')));

    const { data, pagination } = paginate(filtered, req.query);
    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    const sourceTemplates = filtered
      .map((row) => ({
        id: String(row.id || '').trim(),
        title: String(row.title || '').trim(),
        status: String(row.status || '').trim().toLowerCase(),
        parentTemplateId: resolveTemplateParentId(row),
        revisionDepth: resolveTemplateRevisionDepth(row)
      }))
      .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));

    return res.render('school/exam/templateList', {
      title: 'Exam Templates',
      tableName: 'School_Exam_Templates',
      data,
      sourceTemplates,
      newUrl: 'school/exams/templates',
      newLabel: 'Create Original Exam',
      pagination,
      filters: req.query,
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: false,
      canShowRevisionControls: true,
      print: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function showTemplateForm(req, res) {
  try {
    const templateId = String(req.params.templateId || '').trim();
    const isEdit = Boolean(templateId);
    let template = null;
    let questionRevision = null;
    let questionRows = [];
    let canPublishFromForm = false;

    if (isEdit) {
      template = await getTemplateOrThrow(templateId, req.user);
      await assertTemplateEditableOrThrow(template, req.user);
      const questionContext = await resolveTemplateQuestionRevision(template, req.user, { requireEditable: true });
      questionRevision = questionContext?.revision || null;
      if (questionRevision?.id) {
        const bundle = await schoolDataService.getExamRevisionBundle(questionRevision.id, req.user);
        questionRows = (Array.isArray(bundle?.questions) ? bundle.questions : [])
          .sort((a, b) => Number(a?.sequenceNo || 0) - Number(b?.sequenceNo || 0));
      }
      canPublishFromForm = String(questionRevision?.status || '').trim().toLowerCase() === 'draft';
    } else {
      await assertCreateOrgContextOrThrow(req.user);
    }

    const [departments, subjects] = await Promise.all([
      schoolDataService.fetchData('departments', {}, req.user),
      schoolDataService.fetchData('subjects', {}, req.user)
    ]);

    const subjectMap = new Map((subjects || []).map((row) => [String(row.id || ''), row]));
    const selectedSubjectIds = normalizeSubjectIdList(template || {});
    const selectedSubjects = selectedSubjectIds.map((id) => {
      const subject = subjectMap.get(String(id)) || null;
      return {
        id: String(id),
        code: String(subject?.code || '').trim(),
        title: String(subject?.title || subject?.name || id).trim(),
        status: String(subject?.status || '').trim(),
        credits: Number(subject?.configuration?.credits || 0) || 0
      };
    });

    return res.render('school/exam/templateForm', {
      title: isEdit ? `Edit Template: ${template.title}` : 'New Exam Template',
      template,
      questionRevision,
      questionRows,
      canPublishFromForm,
      templateStatuses: examTemplateModel.TEMPLATE_STATUSES,
      questionStatuses: examQuestionModel.QUESTION_STATUSES,
      questionTypes: examQuestionModel.QUESTION_TYPES,
      objectiveModes: examQuestionModel.OBJECTIVE_MODES,
      departments: (departments || []).sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''))),
      selectedSubjects,
      currentOwnerUserId: String(template?.ownerUserId || req.user?.id || '').trim(),
      currentOwnerDisplayName: resolveUserDisplayName(req.user),
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function saveTemplate(req, res) {
  try {
    const templateId = String(req.params.templateId || '').trim();
    const isEdit = Boolean(templateId);
    let template = null;
    if (isEdit) {
      template = await getTemplateOrThrow(templateId, req.user);
      await assertTemplateEditableOrThrow(template, req.user);
    }

    const payload = examValidationService.parseTemplatePayload(req.body, template);
    payload.ownerUserId = String(template?.ownerUserId || req.user?.id || '').trim();
    payload.ownerTeacherId = String(template?.ownerTeacherId || '').trim();
    payload.audit.lastUpdateUser = String(req.user?.id || '').trim();

    if (isEdit) {
      await schoolDataService.updateData('examTemplates', template.id, payload, req.user);
      if (isAjax(req)) return res.json({ status: 'success', message: 'Template saved successfully.', templateId: template.id });
      return res.redirect(`/school/exams/templates/${encodeURIComponent(template.id)}`);
    }

    const activeOrgId = await assertCreateOrgContextOrThrow(req.user);
    payload.orgId = activeOrgId;
    const created = await schoolDataService.createExamTemplate(payload, req.user);
    const createdTemplateId = created?.template?.id;
    if (isAjax(req)) {
      return res.json({
        status: 'success',
        message: 'Template created successfully.',
        templateId: createdTemplateId,
        revisionId: created?.revision?.id || ''
      });
    }
    return res.redirect(`/school/exams/templates/${encodeURIComponent(createdTemplateId)}`);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function viewTemplate(req, res) {
  try {
    const template = await getTemplateOrThrow(req.params.templateId, req.user);
    const [questionContext, subjects, allTemplates] = await Promise.all([
      resolveTemplateQuestionRevision(template, req.user, { requireEditable: false }),
      schoolDataService.fetchData('subjects', {}, req.user),
      schoolDataService.fetchData('examTemplates', {}, req.user)
    ]);
    const revisions = Array.isArray(questionContext?.revisions) ? questionContext.revisions : [];
    const selectedQuestionRevision = questionContext?.revision || null;
    const publishedRevision = questionContext?.publishedRevision || pickPublishedRevisionFromTemplate(template, revisions);
    const draftRevision = questionContext?.draftRevision || pickDraftRevision(revisions);
    const lockState = questionContext?.lockState || { isLocked: false, publishedLocked: false, assignedLocked: false, allocationCount: 0 };
    let selectedQuestions = [];
    if (selectedQuestionRevision?.id) {
      const questionBundle = await schoolDataService.getExamRevisionBundle(selectedQuestionRevision.id, req.user);
      selectedQuestions = (Array.isArray(questionBundle?.questions) ? questionBundle.questions : [])
        .sort((a, b) => Number(a?.sequenceNo || 0) - Number(b?.sequenceNo || 0));
    }
    const subjectMap = new Map((subjects || []).map((row) => [String(row.id || ''), row]));
    const templateSubjectIds = normalizeSubjectIdList(template);
    const templateSubjects = templateSubjectIds.map((id) => {
      const subject = subjectMap.get(String(id)) || null;
      return {
        id: String(id),
        code: String(subject?.code || '').trim(),
        title: String(subject?.title || subject?.name || id).trim(),
        status: String(subject?.status || '').trim(),
        credits: Number(subject?.configuration?.credits || 0) || 0
      };
    });
    const rootTemplateId = resolveTemplateRootId(template);
    const lineageRows = (Array.isArray(allTemplates) ? allTemplates : [])
      .filter((row) => idsEqual(resolveTemplateRootId(row), rootTemplateId))
      .map((row) => ({
        id: String(row.id || '').trim(),
        title: String(row.title || '').trim(),
        parentTemplateId: resolveTemplateParentId(row),
        rootTemplateId: resolveTemplateRootId(row),
        revisionDepth: resolveTemplateRevisionDepth(row),
        ownerUserId: String(row.ownerUserId || '').trim(),
        status: String(row.status || '').trim().toLowerCase(),
        publishedRevisionId: String(row.publishedRevisionId || '').trim(),
        createdAt: String(row?.audit?.createDateTime || '').trim(),
        updatedAt: String(row?.audit?.lastUpdateDateTime || '').trim()
      }))
      .sort((a, b) => {
        const d = Number(a.revisionDepth || 0) - Number(b.revisionDepth || 0);
        if (d !== 0) return d;
        return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      });

    return res.render('school/exam/templateView', {
      title: `Exam Template: ${template.title}`,
      template,
      templateSubjects,
      templateLockState: lockState,
      lineageRows,
      rootTemplateId,
      selectedQuestionRevision,
      selectedQuestions,
      revisions: sortRevisionsDesc(revisions),
      draftRevision,
      publishedRevision,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function createTemplateRevisionCopy(req, res) {
  try {
    const sourceTemplateId = String(req.params.templateId || req.body.sourceTemplateId || '').trim();
    if (!sourceTemplateId) throw new Error('Source template is required.');
    const sourceTemplate = await getTemplateOrThrow(sourceTemplateId, req.user);
    if (!String(sourceTemplate?.publishedRevisionId || '').trim()) {
      throw new Error('Revisions can only be created from published templates.');
    }
    const payload = {
      title: String(req.body.title || '').trim() || sourceTemplate.title,
      code: String(req.body.code || '').trim() || sourceTemplate.code,
      description: String(req.body.description || '').trim() || sourceTemplate.description
    };
    const cloned = await schoolDataService.cloneExamTemplateAsRevision(sourceTemplate.id, payload, req.user);
    const clonedTemplateId = String(cloned?.template?.id || '').trim();
    const clonedRevisionId = String(cloned?.revision?.id || '').trim();

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        message: 'Revision template created successfully.',
        templateId: clonedTemplateId,
        revisionId: clonedRevisionId,
        parentTemplateId: sourceTemplate.id
      });
    }

    return res.redirect(`/school/exams/templates/edit/${encodeURIComponent(clonedTemplateId)}#tab-questions`);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

function classHasPrimaryInstructorPerson(classRow, personId, teacherPersonMap = new Map()) {
  const normalizedPersonId = normalizeId(personId);
  if (!normalizedPersonId) return false;
  const instructors = Array.isArray(classRow?.instructors) ? classRow.instructors : [];
  return instructors.some((inst) => {
    const linked = resolveLinkedPersonId(inst?.personId, teacherPersonMap);
    const role = String(inst?.role || '').trim().toLowerCase();
    const status = String(inst?.status || '').trim().toLowerCase();
    const isPrimary = role === 'primary' || role === 'primary instructor';
    const isActive = !status || status === 'active';
    return linked && idsEqual(linked, normalizedPersonId) && isPrimary && isActive;
  });
}

async function publishRevision(req, res) {
  try {
    const template = await getTemplateOrThrow(req.params.templateId, req.user);
    const revisionId = String(req.params.revisionId || '').trim();
    let revision = null;
    if (revisionId) {
      revision = await getRevisionOrThrow(revisionId, req.user, template);
    } else {
      await assertTemplateEditableOrThrow(template, req.user);
      const revisions = await getTemplateRevisions(template.id, req.user);
      revision = pickDraftRevision(revisions);
      if (!revision) {
        throw new Error('No draft revision exists for this template. Create a revision copy first.');
      }
    }
    await schoolDataService.publishExamRevision(revision.id, {}, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Template published successfully.', revisionId: revision.id });
    return res.redirect(`/school/exams/templates/${encodeURIComponent(template.id)}`);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function saveQuestion(req, res) {
  try {
    const template = await getTemplateOrThrow(req.params.templateId, req.user);
    const requestedRevisionId = String(req.params.revisionId || '').trim();
    const context = requestedRevisionId
      ? { revision: await getRevisionOrThrow(requestedRevisionId, req.user, template) }
      : await resolveTemplateQuestionRevision(template, req.user, { requireEditable: true });
    const revision = context.revision;
    const questionId = String(req.params.questionId || '').trim();
    const isEdit = Boolean(questionId);

    if (!isDraftStatus(revision.status)) {
      throw new Error('Only draft revisions can be edited.');
    }

    let existingQuestion = null;
    if (isEdit) {
      existingQuestion = await getQuestionOrThrow(questionId, req.user, revision);
      req.body.existingMediaRefsJson = req.body.existingMediaRefsJson
        || JSON.stringify(existingQuestion.mediaRefs || []);
    }

    const payload = examValidationService.parseQuestionPayload(req.body, {
      uploadedFiles: req.files || []
    });
    payload.templateId = template.id;
    payload.revisionId = revision.id;
    if (isEdit) payload.id = existingQuestion.id;

    const saved = await schoolDataService.saveExamDraftQuestion(revision.id, payload, req.user);
    const savedQuestion = saved?.question || null;
    if (savedQuestion?.id) {
      await relocateUnsavedQuestionMediaRefs(savedQuestion, req.user);
    }
    if (isAjax(req)) {
      return res.json({
        status: 'success',
        message: 'Question saved successfully.',
        questionId: savedQuestion?.id || ''
      });
    }
    return res.redirect(`/school/exams/templates/edit/${encodeURIComponent(template.id)}#tab-questions`);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function relocateUnsavedQuestionMediaRefs(question, reqUser) {
  const questionId = String(question?.id || '').trim();
  const templateId = String(question?.templateId || '').trim();
  if (!questionId || !templateId) return;
  const refs = Array.isArray(question?.mediaRefs) ? question.mediaRefs : [];
  if (!refs.length) return;

  const activeOrgId = getActiveOrgIdOrThrow(reqUser);
  const targetRelativeDir = uploadFolderSettingsService.resolveUploadFolder('school.examMedia', {
    templateId,
    questionId
  });

  let hasChanges = false;
  const relocatedRefs = [];
  for (const ref of refs) {
    const originalPath = String(ref?.storagePath || ref?.url || '').trim();
    const originalRef = String(ref?.url || ref?.storagePath || '').trim();
    if (!originalPath || !/([\\/])_unsaved([\\/]|$)/i.test(originalPath)) {
      relocatedRefs.push(ref);
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const moved = await fileAssetStorage.moveUploadReference({
        sourceRef: originalRef,
        destinationScopeKey: activeOrgId,
        destinationDir: targetRelativeDir
      });
      relocatedRefs.push({
        ...ref,
        storagePath: moved.path,
        url: moved.url
      });
      hasChanges = true;
    } catch (_) {
      relocatedRefs.push(ref);
    }
  }

  if (!hasChanges) return;
  await schoolDataService.updateData('examQuestions', questionId, {
    mediaRefs: relocatedRefs,
    audit: {
      lastUpdateUser: String(reqUser?.id || '').trim(),
      lastUpdateDateTime: new Date().toISOString()
    }
  }, reqUser);
}

async function deleteQuestion(req, res) {
  try {
    const template = await getTemplateOrThrow(req.params.templateId, req.user);
    const requestedRevisionId = String(req.params.revisionId || '').trim();
    const context = requestedRevisionId
      ? { revision: await getRevisionOrThrow(requestedRevisionId, req.user, template) }
      : await resolveTemplateQuestionRevision(template, req.user, { requireEditable: true });
    const revision = context.revision;
    if (!isDraftStatus(revision.status)) {
      throw new Error('Only draft revisions can be edited.');
    }
    await getQuestionOrThrow(req.params.questionId, req.user, revision);
    await schoolDataService.deleteExamDraftQuestion(revision.id, req.params.questionId, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Question deleted.' });
    return res.redirect(`/school/exams/templates/edit/${encodeURIComponent(template.id)}#tab-questions`);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function reorderQuestions(req, res) {
  try {
    const template = await getTemplateOrThrow(req.params.templateId, req.user);
    const requestedRevisionId = String(req.params.revisionId || '').trim();
    const context = requestedRevisionId
      ? { revision: await getRevisionOrThrow(requestedRevisionId, req.user, template) }
      : await resolveTemplateQuestionRevision(template, req.user, { requireEditable: true });
    const revision = context.revision;
    if (!isDraftStatus(revision.status)) throw new Error('Only draft revisions can be reordered.');

    const rawOrder = Array.isArray(req.body.questionOrder) ? req.body.questionOrder : String(req.body.questionOrder || '')
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean);
    if (!rawOrder.length) throw new Error('Question order is required.');

    const bundle = await schoolDataService.getExamRevisionBundle(revision.id, req.user);
    const questionMap = new Map((bundle?.questions || []).map((row) => [String(row.id), row]));
    let sequence = 1;
    for (const questionId of rawOrder) {
      const question = questionMap.get(String(questionId));
      if (!question) continue;
      // eslint-disable-next-line no-await-in-loop
      await schoolDataService.updateData('examQuestions', question.id, {
        sequenceNo: sequence,
        audit: {
          lastUpdateUser: String(req.user?.id || '').trim(),
          lastUpdateDateTime: new Date().toISOString()
        }
      }, req.user);
      sequence += 1;
    }

    if (isAjax(req)) return res.json({ status: 'success', message: 'Question order updated.' });
    return res.redirect(`/school/exams/templates/edit/${encodeURIComponent(template.id)}#tab-questions`);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function showAllocationForm(req, res) {
  try {
    const isAdminViewer = isExamAdminViewer(req.user);
    return res.render('school/exam/allocationForm', {
      title: 'New Exam Allocation',
      template: null,
      revision: null,
      classes: [],
      templates: [],
      selectedClass: null,
      rosterPreview: { expectedStudentCount: 0, source: 'none' },
      isAdminViewer,
      allocationStatuses: examAllocationModel.ALLOCATION_STATUSES,
      windowPolicyOptions: WINDOW_POLICY_OPTIONS,
      questionPresentationModeOptions: QUESTION_PRESENTATION_MODE_OPTIONS,
      isEdit: false,
      allocation: null,
      allocationFormData: {
        forceSessionWindow: true,
        windowPolicy: 'strict_fixed_window',
        questionPresentationMode: 'all_questions_on_one_page',
        countsInFinalScore: true
      },
      formAction: '/school/exams/allocations/new',
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function saveAllocation(req, res) {
  try {
    const payload = examValidationService.parseAllocationPayload(req.body);
    const templateId = String(req.body?.templateId || '').trim();
    if (!templateId) throw new Error('Template is required.');
    const template = await getTemplateOrThrow(templateId, req.user);
    const publishedContext = await resolveTemplatePublishedRevisionOrThrow(template, req.user);
    const revision = publishedContext.revision;
    const templateSettings = template?.settings || {};

    const classRow = await schoolDataService.getDataById('classes', payload.classId, req.user);
    if (!classRow) throw new Error('Selected class was not found.');

    const isAdminViewer = isExamAdminViewer(req.user);
    const viewerPersonId = normalizeId(req.user?.personId);
    if (!isAdminViewer) {
      if (!viewerPersonId) throw new Error('Your user account is not linked to a person.');
      const teachers = await schoolDataService.fetchData('teachers', {}, req.user);
      const teacherPersonMap = buildTeacherPersonMap(teachers || []);
      if (!classHasPrimaryInstructorPerson(classRow, viewerPersonId, teacherPersonMap)) {
        throw new Error('You can only create allocations for classes where you are the Primary Instructor.');
      }
    }

    const selectedSessionId = normalizeId(req.body?.sessionId);
    if (!selectedSessionId) throw new Error('Session is required.');
    const classSessions = Array.isArray(classRow?.sessions) ? classRow.sessions : [];
    const selectedSession = classSessions.find((row) => idsEqual(row?.sessionId, selectedSessionId));
    if (!selectedSession) throw new Error('Selected class session was not found.');
    const selectedSessionStatus = String(selectedSession?.status || '').trim().toLowerCase();
    if (selectedSessionStatus && selectedSessionStatus !== 'scheduled') {
      throw new Error('Only scheduled sessions can be used for exam allocation.');
    }
    const selectedSessionDate = normalizeId(selectedSession?.date);
    if (!selectedSessionDate) throw new Error('Selected session date is missing.');
    const forceSessionWindow = ['true', '1', 'on', 'yes']
      .includes(String(req.body?.forceSessionWindow || '').trim().toLowerCase());

    const timezone = String(payload.timezone || 'UTC').trim() || 'UTC';
    const sessionStartTime = normalizeId(selectedSession?.startTime || '09:00');
    const sessionEndTime = normalizeId(selectedSession?.endTime || selectedSession?.startTime || '10:00');
    if (forceSessionWindow) {
      payload.windowStartLocalDate = selectedSessionDate;
      payload.windowEndLocalDate = selectedSessionDate;
      payload.windowStartLocalTime = normalizeId(payload.windowStartLocalTime || sessionStartTime);
      payload.windowEndLocalTime = normalizeId(payload.windowEndLocalTime || sessionEndTime);
    } else {
      if (!normalizeId(payload.windowStartLocalDate)) payload.windowStartLocalDate = selectedSessionDate;
      if (!normalizeId(payload.windowEndLocalDate)) payload.windowEndLocalDate = selectedSessionDate;
      if (!normalizeId(payload.windowStartLocalTime)) payload.windowStartLocalTime = sessionStartTime;
      if (!normalizeId(payload.windowEndLocalTime)) payload.windowEndLocalTime = sessionEndTime;
    }

    const computedWindowStartUtc = payload.windowStartUtc
      || toIsoUtcFromLocalTokens(payload.windowStartLocalDate, payload.windowStartLocalTime, timezone);
    const computedWindowEndUtc = payload.windowEndUtc
      || toIsoUtcFromLocalTokens(payload.windowEndLocalDate, payload.windowEndLocalTime, timezone);

    if (!computedWindowStartUtc || !computedWindowEndUtc) {
      throw new Error('Allocation window start/end is required.');
    }
    if (computedWindowEndUtc <= computedWindowStartUtc) {
      throw new Error('Allocation end must be later than start.');
    }

    const nowActor = String(req.user?.id || '').trim();
    const hasWindowPolicyOverride = hasOwn(req.body, 'windowPolicy');
    const hasQuestionPresentationModeOverride = hasOwn(req.body, 'questionPresentationMode');
    const hasCountsInFinalScoreOverride = hasOwn(req.body, 'countsInFinalScore');
    const effectiveWindowPolicy = hasWindowPolicyOverride
      ? payload.windowPolicy
      : String(templateSettings.defaultWindowPolicy || payload.windowPolicy || 'strict_fixed_window').trim().toLowerCase();
    const effectiveQuestionPresentationMode = hasQuestionPresentationModeOverride
      ? payload.questionPresentationMode
      : String(templateSettings.defaultQuestionPresentationMode || payload.questionPresentationMode || 'all_questions_on_one_page').trim().toLowerCase();
    const effectiveCountsInFinalScore = hasCountsInFinalScoreOverride
      ? payload.countsInFinalScore
      : (templateSettings.defaultCountsInFinalScore !== false);
    const created = await schoolDataService.createExamAllocation({
      ...payload,
      templateId: template.id,
      revisionId: revision.id,
      revisionNo: revision.revisionNo,
      timezone,
      windowStartUtc: computedWindowStartUtc,
      windowEndUtc: computedWindowEndUtc,
      windowStartLocalDate: payload.windowStartLocalDate,
      windowStartLocalTime: payload.windowStartLocalTime,
      windowEndLocalDate: payload.windowEndLocalDate,
      windowEndLocalTime: payload.windowEndLocalTime,
      windowPolicy: effectiveWindowPolicy,
      questionPresentationMode: effectiveQuestionPresentationMode,
      countsInFinalScore: effectiveCountsInFinalScore,
      extensions: {
        sourceSession: {
          sessionId: selectedSessionId,
          sessionDate: selectedSessionDate,
          startTime: normalizeId(selectedSession?.startTime),
          endTime: normalizeId(selectedSession?.endTime),
          forceWindow: forceSessionWindow
        }
      },
      audit: { lastUpdateUser: nowActor }
    }, req.user);

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        message: 'Template allocation created successfully.',
        allocationId: created?.id || ''
      });
    }
    return res.redirect(`/school/exams/allocations/${encodeURIComponent(created?.id || '')}`);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function showAllocationEditForm(req, res) {
  try {
    const allocation = await getAllocationOrThrow(req.params.allocationId, req.user);
    const [template, revision, classes] = await Promise.all([
      schoolDataService.getDataById('examTemplates', allocation.templateId, req.user),
      schoolDataService.getDataById('examRevisions', allocation.revisionId, req.user),
      schoolDataService.fetchData('classes', {}, req.user)
    ]);
    const selectedClass = (classes || []).find((row) => idsEqual(row.id, allocation.classId)) || null;
    const classSessions = Array.isArray(selectedClass?.sessions) ? selectedClass.sessions : [];
    const sourceSessionId = normalizeId(allocation?.extensions?.sourceSession?.sessionId);
    const sourceSessionDate = normalizeId(allocation?.extensions?.sourceSession?.sessionDate);
    const sourceSessionStart = normalizeId(allocation?.extensions?.sourceSession?.startTime);
    const sourceSessionEnd = normalizeId(allocation?.extensions?.sourceSession?.endTime);
    let matchedSession = null;
    if (sourceSessionId) {
      matchedSession = classSessions.find((row) => idsEqual(row?.sessionId, sourceSessionId)) || null;
    }
    if (!matchedSession) {
      const targetDate = normalizeId(allocation?.windowStartLocalDate || allocation?.scheduling?.windowStartLocalDate);
      const targetStart = normalizeId(allocation?.windowStartLocalTime || allocation?.scheduling?.windowStartLocalTime);
      matchedSession = classSessions.find((row) => {
        const rowDate = normalizeId(row?.date);
        const rowStart = normalizeId(row?.startTime);
        if (!targetDate) return false;
        if (rowDate !== targetDate) return false;
        return !targetStart || !rowStart || rowStart === targetStart;
      }) || null;
    }

    const resolvedSessionId = normalizeId(
      sourceSessionId
      || matchedSession?.sessionId
    );
    const resolvedSessionDate = normalizeId(
      sourceSessionDate
      || matchedSession?.date
    );
    const resolvedSessionStart = normalizeId(
      sourceSessionStart
      || matchedSession?.startTime
    );
    const resolvedSessionEnd = normalizeId(
      sourceSessionEnd
      || matchedSession?.endTime
    );
    const resolvedSessionLabel = resolvedSessionId
      ? `${resolvedSessionDate || '-'} | ${resolvedSessionStart || '--:--'}-${resolvedSessionEnd || '--:--'} | ${resolvedSessionId}`
      : '';

    const roster = selectedClass
      ? await resolveRosterStudentIdsByClass(selectedClass.id, req.user)
      : { studentIds: [], source: 'none' };
    const storedStartDate = normalizeId(allocation?.windowStartLocalDate || allocation?.scheduling?.windowStartLocalDate);
    const storedStartTime = normalizeId(allocation?.windowStartLocalTime || allocation?.scheduling?.windowStartLocalTime);
    const storedEndDate = normalizeId(allocation?.windowEndLocalDate || allocation?.scheduling?.windowEndLocalDate);
    const storedEndTime = normalizeId(allocation?.windowEndLocalTime || allocation?.scheduling?.windowEndLocalTime);
    const fallbackStart = toLocalTokensFromUtc(allocation?.windowStartUtc || allocation?.scheduling?.windowStartUtc || '');
    const fallbackEnd = toLocalTokensFromUtc(allocation?.windowEndUtc || allocation?.scheduling?.windowEndUtc || '');

    const allocationFormData = {
      templateId: String(allocation?.templateId || ''),
      classId: String(allocation?.classId || ''),
      sessionId: resolvedSessionId,
      sessionDate: resolvedSessionDate,
      sessionStartTime: resolvedSessionStart,
      sessionEndTime: resolvedSessionEnd,
      sessionLabel: resolvedSessionLabel,
      forceSessionWindow: allocation?.extensions?.sourceSession?.forceWindow !== false,
      allocationName: String(allocation?.allocationName || '').trim(),
      instructionsForStudents: String(allocation?.instructionsForStudents || '').trim(),
      status: String(allocation?.status || 'scheduled').trim().toLowerCase(),
      timezone: String(allocation?.timezone || allocation?.scheduling?.timezone || 'UTC').trim() || 'UTC',
      windowStartLocalDate: storedStartDate || fallbackStart.date,
      windowStartLocalTime: storedStartTime || fallbackStart.time,
      windowEndLocalDate: storedEndDate || fallbackEnd.date,
      windowEndLocalTime: storedEndTime || fallbackEnd.time,
      durationMinutes: Number(allocation?.durationMinutes || 60),
      maxAttemptsPerStudent: Number(allocation?.maxAttemptsPerStudent || 1),
      autoSubmitOnExpire: allocation?.autoSubmitOnExpire !== false,
      allowLateStart: allocation?.allowLateStart === true,
      shuffleQuestions: allocation?.shuffleQuestions === true,
      windowPolicy: String(
        allocation?.windowPolicy
        || template?.settings?.defaultWindowPolicy
        || 'strict_fixed_window'
      ).trim().toLowerCase(),
      questionPresentationMode: String(
        allocation?.questionPresentationMode
        || template?.settings?.defaultQuestionPresentationMode
        || 'all_questions_on_one_page'
      ).trim().toLowerCase(),
      countsInFinalScore: allocation?.countsInFinalScore !== false,
      tags: Array.isArray(allocation?.tags) ? allocation.tags.join(', ') : ''
    };

    return res.render('school/exam/allocationForm', {
      title: 'Edit Exam Allocation',
      template,
      revision,
      classes: (classes || []).sort((a, b) => String(a?.title || '').localeCompare(String(b?.title || ''))),
      templates: [],
      selectedClass,
      rosterPreview: {
        ...roster,
        expectedStudentCount: Array.isArray(roster?.studentIds) ? roster.studentIds.length : 0
      },
      isAdminViewer: isExamAdminViewer(req.user),
      allocationStatuses: examAllocationModel.ALLOCATION_STATUSES,
      windowPolicyOptions: WINDOW_POLICY_OPTIONS,
      questionPresentationModeOptions: QUESTION_PRESENTATION_MODE_OPTIONS,
      isEdit: true,
      allocation,
      allocationFormData,
      formAction: `/school/exams/allocations/${encodeURIComponent(allocation.id)}/edit`,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function saveAllocationEdit(req, res) {
  try {
    const allocation = await getAllocationOrThrow(req.params.allocationId, req.user);
    const payload = examValidationService.parseAllocationPayload(req.body);
    const currentStatus = String(allocation?.status || '').trim().toLowerCase();
    if (['cancelled', 'archived'].includes(currentStatus)) {
      throw new Error('Cancelled/archived allocations cannot be edited.');
    }
    if (!idsEqual(payload.classId, allocation.classId)) {
      throw new Error('Class cannot be changed after allocation is created.');
    }

    const timezone = String(payload.timezone || allocation?.timezone || 'UTC').trim() || 'UTC';
    const computedWindowStartUtc = payload.windowStartUtc
      || toIsoUtcFromLocalTokens(payload.windowStartLocalDate, payload.windowStartLocalTime, timezone);
    const computedWindowEndUtc = payload.windowEndUtc
      || toIsoUtcFromLocalTokens(payload.windowEndLocalDate, payload.windowEndLocalTime, timezone);

    if (!computedWindowStartUtc || !computedWindowEndUtc) {
      throw new Error('Allocation window start/end is required.');
    }
    if (computedWindowEndUtc <= computedWindowStartUtc) {
      throw new Error('Allocation end must be later than start.');
    }

    const actor = String(req.user?.id || '').trim();
    const forceSessionWindow = ['true', '1', 'on', 'yes']
      .includes(String(req.body?.forceSessionWindow || '').trim().toLowerCase());
    const baseExt = (allocation.extensions && typeof allocation.extensions === 'object' && !Array.isArray(allocation.extensions))
      ? { ...allocation.extensions }
      : {};
    const baseSource = (baseExt.sourceSession && typeof baseExt.sourceSession === 'object' && !Array.isArray(baseExt.sourceSession))
      ? { ...baseExt.sourceSession }
      : {};
    const mergedExtensions = {
      ...baseExt,
      sourceSession: {
        ...baseSource,
        forceWindow: forceSessionWindow
      }
    };
    const effectiveWindowPolicy = hasOwn(req.body, 'windowPolicy')
      ? payload.windowPolicy
      : String(allocation?.windowPolicy || 'strict_fixed_window').trim().toLowerCase();
    const effectiveQuestionPresentationMode = hasOwn(req.body, 'questionPresentationMode')
      ? payload.questionPresentationMode
      : String(allocation?.questionPresentationMode || 'all_questions_on_one_page').trim().toLowerCase();
    const effectiveCountsInFinalScore = hasOwn(req.body, 'countsInFinalScore')
      ? payload.countsInFinalScore
      : (allocation?.countsInFinalScore !== false);
    const updated = await schoolDataService.updateData('examAllocations', allocation.id, {
      allocationName: payload.allocationName,
      instructionsForStudents: payload.instructionsForStudents,
      status: payload.status,
      timezone,
      scheduling: {
        timezone,
        windowStartUtc: computedWindowStartUtc,
        windowEndUtc: computedWindowEndUtc,
        windowStartLocalDate: payload.windowStartLocalDate,
        windowStartLocalTime: payload.windowStartLocalTime,
        windowEndLocalDate: payload.windowEndLocalDate,
        windowEndLocalTime: payload.windowEndLocalTime
      },
      windowStartUtc: computedWindowStartUtc,
      windowEndUtc: computedWindowEndUtc,
      windowStartLocalDate: payload.windowStartLocalDate,
      windowStartLocalTime: payload.windowStartLocalTime,
      windowEndLocalDate: payload.windowEndLocalDate,
      windowEndLocalTime: payload.windowEndLocalTime,
      durationMinutes: payload.durationMinutes,
      autoSubmitOnExpire: payload.autoSubmitOnExpire,
      allowLateStart: payload.allowLateStart,
      maxAttemptsPerStudent: payload.maxAttemptsPerStudent,
      shuffleQuestions: payload.shuffleQuestions,
      windowPolicy: effectiveWindowPolicy,
      questionPresentationMode: effectiveQuestionPresentationMode,
      countsInFinalScore: effectiveCountsInFinalScore,
      tags: payload.tags,
      extensions: mergedExtensions,
      audit: { lastUpdateUser: actor }
    }, req.user);

    const linkedAssignments = await schoolDataService.fetchData('examAssignments', {
      allocationId__eq: allocation.id
    }, req.user);
    let syncedAssignments = 0;
    for (const assignment of (linkedAssignments || [])) {
      const st = String(assignment?.status || '').trim().toLowerCase();
      if (st === 'cancelled') continue;
      const patch = {
        maxAttemptsAllowed: payload.maxAttemptsPerStudent,
        audit: { lastUpdateUser: actor }
      };
      if (isScheduleSyncableAssignmentStatus(st)) {
        patch.startWindowUtc = computedWindowStartUtc;
        patch.endWindowUtc = computedWindowEndUtc;
        patch.durationMinutes = payload.durationMinutes;
        patch.allowLateStart = payload.allowLateStart;
      }
      // eslint-disable-next-line no-await-in-loop
      await schoolDataService.updateData('examAssignments', assignment.id, patch, req.user);
      syncedAssignments += 1;
    }

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        message: `Allocation updated successfully. Updated ${syncedAssignments} assignment(s).`,
        allocationId: updated?.id || allocation.id,
        syncedAssignments
      });
    }
    return res.redirect(`/school/exams/allocations/${encodeURIComponent(updated?.id || allocation.id)}`);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function cancelAllocation(req, res) {
  try {
    const allocation = await getAllocationOrThrow(req.params.allocationId, req.user);
    const actor = String(req.user?.id || '').trim();
    const currentStatus = String(allocation?.status || '').trim().toLowerCase();

    if (currentStatus !== 'cancelled') {
      await schoolDataService.updateData('examAllocations', allocation.id, {
        status: 'cancelled',
        cancelledAtUtc: new Date().toISOString(),
        cancelledBy: actor,
        audit: { lastUpdateUser: actor }
      }, req.user);
    }

    const linkedAssignments = await schoolDataService.fetchData('examAssignments', {
      allocationId__eq: allocation.id
    }, req.user);
    let cancelledAssignments = 0;
    let preservedAssignments = 0;
    for (const assignment of (linkedAssignments || [])) {
      if (isFinalizedAssignmentStatus(assignment?.status)) {
        preservedAssignments += 1;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await schoolDataService.updateData('examAssignments', assignment.id, {
        status: 'cancelled',
        note: String(assignment?.note || '').trim() || 'Cancelled due to allocation cancellation.',
        audit: { lastUpdateUser: actor }
      }, req.user);
      cancelledAssignments += 1;
    }

    const message = `Allocation cancelled. Assignment updates: cancelled ${cancelledAssignments}, preserved ${preservedAssignments}.`;
    if (isAjax(req)) {
      return res.json({
        status: 'success',
        message,
        cancelledAssignments,
        preservedAssignments
      });
    }
    return res.redirect(`/school/exams/allocations/${encodeURIComponent(allocation.id)}?cancelled=1`);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function openAllocation(req, res) {
  try {
    const allocation = await getAllocationOrThrow(req.params.allocationId, req.user);
    const actor = String(req.user?.id || '').trim();
    const currentStatus = String(allocation?.status || '').trim().toLowerCase();
    const requestedRaw = String(req.body?.status || 'open').trim().toLowerCase();
    const requestedStatus = (() => {
      if (['open'].includes(requestedRaw)) return 'open';
      if (['scheduled', 'pause', 'paused', 'close', 'closed', 'stop', 'stopped'].includes(requestedRaw)) return 'scheduled';
      return '';
    })();
    if (!requestedStatus) throw new Error('Unsupported allocation status update request.');

    if (['cancelled', 'archived'].includes(currentStatus)) {
      throw new Error('Cancelled or archived allocations cannot be reopened.');
    }

    if (currentStatus !== requestedStatus) {
      await schoolDataService.updateData('examAllocations', allocation.id, {
        status: requestedStatus,
        audit: { lastUpdateUser: actor }
      }, req.user);
    }

    const message = currentStatus === requestedStatus
      ? `Allocation is already ${requestedStatus}.`
      : (requestedStatus === 'open'
        ? 'Allocation status changed to open. Students can now start the exam.'
        : 'Allocation status changed to scheduled. Exam is temporarily paused.');

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        message,
        allocationId: allocation.id,
        allocationStatus: requestedStatus
      });
    }
    return res.redirect(`/school/exams/allocations/${encodeURIComponent(allocation.id)}`);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function listAllocations(req, res) {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();

    const [allocations, assignments, classes, revisions] = await Promise.all([
      schoolDataService.fetchData('examAllocations', {}, req.user),
      schoolDataService.fetchData('examAssignments', {}, req.user),
      schoolDataService.fetchData('classes', {}, req.user),
      schoolDataService.fetchData('examRevisions', {}, req.user)
    ]);

    const classNameById = new Map((classes || []).map((row) => [String(row.id), String(row.title || row.id || '').trim()]));
    const classById = new Map((classes || []).map((row) => [String(row.id), row]));
    const revisionLabelById = new Map((revisions || []).map((row) => [String(row.id), `R${Number(row.revisionNo || 0)} | ${String(row.title || row.id || '').trim()}`]));

    const assignmentsByAllocationId = new Map();
    (assignments || []).forEach((row) => {
      const allocationId = String(row?.allocationId || '').trim();
      if (!allocationId) return;
      if (!assignmentsByAllocationId.has(allocationId)) assignmentsByAllocationId.set(allocationId, []);
      assignmentsByAllocationId.get(allocationId).push(row);
    });

    const enriched = (allocations || []).map((row) => {
      const linkedAssignments = assignmentsByAllocationId.get(String(row.id)) || [];
      const classRow = classById.get(String(row.classId || '')) || null;
      const sourceSessionMeta = resolveAllocationSourceSessionMeta(row, classRow);
      return {
        ...row,
        className: classNameById.get(String(row.classId || '')) || String(row.classId || ''),
        revisionLabel: revisionLabelById.get(String(row.revisionId || '')) || String(row.revisionId || ''),
        sourceSessionId: String(sourceSessionMeta?.sessionId || '').trim(),
        sourceSessionDate: String(sourceSessionMeta?.date || '').trim(),
        sourceSessionStartTime: String(sourceSessionMeta?.startTime || '').trim(),
        sourceSessionEndTime: String(sourceSessionMeta?.endTime || '').trim(),
        assignmentCounts: buildAssignmentCounts(linkedAssignments)
      };
    });

    const isAdminViewer = isExamAdminViewer(req.user);
    const actorId = normalizeId(req.user?.id);

    const filtered = enriched
      .filter((row) => {
        if (!isAdminViewer) {
          const ownerId = normalizeId(row?.audit?.createUser);
          if (!ownerId || !idsEqual(ownerId, actorId)) return false;
        }
        if (!q) return true;
        return [
          row.id,
          row.allocationName,
          row.className,
          row.revisionLabel,
          row.status,
          row.classId,
          row.revisionId,
          row.templateId
        ]
          .map((token) => String(token || '').toLowerCase())
          .some((token) => token.includes(q));
      })
      .sort((a, b) => String(b.audit?.lastUpdateDateTime || b.audit?.createDateTime || '')
        .localeCompare(String(a.audit?.lastUpdateDateTime || a.audit?.createDateTime || '')));

    const { data, pagination } = paginate(filtered, req.query);
    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    return res.render('school/exam/allocationList', {
      title: 'Exam Allocations',
      tableName: 'School_Exam_Allocations',
      data,
      newHref: '/school/exams/allocations/new',
      newLabel: 'New Allocation',
      pagination,
      filters: req.query,
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: false,
      print: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function viewAllocation(req, res) {
  try {
    const allocation = await getAllocationOrThrow(req.params.allocationId, req.user);
    const [template, revision, classRow, assignments, students, persons] = await Promise.all([
      schoolDataService.getDataById('examTemplates', allocation.templateId, req.user),
      schoolDataService.getDataById('examRevisions', allocation.revisionId, req.user),
      schoolDataService.getDataById('classes', allocation.classId, req.user),
      schoolDataService.fetchData('examAssignments', { allocationId__eq: allocation.id }, req.user),
      schoolDataService.fetchData('students', {}, req.user),
      listSchoolPersonRecords(req.user, { query: { limit: 5000 } })
    ]);
    const counts = buildAssignmentCounts(assignments || []);
    const personById = new Map((Array.isArray(persons) ? persons : [])
      .map((row) => [String(row?.id || '').trim(), row]));
    const studentById = new Map((Array.isArray(students) ? students : [])
      .map((row) => [String(row?.id || '').trim(), row]));
    const visibleAssignments = (assignments || [])
      .filter((row) => String(row?.status || '').trim().toLowerCase() !== 'cancelled')
      .map((row) => {
        const studentId = String(row?.studentId || '').trim();
        const student = studentById.get(studentId) || null;
        const person = personById.get(String(student?.personId || '').trim()) || null;
        const first = String(person?.name?.first || '').trim();
        const last = String(person?.name?.last || '').trim();
        const fullName = `${first} ${last}`.trim();
        return {
          ...row,
          studentName: fullName || studentId || '-',
          studentNo: String(student?.studentNo || '').trim()
        };
      });

    return res.render('school/exam/allocationView', {
      title: `Allocation: ${allocation.allocationName || allocation.id}`,
      allocation,
      template,
      revision,
      classRow,
      assignments: visibleAssignments.sort((a, b) => String(a.studentName || a.studentId || '').localeCompare(String(b.studentName || b.studentId || ''))),
      assignmentCounts: counts,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function generateAllocationAssignments(req, res) {
  try {
    const allocation = await getAllocationOrThrow(req.params.allocationId, req.user);
    const roster = await resolveRosterStudentIdsByClass(allocation.classId, req.user);
    const exemptStudentIds = getExemptStudentIdSet(allocation);
    const eligibleStudentIds = (Array.isArray(roster.studentIds) ? roster.studentIds : [])
      .filter((studentId) => !exemptStudentIds.has(String(studentId || '').trim()));
    if (!eligibleStudentIds.length) {
      throw new Error('No students found in roster for this class.');
    }

    const eligibleSet = new Set(eligibleStudentIds.map((row) => String(row || '').trim()).filter(Boolean));
    const linkedAssignments = await schoolDataService.fetchData('examAssignments', { allocationId__eq: allocation.id }, req.user);
    let syncedCancelledCount = 0;
    for (const assignment of (linkedAssignments || [])) {
      const sid = String(assignment?.studentId || '').trim();
      if (!sid) continue;
      if (eligibleSet.has(sid)) continue;
      if (isFinalizedAssignmentStatus(assignment?.status)) continue;
      // eslint-disable-next-line no-await-in-loop
      await schoolDataService.updateData('examAssignments', assignment.id, {
        status: 'cancelled',
        note: 'Moved out of active class roster for current allocation sync.',
        audit: { lastUpdateUser: String(req.user?.id || '').trim() }
      }, req.user);
      syncedCancelledCount += 1;
    }

    const result = await schoolDataService.createExamAssignmentsForAllocation({
      allocationId: allocation.id,
      studentIds: eligibleStudentIds
    }, req.user);

    const createdCount = Array.isArray(result?.created) ? result.created.length : 0;
    const skippedCount = Array.isArray(result?.skippedStudentIds) ? result.skippedStudentIds.length : 0;
    const exemptCount = exemptStudentIds.size;

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        message: `Assignment generation completed. Created: ${createdCount}, Skipped: ${skippedCount}, Exempt: ${exemptCount}, Synced out: ${syncedCancelledCount}.`,
        createdCount,
        skippedCount,
        exemptCount,
        syncedCancelledCount
      });
    }

    return res.redirect(`/school/exams/allocations/${encodeURIComponent(allocation.id)}?generated=1&created=${createdCount}&skipped=${skippedCount}&exempt=${exemptCount}&syncedOut=${syncedCancelledCount}`);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function addAllocationStudents(req, res) {
  try {
    const allocation = await getAllocationOrThrow(req.params.allocationId, req.user);
    const studentIds = parseStudentIdsInput(req.body?.studentIds);
    if (!studentIds.length) throw new Error('Provide at least one student ID.');

    const exemptSet = getExemptStudentIdSet(allocation);
    studentIds.forEach((studentId) => exemptSet.delete(String(studentId || '').trim()));
    await saveAllocationExemptStudentIds(allocation, exemptSet, req.user);

    const result = await schoolDataService.createExamAssignmentsForAllocation({
      allocationId: allocation.id,
      studentIds
    }, req.user);
    const createdCount = Array.isArray(result?.created) ? result.created.length : 0;
    const skippedCount = Array.isArray(result?.skippedStudentIds) ? result.skippedStudentIds.length : 0;

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        message: `Students added. Created: ${createdCount}, Skipped: ${skippedCount}.`,
        createdCount,
        skippedCount
      });
    }
    return res.redirect(`/school/exams/allocations/${encodeURIComponent(allocation.id)}?added=1&created=${createdCount}&skipped=${skippedCount}`);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function exemptAllocationStudents(req, res) {
  try {
    const allocation = await getAllocationOrThrow(req.params.allocationId, req.user);
    const studentIds = parseStudentIdsInput(req.body?.studentIds);
    if (!studentIds.length) throw new Error('Provide at least one student ID.');

    const exemptSet = getExemptStudentIdSet(allocation);
    studentIds.forEach((studentId) => exemptSet.add(String(studentId || '').trim()));
    await saveAllocationExemptStudentIds(allocation, exemptSet, req.user);

    const linkedAssignments = await schoolDataService.fetchData('examAssignments', {
      allocationId__eq: allocation.id
    }, req.user);
    let cancelledCount = 0;
    for (const assignment of (linkedAssignments || [])) {
      const sid = String(assignment?.studentId || '').trim();
      if (!sid || !exemptSet.has(sid)) continue;
      if (isFinalizedAssignmentStatus(assignment?.status)) continue;
      // eslint-disable-next-line no-await-in-loop
      await schoolDataService.updateData('examAssignments', assignment.id, {
        status: 'cancelled',
        note: 'Exempted from allocation by teacher.',
        audit: { lastUpdateUser: String(req.user?.id || '').trim() }
      }, req.user);
      cancelledCount += 1;
    }

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        message: `Students exempted. Pending assignments cancelled: ${cancelledCount}.`,
        cancelledCount,
        exemptCount: exemptSet.size
      });
    }
    return res.redirect(`/school/exams/allocations/${encodeURIComponent(allocation.id)}?exempted=1&cancelled=${cancelledCount}`);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function listTeacherAssignments(req, res) {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const classIdFilter = String(req.query.classId || '').trim();
    const statusFilter = String(req.query.status || '').trim().toLowerCase();

    const [allocations, assignments, classes, revisions, teachers] = await Promise.all([
      schoolDataService.fetchData('examAllocations', {}, req.user),
      schoolDataService.fetchData('examAssignments', {}, req.user),
      schoolDataService.fetchData('classes', {}, req.user),
      schoolDataService.fetchData('examRevisions', {}, req.user),
      schoolDataService.fetchData('teachers', {}, req.user)
    ]);

    const { viewer, effectivePersonId, selectedTeacherId } = resolveTeacherReviewPersonScope(req, teachers);
    const adminPickedNothing = viewer.isAdminViewer
      && !normalizeId(req.query?.teacherId)
      && !normalizeId(req.query?.personId);
    const invalidTeacherSelection = viewer.isAdminViewer
      && Boolean(normalizeId(req.query?.teacherId))
      && !effectivePersonId;

    const classMap = new Map((classes || []).map((row) => [String(row.id), row]));
    const classNameById = new Map((classes || []).map((row) => [String(row.id), String(row.title || row.id || '').trim()]));
    const revisionLabelById = new Map((revisions || []).map((row) => [String(row.id), `R${Number(row.revisionNo || 0)} | ${String(row.title || row.id || '').trim()}`]));
    const teacherPersonMap = buildTeacherPersonMap(teachers || []);

    const assignmentsByAllocationId = new Map();
    (assignments || []).forEach((row) => {
      const allocationId = String(row?.allocationId || '').trim();
      if (!allocationId) return;
      if (!assignmentsByAllocationId.has(allocationId)) assignmentsByAllocationId.set(allocationId, []);
      assignmentsByAllocationId.get(allocationId).push(row);
    });

    const actorId = normalizeId(req.user?.id);
    const visible = (allocations || []).filter((row) => {
      if (viewer.isAdminViewer && !effectivePersonId) return false;
      const creatorId = normalizeId(row?.audit?.createUser);
      if (creatorId && actorId && idsEqual(creatorId, actorId)) return true;
      if (!effectivePersonId) return true;
      const classRow = classMap.get(String(row.classId || '')) || null;
      if (classHasInstructorPerson(classRow, effectivePersonId, teacherPersonMap)) return true;
      const linkedAssignments = assignmentsByAllocationId.get(String(row.id || '')) || [];
      return linkedAssignments.some((assignment) => idsEqual(assignment?.personId, effectivePersonId));
    });

    const enriched = visible.map((row) => {
      const linkedAssignments = assignmentsByAllocationId.get(String(row.id)) || [];
      const visibleAssignments = effectivePersonId
        ? linkedAssignments.filter((assignment) => idsEqual(assignment?.personId, effectivePersonId))
        : linkedAssignments;
      const classRow = classMap.get(String(row.classId || '')) || null;
      const sourceSessionMeta = resolveAllocationSourceSessionMeta(row, classRow);
      return {
        ...row,
        className: classNameById.get(String(row.classId || '')) || String(row.classId || ''),
        revisionLabel: revisionLabelById.get(String(row.revisionId || '')) || String(row.revisionId || ''),
        windowStartUtc: row.windowStartUtc || row.scheduling?.windowStartUtc || '',
        windowEndUtc: row.windowEndUtc || row.scheduling?.windowEndUtc || '',
        sourceSessionId: String(sourceSessionMeta?.sessionId || '').trim(),
        sourceSessionDate: String(sourceSessionMeta?.date || '').trim(),
        sourceSessionStartTime: String(sourceSessionMeta?.startTime || '').trim(),
        sourceSessionEndTime: String(sourceSessionMeta?.endTime || '').trim(),
        assignmentCounts: buildAssignmentCounts(linkedAssignments),
        viewerAssignmentCounts: buildAssignmentCounts(visibleAssignments)
      };
    });

    const filtered = enriched
      .filter((row) => {
        if (classIdFilter && !idsEqual(row.classId, classIdFilter)) return false;
        if (statusFilter && String(row.status || '').trim().toLowerCase() !== statusFilter) return false;
        if (!q) return true;
        return [
          row.id,
          row.allocationName,
          row.className,
          row.revisionLabel,
          row.status,
          row.classId,
          row.revisionId
        ]
          .map((token) => String(token || '').toLowerCase())
          .some((token) => token.includes(q));
      })
      .sort((a, b) => String(b.audit?.lastUpdateDateTime || b.audit?.createDateTime || '')
        .localeCompare(String(a.audit?.lastUpdateDateTime || a.audit?.createDateTime || '')));

    const { data, pagination } = paginate(filtered, req.query);
    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    return res.render('school/exam/teacherAssignmentList', {
      title: 'Teacher Review',
      tableName: 'School_Exam_Teacher_Assignments',
      data,
      classes,
      allocationStatuses: examAllocationModel.ALLOCATION_STATUSES,
      selectedPersonId: effectivePersonId,
      selectedTeacherId,
      selectedPersonDisplay: await resolvePersonDisplay(effectivePersonId, req.user),
      requiresTeacherSelection: adminPickedNothing,
      invalidTeacherSelection,
      isAdminViewer: viewer.isAdminViewer,
      newUrl: null,
      newLabel: null,
      pagination,
      filters: req.query,
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: false,
      print: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function viewTeacherAssignment(req, res) {
  try {
    const allocation = await getAllocationOrThrow(req.params.allocationId, req.user);
    const [template, revision, classRow, assignments, teachers, students, persons, attempts] = await Promise.all([
      schoolDataService.getDataById('examTemplates', allocation.templateId, req.user),
      schoolDataService.getDataById('examRevisions', allocation.revisionId, req.user),
      schoolDataService.getDataById('classes', allocation.classId, req.user),
      schoolDataService.fetchData('examAssignments', { allocationId__eq: allocation.id }, req.user),
      schoolDataService.fetchData('teachers', {}, req.user),
      schoolDataService.fetchData('students', {}, req.user),
      listSchoolPersonRecords(req.user, { query: { limit: 5000 } }),
      schoolDataService.fetchData('examAttempts', {}, req.user)
    ]);

    const teacherPersonMap = buildTeacherPersonMap(teachers || []);
    const { effectivePersonId, selectedTeacherId } = resolveTeacherReviewPersonScope(req, teachers);
    const normalizedViewerPersonId = effectivePersonId;
    let visibleAssignments = Array.isArray(assignments) ? assignments : [];
    if (normalizedViewerPersonId) {
      const isInstructor = classHasInstructorPerson(classRow, normalizedViewerPersonId, teacherPersonMap);
      if (!isInstructor) {
        visibleAssignments = visibleAssignments.filter((row) => idsEqual(row?.personId, normalizedViewerPersonId));
      }
      if (!isInstructor && visibleAssignments.length <= 0) {
        throw new Error('You do not have access to this allocation.');
      }
    }

    const studentById = new Map((Array.isArray(students) ? students : [])
      .map((row) => [String(row?.id || '').trim(), row]));
    const personById = new Map((Array.isArray(persons) ? persons : [])
      .map((row) => [String(row?.id || '').trim(), row]));
    const attemptsByAssignmentId = new Map();
    (Array.isArray(attempts) ? attempts : []).forEach((row) => {
      const assignmentId = String(row?.assignmentId || '').trim();
      if (!assignmentId) return;
      if (!attemptsByAssignmentId.has(assignmentId)) attemptsByAssignmentId.set(assignmentId, []);
      attemptsByAssignmentId.get(assignmentId).push(row);
    });

    const rows = (visibleAssignments || []).map((row) => {
      const student = studentById.get(String(row?.studentId || '').trim()) || null;
      const person = personById.get(String(student?.personId || '').trim()) || null;
      const fullName = `${String(person?.name?.first || '').trim()} ${String(person?.name?.last || '').trim()}`.trim();
      const linkedAttempts = (attemptsByAssignmentId.get(String(row?.id || '').trim()) || [])
        .sort((a, b) => Number(b?.attemptNo || 0) - Number(a?.attemptNo || 0));
      const reviewAttempt = linkedAttempts.find((item) => ['submitted', 'auto_submitted', 'graded'].includes(String(item?.status || '').trim().toLowerCase()))
        || linkedAttempts[0]
        || null;
      return {
        ...row,
        studentName: fullName || String(student?.studentNo || row?.studentId || '').trim(),
        studentNo: String(student?.studentNo || '').trim(),
        reviewAttemptId: String(reviewAttempt?.id || row?.submittedAttemptId || row?.startedAttemptId || '').trim(),
        reviewAttemptStatus: String(reviewAttempt?.status || '').trim().toLowerCase()
      };
    });

    const counts = buildAssignmentCounts(rows || []);
    const allCounts = buildAssignmentCounts(assignments || []);

    return res.render('school/exam/teacherAssignmentView', {
      title: `Students: ${allocation.allocationName || allocation.id}`,
      allocation,
      template,
      revision,
      classRow,
      assignments: rows.sort((a, b) => String(a.studentName || a.studentId || '').localeCompare(String(b.studentName || b.studentId || ''))),
      assignmentCounts: counts,
      allAssignmentCounts: allCounts,
      selectedPersonId: normalizedViewerPersonId,
      selectedTeacherId,
      selectedPersonDisplay: await resolvePersonDisplay(normalizedViewerPersonId, req.user),
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function viewTeacherAttemptReview(req, res) {
  try {
    const assignment = await schoolDataService.getDataById('examAssignments', req.params.assignmentId, req.user);
    if (!assignment) throw new Error('Assignment not found.');
    const allocation = await getAllocationOrThrow(assignment.allocationId, req.user);
    const [template, revision, classRow, teachers, students, persons, attempts, bundle] = await Promise.all([
      schoolDataService.getDataById('examTemplates', assignment.templateId, req.user),
      schoolDataService.getDataById('examRevisions', assignment.revisionId, req.user),
      schoolDataService.getDataById('classes', assignment.classId, req.user),
      schoolDataService.fetchData('teachers', {}, req.user),
      schoolDataService.fetchData('students', {}, req.user),
      listSchoolPersonRecords(req.user, { query: { limit: 5000 } }),
      schoolDataService.fetchData('examAttempts', { assignmentId__eq: assignment.id }, req.user),
      schoolDataService.getExamRevisionBundle(assignment.revisionId, req.user)
    ]);

    const teacherPersonMap = buildTeacherPersonMap(teachers || []);
    const { effectivePersonId, selectedTeacherId } = resolveTeacherReviewPersonScope(req, teachers);
    const normalizedViewerPersonId = effectivePersonId;
    if (normalizedViewerPersonId) {
      const isInstructor = classHasInstructorPerson(classRow, normalizedViewerPersonId, teacherPersonMap);
      if (!isInstructor && !idsEqual(assignment?.personId, normalizedViewerPersonId)) {
        throw new Error('You do not have access to review this assignment.');
      }
    }

    const sortedAttempts = (Array.isArray(attempts) ? attempts : [])
      .sort((a, b) => Number(b?.attemptNo || 0) - Number(a?.attemptNo || 0));
    if (!sortedAttempts.length) {
      const qs = new URLSearchParams();
      if (String(selectedTeacherId || '').trim()) qs.set('teacherId', String(selectedTeacherId).trim());
      if (String(normalizedViewerPersonId || '').trim()) qs.set('personId', String(normalizedViewerPersonId).trim());
      const tail = qs.toString();
      return res.redirect(`/school/exams/teacher-assignments/${allocation.id}${tail ? `?${tail}` : ''}`);
    }
    const requestedAttemptId = String(req.query?.attemptId || '').trim();
    const attempt = requestedAttemptId
      ? sortedAttempts.find((row) => idsEqual(row?.id, requestedAttemptId))
      : (sortedAttempts.find((row) => idsEqual(row?.id, assignment?.submittedAttemptId))
        || sortedAttempts.find((row) => idsEqual(row?.id, assignment?.startedAttemptId))
        || sortedAttempts[0]);
    if (!attempt) throw new Error('No attempt found for this assignment.');

    const answers = await schoolDataService.fetchData('examAnswers', { attemptId__eq: attempt.id }, req.user);
    const answerByQuestionId = new Map((Array.isArray(answers) ? answers : [])
      .map((row) => [String(row?.questionId || '').trim(), row]));
    const questionRows = (Array.isArray(bundle?.questions) ? bundle.questions : [])
      .filter((row) => String(row?.status || '').trim().toLowerCase() !== 'archived')
      .sort((a, b) => Number(a?.sequenceNo || 0) - Number(b?.sequenceNo || 0))
      .map((q) => {
        const answer = answerByQuestionId.get(String(q?.id || '').trim()) || null;
        return { question: q, answer };
      });

    const student = (Array.isArray(students) ? students : []).find((row) => idsEqual(row?.id, assignment?.studentId)) || null;
    const person = (Array.isArray(persons) ? persons : []).find((row) => idsEqual(row?.id, student?.personId)) || null;
    const studentName = `${String(person?.name?.first || '').trim()} ${String(person?.name?.last || '').trim()}`.trim()
      || String(student?.studentNo || assignment?.studentId || '').trim();

    return res.render('school/exam/teacherAttemptReview', {
      title: `Review Attempt: ${assignment.id}`,
      assignment,
      allocation,
      template,
      revision,
      classRow,
      attempt,
      attempts: sortedAttempts,
      questionRows,
      studentName,
      selectedPersonId: normalizedViewerPersonId,
      selectedTeacherId,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

function isTerminalAttemptStatus(status) {
  return ['submitted', 'auto_submitted', 'graded'].includes(String(status || '').trim().toLowerCase());
}

async function reconcileAssignmentAfterAttemptDelete(assignment, requestingUser) {
  const remaining = await schoolDataService.fetchData('examAttempts', { assignmentId__eq: assignment.id }, requestingUser);
  const sorted = (Array.isArray(remaining) ? remaining : []).slice()
    .sort((a, b) => Number(b?.attemptNo || 0) - Number(a?.attemptNo || 0));
  const inProgress = sorted.find((row) => String(row?.status || '').trim().toLowerCase() === 'in_progress');
  const bestSubmitted = [...sorted].reverse().find((row) => isTerminalAttemptStatus(row?.status));
  const audit = { lastUpdateUser: String(requestingUser?.id || '').trim() };

  if (inProgress) {
    await schoolDataService.updateData('examAssignments', assignment.id, {
      status: 'started',
      startedAttemptId: inProgress.id,
      submittedAttemptId: '',
      scoreComputed: Number(inProgress.totalScoreComputed || 0),
      maxScoreComputed: Number(inProgress.maxScoreComputed || 0),
      percentageComputed: Number(inProgress.percentageComputed || 0),
      audit
    }, requestingUser);
    return;
  }

  if (bestSubmitted) {
    const st = String(bestSubmitted.status || '').trim().toLowerCase();
    const assignmentStatus = st === 'graded' ? 'graded' : st;
    await schoolDataService.updateData('examAssignments', assignment.id, {
      status: assignmentStatus,
      startedAttemptId: '',
      submittedAttemptId: bestSubmitted.id,
      scoreComputed: Number(bestSubmitted.totalScoreComputed || 0),
      maxScoreComputed: Number(bestSubmitted.maxScoreComputed || 0),
      percentageComputed: Number(bestSubmitted.percentageComputed || 0),
      audit
    }, requestingUser);
    return;
  }

  await schoolDataService.updateData('examAssignments', assignment.id, {
    status: 'available',
    startedAttemptId: '',
    submittedAttemptId: '',
    scoreComputed: 0,
    maxScoreComputed: 0,
    percentageComputed: 0,
    audit
  }, requestingUser);
}

async function deleteTeacherReviewAttempt(req, res) {
  try {
    const viewer = resolveTeacherViewerContext(req);
    const assignment = await schoolDataService.getDataById('examAssignments', req.params.assignmentId, req.user);
    if (!assignment) throw new Error('Assignment not found.');
    const attempt = await schoolDataService.getDataById('examAttempts', req.params.attemptId, req.user);
    if (!attempt || !idsEqual(attempt.assignmentId, assignment.id)) throw new Error('Attempt not found for assignment.');

    const classRow = await schoolDataService.getDataById('classes', assignment.classId, req.user);
    const teachers = await schoolDataService.fetchData('teachers', {}, req.user);
    const teacherPersonMap = buildTeacherPersonMap(teachers || []);
    const normalizedViewerPersonId = normalizeId(viewer.personId);
    if (normalizedViewerPersonId) {
      const isInstructor = classHasInstructorPerson(classRow, normalizedViewerPersonId, teacherPersonMap);
      if (!isInstructor && !idsEqual(assignment?.personId, normalizedViewerPersonId)) {
        throw new Error('You do not have access to delete attempts for this assignment.');
      }
    }

    const answers = await schoolDataService.fetchData('examAnswers', { attemptId__eq: attempt.id }, req.user);
    for (const ans of (Array.isArray(answers) ? answers : [])) {
      if (!ans?.id) continue;
      // eslint-disable-next-line no-await-in-loop
      await schoolDataService.deleteData('examAnswers', ans.id, req.user);
    }
    await schoolDataService.deleteData('examAttempts', attempt.id, req.user);
    await reconcileAssignmentAfterAttemptDelete(assignment, req.user);

    const rest = await schoolDataService.fetchData('examAttempts', { assignmentId__eq: assignment.id }, req.user);
    const sortedRest = (Array.isArray(rest) ? rest : []).slice()
      .sort((a, b) => Number(b?.attemptNo || 0) - Number(a?.attemptNo || 0));
    const nextAttemptId = sortedRest.length ? String(sortedRest[0].id || '').trim() : '';

    return res.json({
      status: 'success',
      message: 'Attempt deleted.',
      removedAttemptId: String(attempt.id || '').trim(),
      nextAttemptId,
      assignmentId: assignment.id
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function gradeTeacherAttemptAnswer(req, res) {
  try {
    const viewer = resolveTeacherViewerContext(req);
    const assignment = await schoolDataService.getDataById('examAssignments', req.params.assignmentId, req.user);
    if (!assignment) throw new Error('Assignment not found.');
    const attempt = await schoolDataService.getDataById('examAttempts', req.params.attemptId, req.user);
    if (!attempt || !idsEqual(attempt.assignmentId, assignment.id)) throw new Error('Attempt not found for assignment.');
    const answer = await schoolDataService.getDataById('examAnswers', req.params.answerId, req.user);
    if (!answer || !idsEqual(answer.attemptId, attempt.id)) throw new Error('Answer not found for attempt.');

    const classRow = await schoolDataService.getDataById('classes', assignment.classId, req.user);
    const teachers = await schoolDataService.fetchData('teachers', {}, req.user);
    const teacherPersonMap = buildTeacherPersonMap(teachers || []);
    const normalizedViewerPersonId = normalizeId(viewer.personId);
    if (normalizedViewerPersonId) {
      const isInstructor = classHasInstructorPerson(classRow, normalizedViewerPersonId, teacherPersonMap);
      if (!isInstructor && !idsEqual(assignment?.personId, normalizedViewerPersonId)) {
        throw new Error('You do not have access to grade this assignment.');
      }
    }

    const question = await schoolDataService.getDataById('examQuestions', answer.questionId, req.user);
    if (!question) throw new Error('Question not found for answer.');
    const maxScore = Number(question?.scoring?.maxScore || 0);
    const manualScore = Number(req.body?.manualScore);
    if (!Number.isFinite(manualScore) || manualScore < 0) {
      throw new Error('manualScore is required and must be >= 0.');
    }
    if (manualScore > maxScore) {
      throw new Error(`manualScore cannot exceed max score (${maxScore}).`);
    }

    const isCorrect = String(req.body?.isCorrect || '').trim().toLowerCase() === 'true';
    const feedback = String(req.body?.feedback || '').trim();
    const graded = await schoolDataService.gradeExamAttemptAnswer(answer.id, {
      manualScore,
      isCorrect,
      feedback
    }, req.user);

    return res.json({
      status: 'success',
      message: 'Answer graded.',
      answerId: graded?.answer?.id || answer.id,
      attemptId: graded?.attempt?.id || attempt.id,
      attemptStatus: String(graded?.attempt?.status || '').trim().toLowerCase(),
      scoreComputed: Number(graded?.attempt?.totalScoreComputed || 0),
      maxScoreComputed: Number(graded?.attempt?.maxScoreComputed || 0),
      percentageComputed: Number(graded?.attempt?.percentageComputed || 0)
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function listTemplateSubjectsByDepartment(req, res) {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const departmentId = String(req.query.departmentId || '').trim();
    if (!departmentId) {
      return res.json({
        status: 'success',
        results: [],
        pagination: { currentPage: 1, totalPages: 1, totalItems: 0, limit: Number(req.query.limit || 20) || 20 }
      });
    }

    const allSubjects = await schoolDataService.fetchData('subjects', {}, req.user);
    const filtered = (allSubjects || [])
      .filter((row) => idsEqual(
        row?.academicUnit?.departmentId
        || row?.departmentId
        || row?.department?.id
        || '',
        departmentId
      ))
      .filter((row) => {
        if (!q) return true;
        return [
          row.id,
          row.code,
          row.title,
          row.description,
          row.status,
          row?.academicUnit?.departmentName,
          row?.academicUnit?.departmentCode
        ]
          .map((token) => String(token || '').toLowerCase())
          .some((token) => token.includes(q));
      })
      .sort((a, b) => String(a?.title || '').localeCompare(String(b?.title || '')));

    const { data, pagination } = paginate(filtered, req.query);
    return res.json({ status: 'success', results: data, pagination });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function deleteAllocation(req, res) {
  try {
    const allocation = await getAllocationOrThrow(req.params.allocationId, req.user);
    const currentStatus = String(allocation?.status || '').trim().toLowerCase();
    if (currentStatus !== 'cancelled') {
      throw new Error('Only cancelled allocations can be deleted.');
    }

    const linkedAssignments = await schoolDataService.fetchData('examAssignments', {
      allocationId__eq: allocation.id
    }, req.user);
    const nonCancelled = (linkedAssignments || []).filter((row) => String(row?.status || '').trim().toLowerCase() !== 'cancelled');
    if (nonCancelled.length > 0) {
      throw new Error('All linked assignments must be cancelled before deleting allocation.');
    }

    for (const assignment of (linkedAssignments || [])) {
      // eslint-disable-next-line no-await-in-loop
      await schoolDataService.deleteData('examAssignments', assignment.id, req.user);
    }
    await schoolDataService.deleteData('examAllocations', allocation.id, req.user);

    const message = `Allocation deleted successfully. Removed ${Number(linkedAssignments?.length || 0)} cancelled assignment(s).`;
    if (isAjax(req)) {
      return res.json({
        status: 'success',
        message
      });
    }
    return res.redirect('/school/exams/allocations?deleted=1');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function listPublishedAllocationTemplates(req, res) {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const [templates, revisions] = await Promise.all([
      schoolDataService.fetchData('examTemplates', {}, req.user),
      schoolDataService.fetchData('examRevisions', {}, req.user)
    ]);

    const publishedRevisionByTemplateId = new Map();
    (revisions || []).forEach((row) => {
      if (String(row?.status || '').trim().toLowerCase() !== 'published') return;
      const templateId = String(row?.templateId || '').trim();
      if (!templateId) return;
      const current = publishedRevisionByTemplateId.get(templateId);
      if (!current || Number(row?.revisionNo || 0) > Number(current?.revisionNo || 0)) {
        publishedRevisionByTemplateId.set(templateId, row);
      }
    });

    const filtered = (templates || [])
      .filter((row) => publishedRevisionByTemplateId.has(String(row?.id || '').trim()))
      .map((row) => {
        const revision = publishedRevisionByTemplateId.get(String(row?.id || '').trim()) || null;
        return {
          id: String(row?.id || '').trim(),
          title: String(row?.title || row?.id || '').trim(),
          code: String(row?.code || '').trim(),
          status: String(row?.status || '').trim().toLowerCase(),
          revisionId: String(revision?.id || '').trim(),
          revisionNo: Number(revision?.revisionNo || 0),
          revisionTitle: String(revision?.title || '').trim(),
          defaultWindowPolicy: String(row?.settings?.defaultWindowPolicy || 'strict_fixed_window').trim().toLowerCase(),
          defaultQuestionPresentationMode: String(row?.settings?.defaultQuestionPresentationMode || 'all_questions_on_one_page').trim().toLowerCase(),
          defaultCountsInFinalScore: row?.settings?.defaultCountsInFinalScore !== false
        };
      })
      .filter((row) => {
        if (!q) return true;
        return [row.id, row.title, row.code, row.revisionTitle, `r${row.revisionNo}`]
          .map((token) => String(token || '').toLowerCase())
          .some((token) => token.includes(q));
      })
      .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));

    const { data, pagination } = paginate(filtered, req.query);
    return res.json({ status: 'success', results: data, pagination });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function listEligibleAllocationClasses(req, res) {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const [classes, teachers] = await Promise.all([
      schoolDataService.fetchData('classes', {}, req.user),
      schoolDataService.fetchData('teachers', {}, req.user)
    ]);
    const isAdminViewer = isExamAdminViewer(req.user);
    const viewerPersonId = normalizeId(req.user?.personId);
    const teacherPersonMap = buildTeacherPersonMap(teachers || []);

    const filtered = (classes || [])
      .filter((row) => {
        if (isAdminViewer) return true;
        if (!viewerPersonId) return false;
        return classHasPrimaryInstructorPerson(row, viewerPersonId, teacherPersonMap);
      })
      .map((row) => ({
        id: String(row?.id || '').trim(),
        title: String(row?.title || row?.name || row?.id || '').trim(),
        code: String(row?.code || '').trim(),
        status: String(row?.status || '').trim().toLowerCase(),
        capacity: Number(row?.capacity || 0) || 0,
        enrollmentCount: Array.isArray(row?.enrollment?.students) ? row.enrollment.students.length : 0
      }))
      .filter((row) => {
        if (!q) return true;
        return [row.id, row.title, row.code, row.status]
          .map((token) => String(token || '').toLowerCase())
          .some((token) => token.includes(q));
      })
      .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));

    const { data, pagination } = paginate(filtered, req.query);
    return res.json({ status: 'success', results: data, pagination });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function listClassScheduledSessions(req, res) {
  try {
    const classId = String(req.query.classId || '').trim();
    if (!classId) {
      return res.json({
        status: 'success',
        results: [],
        pagination: { currentPage: 1, totalPages: 1, totalItems: 0, limit: Number(req.query.limit || 20) || 20 }
      });
    }

    const classRow = await schoolDataService.getDataById('classes', classId, req.user);
    if (!classRow) throw new Error('Class not found.');

    const isAdminViewer = isExamAdminViewer(req.user);
    const viewerPersonId = normalizeId(req.user?.personId);
    if (!isAdminViewer) {
      if (!viewerPersonId) throw new Error('Your user account is not linked to a person.');
      const teachers = await schoolDataService.fetchData('teachers', {}, req.user);
      const teacherPersonMap = buildTeacherPersonMap(teachers || []);
      if (!classHasPrimaryInstructorPerson(classRow, viewerPersonId, teacherPersonMap)) {
        throw new Error('You can only access sessions for classes where you are the Primary Instructor.');
      }
    }

    const q = String(req.query.q || '').trim().toLowerCase();
    const sessions = (Array.isArray(classRow?.sessions) ? classRow.sessions : [])
      .filter((row) => String(row?.status || '').trim().toLowerCase() === 'scheduled')
      .map((row) => {
        const sessionId = String(row?.sessionId || '').trim();
        const date = String(row?.date || '').trim();
        const startTime = String(row?.startTime || '').trim();
        const endTime = String(row?.endTime || '').trim();
        return {
          id: sessionId,
          sessionId,
          classId: String(classRow?.id || '').trim(),
          className: String(classRow?.title || classRow?.id || '').trim(),
          date,
          startTime,
          endTime,
          status: 'scheduled',
          title: `${date || '-'} | ${startTime || '--:--'}-${endTime || '--:--'} | ${sessionId}`
        };
      })
      .filter((row) => {
        if (!q) return true;
        return [row.sessionId, row.className, row.date, row.startTime, row.endTime]
          .map((token) => String(token || '').toLowerCase())
          .some((token) => token.includes(q));
      })
      .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));

    const { data, pagination } = paginate(sessions, req.query);
    return res.json({ status: 'success', results: data, pagination });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function listAllocationClassStudents(req, res) {
  try {
    const allocationId = String(req.query?.allocationId || '').trim();
    if (!allocationId) throw new Error('allocationId is required.');
    const allocation = await getAllocationOrThrow(allocationId, req.user);
    const roster = await resolveRosterStudentIdsByClass(allocation.classId, req.user);
    const studentIdSet = new Set((Array.isArray(roster?.studentIds) ? roster.studentIds : []).map((row) => String(row || '').trim()).filter(Boolean));
    if (!studentIdSet.size) return res.json({ status: 'success', results: [], pagination: null });

    const q = String(req.query.q || '').trim().toLowerCase();
    const [students, persons, assignments] = await Promise.all([
      schoolDataService.fetchData('students', {}, req.user),
      listSchoolPersonRecords(req.user, { query: { limit: 5000 } }),
      schoolDataService.fetchData('examAssignments', { allocationId__eq: allocation.id }, req.user)
    ]);

    const personById = new Map((Array.isArray(persons) ? persons : []).map((row) => [String(row?.id || '').trim(), row]));
    const assignedSet = new Set((Array.isArray(assignments) ? assignments : [])
      .filter((row) => String(row?.status || '').trim().toLowerCase() !== 'cancelled')
      .map((row) => String(row?.studentId || '').trim())
      .filter(Boolean));
    const exemptSet = getExemptStudentIdSet(allocation);

    const results = (Array.isArray(students) ? students : [])
      .filter((row) => studentIdSet.has(String(row?.id || '').trim()))
      .map((row) => {
        const studentId = String(row?.id || '').trim();
        const person = personById.get(String(row?.personId || '').trim()) || null;
        const first = String(person?.name?.first || '').trim();
        const last = String(person?.name?.last || '').trim();
        const fullName = `${first} ${last}`.trim();
        return {
          id: studentId,
          title: fullName || String(row?.studentNo || studentId).trim(),
          name: fullName || '',
          studentNo: String(row?.studentNo || '').trim(),
          status: String(row?.status || '').trim().toLowerCase() || 'active',
          assigned: assignedSet.has(studentId),
          exempt: exemptSet.has(studentId)
        };
      })
      .filter((row) => {
        if (!q) return true;
        return [row.id, row.title, row.name, row.studentNo, row.status]
          .map((token) => String(token || '').toLowerCase())
          .some((token) => token.includes(q));
      })
      .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));

    const { data, pagination } = paginate(results, req.query);
    return res.json({ status: 'success', results: data, pagination });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function listTakeAssignments(req, res) {
  try {
    const isAdminViewer = isExamAdminViewer(req.user);
    const applyPressed = String(req.query?.apply || '').trim() === '1';
    const selectedPersonId = isAdminViewer ? String(req.query?.personId || '').trim() : '';
    const qRaw = String(req.query?.q || '').trim();
    const q = qRaw.toLowerCase();
    const classIdFilter = String(req.query?.classId || '').trim();
    const requestedLifecycle = String(req.query?.lifecycle || '').trim().toLowerCase();
    const lifecycleOptionIds = new Set(TAKE_EXAM_LIFECYCLE_OPTIONS.map((row) => String(row.id || '').trim().toLowerCase()));
    const normalizedLifecycle = lifecycleOptionIds.has(requestedLifecycle) ? requestedLifecycle : TAKE_EXAM_DEFAULT_LIFECYCLE;
    const requestedDatePreset = String(req.query?.datePreset || '').trim().toLowerCase();
    const normalizedDatePreset = TAKE_EXAM_DATE_PRESET_OPTIONS.includes(requestedDatePreset) ? requestedDatePreset : '';
    const manualWindowStartDate = coerceDateToken(req.query?.windowStartDate);
    const manualWindowEndDate = coerceDateToken(req.query?.windowEndDate);
    const hasManualDateFilters = Boolean(manualWindowStartDate || manualWindowEndDate);
    const hasNonDefaultFilters = Boolean(
      qRaw
      || classIdFilter
      || (isAdminViewer && selectedPersonId)
      || hasManualDateFilters
      || (normalizedLifecycle && normalizedLifecycle !== TAKE_EXAM_DEFAULT_LIFECYCLE)
      || (normalizedDatePreset && ![TAKE_EXAM_DEFAULT_DATE_PRESET, ''].includes(normalizedDatePreset))
    );
    const showAllByApply = applyPressed && !hasNonDefaultFilters;
    const lifecycleFilter = showAllByApply ? 'all' : normalizedLifecycle;
    const dateFilters = showAllByApply
      ? resolveTakeExamDateFilters({ datePreset: 'all' })
      : resolveTakeExamDateFilters(req.query);
    const [assignments, allocations, templates, revisions, classes, attempts, students, persons, teachers] = await Promise.all([
      schoolDataService.fetchData('examAssignments', {}, req.user),
      schoolDataService.fetchData('examAllocations', {}, req.user),
      schoolDataService.fetchData('examTemplates', {}, req.user),
      schoolDataService.fetchData('examRevisions', {}, req.user),
      schoolDataService.fetchData('classes', {}, req.user),
      schoolDataService.fetchData('examAttempts', {}, req.user),
      schoolDataService.fetchData('students', {}, req.user),
      listSchoolPersonRecords(req.user, { query: { limit: 5000 } }),
      schoolDataService.fetchData('teachers', {}, req.user)
    ]);

    const assignmentRows = (Array.isArray(assignments) ? assignments : [])
      .filter((row) => !['cancelled'].includes(String(row?.status || '').trim().toLowerCase()));
    const allocationById = new Map((Array.isArray(allocations) ? allocations : []).map((row) => [String(row?.id || '').trim(), row]));
    const templateById = new Map((Array.isArray(templates) ? templates : []).map((row) => [String(row?.id || '').trim(), row]));
    const revisionById = new Map((Array.isArray(revisions) ? revisions : []).map((row) => [String(row?.id || '').trim(), row]));
    const classById = new Map((Array.isArray(classes) ? classes : []).map((row) => [String(row?.id || '').trim(), row]));
    const teacherPersonMap = buildTeacherPersonMap(teachers || []);
    const studentById = new Map((Array.isArray(students) ? students : []).map((row) => [String(row?.id || '').trim(), row]));
    const personById = new Map((Array.isArray(persons) ? persons : []).map((row) => [String(row?.id || '').trim(), row]));
    const attemptsByAssignmentId = new Map();
    (Array.isArray(attempts) ? attempts : []).forEach((row) => {
      const assignmentId = String(row?.assignmentId || '').trim();
      if (!assignmentId) return;
      if (!attemptsByAssignmentId.has(assignmentId)) attemptsByAssignmentId.set(assignmentId, []);
      attemptsByAssignmentId.get(assignmentId).push(row);
    });

    const currentUserPersonId = normalizeId(req.user?.personId);
    const ownedStudentIdSet = new Set((Array.isArray(students) ? students : [])
      .filter((row) => idsEqual(row?.personId, currentUserPersonId))
      .map((row) => String(row?.id || '').trim())
      .filter(Boolean));
    const selectedStudentIdSet = new Set((Array.isArray(students) ? students : [])
      .filter((row) => selectedPersonId && idsEqual(row?.personId, selectedPersonId))
      .map((row) => String(row?.id || '').trim())
      .filter(Boolean));

    const nowMs = Date.now();
    const baseRows = assignmentRows
      .filter((row) => {
        const studentId = String(row?.studentId || '').trim();
        const classRow = classById.get(String(row?.classId || '').trim()) || null;
        if (isAdminViewer) {
          if (selectedPersonId) return selectedStudentIdSet.has(studentId);
          return true;
        }
        const isOwnerStudent = ownedStudentIdSet.has(studentId);
        const isClassInstructor = classHasInstructorPerson(classRow, currentUserPersonId, teacherPersonMap);
        return isOwnerStudent || isClassInstructor;
      })
      .map((row) => {
        const allocation = allocationById.get(String(row?.allocationId || '').trim()) || null;
        const allocationStatusToken = String(allocation?.status || '').trim().toLowerCase();
        const allocationIsOpen = allocationStatusToken === 'open';
        const template = templateById.get(String(row?.templateId || '').trim()) || null;
        const revision = revisionById.get(String(row?.revisionId || '').trim()) || null;
        const classRow = classById.get(String(row?.classId || '').trim()) || null;
        const canStatusOverride = isAdminViewer || classHasInstructorPerson(classRow, currentUserPersonId, teacherPersonMap);
        const student = studentById.get(String(row?.studentId || '').trim()) || null;
        const person = personById.get(String(student?.personId || '').trim()) || null;
        const fullName = `${String(person?.name?.first || '').trim()} ${String(person?.name?.last || '').trim()}`.trim();
        const linkedAttempts = (attemptsByAssignmentId.get(String(row?.id || '').trim()) || [])
          .sort((a, b) => Number(b?.attemptNo || 0) - Number(a?.attemptNo || 0));
        const activeAttempt = linkedAttempts.find((item) => String(item?.status || '').trim().toLowerCase() === 'in_progress') || null;
        const latestAttempt = linkedAttempts[0] || null;
        const assignmentStatusToken = String(row?.status || '').trim().toLowerCase();
        const canStartByStatus = ['pending', 'available'].includes(assignmentStatusToken) && allocationIsOpen;
        const canContinueByStatus = allocationIsOpen
          && (assignmentStatusToken === 'started' || String(activeAttempt?.status || '').trim().toLowerCase() === 'in_progress');
        return {
          ...row,
          allocationName: String(allocation?.allocationName || allocation?.id || row?.allocationId || '').trim(),
          templateTitle: String(template?.title || row?.templateId || '').trim(),
          revisionLabel: `R${Number(revision?.revisionNo || row?.revisionNo || 0)}`,
          classTitle: String(classRow?.title || classRow?.name || row?.classId || '').trim(),
          studentName: fullName || String(student?.studentNo || row?.studentId || '').trim(),
          studentNo: String(student?.studentNo || '').trim(),
          canTake: canStartByStatus || canContinueByStatus,
          canViewResult: (
            String(row?.status || '').trim().toLowerCase() === 'graded'
            || String((activeAttempt || latestAttempt)?.status || '').trim().toLowerCase() === 'graded'
          ),
          canStatusOverride,
          activeAttemptId: String(activeAttempt?.id || '').trim(),
          latestAttemptStatus: String((activeAttempt || latestAttempt)?.status || '').trim().toLowerCase(),
          lifecycleBucket: resolveTakeAssignmentLifecycleBucket({
            assignmentStatus: row?.status,
            latestAttemptStatus: String((activeAttempt || latestAttempt)?.status || '').trim().toLowerCase(),
            startWindowUtc: row?.startWindowUtc,
            endWindowUtc: row?.endWindowUtc
          }, nowMs)
        };
      });

    const classFilterOptions = Array.from(baseRows.reduce((acc, row) => {
      const classId = String(row?.classId || '').trim();
      if (!classId) return acc;
      if (!acc.has(classId)) {
        acc.set(classId, {
          id: classId,
          title: String(row?.classTitle || classId).trim()
        });
      }
      return acc;
    }, new Map()).values())
      .sort((a, b) => String(a?.title || '').localeCompare(String(b?.title || '')));

    const filteredRows = baseRows
      .filter((row) => {
        if (classIdFilter && !idsEqual(row?.classId, classIdFilter)) return false;
        if (lifecycleFilter !== 'all' && String(row?.lifecycleBucket || '') !== lifecycleFilter) return false;

        const rowStartMs = Date.parse(String(row?.startWindowUtc || '').trim());
        const rowEndMs = Date.parse(String(row?.endWindowUtc || '').trim());
        if (dateFilters.filterStartMs !== null && Number.isFinite(rowEndMs) && rowEndMs < dateFilters.filterStartMs) return false;
        if (dateFilters.filterEndMs !== null && Number.isFinite(rowStartMs) && rowStartMs > dateFilters.filterEndMs) return false;

        if (!q) return true;
        return [
          row?.id,
          row?.studentName,
          row?.studentNo,
          row?.studentId,
          row?.templateTitle,
          row?.allocationName,
          row?.classTitle,
          row?.classId,
          row?.status,
          row?.lifecycleBucket
        ]
          .map((token) => String(token || '').toLowerCase())
          .some((token) => token.includes(q));
      })
      .sort((a, b) => String(b?.audit?.lastUpdateDateTime || b?.audit?.createDateTime || '').localeCompare(String(a?.audit?.lastUpdateDateTime || a?.audit?.createDateTime || '')));
    const { data: pagedRows, pagination } = paginate(filteredRows, req.query);

    const selectedPersonDisplay = selectedPersonId
      ? await resolvePersonDisplay(selectedPersonId, req.user)
      : '';

    return res.render('school/exam/takeAssignmentList', {
      title: 'Take Exam',
      tableName: TAKE_ASSIGNMENTS_TABLE_NAME,
      isAdminViewer,
      selectedPersonId,
      selectedPersonDisplay,
      assignmentStatusOptions: examAssignmentModel.ASSIGNMENT_STATUSES,
      lifecycleOptions: TAKE_EXAM_LIFECYCLE_OPTIONS,
      classFilterOptions,
      filters: {
        q: qRaw,
        personId: selectedPersonId,
        classId: classIdFilter,
        lifecycle: lifecycleFilter,
        datePreset: dateFilters.datePreset,
        windowStartDate: dateFilters.windowStartDate,
        windowEndDate: dateFilters.windowEndDate
      },
      rows: pagedRows,
      totalVisibleRows: filteredRows.length,
      pagination,
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: false,
      print: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function updateTakeAssignmentStatus(req, res) {
  try {
    const assignment = await schoolDataService.getDataById('examAssignments', req.params.assignmentId, req.user);
    if (!assignment) throw new Error('Assignment not found.');
    const classRow = await schoolDataService.getDataById('classes', assignment.classId, req.user);
    const isAdminViewer = isExamAdminViewer(req.user);
    if (!isAdminViewer) {
      const teachers = await schoolDataService.fetchData('teachers', {}, req.user);
      const teacherPersonMap = buildTeacherPersonMap(teachers || []);
      const viewerPersonId = normalizeId(req.user?.personId);
      if (!classHasInstructorPerson(classRow, viewerPersonId, teacherPersonMap)) {
        throw new Error('Only admins or class instructors can change assignment status.');
      }
    }

    const requestedStatus = String(req.body?.status || '').trim().toLowerCase();
    const normalizedStatus = requestedStatus === 'in_progress' ? 'started' : requestedStatus;
    if (!examAssignmentModel.ASSIGNMENT_STATUSES.includes(normalizedStatus)) {
      throw new Error('Invalid assignment status.');
    }

    const patch = {
      status: normalizedStatus,
      note: String(req.body?.note || '').trim(),
      audit: { lastUpdateUser: String(req.user?.id || '').trim() }
    };
    if (['pending', 'available'].includes(normalizedStatus)) {
      patch.startedAttemptId = '';
      patch.submittedAttemptId = '';
    } else if (normalizedStatus === 'started' && assignment?.submittedAttemptId) {
      patch.startedAttemptId = String(assignment.submittedAttemptId || '').trim();
      patch.submittedAttemptId = '';
    }

    const updated = await schoolDataService.updateData('examAssignments', assignment.id, patch, req.user);

    if (normalizedStatus === 'started' && assignment?.submittedAttemptId) {
      const attempt = await schoolDataService.getDataById('examAttempts', String(assignment.submittedAttemptId || '').trim(), req.user);
      if (attempt) {
        await schoolDataService.updateData('examAttempts', attempt.id, {
          status: 'in_progress',
          submittedAtUtc: '',
          autoSubmittedAtUtc: '',
          isAutoSubmitted: false,
          audit: { lastUpdateUser: String(req.user?.id || '').trim() }
        }, req.user);
      }
    }

    return res.json({
      status: 'success',
      message: 'Assignment status updated.',
      assignmentId: updated?.id || assignment.id,
      assignmentStatus: String(updated?.status || normalizedStatus).trim().toLowerCase()
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function listEligibleTakeStudentPersons(req, res) {
  try {
    if (!isExamAdminViewer(req.user)) throw new Error('Only admins can access this picker.');
    const q = String(req.query?.q || '').trim().toLowerCase();
    const [students, persons] = await Promise.all([
      schoolDataService.fetchData('students', {}, req.user),
      listSchoolPersonRecords(req.user, { query: { limit: 5000 } })
    ]);
    const studentCountByPersonId = new Map();
    (Array.isArray(students) ? students : []).forEach((row) => {
      const personId = String(row?.personId || '').trim();
      if (!personId) return;
      studentCountByPersonId.set(personId, Number(studentCountByPersonId.get(personId) || 0) + 1);
    });

    const results = (Array.isArray(persons) ? persons : [])
      .filter((row) => studentCountByPersonId.has(String(row?.id || '').trim()))
      .map((row) => {
        const personId = String(row?.id || '').trim();
        const first = String(row?.name?.first || '').trim();
        const last = String(row?.name?.last || '').trim();
        const fullName = `${first} ${last}`.trim();
        return {
          id: personId,
          title: fullName || personId,
          name: fullName,
          studentCount: Number(studentCountByPersonId.get(personId) || 0)
        };
      })
      .filter((row) => {
        if (!q) return true;
        return [row.id, row.title, row.name]
          .map((token) => String(token || '').toLowerCase())
          .some((token) => token.includes(q));
      })
      .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));

    const { data, pagination } = paginate(results, req.query);
    return res.json({ status: 'success', results: data, pagination });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function viewAllocationSimulate(req, res) {
  try {
    const allocationId = String(req.params?.allocationId || '').trim();
    const classIdParam = String(req.query?.classId || '').trim();
    const sessionIdParam = String(req.query?.sessionId || '').trim();
    if (!allocationId) throw new Error('Allocation is required.');
    if (!classIdParam) throw new Error('classId is required for exam simulation.');

    const allocation = await schoolDataService.getDataById('examAllocations', allocationId, req.user);
    if (!allocation) throw new Error('Allocation not found.');
    ensureSameOrg(allocation, getActiveOrgIdOrThrow(req.user), 'Allocation');
    if (!idsEqual(allocation.classId, classIdParam)) {
      throw new Error('This simulation link is not valid for the selected class.');
    }

    const [template, revision, classRow, bundle] = await Promise.all([
      schoolDataService.getDataById('examTemplates', allocation.templateId, req.user),
      schoolDataService.getDataById('examRevisions', allocation.revisionId, req.user),
      schoolDataService.getDataById('classes', allocation.classId, req.user),
      schoolDataService.getExamRevisionBundle(allocation.revisionId, req.user)
    ]);

    const baseQuestions = (Array.isArray(bundle?.questions) ? bundle.questions : [])
      .filter((row) => String(row?.status || '').trim().toLowerCase() !== 'archived')
      .sort((a, b) => Number(a?.sequenceNo || 0) - Number(b?.sequenceNo || 0));
    const shouldShuffle = allocation?.shuffleQuestions === true;
    const simSeed = `simulate:${allocationId}`;
    const questions = shouldShuffle
      ? [...baseQuestions].sort((a, b) => deterministicStableHash(`${simSeed}:${a?.id}`) - deterministicStableHash(`${simSeed}:${b?.id}`))
      : baseQuestions;

    const presentationMode = String(
      allocation?.questionPresentationMode
      || template?.settings?.defaultQuestionPresentationMode
      || 'all_questions_on_one_page'
    ).trim().toLowerCase();
    const allowBackNavigation = template?.settings?.allowBackNavigation !== false;
    const showResultImmediately = template?.settings?.showResultImmediately === true;

    const syntheticAssignment = {
      id: '',
      allocationId: allocation.id,
      classId: allocation.classId,
      templateId: allocation.templateId,
      revisionId: allocation.revisionId,
      revisionNo: Number(revision?.revisionNo || 0),
      status: 'simulation',
      studentId: '',
      startWindowUtc: allocation.windowStartUtc || '',
      endWindowUtc: allocation.windowEndUtc || '',
      durationMinutes: Number(allocation.durationMinutes || 0)
    };

    const simulationBackHref = sessionIdParam
      ? `/school/classes/${encodeURIComponent(classIdParam)}/sessions/${encodeURIComponent(sessionIdParam)}`
      : '';

    return res.render('school/exam/takeAssignmentView', {
      title: `Simulate: ${String(template?.title || allocation?.allocationName || 'Exam').trim()}`,
      assignment: syntheticAssignment,
      allocation,
      template,
      revision,
      classRow,
      attempt: null,
      questions,
      answerByQuestionId: new Map(),
      studentName: 'Preview (not saved)',
      isAdminViewer: true,
      presentationMode,
      allowBackNavigation,
      showResultImmediately,
      resultViewMode: false,
      simulationMode: true,
      simulationClassId: classIdParam,
      simulationBackHref,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function viewTakeAssignment(req, res) {
  try {
    const assignment = await schoolDataService.getDataById('examAssignments', req.params.assignmentId, req.user);
    if (!assignment) throw new Error('Assignment not found.');
    const isAdminViewer = isExamAdminViewer(req.user);

    if (!isAdminViewer) {
      const currentUserPersonId = normalizeId(req.user?.personId);
      const students = await schoolDataService.fetchData('students', {}, req.user);
      const ownedStudentIds = new Set((Array.isArray(students) ? students : [])
        .filter((row) => idsEqual(row?.personId, currentUserPersonId))
        .map((row) => String(row?.id || '').trim())
        .filter(Boolean));
      if (!ownedStudentIds.has(String(assignment?.studentId || '').trim())) {
        throw new Error('You can only take exams assigned to your student profile.');
      }
    }

    const requestedView = String(req.query?.view || '').trim().toLowerCase();
    const resultViewMode = requestedView === 'result';

    const [allocation, template, revision, classRow, students, persons, attempts, bundle] = await Promise.all([
      schoolDataService.getDataById('examAllocations', assignment.allocationId, req.user),
      schoolDataService.getDataById('examTemplates', assignment.templateId, req.user),
      schoolDataService.getDataById('examRevisions', assignment.revisionId, req.user),
      schoolDataService.getDataById('classes', assignment.classId, req.user),
      schoolDataService.fetchData('students', {}, req.user),
      listSchoolPersonRecords(req.user, { query: { limit: 5000 } }),
      schoolDataService.fetchData('examAttempts', { assignmentId__eq: assignment.id }, req.user),
      schoolDataService.getExamRevisionBundle(assignment.revisionId, req.user)
    ]);

    const student = (Array.isArray(students) ? students : [])
      .find((row) => idsEqual(row?.id, assignment?.studentId)) || null;
    const person = (Array.isArray(persons) ? persons : [])
      .find((row) => idsEqual(row?.id, student?.personId)) || null;
    const studentName = `${String(person?.name?.first || '').trim()} ${String(person?.name?.last || '').trim()}`.trim()
      || String(student?.studentNo || assignment?.studentId || '').trim();

    const sortedAttempts = (Array.isArray(attempts) ? attempts : [])
      .sort((a, b) => Number(b?.attemptNo || 0) - Number(a?.attemptNo || 0));
    const activeAttempt = sortedAttempts.find((row) => String(row?.status || '').trim().toLowerCase() === 'in_progress') || null;
    const latestAttempt = sortedAttempts[0] || null;
    const assignmentStatus = String(assignment?.status || '').trim().toLowerCase();
    const terminalAssignmentStatuses = new Set(['submitted', 'auto_submitted', 'graded', 'expired']);
    let attempt = activeAttempt || null;
    if (!attempt && terminalAssignmentStatuses.has(assignmentStatus)) {
      const submittedId = String(assignment?.submittedAttemptId || '').trim();
      if (submittedId) {
        attempt = sortedAttempts.find((row) => idsEqual(row?.id, submittedId)) || null;
      }
      if (!attempt && latestAttempt) {
        const st = String(latestAttempt?.status || '').trim().toLowerCase();
        if (['submitted', 'auto_submitted', 'graded'].includes(st)) attempt = latestAttempt;
      }
    }
    const answers = attempt
      ? await schoolDataService.fetchData('examAnswers', { attemptId__eq: attempt.id }, req.user)
      : [];
    const answerByQuestionId = new Map((Array.isArray(answers) ? answers : [])
      .map((row) => [String(row?.questionId || '').trim(), row]));

    const baseQuestions = (Array.isArray(bundle?.questions) ? bundle.questions : [])
      .filter((row) => String(row?.status || '').trim().toLowerCase() !== 'archived')
      .sort((a, b) => Number(a?.sequenceNo || 0) - Number(b?.sequenceNo || 0));
    const questionOrder = Array.isArray(attempt?.extensions?.questionOrder) ? attempt.extensions.questionOrder : [];
    const orderedBySavedOrder = questionOrder.length
      ? baseQuestions.sort((a, b) => questionOrder.indexOf(String(a?.id || '').trim()) - questionOrder.indexOf(String(b?.id || '').trim()))
      : baseQuestions;
    const shouldShuffle = allocation?.shuffleQuestions === true;
    const questions = shouldShuffle && !questionOrder.length
      ? [...orderedBySavedOrder].sort((a, b) => deterministicStableHash(`${attempt?.id || assignment?.id}:${a?.id}`) - deterministicStableHash(`${attempt?.id || assignment?.id}:${b?.id}`))
      : orderedBySavedOrder;

    const presentationMode = String(
      allocation?.questionPresentationMode
      || template?.settings?.defaultQuestionPresentationMode
      || 'all_questions_on_one_page'
    ).trim().toLowerCase();
    const allowBackNavigation = template?.settings?.allowBackNavigation !== false;
    const showResultImmediately = template?.settings?.showResultImmediately === true;

    return res.render('school/exam/takeAssignmentView', {
      title: String(template?.title || allocation?.allocationName || 'Take Exam').trim(),
      assignment,
      allocation,
      template,
      revision,
      classRow,
      attempt,
      questions,
      answerByQuestionId,
      studentName,
      isAdminViewer,
      presentationMode,
      allowBackNavigation,
      showResultImmediately,
      resultViewMode,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function startTakeAssignment(req, res) {
  try {
    const assignment = await schoolDataService.getDataById('examAssignments', req.params.assignmentId, req.user);
    if (!assignment) throw new Error('Assignment not found.');
    const isAdminViewer = isExamAdminViewer(req.user);
    if (!isAdminViewer) {
      const currentUserPersonId = normalizeId(req.user?.personId);
      const students = await schoolDataService.fetchData('students', {}, req.user);
      const ownedStudentIds = new Set((Array.isArray(students) ? students : [])
        .filter((row) => idsEqual(row?.personId, currentUserPersonId))
        .map((row) => String(row?.id || '').trim())
        .filter(Boolean));
      if (!ownedStudentIds.has(String(assignment?.studentId || '').trim())) {
        throw new Error('You can only start exams assigned to your student profile.');
      }
    }

    let attempt = await schoolDataService.startExamAttempt({ assignmentId: assignment.id }, req.user);
    const allocation = await schoolDataService.getDataById('examAllocations', assignment.allocationId, req.user);
    if (allocation?.shuffleQuestions === true) {
      const bundle = await schoolDataService.getExamRevisionBundle(assignment.revisionId, req.user);
      const questionOrder = (Array.isArray(bundle?.questions) ? bundle.questions : [])
        .sort((a, b) => deterministicStableHash(`${attempt?.id || assignment?.id}:${a?.id}`) - deterministicStableHash(`${attempt?.id || assignment?.id}:${b?.id}`))
        .map((row) => String(row?.id || '').trim())
        .filter(Boolean);
      attempt = await schoolDataService.updateData('examAttempts', attempt.id, {
        extensions: {
          ...(attempt?.extensions && typeof attempt.extensions === 'object' ? attempt.extensions : {}),
          questionOrder
        },
        audit: { lastUpdateUser: String(req.user?.id || '').trim() }
      }, req.user);
    }

    const redirectUrl = `/school/exams/take/${encodeURIComponent(assignment.id)}`;
    if (isAjax(req)) return res.json({ status: 'success', attemptId: attempt?.id || '', redirectUrl });
    return res.redirect(redirectUrl);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function saveTakeAssignmentAnswer(req, res) {
  try {
    const assignment = await schoolDataService.getDataById('examAssignments', req.params.assignmentId, req.user);
    if (!assignment) throw new Error('Assignment not found.');
    const attempt = await schoolDataService.getDataById('examAttempts', req.params.attemptId, req.user);
    if (!attempt || !idsEqual(attempt.assignmentId, assignment.id)) throw new Error('Attempt not found for this assignment.');

    const isAdminViewer = isExamAdminViewer(req.user);
    if (!isAdminViewer) {
      const currentUserPersonId = normalizeId(req.user?.personId);
      const students = await schoolDataService.fetchData('students', {}, req.user);
      const ownedStudentIds = new Set((Array.isArray(students) ? students : [])
        .filter((row) => idsEqual(row?.personId, currentUserPersonId))
        .map((row) => String(row?.id || '').trim())
        .filter(Boolean));
      if (!ownedStudentIds.has(String(assignment?.studentId || '').trim())) {
        throw new Error('You can only save answers for your own assignment.');
      }
    }

    const questionId = String(req.body?.questionId || '').trim();
    if (!questionId) throw new Error('questionId is required.');
    const question = await schoolDataService.getDataById('examQuestions', questionId, req.user);
    if (!question || !idsEqual(question?.revisionId, assignment?.revisionId)) throw new Error('Question is invalid for this assignment.');

    const input = {
      attemptId: attempt.id,
      questionId: question.id,
      updatedFromClientAtUtc: new Date().toISOString()
    };
    if (String(question?.questionType || '').trim().toLowerCase() === 'objective') {
      const selectedOptionIds = normalizeSelectedOptionIds(req.body?.selectedOptionIds || req.body?.selectedOptionId);
      input.selectedOptionIds = selectedOptionIds;
      input.objectiveResponse = { selectedOptionIds };
    } else {
      const text = String(req.body?.text || '').trim();
      input.text = text;
      input.subjectiveResponse = { text, attachments: [] };
    }

    const saved = await schoolDataService.saveExamAttemptAnswer(input, req.user);
    return res.json({ status: 'success', answerId: saved?.id || '' });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function submitTakeAssignment(req, res) {
  try {
    const assignment = await schoolDataService.getDataById('examAssignments', req.params.assignmentId, req.user);
    if (!assignment) throw new Error('Assignment not found.');
    const attempt = await schoolDataService.getDataById('examAttempts', req.params.attemptId, req.user);
    if (!attempt || !idsEqual(attempt.assignmentId, assignment.id)) throw new Error('Attempt not found for this assignment.');

    const isAdminViewer = isExamAdminViewer(req.user);
    if (!isAdminViewer) {
      const currentUserPersonId = normalizeId(req.user?.personId);
      const students = await schoolDataService.fetchData('students', {}, req.user);
      const ownedStudentIds = new Set((Array.isArray(students) ? students : [])
        .filter((row) => idsEqual(row?.personId, currentUserPersonId))
        .map((row) => String(row?.id || '').trim())
        .filter(Boolean));
      if (!ownedStudentIds.has(String(assignment?.studentId || '').trim())) {
        throw new Error('You can only submit your own assignment.');
      }
    }

    const autoSubmit = String(req.body?.autoSubmit || '').trim().toLowerCase() === 'true';
    const submitted = await schoolDataService.submitExamAttempt(attempt.id, { autoSubmit }, req.user);
    return res.json({
      status: 'success',
      attemptId: submitted?.id || '',
      scoreComputed: Number(submitted?.totalScoreComputed || 0),
      maxScoreComputed: Number(submitted?.maxScoreComputed || 0),
      percentageComputed: Number(submitted?.percentageComputed || 0)
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function uploadQuestionMedia(req, res) {
  try {
    const templateId = String(req.body?.templateId || req.params?.templateId || '').trim();
    if (!templateId) throw new Error('templateId is required for media upload.');
    if (!Array.isArray(req.files) || req.files.length <= 0) {
      throw new Error('No files were uploaded.');
    }
    const files = req.files
      .filter((file) => file && file.path && file.filename)
      .map((file) => {
        const storedPath = String(uploadMiddleware.getStoredFilePath(file) || '').trim();
        const storedUrl = String(uploadMiddleware.getStoredFileUrl(file) || storedPath).trim();
        return {
          name: String(file.originalname || file.filename || '').trim(),
          fileName: String(file.filename || '').trim(),
          type: String(file.mimetype || '').trim(),
          sizeBytes: Number(file.size || 0) || 0,
          storagePath: storedPath,
          url: storedUrl
        };
      });
    return res.json({
      status: 'success',
      message: `Uploaded ${files.length} file(s).`,
      files
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

module.exports = {
  showHome,
  listTemplates,
  showTemplateForm,
  saveTemplate,
  viewTemplate,
  createTemplateRevisionCopy,
  publishRevision,
  saveQuestion,
  deleteQuestion,
  reorderQuestions,
  showAllocationForm,
  saveAllocation,
  showAllocationEditForm,
  saveAllocationEdit,
  cancelAllocation,
  openAllocation,
  deleteAllocation,
  listAllocations,
  viewAllocation,
  viewAllocationSimulate,
  generateAllocationAssignments,
  addAllocationStudents,
  exemptAllocationStudents,
  listTemplateSubjectsByDepartment,
  uploadQuestionMedia,
  listTeacherAssignments,
  viewTeacherAssignment,
  viewTeacherAttemptReview,
  gradeTeacherAttemptAnswer,
  deleteTeacherReviewAttempt,
  listTakeAssignments,
  viewTakeAssignment,
  startTakeAssignment,
  updateTakeAssignmentStatus,
  saveTakeAssignmentAnswer,
  submitTakeAssignment,
  listPublishedAllocationTemplates,
  listEligibleAllocationClasses,
  listClassScheduledSessions,
  listAllocationClassStudents,
  listEligibleTakeStudentPersons
};
