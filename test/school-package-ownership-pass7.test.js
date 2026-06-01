const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('school package pass7 starts route implementation ownership with package-owned schoolRoutes', () => {
  const routeSource = read('packages/school/MVC/routes/schoolRoutes.js');

  assert.equal(routeSource.includes("requireCoreModule('MVC/routes/school/schoolRoutes')"), false);
  assert.match(routeSource, /const\s+\{\s*requireAuth,\s*SECTIONS\s*\}\s*=\s*require\('\.\/schoolRouteDependencies'\)/);
  assert.match(routeSource, /router\.get\('\/'/);
  assert.match(routeSource, /dashboard\/section-nav/);
  assert.match(routeSource, /encodeURIComponent\(SECTIONS\.SCHOOL\)/);
});

test('school package pass7 keeps transactionDefinitionRoutes as package-owned alias', () => {
  const routeSource = read('packages/school/MVC/routes/transactionDefinitionRoutes.js');

  assert.equal(routeSource.includes("requireCoreModule('MVC/routes/school/transactionDefinitionRoutes')"), false);
  assert.match(routeSource, /module\.exports\s*=\s*require\('\.\/transactionTemplateRoutes'\)/);
});

test('school package pass7 owns gradesMatrixRoutes implementation', () => {
  const routeSource = read('packages/school/MVC/routes/gradesMatrixRoutes.js');

  assert.equal(routeSource.includes("requireCoreModule('MVC/routes/school/gradesMatrixRoutes')"), false);
  assert.match(routeSource, /const\s+ctrl\s*=\s*require\('\.\.\/controllers\/school\/gradesMatrixController'\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_GRADEBOOK,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /trackActionState\(SECTIONS\.SCHOOL_GRADEBOOK,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /ctrl\.showGradesMatrixPage/);
  assert.match(routeSource, /ctrl\.getGradesMatrixData/);
});

test('school package pass7 owns sessionRoutes implementation', () => {
  const routeSource = read('packages/school/MVC/routes/sessionRoutes.js');

  assert.equal(routeSource.includes("requireCoreModule('MVC/routes/school/sessionRoutes')"), false);
  assert.match(routeSource, /const\s+ctrl\s*=\s*require\('\.\.\/controllers\/school\/sessionController'\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_SESSIONS,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /trackActionState\(SECTIONS\.SCHOOL_SESSIONS,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /ctrl\.showSessionListPage/);
  assert.match(routeSource, /ctrl\.getSessionsApi/);
});

test('school package pass7 owns sessionStatusRoutes implementation', () => {
  const routeSource = read('packages/school/MVC/routes/sessionStatusRoutes.js');

  assert.equal(routeSource.includes("requireCoreModule('MVC/routes/school/sessionStatusRoutes')"), false);
  assert.match(routeSource, /const\s+ctrl\s*=\s*require\('\.\.\/controllers\/school\/sessionStatusController'\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_SESSION_STATUSES,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_SESSION_STATUSES,\s*OPERATIONS\.CREATE\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_SESSION_STATUSES,\s*OPERATIONS\.UPDATE\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_SESSION_STATUSES,\s*OPERATIONS\.DELETE\)/);
  assert.match(routeSource, /ctrl\.listSessionStatuses/);
  assert.match(routeSource, /ctrl\.saveSessionStatus/);
  assert.match(routeSource, /ctrl\.deleteSessionStatus/);
});

test('school package pass7 owns holidayRoutes implementation', () => {
  const routeSource = read('packages/school/MVC/routes/holidayRoutes.js');

  assert.equal(routeSource.includes("requireCoreModule('MVC/routes/school/holidayRoutes')"), false);
  assert.match(routeSource, /const\s+ctrl\s*=\s*require\('\.\.\/controllers\/school\/holidayController'\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_HOLIDAYS,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_HOLIDAYS,\s*OPERATIONS\.UPDATE\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_HOLIDAYS,\s*OPERATIONS\.DELETE\)/);
  assert.match(routeSource, /ctrl\.listHolidays/);
  assert.match(routeSource, /ctrl\.listHolidaysInRange/);
  assert.match(routeSource, /ctrl\.saveHoliday/);
  assert.match(routeSource, /ctrl\.deleteHoliday/);
});

test('school package pass8 owns payRateRoutes implementation', () => {
  const routeSource = read('packages/school/MVC/routes/payRateRoutes.js');

  assert.equal(routeSource.includes("requireCoreModule('MVC/routes/school/payRateRoutes')"), false);
  assert.match(routeSource, /const\s+ctrl\s*=\s*require\('\.\.\/controllers\/school\/payRateController'\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_PAY_RATES,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_PAY_RATES,\s*OPERATIONS\.CREATE\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_PAY_RATES,\s*OPERATIONS\.UPDATE\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_PAY_RATES,\s*OPERATIONS\.DELETE\)/);
  assert.match(routeSource, /ctrl\.eligiblePersons/);
  assert.match(routeSource, /ctrl\.listPayRates/);
  assert.match(routeSource, /ctrl\.savePayRate/);
  assert.match(routeSource, /ctrl\.deletePayRate/);
});

test('school package pass8 owns timesheetPeriodRoutes implementation', () => {
  const routeSource = read('packages/school/MVC/routes/timesheetPeriodRoutes.js');

  assert.equal(routeSource.includes("requireCoreModule('MVC/routes/school/timesheetPeriodRoutes')"), false);
  assert.match(routeSource, /const\s+ctrl\s*=\s*require\('\.\.\/controllers\/school\/timesheetPeriodController'\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_TIMESHEET_PERIODS,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_TIMESHEET_PERIODS,\s*OPERATIONS\.CREATE\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_TIMESHEET_PERIODS,\s*OPERATIONS\.UPDATE\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_TIMESHEET_PERIODS,\s*OPERATIONS\.DELETE\)/);
  assert.match(routeSource, /ctrl\.listTimesheetPeriods/);
  assert.match(routeSource, /ctrl\.saveTimesheetPeriod/);
  assert.match(routeSource, /ctrl\.deleteTimesheetPeriod/);
});

test('school package pass9 owns termRoutes implementation', () => {
  const routeSource = read('packages/school/MVC/routes/termRoutes.js');

  assert.equal(routeSource.includes("requireCoreModule('MVC/routes/school/termRoutes')"), false);
  assert.match(routeSource, /const\s+ctrl\s*=\s*require\('\.\.\/controllers\/school\/termController'\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_TERMS,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_TERMS,\s*OPERATIONS\.CREATE\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_TERMS,\s*OPERATIONS\.UPDATE\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_TERMS,\s*OPERATIONS\.DELETE\)/);
  assert.match(routeSource, /ctrl\.listTerms/);
  assert.match(routeSource, /ctrl\.showAddWizardForm/);
  assert.match(routeSource, /ctrl\.showEditWizardForm/);
  assert.match(routeSource, /ctrl\.saveTerm/);
  assert.match(routeSource, /ctrl\.deleteTerm/);
});

test('school package pass9 owns timesheetRoutes implementation', () => {
  const routeSource = read('packages/school/MVC/routes/timesheetRoutes.js');

  assert.equal(routeSource.includes("requireCoreModule('MVC/routes/school/timesheetRoutes')"), false);
  assert.match(routeSource, /const\s+ctrl\s*=\s*require\('\.\.\/controllers\/school\/timesheetController'\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_TIMESHEETS,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_TIMESHEETS,\s*OPERATIONS\.UPDATE\)/);
  assert.match(routeSource, /ctrl\.listMyTimesheets/);
  assert.match(routeSource, /ctrl\.listEligibleTimesheetPersons/);
  assert.match(routeSource, /ctrl\.viewTimesheet/);
  assert.match(routeSource, /ctrl\.saveTimesheet/);
});

test('school package pass10 owns attendanceRoutes implementation', () => {
  const routeSource = read('packages/school/MVC/routes/attendanceRoutes.js');

  assert.equal(routeSource.includes("requireCoreModule('MVC/routes/school/attendanceRoutes')"), false);
  assert.match(routeSource, /const\s+ctrl\s*=\s*require\('\.\.\/controllers\/school\/attendanceController'\)/);
  assert.match(routeSource, /requireCoreModule\('MVC\/middleware\/attendanceMatrixPolicyAdminMiddleware'\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_ATTENDANCES,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_ATTENDANCES,\s*OPERATIONS\.UPDATE\)/);
  assert.match(routeSource, /ctrl\.showAttendanceMatrixSettings/);
  assert.match(routeSource, /ctrl\.saveAttendanceMatrixSettings/);
  assert.match(routeSource, /ctrl\.showAttendancePage/);
  assert.match(routeSource, /ctrl\.updateAttendanceRosterCell/);
});

test('school package pass10 owns sampleDataRoutes implementation', () => {
  const routeSource = read('packages/school/MVC/routes/sampleDataRoutes.js');

  assert.equal(routeSource.includes("requireCoreModule('MVC/routes/school/sampleDataRoutes')"), false);
  assert.match(routeSource, /const\s+ctrl\s*=\s*require\('\.\.\/controllers\/school\/schoolSampleDataController'\)/);
  assert.match(routeSource, /requireCoreModule\('MVC\/middleware\/adminApproval'\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_SAMPLE_DATA,\s*OPERATIONS\.CREATE\)/);
  assert.match(routeSource, /ctrl\.showForm/);
  assert.match(routeSource, /ctrl\.generate/);
  assert.match(routeSource, /ctrl\.clearTransactionalData/);
  assert.match(routeSource, /ctrl\.deleteSelectedSamplePeople/);
});

test('school package pass11 owns staffRoutes implementation', () => {
  const routeSource = read('packages/school/MVC/routes/staffRoutes.js');

  assert.equal(routeSource.includes("requireCoreModule('MVC/routes/school/staffRoutes')"), false);
  assert.match(routeSource, /const\s+ctrl\s*=\s*require\('\.\.\/controllers\/school\/staffController'\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_STAFF,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_STAFF,\s*OPERATIONS\.CREATE\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_STAFF,\s*OPERATIONS\.UPDATE\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_STAFF,\s*OPERATIONS\.DELETE\)/);
  assert.match(routeSource, /ctrl\.listStaff/);
  assert.match(routeSource, /ctrl\.listArchivedStaff/);
  assert.match(routeSource, /ctrl\.recoverStaff/);
  assert.match(routeSource, /ctrl\.saveStaff/);
});

test('school package pass11 owns teacherRoutes implementation', () => {
  const routeSource = read('packages/school/MVC/routes/teacherRoutes.js');

  assert.equal(routeSource.includes("requireCoreModule('MVC/routes/school/teacherRoutes')"), false);
  assert.match(routeSource, /const\s+ctrl\s*=\s*require\('\.\.\/controllers\/school\/teacherController'\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_TEACHERS,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_TEACHERS,\s*OPERATIONS\.CREATE\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_TEACHERS,\s*OPERATIONS\.UPDATE\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_TEACHERS,\s*OPERATIONS\.DELETE\)/);
  assert.match(routeSource, /ctrl\.listTeachers/);
  assert.match(routeSource, /ctrl\.listArchivedTeachers/);
  assert.match(routeSource, /ctrl\.recoverTeacher/);
  assert.match(routeSource, /ctrl\.saveTeacher/);
});

test('school package pass11 owns subjectRoutes implementation', () => {
  const routeSource = read('packages/school/MVC/routes/subjectRoutes.js');

  assert.equal(routeSource.includes("requireCoreModule('MVC/routes/school/subjectRoutes')"), false);
  assert.match(routeSource, /const\s+ctrl\s*=\s*require\('\.\.\/controllers\/school\/subjectController'\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_SUBJECTS,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_SUBJECTS,\s*OPERATIONS\.CREATE\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_SUBJECTS,\s*OPERATIONS\.UPDATE\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_SUBJECTS,\s*OPERATIONS\.DELETE\)/);
  assert.match(routeSource, /ctrl\.listSubjects/);
  assert.match(routeSource, /ctrl\.showAddWizardForm/);
  assert.match(routeSource, /ctrl\.showEditWizardForm/);
  assert.match(routeSource, /ctrl\.editSubject/);
});

test('school package pass11 owns departmentRoutes implementation', () => {
  const routeSource = read('packages/school/MVC/routes/departmentRoutes.js');

  assert.equal(routeSource.includes("requireCoreModule('MVC/routes/school/departmentRoutes')"), false);
  assert.match(routeSource, /const\s+ctrl\s*=\s*require\('\.\.\/controllers\/school\/departmentController'\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_DEPARTMENTS,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_DEPARTMENTS,\s*OPERATIONS\.CREATE\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_DEPARTMENTS,\s*OPERATIONS\.UPDATE\)/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_DEPARTMENTS,\s*OPERATIONS\.DELETE\)/);
  assert.match(routeSource, /ctrl\.listDepartments/);
  assert.match(routeSource, /ctrl\.getDepartmentsApi/);
  assert.match(routeSource, /ctrl\.showCreateWizardForm/);
  assert.match(routeSource, /ctrl\.saveDepartment/);
});
