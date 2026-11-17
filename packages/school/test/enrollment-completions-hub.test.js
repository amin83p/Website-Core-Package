'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const weeklyReportsHubService = require('../MVC/services/school/weeklyReportsHubService');
const enrollmentCompletionsHubService = require('../MVC/services/school/enrollmentCompletionsHubService');
const sessionEnrollmentContextService = require('../MVC/services/school/sessionEnrollmentContextService');

const reportHubView = fs.readFileSync(
  path.join(__dirname, '..', 'MVC', 'views', 'school', 'reportHub.ejs'),
  'utf8'
);

test('parseMonthKey returns month boundaries and label', () => {
  const parsed = enrollmentCompletionsHubService.parseMonthKey('2026-03');
  assert.ok(parsed);
  assert.equal(parsed.monthStart, '2026-03-01');
  assert.equal(parsed.monthEnd, '2026-03-31');
  assert.match(parsed.monthLabel, /March\s+2026/);
});

test('dateInMonth matches effective finish YYYY-MM', () => {
  assert.equal(enrollmentCompletionsHubService.dateInMonth('2026-03-15', '2026-03'), true);
  assert.equal(enrollmentCompletionsHubService.dateInMonth('2026-02-28', '2026-03'), false);
});

test('classMatchesDepartmentList and classMatchesProgramList accept multi ids', () => {
  const classRow = {
    deliveryDepartmentId: 'DEPT/1',
    allowedProgramTerms: [{ programId: 'PROG/1' }, { programId: 'PROG/2' }]
  };
  assert.equal(weeklyReportsHubService.classMatchesDepartmentList(classRow, ['DEPT/2', 'DEPT/1']), true);
  assert.equal(weeklyReportsHubService.classMatchesDepartmentList(classRow, ['DEPT/9']), false);
  assert.equal(weeklyReportsHubService.classMatchesProgramList(classRow, ['PROG/2']), true);
  assert.equal(weeklyReportsHubService.classMatchesProgramList(classRow, []), true);
});

test('isIncludedPeriodStatus excludes draft and includes completed', () => {
  assert.equal(enrollmentCompletionsHubService.isIncludedPeriodStatus({ status: 'draft' }), false);
  assert.equal(enrollmentCompletionsHubService.isIncludedPeriodStatus({ status: 'completed' }), true);
  assert.equal(enrollmentCompletionsHubService.isIncludedPeriodStatus({ status: 'withdrawn' }), true);
});

test('effective finish in month uses resolveExpectedFinishDate completionDate', () => {
  const finish = sessionEnrollmentContextService.resolveExpectedFinishDate({
    period: { completionDate: '2026-05-20', endDate: '2026-06-01' },
    sessions: [],
    statusMap: {}
  });
  assert.equal(finish, '2026-05-20');
  assert.equal(enrollmentCompletionsHubService.dateInMonth(finish, '2026-05'), true);
  assert.equal(enrollmentCompletionsHubService.dateInMonth(finish, '2026-06'), false);
});

test('buildEnrollmentPeriodNotes includes extension and follow-on stubs', () => {
  const studentToPersonMap = new Map([['STU/1', 'PERSON/1']]);
  const notes = enrollmentCompletionsHubService.buildEnrollmentPeriodNotes({
    period: { id: 'PER/1', enrollmentKind: 'standard', startDate: '2026-01-01' },
    periodRows: [
      { id: 'PER/1', studentId: 'STU/1', startDate: '2026-01-01', status: 'completed' },
      { id: 'PER/2', studentId: 'STU/1', extensionOfPeriodId: 'PER/1', startDate: '2026-04-01', enrollmentKind: 'extension' },
      { id: 'PER/3', studentId: 'STU/1', startDate: '2026-06-01', enrollmentKind: 'standard', status: 'planned' }
    ],
    effectiveFinish: '2026-05-15',
    studentPersonId: 'PERSON/1',
    studentToPersonMap
  });
  assert.match(notes, /Linked extension/);
  assert.match(notes, /Follow-on: 2026-06-01/);
});

test('formatAttendanceLabel uses expected session counts from weekly summary shape', () => {
  const summary = weeklyReportsHubService.summarizeStudentAttendanceForWeeklyReport({
    records: [
      { expectedForSession: true, status: 'present' },
      { expectedForSession: true, status: 'present' },
      { expectedForSession: true, status: 'absent' },
      { expectedForSession: false, status: 'present' }
    ]
  });
  assert.equal(summary.sessionCount, 3);
  const label = enrollmentCompletionsHubService.formatAttendanceLabel(summary);
  assert.match(label, /66\.7% \(2\/3\)/);
});

test('reportHub view includes enrollment-completions section and month input', () => {
  assert.match(reportHubView, /data-hub-workspace-section="enrollment-completions"/);
  assert.match(reportHubView, /hubEnrollmentCompletionsMonth/);
  assert.match(reportHubView, /enrollment-completions/);
});