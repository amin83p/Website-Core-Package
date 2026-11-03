'use strict';

const schoolRepositories = require('../../repositories/school');
function getReviewService() {
  return require('./sessionStudentCaseReviewService');
}
const sessionStudentCaseAccessService = require('./sessionStudentCaseAccessService');
const sessionStudentCaseRoutingService = require('./sessionStudentCaseRoutingService');
const sessionStudentCaseResultVisibilityService = require('./sessionStudentCaseResultVisibilityService');
const personDisplayNameService = require('./personDisplayNameService');
const schoolFileService = require('./schoolFileService');
function getCollaborationService() {
  return require('./sessionStudentCaseCollaborationService');
}
const {
  sanitizeWorkActions,
  generateWorkActionId,
  WORK_ACTION_BODY_MAX,
  WORK_ACTION_SUMMARY_MAX
} = require('../../models/school/sessionStudentCaseModel');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const WORK_ACTION_FILE_MAX_BYTES = 2 * 1024 * 1024;

const SYSTEM_ACTION_LABELS = Object.freeze({
  case_created: 'Case created',
  case_updated: 'Case updated',
  case_resolved: 'Case resolved',
  case_reopened: 'Case reopened',
  case_status_changed: 'Status changed',
  assigned: 'Primary assignee set',
  unassigned: 'Primary assignee removed',
  shared_with: 'Collaborator added',
  collaborator_removed: 'Collaborator removed',
  collaboration_reminder: 'Collaboration reminder sent',
  new_case: 'Routing notification sent'
});

function cleanString(value = '', max = 5000) {
  const out = String(value ?? '').replace(/\0/g, '').trim();
  return out.length > max ? out.slice(0, max) : out;
}

function getActiveOrgId(user) {
  return toPublicId(user?.activeOrgId || user?.activeOrganization?.id || user?.primaryOrgId || '');
}

function getActorUserId(user) {
  return toPublicId(user?.id || user?._id || user?.userId || user?.username || '');
}

function getActorPersonId(user) {
  return toPublicId(user?.personId || user?.person?.id || user?.profile?.personId || '');
}

async function resolveActorName(user) {
  const personId = getActorPersonId(user);
  if (personId) {
    const name = await personDisplayNameService.resolvePersonDisplayName(personId, { fallback: '' });
    if (name) return name;
  }
  return cleanString(user?.preferredName || user?.displayName || user?.fullName || user?.name || user?.username || getActorUserId(user), 180);
}

function deriveWorkActionSummary(body = '') {
  const text = cleanString(body, WORK_ACTION_BODY_MAX);
  if (!text) return '';
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length > WORK_ACTION_SUMMARY_MAX
    ? `${singleLine.slice(0, WORK_ACTION_SUMMARY_MAX - 1)}…`
    : singleLine;
}

function formatSystemLifecycleSummary(event = {}) {
  const action = cleanString(event.action, 80);
  const label = SYSTEM_ACTION_LABELS[action] || action.replace(/_/g, ' ') || 'System update';
  const oldStatus = cleanString(event.oldStatus, 40);
  const newStatus = cleanString(event.newStatus, 40);
  if (oldStatus && newStatus && oldStatus !== newStatus) {
    return `${label}: ${oldStatus} → ${newStatus}`;
  }
  const note = cleanString(event.note, 200);
  if (note) return `${label} — ${note.length > 120 ? `${note.slice(0, 117)}…` : note}`;
  return label;
}

function buildSystemTimelineBody(event = {}) {
  const parts = [];
  const label = SYSTEM_ACTION_LABELS[cleanString(event.action, 80)] || cleanString(event.action, 80);
  if (label) parts.push(label);
  const oldStatus = cleanString(event.oldStatus, 40);
  const newStatus = cleanString(event.newStatus, 40);
  if (oldStatus && newStatus && oldStatus !== newStatus) {
    parts.push(`Status changed from ${oldStatus} to ${newStatus}.`);
  }
  const note = cleanString(event.note, 1000);
  if (note) parts.push(note);
  return parts.join('\n\n').trim();
}

function normalizeBoolean(value) {
  if (value === true || value === false) return value;
  const token = String(value ?? '').trim().toLowerCase();
  return ['true', '1', 'yes', 'on'].includes(token);
}

function canViewPrivateWorkActions(capabilities = {}) {
  return sessionStudentCaseResultVisibilityService.canManageResultFields(capabilities);
}

function canViewWorkActionRow(action = {}, { reqUser = null, capabilities = {} } = {}) {
  if (!action || action.private !== true) return true;
  if (canViewPrivateWorkActions(capabilities)) return true;
  const viewerId = getActorUserId(reqUser);
  const authorId = toPublicId(action.actorUserId || '');
  return Boolean(viewerId && authorId && idsEqual(viewerId, authorId));
}

function filterWorkActionsForViewer(workActions = [], context = {}) {
  return (Array.isArray(workActions) ? workActions : []).filter((row) => canViewWorkActionRow(row, context));
}

function buildMixedTimeline(caseRow = {}, { canEditWorkAction = false, canDeleteWorkAction = false } = {}) {
  const entries = [];
  (Array.isArray(caseRow.workActions) ? caseRow.workActions : []).forEach((row) => {
    if (!row || typeof row !== 'object') return;
    const id = cleanString(row.id, 120) || `work-${entries.length}`;
    const isPrivate = row.private === true;
    entries.push({
      kind: 'work',
      id,
      at: cleanString(row.at, 40) || '',
      actorName: cleanString(row.actorName, 180) || 'Staff',
      title: isPrivate ? 'Private work log' : 'Work log',
      summary: cleanString(row.summary, WORK_ACTION_SUMMARY_MAX) || deriveWorkActionSummary(row.body),
      body: cleanString(row.body, WORK_ACTION_BODY_MAX),
      attachment: row.attachment && typeof row.attachment === 'object' ? row.attachment : null,
      private: isPrivate,
      involvedPersonIds: Array.isArray(row.involvedPersonIds) ? row.involvedPersonIds : [],
      notifiedAt: cleanString(row.notifiedAt, 40) || '',
      updatedAt: cleanString(row.updatedAt, 40) || '',
      canEdit: canEditWorkAction,
      canDelete: canDeleteWorkAction,
      readOnly: false
    });
  });
  (Array.isArray(caseRow.lifecycle) ? caseRow.lifecycle : []).forEach((event, index) => {
    if (!event || typeof event !== 'object') return;
    const action = cleanString(event.action, 80);
    if (!action && !event.oldStatus && !event.newStatus) return;
    entries.push({
      kind: 'system',
      id: `lifecycle-${index}-${action || 'event'}`,
      at: cleanString(event.at, 40) || '',
      actorName: cleanString(event.actorName, 180) || 'System',
      title: 'System',
      summary: formatSystemLifecycleSummary(event),
      body: buildSystemTimelineBody(event),
      systemAction: action,
      attachment: null,
      readOnly: true
    });
  });
  return entries.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
}

function canEditWorkAction(caseRow = {}, capabilities = {}) {
  return sessionStudentCaseResultVisibilityService.canEditCase(caseRow, capabilities);
}

function canDeleteWorkAction(caseRow = {}, capabilities = {}) {
  return sessionStudentCaseResultVisibilityService.canDeleteCase(caseRow, capabilities);
}

async function loadWorkActionMutationContext(req, caseId) {
  const reviewService = getReviewService();
  const existing = await reviewService.loadCaseForRequest(req, caseId);
  const { classData, session } = await reviewService.loadClassSessionContext(
    req,
    existing.classId,
    existing.sessionId
  );
  await sessionStudentCaseAccessService.assertCanViewCases(req, classData, session, existing);
  const capabilities = await sessionStudentCaseAccessService.resolveCaseCapabilities(req, {
    classData,
    session,
    caseRow: existing
  });
  const enrichedCapabilities = sessionStudentCaseResultVisibilityService.enrichCapabilities(
    existing,
    req.user,
    capabilities
  );
  return { existing, classData, session, enrichedCapabilities };
}

function prepareWorkActionViewerPayload(updated, req, enrichedCapabilities, timelineOptions = {}) {
  const redacted = sessionStudentCaseResultVisibilityService.redactCaseForViewer(updated, {
    reqUser: req.user,
    capabilities: enrichedCapabilities
  });
  redacted.workActions = filterWorkActionsForViewer(redacted.workActions, {
    reqUser: req.user,
    capabilities: enrichedCapabilities
  });
  const canEdit = canEditWorkAction(updated, enrichedCapabilities);
  const canDelete = canDeleteWorkAction(updated, enrichedCapabilities);
  return {
    case: redacted,
    timeline: buildMixedTimeline(redacted, {
      canEditWorkAction: canEdit,
      canDeleteWorkAction: canDelete,
      ...timelineOptions
    })
  };
}

function findWorkActionRow(caseRow, actionId) {
  const key = cleanString(actionId, 120);
  if (!key) return null;
  return (Array.isArray(caseRow.workActions) ? caseRow.workActions : [])
    .find((row) => cleanString(row?.id, 120) === key) || null;
}

async function appendWorkActionLifecycle(req, existing, action, note = '') {
  const event = {
    at: new Date().toISOString(),
    action,
    actorUserId: getActorUserId(req.user),
    actorPersonId: getActorPersonId(req.user),
    actorName: await resolveActorName(req.user),
    note: cleanString(note, 1000)
  };
  return [...(Array.isArray(existing.lifecycle) ? existing.lifecycle : []), event];
}

async function buildWorkActionNotifyCandidates(req, caseRow = {}) {
  const actorPersonId = getActorPersonId(req.user);
  const actorUserId = getActorUserId(req.user);
  const seen = new Set();
  const candidates = [];

  async function tryAdd({ personId, personName = '', roleHint = '' }) {
    const pid = toPublicId(personId);
    if (!pid || seen.has(pid)) return;
    if (actorPersonId && idsEqual(pid, actorPersonId)) return;
    const userId = await getCollaborationService().resolveUserIdForPerson(req.user, pid);
    if (!userId) return;
    if (actorUserId && idsEqual(userId, actorUserId)) return;
    seen.add(pid);
    const name = personName
      || await personDisplayNameService.resolvePersonDisplayName(pid, { fallback: pid });
    candidates.push({
      personId: pid,
      personName: name,
      userId,
      roleHint
    });
  }

  const assignedTo = caseRow?.assignedTo;
  if (assignedTo?.personId) {
    await tryAdd({
      personId: assignedTo.personId,
      personName: assignedTo.personName,
      roleHint: 'Primary assignee'
    });
  }

  for (const row of (Array.isArray(caseRow.collaborators) ? caseRow.collaborators : [])) {
    await tryAdd({
      personId: row?.personId,
      personName: row?.personName,
      roleHint: 'Collaborator'
    });
  }

  const routingReviewers = await getCollaborationService().listRoutingReviewersForCase(req, caseRow);
  for (const row of routingReviewers) {
    await tryAdd({
      personId: row?.personId,
      personName: row?.personName,
      roleHint: 'Category routing'
    });
  }

  const creatorUserId = toPublicId(caseRow?.audit?.createdBy || caseRow?.createdBy || '');
  if (creatorUserId) {
    const creator = await getCollaborationService().resolvePersonIdForUserId(req.user, creatorUserId);
    if (creator?.personId) {
      await tryAdd({
        personId: creator.personId,
        personName: creator.personName,
        roleHint: 'Case creator'
      });
    }
  }

  return candidates;
}

async function assertCanEditWorkAction(req, classData, session, caseRow, enrichedCapabilities) {
  await sessionStudentCaseAccessService.assertCanUpdate(req, classData, session, caseRow);
  if (!canEditWorkAction(caseRow, enrichedCapabilities)) {
    throw sessionStudentCaseAccessService.createDeniedError('You do not have permission to edit work log entries for this case.');
  }
  sessionStudentCaseResultVisibilityService.assertCaseMutationAllowed(caseRow, enrichedCapabilities, { action: 'edit' });
}

async function assertCanDeleteWorkAction(req, classData, session, caseRow, enrichedCapabilities) {
  await sessionStudentCaseAccessService.assertCanDelete(req, classData, session, caseRow);
  if (!canDeleteWorkAction(caseRow, enrichedCapabilities)) {
    throw sessionStudentCaseAccessService.createDeniedError('You do not have permission to delete work log entries for this case.');
  }
  sessionStudentCaseResultVisibilityService.assertCaseMutationAllowed(caseRow, enrichedCapabilities, { action: 'delete' });
}

async function persistWorkActionsPatch(req, existing, workActions, lifecycleAction = '', lifecycleNote = '') {
  const orgId = getActiveOrgId(req.user);
  const lifecycle = lifecycleAction
    ? await appendWorkActionLifecycle(req, existing, lifecycleAction, lifecycleNote)
    : (Array.isArray(existing.lifecycle) ? existing.lifecycle : []);
  const updated = await schoolRepositories.sessionStudentCases.update(existing.id, {
    workActions: sanitizeWorkActions(workActions),
    lifecycle,
    revisionNo: (Number(existing.revisionNo) || 1) + 1,
    audit: {
      ...(existing.audit || {}),
      lastUpdateDateTime: new Date().toISOString(),
      updatedBy: getActorUserId(req.user)
    }
  }, {
    scope: { activeOrgId: orgId }
  });
  if (!updated) throw new Error('Failed to update work log entries.');
  return updated;
}

async function canContributeWorkAction(req, caseRow = null, capabilities = null) {
  if (!caseRow) return false;
  const caps = capabilities || await sessionStudentCaseAccessService.resolveCaseCapabilities(req, {
    classData: null,
    session: null,
    caseRow
  });
  if (!(caps.canReadAll || caps.canRead)) return false;
  if (caps.canUpdate || caps.canResolve) return true;
  if (caps.canAssignOrShare) return true;
  if (sessionStudentCaseRoutingService.isRoutingAdminViewer(req.user)) return true;
  const personId = sessionStudentCaseRoutingService.getViewerPersonId(req.user);
  if (sessionStudentCaseAccessService.isCaseAssignee(caseRow, personId)) return true;
  if (sessionStudentCaseAccessService.isCaseCollaborator(caseRow, personId)) return true;
  if (await sessionStudentCaseAccessService.isCaseHandler(req, caseRow)) return true;
  return false;
}

async function assertCanContributeWorkAction(req, caseRow = null, capabilities = null) {
  const allowed = await canContributeWorkAction(req, caseRow, capabilities);
  if (allowed) return;
  throw sessionStudentCaseAccessService.createDeniedError('You do not have permission to add a work log entry for this case.');
}

function assertWorkActionFileSize(file) {
  if (!file) return;
  const size = Number(file.size || 0);
  if (size > WORK_ACTION_FILE_MAX_BYTES) {
    throw new Error('Attachment must be 2 MB or smaller.');
  }
}

async function addWorkAction(req, caseId, { body = '', file = null, isPrivate = false } = {}) {
  const reviewService = getReviewService();
  const existing = await reviewService.loadCaseForRequest(req, caseId);
  const { classData, session } = await reviewService.loadClassSessionContext(
    req,
    existing.classId,
    existing.sessionId
  );
  await sessionStudentCaseAccessService.assertCanViewCases(req, classData, session, existing);
  const capabilities = await sessionStudentCaseAccessService.resolveCaseCapabilities(req, {
    classData,
    session,
    caseRow: existing
  });
  const enrichedCapabilities = sessionStudentCaseResultVisibilityService.enrichCapabilities(
    existing,
    req.user,
    capabilities
  );
  await assertCanContributeWorkAction(req, existing, enrichedCapabilities);

  const text = cleanString(body, WORK_ACTION_BODY_MAX);
  if (!text) throw new Error('Describe what you did before saving this action.');

  assertWorkActionFileSize(file);

  let attachment = null;
  if (file) {
    attachment = schoolFileService.normalizeUploadedFile(file, {
      kind: 'session_student_case_action',
      uploadedBy: getActorUserId(req.user),
      classId: existing.classId,
      sessionId: existing.sessionId,
      subjectId: existing.id
    });
  }

  const actorName = await resolveActorName(req.user);
  const workRow = {
    id: generateWorkActionId(new Set((existing.workActions || []).map((row) => String(row?.id || '')))),
    at: new Date().toISOString(),
    actorUserId: getActorUserId(req.user),
    actorPersonId: getActorPersonId(req.user),
    actorName,
    summary: deriveWorkActionSummary(text),
    body: text,
    private: normalizeBoolean(isPrivate),
    attachment
  };

  const mergedActions = sanitizeWorkActions([...(Array.isArray(existing.workActions) ? existing.workActions : []), workRow]);
  const orgId = getActiveOrgId(req.user);
  const updated = await schoolRepositories.sessionStudentCases.update(existing.id, {
    workActions: mergedActions,
    revisionNo: (Number(existing.revisionNo) || 1) + 1,
    audit: {
      ...(existing.audit || {}),
      lastUpdateDateTime: new Date().toISOString(),
      updatedBy: getActorUserId(req.user)
    }
  }, {
    scope: { activeOrgId: orgId }
  });

  if (!updated) throw new Error('Failed to save work log entry.');

  const notifyCandidates = await buildWorkActionNotifyCandidates(req, updated);
  const payload = prepareWorkActionViewerPayload(updated, req, enrichedCapabilities);

  return {
    ...payload,
    actionId: workRow.id,
    notifyCandidates
  };
}

async function notifyWorkActionInvolved(req, caseId, actionId, { personIds = [] } = {}) {
  const { existing, classData, session, enrichedCapabilities } = await loadWorkActionMutationContext(req, caseId);
  await assertCanContributeWorkAction(req, existing, enrichedCapabilities);

  const actionRow = findWorkActionRow(existing, actionId);
  if (!actionRow) {
    const error = new Error('Work log entry not found.');
    error.statusCode = 404;
    throw error;
  }
  if (!canViewWorkActionRow(actionRow, { reqUser: req.user, capabilities: enrichedCapabilities })) {
    throw sessionStudentCaseAccessService.createDeniedError('You do not have permission to notify for this work log entry.');
  }

  const candidates = await buildWorkActionNotifyCandidates(req, existing);
  const allowedIds = new Set(candidates.map((row) => row.personId));
  const selected = [];
  (Array.isArray(personIds) ? personIds : []).forEach((value) => {
    const pid = toPublicId(value);
    if (pid && allowedIds.has(pid) && !selected.includes(pid)) selected.push(pid);
  });

  const candidateByPerson = new Map(candidates.map((row) => [row.personId, row]));
  const excerpt = actionRow.private === true
    ? ''
    : cleanString(actionRow.summary || deriveWorkActionSummary(actionRow.body), 260);

  let notified = 0;
  let skipped = 0;
  for (const personId of selected) {
    const candidate = candidateByPerson.get(personId);
    if (!candidate?.userId) {
      skipped += 1;
      continue;
    }
    try {
      await getCollaborationService().sendCaseCollaborationChatMessage({
        fromUser: req.user,
        toUserId: candidate.userId,
        caseRow: existing,
        action: 'work_log',
        note: excerpt
      });
      notified += 1;
    } catch (error) {
      skipped += 1;
    }
  }

  const mergedActions = (Array.isArray(existing.workActions) ? existing.workActions : []).map((row) => {
    if (cleanString(row?.id, 120) !== cleanString(actionId, 120)) return row;
    return {
      ...row,
      involvedPersonIds: selected,
      notifiedAt: new Date().toISOString()
    };
  });

  const updated = await persistWorkActionsPatch(req, existing, mergedActions);
  const payload = prepareWorkActionViewerPayload(updated, req, enrichedCapabilities);
  return { notified, skipped, ...payload };
}

async function updateWorkAction(req, caseId, actionId, {
  body = '',
  isPrivate = false,
  file = null,
  removeAttachment = false
} = {}) {
  const { existing, classData, session, enrichedCapabilities } = await loadWorkActionMutationContext(req, caseId);
  await assertCanEditWorkAction(req, classData, session, existing, enrichedCapabilities);

  const actionKey = cleanString(actionId, 120);
  const prior = findWorkActionRow(existing, actionKey);
  if (!prior) {
    const error = new Error('Work log entry not found.');
    error.statusCode = 404;
    throw error;
  }
  if (!canViewWorkActionRow(prior, { reqUser: req.user, capabilities: enrichedCapabilities })) {
    throw sessionStudentCaseAccessService.createDeniedError('You do not have permission to edit this work log entry.');
  }

  const text = cleanString(body, WORK_ACTION_BODY_MAX);
  if (!text) throw new Error('Describe what you did before saving this action.');
  assertWorkActionFileSize(file);

  let attachment = prior.attachment || null;
  if (removeAttachment) attachment = null;
  if (file) {
    attachment = schoolFileService.normalizeUploadedFile(file, {
      kind: 'session_student_case_action',
      uploadedBy: getActorUserId(req.user),
      classId: existing.classId,
      sessionId: existing.sessionId,
      subjectId: existing.id
    });
  }

  const mergedActions = (Array.isArray(existing.workActions) ? existing.workActions : []).map((row) => {
    if (cleanString(row?.id, 120) !== actionKey) return row;
    return {
      ...row,
      summary: deriveWorkActionSummary(text),
      body: text,
      private: normalizeBoolean(isPrivate),
      attachment,
      updatedAt: new Date().toISOString(),
      updatedByUserId: getActorUserId(req.user)
    };
  });

  const updated = await persistWorkActionsPatch(
    req,
    existing,
    mergedActions,
    'work_action_updated',
    deriveWorkActionSummary(text)
  );
  const payload = prepareWorkActionViewerPayload(updated, req, enrichedCapabilities);
  return { actionId: actionKey, ...payload };
}

async function deleteWorkAction(req, caseId, actionId) {
  const { existing, classData, session, enrichedCapabilities } = await loadWorkActionMutationContext(req, caseId);
  await assertCanDeleteWorkAction(req, classData, session, existing, enrichedCapabilities);

  const actionKey = cleanString(actionId, 120);
  const prior = findWorkActionRow(existing, actionKey);
  if (!prior) {
    const error = new Error('Work log entry not found.');
    error.statusCode = 404;
    throw error;
  }
  if (!canViewWorkActionRow(prior, { reqUser: req.user, capabilities: enrichedCapabilities })) {
    throw sessionStudentCaseAccessService.createDeniedError('You do not have permission to delete this work log entry.');
  }

  const mergedActions = (Array.isArray(existing.workActions) ? existing.workActions : [])
    .filter((row) => cleanString(row?.id, 120) !== actionKey);

  const updated = await persistWorkActionsPatch(
    req,
    existing,
    mergedActions,
    'work_action_deleted',
    cleanString(prior.summary, 160)
  );
  return prepareWorkActionViewerPayload(updated, req, enrichedCapabilities);
}

module.exports = {
  WORK_ACTION_FILE_MAX_BYTES,
  WORK_ACTION_BODY_MAX,
  buildMixedTimeline,
  filterWorkActionsForViewer,
  canViewWorkActionRow,
  deriveWorkActionSummary,
  canContributeWorkAction,
  assertCanContributeWorkAction,
  assertWorkActionFileSize,
  addWorkAction,
  buildWorkActionNotifyCandidates,
  notifyWorkActionInvolved,
  updateWorkAction,
  deleteWorkAction,
  canEditWorkAction,
  canDeleteWorkAction
};
