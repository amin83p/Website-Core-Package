'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const enrollmentClaimDisplayService = require('../MVC/services/school/enrollmentClaimDisplayService');
const { SECTIONS, OPERATIONS } = require('../config/accessConstants');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const VIEW_FILES = [
  'packages/school/MVC/views/school/attendance/attendanceViewer.ejs',
  'packages/school/MVC/views/school/attendance/studentAttendanceReportViewer.ejs',
  'packages/school/MVC/views/school/grades/gradesMatrix.ejs',
  'packages/school/MVC/views/school/report/semiMonthlyReportViewer.ejs',
  'packages/school/MVC/views/school/report/conductMatrix.ejs',
  'packages/school/MVC/views/school/report/classConductReport.ejs'
];

const MATRIX_BUILDER_FILES = [
  'packages/school/MVC/controllers/school/gradesMatrixController.js',
  'packages/school/MVC/controllers/school/attendanceController.js',
  'packages/school/MVC/services/school/conductMatrixService.js',
  'packages/school/MVC/services/school/classConductReportService.js',
  'packages/school/MVC/services/school/schoolSemiMonthlyReportService.js'
];

function mockSchoolDataService({ periodRows = [], students = [] } = {}) {
  return {
    async getClassEnrollmentPeriodsByClassId() {
      return periodRows;
    },
    async getClassEnrollmentPeriodsByStudentId() {
      return periodRows;
    },
    async fetchAllData() {
      return students;
    }
  };
}

test('loadClaimsForWindow groups overlapping enrollment claims by label', async () => {
  const students = [{
    id: 'stu-1',
    personId: 'person-1',
    claimNumbers: [
      { id: 'claim-wcb', number: '11111', label: 'WCB' },
      { id: 'claim-ei', number: '22222', label: 'EI' }
    ]
  }];
  const periodRows = [
    {
      studentId: 'stu-1',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      claimNumberId: 'claim-wcb',
      claimNumber: '11111'
    },
    {
      studentId: 'stu-1',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      claimNumberId: 'claim-ei',
      claimNumber: '22222'
    }
  ];
  const claims = await enrollmentClaimDisplayService.loadClaimsForWindow({
    classId: 'class-1',
    startDate: '2026-09-01',
    endDate: '2026-10-31',
    students: [{ personId: 'person-1', studentRecordId: 'stu-1' }],
    requestingUser: { id: 'u1' }
  }, {
    schoolDataService: mockSchoolDataService({ periodRows, students })
  });

  assert.equal(claims['person-1'].displayLine, '11111 WCB, 22222 EI');
  assert.equal(claims['stu-1'].displayLine, claims['person-1'].displayLine);
  assert.equal(claims['person-1'].entries.length, 2);
});

test('loadClaimsForWindow mentions a repeated overlapping claim number once', async () => {
  const students = [{
    id: 'stu-1',
    personId: 'person-1',
    claimNumbers: [
      { id: 'claim-wcb-a', number: '785 5565', label: 'WCB' },
      { id: 'claim-wcb-b', number: '785 5565', label: 'WCB' }
    ]
  }];
  const periodRows = [
    {
      studentId: 'stu-1',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      claimNumberId: 'claim-wcb-a',
      claimNumber: '785 5565'
    },
    {
      studentId: 'stu-1',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      claimNumberId: 'claim-wcb-b',
      claimNumber: '785 5565'
    }
  ];
  const claims = await enrollmentClaimDisplayService.loadClaimsForWindow({
    classId: 'class-1',
    startDate: '2026-09-01',
    endDate: '2026-10-31',
    students: [{ personId: 'person-1', studentRecordId: 'stu-1' }],
    requestingUser: { id: 'u1' }
  }, {
    schoolDataService: mockSchoolDataService({ periodRows, students })
  });

  assert.equal(claims['person-1'].displayLine, '785 5565 WCB');
  assert.equal(claims['person-1'].entries.length, 1);
});

test('loadClaimsForWindow returns empty display line when no overlapping claim', async () => {
  const claims = await enrollmentClaimDisplayService.loadClaimsForWindow({
    classId: 'class-1',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    students: [{ personId: 'person-1', studentRecordId: 'stu-1' }],
    requestingUser: { id: 'u1' }
  }, {
    schoolDataService: mockSchoolDataService({
      periodRows: [{
        studentId: 'stu-1',
        startDate: '2026-11-01',
        endDate: '2026-11-30',
        claimNumber: '99999'
      }],
      students: [{ id: 'stu-1', personId: 'person-1', claimNumbers: [] }]
    })
  });
  assert.equal(claims['person-1'].displayLine, '');
});

test('excuse user is allowed on attendance pages and denied on grades', async () => {
  const deps = {
    userCanMarkAttendanceExcused: async () => true,
    isAdminForRequestAsync: async () => false,
    evaluateAccess: async () => ({ allowed: false })
  };
  const user = { id: 'excuse-user' };
  assert.equal(
    await enrollmentClaimDisplayService.canShowForPage(user, 'attendance-matrix', '', deps),
    true
  );
  assert.equal(
    await enrollmentClaimDisplayService.canShowForPage(user, 'attendance-report', '', deps),
    true
  );
  assert.equal(
    await enrollmentClaimDisplayService.canShowForPage(user, 'grades-matrix', '', deps),
    false
  );
});

test('Family A admin is allowed on gradebook and conduct pages', async () => {
  const deps = {
    userCanMarkAttendanceExcused: async () => false,
    isAdminForRequestAsync: async () => true,
    evaluateAccess: async () => ({ allowed: false })
  };
  const user = { id: 'family-a' };
  assert.equal(await enrollmentClaimDisplayService.canShowForPage(user, 'grades-matrix', '', deps), true);
  assert.equal(await enrollmentClaimDisplayService.canShowForPage(user, 'semi-monthly', '', deps), true);
  assert.equal(await enrollmentClaimDisplayService.canShowForPage(user, 'conduct-matrix', '', deps), true);
  assert.equal(await enrollmentClaimDisplayService.canShowForPage(user, 'conduct-report', '', deps), true);
});

test('organization READ_ALL is allowed on grades and conduct pages', async () => {
  const deps = {
    isAdminForRequestAsync: async () => false,
    evaluateAccess: async () => ({ allowed: true, scopeId: 'SCP_ORG' })
  };
  const user = { id: 'org-reader' };
  assert.equal(
    await enrollmentClaimDisplayService.canShowOnSectionPage(
      user,
      SECTIONS.SCHOOL_GRADEBOOK,
      { operationId: OPERATIONS.READ_ALL },
      deps
    ),
    true
  );
  assert.equal(
    await enrollmentClaimDisplayService.canShowOnSectionPage(
      user,
      SECTIONS.SCHOOL_CLASS_CONDUCT_MATRIX,
      { operationId: OPERATIONS.READ_ALL },
      deps
    ),
    true
  );
});

test('department-only READ_ALL is denied on grades and conduct pages', async () => {
  const deps = {
    isAdminForRequestAsync: async () => false,
    evaluateAccess: async () => ({ allowed: true, scopeId: 'SCP_DEPT' })
  };
  const user = { id: 'dept-reader' };
  assert.equal(
    await enrollmentClaimDisplayService.canShowOnSectionPage(
      user,
      SECTIONS.SCHOOL_GRADEBOOK,
      { operationId: OPERATIONS.READ_ALL },
      deps
    ),
    false
  );
  assert.equal(
    await enrollmentClaimDisplayService.canShowOnSectionPage(
      user,
      SECTIONS.SCHOOL_CLASS_CONDUCT_REPORT,
      { operationId: OPERATIONS.READ },
      deps
    ),
    false
  );
});

test('existing matrix data builders do not fetch enrollment claims', () => {
  MATRIX_BUILDER_FILES.forEach((rel) => {
    const src = read(rel);
    assert.doesNotMatch(src, /enrollment-claims\/api\/window/);
    assert.doesNotMatch(src, /loadClaimsForWindow/);
  });
});

test('claim numbers button is gated by canShowEnrollmentClaims on all six pages', () => {
  VIEW_FILES.forEach((rel) => {
    const src = read(rel);
    assert.match(src, /canShowEnrollmentClaims/);
    assert.match(src, /btn_toggleEnrollmentClaims/);
    assert.match(src, /enrollmentClaimToggle\.js/);
    const buttonIndex = src.indexOf('btn_toggleEnrollmentClaims');
    const flagIndex = src.lastIndexOf('canShowEnrollmentClaims', buttonIndex);
    assert.ok(flagIndex !== -1 && flagIndex < buttonIndex, `${rel} should gate the Claim Numbers button`);
    const manageStart = src.indexOf('manageBtns');
    const manageEnd = src.indexOf('tablePages-start', manageStart);
    if (manageStart !== -1 && manageEnd !== -1) {
      assert.equal(
        src.slice(manageStart, manageEnd).includes('btn_toggleEnrollmentClaims'),
        false,
        `${rel} should not put Claim Numbers on the page toolbar`
      );
    }
  });
});

test('enrollmentClaimToggle lazily posts to enrollment-claims window API', () => {
  const src = read('packages/school/public/scripts/enrollmentClaimToggle.js');
  assert.match(src, /\/school\/enrollment-claims\/api\/window/);
  assert.match(src, /method:\s*'POST'/);
  assert.match(src, /Hide claim numbers/);
  assert.match(src, /js-enrollment-claim-host/);
  assert.match(src, /btn\.innerHTML = '<i class="bi bi-card-text"/);
  assert.match(src, /Load the matrix first/);
});

test('claim numbers buttons are icon-only with tooltip', () => {
  VIEW_FILES.forEach((rel) => {
    const src = read(rel);
    const match = src.match(/id="btn_toggleEnrollmentClaims"[^>]*>[\s\S]*?<\/button>/);
    assert.ok(match, `${rel} should render the claim numbers button`);
    const markup = match[0];
    assert.match(markup, /attendance-legend-icon-btn/);
    assert.match(markup, /aria-label="Show claim numbers"/);
    assert.match(markup, /<i class="bi bi-card-text"/);
    assert.doesNotMatch(markup, /Claim Numbers/);
  });
});

test('matrix pages prompt before loading from a URL query', () => {
  const attendance = read('packages/school/MVC/views/school/attendance/attendanceViewer.ejs');
  const grades = read('packages/school/MVC/views/school/grades/gradesMatrix.ejs');
  const conduct = read('packages/school/public/scripts/conductMatrixClient.js');
  assert.match(attendance, /promptLoadAttendanceMatrixFromUrlLink/);
  assert.match(attendance, /autoLoad:\s*false/);
  assert.doesNotMatch(attendance, /qStart && qEnd[\s\S]{0,180}btn_loadData'\)\.click\(\)/);
  assert.match(grades, /promptLoadGradesMatrixFromUrlLink/);
  assert.doesNotMatch(grades, /setTimeout\(\s*\(\)\s*=>\s*document\.getElementById\('gm_btnLoad'\)\.click\(\)/);
  assert.match(conduct, /promptLoadConductMatrixFromUrlLink/);
  assert.doesNotMatch(conduct, /if \(INITIAL\.classId\) loadMatrix\(\)/);
});

test('enrollment-claims route mounts under school main router', () => {
  const src = read('packages/school/MVC/routes/schoolMainRoute.js');
  assert.match(src, /enrollment-claims/);
  assert.match(src, /enrollmentClaimRoutes/);
  const route = read('packages/school/MVC/routes/enrollmentClaimRoutes.js');
  assert.match(route, /\/api\/window/);
  assert.match(route, /postEnrollmentClaimsWindow/);
  assert.match(route, /requireAuth/);
});
