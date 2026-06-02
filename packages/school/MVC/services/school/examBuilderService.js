const crypto = require('crypto');
const schoolRepositories = require('../../repositories/school');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const ACTIVE_QUESTION_STATUSES = new Set(['draft', 'active']);

let dependencies = {
  repositories: schoolRepositories
};
const defaultDependencies = {
  repositories: schoolRepositories
};

function resolveActor(requestingUser) {
  return String(
    requestingUser?.id ||
    requestingUser?.userId ||
    requestingUser?.personId ||
    requestingUser?.username ||
    'system'
  ).trim() || 'system';
}

function resolveActiveOrgId(requestingUser, explicitOrgId = '') {
  const token = toPublicId(explicitOrgId || requestingUser?.activeOrgId || requestingUser?.primaryOrgId || '');
  if (!token) throw new Error('Active organization is required.');
  return token;
}

function ensureSameOrg(record, activeOrgId, entityName = 'Record') {
  const recordOrgId = toPublicId(record?.orgId);
  if (!recordOrgId || !idsEqual(recordOrgId, activeOrgId)) {
    throw new Error(`${entityName} is not accessible in the active organization.`);
  }
}

function normalizeStatus(value, fallback = '') {
  const token = String(value || '').trim().toLowerCase();
  return token || fallback;
}

function ensureDraftRevision(revision) {
  if (!revision) throw new Error('Revision not found.');
  if (normalizeStatus(revision.status) !== 'draft') {
    throw new Error('Only draft revisions can be edited.');
  }
  if (revision.isImmutable === true) {
    throw new Error('Published revision is immutable.');
  }
}

function hashRevisionPayload(revision, questions) {
  const normalizedQuestions = (Array.isArray(questions) ? questions : [])
    .map((q) => ({
      id: q.id,
      sequenceNo: Number(q.sequenceNo || 0),
      questionType: q.questionType,
      promptText: q.promptText,
      objectiveMode: q.objectiveMode || '',
      objectiveOptions: Array.isArray(q.objectiveOptions)
        ? q.objectiveOptions.map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect === true }))
        : [],
      scoring: q.scoring || {}
    }))
    .sort((a, b) => a.sequenceNo - b.sequenceNo || String(a.id).localeCompare(String(b.id)));

  const payload = JSON.stringify({
    revisionId: revision?.id || '',
    revisionNo: revision?.revisionNo || 0,
    title: revision?.title || '',
    instructions: revision?.instructions || '',
    durationMinutes: revision?.durationMinutes || 0,
    questions: normalizedQuestions
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

async function getTemplateOrThrow(templateId, options = {}) {
  const row = await dependencies.repositories.examTemplates.getById(templateId, options);
  if (!row) throw new Error('Exam template not found.');
  return row;
}

async function getRevisionOrThrow(revisionId, options = {}) {
  const row = await dependencies.repositories.examRevisions.getById(revisionId, options);
  if (!row) throw new Error('Exam revision not found.');
  return row;
}

async function getAllocationOrThrow(allocationId, options = {}) {
  const row = await dependencies.repositories.examAllocations.getById(allocationId, options);
  if (!row) throw new Error('Exam allocation not found.');
  return row;
}

async function recalculateRevisionTotals(revisionId, options = {}) {
  const allQuestions = await dependencies.repositories.examQuestions.findByRevisionId(revisionId, options);
  const rows = (Array.isArray(allQuestions) ? allQuestions : [])
    .filter((row) => ACTIVE_QUESTION_STATUSES.has(normalizeStatus(row?.status, 'draft')));
  const totalQuestions = rows.length;
  const totalScore = rows.reduce((sum, row) => {
    const maxScore = Number(row?.scoring?.maxScore || 0);
    return sum + (Number.isFinite(maxScore) ? maxScore : 0);
  }, 0);
  return {
    totalQuestions,
    totalScore: Number(totalScore.toFixed(2)),
    questions: rows
  };
}

async function createTemplate(input = {}, requestingUser = null, options = {}) {
  const actor = resolveActor(requestingUser);
  const orgId = resolveActiveOrgId(requestingUser, input.orgId);

  const template = await dependencies.repositories.examTemplates.create({
    orgId,
    code: input.code,
    title: input.title,
    description: input.description,
    ownerUserId: input.ownerUserId || actor,
    ownerTeacherId: input.ownerTeacherId || '',
    visibility: String(input.visibility || 'private').trim().toLowerCase() === 'public' ? 'public' : 'private',
    departmentId: input.departmentId || '',
    departmentCode: input.departmentCode || '',
    departmentName: input.departmentName || '',
    subjectIds: Array.isArray(input.subjectIds) ? input.subjectIds : [],
    subjectId: input.subjectId,
    classLevel: input.classLevel,
    tags: input.tags,
    parentTemplateId: input.parentTemplateId || '',
    rootTemplateId: input.rootTemplateId || '',
    revisionDepth: Number(input.revisionDepth || 0),
    settings: input.settings,
    status: 'draft',
    latestRevisionNo: 0,
    publishedRevisionId: '',
    audit: { createUser: actor, lastUpdateUser: actor }
  }, options);

  const createInitialDraft = input.createInitialDraftRevision !== false;
  if (!createInitialDraft) return { template, revision: null };

  const revision = await dependencies.repositories.examRevisions.create({
    orgId,
    templateId: template.id,
    revisionNo: 1,
    title: `${template.title} - R1`,
    instructions: '',
    durationMinutes: Number(template?.settings?.defaultDurationMinutes || 60),
    status: 'draft',
    totalQuestions: 0,
    totalScore: 0,
    tags: input.tags,
    audit: { createUser: actor, lastUpdateUser: actor }
  }, options);

  const updatedTemplate = await dependencies.repositories.examTemplates.update(template.id, {
    latestRevisionNo: 1,
    rootTemplateId: template.rootTemplateId || template.id,
    revisionDepth: Number(template.revisionDepth || 0),
    audit: { lastUpdateUser: actor }
  }, options);

  return { template: updatedTemplate, revision };
}

function sortRevisionNoDesc(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])]
    .sort((a, b) => Number(b?.revisionNo || 0) - Number(a?.revisionNo || 0));
}

function getSourceRevisionForClone(template, revisions = []) {
  const ordered = sortRevisionNoDesc(revisions);
  if (!ordered.length) return null;
  const publishedId = toPublicId(template?.publishedRevisionId);
  if (publishedId) {
    const published = ordered.find((row) => idsEqual(row?.id, publishedId));
    if (published) return published;
  }
  return null;
}

async function cloneTemplateAsRevision(sourceTemplateId, input = {}, requestingUser = null, options = {}) {
  const actor = resolveActor(requestingUser);
  const activeOrgId = resolveActiveOrgId(requestingUser, input.orgId);
  const sourceTemplate = await getTemplateOrThrow(sourceTemplateId, options);
  ensureSameOrg(sourceTemplate, activeOrgId, 'Source exam template');

  const sourceRevisions = await dependencies.repositories.examRevisions.findByTemplateId(sourceTemplate.id, options);
  const publishedRevisionId = toPublicId(sourceTemplate?.publishedRevisionId);
  if (!publishedRevisionId) {
    throw new Error('Revisions can only be created from published templates.');
  }
  const sourceRevision = getSourceRevisionForClone(sourceTemplate, sourceRevisions);
  if (!sourceRevision) throw new Error('Published source revision was not found for this template.');
  ensureSameOrg(sourceRevision, activeOrgId, 'Source exam revision');

  const sourceQuestions = await dependencies.repositories.examQuestions.findByRevisionId(sourceRevision.id, options);
  const normalizedSourceQuestions = (Array.isArray(sourceQuestions) ? sourceQuestions : [])
    .sort((a, b) => Number(a?.sequenceNo || 0) - Number(b?.sequenceNo || 0));

  const rootTemplateId = toPublicId(sourceTemplate.rootTemplateId || sourceTemplate.id);
  const revisionDepth = Number(sourceTemplate.revisionDepth || 0) + 1;
  const copiedTemplate = await dependencies.repositories.examTemplates.create({
    orgId: activeOrgId,
    code: input.code || sourceTemplate.code || '',
    title: input.title || sourceTemplate.title || 'Exam Template',
    description: input.description || sourceTemplate.description || '',
    ownerUserId: input.ownerUserId || sourceTemplate.ownerUserId || actor,
    ownerTeacherId: sourceTemplate.ownerTeacherId || '',
    visibility: sourceTemplate.visibility || 'private',
    departmentId: sourceTemplate.departmentId || '',
    departmentCode: sourceTemplate.departmentCode || '',
    departmentName: sourceTemplate.departmentName || '',
    subjectIds: Array.isArray(sourceTemplate.subjectIds) ? sourceTemplate.subjectIds : [],
    subjectId: sourceTemplate.subjectId || '',
    classLevel: sourceTemplate.classLevel || '',
    tags: Array.isArray(sourceTemplate.tags) ? sourceTemplate.tags : [],
    parentTemplateId: sourceTemplate.id,
    rootTemplateId,
    revisionDepth,
    settings: sourceTemplate.settings || {},
    status: 'draft',
    latestRevisionNo: 0,
    publishedRevisionId: '',
    extensions: {
      ...(sourceTemplate.extensions || {}),
      lineage: {
        sourceTemplateId: sourceTemplate.id,
        sourceRevisionId: sourceRevision.id,
        clonedAt: new Date().toISOString(),
        clonedBy: actor
      }
    },
    audit: { createUser: actor, lastUpdateUser: actor }
  }, options);

  const copiedRevision = await dependencies.repositories.examRevisions.create({
    orgId: activeOrgId,
    templateId: copiedTemplate.id,
    revisionNo: 1,
    title: input.revisionTitle || `${copiedTemplate.title} - R1`,
    instructions: sourceRevision.instructions || '',
    durationMinutes: Number(input.durationMinutes || sourceRevision.durationMinutes || sourceTemplate?.settings?.defaultDurationMinutes || 60),
    blueprintSummary: sourceRevision.blueprintSummary || {},
    tags: Array.isArray(sourceRevision.tags) ? sourceRevision.tags : [],
    status: 'draft',
    totalQuestions: 0,
    totalScore: 0,
    audit: { createUser: actor, lastUpdateUser: actor }
  }, options);

  for (const sourceQuestion of normalizedSourceQuestions) {
    const payload = {
      ...sourceQuestion,
      id: undefined,
      orgId: activeOrgId,
      templateId: copiedTemplate.id,
      revisionId: copiedRevision.id,
      status: 'draft',
      audit: { createUser: actor, lastUpdateUser: actor }
    };
    // eslint-disable-next-line no-await-in-loop
    await dependencies.repositories.examQuestions.create(payload, options);
  }

  const totals = await recalculateRevisionTotals(copiedRevision.id, options);
  const updatedRevision = await dependencies.repositories.examRevisions.update(copiedRevision.id, {
    totalQuestions: totals.totalQuestions,
    totalScore: totals.totalScore,
    audit: { lastUpdateUser: actor }
  }, options);

  const updatedTemplate = await dependencies.repositories.examTemplates.update(copiedTemplate.id, {
    latestRevisionNo: 1,
    audit: { lastUpdateUser: actor }
  }, options);

  return {
    sourceTemplate,
    sourceRevision,
    template: updatedTemplate,
    revision: updatedRevision
  };
}

async function createDraftRevision(templateId, input = {}, requestingUser = null, options = {}) {
  const actor = resolveActor(requestingUser);
  const activeOrgId = resolveActiveOrgId(requestingUser, input.orgId);
  const template = await getTemplateOrThrow(templateId, options);
  ensureSameOrg(template, activeOrgId, 'Exam template');
  if (toPublicId(template?.publishedRevisionId)) {
    throw new Error('Published templates are immutable. Create a revision template copy instead.');
  }
  const linkedAllocations = await dependencies.repositories.examAllocations.list({
    query: {
      templateId__eq: template.id,
      page: 1,
      limit: 1
    },
    scope: { canViewAll: true }
  });
  if (Array.isArray(linkedAllocations) && linkedAllocations.length > 0) {
    throw new Error('Allocated templates are immutable. Create a revision template copy instead.');
  }

  const revisions = await dependencies.repositories.examRevisions.findByTemplateId(template.id, options);
  const draftExists = (revisions || []).some((row) => normalizeStatus(row?.status) === 'draft');
  if (draftExists) throw new Error('Template already has a draft revision. Publish/archive it first.');

  const maxRevisionNo = (revisions || []).reduce((max, row) => {
    const num = Number(row?.revisionNo || 0);
    return Number.isFinite(num) && num > max ? num : max;
  }, 0);
  const nextRevisionNo = maxRevisionNo + 1;

  const revision = await dependencies.repositories.examRevisions.create({
    orgId: activeOrgId,
    templateId: template.id,
    revisionNo: nextRevisionNo,
    title: input.title || `${template.title} - R${nextRevisionNo}`,
    instructions: input.instructions || '',
    durationMinutes: Number(input.durationMinutes || template?.settings?.defaultDurationMinutes || 60),
    tags: input.tags,
    status: 'draft',
    totalQuestions: 0,
    totalScore: 0,
    audit: { createUser: actor, lastUpdateUser: actor }
  }, options);

  await dependencies.repositories.examTemplates.update(template.id, {
    latestRevisionNo: nextRevisionNo,
    audit: { lastUpdateUser: actor }
  }, options);

  return revision;
}

async function updateDraftRevision(revisionId, updates = {}, requestingUser = null, options = {}) {
  const actor = resolveActor(requestingUser);
  const activeOrgId = resolveActiveOrgId(requestingUser, updates.orgId);
  const revision = await getRevisionOrThrow(revisionId, options);
  ensureSameOrg(revision, activeOrgId, 'Exam revision');
  ensureDraftRevision(revision);

  return dependencies.repositories.examRevisions.update(revision.id, {
    title: updates.title,
    instructions: updates.instructions,
    durationMinutes: updates.durationMinutes,
    blueprintSummary: updates.blueprintSummary,
    tags: updates.tags,
    extensions: updates.extensions,
    audit: { lastUpdateUser: actor }
  }, options);
}

async function saveDraftQuestion(revisionId, questionInput = {}, requestingUser = null, options = {}) {
  const actor = resolveActor(requestingUser);
  const activeOrgId = resolveActiveOrgId(requestingUser, questionInput.orgId);
  const revision = await getRevisionOrThrow(revisionId, options);
  ensureSameOrg(revision, activeOrgId, 'Exam revision');
  ensureDraftRevision(revision);

  const existingQuestions = await dependencies.repositories.examQuestions.findByRevisionId(revision.id, options);
  const maxSequenceNo = (existingQuestions || []).reduce((max, row) => {
    const num = Number(row?.sequenceNo || 0);
    return Number.isFinite(num) && num > max ? num : max;
  }, 0);

  let savedQuestion = null;
  const questionId = toPublicId(questionInput.id || questionInput.questionId);
  if (questionId) {
    const existing = await dependencies.repositories.examQuestions.getById(questionId, options);
    if (!existing) throw new Error('Question not found.');
    ensureSameOrg(existing, activeOrgId, 'Exam question');
    if (!idsEqual(existing.revisionId, revision.id)) {
      throw new Error('Question does not belong to the selected revision.');
    }
    savedQuestion = await dependencies.repositories.examQuestions.update(existing.id, {
      ...questionInput,
      templateId: revision.templateId,
      revisionId: revision.id,
      sequenceNo: Number(questionInput.sequenceNo || existing.sequenceNo || 1),
      audit: { lastUpdateUser: actor }
    }, options);
  } else {
    savedQuestion = await dependencies.repositories.examQuestions.create({
      ...questionInput,
      orgId: activeOrgId,
      templateId: revision.templateId,
      revisionId: revision.id,
      sequenceNo: Number(questionInput.sequenceNo || (maxSequenceNo + 1)),
      status: questionInput.status || 'draft',
      audit: { createUser: actor, lastUpdateUser: actor }
    }, options);
  }

  const totals = await recalculateRevisionTotals(revision.id, options);
  const updatedRevision = await dependencies.repositories.examRevisions.update(revision.id, {
    totalQuestions: totals.totalQuestions,
    totalScore: totals.totalScore,
    audit: { lastUpdateUser: actor }
  }, options);

  return { question: savedQuestion, revision: updatedRevision };
}

async function deleteDraftQuestion(revisionId, questionId, requestingUser = null, options = {}) {
  const actor = resolveActor(requestingUser);
  const activeOrgId = resolveActiveOrgId(requestingUser);
  const revision = await getRevisionOrThrow(revisionId, options);
  ensureSameOrg(revision, activeOrgId, 'Exam revision');
  ensureDraftRevision(revision);

  const question = await dependencies.repositories.examQuestions.getById(questionId, options);
  if (!question) throw new Error('Question not found.');
  ensureSameOrg(question, activeOrgId, 'Exam question');
  if (!idsEqual(question.revisionId, revision.id)) throw new Error('Question does not belong to this revision.');

  await dependencies.repositories.examQuestions.remove(question.id, options);
  const totals = await recalculateRevisionTotals(revision.id, options);
  const updatedRevision = await dependencies.repositories.examRevisions.update(revision.id, {
    totalQuestions: totals.totalQuestions,
    totalScore: totals.totalScore,
    audit: { lastUpdateUser: actor }
  }, options);
  return { removed: true, revision: updatedRevision };
}

async function publishRevision(revisionId, payload = {}, requestingUser = null, options = {}) {
  const actor = resolveActor(requestingUser);
  const activeOrgId = resolveActiveOrgId(requestingUser, payload.orgId);
  const revision = await getRevisionOrThrow(revisionId, options);
  ensureSameOrg(revision, activeOrgId, 'Exam revision');
  ensureDraftRevision(revision);

  const template = await getTemplateOrThrow(revision.templateId, options);
  ensureSameOrg(template, activeOrgId, 'Exam template');

  const totals = await recalculateRevisionTotals(revision.id, options);
  if (totals.totalQuestions <= 0) {
    throw new Error('Cannot publish a revision without questions.');
  }
  if (totals.totalScore <= 0) {
    throw new Error('Cannot publish a revision with zero total score.');
  }

  const checksum = hashRevisionPayload(revision, totals.questions);
  const publishedRevision = await dependencies.repositories.examRevisions.update(revision.id, {
    status: 'published',
    isImmutable: true,
    publishedAt: new Date().toISOString(),
    publishedBy: actor,
    totalQuestions: totals.totalQuestions,
    totalScore: totals.totalScore,
    checksum,
    audit: { lastUpdateUser: actor }
  }, options);

  await dependencies.repositories.examTemplates.update(template.id, {
    status: 'active',
    publishedRevisionId: publishedRevision.id,
    latestRevisionNo: Math.max(Number(template.latestRevisionNo || 0), Number(publishedRevision.revisionNo || 0)),
    audit: { lastUpdateUser: actor }
  }, options);

  return publishedRevision;
}

async function createAllocationForPublishedRevision(input = {}, requestingUser = null, options = {}) {
  const actor = resolveActor(requestingUser);
  const activeOrgId = resolveActiveOrgId(requestingUser, input.orgId);
  const revision = await getRevisionOrThrow(input.revisionId, options);
  ensureSameOrg(revision, activeOrgId, 'Exam revision');
  if (normalizeStatus(revision.status) !== 'published') {
    throw new Error('Only published revisions can be allocated to classes.');
  }

  const template = await getTemplateOrThrow(revision.templateId, options);
  ensureSameOrg(template, activeOrgId, 'Exam template');
  const classRow = await dependencies.repositories.classes.getById(input.classId, options);
  if (!classRow) throw new Error('Class not found.');
  ensureSameOrg(classRow, activeOrgId, 'Class');
  const windowPolicy = String(
    input.windowPolicy
    || template?.settings?.defaultWindowPolicy
    || 'strict_fixed_window'
  ).trim().toLowerCase();
  const questionPresentationMode = String(
    input.questionPresentationMode
    || template?.settings?.defaultQuestionPresentationMode
    || 'all_questions_on_one_page'
  ).trim().toLowerCase();
  const countsInFinalScore = input.countsInFinalScore !== undefined && input.countsInFinalScore !== null
    ? input.countsInFinalScore === true
    : (template?.settings?.defaultCountsInFinalScore !== false);

  const allocation = await dependencies.repositories.examAllocations.create({
    orgId: activeOrgId,
    classId: classRow.id,
    templateId: template.id,
    revisionId: revision.id,
    revisionNo: revision.revisionNo,
    allocationName: input.allocationName || `${template.title} - ${revision.title}`,
    instructionsForStudents: input.instructionsForStudents || '',
    status: input.status || 'scheduled',
    scheduling: {
      timezone: input.timezone || template?.settings?.defaultTimezone || 'UTC',
      windowStartUtc: input.windowStartUtc,
      windowEndUtc: input.windowEndUtc,
      windowStartLocalDate: input.windowStartLocalDate,
      windowEndLocalDate: input.windowEndLocalDate,
      windowStartLocalTime: input.windowStartLocalTime,
      windowEndLocalTime: input.windowEndLocalTime
    },
    durationMinutes: Number(input.durationMinutes || revision.durationMinutes || template?.settings?.defaultDurationMinutes || 60),
    autoSubmitOnExpire: input.autoSubmitOnExpire !== false,
    allowLateStart: input.allowLateStart === true,
    maxAttemptsPerStudent: Number(input.maxAttemptsPerStudent || 1),
    shuffleQuestions: input.shuffleQuestions === true,
    windowPolicy,
    questionPresentationMode,
    countsInFinalScore,
    tags: input.tags,
    extensions: input.extensions,
    audit: { createUser: actor, lastUpdateUser: actor }
  }, options);

  return allocation;
}

async function createAssignmentsForAllocation(input = {}, requestingUser = null, options = {}) {
  const actor = resolveActor(requestingUser);
  const activeOrgId = resolveActiveOrgId(requestingUser, input.orgId);
  const allocation = await getAllocationOrThrow(input.allocationId, options);
  ensureSameOrg(allocation, activeOrgId, 'Exam allocation');

  const studentIds = Array.from(new Set((Array.isArray(input.studentIds) ? input.studentIds : [])
    .map((row) => toPublicId(row))
    .filter(Boolean)));
  if (!studentIds.length) throw new Error('At least one student is required to create assignments.');

  const existing = await dependencies.repositories.examAssignments.findByAllocationId(allocation.id, options);
  const existingByStudent = new Set((existing || []).map((row) => toPublicId(row?.studentId)).filter(Boolean));
  const created = [];
  const skippedStudentIds = [];

  for (const studentId of studentIds) {
    if (existingByStudent.has(studentId)) {
      skippedStudentIds.push(studentId);
      // eslint-disable-next-line no-continue
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const student = await dependencies.repositories.students.getById(studentId, options);
    if (!student || !idsEqual(student?.orgId, activeOrgId)) {
      skippedStudentIds.push(studentId);
      // eslint-disable-next-line no-continue
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const assignment = await dependencies.repositories.examAssignments.create({
      orgId: activeOrgId,
      allocationId: allocation.id,
      classId: allocation.classId,
      studentId,
      personId: student.personId || '',
      templateId: allocation.templateId,
      revisionId: allocation.revisionId,
      revisionNo: allocation.revisionNo,
      status: 'pending',
      assignedAtUtc: new Date().toISOString(),
      startWindowUtc: allocation.windowStartUtc,
      endWindowUtc: allocation.windowEndUtc,
      durationMinutes: allocation.durationMinutes,
      allowLateStart: allocation.allowLateStart === true,
      maxAttemptsAllowed: allocation.maxAttemptsPerStudent || 1,
      audit: { createUser: actor, lastUpdateUser: actor }
    }, options);
    created.push(assignment);
  }

  return { created, skippedStudentIds };
}

async function startAttempt(input = {}, requestingUser = null, options = {}) {
  const actor = resolveActor(requestingUser);
  const activeOrgId = resolveActiveOrgId(requestingUser, input.orgId);
  const assignment = await dependencies.repositories.examAssignments.getById(input.assignmentId, options);
  if (!assignment) throw new Error('Assignment not found.');
  ensureSameOrg(assignment, activeOrgId, 'Exam assignment');

  const nowIso = new Date().toISOString();
  if (assignment.startWindowUtc > nowIso) throw new Error('Exam window has not started yet.');
  if (assignment.endWindowUtc < nowIso && assignment.allowLateStart !== true) {
    throw new Error('Exam window is closed.');
  }

  const allocation = await dependencies.repositories.examAllocations.getById(assignment.allocationId, options);
  if (!allocation) throw new Error('Exam allocation not found for this assignment.');
  ensureSameOrg(allocation, activeOrgId, 'Exam allocation');
  if (normalizeStatus(allocation.status) !== 'open') {
    throw new Error('This exam is not open yet. Please contact your teacher.');
  }

  const attempts = await dependencies.repositories.examAttempts.findByAssignmentId(assignment.id, options);
  const limitFromAllocation = Number(allocation.maxAttemptsPerStudent);
  const limitFromAssignment = Number(assignment.maxAttemptsAllowed);
  const attemptLimit = Math.max(
    1,
    Math.min(20, Number.isFinite(limitFromAllocation) && limitFromAllocation > 0
      ? limitFromAllocation
      : (Number.isFinite(limitFromAssignment) && limitFromAssignment > 0 ? limitFromAssignment : 1))
  );
  if ((attempts || []).length >= attemptLimit) {
    throw new Error('Maximum attempt count reached for this assignment.');
  }

  const attemptNo = (attempts || []).length + 1;
  const startedAtUtc = nowIso;
  const expiresAtUtc = new Date(new Date(startedAtUtc).getTime() + Number(assignment.durationMinutes || 60) * 60000).toISOString();
  const attempt = await dependencies.repositories.examAttempts.create({
    orgId: activeOrgId,
    assignmentId: assignment.id,
    allocationId: assignment.allocationId,
    studentId: assignment.studentId,
    personId: assignment.personId || '',
    templateId: assignment.templateId,
    revisionId: assignment.revisionId,
    revisionNo: assignment.revisionNo,
    attemptNo,
    status: 'in_progress',
    startedAtUtc,
    expiresAtUtc,
    answerCount: 0,
    totalScoreComputed: 0,
    maxScoreComputed: 0,
    percentageComputed: 0,
    gradeState: 'ungraded',
    note: cleanString(input.note, { max: 1000, allowEmpty: true }),
    audit: { createUser: actor, lastUpdateUser: actor }
  }, options);

  await dependencies.repositories.examAssignments.update(assignment.id, {
    status: 'started',
    startedAttemptId: attempt.id,
    submittedAttemptId: '',
    audit: { lastUpdateUser: actor }
  }, options);

  return attempt;
}

async function saveAttemptAnswer(input = {}, requestingUser = null, options = {}) {
  const actor = resolveActor(requestingUser);
  const activeOrgId = resolveActiveOrgId(requestingUser, input.orgId);
  const attempt = await dependencies.repositories.examAttempts.getById(input.attemptId, options);
  if (!attempt) throw new Error('Attempt not found.');
  ensureSameOrg(attempt, activeOrgId, 'Exam attempt');
  const allocation = await dependencies.repositories.examAllocations.getById(attempt.allocationId, options);
  if (!allocation) throw new Error('Exam allocation not found for this attempt.');
  ensureSameOrg(allocation, activeOrgId, 'Exam allocation');
  if (normalizeStatus(allocation.status) !== 'open') {
    throw new Error('This exam is currently paused and cannot be edited.');
  }
  if (normalizeStatus(attempt.status) !== 'in_progress') {
    throw new Error('Answers can only be changed while attempt is in progress.');
  }

  const question = await dependencies.repositories.examQuestions.getById(input.questionId, options);
  if (!question) throw new Error('Question not found.');
  if (!idsEqual(question.revisionId, attempt.revisionId)) {
    throw new Error('Question does not belong to the attempt revision.');
  }

  const existing = await dependencies.repositories.examAnswers.list({
    query: {
      attemptId__eq: attempt.id,
      questionId__eq: question.id,
      page: 1,
      limit: 1
    },
    scope: { canViewAll: true }
  });
  const row = Array.isArray(existing) && existing.length ? existing[0] : null;

  const payload = {
    orgId: activeOrgId,
    attemptId: attempt.id,
    assignmentId: attempt.assignmentId,
    questionId: question.id,
    revisionId: attempt.revisionId,
    studentId: attempt.studentId,
    answerType: question.questionType,
    status: 'saved',
    objectiveResponse: input.objectiveResponse,
    selectedOptionIds: input.selectedOptionIds,
    subjectiveResponse: input.subjectiveResponse,
    text: input.text,
    attachments: input.attachments,
    updatedFromClientAtUtc: input.updatedFromClientAtUtc,
    answeredAtUtc: new Date().toISOString(),
    feedback: row?.feedback || '',
    manualScore: row?.manualScore,
    autoScore: row?.autoScore,
    finalScore: row?.finalScore,
    audit: row ? { lastUpdateUser: actor } : { createUser: actor, lastUpdateUser: actor }
  };

  const saved = row
    ? await dependencies.repositories.examAnswers.update(row.id, payload, options)
    : await dependencies.repositories.examAnswers.create(payload, options);

  const allAnswers = await dependencies.repositories.examAnswers.findByAttemptId(attempt.id, options);
  await dependencies.repositories.examAttempts.update(attempt.id, {
    answerCount: (allAnswers || []).length,
    audit: { lastUpdateUser: actor }
  }, options);

  return saved;
}

function scoreObjectiveAnswer(question, answer) {
  const maxScore = Number(question?.scoring?.maxScore || 0);
  if (maxScore <= 0) return 0;
  const selected = new Set((answer?.objectiveResponse?.selectedOptionIds || []).map((id) => String(id)));
  const correct = new Set((Array.isArray(question?.objectiveOptions) ? question.objectiveOptions : [])
    .filter((row) => row?.isCorrect === true)
    .map((row) => String(row?.id || ''))
    .filter(Boolean));
  if (!correct.size) return 0;

  const questionMode = String(question?.objectiveMode || 'single_choice').trim().toLowerCase();
  if (questionMode === 'multiple_choice' && question?.scoring?.partialAllowed === true) {
    let matched = 0;
    selected.forEach((id) => {
      if (correct.has(id)) matched += 1;
    });
    const ratio = matched / correct.size;
    return Number((Math.max(0, Math.min(1, ratio)) * maxScore).toFixed(2));
  }

  const sameSize = selected.size === correct.size;
  const allMatch = sameSize && Array.from(selected).every((id) => correct.has(id));
  return allMatch ? Number(maxScore.toFixed(2)) : 0;
}

async function submitAttempt(attemptId, input = {}, requestingUser = null, options = {}) {
  const actor = resolveActor(requestingUser);
  const activeOrgId = resolveActiveOrgId(requestingUser, input.orgId);
  const attempt = await dependencies.repositories.examAttempts.getById(attemptId, options);
  if (!attempt) throw new Error('Attempt not found.');
  ensureSameOrg(attempt, activeOrgId, 'Exam attempt');
  const allocation = await dependencies.repositories.examAllocations.getById(attempt.allocationId, options);
  if (!allocation) throw new Error('Exam allocation not found for this attempt.');
  ensureSameOrg(allocation, activeOrgId, 'Exam allocation');
  if (normalizeStatus(allocation.status) !== 'open') {
    throw new Error('This exam is currently paused and cannot be submitted right now.');
  }
  if (!['in_progress', 'submitted', 'auto_submitted'].includes(normalizeStatus(attempt.status))) {
    throw new Error('Attempt cannot be submitted from current status.');
  }

  const questions = await dependencies.repositories.examQuestions.findByRevisionId(attempt.revisionId, options);
  const activeQuestions = (questions || []).filter((q) => ACTIVE_QUESTION_STATUSES.has(normalizeStatus(q?.status, 'draft')));
  const answers = await dependencies.repositories.examAnswers.findByAttemptId(attempt.id, options);
  const answerMap = new Map((answers || []).map((row) => [toPublicId(row?.questionId), row]));

  let totalScore = 0;
  let maxScore = 0;

  for (const question of activeQuestions) {
    const questionMaxScore = Number(question?.scoring?.maxScore || 0);
    maxScore += Number.isFinite(questionMaxScore) ? questionMaxScore : 0;
    const answer = answerMap.get(toPublicId(question?.id));
    if (!answer) continue;

    if (question.questionType === 'objective') {
      const autoScore = scoreObjectiveAnswer(question, answer);
      // eslint-disable-next-line no-await-in-loop
      await dependencies.repositories.examAnswers.update(answer.id, {
        autoScore,
        finalScore: answer.manualScore !== null && answer.manualScore !== undefined ? answer.manualScore : autoScore,
        isCorrect: autoScore >= Number(question?.scoring?.maxScore || 0),
        status: 'submitted',
        audit: { lastUpdateUser: actor }
      }, options);
      totalScore += Number(answer.manualScore !== null && answer.manualScore !== undefined ? answer.manualScore : autoScore);
    } else {
      const subjectiveScore = Number(answer.manualScore !== null && answer.manualScore !== undefined ? answer.manualScore : 0);
      totalScore += subjectiveScore;
      // eslint-disable-next-line no-await-in-loop
      await dependencies.repositories.examAnswers.update(answer.id, {
        finalScore: subjectiveScore,
        status: 'submitted',
        audit: { lastUpdateUser: actor }
      }, options);
    }
  }

  const normalizedMax = Number(maxScore.toFixed(2));
  const normalizedScore = Number(totalScore.toFixed(2));
  const percentage = normalizedMax > 0 ? Math.round((normalizedScore / normalizedMax) * 100) : 0;
  const nowIso = new Date().toISOString();
  const nextStatus = input.autoSubmit === true ? 'auto_submitted' : 'submitted';

  const updatedAttempt = await dependencies.repositories.examAttempts.update(attempt.id, {
    status: nextStatus,
    submittedAtUtc: input.autoSubmit === true ? attempt.submittedAtUtc : nowIso,
    autoSubmittedAtUtc: input.autoSubmit === true ? nowIso : attempt.autoSubmittedAtUtc,
    isAutoSubmitted: input.autoSubmit === true,
    totalScoreComputed: normalizedScore,
    maxScoreComputed: normalizedMax,
    percentageComputed: percentage,
    gradeState: 'pending',
    durationSecondsUsed: Math.max(0, Math.floor((new Date(nowIso).getTime() - new Date(attempt.startedAtUtc).getTime()) / 1000)),
    audit: { lastUpdateUser: actor }
  }, options);

  await dependencies.repositories.examAssignments.update(updatedAttempt.assignmentId, {
    status: nextStatus,
    submittedAttemptId: updatedAttempt.id,
    scoreComputed: normalizedScore,
    maxScoreComputed: normalizedMax,
    percentageComputed: percentage,
    audit: { lastUpdateUser: actor }
  }, options);

  return updatedAttempt;
}

async function gradeAttemptAnswer(answerId, gradingInput = {}, requestingUser = null, options = {}) {
  const actor = resolveActor(requestingUser);
  const activeOrgId = resolveActiveOrgId(requestingUser, gradingInput.orgId);
  const answer = await dependencies.repositories.examAnswers.getById(answerId, options);
  if (!answer) throw new Error('Answer not found.');
  ensureSameOrg(answer, activeOrgId, 'Exam answer');

  const attempt = await dependencies.repositories.examAttempts.getById(answer.attemptId, options);
  if (!attempt) throw new Error('Attempt not found for answer.');
  ensureSameOrg(attempt, activeOrgId, 'Exam attempt');

  const manualScore = Number(gradingInput.manualScore);
  if (!Number.isFinite(manualScore) || manualScore < 0) {
    throw new Error('manualScore is required and must be >= 0.');
  }

  const updatedAnswer = await dependencies.repositories.examAnswers.update(answer.id, {
    manualScore,
    finalScore: Number(manualScore.toFixed(2)),
    feedback: gradingInput.feedback,
    gradedBy: actor,
    gradedAtUtc: new Date().toISOString(),
    status: 'graded',
    isCorrect: gradingInput.isCorrect,
    audit: { lastUpdateUser: actor }
  }, options);

  const answers = await dependencies.repositories.examAnswers.findByAttemptId(attempt.id, options);
  const questions = await dependencies.repositories.examQuestions.findByRevisionId(attempt.revisionId, options);
  const activeQuestions = (questions || []).filter((q) => ACTIVE_QUESTION_STATUSES.has(normalizeStatus(q?.status, 'draft')));
  const maxScore = activeQuestions.reduce((sum, q) => sum + Number(q?.scoring?.maxScore || 0), 0);
  const totalScore = (answers || []).reduce((sum, row) => sum + Number(row?.finalScore || 0), 0);
  const normalizedMax = Number(maxScore.toFixed(2));
  const normalizedScore = Number(totalScore.toFixed(2));
  const percentage = normalizedMax > 0 ? Math.round((normalizedScore / normalizedMax) * 100) : 0;

  const updatedAttempt = await dependencies.repositories.examAttempts.update(attempt.id, {
    status: 'graded',
    gradeState: 'graded',
    gradedBy: actor,
    gradedAtUtc: new Date().toISOString(),
    totalScoreComputed: normalizedScore,
    maxScoreComputed: normalizedMax,
    percentageComputed: percentage,
    audit: { lastUpdateUser: actor }
  }, options);

  await dependencies.repositories.examAssignments.update(attempt.assignmentId, {
    status: 'graded',
    scoreComputed: normalizedScore,
    maxScoreComputed: normalizedMax,
    percentageComputed: percentage,
    audit: { lastUpdateUser: actor }
  }, options);

  return { answer: updatedAnswer, attempt: updatedAttempt };
}

function cleanString(value, options = {}) {
  if (value === undefined || value === null) return options.allowEmpty === false ? '' : '';
  const max = Number(options.max || 5000);
  const text = String(value).trim();
  return text.length > max ? text.slice(0, max) : text;
}

const examBuilderService = {
  createTemplate,
  cloneTemplateAsRevision,
  createDraftRevision,
  updateDraftRevision,
  saveDraftQuestion,
  deleteDraftQuestion,
  publishRevision,
  createAllocationForPublishedRevision,
  createAssignmentsForAllocation,
  startAttempt,
  saveAttemptAnswer,
  submitAttempt,
  gradeAttemptAnswer,

  async getRevisionBundle(revisionId, requestingUser = null, options = {}) {
    const activeOrgId = resolveActiveOrgId(requestingUser);
    const revision = await getRevisionOrThrow(revisionId, options);
    ensureSameOrg(revision, activeOrgId, 'Exam revision');
    const questions = await dependencies.repositories.examQuestions.findByRevisionId(revision.id, options);
    return {
      revision,
      questions: (questions || []).sort((a, b) => Number(a.sequenceNo || 0) - Number(b.sequenceNo || 0))
    };
  },

  __setDependencies(overrides = {}) {
    if (overrides && typeof overrides === 'object') {
      dependencies = {
        ...dependencies,
        ...overrides
      };
    }
  },

  __resetDependencies() {
    dependencies = { ...defaultDependencies };
  }
};

module.exports = examBuilderService;
