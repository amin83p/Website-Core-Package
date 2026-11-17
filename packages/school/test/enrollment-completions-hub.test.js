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
const reportHubController = fs.readFileSync(
  path.join(__dirname, '..', 'MVC', 'controllers', 'school', 'schoolReportHubController.js'),
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

test('resolveAmPmEnrollmentTeachers ignores PM enrollments that start after the completing finish date', () => {
  const personNameById = new Map();
  const instructorHasmik = { personId: 'TEA/HAS', name: 'Hasmik Blikyan', status: 'active' };
  const instructorAm = { personId: 'TEA/AM', name: 'AM Teacher', status: 'active' };
  const studentPeriods = [
    {
      studentPersonId: 'PERSON/JOSE',
      startDate: '2026-01-10',
      effectiveEnd: '2026-03-20',
      classId: 'CLASS/AM',
      period: { id: 'PER/AM' },
      className: 'EAL-AM Reading',
      classRow: { title: 'EAL-AM Reading', instructors: [instructorAm] },
      sessions: []
    },
    {
      studentPersonId: 'PERSON/JOSE',
      startDate: '2026-07-16',
      effectiveEnd: '2026-08-31',
      classId: 'CLASS/PM',
      period: { id: 'PER/PM' },
      className: 'EAL-PM-I/G-Beginner Reading & Writing-HASMIK',
      classRow: { title: 'EAL-PM-I/G-Beginner Reading & Writing-HASMIK', instructors: [instructorHasmik] },
      sessions: []
    }
  ];
  const teachers = enrollmentCompletionsHubService.resolveAmPmEnrollmentTeachers(
    'PERSON/JOSE',
    studentPeriods,
    personNameById,
    {
      classId: 'CLASS/AM',
      enrollmentPeriodId: 'PER/AM',
      effectiveFinish: '2026-03-20'
    }
  );
  assert.equal(teachers.teacherAmNames, 'AM Teacher');
  assert.equal(teachers.teacherPmNames, '—');
});

test('buildEnrollmentNewEnrollmentSummary lists only later enrollments with start and end', () => {
  const studentToPersonMap = new Map([['STU/1', 'PERSON/1']]);
  const summary = enrollmentCompletionsHubService.buildEnrollmentNewEnrollmentSummary({
    period: { id: 'PER/1', startDate: '2026-01-01' },
    periodRows: [
      { id: 'PER/1', studentId: 'STU/1', startDate: '2026-01-01', endDate: '2026-05-15', status: 'completed' },
      { id: 'PER/2', studentId: 'STU/1', extensionOfPeriodId: 'PER/1', startDate: '2026-04-01', enrollmentKind: 'extension' },
      { id: 'PER/3', studentId: 'STU/1', startDate: '2026-06-01', endDate: '2026-09-01', enrollmentKind: 'standard', status: 'planned' }
    ],
    effectiveFinish: '2026-05-15',
    studentPersonId: 'PERSON/1',
    studentToPersonMap
  });
  assert.doesNotMatch(summary, /Extension/);
  assert.doesNotMatch(summary, /Linked extension/);
  assert.match(summary, /2026-06-01/);
  assert.match(summary, /2026-09-01/);
  assert.equal(
    enrollmentCompletionsHubService.buildEnrollmentNewEnrollmentSummary({
      period: { id: 'PER/1' },
      periodRows: [{ id: 'PER/1', studentId: 'STU/1', startDate: '2026-01-01' }],
      effectiveFinish: '2026-05-15',
      studentPersonId: 'PERSON/1',
      studentToPersonMap
    }),
    '—'
  );
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

test('resolveEnrollmentCompletionsFunderOptions uses person-backed labels from loadActiveFunderOptions', async () => {
  const scheduleEnrollStudentsService = require('../MVC/services/school/scheduleEnrollStudentsService');
  const originalLoad = scheduleEnrollStudentsService.loadActiveFunderOptions;
  scheduleEnrollStudentsService.loadActiveFunderOptions = async () => ([
    { id: 'FUN/1', label: 'IRCC Sponsor' },
    { id: 'FUN/2', label: 'WCB' }
  ]);
  try {
    const options = await enrollmentCompletionsHubService.resolveFilterOptions({ activeOrgId: 'ORG/1' });
    const funders = options.funderOptions || [];
    const ircc = funders.find((row) => String(row.id) === 'FUN/1');
    assert.ok(ircc);
    assert.equal(ircc.name, 'IRCC Sponsor');
    assert.equal(ircc.label, 'IRCC Sponsor');
    assert.equal(funders[0].id, 'self');
    assert.equal(funders[0].name, 'Self Fund');
  } finally {
    scheduleEnrollStudentsService.loadActiveFunderOptions = originalLoad;
  }
});

test('buildFunderGroupKey distinguishes self fund from registered funder', () => {
  assert.equal(enrollmentCompletionsHubService.buildFunderGroupKey('self', 'self'), 'self');
  assert.equal(enrollmentCompletionsHubService.buildFunderGroupKey('FUN/1', 'funder'), 'funder:FUN/1');
});

test('consolidateEnrollmentCompletionRows keeps separate rows per funder for same student', () => {
  const consolidated = enrollmentCompletionsHubService.consolidateEnrollmentCompletionRows([
    {
      studentPersonId: 'PERSON/1',
      funderGroupKey: 'self',
      funderLabel: 'Self Fund',
      enrollmentFinishDate: '2026-03-10'
    },
    {
      studentPersonId: 'PERSON/1',
      funderGroupKey: 'funder:FUN/1',
      funderLabel: 'IRCC',
      enrollmentFinishDate: '2026-03-20'
    }
  ]);
  assert.equal(consolidated.length, 2);
});

test('filterProgramOptionsByDepartments returns only programs in selected departments', () => {
  const catalog = [
    { id: 'PROG/1', name: 'A', departmentId: 'DEPT/1' },
    { id: 'PROG/2', name: 'B', departmentId: 'DEPT/2' },
    { id: 'PROG/3', name: 'C', departmentId: '' }
  ];
  const filtered = enrollmentCompletionsHubService.filterProgramOptionsByDepartments(catalog, ['DEPT/1']);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 'PROG/1');
  assert.equal(enrollmentCompletionsHubService.filterProgramOptionsByDepartments(catalog, []).length, 0);
});

test('filterRowsByFunderIds honors self and registered funder keys', () => {
  const rows = [
    { studentPersonId: 'P/1', funderGroupKey: 'self' },
    { studentPersonId: 'P/2', funderGroupKey: 'funder:FUN/1' }
  ];
  const selfOnly = enrollmentCompletionsHubService.filterRowsByFunderIds(rows, ['self']);
  assert.equal(selfOnly.length, 1);
  assert.equal(selfOnly[0].studentPersonId, 'P/1');
  const funderOnly = enrollmentCompletionsHubService.filterRowsByFunderIds(rows, 'FUN/1');
  assert.equal(funderOnly.length, 1);
  assert.equal(funderOnly[0].studentPersonId, 'P/2');
  assert.equal(enrollmentCompletionsHubService.filterRowsByFunderIds(rows, []).length, 2);
});

test('buildFunderGroupsFromRows sorts self fund first then labels', () => {
  const groups = enrollmentCompletionsHubService.buildFunderGroupsFromRows([
    { funderGroupKey: 'funder:FUN/2', funderLabel: 'WCB', funderType: 'funder' },
    { funderGroupKey: 'self', funderLabel: 'Self Fund', funderType: 'self' },
    { funderGroupKey: 'funder:FUN/1', funderLabel: 'IRCC', funderType: 'funder' }
  ]);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].funderGroupKey, 'self');
  assert.equal(groups[1].funderLabel, 'IRCC');
  assert.equal(groups[2].funderLabel, 'WCB');
});

test('resolveClaimNumberDisplay uses period claim and student claim registry', () => {
  const student = {
    claimNumbers: [
      { id: 'claim-primary', number: '12345', label: 'Primary' }
    ]
  };
  assert.equal(
    enrollmentCompletionsHubService.resolveClaimNumberDisplay({ claimNumberId: 'claim-primary' }, student),
    '12345'
  );
  assert.equal(
    enrollmentCompletionsHubService.resolveClaimNumberDisplay({ claimNumber: '99999' }, student),
    '99999'
  );
});

test('reportHub view includes enrollment-completions section and month input', () => {
  assert.match(reportHubView, /data-hub-workspace-section="enrollment-completions"/);
  assert.match(reportHubView, /hubEnrollmentCompletionsMonth/);
  assert.match(reportHubView, /enrollment-completions/);
});

test('reportHub section bar uses fixed column grid like master academia hub', () => {
  assert.match(reportHubView, /--hub-report-section-count/);
  assert.match(reportHubView, /grid-template-columns:\s*repeat\(var\(--hub-report-section-count/);
});

test('reportHub enrollment column picker and month shortcuts layout', () => {
  assert.match(reportHubView, /hubEnrollmentCompletionsColumnToggleLabel/);
  assert.match(reportHubView, /hub-enrollment-completions-month-shortcuts/);
});

test('report hub controller loads shared print manager like attendance matrix', () => {
  assert.match(reportHubController, /includePrintManager:\s*true/);
});

test('enrollment completion print uses attendance matrix html preview with 10mm page margins', () => {
  assert.match(reportHubView, /buildEnrollmentCompletionsPrintHtmlDocument/);
  assert.match(reportHubView, /AppPrintManager\.openHtmlPreview/);
  assert.match(reportHubView, /PrintDocumentBuilder\.buildPageCss/);
  assert.match(reportHubView, /@page \{ margin: 10mm; size: portrait; \}/);
  assert.match(reportHubView, /class="identity-block"/);
  assert.match(reportHubView, /table\.matrix thead \{ display: table-header-group; \}/);
  assert.match(reportHubView, /view: 'enrollment-completion'/);
  assert.doesNotMatch(reportHubView, /runEnrollmentCompletionsPrintJob/);
  assert.doesNotMatch(reportHubView, /hub-print-enrollment-completions/);
  assert.match(reportHubView, /CLB Goal\/Current\/Updated/);
  assert.match(reportHubView, /table-striped/);
  assert.match(reportHubView, /table\.matrix tbody tr:nth-child\(even\) td/);
});

test('reportHub enrollment completions optional columns and print page breaks', () => {
  assert.match(reportHubView, /hubEnrollmentCompletionsColNewEnrollment/);
  assert.match(reportHubView, /hubEnrollmentCompletionsColClb/);
  assert.match(reportHubView, /HUB_ENROLLMENT_COMPLETIONS_COMMENT_COLUMN_LABEL/);
  assert.match(reportHubView, /enrollment-completions-funder-print-page/);
  assert.match(reportHubView, /readEnrollmentCompletionsColumnPrefs/);
});

test('reportHub enrollment completions filters funders and department-scoped programs', () => {
  assert.match(reportHubView, /hubEnrollmentCompletionsFunderIds/);
  assert.match(reportHubView, /hubEnrollmentCompletionsProgramCatalog/);
  assert.match(reportHubView, /enrollmentCompletionsProgramsForSelectedDepartments/);
  assert.match(reportHubView, /getMonth\(\) \+ 1/);
  assert.match(reportHubView, /data-hub-enrollment-completions-month="nextMonth"/);
});

test('reportHub enrollment completions view supports funder tables claim and new enrollment column', () => {
  assert.match(reportHubView, /groupEnrollmentCompletionsRowsByFunder/);
  assert.match(reportHubView, /hub-enrollment-completions-funder-section/);
  assert.match(reportHubView, /Claim:/);
  assert.match(reportHubView, /HUB_ENROLLMENT_COMPLETIONS_NEW_ENROLLMENT_COLUMN_LABEL/);
  assert.match(reportHubView, /New enrollment/);
  assert.match(reportHubView, /renderEnrollmentCompletionsPrintTablesByFunder/);
  assert.match(reportHubView, /funder-section-title/);
  assert.match(reportHubView, /data-hub-enrollment-completions-sort="followOn"/);
});