const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schoolSampleDataService = require('../packages/school/MVC/services/school/schoolSampleDataService');
const schoolRepositories = require('../packages/school/MVC/repositories/school');
const withdrawalRepository = require('../packages/school/MVC/repositories/school/withdrawalRepository');
const attendanceMatrixPolicyModel = require('../packages/school/MVC/models/school/attendanceMatrixPolicyModel');
const indexService = require('../packages/school/MVC/services/school/schoolIndexService');

function makeClearResult(label, count = 1) {
  return {
    removed: count,
    remaining: 0,
    label
  };
}

function installClearWorkspaceStubs(options = {}) {
  const calls = [];
  const record = (name) => async (...args) => {
    calls.push({ name, args });
    if (typeof options.handlers?.[name] === 'function') {
      return options.handlers[name](...args);
    }
    return makeClearResult(name);
  };

  const originals = {
    academicLedger: schoolRepositories.academicLedger.clearByOrg,
    globalTransactions: schoolRepositories.globalTransactions.clearByOrg,
    transactionJournals: schoolRepositories.transactionJournals.clearByOrg,
    studentProgramRegistrations: schoolRepositories.studentProgramRegistrations.clearByOrg,
    studentProgramPriorSubjects: schoolRepositories.studentProgramPriorSubjects.clearByOrg,
    studentTermRegistrations: schoolRepositories.studentTermRegistrations.clearByOrg,
    classEnrollmentPeriods: schoolRepositories.classEnrollmentPeriods.clearByOrg,
    clearWithdrawalsByOrg: withdrawalRepository.clearWithdrawalsByOrg,
    clearEnrollmentsByOrg: schoolRepositories.classes.clearEnrollmentsByOrg,
    reportInstances: schoolRepositories.reportInstances.clearByOrg,
    reportAssignments: schoolRepositories.reportAssignments.clearByOrg,
    timesheets: schoolRepositories.timesheets.clearByOrg,
    clearRuntimeStorageByOrg: schoolRepositories.classes.clearRuntimeStorageByOrg,
    clearStorageByOrg: schoolRepositories.subjects.clearStorageByOrg,
    activities: schoolRepositories.activities.clearByOrg,
    activityCategories: schoolRepositories.activityCategories.clearByOrg,
    leaveRequests: schoolRepositories.leaveRequests.clearByOrg,
    tasks: schoolRepositories.tasks.clearByOrg,
    taskRoutingRules: schoolRepositories.taskRoutingRules.clearByOrg,
    sessionStudentCases: schoolRepositories.sessionStudentCases.clearByOrg,
    examAnswers: schoolRepositories.examAnswers.clearByOrg,
    examAttempts: schoolRepositories.examAttempts.clearByOrg,
    examAssignments: schoolRepositories.examAssignments.clearByOrg,
    examAllocations: schoolRepositories.examAllocations.clearByOrg,
    academicSnapshots: schoolRepositories.academicSnapshots.clearByOrg,
    classesList: schoolRepositories.classes.list,
    rebuildIndexesForClass: indexService.rebuildIndexesForClass,
    removePolicyForOrg: attendanceMatrixPolicyModel.removePolicyForOrg,
    purgeOrgScopedRepositoryRows: schoolRepositories.purgeOrgScopedRepositoryRows,
    purgeOrgScopedSchoolAccounts: schoolRepositories.purgeOrgScopedSchoolAccounts,
    examQuestions: schoolRepositories.examQuestions.clearByOrg,
    examRevisions: schoolRepositories.examRevisions.clearByOrg,
    examTemplates: schoolRepositories.examTemplates.clearByOrg,
    activityCategoriesList: schoolRepositories.activityCategories.list
  };

  schoolRepositories.academicLedger.clearByOrg = record('academicLedger.clearByOrg');
  schoolRepositories.globalTransactions.clearByOrg = record('globalTransactions.clearByOrg');
  schoolRepositories.transactionJournals.clearByOrg = record('transactionJournals.clearByOrg');
  schoolRepositories.studentProgramRegistrations.clearByOrg = record('studentProgramRegistrations.clearByOrg');
  schoolRepositories.studentProgramPriorSubjects.clearByOrg = record('studentProgramPriorSubjects.clearByOrg');
  schoolRepositories.studentTermRegistrations.clearByOrg = record('studentTermRegistrations.clearByOrg');
  schoolRepositories.classEnrollmentPeriods.clearByOrg = record('classEnrollmentPeriods.clearByOrg');
  withdrawalRepository.clearWithdrawalsByOrg = record('withdrawals.clearByOrg');
  schoolRepositories.classes.clearEnrollmentsByOrg = record('classes.clearEnrollmentsByOrg');
  schoolRepositories.reportInstances.clearByOrg = record('reportInstances.clearByOrg');
  schoolRepositories.reportAssignments.clearByOrg = record('reportAssignments.clearByOrg');
  schoolRepositories.timesheets.clearByOrg = record('timesheets.clearByOrg');
  schoolRepositories.classes.clearRuntimeStorageByOrg = record('classes.clearRuntimeStorageByOrg');
  schoolRepositories.subjects.clearStorageByOrg = record('subjects.clearStorageByOrg');
  schoolRepositories.activities.clearByOrg = record('activities.clearByOrg');
  schoolRepositories.activityCategories.clearByOrg = record('activityCategories.clearByOrg');
  schoolRepositories.leaveRequests.clearByOrg = record('leaveRequests.clearByOrg');
  schoolRepositories.tasks.clearByOrg = record('tasks.clearByOrg');
  schoolRepositories.taskRoutingRules.clearByOrg = record('taskRoutingRules.clearByOrg');
  schoolRepositories.sessionStudentCases.clearByOrg = record('sessionStudentCases.clearByOrg');
  schoolRepositories.examAnswers.clearByOrg = record('examAnswers.clearByOrg');
  schoolRepositories.examAttempts.clearByOrg = record('examAttempts.clearByOrg');
  schoolRepositories.examAssignments.clearByOrg = record('examAssignments.clearByOrg');
  schoolRepositories.examAllocations.clearByOrg = record('examAllocations.clearByOrg');
  schoolRepositories.academicSnapshots.clearByOrg = record('academicSnapshots.clearByOrg');
  schoolRepositories.examQuestions.clearByOrg = record('examQuestions.clearByOrg');
  schoolRepositories.examRevisions.clearByOrg = record('examRevisions.clearByOrg');
  schoolRepositories.examTemplates.clearByOrg = record('examTemplates.clearByOrg');

  schoolRepositories.classes.list = async () => [{ id: 'CLS-1', orgId: 'ORG-1' }];
  indexService.rebuildIndexesForClass = async () => true;
  attendanceMatrixPolicyModel.removePolicyForOrg = async () => ({ removed: 1 });
  schoolRepositories.purgeOrgScopedRepositoryRows = async (repo, orgId) => {
    const repoMap = [
      ['reportTemplates', schoolRepositories.reportTemplates],
      ['timesheetPeriods', schoolRepositories.timesheetPeriods],
      ['classes', schoolRepositories.classes],
      ['subjects', schoolRepositories.subjects],
      ['programs', schoolRepositories.programs],
      ['terms', schoolRepositories.terms],
      ['departments', schoolRepositories.departments]
    ];
    const match = repoMap.find(([, ref]) => ref === repo);
    const repoName = match ? match[0] : 'unknown';
    calls.push({ name: `purgeOrgScopedRepositoryRows:${repoName}`, args: [orgId] });
    return { removed: 2, remaining: 0, errors: [] };
  };
  schoolRepositories.purgeOrgScopedSchoolAccounts = async (orgId) => {
    calls.push({ name: 'purgeOrgScopedSchoolAccounts', args: [orgId] });
    return { removed: 1, skippedHeadAccounts: 2, remaining: 3, errors: [] };
  };
  schoolRepositories.activityCategories.list = async () => [];

  return {
    calls,
    restore() {
      Object.entries(originals).forEach(([key, fn]) => {
        if (key === 'clearWithdrawalsByOrg') {
          withdrawalRepository.clearWithdrawalsByOrg = fn;
          return;
        }
        if (key === 'clearEnrollmentsByOrg') {
          schoolRepositories.classes.clearEnrollmentsByOrg = fn;
          return;
        }
        if (key === 'clearRuntimeStorageByOrg') {
          schoolRepositories.classes.clearRuntimeStorageByOrg = fn;
          return;
        }
        if (key === 'clearStorageByOrg') {
          schoolRepositories.subjects.clearStorageByOrg = fn;
          return;
        }
        if (key === 'classesList') {
          schoolRepositories.classes.list = fn;
          return;
        }
        if (key === 'rebuildIndexesForClass') {
          indexService.rebuildIndexesForClass = fn;
          return;
        }
        if (key === 'removePolicyForOrg') {
          attendanceMatrixPolicyModel.removePolicyForOrg = fn;
          return;
        }
        if (key === 'purgeOrgScopedRepositoryRows') {
          schoolRepositories.purgeOrgScopedRepositoryRows = fn;
          return;
        }
        if (key === 'purgeOrgScopedSchoolAccounts') {
          schoolRepositories.purgeOrgScopedSchoolAccounts = fn;
          return;
        }
        if (key === 'activityCategoriesList') {
          schoolRepositories.activityCategories.list = fn;
          return;
        }
        const [repo, method] = key.split('.');
        if (repo && method && schoolRepositories[repo]) {
          schoolRepositories[repo][method] = fn;
        }
      });
    }
  };
}

test('clearSampleTransactionalData wires expanded transactional clear helpers', async () => {
  const { calls, restore } = installClearWorkspaceStubs();
  try {
    const result = await schoolSampleDataService.clearSampleTransactionalData({
      orgId: 'ORG-1',
      includeAcademicSnapshots: true,
      masterDefinitions: {}
    });

    const names = calls.map((row) => row.name);
    [
      'activities.clearByOrg',
      'activityCategories.clearByOrg',
      'leaveRequests.clearByOrg',
      'tasks.clearByOrg',
      'taskRoutingRules.clearByOrg',
      'sessionStudentCases.clearByOrg',
      'examAnswers.clearByOrg',
      'examAttempts.clearByOrg',
      'examAssignments.clearByOrg',
      'examAllocations.clearByOrg'
    ].forEach((expected) => {
      assert.ok(names.includes(expected), `expected call ${expected}`);
    });

    const examStart = names.indexOf('examAnswers.clearByOrg');
    const examAttempts = names.indexOf('examAttempts.clearByOrg');
    const examAssignments = names.indexOf('examAssignments.clearByOrg');
    const examAllocations = names.indexOf('examAllocations.clearByOrg');
    assert.ok(examStart >= 0 && examAttempts > examStart && examAssignments > examAttempts && examAllocations > examAssignments);

    assert.equal(result.summary.cleared.activities, 1);
    assert.equal(result.summary.cleared.sessionStudentCases, 1);
    assert.equal(result.summary.cleared.examAnswers, 1);
  } finally {
    restore();
  }
});

test('clearSampleTransactionalData purges selected master definitions in order', async () => {
  const { calls, restore } = installClearWorkspaceStubs();
  try {
    const result = await schoolSampleDataService.clearSampleTransactionalData({
      orgId: 'ORG-1',
      includeAcademicSnapshots: false,
      masterDefinitions: {
        examDefinitions: true,
        reportTemplates: true,
        classes: true,
        programs: true,
        schoolAccounts: true
      }
    });

    const names = calls.map((row) => row.name);
    const questionsIdx = names.indexOf('examQuestions.clearByOrg');
    const revisionsIdx = names.indexOf('examRevisions.clearByOrg');
    const templatesIdx = names.indexOf('examTemplates.clearByOrg');
    assert.ok(questionsIdx >= 0 && revisionsIdx > questionsIdx && templatesIdx > revisionsIdx);

    assert.ok(names.includes('purgeOrgScopedRepositoryRows:reportTemplates'));
    assert.ok(names.includes('purgeOrgScopedRepositoryRows:classes'));
    assert.ok(names.includes('purgeOrgScopedRepositoryRows:programs'));
    assert.ok(names.includes('purgeOrgScopedSchoolAccounts'));

    assert.equal(result.summary.cleared.examTemplates, 1);
    assert.equal(result.summary.cleared.reportTemplates, 2);
    assert.equal(result.summary.cleared.classes, 2);
    assert.equal(result.summary.cleared.schoolAccounts, 1);
    assert.equal(result.summary.cleared.schoolAccountsSkippedHead, 2);
    assert.deepEqual(result.masterDefinitions.examDefinitions, true);
  } finally {
    restore();
  }
});

test('normalizeMasterDefinitions defaults all master purge flags to false', () => {
  const normalized = schoolSampleDataService.normalizeMasterDefinitions({
    classes: 'false',
    schoolAccounts: 'on'
  });
  assert.equal(normalized.classes, false);
  assert.equal(normalized.schoolAccounts, true);
  assert.equal(normalized.programs, false);
});

test('generator form exposes master definition checkbox field names', () => {
  const formPath = path.join(
    __dirname,
    '../packages/school/MVC/views/school/sampleData/generatorForm.ejs'
  );
  const html = fs.readFileSync(formPath, 'utf8');
  [
    'masterDefinitions_classes',
    'masterDefinitions_programs',
    'masterDefinitions_terms',
    'masterDefinitions_subjects',
    'masterDefinitions_departments',
    'masterDefinitions_reportTemplates',
    'masterDefinitions_timesheetPeriods',
    'masterDefinitions_activityCategories',
    'masterDefinitions_examDefinitions',
    'masterDefinitions_schoolAccounts',
    'btnClearTransactionalData',
    'Reset Org Workspace'
  ].forEach((needle) => {
    assert.ok(html.includes(needle), `expected generator form to include ${needle}`);
  });
});

test('controller idempotency version bumped for expanded clear payload', () => {
  const controllerPath = path.join(
    __dirname,
    '../packages/school/MVC/controllers/school/schoolSampleDataController.js'
  );
  const source = fs.readFileSync(controllerPath, 'utf8');
  assert.match(source, /CLEAR_TRANSACTIONAL_IDEMPOTENCY_VERSION = 'v6'/);
  assert.match(source, /parseMasterDefinitions/);
  assert.match(source, /masterDefinitions_classes/);
});

function installPreviewStubs() {
  const calls = [];
  const listRows = (name, rows = []) => async (...args) => {
    calls.push({ name: `list:${name}`, args });
    return rows;
  };

  const originals = {
    academicLedgerList: schoolRepositories.academicLedger.list,
    globalTransactionsList: schoolRepositories.globalTransactions.list,
    activitiesList: schoolRepositories.activities.list,
    classesList: schoolRepositories.classes.list,
    subjectsList: schoolRepositories.subjects.list,
    schoolAccountsList: schoolRepositories.schoolAccounts.list,
    academicSnapshotsList: schoolRepositories.academicSnapshots.list,
    academicLedgerClear: schoolRepositories.academicLedger.clearByOrg,
    purgeOrgScopedRepositoryRows: schoolRepositories.purgeOrgScopedRepositoryRows,
    purgeOrgScopedSchoolAccounts: schoolRepositories.purgeOrgScopedSchoolAccounts,
    withdrawalList: withdrawalRepository.list,
    getPolicyForOrg: attendanceMatrixPolicyModel.getPolicyForOrg
  };

  const defaultList = async () => [];
  const repos = [
    'academicLedger', 'globalTransactions', 'transactionJournals',
    'studentProgramRegistrations', 'studentProgramPriorSubjects', 'studentTermRegistrations',
    'classEnrollmentPeriods', 'reportInstances', 'reportAssignments', 'timesheets',
    'activities', 'activityCategories', 'leaveRequests', 'tasks', 'taskRoutingRules',
    'sessionStudentCases', 'examAnswers', 'examAttempts', 'examAssignments', 'examAllocations',
    'examQuestions', 'examRevisions', 'examTemplates', 'reportTemplates', 'timesheetPeriods',
    'subjects', 'programs', 'terms', 'departments'
  ];
  repos.forEach((repoName) => {
    if (schoolRepositories[repoName]?.list) {
      schoolRepositories[repoName].list = defaultList;
    }
  });

  schoolRepositories.academicLedger.list = listRows('academicLedger', [{ id: 'LED-1', name: 'Ledger 1' }]);
  schoolRepositories.activities.list = listRows('activities', [{ id: 'ACT-1', title: 'Activity 1' }]);
  schoolRepositories.classes.list = async () => ([
    {
      id: 'CLS-1',
      orgId: 'ORG-1',
      name: 'Class 1',
      enrollment: { students: [{ id: 'STU-1' }, { id: 'STU-2' }] },
      sessions: [{ id: 'SES-1' }],
      officialFinalGrades: { term1: { status: 'draft' } }
    }
  ]);
  schoolRepositories.subjects.list = listRows('subjects', [{ id: 'SUB-1', name: 'Subject 1' }]);
  schoolRepositories.schoolAccounts.list = listRows('schoolAccounts', [
    { id: 'ACC-1', name: 'Regular Account', headCategory: 'none' },
    { id: 'ACC-2', name: 'Head Account', headCategory: 'students' }
  ]);
  schoolRepositories.academicSnapshots.list = listRows('academicSnapshots', [{ id: 'SNAP-1', name: 'Snapshot 1' }]);
  withdrawalRepository.list = listRows('withdrawals', [{ id: 'WD-1', reason: 'Withdrawal 1' }]);
  attendanceMatrixPolicyModel.getPolicyForOrg = async () => ({ orgId: 'ORG-1' });
  schoolRepositories.academicLedger.clearByOrg = async (...args) => {
    calls.push({ name: 'academicLedger.clearByOrg', args });
    return { removed: 0, remaining: 0 };
  };
  schoolRepositories.purgeOrgScopedRepositoryRows = async (...args) => {
    calls.push({ name: 'purgeOrgScopedRepositoryRows', args });
    return { removed: 0, remaining: 0, errors: [] };
  };
  schoolRepositories.purgeOrgScopedSchoolAccounts = async (...args) => {
    calls.push({ name: 'purgeOrgScopedSchoolAccounts', args });
    return { removed: 0, remaining: 0, errors: [] };
  };

  return {
    calls,
    restore() {
      Object.entries(originals).forEach(([key, fn]) => {
        if (key === 'withdrawalList') {
          withdrawalRepository.list = fn;
          return;
        }
        if (key === 'getPolicyForOrg') {
          attendanceMatrixPolicyModel.getPolicyForOrg = fn;
          return;
        }
        if (key === 'classesList') {
          schoolRepositories.classes.list = fn;
          return;
        }
        if (key === 'purgeOrgScopedRepositoryRows') {
          schoolRepositories.purgeOrgScopedRepositoryRows = fn;
          return;
        }
        if (key === 'purgeOrgScopedSchoolAccounts') {
          schoolRepositories.purgeOrgScopedSchoolAccounts = fn;
          return;
        }
        const map = {
          academicLedgerList: ['academicLedger', 'list'],
          globalTransactionsList: ['globalTransactions', 'list'],
          activitiesList: ['activities', 'list'],
          subjectsList: ['subjects', 'list'],
          schoolAccountsList: ['schoolAccounts', 'list'],
          academicSnapshotsList: ['academicSnapshots', 'list'],
          academicLedgerClear: ['academicLedger', 'clearByOrg']
        };
        const target = map[key];
        if (target) {
          schoolRepositories[target[0]][target[1]] = fn;
        }
      });
    }
  };
}

test('buildOrgWorkspaceResetPreview returns counts without mutating data', async () => {
  const { calls, restore } = installPreviewStubs();
  try {
    const preview = await schoolSampleDataService.buildOrgWorkspaceResetPreview({
      orgId: 'ORG-1',
      includeAcademicSnapshots: true,
      masterDefinitions: { schoolAccounts: true, classes: true }
    });

    assert.equal(preview.orgId, 'ORG-1');
    assert.ok(Array.isArray(preview.transactional.groups));
    assert.ok(preview.transactional.groups.some((g) => g.key === 'activities' && g.count === 1));
    assert.ok(preview.transactional.groups.some((g) => g.key === 'classEnrollments' && g.count === 2));
    assert.equal(preview.masters.selectedKeys.includes('schoolAccounts'), true);
    assert.equal(preview.masters.selectedKeys.includes('classes'), true);
    assert.ok(preview.masters.groups.some((g) => g.key === 'schoolAccounts' && g.count === 1));
    assert.ok(preview.masters.protected.some((g) => g.key === 'schoolAccountsHead' && g.count === 1));

    const mutatingCalls = calls.filter((row) => (
      String(row.name).includes('clearByOrg')
      || row.name === 'purgeOrgScopedRepositoryRows'
      || row.name === 'purgeOrgScopedSchoolAccounts'
    ));
    assert.equal(mutatingCalls.length, 0);
  } finally {
    restore();
  }
});

test('generator form exposes org workspace reset preview UI', () => {
  const formPath = path.join(
    __dirname,
    '../packages/school/MVC/views/school/sampleData/generatorForm.ejs'
  );
  const html = fs.readFileSync(formPath, 'utf8');
  [
    'btnPreviewOrgWorkspaceReset',
    'sampleWorkspaceResetPreviewModal',
    'btnProceedOrgWorkspaceReset',
    'clear-transactional-preview',
    'loadOrgWorkspaceResetPreview',
    'Preview Reset'
  ].forEach((needle) => {
    assert.ok(html.includes(needle), `expected generator form to include ${needle}`);
  });
});
