const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const wizard = require('../MVC/services/school/semiMonthlyReportAssignmentWizardService');

const classes = [
  { id: 'CLS_1', title: 'Morning', orgId: 'ORG', allowedProgramTerms: [{ programId: 'PRG_1' }] },
  { id: 'CLS_2', title: 'Afternoon', orgId: 'ORG', allowedProgramTerms: [{ programId: 'PRG_2' }] }
];

const assignments = [
  { id: 'ASG_1', classId: 'CLS_1', orgId: 'ORG', reportScope: 'class' },
  { id: 'ASG_2', classId: 'CLS_1', orgId: 'ORG', reportScope: 'each_student' },
  { id: 'ASG_3', classId: 'CLS_2', orgId: 'ORG', reportScope: 'class' }
];

test('program count includes only assignment classes for that program and scope', () => {
  const count = wizard.countClassesForProgram({
    assignments,
    classes,
    reportScope: 'class',
    programId: 'PRG_1'
  });
  assert.equal(count, 1);
  const otherScope = wizard.countClassesForProgram({
    assignments,
    classes,
    reportScope: 'each_student',
    programId: 'PRG_2'
  });
  assert.equal(otherScope, 0);
});

test('verified end date walks back to a day every class has a session, inside the same month', () => {
  const sessionsByClassId = {
    CLS_1: [
      { sessionId: 'S1', date: '2026-06-03', startTime: '09:00', endTime: '11:00', status: 'scheduled' },
      { sessionId: 'S2', date: '2026-06-04', startTime: '09:00', endTime: '11:00', status: 'scheduled' }
    ],
    CLS_2: [
      { sessionId: 'S3', date: '2026-06-04', startTime: '13:00', endTime: '15:00', status: 'scheduled' }
    ]
  };
  const adjusted = wizard.resolveVerifiedEndDate({
    startDate: '2026-06-01',
    endDate: '2026-06-05',
    sessionsByClassId
  });
  assert.equal(adjusted.ok, true);
  assert.equal(adjusted.verifiedEndDate, '2026-06-04');
  assert.equal(adjusted.adjusted, true);

  const sameMonth = wizard.resolveVerifiedEndDate({
    startDate: '2026-05-20',
    endDate: '2026-06-05',
    sessionsByClassId
  });
  assert.equal(sameMonth.ok, false);

  const none = wizard.resolveVerifiedEndDate({
    startDate: '2026-06-01',
    endDate: '2026-06-02',
    sessionsByClassId
  });
  assert.equal(none.ok, false);
});

test('task window is the last requested hours of the session', () => {
  const window = wizard.taskWindowBeforeSessionEnd({
    startTime: '09:00',
    endTime: '11:00'
  }, 1);
  assert.equal(window.ok, true);
  assert.equal(window.taskStartTime, '10:00');
  assert.equal(window.taskEndTime, '11:00');

  const tooLong = wizard.taskWindowBeforeSessionEnd({
    startTime: '09:00',
    endTime: '09:30'
  }, 1);
  assert.equal(tooLong.ok, false);
});

test('apply creates one assignment for the latest session on the verified date', async (t) => {
  const created = [];
  wizard.__setDependenciesForTest({
    schoolDataService: {
      getDataById: async () => ({ id: 'CLS_1', title: 'Morning', orgId: 'ORG' }),
      getClassSessions: async () => ([
        { sessionId: 'EARLY', date: '2026-06-04', startTime: '09:00', endTime: '10:00', status: 'scheduled', roster: [] },
        { sessionId: 'LATE', date: '2026-06-04', startTime: '13:00', endTime: '15:00', status: 'scheduled', roster: [{ personId: 'PER_1' }] }
      ])
    },
    sessionReportAssignmentService: {
      createAssignmentForSession: async (args) => {
        created.push(args);
        return { assignment: { id: 'ASG_NEW' }, message: 'assigned' };
      }
    }
  });
  t.after(() => wizard.__resetDependenciesForTest());

  const result = await wizard.applyClassTemplate({
    classId: 'CLS_1',
    templateId: 'TPL_1',
    reportScope: 'class',
    reportStartDate: '2026-06-01',
    verifiedEndDate: '2026-06-04',
    hoursBeforeEnd: 1,
    conflictPermitted: true,
    timesheetReflection: true,
    conductRequiredBeforeFill: true,
    allocatedHours: 1,
    reqUser: { id: 'USER_1', activeOrgId: 'ORG' }
  });

  assert.equal(result.assignmentId, 'ASG_NEW');
  assert.equal(created.length, 1);
  assert.equal(created[0].session.sessionId, 'LATE');
  assert.equal(created[0].input.taskStartTime, '14:00');
  assert.equal(created[0].input.taskEndTime, '15:00');
  assert.equal(created[0].input.templateId, 'TPL_1');
});

test('semi-monthly wizard is linked from report assignments', () => {
  const list = fs.readFileSync(path.join(__dirname, '../MVC/views/school/report/assignmentList.ejs'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../MVC/routes/reportRoutes.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../MVC/views/school/report/semiMonthlyAssignmentWizard.ejs'), 'utf8');
  assert.match(list, /semi-monthly-wizard/);
  assert.match(routes, /\/assignments\/semi-monthly-wizard\/apply/);
  assert.match(page, /smmrReportScope/);
  assert.match(page, /wizard-step-rail/);
  assert.match(page, /smmrWizardProgressBar/);
  assert.match(page, /semiMonthlyReportAssignmentWizard\.js/);
  const script = fs.readFileSync(path.join(__dirname, '../public/scripts/semiMonthlyReportAssignmentWizard.js'), 'utf8');
  assert.match(script, /showLoading/);
  assert.match(script, /Preparing class sessions for the verified date/);
  assert.match(script, /Eligible Sessions/);
  const service = fs.readFileSync(path.join(__dirname, '../MVC/services/school/semiMonthlyReportAssignmentWizardService.js'), 'utf8');
  assert.match(service, /eligibleSessionCount/);
});
