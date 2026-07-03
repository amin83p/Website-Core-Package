const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const schoolRepositories = require('../packages/school/MVC/repositories/school');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const reportIntegrityService = require('../packages/school/MVC/services/school/reportIntegrityService');
const reportViewService = require('../packages/school/MVC/services/school/reportViewService');

const ROOT = path.resolve(__dirname, '..');
const reqUser = { id: 'USER-1', personId: 'PERSON-USER', activeOrgId: '900000' };

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

test('report instance access blocks archived instances before editing', async () => {
  await withPatched(schoolRepositories.reportInstances, {
    getById: async () => ({
      id: 'INST-ARCHIVED',
      orgId: '900000',
      assignmentId: 'ASN-1',
      classId: 'CLASS-1',
      templateId: 'TPL-1',
      status: 'archived'
    })
  }, async () => {
    await assert.rejects(
      reportIntegrityService.getAccessibleInstanceOrThrow('INST-ARCHIVED', reqUser),
      /archived and cannot be opened/
    );
  });
});

test('report instance access blocks missing or mismatched assignment context', async () => {
  const instance = {
    id: 'INST-1',
    orgId: '900000',
    assignmentId: 'ASN-MISSING',
    classId: 'CLASS-1',
    templateId: 'TPL-1',
    status: 'draft'
  };

  await withPatched(schoolRepositories.reportInstances, {
    getById: async () => instance
  }, async () => {
    await withPatched(schoolRepositories.reportAssignments, {
      getById: async () => null
    }, async () => {
      await assert.rejects(
        reportIntegrityService.getAccessibleInstanceOrThrow('INST-1', reqUser),
        /assignment for this instance is no longer available/
      );
    });

    await withPatched(schoolRepositories.reportAssignments, {
      getById: async () => ({
        id: 'ASN-MISSING',
        orgId: '900000',
        classId: 'CLASS-OTHER',
        templateId: 'TPL-1'
      })
    }, async () => {
      await assert.rejects(
        reportIntegrityService.getAccessibleInstanceOrThrow('INST-1', reqUser),
        /no longer matches its assignment class/
      );
    });
  });
});

test('report instance lists hide archived and orphan rows', async () => {
  await withPatched(schoolDataService, {
    fetchData: async (entityType) => {
      if (entityType === 'reportInstances') {
        return [
          {
            id: 'INST-ACTIVE',
            orgId: '900000',
            assignmentId: 'ASN-1',
            classId: 'CLASS-1',
            templateId: 'TPL-1',
            teacherId: 'TEACHER-1',
            sessionDate: '2026-06-30',
            status: 'draft',
            audit: { createDateTime: '2026-06-18T00:00:00.000Z' }
          },
          {
            id: 'INST-ARCHIVED',
            orgId: '900000',
            assignmentId: 'ASN-1',
            classId: 'CLASS-1',
            templateId: 'TPL-1',
            teacherId: 'TEACHER-1',
            sessionDate: '2026-06-30',
            status: 'archived',
            audit: { createDateTime: '2026-06-18T00:00:00.000Z' }
          },
          {
            id: 'INST-ORPHAN',
            orgId: '900000',
            assignmentId: 'ASN-MISSING',
            classId: 'CLASS-1',
            templateId: 'TPL-1',
            teacherId: 'TEACHER-1',
            sessionDate: '2026-06-30',
            status: 'draft',
            audit: { createDateTime: '2026-06-18T00:00:00.000Z' }
          }
        ];
      }
      if (entityType === 'reportAssignments') return [{ id: 'ASN-1', orgId: '900000', classId: 'CLASS-1', templateId: 'TPL-1' }];
      if (entityType === 'reportTemplates') return [{ id: 'TPL-1', orgId: '900000', title: 'Template' }];
      if (entityType === 'classes') return [{ id: 'CLASS-1', orgId: '900000', title: 'Class' }];
      return [];
    }
  }, async () => {
    const rows = await reportViewService.buildInstanceListRows({ reqUser });
    assert.deepEqual(rows.map((row) => row.id), ['INST-ACTIVE']);
  });
});

test('report instance list shows pending rows for active assignments without instances', async () => {
  await withPatched(schoolDataService, {
    fetchData: async (entityType) => {
      if (entityType === 'reportInstances') return [];
      if (entityType === 'reportAssignments') {
        return [{
          id: 'ASN-1',
          orgId: '900000',
          classId: 'CLASS-1',
          templateId: 'TPL-1',
          teacherIds: ['TEACHER-1'],
          reportScope: 'each_student',
          reportDueDate: '2026-06-30',
          sessionDate: '2026-06-30',
          status: 'active',
          audit: { createDateTime: '2026-06-18T00:00:00.000Z' }
        }];
      }
      if (entityType === 'reportTemplates') return [{ id: 'TPL-1', orgId: '900000', title: 'Template' }];
      if (entityType === 'classes') return [{ id: 'CLASS-1', orgId: '900000', title: 'Class', registrationMode: 'rolling' }];
      if (entityType === 'students') return [{ id: 'STU-1', orgId: '900000', personId: 'PERSON-1' }];
      return [];
    },
    getClassSessions: async () => [],
    getClassEnrollmentPeriodsByClassId: async () => [{
      id: 'PERIOD-1',
      orgId: '900000',
      classId: 'CLASS-1',
      studentId: 'STU-1',
      status: 'completed',
      startDate: '2026-06-01',
      endDate: '2026-06-30'
    }]
  }, async () => {
    const rows = await reportViewService.buildInstanceListRows({ reqUser });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].isPendingAssignment, true);
    assert.equal(rows[0].assignmentId, 'ASN-1');
    assert.equal(rows[0].teacherId, 'TEACHER-1');
    assert.equal(rows[0].studentId, 'PERSON-1');
    assert.equal(rows[0].targetKey, 'student:PERSON-1');
    assert.equal(rows[0].status, 'pending');
  });
});

test('report review navigator filters same template, student target, class, and participant access', async () => {
  const currentInstance = {
    id: 'INST-CURRENT',
    orgId: '900000',
    assignmentId: 'ASN-CURRENT',
    classId: 'CLASS-1',
    templateId: 'TPL-1',
    teacherId: 'TEACHER-1',
    studentId: 'STUDENT-1',
    targetKey: 'student:STUDENT-1',
    sessionDate: '2026-07-10',
    status: 'draft',
    audit: { createDateTime: '2026-07-10T00:00:00.000Z' }
  };

  const instances = [
    currentInstance,
    {
      id: 'INST-OLDER',
      orgId: '900000',
      assignmentId: 'ASN-OLDER',
      classId: 'CLASS-1',
      templateId: 'TPL-1',
      teacherId: 'TEACHER-1',
      studentId: 'STUDENT-1',
      targetKey: 'student:STUDENT-1',
      sessionDate: '2026-06-01',
      status: 'submitted',
      audit: { createDateTime: '2026-06-01T00:00:00.000Z' }
    },
    {
      id: 'INST-OTHER-TEACHER',
      orgId: '900000',
      assignmentId: 'ASN-OTHER-TEACHER',
      classId: 'CLASS-1',
      templateId: 'TPL-1',
      teacherId: 'TEACHER-2',
      studentId: 'STUDENT-1',
      targetKey: 'student:STUDENT-1',
      sessionDate: '2026-07-05',
      status: 'locked',
      audit: { createDateTime: '2026-07-05T00:00:00.000Z' }
    },
    {
      id: 'INST-DIFFERENT-STUDENT',
      orgId: '900000',
      assignmentId: 'ASN-DIFFERENT-STUDENT',
      classId: 'CLASS-1',
      templateId: 'TPL-1',
      teacherId: 'TEACHER-1',
      studentId: 'STUDENT-2',
      targetKey: 'student:STUDENT-2',
      sessionDate: '2026-07-04',
      status: 'submitted',
      audit: { createDateTime: '2026-07-04T00:00:00.000Z' }
    },
    {
      id: 'INST-DIFFERENT-CLASS',
      orgId: '900000',
      assignmentId: 'ASN-DIFFERENT-CLASS',
      classId: 'CLASS-2',
      templateId: 'TPL-1',
      teacherId: 'TEACHER-1',
      studentId: 'STUDENT-1',
      targetKey: 'student:STUDENT-1',
      sessionDate: '2026-07-03',
      status: 'submitted',
      audit: { createDateTime: '2026-07-03T00:00:00.000Z' }
    },
    {
      id: 'INST-DIFFERENT-TEMPLATE',
      orgId: '900000',
      assignmentId: 'ASN-DIFFERENT-TEMPLATE',
      classId: 'CLASS-1',
      templateId: 'TPL-2',
      teacherId: 'TEACHER-1',
      studentId: 'STUDENT-1',
      targetKey: 'student:STUDENT-1',
      sessionDate: '2026-07-02',
      status: 'submitted',
      audit: { createDateTime: '2026-07-02T00:00:00.000Z' }
    },
    {
      id: 'INST-DIFFERENT-ORG',
      orgId: '900001',
      assignmentId: 'ASN-DIFFERENT-ORG',
      classId: 'CLASS-1',
      templateId: 'TPL-1',
      teacherId: 'TEACHER-1',
      studentId: 'STUDENT-1',
      targetKey: 'student:STUDENT-1',
      sessionDate: '2026-07-01',
      status: 'submitted',
      audit: { createDateTime: '2026-07-01T00:00:00.000Z' }
    },
    {
      id: 'INST-ARCHIVED',
      orgId: '900000',
      assignmentId: 'ASN-ARCHIVED',
      classId: 'CLASS-1',
      templateId: 'TPL-1',
      teacherId: 'TEACHER-1',
      studentId: 'STUDENT-1',
      targetKey: 'student:STUDENT-1',
      sessionDate: '2026-06-20',
      status: 'archived',
      audit: { createDateTime: '2026-06-20T00:00:00.000Z' }
    },
    {
      id: 'INST-ORPHAN',
      orgId: '900000',
      assignmentId: 'ASN-MISSING',
      classId: 'CLASS-1',
      templateId: 'TPL-1',
      teacherId: 'TEACHER-1',
      studentId: 'STUDENT-1',
      targetKey: 'student:STUDENT-1',
      sessionDate: '2026-06-15',
      status: 'submitted',
      audit: { createDateTime: '2026-06-15T00:00:00.000Z' }
    },
    {
      id: 'INST-MISMATCHED-ASSIGNMENT',
      orgId: '900000',
      assignmentId: 'ASN-MISMATCHED',
      classId: 'CLASS-1',
      templateId: 'TPL-1',
      teacherId: 'TEACHER-1',
      studentId: 'STUDENT-1',
      targetKey: 'student:STUDENT-1',
      sessionDate: '2026-06-10',
      status: 'submitted',
      audit: { createDateTime: '2026-06-10T00:00:00.000Z' }
    }
  ];

  const assignments = [
    { id: 'ASN-CURRENT', orgId: '900000', classId: 'CLASS-1', templateId: 'TPL-1' },
    { id: 'ASN-OLDER', orgId: '900000', classId: 'CLASS-1', templateId: 'TPL-1' },
    { id: 'ASN-OTHER-TEACHER', orgId: '900000', classId: 'CLASS-1', templateId: 'TPL-1' },
    { id: 'ASN-DIFFERENT-STUDENT', orgId: '900000', classId: 'CLASS-1', templateId: 'TPL-1' },
    { id: 'ASN-DIFFERENT-CLASS', orgId: '900000', classId: 'CLASS-2', templateId: 'TPL-1' },
    { id: 'ASN-DIFFERENT-TEMPLATE', orgId: '900000', classId: 'CLASS-1', templateId: 'TPL-2' },
    { id: 'ASN-DIFFERENT-ORG', orgId: '900001', classId: 'CLASS-1', templateId: 'TPL-1' },
    { id: 'ASN-ARCHIVED', orgId: '900000', classId: 'CLASS-1', templateId: 'TPL-1' },
    { id: 'ASN-MISMATCHED', orgId: '900000', classId: 'CLASS-OTHER', templateId: 'TPL-1' }
  ];

  await withPatched(schoolDataService, {
    fetchData: async (entityType) => {
      if (entityType === 'reportInstances') return instances;
      if (entityType === 'reportAssignments') return assignments;
      return [];
    }
  }, async () => {
    const fullNavigator = await reportViewService.buildReportReviewNavigator({
      currentInstance,
      reqUser
    });
    assert.deepEqual(fullNavigator.rows.map((row) => row.id), ['INST-CURRENT', 'INST-OTHER-TEACHER', 'INST-OLDER']);
    assert.equal(fullNavigator.currentIndex, 0);
    assert.equal(fullNavigator.olderCount, 2);
    assert.equal(fullNavigator.olderHref, '/school/reports/instances/edit-v2/INST-OTHER-TEACHER');
    assert.equal(fullNavigator.newerHref, '');
    assert.deepEqual(Object.keys(fullNavigator.rows[0]).sort(), ['href', 'id', 'isCurrent', 'sessionDate', 'status', 'teacherId'].sort());

    const participantNavigator = await reportViewService.buildReportReviewNavigator({
      currentInstance,
      reqUser: { ...reqUser, personId: 'TEACHER-1' },
      participantOnly: true
    });
    assert.deepEqual(participantNavigator.rows.map((row) => row.id), ['INST-CURRENT', 'INST-OLDER']);
  });
});

test('report controller uses person ids for fallback teacher and student lookup', () => {
  const source = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/controllers/school/reportController.js'), 'utf8');
  assert.match(source, /fallbackTeacherId:\s*req\.user\?\.personId\s*\|\|\s*''/);
  assert.doesNotMatch(source, /fallbackTeacherId:\s*req\.user\?\.id\s*\|\|\s*''/);
  assert.match(source, /personId__eq:\s*studentPersonId/);
  assert.match(source, /dataServiceGlobal\.getDataById\('persons',\s*studentPersonId/);
});

test('report instance list renders pending assigned reports with start action and student column', () => {
  const source = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/report/instanceList.ejs'), 'utf8');
  assert.match(source, /<th>Student<\/th>/);
  assert.match(source, /row\.isPendingAssignment/);
  assert.match(source, /Pending report/);
  assert.match(source, /\/school\/reports\/instances\/start\//);
  assert.match(source, /studentId=/);
});

test('report instance save route accepts safe action-state fallback for stale editor tabs', () => {
  const source = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/routes/reportRoutes.js'), 'utf8');
  assert.match(
    source,
    /router\.post\('\/instances\/edit\/:id'[\s\S]*trackActionState\(REPORT_INSTANCE_SECTION,\s*OPERATIONS\.UPDATE,\s*\{[\s\S]*requireToken:\s*true[\s\S]*allowOperationTokenFallback:\s*true[\s\S]*allowInactiveTokenFallback:\s*true[\s\S]*\}\)/,
    'report instance save route should allow fallback for stale/expired action-state tokens'
  );
});

test('report instance editor prevents duplicate saves and explains expired form sessions', () => {
  const source = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/report/instanceEditor.ejs'), 'utf8');
  assert.match(source, /name="actionStateId"\s+value="<%= actionStateId \|\| '' %>"/);
  assert.match(source, /reportInstanceSubmitting/);
  assert.match(source, /setReportInstanceSubmitting\(true,\s*submitter\)/);
  assert.match(source, /Form Session Expired/);
  assert.match(source, /This report form session is no longer active/);
  assert.doesNotMatch(source, /If you need this for your work, an administrator can add it to your profile/);
});
