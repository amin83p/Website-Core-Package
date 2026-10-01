'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const sessionManagementService = require('../MVC/services/school/sessionManagementService');
const schoolAdminAccessService = require('../MVC/services/school/schoolAdminAccessService');
const sessionAttendanceEditAccessService = require('../MVC/services/school/sessionAttendanceEditAccessService');

const CLASS_ID = 'CLASS/1';
const SESSION_ID = 'SESSION/1';
const ORG_ID = 'ORG-1';
const REQ_USER = { id: 'USER-TEACHER', activeOrgId: ORG_ID };

function buildCompletionStatusMap() {
  return new Map([
    ['completed', {
      code: 'completed',
      isFinal: true,
      makeUpRequired: false,
      mergedSessionRequired: false,
      excludeFromAttendance: false
    }],
    ['scheduled', {
      code: 'scheduled',
      isFinal: false,
      makeUpRequired: false,
      mergedSessionRequired: false,
      excludeFromAttendance: false
    }]
  ]);
}

function stubCompletedEditAccess({ editable = true } = {}) {
  const original = sessionAttendanceEditAccessService.resolveSessionSectionEditAccess;
  sessionAttendanceEditAccessService.resolveSessionSectionEditAccess = async () => ({
    editable,
    policy: {},
    reason: editable ? 'within_edit_window' : 'edit_window_expired'
  });
  return () => {
    sessionAttendanceEditAccessService.resolveSessionSectionEditAccess = original;
  };
}

function stubCanRevertCompletedStatus(value) {
  const original = schoolAdminAccessService.canRevertCompletedSessionStatusAsync;
  schoolAdminAccessService.canRevertCompletedSessionStatusAsync = async () => Boolean(value);
  return () => {
    schoolAdminAccessService.canRevertCompletedSessionStatusAsync = original;
  };
}

function baseAssertInput(overrides = {}) {
  return {
    operation: sessionManagementService.SESSION_OPERATIONS.CHANGE_STATUS,
    classId: CLASS_ID,
    sessionId: SESSION_ID,
    session: {
      sessionId: SESSION_ID,
      date: '2020-01-15',
      status: 'completed',
      endTime: '10:00'
    },
    classData: { id: CLASS_ID, orgId: ORG_ID },
    allSessions: [],
    reqUser: REQ_USER,
    source: 'session_manager',
    proposedChanges: { status: 'scheduled' },
    orgId: ORG_ID,
    orgTimeZone: 'UTC',
    statusMap: buildCompletionStatusMap(),
    prefetched: {
      assignments: [],
      instances: [],
      cases: [],
      bookCoveringReport: null
    },
    skipDeletionGuard: true,
    ...overrides
  };
}

test('CHANGE_STATUS blocks reverting completed session when any edit window expired', async () => {
  const restoreAccess = stubCompletedEditAccess({ editable: false });
  const restoreRevert = stubCanRevertCompletedStatus(false);
  try {
    await assert.rejects(
      () => sessionManagementService.assertSessionOperationAllowed(baseAssertInput()),
      (error) => error.code === sessionManagementService.ERROR_CODES.COMPLETED_STATUS_REVERT
    );
  } finally {
    restoreAccess();
    restoreRevert();
  }
});

test('CHANGE_STATUS allows reverting completed session while all edit windows open', async () => {
  const restoreAccess = stubCompletedEditAccess({ editable: true });
  const restoreRevert = stubCanRevertCompletedStatus(false);
  try {
    await sessionManagementService.assertSessionOperationAllowed(baseAssertInput());
  } finally {
    restoreAccess();
    restoreRevert();
  }
});

test('CHANGE_STATUS allows reverting completed session for privileged override', async () => {
  const restoreAccess = stubCompletedEditAccess({ editable: false });
  const restoreRevert = stubCanRevertCompletedStatus(true);
  try {
    await sessionManagementService.assertSessionOperationAllowed(baseAssertInput());
  } finally {
    restoreAccess();
    restoreRevert();
  }
});

test('CHANGE_STATUS does not apply revert guard when session is not completed', async () => {
  const restoreAccess = stubCompletedEditAccess({ editable: false });
  const restoreRevert = stubCanRevertCompletedStatus(false);
  try {
    await sessionManagementService.assertSessionOperationAllowed(baseAssertInput({
      session: {
        sessionId: SESSION_ID,
        date: '2020-01-15',
        status: 'scheduled'
      },
      proposedChanges: { status: 'completed' }
    }));
  } finally {
    restoreAccess();
    restoreRevert();
  }
});

test('CHANGE_STATUS does not apply revert guard when staying on completion status', async () => {
  const restoreAccess = stubCompletedEditAccess({ editable: false });
  const restoreRevert = stubCanRevertCompletedStatus(false);
  try {
    await sessionManagementService.assertSessionOperationAllowed(baseAssertInput({
      proposedChanges: { status: 'completed' }
    }));
  } finally {
    restoreAccess();
    restoreRevert();
  }
});

test('canRevertCompletedSessionStatusAsync allows Family A bypass admins', async () => {
  const user = {
    id: 'USER_BYPASS',
    activeOrgId: ORG_ID,
    activeProfile: {
      active: true,
      orgId: ORG_ID,
      adminCategories: ['SCHOOL'],
      sections: []
    }
  };
  const allowed = await schoolAdminAccessService.canRevertCompletedSessionStatusAsync(user);
  assert.equal(allowed, true);
});
