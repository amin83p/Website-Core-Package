'use strict';

const schoolRepositories = require('../../repositories/school');
const sessionStudentCaseReviewService = require('./sessionStudentCaseReviewService');
const sessionStudentCaseAccessService = require('./sessionStudentCaseAccessService');
const sessionStudentCaseRoutingService = require('./sessionStudentCaseRoutingService');
const schoolIdentityLookupService = require('./schoolIdentityLookupService');
const personDisplayNameService = require('./personDisplayNameService');
const { normalizeCategory, CASE_CATEGORY_LABELS } = require('./sessionStudentCasePresetService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const chatRepository = requireCoreModule('MVC/repositories/chatRepository');
const socketService = requireCoreModule('MVC/services/socketService');

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

function buildLifecycleEvent({ action, reqUser, note = '' }) {
  return {
    at: new Date().toISOString(),
    action,
    actorUserId: getActorUserId(reqUser),
    actorPersonId: getActorPersonId(reqUser),
    actorName: '',
    oldStatus: '',
    newStatus: '',
    note: cleanString(note, 1000)
  };
}

async function enrichActor(event, reqUser) {
  return { ...event, actorName: await resolveActorName(reqUser) };
}

function buildCaseOpenHref(caseRow = {}) {
  const caseId = toPublicId(caseRow?.id);
  if (!caseId) return '/school/session-student-cases';
  return `/school/session-student-cases?studentCaseId=${encodeURIComponent(caseId)}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendCaseCollaborationChatMessage({
  fromUser,
  toUserId,
  caseRow,
  action,
  note = ''
}) {
  const authorIdStr = String(getActorUserId(fromUser) || '');
  const targetIdStr = String(toPublicId(toUserId) || '');
  if (!authorIdStr || !targetIdStr) return;

  const actionLabels = {
    assign: 'assigned you as the primary handler for',
    share: 'shared a student case with you:',
    reminder: 'sent you a reminder about',
    new_case: 'registered a new student case that needs your review:'
  };
  const actionLabel = actionLabels[action] || actionLabels.reminder;
  const summary = escapeHtml(cleanString(caseRow?.summary || 'Student session case', 260));
  const classTitle = escapeHtml(cleanString(caseRow?.classTitle || caseRow?.classId || 'Class', 220));
  const studentLabel = cleanString(caseRow?.studentName || caseRow?.studentPersonId || '', 180);
  const studentLine = studentLabel
    ? `Student: <strong>${escapeHtml(studentLabel)}</strong><br>`
    : 'Scope: <strong>Session-wide</strong><br>';
  const noteLine = note
    ? `<br><div style="border-left: 3px solid #0d6efd; padding-left: 10px; color: #6c757d; font-style: italic;">${escapeHtml(note)}</div><br>`
    : '<br>';
  const openHref = buildCaseOpenHref(caseRow);
  const introLine = action === 'new_case'
    ? 'A new <strong>session student case</strong> was registered and routed to you for review.'
    : (action === 'reminder'
      ? 'This is a reminder about a <strong>session student case</strong>.'
      : `You were ${actionLabel} a <strong>session student case</strong>.`);
  const chatMsgContent = [
    '<i class="bi bi-folder-symlink-fill text-primary"></i> <strong>System Message:</strong>',
    introLine,
    '<br><br>',
    `Class: <strong>${classTitle}</strong><br>`,
    studentLine,
    `Summary: ${summary}`,
    noteLine,
    `<a href="${openHref}" target="_blank" rel="noopener" class="text-decoration-none fw-bold">`,
    '<i class="bi bi-box-arrow-up-right"></i> Open Case',
    '</a>'
  ].join('\n');

  const conv = await chatRepository.create({ userIds: [authorIdStr, targetIdStr] });
  const savedMsg = await chatRepository.addMessage(conv.id, authorIdStr, chatMsgContent.trim(), 'system', null);
  try {
    const io = socketService.getIo();
    io.to(conv.id).emit('new_message', {
      convId: conv.id,
      message: savedMsg
    });
  } catch (socketErr) {
    // ignore offline socket failures
  }
}

async function resolveTargetForChat(req, targetPersonId) {
  const personId = toPublicId(targetPersonId);
  if (!personId) {
    const error = new Error('A valid person is required.');
    error.statusCode = 400;
    throw error;
  }
  const viewerPersonId = getActorPersonId(req.user);
  if (viewerPersonId && idsEqual(viewerPersonId, personId)) {
    const error = new Error('You cannot assign or share a case with yourself.');
    error.statusCode = 400;
    throw error;
  }

  const usersPayload = await schoolIdentityLookupService.listSchoolUsers({
    reqUser: req.user,
    q: personId,
    query: { page: 1, limit: 100 }
  });
  const match = (usersPayload.allRows || usersPayload.rows || [])
    .find((row) => idsEqual(row.personId, personId));
  if (!match?.userId) {
    const error = new Error('That person does not have a user account and cannot receive a chat notification.');
    error.statusCode = 400;
    throw error;
  }
  const personName = await personDisplayNameService.resolvePersonDisplayName(personId, {
    fallback: match.displayName || match.name || personId
  });
  return {
    personId,
    personName,
    userId: toPublicId(match.userId)
  };
}

function categoryLabelForCase(caseRow = {}) {
  const category = normalizeCategory(caseRow?.category || 'other');
  return CASE_CATEGORY_LABELS[category] || category;
}

async function evaluateCollaborationBlock(existing, target, policy) {
  const categoryLabel = categoryLabelForCase(existing);
  if (sessionStudentCaseRoutingService.isCaseRoutedToPerson(existing, target.personId, policy)) {
    return {
      blocked: true,
      code: 'already_routed',
      message: `${target.personName} is already a category reviewer for ${categoryLabel} cases. Assignment or sharing is not needed—they already have access. Send another chat reminder?`,
      targetPersonId: target.personId,
      targetPersonName: target.personName,
      categoryLabel
    };
  }
  if (existing?.assignedTo && idsEqual(existing.assignedTo.personId, target.personId)) {
    return {
      blocked: true,
      code: 'already_assignee',
      message: `${target.personName} is already the primary assignee for this case. Send another chat reminder?`,
      targetPersonId: target.personId,
      targetPersonName: target.personName,
      categoryLabel
    };
  }
  const collaborators = Array.isArray(existing?.collaborators) ? existing.collaborators : [];
  if (collaborators.some((row) => idsEqual(row?.personId, target.personId))) {
    return {
      blocked: true,
      code: 'already_collaborator',
      message: `${target.personName} is already a collaborator on this case. Send another chat reminder?`,
      targetPersonId: target.personId,
      targetPersonName: target.personName,
      categoryLabel
    };
  }
  return { blocked: false };
}

async function persistCollaborationUpdate(req, existing, patch, lifecycleAction, note = '') {
  const lifecycleEvent = await enrichActor(buildLifecycleEvent({
    action: lifecycleAction,
    reqUser: req.user,
    note
  }), req.user);
  const lifecycle = [...(Array.isArray(existing.lifecycle) ? existing.lifecycle : []), lifecycleEvent];
  const updated = await schoolRepositories.sessionStudentCases.update(existing.id, {
    ...patch,
    lifecycle,
    revisionNo: (Number(existing.revisionNo) || 1) + 1
  }, {
    scope: { activeOrgId: getActiveOrgId(req.user) }
  });
  if (!updated) {
    const error = new Error('Student case not found.');
    error.statusCode = 404;
    throw error;
  }
  return updated;
}

async function assignCase(req, caseId, input = {}) {
  const existing = await sessionStudentCaseReviewService.loadCaseForRequest(req, caseId);
  await sessionStudentCaseAccessService.assertCanAssignOrShareCase(req, existing);

  const target = await resolveTargetForChat(req, input.targetPersonId);
  const orgId = getActiveOrgId(req.user);
  const policy = await sessionStudentCaseRoutingService.getRoutingPolicyForOrg(orgId);
  const block = await evaluateCollaborationBlock(existing, target, policy);
  if (block.blocked) {
    return { blocked: true, ...block, case: existing };
  }

  const actorName = await resolveActorName(req.user);
  const assignedTo = {
    personId: target.personId,
    personName: target.personName,
    assignedAt: new Date().toISOString(),
    assignedByPersonId: getActorPersonId(req.user),
    assignedByUserId: getActorUserId(req.user),
    assignedByName: actorName
  };
  const note = cleanString(input.message, 1000);
  const updated = await persistCollaborationUpdate(req, existing, { assignedTo }, 'assigned', note);

  await sendCaseCollaborationChatMessage({
    fromUser: req.user,
    toUserId: target.userId,
    caseRow: updated,
    action: 'assign',
    note
  });

  return {
    case: updated,
    assignedTo: updated.assignedTo || null
  };
}

async function shareCase(req, caseId, input = {}) {
  const existing = await sessionStudentCaseReviewService.loadCaseForRequest(req, caseId);
  await sessionStudentCaseAccessService.assertCanAssignOrShareCase(req, existing);

  const target = await resolveTargetForChat(req, input.targetPersonId);
  const orgId = getActiveOrgId(req.user);
  const policy = await sessionStudentCaseRoutingService.getRoutingPolicyForOrg(orgId);
  const block = await evaluateCollaborationBlock(existing, target, policy);
  if (block.blocked) {
    return {
      blocked: true,
      ...block,
      case: existing,
      collaborators: Array.isArray(existing.collaborators) ? existing.collaborators : []
    };
  }

  const actorName = await resolveActorName(req.user);
  const existingCollaborators = Array.isArray(existing.collaborators) ? existing.collaborators : [];
  const collaborator = {
    personId: target.personId,
    personName: target.personName,
    addedAt: new Date().toISOString(),
    addedByPersonId: getActorPersonId(req.user),
    addedByUserId: getActorUserId(req.user),
    addedByName: actorName
  };
  const collaborators = [...existingCollaborators, collaborator];
  const note = cleanString(input.message, 1000);
  const updated = await persistCollaborationUpdate(req, existing, { collaborators }, 'shared_with', note);

  await sendCaseCollaborationChatMessage({
    fromUser: req.user,
    toUserId: target.userId,
    caseRow: updated,
    action: 'share',
    note
  });

  return {
    case: updated,
    collaborators: updated.collaborators || []
  };
}

async function resendCaseCollaborationChat(req, caseId, input = {}) {
  const existing = await sessionStudentCaseReviewService.loadCaseForRequest(req, caseId);
  await sessionStudentCaseAccessService.assertCanAssignOrShareCase(req, existing);
  const target = await resolveTargetForChat(req, input.targetPersonId);
  const note = cleanString(input.message, 1000);
  await sendCaseCollaborationChatMessage({
    fromUser: req.user,
    toUserId: target.userId,
    caseRow: existing,
    action: 'reminder',
    note
  });
  return {
    targetPersonId: target.personId,
    targetPersonName: target.personName
  };
}

async function resolveUserIdForPerson(reqUser, personId) {
  const usersPayload = await schoolIdentityLookupService.listSchoolUsers({
    reqUser,
    q: personId,
    query: { page: 1, limit: 100 }
  });
  const match = (usersPayload.allRows || usersPayload.rows || [])
    .find((row) => idsEqual(row.personId, personId));
  return match?.userId ? toPublicId(match.userId) : '';
}

async function notifyCategoryRoutingAssigneesOnCaseCreated({ caseRow, reqUser }) {
  if (!caseRow?.id) return { notified: 0 };
  const orgId = toPublicId(caseRow.orgId || getActiveOrgId(reqUser));
  if (!orgId) return { notified: 0 };
  const policy = await sessionStudentCaseRoutingService.getRoutingPolicyForOrg(orgId);
  const assignees = sessionStudentCaseRoutingService.listActiveRoutingAssigneesForCaseCategory(policy, caseRow);
  if (!assignees.length) return { notified: 0 };

  const creatorPersonId = getActorPersonId(reqUser);
  const seen = new Set();
  let notified = 0;
  for (const assignee of assignees) {
    const personId = toPublicId(assignee.personId);
    if (!personId || seen.has(personId)) continue;
    seen.add(personId);
    if (creatorPersonId && idsEqual(creatorPersonId, personId)) continue;
    try {
      const userId = await resolveUserIdForPerson(reqUser, personId);
      if (!userId) continue;
      await sendCaseCollaborationChatMessage({
        fromUser: reqUser,
        toUserId: userId,
        caseRow,
        action: 'new_case'
      });
      notified += 1;
    } catch (error) {
      console.error(`Failed to notify routing assignee ${personId} for case ${caseRow.id}:`, error);
    }
  }
  return { notified };
}

async function listRoutingReviewersForCase(req, caseRow) {
  const orgId = getActiveOrgId(req.user);
  if (!orgId || !caseRow) return [];
  const policy = await sessionStudentCaseRoutingService.getRoutingPolicyForOrg(orgId);
  return sessionStudentCaseRoutingService.listActiveRoutingAssigneesForCaseCategory(policy, caseRow);
}

async function listShareEligiblePersons(req, caseId, query = {}) {
  const existing = await sessionStudentCaseReviewService.loadCaseForRequest(req, caseId);
  await sessionStudentCaseAccessService.assertCanAssignOrShareCase(req, existing);

  const payload = await schoolIdentityLookupService.listSchoolPersons({
    reqUser: req.user,
    q: query.q || '',
    query,
    requireSchoolRole: true,
    allowedSchoolRoles: ['staff', 'teacher']
  });
  const usersPayload = await schoolIdentityLookupService.listSchoolUsers({
    reqUser: req.user,
    q: '',
    query: { page: 1, limit: 5000 }
  });
  const userIdByPersonId = new Map(
    (usersPayload.allRows || usersPayload.rows || [])
      .filter((row) => row.personId && row.userId)
      .map((row) => [toPublicId(row.personId), toPublicId(row.userId)])
  );
  const orgId = getActiveOrgId(req.user);
  const policy = await sessionStudentCaseRoutingService.getRoutingPolicyForOrg(orgId);
  const routingPersonIds = new Set(
    sessionStudentCaseRoutingService.listActiveRoutingAssigneesForCaseCategory(policy, existing)
      .map((row) => toPublicId(row.personId))
      .filter(Boolean)
  );
  const rows = (payload.rows || [])
    .map((row) => {
      const personId = toPublicId(row.personId || row.id);
      return {
        ...row,
        personId,
        id: personId,
        userId: userIdByPersonId.get(personId) || '',
        isCategoryRoutingReviewer: routingPersonIds.has(personId)
      };
    })
    .filter((row) => row.personId && row.userId);

  return {
    rows,
    pagination: payload.pagination || {}
  };
}

module.exports = {
  assignCase,
  shareCase,
  resendCaseCollaborationChat,
  notifyCategoryRoutingAssigneesOnCaseCreated,
  listRoutingReviewersForCase,
  listShareEligiblePersons,
  sendCaseCollaborationChatMessage,
  buildCaseOpenHref,
  _private: {
    resolveTargetForChat,
    persistCollaborationUpdate,
    evaluateCollaborationBlock
  }
};
