const test = require('node:test');
const assert = require('node:assert/strict');

const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const schoolRepositories = require('../packages/school/MVC/repositories/school');
const classEnrollmentReadService = require('../packages/school/MVC/services/school/classEnrollmentReadService');
const reportIntegrityService = require('../packages/school/MVC/services/school/reportIntegrityService');

const reqUser = { id: 'USER-1', activeOrgId: '900000' };

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

test('report roster statuses include completed periods only for rolling classes', () => {
  assert.deepEqual(
    classEnrollmentReadService.getReportRosterStatusesForClass({ registrationMode: 'rolling' }),
    ['active', 'planned', 'completed']
  );
  assert.deepEqual(
    classEnrollmentReadService.getReportRosterStatusesForClass({ registrationMode: 'term_based' }),
    ['active', 'planned']
  );
});

test('completed rolling enrollment periods are eligible only when they overlap the report target date', async () => {
  const periods = [
    {
      id: 'PERIOD-OVERLAP',
      orgId: '900000',
      classId: 'CLASS-ROLLING',
      studentId: 'STU-1',
      status: 'completed',
      startDate: '2026-06-01',
      endDate: '2026-06-30'
    },
    {
      id: 'PERIOD-ENDED',
      orgId: '900000',
      classId: 'CLASS-ROLLING',
      studentId: 'STU-2',
      status: 'completed',
      startDate: '2026-05-01',
      endDate: '2026-06-28'
    },
    {
      id: 'PERIOD-CANCELLED',
      orgId: '900000',
      classId: 'CLASS-ROLLING',
      studentId: 'STU-3',
      status: 'cancelled',
      startDate: '2026-06-01',
      endDate: '2026-06-30'
    }
  ];

  await withPatched(schoolDataService, {
    getClassEnrollmentPeriodsByClassId: async () => periods
  }, async () => {
    const snapshot = await classEnrollmentReadService.listActiveStudentIdsForClass({
      classId: 'CLASS-ROLLING',
      classItem: { id: 'CLASS-ROLLING', orgId: '900000', registrationMode: 'rolling' },
      reqUser,
      activeOrgId: '900000',
      startDate: '2026-06-29',
      endDate: '2026-06-29',
      canonicalStatuses: classEnrollmentReadService.getReportRosterStatusesForClass({ registrationMode: 'rolling' })
    });

    assert.deepEqual([...snapshot.studentIds].sort(), ['STU-1']);
  });
});

test('each-student report assignment accepts completed rolling membership on the target date', async () => {
  const rollingClass = {
    id: 'CLASS-ROLLING',
    orgId: '900000',
    registrationMode: 'rolling',
    title: 'Rolling Class'
  };
  const template = { id: 'TPL-1', orgId: '900000', title: 'Progress Report' };
  const students = [{ id: 'STU-1', orgId: '900000', personId: 'PERSON-1' }];
  const periods = [{
    id: 'PERIOD-1',
    orgId: '900000',
    classId: 'CLASS-ROLLING',
    studentId: 'STU-1',
    status: 'completed',
    startDate: '2026-06-01',
    endDate: '2026-06-30'
  }];

  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => {
      if (entityType === 'classes' && id === 'CLASS-ROLLING') return rollingClass;
      return null;
    },
    getClassSessions: async () => [],
    getClassEnrollmentPeriodsByClassId: async () => periods,
    fetchData: async (entityType) => {
      if (entityType === 'students') return students;
      if (entityType === 'classes') return [rollingClass];
      return [];
    }
  }, async () => {
    await withPatched(schoolRepositories.reportTemplates, {
      getById: async (id) => (id === 'TPL-1' ? template : null)
    }, async () => {
      const result = await reportIntegrityService.validateAssignmentCrossEntityContext({
        classId: 'CLASS-ROLLING',
        templateId: 'TPL-1',
        reqUser,
        reportScope: 'each_student',
        hasSessionTargets: false,
        selectedDateTargets: ['2026-06-29'],
        teacherIds: [],
        requestedTaskStartTime: '',
        requestedTaskEndTime: '',
        conflictPermitted: true,
        requestedReportStartDate: '',
        requestedReportDueDate: '',
        selectedTargetStudentIds: []
      });

      assert.deepEqual(result.classStudentIds, ['PERSON-1']);
      assert.deepEqual(result.persistedTargetStudentIds, []);
    });
  });
});

test('non-rolling each-student report assignment still rejects completed-only membership', async () => {
  const termClass = {
    id: 'CLASS-TERM',
    orgId: '900000',
    registrationMode: 'term_based',
    title: 'Term Class'
  };
  const template = { id: 'TPL-1', orgId: '900000', title: 'Progress Report' };
  const periods = [{
    id: 'PERIOD-TERM',
    orgId: '900000',
    classId: 'CLASS-TERM',
    studentId: 'STU-1',
    status: 'completed',
    startDate: '2026-06-01',
    endDate: '2026-06-30'
  }];

  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => {
      if (entityType === 'classes' && id === 'CLASS-TERM') return termClass;
      return null;
    },
    getClassSessions: async () => [],
    getClassEnrollmentPeriodsByClassId: async () => periods,
    fetchData: async () => []
  }, async () => {
    await withPatched(schoolRepositories.reportTemplates, {
      getById: async (id) => (id === 'TPL-1' ? template : null)
    }, async () => {
      await assert.rejects(
        reportIntegrityService.validateAssignmentCrossEntityContext({
          classId: 'CLASS-TERM',
          templateId: 'TPL-1',
          reqUser,
          reportScope: 'each_student',
          hasSessionTargets: false,
          selectedDateTargets: ['2026-06-29'],
          teacherIds: [],
          requestedTaskStartTime: '',
          requestedTaskEndTime: '',
          conflictPermitted: true,
          requestedReportStartDate: '',
          requestedReportDueDate: '',
          selectedTargetStudentIds: []
        }),
        /No students with active enrollment on 2026-06-29/
      );
    });
  });
});

test('selected-students report assignment rejects students outside the rolling target-date roster', async () => {
  const rollingClass = {
    id: 'CLASS-ROLLING',
    orgId: '900000',
    registrationMode: 'rolling',
    title: 'Rolling Class'
  };
  const template = { id: 'TPL-1', orgId: '900000', title: 'Progress Report' };
  const students = [
    { id: 'STU-1', orgId: '900000', personId: 'PERSON-1' },
    { id: 'STU-2', orgId: '900000', personId: 'PERSON-2' }
  ];
  const periods = [{
    id: 'PERIOD-1',
    orgId: '900000',
    classId: 'CLASS-ROLLING',
    studentId: 'STU-1',
    status: 'completed',
    startDate: '2026-06-01',
    endDate: '2026-06-30'
  }];

  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => {
      if (entityType === 'classes' && id === 'CLASS-ROLLING') return rollingClass;
      return null;
    },
    getClassSessions: async () => [],
    getClassEnrollmentPeriodsByClassId: async () => periods,
    fetchData: async (entityType) => (entityType === 'students' ? students : [])
  }, async () => {
    await withPatched(schoolRepositories.reportTemplates, {
      getById: async (id) => (id === 'TPL-1' ? template : null)
    }, async () => {
      await assert.rejects(
        reportIntegrityService.validateAssignmentCrossEntityContext({
          classId: 'CLASS-ROLLING',
          templateId: 'TPL-1',
          reqUser,
          reportScope: 'selected_students',
          hasSessionTargets: false,
          selectedDateTargets: ['2026-06-29'],
          teacherIds: [],
          requestedTaskStartTime: '',
          requestedTaskEndTime: '',
          conflictPermitted: true,
          requestedReportStartDate: '',
          requestedReportDueDate: '',
          selectedTargetStudentIds: ['PERSON-2']
        }),
        /not actively enrolled on 2026-06-29/
      );
    });
  });
});
