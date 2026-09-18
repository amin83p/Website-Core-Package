const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const POLICY_PATH = path.join(ROOT_DIR, 'MVC/services/chatOperationPolicyService.js');
const ACCESS_SERVICE_PATH = path.join(ROOT_DIR, 'MVC/services/chatAccessService.js');

function stubModule(modulePath, exportsValue, originals) {
  const resolved = require.resolve(modulePath);
  if (!originals.has(resolved)) originals.set(resolved, require.cache[resolved]);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exportsValue
  };
}

function restoreModules(originals, extraPaths = []) {
  extraPaths.forEach((modulePath) => delete require.cache[modulePath]);
  originals.forEach((entry, resolved) => {
    if (entry) require.cache[resolved] = entry;
    else delete require.cache[resolved];
  });
}

test('USER scope is denied for chat operations covered by the docx matrix', () => {
  delete require.cache[POLICY_PATH];
  const policy = require(POLICY_PATH);

  assert.equal(policy.isUserScopeDenied('READ', 'USER'), true);
  assert.equal(policy.isUserScopeDenied('READ_ALL', 'SCP_USER'), true);
  assert.equal(policy.isUserScopeDenied('CREATE', 'USER'), true);
  assert.equal(policy.isUserScopeDenied('UPDATE', 'USER'), true);
  assert.equal(policy.isUserScopeDenied('DELETE', 'USER'), true);
  assert.equal(policy.isUserScopeDenied('DOWNLOAD_FILE', 'USER'), true);
  assert.equal(policy.isUserScopeDenied('READ', 'OWNER'), false);
});

test('getUpdateLimits returns docx defaults for OWNER and DEPARTMENT scopes', () => {
  delete require.cache[POLICY_PATH];
  const policy = require(POLICY_PATH);

  assert.deepEqual(policy.getUpdateLimits('OWNER'), {
    maxMessages: 15,
    maxFileSizeKB: 50,
    scopeMode: 'owner'
  });
  assert.deepEqual(policy.getUpdateLimits('DEPARTMENT'), {
    maxMessages: 100,
    maxFileSizeKB: 1024,
    scopeMode: 'department'
  });
  assert.deepEqual(policy.getUpdateLimits('OWNER', { maxAttempts: null, maxVolumeKB: null }), {
    maxMessages: 15,
    maxFileSizeKB: 50,
    scopeMode: 'owner'
  });
});

test('deriveAccessFlags splits inbox and message-content permissions', () => {
  delete require.cache[POLICY_PATH];
  const policy = require(POLICY_PATH);

  const flags = policy.deriveAccessFlags({
    read: { allowed: true, scopeId: 'OWNER' },
    readAll: { allowed: false, scopeId: null },
    create: { allowed: true, scopeId: 'OWNER' },
    update: { allowed: true, scopeId: 'OWNER', limits: {} },
    del: { allowed: false, scopeId: null },
    deleteAll: { allowed: false, scopeId: null },
    download: { allowed: false, scopeId: null }
  }, {});

  assert.equal(flags.canReadInbox, true);
  assert.equal(flags.canReadMessageContent, false);
  assert.equal(flags.canCreate, true);
  assert.equal(flags.canManageConversationList, false);
});

test('deriveAccessFlags clears update limits for Family A bypass admins', () => {
  delete require.cache[POLICY_PATH];
  const policy = require(POLICY_PATH);

  const flags = policy.deriveAccessFlags({
    read: { allowed: true, scopeId: 'OWNER' },
    readAll: { allowed: true, scopeId: 'OWNER' },
    create: { allowed: true, scopeId: 'OWNER' },
    update: { allowed: true, scopeId: 'OWNER', limits: { maxAttempts: 5, maxVolumeKB: 10 } },
    del: { allowed: true, scopeId: 'OWNER' },
    deleteAll: { allowed: true, scopeId: 'GLOBAL' },
    download: { allowed: true, scopeId: 'OWNER' }
  }, { update: true });

  assert.equal(flags.updateLimits.maxMessages, null);
  assert.equal(flags.updateLimits.maxFileSizeKB, null);
});

test('filterConversationsForReviewList returns all rows when adminBypass is set', async () => {
  delete require.cache[POLICY_PATH];
  const policy = require(POLICY_PATH);
  const rows = [{ id: 'A' }, { id: 'B' }];
  const filtered = await policy.filterConversationsForReviewList(
    { id: 'ADMIN-1' },
    rows,
    'OWNER',
    { adminBypass: true }
  );
  assert.deepEqual(filtered, rows);
});

test('applyOperationPolicy rejects USER scope even when central access allows', async () => {
  const originals = new Map();
  try {
    stubModule('../MVC/services/adminAuthorityService', {
      isAdminForRequestAsync: async () => false
    }, originals);

    delete require.cache[POLICY_PATH];
    const policy = require(POLICY_PATH);
    const result = await policy.applyOperationPolicy({
      user: { id: 'USER-1', activeOrgId: 'ORG-1' },
      operationId: 'READ',
      evaluation: { allowed: true, scopeId: 'USER' }
    });

    assert.equal(result.allowed, false);
    assert.match(result.reason, /USER scope/i);
  } finally {
    restoreModules(originals, [POLICY_PATH]);
  }
});

test('canUseChatOperation honors admin bypass with active organization context', async () => {
  const originals = new Map();
  let adminContext = null;
  try {
    stubModule('../MVC/services/security/index', {
      evaluateAccess: async ({ operationId }) => ({
        allowed: false,
        operationId,
        reason: 'Denied by profile.'
      })
    }, originals);
    stubModule('../MVC/services/adminAuthorityService', {
      isAdminForRequestAsync: async (user, sectionId, operationId, orgContext) => {
        adminContext = orgContext;
        return operationId === 'READ_ALL';
      }
    }, originals);
    stubModule('../MVC/services/chatContactScopeService', {
      normalizeChatScopeMode: () => 'owner',
      getConversationScopeEligibility: async () => ({ allowed: true }),
      getConversationMessagingEligibility: async () => ({ canMessage: true })
    }, originals);

    delete require.cache[ACCESS_SERVICE_PATH];
    delete require.cache[POLICY_PATH];
    const chatAccessService = require(ACCESS_SERVICE_PATH);
    const result = await chatAccessService.canUseChatOperation(
      { id: 'ADMIN-1', activeOrgId: 'ORG-9' },
      'READ_ALL',
      '127.0.0.1'
    );

    assert.equal(result.allowed, true);
    assert.equal(result.adminBypass, true);
    assert.equal(adminContext?.orgId, 'ORG-9');
  } finally {
    restoreModules(originals, [ACCESS_SERVICE_PATH, POLICY_PATH]);
  }
});

test('participant message history requires READ_ALL rather than READ alone', async () => {
  const originals = new Map();
  try {
    stubModule('../MVC/services/security/index', {
      evaluateAccess: async ({ operationId }) => ({
        allowed: operationId === 'READ' || operationId === 'UPDATE',
        operationId,
        scopeId: 'OWNER'
      })
    }, originals);
    stubModule('../MVC/services/adminAuthorityService', {
      isAdminForRequestAsync: async () => false
    }, originals);
    stubModule('../MVC/services/chatContactScopeService', {
      normalizeChatScopeMode: (scopeId) => String(scopeId || '').toLowerCase(),
      getConversationMessagingEligibility: async () => ({ canMessage: true }),
      getConversationScopeEligibility: async () => ({ allowed: true })
    }, originals);

    delete require.cache[ACCESS_SERVICE_PATH];
    delete require.cache[POLICY_PATH];
    const chatAccessService = require(ACCESS_SERVICE_PATH);
    const conversation = {
      id: 'CONV-1',
      participants: [{ userId: 'USER-1' }, { userId: 'USER-2' }]
    };

    const inbox = await chatAccessService.canAccessConversation({
      user: { id: 'USER-1', activeOrgId: 'ORG-1' },
      conversation,
      operationIds: ['READ']
    });
    const history = await chatAccessService.canAccessConversation({
      user: { id: 'USER-1', activeOrgId: 'ORG-1' },
      conversation,
      operationIds: ['READ_ALL'],
      requireMessageContent: true
    });

    assert.equal(inbox.allowed, true);
    assert.equal(history.allowed, false);
  } finally {
    restoreModules(originals, [ACCESS_SERVICE_PATH, POLICY_PATH]);
  }
});

test('assertUpdateWithinLimits blocks sends after the OWNER message cap', async () => {
  delete require.cache[POLICY_PATH];
  const policy = require(POLICY_PATH);

  const allowed = await policy.assertUpdateWithinLimits({
    user: { id: 'USER-1' },
    conversation: { id: 'CONV-1' },
    scopeId: 'OWNER',
    pendingCount: 1,
    countSentMessages: async () => 15
  });
  const denied = await policy.assertUpdateWithinLimits({
    user: { id: 'USER-1' },
    conversation: { id: 'CONV-1' },
    scopeId: 'OWNER',
    pendingCount: 1,
    countSentMessages: async () => 15
  });

  assert.equal(allowed.allowed, false);
  assert.match(allowed.reason, /15 messages/i);
  assert.equal(denied.allowed, false);
});

test('canDeleteConversation allows global delete when DELETE_ALL admin bypass is active', async () => {
  const originals = new Map();
  try {
    stubModule('../MVC/services/security/index', {
      evaluateAccess: async ({ operationId }) => ({
        allowed: operationId === 'DELETE' || operationId === 'DELETE_ALL',
        operationId,
        scopeId: 'OWNER'
      })
    }, originals);
    stubModule('../MVC/services/adminAuthorityService', {
      isAdminForRequestAsync: async (_user, _sectionId, operationId) => operationId === 'DELETE_ALL'
    }, originals);
    stubModule('../MVC/services/chatContactScopeService', {
      normalizeChatScopeMode: (scopeId) => {
        const token = String(scopeId || '').toUpperCase();
        if (token === 'OWNER') return 'owner';
        return token.toLowerCase() || 'owner';
      },
      getConversationScopeEligibility: async () => ({ allowed: true })
    }, originals);

    delete require.cache[ACCESS_SERVICE_PATH];
    delete require.cache[POLICY_PATH];
    const chatAccessService = require(ACCESS_SERVICE_PATH);
    const conversation = {
      id: 'CONV-1',
      participants: [{ userId: 'ADMIN-1' }, { userId: 'USER-2' }]
    };

    const result = await chatAccessService.canDeleteConversation(
      { id: 'ADMIN-1', activeOrgId: 'ORG-1' },
      conversation,
      '127.0.0.1'
    );

    assert.equal(result.allowed, true);
    assert.equal(result.globalAdmin, true);
  } finally {
    restoreModules(originals, [ACCESS_SERVICE_PATH, POLICY_PATH]);
  }
});

test('canDeleteConversation denies whole conversation delete at OWNER scope without bypass', async () => {
  const originals = new Map();
  try {
    stubModule('../MVC/services/security/index', {
      evaluateAccess: async ({ operationId }) => ({
        allowed: operationId === 'DELETE',
        operationId,
        scopeId: 'OWNER'
      })
    }, originals);
    stubModule('../MVC/services/adminAuthorityService', {
      isAdminForRequestAsync: async () => false
    }, originals);
    stubModule('../MVC/services/chatContactScopeService', {
      normalizeChatScopeMode: () => 'owner',
      getConversationScopeEligibility: async () => ({ allowed: true })
    }, originals);

    delete require.cache[ACCESS_SERVICE_PATH];
    delete require.cache[POLICY_PATH];
    const chatAccessService = require(ACCESS_SERVICE_PATH);
    const conversation = {
      id: 'CONV-1',
      participants: [{ userId: 'USER-1' }, { userId: 'USER-2' }]
    };

    const result = await chatAccessService.canDeleteConversation(
      { id: 'USER-1', activeOrgId: 'ORG-1' },
      conversation,
      '127.0.0.1'
    );

    assert.equal(result.allowed, false);
    assert.match(result.reason, /not the whole conversation/i);
  } finally {
    restoreModules(originals, [ACCESS_SERVICE_PATH, POLICY_PATH]);
  }
});

test('canDeleteMessages allows any sender when DELETE admin bypass is active', async () => {
  const originals = new Map();
  try {
    stubModule('../MVC/services/security/index', {
      evaluateAccess: async ({ operationId }) => ({
        allowed: operationId === 'DELETE',
        operationId,
        scopeId: 'OWNER'
      })
    }, originals);
    stubModule('../MVC/services/adminAuthorityService', {
      isAdminForRequestAsync: async (_user, _sectionId, operationId) => operationId === 'DELETE'
    }, originals);
    stubModule('../MVC/services/chatContactScopeService', {
      normalizeChatScopeMode: () => 'owner',
      getConversationScopeEligibility: async () => ({ allowed: false })
    }, originals);

    delete require.cache[ACCESS_SERVICE_PATH];
    delete require.cache[POLICY_PATH];
    const chatAccessService = require(ACCESS_SERVICE_PATH);
    const conversation = {
      id: 'CONV-1',
      participants: [{ userId: 'ADMIN-1' }, { userId: 'USER-2' }]
    };
    const messages = [{ id: 'M1', senderId: 'USER-2' }];

    const result = await chatAccessService.canDeleteMessages(
      { id: 'ADMIN-1', activeOrgId: 'ORG-1' },
      conversation,
      messages,
      '127.0.0.1'
    );

    assert.equal(result.allowed, true);
    assert.equal(result.globalAdmin, true);
  } finally {
    restoreModules(originals, [ACCESS_SERVICE_PATH, POLICY_PATH]);
  }
});
