const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const timesheetModel = require('../packages/school/MVC/models/school/timesheetModel');
const timesheetPayRateService = require('../packages/school/MVC/services/school/timesheetPayRateService');
const timesheetPayrollContextService = require('../packages/school/MVC/services/school/timesheetPayrollContextService');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const schoolPersonAccessService = require('../packages/school/MVC/services/school/schoolPersonAccessService');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const PERIOD = Object.freeze({
  startDate: '2026-07-01',
  endDate: '2026-07-31'
});

test('payroll context resolves dual-role records and account labels', async () => {
  const originalGetPerson = schoolPersonAccessService.getPersonById;
  const originalFetch = schoolDataService.fetchData;

  schoolPersonAccessService.getPersonById = async () => ({
    id: 'P_DUAL',
    displayName: 'Dual Role Person',
    organizations: [{
      orgId: 'ORG1',
      roles: ['school_teacher', 'school_staff'],
      memberStatus: 'active'
    }]
  });

  schoolDataService.fetchData = async (entityType, filters = {}) => {
    if (entityType === 'teachers') {
      return [{
        id: 'TCH_1',
        orgId: 'ORG1',
        personId: 'P_DUAL',
        teacherAccountId: 'ACCT_T',
        compensationProfiles: [{
          id: 'CP_T',
          departmentId: 'DEPT_A',
          paymentMethod: 'hourly',
          hourlyRate: 45,
          effectiveFrom: '2026-01-01',
          effectiveTo: '2026-12-31'
        }]
      }];
    }
    if (entityType === 'staff') {
      return [{
        id: 'STF_1',
        orgId: 'ORG1',
        personId: 'P_DUAL',
        staffAccountId: 'ACCT_S',
        compensationProfiles: [{
          id: 'CP_S',
          departmentId: 'DEPT_A',
          paymentMethod: 'hourly',
          hourlyRate: 30,
          effectiveFrom: '2026-01-01',
          effectiveTo: '2026-12-31'
        }]
      }];
    }
    if (entityType === 'schoolAccounts') {
      return [
        { id: 'ACCT_T', name: 'Teacher Payroll', code: 'T-PAY' },
        { id: 'ACCT_S', name: 'Staff Payroll', code: 'S-PAY' }
      ];
    }
    return [];
  };

  try {
    const context = await timesheetPayrollContextService.resolvePayrollPersonContext({
      orgId: 'ORG1',
      personId: 'P_DUAL',
      reqUser: { activeOrgId: 'ORG1' }
    });

    assert.deepEqual(context.roles, ['teacher', 'staff']);
    assert.equal(context.roleRecords.teacher.roleRecordId, 'TCH_1');
    assert.equal(context.roleRecords.teacher.accountId, 'ACCT_T');
    assert.equal(context.roleRecords.teacher.accountLabel, 'Teacher Payroll');
    assert.equal(context.roleRecords.staff.roleRecordId, 'STF_1');
    assert.equal(context.roleRecords.staff.accountId, 'ACCT_S');
    assert.equal(context.roleRecords.staff.accountLabel, 'Staff Payroll');
    assert.equal(context.defaultRole, 'teacher');
  } finally {
    schoolPersonAccessService.getPersonById = originalGetPerson;
    schoolDataService.fetchData = originalFetch;
  }
});

test('pay rate service resolves hourly compensation profile by role department and period', () => {
  const profiles = [
    {
      id: 'OLD',
      departmentId: 'DEPT_A',
      paymentMethod: 'hourly',
      hourlyRate: 20,
      effectiveFrom: '2025-01-01',
      effectiveTo: '2025-12-31'
    },
    {
      id: 'NEW',
      departmentId: 'DEPT_A',
      paymentMethod: 'hourly',
      hourlyRate: 55,
      effectiveFrom: '2026-06-01',
      effectiveTo: '2026-12-31'
    },
    {
      id: 'SALARY',
      departmentId: 'DEPT_A',
      paymentMethod: 'salary',
      hourlyRate: 999,
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31'
    }
  ];

  const resolved = timesheetPayRateService.resolveHourlyRate({
    compensationProfiles: profiles,
    departmentId: 'DEPT_A',
    period: PERIOD
  });

  assert.equal(resolved.profileId, 'NEW');
  assert.equal(resolved.hourlyRate, 55);
  assert.equal(timesheetPayRateService.computeGrossPay(4, 55), 220);
});

test('stampEntryPayrollFields splits teacher and staff lines and defaults legacy rows to teacher', () => {
  const payrollContext = {
    roles: ['teacher', 'staff'],
    defaultRole: 'teacher',
    roleRecords: {
      teacher: {
        roleRecordId: 'TCH_1',
        accountId: 'ACCT_T',
        compensationProfiles: [{
          departmentId: 'DEPT_A',
          paymentMethod: 'hourly',
          hourlyRate: 40,
          effectiveFrom: '2026-01-01',
          effectiveTo: '2026-12-31'
        }]
      },
      staff: {
        roleRecordId: 'STF_1',
        accountId: 'ACCT_S',
        compensationProfiles: [{
          departmentId: 'DEPT_A',
          paymentMethod: 'hourly',
          hourlyRate: 25,
          effectiveFrom: '2026-01-01',
          effectiveTo: '2026-12-31'
        }]
      }
    }
  };

  const teacherStamp = timesheetPayrollContextService.stampEntryPayrollFields({
    entry: { deliveryDepartmentId: 'DEPT_A', personRole: 'teacher' },
    payrollContext,
    period: PERIOD,
    payRateService: timesheetPayRateService,
    hours: 2
  });
  const staffStamp = timesheetPayrollContextService.stampEntryPayrollFields({
    entry: { deliveryDepartmentId: 'DEPT_A', personRole: 'staff', isManual: true },
    payrollContext,
    period: PERIOD,
    payRateService: timesheetPayRateService,
    hours: 3
  });
  const legacyStamp = timesheetPayrollContextService.stampEntryPayrollFields({
    entry: { deliveryDepartmentId: 'DEPT_A' },
    payrollContext,
    period: PERIOD,
    payRateService: timesheetPayRateService,
    hours: 1
  });

  assert.equal(teacherStamp.personRole, 'teacher');
  assert.equal(teacherStamp.roleRecordId, 'TCH_1');
  assert.equal(teacherStamp.payrollAccountId, 'ACCT_T');
  assert.equal(teacherStamp.grossPay, 80);

  assert.equal(staffStamp.personRole, 'staff');
  assert.equal(staffStamp.roleRecordId, 'STF_1');
  assert.equal(staffStamp.payrollAccountId, 'ACCT_S');
  assert.equal(staffStamp.grossPay, 75);

  assert.equal(legacyStamp.personRole, 'teacher');
  assert.equal(legacyStamp.grossPay, 40);
});

test('resolveRoleForEntry honors activity assignee role and class defaults', () => {
  const payrollContext = {
    roles: ['teacher', 'staff'],
    defaultRole: 'teacher'
  };

  assert.equal(timesheetPayrollContextService.resolveRoleForEntry({
    payrollContext,
    requestedRole: 'staff',
    source: 'activity'
  }), 'staff');

  assert.equal(timesheetPayrollContextService.resolveRoleForEntry({
    payrollContext,
    requestedRole: '',
    source: 'class'
  }), 'teacher');

  const staffOnly = { roles: ['staff'], defaultRole: 'staff' };
  assert.equal(timesheetPayrollContextService.resolveRoleForEntry({
    payrollContext: staffOnly,
    requestedRole: '',
    source: 'activity'
  }), 'staff');
});

test('timesheet model persists payroll fields on entries', () => {
  const payload = timesheetModel.sanitizeTimesheetPayload({
    orgId: 'ORG1',
    periodId: 'TSP_1',
    teacherId: 'P_DUAL',
    status: 'draft',
    entries: [{
      sessionId: 'MAN_ROLE',
      date: '2026-07-10',
      className: 'Staff manual line',
      hours: 2,
      isManual: true,
      personRole: 'staff',
      roleRecordId: 'STF_1',
      payrollAccountId: 'ACCT_S',
      grossPay: 50
    }]
  });

  assert.equal(payload.entries[0].personRole, 'staff');
  assert.equal(payload.entries[0].roleRecordId, 'STF_1');
  assert.equal(payload.entries[0].payrollAccountId, 'ACCT_S');
  assert.equal(payload.entries[0].grossPay, 50);
});

test('timesheet editor and controller require payroll role for multi-role manual entries', () => {
  const editor = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');

  assert.match(editor, /div_man_payrollRole/);
  assert.match(editor, /PAYROLL_ROLES/);
  assert.match(editor, /resolveManualPersonRole/);
  assert.match(editor, /personRole/);
  assert.match(editor, /payrollRoleBadge/);
  assert.match(editor, /Payroll setup warnings/);

  assert.match(controller, /timesheetPayrollContextService/);
  assert.match(controller, /withPayrollStamp/);
  assert.match(controller, /Manual entries require a payroll role when the person has multiple teacher\/staff roles/);
  assert.match(controller, /\$\{personRole\}::/);
});

test('activity timesheet entries include assignee payroll role hint', () => {
  const source = read('packages/school/MVC/services/school/activityService.js');
  assert.match(source, /resolveActivityEntryPersonRole/);
  assert.match(source, /personRole: resolveActivityEntryPersonRole\(attendee\)/);
});
