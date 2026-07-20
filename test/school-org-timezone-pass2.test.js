const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const timezoneUtils = require('../MVC/utils/timezoneUtils');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('resolveOrgTodayFromRequest prefers req.orgToday then computes from timezone', () => {
  assert.equal(
    timezoneUtils.resolveOrgTodayFromRequest({ orgToday: '2026-07-19', user: { activeOrgTimeZone: 'Asia/Tehran' } }),
    '2026-07-19'
  );
  assert.equal(
    timezoneUtils.resolveOrgTodayFromRequest({
      user: { orgToday: '2026-01-02', activeOrgTimeZone: 'America/Edmonton' }
    }),
    '2026-01-02'
  );
  const computed = timezoneUtils.resolveOrgTodayFromRequest({
    orgTimeZone: 'UTC',
    user: { activeOrgTimeZone: 'UTC' }
  });
  assert.match(computed, /^\d{4}-\d{2}-\d{2}$/);
});

test('resolveOrgYearFromRequest derives year from org today', () => {
  assert.equal(
    timezoneUtils.resolveOrgYearFromRequest({ orgToday: '2026-07-19' }),
    '2026'
  );
});

test('hub holidays default no longer uses bare new Date().getFullYear()', () => {
  const hub = read('packages/school/MVC/views/school/masterAcademiaHub.ejs');
  assert.doesNotMatch(hub, /new Date\(\)\.getFullYear\(\)/);
  assert.match(hub, /hubOrgYear/);
  assert.match(hub, /function hubOrgYear/);
});

test('session manager and attendance viewer use org instant formatting helper', () => {
  const sessionManager = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  const attendanceViewer = read('packages/school/MVC/views/school/attendance/attendanceViewer.ejs');
  assert.match(sessionManager, /formatSchoolInstant/);
  assert.match(sessionManager, /AppOrgDateTime\.formatSchoolInstant/);
  assert.doesNotMatch(sessionManager, /new Date\(result\.comment\.timestamp\)\.toLocaleString\(\)/);
  assert.match(attendanceViewer, /formatSchoolInstant/);
  assert.doesNotMatch(attendanceViewer, /new Date\(result\.comment\.timestamp\)\.toLocaleString\(\)/);
});

test('registration batch views use orgToday SSR default', () => {
  const termBatch = read('packages/school/MVC/views/school/program/termRegistrationBatchWizard.ejs');
  const programBatch = read('packages/school/MVC/views/school/program/programRegistrationBatch.ejs');
  const termForm = read('packages/school/MVC/views/school/program/termRegistrationForm.ejs');
  const withdrawalWizard = read('packages/school/MVC/views/school/withdrawal/wizard.ejs');
  assert.match(termBatch, /orgToday/);
  assert.match(programBatch, /orgToday/);
  assert.match(termForm, /orgToday/);
  assert.match(withdrawalWizard, /orgToday/);
  assert.doesNotMatch(termBatch, /new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/);
});

test('classController passes org today into period decision helpers', () => {
  const classController = read('packages/school/MVC/controllers/school/classController.js');
  const rollingController = read('packages/school/MVC/controllers/school/classRollingEnrollmentController.js');
  assert.match(classController, /resolveOrgTodayFromRequest/);
  assert.match(classController, /function periodNeedsCompletionDecision\(period, today/);
  assert.match(classController, /buildClassEnrollmentPeriodMetrics\(reqUser, classIds = \[\], orgToday/);
  assert.match(rollingController, /periodNeedsCompletionDecision\(period, resolveOrgTodayFromRequest\(req\)\)/);
});

test('rolling enrollment today fallbacks avoid temporal dead zone self-reference', () => {
  const rollingController = read('packages/school/MVC/controllers/school/classRollingEnrollmentController.js');
  const classController = read('packages/school/MVC/controllers/school/classController.js');
  assert.doesNotMatch(
    rollingController,
    /const today = String\(orgToday \|\| ''\)\.trim\(\) \|\| resolveOrgTodayFromContext\(\{\s*orgToday:\s*today\s*\}\)/
  );
  assert.match(
    rollingController,
    /const today = String\(orgToday \|\| ''\)\.trim\(\) \|\| resolveOrgTodayFromContext\(\{\s*orgToday\s*\}\)/
  );
  assert.match(rollingController, /if \(end && end <= day\) return true;/);
  assert.match(classController, /if \(end && end <= day\) return true;/);
});

test('org-timezone today assignments do not self-reference the const being initialized', () => {
  const files = [
    'packages/school/MVC/controllers/school/classRollingEnrollmentController.js',
    'packages/school/MVC/controllers/school/classController.js',
    'packages/school/MVC/controllers/school/termRegistrationController.js',
    'packages/school/MVC/controllers/school/scheduleController.js',
    'packages/school/MVC/controllers/school/attendanceController.js',
    'packages/school/MVC/controllers/school/examController.js',
    'packages/school/MVC/controllers/school/timesheetController.js',
    'packages/school/MVC/services/school/classEnrollmentReadService.js',
    'packages/school/MVC/services/school/termRegistrationViewService.js',
    'packages/school/MVC/services/school/classEnrollmentPeriodService.js',
    'packages/school/MVC/services/school/studentEnrollmentDetailService.js',
    'packages/school/MVC/services/school/registrationIntegrityService.js',
    'packages/school/MVC/services/school/leaveRequestService.js',
    'packages/school/MVC/services/school/schoolMasterAcademiaHubService.js',
    'packages/school/MVC/services/school/withdrawal/withdrawalPolicyService.js',
    'packages/school/MVC/services/school/withdrawal/withdrawalSettlementService.js',
    'packages/school/MVC/services/school/programTransactionService.js',
    'packages/school/MVC/services/school/transactionDefinitionPreviewService.js',
    'packages/school/MVC/services/school/sessionStatusPolicyService.js',
    'MVC/services/security/entitlementService.js'
  ];
  const selfRef = /const\s+(today|day|orgToday)\s*=\s*[^\n]*\{\s*orgToday:\s*\1\s*\}/;
  for (const relativePath of files) {
    const source = read(relativePath);
    assert.equal(
      selfRef.test(source),
      false,
      `${relativePath} must not initialize today/day/orgToday from itself`
    );
  }
});

test('classEnrollmentReadService and termRegistrationViewService accept orgToday overrides', () => {
  const enrollmentRead = read('packages/school/MVC/services/school/classEnrollmentReadService.js');
  const termView = read('packages/school/MVC/services/school/termRegistrationViewService.js');
  assert.match(enrollmentRead, /orgToday = ''/);
  assert.match(enrollmentRead, /parseWindowDates\(\{ sessionDates, startDate, endDate, orgToday/);
  assert.match(termView, /orgToday = ''/);
  assert.match(termView, /reqUser\?\.orgToday/);
});

test('orgDateTime exposes orgYear helper', () => {
  const script = read('public/scripts/orgDateTime.js');
  assert.match(script, /orgYear/);
});
