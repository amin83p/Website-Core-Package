const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveRegistrationSource,
  buildEnrollmentDetailApiUrl,
  resolveClassTeacherName
} = require('../MVC/services/school/studentAcademicOverviewService');
const {
  buildTermRegistrationModalPayload,
  buildGradebookActivities,
  buildAttendanceHistoryFromMatrix,
  buildAttendanceHistoryFromAttendanceRecords,
  findMatrixRowForStudent,
  buildEnrollmentMatrixLinks,
  resolveAttendanceHistoryForMatrixRow
} = require('../MVC/services/school/studentEnrollmentDetailService');

test('resolveRegistrationSource detects term registration from enrollmentSource', () => {
  const result = resolveRegistrationSource({
    id: 'CEP-1',
    enrollmentSource: 'term_registration',
    authorizationRef: 'STR-100',
    reasonStart: 'Term registration STR-100'
  });
  assert.equal(result.registrationType, 'term_registration');
  assert.equal(result.registrationId, 'STR-100');
  assert.equal(result.registrationLabel, 'Term Registration');
});

test('resolveRegistrationSource detects term registration from reasonStart regex', () => {
  const result = resolveRegistrationSource({
    id: 'CEP-2',
    reasonStart: 'Added by term registration STR-200',
    notes: ''
  });
  assert.equal(result.registrationType, 'term_registration');
  assert.equal(result.termRegistrationId, 'STR-200');
});

test('resolveRegistrationSource detects term registration when authorizationRef matches known ids', () => {
  const knownTermRegistrationIds = new Set(['STR-300']);
  const result = resolveRegistrationSource({
    id: 'CEP-3',
    authorizationRef: 'STR-300'
  }, { knownTermRegistrationIds });
  assert.equal(result.registrationType, 'term_registration');
  assert.equal(result.registrationId, 'STR-300');
});

test('resolveRegistrationSource labels rolling enrollment separately', () => {
  const result = resolveRegistrationSource({
    id: 'CEP-4',
    enrollmentSource: 'rolling_enrollment'
  });
  assert.equal(result.registrationType, 'class_enrollment');
  assert.equal(result.registrationLabel, 'Rolling Enrollment');
  assert.equal(result.registrationId, 'CEP-4');
});

test('resolveRegistrationSource defaults to class enrollment', () => {
  const result = resolveRegistrationSource({
    id: 'CEP-5',
    status: 'active',
    startDate: '2026-02-01'
  });
  assert.equal(result.registrationType, 'class_enrollment');
  assert.equal(result.registrationLabel, 'Class Enrollment');
});

test('resolveClassTeacherName prefers primary instructor', () => {
  const name = resolveClassTeacherName({
    instructors: [
      { name: 'Secondary', isPrimary: false },
      { displayName: 'Primary Teacher', primary: true }
    ]
  });
  assert.equal(name, 'Primary Teacher');
});

test('resolveClassTeacherName falls back to first instructor', () => {
  const name = resolveClassTeacherName({
    instructors: [{ name: 'Only Teacher' }]
  });
  assert.equal(name, 'Only Teacher');
});

test('buildEnrollmentDetailApiUrl encodes student and enrollment ids', () => {
  const url = buildEnrollmentDetailApiUrl('STU/1', 'CEP:9');
  assert.equal(url, '/school/academic-ledger/student-overview/STU%2F1/enrollment-detail/CEP%3A9');
});

test('academic ledger exposes student overview data API', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const routes = fs.readFileSync(path.join(__dirname, '../MVC/routes/academicLedgerRoutes.js'), 'utf8');
  const controller = fs.readFileSync(path.join(__dirname, '../MVC/controllers/school/academicLedgerController.js'), 'utf8');
  assert.match(routes, /student-overview\/:studentId\/data/);
  assert.match(routes, /getStudentOverviewData/);
  assert.match(controller, /exports\.getStudentOverviewData/);
  assert.match(controller, /buildStudentAcademicOverview/);
});

test('buildTermRegistrationModalPayload condenses linked class enrollment', () => {
  const payload = buildTermRegistrationModalPayload({
    id: 'STR-1',
    status: 'registered',
    verificationStatus: 'verified',
    registrationDate: '2026-02-01',
    studentId: 'STU-1',
    studentName: 'Ada Lovelace',
    programId: 'PRG-1',
    programLabel: 'PRG - Program',
    termId: 'TERM-1',
    termLabel: 'T1 - Term 1',
    selectedCredits: 3,
    classCount: 1,
    note: 'Fall term',
    finance: { expected: 1, posted: 1, reversed: 0 },
    academic: { expected: 2, posted: 2, voided: 0 },
    record: {
      classSummary: {
        count: 1,
        rows: [{ classId: 'CLS-1', classTitle: 'Math', credits: 3, status: 'active' }]
      }
    },
    academicEntries: [{ id: 'AE-1', entryType: 'class_enrolled', effectiveDate: '2026-02-01', status: 'posted', memo: 'Enrolled' }],
    financialTransactions: [{ id: 'TX-1', status: 'posted', amount: 100, memo: 'Tuition' }]
  }, {
    enrollmentId: 'CEP-1',
    classId: 'CLS-1',
    classTitle: 'Math',
    startDate: '2026-02-01',
    endDate: '',
    status: 'active'
  });

  assert.equal(payload.id, 'STR-1');
  assert.equal(payload.selectedClasses.length, 1);
  assert.equal(payload.linkedClassEnrollment.enrollmentId, 'CEP-1');
  assert.equal(payload.recentAcademicEntries.length, 1);
  assert.equal(payload.recentFinancialTransactions.length, 1);
});

test('buildGradebookActivities zips columns and cells', () => {
  const activities = buildGradebookActivities(
    [{ sessionId: 'SES-1', date: '2026-02-01', label: 'Quiz 1', totalScore: 10 }],
    [{ score: 8, percent: 80, attendanceStatus: 'present', absent: false, includeInGradeCalculation: true, effective: true }]
  );
  assert.equal(activities.length, 1);
  assert.equal(activities[0].label, 'Quiz 1');
  assert.equal(activities[0].score, 8);
  assert.equal(activities[0].percent, 80);
});

test('buildAttendanceHistoryFromMatrix deduplicates by session', () => {
  const rows = buildAttendanceHistoryFromMatrix(
    [
      { sessionId: 'SES-1', date: '2026-02-01' },
      { sessionId: 'SES-1', date: '2026-02-01' },
      { sessionId: 'SES-2', date: '2026-02-08' }
    ],
    [
      { attendanceStatus: 'present' },
      { attendanceStatus: 'present' },
      { attendanceStatus: 'absent' }
    ]
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].sessionId, 'SES-1');
  assert.equal(rows[1].status, 'absent');
});

test('buildAttendanceHistoryFromAttendanceRecords maps roster attendance rows', () => {
  const rows = buildAttendanceHistoryFromAttendanceRecords([
    { sessionId: 'SES-1', date: '2026-02-01', status: 'late', lateMinutes: 5, earlyLeaveMinutes: 0 },
    { sessionId: 'SES-2', date: '2026-02-08', status: 'present', lateMinutes: 0, earlyLeaveMinutes: 3 }
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].lateMinutes, 5);
  assert.equal(rows[1].earlyLeaveMinutes, 3);
});

test('findMatrixRowForStudent matches studentRecordId when personId differs', () => {
  const matrix = [
    { personId: 'PER-1', studentRecordId: 'STU-9', cells: [] },
    { personId: 'PER-2', studentRecordId: 'STU-2', cells: [] }
  ];
  const row = findMatrixRowForStudent(matrix, { personId: 'PER-OTHER', studentId: 'STU-9' });
  assert.equal(row.studentRecordId, 'STU-9');
});

test('buildEnrollmentMatrixLinks encodes class dates and attendance studentId', () => {
  const links = buildEnrollmentMatrixLinks({
    classId: 'CLS/1',
    startDate: '2026-01-01',
    endDate: '2026-03-01',
    personId: 'PER-1'
  });
  assert.match(links.attendanceMatrixUrl, /^\/school\/attendances\?/);
  assert.match(links.attendanceMatrixUrl, /classId=CLS/);
  assert.match(links.attendanceMatrixUrl, /studentId=PER-1/);
  assert.match(links.attendanceMatrixUrl, /range=allTime/);
  assert.match(links.gradesMatrixUrl, /^\/school\/grades-matrix\?/);
  assert.match(links.gradesMatrixUrl, /startDate=2026-01-01/);
  assert.doesNotMatch(links.gradesMatrixUrl, /studentId=/);
});

test('resolveAttendanceHistoryForMatrixRow prefers attendance records over cells', () => {
  const history = resolveAttendanceHistoryForMatrixRow(
    {
      _attendanceRecords: [{ sessionId: 'SES-1', date: '2026-02-01', status: 'present', lateMinutes: 2, earlyLeaveMinutes: 0 }],
      cells: [{ attendanceStatus: 'absent' }]
    },
    [{ sessionId: 'SES-1', date: '2026-02-01' }],
    [{ attendanceStatus: 'absent' }]
  );
  assert.equal(history.length, 1);
  assert.equal(history[0].status, 'present');
  assert.equal(history[0].lateMinutes, 2);
});

test('class enrollment detail loads full grades matrix window', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(
    path.join(__dirname, '../MVC/services/school/studentEnrollmentDetailService.js'),
    'utf8'
  );
  assert.match(source, /fullMatrix:\s*'1'/);
  assert.match(source, /matrixLinks/);
  assert.match(source, /findMatrixRowForStudent/);
});
