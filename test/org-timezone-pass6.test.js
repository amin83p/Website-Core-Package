const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('PTE ledger services use formatInstantInTimezone instead of toLocaleString for display fields', () => {
  const ledger = read('packages/pte/MVC/services/pte/pteAttemptLedgerService.js');
  const tokenUsage = read('packages/pte/MVC/services/pte/pteAiTokenUsageDataService.js');
  assert.match(ledger, /formatInstantInTimezone/);
  assert.match(ledger, /formatLedgerInstant/);
  assert.doesNotMatch(ledger, /\.toLocaleString\(\)/);
  assert.match(tokenUsage, /formatInstantInTimezone/);
  assert.match(tokenUsage, /formatTokenUsageInstant/);
  assert.doesNotMatch(tokenUsage, /\.toLocaleString\(\)/);
});

test('key PTE views use formatOrgDateTime for instant display', () => {
  const attemptDetails = read('packages/pte/MVC/views/pte/attempt/attemptDetails.ejs');
  const tokenUsageList = read('packages/pte/MVC/views/pte/aiAssist/tokenUsageList.ejs');
  assert.match(attemptDetails, /formatOrgDateTime/);
  assert.doesNotMatch(attemptDetails, /new Date\([^)]+\)\.toLocaleString\(\)/);
  assert.match(tokenUsageList, /consumedAtDisplay/);
});

test('key IELTS views use formatOrgDateTime or AppOrgDateTime.formatInstant', () => {
  const scoringHistory = read('packages/ielts/MVC/views/ielts/scoringHistory.ejs');
  const scoringV0326 = read('packages/ielts/MVC/views/ielts/scoringV0326.ejs');
  assert.match(scoringHistory, /formatOrgDateTime/);
  assert.match(scoringV0326, /function formatSavedAtLabel/);
  assert.match(scoringV0326, /AppOrgDateTime\.formatInstant/);
});

test('school controllers import resolveOrgTodayFromContext for today fallbacks', () => {
  const controllers = [
    'packages/school/MVC/controllers/school/classController.js',
    'packages/school/MVC/controllers/school/classRollingEnrollmentController.js',
    'packages/school/MVC/controllers/school/termRegistrationController.js',
    'packages/school/MVC/controllers/school/attendanceController.js',
    'packages/school/MVC/controllers/school/scheduleController.js'
  ];
  controllers.forEach((controllerPath) => {
    const source = read(controllerPath);
    assert.match(source, /resolveOrgTodayFromContext/);
    assert.doesNotMatch(source, /new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/);
  });
});

test('consolidated school services import resolveOrgTodayFromContext', () => {
  const services = [
    'packages/school/MVC/services/school/programTransactionService.js',
    'packages/school/MVC/services/school/transactionDefinitionPreviewService.js',
    'packages/school/MVC/services/school/withdrawal/withdrawalSettlementService.js',
    'packages/school/MVC/services/school/academicLedgerService.js',
    'packages/school/MVC/services/school/leaveRequestService.js',
    'packages/school/MVC/services/school/sessionStatusPolicyService.js'
  ];
  services.forEach((servicePath) => {
    const source = read(servicePath);
    assert.match(source, /resolveOrgTodayFromContext/);
  });
});

test('core tail views use formatOrgDateTime', () => {
  const policies = read('MVC/views/orgPolicy/policies.ejs');
  const benchpathTasks = read('packages/benchpath/MVC/views/benchpath/task/tasks.ejs');
  assert.match(policies, /formatOrgDateTime\(p\.audit\.lastUpdateDateTime\)/);
  assert.match(benchpathTasks, /formatOrgDateTime\(item\.updatedAt\)/);
});

test('school form UTC tails removed from studentForm and templateForm helpers', () => {
  const studentForm = read('packages/school/MVC/views/school/student/studentForm.ejs');
  const templateForm = read('packages/school/MVC/views/school/report/templateForm.ejs');
  const studentAnchor = studentForm.indexOf('inpClbRecordedAt');
  assert.ok(studentAnchor >= 0);
  assert.doesNotMatch(studentForm.slice(studentAnchor, studentAnchor + 180), /toISOString\(\)\.slice\(0,\s*10\)/);
  const templateAnchor = templateForm.indexOf('const stamp =');
  assert.ok(templateAnchor >= 0);
  assert.doesNotMatch(templateForm.slice(templateAnchor, templateAnchor + 160), /toISOString\(\)\.slice\(0,\s*10\)/);
});

test('practiceController buildPracticeAccessContext threads orgTimeZone', () => {
  const source = read('packages/pte/MVC/controllers/practiceController.js');
  assert.match(source, /orgTimeZone:\s*req\?\.orgTimeZone/);
});
