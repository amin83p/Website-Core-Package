const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const wizard = require('../MVC/services/school/semiMonthlyReportAssignmentWizardService');
const sessionReportAssignmentService = require('../MVC/services/school/sessionReportAssignmentService');

const classes = [
  { id: 'CLS_1', title: 'Morning', orgId: 'ORG', allowedProgramTerms: [{ programId: 'PRG_1' }] },
  { id: 'CLS_2', title: 'Afternoon', orgId: 'ORG', allowedProgramTerms: [{ programId: 'PRG_2' }] }
];

const assignments = [
  { id: 'ASG_1', classId: 'CLS_1', orgId: 'ORG', reportScope: 'class' },
  { id: 'ASG_2', classId: 'CLS_1', orgId: 'ORG', reportScope: 'each_student' },
  { id: 'ASG_3', classId: 'CLS_2', orgId: 'ORG', reportScope: 'class' }
];

test('program count includes classes linked to the program', () => {
  const count = wizard.countClassesForProgram({
    classes,
    programId: 'PRG_1'
  });
  assert.equal(count, 1);
  const otherProgram = wizard.countClassesForProgram({
    classes,
    programId: 'PRG_2'
  });
  assert.equal(otherProgram, 1);
});

test('pickClosestSessionNearPeriodEnd matches per class within five days of period end', () => {
  const sessionsA = [
    { sessionId: 'S1', date: '2026-06-03', startTime: '09:00', endTime: '11:00', status: 'scheduled' }
  ];
  const sessionsB = [
    { sessionId: 'S3', date: '2026-06-05', startTime: '13:00', endTime: '15:00', status: 'scheduled' }
  ];
  const pickA = wizard.pickClosestSessionNearPeriodEnd(sessionsA, '2026-06-01', '2026-06-05');
  const pickB = wizard.pickClosestSessionNearPeriodEnd(sessionsB, '2026-06-01', '2026-06-05');
  assert.equal(pickA.matchedDate, '2026-06-03');
  assert.equal(pickA.daysFromEnd, 2);
  assert.equal(pickA.session.sessionId, 'S1');
  assert.equal(pickB.matchedDate, '2026-06-05');
  assert.equal(pickB.daysFromEnd, 0);
  assert.equal(pickB.session.sessionId, 'S3');

  const onlyEarlierInPeriod = wizard.pickClosestSessionNearPeriodEnd(
    [{ sessionId: 'OLD', date: '2026-06-01', startTime: '09:00', endTime: '11:00', status: 'scheduled' }],
    '2026-06-01',
    '2026-06-10'
  );
  assert.equal(onlyEarlierInPeriod, null);
});

test('resolveVerifiedEndDate uses period end and per-class session matching', () => {
  const sessionsByClassId = {
    CLS_1: [
      { sessionId: 'S1', date: '2026-06-03', startTime: '09:00', endTime: '11:00', status: 'scheduled' },
      { sessionId: 'S2', date: '2026-06-04', startTime: '09:00', endTime: '11:00', status: 'scheduled' }
    ],
    CLS_2: [
      { sessionId: 'S3', date: '2026-06-04', startTime: '13:00', endTime: '15:00', status: 'scheduled' }
    ]
  };
  const resolved = wizard.resolveVerifiedEndDate({
    startDate: '2026-06-01',
    endDate: '2026-06-05',
    sessionsByClassId
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.verifiedEndDate, '2026-06-05');
  assert.equal(resolved.adjusted, false);
  assert.equal(resolved.classesMatchedNearEnd, 2);

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

  const skipsClassWithNoSessionsInRange = wizard.resolveVerifiedEndDate({
    startDate: '2026-06-01',
    endDate: '2026-06-05',
    sessionsByClassId: {
      CLS_1: sessionsByClassId.CLS_1,
      CLS_2: sessionsByClassId.CLS_2,
      CLS_IDLE: []
    }
  });
  assert.equal(skipsClassWithNoSessionsInRange.ok, true);
  assert.equal(skipsClassWithNoSessionsInRange.verifiedEndDate, '2026-06-05');
  assert.equal(skipsClassWithNoSessionsInRange.classesWithoutSessionsInRange, 1);
});

test('previewTiles picks nearest session per class near period end', async (t) => {
  wizard.__setDependenciesForTest({
    schoolDataService: {
      getClassSessions: async (classId) => {
        if (classId === 'CLS_1') {
          return [{ sessionId: 'S1', date: '2026-06-03', startTime: '09:00', endTime: '11:00', status: 'scheduled' }];
        }
        return [{ sessionId: 'S2', date: '2026-06-05', startTime: '13:00', endTime: '15:00', status: 'scheduled' }];
      },
      fetchAllData: async (type) => {
        if (type === 'classes') {
          return classes;
        }
        if (type === 'reportAssignments') {
          return assignments;
        }
        return [];
      },
      getDataById: async (type, id) => {
        if (type === 'reportTemplates') {
          return { id, title: 'Template', allowedReportScopes: ['class', 'each_student', 'selected_students'] };
        }
        return null;
      }
    },
    reportViewService: { buildPersonNameMap: async () => ({}) },
    reportAssignmentStudentEligibilityService: {
      resolveEligibleStudentsForAssignment: async () => []
    },
    semiMonthlyReportPolicyModel: {
      getPolicyForOrg: async () => ({ reportTemplateIds: ['TPL_1'] })
    }
  });
  t.after(() => wizard.__resetDependenciesForTest());

  const preview = await wizard.previewTiles({
    reportScope: 'class',
    programIds: ['PRG_1', 'PRG_2'],
    startDate: '2026-06-01',
    endDate: '2026-06-05',
    verifiedEndDate: '2026-06-05',
    reqUser: { activeOrgId: 'ORG' }
  });

  const byId = Object.fromEntries(preview.classes.map((row) => [row.classId, row]));
  assert.equal(byId.CLS_1.sessionDate, '2026-06-03');
  assert.equal(byId.CLS_1.sessionMatchDaysFromEnd, 2);
  assert.equal(byId.CLS_1.taskStartTime, '09:00');
  assert.equal(byId.CLS_1.taskEndTime, '11:00');
  assert.equal(byId.CLS_2.sessionDate, '2026-06-05');
  assert.equal(byId.CLS_2.sessionMatchDaysFromEnd, 0);
  assert.equal(byId.CLS_2.taskStartTime, '13:00');
  assert.equal(byId.CLS_2.taskEndTime, '15:00');
  assert.equal(preview.sessionLookbackDays, wizard.MAX_SESSION_LOOKBACK_DAYS);
});

test('resolveTemplateIdForClass prefers existing assignment template', () => {
  const templates = [{ id: 'TPL_A', title: 'A' }, { id: 'TPL_B', title: 'B' }];
  assert.equal(wizard.resolveTemplateIdForClass({
    existingAssignment: { templateId: 'TPL_EXISTING' },
    templates,
    requestedTemplateId: 'TPL_B'
  }), 'TPL_EXISTING');
  assert.equal(wizard.resolveTemplateIdForClass({
    templates,
    requestedTemplateId: 'TPL_B'
  }), 'TPL_B');
  assert.equal(wizard.resolveTemplateIdForClass({
    templates,
    requestedTemplateId: 'TPL_INVALID'
  }), 'TPL_A');
  assert.throws(() => wizard.resolveTemplateIdForClass({ templates: [] }), /No report templates/);
});

test('countClassesForProgram respects class capacity target', () => {
  const rows = [
    { id: 'CLS_G', allowedProgramTerms: [{ programId: 'PRG_1' }], enrollment: { maxCapacity: 8 } },
    { id: 'CLS_1', allowedProgramTerms: [{ programId: 'PRG_1' }], enrollment: { maxCapacity: 1 } }
  ];
  assert.equal(wizard.countClassesForProgram({ classes: rows, programId: 'PRG_1', classCapacityTarget: 'all' }), 2);
  assert.equal(wizard.countClassesForProgram({ classes: rows, programId: 'PRG_1', classCapacityTarget: 'group' }), 1);
  assert.equal(wizard.countClassesForProgram({ classes: rows, programId: 'PRG_1', classCapacityTarget: 'one_on_one' }), 1);
  assert.equal(wizard.classMatchesCapacityTarget(rows[1], 'one_on_one'), true);
  assert.equal(wizard.classMatchesCapacityTarget(rows[0], 'group'), true);
});

test('findActiveTargetRowsForSession returns active rows for matched session only', () => {
  const assignment = {
    targetRows: [
      { sessionId: 'S1', status: 'active', reportStartDate: '2026-06-01' },
      { sessionId: 'S2', status: 'active', reportStartDate: '2026-06-01' },
      { sessionId: 'S1', status: 'inactive', reportStartDate: '2026-05-01' }
    ]
  };
  const rows = sessionReportAssignmentService.findActiveTargetRowsForSession(assignment, 'S1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reportStartDate, '2026-06-01');
  const summary = sessionReportAssignmentService.summarizeSessionTargetRowsForPreview(rows);
  assert.equal(summary[0].reportStartDate, '2026-06-01');
});

test('previewTiles flags classes with existing session target rows', async (t) => {
  wizard.__setDependenciesForTest({
    schoolDataService: {
      getClassSessions: async () => ([
        { sessionId: 'S1', date: '2026-06-05', startTime: '09:00', endTime: '11:00', status: 'scheduled' }
      ]),
      fetchAllData: async (type) => {
        if (type === 'classes') return [classes[0]];
        if (type === 'reportAssignments') {
          return [{
            id: 'ASG_1',
            classId: 'CLS_1',
            orgId: 'ORG',
            reportScope: 'class',
            targetRows: [{
              sessionId: 'S1',
              status: 'active',
              reportStartDate: '2026-06-01',
              reportDueDate: '2026-06-05',
              taskStartTime: '09:00',
              taskEndTime: '11:00'
            }]
          }];
        }
        return [];
      },
      getDataById: async (type, id) => {
        if (type === 'reportTemplates') {
          return { id: 'TPL_1', title: 'Template', allowedReportScopes: ['class', 'each_student'] };
        }
        return null;
      }
    },
    reportViewService: { buildPersonNameMap: async () => ({}) },
    reportAssignmentStudentEligibilityService: {
      resolveEligibleStudentsForAssignment: async () => []
    },
    semiMonthlyReportPolicyModel: {
      getPolicyForOrg: async () => ({ reportTemplateIds: ['TPL_1'] })
    }
  });
  t.after(() => wizard.__resetDependenciesForTest());

  const preview = await wizard.previewTiles({
    reportScope: 'class',
    programIds: ['PRG_1'],
    startDate: '2026-06-01',
    endDate: '2026-06-05',
    reqUser: { activeOrgId: 'ORG' }
  });
  assert.equal(preview.classes[0].hasExistingSessionTargetRow, true);
  assert.equal(preview.classes[0].existingSessionTargetRows.length, 1);
  assert.equal(preview.classes[0].existingSessionTargetRows[0].taskStartTime, '09:00');
});

test('previewTiles filters templates by report scope', async (t) => {
  wizard.__setDependenciesForTest({
    schoolDataService: {
      getClassSessions: async () => ([
        { sessionId: 'S1', date: '2026-06-05', startTime: '09:00', endTime: '11:00', status: 'scheduled' }
      ]),
      fetchAllData: async (type) => {
        if (type === 'classes') return [classes[0]];
        if (type === 'reportAssignments') return [];
        return [];
      },
      getDataById: async (type, id) => {
        if (type === 'reportTemplates' && id === 'TPL_CLASS') {
          return { id: 'TPL_CLASS', title: 'Class only', allowedReportScopes: ['class'] };
        }
        if (type === 'reportTemplates' && id === 'TPL_EACH') {
          return { id: 'TPL_EACH', title: 'Each student', allowedReportScopes: ['each_student'] };
        }
        if (type === 'reportTemplates') {
          return { id, title: 'Template' };
        }
        return null;
      }
    },
    reportViewService: { buildPersonNameMap: async () => ({}) },
    reportAssignmentStudentEligibilityService: {
      resolveEligibleStudentsForAssignment: async () => []
    },
    semiMonthlyReportPolicyModel: {
      getPolicyForOrg: async () => ({ reportTemplateIds: ['TPL_CLASS', 'TPL_EACH'] })
    }
  });
  t.after(() => wizard.__resetDependenciesForTest());

  const preview = await wizard.previewTiles({
    reportScope: 'each_student',
    programIds: ['PRG_1'],
    startDate: '2026-06-01',
    endDate: '2026-06-05',
    reqUser: { activeOrgId: 'ORG' }
  });
  assert.equal(preview.templates.length, 1);
  assert.equal(preview.templates[0].id, 'TPL_EACH');
  assert.equal(preview.classes[0].defaultTemplateId, 'TPL_EACH');
});

test('previewTiles filters classes by capacity target', async (t) => {
  const mixedClasses = [
    { id: 'CLS_G', title: 'Group', orgId: 'ORG', allowedProgramTerms: [{ programId: 'PRG_1' }], enrollment: { maxCapacity: 10 } },
    { id: 'CLS_1', title: 'Solo', orgId: 'ORG', allowedProgramTerms: [{ programId: 'PRG_1' }], enrollment: { maxCapacity: 1 } }
  ];
  wizard.__setDependenciesForTest({
    schoolDataService: {
      getClassSessions: async () => ([
        { sessionId: 'S1', date: '2026-06-05', startTime: '09:00', endTime: '11:00', status: 'scheduled' }
      ]),
      fetchAllData: async (type) => {
        if (type === 'classes') return mixedClasses;
        if (type === 'reportAssignments') return [];
        return [];
      },
      getDataById: async (type, id) => {
        if (type === 'reportTemplates') {
          return { id: 'TPL_1', title: 'Template', allowedReportScopes: ['class', 'each_student'] };
        }
        return null;
      }
    },
    reportViewService: { buildPersonNameMap: async () => ({}) },
    reportAssignmentStudentEligibilityService: {
      resolveEligibleStudentsForAssignment: async () => []
    },
    semiMonthlyReportPolicyModel: {
      getPolicyForOrg: async () => ({ reportTemplateIds: ['TPL_1'] })
    }
  });
  t.after(() => wizard.__resetDependenciesForTest());

  const groupOnly = await wizard.previewTiles({
    reportScope: 'class',
    programIds: ['PRG_1'],
    classCapacityTarget: 'group',
    startDate: '2026-06-01',
    endDate: '2026-06-05',
    reqUser: { activeOrgId: 'ORG' }
  });
  assert.equal(groupOnly.classCapacityTarget, 'group');
  assert.equal(groupOnly.classes.length, 1);
  assert.equal(groupOnly.classes[0].classId, 'CLS_G');

  const soloOnly = await wizard.previewTiles({
    reportScope: 'class',
    programIds: ['PRG_1'],
    classCapacityTarget: 'one_on_one',
    startDate: '2026-06-01',
    endDate: '2026-06-05',
    reqUser: { activeOrgId: 'ORG' }
  });
  assert.equal(soloOnly.classes.length, 1);
  assert.equal(soloOnly.classes[0].classId, 'CLS_1');
});

test('taskWindowForFullSession uses full session bounds', () => {
  const window = wizard.taskWindowForFullSession({
    startTime: '09:00',
    endTime: '11:00'
  });
  assert.equal(window.ok, true);
  assert.equal(window.taskStartTime, '09:00');
  assert.equal(window.taskEndTime, '11:00');

  const invalid = wizard.taskWindowForFullSession({
    startTime: '09:00',
    endTime: '09:00'
  });
  assert.equal(invalid.ok, false);
});

test('taskWindowBeforeSessionEnd remains available for trailing-hour assignments', () => {
  const window = wizard.taskWindowBeforeSessionEnd({
    startTime: '09:00',
    endTime: '11:00'
  }, 1);
  assert.equal(window.ok, true);
  assert.equal(window.taskStartTime, '10:00');
  assert.equal(window.taskEndTime, '11:00');
});

test('apply creates one assignment for the latest session on the verified date', async (t) => {
  const created = [];
  wizard.__setDependenciesForTest({
    schoolDataService: {
      getDataById: async (type, id) => {
        if (type === 'reportTemplates') {
          return { id: 'TPL_1', title: 'Template', allowedReportScopes: ['class', 'each_student'] };
        }
        return { id: 'CLS_1', title: 'Morning', orgId: 'ORG' };
      },
      getClassSessions: async () => ([
        { sessionId: 'EARLY', date: '2026-06-04', startTime: '09:00', endTime: '10:00', status: 'scheduled', roster: [] },
        { sessionId: 'LATE', date: '2026-06-04', startTime: '13:00', endTime: '15:00', status: 'scheduled', roster: [{ personId: 'PER_1' }] }
      ]),
      saveClassSessions: async () => {},
      fetchAllData: async () => []
    },
    sessionStatusPolicyService: {
      getStatusMap: async () => new Map(),
      isSessionCompletionStatusByMap: () => false,
      normalizeStatusCode: (code) => String(code || '').trim().toLowerCase()
    },
    sessionManagementService: {
      SESSION_OPERATIONS: { CHANGE_STATUS: 'change_status' },
      assertSessionOperationAllowed: async () => {}
    },
    schoolIndexService: { rebuildIndexesForClass: async () => {} },
    sessionReportAssignmentService: {
      resolveTeacherId: () => 'TCH_1',
      upsertSessionTargetRowForAssignment: async (args) => {
        created.push(args);
        return { assignment: { id: 'ASG_NEW' }, createdAssignment: true, message: 'assigned' };
      }
    },
    semiMonthlyReportPolicyModel: {
      getPolicyForOrg: async () => ({ reportTemplateIds: ['TPL_1'] })
    }
  });
  t.after(() => wizard.__resetDependenciesForTest());

  const result = await wizard.applyClassTemplate({
    classId: 'CLS_1',
    templateId: 'TPL_1',
    reportScope: 'class',
    reportStartDate: '2026-06-01',
    verifiedEndDate: '2026-06-04',
    conflictPermitted: true,
    timesheetReflection: true,
    conductRequiredBeforeFill: true,
    allocatedHours: 1,
    reqUser: { id: 'USER_1', activeOrgId: 'ORG' }
  });

  assert.equal(result.assignmentId, 'ASG_NEW');
  assert.equal(result.operation, 'assignment_created');
  assert.match(result.outcomeSummary, /New report assignment created/);
  assert.equal(created.length, 1);
  assert.equal(created[0].session.sessionId, 'LATE');
  assert.equal(created[0].input.taskStartTime, '13:00');
  assert.equal(created[0].input.taskEndTime, '15:00');
  assert.equal(created[0].input.templateId, 'TPL_1');
});

test('apply reopens completed session when reopenCompletedSession is true', async (t) => {
  const saved = [];
  const created = [];
  wizard.__setDependenciesForTest({
    schoolDataService: {
      getDataById: async (type, id) => {
        if (type === 'reportTemplates') {
          return { id: 'TPL_1', title: 'Template', allowedReportScopes: ['class', 'each_student'] };
        }
        return { id: 'CLS_1', title: 'Morning', orgId: 'ORG' };
      },
      getClassSessions: async () => ([
        { sessionId: 'LATE', date: '2026-06-04', startTime: '13:00', endTime: '15:00', status: 'completed', roster: [{ personId: 'PER_1' }] }
      ]),
      saveClassSessions: async (classId, sessions) => {
        saved.push({ classId, sessions: sessions.map((row) => ({ ...row })) });
      },
      fetchAllData: async () => []
    },
    sessionStatusPolicyService: {
      getStatusMap: async () => new Map(),
      isSessionCompletionStatusByMap: () => true,
      normalizeStatusCode: (code) => String(code || '').trim().toLowerCase()
    },
    sessionManagementService: {
      SESSION_OPERATIONS: { CHANGE_STATUS: 'change_status' },
      assertSessionOperationAllowed: async () => {}
    },
    schoolIndexService: { rebuildIndexesForClass: async () => {} },
    sessionReportAssignmentService: {
      resolveTeacherId: () => 'TCH_1',
      upsertSessionTargetRowForAssignment: async (args) => {
        created.push(args);
        return { assignment: { id: 'ASG_NEW' }, createdAssignment: true, message: 'assigned' };
      }
    },
    semiMonthlyReportPolicyModel: {
      getPolicyForOrg: async () => ({ reportTemplateIds: ['TPL_1'] })
    }
  });
  t.after(() => wizard.__resetDependenciesForTest());

  await wizard.applyClassTemplate({
    classId: 'CLS_1',
    templateId: 'TPL_1',
    reportScope: 'class',
    reportStartDate: '2026-06-01',
    verifiedEndDate: '2026-06-04',
    reopenCompletedSession: true,
    reqUser: { id: 'USER_1', activeOrgId: 'ORG' }
  });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].sessions[0].status, 'scheduled');
  assert.equal(created[0].session.status, 'scheduled');
});

test('semi-monthly wizard is linked from report assignments', () => {
  const list = fs.readFileSync(path.join(__dirname, '../MVC/views/school/report/assignmentList.ejs'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../MVC/routes/reportRoutes.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../MVC/views/school/report/semiMonthlyAssignmentWizard.ejs'), 'utf8');
  assert.match(list, /semi-monthly-wizard/);
  assert.match(routes, /\/assignments\/semi-monthly-wizard\/apply/);
  assert.match(page, /smmrReportScope/);
  assert.match(page, /smmrClassCapacityTarget/);
  assert.match(page, /wizard-step-rail/);
  assert.match(page, /smmrWizardProgressBar/);
  assert.match(page, /smmrClassSearch/);
  assert.match(page, /btn_smmrSelectAllClasses/);
  assert.match(page, /semiMonthlyReportAssignmentWizard\.js/);
  const script = fs.readFileSync(path.join(__dirname, '../public/scripts/semiMonthlyReportAssignmentWizard.js'), 'utf8');
  assert.match(script, /actionStateIdRef/);
  assert.match(script, /X-Action-State-Id/);
  assert.match(script, /selectedClassIds/);
  assert.match(script, /showLoading/);
  assert.match(script, /Checking sessions on the period end date/);
  assert.match(script, /Building class preview/);
  assert.match(page, /smmrReopenCompletedSession/);
  assert.match(page, /id="smmrConflictPermitted" checked/);
  assert.doesNotMatch(page, /smmrHoursBeforeEnd/);
  assert.match(page, /Report template/);
  assert.match(page, /Session assignment/);
  assert.match(page, /partials\/reportMessageHelpers/);
  assert.match(script, /renderOperationResults/);
  assert.match(script, /parseApplyFailureOutcome/);
  assert.match(script, /hasExistingSessionTargetRow/);
  assert.match(script, /renderSessionAssignmentCell/);
  assert.match(script, /buildInactiveEnrollmentSaveFailureModalHtml/);
  assert.match(script, /updateOperationProgress/);
  assert.match(script, /operationRunning/);
  assert.match(script, /wizardScopePayload/);
  assert.match(script, /Existing assignment/);
  assert.match(script, /resolveClassTemplateId/);
  assert.match(script, /data-smmr-class-template/);
  assert.match(script, /renderTemplateCell/);
  assert.match(script, /ensureDefaultStudentsForSelectedClasses/);
  assert.match(page, /smmr-sortable-th/);
  assert.match(page, /data-smmr-sort-key="title"/);
  assert.match(script, /smmrSummaryClasses/);
  assert.match(script, /reportScopeLabel/);
  assert.match(script, /updateClassSortHeaderState/);
  assert.doesNotMatch(script, /student\(s\`\)\.join\('; '\)/);
  const service = fs.readFileSync(path.join(__dirname, '../MVC/services/school/semiMonthlyReportAssignmentWizardService.js'), 'utf8');
  assert.match(service, /eligibleSessionCount/);
  assert.match(service, /resolveTemplateIdForClass/);
});
