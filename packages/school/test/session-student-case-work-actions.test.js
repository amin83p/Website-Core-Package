const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeWorkActions,
  sanitizeCaseInput
} = require('../MVC/models/school/sessionStudentCaseModel');
const workActionService = require('../MVC/services/school/sessionStudentCaseWorkActionService');
const accessService = require('../MVC/services/school/sessionStudentCaseAccessService');
const routingService = require('../MVC/services/school/sessionStudentCaseRoutingService');
const reviewService = require('../MVC/services/school/sessionStudentCaseReviewService');
const sessionStudentCaseAccessService = require('../MVC/services/school/sessionStudentCaseAccessService');
const schoolRepositories = require('../MVC/repositories/school');

test('sanitizeWorkActions stores body, summary, and attachment metadata', () => {
  const rows = sanitizeWorkActions([{
    id: 'SCA-1',
    at: '2026-03-01T12:00:00.000Z',
    actorName: 'Alex',
    body: 'Called the family and documented next steps for tomorrow.',
    attachment: {
      url: '/uploads/test.pdf',
      originalName: 'notes.pdf',
      size: 1200
    }
  }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'SCA-1');
  assert.match(rows[0].summary, /Called the family/);
  assert.equal(rows[0].attachment.originalName, 'notes.pdf');
});

test('sanitizeCaseInput defaults workActions to empty array on create', () => {
  const row = sanitizeCaseInput({
    orgId: 'ORG-1',
    classId: 'CLS-1',
    sessionId: 'SES-1',
    details: 'Needs follow-up'
  });
  assert.deepEqual(row.workActions, []);
});

test('buildMixedTimeline merges work actions and lifecycle chronologically', () => {
  const timeline = workActionService.buildMixedTimeline({
    workActions: [{
      id: 'SCA-2',
      at: '2026-03-02T10:00:00.000Z',
      actorName: 'Sam',
      summary: 'Follow-up call',
      body: 'Follow-up call completed.'
    }],
    lifecycle: [{
      at: '2026-03-01T09:00:00.000Z',
      action: 'case_created',
      actorName: 'Admin',
      note: 'Opened case'
    }]
  });
  assert.equal(timeline.length, 2);
  assert.equal(timeline[0].kind, 'system');
  assert.equal(timeline[1].kind, 'work');
  assert.equal(timeline[0].readOnly, true);
  assert.equal(timeline[1].readOnly, false);
});

test('canContributeWorkAction allows assignee with read access', async () => {
  const caseRow = {
    id: 'SSC-1',
    category: 'behavior',
    assignedTo: { personId: 'PER-A', personName: 'Assignee' }
  };
  const capabilities = {
    canReadAll: true,
    canUpdate: false,
    canResolve: false,
    canAssignOrShare: false
  };
  const allowed = await workActionService.canContributeWorkAction(
    { user: { id: 'USR-A', personId: 'PER-A', activeOrgId: 'ORG-1' } },
    caseRow,
    capabilities
  );
  assert.equal(allowed, true);
});

test('canContributeWorkAction rejects unrelated viewer without worker relationship', async () => {
  const caseRow = {
    id: 'SSC-2',
    category: 'behavior',
    assignedTo: { personId: 'PER-A', personName: 'Assignee' }
  };
  const capabilities = { canReadAll: true, canUpdate: false, canResolve: false, canAssignOrShare: false };
  const originalRouted = accessService.isCaseRoutedToViewer;
  routingService.isRoutingAdminViewer = () => false;
  accessService.isCaseRoutedToViewer = async () => false;
  accessService.isCaseHandler = async () => false;
  try {
    const allowed = await workActionService.canContributeWorkAction(
      { user: { id: 'USR-X', personId: 'PER-X', activeOrgId: 'ORG-1' } },
      caseRow,
      capabilities
    );
    assert.equal(allowed, false);
  } finally {
    accessService.isCaseRoutedToViewer = originalRouted;
  }
});

test('assertWorkActionFileSize rejects files over 2 MB', () => {
  assert.throws(
    () => workActionService.assertWorkActionFileSize({ size: workActionService.WORK_ACTION_FILE_MAX_BYTES + 1 }),
    (error) => /2 MB/.test(error.message)
  );
});

test('deriveWorkActionSummary truncates long bodies', () => {
  const long = 'x'.repeat(300);
  const summary = workActionService.deriveWorkActionSummary(long);
  assert.ok(summary.length <= 160);
});

test('addWorkAction rejects empty body', async () => {
  const existing = {
    id: 'SSC-WA-1',
    orgId: 'ORG-1',
    classId: 'CLS-1',
    sessionId: 'SES-1',
    category: 'behavior',
    workActions: [],
    revisionNo: 1
  };

  const originalLoad = reviewService.loadCaseForRequest;
  const originalContext = reviewService.loadClassSessionContext;
  const originalView = sessionStudentCaseAccessService.assertCanViewCases;
  const originalCaps = sessionStudentCaseAccessService.resolveCaseCapabilities;

  reviewService.loadCaseForRequest = async () => ({ ...existing });
  reviewService.loadClassSessionContext = async () => ({
    classData: { id: 'CLS-1' },
    session: { id: 'SES-1' }
  });
  sessionStudentCaseAccessService.assertCanViewCases = async () => {};
  sessionStudentCaseAccessService.resolveCaseCapabilities = async () => ({
    canReadAll: true,
    canUpdate: true
  });

  try {
    await assert.rejects(
      () => workActionService.addWorkAction(
        { user: { id: 'USR-1', activeOrgId: 'ORG-1' } },
        existing.id,
        { body: '   ' }
      ),
      (error) => /Describe what you did/.test(error.message)
    );
  } finally {
    reviewService.loadCaseForRequest = originalLoad;
    reviewService.loadClassSessionContext = originalContext;
    sessionStudentCaseAccessService.assertCanViewCases = originalView;
    sessionStudentCaseAccessService.resolveCaseCapabilities = originalCaps;
  }
});

test('addWorkAction appends workActions and returns timeline', async () => {
  const existing = {
    id: 'SSC-WA-2',
    orgId: 'ORG-1',
    classId: 'CLS-1',
    sessionId: 'SES-1',
    category: 'behavior',
    workActions: [],
    lifecycle: [],
    revisionNo: 1
  };

  const originalLoad = reviewService.loadCaseForRequest;
  const originalContext = reviewService.loadClassSessionContext;
  const originalView = sessionStudentCaseAccessService.assertCanViewCases;
  const originalCaps = sessionStudentCaseAccessService.resolveCaseCapabilities;
  const originalUpdate = schoolRepositories.sessionStudentCases.update;

  reviewService.loadCaseForRequest = async () => ({ ...existing });
  reviewService.loadClassSessionContext = async () => ({
    classData: { id: 'CLS-1' },
    session: { id: 'SES-1' }
  });
  sessionStudentCaseAccessService.assertCanViewCases = async () => {};
  sessionStudentCaseAccessService.resolveCaseCapabilities = async () => ({
    canReadAll: true,
    canUpdate: true
  });

  let savedPayload = null;
  schoolRepositories.sessionStudentCases.update = async (_id, payload) => {
    savedPayload = payload;
    return { ...existing, ...payload };
  };

  try {
    const result = await workActionService.addWorkAction(
      { user: { id: 'USR-1', personId: 'PER-1', activeOrgId: 'ORG-1', name: 'Alex' } },
      existing.id,
      { body: 'Documented parent contact.' }
    );
    assert.ok(savedPayload.workActions.length === 1);
    assert.match(savedPayload.workActions[0].body, /parent contact/);
    assert.equal(result.actionId, savedPayload.workActions[0].id);
    assert.equal(result.timeline.length, 1);
    assert.equal(result.timeline[0].kind, 'work');
  } finally {
    reviewService.loadCaseForRequest = originalLoad;
    reviewService.loadClassSessionContext = originalContext;
    sessionStudentCaseAccessService.assertCanViewCases = originalView;
    sessionStudentCaseAccessService.resolveCaseCapabilities = originalCaps;
    schoolRepositories.sessionStudentCases.update = originalUpdate;
  }
});

test('model enforces WORK_ACTION_BODY_MAX on sanitize', () => {
  const max = workActionService.WORK_ACTION_BODY_MAX;
  const longBody = 'a'.repeat(max + 50);
  const rows = sanitizeWorkActions([{ body: longBody }]);
  assert.equal(rows[0].body.length, max);
});

test('sanitizeWorkActions stores private flag', () => {
  const rows = sanitizeWorkActions([{ body: 'Secret steps', private: true }]);
  assert.equal(rows[0].private, true);
});

test('filterWorkActionsForViewer hides private entries from general readers', () => {
  const actions = [
    { id: 'A1', body: 'Public note', private: false },
    { id: 'A2', body: 'Resolver only', private: true, actorUserId: 'USR-AUTHOR' }
  ];
  const visible = workActionService.filterWorkActionsForViewer(actions, {
    reqUser: { id: 'USR-READER' },
    capabilities: { canRead: true, canResolve: false }
  });
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, 'A1');
});

test('filterWorkActionsForViewer shows private entries to resolvers and authors', () => {
  const actions = [{ id: 'A2', body: 'Resolver only', private: true, actorUserId: 'USR-AUTHOR' }];
  const resolverView = workActionService.filterWorkActionsForViewer(actions, {
    reqUser: { id: 'USR-R' },
    capabilities: { canResolve: true }
  });
  assert.equal(resolverView.length, 1);
  const authorView = workActionService.filterWorkActionsForViewer(actions, {
    reqUser: { id: 'USR-AUTHOR' },
    capabilities: { canRead: true, canResolve: false }
  });
  assert.equal(authorView.length, 1);
});

test('buildMixedTimeline marks private work entries', () => {
  const timeline = workActionService.buildMixedTimeline({
    workActions: [{ id: 'SCA-P', at: '2026-03-02T10:00:00.000Z', body: 'Hidden', private: true }]
  });
  assert.equal(timeline[0].private, true);
});

test('canEditWorkAction and canDeleteWorkAction mirror case edit/delete capabilities', () => {
  const openCase = { id: 'SSC-1', status: 'open', locked: false };
  const lockedCase = { id: 'SSC-2', status: 'resolved', locked: true };
  assert.equal(workActionService.canEditWorkAction(openCase, { canUpdate: true }), true);
  assert.equal(workActionService.canEditWorkAction(lockedCase, { canUpdate: true }), false);
  assert.equal(workActionService.canEditWorkAction(lockedCase, { canResolve: true }), true);
  assert.equal(workActionService.canDeleteWorkAction(openCase, { canDelete: true }), true);
  assert.equal(workActionService.canDeleteWorkAction(lockedCase, { canDelete: true }), false);
});

test('buildWorkActionNotifyCandidates dedupes stakeholders and excludes actor', async () => {
  const collaborationService = require('../MVC/services/school/sessionStudentCaseCollaborationService');
  const originalList = collaborationService.listRoutingReviewersForCase;
  const originalResolveUser = collaborationService.resolveUserIdForPerson;
  const originalResolvePerson = collaborationService.resolvePersonIdForUserId;

  collaborationService.listRoutingReviewersForCase = async () => ([
    { personId: 'PER-ROUTE', personName: 'Router' }
  ]);
  collaborationService.resolveUserIdForPerson = async (_user, personId) => (
    personId === 'PER-SELF' ? '' : `USR-${personId}`
  );
  collaborationService.resolvePersonIdForUserId = async () => ({
    personId: 'PER-CREATOR',
    personName: 'Creator',
    userId: 'USR-CREATOR'
  });

  const caseRow = {
    id: 'SSC-N',
    assignedTo: { personId: 'PER-A', personName: 'Assignee' },
    collaborators: [{ personId: 'PER-C', personName: 'Collab' }, { personId: 'PER-A', personName: 'Assignee' }],
    audit: { createdBy: 'USR-CREATOR' }
  };

  try {
    const candidates = await workActionService.buildWorkActionNotifyCandidates(
      { user: { id: 'USR-SELF', personId: 'PER-SELF', activeOrgId: 'ORG-1' } },
      caseRow
    );
    const ids = candidates.map((row) => row.personId);
    assert.ok(ids.includes('PER-A'));
    assert.ok(ids.includes('PER-C'));
    assert.ok(ids.includes('PER-ROUTE'));
    assert.ok(ids.includes('PER-CREATOR'));
    assert.ok(!ids.includes('PER-SELF'));
    assert.equal(new Set(ids).size, ids.length);
  } finally {
    collaborationService.listRoutingReviewersForCase = originalList;
    collaborationService.resolveUserIdForPerson = originalResolveUser;
    collaborationService.resolvePersonIdForUserId = originalResolvePerson;
  }
});

test('notifyWorkActionInvolved persists involvedPersonIds and sends chat', async () => {
  const collaborationService = require('../MVC/services/school/sessionStudentCaseCollaborationService');
  const reviewService = require('../MVC/services/school/sessionStudentCaseReviewService');
  const sessionStudentCaseAccessService = require('../MVC/services/school/sessionStudentCaseAccessService');
  const schoolRepositories = require('../MVC/repositories/school');

  const existing = {
    id: 'SSC-NOTIFY',
    orgId: 'ORG-1',
    classId: 'CLS-1',
    sessionId: 'SES-1',
    category: 'behavior',
    assignedTo: { personId: 'PER-1', personName: 'Alex' },
    workActions: [{
      id: 'SCA-N1',
      body: 'Public update text',
      summary: 'Public update',
      private: false,
      actorUserId: 'USR-1'
    }],
    lifecycle: [],
    revisionNo: 1
  };

  const originalLoad = reviewService.loadCaseForRequest;
  const originalContext = reviewService.loadClassSessionContext;
  const originalView = sessionStudentCaseAccessService.assertCanViewCases;
  const originalCaps = sessionStudentCaseAccessService.resolveCaseCapabilities;
  const originalUpdate = sessionStudentCaseAccessService.assertCanUpdate;
  const originalList = collaborationService.listRoutingReviewersForCase;
  const originalResolveUser = collaborationService.resolveUserIdForPerson;
  const originalResolvePerson = collaborationService.resolvePersonIdForUserId;
  const originalSend = collaborationService.sendCaseCollaborationChatMessage;
  const originalRepoUpdate = schoolRepositories.sessionStudentCases.update;

  reviewService.loadCaseForRequest = async () => ({ ...existing });
  reviewService.loadClassSessionContext = async () => ({
    classData: { id: 'CLS-1' },
    session: { id: 'SES-1' }
  });
  sessionStudentCaseAccessService.assertCanViewCases = async () => {};
  sessionStudentCaseAccessService.assertCanUpdate = async () => ({ canReadAll: true, canUpdate: true });
  sessionStudentCaseAccessService.resolveCaseCapabilities = async () => ({
    canReadAll: true,
    canUpdate: true
  });
  collaborationService.listRoutingReviewersForCase = async () => [];
  collaborationService.resolveUserIdForPerson = async (_user, personId) => `USR-${personId}`;
  collaborationService.resolvePersonIdForUserId = async () => null;

  const chatBodies = [];
  collaborationService.sendCaseCollaborationChatMessage = async ({ note }) => {
    chatBodies.push(note);
  };

  let savedPayload = null;
  schoolRepositories.sessionStudentCases.update = async (_id, payload) => {
    savedPayload = payload;
    return { ...existing, ...payload };
  };

  try {
    const result = await workActionService.notifyWorkActionInvolved(
      { user: { id: 'USR-1', personId: 'PER-AUTHOR', activeOrgId: 'ORG-1' } },
      existing.id,
      'SCA-N1',
      { personIds: ['PER-1'] }
    );
    assert.equal(result.notified, 1);
    assert.match(chatBodies[0], /Public update/);
    assert.deepEqual(savedPayload.workActions[0].involvedPersonIds, ['PER-1']);
    assert.ok(savedPayload.workActions[0].notifiedAt);
  } finally {
    reviewService.loadCaseForRequest = originalLoad;
    reviewService.loadClassSessionContext = originalContext;
    sessionStudentCaseAccessService.assertCanViewCases = originalView;
    sessionStudentCaseAccessService.resolveCaseCapabilities = originalCaps;
    sessionStudentCaseAccessService.assertCanUpdate = originalUpdate;
    collaborationService.listRoutingReviewersForCase = originalList;
    collaborationService.resolveUserIdForPerson = originalResolveUser;
    collaborationService.resolvePersonIdForUserId = originalResolvePerson;
    collaborationService.sendCaseCollaborationChatMessage = originalSend;
    schoolRepositories.sessionStudentCases.update = originalRepoUpdate;
  }
});
