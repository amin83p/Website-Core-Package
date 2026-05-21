const test = require('node:test');
const assert = require('node:assert/strict');

const quotaMiddleware = require('../MVC/middleware/activityQuotaMiddleware');
const policyService = require('../MVC/services/activityQuota/consumptionDefinitionPolicyService');

function createJsonResponseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.payload = value;
      return this;
    },
    render(view, model) {
      this.payload = { view, model };
      return this;
    }
  };
}

test('resolveActivityQuotaPolicy attaches resolved policy to request', async () => {
  const originalResolve = policyService.resolvePolicyDefinition;
  try {
    policyService.resolvePolicyDefinition = async () => ({
      definition: {
        id: 'RULE-1',
        orgId: 'ORG-1',
        sectionId: 'PTE_PRACTICE_BY_SKILLS',
        operationId: 'CREATE',
        consumeTiming: 'on_attempt',
        formula: {
          call: { base: 1, multiplier: 0, contextKey: '' },
          amount: { base: 0, multiplier: 0, contextKey: '' },
          token: { base: 0, multiplier: 0, contextKey: '' },
          volume: { base: 0, multiplier: 1, contextKey: 'questionCount' }
        }
      },
      context: {
        orgId: 'ORG-1',
        userId: 'USR-1',
        sectionId: 'PTE_PRACTICE_BY_SKILLS',
        operationId: 'CREATE',
        sourceEventType: 'practice_attempt_started'
      }
    });

    const req = {
      headers: { accept: 'application/json' },
      user: {
        id: 'USR-1',
        activeOrgId: 'ORG-1'
      },
      body: {},
      query: {},
      params: {}
    };
    const res = createJsonResponseRecorder();
    let called = false;
    const middleware = quotaMiddleware.resolveActivityQuotaPolicy({
      section: 'PTE_PRACTICE_BY_SKILLS',
      operation: 'CREATE',
      sourceEventType: 'practice_attempt_started',
      context: { questionCount: 5 }
    });
    await middleware(req, res, () => {
      called = true;
    });

    assert.equal(called, true);
    assert.ok(req.activityQuotaPolicy);
    assert.equal(req.activityQuotaPolicy.definition.id, 'RULE-1');
    assert.equal(req.activityQuotaPolicy.context.questionCount, 5);
  } finally {
    policyService.resolvePolicyDefinition = originalResolve;
  }
});

test('resolveActivityQuotaPolicy blocks request when no active definition exists', async () => {
  const originalResolve = policyService.resolvePolicyDefinition;
  try {
    policyService.resolvePolicyDefinition = async () => {
      const error = new Error('This section/operation does not have an active Activity Quota definition.');
      error.code = 'QUOTA_POLICY_NOT_FOUND';
      throw error;
    };

    const req = {
      headers: { accept: 'application/json' },
      user: {
        id: 'USR-1',
        activeOrgId: 'ORG-1'
      },
      body: {},
      query: {},
      params: {}
    };
    const res = createJsonResponseRecorder();
    let called = false;
    const middleware = quotaMiddleware.resolveActivityQuotaPolicy({
      section: 'PTE_PRACTICE_BY_SKILLS',
      operation: 'CREATE',
      sourceEventType: 'practice_attempt_started'
    });
    await middleware(req, res, () => {
      called = true;
    });

    assert.equal(called, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.payload?.status, 'error');
    assert.match(String(res.payload?.message || ''), /active Activity Quota definition/);
  } finally {
    policyService.resolvePolicyDefinition = originalResolve;
  }
});
