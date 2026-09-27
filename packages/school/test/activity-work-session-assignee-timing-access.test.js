'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const schoolAdminAccessService = require('../MVC/services/school/schoolAdminAccessService');
const { SECTIONS, OPERATIONS } = require('../config/accessConstants');

test('canEditAssigneeTimingAsync allows Family A bypass admins', async () => {
  const user = {
    id: 'USER_BYPASS',
    activeOrgId: 'ORG_1',
    activeProfile: {
      active: true,
      orgId: 'ORG_1',
      fullAdmin: false,
      adminCategories: ['SCHOOL'],
      sections: []
    }
  };
  const allowed = await schoolAdminAccessService.canEditAssigneeTimingAsync(user);
  assert.equal(allowed, true);
});

test('canEditAssigneeTimingAsync denies users without work session UPDATE admin scope', async () => {
  const user = {
    id: 'USER_TEACHER',
    activeOrgId: 'ORG_1',
    activeProfile: {
      active: true,
      orgId: 'ORG_1',
      fullAdmin: false,
      sections: [{
        id: SECTIONS.SCHOOL_WORK_SESSIONS,
        operations: [{ id: OPERATIONS.READ, scopeId: 'SCP_OWNER' }]
      }]
    }
  };
  const allowed = await schoolAdminAccessService.canEditAssigneeTimingAsync(user);
  assert.equal(allowed, false);
});
