const test = require('node:test');
const assert = require('node:assert/strict');

const routingService = require('../MVC/services/school/sessionStudentCaseRoutingService');
const accessService = require('../MVC/services/school/sessionStudentCaseAccessService');
const collaborationService = require('../MVC/services/school/sessionStudentCaseCollaborationService');
const { sanitizeCaseInput } = require('../MVC/models/school/sessionStudentCaseModel');

test('sanitizeCaseInput stores assignedTo and collaborators', () => {
  const row = sanitizeCaseInput({
    orgId: 'ORG-1',
    classId: 'CLS-1',
    sessionId: 'SES-1',
    details: 'Needs follow-up',
    assignedTo: {
      personId: 'PER-1',
      personName: 'Alex',
      assignedAt: '2026-01-01T00:00:00.000Z',
      assignedByPersonId: 'PER-ADMIN',
      assignedByUserId: 'USR-ADMIN',
      assignedByName: 'Admin'
    },
    collaborators: [{
      personId: 'PER-2',
      personName: 'Sam',
      addedAt: '2026-01-02T00:00:00.000Z',
      addedByPersonId: 'PER-ADMIN',
      addedByUserId: 'USR-ADMIN',
      addedByName: 'Admin'
    }]
  });
  assert.equal(row.assignedTo.personId, 'PER-1');
  assert.equal(row.collaborators.length, 1);
  assert.equal(row.collaborators[0].personId, 'PER-2');
});

test('assertCanAssignOrShareCase allows routing admin and routed handler', async () => {
  const caseRow = { id: 'SSC-1', category: 'behavior', assignedTo: null };
  const adminUser = { id: 'USR-ADMIN', personId: 'PER-ADMIN', activeOrgId: 'ORG-1' };
  const routedUser = { id: 'USR-2', personId: 'PER-REVIEWER', activeOrgId: 'ORG-1' };
  const otherUser = { id: 'USR-3', personId: 'PER-OTHER', activeOrgId: 'ORG-1' };

  const originalIsAdmin = routingService.isRoutingAdminViewer;
  const originalGetPolicy = routingService.getRoutingPolicyForOrg;
  routingService.isRoutingAdminViewer = (user) => user?.id === 'USR-ADMIN';
  routingService.getRoutingPolicyForOrg = async () => routingService.normalizePolicyInput({
    categories: {
      behavior: {
        active: true,
        assignees: [{ personId: 'PER-REVIEWER', personName: 'Reviewer' }]
      }
    }
  });

  try {
    await accessService.assertCanAssignOrShareCase({ user: adminUser }, caseRow);
    await accessService.assertCanAssignOrShareCase({ user: routedUser }, caseRow);
    await assert.rejects(
      () => accessService.assertCanAssignOrShareCase({ user: otherUser }, caseRow),
      (error) => error.statusCode === 403
    );
  } finally {
    routingService.isRoutingAdminViewer = originalIsAdmin;
    routingService.getRoutingPolicyForOrg = originalGetPolicy;
  }
});

test('isCaseHandler prefers assignee over category routing', async () => {
  const caseRow = {
    id: 'SSC-2',
    category: 'behavior',
    assignedTo: { personId: 'PER-ASSIGNEE', personName: 'Assignee' }
  };
  const assigneeReq = { user: { id: 'USR-A', personId: 'PER-ASSIGNEE', activeOrgId: 'ORG-1' } };
  const routedReq = { user: { id: 'USR-R', personId: 'PER-REVIEWER', activeOrgId: 'ORG-1' } };

  const originalRouted = accessService.isCaseRoutedToViewer;
  accessService.isCaseRoutedToViewer = async () => true;

  try {
    assert.equal(await accessService.isCaseHandler(assigneeReq, caseRow), true);
    assert.equal(await accessService.isCaseHandler(routedReq, caseRow), false);
  } finally {
    accessService.isCaseRoutedToViewer = originalRouted;
  }
});

test('filterCasesByAccessScope includes assignee and collaborator rows', async () => {
  const schoolDataService = require('../MVC/services/school/schoolDataService');
  const schoolRecordAccessService = require('../MVC/services/school/schoolRecordAccessService');

  const originalResolve = schoolRecordAccessService.resolveAccessFromRequest;
  const originalIsOrgWide = schoolRecordAccessService.isOrgWideScope;
  const originalIsOwned = schoolRecordAccessService.isRecordOwnedByUser;
  const originalFetchAll = schoolDataService.fetchAllData;
  const originalGetPolicy = routingService.getRoutingPolicyForOrg;
  const studentCaseAccessService = require('../MVC/services/school/studentCaseAccessService');
  const originalBuildAccess = studentCaseAccessService.buildStudentCaseAccess;

  schoolRecordAccessService.resolveAccessFromRequest = () => ({
    scopeMode: 'ASSIGNMENT',
    userId: 'USR-1',
    personId: 'PER-VIEW'
  });
  schoolRecordAccessService.isOrgWideScope = () => false;
  schoolRecordAccessService.isRecordOwnedByUser = () => false;
  schoolDataService.fetchAllData = async () => [];
  routingService.getRoutingPolicyForOrg = async () => routingService.normalizePolicyInput({ categories: {} });
  studentCaseAccessService.buildStudentCaseAccess = async () => ({
    canViewCases: true,
    canOpenList: true
  });

  delete require.cache[require.resolve('../MVC/services/school/sessionStudentCaseWorkspaceService')];
  const workspaceService = require('../MVC/services/school/sessionStudentCaseWorkspaceService');

  const rows = [
    { id: 'SSC-ASSIGN', classId: 'CLS-OUT', category: 'learning', assignedTo: { personId: 'PER-VIEW' } },
    { id: 'SSC-COLLAB', classId: 'CLS-OUT', category: 'learning', collaborators: [{ personId: 'PER-VIEW' }] },
    { id: 'SSC-HIDDEN', classId: 'CLS-OUT', category: 'learning' }
  ];

  try {
    const scoped = await workspaceService.filterCasesByAccessScope({
      rows,
      req: { user: { id: 'USR-1', personId: 'PER-VIEW', activeOrgId: 'ORG-1' } },
      applyAccessScope: true
    });
    const ids = scoped.map((row) => row.id).sort();
    assert.deepEqual(ids, ['SSC-ASSIGN', 'SSC-COLLAB']);
  } finally {
    studentCaseAccessService.buildStudentCaseAccess = originalBuildAccess;
    schoolRecordAccessService.resolveAccessFromRequest = originalResolve;
    schoolRecordAccessService.isOrgWideScope = originalIsOrgWide;
    schoolRecordAccessService.isRecordOwnedByUser = originalIsOwned;
    schoolDataService.fetchAllData = originalFetchAll;
    routingService.getRoutingPolicyForOrg = originalGetPolicy;
    delete require.cache[require.resolve('../MVC/services/school/sessionStudentCaseWorkspaceService')];
  }
});

test('shareCase dedupes collaborators and assignCase sets assignedTo', async () => {
  const reviewService = require('../MVC/services/school/sessionStudentCaseReviewService');
  const schoolIdentityLookupService = require('../MVC/services/school/schoolIdentityLookupService');
  const chatRepository = require('../../../MVC/repositories/chatRepository');
  const socketService = require('../../../MVC/services/socketService');
  const schoolRepositories = require('../MVC/repositories/school');

  const existing = {
    id: 'SSC-9',
    orgId: 'ORG-1',
    classId: 'CLS-1',
    sessionId: 'SES-1',
    category: 'behavior',
    details: 'Issue',
    summary: 'Issue',
    lifecycle: [],
    collaborators: [{ personId: 'PER-2', personName: 'Sam' }],
    revisionNo: 1
  };

  const originalLoad = reviewService.loadCaseForRequest;
  const originalListUsers = schoolIdentityLookupService.listSchoolUsers;
  const originalUpdate = schoolRepositories.sessionStudentCases.update;
  const originalCreate = chatRepository.create;
  const originalAddMessage = chatRepository.addMessage;
  const originalGetIo = socketService.getIo;

  reviewService.loadCaseForRequest = async () => ({ ...existing });
  schoolIdentityLookupService.listSchoolUsers = async (_opts) => ({
    rows: [
      { personId: 'PER-1', userId: 'USR-1', displayName: 'Alex' },
      { personId: 'PER-2', userId: 'USR-2', displayName: 'Sam' },
      { personId: 'PER-3', userId: 'USR-3', displayName: 'Pat' }
    ],
    allRows: [
      { personId: 'PER-1', userId: 'USR-1', displayName: 'Alex' },
      { personId: 'PER-2', userId: 'USR-2', displayName: 'Sam' },
      { personId: 'PER-3', userId: 'USR-3', displayName: 'Pat' }
    ]
  });

  let lastUpdatePayload = null;
  schoolRepositories.sessionStudentCases.update = async (_id, payload) => {
    lastUpdatePayload = payload;
    return { ...existing, ...payload };
  };

  chatRepository.create = async () => ({ id: 'CHAT-1' });
  chatRepository.addMessage = async () => ({ id: 'MSG-1', text: 'hello' });
  socketService.getIo = () => ({ to: () => ({ emit: () => {} }) });

  const req = {
    user: { id: 'USR-ADMIN', personId: 'PER-ADMIN', activeOrgId: 'ORG-1' }
  };
  const originalAssert = accessService.assertCanAssignOrShareCase;
  const originalGetPolicy = routingService.getRoutingPolicyForOrg;
  accessService.assertCanAssignOrShareCase = async () => {};
  routingService.getRoutingPolicyForOrg = async () => routingService.normalizePolicyInput({ categories: {} });

  try {
    const duplicate = await collaborationService.shareCase(req, existing.id, { targetPersonId: 'PER-2' });
    assert.equal(duplicate.blocked, true);
    assert.equal(duplicate.code, 'already_collaborator');

    await collaborationService.assignCase(req, existing.id, { targetPersonId: 'PER-1', message: 'Please handle' });
    assert.equal(lastUpdatePayload.assignedTo.personId, 'PER-1');
    assert.ok(Array.isArray(lastUpdatePayload.lifecycle));
    assert.equal(lastUpdatePayload.lifecycle.at(-1).action, 'assigned');

    await collaborationService.shareCase(req, existing.id, { targetPersonId: 'PER-3' });
    assert.equal(lastUpdatePayload.lifecycle.at(-1).action, 'shared_with');
  } finally {
    reviewService.loadCaseForRequest = originalLoad;
    schoolIdentityLookupService.listSchoolUsers = originalListUsers;
    schoolRepositories.sessionStudentCases.update = originalUpdate;
    chatRepository.create = originalCreate;
    chatRepository.addMessage = originalAddMessage;
    socketService.getIo = originalGetIo;
    accessService.assertCanAssignOrShareCase = originalAssert;
    routingService.getRoutingPolicyForOrg = originalGetPolicy;
  }
});

test('assignCase blocks category routing assignees without persisting', async () => {
  const reviewService = require('../MVC/services/school/sessionStudentCaseReviewService');
  const schoolIdentityLookupService = require('../MVC/services/school/schoolIdentityLookupService');
  const schoolRepositories = require('../MVC/repositories/school');

  const existing = {
    id: 'SSC-ROUTED',
    orgId: 'ORG-1',
    classId: 'CLS-1',
    sessionId: 'SES-1',
    category: 'behavior',
    details: 'Issue',
    summary: 'Issue',
    lifecycle: [],
    revisionNo: 1
  };

  const originalLoad = reviewService.loadCaseForRequest;
  const originalListUsers = schoolIdentityLookupService.listSchoolUsers;
  const originalUpdate = schoolRepositories.sessionStudentCases.update;
  const originalGetPolicy = routingService.getRoutingPolicyForOrg;
  const originalAssert = accessService.assertCanAssignOrShareCase;

  reviewService.loadCaseForRequest = async () => ({ ...existing });
  schoolIdentityLookupService.listSchoolUsers = async () => ({
    rows: [{ personId: 'PER-REVIEWER', userId: 'USR-R', displayName: 'Reviewer' }],
    allRows: [{ personId: 'PER-REVIEWER', userId: 'USR-R', displayName: 'Reviewer' }]
  });
  let updateCalled = false;
  schoolRepositories.sessionStudentCases.update = async () => {
    updateCalled = true;
    return existing;
  };
  routingService.getRoutingPolicyForOrg = async () => routingService.normalizePolicyInput({
    categories: {
      behavior: {
        active: true,
        assignees: [{ personId: 'PER-REVIEWER', personName: 'Reviewer' }]
      }
    }
  });
  accessService.assertCanAssignOrShareCase = async () => {};

  try {
    const result = await collaborationService.assignCase(
      { user: { id: 'USR-1', personId: 'PER-ADMIN', activeOrgId: 'ORG-1' } },
      existing.id,
      { targetPersonId: 'PER-REVIEWER' }
    );
    assert.equal(result.blocked, true);
    assert.equal(result.code, 'already_routed');
    assert.equal(updateCalled, false);
  } finally {
    reviewService.loadCaseForRequest = originalLoad;
    schoolIdentityLookupService.listSchoolUsers = originalListUsers;
    schoolRepositories.sessionStudentCases.update = originalUpdate;
    routingService.getRoutingPolicyForOrg = originalGetPolicy;
    accessService.assertCanAssignOrShareCase = originalAssert;
  }
});

test('notifyCategoryRoutingAssigneesOnCaseCreated sends chat to routed users', async () => {
  const schoolIdentityLookupService = require('../MVC/services/school/schoolIdentityLookupService');
  const chatRepository = require('../../../MVC/repositories/chatRepository');
  const socketService = require('../../../MVC/services/socketService');

  const originalGetPolicy = routingService.getRoutingPolicyForOrg;
  const originalListUsers = schoolIdentityLookupService.listSchoolUsers;
  const originalCreate = chatRepository.create;
  const originalAddMessage = chatRepository.addMessage;
  const originalGetIo = socketService.getIo;

  routingService.getRoutingPolicyForOrg = async () => routingService.normalizePolicyInput({
    categories: {
      behavior: {
        active: true,
        assignees: [
          { personId: 'PER-1', personName: 'Alex' },
          { personId: 'PER-2', personName: 'Sam' }
        ]
      }
    }
  });
  schoolIdentityLookupService.listSchoolUsers = async () => ({
    allRows: [
      { personId: 'PER-1', userId: 'USR-1' },
      { personId: 'PER-2', userId: 'USR-2' }
    ]
  });
  let chatCount = 0;
  chatRepository.create = async () => ({ id: 'CHAT-N' });
  chatRepository.addMessage = async () => {
    chatCount += 1;
    return { id: 'MSG-N' };
  };
  socketService.getIo = () => ({ to: () => ({ emit: () => {} }) });

  try {
    const payload = await collaborationService.notifyCategoryRoutingAssigneesOnCaseCreated({
      caseRow: { id: 'SSC-NEW', orgId: 'ORG-1', category: 'behavior', summary: 'New issue' },
      reqUser: { id: 'USR-CREATOR', personId: 'PER-CREATOR', activeOrgId: 'ORG-1' }
    });
    assert.equal(payload.notified, 2);
    assert.equal(chatCount, 2);
  } finally {
    routingService.getRoutingPolicyForOrg = originalGetPolicy;
    schoolIdentityLookupService.listSchoolUsers = originalListUsers;
    chatRepository.create = originalCreate;
    chatRepository.addMessage = originalAddMessage;
    socketService.getIo = originalGetIo;
  }
});

test('sessionStudentCaseModalAssets includes GenericPicker and collaboration modal', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../MVC/views/school/sessionStudentCase/partials/sessionStudentCaseModalAssets.ejs'), 'utf8');
  assert.match(src, /modal_GenericPicker/);
  assert.match(src, /sessionStudentCaseCollaborationModal/);
});

test('sendCaseCollaborationChatMessage uses direct chat repository flow', async () => {
  const chatRepository = require('../../../MVC/repositories/chatRepository');
  const socketService = require('../../../MVC/services/socketService');

  let createdUsers = null;
  let emitted = false;
  const originalCreate = chatRepository.create;
  const originalAddMessage = chatRepository.addMessage;
  const originalGetIo = socketService.getIo;

  chatRepository.create = async ({ userIds }) => {
    createdUsers = userIds;
    return { id: 'CHAT-2' };
  };
  chatRepository.addMessage = async (convId, authorId, text) => {
    assert.equal(convId, 'CHAT-2');
    assert.equal(authorId, 'USR-FROM');
    assert.match(text, /Open Case/);
    return { id: 'MSG-2', text };
  };
  socketService.getIo = () => ({
    to: (room) => {
      assert.equal(room, 'CHAT-2');
      return { emit: (event) => { if (event === 'new_message') emitted = true; } };
    }
  });

  try {
    await collaborationService.sendCaseCollaborationChatMessage({
      fromUser: { id: 'USR-FROM' },
      toUserId: 'USR-TO',
      caseRow: { id: 'SSC-10', summary: 'Test case', classTitle: 'Math' },
      action: 'share'
    });
    assert.deepEqual(createdUsers, ['USR-FROM', 'USR-TO']);
    assert.equal(emitted, true);
  } finally {
    chatRepository.create = originalCreate;
    chatRepository.addMessage = originalAddMessage;
    socketService.getIo = originalGetIo;
  }
});

test('review service loads schoolIdentityLookupService for Open Here', () => {
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '../MVC/services/school/sessionStudentCaseReviewService.js'),
    'utf8'
  );
  assert.match(source, /require\('\.\/schoolIdentityLookupService'\)/);
});
