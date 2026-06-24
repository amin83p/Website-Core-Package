const assert = require('assert');
const fs = require('fs');
const path = require('path');
const adminAuthorityService = require('../MVC/services/adminAuthorityService');
const { SECTIONS, OPERATIONS } = require('../packages/school/config/accessConstants');

const controllerPath = path.join(__dirname, '..', 'packages/school/MVC/controllers/school/timesheetController.js');
const source = fs.readFileSync(controllerPath, 'utf8');

function userWithSchoolScopedAdmin() {
  return {
    id: 'USER_SCHOOL_TIMESHEET_ADMIN',
    activeOrgId: 'ORG_1',
    activeProfile: {
      active: true,
      orgId: 'ORG_1',
      fullAdmin: false,
      adminCategories: ['SCHOOL'],
      sections: []
    },
    activePolicy: null,
    activeOrgPolicy: null
  };
}

async function run() {
  assert.doesNotMatch(
    source,
    /adminChekersService\.isAdmin\(req\.user\)/,
    'Timesheet controller should not use broad system-admin checks for School timesheet admin mode.'
  );
  assert.match(
    source,
    /adminAuthorityService\.isAdminForRequestAsync\([\s\S]*SECTIONS\.SCHOOL_TIMESHEETS[\s\S]*operationId[\s\S]*section:\s*\{\s*id:\s*SECTIONS\.SCHOOL_TIMESHEETS\s*\}/,
    'Timesheet controller should use section-aware admin authority for SCHOOL_TIMESHEETS.'
  );
  assert.match(
    source,
    /resolveTargetTeacherContext\(req, \{ requireTeacher: false, operationId: OPERATIONS\.READ_ALL \}\)/,
    'Timesheet list should allow scoped admins to open without a self teacher/staff role.'
  );
  assert.match(
    source,
    /resolveTargetTeacherContext\(req, \{ requireTeacher: true, operationId: OPERATIONS\.READ_ALL \}\)/,
    'Timesheet editor view should use read authority for admin teacher selection.'
  );
  assert.match(
    source,
    /resolveTargetTeacherContext\(req, \{ requireTeacher: true, operationId: OPERATIONS\.UPDATE \}\)/,
    'Timesheet save should require update authority for admin teacher selection.'
  );
  assert.match(
    source,
    /You must have an active <b>teacher<\/b> or <b>staff<\/b> role/,
    'Normal non-admin users should still require active teacher/staff role.'
  );

  const readAuthority = await adminAuthorityService.resolveAdminAuthorityAsync({
    user: userWithSchoolScopedAdmin(),
    sectionId: SECTIONS.SCHOOL_TIMESHEETS,
    orgId: 'ORG_1',
    operationId: OPERATIONS.READ_ALL
  });
  assert.strictEqual(readAuthority.category, 'SCHOOL');
  assert.strictEqual(readAuthority.isCategoryAdminForSection, true);
  assert.strictEqual(readAuthority.isRequestAdmin, true);

  const updateAuthority = await adminAuthorityService.resolveAdminAuthorityAsync({
    user: userWithSchoolScopedAdmin(),
    sectionId: SECTIONS.SCHOOL_TIMESHEETS,
    orgId: 'ORG_1',
    operationId: OPERATIONS.UPDATE
  });
  assert.strictEqual(updateAuthority.category, 'SCHOOL');
  assert.strictEqual(updateAuthority.isCategoryAdminForSection, true);
  assert.strictEqual(updateAuthority.isRequestAdmin, true);

  console.log('school timesheet scoped admin access tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});