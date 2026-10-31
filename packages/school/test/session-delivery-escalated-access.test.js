const test = require('node:test');
const assert = require('node:assert/strict');

const sessionDeliveryEscalatedAccessService = require('../MVC/services/school/sessionDeliveryEscalatedAccessService');
const schoolDataService = require('../MVC/services/school/schoolDataService');
const schoolRecordAccessService = require('../MVC/services/school/schoolRecordAccessService');
const sessionStatusPolicyService = require('../MVC/services/school/sessionStatusPolicyService');
const { SCOPE_MODES } = require('../MVC/services/school/schoolDataScopeBuilder');

const sampleSession = {
  sessionId: 'SES-1',
  date: '2026-03-01',
  status: 'scheduled',
  delivery: {
    deliveredBy: 'TCH_NEW',
    deliveredByName: 'New Teacher',
    coTeachers: []
  }
};

const sampleClass = {
  id: 'CLS-1',
  orgId: 'ORG-1',
  sessions: [sampleSession]
};

function stubDataLayer({ scopedClass = null, orgClass = sampleClass, sessions = [sampleSession] } = {}) {
  const originalGet = schoolDataService.getDataById;
  const originalSessions = schoolDataService.getClassSessions;
  const originalBuild = schoolRecordAccessService.buildRouteAccessContext;
  const originalResolve = schoolRecordAccessService.resolveAccessFromRequest;
  const originalStatusMap = sessionStatusPolicyService.getStatusMap;

  schoolDataService.getDataById = async (type, id, user, ctx = {}) => {
    if (type !== 'classes') return null;
    if (ctx?.scopeId === 'SCP_ORG') return orgClass;
    return scopedClass;
  };
  schoolDataService.getClassSessions = async () => sessions;
  schoolRecordAccessService.buildRouteAccessContext = () => ({ scopeId: 'SCP_ASSIGNMENT' });
  schoolRecordAccessService.resolveAccessFromRequest = () => ({
    scopeMode: SCOPE_MODES.ASSIGNMENT,
    personId: 'TCH_NEW'
  });
  sessionStatusPolicyService.getStatusMap = async () => ({});

  return () => {
    schoolDataService.getDataById = originalGet;
    schoolDataService.getClassSessions = originalSessions;
    schoolRecordAccessService.buildRouteAccessContext = originalBuild;
    schoolRecordAccessService.resolveAccessFromRequest = originalResolve;
    sessionStatusPolicyService.getStatusMap = originalStatusMap;
  };
}

test('loadSessionManageContext uses org fallback for delivery-only class access', async () => {
  const restore = stubDataLayer({ scopedClass: null });
  try {
    const req = { user: { id: 'U1', activeOrgId: 'ORG-1' } };
    const ctx = await sessionDeliveryEscalatedAccessService.loadSessionManageContext(req, {
      classId: 'CLS-1',
      sessionId: 'SES-1'
    });
    assert.equal(ctx.escalated, true);
    assert.equal(ctx.classData.id, 'CLS-1');
    assert.equal(ctx.persistAccessContext.scopeId, 'SCP_ORG');
    assert.equal(ctx.sessions[0].sessionId, 'SES-1');
    assert.equal(req.sessionDeliveryAccess.escalated, true);
  } finally {
    restore();
  }
});

test('loadSessionManageContext fast path when class is in assignment scope', async () => {
  const restore = stubDataLayer({ scopedClass: sampleClass });
  try {
    const req = { user: { id: 'U1', activeOrgId: 'ORG-1' } };
    const ctx = await sessionDeliveryEscalatedAccessService.loadSessionManageContext(req, {
      classId: 'CLS-1',
      sessionId: 'SES-1'
    });
    assert.equal(ctx.escalated, false);
    assert.equal(ctx.persistAccessContext.scopeId, 'SCP_ASSIGNMENT');
  } finally {
    restore();
  }
});

test('assertSessionInstructionalActive rejects makeup-required sessions', async () => {
  const restore = stubDataLayer({ scopedClass: sampleClass });
  const originalResolveStatus = sessionStatusPolicyService.resolveStatusDefinition;
  sessionStatusPolicyService.resolveStatusDefinition = () => ({
    definition: { makeUpRequired: true }
  });
  try {
    const req = { user: { id: 'U1', activeOrgId: 'ORG-1' } };
    await assert.rejects(
      () => sessionDeliveryEscalatedAccessService.assertSessionInstructionalActive(req, {
        classId: 'CLS-1',
        sessionId: 'SES-1'
      }),
      /make-up session/
    );
  } finally {
    sessionStatusPolicyService.resolveStatusDefinition = originalResolveStatus;
    restore();
  }
});
