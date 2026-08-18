const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const reportRosterService = require('../packages/school/MVC/services/school/reportRosterService');
const reportIntegrityService = require('../packages/school/MVC/services/school/reportIntegrityService');
const sessionReportInstanceService = require('../packages/school/MVC/services/school/sessionReportInstanceService');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const schoolRepositories = require('../packages/school/MVC/repositories/school');
const reportViewService = require('../packages/school/MVC/services/school/reportViewService');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function withPatched(target, replacements, callback) {
  const originals = {};
  Object.entries(replacements).forEach(([key, value]) => {
    originals[key] = target[key];
    target[key] = value;
  });
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      Object.entries(originals).forEach(([key, value]) => {
        target[key] = value;
      });
    });
}

test('resolveSessionRosterPersonIds returns unique personIds from session roster', () => {
  const ids = reportRosterService.resolveSessionRosterPersonIds({
    roster: [
      { personId: 'P-A', attendanceStatus: 'present' },
      { personId: 'P-B', attendanceStatus: 'absent' },
      { personId: 'P-A', attendanceStatus: 'present' },
      { personId: '', name: 'Empty row' }
    ]
  });
  assert.deepEqual(ids, ['P-A', 'P-B']);
});

test('resolveEachStudentTargetPersonIds uses session roster instead of enrollment when session-linked', async () => {
  const enrollmentIds = ['P-A', 'P-B', 'P-C'];
  const assignment = {
    reportScope: 'each_student',
    sessionId: 'SES-1'
  };
  const sessions = [{
    sessionId: 'SES-1',
    roster: [
      { personId: 'P-A' },
      { personId: 'P-B' }
    ]
  }];

  const targets = await reportRosterService.resolveEachStudentTargetPersonIds({
    assignment,
    classData: { id: 'CLS-1' },
    sessions,
    reqUser: {},
    resolveEnrollmentPersonIds: async () => enrollmentIds
  });

  assert.deepEqual(targets, ['P-A', 'P-B']);
});

test('resolveEachStudentTargetPersonIds falls back to enrollment for non-session each_student', async () => {
  const enrollmentIds = ['P-A', 'P-C'];
  const assignment = { reportScope: 'each_student' };

  const targets = await reportRosterService.resolveEachStudentTargetPersonIds({
    assignment,
    classData: { id: 'CLS-1' },
    sessions: [],
    reqUser: {},
    resolveEnrollmentPersonIds: async () => enrollmentIds
  });

  assert.deepEqual(targets, ['P-A', 'P-C']);
});

test('resolveStartInstanceContext limits each_student targets to session roster', async () => {
  const assignment = {
    id: 'ASN-1',
    orgId: '900000',
    classId: 'CLS-1',
    templateId: 'TPL-1',
    reportScope: 'each_student',
    status: 'active',
    teacherIds: ['TEACHER-1'],
    targetRows: [{
      rowId: 'row_1',
      sessionId: 'SES-1',
      sessionDate: '2026-06-23',
      teacherId: 'TEACHER-1',
      status: 'active'
    }]
  };

  await withPatched(schoolRepositories.reportAssignments, {
    getById: async () => assignment
  }, async () => {
    await withPatched(schoolRepositories.reportTemplates, {
      getById: async () => ({ id: 'TPL-1', orgId: '900000', version: 1 })
    }, async () => {
      await withPatched(schoolDataService, {
        getDataById: async (entityType) => {
          if (entityType === 'classes') return { id: 'CLS-1', orgId: '900000' };
          return null;
        },
        getClassSessions: async () => ([{
          sessionId: 'SES-1',
          date: '2026-06-23',
          roster: [
            { personId: 'P-A' },
            { personId: 'P-B' }
          ]
        }]),
        fetchAllData: async (entityType) => {
          if (entityType === 'students') {
            return [
              { id: 'STU-1', personId: 'P-A' },
              { id: 'STU-2', personId: 'P-B' },
              { id: 'STU-3', personId: 'P-C' }
            ];
          }
          return [];
        }
      }, async () => {
        const ctx = await reportIntegrityService.resolveStartInstanceContext({
          assignmentId: 'ASN-1',
          assignmentRowId: 'row_1',
          reqUser: { id: 'USR-1', activeOrgId: '900000', personId: 'TEACHER-1' }
        });

        assert.deepEqual(ctx.targetStudentIds, ['P-A', 'P-B']);
      });
    });
  });
});

test('buildSessionRosterReconciliation detects orphan instances and missing roster students', async () => {
  const instanceRows = [
    {
      id: 'INST-1',
      isPendingAssignment: false,
      orgId: '900000',
      assignmentId: 'ASN-1',
      assignmentRowId: 'row_1',
      classId: 'CLS-1',
      sessionId: 'SES-1',
      sessionDate: '2026-06-23',
      studentId: 'P-A',
      studentName: 'Alice'
    },
    {
      id: 'INST-ORPHAN',
      isPendingAssignment: false,
      orgId: '900000',
      assignmentId: 'ASN-1',
      assignmentRowId: 'row_1',
      classId: 'CLS-1',
      sessionId: 'SES-1',
      sessionDate: '2026-06-23',
      studentId: 'P-C',
      studentName: 'Carol (late joiner)'
    }
  ];

  await withPatched(reportViewService, {
    buildInstanceListRows: async () => instanceRows
  }, async () => {
    await withPatched(schoolDataService, {
      fetchData: async (entityType) => {
        if (entityType !== 'reportAssignments') return [];
        return [{
          id: 'ASN-1',
          orgId: '900000',
          classId: 'CLS-1',
          templateId: 'TPL-1',
          reportScope: 'each_student',
          status: 'active',
          targetRows: [{
            rowId: 'row_1',
            sessionId: 'SES-1',
            sessionDate: '2026-06-23',
            teacherId: 'TEACHER-1',
            status: 'active'
          }]
        }];
      },
      getDataById: async (entityType) => {
        if (entityType === 'reportTemplates') return { id: 'TPL-1', title: 'Progress Report' };
        return null;
      }
    }, async () => {
      const reconciliation = await sessionReportInstanceService.buildSessionRosterReconciliation({
        classId: 'CLS-1',
        sessionId: 'SES-1',
        sessionDate: '2026-06-23',
        sessionRoster: [
          { personId: 'P-A', name: 'Alice' },
          { personId: 'P-B', name: 'Bob' }
        ],
        reqUser: { id: 'USR-1', activeOrgId: '900000' }
      });

      assert.equal(reconciliation.length, 1);
      assert.equal(reconciliation[0].expectedCount, 2);
      assert.equal(reconciliation[0].missingCount, 1);
      assert.deepEqual(reconciliation[0].missingStudentIds, ['P-B']);
      assert.equal(reconciliation[0].orphanedInstances.length, 1);
      assert.equal(reconciliation[0].orphanedInstances[0].instanceId, 'INST-ORPHAN');
      assert.equal(reconciliation[0].orphanedInstances[0].studentName, 'Carol (late joiner)');
    });
  });
});

test('sessionManager includes roster reconciliation UI hooks', () => {
  const src = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  assert.match(src, /sessionReportRosterReconciliationHost/);
  assert.match(src, /sessionRosterReconciliationState/);
  assert.match(src, /js-delete-orphan-report-instance/);
  assert.match(src, /renderSessionRosterReconciliation/);
});
