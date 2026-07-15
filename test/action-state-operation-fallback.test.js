const test = require('node:test');
const assert = require('node:assert/strict');

const dataService = require('../MVC/services/dataService');
const { trackActionState } = require('../MVC/middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../config/accessConstants');

const ORIGINALS = {
  logActionStateAttempt: dataService.logActionStateAttempt,
  updateActionStateProgress: dataService.updateActionStateProgress,
  completeActionState: dataService.completeActionState,
  failActionState: dataService.failActionState,
  recordActionStateRetryableError: dataService.recordActionStateRetryableError
};

function restore() {
  dataService.logActionStateAttempt = ORIGINALS.logActionStateAttempt;
  dataService.updateActionStateProgress = ORIGINALS.updateActionStateProgress;
  dataService.completeActionState = ORIGINALS.completeActionState;
  dataService.failActionState = ORIGINALS.failActionState;
  dataService.recordActionStateRetryableError = ORIGINALS.recordActionStateRetryableError;
}

function createReq() {
  return {
    method: 'POST',
    originalUrl: '/pte/practice/api/runtime/S-1/items/I-1/save',
    url: '/pte/practice/api/runtime/S-1/items/I-1/save',
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    headers: {
      'x-ajax-request': 'true',
      'user-agent': 'node-test'
    },
    params: { sessionId: 'S-1', itemId: 'I-1' },
    query: {},
    body: { actionStateId: 'OLD-READ-TOKEN' },
    user: {
      id: 'USR-1',
      activeOrgId: 'ORG-1',
      username: 'tester'
    },
    accessLimits: {}
  };
}

function createRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    },
    end(payload) {
      this.payload = payload;
      return this;
    },
    render(view, payload) {
      this.payload = { view, ...payload };
      return this;
    }
  };
}

test.afterEach(() => {
  restore();
});

test('action-state middleware can mint runtime state after operation-token mismatch when route opts in', async () => {
  const calls = [];
  dataService.logActionStateAttempt = async (userId, sectionId, operationId, targetKey, limits, forceId, context) => {
    calls.push({ userId, sectionId, operationId, targetKey, forceId, context });
    if (forceId === 'OLD-READ-TOKEN') {
      throw new Error('Action State Token does not belong to this operation.');
    }
    return {
      id: 'NEW-RUNTIME-TOKEN',
      targetKey,
      attemptCount: 1
    };
  };
  dataService.updateActionStateProgress = async () => {};
  dataService.completeActionState = async () => {};
  dataService.failActionState = async () => {};
  dataService.recordActionStateRetryableError = async () => {};

  const req = createReq();
  const res = createRes();
  let nextCalled = false;
  const middleware = trackActionState(SECTIONS.TASKS, OPERATIONS.UPDATE, {
    requireToken: true,
    allowOperationTokenFallback: true
  });

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(req.actionStateId, 'NEW-RUNTIME-TOKEN');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].forceId, 'OLD-READ-TOKEN');
  assert.equal(calls[1].forceId, null);
  assert.equal(calls[1].targetKey, 'S-1');
  assert.equal(calls[1].context.actionStateFallback.reason, 'operation_token_mismatch');
});

test('action-state middleware keeps opted-in runtime tokens active after successful POST responses', async () => {
  let updateCalls = 0;
  let completeCalls = 0;
  dataService.logActionStateAttempt = async (userId, sectionId, operationId, targetKey, limits, forceId) => {
    assert.equal(forceId, 'OLD-READ-TOKEN');
    return {
      id: 'ACTIVE-RUNTIME-TOKEN',
      targetKey,
      attemptCount: 1
    };
  };
  dataService.updateActionStateProgress = async () => {
    updateCalls += 1;
  };
  dataService.completeActionState = async () => {
    completeCalls += 1;
  };
  dataService.failActionState = async () => {};
  dataService.recordActionStateRetryableError = async () => {};

  const req = createReq();
  const res = createRes();
  let nextCalled = false;
  const middleware = trackActionState(SECTIONS.TASKS, OPERATIONS.UPDATE, {
    requireToken: true,
    allowOperationTokenFallback: true,
    keepActive: true
  });

  await middleware(req, res, () => {
    nextCalled = true;
  });
  res.json({ status: 'success', saved: true });

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(nextCalled, true);
  assert.equal(req.actionStateId, 'ACTIVE-RUNTIME-TOKEN');
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'success');
  assert.equal(updateCalls, 1);
  assert.equal(completeCalls, 0);
});

test('action-state middleware can mint replacement state after inactive token when route opts in', async () => {
  const calls = [];
  dataService.logActionStateAttempt = async (userId, sectionId, operationId, targetKey, limits, forceId, context) => {
    calls.push({ userId, sectionId, operationId, targetKey, forceId, context });
    if (forceId === 'OLD-READ-TOKEN') {
      throw new Error('Action State is no longer active.');
    }
    return {
      id: 'REPLACEMENT-TOKEN',
      targetKey,
      attemptCount: 1
    };
  };
  dataService.updateActionStateProgress = async () => {};
  dataService.completeActionState = async () => {};
  dataService.failActionState = async () => {};
  dataService.recordActionStateRetryableError = async () => {};

  const req = createReq();
  const res = createRes();
  let nextCalled = false;
  const middleware = trackActionState(SECTIONS.TASKS, OPERATIONS.UPDATE, {
    requireToken: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  });

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(req.actionStateId, 'REPLACEMENT-TOKEN');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].forceId, 'OLD-READ-TOKEN');
  assert.equal(calls[1].forceId, null);
  assert.equal(calls[1].targetKey, 'S-1');
  assert.equal(calls[1].context.actionStateFallback.reason, 'inactive_or_expired_token');
});

test('action-state middleware rejects inactive token when inactive fallback is not enabled', async () => {
  dataService.logActionStateAttempt = async () => {
    throw new Error('Action State is no longer active.');
  };

  const req = createReq();
  const res = createRes();
  let nextCalled = false;
  const middleware = trackActionState(SECTIONS.TASKS, OPERATIONS.UPDATE, {
    requireToken: true,
    allowOperationTokenFallback: true
  });

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.status, 'error');
  assert.match(res.payload.message, /Action State is no longer active/);
});

test('action-state middleware keeps strict operation validation unless route opts in', async () => {
  dataService.logActionStateAttempt = async () => {
    throw new Error('Action State Token does not belong to this operation.');
  };

  const req = createReq();
  const res = createRes();
  let nextCalled = false;
  const middleware = trackActionState(SECTIONS.TASKS, OPERATIONS.UPDATE, {
    requireToken: true
  });

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.status, 'error');
  assert.match(res.payload.message, /does not belong to this operation/);
});

test('operation-token fallback still requires a client token', async () => {
  let logCalls = 0;
  dataService.logActionStateAttempt = async () => {
    logCalls += 1;
    return { id: 'UNEXPECTED-TOKEN', targetKey: 'S-1', attemptCount: 1 };
  };

  const req = createReq();
  req.body = {};
  const res = createRes();
  let nextCalled = false;
  const middleware = trackActionState(SECTIONS.TASKS, OPERATIONS.UPDATE, {
    requireToken: true,
    allowOperationTokenFallback: true
  });

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(logCalls, 0);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.status, 'error');
  assert.match(res.payload.message, /Missing Action State Token/);
});

for (const validationError of [
  'Security Violation: User mismatch.',
  'Action State Token does not belong to this section.'
]) {
  test(`operation-token fallback rejects ${validationError}`, async () => {
    let logCalls = 0;
    dataService.logActionStateAttempt = async () => {
      logCalls += 1;
      throw new Error(validationError);
    };

    const req = createReq();
    const res = createRes();
    let nextCalled = false;
    const middleware = trackActionState(SECTIONS.TASKS, OPERATIONS.UPDATE, {
      requireToken: true,
      allowOperationTokenFallback: true
    });

    await middleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(logCalls, 1);
    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.status, 'error');
    assert.match(res.payload.message, new RegExp(validationError.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
}

test('action-state middleware can mint runtime state after target-token mismatch when route opts in', async () => {
  const calls = [];
  dataService.logActionStateAttempt = async (userId, sectionId, operationId, targetKey, limits, forceId, context) => {
    calls.push({ userId, sectionId, operationId, targetKey, forceId, context });
    if (forceId === 'OLD-READ-TOKEN') {
      return {
        id: 'OLD-READ-TOKEN',
        targetKey: 'GLOBAL_SCOPE',
        attemptCount: 1
      };
    }
    return {
      id: 'NEW-TARGET-TOKEN',
      targetKey,
      attemptCount: 1
    };
  };
  dataService.updateActionStateProgress = async () => {};
  dataService.completeActionState = async () => {};
  dataService.failActionState = async () => {};
  dataService.recordActionStateRetryableError = async () => {};

  const req = createReq();
  const res = createRes();
  let nextCalled = false;
  const middleware = trackActionState(SECTIONS.TASKS, OPERATIONS.UPDATE, {
    requireToken: true,
    allowOperationTokenFallback: true
  });

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(req.actionStateId, 'NEW-TARGET-TOKEN');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].forceId, 'OLD-READ-TOKEN');
  assert.equal(calls[1].forceId, null);
  assert.equal(calls[1].targetKey, 'S-1');
  assert.equal(calls[1].context.actionStateFallback.reason, 'target_token_mismatch');
});

test('action-state middleware falls back when inbound token throws target mismatch validation', async () => {
  const calls = [];
  dataService.logActionStateAttempt = async (userId, sectionId, operationId, targetKey, limits, forceId, context) => {
    calls.push({ userId, sectionId, operationId, targetKey, forceId, context });
    if (forceId === 'OLD-READ-TOKEN') {
      throw new Error('Action State Token is not valid for this record.');
    }
    return {
      id: 'NEW-TARGET-VALIDATION-TOKEN',
      targetKey,
      attemptCount: 1
    };
  };
  dataService.updateActionStateProgress = async () => {};
  dataService.completeActionState = async () => {};
  dataService.failActionState = async () => {};
  dataService.recordActionStateRetryableError = async () => {};

  const req = createReq();
  const res = createRes();
  let nextCalled = false;
  const middleware = trackActionState(SECTIONS.TASKS, OPERATIONS.UPDATE, {
    requireToken: true,
    allowOperationTokenFallback: true
  });

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(req.actionStateId, 'NEW-TARGET-VALIDATION-TOKEN');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].forceId, 'OLD-READ-TOKEN');
  assert.equal(calls[1].forceId, null);
  assert.equal(calls[1].targetKey, 'S-1');
  assert.equal(calls[1].context.actionStateFallback.reason, 'target_token_mismatch');
});
