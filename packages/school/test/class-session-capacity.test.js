const test = require('node:test');
const assert = require('node:assert/strict');

const classSessionCapacityService = require('../MVC/services/school/classSessionCapacityService');
const sessionStatusPolicyService = require('../MVC/services/school/sessionStatusPolicyService');

test('resolveClassMaxCapacity reads enrollment.maxCapacity and aliases', () => {
  assert.equal(classSessionCapacityService.resolveClassMaxCapacity({ enrollment: { maxCapacity: 4 } }), 4);
  assert.equal(classSessionCapacityService.resolveClassMaxCapacity({ maxCapacity: 2 }), 2);
  assert.equal(classSessionCapacityService.resolveClassMaxCapacity({ capacity: 3 }), 3);
  assert.equal(classSessionCapacityService.resolveClassMaxCapacity({ studentCapacity: 5 }), 5);
});

test('resolveIsOneOnOne uses maxCapacity === 1', () => {
  assert.equal(classSessionCapacityService.resolveIsOneOnOne({
    classData: { enrollment: { maxCapacity: 1 } },
    enrollmentStudentCount: 5
  }), true);
});

test('resolveIsOneOnOne uses single enrollment student', () => {
  assert.equal(classSessionCapacityService.resolveIsOneOnOne({
    classData: { enrollment: { maxCapacity: 10 } },
    enrollmentStudentCount: 1
  }), true);
  assert.equal(classSessionCapacityService.resolveIsOneOnOne({
    classData: { enrollment: { maxCapacity: 10 } },
    enrollmentStudentCount: 2
  }), false);
});

test('buildEnrollmentStudentContext marks one student as one-on-one', () => {
  const ctx = classSessionCapacityService.buildEnrollmentStudentContext(new Set(['STU_1']));
  assert.equal(ctx.isOneOnOne, true);
  assert.equal(ctx.singleStudentId, 'STU_1');
});

test('resolveCapacityModeFromIsOneOnOne maps modes', () => {
  assert.equal(classSessionCapacityService.resolveCapacityModeFromIsOneOnOne(true), 'one_on_one');
  assert.equal(classSessionCapacityService.resolveCapacityModeFromIsOneOnOne(false), 'group');
});

test('isDepartmentOneOnOneEntry excludes activities and honors flags', () => {
  assert.equal(classSessionCapacityService.isDepartmentOneOnOneEntry({
    sessionId: 'act-123',
    isOneOnOne: true
  }, {}), false);
  assert.equal(classSessionCapacityService.isDepartmentOneOnOneEntry({
    sessionId: 'SES_1',
    classMaxCapacity: 1
  }, {}), true);
  assert.equal(classSessionCapacityService.isDepartmentOneOnOneEntry({
    sessionId: 'SES_1',
    isOneOnOne: true
  }, { enrollment: { maxCapacity: 8 } }), true);
});

test('normalizeClassCapacity defaults missing values to both', () => {
  assert.equal(sessionStatusPolicyService.normalizeClassCapacity(''), 'both');
  assert.equal(sessionStatusPolicyService.normalizeClassCapacity('group'), 'group');
  assert.equal(sessionStatusPolicyService.normalizeClassCapacity('one_on_one'), 'one_on_one');
  assert.equal(sessionStatusPolicyService.normalizeClassCapacity('1 on 1'), 'one_on_one');
});

test('filterSelectableStatusMetaByCapacity filters by session capacity mode', () => {
  const meta = [
    { code: 'scheduled', classCapacity: 'both' },
    { code: 'solo_only', classCapacity: 'one_on_one' },
    { code: 'group_only', classCapacity: 'group' }
  ];
  const oneOnOne = sessionStatusPolicyService.filterSelectableStatusMetaByCapacity(meta, { capacityMode: 'one_on_one' });
  assert.deepEqual(oneOnOne.map((row) => row.code), ['scheduled', 'solo_only']);
  const group = sessionStatusPolicyService.filterSelectableStatusMetaByCapacity(meta, { capacityMode: 'group' });
  assert.deepEqual(group.map((row) => row.code), ['scheduled', 'group_only']);
});

test('assertStatusSelectableByAccess rejects capacity mismatch', () => {
  const statusMap = new Map([
    ['solo_only', { code: 'solo_only', accessType: 'users', classCapacity: 'one_on_one' }]
  ]);
  assert.throws(() => {
    sessionStatusPolicyService.assertStatusSelectableByAccess('solo_only', statusMap, {
      allowAdminStatuses: false,
      capacityMode: 'group'
    });
  }, /not available for this session capacity type/i);
});

test('normalizeSessionCapacityType defaults missing values to group', () => {
  assert.equal(classSessionCapacityService.normalizeSessionCapacityType(''), 'group');
  assert.equal(classSessionCapacityService.normalizeSessionCapacityType('group'), 'group');
  assert.equal(classSessionCapacityService.normalizeSessionCapacityType('one_on_one'), 'one_on_one');
  assert.equal(classSessionCapacityService.normalizeSessionCapacityType('1 on 1'), 'one_on_one');
});

test('resolveSessionMaxStudents returns 1 for capacity-1 classes', () => {
  assert.equal(classSessionCapacityService.resolveSessionMaxStudents({ enrollment: { maxCapacity: 1 } }), 1);
  assert.equal(classSessionCapacityService.resolveSessionMaxStudents({ enrollment: { maxCapacity: 8 } }), 8);
  assert.equal(classSessionCapacityService.resolveSessionMaxStudents({ enrollment: { maxCapacity: 0 } }), 0);
});

test('resolveEffectiveSessionCapacityType forces one_on_one for rolling capacity-1', () => {
  const rollingCapacityOne = { registrationMode: 'rolling', enrollment: { maxCapacity: 1 } };
  assert.equal(
    classSessionCapacityService.resolveEffectiveSessionCapacityType(rollingCapacityOne, 'group'),
    'one_on_one'
  );
  assert.equal(
    classSessionCapacityService.resolveEffectiveSessionCapacityType(
      { registrationMode: 'rolling', enrollment: { maxCapacity: 8 } },
      'group'
    ),
    'group'
  );
});

test('shouldSkipClassLevelCapacityLimit is true only for rolling capacity-1', () => {
  assert.equal(
    classSessionCapacityService.shouldSkipClassLevelCapacityLimit({
      registrationMode: 'rolling',
      enrollment: { maxCapacity: 1 }
    }),
    true
  );
  assert.equal(
    classSessionCapacityService.shouldSkipClassLevelCapacityLimit({
      registrationMode: 'rolling',
      enrollment: { maxCapacity: 8 }
    }),
    false
  );
  assert.equal(
    classSessionCapacityService.shouldSkipClassLevelCapacityLimit({
      registrationMode: 'term_based',
      enrollment: { maxCapacity: 1 }
    }),
    false
  );
});

test('resolveRollingSessionCapacityFromEnrollment uses class maxCapacity for rolling capacity-1', () => {
  const rollingCapacityOne = { registrationMode: 'rolling', enrollment: { maxCapacity: 1 } };
  const sessionOneStudent = {
    date: '2026-03-01',
    roster: [{ personId: 'PER_1' }]
  };
  const periodsGroup = [{
    studentId: 'STU_1',
    status: 'active',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    sessionCapacityType: 'group'
  }];

  assert.equal(classSessionCapacityService.resolveRollingSessionCapacityFromEnrollment({
    classData: rollingCapacityOne,
    session: sessionOneStudent,
    enrollmentPeriods: periodsGroup,
    studentToPersonMap: new Map([['STU_1', 'PER_1']])
  }), 'one_on_one');
});

test('resolveRollingSessionCapacityFromEnrollment uses roster and enrollment period', () => {
  const studentToPersonMap = new Map([['STU_1', 'PER_1']]);
  const sessionOneStudent = {
    date: '2026-03-01',
    roster: [{ personId: 'PER_1' }]
  };
  const sessionTwoStudents = {
    date: '2026-03-01',
    roster: [{ personId: 'PER_1' }, { personId: 'PER_2' }]
  };
  const periodsOneOnOne = [{
    studentId: 'STU_1',
    status: 'active',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    sessionCapacityType: 'one_on_one'
  }];
  const periodsGroup = [{
    studentId: 'STU_1',
    status: 'active',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    sessionCapacityType: 'group'
  }];

  assert.equal(classSessionCapacityService.resolveRollingSessionCapacityFromEnrollment({
    session: sessionOneStudent,
    enrollmentPeriods: periodsOneOnOne,
    studentToPersonMap
  }), 'one_on_one');
  assert.equal(classSessionCapacityService.resolveRollingSessionCapacityFromEnrollment({
    session: sessionTwoStudents,
    enrollmentPeriods: periodsOneOnOne,
    studentToPersonMap
  }), 'group');
  assert.equal(classSessionCapacityService.resolveRollingSessionCapacityFromEnrollment({
    session: sessionOneStudent,
    enrollmentPeriods: periodsGroup,
    studentToPersonMap
  }), 'group');
  assert.equal(classSessionCapacityService.resolveRollingSessionCapacityFromEnrollment({
    session: sessionOneStudent,
    enrollmentPeriods: [{ ...periodsGroup[0], sessionCapacityType: undefined }],
    studentToPersonMap
  }), 'group');
});

test('resolveSessionOneOnOneContext keeps term class rules for non-rolling classes', () => {
  const termContext = classSessionCapacityService.resolveIsOneOnOne({
    classData: { registrationMode: 'term_based', enrollment: { maxCapacity: 10 } },
    enrollmentStudentCount: 1
  });
  assert.equal(termContext, true);
});

test('resolveSessionOneOnOneContext rolling branch resolves from roster enrollment', async () => {
  const rollingClass = { id: 'CLS_ROLL', registrationMode: 'rolling', enrollment: { maxCapacity: 8 } };
  const session = {
    date: '2026-03-01',
    roster: [{ personId: 'PER_1' }]
  };
  const studentToPersonMap = new Map([['STU_1', 'PER_1']]);
  const enrollmentPeriods = [{
    studentId: 'STU_1',
    status: 'active',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    sessionCapacityType: 'one_on_one'
  }];

  const context = await classSessionCapacityService.resolveSessionOneOnOneContext({
    classData: rollingClass,
    session,
    studentToPersonMap,
    enrollmentPeriods
  });

  assert.equal(context.capacityMode, 'one_on_one');
  assert.equal(context.isOneOnOne, true);
});

test('timesheet enrichClassLiveSessions uses central per-session capacity resolver', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const timesheetLabelSource = fs.readFileSync(
    path.join(__dirname, '../MVC/services/school/timesheetSessionStudentLabelService.js'),
    'utf8'
  );
  assert.match(timesheetLabelSource, /resolveSessionOneOnOneContext\(/);
  assert.match(timesheetLabelSource, /enrollmentPeriodsByClassId/);
  assert.doesNotMatch(timesheetLabelSource, /buildPeriodClassStudentContextById\(relevantClassRows/);
});
