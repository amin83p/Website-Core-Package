'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const reportHubStudentDirectoryService = require('../MVC/services/school/reportHubStudentDirectoryService');

const ROOT = path.join(__dirname, '..');
const reportHubView = fs.readFileSync(path.join(ROOT, 'MVC', 'views', 'school', 'reportHub.ejs'), 'utf8');
const studentManagementView = fs.readFileSync(path.join(ROOT, 'MVC', 'views', 'school', 'studentManagement.ejs'), 'utf8');
const studentManagementScript = fs.readFileSync(
  path.join(ROOT, 'public', 'scripts', 'schoolStudentManagement.js'),
  'utf8'
);
const managementRoutes = fs.readFileSync(path.join(ROOT, 'MVC', 'routes', 'schoolStudentManagementRoutes.js'), 'utf8');
const managementController = fs.readFileSync(
  path.join(ROOT, 'MVC', 'controllers', 'school', 'schoolStudentManagementController.js'),
  'utf8'
);
const mainRoute = fs.readFileSync(path.join(ROOT, 'MVC', 'routes', 'schoolMainRoute.js'), 'utf8');
const reportHubRoutes = fs.readFileSync(path.join(ROOT, 'MVC', 'routes', 'schoolReportHubRoutes.js'), 'utf8');
const reportHubService = fs.readFileSync(path.join(ROOT, 'MVC', 'services', 'school', 'schoolReportHubService.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.manifest.json'), 'utf8'));

test('student management view and client expose workspace', () => {
  assert.match(studentManagementView, /schoolStudentManagementWorkspace/);
  assert.match(studentManagementView, /School Student Management/);
  assert.match(studentManagementView, /schoolStudentManagement\.js/);
  assert.match(studentManagementView, /studentClaimNumbersManager\.js/);
  assert.match(studentManagementView, /studentReferralLinksManager\.js/);
  assert.match(studentManagementView, /rollingStudentClbManager\.js/);
  assert.match(studentManagementScript, /data-hub-students-card="claims"/);
  assert.match(studentManagementScript, /data-hub-students-card="clb"/);
  assert.match(studentManagementScript, /data-hub-students-card="referrals"/);
  const managementModals = fs.readFileSync(path.join(ROOT, 'MVC', 'views', 'school', 'partials', 'studentManagementModals.ejs'), 'utf8');
  assert.match(managementModals, /personProfileEditModal/);
  assert.match(studentManagementScript, /data-hub-students-person-focus/);
  assert.match(studentManagementScript, /SchoolPersonProfileModal/);
  assert.match(studentManagementScript, /hubStudentsProgramRegsCard/);
  assert.match(studentManagementScript, /programRegistrations/);
  const directoryService = fs.readFileSync(
    path.join(ROOT, 'MVC', 'services', 'school', 'reportHubStudentDirectoryService.js'),
    'utf8'
  );
  assert.match(directoryService, /programRegistrations/);
  assert.match(directoryService, /programRegistrationViewService/);
  assert.match(directoryService, /classEnrollments/);
  assert.match(directoryService, /referralLinks/);
  assert.match(directoryService, /buildClassEnrollmentRows/);
  assert.match(studentManagementScript, /hubStudentsEnrollmentsCard/);
  assert.match(studentManagementScript, /hubStudentsEmptyHero/);
  assert.match(studentManagementScript, /SchoolStudentManagementEnrollmentClose/);
  assert.match(studentManagementScript, /\/school\/student-management\/api/);
  assert.match(studentManagementScript, /mountStudentManagementWorkspace/);
  assert.match(studentManagementScript, /hub-students-quick-actions/);
  assert.match(studentManagementScript, /data-hub-students-open="attendance-report"/);
  assert.match(studentManagementScript, /data-hub-students-open="grades-matrix"/);
  assert.match(studentManagementScript, /data-hub-students-open="class-conduct-report"/);
  assert.match(studentManagementScript, /data-hub-students-open="person-reports"/);
  assert.match(studentManagementScript, /data-hub-students-open="session-cases"/);
  assert.match(studentManagementScript, /data-hub-students-open="referral-links"/);
  assert.match(managementModals, /studentReferralLinksModal/);
  assert.match(managementModals, /referralQuickCreateModal/);
  assert.match(managementModals, /modal_GenericPicker/);
  assert.match(studentManagementView, /schoolReferralQuickCreate\.js/);
  assert.match(studentManagementScript, /hubStudentsBuildAttendanceReportUrl/);
  assert.match(studentManagementScript, /HUB_STUDENTS_EMBED_QUERY/);
  assert.match(studentManagementScript, /smEmbed/);
  assert.match(studentManagementScript, /hubStudentsWithEmbedParams/);
  assert.match(studentManagementScript, /hubStudentsBuildSessionCasesUrl/);
  assert.match(studentManagementScript, /hubStudentsEmbedFrame/);
  assert.match(studentManagementView, /schoolDateRangeShortcuts\.js/);
  assert.match(managementModals, /id="hubStudentsDateRangeModal"/);
  assert.match(managementModals, /id="hubStudentsEmbedModal"/);
  assert.match(managementModals, /id="hubStudentsEmbedFrame"/);
  assert.match(managementModals, /data-hub-students-range-token="year"/);
  assert.match(managementModals, /data-hub-students-range-token="last-6-months"/);
  assert.match(studentManagementScript, /hubStudentsPriorMonthsRange/);
});

test('report hub no longer exposes Students segment', () => {
  assert.doesNotMatch(reportHubView, /data-hub-workspace-section="students"/);
  assert.doesNotMatch(reportHubView, /const hubReportSectionCount = 6 \+/);
  assert.match(reportHubView, /const hubReportSectionCount = 5 \+/);
  assert.doesNotMatch(reportHubView, /HUB_STUDENTS_MIN_SEARCH/);
});

test('student management routes and controller are registered', () => {
  assert.match(mainRoute, /\/student-management/);
  assert.match(managementRoutes, /SECTIONS\.SCHOOL_STUDENT_MANAGEMENT/);
  assert.match(managementRoutes, /\/api\/students\/search/);
  assert.match(managementRoutes, /\/api\/students\/summary/);
  assert.match(managementRoutes, /\/api\/students\/:studentId\/profile/);
  assert.match(managementController, /exports\.showStudentManagementPage/);
  assert.match(managementController, /school\/studentManagement/);
  assert.doesNotMatch(reportHubRoutes, /\/api\/students\/search/);
  assert.doesNotMatch(reportHubService, /key === 'students'/);
});

test('package manifest declares SCHOOL_STUDENT_MANAGEMENT section', () => {
  const section = (manifest.sections || []).find((row) => row.name === 'SCHOOL_STUDENT_MANAGEMENT');
  assert.ok(section, 'section should exist in manifest');
  assert.equal(section.id, '445587');
  assert.equal(section.homeURL, '/school/student-management');
  const school = (manifest.sections || []).find((row) => row.name === 'SCHOOL');
  assert.ok((school.subsections || []).some((row) => row.id === '445587'));
  assert.ok((manifest.dashboardEntries || []).some((row) => row.href === '/school/student-management'));
});

test('student directory service enforces minimum search length constant', () => {
  assert.equal(reportHubStudentDirectoryService.MIN_SEARCH_LENGTH, 3);
});

test('student directory service classifies gender buckets for population summary', () => {
  assert.equal(reportHubStudentDirectoryService.classifyHubStudentGender('female'), 'female');
  assert.equal(reportHubStudentDirectoryService.classifyHubStudentGender('Male'), 'male');
  assert.equal(reportHubStudentDirectoryService.classifyHubStudentGender('other'), 'other');
});