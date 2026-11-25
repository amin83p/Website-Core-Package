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
const studentFileTimelineService = fs.readFileSync(
  path.join(ROOT, 'MVC', 'services', 'school', 'studentFileTimelineService.js'),
  'utf8'
);
const reportController = fs.readFileSync(
  path.join(ROOT, 'MVC', 'controllers', 'school', 'reportController.js'),
  'utf8'
);
const mainRoute = fs.readFileSync(path.join(ROOT, 'MVC', 'routes', 'schoolMainRoute.js'), 'utf8');
const reportHubRoutes = fs.readFileSync(path.join(ROOT, 'MVC', 'routes', 'schoolReportHubRoutes.js'), 'utf8');
const reportHubService = fs.readFileSync(path.join(ROOT, 'MVC', 'services', 'school', 'schoolReportHubService.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.manifest.json'), 'utf8'));

test('student management view and client expose workspace', () => {
  assert.match(studentManagementView, /schoolStudentManagementWorkspace/);
  assert.match(studentManagementView, /Student File Management/);
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
  assert.match(studentManagementScript, /hubStudentsOnHoldsCard/);
  assert.match(studentManagementScript, /hubStudentsCollectAppliedOnHolds/);
  assert.match(studentManagementScript, /data-hub-students-open-on-hold/);
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
  assert.match(studentManagementScript, /data-hub-students-open="timeline"/);
  assert.match(studentManagementScript, /hubStudentsHandleTimelineEventAction/);
  assert.doesNotMatch(
    studentManagementScript,
    /function hubStudentsHandleTimelineEventAction[\s\S]*?hubStudentsHideTimelineModal/
  );
  assert.match(studentManagementScript, /hubStudentsTimelineTrack/);
  assert.match(studentManagementScript, /hub-students-timeline-elbow-corner/);
  assert.match(studentManagementScript, /hub-students-timeline-event-date/);
  assert.match(studentManagementScript, /hubStudentsOptimizeTimelineLayouts/);
  assert.match(studentManagementScript, /data-hub-timeline-draggable/);
  assert.match(studentManagementScript, /hubStudentsTimelineLayoutPrefsKey/);
  assert.match(studentManagementScript, /HUB_TIMELINE_ZOOM/);
  assert.match(studentManagementScript, /hubStudentsTimelinePanState/);
  assert.match(studentManagementScript, /track-scroll--zoomed/);
  assert.match(studentManagementScript, /ctrlKey/);
  assert.match(managementModals, /hubStudentsTimelineHelpBtn/);
  assert.match(managementModals, /hubStudentsTimelineHelpPanel/);
  assert.match(managementModals, /hubStudentsTimelineHelpClose/);
  assert.match(managementModals, /hub-students-timeline-legend-bar/);
  assert.match(managementModals, /Ctrl\+wheel/);
  assert.match(studentManagementScript, /hubStudentsBindTimelineHelpPanel/);
  assert.match(studentManagementScript, /hubStudentsSetTimelineHelpOpen/);
  assert.doesNotMatch(studentManagementScript, /hub-students-timeline-dot-date/);
  assert.doesNotMatch(studentManagementScript, /hub-students-timeline-vline/);
  assert.doesNotMatch(studentManagementScript, /hub-students-timeline-joint-h/);
  assert.match(studentManagementScript, /elbowWPx/);
  const managementStyles = fs.readFileSync(
    path.join(ROOT, 'MVC', 'views', 'school', 'partials', 'studentManagementStyles.ejs'),
    'utf8'
  );
  assert.match(managementStyles, /hub-students-timeline-elbow-corner/);
  assert.match(managementStyles, /--elbow-w/);
  assert.match(managementStyles, /hub-students-timeline-event-date/);
  assert.match(managementStyles, /hub-students-timeline-track-scroll--zoomed/);
  assert.match(managementModals, /hubStudentsTimelineRangeSync/);
  assert.match(managementModals, /id="hubStudentsTimelineModal"/);
  assert.match(managementModals, /id="hubStudentsTimelineLoadModal"/);
  assert.match(managementModals, /hub-students-timeline-load-dialog/);
  assert.match(managementStyles, /hub-students-timeline-source-row/);
  assert.match(managementStyles, /hub-students-timeline-type--enrollment/);
  assert.match(managementStyles, /hub-students-onhold-list/);
  assert.match(managementModals, /id="hubStudentsTimelineSourceList"/);
  assert.match(managementModals, /id="hubStudentsTimelineLegend"/);
  assert.match(managementModals, /data-timeline-source="clb"/);
  assert.match(managementModals, /hubStudentsTimelineChangeFilters/);
  assert.match(managementStyles, /hub-students-timeline-filters-btn/);
  assert.match(managementModals, /id="hubStudentsTimelineLoadStatus"/);
  assert.match(studentManagementScript, /hubStudentsOpenTimelineLoadModal/);
  assert.match(studentManagementScript, /timeline\/load-options/);
  assert.match(studentManagementScript, /sources\.join/);
  assert.match(studentManagementScript, /hubStudentsFilterTimelineEventsByVisibility/);
  assert.match(studentManagementScript, /hub-students-timeline-source-row/);
  assert.match(studentManagementScript, /hubStudentsTimelineSourceTypeClass/);
  assert.match(studentManagementScript, /hubStudentsUpdateTimelineAxisProgress/);
  assert.match(managementModals, /studentReferralLinksModal/);
  assert.match(managementModals, /referralQuickCreateModal/);
  assert.match(managementModals, /modal_GenericPicker/);
  assert.match(studentManagementView, /schoolReferralQuickCreate\.js/);
  assert.match(studentManagementScript, /hubStudentsBuildAttendanceReportUrl/);
  assert.match(studentManagementScript, /HUB_STUDENTS_EMBED_QUERY/);
  assert.match(studentManagementScript, /smEmbed/);
  assert.match(studentManagementScript, /hubStudentsWithEmbedParams/);
  assert.match(studentManagementScript, /hubStudentsRenderTimelineSpan/);
  assert.match(studentManagementScript, /hub-students-timeline-span/);
  assert.match(studentManagementScript, /enrollment_on_hold_embed/);
  assert.match(managementStyles, /hub-students-timeline-type--on-hold/);
  assert.match(studentFileTimelineService, /class_enrollment_on_hold/);
  assert.match(directoryService, /enrollmentHoldPeriods/);
  const academicOverviewService = fs.readFileSync(
    path.join(ROOT, 'MVC', 'services', 'school', 'studentAcademicOverviewService.js'),
    'utf8'
  );
  assert.match(academicOverviewService, /buildEnrollmentOnHoldDeepLinkUrl/);
  assert.match(academicOverviewService, /enrollmentHoldPeriods/);
  assert.match(studentManagementScript, /hubStudentsBuildSessionCasesUrl/);
  assert.match(studentManagementScript, /hubStudentsEmbedFrame/);
  assert.match(studentManagementView, /schoolDateRangeShortcuts\.js/);
  assert.match(managementModals, /id="hubStudentsDateRangeModal"/);
  assert.match(managementModals, /id="hubStudentsEmbedModal"/);
  assert.match(managementStyles, /#hubStudentsReportsModal[\s\S]*z-index:\s*1065/);
  assert.match(managementStyles, /#hubStudentsTimelineModal\.hub-students-timeline-modal[\s\S]*z-index:\s*1055/);
  assert.match(managementStyles, /hub-students-embed-dim/);
  assert.match(managementStyles, /--sections-page-max-width[\s\S]*\* 1\.1/);
  assert.match(studentManagementScript, /hub-students-embed-dim/);
  assert.match(managementModals, /id="hubStudentsReportsModal"/);
  assert.match(managementModals, /hub-students-reports-dialog/);
  assert.match(studentManagementScript, /Review<\/a>/);
  assert.match(managementStyles, /hub-students-reports-dialog/);
  assert.match(managementModals, /id="hubStudentsReportsList"/);
  assert.match(studentManagementScript, /hubStudentsOpenReportsModal/);
  assert.match(studentManagementScript, /hubStudentsBuildReportInstanceV2EmbedUrl/);
  assert.match(studentManagementScript, /report_instance_v2/);
  assert.match(studentManagementScript, /edit-v2/);
  assert.match(studentManagementScript, /report-instances/);
  assert.match(studentFileTimelineService, /kind: 'report_instance_v2'/);
  assert.match(reportController, /embedRenderLocals\(req, renderContext\)/);
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
  assert.match(managementRoutes, /\/api\/students\/:studentId\/timeline\/load-options/);
  assert.match(managementRoutes, /\/api\/students\/:studentId\/timeline/);
  assert.match(managementRoutes, /\/api\/students\/:studentId\/report-instances/);
  assert.match(managementController, /exports\.getHubStudentTimelineLoadOptions/);
  assert.match(managementController, /exports\.getHubStudentTimeline/);
  assert.match(managementController, /exports\.getHubStudentReportInstances/);
  assert.match(managementController, /listStudentReportInstancesForForm/);
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