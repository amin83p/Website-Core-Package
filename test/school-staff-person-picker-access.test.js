const assert = require('assert');
const fs = require('fs');
const path = require('path');
const adminAuthorityService = require('../MVC/services/adminAuthorityService');
const { SECTIONS, OPERATIONS } = require('../packages/school/config/accessConstants');

const ROLE_PICKERS = [
  {
    label: 'Staff',
    formPath: 'packages/school/MVC/views/school/staff/staffForm.ejs',
    routePath: 'packages/school/MVC/routes/staffRoutes.js',
    controllerPath: 'packages/school/MVC/controllers/school/staffController.js',
    endpoint: '/school/staff/api/eligible-persons',
    sectionConstant: 'SCHOOL_STAFF',
    sectionId: SECTIONS.SCHOOL_STAFF
  },
  {
    label: 'Teacher',
    formPath: 'packages/school/MVC/views/school/teacher/teacherForm.ejs',
    routePath: 'packages/school/MVC/routes/teacherRoutes.js',
    controllerPath: 'packages/school/MVC/controllers/school/teacherController.js',
    endpoint: '/school/teachers/api/eligible-persons',
    sectionConstant: 'SCHOOL_TEACHERS',
    sectionId: SECTIONS.SCHOOL_TEACHERS
  },
  {
    label: 'Student',
    formPath: 'packages/school/MVC/views/school/student/studentForm.ejs',
    routePath: 'packages/school/MVC/routes/studentRoutes.js',
    controllerPath: 'packages/school/MVC/controllers/school/studentController.js',
    endpoint: '/school/students/api/eligible-persons',
    sectionConstant: 'SCHOOL_STUDENTS',
    sectionId: SECTIONS.SCHOOL_STUDENTS
  }
];

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function userWithSchoolScopedAdmin() {
  return {
    id: 'USER_SCHOOL_ADMIN',
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

async function assertRolePickerConfig(config) {
  const formSource = read(config.formPath);
  const endpointPattern = new RegExp(`apiEndpoint:\\s*'${config.endpoint.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}'`);
  assert.match(formSource, endpointPattern, `${config.label} Form person picker should use its School-scoped endpoint.`);
  assert.doesNotMatch(formSource, /apiEndpoint:\s*'\/persons'/, `${config.label} Form person picker should not call the global Persons endpoint.`);

  const routeSource = read(config.routePath);
  assert.match(routeSource, /router\.get\('\/api\/eligible-persons'/, `${config.label} routes should expose eligible-persons endpoint.`);
  assert.match(
    routeSource,
    new RegExp(`requireAccess\\(SECTIONS\\.${config.sectionConstant},\\s*OPERATIONS\\.CREATE\\)`),
    `${config.label} eligible-persons endpoint should be guarded by ${config.sectionConstant} create access.`
  );
  assert.match(routeSource, /ctrl\.listEligiblePersons/, `${config.label} eligible-persons endpoint should call the controller picker handler.`);

  const controllerSource = read(config.controllerPath);
  assert.match(controllerSource, /exports\.listEligiblePersons\s*=\s*async/, `${config.label} controller should export listEligiblePersons.`);
  assert.match(controllerSource, /dataServiceGlobal\.fetchData\('persons'/, `${config.label} picker should read person rows through the data facade.`);
  assert.match(controllerSource, /resolvePersonMembershipOrgIds/, `${config.label} picker should filter person rows by active organization membership.`);

  const authority = await adminAuthorityService.resolveAdminAuthorityAsync({
    user: userWithSchoolScopedAdmin(),
    sectionId: config.sectionId,
    orgId: 'ORG_1',
    operationId: OPERATIONS.CREATE
  });
  assert.strictEqual(authority.category, 'SCHOOL');
  assert.strictEqual(authority.isCategoryAdminForSection, true);
  assert.strictEqual(authority.isRequestAdmin, true);
}

async function run() {
  for (const config of ROLE_PICKERS) {
    await assertRolePickerConfig(config);
  }
  console.log('school role person picker access tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});