'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schoolAdminAccessService = require('../MVC/services/school/schoolAdminAccessService');
const adminAuthorityService = require('../../../MVC/services/adminAuthorityService');
const { SECTIONS, OPERATIONS } = require('../config/accessConstants');

test('canViewStatHolidayPayWarningsPanelAsync allows Family A bypass admins', async () => {
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
  const allowed = await schoolAdminAccessService.canViewStatHolidayPayWarningsPanelAsync(user);
  assert.equal(allowed, true);
});

test('canViewStatHolidayPayWarningsPanelAsync denies users without management READ_ALL admin scope', async () => {
  const user = {
    id: 'USER_TEACHER',
    activeOrgId: 'ORG_1',
    activeProfile: {
      active: true,
      orgId: 'ORG_1',
      fullAdmin: false,
      sections: [{
        id: SECTIONS.SCHOOL_TIMESHEETS,
        operations: [{ id: OPERATIONS.READ, scopeId: 'SCP_OWNER' }]
      }]
    }
  };
  const allowed = await schoolAdminAccessService.canViewStatHolidayPayWarningsPanelAsync(user);
  assert.equal(allowed, false);
});

test('timesheet editor gates statHolidayWarningsPanel markup and payload', () => {
  const editorSource = fs.readFileSync(
    path.join(__dirname, '../MVC/views/school/timesheet/timesheetEditor.ejs'),
    'utf8'
  );
  const controllerSource = fs.readFileSync(
    path.join(__dirname, '../MVC/controllers/school/timesheetController.js'),
    'utf8'
  );
  assert.match(editorSource, /canViewStatHolidayWarningsPanel/);
  assert.match(editorSource, /CAN_VIEW_STAT_HOLIDAY_WARNINGS_PANEL/);
  assert.match(controllerSource, /canViewStatHolidayPayWarningsPanelAsync/);
  assert.match(controllerSource, /if \(!canViewStatHolidayWarningsPanel\)/);
});

test('Family A helper matches bypass section admin authority', async () => {
  const user = {
    id: 'USER_CAT',
    activeOrgId: 'ORG_1',
    activeProfile: {
      active: true,
      orgId: 'ORG_1',
      adminCategories: ['SCHOOL'],
      sections: []
    }
  };
  const authority = await adminAuthorityService.resolveAdminAuthorityAsync({
    user,
    sectionId: SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT,
    operationId: OPERATIONS.READ_ALL,
    orgId: 'ORG_1'
  });
  assert.equal(schoolAdminAccessService.isFamilyABypassAdminAuthority(authority), true);
});
